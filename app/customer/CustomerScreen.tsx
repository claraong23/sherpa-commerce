'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Badge, Button, Spinner, StatusDot } from '@ui/primitives'
import type { CustomerIntent, DemoFaults, Merchant, Offer, ScoredOffer } from '@core/schemas'
import { EMPTY_FAULTS } from '@core/schemas'
import { CustomerAgentPanel, EventLog } from './CustomerAgentPanel'
import { DevPanel } from './DevPanel'
import { ExchangeLane } from './ExchangeLane'
import { MerchantAgents } from './MerchantAgents'
import { PaymentPanel, type PaymentView } from './PaymentPanel'
import { deriveMerchantViews, derivePhase, deriveTrust, useEventStream } from './useEventStream'
import { registerPasskey, signWithPasskey, webauthnSupported } from './passkey'

interface ChatMsg {
  id: string
  role: 'user' | 'agent'
  text: string
  kind?: 'normal' | 'recommendation' | 'offer' | 'receipt' | 'error'
  offerId?: string
}

const PROMPTS = [
  'I need a laptop for CAD and gaming under S$1,600. I carry it around every day.',
  'I mostly code and travel. Battery and weight matter more than gaming. Keep it under S$1,500.',
  'I need CUDA for ML. Nothing refurbished. Max S$1,700.',
]

const emptyPayment: PaymentView = {
  instructionId: null,
  merchantName: null,
  maxAmount: null,
  currency: 'SGD',
  expiresAt: null,
  credentialLast4: '4821',
  offerHash: null,
  authenticated: false,
  authMethod: null,
  checks: [],
  visa: null,
  order: null,
  failure: null,
}

