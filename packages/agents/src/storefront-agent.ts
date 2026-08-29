import { getAdapterForMerchant } from '@commerce/index'
import { getStore } from '@core/db'
import { id, isoIn } from '@core/ids'
import type { CustomerIntent, Product, PublicProduct } from '@core/schemas'
import { toPublicProduct } from '@core/schemas'
import { buildCustomerIntent } from './intent'
import { complete, llmAvailable, scrubForPrompt } from './llm'

/**
 * STOREFRONT AGENT — merchant-scoped by construction.
 *
 * A session is created with one merchantId. The tool objects below close over
 * that id; there is no parameter for "which merchant" and no tool that reads
 * across merchants. A prompt-injection attempt, a jailbreak, or a bug in the
 * system prompt cannot produce competitor data, because no code path exists to
 * fetch it.
 *
 * The competitor refusal is therefore a statement of fact about the tool
 * surface, not a policy the model is asked to follow.
 */

export interface StorefrontTools {
  readonly merchantId: string
  searchProducts(query: string, limit?: number): Promise<PublicProduct[]>
  compareProducts(skus: string[]): Promise<PublicProduct[]>
  checkStock(sku: string): Promise<{ sku: string; available: number; source: string }>
  createQuote(sku: string): Promise<{ quoteId: string; sku: string; total: number; currency: string; expiresAt: string } | null>
}

export function createStorefrontTools(merchantId: string): StorefrontTools {
  return {
    merchantId,

    async searchProducts(query: string, limit = 6) {
      // Scoped read: merchantId is bound at construction, not passed in.
      const all = await getStore().listProducts(merchantId)
      const terms = query
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .filter((t) => t.length > 2)
      if (!terms.length) return all.slice(0, limit).map(toPublicProduct)

      const scored = all.map((p) => {
        const hay = `${p.title} ${p.brand} ${p.model} ${p.description} ${p.tags.join(' ')} ${p.specs.cpu} ${p.specs.gpu}`.toLowerCase()
        let score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0)
        if (/light|portab|carry|travel/.test(query) && (p.specs.weightKg ?? 3) < 1.6) score += 2
        if (/gam|cad|3d|render/.test(query) && p.specs.dedicatedGpu) score += 2
        if (/cheap|budget|afford/.test(query)) score += Math.max(0, 3 - p.price / 700)
        if (p.stock <= 0) score -= 1.5
        return { p, score }
      })
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .filter((s) => s.score > 0)
        .map((s) => toPublicProduct(s.p))
    },

    async compareProducts(skus: string[]) {
      const out: Product[] = []
      for (const sku of skus.slice(0, 4)) {
        const p = await getStore().getProductBySku(merchantId, sku)
        if (p) out.push(p)
      }
      return out.map(toPublicProduct)
    },

    async checkStock(sku: string) {
      const adapter = await getAdapterForMerchant(merchantId)
      const inv = await adapter.getInventory(merchantId, sku)
      return { sku, available: inv.available, source: inv.source }
    },

    async createQuote(sku: string) {
      const product = await getStore().getProductBySku(merchantId, sku)
      if (!product || product.stock <= 0) return null
      const adapter = await getAdapterForMerchant(merchantId)
      const quote = await adapter.createQuote({
        merchantId,
        sku,
        price: product.price,
        currency: product.currency,
        bundle: null,
        warrantyYears: product.warrantyYears,
        deliveryDays: 2,
      })
      return {
        quoteId: quote.quoteId,
        sku,
        total: quote.total,
        currency: quote.currency,
        expiresAt: quote.expiresAt,
      }
    },
  }
}

export interface StorefrontReply {
  text: string
  products: PublicProduct[]
  scope: { merchantId: string; merchantName: string }
  refusedCrossMerchant: boolean
}

/**
 * Detects a question about a merchant other than this one. Used to answer
 * honestly rather than to enforce the boundary — the boundary is the tool
 * surface above.
 */
export async function detectCrossMerchantAsk(
  merchantId: string,
  text: string,
): Promise<string | null> {
  const merchants = await getStore().listMerchants()
  const lower = text.toLowerCase()
  for (const m of merchants) {
    if (m.id === merchantId) continue
    const nameTokens = m.name.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
    if (nameTokens.some((t) => lower.includes(t))) return m.name
  }
  if (/\b(competitor|other (shop|store|retailer)s?|elsewhere|cheaper somewhere)\b/i.test(text)) {
    return 'another retailer'
  }
  return null
}

