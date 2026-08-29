'use client'

import clsx from 'clsx'
import { Badge, Check, StatusDot } from '@ui/primitives'
import type { AgentEvent } from '@core/schemas'

export interface PaymentView {
  instructionId: string | null
  merchantName: string | null
  maxAmount: number | null
  currency: string
  expiresAt: string | null
  credentialLast4: string
  offerHash: string | null
  authenticated: boolean
  authMethod: 'webauthn' | 'simulated' | null
  checks: { control: string; passed: boolean; detail: string; code: string | null }[]
  visa: {
    mode: 'sandbox' | 'mock'
    label: string
    honesty: string
    authCode: string | null
    transactionId: string | null
    networkTokenLast4: string
    latencyMs: number
  } | null
  order: {
    id: string
    sku: string
    productTitle: string
    amount: number
    currency: string
    externalOrderId: string | null
    externalOrderStatus: string
  } | null
  failure: { code: string; message: string } | null
}

export function PaymentPanel({ view, events }: { view: PaymentView; events: AgentEvent[] }) {
  const lockEvent = events.find((e) => e.eventType === 'OFFER_LOCKED')
  const lockFailed = events.find((e) => e.eventType === 'OFFER_LOCK_FAILED')
  const authorizing = events.some((e) => e.eventType === 'VISA_AUTH_STARTED')
  const approved = events.some((e) => e.eventType === 'VISA_AUTH_APPROVED')
  const declined = events.some(
    (e) => e.eventType === 'VISA_AUTH_DECLINED' || e.eventType === 'PAYMENT_INSTRUCTION_DECLINED',
  )

  const nothingYet = !lockEvent && !lockFailed && !view.instructionId

  return (
    <div className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">Offer lock · Payment Instruction · Visa authorization</span>
        {view.visa && (
          <Badge tone={view.visa.mode === 'sandbox' ? 'ok' : 'warn'}>
            <StatusDot tone={view.visa.mode === 'sandbox' ? 'ok' : 'pending'} />
            {view.visa.label}
          </Badge>
        )}
      </header>

      {nothingYet ? (
        <div className="px-4 py-6 text-[12px] text-ink-600">
          Nothing locked yet. Choosing an offer freezes it, hashes it, and creates a Payment Instruction
          scoped to that one merchant and amount.
        </div>
      ) : (
        <div className="grid gap-px bg-ink-800 md:grid-cols-3">
          {/* Lock */}
          <div className="bg-ink-900 p-4">
            <div className="label-xs mb-2.5">1 · Offer lock</div>
            {lockFailed ? (
              <div className="space-y-1.5">
                <Check done tone="fail" label={String(lockFailed.payload.code ?? 'lock failed')} />
                <p className="text-[11px] leading-relaxed text-bad-400">
                  {String(lockFailed.payload.detail ?? '')}
                </p>
              </div>
            ) : lockEvent ? (
              <div className="space-y-1.5">
                <Check done label="Inventory re-checked" />
                <Check done label="Offer unchanged" />
                <Check done label="Canonicalised and hashed" />
                <div className="mono mt-2 truncate rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[10px] text-ink-400">
                  sha-256 {String(lockEvent.payload.hash ?? '')}…
                </div>
              </div>
            ) : (
              <div className="text-[11.5px] text-ink-600">Locking…</div>
            )}
          </div>

          {/* Payment Instruction */}
          <div className="bg-ink-900 p-4">
            <div className="label-xs mb-2.5">2 · Payment Instruction</div>
            {view.instructionId ? (
              <div className="space-y-1">
                <Row label="ID" value={view.instructionId} />
                <Row label="Merchant" value={`${view.merchantName} only`} />
                <Row
                  label="Maximum"
                  value={`${view.currency} ${view.maxAmount?.toLocaleString('en-SG') ?? '—'}`}
                />
                <Row
                  label="Expires"
                  value={
                    view.expiresAt
                      ? new Date(view.expiresAt).toLocaleTimeString('en-SG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'
                  }
                />
                <Row label="Credential" value={`Visa token •••• ${view.credentialLast4}`} />
                <div className="pt-1.5">
                  <Badge tone={view.authenticated ? 'ok' : 'neutral'}>
                    {view.authenticated
                      ? view.authMethod === 'webauthn'
                        ? 'Passkey confirmed (WebAuthn)'
                        : 'Confirmed (simulated passkey)'
                      : 'Awaiting confirmation'}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="text-[11.5px] text-ink-600">Not created yet.</div>
            )}
          </div>

          {/* Authorization */}
          <div className="bg-ink-900 p-4">
            <div className="label-xs mb-2.5">3 · Visa Acceptance</div>

            {view.checks.length > 0 && (
              <div className="mb-3 space-y-1">
                {view.checks.map((c) => (
                  <div key={c.control} className="flex items-start gap-1.5 text-[11px]">
                    <span className="mt-1">
                      <StatusDot tone={c.passed ? 'ok' : 'fail'} />
                    </span>
                    <span className={c.passed ? 'text-ink-300' : 'text-bad-400'}>{c.control}</span>
                  </div>
                ))}
              </div>
            )}

            {view.failure ? (
              <div className="rounded-md border border-bad-500/35 bg-bad-500/10 p-2.5">
                <div className="mono text-[10.5px] font-semibold text-bad-400">{view.failure.code}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-300">{view.failure.message}</p>
              </div>
            ) : approved && view.visa ? (
              <div className="space-y-1">
                <div className="mb-1.5">
                  <Badge tone="ok">APPROVED</Badge>
                </div>
                <Row label="Auth code" value={view.visa.authCode ?? '—'} />
                <Row label="Transaction" value={truncate(view.visa.transactionId ?? '—', 18)} />
                <Row label="Token" value={`•••• ${view.visa.networkTokenLast4}`} />
                <Row label="Latency" value={`${view.visa.latencyMs} ms`} />
              </div>
            ) : authorizing && !declined ? (
              <div className="flex items-center gap-2 text-[12px] text-gold-400">
                <StatusDot tone="pending" pulse />
                Authorizing…
              </div>
            ) : (
              <div className="text-[11.5px] text-ink-600">Awaiting confirmation.</div>
            )}
          </div>
        </div>
      )}

      {view.order && (
        <div className="anim-in border-t border-ok-500/25 bg-ok-500/[0.06] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-medium text-white">
                Order created · {view.order.productTitle}
              </div>
              <div className="mono mt-0.5 text-[10.5px] text-ink-400">
                {view.order.id} · {view.order.sku} · {view.order.currency}{' '}
                {view.order.amount.toLocaleString('en-SG')}
              </div>
            </div>
            <Badge tone={view.order.externalOrderStatus === 'created' ? 'ok' : 'neutral'}>
              shopifyOrderStatus: {view.order.externalOrderStatus}
            </Badge>
          </div>
        </div>
      )}

      {view.visa && (
        <div className="border-t border-ink-800 px-4 py-2 text-[10.5px] leading-relaxed text-ink-500">
          {view.visa.honesty}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-ink-500">{label}</span>
      <span className={clsx('mono truncate text-right text-ink-200')}>{value}</span>
    </div>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
