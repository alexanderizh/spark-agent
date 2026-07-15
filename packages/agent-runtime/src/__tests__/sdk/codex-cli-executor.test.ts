import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { CodexCliExecutor } from '../../sdk/codex-cli-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

const spawnMock = vi.hoisted(() => vi.fn())
let codexHome: string
let previousCodexHome: string | undefined
let lastProfileConfig = ''

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
  prompt = ''

  constructor(
    public readonly args: string[],
    private readonly outputLines = ['{"type":"message","message":"working"}'],
  ) {
    super()
    captureSpawnProfileConfig(args)
    this.stdin = Object.assign(new EventEmitter(), {
      end: vi.fn((prompt: string) => {
        this.prompt = prompt
        const outputFile = this.args[this.args.indexOf('--output-last-message') + 1]
        if (outputFile == null) throw new Error('missing --output-last-message path')
        writeFileSync(outputFile, 'OK from Codex CLI')
        for (const line of this.outputLines) {
          this.stdout.emit('data', Buffer.from(`${line}\n`))
        }
        this.emit('close', 0)
      }),
    })
  }

  kill = vi.fn()
}

class MissingCommandProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }

  constructor() {
    super()
    this.stdin = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        const err = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        this.emit('error', err)
        this.emit('close', 1)
      }),
    })
  }

  kill = vi.fn()
}

class StdinErrorProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }

  constructor() {
    super()
    this.stdin = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        const err = new Error('write EOF') as NodeJS.ErrnoException
        err.code = 'EOF'
        this.stdin.emit('error', err)
        this.emit('close', 1)
      }),
    })
  }

  kill = vi.fn()
}

class FailedCodexProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }

  constructor(
    private readonly stdoutLines: string[],
    private readonly stderrText: string,
  ) {
    super()
    this.stdin = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        for (const line of this.stdoutLines) {
          this.stdout.emit('data', Buffer.from(`${line}\n`))
        }
        this.stderr.emit('data', Buffer.from(this.stderrText))
        this.emit('close', 1)
      }),
    })
  }

  kill = vi.fn()
}

class CancellableCodexProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }

  constructor() {
    super()
    this.stdin = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        this.stdout.emit(
          'data',
          Buffer.from('{"type":"response.output_text.delta","delta":"partial CLI answer"}\n'),
        )
      }),
    })
  }

  kill = vi.fn(() => {
    this.emit('close', 143)
    return true
  })
}

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: '',
    useLocalConfig: true,
    model: 'codex cli',
    workspaceRootPath: process.cwd(),
    permissionMode: 'codex-default',
    systemPrompt: 'System context',
    skillSystemPrompt: 'Skill catalog',
    mcpServers: {
      local_tools: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { TEST_TOKEN: 'secret' },
      },
      in_process: {
        type: 'sdk',
        name: 'spark_team',
        instance: {},
      },
    },
    ...overrides,
  }
}

function readSpawnProfileConfig(args: string[]): string {
  const profileName = args[args.indexOf('-p') + 1]
  if (profileName == null) return ''
  return readFileSync(path.join(codexHome, `${profileName}.config.toml`), 'utf8')
}

function captureSpawnProfileConfig(args: string[]): void {
  lastProfileConfig = readSpawnProfileConfig(args)
}

