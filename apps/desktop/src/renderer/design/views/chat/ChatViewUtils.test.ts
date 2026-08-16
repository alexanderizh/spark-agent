import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { UsageSnapshot } from './ChatUsageTypes'
import {
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
})
