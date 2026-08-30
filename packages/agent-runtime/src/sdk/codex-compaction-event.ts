import type { AgentEvent } from '@spark/protocol'

type EventBase = Pick<AgentEvent, 'id' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'>
type CodexCompactionEvent = Extract<AgentEvent, { type: 'context_compaction' }>

export function extractCodexCompactionEvent(
  obj: Record<string, unknown>,
  source: 'codex_cli' | 'codex_sdk',
  base: EventBase,
): CodexCompactionEvent | null {
  if (!hasCompactSignal(obj)) return null

  const rawType = readString(obj.type) ?? readString(obj.hook_event_name) ?? 'codex/compact'
  const compactResult = readString(obj.compact_result)
  const status = readString(obj.status)
  const phase: CodexCompactionEvent['phase'] =
    /boundary/i.test(rawType)
      ? 'boundary'
      : compactResult === 'failed' || status === 'failed'
        ? 'failed'
        : status === 'compacting' || /start|started|begin/i.test(rawType)
          ? 'started'
          : 'completed'

  const summary =
    readString(obj.compact_summary) ??
    readString(obj.compaction_summary) ??
    readString(obj.summary)
  const message =
    readString(obj.compact_error) ??
    readNestedString(obj.error, ['message', 'error']) ??
    readString(obj.message)
  const preTokens =
    readNumber(obj.pre_compaction_tokens) ??
    readNumber(obj.pre_tokens) ??
    readNumber(obj.preTokens)
  const postTokens =
    readNumber(obj.post_compaction_tokens) ??
    readNumber(obj.post_tokens) ??
    readNumber(obj.postTokens)
  const durationMs = readNumber(obj.duration_ms) ?? readNumber(obj.durationMs)
  const trigger = readString(obj.trigger)

  return {
    ...base,
    type: 'context_compaction',
    provider: 'codex',
    source,
    phase,
    ...(trigger != null ? { trigger } : {}),
    ...(preTokens != null ? { preTokens } : {}),
    ...(postTokens != null ? { postTokens } : {}),
    ...(durationMs != null ? { durationMs } : {}),
    ...(summary != null ? { summary } : {}),
    ...(message != null ? { message } : {}),
    rawType,
  }
}

function hasCompactSignal(obj: Record<string, unknown>): boolean {
  const type = readString(obj.type) ?? readString(obj.hook_event_name) ?? ''
  if (/compact|compaction/i.test(type)) return true
  return Object.keys(obj).some((key) => /compact|compaction/i.test(key))
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNestedString(value: unknown, keys: string[]): string | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const found = readString(record[key])
    if (found != null) return found
  }
  return null
}
