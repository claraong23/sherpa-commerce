import Link from 'next/link'
import { getStore } from '@core/db'
import { integrationStatus } from '@core/env'
import { HeroDiagram } from './HeroDiagram'

export const dynamic = 'force-dynamic'

const SCREENS = [
  {
    href: '/merchant/onboard',
    n: '01',
    hue: 220,
    title: 'Merchant onboarding',
    lede: 'Paste a store URL. Platform detection, catalogue import, rule extraction by chat or voice, Visa acceptance, agent generated — one conversation.',
    tags: ['Shopify detector', 'Voice interview', 'Editable rules', 'Payment setup'],
  },
  {
    href: '/storefront/sherpa-computers',
    n: '02',
    hue: 178,
    title: 'Merchant storefront',
    lede: 'The generated agent running on the merchant’s own site. Scoped to one catalogue by construction — ask it about a competitor and watch it decline.',
    tags: ['App embed', 'Merchant-scoped tools', 'No cross-merchant access'],
  },
  {
    href: '/customer',
    n: '03',
    hue: 340,
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
    <main className="relative min-h-screen overflow-hidden">
      {/*
       * Gradient canvas. Layered radials rather than one wide linear: broad
       * low-saturation gradients band on 8-bit displays, and stacked radials
       * keep neighbouring stops close enough in luminance to avoid it. Every
       * stop stays above ~95% lightness so slate-700 body copy keeps ~10:1.
       */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: [
            'radial-gradient(110% 70% at 12% -8%, hsl(220 90% 96%), transparent 60%)',
            'radial-gradient(90% 60% at 88% 4%, hsl(340 92% 97%), transparent 62%)',
            'radial-gradient(120% 80% at 60% 100%, hsl(178 78% 96%), transparent 65%)',
            'linear-gradient(180deg, #fbfcfe, #ffffff 45%, #fbfcfe)',
          ].join(','),
        }}
        aria-hidden
      />

      <div className="mx-auto max-w-6xl px-6 pb-16 pt-5">
        {/* ── Glass pill nav ── */}
        <nav className="mb-14 flex flex-wrap items-center justify-between gap-3 rounded-full border border-white/70 bg-white/60 py-2 pl-3 pr-2.5 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-400 text-[13px] font-bold text-slate-900">
              S
            </span>
            <span className="text-[13px] font-semibold tracking-tight text-slate-900">Sherpa</span>
            <span className="hidden text-[11.5px] text-slate-500 sm:inline">
              Agentic commerce infrastructure
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip label="Visa hackathon prototype" tone="brand" />
            <Link
              href="/customer"
              className="focus-ring rounded-full bg-slate-900 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-slate-800"
            >
              Open the demo
            </Link>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <h1 className="text-[38px] leading-[1.06] font-extrabold tracking-[-0.035em] text-slate-900 sm:text-[46px]">
              Turn any merchant into
              <br />
              <span className="text-brand-600">an AI-native seller.</span>
            </h1>

            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-slate-600">
              One conversation onboards a merchant. The agent it produces sells on that
              merchant’s own storefront <em className="not-italic font-medium text-slate-900">and</em>{' '}
              competes for customer intent in a sealed offer exchange — with Visa as the trust and
              transaction layer.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Link
                href="/merchant/onboard"
                className="focus-ring group inline-flex items-center gap-2 rounded-full bg-brand-400 py-1.5 pl-5 pr-1.5 text-[13.5px] font-semibold text-slate-900 transition-colors hover:bg-brand-500"
              >
                Start with a merchant
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white transition-transform group-hover:translate-x-0.5">
                  <Arrow />
                </span>
              </Link>
              <Link
                href="/customer"
                className="focus-ring rounded-full border border-white/80 bg-white/70 px-4 py-2.5 text-[13px] font-medium text-slate-700 backdrop-blur-md transition-colors hover:bg-white"
              >
                Watch agents compete
              </Link>
            </div>

            {/* Real integration status, not decoration. */}
            <div className="mt-8 flex flex-wrap gap-1.5">
              <StatusChip label={`${merchants.length} merchants · ${productCount} laptops`} tone="neutral" />
              <StatusChip label={status.database} tone="neutral" />
              <StatusChip label={status.llm} tone="neutral" />
              <StatusChip label={`shopify ${status.shopify}`} tone="neutral" />
              <StatusChip label={`visa ${status.visa}`} tone={status.visa === 'sandbox' ? 'ok' : 'warn'} />
            </div>
          </div>

          {/*
            * Hero device: the architecture itself.
            *
            * The callouts sit BELOW the diagram rather than beside it. There is
            * no breakpoint where a 184px card fits in the ~50px of slack either
            * side of the SVG, and overlapping the nodes would put backdrop-blur
            * across artwork — which reads as smear, not glass. Short upward
            * connectors keep the UI_4 tether.
            */}
          <div className="mx-auto w-full max-w-[420px]">
            <HeroDiagram className="w-full drop-shadow-[0_18px_40px_rgba(23,28,40,0.06)]" />

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Callout>
                <b className="mb-0.5 block font-semibold text-slate-900">Merchant agent</b>
                own inventory, own rules, cannot see a rival’s offer
              </Callout>
              <Callout>
                <b className="mb-0.5 block font-semibold text-slate-900">Customer agent</b>
                filters, verifies and scores for the buyer alone
              </Callout>
            </div>
          </div>
        </section>

        {/* ── Demo routes ── */}
        <section className="mt-16">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[17px] font-bold tracking-tight text-slate-900">Three demo screens</h2>
            <span className="text-[11.5px] text-slate-500">every screen runs on real data</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {SCREENS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="focus-ring group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(23,28,40,0.07)]"
              >
                <span
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: `hsl(${s.hue} 68% 62%)` }}
                  aria-hidden
                />
                <div className="mono mb-3.5 text-[11px] text-slate-400">{s.n}</div>
                <h3 className="text-[16px] font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-slate-600">{s.lede}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {s.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] text-slate-600"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <span
                  className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium"
                  style={{ color: `hsl(${s.hue} 52% 38%)` }}
                >
                  Open
                  <span className="transition-transform group-hover:translate-x-0.5">
                    <Arrow small />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Honesty ── */}
        <section className="mt-10 rounded-2xl border border-slate-200 bg-white/80 p-6 backdrop-blur-sm">
          <h2 className="text-[15px] font-bold tracking-tight text-slate-900">
            What is real, and what is not
          </h2>
          <div className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            <Honest
              ok
              text="Merchant policy engine, offer validator, hard-constraint filter, deterministic scoring, offer canonicalization and SHA-256 lock, Payment Instruction controls, Ed25519 TAP-style signing and verification, WebAuthn assertion verification — all executing."
            />
            <Honest
              ok={status.visa === 'sandbox'}
              text={
                status.visa === 'sandbox'
                  ? 'Visa Acceptance authorization is a real call to the sandbox at apitest.visaacceptance.com. No real money moves.'
                  : 'Visa Acceptance authorization is simulated to the documented request/response model — no sandbox credentials are configured here.'
              }
            />
            <Honest
              ok={status.shopify === 'connected'}
              text={
                status.shopify === 'connected'
                  ? 'Shopify GraphQL Admin API is connected: catalogue sync, live inventory and orderCreate.'
                  : 'Shopify runs against the seeded catalogue mirror. Set SHOPIFY_ADMIN_ACCESS_TOKEN and SHOPIFY_DEMO_STORE_DOMAIN for the live path.'
              }
            />
            <Honest
              ok={false}
              text="Visa Intelligent Commerce Connect, VIC credential services, the Visa MCP Server and network commerce-signal ingestion are architecture-mapped, not integrated. The TAP demo key is locally generated and is not registered with Visa."
            />
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11.5px] text-slate-500">
          <span>Prototype. Product data is fabricated for the demo.</span>
          <Link href="/docs/merchant/sherpa-computers" className="text-brand-600 hover:underline">
            Merchant API docs →
          </Link>
        </footer>
      </div>
    </main>
  )
}

