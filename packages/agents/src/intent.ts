import { z } from 'zod'
import { id, isoIn, nowIso } from '@core/ids'
import {
  type CustomerIntent,
  type HardConstraints,
  type IntentContext,
  type Preferences,
  HardConstraintsSchema,
  IntentContextSchema,
  PreferencesSchema,
  PREFERENCE_KEYS,
} from '@core/schemas'
import { scrubForPrompt, structured } from './llm'

/**
 * Customer intent extraction.
 *
 * The LLM turns free text into a candidate structure; every field is then
 * validated and clamped, and the deterministic extractor below runs regardless
 * so numeric constraints (budget, RAM, weight) come from the text itself rather
 * than from model arithmetic. Deterministic values win on conflict for anything
 * that a hard filter will later enforce.
 */

const ExtractionSchema = z.object({
  budgetMax: z.number().nullable().optional(),
  useCases: z.array(z.string()).max(8).default([]),
  requiresDedicatedGpu: z.boolean().nullable().optional(),
  requiresCuda: z.boolean().nullable().optional(),
  excludeRefurbished: z.boolean().nullable().optional(),
  minRamGb: z.number().nullable().optional(),
  maxWeightKg: z.number().nullable().optional(),
  maxDeliveryDays: z.number().nullable().optional(),
  targetLongevityYears: z.number().nullable().optional(),
  dailyCarry: z.boolean().nullable().optional(),
  studentContext: z.boolean().nullable().optional(),
  weights: z
    .object({
      value: z.number().min(0).max(1).optional(),
      cadPerformance: z.number().min(0).max(1).optional(),
      gamingPerformance: z.number().min(0).max(1).optional(),
      portability: z.number().min(0).max(1).optional(),
      battery: z.number().min(0).max(1).optional(),
      longevity: z.number().min(0).max(1).optional(),
      warranty: z.number().min(0).max(1).optional(),
      delivery: z.number().min(0).max(1).optional(),
      bundleValue: z.number().min(0).max(1).optional(),
    })
    .default({}),
  clarifyingQuestion: z.string().nullable().default(null),
  summary: z.string().default(''),
})

export type Extraction = z.infer<typeof ExtractionSchema>

/* ─────────────────────────  Deterministic extraction  ───────────────────────── */

const USE_CASE_PATTERNS: { key: string; re: RegExp; weights: Partial<Preferences> }[] = [
  {
    key: 'cad',
    re: /\b(cad|solidworks|autocad|fusion 360|revit|3d model|rendering|render|blender|cae|simulation)\b/i,
    weights: { cadPerformance: 0.4, longevity: 0.12 },
  },
  {
    key: 'engineering',
    re: /\b(engineering|architecture|architect|mechanical|civil)\b/i,
    weights: { cadPerformance: 0.28, longevity: 0.14 },
  },
  {
    key: 'gaming',
    re: /\b(gaming|games?|fps|esports|aaa titles?)\b/i,
    weights: { gamingPerformance: 0.3 },
  },
  {
    // ML training is more compute- and memory-bound than viewport CAD, and
    // buyers expect a longer useful life out of the hardware.
    key: 'machine learning',
    re: /\b(machine learning|ml\b|deep learning|training models?|pytorch|tensorflow|cuda|llm)\b/i,
    weights: { cadPerformance: 0.38, longevity: 0.22 },
  },
  {
    key: 'programming',
    re: /\b(cod(e|ing)|programm|developer|dev work|software|compil|docker|ide)\b/i,
    weights: { longevity: 0.14, portability: 0.1, battery: 0.1 },
  },
  {
    key: 'travel',
    re: /\b(travel|commut|on the go|carry|portable|lightweight|light\b|backpack)\b/i,
    weights: { portability: 0.26, battery: 0.16 },
  },
  {
    key: 'video editing',
    re: /\b(video editing|premiere|davinci|after effects|content creat)\b/i,
    weights: { cadPerformance: 0.24, longevity: 0.12 },
  },
  {
    key: 'study',
    re: /\b(uni|university|student|school|college|study|studying)\b/i,
    weights: { longevity: 0.18, value: 0.12, portability: 0.08 },
  },
  {
    key: 'office',
    re: /\b(office|documents?|spreadsheet|excel|admin work|email)\b/i,
    weights: { value: 0.2, portability: 0.12, battery: 0.12 },
  },
]

