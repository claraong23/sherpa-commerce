/**
 * SERVER-ONLY environment access.
 *
 * Nothing in this module may be imported from a client component. Values are
 * read lazily so that a missing credential never crashes a page render — it
 * degrades to demo mode instead.
 */

const bool = (v: string | undefined, fallback: boolean) => {
  if (v === undefined || v === '') return fallback
  return v === '1' || v.toLowerCase() === 'true'
}

const str = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined)

export function serverEnv() {
  const e = process.env
  return {
    nodeEnv: e.NODE_ENV ?? 'development',
    demoMode: bool(e.DEMO_MODE, true),
    appUrl: str(e.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000',

    openaiApiKey: str(e.OPENAI_API_KEY),
    openaiModel: str(e.OPENAI_MODEL) ?? 'gpt-4o-mini',
    openaiRealtimeModel:
      str(e.OPENAI_REALTIME_MODEL) ?? 'gpt-4o-realtime-preview-2024-12-17',

    supabaseUrl: str(e.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRoleKey: str(e.SUPABASE_SERVICE_ROLE_KEY),

    shopifyStoreDomain: str(e.SHOPIFY_DEMO_STORE_DOMAIN),
    shopifyAdminToken: str(e.SHOPIFY_ADMIN_ACCESS_TOKEN),
    shopifyApiVersion: str(e.SHOPIFY_API_VERSION) ?? '2025-01',
    shopifyMerchantSlug: str(e.SHOPIFY_MERCHANT_SLUG) ?? 'sherpa-computers',
    shopifyApiKey: str(e.SHOPIFY_API_KEY),

    visaMode: (str(e.VISA_ACCEPTANCE_MODE) ?? 'mock') as 'mock' | 'sandbox',
    visaBaseUrl: str(e.VISA_ACCEPTANCE_BASE_URL) ?? 'https://apitest.visaacceptance.com',
    visaMerchantId: str(e.VISA_ACCEPTANCE_MERCHANT_ID),
    visaKeyId: str(e.VISA_ACCEPTANCE_KEY_ID),
    visaSecretKey: str(e.VISA_ACCEPTANCE_SECRET_KEY),
    visaTestPan: str(e.VISA_ACCEPTANCE_TEST_PAN) ?? '4111111111111111',
    visaTestExpMonth: str(e.VISA_ACCEPTANCE_TEST_EXP_MONTH) ?? '12',
    visaTestExpYear: str(e.VISA_ACCEPTANCE_TEST_EXP_YEAR) ?? '2031',

    tapPrivateKey: str(e.TAP_PRIVATE_KEY),
    tapPublicKey: str(e.TAP_PUBLIC_KEY),
    tapKeyId: str(e.TAP_KEY_ID) ?? 'customer-agent-01',

    enableRealtimeVoice: bool(e.ENABLE_REALTIME_VOICE, true),
    enableWebauthn: bool(e.ENABLE_WEBAUTHN, true),
    enableShopifySync: bool(e.ENABLE_SHOPIFY_SYNC, true),
    enableShopifyOrderCreate: bool(e.ENABLE_SHOPIFY_ORDER_CREATE, true),
    enableLlm: bool(e.ENABLE_LLM, true),
    agentStaggerMs: Number(e.AGENT_STAGGER_MS ?? 420) || 0,
  }
}

export type ServerEnv = ReturnType<typeof serverEnv>

/** Integration status, safe to expose to the developer/detail UI. Contains no secrets. */
export function integrationStatus() {
  const env = serverEnv()
  return {
    demoMode: env.demoMode,
    llm: env.openaiApiKey && env.enableLlm ? 'live' : 'deterministic-fallback',
    llmModel: env.openaiApiKey && env.enableLlm ? env.openaiModel : null,
    database:
      env.supabaseUrl && env.supabaseServiceRoleKey ? 'supabase' : 'in-memory-seed',
    shopify:
      env.shopifyAdminToken && env.shopifyStoreDomain && env.enableShopifySync
        ? 'connected'
        : 'demo-mirror',
    shopifyStoreDomain: env.shopifyStoreDomain ?? null,
    shopifyOrderCreate:
      env.shopifyAdminToken && env.enableShopifyOrderCreate ? 'enabled' : 'not_configured',
    visa:
      env.visaMode === 'sandbox' && env.visaMerchantId && env.visaKeyId && env.visaSecretKey
        ? 'sandbox'
        : 'mock',
    visaBaseUrl: env.visaMode === 'sandbox' ? env.visaBaseUrl : null,
    realtimeVoice:
      env.openaiApiKey && env.enableRealtimeVoice ? 'openai-realtime' : 'recorder-fallback',
    webauthn: env.enableWebauthn ? 'browser-webauthn' : 'simulated-confirmation',
    tapKeys: env.tapPrivateKey && env.tapPublicKey ? 'env-keys' : 'ephemeral-boot-keys',
  } as const
}

export type IntegrationStatus = ReturnType<typeof integrationStatus>
