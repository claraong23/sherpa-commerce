'use client'

import clsx from 'clsx'
import { Badge, StatusDot } from '@ui/primitives'
import type { Merchant } from '@core/schemas'
import type { MerchantAgentView } from './useEventStream'

const SIZE_LABEL: Record<string, string> = { sme: 'SME · stall', mid: 'Mid-size', chain: 'Chain' }

const OBJECTIVE_LABEL: Record<string, string> = {
  margin: 'Margin',
  conversion: 'Conversion',
  inventory_turnover: 'Inventory turnover',
  aov: 'Average order value',
}

export function MerchantAgents({
  merchants,
  views,
  objectives,
  selectedOfferId,
}: {
  merchants: Merchant[]
  views: Record<string, MerchantAgentView>
  objectives: Record<string, string | null>
  selectedOfferId: string | null
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {merchants.map((m) => (
        <MerchantCard
          key={m.id}
          merchant={m}
          view={views[m.id]}
          objective={objectives[m.id] ?? null}
          selected={Boolean(selectedOfferId && views[m.id]?.offer?.offerId === selectedOfferId)}
        />
      ))}
    </div>
  )
}

function MerchantCard({
  merchant,
  view,
  objective,
  selected,
}: {
  merchant: Merchant
  view: MerchantAgentView | undefined
  objective: string | null
  selected: boolean
}) {
  const v = view
  const hue = merchant.logoHue
  const eliminated = v?.filterPassed === false
  const failedSignature = v?.signatureValid === false

  return (
    <article
      className={clsx(
        'panel relative flex flex-col overflow-hidden transition-colors duration-300',
        selected && 'border-brand-400 bg-brand-50',
        eliminated && 'opacity-60',
        failedSignature && 'border-bad-200',
      )}
    >
      <div
        className="h-[3px] w-full shrink-0"
        style={{ background: `linear-gradient(90deg, hsl(${hue} 68% 58%), hsl(${(hue + 45) % 360} 60% 50%))` }}
        aria-hidden
      />

      <header className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[14px] font-semibold text-slate-900">{merchant.name}</h3>
            {v?.rank === 1 && <Badge tone="gold">#1</Badge>}
          </div>
          <div className="mt-0.5 text-[10.5px] text-slate-500">{SIZE_LABEL[merchant.sizeType]}</div>
        </div>
        <div className="text-right">
          <div className="label-xs">Objective</div>
          <div className="text-[11px] font-medium text-slate-800">
            {objective ? (OBJECTIVE_LABEL[objective] ?? objective) : '—'}
          </div>
        </div>
      </header>

      <div className="mt-3 space-y-1 px-3.5">
        <Step
          label="Signature verified"
          state={v?.signatureValid === true ? 'ok' : v?.signatureValid === false ? 'fail' : v?.requestSigned ? 'pending' : 'idle'}
          detail={v?.signatureFailure ?? undefined}
        />
        <Step
          label="Stock checked"
          state={v?.inventoryChecked ? 'ok' : 'idle'}
          detail={v?.candidatesInStock !== null && v?.candidatesInStock !== undefined ? `${v.candidatesInStock} eligible` : undefined}
        />
        <Step label="Rules applied" state={v?.rulesApplied ? 'ok' : 'idle'} />
        <Step
          label={v?.sealed ? 'Offer sealed' : 'Offer generated'}
          state={v?.sealed ? 'ok' : v?.offerCreated ? 'pending' : v?.noOffer ? 'fail' : 'idle'}
          detail={v?.noOffer ? (v.noOfferReason ?? 'no valid offer') : undefined}
        />
      </div>

      <div className="mt-3 flex-1 border-t border-slate-200 px-3.5 py-3">
        {v?.offer?.title ? (
          <div className="anim-in">
            <div className="text-[13px] leading-snug font-medium text-slate-900">{v.offer.title}</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="mono text-[17px] font-semibold text-slate-900">
                {v.offer.currency ?? 'SGD'} {Math.round(v.offer.price ?? 0).toLocaleString('en-SG')}
              </span>
              {(v.offer.discountPct ?? 0) > 0.1 && (
                <span className="mono text-[10.5px] text-ok-600">−{v.offer.discountPct?.toFixed(1)}%</span>
              )}
              {v.countered && <Badge tone="brand">countered</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {v.offer.bundle && <Badge tone="neutral">+ {v.offer.bundle.description}</Badge>}
              <Badge tone="neutral">{v.offer.warrantyYears}y warranty</Badge>
              <Badge tone="neutral">
                {v.offer.deliveryDays === 0 ? 'same day' : `${v.offer.deliveryDays}d delivery`}
              </Badge>
            </div>
          </div>
        ) : v?.noOffer ? (
          <div className="text-[11.5px] leading-relaxed text-slate-500">
            No valid offer. {v.noOfferReason}
          </div>
        ) : (
          <div className="flex h-[76px] items-center text-[11.5px] text-slate-400">
            {v?.requestSigned ? 'Constructing offer…' : 'Awaiting request'}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/60 px-3.5 py-2">
        {v?.sealed ? (
          <span className="mono flex items-center gap-1.5 text-[10px] text-slate-600">
            <StatusDot tone="ok" />
            SEALED {v.hash && <span className="text-slate-400">{v.hash}…</span>}
          </span>
        ) : (
          <span className="mono flex items-center gap-1.5 text-[10px] text-slate-400">
            <StatusDot tone={v?.offerCreated ? 'pending' : 'idle'} pulse={v?.offerCreated && !v?.sealed} />
            {v?.offerCreated ? 'SEALING' : 'IDLE'}
          </span>
        )}

        {v?.scorePct !== null && v?.scorePct !== undefined ? (
          <span className="mono text-[11px] font-semibold text-slate-900">{v.scorePct}</span>
        ) : eliminated ? (
          <Badge tone="bad">filtered</Badge>
        ) : null}
      </footer>

      {eliminated && v?.filterViolations.length ? (
        <div className="border-t border-bad-200 bg-bad-50 px-3.5 py-2 text-[10.5px] leading-relaxed text-bad-600">
          {v.filterViolations.map((x) => x.detail).join(' · ')}
        </div>
      ) : null}
    </article>
  )
}

function Step({
  label,
  state,
  detail,
}: {
  label: string
  state: 'ok' | 'pending' | 'fail' | 'idle'
  detail?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px]">
      <span className="flex items-center gap-1.5">
        <StatusDot tone={state} pulse={state === 'pending'} />
        <span className={state === 'idle' ? 'text-slate-400' : state === 'fail' ? 'text-bad-600' : 'text-slate-800'}>
          {label}
        </span>
      </span>
      {detail && <span className="mono truncate text-[10px] text-slate-500">{detail}</span>}
    </div>
  )
}
