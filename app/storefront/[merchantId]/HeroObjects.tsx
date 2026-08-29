import Image from 'next/image'
import clsx from 'clsx'

/**
 * Rendered objects floating in the storefront hero.
 *
 * These are generated 3D renders with a real alpha channel, not CSS shapes, so
 * they carry a specular highlight and a chrome rim that no gradient div gets
 * near. They are decoration and nothing else: `aria-hidden`, no text, and
 * nothing a buyer needs is ever placed on top of one.
 *
 * The disc is picked by merchant hue, so Bizgram does not get a lilac object
 * floating over its mint hero. The ring is iridescent and reads as neutral, so
 * all three share it. Same rule as the rest of the storefront: a tint may vary
 * in intensity, never in hue.
 *
 * Placement is anchored to the section's outer edges rather than to the
 * content grid. The hero has two layouts depending on whether the merchant has
 * hero art, and edge anchoring is the only arrangement that survives both
 * without landing on a price.
 *
 * Three objects, not more. The hero illustration behind them already contains
 * a ribbon and its own floating spheres, and a fourth object here put one in
 * the gap between the headline and the product, which is the one part of the
 * composition that needs to stay empty.
 *
 * Everything here is hidden below `md`. On a phone the hero is a single
 * column and there is no outer margin left to float anything in.
 */

/** The palette disc nearest a merchant's hue. */
function discFor(hue: number): string {
  if (hue < 200) return '/site/tokens/token-ok.png' // 178, strong cyan
  if (hue < 280) return '/site/tokens/token-brand.png' // 220, wisteria blue
  return '/site/tokens/token-berry.png' // 340, wild strawberry
}

const RING = '/site/tokens/token-ring.png'

export function HeroObjects({ hue }: { hue: number }) {
  const disc = discFor(hue)

  /** Drift periods share no common factor, so the group never resynchronises. */
  const objects = [
    {
      key: 'disc-lead',
      // Large, top right. The one object allowed to read as a subject.
      src: disc,
      className: 'right-[1%] top-[2%] w-[112px] lg:w-[152px]',
      style: {
        '--drift-y': '-22px',
        '--drift-x': '6px',
        '--drift-rot': '-8deg',
        '--drift-spin': '7deg',
        '--drift-dur': '11s',
      },
    },
    {
      key: 'ring',
      // Low right, sitting deeper. Reads as the far end of the ribbon's arc.
      src: RING,
      className: 'right-[5%] bottom-[3%] w-[92px] opacity-85 lg:w-[124px]',
      style: {
        '--drift-y': '14px',
        '--drift-x': '-10px',
        '--drift-rot': '4deg',
        '--drift-spin': '-6deg',
        '--drift-dur': '13s',
        '--drift-delay': '-4s',
      },
    },
    {
      key: 'disc-echo',
      // Left edge, half out of frame, behind the copy. Gives the left side of
      // the band something to catch, so the hero is not lopsided.
      src: disc,
      className: '-left-[3%] bottom-[14%] w-[88px] opacity-65',
      style: {
        '--drift-y': '-16px',
        '--drift-rot': '6deg',
        '--drift-spin': '5deg',
        '--drift-dur': '15s',
        '--drift-delay': '-7s',
      },
    },
  ]

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 bottom-[124px] hidden md:block"
      aria-hidden
    >
      {objects.map((o) => (
        <div
          key={o.key}
          className={clsx('drift absolute', o.className)}
          style={o.style as React.CSSProperties}
        >
          {/* A soft bloom in the merchant's hue under each object, so it looks
              lit by the same page it is sitting on. */}
          <div
            className="absolute inset-[12%] rounded-full blur-2xl"
            style={{ background: `hsl(${hue} 80% 82% / 0.45)` }}
          />
          <Image
            src={o.src}
            alt=""
            width={200}
            height={200}
            sizes="200px"
            className="relative h-auto w-full drop-shadow-[0_18px_28px_rgba(23,28,40,0.16)]"
          />
        </div>
      ))}
    </div>
  )
}
