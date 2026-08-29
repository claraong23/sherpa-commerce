import { z } from 'zod'
import { issuePaymentInstruction } from '@agents/purchase-flow'
import { getStore } from '@core/db'
import { visaModeLabel } from '@visa/index'
import { bad, faultsFrom, FaultsInput, ok, parseBody } from '../../_shared'

export const runtime = 'nodejs'
export const maxDuration = 30

const Body = z.object({
  sessionId: z.string(),
  acceptedOfferId: z.string(),
  faults: FaultsInput,
})

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const store = getStore()
  const accepted = await store.getAcceptedOffer(data.acceptedOfferId)
  if (!accepted) return bad('unknown accepted offer', 404)

  const merchant = await store.getMerchant(accepted.merchantId)
  const offer = await store.getOffer(accepted.offerId)

  const instruction = await issuePaymentInstruction({
    sessionId: data.sessionId,
    acceptedOfferId: data.acceptedOfferId,
    faults: faultsFrom(data.faults),
  })

  return ok({
    instruction,
    visa: visaModeLabel(),
    merchantName: merchant?.name ?? accepted.merchantId,
    offer: offer
      ? {
          offerId: offer.offerId,
          title: offer.product.title,
          bundle: offer.bundle,
          warrantyYears: offer.warrantyYears,
          deliveryDays: offer.deliveryDays,
          hash: accepted.offerHash,
        }
      : null,
  })
}
