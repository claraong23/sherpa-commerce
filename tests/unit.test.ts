import { describe, expect, it } from 'vitest'
import { canonicalizeOffer, canonicalJson, sha256Hex } from '@core/canonical'
import { minimumAllowedPrice, validateOffer } from '@core/policy/validator'
import { hardFilter, verifyOfferFacts } from '@core/scoring/filter'
import { dimensionScores, normalizeWeights, rankOffers, scoreOffer } from '@core/scoring/score'
import { clamp01, cpuTier, gpuTier, portabilityScore } from '@core/scoring/specs'
import { detectFromDomain, normalizeUrl, sanitizeHtml, scoreFingerprints } from '@core/detect/platform'
import { extractBudget, extractDeterministic } from '@agents/intent'
import { extractRulesDeterministic } from '@agents/rules-extract'
import { merchantUtility } from '@agents/merchant-agent'
import { SEED_PRODUCTS } from '@core/seed/products'
import { SEED_PROFILES } from '@core/seed/merchants'
import {
  createPaymentInstruction,
  evaluatePaymentInstruction,
} from '@visa/payment-instruction'
import {
  buildSignatureBase,
  generateTapKeyPair,
  signAgentRequest,
  tamperSignature,
  verifyAgentRequest,
} from '@visa/tap'
import {
  intent,
  makeOffer,
  product,
  profile,
  TEST_ACCEPTED,
} from './fixtures'

/* ────────────────────────────  Hard constraints  ──────────────────────────── */

describe('hard constraint filter', () => {
  it('rejects an offer over budget', () => {
    const r = hardFilter(makeOffer({ price: 1800 }), intent({ maxPrice: 1600 }))
    expect(r.passed).toBe(false)
    expect(r.violations[0].constraint).toBe('maxPrice')
  })

  it('accepts an offer exactly at budget', () => {
    expect(hardFilter(makeOffer({ price: 1600 }), intent({ maxPrice: 1600 })).passed).toBe(true)
  })

  it('rejects insufficient RAM', () => {
    const offer = makeOffer({ specs: { ramGb: 8 } })
    const r = hardFilter(offer, intent({ minRamGb: 16 }))
    expect(r.passed).toBe(false)
    expect(r.violations[0].constraint).toBe('minRamGb')
  })

  it('rejects a non-CUDA GPU when CUDA is required', () => {
    const offer = makeOffer({ specs: { gpu: 'AMD Radeon RX 7700S 8GB', cuda: false, dedicatedGpu: true } })
    const r = hardFilter(offer, intent({ requiresCuda: true }))
    expect(r.passed).toBe(false)
    expect(r.violations.map((v) => v.constraint)).toContain('requiresCuda')
  })

  it('rejects integrated graphics when a dedicated GPU is required', () => {
    const offer = makeOffer({ specs: { gpu: 'Intel Iris Xe', dedicatedGpu: false, cuda: false } })
    expect(hardFilter(offer, intent({ requiresDedicatedGpu: true })).passed).toBe(false)
  })

  it('rejects refurbished units when excluded', () => {
    const offer = makeOffer({ condition: 'refurbished' })
    expect(hardFilter(offer, intent({ excludeRefurbished: true })).passed).toBe(false)
  })

  it('rejects an out-of-stock offer regardless of constraints', () => {
    const offer = makeOffer({ availability: 'out_of_stock' })
    const r = hardFilter(offer, intent({}))
    expect(r.passed).toBe(false)
    expect(r.violations[0].constraint).toBe('availability')
  })

  it('reports every violation, not just the first', () => {
    const offer = makeOffer({ price: 2000, specs: { ramGb: 8 } })
    const r = hardFilter(offer, intent({ maxPrice: 1500, minRamGb: 16 }))
    expect(r.violations.length).toBe(2)
  })

  it('does not let a strong warranty compensate for a violation', () => {
    const offer = makeOffer({ price: 2000, warrantyYears: 3 })
    expect(hardFilter(offer, intent({ maxPrice: 1500 })).passed).toBe(false)
  })
})

/* ────────────────────────────  Scoring  ──────────────────────────── */

