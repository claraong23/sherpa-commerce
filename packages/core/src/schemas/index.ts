import { z } from 'zod'

/* ────────────────────────────  Primitives  ──────────────────────────── */

export const CurrencySchema = z.enum(['SGD', 'USD', 'MYR'])
export type Currency = z.infer<typeof CurrencySchema>

export const MerchantSizeSchema = z.enum(['sme', 'mid', 'chain'])
export type MerchantSize = z.infer<typeof MerchantSizeSchema>

export const MerchantObjectiveSchema = z.enum([
  'margin',
  'conversion',
  'inventory_turnover',
  'aov',
])
export type MerchantObjective = z.infer<typeof MerchantObjectiveSchema>

export const PlatformSchema = z.enum([
  'shopify',
  'woocommerce',
  'wix',
  'squarespace',
  'bigcommerce',
  'magento',
  'custom',
  'unknown',
])
export type Platform = z.infer<typeof PlatformSchema>

/* ────────────────────────────  Merchant  ──────────────────────────── */

export const MerchantSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sizeType: MerchantSizeSchema,
  category: z.string().default('laptops'),
  websiteUrl: z.string().optional(),
  platform: PlatformSchema.default('unknown'),
  commercePlatform: PlatformSchema.default('unknown'),
  currency: CurrencySchema.default('SGD'),
  agentId: z.string(),
  visaMode: z.enum(['not_connected', 'sandbox', 'simulated']).default('not_connected'),
  networkEnabled: z.boolean().default(true),
  storefrontEnabled: z.boolean().default(true),
  logoHue: z.number().int().min(0).max(360).default(210),
  createdAt: z.string(),
})
export type Merchant = z.infer<typeof MerchantSchema>

export const SalesRuleSchema = z.object({
  id: z.string(),
  kind: z
    .enum([
      'min_spec_for_workload',
      'prefer_upgrade_over_discount',
      'never_recommend',
      'prioritize_tag',
      'bundle_policy',
      'freeform',
    ])
    .default('freeform'),
  text: z.string(),
  /** Machine-enforceable payload. Freeform rules carry {} and stay advisory. */
  params: z.record(z.unknown()).default({}),
  approved: z.boolean().default(false),
  source: z.enum(['chat', 'voice', 'seed', 'manual']).default('manual'),
})
export type SalesRule = z.infer<typeof SalesRuleSchema>

export const MerchantProfileSchema = z.object({
  merchantId: z.string(),
  primaryObjective: MerchantObjectiveSchema,
  secondaryObjective: MerchantObjectiveSchema.optional(),
  maxDiscountPct: z.number().min(0).max(60).default(5),
  minMarginPct: z.number().min(0).max(90).default(8),
  bundleAllowance: z.number().min(0).default(0),
  salesRules: z.array(SalesRuleSchema).default([]),
  inventoryPriorities: z.array(z.string()).default([]),
  brandTone: z.string().optional(),
  standardWarrantyYears: z.number().min(0).max(5).default(1),
  maxWarrantyYears: z.number().min(0).max(5).default(2),
  standardDeliveryDays: z.number().min(0).max(30).default(3),
  approvedAt: z.string().nullable().default(null),
})
export type MerchantProfile = z.infer<typeof MerchantProfileSchema>

/* ────────────────────────────  Product  ──────────────────────────── */

export const LaptopSpecsSchema = z.object({
  cpu: z.string(),
  gpu: z.string(),
  ramGb: z.number().int(),
  storageGb: z.number().int(),
  weightKg: z.number().optional(),
  batteryWh: z.number().optional(),
  generation: z.number().int().optional(),
  screenSize: z.number().optional(),
  os: z.string().default('Windows 11'),
  cuda: z.boolean().default(false),
  dedicatedGpu: z.boolean().default(false),
  ramUpgradeable: z.boolean().default(false),
})
export type LaptopSpecs = z.infer<typeof LaptopSpecsSchema>

export const ProductSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  sku: z.string(),
  externalProductId: z.string().optional(),
  externalVariantId: z.string().optional(),
  brand: z.string(),
  model: z.string(),
  title: z.string(),
  description: z.string().default(''),
  price: z.number(),
  /** Server-only. Never included in an Offer or in any LLM prompt. */
  costPrice: z.number(),
  currency: CurrencySchema.default('SGD'),
  specs: LaptopSpecsSchema,
  tags: z.array(z.string()).default([]),
  warrantyYears: z.number().default(1),
  stock: z.number().int().default(0),
  condition: z.enum(['new', 'refurbished']).default('new'),
  imageUrl: z.string().optional(),
  source: z.enum(['seed', 'shopify', 'csv', 'api']).default('seed'),
})
export type Product = z.infer<typeof ProductSchema>

