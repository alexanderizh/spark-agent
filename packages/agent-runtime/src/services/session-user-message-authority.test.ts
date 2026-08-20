import { describe, expect, it } from 'vitest'
import { createAuthoritativeUserMessageEvent } from './session-user-message-authority.js'

describe('createAuthoritativeUserMessageEvent', () => {
  it('creates a correlated user event for Composer-originated turns', () => {
    expect(
      createAuthoritativeUserMessageEvent({
        sessionId: 'session-1',
        turnId: 'turn-1',
        message: 'hello',
        attachments: [{ type: 'file', path: '/tmp/input.txt' }],
        presentation: {
          clientMessageId: '00000000-0000-4000-8000-000000000123',
        },
        createId: () => 'event-1',
        now: () => '2026-08-21T00:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'event-1',
      type: 'user_message',
      sessionId: 'session-1',
      turnId: 'turn-1',
      content: 'hello',
      clientMessageId: '00000000-0000-4000-8000-000000000123',
      attachments: [{ type: 'file', path: '/tmp/input.txt', name: 'input.txt' }],
    })
  })

  it('keeps legacy and internal callers executor-owned', () => {
    expect(
      createAuthoritativeUserMessageEvent({
        sessionId: 'session-1',
        turnId: 'turn-1',
        message: 'internal',
      }),
    ).toBeNull()
  })
})
