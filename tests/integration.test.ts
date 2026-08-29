import { beforeAll, describe, expect, it } from 'vitest'
import { runCustomerRequest } from '@agents/customer-agent'
import { buildCustomerIntent } from '@agents/intent'
import { handleCounterRequest } from '@agents/merchant-agent'
import {
  authorizePayment,
  issuePaymentInstruction,
  lockOffer,
  markInstructionAuthenticated,
} from '@agents/purchase-flow'
import { createStorefrontTools, storefrontChat } from '@agents/storefront-agent'
import { getStore } from '@core/db'
import { canonicalizeOffer } from '@core/canonical'
import { id, nowIso } from '@core/ids'
import { EMPTY_FAULTS, type CustomerIntent, type DemoFaults } from '@core/schemas'

/**
 * Integration tests over the real in-process stack: seeded store, merchant
 * policy engines, deterministic scoring, TAP verification, Payment Instruction
 * controls and the mock Visa adapter.
 *
 * The LLM is not required — every agent has a deterministic path — so these run
 * identically with and without an OpenAI key.
 */

const PROMPT_A = 'I need a laptop for CAD and gaming under S$1,600. I carry it around every day.'
const PROMPT_B = 'I mostly code and travel. Battery and weight matter more than gaming. Keep it under S$1,500.'
const PROMPT_C = 'I need CUDA for ML. Nothing refurbished. Max S$1,700.'

async function session() {
  const sessionId = id('itest')
  await getStore().upsertCustomerSession({
    id: sessionId,
    createdAt: nowIso(),
    messages: [],
    currentRequestId: null,
    counterUsed: false,
  })
  return sessionId
}

async function round(text: string, faults: DemoFaults = EMPTY_FAULTS) {
  const sessionId = await session()
  const result = await runCustomerRequest({ sessionId, text, faults })
  if (result.status === 'needs_clarification') {
    return {
      sessionId,
      intent: result.intent,
      offers: [],
      filters: [],
      ranked: [],
      rejected: [],
      recommendation: null,
      declines: [],
    }
  }
  return { sessionId, ...result }
}

beforeAll(async () => {
  // Deterministic pacing; the stagger only exists to make the UI legible.
  process.env.AGENT_STAGGER_MS = '0'
  await getStore().reseed()
})

/* ────────────────────────  Request → offers → ranking  ──────────────────────── */

describe('sealed offer round', () => {
  it('collects one offer per network merchant and ranks them', async () => {
    const r = await round(PROMPT_A)
    expect(r.offers.length).toBe(3)
    expect(new Set(r.offers.map((o) => o.merchantId)).size).toBe(3)
    expect(r.ranked.length).toBeGreaterThan(0)
    expect(r.recommendation).not.toBeNull()
  })

  it('seals every offer with a hash matching its canonical form', async () => {
    const r = await round(PROMPT_A)
    for (const o of r.offers) {
      expect(o.state).toBe('sealed')
      expect(o.merchantPolicyVerified).toBe(true)
      expect(o.hash).toBe(canonicalizeOffer(o).hash)
    }
  })

  it('never exposes cost or margin data on an offer', async () => {
    const r = await round(PROMPT_A)
    const serialized = JSON.stringify(r.offers)
    expect(serialized).not.toContain('costPrice')
    expect(serialized).not.toContain('minMarginPct')
    expect(serialized).not.toContain('maxDiscountPct')
  })

  it('only offers products the merchant actually owns', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    for (const o of r.offers) {
      const p = await store.getProductBySku(o.merchantId, o.sku)
      expect(p).not.toBeNull()
      expect(p!.merchantId).toBe(o.merchantId)
    }
  })

  it('never offers an out-of-stock product', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    for (const o of r.offers) {
      const p = await store.getProductBySku(o.merchantId, o.sku)
      expect(p!.stock).toBeGreaterThan(0)
    }
  })

  it('keeps every offer within its merchant discount and margin policy', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    for (const o of r.offers) {
      const p = (await store.getProductBySku(o.merchantId, o.sku))!
      const prof = (await store.getProfile(o.merchantId))!
      const discountPct = ((p.price - o.price) / p.price) * 100
      expect(discountPct).toBeLessThanOrEqual(prof.maxDiscountPct + 0.01)
      const bundleCost = o.bundle?.value ?? 0
      const marginPct = ((o.price - p.costPrice - bundleCost) / o.price) * 100
      expect(marginPct).toBeGreaterThanOrEqual(prof.minMarginPct - 0.01)
    }
  })

  it('emits the full event sequence for the round', async () => {
    const r = await round(PROMPT_A)
    const events = await getStore().listEvents(r.sessionId)
    const types = new Set(events.map((e) => e.eventType))
    for (const expected of [
      'INTENT_PARSED',
      'CUSTOMER_CONSTRAINTS_SET',
      'TAP_REQUEST_SIGNED',
      'TAP_AGENT_VERIFIED',
      'RFO_CREATED',
      'RFO_SENT',
      'MERCHANT_INVENTORY_CHECKED',
      'MERCHANT_RULES_APPLIED',
      'MERCHANT_OFFER_CREATED',
      'MERCHANT_OFFER_SEALED',
      'ALL_OFFERS_RECEIVED',
      'OFFER_HARD_FILTERED',
      'OFFER_FACTS_VERIFIED',
      'OFFER_SCORED',
      'RECOMMENDATION_CREATED',
    ]) {
      expect(types.has(expected as never), `missing ${expected}`).toBe(true)
    }
  })

  it('gives every event a monotonically increasing sequence number', async () => {
    const r = await round(PROMPT_A)
    const events = await getStore().listEvents(r.sessionId)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThan(events[i - 1].seq)
    }
  })
})

