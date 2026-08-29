import { z } from 'zod'
import { getAdapterForMerchant } from '@commerce/index'
import { canonicalizeOffer } from '@core/canonical'
import { getStore } from '@core/db'
import { emitAgentEvent } from '@core/events/bus'
import { id, isoIn, nowIso } from '@core/ids'
import { minimumAllowedPrice, validateOffer } from '@core/policy/validator'
import { hardFilter } from '@core/scoring/filter'
import { scoreOffer } from '@core/scoring/score'
import type {
  Bundle,
  CounterRequest,
  CounterResult,
  CustomerIntent,
  Merchant,
  MerchantProfile,
  Offer,
  Product,
} from '@core/schemas'
import { SEED_BUNDLES } from '@core/seed/products'
import { scrubForPrompt, structured } from './llm'

/**
 * MERCHANT AGENT
 *
 * Not a freeform chatbot with a pricing budget. The flow is:
 *   1. deterministic candidate set  (own inventory, in stock, customer-valid)
 *   2. deterministic ranking by the merchant's objective
 *   3. optional LLM pick among the top candidates + a sales note
 *   4. deterministic pricing / bundle / warranty inside the policy envelope
 *   5. deterministic validation
 *   6. seal (canonicalize + SHA-256)
 *
 * The model can influence step 3 only. If it picks something invalid, step 5
 * rejects it and step 3's deterministic choice is used instead.
 *
 * A merchant agent never sees another merchant's offers.
 */

const StrategySchema = z.object({
  sku: z.string(),
  reason: z.string().max(240),
  customerNote: z.string().max(220),
  tradeoffs: z.array(z.string().max(120)).max(3).default([]),
})

export interface OfferContext {
  merchant: Merchant
  profile: MerchantProfile
  intent: CustomerIntent
  sessionId: string
  /** Demo fault: zero the chosen product's stock before validation. */
  forceOutOfStock?: boolean
}

/* ─────────────────────────  Candidate selection  ───────────────────────── */

/** How well a product serves this merchant's own objective, 0..1. */
export function merchantUtility(product: Product, profile: MerchantProfile, price: number): number {
  const marginAmount = price - product.costPrice
  const marginPct = marginAmount / price
  const priorityHit = product.tags.some((t) => profile.inventoryPriorities.includes(t)) ? 1 : 0

  switch (profile.primaryObjective) {
    case 'margin':
      return Math.min(1, marginPct / 0.25) * 0.8 + priorityHit * 0.2
    case 'inventory_turnover':
      return Math.min(1, product.stock / 10) * 0.6 + priorityHit * 0.4
    case 'aov':
      return Math.min(1, price / 2200) * 0.75 + priorityHit * 0.25
    case 'conversion':
    default:
      return Math.min(1, marginAmount / 400) * 0.3 + Math.min(1, product.stock / 8) * 0.2 + 0.5
  }
}

/**
 * How likely this candidate is to actually win the round.
 *
 * The merchant estimates it with the same public scoring model the customer
 * agent uses — the customer's stated priorities arrive in the RFO, so this is
 * information the merchant legitimately has. It is an estimate only: the
 * merchant scores its own candidates against each other, while the customer
 * scores across merchants and its result is the one that decides the ranking.
 */
function estimateCustomerFit(offer: Offer, intent: CustomerIntent): number {
  // Scored standalone, not against the merchant's other candidates: a peer set
  // drawn from one catalogue makes that catalogue's cheapest SKU look like the
  // best value regardless of the market, which is the wrong signal here. With a
  // single peer the relative-price term is constant across candidates and the
  // budget-anchored headroom term carries the price signal.
  return scoreOffer(offer, intent, { peers: [offer] }).score
}

