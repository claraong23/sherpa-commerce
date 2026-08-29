'use client'

import dynamic from 'next/dynamic'

/**
 * Loader boundary for the WebGL ribbon.
 *
 * three.js is ~135 kB and this canvas is decoration, so it must not sit in the
 * storefront's first-load bundle ahead of the price list. Importing it through
 * `dynamic` with `ssr: false` moves it into its own chunk that is fetched
 * after the page is interactive, and skips a server render that would only
 * have produced an empty div anyway.
 *
 * There is deliberately no loading skeleton. The hero already has its coloured
 * wash underneath, so the band simply arrives; a placeholder shape would flash
 * and then be replaced, which is worse than nothing appearing.
 */
const RibbonCanvas = dynamic(() => import('./RibbonCanvas'), { ssr: false })

export function HeroRibbon({ hue, className }: { hue: number; className?: string }) {
  return <RibbonCanvas hue={hue} className={className} />
}
