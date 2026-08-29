'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Button, Spinner } from '@ui/primitives'
import type { ChatMessage, SalesRule } from '@core/schemas'
import type { SandboxState } from '@agents/onboarding-agent'
import { Workspace } from './Workspace'

const DEMO_URL = 'tan-computers-demo.myshopify.com'

interface Action {
  id: string
  label: string
  kind: 'primary' | 'secondary'
}

export function OnboardScreen() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sandbox, setSandbox] = useState<SandboxState | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/onboarding/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: null }),
    })
      .then((r) => r.json())
      .then((d) => {
        setSessionId(d.sessionId)
        setMessages(d.messages)
        setSandbox(d.sandbox)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const apply = useCallback((d: { messages?: ChatMessage[]; sandbox?: SandboxState; actions?: Action[] }) => {
    if (d.messages) setMessages(d.messages)
    if (d.sandbox) setSandbox(d.sandbox)
    setActions(d.actions ?? [])
  }, [])

  const post = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      if (!sessionId) return null
      setBusy(true)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, ...body }),
        })
        const data = await res.json()
        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              role: 'agent',
              text: data.error ?? 'Something went wrong.',
              createdAt: new Date().toISOString(),
            },
          ])
          return null
        }
        apply(data)
        return data
      } finally {
        setBusy(false)
      }
    },
    [sessionId, apply],
  )

  const looksLikeUrl = (s: string) =>
    /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s.trim()) && !s.includes(' ')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')

    // A URL before connection means "detect this store", not chat.
    if (!sandbox?.connection.connected && looksLikeUrl(text)) {
      await post('/api/onboarding/connect', { action: 'detect', url: text })
      return
    }

    setMessages((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: 'user', text, createdAt: new Date().toISOString() },
    ])
    await post('/api/onboarding/chat', { message: text })
  }

  const runAction = async (id: string) => {
    if (id === 'approve_rules') await post('/api/onboarding/rules', { action: 'approve_all' })
    if (id === 'connect_visa') await post('/api/onboarding/finalize', { action: 'connect_visa' })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <header className="flex shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[12px] font-semibold text-ink-300 hover:text-white">
            ← Agentic commerce
          </Link>
          <span className="label-xs">Merchant onboarding</span>
        </div>
        {sandbox?.agent.created && (
          <Link href="/customer" className="text-[11.5px] text-brand-300 hover:text-brand-400">
            Watch this agent compete →
          </Link>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[2fr_3fr]">
        {/* ── Conversation ── */}
        <div className="flex min-h-0 flex-col border-b border-ink-800 bg-ink-900 lg:border-b-0 lg:border-r">
          <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={clsx('anim-in flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={clsx(
                    'max-w-[90%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                    m.role === 'user'
                      ? 'rounded-br-sm bg-brand-500 text-white'
                      : 'rounded-bl-sm border border-ink-700 bg-ink-850 text-ink-100',
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
                <Spinner className="text-brand-300" />
                Working…
              </div>
            )}

            {!sandbox?.connection.connected && !sandbox?.detection && messages.length > 0 && (
              <button
                onClick={() => {
                  setInput(DEMO_URL)
                }}
                className="focus-ring w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left text-[11.5px] text-ink-400 hover:border-brand-400/50 hover:text-ink-100"
              >
                Use the demo store · <span className="mono">{DEMO_URL}</span>
              </button>
            )}

            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {actions.map((a) => (
                  <Button
                    key={a.id}
                    size="sm"
                    variant={a.kind === 'primary' ? 'primary' : 'secondary'}
                    onClick={() => runAction(a.id)}
                    disabled={busy}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-ink-800 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  sandbox?.connection.connected
                    ? 'Tell me a rule, a limit, or something your best salesperson knows…'
                    : 'Paste your store URL'
                }
                disabled={busy || !sessionId}
                className="focus-ring min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 disabled:opacity-50"
              />
              <Button type="submit" disabled={busy || !input.trim()}>
                Send
              </Button>
            </div>
          </form>
        </div>

        {/* ── Workspace ── */}
        <div className="min-h-0">
          {sandbox && sessionId ? (
            <Workspace
              sandbox={sandbox}
              sessionId={sessionId}
              busy={busy}
              onConfirmPlatform={() => post('/api/onboarding/connect', { action: 'confirm' })}
              onChoosePlatform={(platform) =>
                post('/api/onboarding/connect', { action: 'override', platform })
              }
              onRuleChange={(rule: SalesRule) =>
                post('/api/onboarding/rules', { action: 'update_rule', rule })
              }
              onRuleRemove={(rule: SalesRule) =>
                post('/api/onboarding/rules', { action: 'remove_rule', rule })
              }
              onApproveRules={() => post('/api/onboarding/rules', { action: 'approve_all' })}
              onProfileChange={(profile) =>
                post('/api/onboarding/rules', { action: 'update_profile', profile })
              }
              onConnectVisa={() => post('/api/onboarding/finalize', { action: 'connect_visa' })}
              onFinalize={() => post('/api/onboarding/finalize', { action: 'finalize' })}
              onVoiceComplete={() => post('/api/onboarding/chat', {})}
              onToggleNetwork={(networkEnabled) =>
                post('/api/onboarding/finalize', { action: 'toggle_network', networkEnabled })
              }
            />
          ) : (
            <div className="grid-bg flex h-full items-center justify-center text-[12px] text-ink-600">
              <Spinner />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
