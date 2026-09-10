import { describe, expect, it } from 'vitest'
import type { SessionId } from '@spark/protocol'
import type { UIMessage } from '../../services/event-mapper'
import { buildUserMessageRevisionPayload } from './user-message-actions'

describe('buildUserMessageRevisionPayload', () => {
  it('keeps attachments, session references, and the original team mention', () => {
    const message: UIMessage & { turnId: string } = {
      id: 'message-1',
      turnId: 'turn-1',
      role: 'user',
      status: 'completed',
      blocks: [{ kind: 'text', content: 'before', isStreaming: false }],
      attachments: [{ type: 'image', path: '/tmp/image.png', name: 'image.png' }],
      sessionReferences: [{ sourceSessionId: 'source-session', snapshotSeq: 12 }],
      mentionAgentId: 'member-agent',
      usage: null,
      eventIds: ['event-1'],
    }

    expect(
      buildUserMessageRevisionPayload('session-1' as SessionId, message, 'after', [
        { id: 'source-session', title: '参考会话' },
      ]),
    ).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'after',
      attachments: message.attachments,
      mentionAgentId: 'member-agent',
      sessionReferences: [
        {
          sourceSessionId: 'source-session',
          snapshotSeq: 12,
          title: '参考会话',
          status: 'active',
        },
      ],
    })
  })
})
