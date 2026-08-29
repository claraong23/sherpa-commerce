import { z } from 'zod'
import { markInstructionAuthenticated } from '@agents/purchase-flow'
import { serverEnv } from '@core/env'
import { verifyAssertion } from '@visa/webauthn'
import { bad, ok, parseBody } from '../../../_shared'

export const runtime = 'nodejs'

const Body = z.object({
  sessionId: z.string(),
  paymentInstructionId: z.string(),
  /** Present for real WebAuthn; absent for the explicitly-labelled fallback. */
  assertion: z
    .object({
      clientDataJSON: z.string().max(8000),
      authenticatorData: z.string().max(8000),
      signature: z.string().max(8000),
    })
    .optional(),
  simulated: z.boolean().default(false),
})

function originContext(req: Request) {
  const env = serverEnv()
  const origin = req.headers.get('origin') ?? env.appUrl
  const allowedOrigins = [env.appUrl, origin, 'http://localhost:3000'].filter(Boolean) as string[]
  const expectedRpIds = Array.from(
    new Set(
      allowedOrigins
        .map((o) => {
          try {
            return new URL(o).hostname
          } catch {
            return null
          }
        })
        .filter(Boolean) as string[],
    ),
  )
  return { allowedOrigins, expectedRpIds }
}

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const env = serverEnv()

  if (data.simulated || !data.assertion || !env.enableWebauthn) {
    const updated = await markInstructionAuthenticated({
      sessionId: data.sessionId,
      paymentInstructionId: data.paymentInstructionId,
      method: 'simulated',
    })
    if (!updated) return bad('unknown Payment Instruction', 404)
    return ok({
      authenticated: true,
      method: 'simulated' as const,
      note: 'Passkey-style confirmation simulated. No FIDO credential was used for this authorization.',
      instruction: updated,
    })
  }

  const { allowedOrigins, expectedRpIds } = originContext(req)
  const result = await verifyAssertion({
    sessionId: data.sessionId,
    ...data.assertion,
    allowedOrigins,
    expectedRpIds,
  })
  if (!result.ok) return bad(result.error ?? 'assertion verification failed', 401)

  const updated = await markInstructionAuthenticated({
    sessionId: data.sessionId,
    paymentInstructionId: data.paymentInstructionId,
    method: 'webauthn',
  })
  if (!updated) return bad('unknown Payment Instruction', 404)

  return ok({
    authenticated: true,
    method: 'webauthn' as const,
    note: 'Browser WebAuthn assertion verified server-side (ES256). Production mapping: Visa Payment Passkeys.',
    instruction: updated,
  })
}
