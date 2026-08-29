import { replayEvents, subscribe } from '@core/events/bus'
import { getStore } from '@core/db'
import type { AgentEvent } from '@core/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Server-sent event stream of real agent events for one session.
 *
 * Two sources, deduplicated by seq:
 *  - the in-process emitter (instant, same-process),
 *  - a poll of the persisted event log (survives a different worker handling
 *    the POST than the one holding this stream, e.g. on serverless).
 */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const url = new URL(req.url)
  const since = Number(url.searchParams.get('since') ?? 0) || 0

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSeq = since
      const seen = new Set<number>()

      const send = (event: AgentEvent) => {
        if (closed) return
        if (event.seq <= since || seen.has(event.seq)) return
        seen.add(event.seq)
        if (event.seq > lastSeq) lastSeq = event.seq
        try {
          controller.enqueue(
            encoder.encode(`event: agent\nid: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          closed = true
        }
      }

      controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`))

      for (const e of await replayEvents(sessionId, since)) send(e)

      const unsubscribe = subscribe(sessionId, send)

      const poll = setInterval(async () => {
        if (closed) return
        try {
          const store = getStore()
          for (const e of await store.listEvents(sessionId, lastSeq)) send(e)
        } catch {
          /* transient store error; the next tick retries */
        }
      }, 1200)

      // Keeps proxies from closing an idle connection.
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
        } catch {
          closed = true
        }
      }, 15000)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(poll)
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
