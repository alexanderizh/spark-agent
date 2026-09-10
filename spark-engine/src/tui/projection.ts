import type { AgentEvent } from '../events/schema.js'
import { stableStringify } from '../kernel/stable-json.js'
import type { TerminalCapabilities } from './theme.js'
import { glyphs } from './theme.js'
import { presentTool, presentToolResult, singleLine } from './tool-presentation.js'

export type RowTone = 'normal' | 'dim' | 'accent' | 'ok' | 'warn' | 'error'

/** Visual block kind; the renderer applies per-kind chrome (background, gaps). */
export type RowKind = 'user' | 'thinking' | 'plain' | 'assistant'

/** Structured view of a settled tool line, colored per-part by the renderer. */
export interface ToolLineParts {
  readonly processStatus?: string
  readonly processId?: string
  readonly tool: string
  readonly title: string
  readonly detail?: string
  readonly ok: boolean
  readonly durationMs: string
  readonly resultLines: readonly string[]
  readonly sessionId?: string
  readonly isTask: boolean
}

export interface TranscriptRow {
  readonly key: string
  readonly text: string
  readonly tone: RowTone
  readonly kind?: RowKind
  readonly toolLine?: ToolLineParts
}

export interface ActiveToolProjection {
  readonly callId: string
  readonly tool: string
  readonly title: string
  readonly detail?: string
  readonly isTask: boolean
  readonly status: 'pending' | 'approval' | 'running'
}

export interface TranscriptProjection {
  readonly settled: readonly TranscriptRow[]
  readonly activeTools: readonly ActiveToolProjection[]
}

export interface UnknownEvent {
  readonly type: string
  readonly seq?: number
  readonly [key: string]: unknown
}

export function projectTranscript(
  events: readonly (AgentEvent | UnknownEvent)[],
  capabilities: TerminalCapabilities,
): TranscriptProjection {
  const settled: TranscriptRow[] = []
  const calls = new Map<string, Extract<AgentEvent, { type: 'tool.call' }>>()
  const intents = new Set<string>()
  const waitingApproval = new Set<string>()
  const stepTurns = new Map<string, string>()
  const callTurns = new Map<string, string>()
  const terminalTurns = new Set<string>()
  let currentTurn: string | undefined
  const results = new Set<string>()
  const permissions = new Map<string, Extract<AgentEvent, { type: 'permission.requested' }>>()
  const symbols = glyphs(capabilities)

  for (const candidate of events) {
    if (!isKnownEvent(candidate)) {
      settled.push({
        key: `unknown-${candidate.seq ?? settled.length}`,
        text: `[event:${candidate.type} #${candidate.seq ?? '?'}]`,
        tone: 'dim',
      })
      continue
    }
    const event = candidate
    switch (event.type) {
      case 'turn.started':
        currentTurn = event.turnId
        settled.push({
          key: `event-${event.seq}`,
          text: `${symbols.bullet} ${event.input.text}`,
          tone: 'normal',
          kind: 'user',
        })
        break
      case 'assistant.completed':
        if (event.message.thinking) {
          settled.push({
            key: `thinking-${event.seq}`,
            text: wrapThinking(
              event.message.thinking,
              Math.max(20, capabilities.width - 4),
              symbols.bar,
            ),
            tone: 'dim',
            kind: 'thinking',
          })
        }
        if (event.message.text) {
          settled.push({
            key: `event-${event.seq}`,
            text: event.message.text,
            tone: 'normal',
            kind: 'assistant',
          })
        }
        break
      case 'tool.call':
        calls.set(event.callId, event)
        {
          const turn = stepTurns.get(event.stepId) ?? currentTurn
          if (turn !== undefined) callTurns.set(event.callId, turn)
        }
        break
      case 'tool.intent':
        intents.add(event.callId)
        break
      case 'tool.result': {
        results.add(event.callId)
        const call = calls.get(event.callId)
        const mark = event.ok ? symbols.success : symbols.failure
        const presentation = presentTool(call?.tool ?? 'unknown', call?.args)
        const result = presentToolResult(
          call?.tool ?? 'unknown',
          event.content,
          event.durationMs,
          capabilities.width,
          event.childSessionId,
        )
        settled.push({
          key: `tool-${event.callId}`,
          text: `${symbols.tool} ${presentation.title} ${mark} ${event.durationMs}ms`,
          tone: event.ok ? 'dim' : 'error',
          toolLine: {
            tool: call?.tool ?? 'unknown',
            title: presentation.title,
            ...(presentation.detail === undefined ? {} : { detail: presentation.detail }),
            ok: event.ok,
            durationMs: result.duration,
            resultLines: result.lines,
            ...(result.processStatus === undefined ? {} : { processStatus: result.processStatus }),
            ...(result.processId === undefined ? {} : { processId: result.processId }),
            ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
            isTask: call?.tool === 'task',
          },
        })
        break
      }
      case 'permission.requested':
        permissions.set(event.requestId, event)
        waitingApproval.add(event.callId)
        break
      case 'permission.decided': {
        const request = permissions.get(event.requestId)
        if (request) waitingApproval.delete(request.callId)
        settled.push({
          key: `permission-${event.requestId}`,
          text: `● ${event.decision === 'allow' ? 'allowed' : 'denied'} ${request?.risk.tool ?? 'tool'}${event.grantScope ? ` scope=${event.grantScope}` : ''}`,
          tone: 'dim',
        })
        break
      }
      case 'permission.evaluated':
        break
      case 'turn.completed':
        terminalTurns.add(event.turnId)
        if (event.reason === 'budget') {
          settled.push({
            key: `event-${event.seq}`,
            text: `${symbols.failure} 执行因预算限制结束 · ${event.stats.steps} steps · ${event.stats.toolCalls} tool calls`,
            tone: 'warn',
          })
        }
        // A normal final turn settles silently: the transcript already shows
        // the answer and tool results; a trailing stats line is noise.
        break
      case 'turn.cancelled':
        terminalTurns.add(event.turnId)
        settled.push({
          key: `event-${event.seq}`,
          text: `${symbols.failure} 已中断 · 已产出内容保留`,
          tone: 'warn',
        })
        break
      case 'turn.failed':
        terminalTurns.add(event.turnId)
        settled.push({
          key: `event-${event.seq}`,
          text: presentTurnFailure(symbols.failure, event.error, event.recoveryHint),
          tone: 'error',
        })
        break
      case 'context.compacted':
        settled.push({
          key: `event-${event.seq}`,
          text: `⇲ 上下文已压缩 · ${event.droppedRanges.map(([from, to]) => `#${from}-${to}`).join(', ')}`,
          tone: 'dim',
        })
        break
      case 'plugin.activated':
      case 'plugin.deactivated':
        settled.push({
          key: `event-${event.seq}`,
          text: `[${event.type}] ${event.pluginId}`,
          tone: 'dim',
        })
        break
      case 'user.answered':
        settled.push({
          key: `event-${event.seq}`,
          text: `回答: ${preview(event.answer)}`,
          tone: 'dim',
        })
        break
      case 'step.started':
        stepTurns.set(event.stepId, event.turnId)
        break
      case 'session.started':
      case 'turn.queued':
      case 'log.rewind':
        break
    }
  }

  const activeTools = [...calls.values()]
    .filter(
      (call) => !results.has(call.callId) && !terminalTurns.has(callTurns.get(call.callId) ?? ''),
    )
    .map((call) => {
      const presentation = presentTool(call.tool, call.args)
      return {
        callId: call.callId,
        tool: call.tool,
        title: presentation.title,
        ...(presentation.detail === undefined ? {} : { detail: presentation.detail }),
        isTask: call.tool === 'task',
        status: waitingApproval.has(call.callId)
          ? ('approval' as const)
          : intents.has(call.callId)
            ? ('running' as const)
            : ('pending' as const),
      }
    })
  return { settled, activeTools }
}

