import { delimiter, sep } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CodexSdkExecutor, resolveBundledCodexCli } from '../../sdk/codex-sdk-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

const codexCtor = vi.hoisted(() => vi.fn())
const startThread = vi.hoisted(() => vi.fn())
const resumeThread = vi.hoisted(() => vi.fn())
const runStreamed = vi.hoisted(() => vi.fn())

vi.mock('@openai/codex-sdk', () => ({
  Codex: codexCtor.mockImplementation(() => ({
    startThread,
    resumeThread,
  })),
}))

async function* streamFrom(events: unknown[]) {
  for (const event of events) yield event
}

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: 'sk-test',
    model: 'gpt-5-codex',
    workspaceRootPath: process.cwd(),
    permissionMode: 'codex-default',
    systemPrompt: 'System context',
    skillSystemPrompt: 'Skill catalog',
    mcpServers: {
      spark_search: {
        type: 'stdio',
        command: 'node',
        args: ['search-server.js'],
      },
    },
    ...overrides,
  }
}

describe('CodexSdkExecutor', () => {
  beforeEach(() => {
    codexCtor.mockClear()
    startThread.mockReset()
    resumeThread.mockReset()
    runStreamed.mockReset()
    startThread.mockReturnValue({ runStreamed })
  })

  it('streams Codex SDK reasoning, command, MCP, file, usage, and final text events', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'item.updated', item: { id: 'reason-1', type: 'reasoning', text: 'Thinking' } },
        {
          type: 'item.started',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'npm test',
            aggregated_output: '',
            status: 'in_progress',
          },
        },
        {
          type: 'item.updated',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'npm test',
            aggregated_output: 'ok\n',
            status: 'in_progress',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'npm test',
            aggregated_output: 'ok\n',
            exit_code: 0,
            status: 'completed',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'mcp-1',
            type: 'mcp_tool_call',
            server: 'spark_search',
            tool: 'web_search',
            arguments: { query: 'codex' },
            result: { content: [], structured_content: { ok: true } },
            status: 'completed',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'patch-1',
            type: 'file_change',
            changes: [{ path: 'src/app.ts', kind: 'update' }],
            status: 'completed',
          },
        },
        { type: 'item.updated', item: { id: 'msg-1', type: 'agent_message', text: 'Hel' } },
        { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Hello' } },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 10,
            cached_input_tokens: 2,
            output_tokens: 4,
            reasoning_output_tokens: 1,
          },
        },
      ]),
    })

    const events: Array<{
      type: string
      content?: string
      toolName?: string
      data?: string
      path?: string
      inputTokens?: number
      cacheHitTokens?: number
      reasoningOutputTokens?: number
      isFinal?: boolean
    }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (
        event.type === 'agent_thinking' ||
        event.type === 'assistant_message' ||
        event.type === 'tool_call' ||
        event.type === 'terminal_output' ||
        event.type === 'file_change' ||
        event.type === 'usage_update'
      ) {
        events.push({
          type: event.type,
          ...('content' in event ? { content: event.content } : {}),
          ...('toolName' in event ? { toolName: event.toolName } : {}),
          ...('data' in event ? { data: event.data } : {}),
          ...('path' in event ? { path: event.path } : {}),
          ...('inputTokens' in event ? { inputTokens: event.inputTokens } : {}),
          ...('cacheHitTokens' in event ? { cacheHitTokens: event.cacheHitTokens } : {}),
          ...('reasoningOutputTokens' in event
            ? { reasoningOutputTokens: event.reasoningOutputTokens }
            : {}),
          ...('isFinal' in event ? { isFinal: event.isFinal } : {}),
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(codexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        config: expect.objectContaining({
          hide_agent_reasoning: false,
          mcp_servers: expect.objectContaining({
            spark_search: expect.objectContaining({
              command: 'node',
              default_tools_approval_mode: 'approve',
            }),
          }),
        }),
      }),
    )
    const bundledCodex = resolveBundledCodexCli()
    if (bundledCodex != null) {
      const codexOptions = codexCtor.mock.calls[0]?.[0]
      const pathKey =
        process.platform === 'win32' && codexOptions.env.Path != null ? 'Path' : 'PATH'
      expect(codexOptions).toEqual(
        expect.objectContaining({
          codexPathOverride: bundledCodex.executablePath,
        }),
      )
      expect(codexOptions.env[pathKey].split(delimiter)[0]).toBe(bundledCodex.pathDirs[0])
    }
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-codex',
        workingDirectory: process.cwd(),
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
        webSearchEnabled: false,
      }),
    )
    expect(runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('Skill catalog'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'agent_thinking', content: 'Thinking' },
        { type: 'tool_call', toolName: 'bash' },
        { type: 'terminal_output', data: 'ok\n', isFinal: false },
        { type: 'terminal_output', data: '', isFinal: true },
        { type: 'tool_call', toolName: 'mcp__spark_search__web_search' },
        { type: 'file_change', path: 'src/app.ts' },
        { type: 'assistant_message', content: 'Hel', isFinal: false },
        { type: 'assistant_message', content: 'lo', isFinal: false },
        { type: 'assistant_message', content: 'Hello', isFinal: true },
        {
          type: 'usage_update',
          inputTokens: 10,
          cacheHitTokens: 2,
          reasoningOutputTokens: 1,
        },
      ]),
    )
  })

  it('maps Spark max reasoning to Codex SDK xhigh effort', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    await new CodexSdkExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ reasoningEffort: 'max' }),
    )

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        modelReasoningEffort: 'xhigh',
      }),
    )
  })

  it('maps Spark minimal reasoning to Codex SDK low effort', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    await new CodexSdkExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ reasoningEffort: 'minimal' }),
    )

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        modelReasoningEffort: 'low',
      }),
    )
  })

  it('passes explicit network and web search controls to Codex threads', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    await new CodexSdkExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        networkAccessEnabled: true,
        webSearchMode: 'cached',
        webSearchEnabled: true,
      }),
    )

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        networkAccessEnabled: true,
        webSearchMode: 'cached',
        webSearchEnabled: true,
      }),
    )
  })

  it('forwards explicit Codex SDK compaction events without synthesizing them', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        {
          type: 'turn.compacted',
          summary: 'Real Codex compaction summary',
          pre_compaction_tokens: 120000,
          post_compaction_tokens: 42000,
        },
      ]),
    })

    const events: Array<{
      type: string
      provider?: string
      source?: string
      phase?: string
      summary?: string
      preTokens?: number
      postTokens?: number
    }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'context_compaction') events.push(event)
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      expect.objectContaining({
        type: 'context_compaction',
        provider: 'codex',
        source: 'codex_sdk',
        phase: 'completed',
        summary: 'Real Codex compaction summary',
        preTokens: 120000,
        postTokens: 42000,
      }),
    ])
  })

  it('maps auto-review permission mode to the supported interactive approval policy', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    const executor = new CodexSdkExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ permissionMode: 'codex-auto-review' }),
    )

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: 'on-request',
      }),
    )
  })

  it('maps HTTP MCP bearer auth to Codex config env without putting the token in config', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    const executor = new CodexSdkExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        mcpServers: {
          spark_team: {
            type: 'http',
            url: 'http://127.0.0.1:1234/mcp',
            headers: {
              Authorization: 'Bearer team-secret',
              'X-Spark-Test': 'ok',
            },
          },
        },
      }),
    )

    expect(codexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          mcp_servers: {
            spark_team: {
              url: 'http://127.0.0.1:1234/mcp',
              default_tools_approval_mode: 'approve',
              bearer_token_env_var: 'SPARK_MCP_SPARK_TEAM_BEARER_TOKEN',
              http_headers: {
                'X-Spark-Test': 'ok',
              },
            },
          },
        }),
        env: expect.objectContaining({
          SPARK_MCP_SPARK_TEAM_BEARER_TOKEN: 'team-secret',
        }),
      }),
    )
    expect(JSON.stringify(codexCtor.mock.calls[0]?.[0]?.config)).not.toContain('team-secret')
    expect(JSON.stringify(codexCtor.mock.calls[0]?.[0]?.config)).not.toContain('Authorization')
  })

  it('passes OpenAI-compatible provider config to Codex SDK model providers', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    await new CodexSdkExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        apiKey: 'sk-third-party',
        apiEndpoint: 'https://provider.example.com/v1',
        model: 'provider-coder',
        codexApiKind: 'chat',
        codexCliProvider: {
          id: 'provider-coder',
          name: 'Provider Coder',
          baseUrl: 'https://provider.example.com/v1/',
          wireApi: 'chat',
          envKey: 'SPARK_CODEX_API_KEY_PROVIDER',
          env: { SPARK_CODEX_API_KEY_PROVIDER: 'sk-third-party' },
        },
      }),
    )

    expect(codexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-third-party',
        baseUrl: 'https://provider.example.com/v1',
        config: expect.objectContaining({
          model_provider: 'provider-coder',
          model_providers: {
            'provider-coder': {
              name: 'Provider Coder',
              base_url: 'https://provider.example.com/v1',
              wire_api: 'chat',
              env_key: 'SPARK_CODEX_API_KEY_PROVIDER',
            },
          },
        }),
        env: expect.objectContaining({
          SPARK_CODEX_API_KEY_PROVIDER: 'sk-third-party',
        }),
      }),
    )
    expect(JSON.stringify(codexCtor.mock.calls[0]?.[0]?.config)).not.toContain('sk-third-party')
  })

  it('uses a non-interactive approval policy for unattended automation turns', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    const executor = new CodexSdkExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ permissionMode: 'codex-auto-review', unattended: true }),
    )

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
      }),
    )
  })

  it('suppresses non-fatal SDK warning and reconnect noise while preserving output', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        {
          type: 'item.completed',
          item: {
            id: 'warn-1',
            type: 'error',
            message:
              'Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter.',
          },
        },
        {
          type: 'error',
          message:
            'Reconnecting... 2/5 (unexpected status 404 Not Found: endpoint not supported, url: ws://localhost:59538/v1/responses)',
        },
        {
          type: 'item.completed',
          item: {
            id: 'transport-fallback-1',
            type: 'error',
            message:
              'Falling back from WebSockets to HTTPS transport. unexpected status 404 Not Found: endpoint not supported, url: ws://localhost:59538/v1/responses',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'metadata-warning-1',
            type: 'error',
            message:
              'Model metadata for `glm-5.2` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'service-tier-warning-1',
            type: 'error',
            message:
              'Configured service tier `priority` is not advertised as supported for model `glm-5.2` and will be omitted from requests.',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'event-stream-lag-1',
            type: 'error',
            message: 'in-process app-server event stream lagged; dropped 6 events',
          },
        },
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'Still works' },
        },
      ]),
    })

    const events: Array<{ type: string; code?: string; content?: string }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_error') events.push({ type: event.type, code: event.code })
      if (event.type === 'assistant_message')
        events.push({ type: event.type, content: event.content })
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { type: 'assistant_message', content: 'Still works' },
      { type: 'assistant_message', content: 'Still works' },
      { type: 'assistant_message', content: 'Still works' },
    ])
  })

  it('emits complete events for each Codex SDK assistant segment and a full final result', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        { type: 'item.updated', item: { id: 'msg-1', type: 'agent_message', text: 'First' } },
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'First answer' },
        },
        {
          type: 'item.completed',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'pwd',
            aggregated_output: '/repo\n',
            exit_code: 0,
            status: 'completed',
          },
        },
        { type: 'item.updated', item: { id: 'msg-2', type: 'agent_message', text: 'Second' } },
        {
          type: 'item.completed',
          item: { id: 'msg-2', type: 'agent_message', text: 'Second answer' },
        },
      ]),
    })

    const events: Array<{
      mode: string
      content: string
      isFinal: boolean
      segmentId?: string
    }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          mode: event.mode,
          content: event.content,
          isFinal: event.isFinal,
          ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { mode: 'delta', content: 'First', isFinal: false, segmentId: 'codex-sdk-turn-1-text-1' },
      {
        mode: 'delta',
        content: ' answer',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      {
        mode: 'complete',
        content: 'First answer',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      { mode: 'delta', content: 'Second', isFinal: false, segmentId: 'codex-sdk-turn-1-text-2' },
      {
        mode: 'delta',
        content: ' answer',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-2',
      },
      {
        mode: 'complete',
        content: 'Second answer',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-2',
      },
      {
        mode: 'complete',
        content: 'First answer\n\nSecond answer',
        isFinal: true,
        segmentId: 'codex-sdk-turn-1',
      },
    ])
  })

  it('streams raw Codex SDK text deltas without duplicating the completed item snapshot', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        { type: 'response.output_text.delta', delta: 'Hel' },
        { type: 'response.output_text.delta', delta: 'lo' },
        {
          type: 'item.completed',
          item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
        },
      ]),
    })

    const events: Array<{ mode: string; content: string; isFinal: boolean; segmentId?: string }> =
      []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          mode: event.mode,
          content: event.content,
          isFinal: event.isFinal,
          ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { mode: 'delta', content: 'Hel', isFinal: false, segmentId: 'codex-sdk-turn-1-text-1' },
      { mode: 'delta', content: 'lo', isFinal: false, segmentId: 'codex-sdk-turn-1-text-1' },
      {
        mode: 'complete',
        content: 'Hello',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      {
        mode: 'complete',
        content: 'Hello',
        isFinal: true,
        segmentId: 'codex-sdk-turn-1',
      },
    ])
  })

  it('finalizes raw Codex SDK deltas when no agent_message item follows', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        { type: 'response.output_text.delta', delta: 'Only ' },
        { type: 'response.output_text.delta', delta: 'delta' },
      ]),
    })

    const events: Array<{ mode: string; content: string; isFinal: boolean; segmentId?: string }> =
      []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          mode: event.mode,
          content: event.content,
          isFinal: event.isFinal,
          ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      {
        mode: 'delta',
        content: 'Only ',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      {
        mode: 'delta',
        content: 'delta',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      {
        mode: 'complete',
        content: 'Only delta',
        isFinal: true,
        segmentId: 'codex-sdk-turn-1',
      },
    ])
  })

  it('finalizes partial text before reporting an aborted SDK stream', async () => {
    async function* abortedStream() {
      yield { type: 'response.output_text.delta', delta: 'partial Codex answer' }
      throw new Error('stream aborted')
    }
    runStreamed.mockResolvedValue({ events: abortedStream() })

    const events: Array<{
      type: string
      mode?: string
      content?: string
      code?: string
      status?: string
      segmentId?: string
    }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          type: event.type,
          mode: event.mode,
          content: event.content,
          ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
        })
        if (event.mode === 'delta') executor.cancel()
      } else if (event.type === 'agent_error') {
        events.push({ type: event.type, code: event.code })
      } else if (event.type === 'agent_status') {
        events.push({ type: event.type, status: event.status })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    const completedIndex = events.findIndex(
      (event) => event.type === 'assistant_message' && event.mode === 'complete',
    )
    const errorIndex = events.findIndex((event) => event.code === 'CODEX_SDK_CANCELLED')
    const cancelledIndex = events.findIndex((event) => event.status === 'cancelled')
    expect(events[completedIndex]).toEqual(
      expect.objectContaining({
        content: 'partial Codex answer',
        segmentId: 'codex-sdk-turn-1-text-1',
      }),
    )
    expect(completedIndex).toBeGreaterThan(-1)
    expect(completedIndex).toBeLessThan(errorIndex)
    expect(errorIndex).toBeLessThan(cancelledIndex)
  })

  it('starts a new Codex SDK assistant segment after a tool even if item id is reused', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        {
          type: 'item.completed',
          item: { id: 'msg-reused', type: 'agent_message', text: 'Before tool' },
        },
        {
          type: 'item.completed',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: 'pwd',
            aggregated_output: '/repo\n',
            exit_code: 0,
            status: 'completed',
          },
        },
        {
          type: 'item.completed',
          item: { id: 'msg-reused', type: 'agent_message', text: 'After tool' },
        },
      ]),
    })

    const events: Array<{ mode: string; content: string; isFinal: boolean; segmentId?: string }> =
      []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          mode: event.mode,
          content: event.content,
          isFinal: event.isFinal,
          ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      {
        mode: 'delta',
        content: 'Before tool',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      {
        mode: 'complete',
        content: 'Before tool',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-1',
      },
      {
        mode: 'delta',
        content: 'After tool',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-2',
      },
      {
        mode: 'complete',
        content: 'After tool',
        isFinal: false,
        segmentId: 'codex-sdk-turn-1-text-2',
      },
      {
        mode: 'complete',
        content: 'Before tool\n\nAfter tool',
        isFinal: true,
        segmentId: 'codex-sdk-turn-1',
      },
    ])
  })

  it('keeps reporting unknown SDK stream errors', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([{ type: 'error', message: 'Unexpected stream failure' }]),
    })

    const events: Array<{ type: string; code?: string; message?: string }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_error') {
        events.push({ type: event.type, code: event.code, message: event.message })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { type: 'agent_error', code: 'CODEX_SDK_STREAM_ERROR', message: 'Unexpected stream failure' },
    ])
  })

  it('resumes an existing Codex SDK thread when sdkSessionId is available', async () => {
    resumeThread.mockReturnValue({ runStreamed })
    runStreamed.mockResolvedValue({
      events: streamFrom([
        { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Done' } },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
          },
        },
      ]),
    })

    const executor = new CodexSdkExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'continue',
      makeConfig({ sdkSessionId: 'codex-thread-1', continueSession: true }),
    )

    expect(resumeThread).toHaveBeenCalledWith(
      'codex-thread-1',
      expect.objectContaining({ model: 'gpt-5-codex' }),
    )
    expect(startThread).not.toHaveBeenCalled()
  })

  it('resolves packaged Codex CLI binaries from app.asar.unpacked', async () => {
    vi.resetModules()
    const fakeNodeModules = `${process.platform === 'win32' ? 'C:' : ''}${sep}Spark${sep}resources${sep}app.asar${sep}node_modules`
    const packagePath = (specifier: string) =>
      `${fakeNodeModules}${sep}${specifier.split('/').join(sep)}`
    const resolveForSpecifier = (specifier: string): string => {
      if (specifier === '@openai/codex/package.json') return packagePath(specifier)
      if (specifier.startsWith('@openai/codex-') && specifier.endsWith('/package.json')) {
        return packagePath(specifier)
      }
      throw new Error(`unexpected resolve: ${specifier}`)
    }
    const createRequireMock = vi.fn(() => ({
      resolve: resolveForSpecifier,
    }))
    const existsSyncMock = vi.fn((filePath: string) => {
      return (
        filePath.includes(`${sep}bin${sep}`) ||
        filePath.endsWith(`${sep}codex-package.json`) ||
        filePath.endsWith(`${sep}codex-path`)
      )
    })
    vi.doMock('node:module', () => ({ createRequire: createRequireMock }))
    vi.doMock('node:fs', () => ({ existsSync: existsSyncMock }))

    const { resolveBundledCodexCli: resolvePackagedCodexCli } =
      await import('../../sdk/codex-sdk-executor.js')
    const resolved = resolvePackagedCodexCli()

    expect(resolved?.executablePath).toContain(`app.asar.unpacked${sep}node_modules`)
    expect(resolved?.executablePath).not.toContain(`app.asar${sep}node_modules`)
    expect(resolved?.pathDirs[0]).toContain(`app.asar.unpacked${sep}node_modules`)

    vi.doUnmock('node:module')
    vi.doUnmock('node:fs')
    vi.resetModules()
  })
})