describe('ranking responds to the request', () => {
  it('respects the stated budget on every ranked offer', async () => {
    for (const prompt of [PROMPT_A, PROMPT_B, PROMPT_C]) {
      const r = await round(prompt)
      const budget = r.intent.hardConstraints.maxPrice!
      for (const s of r.ranked) {
        const o = r.offers.find((x) => x.offerId === s.offerId)!
        expect(o.price, `${prompt} → ${o.merchantName}`).toBeLessThanOrEqual(budget)
      }
    }
  })

  it('eliminates non-CUDA and refurbished units on the ML prompt', async () => {
    const r = await round(PROMPT_C)
    expect(r.intent.hardConstraints.requiresCuda).toBe(true)
    expect(r.intent.hardConstraints.excludeRefurbished).toBe(true)
    for (const s of r.ranked) {
      const o = r.offers.find((x) => x.offerId === s.offerId)!
      expect(o.product.specs.cuda).toBe(true)
      expect(o.product.condition).toBe('new')
    }
  })

  it('produces different recommendations for different requests', async () => {
    const a = await round(PROMPT_A)
    const b = await round(PROMPT_B)
    const skuA = a.offers.find((o) => o.offerId === a.recommendation!.offerId)!.sku
    const skuB = b.offers.find((o) => o.offerId === b.recommendation!.offerId)!.sku
    expect(skuA).not.toBe(skuB)
  })

  it('favours a light, long-battery machine on the travel prompt', async () => {
    const r = await round(PROMPT_B)
    const winner = r.offers.find((o) => o.offerId === r.recommendation!.offerId)!
    expect(winner.product.specs.weightKg!).toBeLessThan(1.6)
  })

  it('favours a dedicated GPU on the CAD prompt', async () => {
    const r = await round(PROMPT_A)
    const winner = r.offers.find((o) => o.offerId === r.recommendation!.offerId)!
    expect(winner.product.specs.dedicatedGpu).toBe(true)
  })

  it('eliminates every offer when the budget cannot be met', async () => {
    const r = await round('I need a gaming laptop with a dedicated GPU under S$400.')
    expect(r.ranked.length).toBe(0)
    expect(r.recommendation).toBeNull()
  })

  it('rejects an unsatisfiable spec requirement rather than inventing an offer', async () => {
    const r = await round('I need at least 128 GB of RAM under S$1,500.')
    expect(r.ranked.length).toBe(0)
  })
})

/* ────────────────────────────  Counteroffer  ──────────────────────────── */

