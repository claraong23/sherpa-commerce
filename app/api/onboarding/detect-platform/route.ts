import { z } from 'zod'
import { detectPlatform, normalizeUrl } from '@core/detect/platform'
import { bad, clientKey, ok, parseBody, rateLimit } from '../../_shared'

export const runtime = 'nodejs'

const Body = z.object({ url: z.string().min(3).max(300) })

export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'detect'), 30)
  if (!limit.allowed) return bad('too many detection requests', 429, { retryAfter: limit.retryAfter })

  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const url = normalizeUrl(data.url)
  if (!url) return bad('that does not look like a URL')

  const detection = await detectPlatform(url)
  return ok({ detection, supported: detection.commercePlatform === 'shopify' })
}
