import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { toPublicProduct } from '@core/schemas'
import { StorefrontChat } from './StorefrontChat'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params
  const merchant = await getStore().getMerchant(merchantId)
  return { title: merchant ? `${merchant.name} — laptops` : 'Storefront' }
}

/**
 * Local storefront preview.
 *
 * When the Shopify dev store is configured, the real demo opens that store —
 * the banner links to it and the same agent runs there through the Theme App
 * Extension app embed. This page exists so screen 2 is demoable with no
 * Shopify configuration at all.
 */
export default async function StorefrontPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params
  const store = getStore()
  const merchant = await store.getMerchant(merchantId)
  if (!merchant) notFound()

  const env = serverEnv()
  const products = (await store.listProducts(merchantId)).map(toPublicProduct)
  const merchants = await store.listMerchants()
  const competitor = merchants.find((m) => m.id !== merchantId)?.name ?? 'another retailer'
  const shopifyLive = Boolean(env.shopifyAdminToken && env.shopifyStoreDomain)
  const storeUrl = env.shopifyStoreDomain ? `https://${env.shopifyStoreDomain}` : merchant.websiteUrl

  const hue = merchant.logoHue

  return (
    <div className="min-h-screen bg-ink-950">
      {/* Demo banner — not part of the merchant's site */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-ink-900 px-4 py-2 text-[11.5px]">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold text-ink-300 hover:text-white">
            ← Agentic commerce
          </Link>
          <span className="text-ink-500">
            {shopifyLive ? 'Local preview of' : 'Local preview standing in for'} the merchant’s own site ·
            the storefront agent below is the generated integration
          </span>
        </div>
        <div className="flex items-center gap-3">
          {storeUrl && (
            <a
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              className={shopifyLive ? 'text-ok-400 hover:underline' : 'text-ink-500'}
            >
              {shopifyLive ? 'Open the Shopify store →' : 'Shopify store not configured'}
            </a>
          )}
          <Link href={`/docs/merchant/${merchant.id}`} className="text-brand-300 hover:underline">
            API docs →
          </Link>
        </div>
      </div>

      {/* Storefront chrome */}
      <header
        className="border-b border-ink-800"
        style={{ background: `linear-gradient(180deg, hsl(${hue} 30% 12%), var(--color-ink-950))` }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[15px] font-bold text-white"
              style={{ background: `hsl(${hue} 55% 42%)` }}
            >
              {merchant.name.charAt(0)}
            </div>
            <div>
              <div className="text-[17px] font-semibold text-white">{merchant.name}</div>
              <div className="text-[11px] text-ink-400">Laptops · Singapore</div>
            </div>
          </div>
          <nav className="hidden gap-6 text-[12.5px] text-ink-300 sm:flex">
            <span>Laptops</span>
            <span>Accessories</span>
            <span>Support</span>
            <span>Contact</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold text-white">Laptops</h1>
            <p className="mt-1 text-[13px] text-ink-400">
              {products.length} models · prices in {merchant.currency}
            </p>
          </div>
          <p className="max-w-md text-[11.5px] leading-relaxed text-ink-500">
            The assistant in the corner answers only from this catalogue. Ask it about a competitor and it
            will tell you it cannot see one — there is no tool in its session that can.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <article key={p.id} className="panel overflow-hidden">
              {p.imageUrl && (
                <Image
                  src={p.imageUrl}
                  alt=""
                  width={320}
                  height={200}
                  className="h-[150px] w-full border-b border-ink-800 object-cover"
                  unoptimized
                />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[13.5px] leading-snug font-medium text-white">{p.title}</h2>
                  {p.condition === 'refurbished' && (
                    <span className="shrink-0 rounded border border-warn-500/35 bg-warn-500/10 px-1.5 py-0.5 text-[9.5px] text-warn-500">
                      refurb
                    </span>
                  )}
                </div>

                <dl className="mono mt-2.5 space-y-0.5 text-[10.5px] text-ink-400">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-600">CPU</dt>
                    <dd className="truncate text-right">{p.specs.cpu}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-600">GPU</dt>
                    <dd className="truncate text-right">{p.specs.gpu}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-600">Memory</dt>
                    <dd>{p.specs.ramGb} GB</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-600">Weight</dt>
                    <dd>{p.specs.weightKg ? `${p.specs.weightKg} kg` : '—'}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-end justify-between border-t border-ink-800 pt-3">
                  <div>
                    <div className="mono text-[16px] font-semibold text-white">
                      {p.currency} {p.price.toLocaleString('en-SG')}
                    </div>
                    <div className="text-[10px] text-ink-500">{p.warrantyYears}-year warranty</div>
                  </div>
                  <span
                    className={`text-[10.5px] ${p.stock > 0 ? 'text-ok-400' : 'text-bad-400'}`}
                  >
                    {p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      <footer className="border-t border-ink-800 px-6 py-6 text-center text-[11px] text-ink-600">
        {merchant.name} · demo storefront · product data is fabricated for this prototype
      </footer>

      <StorefrontChat merchantId={merchant.id} merchantName={merchant.name} competitorName={competitor} />
    </div>
  )
}
