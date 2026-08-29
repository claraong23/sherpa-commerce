import type { Bundle, Product } from '@core/schemas'

/**
 * The only shape the rest of the system knows about.
 *
 * Nothing outside `packages/commerce` may import a Shopify type or reason about
 * a Shopify GID. Adding WooCommerce or Wix later means adding one file here.
 */

/** Catalogue records are already normalized by the adapter that produced them. */
export type NormalizedProduct = Product

export interface InventoryState {
  sku: string
  merchantId: string
  available: number
  source: 'shopify' | 'mirror'
  checkedAt: string
}

export interface QuoteInput {
  merchantId: string
  sku: string
  price: number
  currency: string
  bundle: Bundle | null
  warrantyYears: number
  deliveryDays: number
}

export interface Quote {
  quoteId: string
  merchantId: string
  sku: string
  total: number
  currency: string
  expiresAt: string
}

export interface ReservationInput {
  merchantId: string
  sku: string
  quantity: number
  holdSeconds: number
}

export interface Reservation {
  reservationId: string
  merchantId: string
  sku: string
  quantity: number
  expiresAt: string
  honored: boolean
}

export interface OrderInput {
  merchantId: string
  sku: string
  quantity: number
  amount: number
  currency: string
  reference: string
  customerEmail?: string
  note?: string
}

export interface CommerceOrder {
  externalOrderId: string | null
  status: 'created' | 'not_configured' | 'failed' | 'demo'
  detail: string
  raw?: Record<string, unknown>
}

export interface CommerceAdapter {
  readonly kind: 'shopify' | 'demo' | 'generic'
  readonly merchantId: string

  syncCatalog(merchantId: string): Promise<NormalizedProduct[]>
  getInventory(merchantId: string, sku: string): Promise<InventoryState>
  createQuote(input: QuoteInput): Promise<Quote>
  reserve?(input: ReservationInput): Promise<Reservation>
  createOrder(input: OrderInput): Promise<CommerceOrder>
}
