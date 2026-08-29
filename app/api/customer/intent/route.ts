import { z } from 'zod'
import { buildCustomerIntent } from '@agents/intent'
import { bad, clientKey, ok, parseBody, rateLimit } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 45

const Body = z.object({ sessionId: z.string(), text: z.string().min(2).max(2000) })

/** Intent extraction on its own, without running an offer round. */
export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'intent'), 40)
  if (!limit.allowed) return bad('too many requests', 429, { retryAfter: limit.retryAfter })

  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const intent = await buildCustomerIntent({ sessionId: data.sessionId, text: data.text })
  return ok({ intent })
}