/**
 * Candidate ranking is expected value, not a weighted sum:
 *
 *     rank = P(win)^SHARPNESS × (FLOOR + (1 - FLOOR) × merchantUtility)
 *
 * A weighted sum lets a high-utility SKU outrank one the customer would
 * actually buy — a turnover-focused merchant ends up pushing its most
 * overstocked box at a customer who wants something else, and wins nothing.
 * Multiplying makes an unwinnable offer worth nothing regardless of its
 * utility, which is the real merchant incentive.
 *
 * SHARPNESS compensates for customer scores being compressed: they average
 * nine normalized dimensions, so a decisive fit difference still only moves the
 * total by ~0.1. FLOOR keeps a merchant from ignoring its objective entirely
 * when two candidates fit similarly.
 */
const WIN_SHARPNESS = 2
const UTILITY_FLOOR = 0.35

export interface Candidate {
  product: Product
  price: number
  bundle: Bundle | null
  warrantyYears: number
  deliveryDays: number
  merchantScore: number
  fitScore: number
}

/**
 * Price the offer at the strongest position the policy envelope allows,
 * given the merchant's objective.
 */
function priceCandidate(product: Product, profile: MerchantProfile, intent: CustomerIntent): Candidate | null {
  const bundles = SEED_BUNDLES[product.merchantId] ?? []
  const budget = intent.hardConstraints.maxPrice

  // Bundles that fit the merchant's allowance, richest first.
  const affordable: Bundle[] = bundles
    .filter((b) => b.value <= profile.bundleAllowance)
    .sort((a, b) => b.value - a.value)
    .map((b) => ({ ...b }))

  const tryPrice = (withBundle: Bundle | null): number | null => {
    const floor = minimumAllowedPrice(product, profile, withBundle?.value ?? 0)
    if (floor > product.price + 0.001) return null

    let target = product.price
    if (profile.primaryObjective === 'inventory_turnover' || profile.primaryObjective === 'conversion') {
      // Discount hard, subject to the floor.
      target = floor
    } else if (profile.primaryObjective === 'margin') {
      // Hold price, concede only what is needed to land under a stated budget.
      target = budget !== undefined && product.price > budget ? Math.max(floor, budget - 1) : product.price
    } else {
      // AOV: hold list, lean on the bundle.
      target = budget !== undefined && product.price > budget ? Math.max(floor, budget - 1) : product.price
    }

    // "Prefer an accessory over a cash discount above N%" — an approved rule.
    const preferUpgrade = profile.salesRules.find(
      (r) => r.approved && r.kind === 'prefer_upgrade_over_discount',
    )
    if (preferUpgrade && withBundle) {
      const threshold = Number((preferUpgrade.params as { discountThresholdPct?: number }).discountThresholdPct ?? 4)
      const cap = product.price * (1 - threshold / 100)
      target = Math.max(target, Math.min(product.price, cap))
      if (target < floor) target = floor
    }

    const price = Math.round(Math.max(floor, Math.min(product.price, target)) * 100) / 100
    if (budget !== undefined && price > budget) return null
    return price
  }

  // Take the richest bundle that still lands inside the customer's budget,
  // trimming down before abandoning the bundle altogether. Every bundled item
  // consumes margin headroom, so a cheaper bundle can be the difference between
  // an offer and no offer.
  let bundle: Bundle | null = null
  let price: number | null = null
  for (const option of [...affordable, null]) {
    const attempt = tryPrice(option)
    if (attempt !== null) {
      bundle = option
      price = attempt
      break
    }
  }
  if (price === null) return null

  const warrantyYears = Math.min(
    profile.maxWarrantyYears,
    Math.max(product.warrantyYears, profile.standardWarrantyYears),
  )

  return {
    product,
    price,
    bundle,
    warrantyYears,
    deliveryDays: profile.standardDeliveryDays,
    merchantScore: merchantUtility(product, profile, price),
    fitScore: 0,
  }
}

