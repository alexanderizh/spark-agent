import { describe, expect, it } from 'vitest'
import type { ComputerUseEvent } from '@spark/protocol'
import {
  groupComputerActivityEvents,
  isTerminalComputerActivityEvent,
  mergeComputerActivityEvents,
} from './computer-activity-timeline'

function event(
  computerSessionId: string,
  seq: number,
  type: ComputerUseEvent['type'] = 'computer_observation_created',
): ComputerUseEvent {
  const base = {
    id: `${computerSessionId}-${seq}`,
    sessionId: 'session-1',
    turnId: 'turn-1',
    computerSessionId,
    timestamp: `2026-07-31T00:00:0${seq}.000Z`,
    seq,
  }
  if (type === 'computer_session_completed') {
    return { ...base, type, verificationIds: ['verification-1'] }
  }
  return {
    ...base,
    type: 'computer_observation_created',
    frameId: `frame-${seq}`,
    treeVersion: `tree-${seq}`,
  }
}

describe('computer activity timeline', () => {
  it('deduplicates replay and live events and restores sequence order', () => {
    expect(
      mergeComputerActivityEvents([event('cs-1', 1)], [event('cs-1', 0), event('cs-1', 1)]).map(
        (item) => item.seq,
      ),
    ).toEqual([0, 1])
  })

  it('groups multiple computer sessions without merging their sequences', () => {
    const grouped = groupComputerActivityEvents([
      event('cs-2', 0),
      event('cs-1', 1),
      event('cs-1', 0),
    ])
    expect(
      grouped.map((item) => [item.computerSessionId, item.events.map((entry) => entry.seq)]),
    ).toEqual([
      ['cs-1', [0, 1]],
      ['cs-2', [0]],
    ])
  })

  it('recognizes terminal session events', () => {
    expect(isTerminalComputerActivityEvent(event('cs-1', 1, 'computer_session_completed'))).toBe(
      true,
    )
    expect(isTerminalComputerActivityEvent(event('cs-1', 0))).toBe(false)
  })
})
