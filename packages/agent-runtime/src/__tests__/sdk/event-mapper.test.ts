import { describe, expect, it } from 'vitest'

import { mapSDKMessageToEvents } from '../../sdk/event-mapper.js'
import type { SDKMessage } from '../../sdk/types.js'

const ctx = { sessionId: 'session-1', turnId: 'turn-1' }

describe('Claude SDK event mapper', () => {
  it('maps Claude background task lifecycle into subagent events', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const started = mapSDKMessageToEvents(
      {
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
      } as SDKMessage,
      context,
    )
    const progress = mapSDKMessageToEvents(
      {
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
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
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
      } as SDKMessage,
      context,
    )

    expect(started).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-1',
        taskId: 'task-1',
        name: 'researcher',
        task: 'Find permission regressions',
      }),
    )
    expect(progress).toContainEqual(
      expect.objectContaining({
        type: 'subagent_progress',
        toolCallId: 'tool-1',
        taskId: 'task-1',
        summary: 'Reviewing permission callbacks',
        lastToolName: 'read_file',
        totalTokens: 321,
        toolUses: 4,
        durationMs: 1_500,
      }),
    )
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-1',
        taskId: 'task-1',
        status: 'success',
        resultSummary: 'No permission regressions found',
        output: '',
        totalTokens: 456,
        toolUses: 6,
        durationMs: 2_500,
      }),
    )
    expect(completed[0]).not.toHaveProperty('outputFile')
  })

  it('does not map internal local shell task lifecycle into subagent events', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const started = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-local-bash',
        tool_use_id: 'tool-local-bash',
        task_type: 'local_bash',
        description: 'Run ls and grep',
        uuid: 'task-local-bash-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const progress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-local-bash',
        description: 'Running ls and grep',
        usage: { total_tokens: 12, tool_uses: 1, duration_ms: 100 },
        uuid: 'task-local-bash-progress',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const updated = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-local-bash',
        patch: { status: 'completed' },
        uuid: 'task-local-bash-updated',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-local-bash',
        status: 'completed',
        output_file: '',
        summary: 'Command finished',
        uuid: 'task-local-bash-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const nested = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'task-local-bash-nested',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-local-bash',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Internal shell output.' }],
        },
      } as SDKMessage,
      context,
    )

    expect(started).toEqual([])
    expect(progress).toEqual([])
    expect(updated).toEqual([])
    expect(completed).toEqual([])
    expect(nested).toEqual([])
  })

  it('does not map late nested output for an internal task without tool_use_id', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-local-bash-without-tool-id',
        task_type: 'local_bash',
        description: 'Run an internal shell command',
        uuid: 'task-local-bash-without-tool-id-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    const delta = mapSDKMessageToEvents(
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Internal ' } },
        parent_tool_use_id: 'late-local-bash-tool-id',
        uuid: 'task-local-bash-without-tool-id-delta',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const complete = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'task-local-bash-without-tool-id-complete',
        session_id: 'session-1',
        parent_tool_use_id: 'late-local-bash-tool-id',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Internal output.' }],
        },
      } as SDKMessage,
      context,
    )
    const forwarded = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'task-local-bash-without-tool-id-user',
        session_id: 'session-1',
        parent_tool_use_id: 'late-local-bash-tool-id',
        message: { role: 'user', content: 'Internal forwarded output.' },
      } as SDKMessage,
      context,
    )

    expect(delta).toEqual([])
    expect(complete).toEqual([])
    expect(forwarded).toEqual([])
  })

  it.each([
    ['local_workflow', { workflow_name: 'spec' }],
    ['future_background_job', {}],
  ])('does not map non-Agent %s task lifecycle into subagent events', (taskType, extra) => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const started = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: `task-${taskType}`,
        tool_use_id: `tool-${taskType}`,
        task_type: taskType,
        description: `Run ${taskType}`,
        ...extra,
        uuid: `task-${taskType}-started`,
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const progress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: `task-${taskType}`,
        description: `Running ${taskType}`,
        usage: { total_tokens: 5, tool_uses: 1, duration_ms: 50 },
        uuid: `task-${taskType}-progress`,
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: `task-${taskType}`,
        status: 'completed',
        output_file: '',
        summary: `${taskType} finished`,
        uuid: `task-${taskType}-completed`,
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(started).toEqual([])
    expect(progress).toEqual([])
    expect(completed).toEqual([])
  })

  it('classifies a task from task_type without hiding a colliding Agent name', () => {
    const events = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-agent-name-collision',
        tool_use_id: 'tool-agent-name-collision',
        task_type: 'agent',
        subagent_type: 'local_bash',
        description: 'Run the custom local_bash Agent',
        uuid: 'task-agent-name-collision-started',
        session_id: 'session-1',
      } as SDKMessage,
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-agent-name-collision',
        taskId: 'task-agent-name-collision',
        name: 'local_bash',
      }),
    )
  })

  it('maps an explicit remote_agent task as a real subagent', () => {
    const events = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-remote-agent',
        tool_use_id: 'tool-remote-agent',
        task_type: 'remote_agent',
        description: 'Run a remote Agent',
        uuid: 'task-remote-agent-started',
        session_id: 'session-1',
      } as SDKMessage,
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-remote-agent',
        taskId: 'task-remote-agent',
      }),
    )
  })

  it('keeps explicit skip_transcript authoritative for Agent tasks', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const started = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-hidden-agent',
        tool_use_id: 'tool-hidden-agent',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Run hidden housekeeping',
        skip_transcript: true,
        uuid: 'task-hidden-agent-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const progress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-hidden-agent',
        tool_use_id: 'tool-hidden-agent',
        subagent_type: 'researcher',
        description: 'Still running hidden housekeeping',
        usage: { total_tokens: 5, tool_uses: 1, duration_ms: 50 },
        uuid: 'task-hidden-agent-progress',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-hidden-agent',
        tool_use_id: 'tool-hidden-agent',
        status: 'completed',
        output_file: '',
        summary: 'Hidden housekeeping finished',
        uuid: 'task-hidden-agent-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(started).toEqual([])
    expect(progress).toEqual([])
    expect(completed).toEqual([])
  })

  it('does not reveal a hidden Agent task when its tool_use message arrives', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-hidden-overlap',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Run hidden overlapping task',
        skip_transcript: true,
        uuid: 'task-hidden-overlap-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    const toolUse = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-hidden-overlap',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-hidden-overlap',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Run hidden overlapping task',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const toolResult = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'agent-hidden-overlap-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-hidden-overlap',
              content: 'Hidden result',
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const nestedDelta = mapSDKMessageToEvents(
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hidden ' } },
        parent_tool_use_id: 'tool-hidden-overlap',
        uuid: 'agent-hidden-overlap-delta',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const nestedComplete = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-hidden-overlap-complete',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-hidden-overlap',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hidden nested output.' }],
        },
      } as SDKMessage,
      context,
    )
    const nestedUser = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'agent-hidden-overlap-user',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-hidden-overlap',
        message: {
          role: 'user',
          content: 'Hidden forwarded user output.',
        },
      } as SDKMessage,
      context,
    )

    expect(toolUse).toEqual([])
    expect(toolResult).toEqual([])
    expect(nestedDelta).toEqual([])
    expect(nestedComplete).toEqual([])
    expect(nestedUser).toEqual([])
  })

  it('does not attribute runtime signals to a non-Agent task_updated edge', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-non-agent-update',
        task_type: 'future_background_job',
        description: 'Run future background job',
        uuid: 'task-non-agent-update-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-non-agent-update',
        patch: { status: 'running' },
        uuid: 'task-non-agent-update-running',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    const retry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 100,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'retry-after-non-agent-update',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(retry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK' },
      }),
    )
  })

  it('maps the legacy Task tool name into a subagent lifecycle', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }

    const started = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'legacy-task-tool-use',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'legacy-task-tool-id',
              name: 'Task',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect legacy CLI behavior',
                prompt: 'Trace the legacy Task tool.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'legacy-task-tool-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'legacy-task-tool-id',
              content: 'Legacy Task completed.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    expect(started).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'legacy-task-tool-id',
        name: 'researcher',
      }),
    )
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'legacy-task-tool-id',
        output: 'Legacy Task completed.',
      }),
    )
  })

  it('does not reactivate a completed task when a duplicate tool_use arrives late', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-completed-before-tool',
        tool_use_id: 'tool-completed-before-tool',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect terminal ordering',
        uuid: 'task-completed-before-tool-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-completed-before-tool',
        patch: { status: 'completed' },
        uuid: 'task-completed-before-tool-updated',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-completed-before-tool',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-completed-before-tool',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect terminal ordering',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const retry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 100,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'retry-after-late-tool-use',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(retry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK' },
      }),
    )
  })

  it('does not reactivate a tool-result-completed task when a duplicate tool_use arrives late', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-tool-result-terminal',
        tool_use_id: 'tool-result-terminal',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect tool-result terminal state',
        uuid: 'task-tool-result-terminal-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-tool-result-terminal',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-result-terminal',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect tool-result terminal state',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'agent-tool-result-terminal-completed',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-result-terminal',
              content: 'Tool result completed.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-tool-result-terminal-duplicate',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-result-terminal',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect tool-result terminal state',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const nested = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-tool-result-terminal-nested',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-result-terminal',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Late nested output.' }],
        },
      } as SDKMessage,
      context,
    )

    const retry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 100,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'retry-after-tool-result-terminal',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(nested).toEqual([])
    expect(retry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK' },
      }),
    )
  })

  it('emits each task notification completion only once', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-duplicate-notification',
        tool_use_id: 'tool-duplicate-notification',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect duplicate notifications',
        uuid: 'task-duplicate-notification-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    const first = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-duplicate-notification',
        tool_use_id: 'tool-duplicate-notification',
        status: 'completed',
        output_file: '',
        summary: 'Duplicate notification task finished',
        uuid: 'task-duplicate-notification-first',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const duplicate = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-duplicate-notification',
        tool_use_id: 'tool-duplicate-notification',
        status: 'completed',
        output_file: '',
        summary: 'Duplicate notification task finished',
        uuid: 'task-duplicate-notification-second',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(first).toContainEqual(expect.objectContaining({ type: 'subagent_completed' }))
    expect(duplicate).toEqual([])
  })

  it('allows a full result to enrich a notification once and suppresses later notifications', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-completion-enrichment',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-completion-enrichment',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect completion enrichment',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-completion-enrichment',
        tool_use_id: 'tool-completion-enrichment',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect completion enrichment',
        uuid: 'task-completion-enrichment-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const notification = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-completion-enrichment',
        tool_use_id: 'tool-completion-enrichment',
        status: 'completed',
        output_file: '',
        summary: 'Completion notification',
        uuid: 'task-completion-enrichment-notification',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const fullResult = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'task-completion-enrichment-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        tool_use_result: {
          status: 'completed',
          agentId: 'agent-completion-enrichment',
          agentType: 'researcher',
          content: [{ type: 'text', text: 'Full completion output.' }],
        },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-completion-enrichment',
              content: 'Full completion output.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const duplicateResult = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'task-completion-enrichment-result-duplicate',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-completion-enrichment',
              content: 'Full completion output.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const lateNotification = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-completion-enrichment',
        tool_use_id: 'tool-completion-enrichment',
        status: 'completed',
        output_file: '',
        summary: 'Late completion notification',
        uuid: 'task-completion-enrichment-notification-late',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(notification).toContainEqual(
      expect.objectContaining({ type: 'subagent_completed', output: '' }),
    )
    expect(fullResult).toContainEqual(
      expect.objectContaining({ type: 'subagent_completed', output: 'Full completion output.' }),
    )
    expect(duplicateResult).toEqual([])
    expect(lateNotification).toEqual([])
  })

  it('does not revive a task when terminal notification arrives before start or progress', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-terminal-first',
        tool_use_id: 'tool-terminal-first',
        status: 'completed',
        output_file: '',
        summary: 'Terminal event arrived first',
        uuid: 'task-terminal-first-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const started = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-terminal-first',
        tool_use_id: 'tool-terminal-first',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect terminal-first ordering',
        uuid: 'task-terminal-first-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const progress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-terminal-first',
        tool_use_id: 'tool-terminal-first',
        subagent_type: 'researcher',
        description: 'Inspect terminal-first ordering',
        usage: { total_tokens: 5, tool_uses: 1, duration_ms: 50 },
        uuid: 'task-terminal-first-progress',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const updated = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-terminal-first',
        patch: { status: 'running' },
        uuid: 'task-terminal-first-updated',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const retry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 100,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'retry-after-terminal-first-update',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(completed).toEqual([])
    expect(started).toEqual([])
    expect(progress).toEqual([])
    expect(updated).toEqual([])
    expect(retry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK' },
      }),
    )
  })

  it('does not reuse a completed Agent tool as a future task candidate', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'completed-agent-candidate',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-completed-candidate',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect reusable candidate',
                prompt: 'Inspect reusable candidate.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'completed-agent-candidate-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-completed-candidate',
              content: 'Candidate completed.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const nextTask = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-after-completed-candidate',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect reusable candidate',
        prompt: 'Inspect reusable candidate.',
        uuid: 'task-after-completed-candidate-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(nextTask).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'claude-task:task-after-completed-candidate',
        taskId: 'task-after-completed-candidate',
      }),
    )
  })

  it('does not emit duplicate starts when task and Agent messages overlap', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const taskStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-agent',
        tool_use_id: 'tool-agent',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect the event mapper',
        uuid: 'task-agent-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const agentToolUse = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-tool-use',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-agent',
              name: 'Agent',
              input: { agent: 'researcher', prompt: 'Inspect the event mapper' },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    expect(taskStarted).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-agent',
      }),
    )
    expect(agentToolUse).toEqual([])
  })

  it('does not retain a duplicate Agent tool_use as a future correlation candidate', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-known-tool-id',
        tool_use_id: 'tool-known-tool-id',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect repeated work',
        prompt: 'Inspect repeated work.',
        uuid: 'task-known-tool-id-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-known-tool-id',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-known-tool-id',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect repeated work',
                prompt: 'Inspect repeated work.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const nextTask = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-repeated-work',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect repeated work',
        prompt: 'Inspect repeated work.',
        uuid: 'task-repeated-work-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(nextTask).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'claude-task:task-repeated-work',
        taskId: 'task-repeated-work',
      }),
    )
  })

  it('starts a confirmed Agent lifecycle when progress arrives before task_started', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const progress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-progress-first',
        tool_use_id: 'tool-progress-first',
        subagent_type: 'researcher',
        description: 'Inspect progress-first ordering',
        usage: { total_tokens: 5, tool_uses: 1, duration_ms: 50 },
        uuid: 'task-progress-first-progress',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const started = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-progress-first',
        tool_use_id: 'tool-progress-first',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect progress-first ordering',
        uuid: 'task-progress-first-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'subagent_started',
          toolCallId: 'tool-progress-first',
          taskId: 'task-progress-first',
        }),
        expect.objectContaining({
          type: 'subagent_progress',
          toolCallId: 'tool-progress-first',
          taskId: 'task-progress-first',
        }),
      ]),
    )
    expect(started).toEqual([])
  })

  it('keeps one stable lifecycle when task_started omits tool_use_id before Agent tool_use', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const taskStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-late-tool-id',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect late tool ids',
        prompt: 'Trace the late tool id path.',
        uuid: 'task-late-tool-id-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const agentToolUse = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-late-tool-id',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-late-tool-id',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect late tool ids',
                prompt: 'Trace the late tool id path.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const progress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-late-tool-id',
        tool_use_id: 'tool-late-tool-id',
        subagent_type: 'researcher',
        description: 'Inspect late tool ids',
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 100 },
        uuid: 'task-late-tool-id-progress',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(taskStarted).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'claude-task:task-late-tool-id',
      }),
    )
    expect(agentToolUse).toEqual([])
    expect(progress).toContainEqual(
      expect.objectContaining({
        type: 'subagent_progress',
        toolCallId: 'claude-task:task-late-tool-id',
        taskId: 'task-late-tool-id',
      }),
    )
  })

  it('uses the stable task card id for nested messages, usage, and structured completion', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }

    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-stable-output',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect stable output',
        prompt: 'Trace all stable output paths.',
        uuid: 'task-stable-output-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-stable-output',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-stable-output',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect stable output',
                prompt: 'Trace all stable output paths.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const nested = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'nested-stable-output',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-stable-output',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Stable nested output.' }],
          usage: { input_tokens: 12, output_tokens: 4 },
        },
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'completed-stable-output',
        session_id: 'session-1',
        parent_tool_use_id: null,
        tool_use_result: {
          status: 'completed',
          agentId: 'agent-stable-output',
          agentType: 'researcher',
          content: [{ type: 'text', text: 'Stable final output.' }],
        },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-stable-output',
              content: 'Stable final output.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    expect(nested).toContainEqual(
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'claude-task:task-stable-output',
        content: 'Stable nested output.',
      }),
    )
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'claude-task:task-stable-output',
        taskId: 'task-stable-output',
        inputTokens: 12,
        outputTokens: 4,
        output: 'Stable final output.',
      }),
    )
  })

  it('correlates an early nested message to the only active task card', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-early-nested',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect early nested output',
        uuid: 'task-early-nested-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    const nested = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'task-early-nested-message',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-early-nested',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Early nested output.' }],
        },
      } as SDKMessage,
      context,
    )

    expect(nested).toContainEqual(
      expect.objectContaining({
        type: 'subagent_message',
        toolCallId: 'claude-task:task-early-nested',
        content: 'Early nested output.',
      }),
    )
  })

  it('does not merge ambiguous concurrent Agent launches without tool_use_id', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    for (const taskId of ['task-ambiguous-1', 'task-ambiguous-2']) {
      mapSDKMessageToEvents(
        {
          type: 'system',
          subtype: 'task_started',
          task_id: taskId,
          task_type: 'agent',
          subagent_type: 'researcher',
          description: 'Inspect the same area',
          prompt: 'Inspect the same area.',
          uuid: `${taskId}-started`,
          session_id: 'session-1',
        } as SDKMessage,
        context,
      )
    }

    const agentToolUse = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-ambiguous',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-ambiguous',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect the same area',
                prompt: 'Inspect the same area.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    expect(agentToolUse).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-ambiguous',
      }),
    )
  })

  it('correlates task_started without tool_use_id after Agent tool_use', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const agentToolUse = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-before-task',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-before-task',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect reverse ordering',
                prompt: 'Trace the reverse ordering path.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const taskStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-after-agent',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect reverse ordering',
        prompt: 'Trace the reverse ordering path.',
        uuid: 'task-after-agent-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-after-agent',
        status: 'completed',
        output_file: '',
        summary: 'Reverse ordering finished',
        uuid: 'task-after-agent-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(agentToolUse).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-before-task',
        name: 'researcher',
      }),
    )
    expect(taskStarted).toEqual([])
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-before-task',
        taskId: 'task-after-agent',
      }),
    )
  })

  it('keeps async Agent launch metadata pending until task_started can correlate it', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    const started = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'async-agent-before-task',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-async-before-task',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect async ordering',
                prompt: 'Trace async launch ordering.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const asyncReceipt = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'async-agent-before-task-receipt',
        session_id: 'session-1',
        parent_tool_use_id: null,
        tool_use_result: {
          status: 'async_launched',
          agentId: 'agent-async-before-task',
        },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-async-before-task',
              content: 'Async agent launched successfully.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const taskStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-async-after-receipt',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect async ordering',
        prompt: 'Trace async launch ordering.',
        uuid: 'task-async-after-receipt-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-async-after-receipt',
        status: 'completed',
        output_file: '',
        summary: 'Async ordering inspected',
        uuid: 'task-async-after-receipt-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(started).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-async-before-task',
      }),
    )
    expect(asyncReceipt).toEqual([])
    expect(taskStarted).toEqual([])
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-async-before-task',
        taskId: 'task-async-after-receipt',
      }),
    )
  })

  it('does not revive an async Agent when its SDK task arrives after SendMessage completion', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'async-terminal-agent',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-async-terminal',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect async terminal ordering',
                prompt: 'Trace async completion before task events.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'async-terminal-receipt',
        session_id: 'session-1',
        parent_tool_use_id: null,
        tool_use_result: { status: 'async_launched', agentId: 'agent-async-terminal' },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-async-terminal',
              content: 'Async agent launched successfully.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'async-terminal-send-message',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'send-message-async-terminal',
              name: 'SendMessage',
              input: { to: 'agent-async-terminal', summary: 'Collect async findings' },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'async-terminal-send-message-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'send-message-async-terminal',
              content: 'Async Agent completed.',
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const lateStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-async-terminal-late',
        task_type: 'agent',
        subagent_type: 'researcher',
        description: 'Inspect async terminal ordering',
        prompt: 'Trace async completion before task events.',
        uuid: 'async-terminal-task-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const lateProgress = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-async-terminal-late',
        tool_use_id: 'tool-async-terminal',
        subagent_type: 'researcher',
        description: 'Inspect async terminal ordering',
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 100 },
        uuid: 'async-terminal-task-progress',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const retry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 100,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'async-terminal-retry',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-async-terminal',
      }),
    )
    expect(lateStarted).toEqual([])
    expect(lateProgress).toEqual([])
    expect(retry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK' },
      }),
    )
  })

  it('correlates Agent task metadata when optional system fields are absent', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }

    const agentToolUse = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-before-minimal-task',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-before-minimal-task',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect optional fields',
                prompt: 'Trace optional system metadata.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const taskStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-minimal-system-fields',
        task_type: 'agent',
        description: 'Inspect optional fields',
        uuid: 'task-minimal-system-fields-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-minimal-system-fields',
        status: 'completed',
        output_file: '',
        summary: 'Optional fields inspected',
        uuid: 'task-minimal-system-fields-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(agentToolUse).toContainEqual(
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'tool-before-minimal-task',
        name: 'researcher',
      }),
    )
    expect(taskStarted).toEqual([])
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-before-minimal-task',
        taskId: 'task-minimal-system-fields',
        name: 'researcher',
      }),
    )
  })

  it('preserves Agent metadata when task_started has the same tool id but omits optional fields', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'agent-before-minimal-task-with-id',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-minimal-task-with-id',
              name: 'Agent',
              input: {
                subagent_type: 'researcher',
                description: 'Inspect optional fields with id',
                prompt: 'Trace optional system metadata with an id.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const taskStarted = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-minimal-system-fields-with-id',
        tool_use_id: 'tool-minimal-task-with-id',
        task_type: 'agent',
        description: 'Inspect optional fields with id',
        uuid: 'task-minimal-system-fields-with-id-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-minimal-system-fields-with-id',
        status: 'completed',
        output_file: '',
        summary: 'Optional fields with id inspected',
        uuid: 'task-minimal-system-fields-with-id-completed',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    expect(taskStarted).toEqual([])
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-minimal-task-with-id',
        taskId: 'task-minimal-system-fields-with-id',
        name: 'researcher',
      }),
    )
  })

  it('uses the structured Agent tool result as the full subagent output', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'spawn-structured-agent',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-structured-agent',
              name: 'Agent',
              input: {
                agent: 'researcher',
                description: 'Inspect authentication',
                prompt: 'Trace authentication callbacks and report concrete findings.',
              },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const events = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'structured-agent-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        tool_use_result: {
          status: 'completed',
          agentId: 'agent-structured-1',
          agentType: 'researcher',
          prompt: 'Trace authentication callbacks and report concrete findings.',
          content: [
            { type: 'text', text: 'Found two callbacks.\n\nBoth preserve the permission scope.' },
          ],
          totalToolUseCount: 7,
          totalDurationMs: 2_750,
          totalTokens: 640,
          usage: {
            input_tokens: 500,
            output_tokens: 140,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
          },
        },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-structured-agent',
              content: 'Inspect authentication',
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-structured-agent',
        name: 'researcher',
        status: 'success',
        resultSummary: 'Found two callbacks.\n\nBoth preserve the permission scope.',
        output: 'Found two callbacks.\n\nBoth preserve the permission scope.',
        inputTokens: 500,
        outputTokens: 140,
        totalTokens: 640,
        toolUses: 7,
        durationMs: 2_750,
      }),
    )
  })

  it('correlates a structured result after a system task lifecycle without a tool name cache', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-system-only',
        tool_use_id: 'tool-system-only',
        description: 'Inspect system-only lifecycle',
        subagent_type: 'researcher',
        prompt: 'Return the complete system-only report.',
        uuid: 'task-system-only-started',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )

    const events = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'task-system-only-result',
        session_id: 'session-1',
        parent_tool_use_id: null,
        tool_use_result: {
          status: 'completed',
          agentId: 'agent-system-only',
          content: [{ type: 'text', text: 'Complete system-only report.' }],
          totalToolUseCount: 2,
          totalDurationMs: 900,
          totalTokens: 220,
          usage: { input_tokens: 180, output_tokens: 40 },
        },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-system-only',
              content: 'Inspect system-only lifecycle',
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'tool-system-only',
        taskId: 'task-system-only',
        name: 'researcher',
        output: 'Complete system-only report.',
      }),
    )
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'tool_result' }))
  })

  it('maps background task replacement state without correlating unrelated task edges', () => {
    const events = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          { task_id: 'task-1', task_type: 'agent', description: 'Research API behavior' },
          { task_id: 'task-2', task_type: 'bash', description: 'Run focused tests' },
        ],
        uuid: 'background-tasks-1',
        session_id: 'session-1',
      } as SDKMessage,
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        signal: 'background_tasks',
        level: 'info',
        details: [
          { label: '运行中', value: '2' },
          { label: '任务', value: 'Research API behavior; Run focused tests' },
        ],
      }),
    )
  })

  it('keeps forwarded subagent text in a nested transcript instead of the host timeline', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    const delta = mapSDKMessageToEvents(
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Checking ' } },
        parent_tool_use_id: 'tool-1',
        uuid: 'subagent-delta-1',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    const complete = mapSDKMessageToEvents(
      {
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
      } as SDKMessage,
      context,
    )

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
    expect(complete).toEqual(
      expect.arrayContaining([
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
      ]),
    )
    expect(complete).not.toContainEqual(expect.objectContaining({ type: 'assistant_message' }))
  })

  it('keeps forwarded subagent user text out of the host assistant timeline', () => {
    const events = mapSDKMessageToEvents(
      {
        type: 'user',
        uuid: 'subagent-user-1',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-1',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Tool result acknowledged.' }],
        },
      } as SDKMessage,
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

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
    const events = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'subagent-error-1',
        session_id: 'session-1',
        parent_tool_use_id: 'tool-researcher',
        subagent_type: 'researcher',
        error: 'rate_limit',
        message: { role: 'assistant', content: [] },
      } as SDKMessage,
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_error',
        code: 'CLAUDE_RATE_LIMIT',
        origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
      }),
    )
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'agent_status',
        status: 'error',
      }),
    )
  })

  it('attributes provider signals only when the active subagent is unambiguous', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'spawn-1',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-researcher',
              name: 'Agent',
              input: { agent: 'researcher', description: 'Research', prompt: 'Inspect the SDK' },
            },
          ],
        },
      } as SDKMessage,
      context,
    )

    const attributed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 3,
        max_retries: 10,
        retry_delay_ms: 2_000,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'retry-1',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    expect(attributed).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        signal: 'api_retry',
        origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
      }),
    )

    const permissionDenied = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'permission_denied',
        tool_name: 'Bash',
        tool_use_id: 'bash-1',
        message: 'Classifier unavailable',
        uuid: 'permission-denied-1',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    expect(permissionDenied).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        signal: 'permission_denied',
        origin: { kind: 'subagent', toolCallId: 'tool-researcher', name: 'researcher' },
      }),
    )

    mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'spawn-2',
        session_id: 'session-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-reviewer',
              name: 'Agent',
              input: { agent: 'reviewer', description: 'Review', prompt: 'Review the SDK' },
            },
          ],
        },
      } as SDKMessage,
      context,
    )
    const ambiguous = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 4,
        max_retries: 10,
        retry_delay_ms: 4_000,
        error_status: 429,
        error: 'rate_limit',
        uuid: 'retry-2',
        session_id: 'session-1',
      } as SDKMessage,
      context,
    )
    expect(ambiguous).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK（协作来源未明确）' },
      }),
    )
  })

  it('maps Claude Code compact status messages from real SDK fields', () => {
    const started = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'status',
        status: 'compacting',
        uuid: 'status-1',
        session_id: 'session-1',
      } as SDKMessage,
      ctx,
    )
    const completed = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'status',
        status: null,
        compact_result: 'success',
        uuid: 'status-2',
        session_id: 'session-1',
      } as SDKMessage,
      ctx,
    )

    expect(started).toContainEqual(
      expect.objectContaining({
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'started',
        rawType: 'system/status',
      }),
    )
    expect(completed).toContainEqual(
      expect.objectContaining({
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'completed',
        rawType: 'system/status',
      }),
    )
  })

  it('maps Claude Code compact boundary metadata without inventing a summary', () => {
    const events = mapSDKMessageToEvents(
      {
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
      } as SDKMessage,
      ctx,
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'boundary',
        trigger: 'auto',
        preTokens: 180_000,
        postTokens: 48_000,
        durationMs: 1234,
        rawType: 'system/compact_boundary',
      }),
    )
    expect(events[0]).not.toHaveProperty('summary')
  })
})
