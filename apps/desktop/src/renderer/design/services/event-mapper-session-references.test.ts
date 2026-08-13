import { describe, expect, it } from 'vitest'
import type { SessionId } from '@spark/protocol'
import { MessageBuilder } from './event-mapper'

describe('MessageBuilder session references', () => {
  it('projects persisted user-message references into UI messages', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      id: 'event-user-reference',
      type: 'user_message',
      sessionId: 'target-session',
      turnId: 'turn-1',
      timestamp: '2026-08-14T00:00:00.000Z',
      seq: 1,
      content: '这个会话是说什么的',
      sessionReferences: [{ sourceSessionId: 'source-session' as SessionId, snapshotSeq: 42 }],
    })

    expect(builder.getAllMessages()[0]?.sessionReferences).toEqual([
      { sourceSessionId: 'source-session', snapshotSeq: 42 },
    ])
  })
})