describe('spec tiers', () => {
  it('ranks GPUs monotonically within a family', () => {
    expect(gpuTier('NVIDIA GeForce RTX 4070').raster).toBeGreaterThan(gpuTier('NVIDIA GeForce RTX 4060').raster)
    expect(gpuTier('NVIDIA GeForce RTX 4060').raster).toBeGreaterThan(gpuTier('NVIDIA GeForce RTX 4050').raster)
    expect(gpuTier('NVIDIA GeForce RTX 4050').raster).toBeGreaterThan(gpuTier('Intel Iris Xe').raster)
  })

  it('identifies CUDA support from the GPU string', () => {
    expect(gpuTier('NVIDIA GeForce RTX 4060 8GB').cuda).toBe(true)
    expect(gpuTier('AMD Radeon RX 7700S 8GB').cuda).toBe(false)
    expect(gpuTier('Intel Arc Graphics (integrated)').cuda).toBe(false)
  })

  it('rates a professional GPU higher on compute than raster', () => {
    const a1000 = gpuTier('NVIDIA RTX A1000 6GB')
    expect(a1000.compute).toBeGreaterThan(a1000.raster)
  })

  it('ranks CPU tiers', () => {
    expect(cpuTier('Intel Core i9-14900HX').multi).toBeGreaterThan(cpuTier('Intel Core i5-13450HX').multi)
  })

  it('scores lighter laptops higher on portability', () => {
    expect(portabilityScore(1.17)).toBeGreaterThan(portabilityScore(2.4))
    expect(clamp01(portabilityScore(3.5))).toBe(0)
  })
})

describe('customer scoring', () => {
  it('normalizes weights to sum to 1', () => {
    const w = normalizeWeights(intent({}).preferences)
    const total = Object.values(w).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 4)
  })

  it('is deterministic for identical inputs', () => {
    const offer = makeOffer({})
    const i = intent({ maxPrice: 1600 })
    const a = scoreOffer(offer, i, { peers: [offer] })
    const b = scoreOffer(offer, i, { peers: [offer] })
    expect(a.score).toBe(b.score)
    expect(a.breakdown).toEqual(b.breakdown)
  })

  it('contributions sum to the total score', () => {
    const offer = makeOffer({})
    const { score, breakdown } = scoreOffer(offer, intent({ maxPrice: 1600 }), { peers: [offer] })
    const sum = Object.values(breakdown).reduce((a, b) => a + b.contribution, 0)
    expect(sum).toBeCloseTo(score, 3)
  })

  it('scores a dedicated GPU higher on CAD than integrated', () => {
    const i = intent({ maxPrice: 2000 })
    const dgpu = dimensionScores(makeOffer({}), i, { peers: [] })
    const igpu = dimensionScores(
      makeOffer({ specs: { gpu: 'Intel Iris Xe', dedicatedGpu: false, cuda: false } }),
      i,
      { peers: [] },
    )
    expect(dgpu.cadPerformance).toBeGreaterThan(igpu.cadPerformance)
    expect(dgpu.gamingPerformance).toBeGreaterThan(igpu.gamingPerformance)
  })

  it('changes the ranking when weights change', () => {
    const heavy = makeOffer({ offerId: 'heavy', price: 1550, specs: { weightKg: 2.5, batteryWh: 60 } })
    const light = makeOffer({
      offerId: 'light',
      price: 1500,
      specs: { weightKg: 1.2, batteryWh: 80, gpu: 'Intel Arc Graphics', dedicatedGpu: false, cuda: false },
    })

    const gamer = rankOffers([heavy, light], intent({ maxPrice: 1600 }, { gamingPerformance: 0.7, cadPerformance: 0.2 }))
    expect(gamer[0].offerId).toBe('heavy')

    const traveller = rankOffers([heavy, light], intent({ maxPrice: 1600 }, { portability: 0.6, battery: 0.3, gamingPerformance: 0 }))
    expect(traveller[0].offerId).toBe('light')
  })

  it('assigns rank 1 the highest score and labels it best overall', () => {
    const a = makeOffer({ offerId: 'a', price: 1200 })
    const b = makeOffer({ offerId: 'b', price: 1590 })
    const ranked = rankOffers([a, b], intent({ maxPrice: 1600 }, { value: 0.9 }))
    expect(ranked[0].rank).toBe(1)
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score)
    expect(ranked[0].label).toBe('Best overall')
  })

  it('uses price position when no budget is stated', () => {
    const cheap = makeOffer({ offerId: 'cheap', price: 1100 })
    const dear = makeOffer({ offerId: 'dear', price: 2200 })
    const scores = dimensionScores(cheap, intent({}), { peers: [cheap, dear] })
    const dearScores = dimensionScores(dear, intent({}), { peers: [cheap, dear] })
    expect(scores.value).toBeGreaterThan(dearScores.value)
  })
})

/* ────────────────────────────  Merchant policy  ──────────────────────────── */

