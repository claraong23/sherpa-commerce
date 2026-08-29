/**
 * Loads the demo merchants, profiles and catalogue into whichever store is
 * configured (Supabase when credentials are present, otherwise in-memory).
 */
import 'dotenv/config'
import { getStore } from '../packages/core/src/db'

async function main() {
  const store = getStore()
  console.log(`store: ${store.kind}`)

  const result = await store.reseed()
  console.log(`seeded ${result.merchants} merchants, ${result.products} products`)

  for (const m of await store.listMerchants()) {
    const products = await store.listProducts(m.id)
    const profile = await store.getProfile(m.id)
    const inStock = products.filter((p) => p.stock > 0).length
    console.log(
      `  ${m.name.padEnd(16)} ${String(products.length).padStart(2)} products (${inStock} in stock)  objective=${profile?.primaryObjective ?? '—'}`,
    )
  }

  if (store.kind === 'memory') {
    console.log('')
    console.log('In-memory store: this seed lives for the duration of the process.')
    console.log('The running app seeds itself on boot, so no action is needed for the demo.')
    console.log('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to persist to Postgres.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
