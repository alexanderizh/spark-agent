import { errorMessage } from '../config/config-file.js'
import type { AgentEvent } from '../events/schema.js'
import { consumeLlmStream } from '../llm/consume.js'
import type { LlmRequest } from '../llm/types.js'
import { estimateTextTokens } from '../llm/budget.js'
import { NULL_RUNTIME_LOGGER, type RuntimeLogger } from '../observability/logger.js'
import { turnRanges } from '../kernel/compaction.js'
import type { MemoryType } from './store.js'
import type { FileMemoryStore } from './store.js'
import type { AgentEnv } from '../seams.js'

/**
 * Memory auto-extraction: after a turn completes, distill durable facts from
 * that turn's conversation into the memory store.
 *
 * The pass is intentionally conservative and fully isolated from the turn
 * itself — it runs after the terminal event, never changes the turn result,
 * and any failure is logged, not raised. Extraction finds nothing worth
 * keeping in most turns; the prompt is tuned to return an empty array rather
 * than inventing entries.
 */

export const MEMORY_EXTRACTION_PROMPT = `You are the memory-extraction pass of the Spark agent runtime. The conversation turn below just finished. Extract durable facts worth remembering in FUTURE sessions.

Extract only:
- User preferences and working style (scope "user", type "user" or "feedback")
- Project facts: build/test commands, architecture decisions, constraints, key file locations (scope "project", type "project" or "reference")

Do NOT extract:
- Transient task state, in-progress work, or one-off instructions
- Anything directly readable from the repository at any time
- Anything about how this extraction should work

Return a JSON array with at most 3 items, each shaped exactly:
{"scope":"user","type":"user","name":"Short stable name","description":"One line","body":"Durable detail, self-contained"}

"body" must be understandable without the conversation. Return [] when nothing qualifies. Output ONLY the JSON array — no prose, no code fences.`

/** Input is capped so extraction itself can never overflow the window. */
const EXTRACTION_INPUT_TOKEN_CAP = 30_000
const EXTRACTION_MAX_OUTPUT_TOKENS = 2_048