export function CustomerScreen({
  merchants,
  objectives,
}: {
  merchants: Merchant[]
  objectives: Record<string, string | null>
}) {
  // Generated after mount, not during render: a random id computed while
  // rendering differs between the server pass and the client pass and breaks
  // hydration. The event stream and every API call wait for it.
  const [sessionId, setSessionId] = useState('')
  useEffect(() => {
    setSessionId(`cus_${Math.random().toString(36).slice(2, 11)}`)
  }, [])

  const { events, connected, reset } = useEventStream(sessionId)

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: 'Tell me what you need in a laptop — what you will use it for and roughly what you want to spend. I will run an offer round with the merchants on the network and come back with one recommendation.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const [intent, setIntent] = useState<CustomerIntent | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [ranked, setRanked] = useState<ScoredOffer[]>([])
  const [rejected, setRejected] = useState<
    { merchantName: string; product: string; violations: { detail: string }[] }[]
  >([])
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [counterUsed, setCounterUsed] = useState(false)
  const [acceptedOfferId, setAcceptedOfferId] = useState<string | null>(null)
  const [payment, setPayment] = useState<PaymentView>(emptyPayment)
  const [faults, setFaults] = useState<DemoFaults>({ ...EMPTY_FAULTS })
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [authStep, setAuthStep] = useState<'idle' | 'passkey' | 'authorizing'>('idle')

  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const merchantIds = useMemo(() => merchants.map((m) => m.id), [merchants])
  const views = useMemo(() => deriveMerchantViews(events, merchantIds), [events, merchantIds])
  const phase = useMemo(() => derivePhase(events), [events])
  const trust = useMemo(() => deriveTrust(events), [events])
  const sealedCount = useMemo(
    () => events.filter((e) => e.eventType === 'MERCHANT_OFFER_SEALED').length,
    [events],
  )

  const say = useCallback((m: Omit<ChatMsg, 'id'>) => {
    setMessages((prev) => [...prev, { ...m, id: `m_${Math.random().toString(36).slice(2, 10)}` }])
  }, [])

  /* ─────────────────────────  Offer round  ───────────────────────── */

  const runRound = useCallback(
    async (text: string) => {
      setBusy(true)
      setOffers([])
      setRanked([])
      setRejected([])
      setSelectedOfferId(null)
      setAcceptedOfferId(null)
      setPayment(emptyPayment)
      setCounterUsed(false)
      reset()

      try {
        const res = await fetch('/api/exchange/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, text, faults }),
        })
        const data = await res.json()

        if (!res.ok) {
          say({ role: 'agent', text: data.error ?? 'Something went wrong running the offer round.', kind: 'error' })
          return
        }

        if (data.status === 'needs_clarification') {
          setIntent(data.intent)
          say({ role: 'agent', text: data.question })
          return
        }

        setIntent(data.intent)
        setRequestId(data.requestId)
        setOffers(data.offers)
        setRanked(data.ranked)
        setRejected(data.rejected)

        if (data.recommendation) {
          setSelectedOfferId(data.recommendation.offerId)
          say({ role: 'agent', text: data.recommendation.text, kind: 'recommendation' })
          say({ role: 'agent', text: '', kind: 'offer', offerId: data.recommendation.offerId })
        } else {
          const why =
            data.rejected?.length > 0
              ? `Every offer failed one of your hard requirements: ${data.rejected
                  .map((r: { violations: { detail: string }[] }) => r.violations[0]?.detail)
                  .filter(Boolean)
                  .join('; ')}.`
              : data.declines?.length
                ? `No merchant could construct a valid offer: ${data.declines.map((d: { reason: string }) => d.reason).join('; ')}.`
                : 'No merchant returned an offer for that.'
          say({ role: 'agent', text: `${why} Try relaxing the budget or a requirement.`, kind: 'error' })
        }
      } catch (err) {
        say({ role: 'agent', text: `Request failed: ${(err as Error).message}`, kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [sessionId, faults, reset, say],
  )

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy || !sessionId) return
    setInput('')
    say({ role: 'user', text })

    // A price ask against the current recommendation becomes a counteroffer.
    const wantsCounter =
      selectedOfferId &&
      !counterUsed &&
      /\b(below|under|cheaper|lower|discount|can they do|beat|match|less than)\b/i.test(text)

    if (wantsCounter) {
      await runCounter(text)
      return
    }
    await runRound(text)
  }

  /* ─────────────────────────  Counteroffer  ───────────────────────── */

  const runCounter = useCallback(
    async (text: string, explicitTarget?: number) => {
      if (!selectedOfferId) return
      setBusy(true)
      try {
        const res = await fetch('/api/exchange/counter', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            offerId: selectedOfferId,
            text,
            targetPrice: explicitTarget ?? null,
            mustRetain: [],
            flexible: ['accessories', 'bundle', 'delivery'],
          }),
        })
        const data = await res.json()

        if (!res.ok) {
          say({ role: 'agent', text: data.error ?? 'That counteroffer could not be sent.', kind: 'error' })
          return
        }

        setCounterUsed(true)
        say({ role: 'agent', text: data.merchantMessage })

        if (data.accepted && data.offer) {
          setOffers((prev) => [...prev.filter((o) => o.offerId !== selectedOfferId), data.offer])
          setRanked(data.ranked)
          setSelectedOfferId(data.offer.offerId)
          say({ role: 'agent', text: '', kind: 'offer', offerId: data.offer.offerId })
        }
      } catch (err) {
        say({ role: 'agent', text: `Counteroffer failed: ${(err as Error).message}`, kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [selectedOfferId, sessionId, say],
  )

  /* ───────────────────  Lock → instruction → passkey → authorize  ─────────────────── */

  const buy = useCallback(
    async (offerId: string) => {
      setBusy(true)
      setPayment(emptyPayment)
      try {
        // 1. Lock.
        const lockRes = await fetch(`/api/offers/${encodeURIComponent(offerId)}/lock`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, faults }),
        })
        const lock = await lockRes.json()
        if (!lockRes.ok) {
          setPayment((p) => ({ ...p, failure: { code: lock.code ?? 'LOCK_FAILED', message: lock.error } }))
          say({
            role: 'agent',
            text: `I could not lock that offer — ${lock.error}. Nothing was charged.`,
            kind: 'error',
          })
          return
        }
        setAcceptedOfferId(lock.accepted.acceptedOfferId)

        // 2. Payment Instruction.
        const piRes = await fetch('/api/payments/instruction', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, acceptedOfferId: lock.accepted.acceptedOfferId, faults }),
        })
        const pi = await piRes.json()
        if (!piRes.ok) {
          say({ role: 'agent', text: pi.error ?? 'Could not create a Payment Instruction.', kind: 'error' })
          return
        }

        setPayment({
          ...emptyPayment,
          instructionId: pi.instruction.id,
          merchantName: pi.merchantName,
          maxAmount: pi.instruction.maxAmount,
          currency: pi.instruction.currency,
          expiresAt: pi.instruction.expiresAt,
          credentialLast4: pi.instruction.credentialLast4,
          offerHash: lock.accepted.offerHash,
          visa: {
            mode: pi.visa.mode,
            label: pi.visa.label,
            honesty: pi.visa.honesty,
            authCode: null,
            transactionId: null,
            networkTokenLast4: pi.instruction.credentialLast4,
            latencyMs: 0,
          },
        })

        say({
          role: 'agent',
          text: `Locked. The Payment Instruction is scoped to ${pi.merchantName} only, capped at ${pi.instruction.currency} ${pi.instruction.maxAmount.toLocaleString('en-SG')}, and expires in 10 minutes. Confirm with your passkey to authorize.`,
        })
      } catch (err) {
        say({ role: 'agent', text: `Purchase failed: ${(err as Error).message}`, kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [sessionId, faults, say],
  )

  const confirmAndPay = useCallback(async () => {
    if (!payment.instructionId) return
    setBusy(true)
    try {
      // 3. Passkey confirmation — real WebAuthn where the browser supports it.
      // Feature detection can be optimistic (see PASSKEY_TIMEOUT_MS), so a
      // failure here is expected and falls through to the labelled simulation.
      let method: 'webauthn' | 'simulated' = 'simulated'
      if (webauthnSupported()) {
        setAuthStep('passkey')
        try {
          const reg = await fetch('/api/payments/passkey/challenge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, kind: 'register' }),
          }).then((r) => r.json())

          if (reg.enabled && !reg.hasCredential) await registerPasskey(sessionId, reg)

          const auth = await fetch('/api/payments/passkey/challenge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, kind: 'authenticate' }),
          }).then((r) => r.json())

          if (auth.enabled) {
            const assertion = await signWithPasskey(auth.challenge)
            const verify = await fetch('/api/payments/passkey/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                paymentInstructionId: payment.instructionId,
                assertion,
              }),
            })
            if (verify.ok) method = 'webauthn'
          }
        } catch {
          method = 'simulated'
        }
      }

      if (method === 'simulated') {
        await fetch('/api/payments/passkey/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, paymentInstructionId: payment.instructionId, simulated: true }),
        })
      }
      setPayment((p) => ({ ...p, authenticated: true, authMethod: method }))
      setAuthStep('authorizing')

      // 4. Authorize.
      const res = await fetch('/api/payments/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, paymentInstructionId: payment.instructionId, faults }),
      })
      const result = await res.json()

      setPayment((p) => ({
        ...p,
        checks: result.checks ?? [],
        visa: result.visa ?? p.visa,
        order: result.order
          ? {
              id: result.order.id,
              sku: result.order.sku,
              productTitle: result.order.productTitle,
              amount: result.order.amount,
              currency: result.order.currency,
              externalOrderId: result.order.externalOrderId,
              externalOrderStatus: result.order.externalOrderStatus,
            }
          : null,
        failure: result.ok ? null : { code: result.failureCode ?? 'DECLINED', message: result.message },
      }))

      if (result.ok && result.order) {
        say({
          role: 'agent',
          text: `Paid. ${result.order.productTitle} from ${payment.merchantName} for ${result.order.currency} ${result.order.amount.toLocaleString('en-SG')}. Authorization ${result.visa.authCode}, order ${result.order.id}.`,
          kind: 'receipt',
        })
      } else {
        say({ role: 'agent', text: `${result.message} (${result.failureCode})`, kind: 'error' })
      }
    } catch (err) {
      say({ role: 'agent', text: `Authorization failed: ${(err as Error).message}`, kind: 'error' })
    } finally {
      setAuthStep('idle')
      setBusy(false)
    }
  }, [payment.instructionId, payment.merchantName, sessionId, faults, say])

  /* ─────────────────────────────  Render  ───────────────────────────── */

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <TopBar phase={phase} connected={connected} sessionId={sessionId} eventCount={events.length} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[3fr_1fr]">
        {/* ── Backend / market visualization ── */}
        <div className="grid-bg min-h-0 space-y-3 overflow-auto p-4">
          <SectionLabel>Merchant agents</SectionLabel>
          <MerchantAgents
            merchants={merchants}
            views={views}
            objectives={objectives}
            selectedOfferId={selectedOfferId}
          />

          <ExchangeLane
            merchants={merchants}
            views={views}
            requestId={requestId}
            trust={trust}
            offersReceived={sealedCount}
          />

          <CustomerAgentPanel
            intent={intent}
            ranked={ranked}
            rejected={rejected}
            events={events}
            selectedOfferId={selectedOfferId}
            onSelect={setSelectedOfferId}
          />

          <PaymentPanel view={payment} events={events} />

          <EventLog events={events} />
        </div>

        {/* ── Consumer chat ── */}
        <aside className="flex min-h-0 flex-col border-t border-ink-800 bg-ink-900 lg:border-t-0 lg:border-l">
          <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-white">Your shopping agent</div>
              <div className="text-[10.5px] text-ink-500">Working for you, not the merchants</div>
            </div>
            {busy && <Spinner className="text-brand-300" />}
          </header>

          <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
            {messages.map((m) =>
              m.kind === 'offer' ? (
                <OfferCard
                  key={m.id}
                  offer={offers.find((o) => o.offerId === m.offerId) ?? null}
                  onBuy={() => m.offerId && buy(m.offerId)}
                  onCounter={() => {
                    const o = offers.find((x) => x.offerId === m.offerId)
                    if (!o) return
                    const target = Math.round(o.price * 0.94)
                    say({ role: 'user', text: `Can they get below S$${target.toLocaleString('en-SG')}?` })
                    runCounter(`Can they get below S$${target}?`, target)
                  }}
                  counterUsed={counterUsed}
                  locked={Boolean(acceptedOfferId)}
                  busy={busy}
                />
              ) : (
                <Bubble key={m.id} msg={m} />
              ),
            )}

            {payment.instructionId && !payment.order && !payment.failure && (
              <InstructionCard view={payment} onConfirm={confirmAndPay} busy={busy} step={authStep} />
            )}

            {messages.length <= 1 && (
              <div className="space-y-1.5 pt-2">
                <div className="label-xs">Try</div>
                {PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      say({ role: 'user', text: p })
                      runRound(p)
                    }}
                    disabled={busy || !sessionId}
                    className="focus-ring w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left text-[11.5px] leading-relaxed text-ink-300 transition-colors hover:border-brand-400/50 hover:text-ink-100 disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-ink-800 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={selectedOfferId ? 'Ask, counter, or change priorities…' : 'What do you need?'}
                disabled={busy || !sessionId}
                className="focus-ring min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 disabled:opacity-50"
              />
              <Button type="submit" disabled={busy || !input.trim() || !sessionId}>
                Send
              </Button>
            </div>
          </form>
        </aside>
      </div>

      <DevPanel faults={faults} onChange={setFaults} status={status} />
    </div>
  )
}