describe('offer validator', () => {
  const base = {
    profile: profile({}),
    intent: intent({ maxPrice: 2000 }),
    liveStock: 5,
  }

  it('accepts a compliant offer', () => {
    const p = product({ price: 1500, costPrice: 1200 })
    const offer = makeOffer({ price: 1450, sku: p.sku, listPrice: p.price })
    const r = validateOffer({ ...base, offer, product: p })
    expect(r.valid).toBe(true)
  })

  it('rejects a discount beyond the merchant maximum', () => {
    const p = product({ price: 1500, costPrice: 900 })
    const offer = makeOffer({ price: 1200, sku: p.sku, listPrice: p.price })
    const r = validateOffer({ ...base, offer, product: p, profile: profile({ maxDiscountPct: 8, minMarginPct: 0 }) })
    expect(r.valid).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('DISCOUNT_EXCEEDS_POLICY')
  })

  it('rejects an offer that breaks the margin floor', () => {
    const p = product({ price: 1500, costPrice: 1400 })
    const offer = makeOffer({ price: 1450, sku: p.sku, listPrice: p.price })
    const r = validateOffer({ ...base, offer, product: p, profile: profile({ minMarginPct: 12 }) })
    expect(r.valid).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('MARGIN_BELOW_FLOOR')
  })

  it('counts bundle cost against the margin floor', () => {
    const p = product({ price: 1500, costPrice: 1290 })
    const bare = makeOffer({ price: 1450, sku: p.sku, listPrice: p.price })
    const bundled = makeOffer({
      price: 1450,
      sku: p.sku,
      listPrice: p.price,
      bundle: { type: 'kit', description: 'Kit', value: 120 },
    })
    const prof = profile({ minMarginPct: 10, bundleAllowance: 200 })
    expect(validateOffer({ ...base, offer: bare, product: p, profile: prof }).valid).toBe(true)
    expect(validateOffer({ ...base, offer: bundled, product: p, profile: prof }).valid).toBe(false)
  })

  it('rejects a bundle beyond the allowance', () => {
    const p = product({ price: 1500, costPrice: 1000 })
    const offer = makeOffer({
      price: 1490,
      sku: p.sku,
      listPrice: p.price,
      bundle: { type: 'kit', description: 'Kit', value: 300 },
    })
    const r = validateOffer({ ...base, offer, product: p, profile: profile({ bundleAllowance: 50 }) })
    expect(r.issues.map((i) => i.code)).toContain('BUNDLE_EXCEEDS_ALLOWANCE')
  })

  it('rejects a product belonging to another merchant', () => {
    const p = product({ merchantId: 'someone-else' })
    const offer = makeOffer({ merchantId: 'sherpa-computers', sku: p.sku, listPrice: p.price, price: p.price })
    const r = validateOffer({ ...base, offer, product: p })
    expect(r.issues.map((i) => i.code)).toContain('PRODUCT_NOT_OWNED_BY_MERCHANT')
  })

  it('rejects misrepresented specifications', () => {
    const p = product({})
    const offer = makeOffer({ sku: p.sku, listPrice: p.price, price: p.price, specs: { ramGb: 64 } })
    const r = validateOffer({ ...base, offer, product: p })
    expect(r.issues.map((i) => i.code)).toContain('SPEC_MISREPRESENTATION')
  })

  it('rejects a price above list', () => {
    const p = product({ price: 1500 })
    const offer = makeOffer({ price: 1600, sku: p.sku, listPrice: p.price })
    const r = validateOffer({ ...base, offer, product: p, intent: intent({ maxPrice: 5000 }) })
    expect(r.issues.map((i) => i.code)).toContain('PRICE_ABOVE_LIST')
  })

  it('rejects an offer with no stock', () => {
    const p = product({})
    const offer = makeOffer({ sku: p.sku, listPrice: p.price, price: p.price })
    const r = validateOffer({ ...base, offer, product: p, liveStock: 0 })
    expect(r.issues.map((i) => i.code)).toContain('OUT_OF_STOCK')
  })

  it('rejects warranty beyond merchant policy', () => {
    const p = product({})
    const offer = makeOffer({ sku: p.sku, listPrice: p.price, price: p.price, warrantyYears: 5 })
    const r = validateOffer({ ...base, offer, product: p, profile: profile({ maxWarrantyYears: 2 }) })
    expect(r.issues.map((i) => i.code)).toContain('WARRANTY_EXCEEDS_POLICY')
  })

  it('enforces an approved minimum-spec sales rule', () => {
    const p = product({ specs: { ramGb: 8 } })
    const offer = makeOffer({ sku: p.sku, listPrice: p.price, price: p.price, specs: { ramGb: 8 } })
    const withRule = profile({
      salesRules: [
        {
          id: 'r1',
          kind: 'min_spec_for_workload',
          text: 'CAD needs 16 GB',
          params: { workloads: ['cad'], minRamGb: 16 },
          approved: true,
          source: 'seed',
        },
      ],
    })
    const cadIntent = intent({ maxPrice: 5000 })
    cadIntent.context.useCases = ['cad']
    const r = validateOffer({ ...base, offer, product: p, profile: withRule, intent: cadIntent })
    expect(r.issues.map((i) => i.code)).toContain('MERCHANT_SALES_RULE_VIOLATED')
  })

  it('ignores an unapproved sales rule', () => {
    const p = product({ specs: { ramGb: 8 } })
    const offer = makeOffer({ sku: p.sku, listPrice: p.price, price: p.price, specs: { ramGb: 8 } })
    const unapproved = profile({
      salesRules: [
        {
          id: 'r1',
          kind: 'min_spec_for_workload',
          text: 'CAD needs 16 GB',
          params: { workloads: ['cad'], minRamGb: 16 },
          approved: false,
          source: 'seed',
        },
      ],
    })
    const cadIntent = intent({ maxPrice: 5000 })
    cadIntent.context.useCases = ['cad']
    const r = validateOffer({ ...base, offer, product: p, profile: unapproved, intent: cadIntent })
    expect(r.issues.map((i) => i.code)).not.toContain('MERCHANT_SALES_RULE_VIOLATED')
  })

  it('propagates customer hard constraints into validation', () => {
    const p = product({ price: 1500 })
    const offer = makeOffer({ price: 1450, sku: p.sku, listPrice: p.price })
    const r = validateOffer({ ...base, offer, product: p, intent: intent({ maxPrice: 1000 }) })
    expect(r.issues.map((i) => i.code)).toContain('CUSTOMER_HARD_CONSTRAINT')
  })
})

