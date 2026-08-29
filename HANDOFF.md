# Engineering handoff

Build completed 2026-08-29. Repository was empty apart from the three context
markdown files; everything below was scaffolded and written in this session.

---

## 1. What was built

A working two-sided agentic commerce prototype in a single Next.js 15 app with
path-aliased internal packages.

**Merchant side.** A conversational onboarding agent that fingerprints a store's
commerce platform deterministically, imports its catalogue through a commerce
adapter, extracts commercial rules from chat or a voice interview, holds those
rules unapproved until the merchant approves them, connects payment acceptance
in the same flow, and emits a merchant agent with a public agent ID, a storefront
integration and generated API docs.

**Merchant agent.** Not a chatbot with a pricing budget. It builds a candidate
set from its own in-stock inventory, prices each candidate at the strongest
position its policy envelope allows, ranks by expected value
(`P(win)² × merchant utility`), optionally lets the model pick among the top
candidates and write the sales note, then runs a deterministic validator over
ten checks before canonicalizing and SHA-256 sealing the offer. It never sees a
competitor's offer.

**Customer agent.** Structures free text into hard constraints and weighted
preferences, signs one Ed25519 request per merchant, hard-filters returned
offers, independently verifies each offer's facts against the merchant's own
catalogue record, scores on nine deterministic dimensions, recommends one, runs
at most one counteroffer, then locks → Payment Instruction → passkey →
authorize → order.

**Visualization.** Renders exclusively from a persisted agent event stream
delivered over SSE. Nothing animates on a timer.

**Failure injection.** Six faults behind `Ctrl/Cmd + Shift + D` that produce
genuine server-side refusals.

### Deviations from the brief

| Brief | Built | Why |
|---|---|---|
| pnpm workspace with `apps/platform` + published packages | Single Next.js app, `packages/*` via tsconfig paths + Next `transpilePackages`-free resolution | Same module boundaries, no monorepo build graph. The brief permits this ("functionality beats directory aesthetics"). `pnpm dev/build/test` all work. |
| `EVENT_LABELS` exported from the event bus | Also exported from `packages/core/src/events/labels.ts` | The bus imports the data store and `node:crypto`. A client component importing labels from it broke the production build. |

---

## 2. Routes

### Pages
| Route | Purpose |
|---|---|
| `/` | Landing, live integration status, honesty panel |
| `/merchant/onboard` | Screen 1 — onboarding conversation + live workspace |
| `/storefront/[merchantId]` | Screen 2 — merchant store with the scoped agent |
| `/docs/merchant/[merchantId]` | Generated merchant-specific API documentation |
| `/customer` | Screen 3 — market visualization + consumer chat |

### API
| Route | Purpose |
|---|---|
| `POST /api/onboarding/detect-platform` | Deterministic platform fingerprint |
| `POST /api/onboarding/chat` | Onboarding turn (creates the session when id is null) |
| `POST /api/onboarding/connect` | `detect` \| `confirm` \| `override` |
| `POST /api/onboarding/rules` | Edit / remove / approve rules, edit profile limits |
| `POST /api/onboarding/finalize` | `connect_visa` \| `finalize` \| `toggle_network` |
| `POST /api/onboarding/voice-session` | Mints an ephemeral OpenAI Realtime client secret |
| `POST /api/onboarding/voice-summary` | Transcript → structured unapproved rules |
| `POST /api/shopify/sync` | Catalogue sync through the adapter |
| `POST /api/shopify/order` | Direct order creation (developer path) |
| `POST /api/storefront/chat` | Merchant-scoped storefront conversation |
| `POST /api/customer/intent` | Intent extraction alone |
| `POST /api/exchange/request` | Full customer flow → recommendation |
| `GET /api/exchange/[requestId]/offers` | Offers + current ranking |
| `POST /api/exchange/counter` | One counteroffer round |
| `POST /api/offers/[offerId]/lock` | Re-check stock, re-hash, freeze |
| `POST /api/payments/instruction` | Create the Payment Instruction |
| `POST /api/payments/passkey/challenge` | WebAuthn challenge (register \| authenticate) |
| `POST /api/payments/passkey/register` | Store the credential public key |
| `POST /api/payments/passkey/verify` | Verify the ES256 assertion, or the labelled fallback |
| `POST /api/payments/authorize` | Enforce controls → Visa → transaction → order |
| `GET /api/events/[sessionId]` | SSE agent event stream |
| `GET /api/public/merchant/[merchantId]` | Browser-safe widget config (CORS) |
| `GET /api/status` | Integration status, no secrets |
| `GET /product-image/[file]` | Deterministic SVG product placeholders |
| `GET /widget.js` | Embeddable storefront widget loader |

