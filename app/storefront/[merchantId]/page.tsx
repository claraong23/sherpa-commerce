import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import clsx from 'clsx'
import { MagnifyingGlass, ArrowRight, ShieldCheck, Truck, ListChecks } from '@phosphor-icons/react/dist/ssr'
import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { heroImageForSku } from '@core/seed/products'
import type { PublicProduct } from '@core/schemas'
import { toPublicProduct } from '@core/schemas'
import { StorefrontChat } from './StorefrontChat'
import { HeroRibbon } from './HeroRibbon'
import { HeroObjects } from './HeroObjects'
import { MerchantSwitcher } from './MerchantSwitcher'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params
  const merchant = await getStore().getMerchant(merchantId)
  return { title: merchant ? `${merchant.name} laptops` : 'Storefront' }
}

interface SearchParams {
  brand?: string
  q?: string
}

/**
 * Local storefront preview.
 *
 * When the Shopify dev store is configured, the real demo opens that store —
 * the banner links to it and the same agent runs there through the Theme App
 * Extension app embed. This page exists so screen 2 is demoable with no
 * Shopify configuration at all.
 *
 * Everything shown here is real: prices, specs, stock and the merchant's own
 * warranty and delivery terms. Nothing on the page is decorative filler, and
 * the commercial policy fields (discount ceiling, margin floor) are never
 * surfaced — those stay server-side in the offer validator.
 */
