import type { AgentEvent, TurnPromptSnapshotEvent } from '@spark/protocol'
import type { SessionUsageData, TurnUsageRow, UsageSnapshot } from './ChatUsageTypes'

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
 * 面板「轮次用量」图表数据：把逐事件的 usage 快照收敛成「一轮一行」。
 *
 * 同一轮（同 turnId）可能产生多条 usage_update（message_start 空快照、逐消息
 * 用量、result 终值……），轮内 token/缓存字段取「最后一个非零值」（零值快照不
 * 回退已见终值），estimatedCostUsd 轮内累加（与顶部累计口径一致），timestamp
 * 取轮内最后一条。全程零用量的轮次不占行；rows 只保留有用量的最近 maxRows 轮
 * （时间升序）。turnNumber 是按首现顺序计的真实轮次序号；totalTurns 是去重后
 * 的轮次总数（含无用量轮，供「N 轮」计数）。
 */
export function buildTurnUsageRows(
  turns: UsageSnapshot[],
  maxRows = 20,
): { totalTurns: number; rows: TurnUsageRow[] } {
  const byTurnId = new Map<string, UsageSnapshot>()
  for (const snap of turns) {
    const prev = byTurnId.get(snap.turnId)
    if (prev == null) {
      byTurnId.set(snap.turnId, { ...snap })
      continue
    }
    byTurnId.set(snap.turnId, {
      ...snap,
      inputTokens: snap.inputTokens > 0 ? snap.inputTokens : prev.inputTokens,
      outputTokens: snap.outputTokens > 0 ? snap.outputTokens : prev.outputTokens,
      reasoningOutputTokens:
        snap.reasoningOutputTokens > 0 ? snap.reasoningOutputTokens : prev.reasoningOutputTokens,
      cacheHitTokens: snap.cacheHitTokens > 0 ? snap.cacheHitTokens : prev.cacheHitTokens,
      cacheWriteTokens: snap.cacheWriteTokens > 0 ? snap.cacheWriteTokens : prev.cacheWriteTokens,
      estimatedCostUsd: prev.estimatedCostUsd + snap.estimatedCostUsd,
    })
  }
  const collapsed = Array.from(byTurnId.values(), (snapshot, index) => ({
    turnNumber: index + 1,
    snapshot,
  }))
  return {
    totalTurns: collapsed.length,
    rows: collapsed
      .filter(
        (row) =>
          row.snapshot.inputTokens +
            row.snapshot.outputTokens +
            row.snapshot.reasoningOutputTokens >
          0,
      )
      .slice(-maxRows),
  }
}

// ─── 会话性能指标（吞吐 / TTFT / 轮次时长）────────────────────────────────

/** 「性能」区块单行：一轮一行（buildSessionPerf 输出）。缺测字段为 null，不冒充 0。 */
export type TurnPerfRow = {
  /** 真实轮次序号（1-based，按 turn_prompt_snapshot 出现顺序计，与真实轮次对应） */
  turnNumber: number
  turnId: string
  /** 该轮使用的模型（tooltip 展示用） */
  model: string
  /** completed 参与统计；cancelled / error 展示但排除；unknown = 终态未记录（旧数据/应用中断） */
  status: 'completed' | 'cancelled' | 'error' | 'unknown' | 'running'
  ttftMs: number | null
  /** 纯生成时长（流窗口累加，剔除工具执行时间） */
  streamActiveMs: number | null
  turnDurationMs: number | null
  outputTokens: number | null
  /** 吞吐 = outputTokens / streamActiveMs；任一缺测为 null */
  tokensPerSecond: number | null
}

export type SessionPerfSummary = {
  /** 有运行时指标可展示的轮次总数（含运行中 / 中断轮） */
  totalTurns: number
  completedCount: number
  /** completed 且可测吞吐轮次的中位 tok/s（中位数对个别慢轮不敏感） */
  medianTokensPerSecond: number | null
  /** completed 且有 TTFT 轮次的中位 TTFT（ms） */
  medianTtftMs: number | null
  /** 生成时间占比 = ΣstreamActiveMs / ΣturnDurationMs（completed 且两者齐备的轮次） */
  generationShare: number | null
  /** 慢轮阈值 = 中位吞吐 × 0.5；低于该值的 completed 轮标记「偏慢」 */
  slowTokensPerSecond: number | null
  /** 最近 maxRows 行（时间升序，含运行中 / 中断行） */
  rows: TurnPerfRow[]
  /** 运行中轮引用（rows 末尾元素；仅会话 running 且末轮无终态标记时非 null） */
  liveRow: TurnPerfRow | null
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid]
  if (upper == null) return null
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1] ?? 0
  return (lower + upper) / 2
}

/**
 * 从 turn_prompt_snapshot（renderer 已把同 turn 的 turn_runtime_metrics 增量合并进
 * runtimeMetrics 字段）派生「性能」区块数据。数据源覆盖历史回放与 live 事件，
 * 与轮次用量图同链路；旧版本事件的缺测字段（吞吐/终态标记）保持 null / unknown，
 * 不参与统计但保留 TTFT 展示价值。
 */
export function buildSessionPerf(
  snapshots: TurnPromptSnapshotEvent[],
  isSessionRunning: boolean,
  maxRows = 20,
): SessionPerfSummary {
  const rows: TurnPerfRow[] = []
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]
    const metrics = snapshot?.runtimeMetrics
    if (snapshot == null || metrics == null) continue
    const terminal = metrics.turnTerminalStatus
    const status: TurnPerfRow['status'] =
      terminal ?? (index === snapshots.length - 1 && isSessionRunning ? 'running' : 'unknown')
    rows.push({
      turnNumber: index + 1,
      turnId: snapshot.turnId,
      model: snapshot.model,
      status,
      ttftMs: metrics.requestToFirstOutputMs ?? null,
      streamActiveMs: metrics.streamActiveMs ?? null,
      turnDurationMs: metrics.turnDurationMs ?? null,
      outputTokens: metrics.outputTokens ?? null,
      tokensPerSecond: metrics.outputTokensPerSecond ?? null,
    })
  }

  const completed = rows.filter((row) => row.status === 'completed')
  const throughputSamples = completed
    .map((row) => row.tokensPerSecond)
    .filter((value): value is number => value != null && value > 0)
  const ttftSamples = completed
    .map((row) => row.ttftMs)
    .filter((value): value is number => value != null && value > 0)

  let streamTotalMs = 0
  let durationTotalMs = 0
  for (const row of completed) {
    if (
      row.streamActiveMs != null &&
      row.turnDurationMs != null &&
      row.streamActiveMs > 0 &&
      row.turnDurationMs > 0
    ) {
      streamTotalMs += row.streamActiveMs
      durationTotalMs += row.turnDurationMs
    }
  }

  const medianTokensPerSecond = medianOf(throughputSamples)
  const lastRow = rows.at(-1)
  return {
    totalTurns: rows.length,
    completedCount: completed.length,
    medianTokensPerSecond,
    medianTtftMs: medianOf(ttftSamples),
    generationShare: durationTotalMs > 0 ? streamTotalMs / durationTotalMs : null,
    slowTokensPerSecond: medianTokensPerSecond != null ? medianTokensPerSecond * 0.5 : null,
    rows: rows.slice(-maxRows),
    liveRow: lastRow != null && lastRow.status === 'running' ? lastRow : null,
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