/** Product as exposed to customer-side agents and the browser: no cost data. */
export const PublicProductSchema = ProductSchema.omit({ costPrice: true })
export type PublicProduct = z.infer<typeof PublicProductSchema>

export function toPublicProduct(p: Product): PublicProduct {
  const { costPrice: _cost, ...rest } = p
  return rest
}

/* ────────────────────────────  Customer intent  ──────────────────────────── */

export const HardConstraintsSchema = z.object({
  maxPrice: z.number().optional(),
  minRamGb: z.number().optional(),
  minStorageGb: z.number().optional(),
  maxWeightKg: z.number().optional(),
  requiresDedicatedGpu: z.boolean().optional(),
  requiresCuda: z.boolean().optional(),
  excludeRefurbished: z.boolean().optional(),
  minWarrantyYears: z.number().optional(),
  maxDeliveryDays: z.number().optional(),
  requiredOs: z.string().optional(),
  brandExclusions: z.array(z.string()).optional(),
})
export type HardConstraints = z.infer<typeof HardConstraintsSchema>

export const PREFERENCE_KEYS = [
  'value',
  'cadPerformance',
  'gamingPerformance',
  'portability',
  'battery',
  'longevity',
  'warranty',
  'delivery',
  'bundleValue',
] as const
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number]

export const PreferencesSchema = z.object({
  value: z.number().min(0).max(1).default(0.25),
  cadPerformance: z.number().min(0).max(1).default(0),
  gamingPerformance: z.number().min(0).max(1).default(0),
  portability: z.number().min(0).max(1).default(0.1),
  battery: z.number().min(0).max(1).default(0.05),
  longevity: z.number().min(0).max(1).default(0.15),
  warranty: z.number().min(0).max(1).default(0.1),
  delivery: z.number().min(0).max(1).default(0.05),
  bundleValue: z.number().min(0).max(1).default(0.05),
})
export type Preferences = z.infer<typeof PreferencesSchema>

export const IntentContextSchema = z.object({
  useCases: z.array(z.string()).default([]),
  targetLongevityYears: z.number().optional(),
  dailyCarry: z.boolean().optional(),
  studentContext: z.boolean().optional(),
  notes: z.string().optional(),
})
export type IntentContext = z.infer<typeof IntentContextSchema>

export const CustomerIntentSchema = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  rawText: z.string(),
  category: z.literal('laptop').default('laptop'),
  currency: CurrencySchema.default('SGD'),
  hardConstraints: HardConstraintsSchema,
  preferences: PreferencesSchema,
  context: IntentContextSchema,
  clarifyingQuestion: z.string().nullable().default(null),
  createdAt: z.string(),
  expiresAt: z.string(),
})
export type CustomerIntent = z.infer<typeof CustomerIntentSchema>

/* ────────────────────────────  Offer  ──────────────────────────── */

export const BundleSchema = z.object({
  type: z.string(),
  description: z.string(),
  value: z.number(),
})
export type Bundle = z.infer<typeof BundleSchema>

export const ProductSnapshotSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  brand: z.string(),
  model: z.string(),
  title: z.string(),
  listPrice: z.number(),
  condition: z.enum(['new', 'refurbished']),
  specs: LaptopSpecsSchema,
  tags: z.array(z.string()),
  imageUrl: z.string().optional(),
})
export type ProductSnapshot = z.infer<typeof ProductSnapshotSchema>

export const OfferStateSchema = z.enum([
  'draft',
  'sealed',
  'rejected',
  'locked',
  'expired',
  'superseded',
])
export type OfferState = z.infer<typeof OfferStateSchema>

export const OfferSchema = z.object({
  offerId: z.string(),
  requestId: z.string(),
  merchantId: z.string(),
  merchantName: z.string(),
  sku: z.string(),
  product: ProductSnapshotSchema,
  price: z.number(),
  currency: CurrencySchema,
  discountPct: z.number().default(0),
  bundle: BundleSchema.nullable().default(null),
  warrantyYears: z.number(),
  deliveryDays: z.number(),
  availability: z.enum(['in_stock', 'low_stock', 'out_of_stock']),
  tradeoffs: z.array(z.string()).default([]),
  merchantNote: z.string().default(''),
  merchantPolicyVerified: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  state: OfferStateSchema,
  hash: z.string().optional(),
  counterOfOfferId: z.string().nullable().default(null),
})
export type Offer = z.infer<typeof OfferSchema>

/* ────────────────────────────  Counteroffer  ──────────────────────────── */

export const CounterRequestSchema = z.object({
  counterRequestId: z.string(),
  requestId: z.string(),
  offerId: z.string(),
  targetPrice: z.number().nullable(),
  mustRetain: z.array(z.string()).default([]),
  flexible: z.array(z.string()).default([]),
  rawText: z.string().default(''),
  createdAt: z.string(),
})
export type CounterRequest = z.infer<typeof CounterRequestSchema>

