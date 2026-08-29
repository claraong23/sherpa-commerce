import { getAdapterForMerchant } from '@commerce/index'
import { canonicalizeOffer } from '@core/canonical'
import { getStore } from '@core/db'
import { emitAgentEvent } from '@core/events/bus'
import { id, isExpired, nowIso } from '@core/ids'
import type {
  AcceptedOffer,
  DemoFaults,
  Offer,
  Order,
  PaymentInstruction,
  Transaction,
} from '@core/schemas'
import { EMPTY_FAULTS } from '@core/schemas'
import { getVisaAdapter, visaModeLabel } from '@visa/index'
import {
  createPaymentInstruction,
  evaluatePaymentInstruction,
  FAILURE_MESSAGES,
  type PaymentInstructionCheck,
} from '@visa/payment-instruction'

/**
 * Recommendation → payment → order.
 *
 * Every step is a real check against persisted state. The LLM is not involved
 * anywhere below this line.
 */

/* ────────────────────────────  Offer lock  ──────────────────────────── */

export interface LockResult {
  ok: boolean
  accepted: AcceptedOffer | null
  offer: Offer | null
  failureCode: 'OFFER_EXPIRED' | 'OUT_OF_STOCK' | 'OFFER_HASH_MISMATCH' | 'OFFER_NOT_FOUND' | null
  detail: string
  checks: { label: string; passed: boolean; detail: string }[]
}

export async function lockOffer(args: {
  sessionId: string
  offerId: string
  faults?: DemoFaults
}): Promise<LockResult> {
  const faults = args.faults ?? EMPTY_FAULTS
  const store = getStore()
  const checks: LockResult['checks'] = []

  const offer = await store.getOffer(args.offerId)
  if (!offer) {
    return {
      ok: false,
      accepted: null,
      offer: null,
      failureCode: 'OFFER_NOT_FOUND',
      detail: `offer ${args.offerId} not found`,
      checks,
    }
  }

  const fail = async (
    code: NonNullable<LockResult['failureCode']>,
    detail: string,
  ): Promise<LockResult> => {
    await emitAgentEvent({
      sessionId: args.sessionId,
      type: 'OFFER_LOCK_FAILED',
      actor: 'exchange',
      merchantId: offer.merchantId,
      label: `Offer lock failed — ${code}`,
      payload: { offerId: offer.offerId, code, detail },
    })
    return { ok: false, accepted: null, offer, failureCode: code, detail, checks }
  }

  // 1. Validity window.
  const expired = isExpired(offer.expiresAt)
  checks.push({
    label: 'Offer still valid',
    passed: !expired,
    detail: `expires ${new Date(offer.expiresAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}`,
  })
  if (expired) {
    await store.updateOffer({ ...offer, state: 'expired' })
    return fail('OFFER_EXPIRED', 'the sealed offer expired before it was locked')
  }

  // 2. Live inventory recheck through the merchant's commerce adapter.
  const adapter = await getAdapterForMerchant(offer.merchantId)
  const inventory = await adapter.getInventory(offer.merchantId, offer.sku)
  const available = faults.outOfStock ? 0 : inventory.available
  checks.push({
    label: 'Inventory confirmed',
    passed: available > 0,
    detail: `${available} available (${inventory.source})`,
  })
  if (available <= 0) return fail('OUT_OF_STOCK', `${offer.sku} is no longer in stock`)

  // 3. Re-canonicalize and compare against the hash sealed by the merchant agent.
  const { canonical, hash } = canonicalizeOffer(offer)
  const unchanged = offer.hash === hash
  checks.push({
    label: 'Offer unchanged',
    passed: unchanged,
    detail: unchanged ? `sha-256 ${hash.slice(0, 16)}…` : 'content address differs from the sealed value',
  })
  if (!unchanged) {
    return fail('OFFER_HASH_MISMATCH', 'the offer content changed after it was sealed')
  }

  const locked: Offer = { ...offer, state: 'locked' }
  await store.updateOffer(locked)

  const accepted: AcceptedOffer = {
    acceptedOfferId: id('acc'),
    offerId: offer.offerId,
    requestId: offer.requestId,
    sessionId: args.sessionId,
    canonicalOffer: canonical,
    offerHash: hash,
    merchantId: offer.merchantId,
    amount: offer.price,
    currency: offer.currency,
    customerConfirmed: true,
    lockedAt: nowIso(),
  }
  await store.saveAcceptedOffer(accepted)

  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'OFFER_LOCKED',
    actor: 'exchange',
    merchantId: offer.merchantId,
    payload: {
      offerId: offer.offerId,
      acceptedOfferId: accepted.acceptedOfferId,
      hash: hash.slice(0, 16),
      amount: accepted.amount,
      currency: accepted.currency,
    },
  })

  return { ok: true, accepted, offer: locked, failureCode: null, detail: 'offer locked', checks }
}

