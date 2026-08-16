import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
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
})
