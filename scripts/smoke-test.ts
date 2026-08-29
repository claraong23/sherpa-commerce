/**
 * End-to-end smoke test, run entirely in-process — no dev server required.
 *
 * Verifies: environment resolution, store connectivity, seed integrity, TAP
 * signing/verification, a full offer round for all three demo prompts, a
 * counteroffer, an offer lock, the Payment Instruction controls, a Visa
 * authorization through whichever adapter is configured, order creation, and
 * each of the failure paths.
 */
import 'dotenv/config'
import { runOfferRound } from '../packages/agents/src/customer-agent'
import { buildCustomerIntent } from '../packages/agents/src/intent'
import { handleCounterRequest } from '../packages/agents/src/merchant-agent'
import {
  authorizePayment,
  issuePaymentInstruction,
  lockOffer,
  markInstructionAuthenticated,
} from '../packages/agents/src/purchase-flow'
import { storefrontChat } from '../packages/agents/src/storefront-agent'
import { getStore } from '../packages/core/src/db'
import { integrationStatus, serverEnv } from '../packages/core/src/env'
import { id, nowIso } from '../packages/core/src/ids'
import { EMPTY_FAULTS, type DemoFaults } from '../packages/core/src/schemas'
import { signAgentRequest, tamperSignature, tapKeys, verifyAgentRequest } from '../packages/visa/src/tap'
import { visaModeLabel } from '../packages/visa/src'

const PROMPTS = [
  'I need a laptop for CAD and gaming under S$1,600. I carry it around every day.',
  'I mostly code and travel. Battery and weight matter more than gaming. Keep it under S$1,500.',
  'I need CUDA for ML. Nothing refurbished. Max S$1,700.',
]

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function head(title: string) {
  console.log(`\n${title}`)
  console.log('─'.repeat(Math.max(20, title.length)))
}

async function newSession() {
  const sessionId = id('smoke')
  await getStore().upsertCustomerSession({
    id: sessionId,
    createdAt: nowIso(),
    messages: [],
    currentRequestId: null,
    counterUsed: false,
  })
  return sessionId
}

