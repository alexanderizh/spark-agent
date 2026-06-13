import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CodexCliExecutor } from '../../sdk/codex-cli-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
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
  }
  prompt = ''

  constructor(
    public readonly args: string[],
    private readonly outputLines = ['{"type":"message","message":"working"}'],
  ) {
    super()
  }

  kill = vi.fn()
}

class MissingCommandProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    end: vi.fn(() => {
      const err = new Error('spawn codex ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      this.emit('error', err)
      this.emit('close', 1)
    }),
  }

  kill = vi.fn()
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

describe('CodexCliExecutor', () => {
  beforeEach(() => {
    spawnMock.mockReset()
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
      'codex',
      expect.arrayContaining(['exec', '--json', '--output-last-message', '-C']),
      expect.objectContaining({ cwd: process.cwd() }),
    )
    const args = spawnMock.mock.calls[0]?.[1] as string[]
    expect(args).not.toContain('--model')
    expect(args).not.toContain('codex cli')
    expect(child?.prompt).toContain('# Spark Skills')
    expect(child?.prompt).toContain('Skill catalog')
    expect(child?.prompt).toContain('# Spark Runtime Context')
    expect(child?.prompt).toContain('System context')
  })

  it('falls back to Windows Codex CLI shim candidates when the first command is missing', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      spawnMock.mockImplementation((command: string, args: string[]) => {
        if (command === 'codex.cmd') return new MissingCommandProcess()
        return new MockChildProcess(args)
      })

      const executor = new CodexCliExecutor()
      await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

      expect(spawnMock.mock.calls.map((call) => call[0])).toEqual(['codex.cmd', 'codex.exe'])
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('passes CLI-compatible MCP servers and skips in-process SDK servers', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args))

    const executor = new CodexCliExecutor()
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    const args = spawnMock.mock.calls[0]?.[1] as string[]
    const configArgs = args
      .map((arg, index) => (arg === '-c' ? args[index + 1] : null))
      .filter((arg): arg is string => arg != null)
    expect(configArgs).toContain('mcp_servers.local_tools.command="node"')
    expect(configArgs).toContain('mcp_servers.local_tools.args=["server.js"]')
    expect(configArgs).toContain('mcp_servers.local_tools.env.TEST_TOKEN="secret"')
    expect(configArgs.some((arg) => arg.includes('in_process'))).toBe(false)
  })

  it('maps Codex JSONL deltas and completed agent messages to assistant stream events', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args, [
      '{"type":"response.output_text.delta","delta":"Hel"}',
      '{"type":"response.output_text.delta","delta":"lo"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}',
    ]))

    const events: Array<{ type: string; mode?: string; content?: string; isFinal?: boolean }> = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        events.push({
          type: event.type,
          mode: event.mode,
          content: event.content,
          isFinal: event.isFinal,
        })
      }
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([
      { type: 'assistant_message', mode: 'delta', content: 'Hel', isFinal: false },
      { type: 'assistant_message', mode: 'delta', content: 'lo', isFinal: false },
      { type: 'assistant_message', mode: 'complete', content: 'Hello', isFinal: false },
    ])
  })

  it('does not surface structured Codex JSONL as terminal output', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => new MockChildProcess(args, [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"type":"agent_reasoning","text":"private reasoning"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Visible answer"}}',
      '{"type":"turn.completed"}',
    ]))

    const events: string[] = []
    const executor = new CodexCliExecutor()
    executor.onEvent((event) => {
      if (event.type === 'terminal_output') events.push(event.data)
    })
    await executor.executeTurn('session-1', 'turn-1', 'hello', makeConfig())

    expect(events).toEqual([])
  })
})
