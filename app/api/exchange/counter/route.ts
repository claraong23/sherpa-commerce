import { z } from 'zod'
import { handleCounterRequest } from '@agents/merchant-agent'
import { getStore } from '@core/db'
import { emitAgentEvent } from '@core/events/bus'
import { id, nowIso } from '@core/ids'
import { extractBudget } from '@agents/intent'
import { rankOffers } from '@core/scoring/score'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  sessionId: z.string(),
  offerId: z.string(),
  targetPrice: z.number().positive().max(100000).nullable().optional(),
  text: z.string().max(600).default(''),
  mustRetain: z.array(z.string().max(40)).max(6).default([]),
  flexible: z.array(z.string().max(40)).max(6).default(['accessories', 'bundle', 'delivery']),
})

/** Exactly one counteroffer round per request. No recursive haggling. */
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  const session = await store.getCustomerSession(data.sessionId)
  if (!session) return bad('unknown session', 404)
  if (session.counterUsed) {
    return bad('a counteroffer has already been used for this request', 409, {
      code: 'COUNTER_ALREADY_USED',
    })
  }

  const original = await store.getOffer(data.offerId)
  if (!original) return bad('unknown offer', 404)
  if (original.state !== 'sealed') {
    return bad(`offer is ${original.state} and cannot be countered`, 409)
  }

  const intent = await store.getIntent(original.requestId)
  if (!intent) return bad('offer has no matching request', 404)

  const merchant = await store.getMerchant(original.merchantId)
  const profile = await store.getProfile(original.merchantId)
  if (!merchant || !profile) return bad('merchant profile unavailable', 404)

  const targetPrice = data.targetPrice ?? extractBudget(data.text) ?? null

  const counter = {
    counterRequestId: id('cnt'),
    requestId: original.requestId,
    offerId: original.offerId,
    targetPrice,
    mustRetain: data.mustRetain,
    flexible: data.flexible,
    rawText: data.text,
    createdAt: nowIso(),
  }
  await store.saveCounterRequest(counter)

  await emitAgentEvent({
    sessionId: data.sessionId,
    type: 'COUNTER_REQUESTED',
    actor: 'customer_agent',
    merchantId: original.merchantId,
    payload: { offerId: original.offerId, targetPrice, mustRetain: counter.mustRetain },
  })

  const result = await handleCounterRequest({
    ctx: { merchant, profile, intent, sessionId: data.sessionId },
    original,
    counter,
  })

  await store.upsertCustomerSession({ ...session, counterUsed: true })

  const live = (await store.listOffers(original.requestId)).filter((o) => o.state === 'sealed')
  return ok({ ...result, ranked: rankOffers(live, intent), counterUsed: true })
}