export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>
  searchParams: Promise<SearchParams>
}) {
  const { merchantId } = await params
  const sp = await searchParams
  const store = getStore()

  const merchant = await store.getMerchant(merchantId)
  if (!merchant) notFound()

  const env = serverEnv()
  const profile = await store.getProfile(merchantId)
  const all = (await store.listProducts(merchantId)).map(toPublicProduct)
  const merchants = await store.listMerchants()
  const competitor = merchants.find((m) => m.id !== merchantId)?.name ?? 'another retailer'

  const shopifyLive = Boolean(env.shopifyAdminToken && env.shopifyStoreDomain)
  const storeUrl = env.shopifyStoreDomain ? `https://${env.shopifyStoreDomain}` : merchant.websiteUrl
  const hue = merchant.logoHue
  const cur = merchant.currency

  /*
   * The merchant accent, dark enough to carry white text.
   *
   * design.md's rule is that the four brand colours are fills carrying DARK
   * text. Three places on this page do the opposite and put white on the
   * merchant's accent, so those fills have to be darkened until they clear AA.
   *
   * 44% lightness was fine for Sherpa's 220 (5.9:1) and Challenger's 340, but
   * only 2.6:1 for Bizgram's 178: a teal at a given lightness is far brighter
   * than a blue at the same lightness, because luminance is mostly green. 32%
   * is the one value that clears 4.5:1 on all three hues (178 -> 4.65:1,
   * 220 -> 9.7:1), which beats carrying a per-hue exception table.
   */
  const accentSolid = `hsl(${hue} 58% 32%)`

  /* ── Filtering, driven by the URL so it needs no client JS ── */
  const brands = [...new Set(all.map((p) => p.brand))].sort()
  const query = (sp.q ?? '').trim().toLowerCase()
  const products = all.filter((p) => {
    if (sp.brand && p.brand !== sp.brand) return false
    if (!query) return true
    return `${p.title} ${p.brand} ${p.specs.cpu} ${p.specs.gpu} ${p.tags.join(' ')}`
      .toLowerCase()
      .includes(query)
  })

  /* ── Hero product: the strongest in-stock unit that has a cut-out shot ── */
  const hero = pickHero(all)
  const heroImage = hero ? heroImageForSku(hero.sku) : null
  const featured = all.filter((p) => p.stock > 0 && p.id !== hero?.id)
  /* Entry price, for the hero chip on merchants with no cut-out shot. */
  const cheapest = all.filter((p) => p.stock > 0).sort((a, b) => a.price - b.price)[0] ?? null

  return (
    <div className="min-h-screen bg-slate-25">
      {/* Demo banner — not part of the merchant's site */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-slate-200 bg-slate-25 px-5 text-[11px]">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="focus-ring inline-flex min-h-11 items-center font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Agentic commerce
          </Link>
          <span className="hidden text-slate-400 xl:inline">
            {shopifyLive ? 'Local preview of' : 'Local preview standing in for'} the merchant’s own site
          </span>
          <MerchantSwitcher merchants={merchants} currentId={merchant.id} />
        </div>
        <div className="flex items-center gap-4">
          {storeUrl && (
            <a
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              className={clsx(
                'focus-ring inline-flex min-h-11 items-center',
                shopifyLive ? 'text-ok-600 hover:underline' : 'text-slate-400',
              )}
            >
              {shopifyLive ? 'Open the Shopify store →' : 'Shopify store not configured'}
            </a>
          )}
          <Link
            href={`/docs/merchant/${merchant.id}`}
            className="focus-ring inline-flex min-h-11 items-center text-brand-600 hover:underline"
          >
            API docs →
          </Link>
        </div>
      </div>

      {/* ── Store header ── */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-5 py-3.5">
          <Link
            href={`/storefront/${merchant.id}`}
            className="focus-ring flex min-h-11 shrink-0 items-center gap-2.5"
          >
            {/* One flat accent, locked to the merchant's own hue. The previous
                two-stop gradient rotated the accent off-hue (220 → 260 reads
                violet) and is the loudest generated-UI tell there is. */}
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[14px] font-bold text-white"
              style={{ background: accentSolid }}
            >
              {merchant.name.charAt(0)}
            </span>
            <span className="text-[16px] font-semibold tracking-tight text-slate-900">{merchant.name}</span>
          </Link>

          <nav className="hidden items-center gap-5 text-[12.5px] text-slate-600 lg:flex">
            <span className="text-slate-900">Laptops</span>
            <span>Accessories</span>
            <span>Support</span>
          </nav>

          <form action={`/storefront/${merchant.id}`} className="ml-auto flex max-w-xs flex-1 items-center">
            <div className="flex min-h-11 w-full items-center gap-2 rounded-full border border-slate-300 bg-white px-4 focus-within:border-slate-400">
              <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-slate-400" />
              <input
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Search this store"
                aria-label="Search products"
                className="h-11 w-full bg-transparent text-[12.5px] text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </form>

          <span className="hidden shrink-0 text-[12.5px] text-slate-600 sm:inline">Log in</span>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-slate-200">
        {/* Single-hue wash. Two radials on offset hues meant Sherpa's blue bled
            into violet across the canvas; a tint may vary in intensity, never
            in hue. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(115% 85% at 76% 42%, hsl(${hue} 82% 93%), transparent 64%)`,
          }}
          aria-hidden
        />

        {/*
          * Ribbon and objects sit between the wash and the content.
          *
          * The grid texture that used to run across this whole section is gone
          * from the hero: a 34px lattice behind a twisting band reads as moire,
          * and the two textures were fighting for the same job. The grid still
          * runs on every other surface, so the hero is the one place on the
          * page that is allowed to be atmospheric.
          */}
        <HeroRibbon
          hue={hue}
          className="pointer-events-none absolute inset-x-0 bottom-[-6%] h-[76%] opacity-60"
        />
        <HeroObjects hue={hue} />

        <div className="relative mx-auto grid max-w-[1200px] items-center gap-8 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div>
            {hero && (
              <div className="mb-4 flex items-center gap-2 text-[11px]">
                <span
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={{ background: `hsl(${hue} 76% 94%)`, color: `hsl(${hue} 58% 34%)` }}
                >
                  Featured
                </span>
                <span className="mono text-slate-600">
                  {hero.brand} {hero.model} · {hero.specs.gpu.replace(/\s*\d+GB$/, '')}
                </span>
              </div>
            )}

            <h1 className="max-w-xl text-[40px] leading-[1.02] font-bold tracking-[-0.04em] text-slate-900 sm:text-[54px] lg:text-[58px]">
              Built for the work
              <br />
              you actually do.
            </h1>

            <p className="mt-5 max-w-md text-[14px] leading-relaxed text-slate-700">
              {all.length} laptops, specified properly and priced in {cur}. Every unit on this page shows
              its real configuration and live stock. No “from” pricing, no mystery variants.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#catalogue"
                className="focus-ring group inline-flex min-h-12 items-center gap-2.5 rounded-full px-6 text-[13px] font-semibold text-white transition-[filter] duration-150 hover:brightness-95 active:brightness-90"
                style={{ background: accentSolid }}
              >
                Shop the range
                <ArrowRight size={15} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>

            {hero && (
              <dl className="mt-9 grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-200 pt-6 sm:grid-cols-4">
                <HeroSpec label="Memory" value={`${hero.specs.ramGb} GB`} />
                <HeroSpec label="Storage" value={`${hero.specs.storageGb} GB`} />
                <HeroSpec label="Weight" value={hero.specs.weightKg ? `${hero.specs.weightKg} kg` : 'not listed'} />
                <HeroSpec label="Warranty" value={`${hero.warrantyYears} year${hero.warrantyYears === 1 ? '' : 's'}`} />
              </dl>
            )}
          </div>

          {heroImage && hero ? (
            <div className="relative flex items-center justify-center">
              <div
                className="pointer-events-none absolute h-[78%] w-[78%] rounded-full blur-3xl"
                style={{ background: `hsl(${hue} 85% 88% / 0.75)` }}
                aria-hidden
              />
              {/*
                * Illustration, not a photograph of this unit, so it is
                * decorative and the alt text is empty: the featured product is
                * already named in the eyebrow above and priced in the chip
                * below, and announcing it a third time is noise on a screen
                * reader.
                *
                * The drop shadow is light. The old one was tuned for an opaque
                * laptop cut-out; at that weight it prints a hard grey copy of
                * the translucent ribbon underneath itself.
                */}
              <Image
                src={heroImage}
                alt=""
                aria-hidden
                width={800}
                height={800}
                priority
                sizes="(max-width: 1024px) 90vw, 520px"
                className="relative w-full max-w-[520px] drop-shadow-[0_18px_34px_rgba(23,28,40,0.14)]"
              />
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-slate-300 bg-white/80 px-3.5 py-1.5 backdrop-blur">
                <span className="mono text-[11px] text-slate-800">
                  {cur} {hero.price.toLocaleString('en-SG')}
                </span>
                <span className="ml-2 text-[10.5px] text-ok-600">{hero.stock} in stock</span>
              </div>
            </div>
          ) : (
            /*
             * No cut-out product shot for this merchant.
             *
             * This used to fall back to a 2x2 grid of text tiles, which meant
             * two of the three storefronts had no hero subject at all and read
             * as unfinished next to Sherpa. A rendered object holds the same
             * position in the composition, so every merchant now gets the same
             * hero shape and the same floating price chip, and the difference
             * between them is the hue rather than the layout.
             */
            <div className="relative flex min-h-[260px] items-center justify-center lg:min-h-[340px]">
              <div
                className="pointer-events-none absolute h-[62%] w-[62%] rounded-full blur-3xl"
                style={{ background: `hsl(${hue} 85% 86% / 0.8)` }}
                aria-hidden
              />
              <Image
                src="/site/tokens/token-ring.png"
                alt=""
                width={520}
                height={520}
                priority
                sizes="(max-width: 1024px) 70vw, 340px"
                aria-hidden
                className="drift relative w-[62%] max-w-[340px] drop-shadow-[0_26px_40px_rgba(23,28,40,0.18)]"
                style={
                  {
                    '--drift-y': '-20px',
                    '--drift-rot': '-6deg',
                    '--drift-spin': '9deg',
                    '--drift-dur': '12s',
                  } as React.CSSProperties
                }
              />
              {cheapest && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-slate-300 bg-white/80 px-3.5 py-1.5 backdrop-blur">
                  <span className="mono text-[11px] text-slate-800">
                    from {cur} {cheapest.price.toLocaleString('en-SG')}
                  </span>
                  <span className="ml-2 text-[10.5px] text-ok-600">{all.length} in the range</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/*
          * Also in stock: a horizontal scroll-snap rail.
          *
          * Deliberately NOT a three-column card row. The catalogue grid below
          * already owns that layout family, and repeating it here would give
          * the page two identical rhythms back to back.
          *
          * Text only, by the same logic. The grid below shows every one of
          * these products with the same photograph, so a thumbnail here put
          * each image on the page twice. The rail earns its place by carrying
          * a different cut of the data — one scannable line per unit.
          */}
        {featured.length > 0 && (
          <div className="relative mx-auto max-w-[1200px] pb-10">
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {featured.map((p) => (
                <a
                  key={p.id}
                  href="#catalogue"
                  className="focus-ring flex min-h-11 w-[236px] shrink-0 snap-start flex-col justify-center gap-1 rounded-xl border border-slate-200 bg-white/70 px-3.5 py-2.5 backdrop-blur transition-colors hover:border-slate-300"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12.5px] font-medium text-slate-900">{p.model}</span>
                    <span className="mono shrink-0 text-[12px] font-semibold text-slate-900">
                      {cur} {p.price.toLocaleString('en-SG')}
                    </span>
                  </span>
                  <span className="truncate text-[10.5px] text-slate-500">
                    {p.brand} · {p.specs.ramGb} GB · {p.specs.storageGb} GB · {p.stock} in stock
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Trust row — real terms from this merchant's profile ── */}
      {profile && (
        <section className="border-b border-slate-200 bg-slate-50/40">
          <div className="mx-auto grid max-w-[1200px] px-5 py-7 sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
            <Promise
              hue={hue}
              icon={<ShieldCheck size={17} weight="duotone" />}
              title={`${profile.standardWarrantyYears}-year warranty`}
              body="Applied to every unit in this catalogue as standard, parts and labour included."
            />
            <Promise
              hue={hue}
              icon={<Truck size={17} weight="duotone" />}
              title={
                profile.standardDeliveryDays === 0
                  ? 'Same-day delivery'
                  : `${profile.standardDeliveryDays}-day delivery`
              }
              body="Quoted on the product, not at checkout. Stock counts on this page are live."
            />
            <Promise
              hue={hue}
              icon={<ListChecks size={17} weight="duotone" />}
              title="Specified honestly"
              body="Full CPU, GPU, memory and weight on every unit. The assistant cannot overstate them."
            />
          </div>
        </section>
      )}

      {/* ── Catalogue ── */}
      <main id="catalogue" className="mx-auto max-w-[1200px] px-5 py-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-bold tracking-tight text-slate-900">All laptops</h2>
            <p className="mt-1 text-[12.5px] text-slate-600">
              {products.length} of {all.length} models
              {sp.brand ? ` · ${sp.brand}` : ''}
              {query ? ` · matching “${sp.q}”` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip href={`/storefront/${merchant.id}`} active={!sp.brand && !query} hue={hue}>
              All
            </FilterChip>
            {brands.map((b) => (
              <FilterChip
                key={b}
                href={`/storefront/${merchant.id}?brand=${encodeURIComponent(b)}`}
                active={sp.brand === b}
                hue={hue}
              >
                {b}
              </FilterChip>
            ))}
          </div>
        </div>

        {products.length === 0 ? (
          <div className="panel px-6 py-14 text-center">
            <p className="text-[13.5px] text-slate-700">Nothing in this catalogue matches that.</p>
            <Link
              href={`/storefront/${merchant.id}`}
              className="focus-ring mt-2 inline-flex min-h-11 items-center rounded-full px-4 text-[12.5px] text-brand-600 hover:underline"
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <div
                key={p.id}
                className="anim-in"
                style={{ animationDelay: `${Math.min(i, 5) * 60}ms` }}
              >
                <ProductCard product={p} currency={cur} hue={hue} />
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 max-w-2xl text-[11.5px] leading-relaxed text-slate-400">
          The assistant in the corner answers only from this catalogue. Ask it about a competitor and it
          will tell you it cannot see one. There is no tool in its session that can.
        </p>
      </main>

      <footer className="border-t border-slate-200 px-5 py-7 text-center text-[11px] text-slate-400">
        {merchant.name} · demo storefront · product data is fabricated for this prototype
      </footer>

      <StorefrontChat merchantId={merchant.id} merchantName={merchant.name} competitorName={competitor} />
    </div>
  )
}

/* ────────────────────────────  Pieces  ──────────────────────────── */

function ProductCard({
  product: p,
  currency,
  hue,
}: {
  product: PublicProduct
  currency: string
  hue: number
}) {
  const out = p.stock <= 0
  return (
    <article
      className={clsx(
        'panel group overflow-hidden transition-all duration-200',
        out ? 'opacity-70' : 'hover:-translate-y-0.5 hover:border-slate-300',
      )}
    >
      {p.imageUrl && (
        <div
          className={clsx(
            'relative flex h-[180px] items-center justify-center overflow-hidden border-b border-slate-200',
            // Press art is square on white, so it sits on a white tile and is
            // contained. object-cover on a short wide card slices the middle
            // out of the laptop. Generated placeholders are drawn for dark and
            // fill the frame instead.
            isPhoto(p.imageUrl) ? 'bg-white p-3' : '',
          )}
        >
          <Image
            src={p.imageUrl}
            alt={p.title}
            width={320}
            height={220}
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 360px"
            className={clsx(
              'h-full w-full transition-transform duration-300',
              isPhoto(p.imageUrl) ? 'object-contain group-hover:scale-[1.04]' : 'object-cover',
            )}
            // Next refuses to optimize SVG unless `dangerouslyAllowSVG` is on,
            // which is not worth enabling for a placeholder.
            unoptimized={!isPhoto(p.imageUrl)}
          />

          <span
            className="absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold tracking-wide"
            // Same AA problem as the hero CTA, and worse here: 46% lightness
            // put this at 2.4:1 on Bizgram's teal, on 9.5px text.
            style={{
              background: `hsl(${hue} 58% 32%)`,
              color: '#fff',
            }}
          >
            {p.brand.toUpperCase()}
          </span>

          {p.condition === 'refurbished' && (
            <span className="absolute right-2.5 top-2.5 rounded-full border border-warn-200 bg-white/85 px-2 py-0.5 text-[9.5px] font-medium text-warn-700 backdrop-blur">
              Refurbished
            </span>
          )}
        </div>
      )}

      <div className="p-4">
        <h3 className="text-[13.5px] leading-snug font-semibold text-slate-900">{p.title}</h3>

        <dl className="mono mt-3 space-y-1 text-[10.5px]">
          <SpecRow label="CPU" value={p.specs.cpu} />
          <SpecRow label="GPU" value={p.specs.gpu} />
          <SpecRow label="Memory" value={`${p.specs.ramGb} GB · ${p.specs.storageGb} GB SSD`} />
          <SpecRow label="Weight" value={p.specs.weightKg ? `${p.specs.weightKg} kg` : 'not listed'} />
        </dl>

        <div className="mt-3.5 flex items-end justify-between border-t border-slate-200 pt-3.5">
          <div>
            <div className="mono text-[17px] font-bold tracking-tight text-slate-900">
              {currency} {p.price.toLocaleString('en-SG')}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {p.warrantyYears}-year warranty included
            </div>
          </div>
          <span
            className={clsx(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              out
                ? 'border-bad-200 bg-bad-50 text-bad-600'
                : p.stock <= 3
                  ? 'border-warn-200 bg-warn-50 text-warn-700'
                  : 'border-ok-200 bg-ok-50 text-ok-600',
            )}
          >
            {out ? 'Out of stock' : `${p.stock} in stock`}
          </span>
        </div>
      </div>
    </article>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="truncate text-right text-slate-700">{value}</dd>
    </div>
  )
}

function HeroSpec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="mono mt-0.5 text-[14px] font-semibold text-slate-900">{value}</dd>
    </div>
  )
}

/**
 * A merchant term, read from its own profile.
 *
 * Not a card: elevation would imply these are three separate things to choose
 * between. They are one band of terms, so a hairline divider groups them and
 * the surface stays flat (skill 4.4).
 */
function Promise({
  hue,
  icon,
  title,
  body,
}: {
  hue: number
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex gap-3 px-0 py-2 sm:px-6 sm:first:pl-0 sm:last:pr-0">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `hsl(${hue} 76% 94%)`, color: `hsl(${hue} 58% 38%)` }}
      >
        {icon}
      </span>
      <div>
        <div className="text-[13px] font-semibold text-slate-900">{title}</div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-slate-600">{body}</p>
      </div>
    </div>
  )
}

function FilterChip({
  href,
  active,
  hue,
  children,
}: {
  href: string
  active: boolean
  hue: number
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={clsx(
        // min-h-11 is 44px — the WCAG 2.5.8 target floor. These chips are the
        // page's main interaction and were sitting at ~26px.
        'focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-[12px] transition-colors',
        active ? 'text-brand-700 font-medium' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800',
      )}
      style={active ? { borderColor: `hsl(${hue} 55% 72%)`, background: `hsl(${hue} 78% 95%)` } : undefined}
    >
      {children}
    </Link>
  )
}

/* ────────────────────────────  Helpers  ──────────────────────────── */

/**
 * Real photography versus a generated placeholder.
 *
 * The two need opposite treatment: press art is square on a white background
 * and must be contained on a light tile, while the generated SVG is drawn for
 * a dark surface and fills the frame.
 */
function isPhoto(url: string): boolean {
  return !url.endsWith('.svg')
}

/**
 * The unit to lead with.
 *
 * Prefers an in-stock product that has a cut-out hero shot, since that is what
 * the layout is built around. Falls back to the most capable in-stock unit so
 * a merchant with no hero asset still gets a sensible feature.
 */
function pickHero(products: PublicProduct[]): PublicProduct | null {
  const inStock = products.filter((p) => p.stock > 0)
  if (!inStock.length) return null
  const withArt = inStock.filter((p) => heroImageForSku(p.sku))
  const pool = withArt.length ? withArt : inStock
  return [...pool].sort(
    (a, b) =>
      Number(b.specs.dedicatedGpu) - Number(a.specs.dedicatedGpu) ||
      b.specs.ramGb - a.specs.ramGb ||
      b.price - a.price,
  )[0]
}
