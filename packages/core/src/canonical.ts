import { createHash } from 'node:crypto'
import type { Offer } from './schemas'

/**
 * Deterministic canonical JSON: object keys sorted recursively, no whitespace.
 * Two structurally identical objects always produce byte-identical output, so
 * the SHA-256 over it is a stable content address.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue)
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue
      out[k] = sortValue(src[k])
    }
    return out
  }
  if (typeof v === 'number') {
    // Avoid -0 / float formatting drift between runs.
    return Number(v.toFixed(6)) === Math.round(v * 1e6) / 1e6 ? Number(v.toFixed(6)) : v
  }
  return v
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function sha256Base64(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('base64')
}

/**
 * The frozen commercial substance of an offer. Anything omitted here is
 * presentation and may change without breaking the lock; anything included
 * cannot change between recommendation and authorization.
 */
export interface CanonicalOfferFields {
  merchantId: string
  sku: string
  productId: string
  amount: number
  currency: string
  bundle: { type: string; value: number } | null
  warrantyYears: number
  deliveryDays: number
  expiresAt: string
}

export function canonicalOfferFields(offer: Offer): CanonicalOfferFields {
  return {
    merchantId: offer.merchantId,
    sku: offer.sku,
    productId: offer.product.productId,
    amount: Number(offer.price.toFixed(2)),
    currency: offer.currency,
    bundle: offer.bundle ? { type: offer.bundle.type, value: offer.bundle.value } : null,
    warrantyYears: offer.warrantyYears,
    deliveryDays: offer.deliveryDays,
    expiresAt: offer.expiresAt,
  }
}

export function canonicalizeOffer(offer: Offer): { canonical: string; hash: string } {
  const canonical = canonicalJson(canonicalOfferFields(offer))
  return { canonical, hash: sha256Hex(canonical) }
}

export function offerHash(offer: Offer): string {
  return canonicalizeOffer(offer).hash
}
