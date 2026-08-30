import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type {
  EngineExecutor,
  PermissionModeAwareExecutor,
  RewindCapableExecutor,
} from '../../sdk/engine-executor.js'
import type { SDKExecutorConfig } from '../../sdk/types.js'

/**
 * EngineExecutor conformance 测试（P1-W1-D3）。
 *
 * 两层断言：
 * 1. 编译期：四执行器赋值到接口类型（含 Claude 的两个能力接口）——
 *    任何签名漂移会在 typecheck 阶段失败，配合各执行器类上的
 *    `implements` 声明构成双保险。
 * 2. 运行期：契约核心条款「cancel() 返回后事件流上最终必须出现 cancelled
 *    终态，且 executeTurn 以 resolve 收场」逐执行器冒烟。
 *
 * transport mock 复用各执行器既有测试的模式（SDK 函数级 mock /
 * 子进程 mock / codex-sdk thread mock / openai chat mock）。
 */

const queryMock = vi.hoisted(() => vi.fn())
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

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

const openAIConstructor = vi.hoisted(() => vi.fn())
const chatCreate = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: openAIConstructor.mockImplementation(() => ({
    chat: { completions: { create: chatCreate } },
  })),
}))

const { ClaudeSDKExecutor, resetSDKLoadState } = await import('../../sdk/claude-sdk-executor.js')
const { CodexSdkExecutor } = await import('../../sdk/codex-sdk-executor.js')
const { CodexCliExecutor } = await import('../../sdk/codex-cli-executor.js')
const { CodexOpenAIExecutor } = await import('../../sdk/codex-openai-executor.js')
const { isPermissionModeAware, isRewindCapable } = await import('../../sdk/engine-executor.js')

function trackEventsAndCancelOnFirstDelta(executor: EngineExecutor, events: AgentEvent[]): void {
  let cancelled = false
  executor.onEvent((event) => {
    events.push(event)
    if (event.type === 'assistant_message' && event.mode === 'delta' && !cancelled) {
      cancelled = true
      executor.cancel()
    }
  })
}

function hasCancelledTerminal(events: AgentEvent[]): boolean {
  return events.some((event) => event.type === 'agent_status' && event.status === 'cancelled')
}

