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

  it('publishes a command batch only after the transaction succeeds', () => {
    const order: string[] = []
    const events = [makeEvent('event-1', 7), makeEvent('event-2', 8)]
    const repo = {
      insertBatch: vi.fn(() => order.push('persist-batch')),
    }

    persistAndPublishAgentEvents(repo, events, () => order.push('publish'))

    expect(order).toEqual(['persist-batch', 'publish', 'publish'])
  })
})