---

## 3. Architecture notes worth knowing

**Adapter selection is a merchant property.** `getAdapterForMerchant()` is the
only place that decides Shopify vs demo vs generic. Nothing outside
`packages/commerce` imports a Shopify type or reasons about a GID.

**Store selection degrades, never fails.** Supabase requires *both* URL and
service-role key; a half-configured environment stays on the in-process store
rather than failing mid-demo.

**Offer canonicalization freezes commercial substance only.** `merchantId`,
`sku`, `productId`, `amount`, `currency`, `bundle`, `warrantyYears`,
`deliveryDays`, `expiresAt`. Presentation fields (`merchantNote`, `tradeoffs`)
are excluded, so re-wording an offer does not invalidate its hash while changing
its price does. Tests assert both directions.

**Payment Instruction controls are evaluated exhaustively, not
short-circuited.** All eight run so the UI can show the full list; the first
failure in declaration order determines the decline code.

**The storefront boundary is the tool surface.** `createStorefrontTools(id)`
closes over one merchant id. There is no "which merchant" parameter anywhere and
no cross-merchant query. Integration tests assert competitor SKUs return empty
from `compareProducts`, `checkStock` and `createQuote`.

**Client/server boundary is enforced at runtime.** `assertServer()` in
`packages/core/src/server-guard.ts` throws if a secret-reading module reaches a
browser bundle. It caught a real violation during this build (a client component
importing event labels from the bus, dragging in `node:crypto` and the DB).

---

## 4. Integrations that are genuinely live

Working right now, with no credentials configured:

- **Merchant policy engine** — discount ceiling, margin floor (bundle cost
  counted), bundle allowance, warranty ceiling, expiry bounds, product ownership,
  spec/price/condition misrepresentation, approved sales rules, customer hard
  constraints. Ten checks, all enforced.
- **Customer hard filter and scoring** — nine dimensions from lookup tables and
  arithmetic. Deterministic and explainable; contributions sum to the score.
- **Offer canonicalization + SHA-256 lock** with a real re-hash comparison
  before payment.
- **TAP-style signing** — Ed25519 over an RFC 9421-aligned signature base with
  `created`, nonce, content digest and covered components. Signature, digest,
  timestamp-skew and nonce-replay all verified. Tampering is caught.
- **Payment Instruction controls** — all eight enforced server-side before any
  outbound call.
- **WebAuthn assertion verification** — ES256, challenge binding, origin check,
  RP ID hash, user-presence flag, DER→raw signature conversion, WebCrypto
  verify. Real crypto, no library.
- **Platform detector** — HTTP fingerprinting on asset hosts, response headers
  and markup markers, weighted and scored. The model never decides the platform.
- **Event bus + SSE** — persisted events, in-process push plus a DB poll with
  seq-based dedup.
- **Commerce adapter** — real inventory reads and order writes against the
  configured store.

Activated by credentials, code complete and exercised by tests via the same
interface:

- **Shopify GraphQL Admin API** — `syncCatalog` (products, variants,
  `inventoryItem.unitCost`, metafields → normalized specs, cursor pagination),
  `getInventory` (live, writes through to the mirror), `orderCreate` with
  `priceSet`, tags and user-error handling.
- **Visa Acceptance sandbox** — `POST /pts/v2/payments` with HTTP Signature
  (`host`, `date`, `(request-target)`, `digest`, `v-c-merchant-id`),
  HMAC-SHA256 over the signing string, response mapped to the internal
  transaction shape.
- **OpenAI Realtime** — server-minted ephemeral client secret, browser WebRTC
  offer/answer against `/v1/realtime/calls`, data-channel transcript events.