/** Parse "under S$1,600", "max 1700", "$1,500 budget", "below 1450". */
export function extractBudget(text: string): number | undefined {
  const patterns = [
    /(?:under|below|less than|max(?:imum)?|up to|budget(?: of)?|around|about|no more than)\s*(?:s?\$|sgd|usd)?\s*([\d,]+(?:\.\d+)?)\s*(k\b)?/gi,
    /(?:s\$|sgd|usd|\$)\s*([\d,]+(?:\.\d+)?)\s*(k\b)?/gi,
  ]
  const found: number[] = []
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      let n = Number(m[1].replace(/,/g, ''))
      if (m[2]) n *= 1000
      if (Number.isFinite(n) && n >= 100 && n <= 20000) found.push(n)
    }
    if (found.length) break
  }
  if (!found.length) return undefined
  return Math.min(...found)
}

export function extractDeterministic(text: string): {
  hard: HardConstraints
  weights: Partial<Preferences>
  context: IntentContext
} {
  const hard: HardConstraints = {}
  const weights: Partial<Preferences> = {}
  const useCases: string[] = []

  const budget = extractBudget(text)
  if (budget !== undefined) hard.maxPrice = budget

  for (const uc of USE_CASE_PATTERNS) {
    if (!uc.re.test(text)) continue
    useCases.push(uc.key)
    for (const [k, v] of Object.entries(uc.weights)) {
      const key = k as keyof Preferences
      weights[key] = Math.max(weights[key] ?? 0, v as number)
    }
  }

  // Hard technical requirements.
  if (/\bcuda\b/i.test(text) || /\bnvidia\b.*\b(need|require|must)\b|\b(need|require|must)\b.*\bnvidia\b/i.test(text)) {
    hard.requiresCuda = true
  }
  if (/\b(dedicated|discrete|dGPU)\b.*\b(gpu|graphics)\b|\b(gpu|graphics)\b.*\b(dedicated|discrete)\b/i.test(text)) {
    hard.requiresDedicatedGpu = true
  }
  if (/\b(no|not|nothing|never|avoid|exclude)\b[^.]{0,24}\brefurb/i.test(text)) {
    hard.excludeRefurbished = true
  }
  const ram = text.match(/\b(?:at least|minimum|min|need|require[sd]?)\s*(\d{1,3})\s*gb\b/i)
  if (ram) {
    const n = Number(ram[1])
    if (n >= 4 && n <= 128) hard.minRamGb = n
  }
  const weight = text.match(/\b(?:under|below|less than|max(?:imum)?|lighter than)\s*([\d.]+)\s*(kg|kilograms?)\b/i)
  if (weight) {
    const n = Number(weight[1])
    if (n > 0.5 && n < 5) hard.maxWeightKg = n
  }
  const delivery = text.match(/\b(?:within|in|need it in|delivered? in)\s*(\d{1,2})\s*(?:days?|business days?)\b/i)
  if (delivery) {
    const n = Number(delivery[1])
    if (n >= 0 && n <= 30) hard.maxDeliveryDays = n
  }
  const warranty = text.match(/\b(?:at least|minimum|min)\s*(\d)\s*(?:-|\s)?year\s*warranty\b/i)
  if (warranty) hard.minWarrantyYears = Number(warranty[1])

  // Explicit priority statements adjust weights.
  if (/\bbattery\b[^.]{0,40}\b(matter|important|priorit|more than)\b/i.test(text)) {
    weights.battery = Math.max(weights.battery ?? 0, 0.28)
  }
  if (/\b(weight|light|portab)\w*\b[^.]{0,40}\b(matter|important|priorit|more than)\b/i.test(text)) {
    weights.portability = Math.max(weights.portability ?? 0, 0.28)
  }
  if (/\b(more than gaming|not.{0,12}gaming|don't game|dont game|no gaming)\b/i.test(text)) {
    weights.gamingPerformance = 0
  }
  if (/\b(cheap|budget|value for money|affordable|as cheap as)\b/i.test(text)) {
    weights.value = Math.max(weights.value ?? 0, 0.3)
  }
  if (/\b(warranty|reliab|support|service)\b/i.test(text)) {
    weights.warranty = Math.max(weights.warranty ?? 0, 0.14)
  }
  if (/\b(urgent|asap|today|tomorrow|next day|quickly)\b/i.test(text)) {
    weights.delivery = Math.max(weights.delivery ?? 0, 0.16)
  }

  const context: IntentContext = {
    useCases,
    dailyCarry: /\b(carry (it )?(around )?(every ?day|daily)|commut|every day|daily)\b/i.test(text) || undefined,
    studentContext: /\b(uni|university|student|college|school)\b/i.test(text) || undefined,
    targetLongevityYears: /\b(last through (uni|university|school|college)|(\d)\s*years?)\b/i.test(text)
      ? Number(text.match(/\b(\d)\s*years?\b/i)?.[1] ?? 4)
      : undefined,
  }
  if (context.targetLongevityYears) {
    weights.longevity = Math.max(weights.longevity ?? 0, 0.2)
  }

  return { hard, weights, context }
}

/** Baseline so an unrecognised prompt still ranks sensibly. */
function baselineWeights(): Preferences {
  return PreferencesSchema.parse({
    value: 0.25,
    cadPerformance: 0,
    gamingPerformance: 0,
    portability: 0.1,
    battery: 0.05,
    longevity: 0.15,
    warranty: 0.1,
    delivery: 0.05,
    bundleValue: 0.05,
  })
}

function mergeWeights(base: Preferences, override: Partial<Preferences>): Preferences {
  const out = { ...base }
  for (const k of PREFERENCE_KEYS) {
    const v = override[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v))
  }
  return out
}

