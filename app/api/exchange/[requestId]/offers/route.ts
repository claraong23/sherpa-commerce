import { getStore } from '@core/db'
import { rankOffers } from '@core/scoring/score'
import { bad, ok } from '../../../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params
  const store = getStore()
  const intent = await store.getIntent(requestId)
  if (!intent) return bad('unknown request', 404)

  const all = await store.listOffers(requestId)
  const live = all.filter((o) => o.state === 'sealed' || o.state === 'locked')
  return ok({ requestId, intent, offers: all, ranked: rankOffers(live, intent) })
}