export async function buildCandidates(ctx: OfferContext): Promise<Candidate[]> {
  const products = await getStore().listProducts(ctx.merchant.id)
  const priced: { candidate: Candidate; probe: Offer }[] = []

  for (const product of products) {
    if (product.stock <= 0) continue
    const c = priceCandidate(product, ctx.profile, ctx.intent)
    if (!c) continue

    // Probe the customer's hard constraints before spending effort on the offer.
    const probe = draftOffer(ctx, c)
    if (!hardFilter(probe, ctx.intent).passed) continue

    priced.push({ candidate: c, probe })
  }

  const candidates = priced.map(({ candidate, probe }) => ({
    ...candidate,
    fitScore: estimateCustomerFit(probe, ctx.intent),
  }))

  candidates.sort((a, b) => expectedValue(b) - expectedValue(a))
  return candidates
}

export function expectedValue(c: Candidate): number {
  return (
    Math.pow(c.fitScore, WIN_SHARPNESS) * (UTILITY_FLOOR + (1 - UTILITY_FLOOR) * c.merchantScore)
  )
}

/* ────────────────────────────  Offer assembly  ──────────────────────────── */

function draftOffer(ctx: OfferContext, c: Candidate, overrides: Partial<Offer> = {}): Offer {
  const created = nowIso()
  return {
    offerId: overrides.offerId ?? id(`of${ctx.merchant.slug.slice(0, 3)}`),
    requestId: ctx.intent.requestId,
    merchantId: ctx.merchant.id,
    merchantName: ctx.merchant.name,
    sku: c.product.sku,
    product: {
      productId: c.product.id,
      sku: c.product.sku,
      brand: c.product.brand,
      model: c.product.model,
      title: c.product.title,
      listPrice: c.product.price,
      condition: c.product.condition,
      specs: c.product.specs,
      tags: c.product.tags,
      imageUrl: c.product.imageUrl,
    },
    price: c.price,
    currency: ctx.merchant.currency,
    discountPct: Number((((c.product.price - c.price) / c.product.price) * 100).toFixed(2)),
    bundle: c.bundle,
    warrantyYears: c.warrantyYears,
    deliveryDays: c.deliveryDays,
    availability: c.product.stock > 3 ? 'in_stock' : c.product.stock > 0 ? 'low_stock' : 'out_of_stock',
    tradeoffs: [],
    merchantNote: '',
    merchantPolicyVerified: false,
    createdAt: created,
    expiresAt: isoIn(900),
    state: 'draft',
    hash: undefined,
    counterOfOfferId: null,
    ...overrides,
  }
}

/** Factual, derived from the catalogue — not merchant marketing copy. */
function deriveTradeoffs(c: Candidate, intent: CustomerIntent): string[] {
  const out: string[] = []
  const s = c.product.specs
  if (!s.dedicatedGpu && (intent.preferences.cadPerformance > 0.1 || intent.preferences.gamingPerformance > 0.1)) {
    out.push('Integrated graphics only — limited for 3D and gaming workloads')
  }
  if ((s.weightKg ?? 0) >= 2.2 && intent.preferences.portability > 0.12) {
    out.push(`${s.weightKg} kg — heavy for daily carry`)
  }
  if ((s.generation ?? 2026) <= 2024) out.push(`Previous-generation platform (${s.generation})`)
  if (c.product.condition === 'refurbished') out.push('Refurbished unit')
  if ((s.batteryWh ?? 99) < 60) out.push(`Small ${s.batteryWh} Wh battery`)
  if (c.warrantyYears < 2) out.push(`${c.warrantyYears}-year warranty only`)
  if (s.ramGb <= 16 && intent.context.useCases.some((u) => /cad|engineering|ml|machine/i.test(u))) {
    out.push('16 GB RAM may limit large assemblies or datasets')
  }
  return out.slice(0, 3)
}

/* ─────────────────────────────  Public API  ───────────────────────────── */

export interface MerchantOfferOutcome {
  offer: Offer | null
  declineReason: string | null
  validationIssues: { code: string; detail: string }[]
  usedLlmPick: boolean
}