describe('EngineExecutor conformance', () => {
  let codexHome: string
  let previousCodexHome: string | undefined

  beforeEach(() => {
    queryMock.mockReset()
    resetSDKLoadState()
    codexCtor.mockClear()
    startThread.mockReset()
    resumeThread.mockReset()
    runStreamed.mockReset()
    startThread.mockReturnValue({ runStreamed })
    spawnMock.mockReset()
    openAIConstructor.mockClear()
    chatCreate.mockReset()
    previousCodexHome = process.env.CODEX_HOME
    codexHome = mkdtempSync(path.join(tmpdir(), 'spark-conformance-'))
    process.env.CODEX_HOME = codexHome
  })

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = previousCodexHome
    }
    rmSync(codexHome, { recursive: true, force: true })
  })

  it('satisfies the executor contracts at compile time and reports engine + capabilities', () => {
    const claude = new ClaudeSDKExecutor()
    const codexSdk = new CodexSdkExecutor()
    const codexCli = new CodexCliExecutor()
    const codexOpenAI = new CodexOpenAIExecutor()

    // 编译期窄化：赋值到接口类型即 conformance（typecheck 兜底）。
    const asClaude: PermissionModeAwareExecutor & RewindCapableExecutor = claude
    const asSdk: EngineExecutor = codexSdk
    const asCli: EngineExecutor = codexCli
    const asOpenAI: EngineExecutor = codexOpenAI

    expect(asClaude.engine).toBe('claude-sdk')
    expect(asSdk.engine).toBe('codex')
    expect(asCli.engine).toBe('codex')
    expect(asOpenAI.engine).toBe('codex')

    expect(isPermissionModeAware(claude)).toBe(true)
    expect(isRewindCapable(claude)).toBe(true)
    for (const codex of [codexSdk, codexCli, codexOpenAI]) {
      expect(isPermissionModeAware(codex)).toBe(false)
      expect(isRewindCapable(codex)).toBe(false)
    }
  })

  it('ClaudeSDKExecutor: cancel() 后事件流出现 cancelled 终态且 turn 以 resolve 收场', async () => {
    queryMock.mockReturnValue(
      (async function* () {
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'partial answer' },
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ignored',
          usage: { input_tokens: 1, output_tokens: 1 },
          total_cost_usd: 0,
        }
      })(),
    )
    const executor = new ClaudeSDKExecutor()
    const events: AgentEvent[] = []
    trackEventsAndCancelOnFirstDelta(executor, events)
    const config: SDKExecutorConfig = {
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-5',
      workspaceRootPath: process.cwd(),
      permissionMode: 'claude-ask',
    }

    await expect(
      executor.executeTurn('sess-conf', 'turn-conf', 'hello', config),
    ).resolves.toBeUndefined()
    expect(hasCancelledTerminal(events)).toBe(true)
  })

  it('CodexSdkExecutor: cancel() 后事件流出现 cancelled 终态且 turn 以 resolve 收场', async () => {
    async function* abortedStream() {
      yield { type: 'response.output_text.delta', delta: 'partial answer' }
      throw new Error('stream aborted')
    }
    runStreamed.mockResolvedValue({ events: abortedStream() })
    const executor = new CodexSdkExecutor()
    const events: AgentEvent[] = []
    trackEventsAndCancelOnFirstDelta(executor, events)
    const config: SDKExecutorConfig = {
      apiKey: 'sk-test',
      model: 'gpt-5-codex',
      workspaceRootPath: process.cwd(),
      permissionMode: 'codex-default',
    }

    await expect(
      executor.executeTurn('sess-conf', 'turn-conf', 'hello', config),
    ).resolves.toBeUndefined()
    expect(hasCancelledTerminal(events)).toBe(true)
  })

  it('CodexCliExecutor: cancel() 后事件流出现 cancelled 终态且 turn 以 resolve 收场', async () => {
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
              Buffer.from('{"type":"response.output_text.delta","delta":"partial answer"}\n'),
            )
          }),
        })
      }

      kill = vi.fn(() => {
        this.emit('close', 143)
        return true
      })
    }
    spawnMock.mockImplementation(() => new CancellableCodexProcess())

    const executor = new CodexCliExecutor()
    const events: AgentEvent[] = []
    trackEventsAndCancelOnFirstDelta(executor, events)
    const config: SDKExecutorConfig = {
      apiKey: '',
      useLocalConfig: true,
      model: 'codex cli',
      workspaceRootPath: process.cwd(),
      permissionMode: 'codex-default',
    }

    await expect(
      executor.executeTurn('sess-conf', 'turn-conf', 'hello', config),
    ).resolves.toBeUndefined()
    expect(hasCancelledTerminal(events)).toBe(true)
  })

  it('CodexOpenAIExecutor: cancel() 后事件流出现 cancelled 终态且 turn 以 resolve 收场', async () => {
    chatCreate.mockImplementation(async (_body: unknown, options: { signal: AbortSignal }) => {
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })

    const executor = new CodexOpenAIExecutor()
    const events: AgentEvent[] = []
    const statuses: string[] = []
    executor.onEvent((event) => {
      events.push(event)
      if (event.type === 'agent_status') statuses.push(event.status)
    })
    const config: SDKExecutorConfig = {
      apiKey: 'sk-test',
      apiEndpoint: 'https://provider.example.com/v1/',
      model: 'provider-chat-model',
      workspaceRootPath: process.cwd(),
      permissionMode: 'codex-default',
      codexApiKind: 'chat',
    }

    const turn = executor.executeTurn('sess-conf', 'turn-conf', 'hello', config)
    executor.cancel()
    await expect(turn).resolves.toBeUndefined()
    expect(hasCancelledTerminal(events)).toBe(true)
  })
})
