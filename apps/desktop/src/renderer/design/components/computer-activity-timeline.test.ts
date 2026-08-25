import { describe, expect, it } from 'vitest'
import type { ComputerUseEvent } from '@spark/protocol'
import {
  groupComputerActivityEvents,
  isTerminalComputerActivityEvent,
  mergeComputerActivityEvents,
  sliceComputerActivityTimelines,
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

describe('sliceComputerActivityTimelines', () => {
  const anchors = [
    { id: 'm1', timestamp: '2026-07-31T00:00:00.000Z' },
    { id: 'm2', timestamp: '2026-07-31T00:00:05.000Z' },
    { id: 'm3', timestamp: undefined },
    { id: 'm4', timestamp: '2026-07-31T00:00:10.000Z' },
  ]

  it('splits one timeline across messages by event time and marks only the last segment', () => {
    // fixture 时间戳 = 00:00:0<seq>：seq 0..1（:00/:01）→ m1 之后；seq 7（:07）→ m2 之后（m3 无 timestamp 不作锚点）
    const grouped = groupComputerActivityEvents([
      event('cs-1', 0),
      event('cs-1', 1),
      event('cs-1', 7),
    ])
    const sliced = sliceComputerActivityTimelines(grouped, anchors)
    expect([...sliced.keys()]).toEqual(['m1', 'm2'])
    expect(
      sliced
        .get('m1')
        ?.map((segment) => [segment.events.map((entry) => entry.seq), segment.isSessionLatest]),
    ).toEqual([[[0, 1], false]])
    expect(
      sliced
        .get('m2')
        ?.map((segment) => [segment.events.map((entry) => entry.seq), segment.isSessionLatest]),
    ).toEqual([[[7], true]])
  })

  it('assigns events earlier than the first anchor to the first anchor (pagination fallback)', () => {
    const grouped = groupComputerActivityEvents([event('cs-1', 0)])
    const sliced = sliceComputerActivityTimelines(grouped, [
      { id: 'late', timestamp: '2026-07-31T00:00:09.000Z' },
    ])
    expect([...sliced.keys()]).toEqual(['late'])
    expect(sliced.get('late')?.[0]?.events.map((entry) => entry.seq)).toEqual([0])
  })

  it('returns an empty map when no anchor has a timestamp', () => {
    const grouped = groupComputerActivityEvents([event('cs-1', 0)])
    expect(sliceComputerActivityTimelines(grouped, [{ id: 'm1', timestamp: undefined }]).size).toBe(
      0,
    )
  })

  it('orders segments in one slot by first event time across sessions', () => {
    // cs-1 首事件（:00）早于 cs-2 首事件（:03），都落在 m1 之后 → 槽内按首事件时间排序
    const grouped = groupComputerActivityEvents([
      event('cs-2', 3),
      event('cs-1', 0),
      event('cs-1', 1),
    ])
    const sliced = sliceComputerActivityTimelines(grouped, anchors)
    expect(sliced.get('m1')?.map((segment) => segment.computerSessionId)).toEqual(['cs-1', 'cs-2'])
  })
})
