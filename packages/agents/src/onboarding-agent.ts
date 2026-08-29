import { getAdapterForMerchant } from '@commerce/index'
import { ShopifyCommerceAdapter } from '@commerce/shopify'
import { getStore } from '@core/db'
import { integrationStatus, serverEnv } from '@core/env'
import { agentIdFor, id, nowIso } from '@core/ids'
import type {
  ChatMessage,
  DetectionResult,
  Merchant,
  MerchantProfile,
  OnboardingSession,
  OnboardingStage,
  Product,
  SalesRule,
} from '@core/schemas'
import { MerchantProfileSchema } from '@core/schemas'
import { complete, llmAvailable, scrubForPrompt } from './llm'
import { extractMerchantRules } from './rules-extract'

/**
 * MERCHANT ONBOARDING AGENT
 *
 * Stage transitions are deterministic; the model handles language. That means
 * the right-hand workspace always reflects a real backend state, and a model
 * outage degrades the wording rather than stranding the merchant mid-flow.
 */

export interface SandboxState {
  stage: OnboardingStage
  detection: DetectionResult | null
  connection: {
    connected: boolean
    mode: 'none' | 'shopify' | 'demo'
    storeDomain: string | null
    productsSynced: number
    inventorySync: 'ready' | 'pending'
    orders: 'ready' | 'demo' | 'not_configured'
  }
  catalogue: {
    id: string
    sku: string
    title: string
    price: number
    currency: string
    ramGb: number
    gpu: string
    stock: number
    imageUrl?: string
  }[]
  profile: Partial<MerchantProfile> | null
  rules: SalesRule[]
  pendingQuestion: { questionId: string; text: string } | null
  voice: { available: boolean; mode: string; transcript: { role: string; text: string }[] }
  visa: {
    connected: boolean
    mode: 'sandbox' | 'mock' | null
    merchantName: string | null
    currency: string
    status: string
  }
  agent: {
    created: boolean
    merchantId: string | null
    agentId: string | null
    storefrontUrl: string | null
    docsUrl: string | null
    networkEnabled: boolean
    embedSnippet: string | null
  }
  checklist: { label: string; done: boolean }[]
  integrations: ReturnType<typeof integrationStatus>
}

export interface OnboardingTurn {
  session: OnboardingSession
  reply: string
  sandbox: SandboxState
  actions: { id: string; label: string; kind: 'primary' | 'secondary' }[]
}

/* ─────────────────────────────  Questions  ───────────────────────────── */

interface Question {
  qid: string
  text: string
  /** Skip if this returns true against the profile we already hold. */
  satisfied: (p: Partial<MerchantProfile>) => boolean
}

const QUESTIONS: Question[] = [
  {
    qid: 'objective',
    text: 'What are you optimising right now — margin, conversion, average order value, or moving inventory?',
    satisfied: (p) => Boolean(p.primaryObjective),
  },
  {
    qid: 'discount',
    text: 'What is the most your agent may ever discount, as a percentage off list?',
    satisfied: (p) => p.maxDiscountPct !== undefined,
  },
  {
    qid: 'margin',
    text: 'Is there a minimum margin it must never go below?',
    satisfied: (p) => p.minMarginPct !== undefined,
  },
  {
    qid: 'bundle',
    text: 'Can it bundle accessories instead of discounting? If so, up to what value per order?',
    satisfied: (p) => p.bundleAllowance !== undefined,
  },
  {
    qid: 'priority',
    text: 'Any stock you specifically want it to push, or anything it should not recommend for certain workloads?',
    satisfied: (p) => Boolean(p.inventoryPriorities?.length) || Boolean(p.salesRules?.length),
  },
  {
    qid: 'knowledge',
    text: 'Anything you know about these machines that is not on the product pages — the kind of thing your best salesperson would say?',
    satisfied: (p) => (p.salesRules?.length ?? 0) >= 2,
  },
]

export function nextQuestion(
  profile: Partial<MerchantProfile>,
  asked: string[],
): Question | null {
  for (const q of QUESTIONS) {
    if (asked.includes(q.qid)) continue
    if (q.satisfied(profile)) continue
    return q
  }
  return null
}

/* ────────────────────────────  Session I/O  ──────────────────────────── */

export async function createOnboardingSession(): Promise<OnboardingSession> {
  const session: OnboardingSession = {
    id: id('onb'),
    merchantId: null,
    stage: 'welcome',
    websiteUrl: null,
    detection: null,
    messages: [
      msg(
        'agent',
        "Paste your store URL and I'll turn what you already have into an AI commerce agent. I'll read your catalogue myself and only ask about the things I can't see.",
      ),
    ],
    draftProfile: null,
    askedQuestionIds: [],
    productCount: 0,
    connected: false,
    connectionMode: 'none',
    visaConnected: false,
    transcript: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  return getStore().upsertOnboardingSession(session)
}

function msg(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: id('msg'), role, text, createdAt: nowIso() }
}

