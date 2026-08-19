import { describe, expect, it } from 'vitest'
import type { AgentEvent, TurnPromptSnapshotEvent, TurnRuntimeMetrics } from '@spark/protocol'
import type { UsageSnapshot } from './ChatUsageTypes'
import {
  buildSessionPerf,
  buildTurnUsageRows,
  buildUsageDataFromEvents,
  computeCacheHitRate,
  createEmptySessionUsageData,
  eventsAfterLastHistoryReset,
} from './ChatViewUtils'

function event(type: AgentEvent['type'], seq: number): AgentEvent {
  return {
    id: `${type}-${seq}`,
    type,
    sessionId: 'session-1',
    turnId: `turn-${seq}`,
    timestamp: new Date(seq * 1000).toISOString(),
    seq,
    ...(type === 'session_history_reset' ? { reason: 'command:/clear' } : {}),
  } as AgentEvent
}

describe('ChatViewUtils', () => {
  it('derives session metadata only from the latest history window', () => {
    const reset = event('session_history_reset', 3)
    const events = [
      event('context_ledger', 1),
      event('usage_update', 2),
      reset,
      event('user_message', 4),
      event('agent_status', 5),
    ]

    expect(eventsAfterLastHistoryReset(events)).toEqual(events.slice(3))
  })

  it('returns an empty window when reset is the last event', () => {
    expect(eventsAfterLastHistoryReset([event('session_history_reset', 1)])).toEqual([])
  })

  it('keeps the original event array when no reset marker exists', () => {
    const events = [event('usage_update', 1)]

    expect(eventsAfterLastHistoryReset(events)).toBe(events)
  })

  it('creates independent empty usage snapshots', () => {
    const first = createEmptySessionUsageData()
    const second = createEmptySessionUsageData()

    first.turns.push({
      turnId: 'turn-1',
      inputTokens: 1,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheHitTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      timestamp: new Date(0).toISOString(),
    })

    expect(second.turns).toEqual([])
    expect(first.cacheHitRate).toBeNull()
  })

  describe('computeCacheHitRate', () => {
    it('adds back cache tokens to the denominator for claude (Anthropic uncached-remainder semantics)', () => {
      // Anthropic: input_tokens 是未命中余量，总量 = 1k + 9k + 0.5k = 10.5k
      expect(
        computeCacheHitRate({
          provider: 'claude',
          inputTokens: 1_000,
          cacheHitTokens: 9_000,
          cacheWriteTokens: 500,
        }),
      ).toBeCloseTo(9_000 / 10_500)
    })

    it('uses prompt_tokens directly for codex (OpenAI cached-is-subset semantics)', () => {
      // OpenAI: prompt_tokens 已含 cached，总量 = 10k，cached 8k
      expect(
        computeCacheHitRate({
          provider: 'codex',
          inputTokens: 10_000,
          cacheHitTokens: 8_000,
          cacheWriteTokens: 0,
        }),
      ).toBeCloseTo(0.8)
    })

    it('returns null when no cache metrics are reported (unmeasured, not zero)', () => {
      expect(computeCacheHitRate({ provider: 'claude', inputTokens: 1_000 })).toBeNull()
      expect(computeCacheHitRate({ provider: 'codex', inputTokens: 1_000 })).toBeNull()
    })

    it('reports a measured zero hit as 0, not null (codex cached_tokens: 0)', () => {
      expect(
        computeCacheHitRate({ provider: 'codex', inputTokens: 1_000, cacheHitTokens: 0 }),
      ).toBe(0)
      // 显式上报 write=0（字段存在）同样是「已度量」，返回 0 而非隐藏。
      expect(
        computeCacheHitRate({ provider: 'claude', inputTokens: 1_000, cacheWriteTokens: 0 }),
      ).toBe(0)
    })

    it('reports zero on the first turn of a session (cache written, nothing read yet)', () => {
      expect(
        computeCacheHitRate({
          provider: 'claude',
          inputTokens: 1_000,
          cacheHitTokens: 0,
          cacheWriteTokens: 4_000,
        }),
      ).toBe(0)
    })

    it('returns null when the denominator is not positive', () => {
      expect(
        computeCacheHitRate({
          provider: 'codex',
          inputTokens: 0,
          cacheHitTokens: 0,
          cacheWriteTokens: 100,
        }),
      ).toBeNull()
    })
  })

  describe('buildUsageDataFromEvents', () => {
    const usageEvent = (overrides: {
      seq: number
      provider: string
      inputTokens: number
      cacheHitTokens?: number
      cacheWriteTokens?: number
    }): AgentEvent =>
      ({
        id: `usage-${overrides.seq}`,
        type: 'usage_update',
        sessionId: 'session-1',
        turnId: `turn-${overrides.seq}`,
        timestamp: new Date(overrides.seq * 1000).toISOString(),
        seq: overrides.seq,
        provider: overrides.provider,
        inputTokens: overrides.inputTokens,
        outputTokens: 10,
        ...('cacheHitTokens' in overrides ? { cacheHitTokens: overrides.cacheHitTokens } : {}),
        ...('cacheWriteTokens' in overrides
          ? { cacheWriteTokens: overrides.cacheWriteTokens }
          : {}),
      }) as AgentEvent

    it('does not fabricate a hit rate by mixing a stale cache numerator with a new denominator', () => {
      // 回归：turn 1 走 claude 上报缓存命中，turn 2 切到 codex 且未上报缓存字段——
      // 旧实现把 turn 1 的 cacheHit 粘滞值配上 turn 2 的 inputTokens，捏造出 100%。
      const data = buildUsageDataFromEvents([
        usageEvent({
          seq: 1,
          provider: 'claude',
          inputTokens: 1_500,
          cacheHitTokens: 9_000,
          cacheWriteTokens: 500,
        }),
        usageEvent({ seq: 2, provider: 'codex', inputTokens: 1_000 }),
      ])
      // 命中率应保持最近一次已度量轮次（claude 口径 9000/11000），而不是 100%。
      expect(data.cacheHitRate).toBeCloseTo(9_000 / 11_000)
    })

    it('shows a measured zero hit (codex cached_tokens: 0) as 0 instead of hiding the row', () => {
      const data = buildUsageDataFromEvents([
        usageEvent({ seq: 1, provider: 'codex', inputTokens: 2_000, cacheHitTokens: 0 }),
      ])
      expect(data.cacheHitRate).toBe(0)
    })

    it('returns null rate when no event reported cache metrics', () => {
      const data = buildUsageDataFromEvents([
        usageEvent({ seq: 1, provider: 'codex', inputTokens: 2_000 }),
      ])
      expect(data.cacheHitRate).toBeNull()
    })
  })

  describe('buildTurnUsageRows', () => {
    const snap = (turnId: string, over: Partial<UsageSnapshot>): UsageSnapshot => ({
      turnId,
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheHitTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      timestamp: '2026-08-17T00:00:00.000Z',
      ...over,
    })

    it('merges same-turn snapshots into one row taking the last non-zero terminal value', () => {
      // 回归：同一轮先报 message_start 空快照、再报终值——旧行为渲染成两行（一行 0）。
      const { totalTurns, rows } = buildTurnUsageRows([
        snap('t1', { inputTokens: 0, outputTokens: 0 }),
        snap('t1', { inputTokens: 1_200, outputTokens: 340, estimatedCostUsd: 0.02 }),
        // 轮末再来一条零值快照，不应把已见终值回退成 0
        snap('t1', { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0.01 }),
      ])
      expect(totalTurns).toBe(1)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.turnNumber).toBe(1)
      expect(rows[0]?.snapshot.inputTokens).toBe(1_200)
      expect(rows[0]?.snapshot.outputTokens).toBe(340)
      // estimatedCostUsd 轮内累加，与顶部累计口径一致
      expect(rows[0]?.snapshot.estimatedCostUsd).toBeCloseTo(0.03)
    })

    it('drops turns whose every snapshot is zero and keeps real turn numbers', () => {
      const { totalTurns, rows } = buildTurnUsageRows([
        snap('t1', { inputTokens: 900, outputTokens: 100 }),
        snap('t2', {}),
        snap('t2', { inputTokens: 0, outputTokens: 0 }),
        snap('t3', { inputTokens: 500, outputTokens: 50 }),
      ])
      // t2 全程 0 用量：不占行，但计入 totalTurns
      expect(totalTurns).toBe(3)
      expect(rows.map((r) => r.turnNumber)).toEqual([1, 3])
    })

    it('keeps only the most recent 20 turns with usage, in ascending order', () => {
      const snaps: UsageSnapshot[] = []
      for (let i = 1; i <= 30; i += 1) {
        snaps.push(snap(`t${i}`, { inputTokens: i * 100 }))
      }
      const { totalTurns, rows } = buildTurnUsageRows(snaps)
      expect(totalTurns).toBe(30)
      expect(rows).toHaveLength(20)
      expect(rows[0]?.turnNumber).toBe(11)
      expect(rows[19]?.turnNumber).toBe(30)
    })
  })

  describe('buildSessionPerf', () => {
    const perfSnapshot = (
      turnId: string,
      runtimeMetrics: TurnRuntimeMetrics | undefined,
    ): TurnPromptSnapshotEvent =>
      ({
        id: `snap-${turnId}`,
        type: 'turn_prompt_snapshot',
        sessionId: 'session-1',
        turnId,
        timestamp: new Date(0).toISOString(),
        seq: 0,
        userMessage: '',
        systemPromptSections: [],
        model: 'test-model',
        adapterKind: 'claude-sdk',
        permissionMode: 'default',
        toolCount: 0,
        runtimeMetrics,
      }) as TurnPromptSnapshotEvent

    // exactOptionalPropertyTypes 下不能传显式 undefined 覆盖可选字段，
    // 需要模拟「字段缺测」时用 omit 显式删键。
    const completedMetrics = (
      overrides: Partial<TurnRuntimeMetrics> = {},
      omit: Array<'outputTokensPerSecond' | 'turnTerminalStatus' | 'turnDurationMs'> = [],
    ): TurnRuntimeMetrics => {
      const metrics: TurnRuntimeMetrics = {
        requestToFirstOutputMs: overrides.requestToFirstOutputMs ?? 500,
        streamActiveMs: overrides.streamActiveMs ?? 4000,
        turnDurationMs: overrides.turnDurationMs ?? 10000,
        outputTokens: overrides.outputTokens ?? 200,
        outputTokensPerSecond: overrides.outputTokensPerSecond ?? 50,
        turnTerminalStatus: overrides.turnTerminalStatus ?? 'completed',
      }
      for (const key of omit) delete metrics[key]
      return metrics
    }

    it('computes median throughput / TTFT / generation share from completed turns only', () => {
      const perf = buildSessionPerf(
        [
          perfSnapshot('t1', completedMetrics({ outputTokensPerSecond: 40 })),
          perfSnapshot(
            't2',
            completedMetrics(
              { requestToFirstOutputMs: 1500, streamActiveMs: 2000, turnDurationMs: 8000 },
              ['outputTokensPerSecond'],
            ),
          ),
          perfSnapshot('t3', completedMetrics({ outputTokensPerSecond: 60 })),
          // 中断轮：展示但不参与任何统计
          perfSnapshot('t4', completedMetrics({ turnTerminalStatus: 'cancelled' })),
          // 无指标的轮：完全不占行
          perfSnapshot('t5', undefined),
        ],
        false,
      )

      expect(perf.totalTurns).toBe(4)
      expect(perf.completedCount).toBe(3)
      // 吞吐样本 [40, 50(null t2 无吞吐), 60] → 中位 50；t2 无 outputTokensPerSecond
      expect(perf.medianTokensPerSecond).toBe(50)
      // TTFT 样本 [500, 1500, 500] → 中位 500
      expect(perf.medianTtftMs).toBe(500)
      // 生成占比 = (4000+2000+4000) / (10000+8000+10000)
      expect(perf.generationShare).toBeCloseTo(10_000 / 28_000)
      expect(perf.slowTokensPerSecond).toBeCloseTo(25)
      // 中断轮保留在行内，状态可区分
      expect(perf.rows.map((row) => row.status)).toEqual([
        'completed',
        'completed',
        'completed',
        'cancelled',
      ])
      // 无指标轮不占行，轮次序号仍按真实轮次计（t4 = 第 4 轮）
      expect(perf.rows.at(-1)?.turnNumber).toBe(4)
      expect(perf.liveRow).toBeNull()
    })

    it('treats the last metrics-less-terminal turn as running only while the session runs', () => {
      const snapshots = [
        perfSnapshot('t1', completedMetrics()),
        perfSnapshot(
          't2',
          completedMetrics({ streamActiveMs: 3000 }, ['turnTerminalStatus', 'turnDurationMs']),
        ),
      ]

      const running = buildSessionPerf(snapshots, true)
      expect(running.rows.at(-1)?.status).toBe('running')
      expect(running.liveRow?.turnId).toBe('t2')
      expect(running.completedCount).toBe(1)

      // 会话不在运行（如旧数据里应用中断留下的无终态轮）→ unknown，不算 live
      const idle = buildSessionPerf(snapshots, false)
      expect(idle.rows.at(-1)?.status).toBe('unknown')
      expect(idle.liveRow).toBeNull()
    })

    it('keeps old-version turns (TTFT only, no terminal marker) excluded from stats but visible', () => {
      const perf = buildSessionPerf(
        [
          perfSnapshot('t1', { requestToFirstOutputMs: 800 }),
          perfSnapshot('t2', { requestToFirstOutputMs: 1200 }),
        ],
        false,
      )

      expect(perf.totalTurns).toBe(2)
      expect(perf.completedCount).toBe(0)
      expect(perf.medianTokensPerSecond).toBeNull()
      expect(perf.medianTtftMs).toBeNull()
      expect(perf.generationShare).toBeNull()
      // TTFT 仍可展示（行数据保留），只是不进统计
      expect(perf.rows.every((row) => row.ttftMs != null)).toBe(true)
      expect(perf.rows.every((row) => row.status === 'unknown')).toBe(true)
    })
  })
})
