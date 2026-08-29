import { serverEnv } from '@core/env'
import type { VisaPaymentAdapter } from './adapter'
import { MockVisaAcceptanceAdapter } from './mock'
import { VisaAcceptanceSandboxAdapter } from './sandbox'

export type { VisaAuthorizationInput, VisaAuthorizationResult, VisaPaymentAdapter } from './adapter'
export { MockVisaAcceptanceAdapter } from './mock'
export { VisaAcceptanceSandboxAdapter } from './sandbox'
export * from './payment-instruction'
export * from './tap'
export * from './webauthn'

/**
 * Sandbox only when the mode is explicitly `sandbox` AND every credential is
 * present. Anything else uses the mock, so a half-configured environment
 * cannot produce a confusing partial failure mid-demo.
 */
export function getVisaAdapter(): VisaPaymentAdapter {
  const env = serverEnv()
  const configured = Boolean(env.visaMerchantId && env.visaKeyId && env.visaSecretKey)
  if (env.visaMode === 'sandbox' && configured) return new VisaAcceptanceSandboxAdapter()
  return new MockVisaAcceptanceAdapter()
}

export function visaModeLabel(): { mode: 'sandbox' | 'mock'; label: string; honesty: string } {
  const adapter = getVisaAdapter()
  return adapter.mode === 'sandbox'
    ? {
        mode: 'sandbox',
        label: 'Visa Acceptance — sandbox',
        honesty: 'This authorization is a real HTTP call to the Visa Acceptance sandbox. No real money moves.',
      }
    : {
        mode: 'mock',
        label: 'Simulated Visa Acceptance',
        honesty:
          'The Visa Acceptance authorization is simulated to the documented request/response model. No external call is made and no card is charged.',
      }
}
