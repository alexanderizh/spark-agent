import type { AgentEvent } from '@spark/protocol'
import type { SessionUsageData } from './ChatUsageTypes'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getLatestInputTokens(events: AgentEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'usage_update' && event.inputTokens > 0) return event.inputTokens
  }
  return 0
}

export function createEmptySessionUsageData(): SessionUsageData {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cacheHitTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  }
}

/**
 * 历史回放派生「最新状态」的窗口：截取最后一个 session_history_reset 标记之后的事件。
 *
 * /clear 等清空命令先删旧事件再写入 reset 标记，MessageBuilder 回放遇到标记会丢弃
 * 此前累积的消息。回放侧的 context_ledger / context_usage / project_context / usage
 * 派生必须与消息使用同一窗口——否则清空后未发新轮次的会话，重进时会把标记之前的
 * 旧账本当作最新状态展示，出现「消息已空但上下文用量仍挂着旧对话历史」的错位。
 * 无标记时原样返回（绝大多数会话路径零开销）。
 */
export function eventsAfterLastHistoryReset(events: AgentEvent[]): AgentEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'session_history_reset') return events.slice(index + 1)
  }
  return events
}

export function getBasename(value: string): string {
  // Compatible with POSIX and Windows-style paths.
  const trimmed = value.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return '新项目'
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? '新项目'
}

export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime()
  const now = Date.now()
  if (!Number.isFinite(then)) return ''
  const diffMs = Math.max(0, now - then)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day

  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时`
  if (diffMs < week) return `${Math.floor(diffMs / day)} 天`
  return `${Math.floor(diffMs / week)} 周`
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return `${value}`
}