---

## 5. Mocked because credentials were absent from this environment

| Integration | State | Exact activation |
|---|---|---|
| **Visa Acceptance** | Mock adapter. Same interface, same response shape, realistic latency, deterministic declines (`amount cents == 13`). Every surface says "Simulated Visa Acceptance". | `VISA_ACCEPTANCE_MODE=sandbox` **and** `VISA_ACCEPTANCE_MERCHANT_ID`, `VISA_ACCEPTANCE_KEY_ID`, `VISA_ACCEPTANCE_SECRET_KEY`. All four, or it stays mock. |
| **Shopify** | Seeded catalogue mirror; `shopifyOrderStatus: "demo"`. | `SHOPIFY_ADMIN_ACCESS_TOKEN` + `SHOPIFY_DEMO_STORE_DOMAIN`. Order creation additionally needs `ENABLE_SHOPIFY_ORDER_CREATE=true` and `write_orders`. |
| **OpenAI** | Deterministic NLU throughout — regex intent extraction, rule extraction, templated recommendation prose. Fully functional, less fluent. | `OPENAI_API_KEY`. |
| **OpenAI Realtime voice** | Browser MediaRecorder, no AI voice; the UI says so. | `OPENAI_API_KEY` + `ENABLE_REALTIME_VOICE=true`. |
| **Supabase** | In-process seeded store. | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. |
| **WebAuthn** | Real code path, but this machine has no platform authenticator, so it times out at 8s and falls back to the labelled simulation. | Any device with a platform authenticator, over HTTPS or localhost. |

**Never integrated, architecture-mapped only** — stated as such in the README,
the landing page and `/api/status`: Visa Intelligent Commerce Connect, VIC
credential services, Visa Payment Passkey Service, Visa MCP Server, Acceptance
Agent Toolkit, network commerce-signal ingestion. No fake endpoints were written
for any of them.

---

## 6. Manual setup still required

Nothing is required to run the demo. To light up real integrations:

1. **OpenAI** — create a key, set `OPENAI_API_KEY`. Highest value per minute
   spent; makes every conversation noticeably better.
2. **Shopify** — Partner/Dev Dashboard account → create a Dev store → load a
   laptop catalogue (metafields in namespace `specs`: `cpu`, `gpu`, `ram_gb`,
   `storage_gb`, `weight_kg`, `battery_wh`, `generation`, `warranty_years`,
   `cuda`, `dedicated_gpu`) → `shopify app config link` → `shopify app dev` →
   enable the app embed in the theme editor → set `SHOPIFY_ADMIN_ACCESS_TOKEN`
   and `SHOPIFY_DEMO_STORE_DOMAIN`. Set unit cost per variant, or the adapter
   assumes 86% of price.
3. **Visa Acceptance** — sandbox account at developer.visaacceptance.com →
   generate a shared-secret key → set the four env vars. Be aware that some
   sandbox accounts additionally require credit-card-service / processor
   configuration before `pts/v2/payments` will authorize, which needs account
   administration rather than code. If that blocks, stay on the mock adapter and
   say so out loud during the demo — the label is already honest.
4. **Supabase** — create a project → `supabase db push` → `pnpm seed`.
5. **TAP keys** — `pnpm tap:generate-keys`, paste both values into `.env.local`.
   Only needed if you want signatures stable across restarts.
6. **Vercel** — connect the repo, paste the env vars, deploy. HTTPS is what
   makes WebAuthn work properly.

---

## 7. Commands

```bash
pnpm install
pnpm dev                  # http://localhost:3000
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm smoke
pnpm seed
pnpm tap:generate-keys
pnpm shopify:dev          # requires Shopify CLI + a linked app
```

`pnpm smoke` runs the entire lifecycle in-process — no dev server, no
credentials. It is the fastest way to confirm the build is healthy.

---

## 8. Results

All verified on the final tree:

```
typecheck   tsc --noEmit                      clean
lint        eslint .                          clean (0 errors, 0 warnings)
build       next build                        22 routes, compiled successfully
test        vitest run                        142 passed / 142
smoke       tsx scripts/smoke-test.ts         65 passed / 0 failed  (1.9s)
```