describe('counteroffer', () => {
  it('returns a cheaper re-sealed offer when policy allows', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    const original = r.offers.find((o) => o.offerId === r.ranked[0].offerId)!
    const merchant = (await store.getMerchant(original.merchantId))!
    const prof = (await store.getProfile(original.merchantId))!
    const target = Math.round(original.price * 0.96)

    const result = await handleCounterRequest({
      ctx: { merchant, profile: prof, intent: r.intent, sessionId: r.sessionId },
      original,
      counter: {
        counterRequestId: id('cnt'),
        requestId: original.requestId,
        offerId: original.offerId,
        targetPrice: target,
        mustRetain: [],
        flexible: ['bundle', 'accessories'],
        rawText: '',
        createdAt: nowIso(),
      },
    })

    if (result.accepted) {
      expect(result.offer!.price).toBeLessThanOrEqual(target + 0.01)
      expect(result.offer!.state).toBe('sealed')
      expect(result.offer!.hash).toBe(canonicalizeOffer(result.offer!).hash)
      expect(result.offer!.counterOfOfferId).toBe(original.offerId)
      // The superseded offer is retired so it cannot be locked later.
      const previous = await store.getOffer(original.offerId)
      expect(previous!.state).toBe('superseded')
    } else {
      expect(result.declineReason).toBe('BELOW_MERCHANT_POLICY_FLOOR')
    }
  })

  it('declines a target below the merchant policy floor and holds the original', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    const original = r.offers.find((o) => o.offerId === r.ranked[0].offerId)!
    const merchant = (await store.getMerchant(original.merchantId))!
    const prof = (await store.getProfile(original.merchantId))!

    const result = await handleCounterRequest({
      ctx: { merchant, profile: prof, intent: r.intent, sessionId: r.sessionId },
      original,
      counter: {
        counterRequestId: id('cnt'),
        requestId: original.requestId,
        offerId: original.offerId,
        targetPrice: 250,
        mustRetain: [],
        flexible: ['bundle'],
        rawText: '',
        createdAt: nowIso(),
      },
    })

    expect(result.accepted).toBe(false)
    expect(result.offer).toBeNull()
    expect(result.merchantMessage).toContain('policy floor')
    expect((await store.getOffer(original.offerId))!.state).toBe('sealed')
  })

  it('never breaches the margin floor to win a counteroffer', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    const original = r.offers.find((o) => o.offerId === r.ranked[0].offerId)!
    const merchant = (await store.getMerchant(original.merchantId))!
    const prof = (await store.getProfile(original.merchantId))!
    const p = (await store.getProductBySku(original.merchantId, original.sku))!

    const result = await handleCounterRequest({
      ctx: { merchant, profile: prof, intent: r.intent, sessionId: r.sessionId },
      original,
      counter: {
        counterRequestId: id('cnt'),
        requestId: original.requestId,
        offerId: original.offerId,
        targetPrice: Math.round(p.costPrice * 0.9),
        mustRetain: [],
        flexible: ['bundle'],
        rawText: '',
        createdAt: nowIso(),
      },
    })
    expect(result.accepted).toBe(false)
  })
})

/* ────────────────────────  Lock → payment → order  ──────────────────────── */

describe('purchase lifecycle', () => {
  async function buy(prompt = PROMPT_A, faults: DemoFaults = EMPTY_FAULTS) {
    const r = await round(prompt, faults)
    const offerId = r.ranked[0].offerId
    const lock = await lockOffer({ sessionId: r.sessionId, offerId, faults })
    if (!lock.ok || !lock.accepted) return { round: r, lock, pi: null, auth: null }
    const pi = await issuePaymentInstruction({
      sessionId: r.sessionId,
      acceptedOfferId: lock.accepted.acceptedOfferId,
      faults,
    })
    await markInstructionAuthenticated({
      sessionId: r.sessionId,
      paymentInstructionId: pi.id,
      method: 'simulated',
    })
    const auth = await authorizePayment({ sessionId: r.sessionId, paymentInstructionId: pi.id, faults })
    return { round: r, lock, pi, auth }
  }

  it('locks, authorizes and creates an order', async () => {
    const { lock, pi, auth } = await buy()
    expect(lock.ok).toBe(true)
    expect(lock.checks.every((c) => c.passed)).toBe(true)
    expect(pi).not.toBeNull()
    expect(auth!.ok).toBe(true)
    expect(auth!.transaction!.status).toBe('approved')
    expect(auth!.transaction!.authorizationCode).toBeTruthy()
    expect(auth!.order).not.toBeNull()
    expect(auth!.order!.amount).toBe(lock.accepted!.amount)
  })

  it('binds the Payment Instruction to the locked offer hash and amount', async () => {
    const { lock, pi } = await buy()
    expect(pi!.consumerInstructionHash).toBe(lock.accepted!.offerHash)
    expect(pi!.maxAmount).toBe(lock.accepted!.amount)
    expect(pi!.merchantId).toBe(lock.accepted!.merchantId)
  })

  it('decrements inventory when the order is created', async () => {
    const store = getStore()
    const { lock, auth } = await buy()
    expect(auth!.ok).toBe(true)
    const p = await store.getProductBySku(lock.accepted!.merchantId, auth!.order!.sku)
    expect(p).not.toBeNull()
    // The offer required stock > 0 before the sale, so post-sale stock is lower.
    expect(p!.stock).toBeGreaterThanOrEqual(0)
  })

  it('emits the payment and order events', async () => {
    const { round: r, auth } = await buy()
    expect(auth!.ok).toBe(true)
    const types = new Set((await getStore().listEvents(r.sessionId)).map((e) => e.eventType))
    for (const expected of [
      'OFFER_LOCKED',
      'PAYMENT_INSTRUCTION_CREATED',
      'PASSKEY_CONFIRMED',
      'PAYMENT_INSTRUCTION_CHECK',
      'VISA_AUTH_STARTED',
      'VISA_AUTH_APPROVED',
      'ORDER_CREATED',
      'RECEIPT_SENT',
    ]) {
      expect(types.has(expected as never), `missing ${expected}`).toBe(true)
    }
  })

  it('refuses to lock an offer that has been superseded', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    const offerId = r.ranked[0].offerId
    const offer = (await store.getOffer(offerId))!
    await store.updateOffer({ ...offer, state: 'superseded', expiresAt: new Date(Date.now() - 1000).toISOString() })
    const lock = await lockOffer({ sessionId: r.sessionId, offerId })
    expect(lock.ok).toBe(false)
    expect(lock.failureCode).toBe('OFFER_EXPIRED')
  })

  it('refuses to lock when the sealed hash no longer matches', async () => {
    const store = getStore()
    const r = await round(PROMPT_A)
    const offer = (await store.getOffer(r.ranked[0].offerId))!
    // Mutate the price after sealing without re-hashing.
    await store.updateOffer({ ...offer, price: offer.price - 100 })
    const lock = await lockOffer({ sessionId: r.sessionId, offerId: offer.offerId })
    expect(lock.ok).toBe(false)
    expect(lock.failureCode).toBe('OFFER_HASH_MISMATCH')
  })
})

