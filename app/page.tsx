import Link from 'next/link'
import { getStore } from '@core/db'
import { integrationStatus } from '@core/env'

export const dynamic = 'force-dynamic'

const SCREENS = [
  {
    href: '/merchant/onboard',
    n: '01',
    title: 'Merchant onboarding',
    lede: 'Paste a store URL. Platform detection, catalogue import, rule extraction by chat or voice, Visa acceptance, agent generated — one conversation.',
    tags: ['Shopify detector', 'Voice interview', 'Editable rules', 'Payment setup'],
  },
  {
    href: '/storefront/tan-computers',
    n: '02',
    title: 'Merchant storefront',
    lede: 'The generated agent running on the merchant’s own site. Scoped to one catalogue by construction — ask it about a competitor and watch it decline.',
    tags: ['App embed', 'Merchant-scoped tools', 'No cross-merchant access'],
  },
  {
    href: '/customer',
    n: '03',
    title: 'Customer agent + exchange',
    lede: 'One sentence in. Signed requests out to three merchant agents, sealed offers back, hard filter, deterministic scoring, one counteroffer, locked offer, Visa authorization, order.',
    tags: ['Sealed offer round', 'TAP-style signing', 'Payment Instruction', 'Passkey'],
  },
]

export default async function Home() {
  const status = integrationStatus()
  const store = getStore()
  const merchants = await store.listMerchants()
  let productCount = 0
  for (const m of merchants) productCount += (await store.listProducts(m.id)).length

  return (
    <main className="grid-bg min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <header className="mb-14">
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-[13px] font-bold text-white">
              A
            </div>
            <span className="label-xs">Agentic commerce infrastructure · Visa hackathon prototype</span>
          </div>

          <h1 className="max-w-3xl text-[34px] leading-[1.15] font-semibold tracking-tight text-white sm:text-[42px]">
            Turn any merchant into an AI-native seller through one conversation.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-300">
            That merchant’s AI agent can then autonomously compete for customer intent — against other
            merchant agents, in a sealed offer round, with Visa as the trust and transaction layer.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-ink-400">
            <StatusPill label="Catalogue" value={`${merchants.length} merchants · ${productCount} laptops`} />
            <StatusPill label="Database" value={status.database} />
            <StatusPill label="Language model" value={status.llm} />
            <StatusPill label="Shopify" value={status.shopify} />
            <StatusPill label="Visa acceptance" value={status.visa} />
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-3">
          {SCREENS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="panel focus-ring group flex flex-col p-5 transition-colors hover:border-brand-400/50"
            >
              <div className="mono mb-4 text-[11px] text-ink-500">{s.n}</div>
              <h2 className="text-[17px] font-semibold text-white group-hover:text-brand-300">{s.title}</h2>
              <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-ink-400">{s.lede}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {s.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10.5px] text-ink-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>

        <section className="panel mt-4 p-5">
          <div className="label-xs mb-3">What is real, and what is not</div>
          <div className="grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
            <Honest
              ok
              text="Merchant policy engine, offer validator, hard-constraint filter, scoring, offer canonicalization + SHA-256 lock, Payment Instruction controls, Ed25519 TAP-style signing and verification, WebAuthn assertion verification — all executing."
            />
            <Honest
              ok={status.visa === 'sandbox'}
              text={
                status.visa === 'sandbox'
                  ? 'Visa Acceptance authorization calls the sandbox at apitest.visaacceptance.com. No real money moves.'
                  : 'Visa Acceptance authorization is simulated to the documented request/response model — no sandbox credentials are configured here.'
              }
            />
            <Honest
              ok={status.shopify === 'connected'}
              text={
                status.shopify === 'connected'
                  ? 'Shopify GraphQL Admin API is connected: catalogue sync, live inventory and orderCreate.'
                  : 'Shopify runs against the seeded catalogue mirror. Set SHOPIFY_ADMIN_ACCESS_TOKEN + SHOPIFY_DEMO_STORE_DOMAIN for the live path.'
              }
            />
            <Honest
              ok={false}
              text="Visa Intelligent Commerce Connect, VIC credential services, the Visa MCP Server and network commerce-signal ingestion are architecture-mapped, not integrated. The TAP demo key is locally generated and is not registered with Visa."
            />
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11.5px] text-ink-500">
          <span>Prototype. Product data is fabricated for the demo.</span>
          <Link href="/docs/merchant/tan-computers" className="hover:text-ink-300">
            Merchant API docs →
          </Link>
        </footer>
      </div>
    </main>
  )
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="label-xs">{label}</span>
      <span className="mono text-ink-200">{value}</span>
    </span>
  )
}

function Honest({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="flex gap-2.5 py-1">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-ok-500' : 'bg-gold-500'}`}
        aria-hidden
      />
      <span className="leading-relaxed text-ink-300">{text}</span>
    </div>
  )
}
