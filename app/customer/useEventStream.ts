'use client'

import { useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '@core/schemas'

/**
 * Subscribes to the session's real agent event stream.
 *
 * The visualization renders from what this returns. No component invents a
 * state or animates on a timer — if an event did not happen on the server, it
 * does not appear on screen.
 */
export function useEventStream(sessionId: string) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const seenRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!sessionId) return
    const source = new EventSource(`/api/events/${encodeURIComponent(sessionId)}`)

    source.addEventListener('ready', () => setConnected(true))

    source.addEventListener('agent', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as AgentEvent
        if (seenRef.current.has(parsed.seq)) return
        seenRef.current.add(parsed.seq)
        setEvents((prev) => [...prev, parsed].sort((a, b) => a.seq - b.seq))
      } catch {
        /* malformed frame; ignore */
      }
    })

    source.onerror = () => setConnected(false)

    return () => {
      source.close()
      setConnected(false)
    }
  }, [sessionId])

  const reset = () => {
    seenRef.current = new Set()
    setEvents([])
  }

  return { events, connected, reset }
}

/* ─────────────  Event stream → view state (pure derivations)  ───────────── */

export interface MerchantAgentView {
  merchantId: string
  requestSigned: boolean
  signatureValid: boolean | null
  signatureFailure: string | null
  inventoryChecked: boolean
  candidatesInStock: number | null
  rulesApplied: boolean
  objective: string | null
  offerCreated: boolean
  sealed: boolean
  noOffer: boolean
  noOfferReason: string | null
  offer: {
    offerId?: string
    sku?: string
    title?: string
    price?: number
    currency?: string
    bundle?: { description: string; value: number } | null
    warrantyYears?: number
    deliveryDays?: number
    discountPct?: number
  } | null
  hash: string | null
  filterPassed: boolean | null
  filterViolations: { constraint: string; detail: string }[]
  factsVerified: boolean | null
  scorePct: number | null
  rank: number | null
  label: string | null
  countered: boolean
}

function emptyMerchantView(merchantId: string): MerchantAgentView {
  return {
    merchantId,
    requestSigned: false,
    signatureValid: null,
    signatureFailure: null,
    inventoryChecked: false,
    candidatesInStock: null,
    rulesApplied: false,
    objective: null,
    offerCreated: false,
    sealed: false,
    noOffer: false,
    noOfferReason: null,
    offer: null,
    hash: null,
    filterPassed: null,
    filterViolations: [],
    factsVerified: null,
    scorePct: null,
    rank: null,
    label: null,
    countered: false,
  }
}

export function deriveMerchantViews(
  events: AgentEvent[],
  merchantIds: string[],
): Record<string, MerchantAgentView> {
  const views: Record<string, MerchantAgentView> = {}
  for (const id of merchantIds) views[id] = emptyMerchantView(id)

  for (const e of events) {
    const mid = e.merchantId
    if (!mid) continue
    if (!views[mid]) views[mid] = emptyMerchantView(mid)
    const v = views[mid]
    const p = e.payload as Record<string, never> & Record<string, unknown>

    switch (e.eventType) {
      case 'TAP_REQUEST_SIGNED':
        v.requestSigned = true
        break
      case 'TAP_AGENT_VERIFIED':
        v.signatureValid = true
        break
      case 'AGENT_SIGNATURE_INVALID':
        v.signatureValid = false
        v.signatureFailure = String(p.code ?? 'AGENT_SIGNATURE_INVALID')
        break
      case 'MERCHANT_INVENTORY_CHECKED':
        v.inventoryChecked = true
        v.candidatesInStock = Number(p.candidatesInStock ?? 0)
        break
      case 'MERCHANT_RULES_APPLIED':
        v.rulesApplied = true
        v.objective = String(p.objective ?? '')
        break
      case 'MERCHANT_OFFER_CREATED':
        v.offerCreated = true
        v.offer = {
          sku: p.sku as string,
          title: p.title as string,
          price: p.price as number,
          currency: p.currency as string,
          bundle: (p.bundle as { description: string; value: number } | null) ?? null,
          warrantyYears: p.warrantyYears as number,
          deliveryDays: p.deliveryDays as number,
          discountPct: p.discountPct as number,
        }
        break
      case 'MERCHANT_OFFER_SEALED':
        v.sealed = true
        v.hash = String(p.hash ?? '')
        v.offer = { ...(v.offer ?? {}), offerId: p.offerId as string }
        break
      case 'MERCHANT_NO_OFFER':
        v.noOffer = true
        v.noOfferReason =
          (p.reason as string) ??
          (Array.isArray(p.issues) ? (p.issues as { code: string }[]).map((i) => i.code).join(', ') : null)
        break
      case 'OFFER_HARD_FILTERED':
        v.filterPassed = Boolean(p.passed)
        v.filterViolations = (p.violations as { constraint: string; detail: string }[]) ?? []
        break
      case 'OFFER_FACTS_VERIFIED':
        v.factsVerified = Boolean(p.verified)
        break
      case 'OFFER_SCORED':
        v.scorePct = Number(p.scorePct ?? 0)
        v.rank = Number(p.rank ?? 0)
        v.label = (p.label as string) ?? null
        break
      case 'COUNTER_OFFER_CREATED':
        v.countered = true
        v.offer = { ...(v.offer ?? {}), offerId: p.offerId as string, price: p.price as number }
        v.hash = String(p.hash ?? v.hash)
        break
      default:
        break
    }
  }
  return views
}

