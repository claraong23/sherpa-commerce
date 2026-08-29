import { randomBytes, randomUUID } from 'node:crypto'

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function shortCode(len = 5): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function id(prefix: string): string {
  return `${prefix}_${shortCode(4)}${shortCode(4)}`.toLowerCase()
}

export function uuid(): string {
  return randomUUID()
}

export function agentIdFor(slug: string): string {
  return `merchant_${slug.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${shortCode(5)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export function isExpired(iso: string, at: number = Date.now()): boolean {
  return new Date(iso).getTime() <= at
}
