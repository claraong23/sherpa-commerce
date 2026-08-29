import { z } from 'zod'
import { id } from '@core/ids'
import type { MerchantObjective, MerchantProfile, SalesRule } from '@core/schemas'
import { scrubForPrompt, structured } from './llm'

/**
 * Turns merchant conversation (typed or spoken) into structured, editable
 * rules.
 *
 * Nothing extracted here is enforced until the merchant approves it in the
 * review panel — `approved` starts false and the offer validator ignores
 * unapproved rules.
 */

const ExtractedSchema = z.object({
  primaryObjective: z
    .enum(['margin', 'conversion', 'inventory_turnover', 'aov'])
    .nullable()
    .default(null),
  secondaryObjective: z
    .enum(['margin', 'conversion', 'inventory_turnover', 'aov'])
    .nullable()
    .default(null),
  maxDiscountPct: z.number().min(0).max(60).nullable().default(null),
  minMarginPct: z.number().min(0).max(90).nullable().default(null),
  bundleAllowance: z.number().min(0).max(1000).nullable().default(null),
  standardWarrantyYears: z.number().min(0).max(5).nullable().default(null),
  inventoryPriorities: z.array(z.string().max(40)).max(6).default([]),
  brandTone: z.string().max(200).nullable().default(null),
  rules: z
    .array(
      z.object({
        kind: z.enum([
          'min_spec_for_workload',
          'prefer_upgrade_over_discount',
          'never_recommend',
          'prioritize_tag',
          'bundle_policy',
          'freeform',
        ]),
        text: z.string().max(200),
        workloads: z.array(z.string().max(40)).max(6).optional(),
        minRamGb: z.number().min(0).max(256).optional(),
        tags: z.array(z.string().max(40)).max(6).optional(),
        discountThresholdPct: z.number().min(0).max(60).optional(),
      }),
    )
    .max(8)
    .default([]),
  summary: z.string().max(600).default(''),
})

export type ExtractedRules = z.infer<typeof ExtractedSchema>

export interface ExtractionOutput {
  patch: Partial<MerchantProfile>
  newRules: SalesRule[]
  summary: string
  source: 'llm' | 'deterministic'
}

const OBJECTIVE_PATTERNS: { re: RegExp; objective: MerchantObjective }[] = [
  { re: /\b(move|shift|clear|turnover|turn over|overstock|old stock|sitting|dead stock)\b/i, objective: 'inventory_turnover' },
  { re: /\b(margin|profit|profitab)\b/i, objective: 'margin' },
  { re: /\b(basket|average order|aov|upsell|attach|bundle more)\b/i, objective: 'aov' },
  { re: /\b(conversion|close more|win more|sell more units)\b/i, objective: 'conversion' },
]

