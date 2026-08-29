import { z } from 'zod'
import { nextQuestion } from '@agents/onboarding-agent'
import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import type { MerchantProfile } from '@core/schemas'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 30

const Body = z.object({ sessionId: z.string() })

/**
 * Mints an ephemeral OpenAI Realtime client secret for the browser.
 *
 * The standard OPENAI_API_KEY never leaves this handler — the browser receives
 * a short-lived client secret scoped to one Realtime session, which is the
 * documented WebRTC flow.
 *
 * The interview instructions are assembled here from the merchant's *current*
 * incomplete profile, so the voice agent only asks what is still missing.
 */
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const env = serverEnv()
  const store = getStore()
  const session = await store.getOnboardingSession(data.sessionId)
  if (!session) return bad('unknown onboarding session', 404)

  const profile = (session.draftProfile ?? {}) as Partial<MerchantProfile>
  const missing: string[] = []
  const asked: string[] = []
  for (let i = 0; i < 6; i++) {
    const q = nextQuestion(profile, asked)
    if (!q) break
    asked.push(q.qid)
    missing.push(q.text)
  }

  const known = {
    objective: profile.primaryObjective ?? null,
    maxDiscountPct: profile.maxDiscountPct ?? null,
    minMarginPct: profile.minMarginPct ?? null,
    bundleAllowance: profile.bundleAllowance ?? null,
    knownRules: (profile.salesRules ?? []).map((r) => r.text),
    catalogueSize: session.productCount,
  }

  const instructions = [
    'You are onboarding a laptop retailer onto an agentic commerce platform, by voice.',
    'You are brisk and concrete. No small talk beyond one short greeting. Never read numbers back as lists.',
    `Their catalogue is already connected (${session.productCount} products), so never ask about products, prices or stock.`,
    `Already known, do NOT ask again: ${JSON.stringify(known)}`,
    missing.length
      ? `Ask only these, one at a time, in this order:\n${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : 'You already have everything. Confirm the rules briefly and end the call.',
    'When you have the answers, say you will put the rules on screen for them to approve, then stop talking.',
  ].join('\n\n')

  if (!env.openaiApiKey || !env.enableRealtimeVoice) {
    return ok({
      mode: 'recorder_fallback' as const,
      reason: env.openaiApiKey
        ? 'ENABLE_REALTIME_VOICE is off'
        : 'OPENAI_API_KEY is not configured on this deployment',
      instructions,
      questions: missing,
    })
  }

  try {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.openaiApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: env.openaiRealtimeModel,
          instructions,
          audio: {
            input: { transcription: { model: 'whisper-1' } },
            output: { voice: 'alloy' },
          },
        },
      }),
    })

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      return ok({
        mode: 'recorder_fallback' as const,
        reason: `Realtime session mint failed (${res.status}): ${detail}`,
        instructions,
        questions: missing,
      })
    }

    const json = (await res.json()) as { value?: string; client_secret?: { value?: string }; expires_at?: number }
    const clientSecret = json.value ?? json.client_secret?.value
    if (!clientSecret) {
      return ok({
        mode: 'recorder_fallback' as const,
        reason: 'Realtime response did not contain a client secret',
        instructions,
        questions: missing,
      })
    }

    return ok({
      mode: 'openai_realtime' as const,
      clientSecret,
      model: env.openaiRealtimeModel,
      expiresAt: json.expires_at ?? null,
      questions: missing,
    })
  } catch (err) {
    return ok({
      mode: 'recorder_fallback' as const,
      reason: `Realtime unreachable: ${(err as Error).message}`,
      instructions,
      questions: missing,
    })
  }
}
