import type { CustomerIntent, FilterResult, Offer } from '../schemas'

/**
 * Stage 1 of customer ranking: hard constraints.
 *
 * Deterministic and non-negotiable. A generous warranty never compensates for
 * a technical incompatibility, so this runs before any weighted scoring and a
 * violation removes the offer from consideration entirely.
 */
export function hardFilter(offer: Offer, intent: CustomerIntent): FilterResult {
  const hc = intent.hardConstraints
  const s = offer.product.specs
  const violations: { constraint: string; detail: string }[] = []

  if (hc.maxPrice !== undefined && offer.price > hc.maxPrice) {
    violations.push({
      constraint: 'maxPrice',
      detail: `${offer.currency} ${offer.price.toFixed(0)} exceeds budget of ${offer.currency} ${hc.maxPrice.toFixed(0)}`,
    })
  }
  if (hc.minRamGb !== undefined && s.ramGb < hc.minRamGb) {
    violations.push({ constraint: 'minRamGb', detail: `${s.ramGb} GB RAM below required ${hc.minRamGb} GB` })
  }
  if (hc.minStorageGb !== undefined && s.storageGb < hc.minStorageGb) {
    violations.push({
      constraint: 'minStorageGb',
      detail: `${s.storageGb} GB storage below required ${hc.minStorageGb} GB`,
    })
  }
  if (hc.maxWeightKg !== undefined && s.weightKg !== undefined && s.weightKg > hc.maxWeightKg) {
    violations.push({ constraint: 'maxWeightKg', detail: `${s.weightKg} kg exceeds ${hc.maxWeightKg} kg limit` })
  }
  if (hc.requiresDedicatedGpu && !s.dedicatedGpu) {
    violations.push({ constraint: 'requiresDedicatedGpu', detail: `${s.gpu} is not a dedicated GPU` })
  }
  if (hc.requiresCuda && !s.cuda) {
    violations.push({ constraint: 'requiresCuda', detail: `${s.gpu} does not support CUDA` })
  }
  if (hc.excludeRefurbished && offer.product.condition === 'refurbished') {
    violations.push({ constraint: 'excludeRefurbished', detail: 'unit is refurbished' })
  }
  if (hc.minWarrantyYears !== undefined && offer.warrantyYears < hc.minWarrantyYears) {
    violations.push({
      constraint: 'minWarrantyYears',
      detail: `${offer.warrantyYears}-year warranty below required ${hc.minWarrantyYears}`,
    })
  }
  if (hc.maxDeliveryDays !== undefined && offer.deliveryDays > hc.maxDeliveryDays) {
    violations.push({
      constraint: 'maxDeliveryDays',
      detail: `${offer.deliveryDays}-day delivery exceeds ${hc.maxDeliveryDays} days`,
    })
  }
  if (hc.requiredOs && !s.os.toLowerCase().includes(hc.requiredOs.toLowerCase())) {
    violations.push({ constraint: 'requiredOs', detail: `${s.os} is not ${hc.requiredOs}` })
  }
  if (hc.brandExclusions?.length) {
    const brand = offer.product.brand.toLowerCase()
    if (hc.brandExclusions.some((b) => brand.includes(b.toLowerCase()))) {
      violations.push({ constraint: 'brandExclusions', detail: `${offer.product.brand} is excluded` })
    }
  }
  if (offer.availability === 'out_of_stock') {
    violations.push({ constraint: 'availability', detail: 'out of stock' })
  }

  return { offerId: offer.offerId, merchantId: offer.merchantId, passed: violations.length === 0, violations }
}

/**
 * Independent factual verification of an offer against the catalogue record the
 * merchant is selling from. A merchant agent may choose which valid offer to
 * make; it may not restate the facts of that offer.
 */
export function verifyOfferFacts(
  offer: Offer,
  catalogue: {
    price: number
    specs: { cpu: string; gpu: string; ramGb: number; storageGb: number }
    condition: string
    stock: number
  } | null,
): { verified: boolean; discrepancies: string[] } {
  if (!catalogue) return { verified: false, discrepancies: ['product not found in merchant catalogue'] }
  const d: string[] = []
  const s = offer.product.specs
  if (s.cpu !== catalogue.specs.cpu) d.push(`cpu mismatch: offer "${s.cpu}" vs catalogue "${catalogue.specs.cpu}"`)
  if (s.gpu !== catalogue.specs.gpu) d.push(`gpu mismatch: offer "${s.gpu}" vs catalogue "${catalogue.specs.gpu}"`)
  if (s.ramGb !== catalogue.specs.ramGb) d.push(`ram mismatch: ${s.ramGb} vs ${catalogue.specs.ramGb}`)
  if (s.storageGb !== catalogue.specs.storageGb) d.push(`storage mismatch: ${s.storageGb} vs ${catalogue.specs.storageGb}`)
  if (offer.product.condition !== catalogue.condition) d.push('condition mismatch')
  if (offer.product.listPrice !== catalogue.price) d.push('list price mismatch')
  if (catalogue.stock <= 0 && offer.availability !== 'out_of_stock') d.push('availability overstated')
  return { verified: d.length === 0, discrepancies: d }
}
