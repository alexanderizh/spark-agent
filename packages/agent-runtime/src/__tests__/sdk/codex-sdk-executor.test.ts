import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CodexSdkExecutor } from '../../sdk/codex-sdk-executor.js'
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
          ...('isFinal' in event ? { isFinal: event.isFinal } : {}),
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(codexCtor).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-test',
      config: expect.objectContaining({
        hide_agent_reasoning: false,
        mcp_servers: expect.objectContaining({
          spark_search: expect.objectContaining({ command: 'node' }),
        }),
      }),
    }))
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5-codex',
      workingDirectory: process.cwd(),
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    }))
    expect(runStreamed).toHaveBeenCalledWith(
      expect.stringContaining('Skill catalog'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(events).toEqual(expect.arrayContaining([
      { type: 'agent_thinking', content: 'Thinking' },
      { type: 'tool_call', toolName: 'bash' },
      { type: 'terminal_output', data: 'ok\n', isFinal: false },
      { type: 'terminal_output', data: '', isFinal: true },
      { type: 'tool_call', toolName: 'mcp__spark_search__web_search' },
      { type: 'file_change', path: 'src/app.ts' },
      { type: 'assistant_message', content: 'Hel', isFinal: false },
      { type: 'assistant_message', content: 'lo', isFinal: false },
      { type: 'assistant_message', content: 'Hello', isFinal: true },
      { type: 'usage_update', inputTokens: 10 },
    ]))
  })

  it('maps auto-review permission mode to the supported interactive approval policy', async () => {
    runStreamed.mockResolvedValue({ events: streamFrom([]) })

    const executor = new CodexSdkExecutor()
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig({ permissionMode: 'codex-auto-review' }))

    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({
      approvalPolicy: 'on-request',
    }))
  })

  it('suppresses non-fatal SDK warning and reconnect noise while preserving output', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        {
          type: 'item.completed',
          item: {
            id: 'warn-1',
            type: 'error',
            message: 'Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter.',
          },
        },
        {
          type: 'error',
          message: 'Reconnecting... 2/5 (unexpected status 404 Not Found: endpoint not supported, url: ws://localhost:59538/v1/responses)',
        },
        {
          type: 'item.completed',
          item: {
            id: 'transport-fallback-1',
            type: 'error',
            message: 'Falling back from WebSockets to HTTPS transport. unexpected status 404 Not Found: endpoint not supported, url: ws://localhost:59538/v1/responses',
          },
        },
        { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Still works' } },
      ]),
    })

    const events: Array<{ type: string; code?: string; content?: string }> = []
    const executor = new CodexSdkExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_error') events.push({ type: event.type, code: event.code })
      if (event.type === 'assistant_message') events.push({ type: event.type, content: event.content })
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { type: 'assistant_message', content: 'Still works' },
      { type: 'assistant_message', content: 'Still works' },
    ])
  })

  it('keeps reporting unknown SDK stream errors', async () => {
    runStreamed.mockResolvedValue({
      events: streamFrom([
        { type: 'error', message: 'Unexpected stream failure' },
      ]),
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
})
