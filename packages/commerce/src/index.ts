import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { DemoCommerceAdapter } from './demo'
import { GenericApiAdapter } from './generic'
import { ShopifyCommerceAdapter } from './shopify'
import type { CommerceAdapter } from './types'

export * from './types'
export { DemoCommerceAdapter } from './demo'
export { GenericApiAdapter } from './generic'
export { ShopifyCommerceAdapter } from './shopify'

/**
 * Adapter selection is a merchant property, resolved here and nowhere else.
 * Callers ask for "the adapter for this merchant" and never learn which one
 * they got.
 */
export async function getAdapterForMerchant(merchantId: string): Promise<CommerceAdapter> {
  const merchant = await getStore().getMerchant(merchantId)
  const env = serverEnv()

  if (
    merchant?.commercePlatform === 'shopify' &&
    merchant.slug === env.shopifyMerchantSlug &&
    ShopifyCommerceAdapter.configured() &&
    env.enableShopifySync
  ) {
    return new ShopifyCommerceAdapter(merchantId)
  }

  if (merchant?.commercePlatform === 'custom' && process.env[`MERCHANT_API_URL_${merchantId.toUpperCase()}`]) {
    return new GenericApiAdapter(merchantId, {
      baseUrl: process.env[`MERCHANT_API_URL_${merchantId.toUpperCase()}`]!,
      apiKey: process.env[`MERCHANT_API_KEY_${merchantId.toUpperCase()}`],
    })
  }

  return new DemoCommerceAdapter(merchantId)
}

export function adapterLabel(kind: CommerceAdapter['kind']): string {
  switch (kind) {
    case 'shopify':
      return 'Shopify Admin API (live)'
    case 'generic':
      return 'Merchant API (custom integration)'
    default:
      return 'Seeded catalogue mirror (demo)'
  }
}
