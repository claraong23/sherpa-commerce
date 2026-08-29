import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getStore } from '@core/db'
import { integrationStatus, serverEnv } from '@core/env'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params
  const m = await getStore().getMerchant(merchantId)
  return { title: m ? `${m.name} — agent API` : 'Merchant API docs' }
}

/**
 * Merchant-specific developer documentation, generated from the real profile.
 *
 * For Shopify merchants the primary UX is the no-code connector; this page is
 * the advanced / custom / enterprise path.
 */
export default async function MerchantDocs({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params
  const store = getStore()
  const merchant = await store.getMerchant(merchantId)
  if (!merchant) notFound()

  const profile = await store.getProfile(merchantId)
  const products = await store.listProducts(merchantId)
  const env = serverEnv()
  const status = integrationStatus()
  const base = env.appUrl
  const sampleSkus = products.slice(0, 3).map((p) => p.sku)
  const sample = products[0]
  const shopifyConnector = merchant.commercePlatform === 'shopify'

  return (
    <div className="min-h-screen bg-slate-25">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-6 py-3">
          <Link href="/" className="text-[12px] font-semibold text-slate-700 hover:text-slate-900">
            ← Agentic commerce
          </Link>
          <div className="flex gap-4 text-[11.5px]">
            <Link href={`/storefront/${merchant.id}`} className="text-brand-600 hover:underline">
              Storefront →
            </Link>
            <Link href="/customer" className="text-brand-600 hover:underline">
              Agent network →
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="label-xs mb-2">Merchant integration</div>
        <h1 className="text-[30px] font-semibold tracking-tight text-slate-900">{merchant.name}</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-600">
          Generated from this merchant’s live profile. Every identifier and example below is real for this
          deployment.
        </p>

        {shopifyConnector && (
          <div className="panel mt-6 border-ok-200 bg-ok-50 p-4">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok-500" aria-hidden />
              <span className="text-[13px] font-semibold text-slate-900">No-code connector active</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-700">
              This merchant runs on Shopify, so catalogue sync, inventory and order creation flow through
              the installed app — nothing on this page is required. These endpoints are the advanced path
              for custom integrations, headless storefronts, or connecting a second commerce system.
            </p>
          </div>
        )}

        {/* ── Identity ── */}
        <Section title="Identity">
          <KV k="Merchant ID" v={merchant.id} />
          <KV k="Agent ID" v={merchant.agentId} mono />
          <KV k="Platform" v={`${merchant.platform} / ${merchant.commercePlatform}`} />
          <KV k="Currency" v={merchant.currency} />
          <KV k="Category" v={merchant.category} />
          <KV
            k="Agent network"
            v={merchant.networkEnabled ? 'enabled — receives customer intents' : 'disabled'}
          />
          <KV k="Storefront agent" v={merchant.storefrontEnabled ? 'enabled' : 'disabled'} />
          <KV
            k="Payment acceptance"
            v={
              merchant.visaMode === 'sandbox'
                ? 'Visa Acceptance sandbox'
                : merchant.visaMode === 'simulated'
                  ? 'Simulated Visa Acceptance (no credentials configured)'
                  : 'not connected'
            }
          />
        </Section>

        {/* ── Integration status ── */}
        <Section title="Integration status">
          <KV k="Catalogue source" v={status.shopify === 'connected' ? 'Shopify Admin API' : 'seeded mirror'} />
          <KV k="Products indexed" v={String(products.length)} />
          <KV k="Order creation" v={status.shopifyOrderCreate} />
          <KV k="Database" v={status.database} />
          <KV k="Sample SKUs" v={sampleSkus.join(', ') || '—'} mono />
        </Section>

        {/* ── Commercial policy ── */}
        {profile && (
          <Section title="Commercial policy (server-side only)">
            <KV k="Primary objective" v={profile.primaryObjective.replace(/_/g, ' ')} />
            <KV k="Max discount" v={`${profile.maxDiscountPct}%`} />
            <KV k="Min margin" v={`${profile.minMarginPct}%`} />
            <KV k="Bundle allowance" v={`${merchant.currency} ${profile.bundleAllowance}`} />
            <KV k="Standard warranty" v={`${profile.standardWarrantyYears} years`} />
            <KV k="Approved sales rules" v={String(profile.salesRules.filter((r) => r.approved).length)} />
            <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500">
              These values are never returned by a public endpoint and are never sent to a browser. They
              are applied inside the offer validator before an offer can be sealed.
            </p>
          </Section>
        )}

        {/* ── Endpoints ── */}
        <Section title="Endpoints">
          <Endpoint
            method="POST"
            path="/api/storefront/chat"
            desc="Merchant-scoped storefront conversation. Tools are bound to this merchantId; there is no cross-merchant search."
          />
          <Endpoint
            method="POST"
            path="/api/shopify/sync"
            desc="Pull catalogue, variants and inventory into the normalized mirror."
          />
          <Endpoint
            method="POST"
            path="/api/shopify/order"
            desc="Create an order for a SKU. Returns shopifyOrderStatus: created | not_configured | failed | demo."
          />
          <Endpoint
            method="GET"
            path={`/api/public/merchant/${merchant.id}`}
            desc="Public browser-safe config for the storefront widget. Agent id only, no secrets."
          />
          <Endpoint
            method="POST"
            path="/api/exchange/request"
            desc="Customer-agent entry point. Signed RFO fans out to every network-enabled merchant agent."
          />
          <Endpoint
            method="POST"
            path="/api/exchange/counter"
            desc="One counteroffer round against a sealed offer, evaluated against this merchant's policy floor."
          />
          <Endpoint
            method="POST"
            path="/api/offers/:offerId/lock"
            desc="Re-check inventory, re-canonicalize, compare SHA-256, freeze the offer."
          />
          <Endpoint
            method="POST"
            path="/api/payments/instruction"
            desc="Create a Payment Instruction bound to this merchant, an amount ceiling and an expiry."
          />
          <Endpoint
            method="POST"
            path="/api/payments/authorize"
            desc="Enforce the instruction controls, then authorize through the Visa Acceptance adapter."
          />
          <Endpoint method="GET" path="/api/events/:sessionId" desc="SSE stream of agent events for a session." />
        </Section>

        {/* ── Examples ── */}
        <Section title="Examples">
          <CodeBlock
            label="Storefront chat"
            code={`curl -X POST ${base}/api/storefront/chat \\
  -H 'content-type: application/json' \\
  -d '{
    "merchantId": "${merchant.id}",
    "message": "I need something light for coding under ${merchant.currency} 1500",
    "history": []
  }'`}
          />

          {sample && (
            <CodeBlock
              label="Create an order"
              code={`curl -X POST ${base}/api/shopify/order \\
  -H 'content-type: application/json' \\
  -d '{
    "merchantId": "${merchant.id}",
    "sku": "${sample.sku}",
    "quantity": 1,
    "amount": ${sample.price},
    "currency": "${merchant.currency}",
    "reference": "PI-EXAMPLE"
  }'`}
            />
          )}

          <CodeBlock
            label="Offer response shape (network mode)"
            code={JSON.stringify(
              {
                offerId: 'ofbiz_a1b2c3d4',
                requestId: 'req_xxxx',
                merchantId: merchant.id,
                sku: sample?.sku ?? 'SKU',
                price: sample ? Math.round(sample.price * 0.97) : 1499,
                currency: merchant.currency,
                bundle: { type: 'mouse', description: 'Wireless mouse', value: 35 },
                warrantyYears: profile?.standardWarrantyYears ?? 1,
                deliveryDays: profile?.standardDeliveryDays ?? 2,
                availability: 'in_stock',
                merchantPolicyVerified: true,
                state: 'sealed',
                hash: 'sha-256 hex of the canonical offer',
                expiresAt: '2026-08-29T13:45:00.000Z',
              },
              null,
              2,
            )}
          />
        </Section>

        {/* ── Storefront embed ── */}
        <Section title="Storefront widget">
          {shopifyConnector ? (
            <>
              <p className="text-[12.5px] leading-relaxed text-slate-700">
                On Shopify the storefront agent ships as a Theme App Extension app embed block
                (<code className="mono text-slate-600">extensions/storefront-chat</code>). Activate it in the
                theme editor under App embeds — no theme code changes and no ScriptTag injection.
              </p>
              <CodeBlock
                label="Non-Shopify sites"
                code={`<script src="${base}/widget.js"
  data-merchant-id="${merchant.id}"
  data-agent-id="${merchant.agentId}"
  async></script>`}
              />
            </>
          ) : (
            <CodeBlock
              label="Drop-in embed"
              code={`<script src="${base}/widget.js"
  data-merchant-id="${merchant.id}"
  data-agent-id="${merchant.agentId}"
  async></script>`}
            />
          )}
        </Section>

        {/* ── Security ── */}
        <Section title="Auth and security">
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-slate-700">
            <li>
              <strong className="text-slate-900">Public identifiers.</strong> The agent id and merchant id are
              browser-safe and are the only values the widget receives.
            </li>
            <li>
              <strong className="text-slate-900">Server-side secrets.</strong> Commercial rules, cost prices,
              margins, Shopify tokens, Visa credentials and the agent signing key never leave the server and
              never enter a model prompt.
            </li>
            <li>
              <strong className="text-slate-900">Agent request signing.</strong> Customer-agent requests carry an
              Ed25519 signature over an RFC 9421-style signature base with a nonce and timestamp; the merchant
              agent verifies before constructing an offer. This is a TAP-style implementation against Visa’s
              public protocol model — the demo key is locally generated and is not registered with Visa.
            </li>
            <li>
              <strong className="text-slate-900">Merchant isolation.</strong> Storefront sessions are constructed
              with one merchant id and the tools close over it. No cross-merchant read path exists.
            </li>
            <li>
              <strong className="text-slate-900">Offer integrity.</strong> A sealed offer is canonicalized and
              hashed with SHA-256. Authorization is refused if the hash changes.
            </li>
            <li className="text-slate-600">
              This prototype has no merchant authentication. A production deployment would issue per-merchant
              API keys with HMAC request signing and scope every endpoint to the authenticated merchant.
            </li>
          </ul>
        </Section>

        <footer className="mt-10 border-t border-slate-200 pt-5 text-[11px] leading-relaxed text-slate-400">
          Generated {new Date().toISOString().slice(0, 10)} for {merchant.name} ({merchant.agentId}).
          Prototype documentation — product and pricing data is fabricated for the demo.
        </footer>
      </main>
    </div>
  )
}

/* ────────────────────────────  Building blocks  ──────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-b border-slate-200 pb-2 text-[15px] font-semibold text-slate-900">{title}</h2>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200/60 py-1.5">
      <span className="text-[12.5px] text-slate-600">{k}</span>
      <span className={`text-right text-[12.5px] text-slate-900 ${mono ? 'mono' : ''}`}>{v}</span>
    </div>
  )
}

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const color =
    method === 'GET' ? 'text-ok-600 border-ok-200 bg-ok-50' : 'text-brand-600 border-brand-200 bg-brand-50'
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-slate-200/60 py-2">
      <span className={`mono shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
        {method}
      </span>
      <code className="mono text-[12px] text-slate-900">{path}</code>
      <p className="w-full text-[11.5px] leading-relaxed text-slate-500">{desc}</p>
    </div>
  )
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="mt-3">
      <div className="label-xs mb-1.5">{label}</div>
      <pre className="mono overflow-x-auto rounded-lg border border-slate-300 bg-white p-3 text-[11px] leading-relaxed text-slate-700">
        {code}
      </pre>
    </div>
  )
}
