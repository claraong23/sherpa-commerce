import type { AcceptedOffer, Currency, PaymentInstruction } from '@core/schemas'
import { id, isoIn, nowIso } from '@core/ids'

/**
 * PAYMENT INSTRUCTION — local implementation of the Visa Intelligent Commerce
 * control model.
 *
 * The object below is ours; the controls it enforces (exact merchant, amount
 * ceiling, expiry, bound consumer instruction, explicit authentication) are the
 * ones VIC describes. We do not hold VIC credentials, so nothing here calls a
 * Visa credential service — this is the local equivalent, enforced for real
 * before any authorization request leaves the server.
 *
 * Judge-facing terminology is "Payment Instruction", never "mandate".
 */

export type PaymentInstructionFailureCode =
  | 'PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED'
  | 'PAYMENT_INSTRUCTION_EXPIRED'
  | 'PAYMENT_INSTRUCTION_NOT_AUTHENTICATED'
  | 'PAYMENT_INSTRUCTION_ALREADY_CONSUMED'
  | 'MERCHANT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'OFFER_HASH_MISMATCH'
  | 'CUSTOMER_NOT_CONFIRMED'

export interface PaymentInstructionCheck {
  control: string
  passed: boolean
  detail: string
  code: PaymentInstructionFailureCode | null
}

export interface PaymentInstructionEvaluation {
  approved: boolean
  failureCode: PaymentInstructionFailureCode | null
  checks: PaymentInstructionCheck[]
}

export const DEFAULT_INSTRUCTION_TTL_SECONDS = 600

export function createPaymentInstruction(args: {
  sessionId: string
  accepted: AcceptedOffer
  ttlSeconds?: number
  /** Demo fault: cap the instruction below the accepted amount. */
  capOverride?: number
  /** Demo fault: create the instruction already expired. */
  expiredOverride?: boolean
  credentialLast4?: string
}): PaymentInstruction {
  const ttl = args.ttlSeconds ?? DEFAULT_INSTRUCTION_TTL_SECONDS
  return {
    id: id('pi').toUpperCase().replace('PI_', 'PI-'),
    sessionId: args.sessionId,
    acceptedOfferId: args.accepted.acceptedOfferId,
    merchantId: args.accepted.merchantId,
    maxAmount: args.capOverride ?? args.accepted.amount,
    currency: args.accepted.currency,
    expiresAt: args.expiredOverride ? isoIn(-60) : isoIn(ttl),
    consumerInstructionHash: args.accepted.offerHash,
    authenticated: false,
    authenticationMethod: 'none',
    credentialLast4: args.credentialLast4 ?? '4821',
    state: 'created',
    createdAt: nowIso(),
  }
}

/**
 * Every control is evaluated (not short-circuited) so the UI can show the full
 * check list, but the first failure in order determines the decline code.
 */
export function evaluatePaymentInstruction(args: {
  instruction: PaymentInstruction
  accepted: AcceptedOffer
  requestedMerchantId: string
  requestedAmount: number
  requestedCurrency: Currency
  currentOfferHash: string
  now?: number
}): PaymentInstructionEvaluation {
  const { instruction: pi, accepted } = args
  const now = args.now ?? Date.now()
  const checks: PaymentInstructionCheck[] = []

  const push = (
    control: string,
    passed: boolean,
    detail: string,
    code: PaymentInstructionFailureCode,
  ) => checks.push({ control, passed, detail, code: passed ? null : code })

  push(
    'Merchant match',
    pi.merchantId === args.requestedMerchantId && accepted.merchantId === args.requestedMerchantId,
    pi.merchantId === args.requestedMerchantId
      ? `authorization target ${args.requestedMerchantId} matches instruction`
      : `instruction is bound to ${pi.merchantId}, authorization targets ${args.requestedMerchantId}`,
    'MERCHANT_MISMATCH',
  )

  push(
    'Amount within limit',
    args.requestedAmount <= pi.maxAmount + 0.001,
    `${args.requestedCurrency} ${args.requestedAmount.toFixed(2)} against ceiling ${pi.currency} ${pi.maxAmount.toFixed(2)}`,
    'PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED',
  )

  push(
    'Currency match',
    pi.currency === args.requestedCurrency,
    `instruction currency ${pi.currency}, requested ${args.requestedCurrency}`,
    'CURRENCY_MISMATCH',
  )

  push(
    'Instruction not expired',
    new Date(pi.expiresAt).getTime() > now,
    `expires ${new Date(pi.expiresAt).toISOString()}`,
    'PAYMENT_INSTRUCTION_EXPIRED',
  )

  push(
    'Offer hash unchanged',
    pi.consumerInstructionHash === args.currentOfferHash && accepted.offerHash === args.currentOfferHash,
    pi.consumerInstructionHash === args.currentOfferHash
      ? `sha-256 ${args.currentOfferHash.slice(0, 16)}… matches locked offer`
      : 'locked offer content address changed since the instruction was created',
    'OFFER_HASH_MISMATCH',
  )

  push(
    'Customer confirmed',
    accepted.customerConfirmed,
    accepted.customerConfirmed ? 'customer confirmed the locked offer' : 'customer has not confirmed',
    'CUSTOMER_NOT_CONFIRMED',
  )

  push(
    'Authenticated',
    pi.authenticated,
    pi.authenticated
      ? `authenticated via ${pi.authenticationMethod}`
      : 'no passkey/FIDO confirmation on this instruction',
    'PAYMENT_INSTRUCTION_NOT_AUTHENTICATED',
  )

  push(
    'Instruction unused',
    pi.state !== 'consumed',
    pi.state === 'consumed' ? 'instruction has already been consumed' : `state=${pi.state}`,
    'PAYMENT_INSTRUCTION_ALREADY_CONSUMED',
  )

  const firstFailure = checks.find((c) => !c.passed)
  return {
    approved: !firstFailure,
    failureCode: firstFailure?.code ?? null,
    checks,
  }
}

export const FAILURE_MESSAGES: Record<PaymentInstructionFailureCode, string> = {
  PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED:
    'The amount requested is above the ceiling you authorized. Nothing was charged.',
  PAYMENT_INSTRUCTION_EXPIRED:
    'This Payment Instruction expired before authorization. Nothing was charged.',
  PAYMENT_INSTRUCTION_NOT_AUTHENTICATED:
    'This Payment Instruction has not been confirmed with a passkey yet.',
  PAYMENT_INSTRUCTION_ALREADY_CONSUMED:
    'This Payment Instruction has already been used for a transaction.',
  MERCHANT_MISMATCH:
    'The merchant being charged is not the merchant you authorized. Nothing was charged.',
  CURRENCY_MISMATCH: 'The authorization currency does not match the Payment Instruction.',
  OFFER_HASH_MISMATCH:
    'The offer changed after you locked it, so authorization was blocked. Nothing was charged.',
  CUSTOMER_NOT_CONFIRMED: 'The locked offer has not been confirmed by the customer.',
}
