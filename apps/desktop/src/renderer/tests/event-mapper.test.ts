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
  it.each(['CODEX_SDK_CANCELLED', 'CODEX_CLI_CANCELLED', 'ABORTED'])(
    'maps %s to a neutral cancellation block instead of an error card',
    (code) => {
      const builder = new MessageBuilder()

      builder.processEvent({
        ...baseEvent('agent_error'),
        id: `cancel-error-${code}`,
        type: 'agent_error',
        code,
        message: 'Provider run was cancelled',
        retryable: false,
      })
      builder.processEvent({
        ...statusEvent('cancelled'),
        id: `cancel-status-${code}`,
      })

      const message = builder.getAllMessages()[0]
      expect(message?.status).toBe('cancelled')
      expect(message?.eventIds).toEqual([`cancel-error-${code}`, `cancel-status-${code}`])
      expect(message?.blocks).toEqual([{ kind: 'cancelled', message: '已取消本次任务' }])
      expect(message?.blocks.some((block) => block.kind === 'error')).toBe(false)
    },
  )

  it('creates a neutral cancellation notice when only user-cancelled status is persisted', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...statusEvent('cancelled'),
    })

    expect(builder.getAllMessages()[0]).toMatchObject({
      status: 'cancelled',
      blocks: [{ kind: 'cancelled', message: '已取消本次任务' }],
    })
  })

  it('keeps restart interruptions as failures when cancelled status follows an error', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('agent_error'),
      type: 'agent_error',
      code: 'APP_RESTARTED',
      message: 'The previous turn stopped because the app restarted.',
      retryable: true,
    })
    builder.processEvent({
      ...statusEvent('cancelled'),
      id: 'restart-cancelled',
    })

    const message = builder.getAllMessages()[0]
    expect(message?.status).toBe('error')
    expect(message?.blocks).toEqual([
      expect.objectContaining({ kind: 'error', code: 'APP_RESTARTED' }),
    ])
    expect(message?.blocks.some((block) => block.kind === 'cancelled')).toBe(false)
  })

  it('keeps actionable Claude runtime signals as structured blocks', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('runtime_signal'),
      type: 'runtime_signal',
      signal: 'rate_limit',
      level: 'warning',
      title: '额度即将用尽',
      message: '当前五小时窗口已使用 92%。',
      code: 'CLAUDE_RATE_LIMIT_WARNING',
      retryable: false,
      actionHint: '额度重置后可继续。',
      details: [{ label: '重置时间', value: '2027-01-15T08:00:00.000Z' }],
    })

    expect(builder.getAllMessages()[0]?.blocks).toEqual([
      expect.objectContaining({
        kind: 'runtime_signal',
        signal: 'rate_limit',
        level: 'warning',
        actionHint: '额度重置后可继续。',
      }),
    ])
  })

  it('replaces Claude background task snapshots instead of stacking status cards', () => {
    const builder = new MessageBuilder()
    const backgroundSnapshot = (id: string, count: number, tasks: string[]): AgentEvent => ({
      ...baseEvent('runtime_signal'),
      id,
      type: 'runtime_signal',
      signal: 'background_tasks',
      level: 'info',
      title: count > 0 ? '后台任务正在运行' : '后台任务已结束',
      message: count > 0 ? `${count} 个后台任务仍在运行。` : '当前没有运行中的后台任务。',
      code: 'CLAUDE_BACKGROUND_TASKS_CHANGED',
      retryable: false,
      details: [
        { label: '运行中', value: String(count) },
        ...(tasks.length > 0 ? [{ label: '任务', value: tasks.join('; ') }] : []),
      ],
    })

    builder.processEvent(backgroundSnapshot('background-1', 1, ['检查会话面板']))
    builder.processEvent(backgroundSnapshot('background-2', 2, ['检查会话面板', '检查画布小地图']))
    builder.processEvent(backgroundSnapshot('background-3', 0, []))

    const message = builder.getAllMessages()[0]
    expect(message?.eventIds).toEqual(['background-1', 'background-2', 'background-3'])
    expect(message?.blocks).toEqual([
      expect.objectContaining({
        kind: 'runtime_signal',
        signal: 'background_tasks',
        title: '后台任务已结束',
        message: '当前没有运行中的后台任务。',
        details: [{ label: '运行中', value: '0' }],
      }),
    ])
  })

  it('updates repeated SDK retries in place and keeps the latest attempt', () => {
    const builder = new MessageBuilder()
    const retryEvent = (id: string, attempt: number): AgentEvent => ({
      ...baseEvent('runtime_signal'),
      id,
      type: 'runtime_signal',
      signal: 'api_retry',
      level: 'warning',
      title: 'Claude API 正在重试',
      message: '当前请求超过了 Claude 的额度或速率限制。',
      code: 'CLAUDE_API_RETRY_RATE_LIMIT',
      retryable: false,
      origin: { kind: 'runtime', name: 'Claude SDK' },
      details: [{ label: '重试进度', value: `${attempt}/10` }],
    })

    builder.processEvent(retryEvent('retry-1', 1))
    builder.processEvent(retryEvent('retry-2', 2))
    builder.processEvent(retryEvent('retry-3', 3))

    const message = builder.getAllMessages()[0]
    expect(message?.eventIds).toEqual(['retry-1', 'retry-2', 'retry-3'])
    expect(message?.blocks).toEqual([
      expect.objectContaining({
        kind: 'runtime_signal',
        occurrenceCount: 3,
        details: [{ label: '重试进度', value: '3/10' }],
      }),
    ])
  })

  it('does not merge permission denials for different tools', () => {
    const builder = new MessageBuilder()
    const permissionDenied = (id: string, tool: string): AgentEvent => ({
      ...baseEvent('runtime_signal'),
      id,
      type: 'runtime_signal',
      signal: 'permission_denied',
      level: 'warning',
      title: '工具权限已拒绝',
      message: '当前工具请求未获批准。',
      code: 'CLAUDE_PERMISSION_DENIED',
      retryable: false,
      details: [{ label: '工具', value: tool }],
    })

    builder.processEvent(permissionDenied('permission-bash', 'Bash'))
    builder.processEvent(permissionDenied('permission-write', 'Write'))

    expect(builder.getAllMessages()[0]?.blocks).toEqual([
      expect.objectContaining({
        kind: 'runtime_signal',
        occurrenceCount: 1,
        details: [{ label: '工具', value: 'Bash' }],
      }),
      expect.objectContaining({
        kind: 'runtime_signal',
        occurrenceCount: 1,
        details: [{ label: '工具', value: 'Write' }],
      }),
    ])
  })

  it('keeps repeated subagent errors on their card without failing the host message', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      ...baseEvent('subagent_started'),
      id: 'subagent-started-1',
      type: 'subagent_started',
      toolCallId: 'tool-researcher',
      name: 'researcher',
      role: 'Research',
      task: 'Inspect the SDK',
    })
    const error = (id: string): AgentEvent => ({
      ...baseEvent('agent_error'),
      id,
      type: 'agent_error',
      code: 'CLAUDE_RATE_LIMIT',
      title: 'Claude 请求受到限流',
      message: '当前请求超过了 Claude 的额度或速率限制。',
      retryable: true,
      origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
    })
    builder.processEvent(error('subagent-error-1'))
    builder.processEvent(error('subagent-error-2'))

    const message = builder.getAllMessages()[0]
    expect(message?.status).toBe('streaming')
    expect(message?.blocks).toEqual([
      expect.objectContaining({
        kind: 'subagent',
        toolCallId: 'tool-researcher',
        status: 'error',
      }),
      expect.objectContaining({
        kind: 'error',
        occurrenceCount: 2,
        origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
      }),
    ])
  })

  it('removes messages retracted by Claude refusal fallback', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'stale-event',
      type: 'assistant_message',
      mode: 'complete',
      content: 'stale partial',
      provider: 'claude',
      isFinal: false,
    })

    builder.processEvent({
      ...baseEvent('transcript_retraction'),
      type: 'transcript_retraction',
      eventIds: ['stale-event'],
      reason: 'model_refusal_fallback',
    })

    expect(builder.getAllMessages()).toEqual([])
  })

  it('keeps reasoning token usage on assistant messages', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('assistant_message'),
      type: 'assistant_message',
      mode: 'complete',
      content: 'done',
      provider: 'codex',
      isFinal: true,
    })
    builder.processEvent({
      ...baseEvent('usage_update'),
      id: 'usage-1',
      type: 'usage_update',
      provider: 'codex',
      model: 'gpt-5-codex',
      inputTokens: 20,
      outputTokens: 9,
      reasoningOutputTokens: 4,
    })

    expect(builder.getAllMessages()[0]?.usage).toEqual({
      inputTokens: 20,
      outputTokens: 9,
      reasoningOutputTokens: 4,
      estimatedCostUsd: undefined,
    })
  })

  it('ignores duplicate event ids when history and live events overlap', () => {
    const builder = new MessageBuilder()
    const userMessage: AgentEvent = {
      ...baseEvent('user_message'),
      type: 'user_message',
      content: 'hello',
    }

    builder.processEvent(userMessage)
    builder.processEvent(userMessage)

    const messages = builder.getAllMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.eventIds).toEqual([userMessage.id])
    expect(messages[0]?.blocks).toMatchObject([{ kind: 'text', content: 'hello' }])
  })

  it('does not append duplicate streaming deltas with the same event id', () => {
    const builder = new MessageBuilder()
    const delta: AgentEvent = {
      ...baseEvent('assistant_message'),
      type: 'assistant_message',
      mode: 'delta',
      content: 'he',
      provider: 'codex',
      isFinal: false,
    }

    builder.processEvent(delta)
    builder.processEvent(delta)

    const message = builder.getAllMessages()[0]
    expect(message?.blocks).toMatchObject([{ kind: 'text', content: 'he' }])
  })

  it('adds a context compaction block from real provider events', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('context_compaction'),
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'boundary',
      trigger: 'auto',
      preTokens: 180000,
      postTokens: 48000,
      durationMs: 1234,
      rawType: 'system/compact_boundary',
    } as AgentEvent)

    const message = builder.getAllMessages()[0]
    expect(message?.blocks).toMatchObject([
      {
        kind: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'boundary',
        trigger: 'auto',
        preTokens: 180000,
        postTokens: 48000,
        durationMs: 1234,
        rawType: 'system/compact_boundary',
      },
    ])
  })

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

    expect(message.status).toBe('cancelled')
    expect(message.blocks).toMatchObject([
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        status: 'error',
      },
      {
        kind: 'cancelled',
        message: '已取消本次任务',
      },
    ])
  })

  it('keeps the assistant message streaming until agent_status after final text arrives', () => {
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

    expect(message.status).toBe('streaming')
    expect(message.blocks.find((block) => block.kind === 'thinking')).toMatchObject({
      kind: 'thinking',
      isStreaming: true,
    })

    builder.processEvent(statusEvent('completed'))

    expect(message.status).toBe('completed')
    expect(message.blocks.find((block) => block.kind === 'thinking')).toMatchObject({
      kind: 'thinking',
      isStreaming: false,
    })
  })

  it('keeps the assistant agent snapshot attached to the message turn', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('user_message'),
      id: 'user-1',
      type: 'user_message',
      content: 'first',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1',
      type: 'assistant_message',
      mode: 'complete',
      content: 'first answer',
      provider: 'codex',
      isFinal: true,
      agentId: 'agent-a',
      agentName: 'Agent A',
    })
    builder.processEvent({
      ...baseEvent('user_message'),
      id: 'user-2',
      type: 'user_message',
      turnId: 'turn-2',
      content: 'second',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-2',
      type: 'assistant_message',
      turnId: 'turn-2',
      mode: 'complete',
      content: 'second answer',
      provider: 'codex',
      isFinal: true,
      agentId: 'agent-b',
      agentName: 'Agent B',
    })

    const messages = builder.getAllMessages()
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      agentId: 'agent-a',
      agentName: 'Agent A',
    })
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      agentId: 'agent-b',
      agentName: 'Agent B',
    })
  })

  it('inserts a late user message before assistant blocks already created for the same turn', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('checkpoint'),
      id: 'checkpoint-1',
      type: 'checkpoint',
      checkpointId: 'chk_12345678',
      label: '新建一个 md 文件',
      seq: 1,
    })
    builder.processEvent({
      ...baseEvent('user_message'),
      id: 'user-1',
      type: 'user_message',
      content: '新建一个 md 文件',
      seq: 2,
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1',
      type: 'assistant_message',
      mode: 'complete',
      content: '我来处理。',
      provider: 'codex',
      isFinal: true,
      seq: 3,
    })

    const messages = builder.getAllMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      role: 'user',
      turnId: 'turn-1',
    })
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      turnId: 'turn-1',
    })
    expect(messages[1]?.blocks).toEqual([
      expect.objectContaining({ kind: 'checkpoint', checkpointId: 'chk_12345678' }),
      expect.objectContaining({ kind: 'text', content: '我来处理。' }),
    ])
  })

  it('keeps a non-final complete assistant segment streaming until agent status completes', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('assistant_message'),
      type: 'assistant_message',
      mode: 'complete',
      content: 'Codex CLI answer',
      provider: 'codex',
      isFinal: false,
      segmentId: 'codex-turn-1',
    })

    let message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.status).toBe('streaming')
    expect(message.blocks).toMatchObject([
      { kind: 'text', content: 'Codex CLI answer', isStreaming: false },
    ])

    builder.processEvent(statusEvent('completed'))
    message = builder.getAllMessages()[0]
    expect(message?.status).toBe('completed')
  })

  it('keeps earlier assistant text segments when the final result contains all segments', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1-delta',
      type: 'assistant_message',
      mode: 'delta',
      content: '逻辑检查通过后我会尝试做前端运行验证。',
      provider: 'codex',
      isFinal: false,
      segmentId: 'seg-1',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1-complete',
      type: 'assistant_message',
      mode: 'complete',
      content: '逻辑检查通过后我会尝试做前端运行验证。',
      provider: 'codex',
      isFinal: false,
      segmentId: 'seg-1',
    })
    builder.processEvent({
      ...baseEvent('tool_call'),
      id: 'tool-1',
      type: 'tool_call',
      toolCallId: 'cmd-1',
      toolName: 'bash',
      toolInput: { command: 'pnpm dev' },
      source: 'builtin',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-2-delta',
      type: 'assistant_message',
      mode: 'delta',
      content: '本地 server 在当前沙箱无权监听端口，我会改做静态验证。',
      provider: 'codex',
      isFinal: false,
      segmentId: 'seg-2',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-final',
      type: 'assistant_message',
      mode: 'complete',
      content:
        '逻辑检查通过后我会尝试做前端运行验证。\n\n本地 server 在当前沙箱无权监听端口，我会改做静态验证。',
      provider: 'codex',
      isFinal: true,
      segmentId: 'codex-sdk-turn-1',
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.blocks).toMatchObject([
      {
        kind: 'text',
        content: '逻辑检查通过后我会尝试做前端运行验证。',
        isStreaming: false,
        segmentId: 'seg-1',
      },
      {
        kind: 'tool_call',
        toolCallId: 'cmd-1',
      },
      {
        kind: 'text',
        content: '本地 server 在当前沙箱无权监听端口，我会改做静态验证。',
        isStreaming: false,
        segmentId: 'seg-2',
      },
    ])
  })

  it('keeps SDK item errors in the active assistant message for the same turn', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('user_message'),
      id: 'user-1',
      type: 'user_message',
      content: 'run codex task',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1',
      type: 'assistant_message',
      mode: 'delta',
      content: '先定位问题。',
      provider: 'codex',
      isFinal: false,
      segmentId: 'seg-1',
    })
    builder.processEvent({
      ...baseEvent('user_message'),
      id: 'user-2',
      turnId: 'turn-2',
      type: 'user_message',
      content: 'queued follow-up',
    })
    builder.processEvent({
      ...baseEvent('agent_error'),
      id: 'sdk-item-error-1',
      type: 'agent_error',
      code: 'CODEX_SDK_ITEM_ERROR',
      message: 'SDK item error',
      retryable: false,
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-2',
      type: 'assistant_message',
      mode: 'delta',
      content: '继续输出。',
      provider: 'codex',
      isFinal: false,
      segmentId: 'seg-2',
    })

    const messages = builder.getAllMessages()
    expect(messages).toHaveLength(3)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      turnId: 'turn-1',
      status: 'error',
    })
    expect(messages[1]?.blocks).toMatchObject([
      { kind: 'text', content: '先定位问题。' },
      { kind: 'error', code: 'CODEX_SDK_ITEM_ERROR' },
      { kind: 'text', content: '继续输出。' },
    ])
  })

  it('appends later complete blocks when one SDK message reuses the same segment id', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1-delta',
      type: 'assistant_message',
      mode: 'delta',
      content: '第一段建议：先做静态检查。',
      provider: 'claude',
      isFinal: false,
      segmentId: 'seg-shared',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-1-complete',
      type: 'assistant_message',
      mode: 'complete',
      content: '第一段建议：先做静态检查。',
      provider: 'claude',
      isFinal: false,
      segmentId: 'seg-shared',
    })
    builder.processEvent({
      ...baseEvent('assistant_message'),
      id: 'assistant-2-complete',
      type: 'assistant_message',
      mode: 'complete',
      content: '\n第二段建议：再补运行验证。',
      provider: 'claude',
      isFinal: false,
      segmentId: 'seg-shared',
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.blocks).toMatchObject([
      {
        kind: 'text',
        content: '第一段建议：先做静态检查。\n第二段建议：再补运行验证。',
        isStreaming: false,
        segmentId: 'seg-shared',
      },
    ])
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

  it('keeps only the latest explicit file presentation for a turn', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('presented_files'),
      type: 'presented_files',
      files: [{ path: '/workspace/old.pdf' }],
    })
    builder.processEvent({
      ...baseEvent('presented_files'),
      id: 'presented-files-2',
      type: 'presented_files',
      files: [{ path: '/workspace/report.pdf', title: 'Final report' }],
    })

    expect(builder.getAllMessages()[0]?.blocks).toEqual([
      {
        kind: 'presented_files',
        files: [{ path: '/workspace/report.pdf', title: 'Final report' }],
      },
    ])
  })

  it('does not convert ordinary file changes into presented files', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('file_change'),
      type: 'file_change',
      changeType: 'create',
      path: '/workspace/LICENSE',
    })

    expect(builder.getAllMessages()[0]?.blocks).toEqual([
      expect.objectContaining({ kind: 'file_change', path: '/workspace/LICENSE' }),
    ])
    expect(
      builder.getAllMessages()[0]?.blocks.some((block) => block.kind === 'presented_files'),
    ).toBe(false)
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

  it('normalizes mixed AskUserQuestion prompt types into a user_question block', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('tool_call'),
      type: 'tool_call',
      toolCallId: 'question-1',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [
          {
            id: 'style',
            question: '希望我怎么协助？',
            header: '协作方式',
            allowOther: true,
            options: [{ label: '直接帮我写', description: '你来直接改代码' }],
          },
          {
            id: 'extra',
            question: '补充一点背景',
            header: '额外信息',
            type: 'text',
            multiline: true,
            placeholder: '输入当前上下文',
          },
        ],
      },
      source: 'builtin',
    })

    const message = builder.getAllMessages()[0]
    expect(message).toBeDefined()
    if (message == null) return

    expect(message.blocks).toMatchObject([
      {
        kind: 'user_question',
        toolCallId: 'question-1',
        answered: false,
        questions: [
          {
            id: 'style',
            question: '希望我怎么协助？',
            header: '协作方式',
            type: 'single_choice',
            required: true,
            allowOther: true,
            options: [{ label: '直接帮我写', description: '你来直接改代码' }],
          },
          {
            id: 'extra',
            question: '补充一点背景',
            header: '额外信息',
            type: 'text',
            required: true,
            multiline: true,
            placeholder: '输入当前上下文',
          },
        ],
      },
    ])
  })

  it('keeps a failed AskUserQuestion unresolved and exposes its transport error', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      ...baseEvent('tool_call'),
      type: 'tool_call',
      toolCallId: 'question-error',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ header: '确认', question: '继续吗？' }] },
      source: 'builtin',
    })
    builder.processEvent({
      ...baseEvent('tool_result'),
      id: 'tool-result-error',
      type: 'tool_result',
      toolCallId: 'question-error',
      toolName: 'AskUserQuestion',
      status: 'error',
      error: 'Tool permission request failed: Stream closed',
    })

    expect(builder.getAllMessages()[0]?.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'user_question',
        answered: false,
        error: 'Tool permission request failed: Stream closed',
      }),
    )
  })

  it('marks AskUserQuestion answered only after a successful tool result', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      ...baseEvent('tool_call'),
      type: 'tool_call',
      toolCallId: 'question-success',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ header: '确认', question: '继续吗？' }] },
      source: 'builtin',
    })
    builder.processEvent({
      ...baseEvent('tool_result'),
      id: 'tool-result-success',
      type: 'tool_result',
      toolCallId: 'question-success',
      toolName: 'AskUserQuestion',
      status: 'success',
      output: JSON.stringify({ answers: [{ question: '继续吗？', answer: '继续' }] }),
    })

    const questionBlock = builder
      .getAllMessages()[0]
      ?.blocks.find((block) => block.kind === 'user_question')
    expect(questionBlock).toEqual(
      expect.objectContaining({
        kind: 'user_question',
        answered: true,
      }),
    )
    expect(questionBlock).not.toHaveProperty('error')
  })

  it('scopes reused Codex tool call IDs to their originating turn', () => {
    const builder = new MessageBuilder()
    const toolCall = (turnId: string, id: string, command: string): AgentEvent => ({
      ...baseEvent('tool_call'),
      id,
      turnId,
      type: 'tool_call',
      toolCallId: 'item_6',
      toolName: 'bash',
      toolInput: { command },
      source: 'builtin',
    })
    const terminalOutput = (turnId: string, id: string, data: string): AgentEvent => ({
      ...baseEvent('terminal_output'),
      id,
      turnId,
      type: 'terminal_output',
      toolCallId: 'item_6',
      stream: 'stdout',
      data,
      isFinal: true,
      exitCode: 0,
    })
    const toolResult = (turnId: string, id: string, output: string): AgentEvent => ({
      ...baseEvent('tool_result'),
      id,
      turnId,
      type: 'tool_result',
      toolCallId: 'item_6',
      toolName: 'bash',
      status: 'success',
      output,
    })

    builder.processEvent(toolCall('turn-1', 'turn-1-call', 'printf old'))
    builder.processEvent(terminalOutput('turn-1', 'turn-1-terminal', 'old output'))
    builder.processEvent(toolResult('turn-1', 'turn-1-result', 'old output'))
    builder.processEvent(toolCall('turn-2', 'turn-2-call', 'printf new'))
    builder.processEvent(terminalOutput('turn-2', 'turn-2-terminal', 'new output'))
    builder.processEvent(toolResult('turn-2', 'turn-2-result', 'new output'))

    const messagesByTurn = new Map(
      builder.getAllMessages().map((message) => [message.turnId, message]),
    )
    const firstTurnBlocks = messagesByTurn.get('turn-1')?.blocks ?? []
    const secondTurnBlocks = messagesByTurn.get('turn-2')?.blocks ?? []

    expect(firstTurnBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          toolCallId: 'item_6',
          status: 'success',
          output: 'old output',
        }),
        expect.objectContaining({
          kind: 'terminal',
          toolCallId: 'item_6',
          stdout: 'old output',
          isStreaming: false,
        }),
      ]),
    )
    expect(secondTurnBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          toolCallId: 'item_6',
          status: 'success',
          output: 'new output',
        }),
        expect.objectContaining({
          kind: 'terminal',
          toolCallId: 'item_6',
          stdout: 'new output',
          isStreaming: false,
        }),
      ]),
    )
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

  it('upserts task progress and bounded transcript into the existing subagent block', () => {
    const builder = new MessageBuilder()

    builder.processEvent({
      ...baseEvent('subagent_started'),
      type: 'subagent_started',
      toolCallId: 'sa-1',
      taskId: 'task-1',
      name: 'Researcher',
      role: 'Finds bugs',
      task: 'Audit permission handling',
    })
    builder.processEvent({
      ...baseEvent('subagent_started'),
      id: 'subagent-started-2',
      type: 'subagent_started',
      toolCallId: 'sa-1',
      taskId: 'task-1',
      name: 'researcher',
      role: 'Audit permission handling',
      task: 'Find permission regressions',
    })
    builder.processEvent({
      ...baseEvent('subagent_progress'),
      type: 'subagent_progress',
      toolCallId: 'sa-1',
      taskId: 'task-1',
      summary: 'Reviewing callbacks',
      lastToolName: 'read_file',
      totalTokens: 321,
      toolUses: 4,
      durationMs: 1_500,
      status: 'running',
    })
    builder.processEvent({
      ...baseEvent('subagent_message'),
      type: 'subagent_message',
      toolCallId: 'sa-1',
      contentKind: 'text',
      mode: 'delta',
      content: 'Checking ',
      segmentId: 'segment-1',
    })
    builder.processEvent({
      ...baseEvent('subagent_message'),
      id: 'subagent-message-2',
      type: 'subagent_message',
      toolCallId: 'sa-1',
      contentKind: 'text',
      mode: 'complete',
      content: 'Checking authentication.',
      segmentId: 'segment-1',
    })

    const blocks = builder.getAllMessages().flatMap((message) => message.blocks)
    const subagents = blocks.filter((block) => block.kind === 'subagent')
    expect(subagents).toHaveLength(1)
    expect(subagents[0]).toMatchObject({
      kind: 'subagent',
      toolCallId: 'sa-1',
      taskId: 'task-1',
      task: 'Find permission regressions',
      status: 'running',
      progressSummary: 'Reviewing callbacks',
      lastToolName: 'read_file',
      tokens: '321',
      toolUses: 4,
      durationMs: 1_500,
      transcript: [{ kind: 'text', content: 'Checking authentication.', segmentId: 'segment-1' }],
    })
  })

  it('preserves stopped and failed background task outcomes', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      ...baseEvent('subagent_started'),
      type: 'subagent_started',
      toolCallId: 'sa-1',
      name: 'Researcher',
      role: 'Finds bugs',
      task: 'Audit permission handling',
    })
    builder.processEvent({
      ...baseEvent('subagent_completed'),
      type: 'subagent_completed',
      toolCallId: 'sa-1',
      name: 'Researcher',
      status: 'stopped',
      resultSummary: 'Stopped by user',
      output: 'Stopped by user',
      totalTokens: 99,
    })

    expect(builder.getAllMessages()[0]?.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'subagent',
        status: 'stopped',
        tokens: '99',
        output: 'Stopped by user',
      }),
    )
  })

  it('bounds nested subagent transcripts to the newest 24k characters', () => {
    const builder = new MessageBuilder()
    builder.processEvent({
      ...baseEvent('subagent_started'),
      type: 'subagent_started',
      toolCallId: 'sa-1',
      name: 'Researcher',
      role: 'Finds bugs',
      task: 'Audit permission handling',
    })
    builder.processEvent({
      ...baseEvent('subagent_message'),
      type: 'subagent_message',
      toolCallId: 'sa-1',
      contentKind: 'text',
      mode: 'complete',
      content: `old:${'a'.repeat(13_000)}`,
      segmentId: 'segment-old',
    })
    builder.processEvent({
      ...baseEvent('subagent_message'),
      id: 'subagent-message-new',
      type: 'subagent_message',
      toolCallId: 'sa-1',
      contentKind: 'text',
      mode: 'complete',
      content: `new:${'b'.repeat(13_000)}`,
      segmentId: 'segment-new',
    })

    const block = builder.getAllMessages()[0]?.blocks.find((item) => item.kind === 'subagent')
    expect(block?.kind).toBe('subagent')
    if (block?.kind !== 'subagent') return
    const transcript = block.transcript ?? []
    expect(transcript.reduce((total, entry) => total + entry.content.length, 0)).toBe(24_000)
    expect(transcript.at(-1)?.content).toBe(`new:${'b'.repeat(13_000)}`)
    expect(transcript[0]?.content.startsWith('old:')).toBe(false)
  })
})
