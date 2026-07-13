import { describe, expect, it } from 'vitest'

import { mapSDKMessageToEvents } from '../../sdk/event-mapper.js'
import type { SDKMessage } from '../../sdk/types.js'

const ctx = { sessionId: 'session-1', turnId: 'turn-1' }

describe('Claude SDK event mapper', () => {
  it('maps Claude background task lifecycle into subagent events', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const started = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-1',
      tool_use_id: 'tool-1',
      description: 'Audit authentication paths',
      subagent_type: 'researcher',
      task_type: 'agent',
      prompt: 'Find permission regressions',
      uuid: 'task-started-1',
      session_id: 'session-1',
    } as SDKMessage, context)
    const progress = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'task-1',
      tool_use_id: 'tool-1',
      description: 'Audit authentication paths',
      subagent_type: 'researcher',
      usage: { total_tokens: 321, tool_uses: 4, duration_ms: 1_500 },
      last_tool_name: 'Read',
      summary: 'Reviewing permission callbacks',
      uuid: 'task-progress-1',
      session_id: 'session-1',
    } as SDKMessage, context)
    const completed = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      tool_use_id: 'tool-1',
      status: 'completed',
      output_file: '/private/subagents/task-1.jsonl',
      summary: 'No permission regressions found',
      usage: { total_tokens: 456, tool_uses: 6, duration_ms: 2_500 },
      uuid: 'task-completed-1',
      session_id: 'session-1',
    } as SDKMessage, context)

    expect(started).toContainEqual(expect.objectContaining({
      type: 'subagent_started',
      toolCallId: 'tool-1',
      taskId: 'task-1',
      name: 'researcher',
      task: 'Find permission regressions',
    }))
    expect(progress).toContainEqual(expect.objectContaining({
      type: 'subagent_progress',
      toolCallId: 'tool-1',
      taskId: 'task-1',
      summary: 'Reviewing permission callbacks',
      lastToolName: 'read_file',
      totalTokens: 321,
      toolUses: 4,
      durationMs: 1_500,
    }))
    expect(completed).toContainEqual(expect.objectContaining({
      type: 'subagent_completed',
      toolCallId: 'tool-1',
      status: 'success',
      output: 'No permission regressions found',
      totalTokens: 456,
      toolUses: 6,
      durationMs: 2_500,
    }))
    expect(completed[0]).not.toHaveProperty('outputFile')
  })

  it('maps background task replacement state without correlating unrelated task edges', () => {
    const events = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'task-1', task_type: 'agent', description: 'Research API behavior' },
        { task_id: 'task-2', task_type: 'bash', description: 'Run focused tests' },
      ],
      uuid: 'background-tasks-1',
      session_id: 'session-1',
    } as SDKMessage, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'runtime_signal',
      signal: 'background_tasks',
      level: 'info',
      details: [
        { label: '运行中', value: '2' },
        { label: '任务', value: 'Research API behavior; Run focused tests' },
      ],
    }))
  })

  it('keeps forwarded subagent text in a nested transcript instead of the host timeline', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    const delta = mapSDKMessageToEvents({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Checking ' } },
      parent_tool_use_id: 'tool-1',
      uuid: 'subagent-delta-1',
      session_id: 'session-1',
    } as SDKMessage, context)
    const complete = mapSDKMessageToEvents({
      type: 'assistant',
      uuid: 'subagent-message-1',
      session_id: 'session-1',
      parent_tool_use_id: 'tool-1',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'text', text: 'Checking authentication.' },
          { type: 'thinking', thinking: 'Trace callers first.' },
        ],
      },
    } as SDKMessage, context)

    expect(delta).toEqual([
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'text',
        mode: 'delta',
        content: 'Checking ',
        segmentId: expect.any(String),
      }),
    ])
    const deltaEvent = delta.find((event) => event.type === 'subagent_message')
    expect(complete).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'text',
        mode: 'complete',
        content: 'Checking authentication.',
        segmentId: deltaEvent?.segmentId,
      }),
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'thinking',
        mode: 'complete',
        content: 'Trace callers first.',
      }),
    ]))
    expect(complete).not.toContainEqual(expect.objectContaining({ type: 'assistant_message' }))
  })

  it('keeps forwarded subagent user text out of the host assistant timeline', () => {
    const events = mapSDKMessageToEvents({
      type: 'user',
      uuid: 'subagent-user-1',
      session_id: 'session-1',
      parent_tool_use_id: 'tool-1',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Tool result acknowledged.' }],
      },
    } as SDKMessage, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'tool-1',
        contentKind: 'text',
        mode: 'complete',
        content: 'Tool result acknowledged.',
      }),
    ])
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'assistant_message' }))
  })

  it('attributes subagent errors without marking the host agent as failed', () => {
    const events = mapSDKMessageToEvents({
      type: 'assistant',
      uuid: 'subagent-error-1',
      session_id: 'session-1',
      parent_tool_use_id: 'tool-researcher',
      subagent_type: 'researcher',
      error: 'rate_limit',
      message: { role: 'assistant', content: [] },
    } as SDKMessage, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_error',
      code: 'CLAUDE_RATE_LIMIT',
      origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
    }))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'agent_status',
      status: 'error',
    }))
  })

  it('attributes provider signals only when the active subagent is unambiguous', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents({
      type: 'assistant',
      uuid: 'spawn-1',
      session_id: 'session-1',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-researcher',
          name: 'Agent',
          input: { agent: 'researcher', description: 'Research', prompt: 'Inspect the SDK' },
        }],
      },
    } as SDKMessage, context)

    const attributed = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'api_retry',
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 2_000,
      error_status: 429,
      error: 'rate_limit',
      uuid: 'retry-1',
      session_id: 'session-1',
    } as SDKMessage, context)
    expect(attributed).toContainEqual(expect.objectContaining({
      type: 'runtime_signal',
      signal: 'api_retry',
      origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
    }))

    const permissionDenied = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'bash-1',
      message: 'Classifier unavailable',
      uuid: 'permission-denied-1',
      session_id: 'session-1',
    } as SDKMessage, context)
    expect(permissionDenied).toContainEqual(expect.objectContaining({
      type: 'runtime_signal',
      signal: 'permission_denied',
      origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
    }))

    mapSDKMessageToEvents({
      type: 'assistant',
      uuid: 'spawn-2',
      session_id: 'session-1',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-reviewer',
          name: 'Agent',
          input: { agent: 'reviewer', description: 'Review', prompt: 'Review the SDK' },
        }],
      },
    } as SDKMessage, context)
    const ambiguous = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'api_retry',
      attempt: 4,
      max_retries: 10,
      retry_delay_ms: 4_000,
      error_status: 429,
      error: 'rate_limit',
      uuid: 'retry-2',
      session_id: 'session-1',
    } as SDKMessage, context)
    expect(ambiguous).toContainEqual(expect.objectContaining({
      type: 'runtime_signal',
      origin: { kind: 'runtime', name: 'Claude SDK（协作来源未明确）' },
    }))
  })

  it('maps Claude Code compact status messages from real SDK fields', () => {
    const started = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      uuid: 'status-1',
      session_id: 'session-1',
    } as SDKMessage, ctx)
    const completed = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success',
      uuid: 'status-2',
      session_id: 'session-1',
    } as SDKMessage, ctx)

    expect(started).toContainEqual(expect.objectContaining({
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'started',
      rawType: 'system/status',
    }))
    expect(completed).toContainEqual(expect.objectContaining({
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'completed',
      rawType: 'system/status',
    }))
  })

  it('maps Claude Code compact boundary metadata without inventing a summary', () => {
    const events = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 180_000,
        post_tokens: 48_000,
        duration_ms: 1234,
      },
      uuid: 'compact-1',
      session_id: 'session-1',
    } as SDKMessage, ctx)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'boundary',
      trigger: 'auto',
      preTokens: 180_000,
      postTokens: 48_000,
      durationMs: 1234,
      rawType: 'system/compact_boundary',
    }))
    expect(events[0]).not.toHaveProperty('summary')
  })
})
