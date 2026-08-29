import { getStore } from '@core/db'
import { CustomerScreen } from './CustomerScreen'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Customer agent — Agentic Commerce',
}

export default async function CustomerPage() {
  const store = getStore()
  const merchants = (await store.listMerchants()).filter((m) => m.networkEnabled)

  const objectives: Record<string, string | null> = {}
  for (const m of merchants) {
    const profile = await store.getProfile(m.id)
    objectives[m.id] = profile?.primaryObjective ?? null
  }

  return <CustomerScreen merchants={merchants} objectives={objectives} />
}