Browser-verified end to end on all three screens: onboarding through to
"agent live"; storefront competitor refusal; customer round → counteroffer →
lock → Payment Instruction → passkey → authorization → order, with the payment
panel showing all eight controls passing.

HTTP-verified: offer round, counteroffer, lock, instruction, unauthenticated
refusal, authenticated authorization, order, SSE replay (64 events, 28 distinct
types), storefront isolation, platform detection.

### Bugs found and fixed during verification

1. **All three demo prompts returned the same winner.** Merchant agents ranked
   candidates by a weighted sum that let a high-utility SKU outrank one the
   customer would actually buy, and estimated customer fit against the merchant's
   *own* catalogue — making each merchant's cheapest item always look like best
   value. Replaced with expected value over the real scorer, scored standalone.
   Winners now differ, and merchants propose sensible SKUs.
2. **Hydration mismatch on `/customer`** — session id generated during render.
   Moved to a post-mount effect.
3. **Purchase froze for 60 seconds** — WebAuthn feature detection reports support
   on localhost, then `credentials.create` never settles without an
   authenticator. Added an 8s abortable timeout with fallback.
4. **Extracted discount/margin limits never appeared in the rules panel** —
   `EditableNumber` held stale local state. Now syncs from the server unless
   focused.
5. **Production build failed** — a client component imported event labels from
   the event bus, pulling `node:crypto` and the data store into the browser
   bundle. Split into `events/labels.ts`.
6. **`"Never discount more than 8%"` was not parsed** — the merchant phrasing the
   demo script actually uses. Broadened the pattern, with a lookahead so margin
   statements do not land in the discount field.
7. **Storefront suggested over-budget laptops** when nothing matched the search
   terms. The no-match fallback now honours the stated budget or says plainly
   that nothing is in stock under it.
8. **Bundles were all-or-nothing** — a merchant dropped its bundle entirely when
   the richest one broke the budget. Now trims to the richest affordable bundle
   first.
9. **Intent-parsing events only fired over HTTP** — they lived in the route
   handler, so the visualization would have been incomplete for any other caller.
   Moved into `runCustomerRequest` in the domain layer.
10. **Double possessive** — "Tan Computers's" in the refusal message.

---

## 9. Known limitations

- **No merchant authentication.** Any caller can act as any merchant. Production
  needs per-merchant API keys with HMAC request signing and per-endpoint scoping.
- **In-memory store is per-process**, as is the TAP nonce replay set and the rate
  limiter. Multi-instance deployments need Supabase configured; replay protection
  and rate limiting would need shared state.
- **SSE across workers** depends on the DB poll (1.2s); the in-process emitter
  only covers same-worker delivery.
- **Counteroffer is one-shot per session**, tracked on the session rather than in
  a negotiation policy engine.
- **Spec tiers are a curated lookup table**, not benchmark data. The catalogue is
  fabricated; it is not a claim about real pricing or configurations.
- **`GenericApiAdapter` is wired but unexercised** by the demo flow.
- **No webhook handlers** for Shopify product/inventory updates. Initial sync
  plus purchase-time re-check only.
- **The onboarding flow assumes one merchant slug** (`SHOPIFY_MERCHANT_SLUG`);
  onboarding a second merchant overwrites the first.

---

## 10. Highest-risk demo issue

**WebAuthn on demo hardware.** Feature detection is optimistic: a browser on
`localhost` advertises full WebAuthn support, then the credential call hangs
until timeout when no platform authenticator exists. This is mitigated — an 8s
abortable timeout falls through to the clearly-labelled simulated confirmation,
and the button reads "Waiting for your passkey…" so the pause is legible — but on
a laptop with no configured passkey the purchase step stalls for eight seconds at
the most dramatic moment of the demo.

**Before presenting, do one of:**

- configure a platform passkey (Windows Hello / Touch ID) on the demo machine and
  rehearse the prompt, **or**
- set `ENABLE_WEBAUTHN=false`, which skips straight to the simulated path with no
  pause and an honest label.

Second-highest risk: if you deploy to Vercel with Supabase unconfigured, requests
can land on different workers and lose session state mid-demo. Configure Supabase
before deploying, or demo locally.