export interface BuildIntentArgs {
  sessionId: string
  text: string
  requestId?: string
  /** Weights carried forward from an earlier turn in the same session. */
  priorPreferences?: Preferences
}

export async function buildCustomerIntent(args: BuildIntentArgs): Promise<CustomerIntent> {
  const text = args.text.slice(0, 2000)
  const det = extractDeterministic(text)

  const llm = await structured({
    schema: ExtractionSchema,
    schemaName: 'CustomerIntentExtraction',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: [
          'You convert a laptop shopper\'s message into structured requirements.',
          'Return JSON with these keys: budgetMax, useCases, requiresDedicatedGpu, requiresCuda,',
          'excludeRefurbished, minRamGb, maxWeightKg, maxDeliveryDays, targetLongevityYears,',
          'dailyCarry, studentContext, weights, clarifyingQuestion, summary.',
          '',
          '"weights" holds relative importance in 0..1 for: value, cadPerformance, gamingPerformance,',
          'portability, battery, longevity, warranty, delivery, bundleValue. They do not need to sum to 1.',
          '',
          'Rules:',
          '- Only set a hard requirement (requiresCuda, requiresDedicatedGpu, minRamGb, excludeRefurbished,',
          '  maxWeightKg) when the user actually stated it as a requirement, not a nice-to-have.',
          '- Set clarifyingQuestion ONLY if the message is too vague to rank laptops at all',
          '  (for example no budget AND no stated use). Otherwise null.',
          '- Never invent a budget the user did not state.',
        ].join('\n'),
      },
      { role: 'user', content: scrubForPrompt(text, 2000) },
    ],
  })

  // Deterministic values take precedence for anything a hard filter enforces.
  const hard: HardConstraints = HardConstraintsSchema.parse({
    maxPrice: det.hard.maxPrice ?? llm?.budgetMax ?? undefined,
    minRamGb: det.hard.minRamGb ?? llm?.minRamGb ?? undefined,
    maxWeightKg: det.hard.maxWeightKg ?? llm?.maxWeightKg ?? undefined,
    maxDeliveryDays: det.hard.maxDeliveryDays ?? llm?.maxDeliveryDays ?? undefined,
    minWarrantyYears: det.hard.minWarrantyYears ?? undefined,
    requiresCuda: det.hard.requiresCuda ?? llm?.requiresCuda ?? undefined,
    requiresDedicatedGpu: det.hard.requiresDedicatedGpu ?? llm?.requiresDedicatedGpu ?? undefined,
    excludeRefurbished: det.hard.excludeRefurbished ?? llm?.excludeRefurbished ?? undefined,
  })

  // A CUDA requirement implies a dedicated NVIDIA GPU.
  if (hard.requiresCuda) hard.requiresDedicatedGpu = true

  const base = args.priorPreferences ?? baselineWeights()
  const preferences = mergeWeights(mergeWeights(base, llm?.weights ?? {}), det.weights)

  // If nothing pushed a workload weight, keep value/longevity carrying the rank.
  const anyWorkload = preferences.cadPerformance + preferences.gamingPerformance > 0
  if (!anyWorkload && preferences.value < 0.2) preferences.value = 0.3

  const context: IntentContext = IntentContextSchema.parse({
    useCases: Array.from(new Set([...(det.context.useCases ?? []), ...((llm?.useCases ?? []) as string[])])).slice(0, 8),
    targetLongevityYears: det.context.targetLongevityYears ?? llm?.targetLongevityYears ?? undefined,
    dailyCarry: det.context.dailyCarry ?? llm?.dailyCarry ?? undefined,
    studentContext: det.context.studentContext ?? llm?.studentContext ?? undefined,
    notes: llm?.summary || undefined,
  })

  // Only ask a clarifying question when we genuinely cannot rank.
  const cannotRank = hard.maxPrice === undefined && context.useCases.length === 0
  const clarifyingQuestion = cannotRank
    ? (llm?.clarifyingQuestion ??
      'What will you mainly use it for, and roughly what budget are you working with?')
    : null

  return {
    requestId: args.requestId ?? id('req'),
    sessionId: args.sessionId,
    rawText: text,
    category: 'laptop',
    currency: 'SGD',
    hardConstraints: hard,
    preferences,
    context,
    clarifyingQuestion,
    createdAt: nowIso(),
    expiresAt: isoIn(1800),
  }
}

