import type { AgentEvent, ArtifactRef, BoundEventDraft } from '../events/schema.js'
import { consumeLlmStream } from '../llm/consume.js'
import { estimateMessageTokens, estimateTextTokens } from '../llm/budget.js'
import type { IrMessage, LlmDelta, LlmRequest } from '../llm/types.js'
import type { SessionLedger } from '../events/ledger.js'
import { DEFAULT_COMPACTION_POLICY, type AgentEnv, type ContextCompactionPolicy } from '../seams.js'
import { throwIfAborted } from './cancellation.js'

export { DEFAULT_COMPACTION_POLICY }

/**
 * Conservative context-window assumption used only when the active model
 * route reports no `contextWindowTokens`. It enables proactive auto-compact
 * for unconfigured routes while staying small enough that the provider's
 * real window is almost always larger.
 */
export const DEFAULT_ASSUMED_CONTEXT_WINDOW_TOKENS = 200_000

/**
 * One `[from, to)` sequence-number window covering all events of a single
 * turn, from its `turn.started` up to (not including) the next turn's start.
 */
export interface TurnRange {
  readonly turnId: string
  readonly fromSeq: number
  /** Exclusive upper bound. */
  readonly toSeq: number
}

export function turnRanges(events: readonly AgentEvent[]): readonly TurnRange[] {
  const ranges: TurnRange[] = []
  const lastSeq = events.at(-1)?.seq ?? -1
  for (const event of events) {
    if (event.type !== 'turn.started') continue
    ranges.push({ turnId: event.turnId, fromSeq: event.seq, toSeq: lastSeq + 1 })
  }
  for (let index = 0; index < ranges.length - 1; index += 1) {
    const current = ranges[index]
    const next = ranges[index + 1]
    if (current && next) ranges[index] = { ...current, toSeq: next.fromSeq }
  }
  return ranges
}

/**
 * Smallest safely-droppable context units. Older turns are dropped whole;
 * inside the newest turn the range is subdivided at assistant boundaries —
 * each unit is one complete exchange (assistant message plus every tool call
 * and result it produced), so dropping a unit never orphans a tool pair and
 * never removes the latest exchange the model is still working from.
 */
export function droppableUnits(
  events: readonly AgentEvent[],
  policy: ContextCompactionPolicy,
): readonly TurnRange[] {
  const ranges = turnRanges(events)
  const current = ranges.at(-1)
  if (current === undefined) return []
  const older = ranges.slice(0, -1)
  const keepOlder = Math.max(0, policy.keepRecentTurns - 1)
  const units: TurnRange[] = older
    .slice(0, Math.max(0, older.length - keepOlder))
    .map((range) => ({ ...range }))
  // Subdivide the current turn at assistant boundaries and offer every
  // segment except the last (the live exchange) for dropping.
  const assistantSeqs = events
    .filter(
      (event) =>
        event.type === 'assistant.completed' &&
        event.seq >= current.fromSeq &&
        event.seq < current.toSeq,
    )
    .map((event) => event.seq)
  let start = current.fromSeq
  const segments: TurnRange[] = []
  for (const boundary of assistantSeqs) {
    segments.push({ turnId: current.turnId, fromSeq: start, toSeq: boundary })
    start = boundary
  }
  segments.push({ turnId: current.turnId, fromSeq: start, toSeq: current.toSeq })
  units.push(...segments.slice(0, -1))
  return units
}

export interface CompactionPlan {
  /** Oldest context units that will be summarized and dropped. */
  readonly dropped: readonly TurnRange[]
  /** Estimated token count of the dropped part. */
  readonly droppedTokens: number
  readonly remainingTokens: number
}

/**
 * Pure planner: chooses which oldest context units to drop so the kept
 * context fits comfortably under the compaction threshold. Tool call/result
 * pairs always share one unit, so dropping whole units never orphans a pair.
 */
