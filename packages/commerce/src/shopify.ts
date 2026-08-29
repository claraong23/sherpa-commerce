import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { nowIso } from '@core/ids'
import type { LaptopSpecs, Product } from '@core/schemas'
import { assertServer } from '@core/server-guard'
import { DemoCommerceAdapter } from './demo'
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

assertServer('@commerce/shopify')

/**
 * Shopify GraphQL Admin API adapter.
 *
 * Uses the current GraphQL Admin API (products/variants/inventory and
 * `orderCreate`). No legacy REST, no ScriptTag injection — the storefront chat
 * ships as a Theme App Extension app embed block instead.
 *
 * Every method degrades to the seeded mirror rather than throwing, so a missing
 * or revoked token never takes down the demo. `configured()` reports which path
 * is actually live.
 */
export class ShopifyCommerceAdapter implements CommerceAdapter {
  readonly kind = 'shopify' as const
  private fallback: DemoCommerceAdapter

  constructor(readonly merchantId: string) {
    this.fallback = new DemoCommerceAdapter(merchantId)
  }

  static configured(): boolean {
    const env = serverEnv()
    return Boolean(env.shopifyAdminToken && env.shopifyStoreDomain)
  }

  private endpoint(): string {
    const env = serverEnv()
    return `https://${env.shopifyStoreDomain}/admin/api/${env.shopifyApiVersion}/graphql.json`
  }

  private async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const env = serverEnv()
    const res = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': env.shopifyAdminToken!,
      },
      body: JSON.stringify({ query, variables }),
    })
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (!res.ok || json.errors?.length) {
      throw new Error(`[shopify] ${res.status} ${json.errors?.map((e) => e.message).join('; ') ?? ''}`)
    }
    return json.data as T
  }

  /* ───────────────────────────  catalogue  ─────────────────────────── */

  async syncCatalog(merchantId: string): Promise<NormalizedProduct[]> {
    if (!ShopifyCommerceAdapter.configured()) return this.fallback.syncCatalog(merchantId)

    const query = `
      query SyncCatalog($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title description vendor productType tags status
            featuredImage { url }
            metafields(first: 20, namespace: "specs") { nodes { key value } }
            variants(first: 5) {
              nodes {
                id sku title price
                inventoryQuantity
                inventoryItem { id unitCost { amount } }
              }
            }
          }
        }
      }`

    type Resp = {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: {
          id: string
          title: string
          description: string
          vendor: string
          productType: string
          tags: string[]
          featuredImage: { url: string } | null
          metafields: { nodes: { key: string; value: string }[] }
          variants: {
            nodes: {
              id: string
              sku: string | null
              title: string
              price: string
              inventoryQuantity: number | null
              inventoryItem: { id: string; unitCost: { amount: string } | null } | null
            }[]
          }
        }[]
      }
    }

    const out: Product[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const data: Resp = await this.graphql<Resp>(query, { cursor })
      for (const node of data.products.nodes) {
        const meta = Object.fromEntries(node.metafields.nodes.map((m) => [m.key, m.value]))
        for (const v of node.variants.nodes) {
          const sku = v.sku || `${node.id.split('/').pop()}-${v.id.split('/').pop()}`
          const price = Number(v.price)
          const cost = v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : price * 0.86
          out.push({
            id: `shopify-${v.id.split('/').pop()}`,
            merchantId,
            sku,
            externalProductId: node.id,
            externalVariantId: v.id,
            brand: node.vendor || 'Unknown',
            model: node.title,
            title: node.title,
            description: (node.description ?? '').slice(0, 800),
            price,
            costPrice: Number(cost.toFixed(2)),
            currency: 'SGD',
            specs: specsFromMetafields(meta, node.title, node.description ?? ''),
            tags: node.tags ?? [],
            warrantyYears: Number(meta.warranty_years ?? 1),
            stock: v.inventoryQuantity ?? 0,
            condition: (node.tags ?? []).some((t) => /refurb/i.test(t)) ? 'refurbished' : 'new',
            imageUrl: node.featuredImage?.url,
            source: 'shopify',
          })
        }
      }
      if (!data.products.pageInfo.hasNextPage) break
      cursor = data.products.pageInfo.endCursor
    }

    if (out.length) await getStore().upsertProducts(out)
    return out
  }

  /* ───────────────────────────  inventory  ─────────────────────────── */

  async getInventory(merchantId: string, sku: string): Promise<InventoryState> {
    if (!ShopifyCommerceAdapter.configured()) return this.fallback.getInventory(merchantId, sku)
    try {
      type Resp = {
        productVariants: { nodes: { id: string; sku: string; inventoryQuantity: number | null }[] }
      }
      const data = await this.graphql<Resp>(
        `query Inv($q: String!) {
          productVariants(first: 1, query: $q) { nodes { id sku inventoryQuantity } }
        }`,
        { q: `sku:${sku}` },
      )
      const node = data.productVariants.nodes[0]
      if (!node) return this.fallback.getInventory(merchantId, sku)
      await getStore().setStock(merchantId, sku, node.inventoryQuantity ?? 0)
      return {
        sku,
        merchantId,
        available: node.inventoryQuantity ?? 0,
        source: 'shopify',
        checkedAt: nowIso(),
      }
    } catch (err) {
      console.warn('[shopify] inventory check failed, using mirror:', (err as Error).message)
      return this.fallback.getInventory(merchantId, sku)
    }
  }

  async createQuote(input: QuoteInput): Promise<Quote> {
    return this.fallback.createQuote(input)
  }

  async reserve(input: ReservationInput): Promise<Reservation> {
    return this.fallback.reserve(input)
  }

  /* ────────────────────────────  orders  ──────────────────────────── */

  async createOrder(input: OrderInput): Promise<CommerceOrder> {
    const env = serverEnv()
    if (!ShopifyCommerceAdapter.configured() || !env.enableShopifyOrderCreate) {
      const local = await this.fallback.createOrder(input)
      return {
        ...local,
        status: ShopifyCommerceAdapter.configured() ? 'not_configured' : local.status,
        detail: ShopifyCommerceAdapter.configured()
          ? 'ENABLE_SHOPIFY_ORDER_CREATE is off; internal order recorded instead.'
          : local.detail,
      }
    }

    const product = await getStore().getProductBySku(input.merchantId, input.sku)
    if (!product?.externalVariantId) {
      const local = await this.fallback.createOrder(input)
      return {
        ...local,
        status: 'not_configured',
        detail: `No Shopify variant id mapped for ${input.sku}; internal order recorded instead.`,
      }
    }

    try {
      type Resp = {
        orderCreate: {
          order: { id: string; name: string } | null
          userErrors: { field: string[] | null; message: string }[]
        }
      }
      const data = await this.graphql<Resp>(
        `mutation CreateOrder($order: OrderCreateOrderInput!) {
          orderCreate(order: $order) {
            order { id name }
            userErrors { field message }
          }
        }`,
        {
          order: {
            lineItems: [
              {
                variantId: product.externalVariantId,
                quantity: input.quantity,
                priceSet: {
                  shopMoney: { amount: input.amount.toFixed(2), currencyCode: input.currency },
                },
              },
            ],
            financialStatus: 'PAID',
            note: input.note ?? `Agentic commerce order ${input.reference}`,
            tags: ['agentic-commerce', 'visa-payment-instruction'],
            ...(input.customerEmail ? { email: input.customerEmail } : {}),
          },
        },
      )

      const errs = data.orderCreate.userErrors
      if (errs?.length || !data.orderCreate.order) {
        return {
          externalOrderId: null,
          status: 'failed',
          detail: `Shopify orderCreate rejected: ${errs.map((e) => e.message).join('; ')}`,
        }
      }
      return {
        externalOrderId: data.orderCreate.order.id,
        status: 'created',
        detail: `Shopify order ${data.orderCreate.order.name} created.`,
        raw: { name: data.orderCreate.order.name },
      }
    } catch (err) {
      // Payment already succeeded; a Shopify write failure must not fail the purchase.
      const local = await this.fallback.createOrder(input)
      return {
        externalOrderId: null,
        status: 'failed',
        detail: `Shopify orderCreate failed (${(err as Error).message}). Internal order recorded: ${local.detail}`,
      }
    }
  }
}

