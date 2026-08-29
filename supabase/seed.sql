-- Demo seed.
--
-- This file is a convenience for `supabase db reset`. The authoritative seed
-- lives in TypeScript at packages/core/src/seed/, which `pnpm seed` writes into
-- whichever store is configured. Prefer that: it validates against the Zod
-- schemas and stays in step with them.
--
--   pnpm seed
--
-- Product data below is fabricated for the prototype.

truncate table agent_events, orders, payment_transactions, payment_instructions,
  accepted_offers, counteroffers, offers, customer_intents, customer_sessions,
  voice_transcripts, onboarding_sessions, products, merchant_profiles, merchants
  restart identity cascade;

-- Merchants are inserted by `pnpm seed`; this placeholder keeps `db reset`
-- from leaving a half-populated database if the TypeScript seed is skipped.
insert into merchants (id, slug, name, doc)
values (
  'tan-computers',
  'tan-computers',
  'Tan Computers',
  jsonb_build_object(
    'id', 'tan-computers',
    'name', 'Tan Computers',
    'slug', 'tan-computers',
    'sizeType', 'sme',
    'category', 'laptops',
    'platform', 'shopify',
    'commercePlatform', 'shopify',
    'currency', 'SGD',
    'agentId', 'merchant_tan_computers_8H3K2',
    'visaMode', 'simulated',
    'networkEnabled', true,
    'storefrontEnabled', true,
    'logoHue', 24,
    'createdAt', '2026-08-01T02:00:00.000Z'
  )
)
on conflict (id) do nothing;

-- Run `pnpm seed` now to load all three merchants, their profiles and the
-- full 18-product catalogue.