describe('CodexCliExecutor', () => {
  beforeEach(() => {
    previousCodexHome = process.env.CODEX_HOME
    codexHome = mkdtempSync(path.join(tmpdir(), 'spark-codex-test-'))
    process.env.CODEX_HOME = codexHome
    lastProfileConfig = ''
    spawnMock.mockReset()
  })

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = previousCodexHome
    }
    rmSync(codexHome, { recursive: true, force: true })
  })

  it('runs local Codex CLI without passing the placeholder model name', async () => {
    let child: MockChildProcess | undefined
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      child = new MockChildProcess(args)
      return child
    })

    const executor = new CodexCliExecutor()
    await executor.executeTurn('session-1', 'turn-1', '只回复 OK', makeConfig())

    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'codex.exe' : 'codex',
      expect.arrayContaining(['exec', '--json', '--output-last-message', '-C']),
      expect.objectContaining({
        cwd: process.cwd(),
        shell: false,
      }),
    )
    const args = spawnMock.mock.calls[0]?.[1] as string[]
    expect(args).not.toContain('--model')
    expect(args).not.toContain('codex cli')
    expect(child?.prompt).toContain('# Spark Skills')
    expect(child?.prompt).toContain('Skill catalog')
    expect(child?.prompt).toContain('# Spark Runtime Context')
    expect(child?.prompt).toContain('System context')
    expect(lastProfileConfig).toContain('sandbox_workspace_write.network_access=false')
    expect(lastProfileConfig).toContain("web_search='disabled'")
  })

  it('does not spawn Codex when cancelled during async preparation', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))
    const executor = new CodexCliExecutor()

    const execution = executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())
    executor.cancel()
    await execution

    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('forces non-interactive Codex CLI execution for unattended automation turns', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ permissionMode: 'codex-auto-review', unattended: true }),
    )

    const args = spawnMock.mock.calls[0]?.[1] as string[]
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args).not.toContain('--sandbox')
  })

  it('maps Spark max reasoning to Codex CLI xhigh effort', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ reasoningEffort: 'max' }),
    )

    expect(lastProfileConfig).toContain("model_reasoning_effort='xhigh'")
  })

  it('maps Spark minimal reasoning to Codex CLI low effort', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({ reasoningEffort: 'minimal' }),
    )

    expect(lastProfileConfig).toContain("model_reasoning_effort='low'")
  })

  it('keeps reasoning visible and writes explicit network controls without an effort override', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    await new CodexCliExecutor().executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        networkAccessEnabled: true,
        webSearchMode: 'cached',
        webSearchEnabled: true,
      }),
    )

    expect(lastProfileConfig).toContain("model_reasoning_summary='concise'")
    expect(lastProfileConfig).toContain('show_raw_agent_reasoning=true')
    expect(lastProfileConfig).toContain('hide_agent_reasoning=false')
    expect(lastProfileConfig).toContain('sandbox_workspace_write.network_access=true')
    expect(lastProfileConfig).toContain("web_search='cached'")
  })

  it('maps CLI file, todo, item error, cache, and reasoning usage with SDK semantics', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"item.completed","item":{"id":"patch-1","type":"file_change","changes":[{"path":"src/new.ts","kind":"add"},{"path":"src/old.ts","kind":"delete"}],"status":"completed"}}',
          '{"type":"item.updated","item":{"id":"todo-1","type":"todo_list","items":[{"text":"Ship parity","completed":false}]}}',
          '{"type":"item.completed","item":{"id":"err-1","type":"error","message":"tool stream broke"}}',
          '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":7,"output_tokens":9,"reasoning_output_tokens":4}}',
        ]),
    )

    const events: AgentEvent[] = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (
        event.type === 'file_change' ||
        event.type === 'tool_call' ||
        event.type === 'tool_result' ||
        event.type === 'agent_error' ||
        event.type === 'usage_update'
      ) {
        events.push(event)
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'file_change', path: 'src/new.ts', changeType: 'create' }),
        expect.objectContaining({ type: 'file_change', path: 'src/old.ts', changeType: 'delete' }),
        expect.objectContaining({ type: 'tool_call', toolCallId: 'todo-1', toolName: 'todo_write' }),
        expect.objectContaining({ type: 'tool_result', toolCallId: 'todo-1', status: 'success' }),
        expect.objectContaining({
          type: 'agent_error',
          code: 'CODEX_CLI_ITEM_ERROR',
          message: 'tool stream broke',
        }),
        expect.objectContaining({
          type: 'usage_update',
          inputTokens: 20,
          outputTokens: 9,
          cacheHitTokens: 7,
          reasoningOutputTokens: 4,
        }),
      ]),
    )
  })

  it('falls back to Windows Codex CLI shim candidates when the first command is missing', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      spawnMock.mockImplementation((command: string, args: string[]) => {
        if (command === 'codex.exe') return new MissingCommandProcess()
        return new MockChildProcess(args)
      })

      const executor = new CodexCliExecutor()
      await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

      expect(spawnMock.mock.calls.map((call) => call[0])).toEqual(['codex.exe', 'codex'])
      expect(spawnMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ shell: false }))
      expect(spawnMock.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ shell: false }))
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('reports stdin EOF as a Codex CLI error instead of leaving an uncaught stream error', async () => {
    spawnMock.mockImplementation(() => new StdinErrorProcess())

    const events: Array<{ type: string; code?: string; message?: string }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_error') {
        events.push({ type: event.type, code: event.code, message: event.message })
      }
    })

    await expect(
      executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig()),
    ).rejects.toThrow('write EOF')
    expect(events).toContainEqual({
      type: 'agent_error',
      code: 'CODEX_CLI_ERROR',
      message: 'write EOF',
    })
  })

  it('surfaces Codex CLI JSONL failure details when the process exits with code 1', async () => {
    spawnMock.mockImplementation(
      () =>
        new FailedCodexProcess(
          [
            '{"type":"thread.started","thread_id":"t1"}',
            '{"type":"turn.started"}',
            '{"type":"error","message":"Reconnecting... 5/5 (stream disconnected before completion)"}',
            '{"type":"turn.failed","error":{"message":"stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)"}}',
          ],
          '2026-06-13T07:54:38Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: os error 10013, url: wss://api.openai.com/v1/responses\n',
        ),
    )

    const events: Array<{
      type: string
      code?: string
      message?: string
      rawError?: string | undefined
    }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_error') {
        events.push({
          type: event.type,
          code: event.code,
          message: event.message,
          rawError: event.rawError,
        })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events[0]?.code).toBe('CODEX_CLI_ERROR')
    expect(events[0]?.message).toContain('failed to connect to websocket')
    expect(events[0]?.message).toContain('os error 10013')
    expect(events[0]?.rawError).toContain('stream disconnected before completion')
  })

  it('finalizes partial text and reports cancellation when SIGTERM stops the CLI', async () => {
    spawnMock.mockImplementation(() => new CancellableCodexProcess())
    const events: Array<{
      type: string
      mode?: string
      content?: string
      code?: string
      status?: string
      segmentId?: string
    }> = []
    const executor = new CodexCliExecutor()
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
    const errorIndex = events.findIndex((event) => event.code === 'CODEX_CLI_CANCELLED')
    const cancelledIndex = events.findIndex((event) => event.status === 'cancelled')
    expect(events[completedIndex]).toEqual(
      expect.objectContaining({
        content: 'partial CLI answer',
        segmentId: 'codex-turn-1-text-1',
      }),
    )
    expect(events.some((event) => event.code === 'CODEX_CLI_ERROR')).toBe(false)
    expect(completedIndex).toBeGreaterThan(-1)
    expect(completedIndex).toBeLessThan(errorIndex)
    expect(errorIndex).toBeLessThan(cancelledIndex)
  })

  it('forwards explicit Codex CLI compaction JSONL without synthesizing a summary', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          JSON.stringify({
            type: 'turn.compacted',
            compact_summary: 'Real Codex CLI compact output',
            pre_compaction_tokens: 90000,
            post_compaction_tokens: 31000,
          }),
        ]),
    )

    const events: Array<{
      type: string
      provider?: string
      source?: string
      phase?: string
      summary?: string
      preTokens?: number
      postTokens?: number
    }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'context_compaction') events.push(event)
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      expect.objectContaining({
        type: 'context_compaction',
        provider: 'codex',
        source: 'codex_cli',
        phase: 'completed',
        summary: 'Real Codex CLI compact output',
        preTokens: 90000,
        postTokens: 31000,
      }),
    ])
  })

  it('passes CLI-compatible MCP servers and skips in-process SDK servers', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    const args = spawnMock.mock.calls[0]?.[1] as string[]
    const profileConfig = lastProfileConfig
    expect(profileConfig).toContain("mcp_servers.local_tools.command='node'")
    expect(profileConfig).toContain("mcp_servers.local_tools.args=['server.js']")
    expect(profileConfig).toContain("mcp_servers.local_tools.env.TEST_TOKEN='secret'")
    expect(profileConfig.includes('local_tools.default_tools_approval_mode')).toBe(false)
    expect(profileConfig.includes('in_process')).toBe(false)
  })

  it('auto-approves Spark built-in MCP tools for non-interactive Codex CLI turns', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        mcpServers: {
          spark_platform: {
            type: 'stdio',
            command: 'node',
            args: ['platform-management-mcp-server.mjs'],
          },
          local_tools: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
          },
        },
      }),
    )

    const profileConfig = lastProfileConfig
    expect(profileConfig).toContain(
      "mcp_servers.spark_platform.default_tools_approval_mode='approve'",
    )
    expect(profileConfig.includes('local_tools.default_tools_approval_mode')).toBe(false)
  })

  it('maps HTTP MCP bearer auth to Codex bearer_token_env_var without leaking the token in args', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[], options: { env?: Record<string, string> }) => {
        const child = new MockChildProcess(args)
        expect(options.env?.SPARK_MCP_SPARK_TEAM_BEARER_TOKEN).toBe('team-secret')
        return child
      },
    )

    const executor = new CodexCliExecutor()
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

    const args = spawnMock.mock.calls[0]?.[1] as string[]
    const profileConfig = lastProfileConfig
    expect(profileConfig).toContain("mcp_servers.spark_team.url='http://127.0.0.1:1234/mcp'")
    expect(profileConfig).toContain("mcp_servers.spark_team.default_tools_approval_mode='approve'")
    expect(profileConfig).toContain(
      "mcp_servers.spark_team.bearer_token_env_var='SPARK_MCP_SPARK_TEAM_BEARER_TOKEN'",
    )
    expect(profileConfig).toContain("mcp_servers.spark_team.http_headers.X-Spark-Test='ok'")
    expect(args).toContain('-p')
    expect(args).not.toContain('-c')
    expect(profileConfig).not.toContain('team-secret')
    expect(profileConfig).not.toContain('Authorization')
  })

  it('passes OpenAI-compatible Codex model provider config through a CLI profile and env', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[], options: { env?: Record<string, string> }) => {
        const child = new MockChildProcess(args)
        expect(options.env?.SPARK_CODEX_API_KEY_TEST).toBe('sk-third-party')
        return child
      },
    )

    const executor = new CodexCliExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        useLocalConfig: false,
        apiKey: 'sk-third-party',
        model: 'provider-coder',
        codexCliProvider: {
          id: 'spark-provider',
          name: 'Third Party Codex',
          baseUrl: 'https://provider.example.com/v1/',
          wireApi: 'responses',
          envKey: 'SPARK_CODEX_API_KEY_TEST',
          env: { SPARK_CODEX_API_KEY_TEST: 'sk-third-party' },
        },
      }),
    )

    const args = spawnMock.mock.calls[0]?.[1] as string[]
    const profileConfig = lastProfileConfig
    expect(args).toEqual(expect.arrayContaining(['--model', 'provider-coder']))
    expect(profileConfig).toContain("model_provider='spark-provider'")
    expect(profileConfig).toContain("model_providers.spark-provider.name='Third Party Codex'")
    expect(profileConfig).toContain(
      "model_providers.spark-provider.base_url='https://provider.example.com/v1'",
    )
    expect(profileConfig).toContain("model_providers.spark-provider.wire_api='responses'")
    expect(profileConfig).toContain(
      "model_providers.spark-provider.env_key='SPARK_CODEX_API_KEY_TEST'",
    )
    expect(args).toContain('-p')
    expect(args).not.toContain('-c')
    expect(profileConfig).not.toContain('sk-third-party')
  })

  it('passes Chat Completions Codex model provider config through a CLI profile', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn(
      'session-1',
      'turn-1',
      'hello',
      makeConfig({
        useLocalConfig: false,
        apiKey: 'sk-third-party',
        model: 'ark-code-latest',
        codexCliProvider: {
          id: 'volcengine-ark',
          name: '火山方舟',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          wireApi: 'chat',
          envKey: 'SPARK_CODEX_API_KEY_VOLCENGINE',
          env: { SPARK_CODEX_API_KEY_VOLCENGINE: 'sk-third-party' },
        },
      }),
    )

    const profileConfig = lastProfileConfig
    expect(profileConfig).toContain("model_provider='volcengine-ark'")
    expect(profileConfig).toContain(
      "model_providers.volcengine-ark.base_url='https://ark.cn-beijing.volces.com/api/coding/v3'",
    )
    expect(profileConfig).toContain("model_providers.volcengine-ark.wire_api='chat'")
    expect(profileConfig).toContain(
      "model_providers.volcengine-ark.env_key='SPARK_CODEX_API_KEY_VOLCENGINE'",
    )
  })

  it('maps Codex JSONL deltas and completed agent messages to assistant stream events', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"response.output_text.delta","delta":"Hel"}',
          '{"type":"response.output_text.delta","delta":"lo"}',
          '{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}',
        ]),
    )

    const events: Array<{
      type: string
      mode?: string
      content?: string
      isFinal?: boolean
      segmentId?: string
    }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          type: event.type,
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
        type: 'assistant_message',
        mode: 'delta',
        content: 'Hel',
        isFinal: false,
        segmentId: 'codex-turn-1-text-1',
      },
      {
        type: 'assistant_message',
        mode: 'delta',
        content: 'lo',
        isFinal: false,
        segmentId: 'codex-turn-1-text-1',
      },
      {
        type: 'assistant_message',
        mode: 'complete',
        content: 'Hello',
        isFinal: false,
        segmentId: 'codex-turn-1-text-1',
      },
      {
        type: 'assistant_message',
        mode: 'complete',
        content: 'Hello',
        isFinal: true,
        segmentId: 'codex-turn-1',
      },
    ])
  })

  it('keeps Codex CLI assistant text before and after tool calls in separate segments', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"Before command"}}',
          '{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"pwd","aggregated_output":"/workspace\\n","exit_code":0,"status":"completed"}}',
          '{"type":"item.completed","item":{"id":"msg-2","type":"agent_message","text":"After command"}}',
        ]),
    )

    const events: Array<{
      type: string
      mode?: string
      content?: string
      isFinal?: boolean
      segmentId?: string
      toolName?: string
    }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          type: event.type,
          mode: event.mode,
          content: event.content,
          isFinal: event.isFinal,
          ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
        })
      }
      if (event.type === 'tool_call') {
        events.push({ type: event.type, toolName: event.toolName })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      {
        type: 'assistant_message',
        mode: 'delta',
        content: 'Before command',
        isFinal: false,
        segmentId: 'codex-turn-1-text-1',
      },
      {
        type: 'assistant_message',
        mode: 'complete',
        content: 'Before command',
        isFinal: false,
        segmentId: 'codex-turn-1-text-1',
      },
      { type: 'tool_call', toolName: 'bash' },
      {
        type: 'assistant_message',
        mode: 'delta',
        content: 'After command',
        isFinal: false,
        segmentId: 'codex-turn-1-text-2',
      },
      {
        type: 'assistant_message',
        mode: 'complete',
        content: 'After command',
        isFinal: false,
        segmentId: 'codex-turn-1-text-2',
      },
      {
        type: 'assistant_message',
        mode: 'complete',
        content: 'Before command\n\nAfter command',
        isFinal: true,
        segmentId: 'codex-turn-1',
      },
    ])
  })

  it('does not surface structured Codex JSONL as terminal output', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"thread.started","thread_id":"t1"}',
          '{"type":"turn.started"}',
          '{"type":"item.completed","item":{"type":"agent_reasoning","text":"private reasoning"}}',
          '{"type":"item.completed","item":{"type":"agent_message","text":"Visible answer"}}',
          '{"type":"turn.completed"}',
        ]),
    )

    const events: string[] = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'terminal_output') events.push(event.data)
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([])
  })

  it('does not turn thread/turn progress markers into visible thinking blocks', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"thread.started","thread_id":"t1"}',
          '{"type":"turn.started"}',
          '{"type":"turn.completed","usage":{"input_tokens":2,"output_tokens":1}}',
        ]),
    )

    const events: Array<{ type: string; content?: string }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'agent_thinking') {
        events.push({ type: event.type, content: event.content })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([])
  })

  it('maps completed MCP items to tool call and result events', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"item.started","item":{"id":"mcp-1","type":"mcp_tool_call","server":"spark_files","tool":"present_files","arguments":{"files":[{"path":"report.pdf"}]},"status":"in_progress"}}',
          '{"type":"item.completed","item":{"id":"mcp-1","type":"mcp_tool_call","server":"spark_files","tool":"present_files","arguments":{"files":[{"path":"report.pdf"}]},"status":"completed","result":{"content":[{"type":"text","text":"{\\"files\\":[{\\"path\\":\\"/workspace/report.pdf\\"}]}"}]}}}',
        ]),
    )

    const events: Array<{ type: string; toolName?: string; output?: unknown }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_call') events.push({ type: event.type, toolName: event.toolName })
      if (event.type === 'tool_result') {
        events.push({ type: event.type, toolName: event.toolName, output: event.output })
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { type: 'tool_call', toolName: 'mcp__spark_files__present_files' },
      {
        type: 'tool_result',
        toolName: 'mcp__spark_files__present_files',
        output: {
          content: [{ type: 'text', text: '{"files":[{"path":"/workspace/report.pdf"}]}' }],
        },
      },
    ])
  })

  it('maps command_execution items to tool call, terminal output, and tool result events', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"pwd","aggregated_output":"","status":"in_progress"}}',
          '{"type":"item.updated","item":{"id":"cmd-1","type":"command_execution","command":"pwd","aggregated_output":"/workspace\\n","status":"in_progress"}}',
          '{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"pwd","aggregated_output":"/workspace\\n","status":"completed","exit_code":0}}',
        ]),
    )

    const events: Array<Record<string, unknown>> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (
        event.type === 'tool_call' ||
        event.type === 'terminal_output' ||
        event.type === 'tool_result'
      ) {
        events.push(event as unknown as Record<string, unknown>)
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'cmd-1',
        toolName: 'bash',
        toolInput: { command: 'pwd' },
      }),
      expect.objectContaining({
        type: 'terminal_output',
        toolCallId: 'cmd-1',
        data: '/workspace\n',
        isFinal: false,
      }),
      expect.objectContaining({
        type: 'terminal_output',
        toolCallId: 'cmd-1',
        data: '',
        isFinal: true,
        exitCode: 0,
      }),
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'cmd-1',
        toolName: 'bash',
        status: 'success',
        output: '/workspace\n',
      }),
    ])
  })

  it('maps generic tool_call items to tool call and tool result events', async () => {
    spawnMock.mockImplementation(
      (_command: string, args: string[]) =>
        new MockChildProcess(args, [
          '{"type":"item.started","item":{"id":"tool-1","type":"tool_call","name":"Read","arguments":{"path":"README.md"},"status":"in_progress"}}',
          '{"type":"item.completed","item":{"id":"tool-1","type":"tool_call","name":"Read","arguments":{"path":"README.md"},"status":"completed","result":{"content":"docs"}}}',
        ]),
    )

    const events: Array<Record<string, unknown>> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'tool_call' || event.type === 'tool_result') {
        events.push(event as unknown as Record<string, unknown>)
      }
    })

    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'Read',
        toolInput: { path: 'README.md' },
      }),
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'tool-1',
        toolName: 'Read',
        status: 'success',
        output: { content: 'docs' },
      }),
    ])
  })
})