export function planCompaction(
  messages: readonly IrMessage[],
  events: readonly AgentEvent[],
  policy: ContextCompactionPolicy,
  options: { readonly force?: boolean } = {},
): CompactionPlan | undefined {
  const units = droppableUnits(events, policy)
  if (units.length === 0) return undefined

  let droppedTokens = 0
  let remainingTokens = 0
  for (const message of messages) {
    const firstSeq = message.sourceSeqs[0]
    const droppedUnit =
      firstSeq !== undefined &&
      units.some((unit) => firstSeq >= unit.fromSeq && firstSeq < unit.toSeq)
    if (droppedUnit) droppedTokens += estimateMessageTokens(message)
    else remainingTokens += estimateMessageTokens(message)
  }
  if (droppedTokens === 0) return undefined
  if (!options.force && droppedTokens < policy.minCompactableTokens) return undefined
  return { dropped: units, droppedTokens, remainingTokens }
}

function turnIdOf(plan: CompactionPlan, seq: number): string | undefined {
  return plan.dropped.find((range) => seq >= range.fromSeq && seq < range.toSeq)?.turnId
}

/** Turns dropped ranges plus projected messages into the summarizer input. */
export function droppedMessages(
  plan: CompactionPlan,
  messages: readonly IrMessage[],
): readonly IrMessage[] {
  const droppedTurnIds = new Set(plan.dropped.map((range) => range.turnId))
  return messages.filter((message) => {
    const firstSeq = message.sourceSeqs[0]
    if (firstSeq === undefined) return false
    // Membership is decided by the first source seq: every source seq of a
    // message belongs to the same turn range.
    const turnId = turnIdOf(plan, firstSeq)
    return turnId !== undefined && droppedTurnIds.has(turnId)
  })
}

/**
 * System prompt for the compaction call. The summary is a handoff document:
 * the model continues the task from this text alone, so concrete state
 * matters far more than prose.
 */
export const COMPACTION_SUMMARY_PROMPT = `You are the context-compaction pass of the Spark agent runtime. The conversation above is being summarized to free context window; the next turn continues this exact task from your summary alone.

Write a dense handoff summary in markdown with exactly these sections:

# Conversation Summary
## 1. Task & Intent
What the user asked for, verbatim constraints, and success criteria.
## 2. Current State
What has been done so far and what is in progress. Include the last action and its outcome.
## 3. Key Decisions & Rationale
Choices made and why, including rejected alternatives that must not be retried.
## 4. Files & Artifacts
Every file path, command, URL, or identifier that was read, written, or referenced, with one line on why it matters.
## 5. Important Tool Results
Numbers, errors, stack traces, and outputs that are still needed to finish the task.
## 6. Next Steps
The concrete, ordered steps to continue.

Rules:
- Preserve exact identifiers: file paths, symbols, commands, versions, error codes.
- Never invent state that is not visible in the conversation.
- Keep it under 2000 words. Prefer lists over prose.`

/** Summarizer input is capped so the compaction call itself cannot overflow. */
const SUMMARY_INPUT_TOKEN_CAP = 60_000

export interface CompactOutcome {
  readonly event: AgentEvent
  readonly summary: string
  readonly plan: CompactionPlan
}

export interface CompactOptions {
  readonly sessionId: string
  readonly cwd: string
  readonly permissionMode?: string
  /** Full event history of the session (buffered by the caller). */
  readonly events: readonly AgentEvent[]
  readonly ledger: SessionLedger
  readonly signal?: AbortSignal
  readonly force?: boolean
  readonly onDelta?: (delta: LlmDelta) => Promise<void> | void
}

export interface CompactSkipped {
  readonly skipped: 'nothing-to-compact' | 'planner-declined' | 'summary-failed'
  readonly detail?: string
}

/**
 * Runs one compaction pass against a session ledger: projects the history,
 * picks the oldest turns to drop, summarizes them through the LLM, persists
 * the summary as an artifact, and appends a `context.compacted` event so the
 * projector replaces the dropped prefix with the summary on every later step.
 */