/* ────────────────────────────  Pieces  ──────────────────────────── */

function Arrow({ small }: { small?: boolean }) {
  const s = small ? 12 : 13
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatusChip({ label, tone }: { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' }) {
  const tones = {
    neutral: 'border-slate-200 bg-white/70 text-slate-600',
    brand: 'border-brand-200 bg-brand-50 text-brand-700',
    ok: 'border-ok-200 bg-ok-50 text-ok-700',
    warn: 'border-warn-200 bg-warn-50 text-warn-700',
  }
  return (
    <span className={`mono rounded-full border px-2.5 py-1 text-[10.5px] backdrop-blur-sm ${tones[tone]}`}>
      {label}
    </span>
  )
}

/**
 * Glass callout tethered upward to the diagram by a line and a dot (UI_4).
 *
 * Glass sits on flat gradient only. The connector runs up into the diagram's
 * lower margin, which is transparent, so the blur samples the gradient rather
 * than the artwork.
 */
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative pt-3">
      <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-slate-300" aria-hidden />
      <span
        className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-400"
        aria-hidden
      />
      <div className="rounded-xl border border-white/80 bg-white/75 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 shadow-[0_6px_20px_rgba(23,28,40,0.07)] backdrop-blur-md">
        {children}
      </div>
    </div>
  )
}

function Honest({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className="flex gap-2.5">
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-ok-400' : 'bg-warn-400'}`}
        aria-hidden
      />
      <span className="text-[12px] leading-relaxed text-slate-600">{text}</span>
    </div>
  )
}
