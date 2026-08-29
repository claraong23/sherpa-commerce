'use client'

/**
 * Browser-side WebAuthn helpers.
 *
 * The public key is taken from `response.getPublicKey()` (SPKI DER), which
 * avoids parsing CBOR attestation in the browser and gives the server exactly
 * what WebCrypto needs to verify the later assertion.
 */

export function webauthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    window.isSecureContext
  )
}

/**
 * How long to wait for the platform authenticator before giving up.
 *
 * Feature detection is not enough: a browser on localhost reports full WebAuthn
 * support, then `credentials.create` simply never settles when no authenticator
 * is available (headless, no platform authenticator, no security key). Without
 * this the purchase button sits on "Authorizing…" for the full 60s WebAuthn
 * timeout, which is the worst possible thing to happen during a demo.
 */
export const PASSKEY_TIMEOUT_MS = 8000

/** Races a credential call against the timeout, aborting the request on expiry. */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms = PASSKEY_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('passkey timed out'))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export interface ChallengePayload {
  challenge: string
  rp: { name: string }
  user: { id: string; name: string; displayName: string }
}

export async function registerPasskey(sessionId: string, payload: ChallengePayload): Promise<void> {
  const cred = (await withTimeout((signal) =>
    navigator.credentials.create({
      signal,
      publicKey: {
        challenge: b64urlToBytes(payload.challenge) as BufferSource,
        rp: { name: payload.rp.name },
        user: {
          id: new TextEncoder().encode(payload.user.id) as BufferSource,
          name: payload.user.name,
          displayName: payload.user.displayName,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          userVerification: 'preferred',
          residentKey: 'discouraged',
        },
        timeout: PASSKEY_TIMEOUT_MS,
        attestation: 'none',
      },
    }),
  )) as PublicKeyCredential | null

  if (!cred) throw new Error('passkey registration cancelled')

  const response = cred.response as AuthenticatorAttestationResponse
  const spki = response.getPublicKey?.()
  if (!spki) throw new Error('browser did not expose the credential public key')

  const res = await fetch('/api/payments/passkey/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      credentialId: bytesToB64url(cred.rawId),
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      publicKeySpki: bytesToB64(spki),
      algorithm: response.getPublicKeyAlgorithm?.() ?? -7,
    }),
  })
  if (!res.ok) throw new Error(`registration rejected: ${(await res.json()).error}`)
}

export async function signWithPasskey(challenge: string): Promise<{
  clientDataJSON: string
  authenticatorData: string
  signature: string
}> {
  const cred = (await withTimeout((signal) =>
    navigator.credentials.get({
      signal,
      publicKey: {
        challenge: b64urlToBytes(challenge) as BufferSource,
        userVerification: 'preferred',
        timeout: PASSKEY_TIMEOUT_MS,
      },
    }),
  )) as PublicKeyCredential | null

  if (!cred) throw new Error('passkey confirmation cancelled')

  const r = cred.response as AuthenticatorAssertionResponse
  return {
    clientDataJSON: bytesToB64url(r.clientDataJSON),
    authenticatorData: bytesToB64url(r.authenticatorData),
    signature: bytesToB64url(r.signature),
  }
}