/* ──────────────────────  Payment Instruction  ────────────────────── */

export async function issuePaymentInstruction(args: {
  sessionId: string
  acceptedOfferId: string
  faults?: DemoFaults
}): Promise<PaymentInstruction> {
  const faults = args.faults ?? EMPTY_FAULTS
  const store = getStore()
  const accepted = await store.getAcceptedOffer(args.acceptedOfferId)
  if (!accepted) throw new Error(`accepted offer ${args.acceptedOfferId} not found`)

  if (faults.amountOverCap || faults.expiredInstruction) {
    await emitAgentEvent({
      sessionId: args.sessionId,
      type: 'DEMO_FAULT_INJECTED',
      actor: 'system',
      label: faults.amountOverCap
        ? 'Demo fault: instruction ceiling set below the locked amount'
        : 'Demo fault: instruction created already expired',
      payload: { faults: { amountOverCap: faults.amountOverCap, expiredInstruction: faults.expiredInstruction } },
    })
  }

  const pi = createPaymentInstruction({
    sessionId: args.sessionId,
    accepted,
    capOverride: faults.amountOverCap ? Math.round(accepted.amount * 0.9 * 100) / 100 : undefined,
    expiredOverride: faults.expiredInstruction,
  })

  await store.savePaymentInstruction(pi)

  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'PAYMENT_INSTRUCTION_CREATED',
    actor: 'visa',
    merchantId: pi.merchantId,
    payload: {
      paymentInstructionId: pi.id,
      merchantId: pi.merchantId,
      maxAmount: pi.maxAmount,
      currency: pi.currency,
      expiresAt: pi.expiresAt,
      consumerInstructionHash: pi.consumerInstructionHash.slice(0, 16),
      credential: `Visa token •••• ${pi.credentialLast4}`,
    },
  })

  return pi
}

export async function markInstructionAuthenticated(args: {
  sessionId: string
  paymentInstructionId: string
  method: 'webauthn' | 'simulated'
}): Promise<PaymentInstruction | null> {
  const store = getStore()
  const pi = await store.getPaymentInstruction(args.paymentInstructionId)
  if (!pi) return null
  const updated: PaymentInstruction = {
    ...pi,
    authenticated: true,
    authenticationMethod: args.method,
    state: 'authenticated',
  }
  await store.updatePaymentInstruction(updated)
  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'PASSKEY_CONFIRMED',
    actor: 'visa',
    merchantId: pi.merchantId,
    label: args.method === 'webauthn' ? 'Passkey confirmed (WebAuthn)' : 'Confirmed (simulated passkey)',
    payload: { paymentInstructionId: pi.id, method: args.method },
  })
  return updated
}

/* ───────────────────────────  Authorization  ─────────────────────────── */

export interface AuthorizeResult {
  ok: boolean
  failureCode: string | null
  message: string
  checks: PaymentInstructionCheck[]
  transaction: Transaction | null
  order: Order | null
  visa: {
    mode: 'sandbox' | 'mock'
    label: string
    honesty: string
    authCode: string | null
    transactionId: string | null
    networkTokenLast4: string
    latencyMs: number
    diagnostics: Record<string, unknown>
  } | null
}

