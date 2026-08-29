import { createHmac } from 'node:crypto'
import { sha256Base64 } from '@core/canonical'
import { serverEnv } from '@core/env'
import { assertServer } from '@core/server-guard'
import type { VisaAuthorizationInput, VisaAuthorizationResult, VisaPaymentAdapter } from './adapter'

assertServer('@visa/sandbox')

/**
 * Visa Acceptance (REST) sandbox authorization.
 *
 * Auth: HTTP Signature (keyid / shared secret), which is what a fresh sandbox
 * account issues fastest. Visa recommends JWT for new integrations because
 * HTTP Signature must be migrated by March 2027 — the adapter boundary is here
 * precisely so that swap is a one-file change.
 *
 * The test instrument is read from env, used only in the outbound request body,
 * and never logged, persisted, returned to the client, or placed in an LLM
 * prompt.
 */
export class VisaAcceptanceSandboxAdapter implements VisaPaymentAdapter {
  readonly mode = 'sandbox' as const

  private signature(args: {
    host: string
    date: string
    requestTarget: string
    digest: string
    merchantId: string
    keyId: string
    secret: string
  }): string {
    const headers = ['host', 'date', '(request-target)', 'digest', 'v-c-merchant-id']
    const signingString = [
      `host: ${args.host}`,
      `date: ${args.date}`,
      `(request-target): ${args.requestTarget}`,
      `digest: ${args.digest}`,
      `v-c-merchant-id: ${args.merchantId}`,
    ].join('\n')

    const mac = createHmac('sha256', Buffer.from(args.secret, 'base64'))
      .update(signingString, 'utf8')
      .digest('base64')

    return [
      `keyid="${args.keyId}"`,
      'algorithm="HmacSHA256"',
      `headers="${headers.join(' ')}"`,
      `signature="${mac}"`,
    ].join(', ')
  }

  async authorize(input: VisaAuthorizationInput): Promise<VisaAuthorizationResult> {
    const started = Date.now()
    const env = serverEnv()

    if (!env.visaMerchantId || !env.visaKeyId || !env.visaSecretKey) {
      return {
        status: 'error',
        auth_code: null,
        network_token_last4: '4821',
        transaction_id: null,
        decline_reason:
          'VISA_ACCEPTANCE_NOT_CONFIGURED: set VISA_ACCEPTANCE_MERCHANT_ID, VISA_ACCEPTANCE_KEY_ID and VISA_ACCEPTANCE_SECRET_KEY, or run with VISA_ACCEPTANCE_MODE=mock',
        processor: 'visa_acceptance_sandbox',
        diagnostics: { configured: false },
        latencyMs: Date.now() - started,
      }
    }

    const path = '/pts/v2/payments'
    const url = new URL(path, env.visaBaseUrl)
    const host = url.host

    const body = JSON.stringify({
      clientReferenceInformation: {
        code: input.paymentInstructionId,
        comments: `agent=${input.agentId}; instruction=${input.consumerInstructionHash.slice(0, 32)}`,
      },
      processingInformation: { capture: false, commerceIndicator: 'internet' },
      orderInformation: {
        amountDetails: { totalAmount: input.amount.toFixed(2), currency: input.currency },
        billTo: {
          firstName: 'Agentic',
          lastName: 'Demo',
          address1: '1 Marina Boulevard',
          locality: 'Singapore',
          administrativeArea: 'SG',
          postalCode: '018989',
          country: 'SG',
          email: 'demo@example.com',
        },
      },
      paymentInformation: {
        card: {
          number: env.visaTestPan,
          expirationMonth: env.visaTestExpMonth,
          expirationYear: env.visaTestExpYear,
          type: '001',
        },
      },
    })

    const date = new Date().toUTCString()
    const digest = `SHA-256=${sha256Base64(body)}`
    const signature = this.signature({
      host,
      date,
      requestTarget: `post ${path}`,
      digest,
      merchantId: env.visaMerchantId,
      keyId: env.visaKeyId,
      secret: env.visaSecretKey,
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/hal+json;charset=utf-8',
          host,
          date,
          digest,
          'v-c-merchant-id': env.visaMerchantId,
          signature,
        },
        body,
      })

      const text = await res.text()
      let json: Record<string, unknown> = {}
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        json = { raw: text.slice(0, 500) }
      }

      const status = String(json.status ?? '')
      const approved = res.ok && (status === 'AUTHORIZED' || status === 'PENDING' || status === 'AUTHORIZED_PENDING_REVIEW')
      const processorInfo = (json.processorInformation ?? {}) as Record<string, unknown>
      const tokenInfo = (json.tokenInformation ?? {}) as Record<string, unknown>

      return {
        status: approved ? 'approved' : res.ok ? 'declined' : 'error',
        auth_code: (processorInfo.approvalCode as string) ?? null,
        network_token_last4:
          ((tokenInfo.prefix as string) ? String(tokenInfo.suffix ?? '') : '') ||
          String(
            ((json.paymentInformation as Record<string, unknown>)?.card as Record<string, unknown>)?.suffix ??
              '4821',
          ),
        transaction_id: (json.id as string) ?? null,
        decline_reason: approved
          ? null
          : `${status || res.status} ${String(json.errorInformation ? (json.errorInformation as Record<string, unknown>).reason : json.message ?? '')}`.trim(),
        processor: 'visa_acceptance_sandbox',
        diagnostics: {
          httpStatus: res.status,
          visaStatus: status,
          endpoint: `${env.visaBaseUrl}${path}`,
          // Credential fields are deliberately excluded.
          reconciliationId: json.reconciliationId ?? null,
        },
        latencyMs: Date.now() - started,
      }
    } catch (err) {
      return {
        status: 'error',
        auth_code: null,
        network_token_last4: '4821',
        transaction_id: null,
        decline_reason: `VISA_ACCEPTANCE_TRANSPORT_ERROR: ${(err as Error).message}`,
        processor: 'visa_acceptance_sandbox',
        diagnostics: { endpoint: `${env.visaBaseUrl}${path}` },
        latencyMs: Date.now() - started,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
