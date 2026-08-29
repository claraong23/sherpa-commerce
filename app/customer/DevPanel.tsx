'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Badge, Button } from '@ui/primitives'
import type { DemoFaults } from '@core/schemas'

/**
 * Developer / Q&A panel. Hidden behind a keyboard shortcut and a small control
 * so it never appears in the consumer-facing flow.
 *
 * These flags cause genuine backend validation failures — they do not fake an
 * error screen. Each one is emitted as DEMO_FAULT_INJECTED so the event log
 * shows exactly what was changed.
 */

const FAULTS: { key: keyof DemoFaults; label: string; produces: string; stage: string }[] = [
  {
    key: 'amountOverCap',
    label: 'Amount over cap',
    produces: 'PAYMENT_INSTRUCTION_AMOUNT_EXCEEDED',
    stage: 'Instruction ceiling set 10% below the locked amount',
  },
  {
    key: 'merchantMismatch',
    label: 'Merchant mismatch',
    produces: 'MERCHANT_MISMATCH',
    stage: 'Authorization sent for a different merchant',
  },
  {
    key: 'expiredInstruction',
    label: 'Expired instruction',
    produces: 'PAYMENT_INSTRUCTION_EXPIRED',
    stage: 'Instruction created with a past expiry',
  },
  {
    key: 'invalidSignature',
    label: 'Invalid TAP signature',
    produces: 'AGENT_SIGNATURE_INVALID',
    stage: 'Signature byte flipped before merchant verification',
  },
  {
    key: 'outOfStock',
    label: 'Out of stock',
    produces: 'OUT_OF_STOCK',
    stage: 'Live inventory forced to zero at offer and lock time',
  },
  {
    key: 'visaDecline',
    label: 'Issuer decline',
    produces: 'VISA_AUTH_DECLINED',
    stage: 'Authorization declined by the acceptance adapter',
  },
]

export function DevPanel({
  faults,
  onChange,
  status,
}: {
  faults: DemoFaults
  onChange: (f: DemoFaults) => void
  status: Record<string, unknown> | null
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const active = FAULTS.filter((f) => faults[f.key]).length

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'focus-ring fixed bottom-3 left-3 z-40 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors',
          active > 0
            ? 'border-bad-500/50 bg-bad-500/15 text-bad-400'
            : 'border-ink-700 bg-ink-850 text-ink-500 hover:text-ink-300',
        )}
        title="Developer panel (Ctrl/Cmd + Shift + D)"
      >
        dev{active > 0 ? ` · ${active} fault${active > 1 ? 's' : ''}` : ''}
      </button>

      {open && (
        <div className="anim-in fixed bottom-12 left-3 z-40 w-[330px] rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
          <header className="flex items-center justify-between border-b border-ink-800 px-3.5 py-2.5">
            <span className="label-xs">Failure injection · Q&amp;A</span>
            <button onClick={() => setOpen(false)} className="text-[15px] leading-none text-ink-500 hover:text-ink-200">
              ×
            </button>
          </header>

          <div className="max-h-[52vh] overflow-auto p-2.5">
            <p className="mb-2.5 px-1 text-[10.5px] leading-relaxed text-ink-500">
              These trigger real server-side validation failures on the next run — not a mocked error
              screen.
            </p>

            {FAULTS.map((f) => (
              <label
                key={f.key}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-ink-850"
              >
                <input
                  type="checkbox"
                  checked={faults[f.key]}
                  onChange={(e) => onChange({ ...faults, [f.key]: e.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#ef4444]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-ink-100">{f.label}</span>
                  <span className="mono mt-0.5 block text-[9.5px] text-bad-400">{f.produces}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-ink-500">{f.stage}</span>
                </span>
              </label>
            ))}

            <div className="mt-2 flex gap-2 px-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  onChange({
                    amountOverCap: false,
                    merchantMismatch: false,
                    expiredInstruction: false,
                    invalidSignature: false,
                    outOfStock: false,
                    visaDecline: false,
                  })
                }
              >
                Clear all
              </Button>
            </div>

            {status && (
              <div className="mt-3 border-t border-ink-800 px-1 pt-2.5">
                <div className="label-xs mb-1.5">Integration status</div>
                <div className="space-y-0.5">
                  {(
                    [
                      ['database', status.database],
                      ['llm', status.llm],
                      ['shopify', status.shopify],
                      ['visa', status.visa],
                      ['webauthn', status.webauthn],
                      ['tap keys', status.tapKeys],
                    ] as [string, unknown][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between text-[10.5px]">
                      <span className="text-ink-500">{k}</span>
                      <span className="mono text-ink-300">{String(v)}</span>
                    </div>
                  ))}
                </div>
                {typeof status.tap === 'object' && status.tap !== null && (
                  <p className="mt-2 text-[9.5px] leading-relaxed text-ink-600">
                    {String((status.tap as Record<string, unknown>).note ?? '')}
                  </p>
                )}
              </div>
            )}
          </div>

          <footer className="border-t border-ink-800 px-3.5 py-2">
            <Badge tone="neutral">Ctrl/Cmd + Shift + D</Badge>
          </footer>
        </div>
      )}
    </>
  )
}
