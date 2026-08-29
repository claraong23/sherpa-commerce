import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { assertServer } from '@core/server-guard'

assertServer('@visa/webauthn')

/**
 * Passkey confirmation.
 *
 * Real WebAuthn: the browser produces an assertion with a platform
 * authenticator and this module verifies it — challenge binding, origin, RP ID
 * hash, user-presence flag and the ES256 signature over
 * `authenticatorData || SHA-256(clientDataJSON)`.
 *
 * Production mapping: Visa Payment Passkeys. We are not integrated with Visa's
 * Passkey Service; this is a browser FIDO credential registered against this
 * app's origin.
 */

export type PasskeyMethod = 'webauthn' | 'simulated'

interface StoredCredential {
  credentialId: string
  /** SPKI DER public key, base64. Taken from `response.getPublicKey()`. */
  publicKeySpki: string
  algorithm: number
  createdAt: number
}

interface WebauthnState {
  challenges: Map<string, { challenge: string; expires: number; kind: 'register' | 'authenticate' }>
  credentials: Map<string, StoredCredential>
}

const GLOBAL_KEY = Symbol.for('vac.webauthn')

function state(): WebauthnState {
  const g = globalThis as unknown as Record<symbol, WebauthnState | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { challenges: new Map(), credentials: new Map() }
  return g[GLOBAL_KEY]!
}

export function issueChallenge(sessionId: string, kind: 'register' | 'authenticate') {
  const challenge = randomBytes(32).toString('base64url')
  state().challenges.set(`${sessionId}:${kind}`, {
    challenge,
    expires: Date.now() + 5 * 60 * 1000,
    kind,
  })
  return challenge
}

function consumeChallenge(sessionId: string, kind: 'register' | 'authenticate'): string | null {
  const key = `${sessionId}:${kind}`
  const entry = state().challenges.get(key)
  if (!entry) return null
  state().challenges.delete(key)
  if (entry.expires < Date.now()) return null
  return entry.challenge
}

export function hasCredential(sessionId: string): boolean {
  return state().credentials.has(sessionId)
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

interface ClientData {
  type: string
  challenge: string
  origin: string
}

function parseClientData(clientDataJSONb64: string): ClientData {
  return JSON.parse(b64urlToBuf(clientDataJSONb64).toString('utf8')) as ClientData
}

function originHostMatches(origin: string, allowed: string[]): boolean {
  try {
    const h = new URL(origin).host
    return allowed.some((a) => {
      try {
        return new URL(a).host === h
      } catch {
        return a === h
      }
    })
  } catch {
    return false
  }
}

export interface RegisterInput {
  sessionId: string
  credentialId: string
  clientDataJSON: string
  /** base64 SPKI from AuthenticatorAttestationResponse.getPublicKey() */
  publicKeySpki: string
  algorithm: number
  allowedOrigins: string[]
}

export function verifyRegistration(input: RegisterInput): { ok: boolean; error?: string } {
  const expected = consumeChallenge(input.sessionId, 'register')
  if (!expected) return { ok: false, error: 'no pending registration challenge' }

  let cd: ClientData
  try {
    cd = parseClientData(input.clientDataJSON)
  } catch {
    return { ok: false, error: 'clientDataJSON is not valid JSON' }
  }
  if (cd.type !== 'webauthn.create') return { ok: false, error: `unexpected type ${cd.type}` }
  if (cd.challenge !== expected) return { ok: false, error: 'challenge mismatch' }
  if (!originHostMatches(cd.origin, input.allowedOrigins)) {
    return { ok: false, error: `origin ${cd.origin} not allowed` }
  }
  if (input.algorithm !== -7) {
    return { ok: false, error: `unsupported COSE algorithm ${input.algorithm}; this demo verifies ES256 (-7)` }
  }

  state().credentials.set(input.sessionId, {
    credentialId: input.credentialId,
    publicKeySpki: input.publicKeySpki,
    algorithm: input.algorithm,
    createdAt: Date.now(),
  })
  return { ok: true }
}

/** WebAuthn signs with ASN.1 DER; WebCrypto ECDSA wants raw r||s. */
function derToRawEcdsa(der: Buffer): Buffer {
  let offset = 0
  if (der[offset++] !== 0x30) throw new Error('bad DER sequence')
  const seqLen = der[offset++]
  if (seqLen & 0x80) offset += seqLen & 0x7f
  const readInt = (): Buffer => {
    if (der[offset++] !== 0x02) throw new Error('bad DER integer')
    const len = der[offset++]
    let v = der.subarray(offset, offset + len)
    offset += len
    while (v.length > 32 && v[0] === 0x00) v = v.subarray(1)
    if (v.length < 32) v = Buffer.concat([Buffer.alloc(32 - v.length), v])
    return v
  }
  return Buffer.concat([readInt(), readInt()])
}

export interface AuthenticateInput {
  sessionId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  allowedOrigins: string[]
  expectedRpIds: string[]
}

export async function verifyAssertion(
  input: AuthenticateInput,
): Promise<{ ok: boolean; error?: string; userPresent?: boolean }> {
  const cred = state().credentials.get(input.sessionId)
  if (!cred) return { ok: false, error: 'no registered passkey for this session' }

  const expected = consumeChallenge(input.sessionId, 'authenticate')
  if (!expected) return { ok: false, error: 'no pending authentication challenge' }

  let cd: ClientData
  try {
    cd = parseClientData(input.clientDataJSON)
  } catch {
    return { ok: false, error: 'clientDataJSON is not valid JSON' }
  }
  if (cd.type !== 'webauthn.get') return { ok: false, error: `unexpected type ${cd.type}` }
  if (cd.challenge !== expected) return { ok: false, error: 'challenge mismatch' }
  if (!originHostMatches(cd.origin, input.allowedOrigins)) {
    return { ok: false, error: `origin ${cd.origin} not allowed` }
  }

  const authData = b64urlToBuf(input.authenticatorData)
  if (authData.length < 37) return { ok: false, error: 'authenticatorData too short' }

  const rpIdHash = authData.subarray(0, 32)
  const rpMatches = input.expectedRpIds.some((rp) =>
    createHash('sha256').update(rp).digest().equals(rpIdHash),
  )
  if (!rpMatches) return { ok: false, error: 'RP ID hash does not match this origin' }

  const flags = authData[32]
  const userPresent = (flags & 0x01) === 0x01
  if (!userPresent) return { ok: false, error: 'user presence flag not set' }

  const clientDataHash = createHash('sha256').update(b64urlToBuf(input.clientDataJSON)).digest()
  const signedData = Buffer.concat([authData, clientDataHash])

  try {
    const key = await webcrypto.subtle.importKey(
      'spki',
      Buffer.from(cred.publicKeySpki, 'base64'),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const raw = derToRawEcdsa(b64urlToBuf(input.signature))
    const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signedData)
    return ok ? { ok: true, userPresent } : { ok: false, error: 'signature did not verify' }
  } catch (err) {
    return { ok: false, error: `verification error: ${(err as Error).message}` }
  }
}

export function clearCredential(sessionId: string) {
  state().credentials.delete(sessionId)
}
