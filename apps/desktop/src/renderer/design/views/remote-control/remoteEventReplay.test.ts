import { describe, expect, it } from 'vitest'
import type { AgentEvent, MobileBridgeEvent } from '@spark/protocol'
import { MessageBuilder } from '../../services/event-mapper'
import { buildRemoteTimeline } from './remoteEventMerge'

// Replays the persisted shape observed at seq 360/376/380 in a local Codex session.
// IDs, timestamps and text are replaced; the two distinct segment IDs are preserved in shape.
const turnId = 'replay-turn'
const base = {
  sessionId: 'replay-session',
  turnId,
  timestamp: '2026-11-16T03:00:00Z',
  provider: 'codex' as const,
}
const events: AgentEvent[] = [
  { ...base, id: 'user', seq: 360, type: 'user_message', content: '你好' },
  {
    ...base,
    id: 'segment',
    seq: 376,
    type: 'assistant_message',
    mode: 'complete',
    content: '你好，有什么可以帮你？',
    isFinal: false,
    segmentId: `codex-sdk-${turnId}-text-1`,
  },
  {
    ...base,
    id: 'result',
    seq: 380,
    type: 'assistant_message',
    mode: 'complete',
    content: '你好，有什么可以帮你？',
    isFinal: true,
    segmentId: `codex-sdk-${turnId}`,
  },
]

function bridgeEvents(): MobileBridgeEvent[] {
  return events.flatMap<MobileBridgeEvent>((event) => {
    const base = { id: event.id, seq: event.seq, turnId: event.turnId, timestamp: event.timestamp }
    if (event.type === 'user_message')
      return [{ ...base, type: 'user_message' as const, content: event.content }]
    if (event.type === 'assistant_message')
      return [
        {
          ...base,
          type: 'assistant_message' as const,
          content: event.content,
          mode: event.mode,
          isFinal: event.isFinal,
          segmentId: event.segmentId,
        },
      ]
    return []
  })
}

describe('Codex persisted-event replay', () => {
  it('local renderer reconciles a final result carrying a different segment ID', () => {
    const builder = new MessageBuilder()
    for (const event of events) builder.processEvent(event)
    const assistant = builder.getAllMessages().filter((message) => message.role === 'assistant')
    expect(assistant).toHaveLength(1)
    expect(
      assistant[0]?.blocks.filter((block) => block.kind === 'text').map((block) => block.content),
    ).toEqual(['你好，有什么可以帮你？'])
  })

  it('two separate greeting turns retain one answer each', () => {
    const first = bridgeEvents()
    const second = first.map((event) => ({
      ...event,
      id: `second-${event.id}`,
      turnId: 'second-turn',
      seq: event.seq + 100,
      segmentId: event.segmentId?.replace(turnId, 'second-turn'),
    }))
    const timeline = buildRemoteTimeline([...first, ...second])
    expect(timeline.map((item) => item.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(timeline.filter((item) => item.kind === 'assistant').map((item) => item.text)).toEqual([
      '你好，有什么可以帮你？',
      '你好，有什么可以帮你？',
    ])
  })

  it('remote replay must match the single local answer on every history load', () => {
    for (let load = 0; load < 2; load += 1) {
      const timeline = buildRemoteTimeline(bridgeEvents())
      expect(timeline.filter((item) => item.kind === 'user')).toHaveLength(1)
      expect(timeline.filter((item) => item.kind === 'assistant').map((item) => item.text)).toEqual(
        ['你好，有什么可以帮你？'],
      )
    }
  })
})
