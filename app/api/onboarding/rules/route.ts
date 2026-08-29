import { z } from 'zod'
import { buildSandbox } from '@agents/onboarding-agent'
import { getStore } from '@core/db'
import { nowIso } from '@core/ids'
import type { SalesRule } from '@core/schemas'
import { SalesRuleSchema } from '@core/schemas'
import { bad, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'

const Body = z.object({
  sessionId: z.string(),
  action: z.enum(['update_rule', 'remove_rule', 'approve_all', 'update_profile', 'advance_stage']),
  rule: SalesRuleSchema.partial().extend({ id: z.string() }).optional(),
  profile: z
    .object({
      primaryObjective: z.enum(['margin', 'conversion', 'inventory_turnover', 'aov']).optional(),
      maxDiscountPct: z.number().min(0).max(60).optional(),
      minMarginPct: z.number().min(0).max(90).optional(),
      bundleAllowance: z.number().min(0).max(1000).optional(),
      standardWarrantyYears: z.number().min(0).max(5).optional(),
      standardDeliveryDays: z.number().min(0).max(30).optional(),
    })
    .optional(),
  stage: z.enum(['rules_review', 'payment_setup', 'voice_optional']).optional(),
})

/**
 * Merchant rule review. Nothing here becomes enforceable until `approved` is
 * true — the offer validator ignores unapproved rules.
 */
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  const session = await store.getOnboardingSession(data.sessionId)
  if (!session) return bad('unknown onboarding session', 404)

  const draft = { ...(session.draftProfile ?? {}) }
  let rules = [...((draft.salesRules ?? []) as SalesRule[])]

  switch (data.action) {
    case 'update_rule': {
      if (!data.rule) return bad('rule is required')
      rules = rules.map((r) => (r.id === data.rule!.id ? { ...r, ...data.rule } : r))
      break
    }
    case 'remove_rule': {
      if (!data.rule) return bad('rule is required')
      rules = rules.filter((r) => r.id !== data.rule!.id)
      break
    }
    case 'approve_all': {
      rules = rules.map((r) => ({ ...r, approved: true }))
      break
    }
    case 'update_profile': {
      Object.assign(draft, data.profile ?? {})
      break
    }
    case 'advance_stage':
      break
  }

  draft.salesRules = rules

  const nextStage =
    data.action === 'approve_all'
      ? 'payment_setup'
      : data.action === 'advance_stage' && data.stage
        ? data.stage
        : session.stage

  const messages =
    data.action === 'approve_all'
      ? [
          ...session.messages,
          {
            id: `msg_${Math.random().toString(36).slice(2, 10)}`,
            role: 'agent' as const,
            text: 'Rules approved. Your agent is ready to sell — the last thing it needs is payment acceptance. Connect Visa on the right.',
            createdAt: nowIso(),
          },
        ]
      : session.messages

  const updated = await store.upsertOnboardingSession({
    ...session,
    draftProfile: draft,
    stage: nextStage,
    messages,
    updatedAt: nowIso(),
  })

  return ok({ sessionId: updated.id, messages: updated.messages, sandbox: await buildSandbox(updated) })
}
