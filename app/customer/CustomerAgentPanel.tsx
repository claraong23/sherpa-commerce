'use client'

import clsx from 'clsx'
import { Badge, Meter, StatusDot } from '@ui/primitives'
import type { AgentEvent, CustomerIntent, ScoredOffer } from '@core/schemas'
import { EVENT_LABELS } from '@core/events/labels'

const DIM_LABEL: Record<string, string> = {
  value: 'Value',
  cadPerformance: 'CAD / 3D',
  gamingPerformance: 'Gaming',
  portability: 'Portability',
  battery: 'Battery',
  longevity: 'Longevity',
  warranty: 'Warranty',
  delivery: 'Delivery',
  bundleValue: 'Extras',
}

export function CustomerAgentPanel({
  intent,
  ranked,
  rejected,
  events,
  selectedOfferId,
  onSelect,
}: {
  intent: CustomerIntent | null
  ranked: ScoredOffer[]
  rejected: { merchantName: string; product: string; violations: { detail: string }[] }[]
  events: AgentEvent[]
  selectedOfferId: string | null
  onSelect: (offerId: string) => void
}) {
  const filtered = events.some((e) => e.eventType === 'OFFER_HARD_FILTERED')
  const verified = events.some((e) => e.eventType === 'OFFER_FACTS_VERIFIED')
  const scored = events.some((e) => e.eventType === 'OFFER_SCORED')

  const weights = intent
    ? Object.entries(intent.preferences)
        .filter(([, v]) => (v as number) > 0.02)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
    : []
  const weightTotal = weights.reduce((a, [, v]) => a + (v as number), 0) || 1

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {/* ── Left: what the customer agent is optimising ── */}
      <div className="panel flex flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
          <span className="label-xs">Customer agent</span>
          <Badge tone="brand">Optimising customer utility</Badge>
        </header>

        <div className="space-y-1 border-b border-ink-800 px-4 py-3">
          <Line label="Hard filters" done={filtered} />
          <Line label="Factual checks" done={verified} />
          <Line label="Scoring" done={scored} />
        </div>

        <div className="flex-1 px-4 py-3">
          <div className="label-xs mb-2">Weights from this conversation</div>
          {weights.length ? (
            <div className="space-y-1.5">
              {weights.map(([k, v]) => (
                <div key={k}>
                  <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
                    <span className="text-ink-300">{DIM_LABEL[k] ?? k}</span>
                    <span className="mono text-ink-500">{Math.round(((v as number) / weightTotal) * 100)}%</span>
                  </div>
                  <Meter value={(v as number) / weightTotal / 0.45} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11.5px] text-ink-600">Awaiting a request.</div>
          )}

          {intent && (
            <>
              <div className="label-xs mt-4 mb-1.5">Hard constraints</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(intent.hardConstraints).filter(([, v]) => v !== undefined).length ? (
                  Object.entries(intent.hardConstraints)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => (
                      <Badge key={k} tone="warn">
                        {constraintLabel(k, v as string | number | boolean)}
                      </Badge>
                    ))
                ) : (
                  <span className="text-[11.5px] text-ink-600">None stated.</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Right: the ranking ── */}
      <div className="panel flex flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
          <span className="label-xs">Independent ranking</span>
          <span className="mono text-[10.5px] text-ink-500">
            {ranked.length} scored · {rejected.length} eliminated
          </span>
        </header>

        <div className="flex-1 overflow-auto">
          {ranked.length === 0 && rejected.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-ink-600">
              Ranking appears once merchant agents seal their offers.
            </div>
          ) : (
            <>
              {ranked.map((s) => (
                <button
                  key={s.offerId}
                  onClick={() => onSelect(s.offerId)}
                  className={clsx(
                    'focus-ring anim-in flex w-full items-start gap-3 border-b border-ink-800 px-4 py-2.5 text-left transition-colors hover:bg-ink-850',
                    selectedOfferId === s.offerId && 'bg-brand-500/10',
                  )}
                >
                  <span
                    className={clsx(
                      'mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold',
                      s.rank === 1 ? 'bg-gold-500 text-ink-950' : 'bg-ink-800 text-ink-300',
                    )}
                  >
                    {s.rank}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-white">{s.merchantName}</span>
                      {s.label && <Badge tone={s.rank === 1 ? 'gold' : 'neutral'}>{s.label}</Badge>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-ink-500">
                      {Object.entries(s.breakdown)
                        .filter(([, v]) => v.weight > 0.04)
                        .sort((a, b) => b[1].contribution - a[1].contribution)
                        .slice(0, 4)
                        .map(([k, v]) => (
                          <span key={k} className="mono">
                            {DIM_LABEL[k] ?? k} {Math.round(v.raw * 100)}
                          </span>
                        ))}
                    </span>
                  </span>

                  <span className="mono shrink-0 text-[16px] font-semibold text-white">{s.scorePct}</span>
                </button>
              ))}

              {rejected.map((r, i) => (
                <div key={i} className="border-b border-ink-800 px-4 py-2 opacity-70">
                  <div className="flex items-center gap-1.5">
                    <StatusDot tone="fail" />
                    <span className="text-[12px] text-ink-300 line-through">{r.merchantName}</span>
                    <span className="truncate text-[11px] text-ink-600">{r.product}</span>
                  </div>
                  <div className="mt-0.5 pl-3.5 text-[10.5px] text-bad-400">
                    {r.violations.map((v) => v.detail).join(' · ')}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Line({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className={done ? 'text-ink-100' : 'text-ink-600'}>{label}</span>
      <StatusDot tone={done ? 'ok' : 'idle'} />
    </div>
  )
}

function constraintLabel(key: string, value: string | number | boolean): string {
  switch (key) {
    case 'maxPrice':
      return `≤ SGD ${Number(value).toLocaleString('en-SG')}`
    case 'minRamGb':
      return `≥ ${value} GB RAM`
    case 'minStorageGb':
      return `≥ ${value} GB SSD`
    case 'maxWeightKg':
      return `≤ ${value} kg`
    case 'requiresCuda':
      return 'CUDA required'
    case 'requiresDedicatedGpu':
      return 'Dedicated GPU'
    case 'excludeRefurbished':
      return 'New only'
    case 'minWarrantyYears':
      return `≥ ${value}y warranty`
    case 'maxDeliveryDays':
      return `≤ ${value}d delivery`
    default:
      return `${key}: ${String(value)}`
  }
}

/** Raw event log for the developer detail view. */
export function EventLog({ events }: { events: AgentEvent[] }) {
  return (
    <div className="panel flex max-h-64 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2">
        <span className="label-xs">Agent event log</span>
        <span className="mono text-[10.5px] text-ink-500">{events.length} events</span>
      </header>
      <div className="flex-1 overflow-auto px-4 py-2">
        {events.length === 0 ? (
          <div className="py-4 text-[11.5px] text-ink-600">No events yet.</div>
        ) : (
          <ol className="space-y-0.5">
            {events.map((e) => (
              <li key={e.id} className="mono flex items-baseline gap-2 text-[10.5px] leading-relaxed">
                <span className="w-7 shrink-0 text-right text-ink-700">{e.seq}</span>
                <span className={clsx('w-[124px] shrink-0 truncate', actorColor(e.actor))}>{e.eventType}</span>
                <span className="truncate text-ink-500">
                  {e.merchantId ? `${e.merchantId} · ` : ''}
                  {e.label || EVENT_LABELS[e.eventType]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function actorColor(actor: string): string {
  switch (actor) {
    case 'merchant_agent':
      return 'text-gold-400'
    case 'customer_agent':
      return 'text-brand-300'
    case 'visa':
      return 'text-ok-400'
    case 'trust':
      return 'text-ink-200'
    case 'commerce':
      return 'text-ink-300'
    default:
      return 'text-ink-500'
  }
}
