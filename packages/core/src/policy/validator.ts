import type { CustomerIntent, MerchantProfile, Offer, Product } from '../schemas'
import { hardFilter } from '../scoring/filter'

export interface ValidationIssue {
  code: string
  detail: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

/**
 * The merchant policy envelope, enforced deterministically.
 *
 * A merchant agent (LLM-assisted or not) proposes an offer; nothing is sealed
 * until it passes here. This is the boundary that keeps model output from
 * becoming commercial or factual truth.
 */
export function validateOffer(args: {
  offer: Offer
  product: Product | null
  profile: MerchantProfile
  intent: CustomerIntent | null
  liveStock: number
}): ValidationResult {
  const { offer, product, profile, intent, liveStock } = args
  const issues: ValidationIssue[] = []

  if (!product) {
    return { valid: false, issues: [{ code: 'PRODUCT_NOT_FOUND', detail: `sku ${offer.sku} not found` }] }
  }

  // 1. The product must belong to this merchant.
  if (product.merchantId !== offer.merchantId) {
    issues.push({
      code: 'PRODUCT_NOT_OWNED_BY_MERCHANT',
      detail: `${offer.sku} belongs to ${product.merchantId}, not ${offer.merchantId}`,
    })
  }

  // 2. Stock.
  if (liveStock <= 0) {
    issues.push({ code: 'OUT_OF_STOCK', detail: `${offer.sku} has no available inventory` })
  }
  if (offer.availability === 'in_stock' && liveStock <= 0) {
    issues.push({ code: 'AVAILABILITY_MISSTATED', detail: 'offer claims in_stock with zero inventory' })
  }

  // 3. Factual integrity — the merchant may not restate the catalogue.
  const s = offer.product.specs
  if (s.cpu !== product.specs.cpu || s.gpu !== product.specs.gpu || s.ramGb !== product.specs.ramGb) {
    issues.push({ code: 'SPEC_MISREPRESENTATION', detail: 'offer specs differ from catalogue record' })
  }
  if (offer.product.listPrice !== product.price) {
    issues.push({ code: 'LIST_PRICE_MISREPRESENTATION', detail: 'offer list price differs from catalogue' })
  }
  if (offer.product.condition !== product.condition) {
    issues.push({ code: 'CONDITION_MISREPRESENTATION', detail: 'offer condition differs from catalogue' })
  }

  // 4. Price and discount envelope.
  if (!Number.isFinite(offer.price) || offer.price <= 0) {
    issues.push({ code: 'INVALID_PRICE', detail: `price ${offer.price} is not a positive number` })
  }
  if (offer.price > product.price + 0.001) {
    issues.push({ code: 'PRICE_ABOVE_LIST', detail: 'offer price exceeds catalogue list price' })
  }
  const actualDiscountPct = ((product.price - offer.price) / product.price) * 100
  if (actualDiscountPct > profile.maxDiscountPct + 0.01) {
    issues.push({
      code: 'DISCOUNT_EXCEEDS_POLICY',
      detail: `discount ${actualDiscountPct.toFixed(2)}% exceeds max ${profile.maxDiscountPct}%`,
    })
  }

  // 5. Margin floor, including the cost of any bundled goods.
  const bundleCost = offer.bundle ? offer.bundle.value : 0
  const effectiveMarginPct = ((offer.price - product.costPrice - bundleCost) / offer.price) * 100
  if (effectiveMarginPct < profile.minMarginPct - 0.01) {
    issues.push({
      code: 'MARGIN_BELOW_FLOOR',
      detail: `effective margin ${effectiveMarginPct.toFixed(2)}% below floor ${profile.minMarginPct}%`,
    })
  }

  // 6. Bundle allowance.
  if (bundleCost > profile.bundleAllowance + 0.01) {
    issues.push({
      code: 'BUNDLE_EXCEEDS_ALLOWANCE',
      detail: `bundle value ${bundleCost} exceeds allowance ${profile.bundleAllowance}`,
    })
  }

  // 7. Warranty envelope.
  if (offer.warrantyYears > profile.maxWarrantyYears + 0.001) {
    issues.push({
      code: 'WARRANTY_EXCEEDS_POLICY',
      detail: `${offer.warrantyYears}y exceeds merchant maximum ${profile.maxWarrantyYears}y`,
    })
  }
  if (offer.warrantyYears < 0) {
    issues.push({ code: 'INVALID_WARRANTY', detail: 'negative warranty' })
  }

  // 8. Expiry must be in the future and bounded.
  const ttlMs = new Date(offer.expiresAt).getTime() - new Date(offer.createdAt).getTime()
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    issues.push({ code: 'INVALID_EXPIRY', detail: 'offer expiry is not after creation' })
  } else if (ttlMs > 60 * 60 * 1000) {
    issues.push({ code: 'EXPIRY_TOO_LONG', detail: 'offer validity exceeds 60 minutes' })
  }

  // 9. Merchant-declared sales rules that carry machine-enforceable params.
  for (const rule of profile.salesRules) {
    if (!rule.approved) continue
    if (rule.kind === 'min_spec_for_workload') {
      const p = rule.params as { workloads?: string[]; minRamGb?: number }
      const workloads = (p.workloads ?? []).map((w) => w.toLowerCase())
      const useCases = (intent?.context.useCases ?? []).map((u) => u.toLowerCase())
      const hit = workloads.some((w) => useCases.some((u) => u.includes(w) || w.includes(u)))
      if (hit && p.minRamGb !== undefined && s.ramGb < p.minRamGb) {
        issues.push({
          code: 'MERCHANT_SALES_RULE_VIOLATED',
          detail: `${rule.text} (offered ${s.ramGb} GB)`,
        })
      }
    }
    if (rule.kind === 'never_recommend') {
      const p = rule.params as { tags?: string[] }
      const banned = (p.tags ?? []).map((t) => t.toLowerCase())
      if (banned.length && offer.product.tags.some((t) => banned.includes(t.toLowerCase()))) {
        issues.push({ code: 'MERCHANT_SALES_RULE_VIOLATED', detail: rule.text })
      }
    }
  }

  // 10. Customer hard constraints — an offer that cannot be bought is not an offer.
  if (intent) {
    const f = hardFilter(offer, intent)
    for (const v of f.violations) {
      issues.push({ code: 'CUSTOMER_HARD_CONSTRAINT', detail: `${v.constraint}: ${v.detail}` })
    }
  }

  return { valid: issues.length === 0, issues }
}

/** Lowest price this merchant may quote for a product, given its policy. */
export function minimumAllowedPrice(product: Product, profile: MerchantProfile, bundleCost = 0): number {
  const discountFloor = product.price * (1 - profile.maxDiscountPct / 100)
  // price such that (price - cost - bundle)/price >= minMarginPct/100
  const marginFloor = (product.costPrice + bundleCost) / (1 - profile.minMarginPct / 100)
  return Math.max(discountFloor, marginFloor)
}