export async function createMerchantOffer(ctx: OfferContext): Promise<MerchantOfferOutcome> {
  const { merchant, profile, intent, sessionId } = ctx
  const store = getStore()
  const adapter = await getAdapterForMerchant(merchant.id)

  const candidates = await buildCandidates(ctx)

  await emitAgentEvent({
    sessionId,
    type: 'MERCHANT_INVENTORY_CHECKED',
    actor: 'merchant_agent',
    merchantId: merchant.id,
    payload: {
      candidatesInStock: candidates.length,
      catalogueSize: (await store.listProducts(merchant.id)).length,
      source: adapter.kind,
    },
  })

  if (!candidates.length) {
    await emitAgentEvent({
      sessionId,
      type: 'MERCHANT_NO_OFFER',
      actor: 'merchant_agent',
      merchantId: merchant.id,
      payload: { reason: 'no in-stock product satisfies the customer constraints inside policy limits' },
    })
    return {
      offer: null,
      declineReason: 'No in-stock product satisfies the customer constraints within merchant pricing policy.',
      validationIssues: [],
      usedLlmPick: false,
    }
  }

  await emitAgentEvent({
    sessionId,
    type: 'MERCHANT_RULES_APPLIED',
    actor: 'merchant_agent',
    merchantId: merchant.id,
    payload: {
      objective: profile.primaryObjective,
      maxDiscountPct: profile.maxDiscountPct,
      bundleAllowance: profile.bundleAllowance,
      approvedRules: profile.salesRules.filter((r) => r.approved).length,
    },
  })

  // The model may pick among the top deterministic candidates and write the note.
  const shortlist = candidates.slice(0, 4)
  let chosen = shortlist[0]
  let usedLlmPick = false
  let note = ''
  let tradeoffs = deriveTradeoffs(chosen, intent)

  const strategy = await structured({
    schema: StrategySchema,
    schemaName: `MerchantStrategy:${merchant.id}`,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: [
          `You are the sales agent for ${merchant.name}. Objective: ${profile.primaryObjective}.`,
          `Tone: ${profile.brandTone ?? 'professional and concise'}.`,
          'Pick ONE sku from the candidate list that best serves the objective while genuinely fitting the customer.',
          'You may not change any price, spec, warranty or availability — those are already fixed.',
          'customerNote: one sentence to the buyer about why this unit suits them. No superlatives, no invented facts.',
          'tradeoffs: honest limitations of this unit for this customer, drawn only from the data given.',
          'Return JSON: {"sku","reason","customerNote","tradeoffs"}.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: scrubForPrompt(
          JSON.stringify({
            customer: {
              request: intent.rawText,
              useCases: intent.context.useCases,
              budget: intent.hardConstraints.maxPrice,
              priorities: intent.preferences,
            },
            // Cost and margin are deliberately absent from the model's view.
            candidates: shortlist.map((c) => ({
              sku: c.product.sku,
              title: c.product.title,
              offerPrice: c.price,
              listPrice: c.product.price,
              specs: c.product.specs,
              condition: c.product.condition,
              stock: c.product.stock,
              warrantyYears: c.warrantyYears,
              deliveryDays: c.deliveryDays,
              bundle: c.bundle,
              tags: c.product.tags,
            })),
          }),
          3500,
        ),
      },
    ],
  })

  if (strategy) {
    const picked = shortlist.find((c) => c.product.sku === strategy.sku)
    if (picked) {
      chosen = picked
      usedLlmPick = true
      note = strategy.customerNote
      const derived = deriveTradeoffs(picked, intent)
      // Union of model-stated and derived tradeoffs; derived always survive.
      tradeoffs = Array.from(new Set([...derived, ...strategy.tradeoffs])).slice(0, 3)
    }
  }

  if (!note) {
    note = defaultNote(chosen, profile)
    tradeoffs = deriveTradeoffs(chosen, intent)
  }

  let offer = draftOffer(ctx, chosen, { merchantNote: note, tradeoffs })

  await emitAgentEvent({
    sessionId,
    type: 'MERCHANT_OFFER_CREATED',
    actor: 'merchant_agent',
    merchantId: merchant.id,
    payload: {
      sku: offer.sku,
      title: offer.product.title,
      price: offer.price,
      currency: offer.currency,
      discountPct: offer.discountPct,
      bundle: offer.bundle,
      warrantyYears: offer.warrantyYears,
      deliveryDays: offer.deliveryDays,
      strategy: usedLlmPick ? 'llm-selected within candidate set' : 'deterministic objective ranking',
    },
  })

  // Live inventory recheck through the commerce adapter.
  const inventory = await adapter.getInventory(merchant.id, offer.sku)
  const liveStock = ctx.forceOutOfStock ? 0 : inventory.available
  if (ctx.forceOutOfStock) {
    await emitAgentEvent({
      sessionId,
      type: 'DEMO_FAULT_INJECTED',
      actor: 'system',
      merchantId: merchant.id,
      label: 'Demo fault: inventory forced to zero',
      payload: { fault: 'outOfStock', sku: offer.sku },
    })
  }

  const product = await store.getProductBySku(merchant.id, offer.sku)
  const validation = validateOffer({ offer, product, profile, intent, liveStock })

  if (!validation.valid) {
    await emitAgentEvent({
      sessionId,
      type: 'MERCHANT_NO_OFFER',
      actor: 'merchant_agent',
      merchantId: merchant.id,
      label: 'Offer rejected by merchant policy validator',
      payload: { issues: validation.issues },
    })
    return {
      offer: null,
      declineReason: validation.issues.map((i) => i.code).join(', '),
      validationIssues: validation.issues,
      usedLlmPick,
    }
  }

  // Seal: canonicalize and hash. Nothing may change after this point.
  offer = { ...offer, merchantPolicyVerified: true, state: 'sealed' }
  const { hash } = canonicalizeOffer(offer)
  offer.hash = hash

  await store.saveOffers([offer])

  await emitAgentEvent({
    sessionId,
    type: 'MERCHANT_OFFER_SEALED',
    actor: 'merchant_agent',
    merchantId: merchant.id,
    payload: { offerId: offer.offerId, hash: hash.slice(0, 16), expiresAt: offer.expiresAt },
  })

  return { offer, declineReason: null, validationIssues: [], usedLlmPick }
}

