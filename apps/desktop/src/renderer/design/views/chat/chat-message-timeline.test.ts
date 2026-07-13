import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { groupChatMessageTimeline } from './chat-message-timeline'

describe('groupChatMessageTimeline', () => {
  it('keeps a mid-stream warning between the content emitted before and after it', () => {
    const blocks: UIBlock[] = [
      { kind: 'text', content: 'before', isStreaming: false },
      {
        kind: 'runtime_signal',
        signal: 'permission_denied',
        level: 'warning',
        title: '工具权限已拒绝',
        message: 'Bash was denied',
        retryable: false,
      },
      { kind: 'text', content: 'after', isStreaming: true },
    ]

    const groups = groupChatMessageTimeline(blocks)

    expect(groups.map((group) => group.kind)).toEqual(['content', 'runtime_signal', 'content'])
    expect(groups[0]).toMatchObject({ blocks: [expect.objectContaining({ content: 'before' })] })
    expect(groups[2]).toMatchObject({ blocks: [expect.objectContaining({ content: 'after' })] })
  })
})
