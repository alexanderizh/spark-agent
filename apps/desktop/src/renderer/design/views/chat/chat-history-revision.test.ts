import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { deriveChatHistoryState, retractAgentEvents } from './chat-history-revision'

function event<T extends AgentEvent>(value: T): T {
  return value
}

describe('chat history revision', () => {
  it('rebuilds messages and derived usage without retracted turn events', () => {
    const base = { sessionId: 'session-1', timestamp: '2026-09-11T00:00:00.000Z' }
    const events: AgentEvent[] = [
      event({ ...base, id: 'u1', turnId: 'turn-1', seq: 1, type: 'user_message', content: 'keep' }),
      event({
        ...base,
        id: 'usage-1',
        turnId: 'turn-1',
        seq: 2,
        type: 'usage_update',
        provider: 'provider-1',
        model: 'model-1',
        inputTokens: 10,
        outputTokens: 5,
      }),
      event({
        ...base,
        id: 'u2',
        turnId: 'turn-2',
        seq: 3,
        type: 'user_message',
        content: 'remove',
      }),
      event({
        ...base,
        id: 'usage-2',
        turnId: 'turn-2',
        seq: 4,
        type: 'usage_update',
        provider: 'provider-1',
        model: 'model-1',
        inputTokens: 99,
        outputTokens: 88,
      }),
    ]

    const revised = retractAgentEvents(events, ['u2', 'usage-2'])
    expect(revised.events.map((item) => item.id)).toEqual(['u1', 'usage-1'])
    expect(revised.messages.map((message) => message.id)).toEqual(['u1'])
    expect(deriveChatHistoryState(revised.events).usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    })
  })
})
