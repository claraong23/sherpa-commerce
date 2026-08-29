import { randomBytes } from 'node:crypto'
import { assertServer } from '@core/server-guard'
import type { VisaAuthorizationInput, VisaAuthorizationResult, VisaPaymentAdapter } from './adapter'

assertServer('@visa/mock')

/**
 * Simulated Visa Acceptance authorization.
 *
 * Same interface, same response shape, same latency profile as the sandbox
 * adapter — but nothing leaves this process. Every surface that renders a
 * result from this adapter labels it "Simulated Visa Acceptance".
 */
export class MockVisaAcceptanceAdapter implements VisaPaymentAdapter {
  readonly mode = 'mock' as const

  async authorize(input: VisaAuthorizationInput): Promise<VisaAuthorizationResult> {
    const started = Date.now()
    await new Promise((r) => setTimeout(r, 620 + Math.floor(Math.random() * 280)))

    // Deterministic decline cases so the failure demo is reproducible.
    const cents = Math.round(input.amount * 100) % 100
    const declineByAmount = cents === 13
    const declined = input.forceDecline === true || declineByAmount

    if (declined) {
      return {
        status: 'declined',
        auth_code: null,
        network_token_last4: '4821',
        transaction_id: null,
        decline_reason: declineByAmount
          ? 'ISSUER_DECLINED (simulated: amounts ending .13 always decline)'
          : 'ISSUER_DECLINED (simulated)',
        processor: 'simulated_visa_acceptance',
        diagnostics: {
          simulated: true,
          rule: declineByAmount ? 'amount_cents_13' : 'forced_decline',
          merchantId: input.merchantId,
          paymentInstructionId: input.paymentInstructionId,
        },
        latencyMs: Date.now() - started,
      }
    }

    return {
      status: 'approved',
      auth_code: randomBytes(3).toString('hex').toUpperCase(),
      network_token_last4: '4821',
      transaction_id: `sim_${randomBytes(8).toString('hex')}`,
      decline_reason: null,
      processor: 'simulated_visa_acceptance',
      diagnostics: {
        simulated: true,
        note: 'No external call was made. Request/response model mirrors Visa Acceptance pts/v2/payments.',
        merchantId: input.merchantId,
        paymentInstructionId: input.paymentInstructionId,
        consumerInstructionHashPrefix: input.consumerInstructionHash.slice(0, 16),
      },
      latencyMs: Date.now() - started,
    }
  }
}
