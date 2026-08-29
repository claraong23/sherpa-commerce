import type {
  AcceptedOffer,
  AgentEvent,
  CounterRequest,
  CustomerIntent,
  CustomerSession,
  Merchant,
  MerchantProfile,
  Offer,
  OnboardingSession,
  Order,
  PaymentInstruction,
  Product,
  Transaction,
  VoiceTranscript,
} from '../schemas'

export interface DataStore {
  readonly kind: 'memory' | 'supabase'

  /* merchants */
  listMerchants(): Promise<Merchant[]>
  getMerchant(id: string): Promise<Merchant | null>
  upsertMerchant(m: Merchant): Promise<Merchant>
  getProfile(merchantId: string): Promise<MerchantProfile | null>
  upsertProfile(p: MerchantProfile): Promise<MerchantProfile>

  /* products */
  listProducts(merchantId: string): Promise<Product[]>
  getProductBySku(merchantId: string, sku: string): Promise<Product | null>
  upsertProducts(products: Product[]): Promise<number>
  setStock(merchantId: string, sku: string, stock: number): Promise<void>

  /* customer flow */
  upsertCustomerSession(s: CustomerSession): Promise<CustomerSession>
  getCustomerSession(id: string): Promise<CustomerSession | null>
  saveIntent(i: CustomerIntent): Promise<CustomerIntent>
  getIntent(requestId: string): Promise<CustomerIntent | null>
  saveOffers(offers: Offer[]): Promise<void>
  updateOffer(offer: Offer): Promise<void>
  listOffers(requestId: string): Promise<Offer[]>
  getOffer(offerId: string): Promise<Offer | null>
  saveCounterRequest(c: CounterRequest): Promise<void>
  saveAcceptedOffer(a: AcceptedOffer): Promise<AcceptedOffer>
  getAcceptedOffer(id: string): Promise<AcceptedOffer | null>

  /* payments */
  savePaymentInstruction(pi: PaymentInstruction): Promise<PaymentInstruction>
  getPaymentInstruction(id: string): Promise<PaymentInstruction | null>
  updatePaymentInstruction(pi: PaymentInstruction): Promise<void>
  saveTransaction(t: Transaction): Promise<Transaction>
  saveOrder(o: Order): Promise<Order>
  getOrder(id: string): Promise<Order | null>
  listOrders(sessionId: string): Promise<Order[]>

  /* onboarding */
  upsertOnboardingSession(s: OnboardingSession): Promise<OnboardingSession>
  getOnboardingSession(id: string): Promise<OnboardingSession | null>
  saveVoiceTranscript(t: VoiceTranscript): Promise<VoiceTranscript>

  /* events */
  appendEvent(e: AgentEvent): Promise<void>
  listEvents(sessionId: string, sinceSeq?: number): Promise<AgentEvent[]>

  /** Reload seed data. Used by `pnpm seed` and by the smoke test. */
  reseed(): Promise<{ merchants: number; products: number }>
}
