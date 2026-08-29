import Link from 'next/link'
import clsx from 'clsx'
import type { Merchant } from '@core/schemas'

/**
 * Jump between the three demo storefronts.
 *
 * This belongs to the demo banner, not to the store header below it. A real
 * merchant's site does not carry links to its competitors, and the whole point
 * of the storefront screen is that it is scoped to one catalogue by
 * construction. Keeping the switcher in the strip that already announces
 * itself as a local preview means nothing inside the merchant's own chrome is
 * pretending to be something it is not.
 *
 * The dot is the merchant's `logoHue`, which is the same value that drives the
 * hero ribbon, the floating objects, the accent and the product badges. It is
 * a colour key rather than decoration: the reason to click is to watch the
 * page re-theme, so the control should show you what you are switching to.
 *
 * No client JS. Three links and an `aria-current` are enough.
 */
export function MerchantSwitcher({
  merchants,
  currentId,
}: {
  merchants: Merchant[]
  currentId: string
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 hidden text-slate-400 lg:inline">Demo stores</span>

      {merchants.map((m) => {
        const active = m.id === currentId
        return (
          <Link
            key={m.id}
            href={`/storefront/${m.id}`}
            aria-current={active ? 'page' : undefined}
            // Filters are deliberately not carried across. The brand facets
            // differ per merchant, so `?brand=Dell` would land on an empty
            // grid at the other store.
            className={clsx(
              'focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 transition-colors',
              active ? 'font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-900',
            )}
            style={active ? { background: `hsl(${m.logoHue} 76% 93%)` } : undefined}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: `hsl(${m.logoHue} 58% 42%)` }}
              aria-hidden
            />
            {m.name}
          </Link>
        )
      })}
    </div>
  )
}
