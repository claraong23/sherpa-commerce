import { integrationStatus } from '@core/env'
import { visaModeLabel } from '@visa/index'
import { TAP_IMPLEMENTATION_NOTE, tapKeys } from '@visa/tap'
import { getStore } from '@core/db'
import { ok } from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Integration status for the developer/detail panels. Contains no secrets. */
export async function GET() {
  const status = integrationStatus()
  const visa = visaModeLabel()
  const keys = tapKeys()
  const store = getStore()
  const merchants = await store.listMerchants()
  let products = 0
  for (const m of merchants) products += (await store.listProducts(m.id)).length

  return ok({
    ...status,
    visaLabel: visa.label,
    visaHonesty: visa.honesty,
    tap: {
      algorithm: 'ed25519',
      keyId: keys.keyId,
      keyOrigin: keys.origin,
      note: TAP_IMPLEMENTATION_NOTE,
    },
    seed: { merchants: merchants.length, products },
  })
}