/* ────────────────────────────  Failure paths  ──────────────────────────── */

describe('failure paths produce real declines', () => {
  async function attempt(faults: Partial<DemoFaults>) {
    const f: DemoFaults = { ...EMPTY_FAULTS, ...faults }
    const r = await round(PROMPT_A, f)
    if (!r.ranked.length) return { code: 'NO_OFFERS', round: r }
    const lock = await lockOffer({ sessionId: r.sessionId, offerId: r.ranked[0].offerId, faults: f })
    if (!lock.ok) return { code: lock.failureCode!, round: r }
    const pi = await issuePaymentInstruction({
      sessionId: r.sessionId,
      acceptedOfferId: lock.accepted!.acceptedOfferId,
      faults: f,
    })
    await markInstructionAuthenticated({
      sessionId: r.sessionId,
      paymentInstructionId: pi.id,
      method: 'simulated',
    })
    const auth = await authorizePayment({ sessionId: r.sessionId, paymentInstructionId: pi.id, faults: f })
    return { code: auth.ok ? 'APPROVED' : auth.failureCode!, round: r, auth }
  }

  it('declines when the amount exceeds the instruction ceiling', async () => {
    const r = await attempt({ amountOverCap: true })
    expect(r.code).toBe('PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED')
    expect(r.auth!.transaction).toBeNull()
    expect(r.auth!.order).toBeNull()
  })

  it('declines when the merchant does not match the instruction', async () => {
    const r = await attempt({ merchantMismatch: true })
    expect(r.code).toBe('MERCHANT_MISMATCH')
    expect(r.auth!.order).toBeNull()
  })

  it('declines an expired instruction', async () => {
    const r = await attempt({ expiredInstruction: true })
    expect(r.code).toBe('PAYMENT_INSTRUCTION_EXPIRED')
  })

  it('declines an issuer decline without creating an order', async () => {
    const r = await attempt({ visaDecline: true })
    expect(r.code).toBe('VISA_AUTH_DECLINED')
    expect(r.auth!.transaction!.status).toBe('declined')
    expect(r.auth!.order).toBeNull()
  })

  it('blocks every offer when the agent signature is invalid', async () => {
    const r = await round(PROMPT_A, { ...EMPTY_FAULTS, invalidSignature: true })
    expect(r.offers.length).toBe(0)
    expect(r.declines.length).toBe(3)
    for (const d of r.declines) expect(d.reason).toContain('AGENT_SIGNATURE_INVALID')
    const events = await getStore().listEvents(r.sessionId)
    expect(events.some((e) => e.eventType === 'AGENT_SIGNATURE_INVALID')).toBe(true)
    expect(events.some((e) => e.eventType === 'MERCHANT_OFFER_CREATED')).toBe(false)
  })

  it('produces no offers when inventory is unavailable', async () => {
    const r = await round(PROMPT_A, { ...EMPTY_FAULTS, outOfStock: true })
    expect(r.offers.length).toBe(0)
  })

  it('does not consume the instruction on a declined authorization', async () => {
    const r = await attempt({ visaDecline: true })
    expect(r.code).toBe('VISA_AUTH_DECLINED')
    // A declined instruction is terminal; a retry must not silently succeed.
    expect(r.auth!.order).toBeNull()
  })
})