/* ────────────────────────────  Sub-views  ──────────────────────────── */

function TopBar({
  phase,
  connected,
  sessionId,
  eventCount,
}: {
  phase: string
  connected: boolean
  sessionId: string
  eventCount: number
}) {
  const PHASES: { key: string; label: string }[] = [
    { key: 'parsing', label: 'Intent' },
    { key: 'broadcasting', label: 'Offer round' },
    { key: 'evaluating', label: 'Evaluation' },
    { key: 'recommended', label: 'Recommendation' },
    { key: 'locking', label: 'Lock' },
    { key: 'authorizing', label: 'Authorization' },
    { key: 'complete', label: 'Order' },
  ]
  const idx = PHASES.findIndex((p) => p.key === phase)

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ink-800 bg-ink-900 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-[12px] font-semibold text-ink-300 hover:text-white">
          ← Agentic commerce
        </Link>
        <span className="label-xs">Live offer round</span>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto">
        {PHASES.map((p, i) => (
          <span key={p.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-ink-700">›</span>}
            <span
              className={clsx(
                'whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
                phase === 'failed' && i === idx
                  ? 'bg-bad-500/15 text-bad-400'
                  : idx >= i && idx >= 0
                    ? 'bg-brand-500/15 text-brand-300'
                    : 'text-ink-600',
              )}
            >
              {p.label}
            </span>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2.5">
        <Badge tone={connected ? 'ok' : 'neutral'}>
          <StatusDot tone={connected ? 'ok' : 'idle'} pulse={connected} />
          SSE · {eventCount}
        </Badge>
        <span className="mono hidden text-[10px] text-ink-600 sm:inline">{sessionId}</span>
      </div>
    </header>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="label-xs">{children}</span>
      <div className="h-px flex-1 bg-ink-800" />
    </div>
  )
}

function Bubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="anim-in flex justify-end">
        <div className="max-w-[88%] rounded-xl rounded-br-sm bg-brand-500 px-3 py-2 text-[12.5px] leading-relaxed text-white">
          {msg.text}
        </div>
      </div>
    )
  }
  return (
    <div className="anim-in flex justify-start">
      <div
        className={clsx(
          'max-w-[92%] rounded-xl rounded-bl-sm border px-3 py-2 text-[12.5px] leading-relaxed',
          msg.kind === 'error'
            ? 'border-bad-500/35 bg-bad-500/10 text-bad-400'
            : msg.kind === 'receipt'
              ? 'border-ok-500/35 bg-ok-500/10 text-ok-400'
              : 'border-ink-700 bg-ink-850 text-ink-100',
        )}
      >
        {msg.text}
      </div>
    </div>
  )
}

