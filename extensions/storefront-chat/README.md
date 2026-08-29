# Storefront agent — Shopify Theme App Extension

The merchant-scoped chat agent, delivered as an **App Embed Block**.

## Why an app embed and not a ScriptTag

App embeds are the current Shopify primitive for floating/overlay storefront UI.
They survive theme updates, are toggled by the merchant in the theme editor, and
need no write access to theme code. ScriptTag injection is legacy and is not
used anywhere in this project.

## What reaches the browser

Only two public identifiers: `merchant_id` and `agent_id`. Catalogue reads,
inventory checks and quotes all happen server-side through
`POST /api/storefront/chat`, which binds the session to one merchant. There is
no cross-merchant tool in that session, so no page-source edit can make the
widget read another merchant's data.

## Setup

```bash
# from the repository root
shopify app dev --store your-store.myshopify.com
```

Then in the store admin:

1. **Online Store → Themes → Customize**
2. **App embeds** (bottom of the left sidebar)
3. Enable **Storefront agent**
4. Set **Merchant ID**, **Agent ID** and **Platform URL** to the values shown at
   the end of merchant onboarding
5. **Save**

Deep link for the demo, which opens the theme editor with the embed pre-selected:

```
https://{store}.myshopify.com/admin/themes/current/editor?context=apps&activateAppId={app-id}/agent_chat
```

## Local preview without Shopify

`/storefront/[merchantId]` in the platform app renders the same widget against
the same endpoint, so screen 2 is demoable with no Shopify configuration.
