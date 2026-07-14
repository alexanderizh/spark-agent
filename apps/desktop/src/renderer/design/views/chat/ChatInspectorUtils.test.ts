import { describe, expect, it } from 'vitest'
import { MessageBuilder, type UIBlock, type UIMessage } from '../../services/event-mapper'
import {
  extractInspectorTasks,
  extractSessionProgressTasks,
  parseTodosFromInputOrOutput,
} from './ChatInspectorUtils'

function toolBlock(
  toolName: string,
  toolInput: Record<string, unknown>,
  options: {
    toolCallId?: string
    output?: string
    teamMember?: boolean
  } = {},
): Extract<UIBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId: options.toolCallId ?? `${toolName}-1`,
    toolName,
    toolInput,
    status: 'success',
    output: options.output,
    error: undefined,
    durationMs: undefined,
    ...(options.teamMember
      ? {
          teamMemberContext: {
            dispatchId: 'dispatch-test-expert',
            memberAgentId: 'agent-test-expert',
          },
        }
      : {}),
  }
}

function assistantMessage(
  status: UIMessage['status'],
  blocks: UIBlock[],
  id = 'assistant-1',
): UIMessage {
  return {
    id,
    role: 'assistant',
    status,
    blocks,
    usage: null,
    eventIds: [],
  }
}

describe('chat inspector task progress', () => {
  it('normalizes Claude and Codex todo payloads and prefers the latest output snapshot', () => {
    expect(
      parseTodosFromInputOrOutput(
        {
          todos: [{ content: '定位问题', status: 'in_progress', activeForm: '正在定位问题' }],
        },
        undefined,
      ),
    ).toEqual([{ content: '定位问题', status: 'in_progress', activeForm: '正在定位问题' }])

    expect(
      parseTodosFromInputOrOutput(
        { todos: [{ text: '定位问题', completed: false }] },
        JSON.stringify({
          todos: [
            { text: '定位问题', completed: true },
            { text: '验证修复', completed: false },
          ],
        }),
      ),
    ).toEqual([
      { content: '定位问题', status: 'completed' },
      { content: '验证修复', status: 'pending' },
    ])
  })

  it('uses the completed host todo snapshot instead of a timed-out member task list', () => {
    const hostTodo = toolBlock(
      'todo_write',
      {
        todos: [
          { text: '定位链路', completed: false },
          { text: '完成修复', completed: false },
        ],
      },
      {
        toolCallId: 'host-todo',
        output: JSON.stringify({
          todos: [
            { text: '定位链路', completed: true },
            { text: '完成修复', completed: true },
          ],
        }),
      },
    )
    const memberTask = toolBlock(
      'task_create',
      { subject: '验证兜底路径', activeForm: '正在验证兜底路径' },
      {
        toolCallId: 'member-task',
        output: 'Task #1 created successfully: 验证兜底路径',
        teamMember: true,
      },
    )

    const tasks = extractSessionProgressTasks([
      assistantMessage('completed', [hostTodo, memberTask]),
    ])

    expect(tasks.map((task) => [task.subject, task.status])).toEqual([
      ['定位链路', 'completed'],
      ['完成修复', 'completed'],
    ])
  })

  it('replays the final Codex todo result into a completed session progress snapshot', () => {
    const builder = new MessageBuilder()
    const base = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-07-14T08:41:30.000Z',
    }

    builder.processEvent({
      ...base,
      id: 'todo-call',
      seq: 1,
      type: 'tool_call',
      toolCallId: 'item-3',
      toolName: 'todo_write',
      toolInput: {
        todos: [
          { text: '定位交叉表标题导出链路', completed: false },
          { text: '修复反馈并完成交付', completed: false },
        ],
      },
      source: 'builtin',
    })
    builder.processEvent({
      ...base,
      id: 'todo-result',
      seq: 2,
      type: 'tool_result',
      toolCallId: 'item-3',
      toolName: 'todo_write',
      status: 'success',
      output: {
        todos: [
          { text: '定位交叉表标题导出链路', completed: true },
          { text: '修复反馈并完成交付', completed: true },
        ],
      },
    })
    builder.processEvent({
      ...base,
      id: 'turn-completed',
      seq: 3,
      type: 'agent_status',
      status: 'completed',
    })

    expect(extractSessionProgressTasks(builder.getAllMessages())).toEqual([
      expect.objectContaining({ subject: '定位交叉表标题导出链路', status: 'completed' }),
      expect.objectContaining({ subject: '修复反馈并完成交付', status: 'completed' }),
    ])
  })

  it('marks unfinished host tasks as interrupted after their message ends', () => {
    const create = toolBlock(
      'task_create',
      { subject: '运行页面验收', activeForm: '正在运行页面验收' },
      { output: 'Task #1 created successfully: 运行页面验收' },
    )
    const update = toolBlock('task_update', { taskId: '1', status: 'in_progress' })
    const memberTask = toolBlock(
      'task_create',
      { subject: '成员内部检查' },
      {
        toolCallId: 'member-task',
        output: 'Task #2 created successfully: 成员内部检查',
        teamMember: true,
      },
    )
    const messages = [assistantMessage('completed', [create, update, memberTask])]

    expect(extractSessionProgressTasks(messages)).toEqual([
      expect.objectContaining({ id: '#1', subject: '运行页面验收', status: 'interrupted' }),
    ])
    expect(extractInspectorTasks(messages).map((task) => task.subject)).toEqual([
      '运行页面验收',
      '成员内部检查',
    ])
  })

  it('keeps a host task running while its owning message is still streaming', () => {
    const create = toolBlock(
      'task_create',
      { subject: '执行验证', activeForm: '正在执行验证' },
      { output: 'Task #1 created successfully: 执行验证' },
    )
    const update = toolBlock('task_update', { taskId: '1', status: 'in_progress' })

    expect(extractSessionProgressTasks([assistantMessage('streaming', [create, update])])).toEqual([
      expect.objectContaining({ id: '#1', status: 'in_progress' }),
    ])
  })
})