/** Regex-based extraction. Always runs; numeric limits from here win. */
export function extractRulesDeterministic(text: string): ExtractionOutput {
  const patch: Partial<MerchantProfile> = {}
  const newRules: SalesRule[] = []

  for (const o of OBJECTIVE_PATTERNS) {
    if (o.re.test(text)) {
      patch.primaryObjective = o.objective
      break
    }
  }

  // Merchants phrase this many ways: "max 8%", "never discount more than 8%",
  // "no more than 8% off", "capped at 8%". The trailing lookahead keeps margin
  // statements out of the discount field.
  const discount = text.match(
    /\b(?:max(?:imum)?|(?:no|never)\s+(?:\w+\s+){0,2}?(?:more than|above|over)|more than|up to|cap(?:ped)? at)\s*(\d{1,2}(?:\.\d)?)\s*%\s*(?!\s*margin)(?:discount|off)?/i,
  )
  if (discount) patch.maxDiscountPct = Number(discount[1])
  else {
    const alt = text.match(/\b(\d{1,2}(?:\.\d)?)\s*%\s*(?:max(?:imum)?\s*)?discount\b/i)
    if (alt) patch.maxDiscountPct = Number(alt[1])
  }

  const margin = text.match(/\b(?:min(?:imum)?|at least|floor of|never below)\s*(\d{1,2}(?:\.\d)?)\s*%\s*margin\b/i)
  if (margin) patch.minMarginPct = Number(margin[1])
  else {
    const alt = text.match(/\bmargin\b[^.]{0,20}?(\d{1,2}(?:\.\d)?)\s*%/i)
    if (alt) patch.minMarginPct = Number(alt[1])
  }

  const bundle = text.match(/\b(?:bundle|accessor\w+|freebie)s?\b[^.]{0,30}?(?:s\$|sgd|\$)?\s*(\d{1,4})\b/i)
  if (bundle) patch.bundleAllowance = Number(bundle[1])

  const warranty = text.match(/\b(\d)\s*(?:-|\s)?years?\s*(?:standard\s*)?warranty\b/i)
  if (warranty) patch.standardWarrantyYears = Number(warranty[1])

  const ramRule = text.match(/\b(?:never|don'?t|do not|no)\b[^.]{0,40}?(\d{1,3})\s*gb\b[^.]{0,40}?\b(cad|engineering|ml|machine learning|3d)\b/i)
  const ramRule2 = text.match(/\b(cad|engineering|ml|machine learning|3d)\b[^.]{0,50}?\b(?:need|require|minimum|at least)s?\b[^.]{0,20}?(\d{1,3})\s*gb\b/i)
  if (ramRule || ramRule2) {
    const minRamGb = Number(ramRule?.[1] ?? ramRule2?.[2])
    const workload = (ramRule?.[2] ?? ramRule2?.[1] ?? 'cad').toLowerCase()
    if (Number.isFinite(minRamGb)) {
      newRules.push({
        id: id('rule'),
        kind: 'min_spec_for_workload',
        text: `${workload.toUpperCase()} customers must be offered at least ${minRamGb} GB RAM.`,
        params: { workloads: [workload], minRamGb },
        approved: false,
        source: 'chat',
      })
    }
  }

  if (/\b(prefer|rather)\b[^.]{0,40}\b(upgrade|ram|accessor\w+|bundle)\b[^.]{0,30}\b(over|instead of|than)\b[^.]{0,20}\b(discount|cash|price cut)\b/i.test(text)) {
    newRules.push({
      id: id('rule'),
      kind: 'prefer_upgrade_over_discount',
      text: 'Prefer bundling an upgrade or accessory over a cash discount.',
      params: { discountThresholdPct: patch.maxDiscountPct ? Math.min(4, patch.maxDiscountPct) : 4 },
      approved: false,
      source: 'chat',
    })
  }

  const priority = text.match(/\b(?:prioriti[sz]e|push|move|focus on|clear)\b\s+((?:previous[- ]gen(?:eration)?|last[- ]gen|old|overstock|refurb\w*|[A-Z][a-z]+)(?:\s+[a-z]+){0,2})/i)
  if (priority) {
    const tag = priority[1].trim().toLowerCase().replace(/\s+/g, '_')
    patch.inventoryPriorities = [tag]
    newRules.push({
      id: id('rule'),
      kind: 'prioritize_tag',
      text: `Prioritise ${priority[1].trim()} inventory when customer fit stays strong.`,
      params: { tags: [tag] },
      approved: false,
      source: 'chat',
    })
  }

  return { patch, newRules, summary: '', source: 'deterministic' }
}

export async function extractMerchantRules(args: {
  text: string
  existing: Partial<MerchantProfile> | null
  source?: SalesRule['source']
}): Promise<ExtractionOutput> {
  const det = extractRulesDeterministic(args.text)

  const llm = await structured({
    schema: ExtractedSchema,
    schemaName: 'MerchantRuleExtraction',
    temperature: 0.1,
    maxTokens: 900,
    messages: [
      {
        role: 'system',
        content: [
          'Extract a laptop retailer\'s commercial rules from what they said.',
          'Return JSON with keys: primaryObjective, secondaryObjective, maxDiscountPct, minMarginPct,',
          'bundleAllowance, standardWarrantyYears, inventoryPriorities, brandTone, rules, summary.',
          '',
          'primaryObjective is one of: margin, conversion, inventory_turnover, aov.',
          'Each entry in "rules" has: kind (min_spec_for_workload | prefer_upgrade_over_discount |',
          'never_recommend | prioritize_tag | bundle_policy | freeform), text (one plain sentence the',
          'merchant would recognise), and optionally workloads, minRamGb, tags, discountThresholdPct.',
          '',
          'Use null for anything the merchant did not state. Do NOT invent numbers.',
          'summary: 1-2 sentences describing what was learned.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: scrubForPrompt(
          `Existing known profile: ${JSON.stringify(args.existing ?? {})}\n\nMerchant said:\n${args.text}`,
          6000,
        ),
      },
    ],
  })

  if (!llm) {
    return { ...det, summary: summarize(det.patch, det.newRules) }
  }

  const patch: Partial<MerchantProfile> = {
    ...(llm.primaryObjective ? { primaryObjective: llm.primaryObjective } : {}),
    ...(llm.secondaryObjective ? { secondaryObjective: llm.secondaryObjective } : {}),
    ...(llm.maxDiscountPct !== null ? { maxDiscountPct: llm.maxDiscountPct } : {}),
    ...(llm.minMarginPct !== null ? { minMarginPct: llm.minMarginPct } : {}),
    ...(llm.bundleAllowance !== null ? { bundleAllowance: llm.bundleAllowance } : {}),
    ...(llm.standardWarrantyYears !== null ? { standardWarrantyYears: llm.standardWarrantyYears } : {}),
    ...(llm.inventoryPriorities.length ? { inventoryPriorities: llm.inventoryPriorities } : {}),
    ...(llm.brandTone ? { brandTone: llm.brandTone } : {}),
    // Deterministic numeric extraction wins — these become enforced limits.
    ...det.patch,
  }

  const llmRules: SalesRule[] = llm.rules.map((r) => ({
    id: id('rule'),
    kind: r.kind,
    text: r.text,
    params: {
      ...(r.workloads ? { workloads: r.workloads } : {}),
      ...(r.minRamGb !== undefined ? { minRamGb: r.minRamGb } : {}),
      ...(r.tags ? { tags: r.tags } : {}),
      ...(r.discountThresholdPct !== undefined ? { discountThresholdPct: r.discountThresholdPct } : {}),
    },
    approved: false,
    source: args.source ?? 'chat',
  }))

  // Deduplicate against deterministic rules of the same kind.
  const merged = [...det.newRules]
  for (const r of llmRules) {
    if (merged.some((m) => m.kind === r.kind && m.kind !== 'freeform')) continue
    merged.push(r)
  }

  return {
    patch,
    newRules: merged.slice(0, 8),
    summary: llm.summary || summarize(patch, merged),
    source: 'llm',
  }
}

function summarize(patch: Partial<MerchantProfile>, rules: SalesRule[]): string {
  const bits: string[] = []
  if (patch.primaryObjective) bits.push(`objective ${patch.primaryObjective.replace('_', ' ')}`)
  if (patch.maxDiscountPct !== undefined) bits.push(`max discount ${patch.maxDiscountPct}%`)
  if (patch.minMarginPct !== undefined) bits.push(`min margin ${patch.minMarginPct}%`)
  if (patch.bundleAllowance !== undefined) bits.push(`bundle allowance ${patch.bundleAllowance}`)
  if (rules.length) bits.push(`${rules.length} sales rule${rules.length > 1 ? 's' : ''}`)
  return bits.length ? `Captured ${bits.join(', ')}.` : 'No new commercial rules detected in that message.'
}
