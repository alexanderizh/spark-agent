import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { buildErrorRetryPayload } from './ChatErrorRetry'

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
