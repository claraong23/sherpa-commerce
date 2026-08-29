import type {
  AcceptedOffer,
  Bundle,
  CustomerIntent,
  HardConstraints,
  LaptopSpecs,
  MerchantProfile,
  Offer,
  Preferences,
  Product,
} from '@core/schemas'
import { PreferencesSchema } from '@core/schemas'

/** Test fixtures. Deliberately explicit so a failing assertion is readable. */

const BASE_SPECS: LaptopSpecs = {
  cpu: 'AMD Ryzen 7 8845HS',
  gpu: 'NVIDIA GeForce RTX 4060 8GB',
  ramGb: 16,
  storageGb: 1000,
  weightKg: 2.1,
  batteryWh: 76,
  generation: 2026,
  screenSize: 16,
  os: 'Windows 11',
  cuda: true,
  dedicatedGpu: true,
  ramUpgradeable: true,
}

export function specs(overrides: Partial<LaptopSpecs> = {}): LaptopSpecs {
  return { ...BASE_SPECS, ...overrides }
}

export function product(
  // `specs` is omitted from the Partial<Product> half so the intersection does
  // not demand a complete LaptopSpecs object.
  overrides: Omit<Partial<Product>, 'specs'> & { specs?: Partial<LaptopSpecs> } = {},
): Product {
  const { specs: specOverrides, ...rest } = overrides
  return {
    id: 'p-test',
    merchantId: 'sherpa-computers',
    sku: 'TEST-SKU',
    brand: 'Acer',
    model: 'Test 16',
    title: 'Acer Test 16',
    description: '',
    price: 1500,
    costPrice: 1200,
    currency: 'SGD',
    specs: specs(specOverrides),
    tags: ['gaming', 'cad'],
    warrantyYears: 2,
    stock: 5,
    condition: 'new',
    source: 'seed',
    ...rest,
  }
}

export function makeOffer(
  overrides: Partial<Omit<Offer, 'product'>> & {
    specs?: Partial<LaptopSpecs>
    listPrice?: number
    condition?: 'new' | 'refurbished'
    bundle?: Bundle | null
  } = {},
): Offer {
  const { specs: specOverrides, listPrice, condition, ...rest } = overrides
  const created = new Date().toISOString()
  return {
    offerId: 'of-test',
    requestId: 'req-test',
    merchantId: 'sherpa-computers',
    merchantName: 'Sherpa Computers',
    sku: rest.sku ?? 'TEST-SKU',
    product: {
      productId: 'p-test',
      sku: rest.sku ?? 'TEST-SKU',
      brand: 'Acer',
      model: 'Test 16',
      title: 'Acer Test 16',
      listPrice: listPrice ?? 1500,
      condition: condition ?? 'new',
      specs: specs(specOverrides),
      tags: ['gaming', 'cad'],
    },
    price: 1450,
    currency: 'SGD',
    discountPct: 0,
    bundle: null,
    warrantyYears: 2,
    deliveryDays: 2,
    availability: 'in_stock',
    tradeoffs: [],
    merchantNote: '',
    merchantPolicyVerified: true,
    createdAt: created,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    state: 'sealed',
    counterOfOfferId: null,
    ...rest,
  }
}

export function intent(
  hard: HardConstraints = {},
  preferences: Partial<Preferences> = {},
): CustomerIntent {
  return {
    requestId: 'req-test',
    sessionId: 'sess-test',
    rawText: 'test request',
    category: 'laptop',
    currency: 'SGD',
    hardConstraints: hard,
    preferences: PreferencesSchema.parse({
      value: 0.25,
      cadPerformance: 0.3,
      gamingPerformance: 0.2,
      portability: 0.15,
      battery: 0.1,
      longevity: 0.15,
      warranty: 0.1,
      delivery: 0.05,
      bundleValue: 0.05,
      ...preferences,
    }),
    context: { useCases: [] },
    clarifyingQuestion: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  }
}

export function profile(overrides: Partial<MerchantProfile> = {}): MerchantProfile {
  return {
    merchantId: 'sherpa-computers',
    primaryObjective: 'conversion',
    maxDiscountPct: 10,
    minMarginPct: 5,
    bundleAllowance: 100,
    salesRules: [],
    inventoryPriorities: [],
    standardWarrantyYears: 1,
    maxWarrantyYears: 3,
    standardDeliveryDays: 2,
    approvedAt: null,
    ...overrides,
  }
}

export const TEST_ACCEPTED: AcceptedOffer = {
  acceptedOfferId: 'acc-test',
  offerId: 'of-test',
  requestId: 'req-test',
  sessionId: 'sess-test',
  canonicalOffer: '{}',
  offerHash: 'a'.repeat(64),
  merchantId: 'bizgram',
  amount: 1529,
  currency: 'SGD',
  customerConfirmed: true,
  lockedAt: new Date().toISOString(),
}