export class ContextCompactor {
  constructor(
    private readonly env: AgentEnv,
    private readonly policy: ContextCompactionPolicy = DEFAULT_COMPACTION_POLICY,
  ) {}

  async compact(options: CompactOptions): Promise<CompactOutcome | CompactSkipped> {
    const projected = this.env.projector.project(options.events, {
      cwd: options.cwd,
      ...(options.permissionMode === undefined
        ? {}
        : { permissionMode: options.permissionMode as never }),
    })
    const plan = planCompaction(projected.messages, options.events, this.policy, {
      ...(options.force === true ? { force: true } : {}),
    })
    if (plan === undefined) return { skipped: 'nothing-to-compact' }

    const summary = await this.#summarize(plan, projected.messages, options)
    if (summary === undefined) {
      return { skipped: 'summary-failed', detail: 'The summarization call did not return text.' }
    }

    const summaryRef = await this.env.artifacts.put(summary, 'text/markdown')
    const event = await options.ledger.append({
      type: 'context.compacted',
      schemaVersion: 1,
      summary,
      summaryRef,
      droppedRanges: plan.dropped.map((range) => [range.fromSeq, range.toSeq]),
    } satisfies BoundEventDraft)
    this.env.telemetry.counter('context.compacted', {
      droppedTurns: plan.dropped.length,
      droppedTokens: plan.droppedTokens,
      remainingTokens: plan.remainingTokens,
    })
    return { event, summary, plan }
  }

  async #summarize(
    plan: CompactionPlan,
    messages: readonly IrMessage[],
    options: CompactOptions,
  ): Promise<string | undefined> {
    if (options.signal !== undefined) throwIfAborted(options.signal)
    const signal = options.signal ?? new AbortController().signal
    const input = droppedMessages(plan, messages).map(stripImageRefs)
    if (input.length === 0) return undefined

    // Hierarchical summarization: inputs over the cap are split into chunks,
    // each summarized by its own call, and the final pass summarizes the
    // intermediate summaries — so nothing is silently discarded, only
    // progressively condensed.
    const chunks = chunkMessages(input, SUMMARY_INPUT_TOKEN_CAP)
    if (chunks.length > 1) {
      this.env.telemetry.counter('context.compaction.chunked', { chunks: chunks.length })
    }
    const intermediates: string[] = []
    for (const chunk of chunks) {
      const summary = await this.#summaryCall(renderTranscript(chunk), options, signal)
      if (summary === undefined) return undefined
      if (chunks.length === 1) return summary
      intermediates.push(summary)
    }

    // Reduce pass. If even the condensed intermediates overflow, degrade by
    // dropping the oldest ones and say so in the input.
    let reduceEntries = intermediates
    let degraded = false
    while (
      reduceEntries.length > 1 &&
      estimateTextTokens(reduceEntries.join('\n\n')) > SUMMARY_INPUT_TOKEN_CAP
    ) {
      reduceEntries = reduceEntries.slice(1)
      degraded = true
    }
    const reduceBody =
      (degraded ? `${SUMMARY_INPUT_NOTE}\n\n` : '') +
      reduceEntries
        .map((summary, index) => `[Earlier segment ${index + 1} summary]\n${summary}`)
        .join('\n\n')
    return await this.#summaryCall(reduceBody, options, signal)
  }

  async #summaryCall(
    body: string,
    options: CompactOptions,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const request: LlmRequest = {
      system: [
        { id: 'compaction-summary', stability: 'volatile', content: COMPACTION_SUMMARY_PROMPT },
      ],
      messages: [{ role: 'user', content: body, sourceSeqs: [] }],
      tools: [],
      maxTokens: 16_384,
      metadata: { sessionId: options.sessionId, purpose: 'context-compaction' },
    }
    try {
      const response = await consumeLlmStream(
        this.env.llm.stream(request, {
          signal,
          turnId: options.sessionId,
          stepId: 'compaction',
        }),
        options.onDelta === undefined ? undefined : async (delta) => options.onDelta?.(delta),
      )
      return response.message.text?.trim() ?? undefined
    } catch {
      // Compaction is an optimization; a failed summarization call must not
      // break the ongoing turn. The caller falls back to the original error.
      this.env.telemetry.counter('context.compaction.summary_failed', {})
      return undefined
    }
  }
}

