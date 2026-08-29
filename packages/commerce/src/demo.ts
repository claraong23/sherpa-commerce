import { getStore } from '@core/db'
import { id, isoIn, nowIso } from '@core/ids'
import type {
  CommerceAdapter,
  CommerceOrder,
  InventoryState,
  NormalizedProduct,
  OrderInput,
  Quote,
  QuoteInput,
  Reservation,
  ReservationInput,
} from './types'

/**
 * Seeded-mirror adapter.
 *
 * Backs any merchant with no live commerce connection, and backs the Shopify
 * merchant too whenever Shopify credentials are absent. Inventory reads and
 * order writes are real against the local store — they are just not talking to
 * an external commerce platform.
 */
export class DemoCommerceAdapter implements CommerceAdapter {
  readonly kind = 'demo' as const
  constructor(readonly merchantId: string) {}

  async syncCatalog(merchantId: string): Promise<NormalizedProduct[]> {
    return getStore().listProducts(merchantId)
  }

  async getInventory(merchantId: string, sku: string): Promise<InventoryState> {
    const p = await getStore().getProductBySku(merchantId, sku)
    return {
      sku,
      merchantId,
      available: p?.stock ?? 0,
      source: 'mirror',
      checkedAt: nowIso(),
    }
  }

  async createQuote(input: QuoteInput): Promise<Quote> {
    return {
      quoteId: id('quote'),
      merchantId: input.merchantId,
      sku: input.sku,
      total: input.price,
      currency: input.currency,
      expiresAt: isoIn(900),
    }
  }

  async reserve(input: ReservationInput): Promise<Reservation> {
    const store = getStore()
    const p = await store.getProductBySku(input.merchantId, input.sku)
    const honored = (p?.stock ?? 0) >= input.quantity
    return {
      reservationId: id('resv'),
      merchantId: input.merchantId,
      sku: input.sku,
      quantity: input.quantity,
      expiresAt: isoIn(input.holdSeconds),
      honored,
    }
  }

  async createOrder(input: OrderInput): Promise<CommerceOrder> {
    const store = getStore()
    const p = await store.getProductBySku(input.merchantId, input.sku)
    if (!p) {
      return { externalOrderId: null, status: 'failed', detail: `sku ${input.sku} not found` }
    }
    if (p.stock < input.quantity) {
      return { externalOrderId: null, status: 'failed', detail: `insufficient inventory for ${input.sku}` }
    }
    await store.setStock(input.merchantId, input.sku, p.stock - input.quantity)
    return {
      externalOrderId: null,
      status: 'demo',
      detail:
        'Internal demo order recorded and inventory decremented. No external commerce platform is connected for this merchant.',
    }
  }
}
