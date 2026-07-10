import type { AgentEvent } from '@spark/protocol'

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

export function countDiffLines(diff: string | undefined): { adds: number; dels: number } {
  if (diff == null || diff.trim().length === 0) return { adds: 0, dels: 0 }
  let adds = 0
  let dels = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) adds += 1
    if (line.startsWith('-')) dels += 1
  }
  return { adds, dels }
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return `${value}`
}
