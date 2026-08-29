'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Badge, Button, Check, StatusDot } from '@ui/primitives'
import type { SalesRule } from '@core/schemas'
import type { SandboxState } from '@agents/onboarding-agent'
import { VoiceCall } from './VoiceCall'

/**
 * The right-hand workspace. Every state here is a projection of real backend
 * state returned with the last onboarding turn — it never runs ahead of the
 * server.
 */
export function Workspace({
  sandbox,
  sessionId,
  busy,
  onConfirmPlatform,
  onChoosePlatform,
  onRuleChange,
  onRuleRemove,
  onApproveRules,
  onProfileChange,
  onConnectVisa,
  onFinalize,
  onVoiceComplete,
  onToggleNetwork,
}: {
  sandbox: SandboxState
  sessionId: string
  busy: boolean
  onConfirmPlatform: () => void
  onChoosePlatform: (platform: string) => void
  onRuleChange: (rule: SalesRule) => void
  onRuleRemove: (rule: SalesRule) => void
  onApproveRules: () => void
  onProfileChange: (patch: Record<string, number | string>) => void
  onConnectVisa: () => void
  onFinalize: () => void
  onVoiceComplete: (turns: { role: string; text: string }[], seconds: number, mode: string) => void
  onToggleNetwork: (enabled: boolean) => void
}) {
  const [showVoice, setShowVoice] = useState(false)

  return (
    <div className="grid-bg flex h-full min-h-0 flex-col overflow-auto">
      <div className="space-y-3 p-4">
        <Checklist items={sandbox.checklist} stage={sandbox.stage} />

        {sandbox.detection && !sandbox.connection.connected && (
          <DetectionCard
            sandbox={sandbox}
            busy={busy}
            onConfirm={onConfirmPlatform}
            onChoose={onChoosePlatform}
          />
        )}

        {sandbox.connection.connected && <ConnectionCard sandbox={sandbox} />}

        {sandbox.catalogue.length > 0 && <CatalogueCard sandbox={sandbox} />}

        {(showVoice || sandbox.voice.transcript.length > 0) && (
          <VoiceCall
            sessionId={sessionId}
            transcript={sandbox.voice.transcript}
            available={sandbox.voice.available}
            onComplete={(turns, seconds, mode) => {
              onVoiceComplete(turns, seconds, mode)
              setShowVoice(false)
            }}
            onCancel={() => setShowVoice(false)}
          />
        )}

        {sandbox.connection.connected && !showVoice && sandbox.stage !== 'live' && (
          <div className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div>
              <div className="text-[12.5px] font-medium text-white">Prefer to talk?</div>
              <div className="text-[11px] text-ink-500">
                {sandbox.voice.available
                  ? 'A voice agent will ask only what is still missing.'
                  : 'OpenAI Realtime is not configured — the call falls back to browser recording.'}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setShowVoice(true)}>
              Start AI call
            </Button>
          </div>
        )}

        {(sandbox.rules.length > 0 || sandbox.profile) && (
          <RulesCard
            sandbox={sandbox}
            busy={busy}
            onRuleChange={onRuleChange}
            onRuleRemove={onRuleRemove}
            onApprove={onApproveRules}
            onProfileChange={onProfileChange}
          />
        )}

        {(sandbox.stage === 'payment_setup' || sandbox.visa.connected) && (
          <VisaCard sandbox={sandbox} busy={busy} onConnect={onConnectVisa} onFinalize={onFinalize} />
        )}

        {sandbox.agent.created && sandbox.stage === 'live' && (
          <LiveCard sandbox={sandbox} onToggleNetwork={onToggleNetwork} />
        )}

        <IntegrationFooter sandbox={sandbox} />
      </div>
    </div>
  )
}

/* ────────────────────────────  Sections  ──────────────────────────── */

