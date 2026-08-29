import { z } from 'zod'
import { buildSandbox, finalizeMerchantAgent } from '@agents/onboarding-agent'
import { getStore } from '@core/db'
import { serverEnv } from '@core/env'
import { nowIso } from '@core/ids'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  sessionId: z.string(),
  action: z.enum(['connect_visa', 'finalize', 'toggle_network']),
  networkEnabled: z.boolean().optional(),
})

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  const env = serverEnv()
  const session = await store.getOnboardingSession(data.sessionId)
  if (!session) return bad('unknown onboarding session', 404)

  if (data.action === 'toggle_network') {
    if (!session.merchantId) return bad('no merchant yet')
    const merchant = await store.getMerchant(session.merchantId)
    if (!merchant) return bad('merchant not found', 404)
    await store.upsertMerchant({ ...merchant, networkEnabled: data.networkEnabled ?? !merchant.networkEnabled })
    return ok({ sessionId: session.id, sandbox: await buildSandbox(session) })
  }

  if (data.action === 'connect_visa') {
    const sandboxConfigured = env.visaMode === 'sandbox' && Boolean(env.visaMerchantId && env.visaKeyId)
    const updated = await store.upsertOnboardingSession({
      ...session,
      visaConnected: true,
      stage: 'payment_setup',
      messages: [
        ...session.messages,
        {
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: 'agent',
          text: sandboxConfigured
            ? 'Visa acceptance configured against the sandbox. Generating your merchant agent now.'
            : 'Visa acceptance active in simulated mode — no Visa Acceptance credentials are configured on this deployment, so authorizations are simulated to the documented request/response model. Generating your merchant agent now.',
          createdAt: nowIso(),
        },
      ],
      updatedAt: nowIso(),
    })
    return ok({ sessionId: updated.id, messages: updated.messages, sandbox: await buildSandbox(updated) })
  }

  // finalize
  try {
    const result = await finalizeMerchantAgent({ session })
    return ok({
      sessionId: result.session.id,
      messages: result.session.messages,
      sandbox: await buildSandbox(result.session),
      merchant: {
        id: result.merchant.id,
        name: result.merchant.name,
        agentId: result.merchant.agentId,
        networkEnabled: result.merchant.networkEnabled,
      },
      profile: result.profile,
    })
  } catch (err) {
    return bad((err as Error).message, 409)
  }
}