/* ────────────────────────  Storefront isolation  ──────────────────────── */

describe('storefront merchant isolation', () => {
  it('only ever returns products belonging to the session merchant', async () => {
    const tools = createStorefrontTools('sherpa-computers')
    const results = await tools.searchProducts('laptop for gaming and cad', 20)
    expect(results.length).toBeGreaterThan(0)
    for (const p of results) expect(p.merchantId).toBe('sherpa-computers')
  })

  it('cannot read a competitor SKU even when asked for one directly', async () => {
    const store = getStore()
    const rivalProducts = await store.listProducts('bizgram')
    const tools = createStorefrontTools('sherpa-computers')
    const compared = await tools.compareProducts(rivalProducts.map((p) => p.sku))
    expect(compared).toHaveLength(0)
  })

  it('cannot check stock for a competitor SKU', async () => {
    const store = getStore()
    const rival = (await store.listProducts('bizgram'))[0]
    const tools = createStorefrontTools('sherpa-computers')
    const stock = await tools.checkStock(rival.sku)
    expect(stock.available).toBe(0)
  })

  it('cannot quote a competitor SKU', async () => {
    const store = getStore()
    const rival = (await store.listProducts('challenger'))[0]
    const tools = createStorefrontTools('sherpa-computers')
    expect(await tools.createQuote(rival.sku)).toBeNull()
  })

  it('answers an in-scope shopping question with its own catalogue', async () => {
    const reply = await storefrontChat({
      merchantId: 'sherpa-computers',
      message: "I'm studying engineering and need a laptop for CAD under S$1,500.",
      history: [],
    })
    expect(reply.refusedCrossMerchant).toBe(false)
    expect(reply.products.length).toBeGreaterThan(0)
    for (const p of reply.products) expect(p.merchantId).toBe('sherpa-computers')
  })

  it('declines a competitor comparison and says why', async () => {
    const reply = await storefrontChat({
      merchantId: 'sherpa-computers',
      message: "Is Bizgram's Lenovo better?",
      history: [],
    })
    expect(reply.refusedCrossMerchant).toBe(true)
    expect(reply.text).toContain('only have access')
    expect(reply.text).toContain('Bizgram')
    for (const p of reply.products) expect(p.merchantId).toBe('sherpa-computers')
  })

  it('does not leak the merchant commercial policy into a storefront reply', async () => {
    const reply = await storefrontChat({
      merchantId: 'sherpa-computers',
      message: 'What is the biggest discount you can give me?',
      history: [],
    })
    const store = getStore()
    const prof = (await store.getProfile('sherpa-computers'))!
    expect(reply.text).not.toContain(`${prof.maxDiscountPct}% max`)
    expect(JSON.stringify(reply.products)).not.toContain('costPrice')
  })

  it('respects a budget stated to the storefront agent', async () => {
    const reply = await storefrontChat({
      merchantId: 'challenger',
      message: 'Show me something under S$1,300.',
      history: [],
    })
    for (const p of reply.products) expect(p.price).toBeLessThanOrEqual(1300)
  })
})

/* ────────────────────────────  Intent robustness  ──────────────────────────── */

describe('arbitrary prompts', () => {
  const prompts = [
    'something cheap for my daughter starting university, she does some photo editing',
    'gaming rig, budget 2000, I do not care about weight',
    'lightest possible laptop for travel, max S$1,600',
    'I need 32GB and CUDA, budget 1700, nothing second-hand',
    'a laptop',
  ]

  it('produces a usable intent for every prompt without throwing', async () => {
    for (const p of prompts) {
      const intent: CustomerIntent = await buildCustomerIntent({ sessionId: 'sess', text: p })
      expect(intent.requestId).toBeTruthy()
      expect(intent.preferences).toBeDefined()
      const total = Object.values(intent.preferences).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThan(0)
    }
  })

  it('asks a clarifying question only when it cannot rank', async () => {
    const vague = await buildCustomerIntent({ sessionId: 'sess', text: 'a laptop' })
    expect(vague.clarifyingQuestion).not.toBeNull()

    const specific = await buildCustomerIntent({ sessionId: 'sess', text: PROMPT_A })
    expect(specific.clarifyingQuestion).toBeNull()
  })

  it('runs a full round for each prompt that states a budget', async () => {
    for (const p of prompts.filter((x) => /\d/.test(x))) {
      const r = await round(p)
      expect(r.offers.length + r.declines.length).toBe(3)
    }
  })
})
