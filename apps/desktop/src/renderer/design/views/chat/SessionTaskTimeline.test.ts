import { describe, expect, it } from 'vitest'
import type { UIBlock, UIMessage } from '../../services/event-mapper'
import { getToolLogGroupKind } from './ChatActivitySegments'
import {
  areSessionTaskTimelineEntriesEqual,
  buildSessionTaskTimeline,
  projectSessionTaskTimelineBlocks,
  shouldReplaceSessionTaskBlock,
} from './SessionTaskTimeline'

function tool(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  output?: string,
): Extract<UIBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId,
    toolName,
    toolInput,
    status: 'success',
    output,
    error: undefined,
    durationMs: undefined,
  }
}

function assistant(id: string, status: UIMessage['status'], blocks: UIBlock[]): UIMessage {
  return { id, role: 'assistant', status, blocks, usage: null, eventIds: [] }
}

describe('session task timeline', () => {
  it('anchors one shared task snapshot at the first task event in output order', () => {
    const firstWrite = tool('todo-1', 'todo_write', {
      todos: [
        { content: '定位链路', status: 'in_progress', activeForm: '正在定位链路' },
        { content: '完成修复', status: 'pending' },
      ],
    })
    const secondWrite = tool('todo-2', 'todo_write', {
      todos: [
        { content: '定位链路', status: 'completed' },
        { content: '完成修复', status: 'in_progress', activeForm: '正在完成修复' },
      ],
    })
    const messages = [
      assistant('assistant-1', 'streaming', [
        { kind: 'text', content: '先说明方案', isStreaming: false },
        firstWrite,
        { kind: 'text', content: '继续执行', isStreaming: false },
        secondWrite,
      ]),
    ]

    const entry = buildSessionTaskTimeline(messages).get('assistant-1')

    expect(entry?.anchorToolCallId).toBe('todo-1')
    expect(entry?.tasks.map((task) => [task.subject, task.status])).toEqual([
      ['定位链路', 'completed'],
      ['完成修复', 'in_progress'],
    ])
  })

  it('keeps later task events at their own chronological message position', () => {
    const create = tool(
      'task-create',
      'task_create',
      { subject: '运行验证', activeForm: '正在运行验证' },
      'Task #1 created successfully: 运行验证',
    )
    const update = tool('task-update', 'task_update', { taskId: '1', status: 'completed' })
    const messages = [
      assistant('assistant-1', 'streaming', [create]),
      assistant('assistant-2', 'streaming', [
        { kind: 'text', content: '验证已经完成', isStreaming: false },
        update,
      ]),
    ]

    const timeline = buildSessionTaskTimeline(messages)

    expect(Array.from(timeline.keys())).toEqual(['assistant-1', 'assistant-2'])
    expect(timeline.get('assistant-1')?.anchorToolCallId).toBe('task-create')
    expect(timeline.get('assistant-1')?.tasks[0]?.status).toBe('pending')
    expect(timeline.get('assistant-2')?.anchorToolCallId).toBe('task-update')
    expect(timeline.get('assistant-2')?.tasks[0]?.status).toBe('completed')
  })

  it('keeps the anchor and removes later host task cards across split message segments', () => {
    const firstWrite = tool('todo-anchor', 'todo_write', {
      todos: [{ content: '执行任务', status: 'in_progress' }],
    })
    const laterUpdate = tool('todo-update', 'todo_write', {
      todos: [{ content: '执行任务', status: 'completed' }],
    })
    const memberTask = {
      ...tool(
        'member-task',
        'task_create',
        { subject: '成员内部任务' },
        'Task #2 created successfully: 成员内部任务',
      ),
      teamMemberContext: { dispatchId: 'dispatch-1', memberAgentId: 'member-1' },
    }

    expect(projectSessionTaskTimelineBlocks([firstWrite], 'todo-anchor')).toEqual([firstWrite])
    expect(projectSessionTaskTimelineBlocks([laterUpdate], 'todo-anchor')).toEqual([])
    expect(projectSessionTaskTimelineBlocks([memberTask], 'todo-anchor')).toEqual([memberTask])
  })

  it('ignores member task events and empty host snapshots', () => {
    const memberTask = {
      ...tool(
        'member-task',
        'task_create',
        { subject: '成员内部任务' },
        'Task #2 created successfully: 成员内部任务',
      ),
      teamMemberContext: { dispatchId: 'dispatch-1', memberAgentId: 'member-1' },
    }
    const clear = tool('todo-clear', 'todo_write', { todos: [] })

    expect(
      buildSessionTaskTimeline([
        assistant('assistant-1', 'completed', [memberTask]),
        assistant('assistant-2', 'completed', [clear]),
      ]).size,
    ).toBe(0)
  })

  it('compares rebuilt task snapshots by value for memoized history rows', () => {
    const entry = {
      anchorToolCallId: 'todo-anchor',
      tasks: [
        { id: '1', subject: '加载历史任务', status: 'completed' as const, createdAt: 0 },
      ],
    }

    expect(areSessionTaskTimelineEntriesEqual(entry, structuredClone(entry))).toBe(true)
    expect(
      areSessionTaskTimelineEntriesEqual(entry, {
        ...entry,
        tasks: [{ ...entry.tasks[0]!, status: 'interrupted' }],
      }),
    ).toBe(false)
    expect(areSessionTaskTimelineEntriesEqual(undefined, entry)).toBe(false)
  })
})

describe('shouldReplaceSessionTaskBlock', () => {
  const entry = {
    anchorToolCallId: 'task-anchor',
    tasks: [
      { id: '1', subject: '验证任务协议', status: 'in_progress' as const, createdAt: 0 },
    ],
  }

  it.each([
    ['task_create', { subject: '创建任务' }, 'Task #1 created successfully: 创建任务'],
    ['TaskCreate', { subject: '创建任务' }, 'Task #1 created successfully: 创建任务'],
    ['task_update', { taskId: '1', status: 'completed' }, undefined],
    ['TaskUpdate', { taskId: '1', status: 'completed' }, undefined],
    ['todo_write', { todos: [{ content: '执行任务', status: 'in_progress' }] }, undefined],
    ['todo_read', {}, 'No todos'],
  ])('routes %s blocks through the session-task panel replacement', (name, input, output) => {
    const block = tool(`call-${name}`, name, input, output)

    expect(shouldReplaceSessionTaskBlock(block, entry)).toBe(true)
    expect(shouldReplaceSessionTaskBlock(block, undefined)).toBe(false)
  })

  it('never routes team member task blocks or non-tool blocks', () => {
    const memberTask = {
      ...tool('member-task', 'task_create', { subject: '成员任务' }, 'Task #1 created'),
      teamMemberContext: { dispatchId: 'dispatch-1', memberAgentId: 'member-1' },
    }

    expect(shouldReplaceSessionTaskBlock(memberTask, entry)).toBe(false)
    expect(
      shouldReplaceSessionTaskBlock(
        { kind: 'text', content: '正文', isStreaming: false },
        entry,
      ),
    ).toBe(false)
  })

  it.each(['task_create', 'task_update', 'todo_read'])(
    'confirms %s is swallowed by the generic tool bucket, so the replacement check must run before grouping',
    (name) => {
      const block = tool(`call-${name}`, name, { subject: '任务' }, 'Task #1 created')

      expect(getToolLogGroupKind(block, 'main')).toBe('tool')
    },
  )
})
