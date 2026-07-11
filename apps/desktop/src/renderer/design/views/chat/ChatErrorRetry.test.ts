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
})