async function main() {
  const started = Date.now()
  console.log('\nAgentic commerce — smoke test')
  console.log('═'.repeat(30))

  /* ── 1. Environment ── */
  head('1. Environment')
  const env = serverEnv()
  const status = integrationStatus()
  console.log(`  demo mode        ${env.demoMode}`)
  console.log(`  database         ${status.database}`)
  console.log(`  language model   ${status.llm}${status.llmModel ? ` (${status.llmModel})` : ''}`)
  console.log(`  shopify          ${status.shopify}`)
  console.log(`  visa acceptance  ${status.visa} — ${visaModeLabel().label}`)
  console.log(`  realtime voice   ${status.realtimeVoice}`)
  console.log(`  tap keys         ${status.tapKeys} (${tapKeys().keyId})`)
  check('environment resolves without throwing', true)

  /* ── 2. Store and seed ── */
  head('2. Store and seed data')
  const store = getStore()
  const merchants = await store.listMerchants()
  check('store reachable', merchants.length > 0, `${store.kind}`)
  check('three demo merchants seeded', merchants.length >= 3, merchants.map((m) => m.name).join(', '))

  let totalProducts = 0
  let outOfStock = 0
  let refurbished = 0
  let cudaCount = 0
  let lightest = 99
  const objectives = new Set<string>()

  for (const m of merchants) {
    const products = await store.listProducts(m.id)
    const profile = await store.getProfile(m.id)
    if (profile) objectives.add(profile.primaryObjective)
    totalProducts += products.length
    for (const p of products) {
      if (p.stock === 0) outOfStock++
      if (p.condition === 'refurbished') refurbished++
      if (p.specs.cuda) cudaCount++
      if ((p.specs.weightKg ?? 9) < lightest) lightest = p.specs.weightKg ?? 9
      if (p.costPrice >= p.price) {
        check(`cost below price for ${p.sku}`, false, `cost ${p.costPrice} >= price ${p.price}`)
      }
    }
  }
  check('at least 12 laptops seeded', totalProducts >= 12, `${totalProducts} products`)
  check('an out-of-stock unit exists', outOfStock >= 1, `${outOfStock} out of stock`)
  check('a refurbished unit exists', refurbished >= 1)
  check('CUDA and non-CUDA units both exist', cudaCount > 0 && cudaCount < totalProducts)
  check('a sub-1.4 kg unit exists', lightest < 1.4, `lightest ${lightest} kg`)
  check('merchant objectives differ', objectives.size >= 3, [...objectives].join(', '))

  /* ── 3. TAP-style signing ── */
  head('3. TAP-style agent signing')
  const signed = signAgentRequest({
    method: 'POST',
    path: '/agent/test/offers',
    body: { hello: 'world' },
    agentIntent: 'PURCHASE',
    agentId: 'customer-agent-01',
  })
  check('valid signature verifies', verifyAgentRequest(signed, { skipReplayCheck: true }).valid)
  const tampered = tamperSignature(signed)
  const tamperResult = verifyAgentRequest(tampered, { skipReplayCheck: true })
  check(
    'tampered signature rejected',
    !tamperResult.valid && tamperResult.code === 'AGENT_SIGNATURE_INVALID',
    tamperResult.code ?? '',
  )
  verifyAgentRequest(signed)
  const replay = verifyAgentRequest(signed)
  check('nonce replay rejected', !replay.valid && replay.code === 'AGENT_NONCE_REPLAY', replay.code ?? '')
  const bodyTamper = verifyAgentRequest({ ...signed, body: '{"hello":"evil"}' }, { skipReplayCheck: true })
  check('body tamper rejected', !bodyTamper.valid && bodyTamper.code === 'AGENT_DIGEST_MISMATCH')

  /* ── 4. Offer rounds ── */
  head('4. Offer rounds (3 prompts)')
  const winners: string[] = []
  let lastRound: Awaited<ReturnType<typeof runOfferRound>> | null = null
  let lastSession = ''

  for (const prompt of PROMPTS) {
    const sessionId = await newSession()
    const intent = await buildCustomerIntent({ sessionId, text: prompt })
    await store.saveIntent(intent)
    const round = await runOfferRound({ intent, sessionId })
    lastRound = round
    lastSession = sessionId

    const label = prompt.slice(0, 44) + '…'
    check(`offers returned — "${label}"`, round.offers.length > 0, `${round.offers.length} sealed`)
    check(`ranking produced — "${label}"`, round.ranked.length > 0, `top ${round.ranked[0]?.scorePct ?? 0}%`)
    check(`recommendation written — "${label}"`, Boolean(round.recommendation))

    for (const o of round.offers) {
      if (o.hash === undefined) check(`offer ${o.offerId} sealed with a hash`, false)
      if (intent.hardConstraints.maxPrice && round.ranked.some((r) => r.offerId === o.offerId)) {
        check(
          `ranked offer respects budget (${o.merchantName})`,
          o.price <= intent.hardConstraints.maxPrice,
          `${o.price} vs ${intent.hardConstraints.maxPrice}`,
        )
      }
    }
    if (round.ranked[0]) winners.push(round.ranked[0].merchantId)

    const events = await store.listEvents(sessionId)
    check(`events persisted — "${label}"`, events.length > 10, `${events.length} events`)
  }

  check(
    'different prompts produce different winners',
    new Set(winners).size > 1,
    winners.join(' → '),
  )

  /* ── 5. CUDA hard constraint ── */
  head('5. Hard constraints actually filter')
  const cudaSession = await newSession()
  const cudaIntent = await buildCustomerIntent({
    sessionId: cudaSession,
    text: 'I need CUDA for ML. Nothing refurbished. Max S$1,700.',
  })
  await store.saveIntent(cudaIntent)
  check('CUDA parsed as a hard constraint', cudaIntent.hardConstraints.requiresCuda === true)
  check('refurbished excluded', cudaIntent.hardConstraints.excludeRefurbished === true)
  const cudaRound = await runOfferRound({ intent: cudaIntent, sessionId: cudaSession })
  const allRankedCuda = cudaRound.ranked.every((r) => {
    const o = cudaRound.offers.find((x) => x.offerId === r.offerId)
    return o?.product.specs.cuda === true && o.product.condition === 'new'
  })
  check('every ranked offer satisfies CUDA + new-only', allRankedCuda)

  /* ── 6. Counteroffer ── */
  head('6. Counteroffer (single round)')
  if (lastRound?.ranked.length) {
    const topOffer = lastRound.offers.find((o) => o.offerId === lastRound!.ranked[0].offerId)!
    const merchant = await store.getMerchant(topOffer.merchantId)
    const profile = await store.getProfile(topOffer.merchantId)
    const target = Math.round(topOffer.price * 0.95)
    const result = await handleCounterRequest({
      ctx: { merchant: merchant!, profile: profile!, intent: lastRound.intent, sessionId: lastSession },
      original: topOffer,
      counter: {
        counterRequestId: id('cnt'),
        requestId: topOffer.requestId,
        offerId: topOffer.offerId,
        targetPrice: target,
        mustRetain: [],
        flexible: ['bundle', 'accessories'],
        rawText: `below ${target}`,
        createdAt: nowIso(),
      },
    })
    check('counteroffer returns a decision', typeof result.accepted === 'boolean', result.accepted ? 'accepted' : 'declined within policy')
    if (result.accepted && result.offer) {
      check('counteroffer respects the target', result.offer.price <= target + 0.01)
      check('counteroffer is re-sealed', result.offer.state === 'sealed' && Boolean(result.offer.hash))
      check('counteroffer links to the original', result.offer.counterOfOfferId === topOffer.offerId)
    }

    // An impossible target must be refused, not silently honoured.
    const absurd = await handleCounterRequest({
      ctx: { merchant: merchant!, profile: profile!, intent: lastRound.intent, sessionId: lastSession },
      original: topOffer,
      counter: {
        counterRequestId: id('cnt'),
        requestId: topOffer.requestId,
        offerId: topOffer.offerId,
        targetPrice: 100,
        mustRetain: [],
        flexible: ['bundle'],
        rawText: 'below 100',
        createdAt: nowIso(),
      },
    })
    check('below-floor counteroffer declined', !absurd.accepted, absurd.declineReason ?? '')
  } else {
    check('counteroffer scenario available', false, 'no ranked offers from the previous round')
  }

  /* ── 7. Happy path: lock → instruction → passkey → authorize → order ── */
  head('7. Purchase lifecycle')
  const buySession = await newSession()
  const buyIntent = await buildCustomerIntent({ sessionId: buySession, text: PROMPTS[0] })
  await store.saveIntent(buyIntent)
  const buyRound = await runOfferRound({ intent: buyIntent, sessionId: buySession })
  const chosen = buyRound.ranked[0]
  check('an offer is available to buy', Boolean(chosen))

  if (chosen) {
    const lock = await lockOffer({ sessionId: buySession, offerId: chosen.offerId })
    check('offer locks', lock.ok, lock.detail)

    if (lock.ok && lock.accepted) {
      const pi = await issuePaymentInstruction({
        sessionId: buySession,
        acceptedOfferId: lock.accepted.acceptedOfferId,
      })
      check('payment instruction created', Boolean(pi.id))
      check('instruction bound to the offer hash', pi.consumerInstructionHash === lock.accepted.offerHash)
      check('instruction capped at the locked amount', pi.maxAmount === lock.accepted.amount)

      const unauth = await authorizePayment({ sessionId: buySession, paymentInstructionId: pi.id })
      check(
        'unauthenticated instruction is refused',
        !unauth.ok && unauth.failureCode === 'PAYMENT_INSTRUCTION_NOT_AUTHENTICATED',
        unauth.failureCode ?? '',
      )

      // Re-issue, since the failed attempt marked the instruction declined.
      const pi2 = await issuePaymentInstruction({
        sessionId: buySession,
        acceptedOfferId: lock.accepted.acceptedOfferId,
      })
      await markInstructionAuthenticated({
        sessionId: buySession,
        paymentInstructionId: pi2.id,
        method: 'simulated',
      })
      const auth = await authorizePayment({ sessionId: buySession, paymentInstructionId: pi2.id })
      check('authorization approved', auth.ok, auth.visa ? `${auth.visa.label} · ${auth.visa.latencyMs}ms` : auth.message)
      check('transaction recorded', Boolean(auth.transaction))
      check('order created', Boolean(auth.order), auth.order ? `${auth.order.id} (${auth.order.externalOrderStatus})` : '')
      check('every instruction control passed', auth.checks.every((c) => c.passed))

      const reuse = await authorizePayment({ sessionId: buySession, paymentInstructionId: pi2.id })
      check(
        'consumed instruction cannot be replayed',
        !reuse.ok && reuse.failureCode === 'PAYMENT_INSTRUCTION_ALREADY_CONSUMED',
        reuse.failureCode ?? '',
      )
    }
  }

  /* ── 8. Failure paths ── */
  head('8. Failure paths')
  await runFaultCase('amount over cap', { amountOverCap: true }, 'PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED')
  await runFaultCase('merchant mismatch', { merchantMismatch: true }, 'MERCHANT_MISMATCH')
  await runFaultCase('expired instruction', { expiredInstruction: true }, 'PAYMENT_INSTRUCTION_EXPIRED')
  await runFaultCase('issuer decline', { visaDecline: true }, 'VISA_AUTH_DECLINED')

  // Signature fault stops offers being constructed at all.
  {
    const sessionId = await newSession()
    const intent = await buildCustomerIntent({ sessionId, text: PROMPTS[0] })
    await store.saveIntent(intent)
    const round = await runOfferRound({
      intent,
      sessionId,
      faults: { ...EMPTY_FAULTS, invalidSignature: true },
    })
    check('invalid TAP signature blocks every offer', round.offers.length === 0, `${round.declines.length} declines`)
    check(
      'signature failure is reported as AGENT_SIGNATURE_INVALID',
      round.declines.every((d) => d.reason.includes('AGENT_SIGNATURE_INVALID')),
    )
  }

  // Out-of-stock fault.
  {
    const sessionId = await newSession()
    const intent = await buildCustomerIntent({ sessionId, text: PROMPTS[0] })
    await store.saveIntent(intent)
    const round = await runOfferRound({
      intent,
      sessionId,
      faults: { ...EMPTY_FAULTS, outOfStock: true },
    })
    check('forced out-of-stock produces no sealed offers', round.offers.length === 0)
  }

  /* ── 9. Storefront isolation ── */
  head('9. Storefront merchant isolation')
  const tan = merchants.find((m) => m.id === 'sherpa-computers') ?? merchants[0]
  const rival = merchants.find((m) => m.id !== tan.id)!

  const inScope = await storefrontChat({
    merchantId: tan.id,
    message: "I'm studying engineering and need a laptop for CAD under S$1,500.",
    history: [],
  })
  check('storefront answers in-scope questions', inScope.products.length > 0, `${inScope.products.length} products`)
  check(
    'storefront only returns this merchant’s products',
    inScope.products.every((p) => p.merchantId === tan.id),
  )

  const outOfScope = await storefrontChat({
    merchantId: tan.id,
    message: `Is ${rival.name}'s Lenovo better?`,
    history: [],
  })
  check('competitor question is refused', outOfScope.refusedCrossMerchant, outOfScope.text.slice(0, 70) + '…')
  check(
    'refusal returns no competitor products',
    outOfScope.products.every((p) => p.merchantId === tan.id),
  )

  /* ── Summary ── */
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log('\n' + '═'.repeat(30))
  console.log(`${passed} passed, ${failed} failed  (${seconds}s)`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log('\nAll smoke checks passed.')
}

async function runFaultCase(name: string, fault: Partial<DemoFaults>, expectedCode: string) {
  const store = getStore()
  const sessionId = await newSession()
  const intent = await buildCustomerIntent({ sessionId, text: PROMPTS[0] })
  await store.saveIntent(intent)
  const faults: DemoFaults = { ...EMPTY_FAULTS, ...fault }
  const round = await runOfferRound({ intent, sessionId, faults })
  if (!round.ranked.length) {
    check(`${name} → ${expectedCode}`, false, 'no offers to buy')
    return
  }
  const lock = await lockOffer({ sessionId, offerId: round.ranked[0].offerId, faults })
  if (!lock.ok || !lock.accepted) {
    check(`${name} → ${expectedCode}`, false, `lock failed: ${lock.failureCode}`)
    return
  }
  const pi = await issuePaymentInstruction({
    sessionId,
    acceptedOfferId: lock.accepted.acceptedOfferId,
    faults,
  })
  await markInstructionAuthenticated({ sessionId, paymentInstructionId: pi.id, method: 'simulated' })
  const auth = await authorizePayment({ sessionId, paymentInstructionId: pi.id, faults })
  check(`${name} → ${expectedCode}`, !auth.ok && auth.failureCode === expectedCode, auth.failureCode ?? 'approved')
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err)
  process.exit(1)
})
