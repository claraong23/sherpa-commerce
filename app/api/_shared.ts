import { NextResponse } from 'next/server'
import { z } from 'zod'
import { DemoFaultsSchema, EMPTY_FAULTS, type DemoFaults } from '@core/schemas'

/** Shared helpers for route handlers. Domain logic lives in packages/, not here. */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init)
}

export function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T>; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { data: null, error: bad('request body must be JSON') }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      data: null,
      error: bad('invalid request body', 422, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
    }
  }
  return { data: parsed.data, error: null }
}

export const FaultsInput = DemoFaultsSchema.partial().optional()

export function faultsFrom(input: Partial<DemoFaults> | undefined): DemoFaults {
  return { ...EMPTY_FAULTS, ...(input ?? {}) }
}

/**
 * Very small fixed-window guard for the AI-backed routes. Enough to stop a
 * runaway client burning credits; not a production rate limiter.
 */
const WINDOW_MS = 60_000
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, retryAfter: 0 }
  }
  b.count += 1
  if (b.count > max) return { allowed: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) }
  return { allowed: true, retryAfter: 0 }
}

export function clientKey(req: Request, salt: string): string {
  const fwd = req.headers.get('x-forwarded-for') ?? 'local'
  return `${salt}:${fwd.split(',')[0].trim()}`
}
