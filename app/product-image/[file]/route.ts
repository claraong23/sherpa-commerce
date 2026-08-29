import { getStore } from '@core/db'

export const runtime = 'nodejs'

/**
 * Deterministic SVG product placeholders.
 *
 * Generated locally so the demo has no external image dependency and renders
 * identically offline. A real catalogue would use merchant imagery.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const sku = decodeURIComponent(file).replace(/\.svg$/i, '')

  const merchants = await getStore().listMerchants()
  let brand = 'Laptop'
  let hue = 210
  for (const m of merchants) {
    const p = await getStore().getProductBySku(m.id, sku)
    if (p) {
      brand = p.brand
      hue = m.logoHue
      break
    }
  }

  const seed = [...sku].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const tilt = (seed % 7) - 3

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" role="img" aria-label="${escapeXml(sku)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 26% 17%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 22% 10%)"/>
    </linearGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 60% 62%)" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="hsl(${(hue + 55) % 360} 55% 40%)" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#bg)"/>
  <g transform="translate(160 108) rotate(${tilt}) translate(-160 -108)">
    <rect x="72" y="42" width="176" height="104" rx="7" fill="#0b0e14" stroke="hsl(${hue} 30% 45%)" stroke-width="1.5"/>
    <rect x="80" y="50" width="160" height="88" rx="3" fill="url(#screen)"/>
    <rect x="88" y="60" width="72" height="5" rx="2.5" fill="#ffffff" opacity="0.55"/>
    <rect x="88" y="72" width="112" height="4" rx="2" fill="#ffffff" opacity="0.3"/>
    <rect x="88" y="82" width="94" height="4" rx="2" fill="#ffffff" opacity="0.22"/>
    <path d="M56 150 L264 150 L276 166 L44 166 Z" fill="#131722" stroke="hsl(${hue} 26% 40%)" stroke-width="1.5"/>
    <rect x="140" y="155" width="40" height="4" rx="2" fill="hsl(${hue} 40% 55%)" opacity="0.5"/>
  </g>
  <text x="16" y="28" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="600" fill="#ffffff" opacity="0.82">${escapeXml(brand)}</text>
  <text x="16" y="188" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="9.5" fill="#ffffff" opacity="0.45">${escapeXml(sku)}</text>
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
