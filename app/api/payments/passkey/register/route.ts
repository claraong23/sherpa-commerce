import { z } from 'zod'
import { serverEnv } from '@core/env'
import { verifyRegistration } from '@visa/webauthn'
import { bad, ok, parseBody } from '../../../_shared'

export const runtime = 'nodejs'

const Body = z.object({
  sessionId: z.string(),
  credentialId: z.string().max(2000),
  clientDataJSON: z.string().max(8000),
  publicKeySpki: z.string().max(4000),
  algorithm: z.number(),
})

function allowedOrigins(req: Request): string[] {
  const env = serverEnv()
  const origin = req.headers.get('origin')
  return [env.appUrl, origin, 'http://localhost:3000'].filter(Boolean) as string[]
}

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, Body)
  if (error) return error

  const result = verifyRegistration({ ...data, allowedOrigins: allowedOrigins(req) })
  if (!result.ok) return bad(result.error ?? 'registration failed', 400)
  return ok({ registered: true })
}
