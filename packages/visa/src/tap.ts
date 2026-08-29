import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto'
import { sha256Base64 } from '@core/canonical'
import { serverEnv } from '@core/env'
import { assertServer } from '@core/server-guard'

assertServer('@visa/tap')

/**
 * TAP-STYLE AGENT SIGNING — HONEST SCOPE
 *
 * This implements the *signing and verification pattern* described by Visa's
 * public Trusted Agent Protocol material, constructed along RFC 9421 lines:
 * a covered-component signature base, a `created` timestamp, a single-use
 * nonce, a content digest over the request body, and an Ed25519 signature.
 *
 * It is NOT a registered Visa agent identity. The keypair is generated locally
 * (or read from env). Nothing here has been enrolled with, issued by, or
 * validated against Visa infrastructure. In production, agent identity would
 * come from Visa's registration/directory infrastructure rather than a key on
 * this machine.
 */

export const TAP_ALGORITHM = 'ed25519'
export const TAP_IMPLEMENTATION_NOTE =
  'TAP-style signing implementation (RFC 9421-aligned signature base, Ed25519). Demo key is locally generated and is not registered with Visa.'

export type AgentIntent = 'BROWSE' | 'PURCHASE' | 'NEGOTIATE'

export interface TapKeyPair {
  privateKeyBase64: string
  publicKeyBase64: string
  keyId: string
  origin: 'env' | 'ephemeral'
}

const GLOBAL_KEY = Symbol.for('vac.tap-keys')
const NONCE_KEY = Symbol.for('vac.tap-nonces')

/** Ed25519 raw 32-byte seed → PKCS8 DER wrapper. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
/** Ed25519 raw 32-byte public key → SPKI DER wrapper. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function privateKeyFromRaw(raw: Buffer) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' })
}

function publicKeyFromRaw(raw: Buffer) {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
}

export function generateTapKeyPair(): { privateKeyBase64: string; publicKeyBase64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer
  const pub = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return {
    // Strip the DER wrappers so the env value is a plain 32-byte base64 key.
    privateKeyBase64: priv.subarray(priv.length - 32).toString('base64'),
    publicKeyBase64: pub.subarray(pub.length - 32).toString('base64'),
  }
}

export function tapKeys(): TapKeyPair {
  const g = globalThis as unknown as Record<symbol, TapKeyPair | undefined>
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY]!
  const env = serverEnv()
  let kp: TapKeyPair
  if (env.tapPrivateKey && env.tapPublicKey) {
    kp = {
      privateKeyBase64: env.tapPrivateKey,
      publicKeyBase64: env.tapPublicKey,
      keyId: env.tapKeyId,
      origin: 'env',
    }
  } else {
    const gen = generateTapKeyPair()
    kp = { ...gen, keyId: env.tapKeyId, origin: 'ephemeral' }
  }
  g[GLOBAL_KEY] = kp
  return kp
}

/* ─────────────────────────  Signature base (RFC 9421-aligned)  ───────────────────────── */

export interface SignedRequest {
  method: string
  path: string
  body: string
  contentDigest: string
  signatureInput: string
  signature: string
  keyId: string
  created: number
  nonce: string
  agentIntent: AgentIntent
  agentId: string
}

const COVERED = ['"@method"', '"@path"', '"content-digest"', '"agent-intent"', '"agent-id"'] as const

function signatureParams(args: {
  created: number
  nonce: string
  keyId: string
}): string {
  return `(${COVERED.join(' ')});created=${args.created};nonce="${args.nonce}";keyid="${args.keyId}";alg="ed25519"`
}

export function buildSignatureBase(args: {
  method: string
  path: string
  contentDigest: string
  agentIntent: AgentIntent
  agentId: string
  params: string
}): string {
  return [
    `"@method": ${args.method.toUpperCase()}`,
    `"@path": ${args.path}`,
    `"content-digest": ${args.contentDigest}`,
    `"agent-intent": ${args.agentIntent}`,
    `"agent-id": ${args.agentId}`,
    `"@signature-params": ${args.params}`,
  ].join('\n')
}