describe('minimumAllowedPrice', () => {
  it('is bound by whichever of discount or margin binds harder', () => {
    const p = product({ price: 1000, costPrice: 900 })
    // discount floor 950; margin floor 900/0.8 = 1125 → margin binds
    expect(minimumAllowedPrice(p, profile({ maxDiscountPct: 5, minMarginPct: 20 }))).toBeCloseTo(1125, 1)
    // discount floor 800; margin floor 900/0.95 ≈ 947 → margin binds
    expect(minimumAllowedPrice(p, profile({ maxDiscountPct: 20, minMarginPct: 5 }))).toBeCloseTo(947.4, 1)
  })

  it('rises when a bundle is attached', () => {
    const p = product({ price: 1000, costPrice: 800 })
    const prof = profile({ maxDiscountPct: 20, minMarginPct: 10 })
    expect(minimumAllowedPrice(p, prof, 100)).toBeGreaterThan(minimumAllowedPrice(p, prof, 0))
  })
})

describe('merchant objectives differ', () => {
  it('ranks the same products differently by objective', () => {
    const cheapHighStock = product({ price: 1000, costPrice: 900, stock: 10 })
    const dearHighMargin = product({ price: 2000, costPrice: 1300, stock: 2 })

    const margin = profile({ primaryObjective: 'margin' })
    expect(merchantUtility(dearHighMargin, margin, 2000)).toBeGreaterThan(
      merchantUtility(cheapHighStock, margin, 1000),
    )

    const turnover = profile({ primaryObjective: 'inventory_turnover' })
    expect(merchantUtility(cheapHighStock, turnover, 1000)).toBeGreaterThan(
      merchantUtility(dearHighMargin, turnover, 2000),
    )

    const aov = profile({ primaryObjective: 'aov' })
    expect(merchantUtility(dearHighMargin, aov, 2000)).toBeGreaterThan(
      merchantUtility(cheapHighStock, aov, 1000),
    )
  })
})

/* ────────────────────────────  Offer hash  ──────────────────────────── */

