import type { CustomerIntent, Offer, Preferences, ScoreBreakdown, ScoredOffer } from '../schemas'
import { PREFERENCE_KEYS } from '../schemas'
import {
  batteryScore,
  clamp01,
  cpuTier,
  generationScore,
  gpuTier,
  portabilityScore,
  ramScore,
  storageScore,
} from './specs'

/**
 * Stage 2 of customer ranking: weighted utility over offers that survived the
 * hard filter. Every dimension is a pure function of structured facts, so the
 * same inputs always produce the same ranking and every number is explainable.
 */

export interface ScoringContext {
  /** All surviving offers, used for relative price/value normalization. */
  peers: Offer[]
}

export function normalizeWeights(prefs: Preferences): Preferences {
  const total = PREFERENCE_KEYS.reduce((acc, k) => acc + (prefs[k] ?? 0), 0)
  if (total <= 0) {
    const even = 1 / PREFERENCE_KEYS.length
    return Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, even])) as unknown as Preferences
  }
  return Object.fromEntries(
    PREFERENCE_KEYS.map((k) => [k, Number((((prefs[k] ?? 0) / total)).toFixed(6))]),
  ) as unknown as Preferences
}

export function dimensionScores(offer: Offer, intent: CustomerIntent, ctx: ScoringContext) {
  const s = offer.product.specs
  const gpu = gpuTier(s.gpu)
  const cpu = cpuTier(s.cpu)

  // --- value -------------------------------------------------------------
  // Half from headroom under the stated budget, half from price relative to
  // the other offers in this round (cheapest = 1, most expensive = 0).
  const budget = intent.hardConstraints.maxPrice
  const prices = ctx.peers.map((p) => p.price)
  const min = Math.min(...prices, offer.price)
  const max = Math.max(...prices, offer.price)
  const relative = max === min ? 0.5 : (max - offer.price) / (max - min)
  const bundleUplift = offer.bundle ? clamp01(offer.bundle.value / (offer.price * 0.06)) * 0.15 : 0
  const value = budget
    ? clamp01(relative * 0.5 + clamp01((budget - offer.price) / (budget * 0.35)) * 0.5 + bundleUplift)
    : // With no stated budget there is no headroom to measure, so price position
      // within the round carries the whole signal. Splitting against a constant
      // would make an expensive offer look mid-priced.
      clamp01(relative + bundleUplift)

  // --- CAD / workstation --------------------------------------------------
  // Viewport work needs GPU compute and single-thread CPU; assemblies need RAM.
  const cadPerformance = clamp01(
    gpu.compute * 0.45 + cpu.single * 0.2 + cpu.multi * 0.1 + ramScore(s.ramGb) * 0.25,
  )

  // --- gaming -------------------------------------------------------------
  const gamingPerformance = clamp01(gpu.raster * 0.72 + cpu.single * 0.18 + ramScore(s.ramGb) * 0.1)

  // --- portability --------------------------------------------------------
  const portability = portabilityScore(s.weightKg)

  // --- battery ------------------------------------------------------------
  // Big discrete GPUs cost real endurance even with a large pack.
  const battery = clamp01(batteryScore(s.batteryWh) * (s.dedicatedGpu ? 0.82 : 1))

  // --- longevity ----------------------------------------------------------
  const longevity = clamp01(
    generationScore(s.generation) * 0.34 +
      ramScore(s.ramGb) * 0.2 +
      storageScore(s.storageGb) * 0.12 +
      clamp01(offer.warrantyYears / 3) * 0.2 +
      (s.ramUpgradeable ? 0.09 : 0) +
      (offer.product.condition === 'new' ? 0.05 : 0),
  )

  // --- warranty / delivery / bundle ---------------------------------------
  const warranty = clamp01(offer.warrantyYears / 3)
  const delivery = clamp01(1 - offer.deliveryDays / 7)
  const bundleValue = offer.bundle ? clamp01(offer.bundle.value / 120) : 0

  return {
    value,
    cadPerformance,
    gamingPerformance,
    portability,
    battery,
    longevity,
    warranty,
    delivery,
    bundleValue,
  } satisfies Record<(typeof PREFERENCE_KEYS)[number], number>
}

export function scoreOffer(
  offer: Offer,
  intent: CustomerIntent,
  ctx: ScoringContext,
): { score: number; breakdown: ScoreBreakdown } {
  const dims = dimensionScores(offer, intent, ctx)
  const weights = normalizeWeights(intent.preferences)
  const breakdown: ScoreBreakdown = {}
  let score = 0
  for (const k of PREFERENCE_KEYS) {
    const raw = dims[k]
    const weight = weights[k]
    const contribution = raw * weight
    score += contribution
    breakdown[k] = {
      raw: Number(raw.toFixed(4)),
      weight: Number(weight.toFixed(4)),
      contribution: Number(contribution.toFixed(4)),
    }
  }
  return { score: Number(score.toFixed(4)), breakdown }
}

export function rankOffers(offers: Offer[], intent: CustomerIntent): ScoredOffer[] {
  const ctx: ScoringContext = { peers: offers }
  const scored = offers.map((o) => {
    const { score, breakdown } = scoreOffer(o, intent, ctx)
    return {
      offerId: o.offerId,
      merchantId: o.merchantId,
      merchantName: o.merchantName,
      score,
      scorePct: Math.round(score * 100),
      breakdown,
      rank: 0,
      label: null as string | null,
    }
  })

  scored.sort((a, b) => b.score - a.score || a.offerId.localeCompare(b.offerId))
  scored.forEach((s, i) => (s.rank = i + 1))

  // Human-facing labels derived from the same breakdown, not invented.
  if (scored.length) {
    scored[0].label = 'Best overall'
    const byValue = [...scored].sort((a, b) => b.breakdown.value.raw - a.breakdown.value.raw)[0]
    const byPerf = [...scored].sort(
      (a, b) =>
        b.breakdown.cadPerformance.raw + b.breakdown.gamingPerformance.raw -
        (a.breakdown.cadPerformance.raw + a.breakdown.gamingPerformance.raw),
    )[0]
    if (byValue && byValue.offerId !== scored[0].offerId) byValue.label = 'Best value'
    if (byPerf && !byPerf.label) byPerf.label = 'Best performance'
  }
  return scored
}

/** Top contributing dimensions, used to ground the natural-language explanation. */
export function topDrivers(s: ScoredOffer, n = 3): { key: string; raw: number; weight: number }[] {
  return Object.entries(s.breakdown)
    .map(([key, v]) => ({ key, raw: v.raw, weight: v.weight, contribution: v.contribution }))
    .filter((d) => d.weight > 0.02)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, n)
    .map(({ key, raw, weight }) => ({ key, raw, weight }))
}
