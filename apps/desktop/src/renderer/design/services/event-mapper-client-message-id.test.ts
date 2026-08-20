import { describe, expect, it } from 'vitest'
import { MessageBuilder } from './event-mapper'

describe('MessageBuilder client message reconciliation', () => {
  it('maps a persisted clientMessageId back to the renderer clientId', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      id: 'event-1',
      type: 'user_message',
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-08-21T00:00:00.000Z',
      seq: 0,
      content: 'hello',
      clientMessageId: '00000000-0000-4000-8000-000000000123',
    })

    expect(builder.getAllMessages()).toEqual([
      expect.objectContaining({
        role: 'user',
        turnId: 'turn-1',
        clientId: '00000000-0000-4000-8000-000000000123',
      }),
    ])
  })
})
