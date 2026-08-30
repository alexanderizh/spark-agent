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

  it('marks timeline content that disappears with the tool-log master toggle', () => {
    const toolOnlyGroups = groupChatMessageTimeline([
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'web_search',
        toolInput: {},
        status: 'success',
        output: 'done',
        error: undefined,
        durationMs: 10,
      },
    ])
    const mixedGroups = groupChatMessageTimeline([
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'web_search',
        toolInput: {},
        status: 'success',
        output: 'done',
        error: undefined,
        durationMs: 10,
      },
      { kind: 'text', content: '最终回答', isStreaming: false },
    ])

    expect(toolOnlyGroups[0]).toMatchObject({ kind: 'content', collapsibleOnly: true })
    expect(mixedGroups[0]).toMatchObject({ kind: 'content', collapsibleOnly: false })
  })
})