/**
 * Mid-conversation preference update ("battery matters more than gaming").
 * Returns null when the message is not a preference statement.
 */
export function applyPreferenceUpdate(text: string, current: Preferences): Preferences | null {
  const det = extractDeterministic(text)
  const relevant = Object.keys(det.weights).length > 0
  const explicit =
    /\b(matters? more|more important|prioriti[sz]e|care more|less important|don'?t care|actually)\b/i.test(text)
  if (!relevant || !explicit) return null

  const next = { ...current }
  for (const [k, v] of Object.entries(det.weights)) {
    next[k as keyof Preferences] = v as number
  }
  // "X more than Y" demotes Y.
  const m = text.match(/\b(battery|weight|portability|gaming|price|value|warranty|performance)\b[^.]{0,30}\bmore than\b[^.]{0,30}\b(battery|weight|portability|gaming|price|value|warranty|performance)\b/i)
  if (m) {
    const map: Record<string, keyof Preferences> = {
      battery: 'battery',
      weight: 'portability',
      portability: 'portability',
      gaming: 'gamingPerformance',
      price: 'value',
      value: 'value',
      warranty: 'warranty',
      performance: 'cadPerformance',
    }
    const up = map[m[1].toLowerCase()]
    const down = map[m[2].toLowerCase()]
    if (up) next[up] = Math.max(next[up], 0.3)
    if (down) next[down] = Math.max(0, next[down] * 0.35)
  }
  return next
}