export interface ExtractedMemory {
  readonly scope: 'user' | 'project'
  readonly type: MemoryType
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface MemoryExtractionOptions {
  readonly env: AgentEnv
  readonly store: FileMemoryStore
  /** Full session event history; only the newest turn is distilled. */
  readonly events: readonly AgentEvent[]
  readonly sessionId: string
  readonly maxItems?: number
  readonly signal?: AbortSignal
  readonly logger?: RuntimeLogger
}

export interface MemoryExtractionOutcome {
  readonly extracted: readonly ExtractedMemory[]
  readonly saved: number
}

/**
 * Distills the newest turn and persists what qualifies. Returns the count of
 * memories written; failures are swallowed (logged) by design.
 */
export async function extractAndSaveMemories(
  options: MemoryExtractionOptions,
): Promise<MemoryExtractionOutcome> {
  const logger = options.logger ?? NULL_RUNTIME_LOGGER
  try {
    const extracted = await extractMemoriesFromTurn(options)
    let saved = 0
    for (const memory of extracted) {
      await options.store.save({
        scope: memory.scope,
        type: memory.type,
        name: memory.name,
        description: memory.description,
        body: memory.body,
        confidence: 0.9,
        sourceSessionId: options.sessionId,
      })
      saved += 1
    }
    if (saved > 0) {
      options.env.telemetry.counter('memory.extracted', { count: saved })
      logger.info(`memory extraction saved ${saved} entr${saved === 1 ? 'y' : 'ies'}`)
    }
    return { extracted, saved }
  } catch (error) {
    // Extraction is an optimization over manual `memory save`; a failure must
    // never surface to the user after the turn already succeeded.
    logger.warn(`memory extraction failed: ${errorMessage(error)}`)
    return { extracted: [], saved: 0 }
  }
}

/** Distills the newest turn into candidate memories (no persistence). */
export async function extractMemoriesFromTurn(
  options: Pick<MemoryExtractionOptions, 'env' | 'events' | 'maxItems' | 'signal'>,
): Promise<readonly ExtractedMemory[]> {
  const maxItems = options.maxItems ?? 3
  const events = newestTurnEvents(options.events)
  if (events.length === 0) return []
  const transcript = renderTurnTranscript(events)
  if (transcript.trim() === '') return []

  const request: LlmRequest = {
    system: [{ id: 'memory-extraction', stability: 'volatile', content: MEMORY_EXTRACTION_PROMPT }],
    messages: [
      {
        role: 'user',
        content: `<turn>\n${transcript}\n</turn>\n\nExtract memories as a JSON array (max ${maxItems} items, [] if nothing qualifies).`,
        sourceSeqs: [],
      },
    ],
    tools: [],
    maxTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    metadata: { purpose: 'memory-extraction' },
  }
  const response = await consumeLlmStream(
    options.env.llm.stream(request, {
      signal: options.signal ?? new AbortController().signal,
      turnId: 'memory-extraction',
      stepId: 'memory-extraction',
    }),
  )
  return parseExtraction(response.message.text ?? '', maxItems)
}

/** Events of the last `turn.started`..end window (the turn just finished). */
function newestTurnEvents(events: readonly AgentEvent[]): readonly AgentEvent[] {
  const ranges = turnRanges(events)
  const last = ranges.at(-1)
  if (last === undefined) return []
  return events.filter((event) => event.seq >= last.fromSeq && event.seq < last.toSeq)
}

const TOOL_RESULT_HEAD_CHARS = 400

/**
 * Renders the turn as a transcript, trimming the OLDEST parts first when the
 * input exceeds the cap — the newest exchanges carry the most extractable
 * signal, and every part is already a lossy view of the ledger.
 */
function renderTurnTranscript(events: readonly AgentEvent[]): string {
  const parts: string[] = []
  for (const event of events) {
    switch (event.type) {
      case 'turn.started':
        parts.push(`[user]\n${event.input.text}`)
        break
      case 'assistant.completed':
        if (event.message.text) parts.push(`[assistant]\n${event.message.text}`)
        for (const call of event.message.toolCalls) {
          parts.push(`[tool call] ${call.name}(${safeJson(call.args)})`)
        }
        break
      case 'tool.result': {
        const content =
          event.content.length > TOOL_RESULT_HEAD_CHARS
            ? `${event.content.slice(0, TOOL_RESULT_HEAD_CHARS)}…(truncated)`
            : event.content
        parts.push(`[tool result ok=${event.ok}]\n${content}`)
        break
      }
      default:
        break
    }
  }
  while (parts.length > 1 && estimateTokens(parts) > EXTRACTION_INPUT_TOKEN_CAP) {
    parts.shift()
  }
  return parts.join('\n\n')
}

function estimateTokens(parts: readonly string[]): number {
  return parts.reduce((total, part) => total + estimateTextTokens(part) + 8, 0)
}

/**
 * Parses the extractor's JSON array. Tolerates code fences and a leading
 * prose line; anything shape-invalid is dropped rather than rejected.
 */
export function parseExtraction(text: string, maxItems: number): readonly ExtractedMemory[] {
  const jsonText = stripFences(text)
  const start = jsonText.indexOf('[')
  const end = jsonText.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const extracted: ExtractedMemory[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const scope = record.scope === 'user' ? 'user' : 'project'
    const name = asSingleLine(record.name)
    const description = asSingleLine(record.description)
    const body = typeof record.body === 'string' ? record.body.trim() : ''
    const type = normalizeType(record.type, scope)
    if (name === undefined || description === undefined || body === '') continue
    extracted.push({ scope, type, name, description, body })
    if (extracted.length >= maxItems) break
  }
  return extracted
}

function stripFences(text: string): string {
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)
  return fenceMatch?.[1] ?? text
}

function normalizeType(value: unknown, scope: 'user' | 'project'): MemoryType {
  const allowed: MemoryType[] =
    scope === 'user' ? ['user', 'feedback'] : ['project', 'reference', 'feedback']
  const candidate = typeof value === 'string' ? (value as MemoryType) : undefined
  return candidate !== undefined && allowed.includes(candidate) ? candidate : scope
}

function asSingleLine(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const collapsed = value.replaceAll(/\s+/gu, ' ').trim()
  return collapsed === '' ? undefined : collapsed.slice(0, 500)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return '[unserializable]'
  }
}
