import { z } from 'zod'
import { buildSandbox, mergeProfile } from '@agents/onboarding-agent'
import { extractMerchantRules } from '@agents/rules-extract'
import { getStore } from '@core/db'
import { id, nowIso } from '@core/ids'
import type { MerchantProfile } from '@core/schemas'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  sessionId: z.string(),
  turns: z
    .array(z.object({ role: z.string().max(20), text: z.string().max(4000) }))
    .max(200)
    .default([]),
  durationSeconds: z.number().min(0).max(7200).default(0),
  mode: z.enum(['openai_realtime', 'recorder_fallback', 'text_simulation']).default('openai_realtime'),
})

/**
 * Post-call structured extraction.
 *
 * The transcript is stored, then turned into candidate rules — all unapproved.
 * The merchant reviews and approves them in the rules panel before any of it
 * affects an offer.
 */
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  const session = await store.getOnboardingSession(data.sessionId)
  if (!session) return bad('unknown onboarding session', 404)

  const merchantTurns = data.turns.filter((t) => /user|merchant|you/i.test(t.role))
  const transcriptText = data.turns.map((t) => `${t.role}: ${t.text}`).join('\n')

  await store.saveVoiceTranscript({
    id: id('voice'),
    onboardingSessionId: session.id,
    merchantId: session.merchantId,
    turns: data.turns.map((t) => ({ ...t, at: nowIso() })),
    durationSeconds: data.durationSeconds,
    mode: data.mode,
    createdAt: nowIso(),
  })

  const existing = (session.draftProfile ?? {}) as Partial<MerchantProfile>

  if (!merchantTurns.length) {
    const updated = await store.upsertOnboardingSession({
      ...session,
      stage: 'rules_review',
      transcript: data.turns,
      updatedAt: nowIso(),
    })
    return ok({
      sessionId: updated.id,
      summary: 'No merchant speech was captured on that call, so no rules were extracted.',
      newRules: [],
      sandbox: await buildSandbox(updated),
    })
  }

  const extraction = await extractMerchantRules({
    text: transcriptText,
    existing,
    source: 'voice',
  })

  const merged = mergeProfile(existing, extraction.patch, extraction.newRules)

  const updated = await store.upsertOnboardingSession({
    ...session,
    draftProfile: merged,
    stage: 'rules_review',
    transcript: data.turns,
    messages: [
      ...session.messages,
      {
        id: id('msg'),
        role: 'agent',
        text: `${extraction.summary} I have put everything I heard on the right as editable rules — nothing is active until you approve it.`,
        createdAt: nowIso(),
      },
    ],
    updatedAt: nowIso(),
  })

  return ok({
    sessionId: updated.id,
    summary: extraction.summary,
    extractionSource: extraction.source,
    newRules: extraction.newRules,
    messages: updated.messages,
    sandbox: await buildSandbox(updated),
  })
}