export async function authorizePayment(args: {
  sessionId: string
  paymentInstructionId: string
  faults?: DemoFaults
}): Promise<AuthorizeResult> {
  const faults = args.faults ?? EMPTY_FAULTS
  const store = getStore()

  const pi = await store.getPaymentInstruction(args.paymentInstructionId)
  if (!pi) {
    return {
      ok: false,
      failureCode: 'PAYMENT_INSTRUCTION_NOT_FOUND',
      message: 'Payment Instruction not found.',
      checks: [],
      transaction: null,
      order: null,
      visa: null,
    }
  }

  const accepted = await store.getAcceptedOffer(pi.acceptedOfferId)
  const offer = accepted ? await store.getOffer(accepted.offerId) : null
  if (!accepted || !offer) {
    return {
      ok: false,
      failureCode: 'ACCEPTED_OFFER_NOT_FOUND',
      message: 'The locked offer backing this instruction is missing.',
      checks: [],
      transaction: null,
      order: null,
      visa: null,
    }
  }

  // A merchant-mismatch fault targets a different merchant with the same instruction.
  const merchants = await store.listMerchants()
  const otherMerchant = merchants.find((m) => m.id !== pi.merchantId)
  const requestedMerchantId = faults.merchantMismatch && otherMerchant ? otherMerchant.id : pi.merchantId
  if (faults.merchantMismatch && otherMerchant) {
    await emitAgentEvent({
      sessionId: args.sessionId,
      type: 'DEMO_FAULT_INJECTED',
      actor: 'system',
      label: 'Demo fault: authorization redirected to a different merchant',
      payload: { boundTo: pi.merchantId, attempted: otherMerchant.id },
    })
  }

  const currentHash = canonicalizeOffer(offer).hash

  const evaluation = evaluatePaymentInstruction({
    instruction: pi,
    accepted,
    requestedMerchantId,
    requestedAmount: accepted.amount,
    requestedCurrency: accepted.currency,
    currentOfferHash: currentHash,
  })

  for (const c of evaluation.checks) {
    await emitAgentEvent({
      sessionId: args.sessionId,
      type: 'PAYMENT_INSTRUCTION_CHECK',
      actor: 'visa',
      merchantId: pi.merchantId,
      label: `${c.control}: ${c.passed ? 'pass' : 'FAIL'}`,
      payload: { control: c.control, passed: c.passed, detail: c.detail, code: c.code },
    })
  }

  if (!evaluation.approved) {
    const code = evaluation.failureCode!
    await store.updatePaymentInstruction({ ...pi, state: 'declined' })
    await emitAgentEvent({
      sessionId: args.sessionId,
      type: 'PAYMENT_INSTRUCTION_DECLINED',
      actor: 'visa',
      merchantId: pi.merchantId,
      label: code,
      payload: { code, checks: evaluation.checks },
    })
    return {
      ok: false,
      failureCode: code,
      message: FAILURE_MESSAGES[code] ?? 'The Payment Instruction controls rejected this authorization.',
      checks: evaluation.checks,
      transaction: null,
      order: null,
      visa: null,
    }
  }

  /* ── Controls passed. Only now does anything leave the server. ── */

  const merchant = await store.getMerchant(pi.merchantId)
  const adapter = getVisaAdapter()
  const label = visaModeLabel()

  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'VISA_AUTH_STARTED',
    actor: 'visa',
    merchantId: pi.merchantId,
    label: `${label.label} — authorizing`,
    payload: {
      mode: adapter.mode,
      amount: accepted.amount,
      currency: accepted.currency,
      credential: `Visa token •••• ${pi.credentialLast4}`,
    },
  })

  const result = await adapter.authorize({
    token: `tok_agent_demo_${pi.credentialLast4}`,
    amount: accepted.amount,
    currency: accepted.currency,
    merchantId: pi.merchantId,
    merchantName: merchant?.name ?? pi.merchantId,
    agentId: 'customer-agent-01',
    paymentInstructionId: pi.id,
    consumerInstructionHash: pi.consumerInstructionHash,
    forceDecline: faults.visaDecline,
  })

  const transaction: Transaction = {
    id: id('txn'),
    paymentInstructionId: pi.id,
    merchantId: pi.merchantId,
    amount: accepted.amount,
    currency: accepted.currency,
    status: result.status,
    authorizationCode: result.auth_code ?? undefined,
    networkTokenLast4: result.network_token_last4,
    externalTransactionId: result.transaction_id ?? undefined,
    declineReason: result.decline_reason ?? undefined,
    processor: result.processor,
    createdAt: nowIso(),
  }
  await store.saveTransaction(transaction)

  const visaInfo: AuthorizeResult['visa'] = {
    mode: adapter.mode,
    label: label.label,
    honesty: label.honesty,
    authCode: result.auth_code,
    transactionId: result.transaction_id,
    networkTokenLast4: result.network_token_last4,
    latencyMs: result.latencyMs,
    diagnostics: result.diagnostics,
  }

  if (result.status !== 'approved') {
    await store.updatePaymentInstruction({ ...pi, state: 'declined' })
    await emitAgentEvent({
      sessionId: args.sessionId,
      type: 'VISA_AUTH_DECLINED',
      actor: 'visa',
      merchantId: pi.merchantId,
      label: `Authorization ${result.status}`,
      payload: { reason: result.decline_reason, mode: adapter.mode },
    })
    return {
      ok: false,
      failureCode: result.status === 'error' ? 'VISA_AUTH_ERROR' : 'VISA_AUTH_DECLINED',
      message: result.decline_reason ?? 'The authorization was declined. Nothing was charged.',
      checks: evaluation.checks,
      transaction,
      order: null,
      visa: visaInfo,
    }
  }

  await store.updatePaymentInstruction({ ...pi, state: 'consumed' })

  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'VISA_AUTH_APPROVED',
    actor: 'visa',
    merchantId: pi.merchantId,
    payload: {
      authorizationCode: result.auth_code,
      transactionId: result.transaction_id,
      networkTokenLast4: result.network_token_last4,
      processor: result.processor,
      latencyMs: result.latencyMs,
    },
  })

  /* ── Order creation through the merchant's commerce adapter. ── */

  const commerce = await getAdapterForMerchant(pi.merchantId)
  const commerceOrder = await commerce.createOrder({
    merchantId: pi.merchantId,
    sku: offer.sku,
    quantity: 1,
    amount: accepted.amount,
    currency: accepted.currency,
    reference: pi.id,
    note: `Agentic commerce purchase. Payment Instruction ${pi.id}, offer hash ${accepted.offerHash.slice(0, 16)}.`,
  })

  const order: Order = {
    id: id('ord'),
    sessionId: args.sessionId,
    merchantId: pi.merchantId,
    acceptedOfferId: accepted.acceptedOfferId,
    transactionId: transaction.id,
    sku: offer.sku,
    productTitle: offer.product.title,
    amount: accepted.amount,
    currency: accepted.currency,
    bundle: offer.bundle,
    warrantyYears: offer.warrantyYears,
    deliveryDays: offer.deliveryDays,
    externalOrderId: commerceOrder.externalOrderId,
    externalOrderStatus: commerceOrder.status,
    createdAt: nowIso(),
  }
  await store.saveOrder(order)

  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'ORDER_CREATED',
    actor: 'commerce',
    merchantId: pi.merchantId,
    payload: {
      orderId: order.id,
      sku: order.sku,
      externalOrderId: order.externalOrderId,
      shopifyOrderStatus: order.externalOrderStatus,
      detail: commerceOrder.detail,
      adapter: commerce.kind,
    },
  })

  await emitAgentEvent({
    sessionId: args.sessionId,
    type: 'RECEIPT_SENT',
    actor: 'commerce',
    merchantId: pi.merchantId,
    payload: { orderId: order.id, amount: order.amount, currency: order.currency },
  })

  return {
    ok: true,
    failureCode: null,
    message: 'Authorization approved and order created.',
    checks: evaluation.checks,
    transaction,
    order,
    visa: visaInfo,
  }
}