function OfferCard({
  offer,
  onBuy,
  onCounter,
  counterUsed,
  locked,
  busy,
}: {
  offer: Offer | null
  onBuy: () => void
  onCounter: () => void
  counterUsed: boolean
  locked: boolean
  busy: boolean
}) {
  if (!offer) return null
  return (
    <div className="anim-in rounded-xl border border-ink-700 bg-ink-850 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] leading-snug font-semibold text-white">{offer.product.title}</div>
          <div className="mt-0.5 text-[11px] text-ink-400">{offer.merchantName}</div>
        </div>
        <div className="mono shrink-0 text-[15px] font-semibold text-white">
          {offer.currency} {Math.round(offer.price).toLocaleString('en-SG')}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone="neutral">{offer.warrantyYears}-year warranty</Badge>
        {offer.bundle && <Badge tone="neutral">{offer.bundle.description}</Badge>}
        <Badge tone="neutral">
          {offer.deliveryDays === 0 ? 'Same-day' : `${offer.deliveryDays}-day`} delivery
        </Badge>
        <Badge tone={offer.availability === 'in_stock' ? 'ok' : 'warn'}>
          {offer.availability.replace('_', ' ')}
        </Badge>
      </div>

      {offer.tradeoffs.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {offer.tradeoffs.map((t) => (
            <li key={t} className="flex gap-1.5 text-[10.5px] leading-relaxed text-ink-500">
              <span className="text-warn-500">·</span>
              {t}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={onBuy} disabled={busy}>
            Buy
          </Button>
          <Button size="sm" variant="secondary" onClick={onCounter} disabled={busy || counterUsed}>
            {counterUsed ? 'Counter used' : 'Counter'}
          </Button>
        </div>
      )}
    </div>
  )
}

function InstructionCard({
  view,
  onConfirm,
  busy,
  step,
}: {
  view: PaymentView
  onConfirm: () => void
  busy: boolean
  step: 'idle' | 'passkey' | 'authorizing'
}) {
  return (
    <div className="anim-in rounded-xl border border-brand-400/40 bg-brand-500/[0.08] p-3">
      <div className="label-xs mb-2">Payment Instruction</div>
      <dl className="space-y-1 text-[11.5px]">
        <Pair k="Merchant" v={`${view.merchantName} only`} />
        <Pair
          k="Maximum"
          v={`${view.currency} ${view.maxAmount?.toLocaleString('en-SG') ?? '—'}`}
        />
        <Pair
          k="Expires"
          v={
            view.expiresAt
              ? new Date(view.expiresAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })
              : '—'
          }
        />
        <Pair k="Credential" v={`Visa token •••• ${view.credentialLast4}`} />
      </dl>
      <Button className="mt-3 w-full" onClick={onConfirm} disabled={busy}>
        {step === 'passkey'
          ? 'Waiting for your passkey…'
          : step === 'authorizing'
            ? 'Authorizing…'
            : 'Confirm with Passkey'}
      </Button>
      <p className="mt-1.5 text-[9.5px] leading-relaxed text-ink-500">
        Uses a browser passkey where available; otherwise an explicitly-labelled simulated confirmation.
      </p>
    </div>
  )
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-400">{k}</dt>
      <dd className="mono text-right text-ink-100">{v}</dd>
    </div>
  )
}
