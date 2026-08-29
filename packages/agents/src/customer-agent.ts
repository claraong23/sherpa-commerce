import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { emitAgentEvent } from '@core/events/bus'
import { nowIso } from '@core/ids'
import { hardFilter, verifyOfferFacts } from '@core/scoring/filter'
import { rankOffers, topDrivers } from '@core/scoring/score'
import type {
  CustomerIntent,
  DemoFaults,
  FilterResult,
  Merchant,
  Offer,
  ScoredOffer,
} from '@core/schemas'
import { EMPTY_FAULTS } from '@core/schemas'
import { signAgentRequest, tamperSignature, verifyAgentRequest } from '@visa/tap'
import { applyPreferenceUpdate, buildCustomerIntent } from './intent'
import { complete, scrubForPrompt } from './llm'
import { createMerchantOffer } from './merchant-agent'

/**
 * CUSTOMER AGENT
 *
 * Runs the sealed offer round and then independently evaluates what came back.
 * It advocates for the buyer: merchant objectives never enter the ranking, and
 * offers are checked against the merchant's own catalogue record before they
 * are scored.
 */

const DIMENSION_LABELS: Record<string, string> = {
  value: 'price and value',
  cadPerformance: 'CAD and workstation performance',
  gamingPerformance: 'gaming performance',
  portability: 'portability',
  battery: 'battery life',
  longevity: 'how long it will stay useful',
  warranty: 'warranty cover',
  delivery: 'delivery speed',
  bundleValue: 'included extras',
}

