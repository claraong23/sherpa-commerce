'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Badge, Button, Spinner } from '@ui/primitives'
import type { PublicProduct } from '@core/schemas'

interface Msg {
  id: string
  role: 'user' | 'agent'
  text: string
  products?: PublicProduct[]
  refused?: boolean
}

/**
 * Floating storefront agent. This is the same widget the Shopify Theme App
 * Extension loads — rendered inline here so the demo works without a Shopify
 * store configured.
 */
export function StorefrontChat({
  merchantId,
  merchantName,
  competitorName,
}: {
  merchantId: string
  merchantName: string
  competitorName: string
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const userMsg: Msg = { id: `u_${Date.now()}`, role: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setBusy(true)
    try {
      const res = await fetch('/api/storefront/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          merchantId,
          message: text,
          history: messages.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        }),
      })
      const data = await res.json()
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'agent',
          text: data.text ?? data.error ?? 'Sorry, I could not answer that.',
          products: data.products ?? [],
          refused: Boolean(data.refusedCrossMerchant),
        },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `e_${Date.now()}`, role: 'agent', text: `Could not reach the assistant: ${(err as Error).message}` },
      ])
    } finally {
      setBusy(false)
    }
  }

  const suggestions = [
    "I'm studying engineering and need a laptop for CAD under S$1,500.",
    `Is ${competitorName}'s Lenovo better?`,
  ]

  return (
    <>
      {open && (
        <div className="anim-in fixed bottom-20 right-5 z-50 flex h-[540px] max-h-[calc(100vh-120px)] w-[380px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl">
          <header className="flex items-start justify-between border-b border-ink-800 px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-white">{merchantName} assistant</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="text-[10.5px] text-ink-500">Scoped to this store’s catalogue</span>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="focus-ring rounded px-1 text-[17px] leading-none text-ink-500 hover:text-ink-200"
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <div ref={logRef} className="flex-1 space-y-3 overflow-auto px-4 py-4">
            {messages.length === 0 && (
              <>
                <div className="rounded-xl rounded-bl-sm border border-ink-700 bg-ink-850 px-3 py-2 text-[12.5px] leading-relaxed text-ink-100">
                  Hi — tell me what you need the laptop for and your budget, and I’ll find the closest match
                  in {merchantName}’s range.
                </div>
                <div className="space-y-1.5 pt-1">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="focus-ring w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left text-[11.5px] leading-relaxed text-ink-400 hover:border-brand-400/50 hover:text-ink-100"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            {messages.map((m) => (
              <div key={m.id} className="anim-in">
                <div className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={clsx(
                      'max-w-[90%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed',
                      m.role === 'user'
                        ? 'rounded-br-sm bg-brand-500 text-white'
                        : m.refused
                          ? 'rounded-bl-sm border border-warn-500/40 bg-warn-500/[0.08] text-warn-500'
                          : 'rounded-bl-sm border border-ink-700 bg-ink-850 text-ink-100',
                    )}
                  >
                    {m.text}
                  </div>
                </div>

                {m.refused && (
                  <div className="mt-1.5 flex justify-start">
                    <Badge tone="warn">Structural: no cross-merchant tool exists in this session</Badge>
                  </div>
                )}

                {m.products && m.products.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {m.products.slice(0, 3).map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[11.5px] font-medium text-ink-100">{p.title}</div>
                          <div className="mono truncate text-[9.5px] text-ink-500">
                            {p.specs.gpu} · {p.specs.ramGb} GB · {p.warrantyYears}y
                          </div>
                        </div>
                        <div className="mono shrink-0 text-[12px] font-semibold text-white">
                          {p.currency} {Math.round(p.price).toLocaleString('en-SG')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
                <Spinner className="text-brand-300" />
                Checking the catalogue…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
            className="border-t border-ink-800 p-3"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What do you need it for?"
                disabled={busy}
                className="focus-ring min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[12.5px] text-ink-100 placeholder:text-ink-600"
              />
              <Button type="submit" size="sm" disabled={busy || !input.trim()}>
                Send
              </Button>
            </div>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="focus-ring fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-2xl transition-colors hover:bg-brand-500"
        aria-label="Chat with the store assistant"
      >
        {open ? (
          <span className="text-[22px] leading-none">×</span>
        ) : (
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </>
  )
}