/**
 * Greedy token-bounded chunking for the summarizer input. A single message
 * larger than the cap forms its own oversized chunk rather than being split
 * mid-message; an empty input yields no chunks.
 */
export function chunkMessages(
  messages: readonly IrMessage[],
  capTokens: number,
): readonly (readonly IrMessage[])[] {
  const chunks: (readonly IrMessage[])[] = []
  let current: IrMessage[] = []
  let currentTokens = 0
  for (const message of messages) {
    const tokens = estimateMessageTokens(message)
    if (current.length > 0 && currentTokens + tokens > capTokens) {
      chunks.push(current)
      current = []
      currentTokens = 0
    }
    current.push(message)
    currentTokens += tokens
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const SUMMARY_INPUT_NOTE =
  '[Some of the oldest intermediate summaries were omitted from this reduction input to fit the window; their detail is only available in the condensed segments that fit.]'

function stripImageRefs(message: IrMessage): IrMessage {
  if (message.role !== 'user') return message
  // Summaries are text-only; image payloads stay in the artifact store and
  // remain reachable through the dropped turns' ledger entries.
  return { role: 'user', content: message.content, sourceSeqs: message.sourceSeqs }
}

function renderTranscript(messages: readonly IrMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === 'user') return `[user]\n${message.content}`
      if (message.role === 'tool_result') {
        return `[tool:${message.tool} ${message.ok ? 'ok' : 'error'}]\n${message.content}`
      }
      const calls = message.toolCalls
        .map((call) => `- ${call.name}(${safeJson(call.args)}) [${call.callId}]`)
        .join('\n')
      const parts = [
        `[assistant]`,
        ...(message.content ? [message.content] : []),
        ...(calls ? [`Tool calls:\n${calls}`] : []),
      ]
      return parts.join('\n')
    })
    .join('\n\n')
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return '[unserializable]'
  }
}

/**
 * Provider errors that mean "the request no longer fits the context window".
 * Only these justify compacting mid-turn and retrying the same step.
 */
export function isContextOverflowError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { readonly code?: unknown }).code
  if (typeof code === 'string' && code === 'llm.context_window_exhausted') return true
  const detailCode = nestedCode(error)
  if (detailCode === 'context_length_exceeded') return true
  const message = error.message.toLowerCase()
  return (
    message.includes('context length exceeded') ||
    message.includes('maximum context length') ||
    message.includes('prompt is too long') ||
    message.includes('context_window_exhausted')
  )
}

function nestedCode(error: Error): string | undefined {
  const detail = (error as { readonly detail?: unknown }).detail
  if (typeof detail !== 'object' || detail === null) return undefined
  const cause = (detail as Record<string, unknown>).cause
  if (typeof cause !== 'object' || cause === null) return undefined
  const code = (cause as Record<string, unknown>).code
  return typeof code === 'string' ? code : undefined
}

/** Estimated tokens of the composed request, excluding tool schemas. */
export function estimateContextTokens(
  system: readonly { content: string }[],
  messages: readonly IrMessage[],
): number {
  return (
    system.reduce((total, section) => total + estimateTextTokens(section.content) + 16, 0) +
    messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
  )
}

// ---------------------------------------------------------------------------
// Microcompact: sink stale tool-result bodies into the artifact store and
// keep a head+tail stub in context. Unlike full compaction, no message is
// removed — tool pairing is untouched and the body stays recoverable.
// ---------------------------------------------------------------------------

export interface SlimCandidate {
  readonly callId: string
  readonly tool: string
  readonly content: string
  readonly tokens: number
}

/** Fixed stub geometry, independent of the body size being slimmed. */
const SLIM_HEAD_CHARS = 500
const SLIM_TAIL_CHARS = 200

