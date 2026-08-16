import type { AgentEvent } from '@spark/protocol'
import type { SessionUsageData, UsageSnapshot } from './ChatUsageTypes'

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
    cacheHitRate: null,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  }
}

/**
 * 缓存命中率 = cache_read / 输入总量。provider 计量口径不同：
 *   - claude（Anthropic）：inputTokens 是未命中余量，总量 = input + cacheHit + cacheWrite
 *   - codex（OpenAI/Codex）：inputTokens 已包含 cached，总量 = input
 * 缓存字段缺省（undefined，该轮未度量）或分母非正时返回 null（不展示）；
 * 已度量的 0 命中（字段存在且为 0）如实返回 0，区别于未度量。
 * 调用方必须传**同一事件**的完整元组——禁止用跨轮/跨 provider 的粘滞值拼凑分子分母。
 */
export function computeCacheHitRate(params: {
  provider: string | undefined
  inputTokens: number
  cacheHitTokens?: number | undefined
  cacheWriteTokens?: number | undefined
}): number | null {
  const { provider, inputTokens } = params
  const cacheHitTokens = params.cacheHitTokens
  const cacheWriteTokens = params.cacheWriteTokens
  if (cacheHitTokens == null && cacheWriteTokens == null) return null
  const hitTokens = cacheHitTokens ?? 0
  const writeTokens = cacheWriteTokens ?? 0
  const denominator = provider === 'claude' ? inputTokens + hitTokens + writeTokens : inputTokens
  if (denominator <= 0) return null
  return clamp(hitTokens / denominator, 0, 1)
}

/**
 * 从事件流重建用量数据。
 *
 * ⚠️ 口径：token 字段是**最后一条 usage_update 的值**（即最近一轮；缓存计数在
 * 最近一条未上报时沿用上一次已知值），`cacheHitRate` 取**最近一次上报了缓存字段
 * 的轮次**（未度量 ≠ 0%），`estimatedCostUsd` 是传入 events 范围内的累加。由于
 * ChatView 的历史是按轮次窗口化加载的，这里的累加**不等于会话累计** —— 会话累计
 * 必须走 `usage:get-session` 读 usage_ledger。面板上这两种口径要分开展示，不要混。
 */
export function buildUsageDataFromEvents(events: AgentEvent[]): SessionUsageData {
  let inputTokens = 0
  let outputTokens = 0
  let reasoningOutputTokens = 0
  let cacheHitTokens = 0
  let cacheWriteTokens = 0
  let estimatedCostUsd = 0
  // 命中率只从「同一事件」的完整元组计算（未度量的事件不更新），杜绝粘滞分子配
  // 新分母——provider 切换后会捏造出 >100% 的假命中率。计数字段仍为粘滞语义。
  let cacheHitRate: number | null = null
  const turns: UsageSnapshot[] = []

  for (const event of events) {
    if (event.type !== 'usage_update') continue
    inputTokens = event.inputTokens
    outputTokens = event.outputTokens
    reasoningOutputTokens = event.reasoningOutputTokens ?? 0
    if (event.cacheHitTokens != null) cacheHitTokens = event.cacheHitTokens
    if (event.cacheWriteTokens != null) cacheWriteTokens = event.cacheWriteTokens
    if (event.estimatedCostUsd != null) estimatedCostUsd += event.estimatedCostUsd
    if (event.cacheHitTokens != null || event.cacheWriteTokens != null) {
      cacheHitRate = computeCacheHitRate({
        provider: event.provider,
        inputTokens: event.inputTokens,
        cacheHitTokens: event.cacheHitTokens,
        cacheWriteTokens: event.cacheWriteTokens,
      })
    }
    turns.push({
      turnId: event.turnId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      reasoningOutputTokens: event.reasoningOutputTokens ?? 0,
      cacheHitTokens: event.cacheHitTokens ?? 0,
      cacheWriteTokens: event.cacheWriteTokens ?? 0,
      estimatedCostUsd: event.estimatedCostUsd ?? 0,
      timestamp: event.timestamp,
    })
  }

  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheHitTokens,
    cacheWriteTokens,
    cacheHitRate,
    estimatedCostUsd,
    contextWindow: 0,
    turns,
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
