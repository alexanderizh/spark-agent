import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { buildErrorRetryPayload, buildTurnRetryPayload } from './ChatErrorRetry'

function uiMessage(
  patch: Partial<UIMessage> & Pick<UIMessage, 'id' | 'role' | 'blocks'>,
): UIMessage {
  return {
    status: 'completed',
    usage: null,
    eventIds: [],
    ...patch,
  }
}

describe('buildErrorRetryPayload', () => {
  it('reuses the nearest preceding user message for retryable failures', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'retry this', isStreaming: false }],
        attachments: [{ type: 'file', path: '/tmp/input.txt', name: 'input.txt' }],
        usage: null,
        eventIds: ['user-1'],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        status: 'error',
        blocks: [
          {
            kind: 'error',
            code: 'CLAUDE_OVERLOADED',
            message: 'busy',
            retryable: true,
          },
        ],
        usage: null,
        eventIds: ['assistant-1'],
      },
    ]

    expect(buildErrorRetryPayload(messages, 1)).toEqual({
      text: 'retry this',
      attachments: [{ type: 'file', path: '/tmp/input.txt', name: 'input.txt' }],
    })
  })

  it('does not reuse an earlier visible user turn for a hidden internal turn failure', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-visible',
        turnId: 'turn-visible',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'do not retry this', isStreaming: false }],
        usage: null,
        eventIds: ['user-visible'],
      },
      {
        id: 'user-hidden',
        turnId: 'turn-internal',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'internal prompt', isStreaming: false }],
        usage: null,
        eventIds: ['user-hidden'],
        turnSource: 'goal_iteration',
        userMessageVisibility: 'hidden',
      },
      {
        id: 'assistant-error',
        turnId: 'turn-internal',
        role: 'assistant',
        status: 'error',
        blocks: [{ kind: 'error', code: 'FAILED', message: 'failed', retryable: true }],
        usage: null,
        eventIds: ['assistant-error'],
      },
    ]

    expect(buildErrorRetryPayload(messages, 2)).toBeNull()
  })
})

describe('buildTurnRetryPayload', () => {
  it('restores the failed turn with attachments and session references', () => {
    const messages = [
      uiMessage({
        id: 'user-1',
        turnId: 'turn-failed',
        role: 'user',
        blocks: [{ kind: 'text', content: 'retry me', isStreaming: false }],
        attachments: [{ type: 'file', path: '/tmp/spec.md' }],
        sessionReferences: [
          { sourceSessionId: 'session-source', title: 'Source', snapshotSeq: 12 },
        ],
      }),
    ]

    expect(buildTurnRetryPayload(messages, 'turn-failed')).toEqual({
      text: 'retry me',
      attachments: [{ type: 'file', path: '/tmp/spec.md' }],
      sessionReferences: [{ sourceSessionId: 'session-source', title: 'Source', snapshotSeq: 12 }],
    })
  })

  it('does not expose hidden internal turn payloads', () => {
    const messages = [
      uiMessage({
        id: 'user-hidden',
        turnId: 'turn-hidden',
        role: 'user',
        userMessageVisibility: 'hidden',
        blocks: [{ kind: 'text', content: 'internal prompt', isStreaming: false }],
      }),
    ]

    expect(buildTurnRetryPayload(messages, 'turn-hidden')).toBeNull()
  })
})
