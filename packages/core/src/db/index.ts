import { assertServer } from '../server-guard'
import { serverEnv } from '../env'
import { memoryStore } from './memory'
import { SupabaseStore } from './supabase'
import type { DataStore } from './types'

export type { DataStore } from './types'
export { MemoryStore, memoryStore } from './memory'
export { SupabaseStore } from './supabase'

assertServer('@core/db')

const GLOBAL_KEY = Symbol.for('vac.datastore')

/**
 * Supabase when both URL and service-role key are present; otherwise the seeded
 * in-process store. Missing credentials degrade the demo, they never break it.
 */
export function getStore(): DataStore {
  const g = globalThis as unknown as Record<symbol, DataStore | undefined>
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY]!

  const env = serverEnv()
  let store: DataStore
  if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    try {
      store = new SupabaseStore(env.supabaseUrl, env.supabaseServiceRoleKey)
    } catch (err) {
      console.warn('[db] Supabase init failed, falling back to in-memory seed store:', err)
      store = memoryStore()
    }
  } else {
    store = memoryStore()
  }
  g[GLOBAL_KEY] = store
  return store
}
