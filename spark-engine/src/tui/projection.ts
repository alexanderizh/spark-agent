import type { AgentEvent } from '../events/schema.js'
import { stableStringify } from '../kernel/stable-json.js'
import type { TerminalCapabilities } from './theme.js'
import { glyphs } from './theme.js'

export type RowTone = 'normal' | 'dim' | 'accent' | 'ok' | 'warn' | 'error'

export interface TranscriptRow {
  readonly key: string
  readonly text: string
  readonly tone: RowTone
}

export interface ActiveToolProjection {
  readonly callId: string
  readonly tool: string
  readonly args: unknown
  readonly status: 'pending' | 'running'
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
        settled.push({
          key: `event-${event.seq}`,
          text: `${symbols.bullet} ${event.input.text}`,
          tone: 'normal',
        })
        break
      case 'assistant.completed':
        if (event.message.thinking) {
          settled.push({
            key: `thinking-${event.seq}`,
            text: `▍ 思考 · ${singleLine(event.message.thinking, capabilities.width - 12)}`,
            tone: 'dim',
          })
        }
        if (event.message.text) {
          settled.push({ key: `event-${event.seq}`, text: event.message.text, tone: 'normal' })
        }
        break
      case 'tool.call':
        calls.set(event.callId, event)
        break
      case 'tool.intent':
        intents.add(event.callId)
        break
      case 'tool.result': {
        results.add(event.callId)
        const call = calls.get(event.callId)
        const mark = event.ok ? symbols.success : symbols.failure
        settled.push({
          key: `tool-${event.callId}`,
          text: `${symbols.tool} ${call?.tool ?? 'unknown'}${call ? `(${preview(call.args)})` : ''} ${mark} ${event.durationMs}ms`,
          tone: event.ok ? 'dim' : 'error',
        })
        break
      }
      case 'permission.requested':
        permissions.set(event.requestId, event)
        break
      case 'permission.decided': {
        const request = permissions.get(event.requestId)
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
        settled.push({
          key: `event-${event.seq}`,
          text: `· 完成 · ${event.stats.steps} steps · ${event.stats.usage.inputTokens + event.stats.usage.outputTokens} tok · $${event.stats.costUsd.toFixed(3)}`,
          tone: 'dim',
        })
        break
      case 'turn.cancelled':
        settled.push({
          key: `event-${event.seq}`,
          text: `${symbols.failure} 已中断 · 已完成 ${event.partial.length} step · 已产出内容保留`,
          tone: 'warn',
        })
        break
      case 'turn.failed':
        settled.push({
          key: `event-${event.seq}`,
          text: `${symbols.failure} ${event.error.code}: ${event.error.message}${event.recoveryHint ? ` · ${event.recoveryHint}` : ''}`,
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
      case 'session.started':
      case 'turn.queued':
      case 'step.started':
      case 'log.rewind':
        break
    }
  }

  const activeTools = [...calls.values()]
    .filter((call) => !results.has(call.callId))
    .map((call) => ({
      callId: call.callId,
      tool: call.tool,
      args: call.args,
      status: intents.has(call.callId) ? ('running' as const) : ('pending' as const),
    }))
  return { settled, activeTools }
}

export function singleLine(value: string, maximum: number): string {
  const line = value.replaceAll(/\s+/g, ' ').trim()
  return line.length <= maximum ? line : `${line.slice(0, Math.max(0, maximum - 1))}…`
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
