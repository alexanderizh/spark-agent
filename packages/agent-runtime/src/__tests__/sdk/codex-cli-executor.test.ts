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
      this.stdout.emit('data', Buffer.from('{"type":"message","message":"working"}\n'))
      this.emit('close', 0)
    }),
  }
  prompt = ''

  constructor(public readonly args: string[]) {
    super()
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
})
