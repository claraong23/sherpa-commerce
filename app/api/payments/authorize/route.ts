import { z } from 'zod'
import { authorizePayment } from '@agents/purchase-flow'
import { faultsFrom, FaultsInput, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({
  sessionId: z.string(),
  paymentInstructionId: z.string(),
  faults: FaultsInput,
})

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const result = await authorizePayment({
    sessionId: data.sessionId,
    paymentInstructionId: data.paymentInstructionId,
    faults: faultsFrom(data.faults),
  })

  // A declined authorization is a valid outcome, not an HTTP error.
  return ok(result)
}
