import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

/**
 * Supabase-backed store. Uses the service-role key, so this module must never
 * be imported from a client component.
 *
 * Rows are stored with a `doc` JSONB column holding the validated domain object
 * plus a few promoted columns for indexing. That keeps migrations small while
 * the schemas are still moving, and keeps the domain types authoritative.
 */
export class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const
  private db: SupabaseClient

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  private async put(table: string, row: Record<string, unknown>) {
    const { error } = await this.db.from(table).upsert(row)
    if (error) throw new Error(`[supabase:${table}] ${error.message}`)
  }

  private async one<T>(table: string, col: string, val: string): Promise<T | null> {
    const { data, error } = await this.db.from(table).select('doc').eq(col, val).limit(1).maybeSingle()
    if (error) throw new Error(`[supabase:${table}] ${error.message}`)
    return (data?.doc as T) ?? null
  }

  /**
   * Selects the `doc` column, optionally narrowed by one equality filter.
   *
   * Deliberately not a general query-builder passthrough: typing that requires
   * `any`, and every caller here filters on at most a single column.
   */
  private async many<T>(table: string, eq?: { column: string; value: string }): Promise<T[]> {
    const base = this.db.from(table).select('doc')
    const { data, error } = await (eq ? base.eq(eq.column, eq.value) : base)
    if (error) throw new Error(`[supabase:${table}] ${error.message}`)
    return ((data ?? []) as { doc: T }[]).map((r) => r.doc)
  }

  async reseed() {
    for (const m of SEED_MERCHANTS) await this.upsertMerchant(m)
    for (const p of SEED_PROFILES) await this.upsertProfile(p)
    await this.upsertProducts(SEED_PRODUCTS)
    return { merchants: SEED_MERCHANTS.length, products: SEED_PRODUCTS.length }
  }

  async listMerchants() {
    return this.many<Merchant>('merchants')
  }
  async getMerchant(id: string) {
    return this.one<Merchant>('merchants', 'id', id)
  }
  async upsertMerchant(m: Merchant) {
    await this.put('merchants', { id: m.id, slug: m.slug, name: m.name, doc: m })
    return m
  }
  async getProfile(merchantId: string) {
    return this.one<MerchantProfile>('merchant_profiles', 'merchant_id', merchantId)
  }
  async upsertProfile(p: MerchantProfile) {
    await this.put('merchant_profiles', { merchant_id: p.merchantId, doc: p })
    return p
  }

  async listProducts(merchantId: string) {
    return this.many<Product>('products', { column: 'merchant_id', value: merchantId })
  }
  async getProductBySku(merchantId: string, sku: string) {
    const { data, error } = await this.db
      .from('products')
      .select('doc')
      .eq('merchant_id', merchantId)
      .eq('sku', sku)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`[supabase:products] ${error.message}`)
    return (data?.doc as Product) ?? null
  }
  async upsertProducts(products: Product[]) {
    if (!products.length) return 0
    const rows = products.map((p) => ({
      id: p.id,
      merchant_id: p.merchantId,
      sku: p.sku,
      stock: p.stock,
      price: p.price,
      doc: p,
    }))
    const { error } = await this.db.from('products').upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`[supabase:products] ${error.message}`)
    return products.length
  }
  async setStock(merchantId: string, sku: string, stock: number) {
    const p = await this.getProductBySku(merchantId, sku)
    if (!p) return
    await this.upsertProducts([{ ...p, stock }])
  }

  async upsertCustomerSession(s: CustomerSession) {
    await this.put('customer_sessions', { id: s.id, doc: s })
    return s
  }
  async getCustomerSession(id: string) {
    return this.one<CustomerSession>('customer_sessions', 'id', id)
  }
  async saveIntent(i: CustomerIntent) {
    await this.put('customer_intents', { request_id: i.requestId, session_id: i.sessionId, doc: i })
    return i
  }
  async getIntent(requestId: string) {
    return this.one<CustomerIntent>('customer_intents', 'request_id', requestId)
  }
  async saveOffers(offers: Offer[]) {
    if (!offers.length) return
    const rows = offers.map((o) => ({
      offer_id: o.offerId,
      request_id: o.requestId,
      merchant_id: o.merchantId,
      state: o.state,
      doc: o,
    }))
    const { error } = await this.db.from('offers').upsert(rows, { onConflict: 'offer_id' })
    if (error) throw new Error(`[supabase:offers] ${error.message}`)
  }
  async updateOffer(offer: Offer) {
    await this.saveOffers([offer])
  }
  async listOffers(requestId: string) {
    return this.many<Offer>('offers', { column: 'request_id', value: requestId })
  }
  async getOffer(offerId: string) {
    return this.one<Offer>('offers', 'offer_id', offerId)
  }
  async saveCounterRequest(c: CounterRequest) {
    await this.put('counteroffers', {
      counter_request_id: c.counterRequestId,
      request_id: c.requestId,
      offer_id: c.offerId,
      doc: c,
    })
  }
  async saveAcceptedOffer(a: AcceptedOffer) {
    await this.put('accepted_offers', {
      accepted_offer_id: a.acceptedOfferId,
      offer_id: a.offerId,
      session_id: a.sessionId,
      offer_hash: a.offerHash,
      doc: a,
    })
    return a
  }
  async getAcceptedOffer(id: string) {
    return this.one<AcceptedOffer>('accepted_offers', 'accepted_offer_id', id)
  }

  async savePaymentInstruction(pi: PaymentInstruction) {
    await this.put('payment_instructions', { id: pi.id, session_id: pi.sessionId, state: pi.state, doc: pi })
    return pi
  }
  async getPaymentInstruction(id: string) {
    return this.one<PaymentInstruction>('payment_instructions', 'id', id)
  }
  async updatePaymentInstruction(pi: PaymentInstruction) {
    await this.savePaymentInstruction(pi)
  }
  async saveTransaction(t: Transaction) {
    await this.put('payment_transactions', {
      id: t.id,
      payment_instruction_id: t.paymentInstructionId,
      status: t.status,
      doc: t,
    })
    return t
  }
  async saveOrder(o: Order) {
    await this.put('orders', { id: o.id, session_id: o.sessionId, merchant_id: o.merchantId, doc: o })
    return o
  }
  async getOrder(id: string) {
    return this.one<Order>('orders', 'id', id)
  }
  async listOrders(sessionId: string) {
    return this.many<Order>('orders', { column: 'session_id', value: sessionId })
  }

  async upsertOnboardingSession(s: OnboardingSession) {
    await this.put('onboarding_sessions', { id: s.id, merchant_id: s.merchantId, doc: s })
    return s
  }
  async getOnboardingSession(id: string) {
    return this.one<OnboardingSession>('onboarding_sessions', 'id', id)
  }
  async saveVoiceTranscript(t: VoiceTranscript) {
    await this.put('voice_transcripts', {
      id: t.id,
      onboarding_session_id: t.onboardingSessionId,
      doc: t,
    })
    return t
  }

  async appendEvent(e: AgentEvent) {
    await this.put('agent_events', {
      id: e.id,
      session_id: e.sessionId,
      seq: e.seq,
      event_type: e.eventType,
      doc: e,
    })
  }
  async listEvents(sessionId: string, sinceSeq = 0) {
    const { data, error } = await this.db
      .from('agent_events')
      .select('doc')
      .eq('session_id', sessionId)
      .gt('seq', sinceSeq)
      .order('seq', { ascending: true })
    if (error) throw new Error(`[supabase:agent_events] ${error.message}`)
    return ((data ?? []) as { doc: AgentEvent }[]).map((r) => r.doc)
  }
}