function Checklist({ items, stage }: { items: SandboxState['checklist']; stage: string }) {
  return (
    <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {items.map((c) => (
          <Check key={c.label} done={c.done} label={c.label} />
        ))}
      </div>
      <Badge tone={stage === 'live' ? 'ok' : 'neutral'}>{stage.replace(/_/g, ' ')}</Badge>
    </div>
  )
}

function DetectionCard({
  sandbox,
  busy,
  onConfirm,
  onChoose,
}: {
  sandbox: SandboxState
  busy: boolean
  onConfirm: () => void
  onChoose: (p: string) => void
}) {
  const d = sandbox.detection!
  const [picking, setPicking] = useState(false)

  return (
    <section className="panel anim-in overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">Platform detection</span>
        <Badge tone={d.confidence > 0.7 ? 'ok' : 'warn'}>{Math.round(d.confidence * 100)}% confidence</Badge>
      </header>

      <div className="p-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-semibold capitalize text-white">{d.commercePlatform}</span>
          <span className="text-[11.5px] text-ink-500">
            website {d.websitePlatform} · commerce {d.commercePlatform}
          </span>
        </div>

        <div className="mono mt-3 rounded-lg border border-ink-700 bg-ink-850 p-3 text-[10.5px] leading-relaxed text-ink-400">
          <div className="mb-1.5 text-ink-500">signals · method={d.method}</div>
          {d.signals.map((s, i) => (
            <div key={i} className="flex gap-1.5">
              <span className="text-ok-500">✓</span>
              {s}
            </div>
          ))}
        </div>

        {!picking ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={onConfirm} disabled={busy}>
              Confirm {d.commercePlatform === 'shopify' ? 'Shopify' : d.commercePlatform}
            </Button>
            <Button variant="secondary" onClick={() => setPicking(true)} disabled={busy}>
              Choose another platform
            </Button>
          </div>
        ) : (
          <div className="mt-3">
            <div className="label-xs mb-2">Select your commerce platform</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {['shopify', 'woocommerce', 'wix', 'bigcommerce', 'magento', 'custom'].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    onChoose(p)
                    setPicking(false)
                  }}
                  className={clsx(
                    'focus-ring rounded-lg border px-2.5 py-2 text-left text-[11.5px] capitalize transition-colors',
                    p === 'shopify'
                      ? 'border-ok-500/40 bg-ok-500/[0.07] text-ink-100'
                      : 'border-ink-700 bg-ink-850 text-ink-400 hover:border-ink-600',
                  )}
                >
                  {p}
                  <span className="mt-0.5 block text-[9.5px] text-ink-600">
                    {p === 'shopify' ? 'No-code connector' : 'Adapter roadmap'}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
              Shopify is the implemented no-code connector in this prototype. Other platforms route to the
              developer path with generated API docs.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function ConnectionCard({ sandbox }: { sandbox: SandboxState }) {
  const c = sandbox.connection
  return (
    <section className="panel anim-in overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">Store connection</span>
        <Badge tone={c.mode === 'shopify' ? 'ok' : 'warn'}>
          <StatusDot tone={c.mode === 'shopify' ? 'ok' : 'pending'} />
          {c.mode === 'shopify' ? 'Shopify connected' : 'Demo connection'}
        </Badge>
      </header>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 text-[12px] sm:grid-cols-4">
        <Stat label="Store" value={c.storeDomain ?? '—'} />
        <Stat label="Products synced" value={String(c.productsSynced)} />
        <Stat label="Inventory sync" value={c.inventorySync} />
        <Stat label="Orders" value={c.orders} />
      </div>
      {c.mode === 'demo' && (
        <div className="border-t border-ink-800 px-4 py-2 text-[10.5px] leading-relaxed text-ink-500">
          Backed by the seeded catalogue mirror. Set SHOPIFY_ADMIN_ACCESS_TOKEN and
          SHOPIFY_DEMO_STORE_DOMAIN to pull from the live store through the GraphQL Admin API.
        </div>
      )}
    </section>
  )
}

function CatalogueCard({ sandbox }: { sandbox: SandboxState }) {
  return (
    <section className="panel anim-in overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">Catalogue preview</span>
        <span className="mono text-[10.5px] text-ink-500">
          {sandbox.connection.productsSynced} normalized records
        </span>
      </header>
      <div className="divide-y divide-ink-800">
        {sandbox.catalogue.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            {p.imageUrl && (
              <Image
                src={p.imageUrl}
                alt=""
                width={56}
                height={35}
                className="h-[35px] w-[56px] shrink-0 rounded border border-ink-700 object-cover"
                unoptimized
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-ink-100">{p.title}</div>
              <div className="mono mt-0.5 truncate text-[10px] text-ink-500">
                {p.sku} · {p.gpu} · {p.ramGb} GB
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="mono text-[12.5px] text-white">
                {p.currency} {p.price.toLocaleString('en-SG')}
              </div>
              <div
                className={clsx('mono text-[10px]', p.stock > 0 ? 'text-ink-500' : 'text-bad-400')}
              >
                {p.stock > 0 ? `${p.stock} in stock` : 'out of stock'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RulesCard({
  sandbox,
  busy,
  onRuleChange,
  onRuleRemove,
  onApprove,
  onProfileChange,
}: {
  sandbox: SandboxState
  busy: boolean
  onRuleChange: (r: SalesRule) => void
  onRuleRemove: (r: SalesRule) => void
  onApprove: () => void
  onProfileChange: (patch: Record<string, number | string>) => void
}) {
  const p = sandbox.profile ?? {}
  const allApproved = sandbox.rules.length > 0 && sandbox.rules.every((r) => r.approved)

  return (
    <section className="panel anim-in overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">Merchant rules</span>
        <Badge tone={allApproved ? 'ok' : 'warn'}>
          {sandbox.rules.filter((r) => r.approved).length}/{sandbox.rules.length} approved
        </Badge>
      </header>

      <div className="grid grid-cols-2 gap-3 border-b border-ink-800 p-4 sm:grid-cols-4">
        <NumberField
          label="Primary objective"
          text={p.primaryObjective?.replace(/_/g, ' ') ?? 'not set'}
        />
        <EditableNumber
          label="Max discount"
          suffix="%"
          value={p.maxDiscountPct}
          onChange={(v) => onProfileChange({ maxDiscountPct: v })}
        />
        <EditableNumber
          label="Min margin"
          suffix="%"
          value={p.minMarginPct}
          onChange={(v) => onProfileChange({ minMarginPct: v })}
        />
        <EditableNumber
          label="Bundle allowance"
          prefix="S$"
          value={p.bundleAllowance}
          onChange={(v) => onProfileChange({ bundleAllowance: v })}
        />
      </div>

      <div className="divide-y divide-ink-800">
        {sandbox.rules.length === 0 ? (
          <div className="px-4 py-4 text-[11.5px] text-ink-600">
            No rules captured yet. Answer the questions in the chat, or run the voice call.
          </div>
        ) : (
          sandbox.rules.map((r) => (
            <RuleRow key={r.id} rule={r} onChange={onRuleChange} onRemove={onRuleRemove} />
          ))
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 px-4 py-3">
        <p className="max-w-md text-[10.5px] leading-relaxed text-ink-500">
          Unapproved rules are ignored by the offer validator. Nothing here affects a customer offer until
          you approve it.
        </p>
        <Button onClick={onApprove} disabled={busy || sandbox.rules.length === 0}>
          Approve rules
        </Button>
      </footer>
    </section>
  )
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: SalesRule
  onChange: (r: SalesRule) => void
  onRemove: (r: SalesRule) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(rule.text)

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <button
        onClick={() => onChange({ ...rule, approved: !rule.approved })}
        className={clsx(
          'focus-ring mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border text-[10px] font-bold transition-colors',
          rule.approved
            ? 'border-ok-500/50 bg-ok-500/15 text-ok-400'
            : 'border-ink-600 bg-ink-850 text-transparent hover:border-ink-500',
        )}
        aria-label={rule.approved ? 'Unapprove rule' : 'Approve rule'}
      >
        ✓
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (text.trim() && text !== rule.text) onChange({ ...rule, text: text.trim() })
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="focus-ring w-full rounded border border-ink-600 bg-ink-850 px-2 py-1 text-[12px] text-ink-100"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="focus-ring w-full text-left text-[12px] leading-relaxed text-ink-100 hover:text-white"
          >
            {rule.text}
          </button>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="mono text-[9.5px] text-ink-600">{rule.kind}</span>
          <span className="text-[9.5px] text-ink-700">·</span>
          <span className="text-[9.5px] text-ink-600">from {rule.source}</span>
          {Object.keys(rule.params).length > 0 && (
            <Badge tone="neutral">enforceable</Badge>
          )}
        </div>
      </div>

      <button
        onClick={() => onRemove(rule)}
        className="focus-ring shrink-0 rounded px-1 text-[14px] leading-none text-ink-600 hover:text-bad-400"
        aria-label="Remove rule"
      >
        ×
      </button>
    </div>
  )
}

function VisaCard({
  sandbox,
  busy,
  onConnect,
  onFinalize,
}: {
  sandbox: SandboxState
  busy: boolean
  onConnect: () => void
  onFinalize: () => void
}) {
  const v = sandbox.visa
  return (
    <section className="panel anim-in overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">Visa acceptance</span>
        {v.mode && <Badge tone={v.mode === 'sandbox' ? 'ok' : 'warn'}>{v.mode}</Badge>}
      </header>

      <div className="p-4">
        <div
          className="relative overflow-hidden rounded-xl p-4"
          style={{ background: 'linear-gradient(118deg, #1a1f71 0%, #2a35a8 58%, #141a5c 100%)' }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Visa Acceptance
              </div>
              <div className="mt-3 text-[15px] font-semibold text-white">{v.merchantName ?? 'Merchant'}</div>
              <div className="mono mt-0.5 text-[11px] text-white/70">{v.currency}</div>
            </div>
            <div className="text-right">
              <div className="text-[17px] font-bold italic tracking-tight text-white">VISA</div>
              <div className="mt-3 text-[11px] text-white/75">{v.status}</div>
            </div>
          </div>
          <div className="mono mt-5 text-[12px] tracking-[0.22em] text-white/45">•••• •••• •••• 4821</div>
        </div>

        {!v.connected ? (
          <Button className="mt-3 w-full" onClick={onConnect} disabled={busy}>
            Connect Visa
          </Button>
        ) : (
          <>
            <div className="mt-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[10.5px] leading-relaxed text-ink-400">
              {v.mode === 'sandbox'
                ? 'Sandbox acceptance configured. Authorizations will hit apitest.visaacceptance.com; no real money moves.'
                : 'No Visa Acceptance credentials configured on this deployment, so authorizations are simulated to the documented request/response model. Set VISA_ACCEPTANCE_MODE=sandbox with merchant id, key id and secret for the real sandbox call.'}
            </div>
            {sandbox.stage !== 'live' && (
              <Button className="mt-3 w-full" onClick={onFinalize} disabled={busy}>
                Generate merchant agent
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function LiveCard({
  sandbox,
  onToggleNetwork,
}: {
  sandbox: SandboxState
  onToggleNetwork: (v: boolean) => void
}) {
  const a = sandbox.agent
  const [copied, setCopied] = useState(false)

  return (
    <section className="panel anim-in overflow-hidden border-ok-500/30">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ok-500/[0.06] px-4 py-2.5">
        <span className="label-xs">Agent live</span>
        <Badge tone="ok">
          <StatusDot tone="ok" pulse />
          Active
        </Badge>
      </header>

      <div className="p-4">
        <div className="text-[18px] font-semibold text-white">Your agent is live.</div>
        <div className="mono mt-1 text-[11px] text-ink-400">{a.agentId}</div>

        <div className="mt-4 flex flex-wrap gap-2">
          {a.storefrontUrl && (
            <Link href={a.storefrontUrl} className="focus-ring">
              <Button size="sm">Open storefront</Button>
            </Link>
          )}
          {a.docsUrl && (
            <Link href={a.docsUrl} className="focus-ring">
              <Button size="sm" variant="secondary">
                Developer API docs
              </Button>
            </Link>
          )}
          <Link href="/customer" className="focus-ring">
            <Button size="sm" variant="secondary">
              See it compete
            </Button>
          </Link>
        </div>

        <label className="mt-4 flex cursor-pointer items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5">
          <span>
            <span className="block text-[12.5px] font-medium text-ink-100">Sell through agent network</span>
            <span className="block text-[10.5px] text-ink-500">
              Receive structured customer intents and construct offers
            </span>
          </span>
          <input
            type="checkbox"
            checked={a.networkEnabled}
            onChange={(e) => onToggleNetwork(e.target.checked)}
            className="h-4 w-4 accent-[#4d5cd4]"
          />
        </label>

        {a.embedSnippet && (
          <div className="mt-3">
            <div className="label-xs mb-1.5">Storefront embed (non-Shopify sites)</div>
            <div className="mono relative rounded-lg border border-ink-700 bg-ink-850 p-2.5 pr-16 text-[9.5px] leading-relaxed break-all text-ink-400">
              {a.embedSnippet}
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(a.embedSnippet!)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                }}
                className="focus-ring absolute right-2 top-2 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[9.5px] text-ink-300 hover:text-white"
              >
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
              On Shopify this is not needed — the storefront agent ships as a Theme App Extension app embed
              block. See{' '}
              <code className="mono text-ink-400">extensions/storefront-chat</code>.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function IntegrationFooter({ sandbox }: { sandbox: SandboxState }) {
  const i = sandbox.integrations
  return (
    <details className="panel px-4 py-2.5 text-[11px]">
      <summary className="label-xs cursor-pointer select-none">Integration detail</summary>
      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {(
          [
            ['database', i.database],
            ['language model', i.llm],
            ['shopify', i.shopify],
            ['shopify orders', i.shopifyOrderCreate],
            ['visa acceptance', i.visa],
            ['realtime voice', i.realtimeVoice],
            ['webauthn', i.webauthn],
            ['tap keys', i.tapKeys],
            ['demo mode', String(i.demoMode)],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <span className="text-ink-500">{k}</span>
            <span className="mono truncate text-ink-300">{v}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

/* ────────────────────────────  Small bits  ──────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className="mono mt-0.5 truncate text-[12px] text-ink-100">{value}</div>
    </div>
  )
}

function NumberField({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className="mt-0.5 text-[12.5px] capitalize text-ink-100">{text}</div>
    </div>
  )
}

function EditableNumber({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string
  value: number | undefined
  onChange: (v: number) => void
  prefix?: string
  suffix?: string
}) {
  const [draft, setDraft] = useState<string>(value !== undefined ? String(value) : '')
  const [focused, setFocused] = useState(false)

  // The server is the source of truth for these limits: chat and voice both
  // write to the same profile. Without this the field keeps whatever it was
  // initialised with and a rule the merchant just stated never appears.
  // Skipped while focused so a server round-trip cannot overwrite typing.
  useEffect(() => {
    if (focused) return
    setDraft(value !== undefined ? String(value) : '')
  }, [value, focused])

  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-0.5">
        {prefix && <span className="text-[11px] text-ink-500">{prefix}</span>}
        <input
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setFocused(false)
            const n = Number(draft)
            if (Number.isFinite(n) && n >= 0 && n !== value) onChange(n)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="—"
          inputMode="decimal"
          className="focus-ring mono w-14 rounded border border-transparent bg-transparent text-[12.5px] text-ink-100 hover:border-ink-700 focus:border-ink-600"
        />
        {suffix && <span className="text-[11px] text-ink-500">{suffix}</span>}
      </div>
    </div>
  )
}
