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
import { SEED_MERCHANTS, SEED_PROFILES } from '../seed/merchants'
import { SEED_PRODUCTS } from '../seed/products'
import type { DataStore } from './types'

interface Tables {
  merchants: Map<string, Merchant>
  profiles: Map<string, MerchantProfile>
  products: Map<string, Product>
  customerSessions: Map<string, CustomerSession>
  intents: Map<string, CustomerIntent>
  offers: Map<string, Offer>
  counters: Map<string, CounterRequest>
  acceptedOffers: Map<string, AcceptedOffer>
  paymentInstructions: Map<string, PaymentInstruction>
  transactions: Map<string, Transaction>
  orders: Map<string, Order>
  onboardingSessions: Map<string, OnboardingSession>
  voiceTranscripts: Map<string, VoiceTranscript>
  events: AgentEvent[]
}

function emptyTables(): Tables {
  return {
    merchants: new Map(),
    profiles: new Map(),
    products: new Map(),
    customerSessions: new Map(),
    intents: new Map(),
    offers: new Map(),
    counters: new Map(),
    acceptedOffers: new Map(),
    paymentInstructions: new Map(),
    transactions: new Map(),
    orders: new Map(),
    onboardingSessions: new Map(),
    voiceTranscripts: new Map(),
    events: [],
  }
}

const productKey = (merchantId: string, sku: string) => `${merchantId}::${sku}`
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * In-process store used whenever Supabase is not configured.
 *
 * Held on globalThis so Next.js dev HMR and route-handler module reloads share
 * one instance instead of silently forking state per compiled chunk.
 */
export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const
  private t: Tables

  constructor() {
    this.t = emptyTables()
    this.seedSync()
  }

  private seedSync() {
    for (const m of SEED_MERCHANTS) this.t.merchants.set(m.id, clone(m))
    for (const p of SEED_PROFILES) this.t.profiles.set(p.merchantId, clone(p))
    for (const p of SEED_PRODUCTS) this.t.products.set(productKey(p.merchantId, p.sku), clone(p))
  }

  async reseed() {
    this.t = emptyTables()
    this.seedSync()
    return { merchants: this.t.merchants.size, products: this.t.products.size }
  }

  async listMerchants() {
    return [...this.t.merchants.values()].map(clone)
  }
  async getMerchant(id: string) {
    const m = this.t.merchants.get(id)
    return m ? clone(m) : null
  }
  async upsertMerchant(m: Merchant) {
    this.t.merchants.set(m.id, clone(m))
    return clone(m)
  }
  async getProfile(merchantId: string) {
    const p = this.t.profiles.get(merchantId)
    return p ? clone(p) : null
  }
  async upsertProfile(p: MerchantProfile) {
    this.t.profiles.set(p.merchantId, clone(p))
    return clone(p)
  }

  async listProducts(merchantId: string) {
    return [...this.t.products.values()].filter((p) => p.merchantId === merchantId).map(clone)
  }
  async getProductBySku(merchantId: string, sku: string) {
    const p = this.t.products.get(productKey(merchantId, sku))
    return p ? clone(p) : null
  }
  async upsertProducts(products: Product[]) {
    for (const p of products) this.t.products.set(productKey(p.merchantId, p.sku), clone(p))
    return products.length
  }
  async setStock(merchantId: string, sku: string, stock: number) {
    const key = productKey(merchantId, sku)
    const p = this.t.products.get(key)
    if (p) this.t.products.set(key, { ...p, stock })
  }

  async upsertCustomerSession(s: CustomerSession) {
    this.t.customerSessions.set(s.id, clone(s))
    return clone(s)
  }
  async getCustomerSession(id: string) {
    const s = this.t.customerSessions.get(id)
    return s ? clone(s) : null
  }
  async saveIntent(i: CustomerIntent) {
    this.t.intents.set(i.requestId, clone(i))
    return clone(i)
  }
  async getIntent(requestId: string) {
    const i = this.t.intents.get(requestId)
    return i ? clone(i) : null
  }
  async saveOffers(offers: Offer[]) {
    for (const o of offers) this.t.offers.set(o.offerId, clone(o))
  }
  async updateOffer(offer: Offer) {
    this.t.offers.set(offer.offerId, clone(offer))
  }
  async listOffers(requestId: string) {
    return [...this.t.offers.values()].filter((o) => o.requestId === requestId).map(clone)
  }
  async getOffer(offerId: string) {
    const o = this.t.offers.get(offerId)
    return o ? clone(o) : null
  }
  async saveCounterRequest(c: CounterRequest) {
    this.t.counters.set(c.counterRequestId, clone(c))
  }
  async saveAcceptedOffer(a: AcceptedOffer) {
    this.t.acceptedOffers.set(a.acceptedOfferId, clone(a))
    return clone(a)
  }
  async getAcceptedOffer(id: string) {
    const a = this.t.acceptedOffers.get(id)
    return a ? clone(a) : null
  }

  async savePaymentInstruction(pi: PaymentInstruction) {
    this.t.paymentInstructions.set(pi.id, clone(pi))
    return clone(pi)
  }
  async getPaymentInstruction(id: string) {
    const pi = this.t.paymentInstructions.get(id)
    return pi ? clone(pi) : null
  }
  async updatePaymentInstruction(pi: PaymentInstruction) {
    this.t.paymentInstructions.set(pi.id, clone(pi))
  }
  async saveTransaction(t: Transaction) {
    this.t.transactions.set(t.id, clone(t))
    return clone(t)
  }
  async saveOrder(o: Order) {
    this.t.orders.set(o.id, clone(o))
    return clone(o)
  }
  async getOrder(id: string) {
    const o = this.t.orders.get(id)
    return o ? clone(o) : null
  }
  async listOrders(sessionId: string) {
    return [...this.t.orders.values()].filter((o) => o.sessionId === sessionId).map(clone)
  }

  async upsertOnboardingSession(s: OnboardingSession) {
    this.t.onboardingSessions.set(s.id, clone(s))
    return clone(s)
  }
  async getOnboardingSession(id: string) {
    const s = this.t.onboardingSessions.get(id)
    return s ? clone(s) : null
  }
  async saveVoiceTranscript(t: VoiceTranscript) {
    this.t.voiceTranscripts.set(t.id, clone(t))
    return clone(t)
  }

  async appendEvent(e: AgentEvent) {
    this.t.events.push(clone(e))
    // Bound memory in long demo sessions.
    if (this.t.events.length > 5000) this.t.events.splice(0, this.t.events.length - 4000)
  }
  async listEvents(sessionId: string, sinceSeq = 0) {
    return this.t.events.filter((e) => e.sessionId === sessionId && e.seq > sinceSeq).map(clone)
  }
}

const GLOBAL_KEY = Symbol.for('vac.memory-store')

export function memoryStore(): MemoryStore {
  const g = globalThis as unknown as Record<symbol, MemoryStore | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new MemoryStore()
  return g[GLOBAL_KEY]!
}
