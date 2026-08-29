import { z } from 'zod'
import { buildSandbox, connectStore } from '@agents/onboarding-agent'
import { getStore } from '@core/db'
import { DetectionResultSchema } from '@core/schemas'
import { detectPlatform, normalizeUrl } from '@core/detect/platform'
import { id, nowIso } from '@core/ids'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  sessionId: z.string(),
  /** 'detect' records the URL and fingerprints it; 'confirm' connects the store. */
  action: z.enum(['detect', 'confirm', 'override']),
  url: z.string().max(300).optional(),
  platform: z.string().max(40).optional(),
})

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  const session = await store.getOnboardingSession(data.sessionId)
  if (!session) return bad('unknown onboarding session', 404)

  if (data.action === 'detect') {
    const url = normalizeUrl(data.url ?? '')
    if (!url) return bad('that does not look like a URL')
    const detection = await detectPlatform(url)
    const updated = await store.upsertOnboardingSession({
      ...session,
      websiteUrl: url,
      detection,
      stage: 'platform_detected',
      messages: [
        ...session.messages,
        { id: id('msg'), role: 'user', text: url, createdAt: nowIso() },
        {
          id: id('msg'),
          role: 'agent',
          text:
            detection.commercePlatform === 'shopify'
              ? `I detected Shopify (${Math.round(detection.confidence * 100)}% confidence) from ${detection.signals.length} signal${detection.signals.length === 1 ? '' : 's'}. Is that correct?`
              : `I could not confirm a supported commerce platform — my best read is ${detection.websitePlatform} at ${Math.round(detection.confidence * 100)}% confidence. Pick the right one and I'll use the matching adapter.`,
          createdAt: nowIso(),
        },
      ],
      updatedAt: nowIso(),
    })
    return ok({ sessionId: updated.id, messages: updated.messages, sandbox: await buildSandbox(updated) })
  }

  if (data.action === 'override') {
    const detection = DetectionResultSchema.parse({
      websitePlatform: data.platform ?? 'custom',
      commercePlatform: data.platform ?? 'custom',
      confidence: 1,
      signals: ['merchant selected the platform manually'],
      method: 'domain-heuristic',
      url: session.websiteUrl ?? '',
      fetchedAt: nowIso(),
    })
    const updated = await store.upsertOnboardingSession({
      ...session,
      detection,
      stage: 'platform_detected',
      updatedAt: nowIso(),
    })
    return ok({ sessionId: updated.id, messages: updated.messages, sandbox: await buildSandbox(updated) })
  }

  // confirm
  if (!session.detection) return bad('detect the platform before confirming')
  const result = await connectStore({ session, detection: session.detection })
  return ok({
    sessionId: result.session.id,
    messages: result.session.messages,
    sandbox: await buildSandbox(result.session),
    productCount: result.productCount,
    mode: result.mode,
  })
}
