import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { groupChatMessageTimeline } from './chat-message-timeline'
import type { SessionTaskTimelineEntry } from './SessionTaskTimeline'

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

  it('keeps a group holding the session task panel out of the tool-log toggle', () => {
    const entry: SessionTaskTimelineEntry = { anchorToolCallId: 'task-1', tasks: [] }
    const taskTool: UIBlock = {
      kind: 'tool_call',
      toolCallId: 'task-1',
      toolName: 'TaskCreate',
      toolInput: {},
      status: 'success',
      output: 'Task 1 created',
      error: undefined,
      durationMs: 5,
    }

    // 有任务面板快照时，任务工具块渲染为正文面板，不受「思考和工具日志」开关控制，
    // 否则收起日志会连 SessionTaskPanel 一起隐藏。
    const withEntry = groupChatMessageTimeline([taskTool], entry)
    expect(withEntry[0]).toMatchObject({ kind: 'content', collapsibleOnly: false })

    // 无快照（如 inspector 面）保持旧行为：任务块仍视为可折叠日志。
    const withoutEntry = groupChatMessageTimeline([taskTool])
    expect(withoutEntry[0]).toMatchObject({ kind: 'content', collapsibleOnly: true })
  })
})