describe('offer canonicalization and hash', () => {
  it('is stable across key ordering', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(sha256Hex(canonicalJson({ b: 1, a: 2 }))).toBe(sha256Hex(canonicalJson({ a: 2, b: 1 })))
  })

  it('produces the same hash for the same offer', () => {
    const offer = makeOffer({})
    expect(canonicalizeOffer(offer).hash).toBe(canonicalizeOffer(offer).hash)
  })

  it('changes when the price changes', () => {
    const a = canonicalizeOffer(makeOffer({ price: 1500 })).hash
    const b = canonicalizeOffer(makeOffer({ price: 1499.99 })).hash
    expect(a).not.toBe(b)
  })

  it('changes when the merchant changes', () => {
    const a = canonicalizeOffer(makeOffer({ merchantId: 'sherpa-computers' })).hash
    const b = canonicalizeOffer(makeOffer({ merchantId: 'bizgram' })).hash
    expect(a).not.toBe(b)
  })

  it('changes when the bundle is removed', () => {
    const withBundle = canonicalizeOffer(
      makeOffer({ bundle: { type: 'bag', description: 'Bag', value: 40 } }),
    ).hash
    const without = canonicalizeOffer(makeOffer({ bundle: null })).hash
    expect(withBundle).not.toBe(without)
  })

  it('changes when warranty or delivery change', () => {
    const base = canonicalizeOffer(makeOffer({})).hash
    expect(canonicalizeOffer(makeOffer({ warrantyYears: 3 })).hash).not.toBe(base)
    expect(canonicalizeOffer(makeOffer({ deliveryDays: 7 })).hash).not.toBe(base)
  })

  it('ignores presentation-only fields', () => {
    const base = canonicalizeOffer(makeOffer({})).hash
    const restyled = canonicalizeOffer(makeOffer({ merchantNote: 'totally different copy' })).hash
    expect(restyled).toBe(base)
  })

  it('emits a 64-character hex digest', () => {
    expect(canonicalizeOffer(makeOffer({})).hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('factual verification', () => {
  it('accepts an offer matching the catalogue', () => {
    const p = product({})
    const offer = makeOffer({ sku: p.sku, listPrice: p.price })
    const r = verifyOfferFacts(offer, {
      price: p.price,
      specs: p.specs,
      condition: p.condition,
      stock: p.stock,
    })
    expect(r.verified).toBe(true)
  })

  it('flags a spec that does not match the catalogue', () => {
    const p = product({})
    const offer = makeOffer({ sku: p.sku, listPrice: p.price, specs: { ramGb: 64 } })
    const r = verifyOfferFacts(offer, {
      price: p.price,
      specs: p.specs,
      condition: p.condition,
      stock: p.stock,
    })
    expect(r.verified).toBe(false)
    expect(r.discrepancies.join(' ')).toContain('ram')
  })

  it('flags a product missing from the catalogue', () => {
    expect(verifyOfferFacts(makeOffer({}), null).verified).toBe(false)
  })
})

/* ────────────────────────────  Payment Instruction  ──────────────────────────── */

describe('payment instruction controls', () => {
  const accepted = TEST_ACCEPTED

  const evaluate = (overrides: Partial<Parameters<typeof evaluatePaymentInstruction>[0]> = {}) => {
    const instruction = createPaymentInstruction({ sessionId: 'sess', accepted })
    return evaluatePaymentInstruction({
      instruction: { ...instruction, authenticated: true, state: 'authenticated' },
      accepted,
      requestedMerchantId: accepted.merchantId,
      requestedAmount: accepted.amount,
      requestedCurrency: accepted.currency,
      currentOfferHash: accepted.offerHash,
      ...overrides,
    })
  }

  it('approves when every control passes', () => {
    const r = evaluate()
    expect(r.approved).toBe(true)
    expect(r.failureCode).toBeNull()
    expect(r.checks.every((c) => c.passed)).toBe(true)
  })

  it('declines an amount above the ceiling', () => {
    const r = evaluate({ requestedAmount: accepted.amount + 0.01 })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED')
  })

  it('approves an amount exactly at the ceiling', () => {
    expect(evaluate({ requestedAmount: accepted.amount }).approved).toBe(true)
  })

  it('declines a different merchant', () => {
    const r = evaluate({ requestedMerchantId: 'someone-else' })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('MERCHANT_MISMATCH')
  })

  it('declines an expired instruction', () => {
    const instruction = createPaymentInstruction({ sessionId: 'sess', accepted, expiredOverride: true })
    const r = evaluatePaymentInstruction({
      instruction: { ...instruction, authenticated: true },
      accepted,
      requestedMerchantId: accepted.merchantId,
      requestedAmount: accepted.amount,
      requestedCurrency: accepted.currency,
      currentOfferHash: accepted.offerHash,
    })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('PAYMENT_INSTRUCTION_EXPIRED')
  })

  it('declines when the offer hash has changed', () => {
    const r = evaluate({ currentOfferHash: 'f'.repeat(64) })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('OFFER_HASH_MISMATCH')
  })

  it('declines a currency mismatch', () => {
    const r = evaluate({ requestedCurrency: 'USD' })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('CURRENCY_MISMATCH')
  })

  it('declines an unauthenticated instruction', () => {
    const instruction = createPaymentInstruction({ sessionId: 'sess', accepted })
    const r = evaluatePaymentInstruction({
      instruction,
      accepted,
      requestedMerchantId: accepted.merchantId,
      requestedAmount: accepted.amount,
      requestedCurrency: accepted.currency,
      currentOfferHash: accepted.offerHash,
    })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('PAYMENT_INSTRUCTION_NOT_AUTHENTICATED')
  })

  it('declines an already-consumed instruction', () => {
    const instruction = createPaymentInstruction({ sessionId: 'sess', accepted })
    const r = evaluatePaymentInstruction({
      instruction: { ...instruction, authenticated: true, state: 'consumed' },
      accepted,
      requestedMerchantId: accepted.merchantId,
      requestedAmount: accepted.amount,
      requestedCurrency: accepted.currency,
      currentOfferHash: accepted.offerHash,
    })
    expect(r.approved).toBe(false)
    expect(r.failureCode).toBe('PAYMENT_INSTRUCTION_ALREADY_CONSUMED')
  })

  it('evaluates every control even after one fails', () => {
    const r = evaluate({ requestedMerchantId: 'other', requestedAmount: 999999 })
    expect(r.checks.length).toBeGreaterThan(5)
    expect(r.checks.filter((c) => !c.passed).length).toBeGreaterThanOrEqual(2)
  })

  it('caps the instruction at the accepted amount by default', () => {
    const pi = createPaymentInstruction({ sessionId: 'sess', accepted })
    expect(pi.maxAmount).toBe(accepted.amount)
    expect(pi.consumerInstructionHash).toBe(accepted.offerHash)
    expect(pi.authenticated).toBe(false)
  })
})

/* ────────────────────────────  TAP-style signing  ──────────────────────────── */

describe('TAP-style agent signing', () => {
  const sign = () =>
    signAgentRequest({
      method: 'POST',
      path: '/agent/m/offers',
      body: { requestId: 'req_1', budget: 1600 },
      agentIntent: 'PURCHASE',
      agentId: 'customer-agent-01',
    })

  it('verifies a valid signature', () => {
    const r = verifyAgentRequest(sign(), { skipReplayCheck: true })
    expect(r.valid).toBe(true)
    expect(r.code).toBeNull()
    expect(r.agentIntent).toBe('PURCHASE')
  })

  it('rejects a tampered signature', () => {
    const r = verifyAgentRequest(tamperSignature(sign()), { skipReplayCheck: true })
    expect(r.valid).toBe(false)
    expect(r.code).toBe('AGENT_SIGNATURE_INVALID')
  })

  it('rejects a modified body', () => {
    const r = verifyAgentRequest({ ...sign(), body: '{"budget":99999}' }, { skipReplayCheck: true })
    expect(r.valid).toBe(false)
    expect(r.code).toBe('AGENT_DIGEST_MISMATCH')
  })

  it('rejects a replayed nonce', () => {
    const req = sign()
    expect(verifyAgentRequest(req).valid).toBe(true)
    const replay = verifyAgentRequest(req)
    expect(replay.valid).toBe(false)
    expect(replay.code).toBe('AGENT_NONCE_REPLAY')
  })

  it('rejects a stale timestamp', () => {
    const req = { ...sign(), created: Math.floor(Date.now() / 1000) - 4000 }
    const r = verifyAgentRequest(req, { skipReplayCheck: true })
    expect(r.valid).toBe(false)
    expect(r.code).toBe('AGENT_TIMESTAMP_SKEW')
  })

  it('rejects a signature from a different key', () => {
    const other = generateTapKeyPair()
    const r = verifyAgentRequest(sign(), {
      publicKeyBase64: other.publicKeyBase64,
      skipReplayCheck: true,
    })
    expect(r.valid).toBe(false)
    expect(r.code).toBe('AGENT_SIGNATURE_INVALID')
  })

  it('covers method, path, digest, intent and agent id in the signature base', () => {
    const base = buildSignatureBase({
      method: 'POST',
      path: '/x',
      contentDigest: 'sha-256=:abc:',
      agentIntent: 'PURCHASE',
      agentId: 'a1',
      params: '(...);created=1',
    })
    expect(base).toContain('"@method": POST')
    expect(base).toContain('"@path": /x')
    expect(base).toContain('"content-digest": sha-256=:abc:')
    expect(base).toContain('"agent-intent": PURCHASE')
    expect(base).toContain('"agent-id": a1')
    expect(base).toContain('"@signature-params"')
  })

  it('changes the signature when the path changes', () => {
    const a = signAgentRequest({ method: 'POST', path: '/a', body: {}, agentIntent: 'BROWSE', agentId: 'x' })
    const b = signAgentRequest({ method: 'POST', path: '/b', body: {}, agentIntent: 'BROWSE', agentId: 'x' })
    expect(a.signature).not.toBe(b.signature)
  })
})

/* ────────────────────────────  Intent extraction  ──────────────────────────── */

describe('deterministic intent extraction', () => {
  it('parses several budget phrasings', () => {
    expect(extractBudget('under S$1,600')).toBe(1600)
    expect(extractBudget('max 1700')).toBe(1700)
    expect(extractBudget('Keep it under S$1,500.')).toBe(1500)
    expect(extractBudget('budget of $2,000')).toBe(2000)
    expect(extractBudget('no more than 1450')).toBe(1450)
    expect(extractBudget('a laptop please')).toBeUndefined()
  })

  it('detects CUDA as a hard requirement', () => {
    expect(extractDeterministic('I need CUDA for ML').hard.requiresCuda).toBe(true)
  })

  it('detects a refurbished exclusion', () => {
    expect(extractDeterministic('Nothing refurbished.').hard.excludeRefurbished).toBe(true)
  })

  it('detects a minimum RAM requirement', () => {
    expect(extractDeterministic('I need at least 32 GB').hard.minRamGb).toBe(32)
  })

  it('detects a weight limit', () => {
    expect(extractDeterministic('must be under 1.5 kg').hard.maxWeightKg).toBe(1.5)
  })

  it('maps use cases onto scoring weights', () => {
    const cad = extractDeterministic('I do CAD and gaming')
    expect(cad.context.useCases).toContain('cad')
    expect(cad.context.useCases).toContain('gaming')
    expect(cad.weights.cadPerformance).toBeGreaterThan(0)
    expect(cad.weights.gamingPerformance).toBeGreaterThan(0)
  })

  it('raises battery and portability when the user says they matter', () => {
    const r = extractDeterministic('Battery and weight matter more than gaming.')
    expect(r.weights.battery).toBeGreaterThanOrEqual(0.28)
    expect(r.weights.gamingPerformance).toBe(0)
  })

  it('detects daily carry', () => {
    expect(extractDeterministic('I carry it around every day').context.dailyCarry).toBe(true)
  })

  it('does not invent constraints from an empty prompt', () => {
    const r = extractDeterministic('hello')
    expect(r.hard.maxPrice).toBeUndefined()
    expect(r.hard.requiresCuda).toBeUndefined()
    expect(r.context.useCases).toHaveLength(0)
  })
})

describe('merchant rule extraction (deterministic)', () => {
  it('extracts a discount cap', () => {
    expect(extractRulesDeterministic('Never discount more than 8%').patch.maxDiscountPct).toBe(8)
  })

  it('extracts a margin floor', () => {
    expect(extractRulesDeterministic('minimum 12% margin').patch.minMarginPct).toBe(12)
  })

  it('infers the objective from plain language', () => {
    expect(extractRulesDeterministic('I want to move old stock').patch.primaryObjective).toBe(
      'inventory_turnover',
    )
    expect(extractRulesDeterministic('protect my margin').patch.primaryObjective).toBe('margin')
  })

  it('extracts a workload minimum-spec rule', () => {
    const r = extractRulesDeterministic('Never sell under 16 GB for CAD')
    const rule = r.newRules.find((x) => x.kind === 'min_spec_for_workload')
    expect(rule).toBeDefined()
    expect((rule!.params as { minRamGb: number }).minRamGb).toBe(16)
  })

  it('leaves every extracted rule unapproved', () => {
    const r = extractRulesDeterministic('Never sell under 16 GB for CAD. Prefer a RAM upgrade over a discount.')
    expect(r.newRules.length).toBeGreaterThan(0)
    expect(r.newRules.every((x) => x.approved === false)).toBe(true)
  })
})

/* ────────────────────────────  Platform detection  ──────────────────────────── */

describe('platform detector', () => {
  const headers = (h: Record<string, string> = {}) => new Headers(h)

  it('normalizes URLs', () => {
    expect(normalizeUrl('sherpa-computers-demo.myshopify.com')).toBe('https://sherpa-computers-demo.myshopify.com')
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com')
    expect(normalizeUrl('not a url at all')).toBe('')
  })

  it('identifies Shopify from markup and headers', () => {
    const r = scoreFingerprints({
      html: '<script src="https://cdn.shopify.com/s/files/x.js"></script><script>window.Shopify={};</script>',
      headers: headers({ 'x-shopid': '12345' }),
      url: 'https://sherpa-computers-demo.myshopify.com',
    })
    expect(r.commercePlatform).toBe('shopify')
    expect(r.confidence).toBeGreaterThan(0.7)
    expect(r.signals.length).toBeGreaterThanOrEqual(2)
    expect(r.method).toBe('http-fingerprint')
  })

  it('identifies WooCommerce', () => {
    const r = scoreFingerprints({
      html: '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce-layout.css">',
      headers: headers(),
      url: 'https://shop.example.com',
    })
    expect(r.commercePlatform).toBe('woocommerce')
  })

  it('reports custom with low confidence when nothing matches', () => {
    const r = scoreFingerprints({ html: '<html><body>hello</body></html>', headers: headers(), url: 'https://x.com' })
    expect(r.websitePlatform).toBe('custom')
    expect(r.confidence).toBeLessThan(0.5)
  })

  it('falls back to a domain heuristic for myshopify.com', () => {
    const r = detectFromDomain('https://something.myshopify.com')
    expect(r.commercePlatform).toBe('shopify')
    expect(r.method).not.toBe('http-fingerprint')
  })

  it('strips scripts and styles before ingestion', () => {
    const dirty = '<style>a{}</style><script>alert(1)</script><p>Real content</p>'
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toContain('alert(1)')
    expect(clean).not.toContain('a{}')
    expect(clean).toContain('Real content')
  })
})

/* ────────────────────────────  Seed integrity  ──────────────────────────── */

describe('seed catalogue', () => {
  it('has at least 12 laptops across three merchants', () => {
    expect(SEED_PRODUCTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(SEED_PRODUCTS.map((p) => p.merchantId)).size).toBe(3)
  })

  it('prices every product above cost', () => {
    for (const p of SEED_PRODUCTS) expect(p.price).toBeGreaterThan(p.costPrice)
  })

  it('uses unique SKUs', () => {
    expect(new Set(SEED_PRODUCTS.map((p) => p.sku)).size).toBe(SEED_PRODUCTS.length)
  })

  it('covers the tradeoffs the demo prompts depend on', () => {
    expect(SEED_PRODUCTS.some((p) => p.stock === 0)).toBe(true)
    expect(SEED_PRODUCTS.some((p) => p.condition === 'refurbished')).toBe(true)
    expect(SEED_PRODUCTS.some((p) => (p.specs.weightKg ?? 9) < 1.3)).toBe(true)
    expect(SEED_PRODUCTS.some((p) => p.specs.cuda)).toBe(true)
    expect(SEED_PRODUCTS.some((p) => p.specs.dedicatedGpu && !p.specs.cuda)).toBe(true)
    expect(SEED_PRODUCTS.some((p) => p.warrantyYears >= 3)).toBe(true)
    expect(SEED_PRODUCTS.some((p) => (p.specs.generation ?? 2026) <= 2024)).toBe(true)
  })

  it('gives the three merchants distinct objectives', () => {
    expect(new Set(SEED_PROFILES.map((p) => p.primaryObjective)).size).toBe(3)
  })

  it('ships every seeded sales rule pre-approved for the demo merchants', () => {
    for (const p of SEED_PROFILES) {
      for (const r of p.salesRules) expect(r.source).toBe('seed')
    }
  })
})

describe('discount phrasing variants', () => {
  const cases: [string, number | undefined][] = [
    ['Never discount more than 8%', 8],
    ['max 5% discount', 5],
    ['no more than 10% off', 10],
    ['capped at 7.5%', 7.5],
    ['up to 12% off', 12],
    ['I want at least 15% margin', undefined],
  ]
  for (const [phrase, expected] of cases) {
    it(`parses "${phrase}"`, () => {
      expect(extractRulesDeterministic(phrase).patch.maxDiscountPct).toBe(expected)
    })
  }

  it('keeps a margin statement out of the discount field', () => {
    const r = extractRulesDeterministic('Minimum 12% margin, never discount more than 6%')
    expect(r.patch.minMarginPct).toBe(12)
    expect(r.patch.maxDiscountPct).toBe(6)
  })
})
