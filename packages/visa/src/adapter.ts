import type { Currency } from '@core/schemas'

/**
 * Visa Acceptance authorization boundary.
 *
 * Two implementations share this interface: a real sandbox client and a mock.
 * Everything above this line (Payment Instruction controls, offer hash, TAP
 * verification, passkey) runs identically in both modes — only the outbound
 * authorization call differs.
 */
export interface VisaAuthorizationInput {
  /** Tokenized credential reference. A raw PAN never reaches this layer. */
  token: string
  amount: number
  currency: Currency
  merchantId: string
  merchantName: string
  agentId: string
  paymentInstructionId: string
  consumerInstructionHash: string
  /** Demo-only: force a decline path. */
  forceDecline?: boolean
}

export interface VisaAuthorizationResult {
  status: 'approved' | 'declined' | 'error'
  auth_code: string | null
  network_token_last4: string
  transaction_id: string | null
  decline_reason: string | null
  processor: 'visa_acceptance_sandbox' | 'simulated_visa_acceptance'
  /** Raw-ish diagnostic for the developer panel. Never contains credentials. */
  diagnostics: Record<string, unknown>
  latencyMs: number
}

export interface VisaPaymentAdapter {
  readonly mode: 'sandbox' | 'mock'
  authorize(input: VisaAuthorizationInput): Promise<VisaAuthorizationResult>
}