export interface OfferRoundResult {
  intent: CustomerIntent
  offers: Offer[]
  filters: FilterResult[]
  ranked: ScoredOffer[]
  rejected: { offer: Offer; violations: FilterResult['violations'] }[]
  recommendation: {
    offerId: string
    text: string
    scorePct: number
  } | null
  declines: { merchantId: string; merchantName: string; reason: string }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runOfferRound(args: {
  intent: CustomerIntent
  sessionId: string
  faults?: DemoFaults
}): Promise<OfferRoundResult> {
  const { intent, sessionId } = args
  const faults = args.faults ?? EMPTY_FAULTS
  const store = getStore()
  const env = serverEnv()

  const merchants = (await store.listMerchants()).filter((m) => m.networkEnabled)

  await emitAgentEvent({
    sessionId,
    type: 'RFO_CREATED',
    actor: 'customer_agent',
    payload: {
      requestId: intent.requestId,
      merchantCount: merchants.length,
      hardConstraints: intent.hardConstraints,
    },
  })

  const offers: Offer[] = []
  const declines: OfferRoundResult['declines'] = []

  // Merchants are dispatched with a small stagger so the exchange is legible in
  // the visualization. Each merchant agent runs independently and cannot see
  // any other merchant's offer.
  for (const merchant of merchants) {
    const outcome = await dispatchToMerchant({ merchant, intent, sessionId, faults })
    if (outcome.offer) offers.push(outcome.offer)
    else if (outcome.reason) declines.push({ merchantId: merchant.id, merchantName: merchant.name, reason: outcome.reason })
    if (env.agentStaggerMs > 0) await sleep(env.agentStaggerMs)
  }

  await emitAgentEvent({
    sessionId,
    type: 'ALL_OFFERS_RECEIVED',
    actor: 'exchange',
    payload: { received: offers.length, declined: declines.length },
  })

  /* ── Stage 1: hard filter ─────────────────────────────────────────── */
  const filters: FilterResult[] = []
  const surviving: Offer[] = []
  const rejected: OfferRoundResult['rejected'] = []

  for (const offer of offers) {
    const f = hardFilter(offer, intent)
    filters.push(f)
    if (f.passed) surviving.push(offer)
    else rejected.push({ offer, violations: f.violations })
    await emitAgentEvent({
      sessionId,
      type: 'OFFER_HARD_FILTERED',
      actor: 'customer_agent',
      merchantId: offer.merchantId,
      payload: { offerId: offer.offerId, passed: f.passed, violations: f.violations },
    })
  }

  /* ── Stage 1b: independent factual verification ───────────────────── */
  for (const offer of surviving) {
    const product = await store.getProductBySku(offer.merchantId, offer.sku)
    const check = verifyOfferFacts(
      offer,
      product
        ? {
            price: product.price,
            specs: product.specs,
            condition: product.condition,
            stock: product.stock,
          }
        : null,
    )
    await emitAgentEvent({
      sessionId,
      type: 'OFFER_FACTS_VERIFIED',
      actor: 'customer_agent',
      merchantId: offer.merchantId,
      payload: { offerId: offer.offerId, verified: check.verified, discrepancies: check.discrepancies },
    })
  }

  /* ── Stage 2: weighted customer utility ───────────────────────────── */
  const ranked = rankOffers(surviving, intent)
  for (const s of ranked) {
    await emitAgentEvent({
      sessionId,
      type: 'OFFER_SCORED',
      actor: 'customer_agent',
      merchantId: s.merchantId,
      payload: {
        offerId: s.offerId,
        scorePct: s.scorePct,
        rank: s.rank,
        label: s.label,
        drivers: topDrivers(s, 3),
      },
    })
  }

  /* ── Recommendation ───────────────────────────────────────────────── */
  let recommendation: OfferRoundResult['recommendation'] = null
  if (ranked.length) {
    const winner = ranked[0]
    const winningOffer = surviving.find((o) => o.offerId === winner.offerId)!
    const text = await explainRecommendation({ winner, winningOffer, ranked, offers: surviving, intent, rejected })
    recommendation = { offerId: winner.offerId, text, scorePct: winner.scorePct }
    await emitAgentEvent({
      sessionId,
      type: 'RECOMMENDATION_CREATED',
      actor: 'customer_agent',
      merchantId: winner.merchantId,
      payload: { offerId: winner.offerId, scorePct: winner.scorePct, considered: surviving.length },
    })
  }

  return { intent, offers, filters, ranked, rejected, recommendation, declines }
}

/* ─────────────────  One merchant, one signed request  ───────────────── */

async function dispatchToMerchant(args: {
  merchant: Merchant
  intent: CustomerIntent
  sessionId: string
  faults: DemoFaults
}): Promise<{ offer: Offer | null; reason: string | null }> {
  const { merchant, intent, sessionId, faults } = args
  const store = getStore()

  // The RFO body carries requirements only — never the customer's payment
  // credential, identity, or the other merchants in the round.
  const rfoBody = {
    requestId: intent.requestId,
    category: intent.category,
    currency: intent.currency,
    hardConstraints: intent.hardConstraints,
    preferences: intent.preferences,
    context: intent.context,
    rawText: intent.rawText,
  }

  let signed = signAgentRequest({
    method: 'POST',
    path: `/agent/${merchant.agentId}/offers`,
    body: rfoBody,
    agentIntent: 'PURCHASE',
    agentId: 'customer-agent-01',
  })

  if (faults.invalidSignature) {
    signed = tamperSignature(signed)
    await emitAgentEvent({
      sessionId,
      type: 'DEMO_FAULT_INJECTED',
      actor: 'system',
      merchantId: merchant.id,
      label: 'Demo fault: signature tampered in transit',
      payload: { fault: 'invalidSignature' },
    })
  }

  await emitAgentEvent({
    sessionId,
    type: 'TAP_REQUEST_SIGNED',
    actor: 'trust',
    merchantId: merchant.id,
    payload: {
      keyId: signed.keyId,
      agentIntent: signed.agentIntent,
      nonce: signed.nonce.slice(0, 12),
      contentDigest: signed.contentDigest.slice(0, 28) + '…',
    },
  })

  await emitAgentEvent({
    sessionId,
    type: 'RFO_SENT',
    actor: 'exchange',
    merchantId: merchant.id,
    payload: { agentId: merchant.agentId, requestId: intent.requestId },
  })

  // Merchant side verifies before doing any commercial work.
  const verification = verifyAgentRequest(signed)
  if (!verification.valid) {
    await emitAgentEvent({
      sessionId,
      type: 'AGENT_SIGNATURE_INVALID',
      actor: 'trust',
      merchantId: merchant.id,
      label: `AGENT_SIGNATURE_INVALID — ${verification.code}`,
      payload: { code: verification.code, detail: verification.detail },
    })
    return { offer: null, reason: `AGENT_SIGNATURE_INVALID (${verification.code})` }
  }

  await emitAgentEvent({
    sessionId,
    type: 'TAP_AGENT_VERIFIED',
    actor: 'trust',
    merchantId: merchant.id,
    payload: {
      agentId: verification.agentId,
      intent: verification.agentIntent,
      keyId: verification.keyId,
      algorithm: 'ed25519',
    },
  })

  const profile = await store.getProfile(merchant.id)
  if (!profile) return { offer: null, reason: 'merchant has no approved profile' }

  const outcome = await createMerchantOffer({
    merchant,
    profile,
    intent,
    sessionId,
    forceOutOfStock: faults.outOfStock,
  })

  return { offer: outcome.offer, reason: outcome.declineReason }
}

/* ────────────────────────────  Explanation  ──────────────────────────── */

async function explainRecommendation(args: {
  winner: ScoredOffer
  winningOffer: Offer
  ranked: ScoredOffer[]
  offers: Offer[]
  intent: CustomerIntent
  rejected: OfferRoundResult['rejected']
}): Promise<string> {
  const { winner, winningOffer, ranked, offers, intent, rejected } = args

  // The model receives only verified facts and computed scores. It writes prose;
  // it does not decide the ranking and cannot introduce a spec.
  const facts = {
    recommendation: {
      merchant: winningOffer.merchantName,
      product: winningOffer.product.title,
      price: winningOffer.price,
      currency: winningOffer.currency,
      warrantyYears: winningOffer.warrantyYears,
      deliveryDays: winningOffer.deliveryDays,
      bundle: winningOffer.bundle,
      specs: winningOffer.product.specs,
      condition: winningOffer.product.condition,
      matchPct: winner.scorePct,
      strongestDimensions: topDrivers(winner, 3).map((d) => DIMENSION_LABELS[d.key] ?? d.key),
      tradeoffs: winningOffer.tradeoffs,
      budgetHeadroom: intent.hardConstraints.maxPrice
        ? Number((intent.hardConstraints.maxPrice - winningOffer.price).toFixed(2))
        : null,
    },
    alternatives: ranked.slice(1, 3).map((s) => {
      const o = offers.find((x) => x.offerId === s.offerId)!
      return {
        merchant: o.merchantName,
        product: o.product.title,
        price: o.price,
        matchPct: s.scorePct,
        label: s.label,
        specs: { gpu: o.product.specs.gpu, ramGb: o.product.specs.ramGb, weightKg: o.product.specs.weightKg },
        warrantyYears: o.warrantyYears,
        tradeoffs: o.tradeoffs,
      }
    }),
    eliminated: rejected.map((r) => ({
      merchant: r.offer.merchantName,
      product: r.offer.product.title,
      reasons: r.violations.map((v) => v.detail),
    })),
    customerPriorities: Object.entries(intent.preferences)
      .filter(([, v]) => (v as number) > 0.1)
      .map(([k]) => DIMENSION_LABELS[k] ?? k),
  }

  const prose = await complete(
    [
      {
        role: 'system',
        content: [
          'You are a shopping agent working for the buyer, reporting the result of an offer round.',
          'Write 2-4 short sentences, plain language, no markdown, no bullet points, no headings.',
          'Rules:',
          '- Use ONLY the numbers and specifications in the JSON. Never state a spec that is not there.',
          '- Lead with the recommendation and the single clearest reason it won.',
          '- Name one honest tradeoff if the data shows one.',
          '- If something was eliminated by a hard constraint, mention it in a half-sentence.',
          '- Do not mention scores as percentages more than once.',
          '- Do not describe your own reasoning process.',
        ].join('\n'),
      },
      { role: 'user', content: scrubForPrompt(JSON.stringify(facts), 3500) },
    ],
    { maxTokens: 260, temperature: 0.5 },
  )

  if (prose) return prose

  // Deterministic explanation when the LLM is unavailable.
  const r = facts.recommendation
  const parts: string[] = []
  parts.push(
    `Best overall is the ${r.product} from ${r.merchant} at ${r.currency} ${r.price.toFixed(0)} — a ${r.matchPct}% match on what you asked for.`,
  )
  parts.push(
    `It leads on ${r.strongestDimensions.slice(0, 2).join(' and ')}, with ${r.specs.gpu}, ${r.specs.ramGb} GB RAM and a ${r.warrantyYears}-year warranty.`,
  )
  if (r.budgetHeadroom !== null && r.budgetHeadroom > 0) {
    parts.push(`That leaves ${r.currency} ${r.budgetHeadroom.toFixed(0)} under your budget.`)
  }
  if (r.tradeoffs.length) parts.push(`Worth knowing: ${r.tradeoffs[0].toLowerCase()}.`)
  if (facts.eliminated.length) {
    parts.push(
      `${facts.eliminated.length} offer${facts.eliminated.length > 1 ? 's were' : ' was'} ruled out on your hard requirements (${facts.eliminated[0].reasons[0]}).`,
    )
  }
  return parts.join(' ')
}

/** Short natural-language answer for follow-up questions about a completed round. */
export async function answerFollowUp(args: {
  question: string
  round: OfferRoundResult
}): Promise<string | null> {
  const { question, round } = args
  if (!round.ranked.length) return null

  const facts = round.ranked.map((s) => {
    const o = round.offers.find((x) => x.offerId === s.offerId)!
    return {
      merchant: o.merchantName,
      product: o.product.title,
      price: o.price,
      currency: o.currency,
      matchPct: s.scorePct,
      specs: o.product.specs,
      warrantyYears: o.warrantyYears,
      deliveryDays: o.deliveryDays,
      bundle: o.bundle,
      tradeoffs: o.tradeoffs,
    }
  })

  return complete(
    [
      {
        role: 'system',
        content: [
          'You are the buyer\'s shopping agent. Answer the follow-up question in 1-3 short sentences.',
          'Use ONLY the offer data provided. If the answer is not in the data, say you do not have it.',
          'No markdown, no lists, no reasoning narration.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: scrubForPrompt(`Offers on the table:\n${JSON.stringify(facts)}\n\nQuestion: ${question}`, 3000),
      },
    ],
    { maxTokens: 200, temperature: 0.4 },
  )
}

/* ────────────────────  Full customer request (domain entry)  ──────────────────── */

export type CustomerRequestResult =
  | { status: 'needs_clarification'; intent: CustomerIntent; question: string }
  | ({ status: 'ranked'; reranked: boolean } & OfferRoundResult)

/**
 * The whole customer-side flow, from raw text to a recommendation.
 *
 * This lives here rather than in the route handler so the event stream is
 * identical however the flow is invoked — HTTP, the smoke test, or a test
 * harness. A route that emitted its own events would produce a visualization
 * that only works over HTTP.
 */
export async function runCustomerRequest(args: {
  sessionId: string
  text: string
  faults?: DemoFaults
}): Promise<CustomerRequestResult> {
  const store = getStore()
  const { sessionId, text } = args

  await emitAgentEvent({
    sessionId,
    type: 'INTENT_RECEIVED',
    actor: 'customer_agent',
    payload: { text },
  })

  // Carry preferences forward so "battery matters more than gaming" re-ranks
  // the existing requirement rather than starting from scratch.
  const session = await store.getCustomerSession(sessionId)
  const priorIntent = session?.currentRequestId ? await store.getIntent(session.currentRequestId) : null
  const updatedPrefs = priorIntent ? applyPreferenceUpdate(text, priorIntent.preferences) : null

  const intent = await buildCustomerIntent({
    sessionId,
    text: updatedPrefs ? `${priorIntent!.rawText} ${text}` : text,
    priorPreferences: updatedPrefs ?? undefined,
  })
  await store.saveIntent(intent)

  await emitAgentEvent({
    sessionId,
    type: 'INTENT_PARSED',
    actor: 'customer_agent',
    payload: {
      requestId: intent.requestId,
      useCases: intent.context.useCases,
      preferences: intent.preferences,
      reranked: Boolean(updatedPrefs),
    },
  })

  await emitAgentEvent({
    sessionId,
    type: 'CUSTOMER_CONSTRAINTS_SET',
    actor: 'customer_agent',
    payload: { hardConstraints: intent.hardConstraints },
  })

  if (intent.clarifyingQuestion) {
    await emitAgentEvent({
      sessionId,
      type: 'CLARIFICATION_REQUESTED',
      actor: 'customer_agent',
      payload: { question: intent.clarifyingQuestion },
    })
    return { status: 'needs_clarification', intent, question: intent.clarifyingQuestion }
  }

  const round = await runOfferRound({ intent, sessionId, faults: args.faults })

  if (session) {
    await store.upsertCustomerSession({ ...session, currentRequestId: intent.requestId, counterUsed: false })
  }

  return { status: 'ranked', reranked: Boolean(updatedPrefs), ...round }
}

export function offerRoundSummary(round: OfferRoundResult) {
  return {
    requestId: round.intent.requestId,
    received: round.offers.length,
    passed: round.ranked.length,
    rejected: round.rejected.length,
    at: nowIso(),
  }
}
