import { z } from 'zod'
import {
  buildSandbox,
  createOnboardingSession,
  handleOnboardingMessage,
} from '@agents/onboarding-agent'
import { getStore } from '@core/db'
import { bad, clientKey, ok, parseBody, rateLimit } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  sessionId: z.string().nullable().optional(),
  message: z.string().max(4000).optional(),
})

export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'onb-chat'), 60)
  if (!limit.allowed) return bad('too many messages', 429, { retryAfter: limit.retryAfter })

  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()

  // No session id, or an unknown one: start a fresh onboarding conversation.
  let session = data.sessionId ? await store.getOnboardingSession(data.sessionId) : null
  if (!session) {
    session = await createOnboardingSession()
    return ok({
      sessionId: session.id,
      messages: session.messages,
      sandbox: await buildSandbox(session),
      actions: [],
    })
  }

  if (!data.message?.trim()) {
    return ok({
      sessionId: session.id,
      messages: session.messages,
      sandbox: await buildSandbox(session),
      actions: [],
    })
  }

  const turn = await handleOnboardingMessage({ session, message: data.message.trim() })
  return ok({
    sessionId: turn.session.id,
    messages: turn.session.messages,
    sandbox: turn.sandbox,
    actions: turn.actions,
  })
}