export const CounterResultSchema = z.object({
  accepted: z.boolean(),
  offer: OfferSchema.nullable(),
  declineReason: z.string().nullable(),
  merchantMessage: z.string(),
})
export type CounterResult = z.infer<typeof CounterResultSchema>

/* ────────────────────────────  Accepted offer  ──────────────────────────── */

export const AcceptedOfferSchema = z.object({
  acceptedOfferId: z.string(),
  offerId: z.string(),
  requestId: z.string(),
  sessionId: z.string(),
  canonicalOffer: z.string(),
  offerHash: z.string(),
  merchantId: z.string(),
  amount: z.number(),
  currency: CurrencySchema,
  customerConfirmed: z.boolean(),
  lockedAt: z.string(),
})
export type AcceptedOffer = z.infer<typeof AcceptedOfferSchema>

/* ────────────────────────────  Payment  ──────────────────────────── */

export const PaymentInstructionStateSchema = z.enum([
  'created',
  'authenticated',
  'consumed',
  'declined',
  'expired',
])
export type PaymentInstructionState = z.infer<typeof PaymentInstructionStateSchema>

export const PaymentInstructionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  acceptedOfferId: z.string(),
  merchantId: z.string(),
  maxAmount: z.number(),
  currency: CurrencySchema,
  expiresAt: z.string(),
  consumerInstructionHash: z.string(),
  authenticated: z.boolean(),
  authenticationMethod: z.enum(['webauthn', 'simulated', 'none']).default('none'),
  credentialLast4: z.string().default('4821'),
  state: PaymentInstructionStateSchema,
  createdAt: z.string(),
})
export type PaymentInstruction = z.infer<typeof PaymentInstructionSchema>

export const TransactionSchema = z.object({
  id: z.string(),
  paymentInstructionId: z.string(),
  merchantId: z.string(),
  amount: z.number(),
  currency: CurrencySchema,
  status: z.enum(['approved', 'declined', 'error']),
  authorizationCode: z.string().optional(),
  networkTokenLast4: z.string().optional(),
  externalTransactionId: z.string().optional(),
  declineReason: z.string().optional(),
  processor: z.enum(['visa_acceptance_sandbox', 'simulated_visa_acceptance']),
  createdAt: z.string(),
})
export type Transaction = z.infer<typeof TransactionSchema>

export const OrderSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  merchantId: z.string(),
  acceptedOfferId: z.string(),
  transactionId: z.string(),
  sku: z.string(),
  productTitle: z.string(),
  amount: z.number(),
  currency: CurrencySchema,
  bundle: BundleSchema.nullable(),
  warrantyYears: z.number(),
  deliveryDays: z.number(),
  externalOrderId: z.string().nullable().default(null),
  externalOrderStatus: z
    .enum(['created', 'not_configured', 'failed', 'demo'])
    .default('demo'),
  createdAt: z.string(),
})
export type Order = z.infer<typeof OrderSchema>

/* ────────────────────────────  Events  ──────────────────────────── */

export const AGENT_EVENT_TYPES = [
  'SESSION_STARTED',
  'INTENT_RECEIVED',
  'INTENT_PARSED',
  'CUSTOMER_CONSTRAINTS_SET',
  'CLARIFICATION_REQUESTED',
  'TAP_REQUEST_SIGNED',
  'TAP_AGENT_VERIFIED',
  'AGENT_SIGNATURE_INVALID',
  'RFO_CREATED',
  'RFO_SENT',
  'MERCHANT_INVENTORY_CHECKED',
  'MERCHANT_RULES_APPLIED',
  'MERCHANT_OFFER_CREATED',
  'MERCHANT_OFFER_SEALED',
  'MERCHANT_NO_OFFER',
  'ALL_OFFERS_RECEIVED',
  'OFFER_HARD_FILTERED',
  'OFFER_FACTS_VERIFIED',
  'OFFER_SCORED',
  'RECOMMENDATION_CREATED',
  'COUNTER_REQUESTED',
  'COUNTER_OFFER_CREATED',
  'COUNTER_DECLINED',
  'OFFER_LOCKED',
  'OFFER_LOCK_FAILED',
  'PAYMENT_INSTRUCTION_CREATED',
  'PASSKEY_CHALLENGE_ISSUED',
  'PASSKEY_CONFIRMED',
  'PAYMENT_INSTRUCTION_CHECK',
  'PAYMENT_INSTRUCTION_DECLINED',
  'VISA_AUTH_STARTED',
  'VISA_AUTH_APPROVED',
  'VISA_AUTH_DECLINED',
  'ORDER_CREATED',
  'RECEIPT_SENT',
  'DEMO_FAULT_INJECTED',
] as const

