import OpenAI from 'openai'
import { z } from 'zod'
import { serverEnv } from '@core/env'
import { assertServer } from '@core/server-guard'

assertServer('@agents/llm')

/**
 * Single point of contact with OpenAI.
 *
 * Two invariants:
 *  1. The API key never leaves the server — no route ever returns it and no
 *     client component imports this module.
 *  2. Every structured response is parsed through Zod before it can influence
 *     application state. A model that returns nonsense degrades to the
 *     deterministic fallback the caller supplies; it never becomes truth.
 */

const GLOBAL_KEY = Symbol.for('vac.openai')

export function llmAvailable(): boolean {
  const env = serverEnv()
  return Boolean(env.openaiApiKey && env.enableLlm)
}

function client(): OpenAI | null {
  const env = serverEnv()
  if (!env.openaiApiKey || !env.enableLlm) return null
  const g = globalThis as unknown as Record<symbol, OpenAI | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new OpenAI({ apiKey: env.openaiApiKey })
  return g[GLOBAL_KEY]!
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Free-text completion. Returns null when the LLM is unavailable or fails. */
export async function complete(
  messages: LlmMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  const c = client()
  if (!c) return null
  try {
    const res = await c.chat.completions.create({
      model: serverEnv().openaiModel,
      messages,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.4,
    })
    return res.choices[0]?.message?.content?.trim() ?? null
  } catch (err) {
    console.warn('[llm] completion failed:', (err as Error).message)
    return null
  }
}

/**
 * Structured output validated against a Zod schema. Returns null on any
 * failure — unavailable, transport error, malformed JSON, or schema violation.
 * Callers must have a deterministic path for null.
 */
export async function structured<T extends z.ZodTypeAny>(args: {
  schema: T
  schemaName: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
}): Promise<z.infer<T> | null> {
  const c = client()
  if (!c) return null
  try {
    const res = await c.chat.completions.create({
      model: serverEnv().openaiModel,
      messages: [
        ...args.messages,
        {
          role: 'system',
          content:
            'Respond with a single JSON object and nothing else. No markdown fences, no commentary.',
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: args.maxTokens ?? 700,
      temperature: args.temperature ?? 0.2,
    })
    const raw = res.choices[0]?.message?.content
    if (!raw) return null
    const parsed = args.schema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.warn(`[llm] ${args.schemaName} failed validation:`, parsed.error.issues.slice(0, 3))
      return null
    }
    return parsed.data
  } catch (err) {
    console.warn(`[llm] ${args.schemaName} failed:`, (err as Error).message)
    return null
  }
}

/**
 * Strip anything that could carry a credential into a prompt. Applied to every
 * externally-sourced string before it reaches the model.
 */
export function scrubForPrompt(text: string, maxChars = 4000): string {
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[redacted-pan]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]')
    .replace(/\bshpat_[A-Za-z0-9]+\b/g, '[redacted-token]')
    .replace(/\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .slice(0, maxChars)
}
