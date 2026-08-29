import { z } from 'zod'
import { storefrontChat } from '@agents/storefront-agent'
import { getStore } from '@core/db'
import { bad, clientKey, ok, parseBody, rateLimit } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  merchantId: z.string().min(1).max(60),
  message: z.string().min(1).max(1500),
  history: z
    .array(z.object({ role: z.enum(['user', 'agent']), text: z.string().max(2000) }))
    .max(12)
    .default([]),
})

/**
 * Storefront chat. The session is scoped to one merchantId and the agent's
 * tools are constructed around it — there is no cross-merchant tool to call.
 */
export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'storefront'), 40)
  if (!limit.allowed) return bad('too many messages', 429, { retryAfter: limit.retryAfter })

  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const merchant = await getStore().getMerchant(data.merchantId)
  if (!merchant) return bad('unknown merchant', 404)
  if (!merchant.storefrontEnabled) return bad('storefront agent is not enabled for this merchant', 403)

  const reply = await storefrontChat({
    merchantId: data.merchantId,
    message: data.message,
    history: data.history,
  })

  return ok(reply)
}
