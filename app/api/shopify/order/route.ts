import { z } from 'zod'
import { getAdapterForMerchant } from '@commerce/index'
import { getStore } from '@core/db'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  merchantId: z.string(),
  sku: z.string(),
  quantity: z.number().int().min(1).max(5).default(1),
  amount: z.number().positive(),
  currency: z.string().default('SGD'),
  reference: z.string().max(120),
})

/**
 * Direct order creation, exposed for the merchant developer path. The customer
 * purchase flow reaches this through the adapter, not through this route.
 */
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const merchant = await getStore().getMerchant(data.merchantId)
  if (!merchant) return bad('unknown merchant', 404)

  const adapter = await getAdapterForMerchant(data.merchantId)
  const result = await adapter.createOrder(data)
  return ok({ ...result, adapter: adapter.kind, shopifyOrderStatus: result.status })
}
