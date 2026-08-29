import { z } from 'zod'
import { lockOffer } from '@agents/purchase-flow'
import { bad, faultsFrom, FaultsInput, ok, parseBody } from '../../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({ sessionId: z.string(), faults: FaultsInput })

export async function POST(req: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const result = await lockOffer({
    sessionId: data.sessionId,
    offerId,
    faults: faultsFrom(data.faults),
  })
  if (!result.ok) {
    return bad(result.detail, 409, { code: result.failureCode, checks: result.checks })
  }
  return ok(result)
}
