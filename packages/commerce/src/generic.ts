import { nowIso } from '@core/ids'
import { DemoCommerceAdapter } from './demo'
import type {
  CommerceAdapter,
  CommerceOrder,
  InventoryState,
  NormalizedProduct,
  OrderInput,
  Quote,
  QuoteInput,
} from './types'

/**
 * Custom / enterprise merchant path.
 *
 * A merchant whose platform we do not have a no-code connector for implements
 * these four endpoints against the contract published at
 * `/docs/merchant/[merchantId]`, and gets the same agent-network participation
 * as a Shopify store.
 *
 * Skeleton: wired end-to-end, falls back to the seeded mirror when no base URL
 * is configured for the merchant. It is not exercised by the demo flow.
 */
export interface GenericApiConfig {
  baseUrl: string
  /** Sent as `authorization: Bearer …`. Server-side only. */
  apiKey?: string
}

export class GenericApiAdapter implements CommerceAdapter {
  readonly kind = 'generic' as const
  private fallback: DemoCommerceAdapter

  constructor(
    readonly merchantId: string,
    private config: GenericApiConfig | null,
  ) {
    this.fallback = new DemoCommerceAdapter(merchantId)
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.config) throw new Error('generic adapter has no baseUrl configured')
    const res = await fetch(new URL(path, this.config.baseUrl).toString(), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new Error(`[generic-adapter] ${res.status} ${await res.text()}`)
    return (await res.json()) as T
  }

  async syncCatalog(merchantId: string): Promise<NormalizedProduct[]> {
    if (!this.config) return this.fallback.syncCatalog(merchantId)
    try {
      const r = await this.call<{ products: NormalizedProduct[] }>(`/merchant/${merchantId}/products/search`)
      return r.products
    } catch (err) {
      console.warn('[generic-adapter] syncCatalog failed, using mirror:', (err as Error).message)
      return this.fallback.syncCatalog(merchantId)
    }
  }

  async getInventory(merchantId: string, sku: string): Promise<InventoryState> {
    if (!this.config) return this.fallback.getInventory(merchantId, sku)
    try {
      const r = await this.call<{ available: number }>(`/merchant/${merchantId}/inventory/${sku}`)
      return { sku, merchantId, available: r.available, source: 'mirror', checkedAt: nowIso() }
    } catch {
      return this.fallback.getInventory(merchantId, sku)
    }
  }

  async createQuote(input: QuoteInput): Promise<Quote> {
    if (!this.config) return this.fallback.createQuote(input)
    try {
      return await this.call<Quote>(`/merchant/${input.merchantId}/quote`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
    } catch {
      return this.fallback.createQuote(input)
    }
  }

  async createOrder(input: OrderInput): Promise<CommerceOrder> {
    if (!this.config) return this.fallback.createOrder(input)
    try {
      const r = await this.call<{ orderId: string }>(`/merchant/${input.merchantId}/orders`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return { externalOrderId: r.orderId, status: 'created', detail: 'Merchant API order created.' }
    } catch (err) {
      return { externalOrderId: null, status: 'failed', detail: (err as Error).message }
    }
  }
}