export async function storefrontChat(args: {
  merchantId: string
  message: string
  history: { role: 'user' | 'agent'; text: string }[]
}): Promise<StorefrontReply> {
  const store = getStore()
  const merchant = await store.getMerchant(args.merchantId)
  if (!merchant) throw new Error(`unknown merchant ${args.merchantId}`)

  const tools = createStorefrontTools(args.merchantId)
  const scope = { merchantId: merchant.id, merchantName: merchant.name }

  const competitor = await detectCrossMerchantAsk(args.merchantId, args.message)
  if (competitor) {
    // Deliberately answered without a tool call — there is no tool that could
    // service this request.
    const inHouse = await tools.searchProducts(args.message.replace(/[^a-z0-9 ]/gi, ' '), 3)
    return {
      text:
        `I only have access to ${possessive(merchant.name)} catalogue and offers. I can compare products available here, ` +
        `but I can't access ${possessive(competitor)} inventory.` +
        (inHouse.length
          ? ` If it helps, the closest ${merchant.name} options are ${inHouse.map((p) => p.title).join(', ')}.`
          : ''),
      products: inHouse,
      scope,
      refusedCrossMerchant: true,
    }
  }

  // Interpret the shopper's message against this merchant's catalogue only.
  const intent: CustomerIntent = await buildCustomerIntent({
    sessionId: `storefront_${merchant.id}`,
    text: args.message,
  })

  let products = await tools.searchProducts(args.message, 8)
  const budget = intent.hardConstraints.maxPrice
  if (budget !== undefined) products = products.filter((p) => p.price <= budget)
  if (intent.hardConstraints.requiresCuda) products = products.filter((p) => p.specs.cuda)
  if (intent.hardConstraints.requiresDedicatedGpu) products = products.filter((p) => p.specs.dedicatedGpu)
  if (intent.hardConstraints.minRamGb !== undefined) {
    products = products.filter((p) => p.specs.ramGb >= intent.hardConstraints.minRamGb!)
  }
  if (intent.hardConstraints.excludeRefurbished) products = products.filter((p) => p.condition === 'new')
  products = products.filter((p) => p.stock > 0).slice(0, 4)

  if (!products.length) {
    // Nothing matched the search terms. Fall back to the catalogue itself, but
    // keep honouring the stated budget — suggesting a laptop over the stated
    // limit would be worse than admitting there is no match.
    const inStock = (await tools.searchProducts('', 40)).filter((p) => p.stock > 0)
    const withinBudget = budget === undefined ? inStock : inStock.filter((p) => p.price <= budget)
    const cheapestFirst = [...(withinBudget.length ? withinBudget : inStock)].sort((a, b) => a.price - b.price)
    const suggestions = cheapestFirst.slice(0, 3)
    const listed = suggestions
      .map((p) => `${p.title} at ${p.currency} ${p.price.toFixed(0)}`)
      .join(', ')

    if (budget !== undefined && !withinBudget.length) {
      return {
        text: `${merchant.name} has nothing in stock under ${intent.currency} ${budget.toFixed(0)} at the moment. The cheapest here is ${listed || 'not currently listed'}.`,
        products: suggestions,
        scope,
        refusedCrossMerchant: false,
      }
    }

    return {
      text: budget
        ? `I couldn't match that exactly, but under ${intent.currency} ${budget.toFixed(0)} ${merchant.name} has ${listed}.`
        : `I couldn't find a good match in ${merchant.name}'s catalogue for that. Tell me your budget and what you'll use it for and I'll narrow it down.`,
      products: suggestions,
      scope,
      refusedCrossMerchant: false,
    }
  }

  const facts = products.map((p) => ({
    sku: p.sku,
    title: p.title,
    price: p.price,
    currency: p.currency,
    specs: p.specs,
    warrantyYears: p.warrantyYears,
    stock: p.stock,
    condition: p.condition,
  }))

  if (llmAvailable()) {
    const text = await complete(
      [
        {
          role: 'system',
          content: [
            `You are the shopping assistant on ${merchant.name}'s own website.`,
            `You can ONLY see ${merchant.name}'s catalogue. You have no access to any other retailer's stock or prices.`,
            'Recommend from the products given, in 2-4 short sentences. Plain text only.',
            'Use only the specifications and prices in the data. Never invent a product, price or spec.',
            'If the shopper asks about a different retailer, say you only have access to this store.',
          ].join('\n'),
        },
        ...args.history.slice(-4).map((h) => ({
          role: (h.role === 'agent' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: scrubForPrompt(h.text, 600),
        })),
        {
          role: 'user',
          content: scrubForPrompt(
            `Shopper says: ${args.message}\n\nAvailable ${merchant.name} products:\n${JSON.stringify(facts)}`,
            3000,
          ),
        },
      ],
      { maxTokens: 240, temperature: 0.5 },
    )
    if (text) return { text, products, scope, refusedCrossMerchant: false }
  }

  // Deterministic response path.
  const top = products[0]
  const bits = [
    `From ${merchant.name}'s range, the ${top.title} at ${top.currency} ${top.price.toFixed(0)} is the closest fit`,
    `— ${top.specs.cpu}, ${top.specs.gpu}, ${top.specs.ramGb} GB RAM, ${top.warrantyYears}-year warranty, ${top.stock} in stock.`,
  ]
  if (products[1]) {
    bits.push(
      `If you want an alternative, the ${products[1].title} is ${products[1].currency} ${products[1].price.toFixed(0)}.`,
    )
  }
  return { text: bits.join(' '), products, scope, refusedCrossMerchant: false }
}

/** "Tan Computers" -> "Tan Computers'", "Bizgram" -> "Bizgram's". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/** Placeholder quote id generator kept alongside the tools for parity with docs. */
export function demoQuoteId() {
  return { quoteId: id('quote'), expiresAt: isoIn(900) }
}