/* ──────────────────────────  Sandbox projection  ────────────────────────── */

export async function buildSandbox(session: OnboardingSession): Promise<SandboxState> {
  const env = serverEnv()
  const store = getStore()
  const merchant = session.merchantId ? await store.getMerchant(session.merchantId) : null
  const products: Product[] = session.merchantId ? await store.listProducts(session.merchantId) : []
  const profile = session.draftProfile ?? null
  const rules = (profile?.salesRules ?? []) as SalesRule[]

  const shopifyLive = ShopifyCommerceAdapter.configured() && env.enableShopifySync
  const approvedRules = rules.filter((r) => r.approved).length

  return {
    stage: session.stage,
    detection: session.detection,
    connection: {
      connected: session.connected,
      mode: session.connectionMode,
      storeDomain: env.shopifyStoreDomain ?? hostOfUrl(session.websiteUrl),
      productsSynced: session.productCount || products.length,
      inventorySync: session.connected ? 'ready' : 'pending',
      orders: !session.connected
        ? 'not_configured'
        : shopifyLive && env.enableShopifyOrderCreate
          ? 'ready'
          : 'demo',
    },
    catalogue: products.slice(0, 8).map((p) => ({
      id: p.id,
      sku: p.sku,
      title: p.title,
      price: p.price,
      currency: p.currency,
      ramGb: p.specs.ramGb,
      gpu: p.specs.gpu,
      stock: p.stock,
      imageUrl: p.imageUrl,
    })),
    profile,
    rules,
    pendingQuestion: null,
    voice: {
      available: Boolean(env.openaiApiKey && env.enableRealtimeVoice),
      mode: env.openaiApiKey && env.enableRealtimeVoice ? 'openai_realtime' : 'recorder_fallback',
      transcript: session.transcript,
    },
    visa: {
      connected: session.visaConnected,
      mode: session.visaConnected ? (env.visaMode === 'sandbox' && env.visaMerchantId ? 'sandbox' : 'mock') : null,
      merchantName: merchant?.name ?? guessNameFromUrl(session.websiteUrl),
      currency: merchant?.currency ?? 'SGD',
      status: session.visaConnected
        ? env.visaMode === 'sandbox' && env.visaMerchantId
          ? 'Sandbox acceptance configured'
          : 'Simulated acceptance active'
        : 'Not connected',
    },
    agent: {
      created: session.stage === 'live' || session.stage === 'agent_generated',
      merchantId: merchant?.id ?? null,
      agentId: merchant?.agentId ?? null,
      storefrontUrl: merchant ? `/storefront/${merchant.id}` : null,
      docsUrl: merchant ? `/docs/merchant/${merchant.id}` : null,
      networkEnabled: merchant?.networkEnabled ?? false,
      embedSnippet: merchant
        ? `<script src="${env.appUrl}/widget.js" data-agent-id="${merchant.agentId}" data-merchant-id="${merchant.id}" async></script>`
        : null,
    },
    checklist: [
      { label: 'Catalogue connected', done: session.connected && (session.productCount > 0 || products.length > 0) },
      { label: 'Merchant rules configured', done: approvedRules > 0 },
      { label: 'Visa acceptance ready', done: session.visaConnected },
      { label: 'Merchant agent created', done: Boolean(merchant) && session.stage === 'live' },
    ],
    integrations: integrationStatus(),
  }
}

