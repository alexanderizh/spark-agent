import { describe, expect, it } from 'vitest'
import type { ComputerUseEvent } from '@spark/protocol'
import {
  groupComputerActivityEvents,
  isTerminalComputerActivityEvent,
  mergeComputerActivityEvents,
  sliceComputerActivityTimelines,
  type ComputerActivityAnchorMessage,
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

function msg(
  id: string,
  overrides: Partial<ComputerActivityAnchorMessage> = {},
): ComputerActivityAnchorMessage {
  return { id, role: 'user', status: 'completed', ...overrides }
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
  it('regression: terminal timeline lands on the turn user message, not the assistant message created before the events', () => {
    // 用户报告场景：U1(:00) → A1 创建于 :01（早于全部事件）→ 事件 :03/:05。
    // 助手消息不能按创建时间锚定，否则事件全部落到轮次最后一条消息之后（卡片沉底）。
    const grouped = groupComputerActivityEvents([
      event('cs-1', 3),
      event('cs-1', 5),
      event('cs-1', 6, 'computer_session_completed'),
    ])
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [
        msg('u1', { timestamp: '2026-07-31T00:00:00.000Z' }),
        msg('a1', {
          role: 'assistant',
          timestamp: '2026-07-31T00:00:01.000Z',
          durationMs: 7000,
        }),
      ],
      'a1',
    )
    expect([...sliced.keys()]).toEqual(['u1'])
    expect(sliced.get('u1')?.[0]?.events.map((entry) => entry.seq)).toEqual([3, 5, 6])
    expect(sliced.get('u1')?.[0]?.isSessionLatest).toBe(true)
  })

  it('streaming assistant messages are not anchors; terminal timelines fall back to the user message', () => {
    const grouped = groupComputerActivityEvents([
      event('cs-1', 3),
      event('cs-1', 4, 'computer_session_completed'),
    ])
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [
        msg('u1', { timestamp: '2026-07-31T00:00:00.000Z' }),
        msg('a1', {
          role: 'assistant',
          status: 'streaming',
          timestamp: '2026-07-31T00:00:01.000Z',
        }),
      ],
      'a1',
    )
    expect([...sliced.keys()]).toEqual(['u1'])
  })

  it('active (non-terminal) timelines attach whole to the active sink message', () => {
    const grouped = groupComputerActivityEvents([event('cs-1', 3), event('cs-1', 5)])
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [
        msg('u1', { timestamp: '2026-07-31T00:00:00.000Z' }),
        msg('a1', {
          role: 'assistant',
          status: 'streaming',
          timestamp: '2026-07-31T00:00:01.000Z',
        }),
      ],
      'a1',
    )
    expect([...sliced.keys()]).toEqual(['a1'])
    const segment = sliced.get('a1')?.[0]
    expect(segment?.events.map((entry) => entry.seq)).toEqual([3, 5])
    expect(segment?.isSessionLatest).toBe(true)
  })

  it('terminal assistant messages anchor at turn end, catching later events from hidden internal turns', () => {
    // 内部轮次（定时任务等）的用户消息被可见性投影过滤：事件应归上一轮终态助手
    // 消息（锚定时间 = timestamp + durationMs），渲染在其后而不是更早的用户消息后。
    const grouped = groupComputerActivityEvents([
      event('cs-1', 5),
      event('cs-1', 6, 'computer_session_completed'),
    ])
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [
        msg('u1', { timestamp: '2026-07-31T00:00:00.000Z' }),
        msg('a1', {
          role: 'assistant',
          timestamp: '2026-07-31T00:00:01.000Z',
          durationMs: 2000,
        }),
      ],
      'a1',
    )
    expect([...sliced.keys()]).toEqual(['a1'])
  })

  it('places multiple turns side by side in chronological order', () => {
    const grouped = [
      ...groupComputerActivityEvents([
        event('cs-1', 2),
        event('cs-1', 3, 'computer_session_completed'),
      ]),
      ...groupComputerActivityEvents([
        event('cs-2', 8),
        event('cs-2', 9, 'computer_session_completed'),
      ]),
    ]
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [
        msg('u1', { timestamp: '2026-07-31T00:00:00.000Z' }),
        msg('a1', {
          role: 'assistant',
          timestamp: '2026-07-31T00:00:01.000Z',
          durationMs: 4000,
        }),
        msg('u2', { timestamp: '2026-07-31T00:00:06.000Z' }),
        msg('a2', {
          role: 'assistant',
          timestamp: '2026-07-31T00:00:07.000Z',
          durationMs: 3000,
        }),
      ],
      'a2',
    )
    expect(sliced.get('u1')?.[0]?.events.map((entry) => entry.seq)).toEqual([2, 3])
    expect(sliced.get('u2')?.[0]?.events.map((entry) => entry.seq)).toEqual([8, 9])
  })

  it('assigns events earlier than the first anchor to the first anchor (pagination fallback)', () => {
    const grouped = groupComputerActivityEvents([event('cs-1', 0, 'computer_session_completed')])
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [msg('late', { timestamp: '2026-07-31T00:00:09.000Z' })],
      'late',
    )
    expect([...sliced.keys()]).toEqual(['late'])
    expect(sliced.get('late')?.[0]?.events.map((entry) => entry.seq)).toEqual([0])
  })

  it('drops segments when no message can anchor and no sink exists', () => {
    const grouped = groupComputerActivityEvents([event('cs-1', 0, 'computer_session_completed')])
    expect(
      sliceComputerActivityTimelines(grouped, [msg('m1', { timestamp: undefined })], undefined)
        .size,
    ).toBe(0)
  })

  it('falls back to the sink when no anchor is valid but a sink exists', () => {
    const grouped = groupComputerActivityEvents([event('cs-1', 0, 'computer_session_completed')])
    const sliced = sliceComputerActivityTimelines(grouped, [], 'last')
    expect([...sliced.keys()]).toEqual(['last'])
  })

  it('orders segments in one slot by first event time across sessions', () => {
    // cs-1 首事件（:00）早于 cs-2 首事件（:03），都落在 u1 之后 → 槽内按首事件时间排序
    const grouped = [
      ...groupComputerActivityEvents([event('cs-1', 0), event('cs-1', 1)]),
      ...groupComputerActivityEvents([event('cs-2', 3)]),
    ]
    const sliced = sliceComputerActivityTimelines(
      grouped,
      [msg('u1', { timestamp: '2026-07-31T00:00:00.000Z' })],
      'u1',
    )
    expect(sliced.get('u1')?.map((segment) => segment.computerSessionId)).toEqual(['cs-1', 'cs-2'])
  })
})
