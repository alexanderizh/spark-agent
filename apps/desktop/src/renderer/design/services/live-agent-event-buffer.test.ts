import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  LiveAgentEventBuffer,
  createAgentEventIdSet,
  mergeAgentEvents,
} from './live-agent-event-buffer'

function event(
  id: string,
  seq: number,
  timestamp: string = '2026-07-11T00:00:00.000Z',
): AgentEvent {
  return {
    id,
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp,
    seq,
    type: 'agent_status',
    status: 'thinking',
  }
}

describe('LiveAgentEventBuffer', () => {
  it('flushes one sorted, de-duplicated batch per animation frame', () => {
    const scheduled: FrameRequestCallback[] = []
    const onFlush = vi.fn()
    const buffer = new LiveAgentEventBuffer({
      onFlush,
      requestFrame: (callback) => {
        scheduled.push(callback)
        return 7
      },
      cancelFrame: vi.fn(),
    })

    buffer.enqueue(event('event-c', 3))
    buffer.enqueue(event('event-b', 1, '2026-07-11T00:00:01.000Z'))
    buffer.enqueue(event('event-a', 1, '2026-07-11T00:00:01.000Z'))
    buffer.enqueue(event('event-a', 1, '2026-07-11T00:00:01.000Z'))

    expect(onFlush).not.toHaveBeenCalled()
    const flushFrame = scheduled[0]
    if (flushFrame == null) throw new Error('expected an animation frame callback')
    flushFrame(0)

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush.mock.calls[0]?.[0].map((item: AgentEvent) => item.id)).toEqual([
      'event-a',
      'event-b',
      'event-c',
    ])
  })

  it('cancels and clears a pending frame', () => {
    const cancelFrame = vi.fn()
    const onFlush = vi.fn()
    const buffer = new LiveAgentEventBuffer({
      onFlush,
      requestFrame: () => 11,
      cancelFrame,
    })

    buffer.enqueue(event('event-1', 1))
    buffer.clear()

    expect(cancelFrame).toHaveBeenCalledWith(11)
    expect(buffer.drainNow()).toEqual([])
    expect(onFlush).not.toHaveBeenCalled()
  })
})

describe('agent event collections', () => {
  it('merges history and live events in deterministic order and builds the id index', () => {
    const merged = mergeAgentEvents(
      [event('event-2', 2), event('event-1', 1)],
      [event('event-2', 2), event('event-3', 3)],
    )

    expect(merged.map((item) => item.id)).toEqual(['event-1', 'event-2', 'event-3'])
    expect(createAgentEventIdSet(merged)).toEqual(new Set(['event-1', 'event-2', 'event-3']))
  })
})
