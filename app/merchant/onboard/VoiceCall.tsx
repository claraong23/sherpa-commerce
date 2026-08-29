'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Badge, Button, Spinner, StatusDot } from '@ui/primitives'

/**
 * In-browser AI voice interview.
 *
 * Preferred path: OpenAI Realtime over WebRTC. The browser gets a short-lived
 * client secret minted server-side — the standard API key never reaches the
 * client. Live transcript comes from the Realtime data channel.
 *
 * Fallback path: MediaRecorder captures the merchant's audio and the call ends
 * with a clearly-labelled note that no AI voice was available. Both paths
 * produce a transcript that goes to the same structured-extraction endpoint.
 */

type CallState = 'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'

interface Turn {
  role: string
  text: string
}

export function VoiceCall({
  sessionId,
  transcript,
  available,
  onComplete,
  onCancel,
}: {
  sessionId: string
  transcript: Turn[]
  available: boolean
  onComplete: (turns: Turn[], seconds: number, mode: string) => void
  onCancel: () => void
}) {
  const [state, setState] = useState<CallState>('idle')
  const [mode, setMode] = useState<'openai_realtime' | 'recorder_fallback'>('openai_realtime')
  const [reason, setReason] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>(transcript)
  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [questions, setQuestions] = useState<string[]>([])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const partialRef = useRef<Record<string, string>>({})
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const pushTurn = useCallback((role: string, text: string) => {
    if (!text.trim()) return
    setTurns((prev) => [...prev, { role, text: text.trim() }])
  }, [])

  const startRealtime = useCallback(
    async (clientSecret: string, model: string, stream: MediaStream) => {
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      const audio = new Audio()
      audio.autoplay = true
      audioRef.current = audio
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0]
      }

      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream))

      const channel = pc.createDataChannel('oai-events')
      channel.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data) as Record<string, unknown>
          const type = String(evt.type ?? '')

          // Merchant speech.
          if (type === 'conversation.item.input_audio_transcription.completed') {
            pushTurn('merchant', String(evt.transcript ?? ''))
          }
          // Agent speech, streamed as deltas then finalised.
          if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
            const rid = String(evt.response_id ?? 'r')
            partialRef.current[rid] = (partialRef.current[rid] ?? '') + String(evt.delta ?? '')
          }
          if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
            const rid = String(evt.response_id ?? 'r')
            const text = String(evt.transcript ?? partialRef.current[rid] ?? '')
            delete partialRef.current[rid]
            pushTurn('agent', text)
          }
        } catch {
          /* non-JSON frame */
        }
      }
      channel.onopen = () => {
        channel.send(JSON.stringify({ type: 'response.create' }))
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${clientSecret}`, 'content-type': 'application/sdp' },
        body: offer.sdp,
      })
      if (!res.ok) throw new Error(`SDP exchange returned ${res.status}`)

      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
    },
    [pushTurn],
  )

  const start = useCallback(async () => {
    setState('connecting')
    setReason(null)
    setTurns([])

    let sessionInfo: {
      mode: 'openai_realtime' | 'recorder_fallback'
      clientSecret?: string
      model?: string
      reason?: string
      questions?: string[]
    }
    try {
      sessionInfo = await fetch('/api/onboarding/voice-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then((r) => r.json())
    } catch (err) {
      setState('error')
      setReason(`Could not create a voice session: ${(err as Error).message}`)
      return
    }

    setQuestions(sessionInfo.questions ?? [])

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
    } catch {
      setState('error')
      setReason('Microphone permission was denied, so the call cannot start.')
      return
    }

    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)

    if (sessionInfo.mode === 'openai_realtime' && sessionInfo.clientSecret) {
      try {
        await startRealtime(sessionInfo.clientSecret, sessionInfo.model!, stream)
        setMode('openai_realtime')
        setState('live')
        return
      } catch (err) {
        setReason(`Realtime connection failed (${(err as Error).message}); recording locally instead.`)
      }
    } else {
      setReason(sessionInfo.reason ?? 'OpenAI Realtime is not configured on this deployment.')
    }

    // Fallback: record locally, no AI voice.
    setMode('recorder_fallback')
    try {
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      rec.start()
    } catch {
      /* recording is best-effort in the fallback */
    }
    setState('live')
  }, [sessionId, startRealtime])

  const end = useCallback(async () => {
    setState('ending')
    cleanup()
    const finalTurns = turns
    try {
      await fetch('/api/onboarding/voice-summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, turns: finalTurns, durationSeconds: seconds, mode }),
      })
    } catch {
      /* the parent still receives the transcript */
    }
    setState('ended')
    onComplete(finalTurns, seconds, mode)
  }, [cleanup, turns, sessionId, seconds, mode, onComplete])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next))
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <section className="panel anim-in overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-2.5">
        <span className="label-xs">AI onboarding call</span>
        <div className="flex items-center gap-2">
          {state === 'live' && (
            <Badge tone={mode === 'openai_realtime' ? 'ok' : 'warn'}>
              <StatusDot tone={mode === 'openai_realtime' ? 'ok' : 'pending'} pulse />
              {mode === 'openai_realtime' ? 'OpenAI Realtime' : 'Recording only'}
            </Badge>
          )}
          <span className="mono text-[11px] text-ink-400">
            {mm}:{ss}
          </span>
        </div>
      </header>

      <div className="p-4">
        {state === 'idle' && (
          <div className="text-center">
            <Orb active={false} />
            <p className="mx-auto mt-3 max-w-sm text-[12px] leading-relaxed text-ink-400">
              {available
                ? 'The agent will ask only what it still needs. It already has your catalogue.'
                : 'OpenAI Realtime is not configured here, so the call will record your answers locally and transcribe them into rules afterwards.'}
            </p>
            {questions.length > 0 && (
              <p className="mt-1.5 text-[10.5px] text-ink-500">{questions.length} questions outstanding</p>
            )}
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={start}>Start call</Button>
              <Button variant="ghost" onClick={onCancel}>
                Not now
              </Button>
            </div>
          </div>
        )}

        {state === 'connecting' && (
          <div className="flex flex-col items-center py-6 text-[12px] text-ink-400">
            <Spinner className="mb-2 text-brand-300" />
            Connecting audio…
          </div>
        )}

        {state === 'error' && (
          <div className="text-center">
            <p className="text-[12px] leading-relaxed text-bad-400">{reason}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={start}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {(state === 'live' || state === 'ending') && (
          <>
            <div className="flex items-center justify-center gap-6">
              <Orb active={!muted} />
            </div>

            {reason && (
              <p className="mt-3 rounded-lg border border-warn-500/30 bg-warn-500/[0.07] px-3 py-2 text-[10.5px] leading-relaxed text-warn-500">
                {reason}
              </p>
            )}

            <div
              ref={logRef}
              className="mt-3 max-h-56 space-y-2 overflow-auto rounded-lg border border-ink-800 bg-ink-850 p-3"
            >
              {turns.length === 0 ? (
                <div className="py-3 text-center text-[11.5px] text-ink-600">
                  {mode === 'openai_realtime' ? 'Waiting for speech…' : 'Recording. Speak your rules aloud.'}
                </div>
              ) : (
                turns.map((t, i) => (
                  <div key={i} className="anim-in">
                    <div className="label-xs">{t.role}</div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-ink-100">{t.text}</div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={toggleMute}>
                {muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button size="sm" variant="danger" onClick={end} disabled={state === 'ending'}>
                {state === 'ending' ? 'Summarising…' : 'End call'}
              </Button>
            </div>
          </>
        )}

        {state === 'ended' && (
          <div className="py-3 text-center text-[12px] text-ink-400">
            Call ended. The rules extracted from it are in the panel below, awaiting your approval.
          </div>
        )}
      </div>
    </section>
  )
}

function Orb({ active }: { active: boolean }) {
  return (
    <div className="relative mx-auto h-20 w-20">
      <div
        className={clsx(
          'absolute inset-0 rounded-full border transition-colors',
          active ? 'border-brand-400/60' : 'border-ink-700',
        )}
      />
      <div
        className={clsx(
          'absolute inset-2 rounded-full transition-opacity',
          active ? 'anim-pulse bg-brand-500/25' : 'bg-ink-800',
        )}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
            stroke={active ? 'var(--color-brand-300)' : 'var(--color-ink-500)'}
            strokeWidth="1.6"
          />
          <path
            d="M19 11a7 7 0 0 1-14 0M12 18v3"
            stroke={active ? 'var(--color-brand-300)' : 'var(--color-ink-500)'}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}
