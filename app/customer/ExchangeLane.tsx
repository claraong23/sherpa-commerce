'use client'

import clsx from 'clsx'
import { Badge, StatusDot } from '@ui/primitives'
import type { Merchant } from '@core/schemas'
import type { MerchantAgentView, TrustView } from './useEventStream'

/**
 * The sealed offer exchange lane.
 *
 * A packet only appears once that merchant's MERCHANT_OFFER_SEALED event has
 * arrived — the animation is triggered by real state, not by a timer.
 */
export function ExchangeLane({
  merchants,
  views,
  requestId,
  trust,
  offersReceived,
}: {
  merchants: Merchant[]
  views: Record<string, MerchantAgentView>
  requestId: string | null
  trust: TrustView
  offersReceived: number
}) {
  return (
    <div className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="label-xs">Sealed offer exchange</span>
          {requestId && <span className="mono text-[10.5px] text-slate-500">{requestId}</span>}
        </div>
        <div className="flex items-center gap-2">
          {trust.keyId && (
            <Badge tone={trust.failures.length ? 'bad' : 'brand'}>
              <StatusDot tone={trust.failures.length ? 'fail' : 'ok'} />
              TAP-style · {trust.intent ?? 'PURCHASE'} · {trust.verifiedCount}/{trust.signedCount} verified
            </Badge>
          )}
          <Badge tone={offersReceived > 0 ? 'ok' : 'neutral'}>{offersReceived} sealed</Badge>
        </div>
      </header>

      <div className="relative px-4 py-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${merchants.length}, minmax(0, 1fr))` }}>
          {merchants.map((m) => {
            const v = views[m.id]
            const sealed = Boolean(v?.sealed)
            const failed = v?.signatureValid === false || Boolean(v?.noOffer)
            return (
              <div key={m.id} className="flex flex-col items-center gap-1.5">
                <span className="mono text-[10px] text-slate-500">{m.name}</span>
                <Lane hue={m.logoHue} active={sealed} failed={failed} />
              </div>
            )
          })}
        </div>

        <div className="mt-1 flex items-center gap-2.5">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
          <span className="label-xs whitespace-nowrap">Customer agent</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
        </div>
      </div>

      {trust.failures.length > 0 && (
        <div className="border-t border-bad-200 bg-bad-50 px-4 py-2 text-[11px] text-bad-600">
          {trust.failures.map((f) => (
            <div key={f.merchantId} className="mono">
              {f.merchantId}: {f.code} — offer construction never ran
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Lane({ hue, active, failed }: { hue: number; active: boolean; failed: boolean }) {
  return (
    <div className="relative h-11 w-full">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden>
        <line
          x1="50"
          y1="2"
          x2="50"
          y2="42"
          stroke={failed ? 'var(--color-bad-500)' : active ? `hsl(${hue} 62% 48%)` : 'var(--color-slate-300)'}
          strokeWidth="1.4"
          strokeDasharray={active ? '5 4' : '2 5'}
          className={clsx(active && !failed && 'anim-dash')}
          opacity={failed ? 0.6 : active ? 0.95 : 0.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {active && !failed && (
        <span
          className="anim-in absolute left-1/2 top-1/2 flex h-5 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded border px-1.5 text-[9px] font-semibold"
          style={{
            borderColor: `hsl(${hue} 52% 68%)`,
            background: `hsl(${hue} 70% 96%)`,
            color: `hsl(${hue} 60% 32%)`,
          }}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden>
            <rect x="0.5" y="0.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" />
            <path d="M2 4 L3.4 5.4 L6 2.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          OFFER
        </span>
      )}

      {failed && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-bad-200 bg-bad-50 px-1.5 text-[9px] font-semibold text-bad-600">
          NONE
        </span>
      )}
    </div>
  )
}