function defaultNote(c: Candidate, profile: MerchantProfile): string {
  const s = c.product.specs
  const bits = [`${s.cpu} with ${s.gpu}`, `${s.ramGb} GB RAM`, `${c.warrantyYears}-year warranty`]
  if (c.bundle) bits.push(`includes ${c.bundle.description.toLowerCase()}`)
  const objective =
    profile.primaryObjective === 'inventory_turnover'
      ? 'Priced to move'
      : profile.primaryObjective === 'aov'
        ? 'Bundled with service'
        : 'Specified for the workload'
  return `${objective}: ${bits.join(', ')}.`
}

/* ───────────────────────────  Counteroffer  ─────────────────────────── */

export async function handleCounterRequest(args: {
  ctx: OfferContext
  original: Offer
  counter: CounterRequest
}): Promise<CounterResult> {
  const { ctx, original, counter } = args
  const { merchant, profile, intent, sessionId } = ctx
  const store = getStore()

  const product = await store.getProductBySku(merchant.id, original.sku)
  if (!product) {
    return {
      accepted: false,
      offer: null,
      declineReason: 'PRODUCT_UNAVAILABLE',
      merchantMessage: 'That configuration is no longer available.',
    }
  }

  const target = counter.targetPrice
  const keepBundle = counter.mustRetain.includes('bundle')
  const bundleFlexible = counter.flexible.includes('bundle') || counter.flexible.includes('accessories')

  // Try, in order of decreasing cost to the merchant: keep bundle, then drop it.
  const attempts: { bundle: Bundle | null; label: string }[] = keepBundle
    ? [{ bundle: original.bundle, label: 'with bundle retained' }]
    : bundleFlexible
      ? [
          { bundle: original.bundle, label: 'with bundle retained' },
          { bundle: null, label: 'laptop-only' },
        ]
      : [{ bundle: original.bundle, label: 'with bundle retained' }]

  for (const attempt of attempts) {
    const floor = minimumAllowedPrice(product, profile, attempt.bundle?.value ?? 0)
    const price = Math.round(Math.max(floor, target ?? floor) * 100) / 100
    if (target !== null && price > target + 0.001) continue

    const candidate: Candidate = {
      product,
      price,
      bundle: attempt.bundle,
      warrantyYears: original.warrantyYears,
      deliveryDays: original.deliveryDays,
      merchantScore: 0,
      fitScore: 0,
    }

    let offer = draftOffer(ctx, candidate, {
      counterOfOfferId: original.offerId,
      tradeoffs: deriveTradeoffs(candidate, intent),
      merchantNote: attempt.bundle
        ? `Revised price ${merchant.currency} ${price.toFixed(0)}, ${attempt.bundle.description.toLowerCase()} retained.`
        : `Revised price ${merchant.currency} ${price.toFixed(0)}, laptop only.`,
      expiresAt: isoIn(900),
    })

    const adapter = await getAdapterForMerchant(merchant.id)
    const inv = await adapter.getInventory(merchant.id, offer.sku)
    const validation = validateOffer({ offer, product, profile, intent, liveStock: inv.available })
    if (!validation.valid) continue

    offer = { ...offer, merchantPolicyVerified: true, state: 'sealed' }
    offer.hash = canonicalizeOffer(offer).hash
    await store.saveOffers([offer])
    await store.updateOffer({ ...original, state: 'superseded' })

    await emitAgentEvent({
      sessionId,
      type: 'COUNTER_OFFER_CREATED',
      actor: 'merchant_agent',
      merchantId: merchant.id,
      payload: {
        offerId: offer.offerId,
        previousPrice: original.price,
        price: offer.price,
        bundleRetained: Boolean(attempt.bundle),
        hash: offer.hash.slice(0, 16),
      },
    })

    const delta = original.price - offer.price
    return {
      accepted: true,
      offer,
      declineReason: null,
      merchantMessage:
        delta > 0
          ? `${merchant.name} can do ${merchant.currency} ${offer.price.toFixed(0)} ${attempt.label} — ${merchant.currency} ${delta.toFixed(0)} off the sealed offer. Valid for 15 minutes.`
          : `${merchant.name} is holding ${merchant.currency} ${offer.price.toFixed(0)} ${attempt.label}.`,
    }
  }

  const floorWithBundle = minimumAllowedPrice(product, profile, original.bundle?.value ?? 0)
  const floorAlone = minimumAllowedPrice(product, profile, 0)
  const best = Math.min(floorWithBundle, floorAlone)

  await emitAgentEvent({
    sessionId,
    type: 'COUNTER_DECLINED',
    actor: 'merchant_agent',
    merchantId: merchant.id,
    payload: {
      requestedPrice: target,
      policyFloor: Number(best.toFixed(2)),
      reason: 'target below merchant discount/margin floor',
    },
  })

  return {
    accepted: false,
    offer: null,
    declineReason: 'BELOW_MERCHANT_POLICY_FLOOR',
    merchantMessage: `${merchant.name} cannot reach ${merchant.currency} ${target?.toFixed(0) ?? '—'}. Their policy floor on this unit is ${merchant.currency} ${best.toFixed(0)}, so the sealed offer stands.`,
  }
}
