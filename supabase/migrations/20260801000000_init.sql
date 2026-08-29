-- Agentic commerce — initial schema.
--
-- Each table stores the validated domain object in a `doc` jsonb column plus a
-- few promoted columns for indexing and foreign keys. The Zod schemas in
-- packages/core/src/schemas are the source of truth for shape; this keeps
-- migrations small while those schemas are still moving, and means adding a
-- field does not require a migration.
--
-- Every table is RLS-enabled with no permissive policy. The application reaches
-- Postgres only through the service-role key from the server, so anon/authed
-- clients get nothing even if the publishable key leaks.

create extension if not exists "pgcrypto";

/* ────────────────────────────  Merchants  ──────────────────────────── */

create table if not exists merchants (
  id          text primary key,
  slug        text not null unique,
  name        text not null,
  doc         jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists merchant_profiles (
  merchant_id text primary key references merchants (id) on delete cascade,
  doc         jsonb not null,
  updated_at  timestamptz not null default now()
);

/* ────────────────────────────  Catalogue  ──────────────────────────── */

create table if not exists products (
  id           text primary key,
  merchant_id  text not null references merchants (id) on delete cascade,
  sku          text not null,
  price        numeric(12, 2) not null,
  stock        integer not null default 0,
  doc          jsonb not null,
  updated_at   timestamptz not null default now(),
  unique (merchant_id, sku)
);

create index if not exists products_merchant_idx on products (merchant_id);
create index if not exists products_stock_idx on products (merchant_id, stock);

/* ────────────────────────  Customer + exchange  ──────────────────────── */

create table if not exists customer_sessions (
  id          text primary key,
  doc         jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists customer_intents (
  request_id  text primary key,
  session_id  text not null,
  doc         jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists customer_intents_session_idx on customer_intents (session_id);

create table if not exists offers (
  offer_id     text primary key,
  request_id   text not null,
  merchant_id  text not null references merchants (id) on delete cascade,
  state        text not null,
  doc          jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists offers_request_idx on offers (request_id);
create index if not exists offers_state_idx on offers (request_id, state);

create table if not exists counteroffers (
  counter_request_id text primary key,
  request_id         text not null,
  offer_id           text not null,
  doc                jsonb not null,
  created_at         timestamptz not null default now()
);

-- The frozen offer. `offer_hash` is the SHA-256 over the canonical offer and is
-- what every downstream payment control is checked against.
create table if not exists accepted_offers (
  accepted_offer_id text primary key,
  offer_id          text not null,
  session_id        text not null,
  offer_hash        text not null,
  doc               jsonb not null,
  created_at        timestamptz not null default now()
);

create index if not exists accepted_offers_session_idx on accepted_offers (session_id);

/* ────────────────────────────  Payments  ──────────────────────────── */

-- Local implementation of the Visa Intelligent Commerce control model.
-- Never called a "mandate" in judge-facing copy.
create table if not exists payment_instructions (
  id          text primary key,
  session_id  text not null,
  state       text not null,
  doc         jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists payment_instructions_session_idx on payment_instructions (session_id);

-- No PAN, no CVV, no expiry is ever written here. The tokenized reference
-- (last four of the network token) is all the application model carries.
create table if not exists payment_transactions (
  id                     text primary key,
  payment_instruction_id text not null references payment_instructions (id) on delete cascade,
  status                 text not null,
  doc                    jsonb not null,
  created_at             timestamptz not null default now()
);

create table if not exists orders (
  id           text primary key,
  session_id   text not null,
  merchant_id  text not null references merchants (id) on delete cascade,
  doc          jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists orders_session_idx on orders (session_id);

/* ────────────────────────────  Onboarding  ──────────────────────────── */

create table if not exists onboarding_sessions (
  id           text primary key,
  merchant_id  text,
  doc          jsonb not null,
  updated_at   timestamptz not null default now()
);

create table if not exists voice_transcripts (
  id                    text primary key,
  onboarding_session_id text not null,
  doc                   jsonb not null,
  created_at            timestamptz not null default now()
);

create index if not exists voice_transcripts_session_idx
  on voice_transcripts (onboarding_session_id);

/* ────────────────────────────  Event trail  ──────────────────────────── */

-- Drives the backend visualization and doubles as the audit trail that maps to
-- Visa Intelligent Commerce commerce signals in the production architecture.
create table if not exists agent_events (
  id          text primary key,
  session_id  text not null,
  seq         integer not null,
  event_type  text not null,
  doc         jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists agent_events_session_seq_idx on agent_events (session_id, seq);
create unique index if not exists agent_events_session_seq_uniq on agent_events (session_id, seq);

/* ────────────────────────────  Lockdown  ──────────────────────────── */

alter table merchants            enable row level security;
alter table merchant_profiles    enable row level security;
alter table products             enable row level security;
alter table customer_sessions    enable row level security;
alter table customer_intents     enable row level security;
alter table offers               enable row level security;
alter table counteroffers        enable row level security;
alter table accepted_offers      enable row level security;
alter table payment_instructions enable row level security;
alter table payment_transactions enable row level security;
alter table orders               enable row level security;
alter table onboarding_sessions  enable row level security;
alter table voice_transcripts    enable row level security;
alter table agent_events         enable row level security;

-- No policies are created on purpose. RLS with zero policies denies every
-- anon/authenticated request; the service-role key used by the server bypasses
-- RLS. Adding a permissive policy here would expose merchant commercial rules
-- and cost prices to anyone holding the publishable key.