/**
 * Pure planner: stale tool results (older than `microcompactKeepExchanges`
 * assistant boundaries) whose body is large enough to be worth a stub.
 */
export function planMicrocompact(
  messages: readonly IrMessage[],
  events: readonly AgentEvent[],
  policy: ContextCompactionPolicy,
): readonly SlimCandidate[] {
  if (!policy.microcompactEnabled) return []
  const assistantSeqs = events
    .filter((event) => event.type === 'assistant.completed')
    .map((event) => event.seq)
  const candidates: SlimCandidate[] = []
  for (const message of messages) {
    if (message.role !== 'tool_result' || !message.ok) continue
    const lastSeq = Math.max(...message.sourceSeqs)
    const newerExchanges = assistantSeqs.filter((seq) => seq > lastSeq).length
    if (newerExchanges < policy.microcompactKeepExchanges) continue
    const tokens = estimateMessageTokens(message)
    if (tokens < policy.microcompactMinTokens) continue
    candidates.push({
      callId: message.callId,
      tool: message.tool,
      content: message.content,
      tokens,
    })
  }
  return candidates
}

/** Head+tail stub replacing a slimmed body; mirrors processToolOutput style. */
export function slimmedStub(content: string, fullHint: string, savedTokens: number): string {
  const omitted = Math.max(0, content.length - SLIM_HEAD_CHARS - SLIM_TAIL_CHARS)
  return (
    `${content.slice(0, SLIM_HEAD_CHARS)}\n\n` +
    `… microcompacted: ${omitted} characters moved to artifact (≈${savedTokens} tokens freed per step) …\n` +
    `Full output: ${fullHint}\n\n` +
    content.slice(-SLIM_TAIL_CHARS)
  )
}

const STUB_BASE_TOKENS =
  estimateTextTokens(
    '… microcompacted: 000000 characters moved to artifact (≈00000 tokens freed per step) …\nFull output: sha256:0000000000000000000000000000000000000000000000000000000000000000 (1234567 bytes)\n\n',
  ) + Math.ceil((SLIM_HEAD_CHARS + SLIM_TAIL_CHARS) / 3)

/**
 * Runs one microcompact batch: sinks every planned body into the artifact
 * store and appends a single `context.tool_results_slimmed` event so the
 * projector swaps in the stubs on every later step.
 */
export async function slimToolResults(
  env: AgentEnv,
  options: {
    readonly events: readonly AgentEvent[]
    readonly messages: readonly IrMessage[]
    readonly ledger: SessionLedger
    readonly policy: ContextCompactionPolicy
  },
): Promise<
  | {
      readonly event: AgentEvent
      readonly slimmedCount: number
      readonly savedTokens: number
    }
  | { readonly skipped: 'nothing-to-slim' }
> {
  const candidates = planMicrocompact(options.messages, options.events, options.policy).slice(
    0,
    Math.max(1, options.policy.microcompactMaxPerTurn),
  )
  const slimmed: {
    callId: string
    fullRef: ArtifactRef
    slimmedContent: string
    savedTokens: number
  }[] = []
  for (const candidate of candidates) {
    const fullRef = await env.artifacts.put(candidate.content, 'text/plain')
    const savedTokens = Math.max(0, candidate.tokens - STUB_BASE_TOKENS)
    if (savedTokens <= 0) continue
    slimmed.push({
      callId: candidate.callId,
      fullRef,
      slimmedContent: slimmedStub(candidate.content, fullRef.readHint, savedTokens),
      savedTokens,
    })
  }
  if (slimmed.length === 0) return { skipped: 'nothing-to-slim' }
  const event = await options.ledger.append({
    type: 'context.tool_results_slimmed',
    schemaVersion: 1,
    slimmed,
  })
  const savedTotal = slimmed.reduce((total, entry) => total + entry.savedTokens, 0)
  env.telemetry.counter('context.tool_results_slimmed', {
    count: slimmed.length,
    savedTokens: savedTotal,
  })
  return { event, slimmedCount: slimmed.length, savedTokens: savedTotal }
}
