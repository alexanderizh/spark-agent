import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { getLastEditableUserMessageId } from './last-user-message-edit'

function message(patch: Partial<UIMessage> = {}): UIMessage {
  return {
    id: 'message-1',
    turnId: 'turn-1',
    role: 'user',
    status: 'completed',
    blocks: [{ kind: 'text', content: 'hello', isStreaming: false }],
    usage: null,
    eventIds: ['event-1'],
    ...patch,
  }
}

describe('getLastEditableUserMessageId', () => {
  it('returns only the latest persisted ordinary user message after the turn settles', () => {
    const first = message()
    const second = message({ id: 'message-2', turnId: 'turn-2', eventIds: ['event-2'] })
    const assistant = message({
      id: 'assistant-2',
      role: 'assistant',
      turnId: 'turn-2',
      eventIds: ['event-3'],
    })
    expect(getLastEditableUserMessageId([first, second, assistant], false)).toBe('message-2')
  })

  it('rejects running, optimistic, hidden, and platform-originated messages', () => {
    expect(getLastEditableUserMessageId([message()], true)).toBeNull()
    expect(
      getLastEditableUserMessageId([message({ eventIds: [], deliveryState: 'accepted' })], false),
    ).toBeNull()
    expect(
      getLastEditableUserMessageId([message({ userMessageVisibility: 'hidden' })], false),
    ).toBeNull()
    expect(
      getLastEditableUserMessageId([message({ turnSource: 'scheduled_task' })], false),
    ).toBeNull()
    expect(getLastEditableUserMessageId([message({ status: 'streaming' })], false)).toBeNull()
  })

  it('allows the last user turn after cancellation or failure', () => {
    const user = message()
    expect(
      getLastEditableUserMessageId(
        [user, message({ id: 'cancelled', role: 'assistant', status: 'cancelled' })],
        false,
      ),
    ).toBe('message-1')
    expect(
      getLastEditableUserMessageId(
        [user, message({ id: 'errored', role: 'assistant', status: 'error' })],
        false,
      ),
    ).toBe('message-1')
  })

  it('allows a latest optimistic message cancelled before its user event was persisted', () => {
    expect(
      getLastEditableUserMessageId(
        [
          message({
            id: 'optimistic-cancelled',
            eventIds: [],
            clientId: 'client-cancelled',
            deliveryState: 'cancelled',
          }),
        ],
        false,
      ),
    ).toBe('optimistic-cancelled')
  })

  it.each(['submitting', 'queued', 'accepted', 'failed'] as const)(
    'still rejects an optimistic message in %s state',
    (deliveryState) => {
      expect(
        getLastEditableUserMessageId(
          [message({ eventIds: [], clientId: 'client-pending', deliveryState })],
          false,
        ),
      ).toBeNull()
    },
  )
})
