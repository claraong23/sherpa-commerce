import { getStore } from '../db'
import { id, nowIso } from '../ids'
import type { AgentActor, AgentEvent, AgentEventType } from '../schemas'
import { eventLabel } from './labels'

/**
 * Central agent event bus.
 *
 * Every meaningful state transition in the customer flow calls
 * `emitAgentEvent`. The event is (a) persisted and (b) pushed to any live SSE
 * subscriber. The visualization renders from this stream — no component
 * animates on a timer, and no business logic lives in a component.
 */

type Listener = (e: AgentEvent) => void

interface BusState {
  listeners: Map<string, Set<Listener>>
  seq: Map<string, number>
}

const GLOBAL_KEY = Symbol.for('vac.event-bus')

function bus(): BusState {
  const g = globalThis as unknown as Record<symbol, BusState | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { listeners: new Map(), seq: new Map() }
  return g[GLOBAL_KEY]!
}

function nextSeq(sessionId: string): number {
  const b = bus()
  const n = (b.seq.get(sessionId) ?? 0) + 1
  b.seq.set(sessionId, n)
  return n
}

export interface EmitInput {
  sessionId: string
  type: AgentEventType
  actor: AgentActor
  merchantId?: string | null
  label?: string
  payload?: Record<string, unknown>
}

export async function emitAgentEvent(input: EmitInput): Promise<AgentEvent> {
  const event: AgentEvent = {
    id: id('evt'),
    seq: nextSeq(input.sessionId),
    sessionId: input.sessionId,
    eventType: input.type,
    actor: input.actor,
    merchantId: input.merchantId ?? null,
    label: input.label ?? eventLabel(input.type),
    payload: input.payload ?? {},
    createdAt: nowIso(),
  }

  const subs = bus().listeners.get(input.sessionId)
  if (subs) for (const fn of subs) { try { fn(event) } catch { /* subscriber died; drop it on next flush */ } }

  try {
    await getStore().appendEvent(event)
  } catch (err) {
    // Persistence failure must not break the live flow.
    console.warn('[events] persist failed:', (err as Error).message)
  }
  return event
}

export function subscribe(sessionId: string, fn: Listener): () => void {
  const b = bus()
  if (!b.listeners.has(sessionId)) b.listeners.set(sessionId, new Set())
  b.listeners.get(sessionId)!.add(fn)
  return () => {
    const set = b.listeners.get(sessionId)
    set?.delete(fn)
    if (set && set.size === 0) b.listeners.delete(sessionId)
  }
}

export async function replayEvents(sessionId: string, sinceSeq = 0): Promise<AgentEvent[]> {
  try {
    return await getStore().listEvents(sessionId, sinceSeq)
  } catch {
    return []
  }
}

export { EVENT_LABELS, eventLabel } from './labels'
