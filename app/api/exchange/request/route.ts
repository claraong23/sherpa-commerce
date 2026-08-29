import { z } from 'zod'
import { runCustomerRequest } from '@agents/customer-agent'
import { getStore } from '@core/db'
import { emitAgentEvent } from '@core/events/bus'
import { id, nowIso } from '@core/ids'
import { toPublicProduct } from '@core/schemas'
import { bad, clientKey, faultsFrom, FaultsInput, ok, parseBody, rateLimit } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 120

const Body = z.object({
  sessionId: z.string().min(3).max(80),
  text: z.string().min(2).max(2000),
  faults: FaultsInput,
})

/**
 * Entry point for the customer flow. The orchestration lives in
 * `@agents/customer-agent`; this handler only does transport concerns.
 */
export async function POST(req: Request) {
  const limit = rateLimit(clientKey(req, 'exchange'), 20)
  if (!limit.allowed) return bad('too many offer rounds', 429, { retryAfter: limit.retryAfter })

  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  if (!(await store.getCustomerSession(data.sessionId))) {
    await store.upsertCustomerSession({
      id: data.sessionId,
      createdAt: nowIso(),
      messages: [],
      currentRequestId: null,
      counterUsed: false,
    })
    await emitAgentEvent({
      sessionId: data.sessionId,
      type: 'SESSION_STARTED',
      actor: 'system',
      payload: { sessionId: data.sessionId },
    })
  }

  const result = await runCustomerRequest({
    sessionId: data.sessionId,
    text: data.text,
    faults: faultsFrom(data.faults),
  })

  if (result.status === 'needs_clarification') {
    return ok({
      status: 'needs_clarification' as const,
      requestId: result.intent.requestId,
      question: result.question,
      intent: result.intent,
    })
  }

  // Offers exposed to the client carry no cost or margin data.
  return ok({
    status: 'ranked' as const,
    requestId: result.intent.requestId,
    intent: result.intent,
    offers: result.offers,
    ranked: result.ranked,
    rejected: result.rejected.map((r) => ({
      offerId: r.offer.offerId,
      merchantId: r.offer.merchantId,
      merchantName: r.offer.merchantName,
      product: r.offer.product.title,
      violations: r.violations,
    })),
    declines: result.declines,
    recommendation: result.recommendation,
    reranked: result.reranked,
  })
}

/** Catalogue snapshot for the visualization sidebars. */
export async function GET() {
  const store = getStore()
  const merchants = await store.listMerchants()
  const out = []
  for (const m of merchants) {
    const products = await store.listProducts(m.id)
    const profile = await store.getProfile(m.id)
    out.push({
      merchant: m,
      objective: profile?.primaryObjective ?? null,
      products: products.map(toPublicProduct),
    })
  }
  return ok({ merchants: out, requestId: id('req') })
}