export const AgentEventTypeSchema = z.enum(AGENT_EVENT_TYPES)
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>

export const AgentActorSchema = z.enum([
  'system',
  'customer_agent',
  'merchant_agent',
  'exchange',
  'trust',
  'visa',
  'commerce',
])
export type AgentActor = z.infer<typeof AgentActorSchema>

export const AgentEventSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  sessionId: z.string(),
  eventType: AgentEventTypeSchema,
  actor: AgentActorSchema,
  merchantId: z.string().nullable().default(null),
  label: z.string().default(''),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string(),
})
export type AgentEvent = z.infer<typeof AgentEventSchema>

/* ────────────────────────  Sessions / onboarding  ──────────────────────── */

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'agent', 'system']),
  text: z.string(),
  createdAt: z.string(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ONBOARDING_STAGES = [
  'welcome',
  'website_url',
  'platform_detected',
  'platform_confirmed',
  'connecting',
  'catalogue_imported',
  'questions',
  'voice_optional',
  'voice_active',
  'voice_summary',
  'rules_review',
  'payment_setup',
  'agent_generated',
  'live',
] as const
export const OnboardingStageSchema = z.enum(ONBOARDING_STAGES)
export type OnboardingStage = z.infer<typeof OnboardingStageSchema>

export const DetectionResultSchema = z.object({
  websitePlatform: PlatformSchema,
  commercePlatform: PlatformSchema,
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()),
  method: z.enum(['http-fingerprint', 'domain-heuristic', 'demo-fixture']),
  url: z.string(),
  fetchedAt: z.string(),
})
export type DetectionResult = z.infer<typeof DetectionResultSchema>

export const OnboardingSessionSchema = z.object({
  id: z.string(),
  merchantId: z.string().nullable(),
  stage: OnboardingStageSchema,
  websiteUrl: z.string().nullable(),
  detection: DetectionResultSchema.nullable(),
  messages: z.array(ChatMessageSchema),
  draftProfile: MerchantProfileSchema.partial().nullable(),
  askedQuestionIds: z.array(z.string()).default([]),
  productCount: z.number().default(0),
  connected: z.boolean().default(false),
  connectionMode: z.enum(['none', 'shopify', 'demo']).default('none'),
  visaConnected: z.boolean().default(false),
  transcript: z.array(z.object({ role: z.string(), text: z.string() })).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>

export const VoiceTranscriptSchema = z.object({
  id: z.string(),
  onboardingSessionId: z.string(),
  merchantId: z.string().nullable(),
  turns: z.array(z.object({ role: z.string(), text: z.string(), at: z.string() })),
  durationSeconds: z.number().default(0),
  mode: z.enum(['openai_realtime', 'recorder_fallback', 'text_simulation']),
  createdAt: z.string(),
})
export type VoiceTranscript = z.infer<typeof VoiceTranscriptSchema>

/* ────────────────────────────  Scoring  ──────────────────────────── */

export const ScoreBreakdownSchema = z.record(
  z.object({ raw: z.number(), weight: z.number(), contribution: z.number() }),
)
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>

export const ScoredOfferSchema = z.object({
  offerId: z.string(),
  merchantId: z.string(),
  merchantName: z.string(),
  score: z.number(),
  scorePct: z.number(),
  breakdown: ScoreBreakdownSchema,
  rank: z.number(),
  label: z.string().nullable(),
})
export type ScoredOffer = z.infer<typeof ScoredOfferSchema>

export const FilterResultSchema = z.object({
  offerId: z.string(),
  merchantId: z.string(),
  passed: z.boolean(),
  violations: z.array(z.object({ constraint: z.string(), detail: z.string() })),
})
export type FilterResult = z.infer<typeof FilterResultSchema>

/* ────────────────────────  Customer session  ──────────────────────── */

export const CustomerSessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  messages: z.array(ChatMessageSchema).default([]),
  currentRequestId: z.string().nullable().default(null),
  counterUsed: z.boolean().default(false),
})
export type CustomerSession = z.infer<typeof CustomerSessionSchema>

/* ──────────────────────  Demo fault injection  ────────────────────── */

export const DemoFaultsSchema = z.object({
  amountOverCap: z.boolean().default(false),
  merchantMismatch: z.boolean().default(false),
  expiredInstruction: z.boolean().default(false),
  invalidSignature: z.boolean().default(false),
  outOfStock: z.boolean().default(false),
  visaDecline: z.boolean().default(false),
})
export type DemoFaults = z.infer<typeof DemoFaultsSchema>

export const EMPTY_FAULTS: DemoFaults = {
  amountOverCap: false,
  merchantMismatch: false,
  expiredInstruction: false,
  invalidSignature: false,
  outOfStock: false,
  visaDecline: false,
}