export type FlowPhase =
  | 'idle'
  | 'parsing'
  | 'broadcasting'
  | 'collecting'
  | 'evaluating'
  | 'recommended'
  | 'countering'
  | 'locking'
  | 'authorizing'
  | 'complete'
  | 'failed'

export function derivePhase(events: AgentEvent[]): FlowPhase {
  let phase: FlowPhase = 'idle'
  for (const e of events) {
    switch (e.eventType) {
      case 'INTENT_RECEIVED':
        phase = 'parsing'
        break
      case 'RFO_CREATED':
      case 'RFO_SENT':
        phase = 'broadcasting'
        break
      case 'MERCHANT_OFFER_SEALED':
      case 'MERCHANT_NO_OFFER':
        phase = 'collecting'
        break
      case 'ALL_OFFERS_RECEIVED':
      case 'OFFER_HARD_FILTERED':
      case 'OFFER_SCORED':
        phase = 'evaluating'
        break
      case 'RECOMMENDATION_CREATED':
        phase = 'recommended'
        break
      case 'COUNTER_REQUESTED':
        phase = 'countering'
        break
      case 'COUNTER_OFFER_CREATED':
      case 'COUNTER_DECLINED':
        phase = 'recommended'
        break
      case 'OFFER_LOCKED':
      case 'PAYMENT_INSTRUCTION_CREATED':
      case 'PASSKEY_CHALLENGE_ISSUED':
      case 'PASSKEY_CONFIRMED':
        phase = 'locking'
        break
      case 'VISA_AUTH_STARTED':
        phase = 'authorizing'
        break
      case 'ORDER_CREATED':
      case 'RECEIPT_SENT':
        phase = 'complete'
        break
      case 'OFFER_LOCK_FAILED':
      case 'PAYMENT_INSTRUCTION_DECLINED':
      case 'VISA_AUTH_DECLINED':
        phase = 'failed'
        break
      default:
        break
    }
  }
  return phase
}

export interface TrustView {
  signedCount: number
  verifiedCount: number
  failures: { merchantId: string; code: string }[]
  keyId: string | null
  intent: string | null
}

export function deriveTrust(events: AgentEvent[]): TrustView {
  const out: TrustView = { signedCount: 0, verifiedCount: 0, failures: [], keyId: null, intent: null }
  for (const e of events) {
    if (e.eventType === 'TAP_REQUEST_SIGNED') {
      out.signedCount++
      out.keyId = String((e.payload as Record<string, unknown>).keyId ?? out.keyId ?? '')
      out.intent = String((e.payload as Record<string, unknown>).agentIntent ?? out.intent ?? '')
    }
    if (e.eventType === 'TAP_AGENT_VERIFIED') out.verifiedCount++
    if (e.eventType === 'AGENT_SIGNATURE_INVALID') {
      out.failures.push({
        merchantId: e.merchantId ?? '?',
        code: String((e.payload as Record<string, unknown>).code ?? 'AGENT_SIGNATURE_INVALID'),
      })
    }
  }
  return out
}