export function signAgentRequest(args: {
  method: string
  path: string
  body: unknown
  agentIntent: AgentIntent
  agentId: string
}): SignedRequest {
  const keys = tapKeys()
  const body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body)
  const contentDigest = `sha-256=:${sha256Base64(body)}:`
  const created = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('base64url')
  const params = signatureParams({ created, nonce, keyId: keys.keyId })
  const base = buildSignatureBase({
    method: args.method,
    path: args.path,
    contentDigest,
    agentIntent: args.agentIntent,
    agentId: args.agentId,
    params,
  })
  const sig = edSign(null, Buffer.from(base, 'utf8'), privateKeyFromRaw(Buffer.from(keys.privateKeyBase64, 'base64')))
  return {
    method: args.method.toUpperCase(),
    path: args.path,
    body,
    contentDigest,
    signatureInput: params,
    signature: sig.toString('base64'),
    keyId: keys.keyId,
    created,
    nonce,
    agentIntent: args.agentIntent,
    agentId: args.agentId,
  }
}

/* ─────────────────────────────  Verification  ───────────────────────────── */

export type TapFailureCode =
  | 'AGENT_SIGNATURE_INVALID'
  | 'AGENT_DIGEST_MISMATCH'
  | 'AGENT_TIMESTAMP_SKEW'
  | 'AGENT_NONCE_REPLAY'
  | 'AGENT_UNKNOWN_KEY'

export interface VerifyResult {
  valid: boolean
  code: TapFailureCode | null
  detail: string
  agentId: string
  agentIntent: AgentIntent
  keyId: string
}

const MAX_SKEW_SECONDS = 300

function nonceStore(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>
  if (!g[NONCE_KEY]) g[NONCE_KEY] = new Map()
  return g[NONCE_KEY]!
}

function rememberNonce(nonce: string): boolean {
  const store = nonceStore()
  const now = Date.now()
  // Evict expired entries so the replay window stays bounded.
  for (const [k, exp] of store) if (exp < now) store.delete(k)
  if (store.has(nonce)) return false
  store.set(nonce, now + MAX_SKEW_SECONDS * 1000)
  return true
}

export function verifyAgentRequest(
  req: SignedRequest,
  opts: { publicKeyBase64?: string; skipReplayCheck?: boolean } = {},
): VerifyResult {
  const keys = tapKeys()
  const pubB64 = opts.publicKeyBase64 ?? keys.publicKeyBase64
  const out = (valid: boolean, code: TapFailureCode | null, detail: string): VerifyResult => ({
    valid,
    code,
    detail,
    agentId: req.agentId,
    agentIntent: req.agentIntent,
    keyId: req.keyId,
  })

  if (!pubB64) return out(false, 'AGENT_UNKNOWN_KEY', 'no public key registered for this agent')

  const expectedDigest = `sha-256=:${sha256Base64(req.body)}:`
  if (expectedDigest !== req.contentDigest) {
    return out(false, 'AGENT_DIGEST_MISMATCH', 'request body does not match content-digest')
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - req.created)
  if (skew > MAX_SKEW_SECONDS) {
    return out(false, 'AGENT_TIMESTAMP_SKEW', `created timestamp is ${skew}s outside the accepted window`)
  }

  if (!opts.skipReplayCheck && !rememberNonce(req.nonce)) {
    return out(false, 'AGENT_NONCE_REPLAY', 'nonce has already been used')
  }

  const base = buildSignatureBase({
    method: req.method,
    path: req.path,
    contentDigest: req.contentDigest,
    agentIntent: req.agentIntent,
    agentId: req.agentId,
    params: req.signatureInput,
  })

  let ok = false
  try {
    ok = edVerify(
      null,
      Buffer.from(base, 'utf8'),
      publicKeyFromRaw(Buffer.from(pubB64, 'base64')),
      Buffer.from(req.signature, 'base64'),
    )
  } catch {
    ok = false
  }
  if (!ok) return out(false, 'AGENT_SIGNATURE_INVALID', 'Ed25519 signature did not verify over the signature base')

  return out(true, null, 'signature valid')
}

/** Corrupt a signature for the demo failure panel. */
export function tamperSignature(req: SignedRequest): SignedRequest {
  const buf = Buffer.from(req.signature, 'base64')
  buf[0] = buf[0] ^ 0xff
  return { ...req, signature: buf.toString('base64') }
}
