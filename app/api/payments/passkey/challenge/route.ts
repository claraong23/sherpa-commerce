import { z } from 'zod'
import { emitAgentEvent } from '@core/events/bus'
import { serverEnv } from '@core/env'
import { hasCredential, issueChallenge } from '@visa/webauthn'
import { ok, parseBody } from '../../../_shared'

export const runtime = 'nodejs'

const Body = z.object({
  sessionId: z.string(),
  kind: z.enum(['register', 'authenticate']),
})

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const env = serverEnv()
  if (!env.enableWebauthn) {
    return ok({ enabled: false, reason: 'ENABLE_WEBAUTHN is off; use the simulated confirmation path' })
  }

  const challenge = issueChallenge(data.sessionId, data.kind)
  await emitAgentEvent({
    sessionId: data.sessionId,
    type: 'PASSKEY_CHALLENGE_ISSUED',
    actor: 'visa',
    label: data.kind === 'register' ? 'Passkey registration challenge issued' : 'Passkey challenge issued',
    payload: { kind: data.kind },
  })

  return ok({
    enabled: true,
    challenge,
    kind: data.kind,
    hasCredential: hasCredential(data.sessionId),
    rp: { name: 'Agentic Commerce Demo' },
    user: { id: data.sessionId, name: 'demo-buyer', displayName: 'Demo Buyer' },
  })
}
