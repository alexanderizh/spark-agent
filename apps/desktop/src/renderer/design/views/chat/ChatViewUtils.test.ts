import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { createEmptySessionUsageData, eventsAfterLastHistoryReset } from './ChatViewUtils'

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
  })
})
