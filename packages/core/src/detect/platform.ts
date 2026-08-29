import type { DetectionResult, Platform } from '../schemas'

/**
 * Deterministic commerce-platform fingerprinting.
 *
 * The LLM is allowed to narrate this result in the onboarding conversation but
 * is never the detector — the signals below are HTTP headers, asset hosts and
 * markup markers.
 */

interface Fingerprint {
  platform: Platform
  commerce: Platform
  weight: number
  signal: string
  test: (ctx: { html: string; headers: Headers; url: string }) => boolean
}

const FINGERPRINTS: Fingerprint[] = [
  {
    platform: 'shopify',
    commerce: 'shopify',
    weight: 0.45,
    signal: 'cdn.shopify.com asset host referenced in markup',
    test: ({ html }) => /cdn\.shopify\.com/i.test(html),
  },
  {
    platform: 'shopify',
    commerce: 'shopify',
    weight: 0.3,
    signal: 'Shopify global object (window.Shopify) present',
    test: ({ html }) => /window\.Shopify|Shopify\.theme|shopify-features/i.test(html),
  },
  {
    platform: 'shopify',
    commerce: 'shopify',
    weight: 0.25,
    signal: 'x-shopid / x-shardid response header',
    test: ({ headers }) => Boolean(headers.get('x-shopid') || headers.get('x-shardid')),
  },
  {
    platform: 'shopify',
    commerce: 'shopify',
    weight: 0.2,
    signal: 'powered-by: Shopify',
    test: ({ headers }) => /shopify/i.test(headers.get('powered-by') ?? ''),
  },
  {
    platform: 'shopify',
    commerce: 'shopify',
    weight: 0.5,
    signal: 'myshopify.com domain',
    test: ({ url }) => /\.myshopify\.com/i.test(url),
  },
  {
    platform: 'woocommerce',
    commerce: 'woocommerce',
    weight: 0.45,
    signal: 'woocommerce stylesheet / generator meta',
    test: ({ html }) => /woocommerce(-layout|\.css|\/assets)|generator" content="WooCommerce/i.test(html),
  },
  {
    platform: 'woocommerce',
    commerce: 'woocommerce',
    weight: 0.2,
    signal: 'wp-content asset path (WordPress layer)',
    test: ({ html }) => /wp-content\/(themes|plugins)/i.test(html),
  },
  {
    platform: 'wix',
    commerce: 'wix',
    weight: 0.5,
    signal: 'wix static asset host / X-Wix-Request-Id header',
    test: ({ html, headers }) =>
      /static\.wixstatic\.com|wix-code/i.test(html) || Boolean(headers.get('x-wix-request-id')),
  },
  {
    platform: 'squarespace',
    commerce: 'squarespace',
    weight: 0.5,
    signal: 'squarespace CDN / static assets',
    test: ({ html }) => /squarespace\.com|static1\.squarespace/i.test(html),
  },
  {
    platform: 'bigcommerce',
    commerce: 'bigcommerce',
    weight: 0.5,
    signal: 'bigcommerce CDN assets',
    test: ({ html }) => /cdn\d*\.bigcommerce\.com/i.test(html),
  },
  {
    platform: 'magento',
    commerce: 'magento',
    weight: 0.45,
    signal: 'Magento static/version path',
    test: ({ html }) => /static\/version\d+\/frontend|Magento_/i.test(html),
  },
]

