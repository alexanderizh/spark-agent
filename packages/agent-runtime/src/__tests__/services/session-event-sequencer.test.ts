import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  SessionEventSequencer,
  persistAndPublishAgentEvent,
  persistAndPublishAgentEvents,
} from '../../services/session-event-sequencer.js'

function makeEvent(id: string, seq: number): AgentEvent {
  return {
    id,
    type: 'agent_status',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-07-11T00:00:00.000Z',
    seq,
    status: 'thinking',
  }
}

describe('SessionEventSequencer', () => {
  it('seeds once from persisted max seq and reserves contiguous ranges', () => {
    const nextSeqBySession = vi.fn(() => 12)
    const sequencer = new SessionEventSequencer()

    expect(sequencer.reserve('session-1', { nextSeqBySession }, 3)).toBe(12)
    expect(sequencer.reserve('session-1', { nextSeqBySession }, 2)).toBe(15)
    expect(nextSeqBySession).toHaveBeenCalledTimes(1)

    sequencer.clear('session-1')
    expect(sequencer.reserve('session-1', { nextSeqBySession }, 1)).toBe(12)
    expect(nextSeqBySession).toHaveBeenCalledTimes(2)
  })

  it('publishes an event only after persistence succeeds', () => {
    const order: string[] = []
    const event = makeEvent('event-1', 7)
    const repo = {
      insert: vi.fn(() => order.push('persist')),
    }

    persistAndPublishAgentEvent(repo, event, () => order.push('publish'))

    expect(order).toEqual(['persist', 'publish'])
  })

  it('does not publish an event when persistence fails', () => {
    const event = makeEvent('event-1', 7)
    const publish = vi.fn()
    const repo = {
      insert: vi.fn(() => {
        throw new Error('disk full')
      }),
    }

    expect(() => persistAndPublishAgentEvent(repo, event, publish)).toThrow('disk full')
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes transient assistant deltas without persisting them', () => {
    const event: AgentEvent = {
      id: 'delta-1',
      type: 'assistant_message',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-07-11T00:00:00.000Z',
      seq: 8,
      mode: 'delta',
      content: 'partial',
      provider: 'test-provider',
      isFinal: false,
    }
    const repo = { insert: vi.fn() }
    const publish = vi.fn()

    persistAndPublishAgentEvent(repo, event, publish)

    expect(repo.insert).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(event)
  })

  it('publishes a command batch only after the transaction succeeds', () => {
    const order: string[] = []
    const events = [makeEvent('event-1', 7), makeEvent('event-2', 8)]
    const repo = {
      insertBatch: vi.fn(() => order.push('persist-batch')),
    }

    persistAndPublishAgentEvents(repo, events, () => order.push('publish'))

    expect(order).toEqual(['persist-batch', 'publish', 'publish'])
  })

  it('filters transient deltas from batch persistence but publishes every event', () => {
    const persistent = makeEvent('event-1', 7)
    const transient: AgentEvent = {
      id: 'delta-1',
      type: 'agent_thinking',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-07-11T00:00:00.000Z',
      seq: 8,
      mode: 'delta',
      content: 'working',
    }
    const repo = { insertBatch: vi.fn() }
    const publish = vi.fn()

    persistAndPublishAgentEvents(repo, [transient, persistent], publish)

    expect(repo.insertBatch).toHaveBeenCalledOnce()
    expect(repo.insertBatch.mock.calls[0]?.[0]).toHaveLength(1)
    expect(publish.mock.calls.map(([event]) => event.id)).toEqual(['delta-1', 'event-1'])
  })

  it.each(['team_member_message', 'subagent_message'] as const)(
    'does not persist %s deltas',
    (type) => {
      const event = {
        id: `${type}-delta`,
        type,
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-07-11T00:00:00.000Z',
        seq: 9,
        mode: 'delta',
        content: 'partial',
        toolCallId: 'tool-1',
      } as AgentEvent
      const repo = { insert: vi.fn() }
      const publish = vi.fn()

      persistAndPublishAgentEvent(repo, event, publish)

      expect(repo.insert).not.toHaveBeenCalled()
      expect(publish).toHaveBeenCalledWith(event)
    },
  )
})
