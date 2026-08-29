import { z } from 'zod'
import { getAdapterForMerchant } from '@commerce/index'
import { ShopifyCommerceAdapter } from '@commerce/shopify'
import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 120

const Body = z.object({ merchantId: z.string() })

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const merchant = await getStore().getMerchant(data.merchantId)
  if (!merchant) return bad('unknown merchant', 404)

  const env = serverEnv()
  const adapter = await getAdapterForMerchant(data.merchantId)
  const products = await adapter.syncCatalog(data.merchantId)

  return ok({
    merchantId: data.merchantId,
    adapter: adapter.kind,
    shopifyConfigured: ShopifyCommerceAdapter.configured(),
    storeDomain: env.shopifyStoreDomain ?? null,
    productsSynced: products.length,
    note:
      adapter.kind === 'shopify'
        ? 'Products, variants and inventory pulled from the Shopify GraphQL Admin API.'
        : 'Shopify credentials absent — returned the seeded catalogue mirror instead.',
  })
}