/** Shopify metafields → our normalized laptop specs, with text fallbacks. */
function specsFromMetafields(
  meta: Record<string, string>,
  title: string,
  description: string,
): LaptopSpecs {
  const text = `${title} ${description}`
  const num = (k: string, fallback: number) => {
    const v = Number(meta[k])
    return Number.isFinite(v) && v > 0 ? v : fallback
  }
  const gpu = meta.gpu ?? matchOr(text, /(rtx\s*\d{4}|radeon[^,.;]*|arc[^,.;]*|iris xe|uhd graphics)/i, 'Integrated Graphics')
  return {
    cpu: meta.cpu ?? matchOr(text, /((?:core\s*)?(?:ultra\s*)?[i][3579][- ]?\w*|ryzen\s*\d\s*\w*)/i, 'Unknown CPU'),
    gpu,
    ramGb: num('ram_gb', Number(matchOr(text, /(\d+)\s*gb\s*(?:ddr|ram|memory)/i, '16')) || 16),
    storageGb: num('storage_gb', Number(matchOr(text, /(\d+)\s*(?:gb|tb)\s*ssd/i, '512')) || 512),
    weightKg: num('weight_kg', 0) || undefined,
    batteryWh: num('battery_wh', 0) || undefined,
    generation: num('generation', 0) || undefined,
    screenSize: num('screen_size', 0) || undefined,
    os: meta.os ?? 'Windows 11',
    cuda: meta.cuda ? meta.cuda === 'true' : /(rtx|gtx|nvidia|quadro)/i.test(gpu),
    dedicatedGpu: meta.dedicated_gpu
      ? meta.dedicated_gpu === 'true'
      : /(rtx|gtx|radeon rx|arc a\d|arc b\d)/i.test(gpu),
    ramUpgradeable: meta.ram_upgradeable === 'true',
  }
}

function matchOr(text: string, re: RegExp, fallback: string): string {
  const m = text.match(re)
  return m ? m[1] ?? m[0] : fallback
}
