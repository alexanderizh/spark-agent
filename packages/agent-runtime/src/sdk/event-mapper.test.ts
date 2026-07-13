import { describe, expect, it } from 'vitest'
import { mapSDKMessageToEvents } from './event-mapper.js'
import type { SDKAssistantMessage, SDKResultMessage, SDKUserMessage } from './types.js'

describe('mapSDKMessageToEvents', () => {
  it.each([
    ['authentication_failed', 'CLAUDE_AUTHENTICATION_FAILED', false],
    ['oauth_org_not_allowed', 'CLAUDE_OAUTH_ORG_NOT_ALLOWED', false],
    ['billing_error', 'CLAUDE_BILLING_ERROR', false],
    ['rate_limit', 'CLAUDE_RATE_LIMIT', true],
    ['overloaded', 'CLAUDE_OVERLOADED', true],
    ['invalid_request', 'CLAUDE_INVALID_REQUEST', false],
    ['model_not_found', 'CLAUDE_MODEL_NOT_FOUND', false],
    ['server_error', 'CLAUDE_SERVER_ERROR', true],
    ['unknown', 'CLAUDE_UNKNOWN', true],
    ['max_output_tokens', 'CLAUDE_MAX_OUTPUT_TOKENS', true],
  ])('maps Claude assistant error %s', (error, code, retryable) => {
    const events = mapSDKMessageToEvents({
      type: 'assistant',
      uuid: 'assistant-error',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      error,
      message: { role: 'assistant', content: [] },
    }, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent_error', code, retryable,
        title: expect.any(String), actionHint: expect.any(String),
      }),
      expect.objectContaining({ type: 'agent_status', status: 'error' }),
    ]))
  })

  it('attributes a subagent assistant error without failing the host status', () => {
    const events = mapSDKMessageToEvents(
      {
        type: 'assistant',
        uuid: 'subagent-error',
        session_id: 'sdk-session',
        parent_tool_use_id: 'tool-researcher',
        subagent_type: 'researcher',
        error: 'rate_limit',
        message: { role: 'assistant', content: [] },
      },
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_error',
        code: 'CLAUDE_RATE_LIMIT',
        origin: {
          kind: 'subagent',
          toolCallId: 'tool-researcher',
          name: 'researcher',
        },
      }),
    )
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'agent_status' }))
  })

  it('attributes retries only while exactly one subagent is active', () => {
    const context = { sessionId: 'session-1', turnId: 'turn-1' }
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-researcher',
        tool_use_id: 'tool-researcher',
        description: 'Research SDK behavior',
        subagent_type: 'researcher',
        uuid: 'task-started-researcher',
        session_id: 'sdk-session',
      },
      context,
    )

    const singleSubagentRetry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 500,
        error: 'rate_limit',
        error_status: 429,
        uuid: 'retry-single-subagent',
        session_id: 'sdk-session',
      },
      context,
    )
    expect(singleSubagentRetry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: {
          kind: 'subagent',
          toolCallId: 'tool-researcher',
          name: 'researcher',
        },
      }),
    )

    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-reviewer',
        tool_use_id: 'tool-reviewer',
        description: 'Review SDK behavior',
        subagent_type: 'reviewer',
        uuid: 'task-started-reviewer',
        session_id: 'sdk-session',
      },
      context,
    )
    const ambiguousRetry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 1000,
        error: 'rate_limit',
        error_status: 429,
        uuid: 'retry-ambiguous',
        session_id: 'sdk-session',
      },
      context,
    )
    expect(ambiguousRetry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK（协作来源未明确）' },
      }),
    )

    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-researcher',
        patch: { status: 'completed' },
        uuid: 'task-updated-researcher',
        session_id: 'sdk-session',
      },
      context,
    )
    mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'task-reviewer',
        patch: { status: 'failed' },
        uuid: 'task-updated-reviewer',
        session_id: 'sdk-session',
      },
      context,
    )
    const postCompletionRetry = mapSDKMessageToEvents(
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 3,
        max_retries: 10,
        retry_delay_ms: 1500,
        error: 'rate_limit',
        error_status: 429,
        uuid: 'retry-after-completion',
        session_id: 'sdk-session',
      },
      context,
    )
    expect(postCompletionRetry).toContainEqual(
      expect.objectContaining({
        type: 'runtime_signal',
        origin: { kind: 'runtime', name: 'Claude SDK' },
      }),
    )
  })

  it('treats structured output retry exhaustion as non-retryable', () => {
    const events = mapSDKMessageToEvents({
      type: 'result',
      subtype: 'error_max_structured_output_retries',
      uuid: 'result-structured-error',
      session_id: 'sdk-session',
      duration_ms: 10,
      duration_api_ms: 5,
      is_error: true,
      num_turns: 2,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      errors: ['schema mismatch'],
    }, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent_error',
        code: 'ERROR_MAX_STRUCTURED_OUTPUT_RETRIES',
        retryable: false,
      }),
    ]))
  })

  it('maps Claude runtime signals without silent drops', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1' }
    const messages = [
      { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 4,
        retry_delay_ms: 1500, error_status: 529, error: 'overloaded',
        uuid: 'retry-1', session_id: 'sdk-session' },
      { type: 'system', subtype: 'permission_denied', tool_name: 'Bash',
        tool_use_id: 'tool-1', decision_reason_type: 'rule',
        decision_reason: 'Denied by project rule', message: 'Command blocked',
        uuid: 'permission-1', session_id: 'sdk-session' },
      { type: 'auth_status', isAuthenticating: true,
        output: ['Open the browser to continue'], uuid: 'auth-1', session_id: 'sdk-session' },
      { type: 'rate_limit_event', rate_limit_info: {
        status: 'allowed_warning', rateLimitType: 'five_hour',
        utilization: 0.92, resetsAt: 1_800_000_000,
      }, uuid: 'rate-1', session_id: 'sdk-session' },
      { type: 'system', subtype: 'model_refusal_fallback',
        original_model: 'claude-opus', fallback_model: 'claude-sonnet',
        request_id: 'request-fallback', content: 'Continuing with the fallback model.',
        uuid: 'fallback-1', session_id: 'sdk-session' },
      { type: 'system', subtype: 'model_refusal_no_fallback',
        original_model: 'claude-opus', request_id: 'request-1',
        content: 'The model declined this request.', uuid: 'refusal-1', session_id: 'sdk-session' },
      { type: 'system', subtype: 'notification', key: 'background-ready',
        text: 'Background work finished', priority: 'high',
        uuid: 'notification-1', session_id: 'sdk-session' },
      { type: 'system', subtype: 'mirror_error', error: 'mirror timed out',
        key: { projectKey: 'project-1', sessionId: 'sdk-session' },
        uuid: 'mirror-1', session_id: 'sdk-session' },
      { type: 'system', subtype: 'worker_shutting_down', reason: 'host_exit',
        uuid: 'worker-1', session_id: 'sdk-session' },
    ]

    const events = messages.flatMap((message) => mapSDKMessageToEvents(message, ctx))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'runtime_signal', signal: 'api_retry' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'permission_denied' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'auth_status' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'rate_limit' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'model_refusal_fallback' }),
      expect.objectContaining({ type: 'agent_error', code: 'CLAUDE_MODEL_REFUSAL' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'notification' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'mirror_error' }),
      expect.objectContaining({ type: 'runtime_signal', signal: 'worker_shutdown' }),
      expect.objectContaining({ type: 'agent_status', status: 'error' }),
    ]))
  })

  it('uses session idle as the authoritative completion signal', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1' }
    const resultEvents = mapSDKMessageToEvents({
      type: 'result', subtype: 'success', uuid: 'result-1', session_id: 'sdk-session',
      duration_ms: 10, duration_api_ms: 5, is_error: false, num_turns: 1,
      result: 'done', total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }, ctx)
    const idleEvents = mapSDKMessageToEvents({
      type: 'system', subtype: 'session_state_changed', state: 'idle',
      uuid: 'state-1', session_id: 'sdk-session',
    }, ctx)

    expect(resultEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent_status', status: 'completed' }),
    ]))
    expect(idleEvents).toEqual([
      expect.objectContaining({ type: 'agent_status', status: 'completed' }),
    ])
  })

  it('retracts superseded Claude messages before rendering a fallback replacement', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1' }
    const refusedEvents = mapSDKMessageToEvents({
      type: 'assistant', uuid: 'assistant-refused', session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'stale partial' }] },
    }, ctx)
    const replacementEvents = mapSDKMessageToEvents({
      type: 'assistant', uuid: 'assistant-fallback', session_id: 'sdk-session',
      parent_tool_use_id: null, supersedes: ['assistant-refused'],
      message: { role: 'assistant', content: [{ type: 'text', text: 'canonical answer' }] },
    }, ctx)

    expect(replacementEvents[0]).toEqual(expect.objectContaining({
      type: 'transcript_retraction',
      eventIds: expect.arrayContaining(refusedEvents.map((event) => event.id)),
    }))
  })

  it('keeps SDK tool result names and emits file changes for write tools', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById: new Map<string, string>() }
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'Edit',
          input: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
        }],
      },
    }
    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Updated src/index.ts',
        }],
      },
    }

    const toolCallEvents = mapSDKMessageToEvents(assistant, ctx)
    const resultEvents = mapSDKMessageToEvents(user, ctx)

    expect(toolCallEvents).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'edit_file',
        toolInput: expect.objectContaining({ file_path: 'src/index.ts' }),
      }),
    ])
    expect(resultEvents).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'tool-1',
        toolName: 'edit_file',
        status: 'success',
      }),
      expect.objectContaining({
        type: 'file_change',
        changeType: 'modify',
        path: 'src/index.ts',
      }),
    ])
  })

  it('routes extended Claude content blocks through the public message mapper', () => {
    const events = mapSDKMessageToEvents({
      type: 'assistant',
      uuid: 'assistant-extended',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'search-1', name: 'web_search', input: { query: 'Spark Agent' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'search-1',
            content: [{ type: 'web_search_result', title: 'Spark', url: 'https://example.com' }],
          },
        ],
      },
    }, { sessionId: 'session-1', turnId: 'turn-1', toolNamesById: new Map() })

    expect(events).toEqual([
      expect.objectContaining({ type: 'tool_call', toolCallId: 'search-1', toolName: 'web_search' }),
      expect.objectContaining({ type: 'tool_result', toolCallId: 'search-1', toolName: 'web_search' }),
    ])
  })

  it('redacts encrypted payloads nested inside regular tool results', () => {
    const secret = 'nested-encrypted-secret'
    const events = mapSDKMessageToEvents({
      type: 'user',
      uuid: 'user-encrypted-result',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [{
            type: 'code_execution_tool_result',
            tool_use_id: 'nested-code-1',
            content: {
              type: 'encrypted_code_execution_result',
              encrypted_stdout: secret,
              stderr: '',
              return_code: 0,
              content: [],
            },
          }],
        }],
      },
    }, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(JSON.stringify(events)).not.toContain(secret)
    expect(events).toEqual([
      expect.objectContaining({ type: 'tool_result', output: expect.stringContaining('[redacted]') }),
    ])
  })

  it('maps SDK result checkpoint metadata', () => {
    const result: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      uuid: 'result-1',
      session_id: 'sdk-session',
      duration_ms: 10,
      duration_api_ms: 5,
      is_error: false,
      num_turns: 1,
      result: 'done',
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      checkpoint: {
        checkpoint_id: 'chk_123',
        label: 'Before edits',
        file_paths: ['src/index.ts'],
      },
    }

    const events = mapSDKMessageToEvents(result, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'checkpoint',
        checkpointId: 'chk_123',
        label: 'Before edits',
        filePaths: ['src/index.ts'],
      }),
    ]))
  })

  it('emits subagent_started when Agent tool_use is encountered', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById: new Map<string, string>() }
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-1',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Finds bugs', prompt: 'Search for null pointer issues' },
        }],
      },
    }

    const events = mapSDKMessageToEvents(assistant, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'agent-tool-1',
        name: 'Researcher',
        role: 'Finds bugs',
        task: 'Search for null pointer issues',
      }),
    ])
  })

  it('emits subagent_completed when subagent tool_result is received', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-1', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    // First, register the input via a prior assistant message (simulates toolInputs map)
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-1',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Finds bugs', prompt: 'Search for null pointer issues' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-1',
          content: 'Found 3 null pointer issues in auth module.',
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-1',
        name: 'Researcher',
        status: 'success',
        resultSummary: 'Found 3 null pointer issues in auth module.',
        output: 'Found 3 null pointer issues in auth module.',
      }),
    ])
  })

  it('keeps async subagent launch metadata from completing the subagent card', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-bg', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-bg',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Finds bugs', prompt: 'Search broadly' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-bg',
          content: [
            'Async agent launched successfully. (This tool result is internal metadata.)',
            'agentId: agent-bg-1',
            'The agent is working in the background. You will be notified automatically when it completes.',
            'output_file: /tmp/task.output',
          ].join('\n'),
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events).toEqual([])

    const sendMessage: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-send',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'send-message-1',
          name: 'SendMessage',
          input: { to: 'agent-bg-1', summary: 'collect findings' },
        }],
      },
    }
    mapSDKMessageToEvents(sendMessage, ctx)

    const sendMessageResult: SDKUserMessage = {
      type: 'user',
      uuid: 'user-send-result',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'send-message-1',
          content: 'The background agent found the root cause.',
        }],
      },
    }

    const completed = mapSDKMessageToEvents(sendMessageResult, ctx)

    expect(completed).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-bg',
        name: 'Researcher',
        status: 'success',
        output: 'The background agent found the root cause.',
      }),
    ])
  })

  it('accumulates subagent token usage from parent_tool_use_id messages and attaches to subagent_completed', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-usage', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    // Main agent spawns the subagent
    const spawn: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-spawn',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-usage',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Find news', prompt: 'Search news' },
        }],
      },
    }
    mapSDKMessageToEvents(spawn, ctx)

    // Subagent emits two internal assistant messages (each carries parent_tool_use_id + usage)
    const inner1: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'inner-1',
      session_id: 'sdk-session',
      parent_tool_use_id: 'agent-tool-usage',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'searching...' }],
        usage: { input_tokens: 1200, output_tokens: 80 },
      },
    }
    const inner2: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'inner-2',
      session_id: 'sdk-session',
      parent_tool_use_id: 'agent-tool-usage',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'summarizing...' }],
        usage: { input_tokens: 800, output_tokens: 120 },
      },
    }
    mapSDKMessageToEvents(inner1, ctx)
    mapSDKMessageToEvents(inner2, ctx)

    // tool_result returns to main agent
    const result: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-usage',
          content: 'Headlines: A, B, C',
        }],
      },
    }
    const events = mapSDKMessageToEvents(result, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-usage',
        name: 'Researcher',
        status: 'success',
        inputTokens: 2000,
        outputTokens: 200,
      }),
    ])
  })

  it('emits subagent_completed with error status on failed tool_result', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-2', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-2',
          name: 'Agent',
          input: { agent: 'Writer', description: 'Writes docs', prompt: 'Write README' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-2',
          content: 'Permission denied',
          is_error: true,
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-2',
        name: 'Writer',
        status: 'error',
        resultSummary: 'Permission denied',
        output: 'Permission denied',
      }),
    ])
  })

  it('truncates long subagent output in resultSummary', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-3', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-3',
          name: 'Agent',
          input: { agent: 'Analyst', description: 'Deep analysis', prompt: 'Analyze all files' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const longOutput = 'x'.repeat(300)
    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-3',
          content: longOutput,
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        resultSummary: `${'x'.repeat(197)}...`,
        output: longOutput,
      }),
    )
  })

  it('maps ExitPlanMode tool input to a plan proposal event', () => {
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'ExitPlanMode',
          input: { plan: '# Plan\n\n1. Do the thing' },
        }],
      },
    }

    const events = mapSDKMessageToEvents(assistant, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'plan_proposed',
        plan: '# Plan\n\n1. Do the thing',
      }),
    ])
  })

  it('collapses identical ExitPlanMode retries within one turn', () => {
    const ctx = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }
    const exitPlan = (uuid: string, toolId: string, plan: string): SDKAssistantMessage => ({
      type: 'assistant',
      uuid,
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolId, name: 'ExitPlanMode', input: { plan } }],
      },
    })

    const first = mapSDKMessageToEvents(exitPlan('assistant-1', 'tool-1', '# Plan'), ctx)
    const duplicate = mapSDKMessageToEvents(exitPlan('assistant-2', 'tool-2', '# Plan'), ctx)
    const revision = mapSDKMessageToEvents(exitPlan('assistant-3', 'tool-3', '# Revised plan'), ctx)

    expect(first).toEqual([expect.objectContaining({ type: 'plan_proposed', plan: '# Plan' })])
    expect(duplicate).toEqual([])
    expect(revision).toEqual([
      expect.objectContaining({ type: 'plan_proposed', plan: '# Revised plan' }),
    ])
  })

  it('falls back to the plan-file Write content when ExitPlanMode has no plan in input', () => {
    // 新版 CLI 计划模式：agent 先 Write 计划到 .claude/plans/*.md，ExitPlanMode
    // 的 input 不再带 plan 文本。event-mapper 应追踪这次写入，在 ExitPlanMode
    // 到来时把文件内容作为 plan 文本发出。
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById: new Map<string, string>() }

    const planWrite: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-write',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-write',
          name: 'Write',
          input: {
            file_path: '/home/u/.claude/plans/abc-plan.md',
            content: '# Plan from file\n\n1. Read code\n2. Add tests',
          },
        }],
      },
    }
    // 先处理 Write（建立 plan 文件追踪），再处理 ExitPlanMode
    mapSDKMessageToEvents(planWrite, ctx)

    const exitPlan: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-exit',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-exit',
          name: 'ExitPlanMode',
          input: { allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] },
        }],
      },
    }
    const events = mapSDKMessageToEvents(exitPlan, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'plan_proposed',
        plan: '# Plan from file\n\n1. Read code\n2. Add tests',
      }),
    ])
  })
})