/** Domains we ship as demo fixtures so onboarding works offline. */
const DEMO_FIXTURES: Record<string, Omit<DetectionResult, 'url' | 'fetchedAt'>> = {
  'sherpa-computers-demo.myshopify.com': {
    websitePlatform: 'shopify',
    commercePlatform: 'shopify',
    confidence: 0.99,
    signals: [
      'myshopify.com domain',
      'cdn.shopify.com asset host referenced in markup',
      'Shopify global object (window.Shopify) present',
      'x-shopid response header',
    ],
    method: 'demo-fixture',
  },
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    return u.origin + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return ''
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Domain-only heuristic used when the site cannot be fetched. */
export function detectFromDomain(url: string): DetectionResult {
  const host = hostOf(url)
  const fixture = DEMO_FIXTURES[host]
  if (fixture) return { ...fixture, url, fetchedAt: new Date().toISOString() }

  if (/\.myshopify\.com$/.test(host)) {
    return {
      websitePlatform: 'shopify',
      commercePlatform: 'shopify',
      confidence: 0.95,
      signals: ['myshopify.com domain'],
      method: 'domain-heuristic',
      url,
      fetchedAt: new Date().toISOString(),
    }
  }
  if (/(^|\.)(shopify)\./.test(host)) {
    return {
      websitePlatform: 'shopify',
      commercePlatform: 'shopify',
      confidence: 0.8,
      signals: ['shopify domain'],
      method: 'domain-heuristic',
      url,
      fetchedAt: new Date().toISOString(),
    }
  }
  return {
    websitePlatform: 'unknown',
    commercePlatform: 'unknown',
    confidence: 0.2,
    signals: ['site could not be fetched; no domain-level platform marker'],
    method: 'domain-heuristic',
    url,
    fetchedAt: new Date().toISOString(),
  }
}

export function scoreFingerprints(ctx: { html: string; headers: Headers; url: string }): DetectionResult {
  const totals = new Map<Platform, { weight: number; commerce: Platform; signals: string[] }>()
  for (const fp of FINGERPRINTS) {
    let hit = false
    try {
      hit = fp.test(ctx)
    } catch {
      hit = false
    }
    if (!hit) continue
    const key = fp.platform
    const cur = totals.get(key) ?? { weight: 0, commerce: fp.commerce, signals: [] }
    cur.weight += fp.weight
    cur.signals.push(fp.signal)
    totals.set(key, cur)
  }

  if (totals.size === 0) {
    return {
      websitePlatform: 'custom',
      commercePlatform: 'unknown',
      confidence: 0.35,
      signals: ['no known platform fingerprint found in HTML or headers'],
      method: 'http-fingerprint',
      url: ctx.url,
      fetchedAt: new Date().toISOString(),
    }
  }

  const [platform, agg] = [...totals.entries()].sort((a, b) => b[1].weight - a[1].weight)[0]
  return {
    websitePlatform: platform,
    commercePlatform: agg.commerce,
    confidence: Math.min(0.99, Number(agg.weight.toFixed(2))),
    signals: agg.signals,
    method: 'http-fingerprint',
    url: ctx.url,
    fetchedAt: new Date().toISOString(),
  }
}

/** Strip scripts/styles and cap length before any of this reaches a model. */
export function sanitizeHtml(html: string, maxChars = 20000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .slice(0, maxChars)
}

export async function detectPlatform(rawUrl: string, opts: { timeoutMs?: number } = {}): Promise<DetectionResult> {
  const url = normalizeUrl(rawUrl)
  if (!url) {
    return {
      websitePlatform: 'unknown',
      commercePlatform: 'unknown',
      confidence: 0,
      signals: ['input is not a valid URL'],
      method: 'domain-heuristic',
      url: rawUrl,
      fetchedAt: new Date().toISOString(),
    }
  }

  const host = hostOf(url)
  const fixture = DEMO_FIXTURES[host]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'VisaAgenticCommerce-Onboarding/0.1 (+platform-detector)' },
    })
    const html = (await res.text()).slice(0, 400_000)
    const detected = scoreFingerprints({ html, headers: res.headers, url })
    if (!fixture) return detected

    // A shipped fixture describes the markers a fully-provisioned instance of
    // this demo store carries. When live detection agrees on the platform,
    // union the evidence; when it finds nothing, fall back to the fixture so a
    // parked or unreachable demo domain does not stall onboarding.
    if (detected.commercePlatform === fixture.commercePlatform) {
      return {
        ...detected,
        confidence: Math.max(detected.confidence, fixture.confidence),
        signals: Array.from(new Set([...detected.signals, ...fixture.signals])),
      }
    }
    if (detected.websitePlatform === 'custom') {
      return { ...fixture, url, fetchedAt: new Date().toISOString() }
    }
    return detected
  } catch {
    return detectFromDomain(url)
  } finally {
    clearTimeout(timer)
  }
}
