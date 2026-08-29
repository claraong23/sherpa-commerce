import { getStore } from '@core/db'

export const runtime = 'nodejs'

/**
 * Deterministic SVG product placeholders, drawn for a LIGHT surface.
 *
 * Generated locally so the demo has no external image dependency and renders
 * identically offline. A real catalogue would use merchant imagery.
 *
 * Flat fills only. A gradient panel where a photograph belongs reads as an
 * image that failed to load; a flat slate tile with a drawn outline reads as
 * a deliberate stand-in.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const sku = decodeURIComponent(file).replace(/\.svg$/i, '')

  const merchants = await getStore().listMerchants()
  let hue = 210
  for (const m of merchants) {
    const p = await getStore().getProductBySku(m.id, sku)
    if (p) {
      hue = m.logoHue
      break
    }
  }

  const seed = [...sku].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const tilt = (seed % 7) - 3

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" role="img" aria-label="${escapeXml(sku)}">
  <rect width="320" height="200" fill="#f4f7fb"/>
  <g transform="translate(160 108) rotate(${tilt}) translate(-160 -108)">
    <rect x="72" y="42" width="176" height="104" rx="7" fill="#ffffff" stroke="hsl(${hue} 28% 72%)" stroke-width="1.5"/>
    <rect x="80" y="50" width="160" height="88" rx="3" fill="hsl(${hue} 44% 70%)"/>
    <rect x="88" y="60" width="72" height="5" rx="2.5" fill="#ffffff" opacity="0.85"/>
    <rect x="88" y="72" width="112" height="4" rx="2" fill="#ffffff" opacity="0.6"/>
    <rect x="88" y="82" width="94" height="4" rx="2" fill="#ffffff" opacity="0.45"/>
    <path d="M56 150 L264 150 L276 166 L44 166 Z" fill="#f4f7fb" stroke="hsl(${hue} 26% 70%)" stroke-width="1.5"/>
    <rect x="140" y="155" width="40" height="4" rx="2" fill="hsl(${hue} 34% 62%)" opacity="0.7"/>
  </g>
  <text x="16" y="188" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="9.5" fill="#4e5871" opacity="0.65">${escapeXml(sku)}</text>
</svg>`

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400, immutable',
    },
  })
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c,
  )
}
