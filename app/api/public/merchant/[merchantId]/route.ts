import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { bad, ok } from '../../../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public, browser-safe merchant config for the storefront widget / Shopify app
 * embed. Contains the public agent identifier only — no commercial rules, no
 * margins, no credentials.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params
  const merchant = await getStore().getMerchant(merchantId)
  if (!merchant) return bad('unknown merchant', 404)

  const res = ok({
    merchantId: merchant.id,
    agentId: merchant.agentId,
    name: merchant.name,
    currency: merchant.currency,
    storefrontEnabled: merchant.storefrontEnabled,
    chatEndpoint: `${serverEnv().appUrl}/api/storefront/chat`,
  })
  res.headers.set('access-control-allow-origin', '*')
  res.headers.set('cache-control', 'public, max-age=60')
  return res
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
}