/** Longest thinking transcript we are willing to settle into the log. */
const THINKING_MAX_LINES = 40

/**
 * Soft-wraps a thinking trace into dim bar-prefixed lines: provider newlines
 * are kept as hard breaks, long segments wrap at the terminal width. The
 * settled transcript keeps structure instead of a single truncated line.
 */
export function wrapThinking(value: string, width: number, bar: string): string {
  const lines: string[] = []
  for (const hardLine of value.split('\n')) {
    const segment = hardLine.trim()
    if (segment === '') continue
    for (const piece of wrapSegment(segment, width - bar.length - 1)) {
      lines.push(`${bar} ${piece}`)
      if (lines.length >= THINKING_MAX_LINES) break
    }
    if (lines.length >= THINKING_MAX_LINES) break
  }
  if (lines.length >= THINKING_MAX_LINES) lines.push(`${bar} …`)
  return lines.join('\n')
}

/** Character-wise soft wrap (CJK-safe: no word assumptions in terminal space). */
function wrapSegment(text: string, width: number): string[] {
  const columns = Math.max(8, width)
  const characters = Array.from(text)
  if (characters.length <= columns) return [characters.join('')]
  const pieces: string[] = []
  for (let offset = 0; offset < characters.length; offset += columns) {
    pieces.push(characters.slice(offset, offset + columns).join(''))
  }
  return pieces
}

function presentTurnFailure(
  failureSymbol: string,
  error: { readonly code: string; readonly message: string; readonly detail?: unknown },
  recoveryHint: string | undefined,
): string {
  const summary = `${failureSymbol} ${singleLine(error.code, 96)}: ${singleLine(error.message, 320)}`
  const detail = asRecord(error.detail)
  const cause = asRecord(detail?.cause)
  const causeCode = stringField(cause?.code)
  const causeMessage = stringField(cause?.message)
  const causeDetail = asRecord(cause?.detail)
  const requestId = stringField(causeDetail?.requestId)
  const rootCause =
    causeCode || causeMessage
      ? ` · 根因 ${singleLine(causeCode ?? 'stream_error', 96)}: ${singleLine(causeMessage ?? 'unknown error', 240)}`
      : ''
  const request = requestId ? ` · request-id ${singleLine(requestId, 128)}` : ''
  const hint =
    error.code === 'llm.partial_stream_failed'
      ? ' · 可直接重试；若重复出现，请检查模型网关与网络'
      : recoveryHint
        ? ` · ${singleLine(recoveryHint, 240)}`
        : ''
  return `${summary}${rootCause}${request}${hint}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function preview(value: unknown): string {
  if (value === undefined) return ''
  try {
    return singleLine(stableStringify(value), 72)
  } catch {
    return '[unserializable]'
  }
}

function isKnownEvent(event: AgentEvent | UnknownEvent): event is AgentEvent {
  return new Set([
    'session.started',
    'turn.started',
    'turn.queued',
    'turn.completed',
    'turn.cancelled',
    'turn.failed',
    'step.started',
    'assistant.completed',
    'tool.call',
    'tool.intent',
    'tool.result',
    'permission.requested',
    'permission.decided',
    'permission.evaluated',
    'context.compacted',
    'log.rewind',
    'plugin.activated',
    'plugin.deactivated',
    'user.answered',
  ]).has(event.type)
}
