# Agentic Commerce — Visa Hackathon Prototype

> **Turn any merchant into an AI-native seller through one conversation.**
> That merchant's AI agent can then autonomously compete for customer intent.

A two-sided agentic commerce system. A merchant talks to an onboarding agent
once; from that conversation we build a merchant-specific commerce agent that
sells on the merchant's own storefront **and** competes for demand in a sealed
offer exchange against other merchant agents. The buyer talks to one customer
agent that filters, scores, negotiates once, and pays — with Visa as the trust
and transaction layer.

Prototype category: **laptops**.

---

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. That is the whole setup — **no credentials
required**. `DEMO_MODE=true` is the default: seeded merchants, seeded catalogue,
deterministic NLU, simulated Visa Acceptance, in-process store.

Real integrations switch on automatically when their environment variables are
present. See [Environment](#environment).

```bash
pnpm build       # production build
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # 142 unit + integration tests
pnpm smoke       # 65 end-to-end checks, in-process, no dev server needed
pnpm seed        # (re)load demo merchants + catalogue
pnpm tap:generate-keys   # Ed25519 keypair for the TAP-style signing demo
```

---

## Architecture

```text
                          MERCHANT SIDE                         CUSTOMER SIDE
                          ─────────────                         ─────────────

  /merchant/onboard                                             /customer
        │                                                            │
   onboarding agent                                            customer agent
   · platform detector (deterministic HTTP fingerprint)         · intent extraction
   · catalogue import via CommerceAdapter                       · hard-constraint filter
   · rule extraction (chat + voice) → merchant approves         · factual verification
   · Visa acceptance, in-flow                                   · weighted utility scoring
        │                                                       · one counteroffer
        ▼                                                            │
   MerchantProfile  ──────────►  merchant agent                      │
   objective, discount ceiling,  · own inventory only                │
   margin floor, bundle          · own commercial rules              │
   allowance, sales rules        · deterministic validator           │
        │                        · seals: canonical JSON → SHA-256   │
        ├───────────────┐                   │                        │
        ▼               ▼                   │                        │
  /storefront/[id]   agent network ◄────────┴──── SEALED OFFER ──────┤
  merchant-scoped                             EXCHANGE               │
  tools only                                                         ▼
                                                            offer lock (re-hash)
                                                                     │
                                                            Payment Instruction
                                                            merchant · amount ·
                                                            expiry · offer hash
                                                                     │
                                                            passkey confirmation
                                                                     │
                                                            Visa Acceptance
                                                            sandbox | simulated
                                                                     │
                                                            order + receipt

  Every transition above emits an AgentEvent → persisted → SSE → visualization.
```

### What the model does, and what it does not

| Language model | Deterministic code |
|---|---|
| Natural-language intent | Price arithmetic, discount and margin limits |
| Which questions are still missing | Hard-constraint filtering |
| Merchant rule extraction from chat/voice | Inventory checks |
| SKU choice **within a pre-validated candidate set** | Candidate set construction, offer pricing |
| Recommendation and counteroffer prose | Scoring, ranking, offer validation |
| Voice transcript summary | Hashes, expiry, payment controls, order creation |

Every structured model output is parsed through Zod before it can affect state,
and every merchant offer passes a deterministic validator before it is sealed.
A model that returns nonsense degrades to the deterministic path; it never
becomes commercial or factual truth.

### Repository layout

```text
app/                          Next.js App Router — pages and API routes only
  api/                        transport concerns; domain logic lives in packages/
packages/
  core/     schemas (Zod), scoring, policy validator, canonicalization,
            platform detector, data store, event bus, seed data
  agents/   intent, customer agent, merchant agent, storefront agent,
            onboarding agent, rule extraction, purchase flow
  commerce/ CommerceAdapter + Shopify / Demo / GenericApi implementations
  visa/     TAP-style signing, Payment Instruction, WebAuthn, Visa adapters
  ui/       shared presentational primitives
extensions/storefront-chat/   Shopify Theme App Extension (app embed block)
supabase/                     migration + seed
scripts/                      seed, smoke test, TAP key generation
tests/                        unit + integration
```

Internal packages are path-aliased (`@core/*`, `@agents/*`, …) inside one
Next.js app rather than published workspace packages. This is deliberate: it
keeps the module boundaries the design needs without a monorepo build graph.

---

## The three demo routes

### 1. `/merchant/onboard` — merchant onboarding

Left: conversation. Right: a workspace that reflects real backend state.

Paste `sherpa-computers-demo.myshopify.com`. The detector fingerprints the site
deterministically (asset hosts, response headers, markup markers — never the
model alone) and reports its signals. Confirm Shopify, and the catalogue
imports through the commerce adapter.

Then state your rules in chat, or run the voice interview. Extracted rules land
in an editable panel **unapproved** — the offer validator ignores unapproved
rules, so nothing you have not approved can affect a customer offer. Approve,
connect Visa acceptance in the same flow (not a separate journey), and the agent
goes live with an agent ID, storefront link, and generated API docs.

### 2. `/storefront/[merchantId]` — the merchant's own store

The generated agent running on the merchant's site. Ask it for a CAD laptop
under S$1,500 and it answers from this catalogue. Ask *"Is Bizgram's Lenovo
better?"* and it declines.

That refusal is structural, not a prompt instruction. A storefront session is
constructed with one `merchantId` and the tools close over it — there is no
parameter for "which merchant" and no cross-merchant read path anywhere in the
codebase. Tests assert that competitor SKUs return empty from every tool.

With Shopify configured, the same widget runs on the real store through the
Theme App Extension in `extensions/storefront-chat/`.

### 3. `/customer` — customer agent and the exchange

75% market visualization, 25% consumer chat.

One sentence in. The customer agent structures it, signs a request per merchant
(Ed25519), and each merchant agent independently checks inventory, applies its
rules, constructs an offer and seals it — without seeing any competitor's offer.
The customer agent then hard-filters, verifies each offer against the merchant's
own catalogue record, scores on weights derived from the conversation, and
recommends one.

Then: one counteroffer, offer lock (re-check inventory, re-canonicalize, compare
SHA-256), Payment Instruction, passkey confirmation, Visa authorization, order.

The visualization renders **only** from the persisted agent event stream. No
component animates on a timer. Press `Ctrl/Cmd + Shift + D` for the failure
injection panel.

---

## Test prompts

| Prompt | What it demonstrates |
|---|---|
| `I need a laptop for CAD and gaming under S$1,600. I carry it around every day.` | Balanced ranking; portability affects the winner |
| `I mostly code and travel. Battery and weight matter more than gaming. Keep it under S$1,500.` | Different weights → different merchant wins |
| `I need CUDA for ML. Nothing refurbished. Max S$1,700.` | Hard constraints eliminate AMD and refurbished stock |
| `I need at least 32GB RAM and a dedicated GPU for rendering, under S$1,650.` | Two of three merchants cannot construct any valid offer |

Winners differ across these prompts because the seeded catalogue has real
tradeoffs, not because anything is scripted.

---

## Environment

Copy `.env.example` to `.env.local`. Everything is optional.

| Variable | Activates |
|---|---|
| `OPENAI_API_KEY` | LLM intent extraction, conversation, merchant strategy, prose. Without it, deterministic NLU handles everything. |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Postgres persistence. Both required; otherwise in-process store. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` + `SHOPIFY_DEMO_STORE_DOMAIN` | Real Shopify GraphQL Admin API: catalogue sync, live inventory, `orderCreate`. |
| `VISA_ACCEPTANCE_MODE=sandbox` + merchant id, key id, secret | Real HTTP call to `apitest.visaacceptance.com`. All three required. |
| `TAP_PRIVATE_KEY` + `TAP_PUBLIC_KEY` | Stable signing keys (`pnpm tap:generate-keys`). Otherwise an ephemeral pair is generated at boot. |

`/api/status` reports which path each integration is on. The developer panel on
`/customer` shows the same.

**Never** prefix a secret with `NEXT_PUBLIC_`. The OpenAI key, Shopify secret,
Supabase service-role key, Visa credentials and the TAP private key are all
server-only; `packages/core/src/server-guard.ts` throws loudly if one of those
modules is pulled into a client bundle.

### Supabase

```bash
supabase link --project-ref <ref>
supabase db push
pnpm seed
```

Every table has RLS enabled with **no policies** — anon and authenticated access
is denied outright, and the server bypasses RLS with the service-role key. This
matters because `products.doc` holds `costPrice` and `merchant_profiles.doc`
holds discount ceilings and margin floors.

### Shopify

```bash
shopify app config link
shopify app dev --store your-store.myshopify.com
```

Scopes: `read_products`, `read_inventory`, `write_orders` — only what the code
calls. Activate the storefront agent under **Themes → Customize → App embeds**.
See `extensions/storefront-chat/README.md`.

If `orderCreate` is unavailable, the purchase still completes and the order
records `shopifyOrderStatus: "not_configured"` rather than failing.

### Visa Acceptance

```bash
VISA_ACCEPTANCE_MODE=sandbox
VISA_ACCEPTANCE_MERCHANT_ID=...
VISA_ACCEPTANCE_KEY_ID=...
VISA_ACCEPTANCE_SECRET_KEY=...
```

Sandbox uses HTTP Signature against `pts/v2/payments`. Visa recommends JWT for
new integrations (HTTP Signature must migrate by March 2027) — the adapter
boundary in `packages/visa/adapter.ts` exists so that is a one-file change.

The test instrument is read from env, used only in the outbound request body,
and never logged, persisted, returned to a client, or placed in a model prompt.

If any credential is missing the app uses the mock adapter, and every surface
that renders the result says **"Simulated Visa Acceptance"**.

### Voice

With `OPENAI_API_KEY` set, the onboarding call runs OpenAI Realtime over WebRTC.
The server mints a short-lived client secret; the standard API key never reaches
the browser. The Realtime agent is briefed with the *current incomplete* profile
so it asks only what is missing.

Without it, the call falls back to browser recording and says so on screen.

---

## Demo script (5 minutes)

1. **`/merchant/onboard`** — paste `sherpa-computers-demo.myshopify.com`, confirm
   Shopify, watch the catalogue import. Type:
   *"I mainly want to move old stock. Never discount more than 8%, minimum 12%
   margin, and I can bundle accessories up to 55 dollars. Never sell under 16 GB
   for CAD."* Point at the rules panel filling in, and at **0/2 approved** —
   nothing is live until the merchant approves. Approve → connect Visa →
   generate agent.
2. **`/storefront/sherpa-computers`** — open the chat. Ask for a CAD laptop under
   S$1,500. Then ask *"Is Bizgram's Lenovo better?"* and point at the refusal
   badge: *no cross-merchant tool exists in this session*.
3. **`/customer`** — run prompt A. Narrate: three merchant agents, three
   objectives, signed requests, sealed offers, hard filter, scoring. Counter.
   Buy. Passkey. Watch the eight Payment Instruction controls pass, then the
   authorization and order.
4. **`Ctrl/Cmd + Shift + D`** — tick *Merchant mismatch*, re-run, buy again.
   `MERCHANT_MISMATCH`, nothing charged. That is a real backend refusal, not a
   mocked screen.

---

## The Visa stack, stated honestly

One sentence for judges:

> Merchant agents are identified using Visa's Trusted Agent Protocol model; the
> purchase is governed by a Visa Intelligent Commerce Payment Instruction with an
> explicit merchant and amount; the user confirms with a passkey-style FIDO step;
> and the tokenized payment is authorized through the Visa Acceptance layer, with
> the instruction-to-transaction trail retained as commerce signals.

What that means in this repository:

| Layer | Prototype | Honest status |
|---|---|---|
| **Visa Acceptance** | `pts/v2/payments`, HTTP Signature | **Real sandbox call** when credentials are set; otherwise simulated to the documented request/response model and labelled as such |
| **Payment Instruction** (VIC) | Local object, 8 controls enforced before anything leaves the server | Controls are **really enforced**; no VIC credential service is called |
| **TAP** | Ed25519 over an RFC 9421-style signature base, nonce, timestamp, content digest, replay store | **Really implemented and verified.** The key is locally generated and is **not registered with Visa** |
| **Passkey** | Browser WebAuthn, ES256 assertion verified server-side | **Really verified** where an authenticator exists; otherwise an explicitly-labelled simulated confirmation |
| **Network token** | `Visa token •••• 4821` in the application model | No raw PAN in agent state, logs, or prompts |
| **Commerce signals** | Persisted agent event trail | Internal log; maps to VIC commerce signals in production |
| **Intelligent Commerce Connect** | — | **Architecture-mapped only.** Not enrolled |
| **Visa MCP Server** | — | **Architecture-mapped only.** No access |
| **Acceptance Agent Toolkit** | — | Referenced as a philosophy comparison only. Not used |

We do not claim a real card was processed, that the demo agent is Visa-approved,
or that we are an enrolled enabler on Connect.

---

## Testing

```bash
pnpm test    # 142 tests
pnpm smoke   # 65 checks
```

Unit coverage: hard constraints, scoring determinism and weight sensitivity,
spec tiers, discount/margin/bundle/warranty policy limits, sales-rule
enforcement, offer canonicalization and hash sensitivity, all eight Payment
Instruction controls, TAP signature/digest/replay/skew, intent parsing, merchant
rule extraction, platform fingerprinting, seed integrity.

Integration coverage: full offer rounds for each demo prompt, policy compliance
of every returned offer, cost data never leaving the server, counteroffer accept
and decline, lock → instruction → passkey → authorize → order, every failure
path, and storefront isolation at the tool level.

Both run entirely in-process with no dev server and no credentials.

---

## Design

Light theme on a four-colour palette — Wisteria Blue, Strong Cyan, Wild
Strawberry, Amber Gold — with a conventional red reserved for payment declines.

The governing constraint: none of the four brand colours clears 3.4:1 against
white, so they are **fills that carry dark text**, never text themselves. Where
a coloured label is needed, a 600/700 shade does the work. Amber never carries
text at all (1.68:1).

Full palette, contrast measurements, semantic mapping and per-component
decisions are in [design.md](design.md).

## Known limitations

- **No merchant authentication.** Anyone who can reach the API can act as any
  merchant. Production needs per-merchant API keys with request signing.
- **The counteroffer round is one-shot per session** by design, not by policy
  engine — a second counter is refused with `COUNTER_ALREADY_USED`.
- **Spec tiers are a lookup table**, not benchmark data. The catalogue is
  fabricated demo data and is not a claim about real retail pricing or
  configurations.
- **The in-memory store is per-process.** On a multi-instance deployment
  configure Supabase, or sessions will land on different workers.
- **SSE across serverless instances** relies on the DB poll in
  `/api/events/[sessionId]`; the in-process emitter only covers same-worker.
- **The TAP nonce store is in-memory**, so replay protection is per-process.
- **`GenericApiAdapter` is wired but unexercised** by the demo flow.
- **Rate limiting is a fixed-window in-memory guard**, enough to stop a runaway
  client, not a production limiter.

## Highest-risk demo issue

**WebAuthn feature detection is optimistic.** A browser on `localhost` reports
full support, then `navigator.credentials.create` never settles when no platform
authenticator exists. This is handled — `PASSKEY_TIMEOUT_MS` (8s) aborts and
falls through to the labelled simulated confirmation — but it means the purchase
step can pause for up to 8 seconds on a machine with no passkey configured. Set
`ENABLE_WEBAUTHN=false` to skip straight to the simulated path on demo hardware.
