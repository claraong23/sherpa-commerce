# Supabase

## Optional

The app runs the entire demo without Supabase, on an in-process seeded store.
Configure Supabase when you want state to survive a restart or to be shared
across serverless instances.

## Setup

1. Create a project (a region near Singapore if available).
2. Copy the values into `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

   The app switches to Postgres when **both** `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are present. A partially-configured environment
   stays on the in-memory store rather than failing halfway through a demo.

3. Apply the migration:

   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```

   Or paste `migrations/20260801000000_init.sql` into the SQL editor.

4. Seed:

   ```bash
   pnpm seed
   ```

## Security

Every table has RLS enabled with **no policies**, which denies all anon and
authenticated access. The server uses the service-role key, which bypasses RLS.

This matters: `products.doc` contains `costPrice`, and `merchant_profiles.doc`
contains discount ceilings and margin floors. A permissive policy would expose
merchant commercial data to anyone holding the publishable key.

The service-role key is server-only and must never be given a `NEXT_PUBLIC_`
prefix.
