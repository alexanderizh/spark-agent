import { describe, expect, it } from 'vitest'

import type { AgentEvent, AgentStatusValue } from '@spark/protocol'
import { MessageBuilder } from '../design/services/event-mapper'

function baseEvent(
  type: AgentEvent['type'],
): Pick<AgentEvent, 'id' | 'type' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'> {
  return {
    id: `${type}-1`,
    type,
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-05-27T00:00:00.000Z',
    seq: 0,
  }
}

function statusEvent(status: AgentStatusValue): AgentEvent {
  return {
    ...baseEvent('agent_status'),
    type: 'agent_status',
    status,
  }
}

describe('MessageBuilder', () => {
  it('stops thinking block streaming when the turn completes without a thinking complete event', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('agent_thinking'),
      type: 'agent_thinking',
      mode: 'delta',
      content: 'checking...',
    })
    builder.processEvent(statusEvent('completed'))

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('completed')
    expect(message.blocks).toMatchObject([
      { kind: 'thinking', content: 'checking...', isStreaming: false },
    ])
  })

  it('marks unfinished tool calls successful when the turn completes', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('tool_call'),
      type: 'tool_call',
      toolCallId: 'tool-1',
      toolName: 'bash',
      toolInput: { command: 'pwd' },
      source: 'builtin',
    })
    builder.processEvent(statusEvent('completed'))

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('completed')
    expect(message.blocks).toMatchObject([
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        status: 'success',
      },
    ])
  })

  it('marks unfinished tool calls errored when the turn is cancelled', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('tool_call'),
      type: 'tool_call',
      toolCallId: 'tool-1',
      toolName: 'bash',
      toolInput: { command: 'pwd' },
      source: 'builtin',
    })
    builder.processEvent(statusEvent('cancelled'))

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('error')
    expect(message.blocks).toMatchObject([
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        status: 'error',
      },
    ])
  })

  it('stops thinking block streaming when the final assistant message arrives', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('agent_thinking'),
      type: 'agent_thinking',
      mode: 'delta',
      content: 'checking...',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      type: 'assistant_message',
      mode: 'delta',
      content: 'done',
      provider: 'codex',
      isFinal: true,
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('completed')
    expect(message.blocks.find((block) => block.kind === 'thinking')).toMatchObject({
      kind: 'thinking',
      isStreaming: false,
    })
  })

  it('maps validation suggestions into assistant blocks', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('validation_suggestion'),
      type: 'validation_suggestion',
      summary: '检测到 1 个文件变更，建议先运行项目验证。',
      changedFiles: ['src/app.ts'],
      commands: [
        {
          id: 'script:typecheck',
          label: '类型检查',
          command: 'pnpm run typecheck',
          reason: '本轮修改包含代码文件，先确认类型契约没有漂移。',
        },
      ],
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.blocks).toMatchObject([
      {
        kind: 'validation_suggestion',
        changedFiles: ['src/app.ts'],
        commands: [{ command: 'pnpm run typecheck' }],
      },
    ])
  })

  it('creates subagent UIBlock on subagent_started event', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('subagent_started'),
      type: 'subagent_started',
      toolCallId: 'sa-1',
      name: 'Researcher',
      role: 'Finds bugs',
      task: 'Search for null pointer issues',
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.blocks).toMatchObject([
      {
        kind: 'subagent',
        toolCallId: 'sa-1',
        name: 'Researcher',
        role: 'Finds bugs',
        task: 'Search for null pointer issues',
        status: 'running',
        tokens: '',
      },
    ])
  })

  it('updates subagent UIBlock on subagent_completed event', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('subagent_started'),
      type: 'subagent_started',
      toolCallId: 'sa-1',
      name: 'Researcher',
      role: 'Finds bugs',
      task: 'Search for null pointer issues',
    })
    builder.processEvent({
      ...baseEvent('subagent_completed'),
      type: 'subagent_completed',
      toolCallId: 'sa-1',
      name: 'Researcher',
      status: 'success',
      resultSummary: 'Found 3 issues',
      output: 'Found 3 null pointer issues in auth module.',
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    const block = message.blocks.find((b) => b.kind === 'subagent')
    expect(block).toMatchObject({
      kind: 'subagent',
      toolCallId: 'sa-1',
      name: 'Researcher',
      status: 'done',
      output: 'Found 3 null pointer issues in auth module.',
    })
  })
})