function hostOfUrl(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function guessNameFromUrl(url: string | null): string | null {
  const host = hostOfUrl(url)
  if (!host) return null
  const base = host.replace(/^www\./, '').split('.')[0]
  return base
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/* ────────────────────────────  Conversation  ──────────────────────────── */

export async function handleOnboardingMessage(args: {
  session: OnboardingSession
  message: string
}): Promise<OnboardingTurn> {
  const store = getStore()
  const session = { ...args.session }
  session.messages = [...session.messages, msg('user', args.message)]

  let reply = ''
  let actions: OnboardingTurn['actions'] = []

  const profile: Partial<MerchantProfile> = session.draftProfile ?? {}

  switch (session.stage) {
    case 'welcome':
    case 'website_url':
    case 'platform_detected': {
      reply =
        session.stage === 'platform_detected'
          ? 'Confirm the platform above and I will connect your store.'
          : "Paste the URL of your store and I'll detect what it runs on."
      break
    }

    case 'platform_confirmed':
    case 'connecting': {
      reply = 'Connecting your store now — one moment.'
      break
    }

    case 'catalogue_imported':
    case 'questions': {
      const extraction = await extractMerchantRules({ text: args.message, existing: profile, source: 'chat' })
      const merged = mergeProfile(profile, extraction.patch, extraction.newRules)
      session.draftProfile = merged

      const asked = session.askedQuestionIds
      const q = nextQuestion(merged, asked)

      if (q) {
        session.askedQuestionIds = [...asked, q.qid]
        session.stage = 'questions'
        reply = await phrase(
          `Acknowledge briefly what the merchant just told you (${extraction.summary || 'no new limits stated'}), then ask exactly this question verbatim: "${q.text}"`,
          `${extraction.summary} ${q.text}`,
        )
      } else {
        session.stage = 'rules_review'
        reply = await phrase(
          'Tell the merchant you have enough to build their agent, and that the rules on the right are editable and need approval before anything goes live. Two sentences.',
          "That's enough to build your agent. Review the rules on the right — nothing takes effect until you approve them.",
        )
        actions = [
          { id: 'start_voice', label: 'Add detail by voice call', kind: 'secondary' },
          { id: 'approve_rules', label: 'Approve rules', kind: 'primary' },
        ]
      }
      break
    }

    case 'voice_optional':
    case 'voice_active':
    case 'voice_summary':
    case 'rules_review': {
      const extraction = await extractMerchantRules({ text: args.message, existing: profile, source: 'chat' })
      if (extraction.newRules.length || Object.keys(extraction.patch).length) {
        session.draftProfile = mergeProfile(profile, extraction.patch, extraction.newRules)
        reply = await phrase(
          `Confirm you added this to the rules panel: ${extraction.summary}. One or two sentences, then remind them to approve.`,
          `${extraction.summary} It's in the rules panel — approve it when you're happy.`,
        )
      } else {
        reply = await phrase(
          'The merchant asked something during rule review. Answer briefly and remind them to approve the rules to continue.',
          'Noted. Approve the rules on the right whenever you are ready and I will set up payment acceptance next.',
        )
      }
      actions = [{ id: 'approve_rules', label: 'Approve rules', kind: 'primary' }]
      break
    }

    case 'payment_setup': {
      reply = 'Connect Visa acceptance on the right and your agent goes live.'
      actions = [{ id: 'connect_visa', label: 'Connect Visa', kind: 'primary' }]
      break
    }

    case 'agent_generated':
    case 'live': {
      const merchant = session.merchantId ? await store.getMerchant(session.merchantId) : null
      const extraction = await extractMerchantRules({ text: args.message, existing: profile, source: 'chat' })
      if (extraction.newRules.length || Object.keys(extraction.patch).length) {
        const merged = mergeProfile(profile, extraction.patch, extraction.newRules)
        session.draftProfile = merged
        reply = `${extraction.summary} New rules need approval in the panel before the agent uses them.`
      } else {
        reply = merchant
          ? `${merchant.name}'s agent is live. You can open the storefront, view the API docs, or tell me another rule to add.`
          : 'Your agent is live.'
      }
      break
    }
  }

  session.messages = [...session.messages, msg('agent', reply)]
  session.updatedAt = nowIso()
  const saved = await store.upsertOnboardingSession(session)
  return { session: saved, reply, sandbox: await buildSandbox(saved), actions }
}

/** Uses the model for wording only; the instruction already contains the content. */
async function phrase(instruction: string, fallback: string): Promise<string> {
  if (!llmAvailable()) return fallback
  const out = await complete(
    [
      {
        role: 'system',
        content:
          'You are an onboarding agent for a commerce platform, talking to a shop owner. Calm, concrete, no hype, no emoji, no markdown. Maximum 3 sentences.',
      },
      { role: 'user', content: scrubForPrompt(instruction, 1200) },
    ],
    { maxTokens: 140, temperature: 0.5 },
  )
  return out ?? fallback
}

export function mergeProfile(
  existing: Partial<MerchantProfile>,
  patch: Partial<MerchantProfile>,
  newRules: SalesRule[],
): Partial<MerchantProfile> {
  const rules = [...((existing.salesRules ?? []) as SalesRule[])]
  for (const r of newRules) {
    const dup = rules.find((x) => x.text.toLowerCase() === r.text.toLowerCase())
    if (!dup) rules.push(r)
  }
  return { ...existing, ...patch, salesRules: rules }
}

/* ──────────────────────  Connect / finalize actions  ────────────────────── */

export async function connectStore(args: {
  session: OnboardingSession
  detection: DetectionResult
  merchantName?: string
}): Promise<{ session: OnboardingSession; reply: string; productCount: number; mode: 'shopify' | 'demo' }> {
  const store = getStore()
  const env = serverEnv()
  const session = { ...args.session }

  const slug = env.shopifyMerchantSlug
  let merchant = await store.getMerchant(slug)

  if (!merchant) {
    const name = args.merchantName ?? guessNameFromUrl(session.websiteUrl) ?? 'New Merchant'
    merchant = await store.upsertMerchant({
      id: slug,
      name,
      slug,
      sizeType: 'sme',
      category: 'laptops',
      websiteUrl: session.websiteUrl ?? undefined,
      platform: args.detection.websitePlatform,
      commercePlatform: args.detection.commercePlatform,
      currency: 'SGD',
      agentId: agentIdFor(slug),
      visaMode: 'not_connected',
      networkEnabled: false,
      storefrontEnabled: false,
      logoHue: 24,
      createdAt: nowIso(),
    })
  } else {
    merchant = await store.upsertMerchant({
      ...merchant,
      websiteUrl: session.websiteUrl ?? merchant.websiteUrl,
      platform: args.detection.websitePlatform,
      commercePlatform: args.detection.commercePlatform,
    })
  }

  const adapter = await getAdapterForMerchant(merchant.id)
  const products = await adapter.syncCatalog(merchant.id)
  const mode: 'shopify' | 'demo' = adapter.kind === 'shopify' ? 'shopify' : 'demo'

  session.merchantId = merchant.id
  session.connected = true
  session.connectionMode = mode
  session.productCount = products.length
  session.stage = 'catalogue_imported'
  // Onboarding starts from the merchant's own knowledge, not a preloaded profile.
  session.draftProfile = session.draftProfile ?? {}
  session.updatedAt = nowIso()

  const reply =
    mode === 'shopify'
      ? `Shopify connected. I pulled ${products.length} products with live inventory. Now I only need what isn't on your product pages.`
      : `Store connected in demo mode and I mirrored ${products.length} products. Set SHOPIFY_ADMIN_ACCESS_TOKEN to pull from the live store instead. Now I only need what isn't on your product pages.`

  session.messages = [...session.messages, msg('agent', reply)]
  const saved = await store.upsertOnboardingSession(session)
  return { session: saved, reply, productCount: products.length, mode }
}

export async function finalizeMerchantAgent(args: {
  session: OnboardingSession
}): Promise<{ session: OnboardingSession; merchant: Merchant; profile: MerchantProfile }> {
  const store = getStore()
  const env = serverEnv()
  const session = { ...args.session }
  if (!session.merchantId) throw new Error('cannot finalize before a store is connected')

  const merchant = await store.getMerchant(session.merchantId)
  if (!merchant) throw new Error(`merchant ${session.merchantId} disappeared`)

  const draft = session.draftProfile ?? {}
  const approvedRules = ((draft.salesRules ?? []) as SalesRule[]).filter((r) => r.approved)

  const profile = MerchantProfileSchema.parse({
    merchantId: merchant.id,
    primaryObjective: draft.primaryObjective ?? 'conversion',
    secondaryObjective: draft.secondaryObjective,
    maxDiscountPct: draft.maxDiscountPct ?? 5,
    minMarginPct: draft.minMarginPct ?? 8,
    bundleAllowance: draft.bundleAllowance ?? 0,
    salesRules: approvedRules,
    inventoryPriorities: draft.inventoryPriorities ?? [],
    brandTone: draft.brandTone,
    standardWarrantyYears: draft.standardWarrantyYears ?? 1,
    maxWarrantyYears: Math.max(2, draft.standardWarrantyYears ?? 1),
    standardDeliveryDays: draft.standardDeliveryDays ?? 2,
    approvedAt: nowIso(),
  })

  await store.upsertProfile(profile)

  const updated = await store.upsertMerchant({
    ...merchant,
    visaMode: env.visaMode === 'sandbox' && env.visaMerchantId ? 'sandbox' : 'simulated',
    networkEnabled: true,
    storefrontEnabled: true,
  })

  session.stage = 'live'
  session.visaConnected = true
  session.draftProfile = profile
  session.updatedAt = nowIso()
  session.messages = [
    ...session.messages,
    msg(
      'agent',
      `Your agent is live. Agent ID ${updated.agentId}. It now sells on your storefront and answers customer-agent requests on the network.`,
    ),
  ]

  const saved = await store.upsertOnboardingSession(session)
  return { session: saved, merchant: updated, profile }
}
