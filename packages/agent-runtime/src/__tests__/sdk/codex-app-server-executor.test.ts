import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { CodexAppServerExecutor } from '../../sdk/codex-app-server/codex-app-server-executor.js'
import type { CodexAppServerExecutorOptions } from '../../sdk/codex-app-server/codex-app-server-executor.js'
import { CodexAppServerRuntimeSupervisor } from '../../sdk/codex-app-server/codex-runtime-supervisor.js'
import { CodexRuntimeNotInstalledError } from '../../sdk/codex-sdk-executor.js'
import type { EngineExecutor } from '../../sdk/engine-executor.js'
import { isCompactCapable, isSteerCapable } from '../../sdk/engine-executor.js'
import type { SDKExecutorConfig, SDKTurnAttachment } from '../../sdk/types.js'
import { FakeEngineExecutor, resetFakeEngineHarness } from './fake-engine-executor.js'

/**
 * CodexAppServerExecutor 行为锁：以 node 脚本替身（fake-codex-app-server.mjs）
 * 代替真实 codex 二进制，锁定 app-server 载具的核心契约——
 * token 级流式、事件映射（segmentId 约定与 CodexSdkExecutor 对齐）、
 * turn/interrupt 取消、resume 静默回退、审批确定性响应（防挂起）、
 * prepare 失败回退 Sdk 载具、进程崩溃与 failed 终态的既有语义。
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url))
const SESSION_ID = 'session-as-1'
const TURN_ID = 'turn-as-1'
const THREAD_ID = 'fake-thread-1'

type Scenario = {
  resumeFails?: boolean
  serverRequests?: Array<{ method: string; params?: Record<string, unknown> }>
  steps?: Array<Record<string, unknown>>
  /** turn/completed 之后替身继续投递的迟到通知（模拟进程关闭期 flush 竞态）。 */
  postTurnSteps?: Array<Record<string, unknown>>
  finalStatus?: 'completed' | 'interrupted' | 'failed'
  failureMessage?: string
}

type JournalEntry = Record<string, unknown> & { kind: string }

function makeConfig(overrides: Partial<SDKExecutorConfig> = {}): SDKExecutorConfig {
  return {
    apiKey: 'test-key',
    model: 'gpt-test',
    permissionMode: 'codex-default',
    workspaceRootPath: process.cwd(),
    ...overrides,
  }
}

function spawnEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

function eventsOf(events: readonly AgentEvent[], type: AgentEvent['type']): AgentEvent[] {
  return events.filter((event) => event.type === type)
}

type AssistantMessageEvent = Extract<AgentEvent, { type: 'assistant_message' }>

function assistantEvents(
  events: readonly AgentEvent[],
  mode: 'delta' | 'complete',
): AssistantMessageEvent[] {
  return events.filter(
    (event): event is AssistantMessageEvent =>
      event.type === 'assistant_message' && event.mode === mode,
  )
}

function eventTypes(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type)
}

async function runScenario(
  scenario: Scenario,
  options: {
    config?: Partial<SDKExecutorConfig>
    executor?: Partial<CodexAppServerExecutorOptions>
    onEvent?: (event: AgentEvent, executor: CodexAppServerExecutor) => void
  } = {},
): Promise<{ events: AgentEvent[]; journal: JournalEntry[]; error: unknown }> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-as-test-'))
  const scenarioPath = join(dir, 'scenario.json')
  const journalPath = join(dir, 'journal.log')
  await writeFile(scenarioPath, JSON.stringify(scenario), 'utf8')
  const executor = new CodexAppServerExecutor({
    executablePath: process.execPath,
    args: [FIXTURE, scenarioPath, journalPath],
    env: spawnEnv(),
    handshakeTimeoutMs: 10_000,
    ...options.executor,
  })
  const events: AgentEvent[] = []
  executor.onEvent((event) => {
    events.push(event)
    options.onEvent?.(event, executor)
  })
  let error: unknown = null
  try {
    await executor.executeTurn(SESSION_ID, TURN_ID, 'hello', makeConfig(options.config))
  } catch (err) {
    error = err
  }
  let journal: JournalEntry[]
  try {
    const raw = await readFile(journalPath, 'utf8')
    journal = raw
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JournalEntry)
  } catch {
    journal = []
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  return { events, journal, error }
}

function agentMessageDeltaStep(delta: string, itemId = 'item-text-1'): Record<string, unknown> {
  return {
    kind: 'notify',
    method: 'item/agentMessage/delta',
    params: { threadId: THREAD_ID, turnId: 'server-turn-1', itemId, delta },
  }
}

function agentMessageCompletedStep(text: string, itemId = 'item-text-1'): Record<string, unknown> {
  return {
    kind: 'notify',
    method: 'item/completed',
    params: {
      threadId: THREAD_ID,
      turnId: 'server-turn-1',
      item: { type: 'agentMessage', id: itemId, text },
    },
  }
}

beforeEach(() => {
  resetFakeEngineHarness()
})

afterEach(() => {
  resetFakeEngineHarness()
})

describe('CodexAppServerExecutor', () => {
  it('编译期 conformance：实现 EngineExecutor 接口', () => {
    const executor: EngineExecutor = new CodexAppServerExecutor()
    expect(executor.engine).toBe('codex')
  })

  it('token 级流式：delta 逐条投递，segmentId 沿用 codex-sdk 约定，终态齐全', async () => {
    const { events, error } = await runScenario({
      steps: [
        {
          kind: 'notify',
          method: 'turn/started',
          params: { threadId: THREAD_ID, turn: { id: 'server-turn-1', status: 'inProgress' } },
        },
        agentMessageDeltaStep('你'),
        agentMessageDeltaStep('好'),
        agentMessageDeltaStep('，世界'),
        agentMessageCompletedStep('你好，世界'),
      ],
      finalStatus: 'completed',
    })
    expect(error).toBeNull()
    const types = eventTypes(events)
    expect(types[0]).toBe('user_message')
    expect(types).toContain('context_usage')

    const deltas = assistantEvents(events, 'delta')
    expect(deltas.map((e) => (e as { content: string }).content)).toEqual(['你', '好', '，世界'])
    for (const delta of deltas) {
      expect((delta as { segmentId?: string }).segmentId).toBe(`codex-sdk-${TURN_ID}-text-1`)
      expect((delta as { provider?: string }).provider).toBe('codex')
    }

    const completes = assistantEvents(events, 'complete')
    expect(completes).toHaveLength(2)
    expect((completes[0] as { content: string }).content).toBe('你好，世界')
    expect((completes[0] as { isFinal?: boolean }).isFinal).toBe(false)
    expect((completes[1] as { content: string }).content).toBe('你好，世界')
    expect((completes[1] as { isFinal?: boolean }).isFinal).toBe(true)
    expect((completes[1] as { segmentId?: string }).segmentId).toBe(`codex-sdk-${TURN_ID}`)

    const statuses = eventsOf(events, 'agent_status')
    expect(statuses.at(-1)).toMatchObject({ status: 'completed' })
  })

  it('按官方顺序完成 initialized 握手，并透传 clientUserMessageId', async () => {
    const { journal, error } = await runScenario(
      { steps: [agentMessageCompletedStep('ok')] },
      { config: { clientUserMessageId: '00000000-0000-4000-8000-000000000123' } },
    )
    expect(error).toBeNull()
    const initializeIndex = journal.findIndex(
      (entry) => entry.kind === 'request' && entry.method === 'initialize',
    )
    const initializedIndex = journal.findIndex(
      (entry) => entry.kind === 'notification' && entry.method === 'initialized',
    )
    const threadStartIndex = journal.findIndex(
      (entry) => entry.kind === 'request' && entry.method === 'thread/start',
    )
    expect(initializeIndex).toBeGreaterThanOrEqual(0)
    expect(initializedIndex).toBeGreaterThan(initializeIndex)
    expect(threadStartIndex).toBeGreaterThan(initializedIndex)
    expect(journal[threadStartIndex]?.params).toMatchObject({
      config: {
        model_reasoning_summary: 'concise',
        show_raw_agent_reasoning: false,
        hide_agent_reasoning: false,
        tool_output_token_limit: 12_000,
      },
    })
    expect(
      journal.find((entry) => entry.kind === 'request' && entry.method === 'turn/start')?.params,
    ).toMatchObject({ clientUserMessageId: '00000000-0000-4000-8000-000000000123' })
  })

  it('隔离损坏的原生 Skill，继续完成 turn 并保留明确诊断', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'codex-invalid-skill-turn-'))
    const skillDir = join(workspace, '.agents', 'skills', 'broken')
    await mkdir(join(workspace, '.git'))
    await mkdir(skillDir, { recursive: true })
    const skillFile = join(skillDir, 'SKILL.md')
    await writeFile(skillFile, '# Missing frontmatter\n', 'utf8')

    try {
      const { events, journal, error } = await runScenario(
        { steps: [agentMessageCompletedStep('still alive')] },
        { config: { workspaceRootPath: workspace } },
      )

      expect(error).toBeNull()
      expect(events.at(-1)).toMatchObject({ type: 'agent_status', status: 'completed' })
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'runtime_signal',
          code: 'INVALID_SKILL_ISOLATED',
          level: 'warning',
        }),
      )
      expect(
        journal.find((entry) => entry.kind === 'request' && entry.method === 'thread/start')
          ?.params,
      ).toMatchObject({
        config: {
          skills: {
            config: expect.arrayContaining([{ path: skillFile, enabled: false }]),
          },
        },
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('turn/start 显式下发当前审批 reviewer、网络与额外 writable roots', async () => {
    const { journal, error } = await runScenario(
      { steps: [agentMessageCompletedStep('ok')] },
      {
        config: {
          permissionMode: 'codex-auto-review',
          networkAccessEnabled: true,
          additionalDirectories: ['/workspace/shared'],
        },
      },
    )
    expect(error).toBeNull()
    expect(
      journal.find((entry) => entry.kind === 'request' && entry.method === 'turn/start')?.params,
    ).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: ['/workspace/shared'],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      serviceTier: null,
    })
  })

  it('turn/start 开启时发送 Fast tier，关闭时显式 null 清除 sticky 状态', async () => {
    const fast = await runScenario(
      { steps: [agentMessageCompletedStep('fast')] },
      { config: { fastMode: true } },
    )
    expect(fast.error).toBeNull()
    expect(
      fast.journal.find((entry) => entry.kind === 'request' && entry.method === 'turn/start')
        ?.params,
    ).toMatchObject({ serviceTier: 'fast' })

    const standard = await runScenario(
      { steps: [agentMessageCompletedStep('standard')] },
      { config: { fastMode: false } },
    )
    expect(standard.error).toBeNull()
    expect(
      standard.journal.find((entry) => entry.kind === 'request' && entry.method === 'turn/start')
        ?.params,
    ).toMatchObject({ serviceTier: null })
  })

  it('reports app-server prepare and turn-start phase metrics', async () => {
    const runtimeMetricsObserver = vi.fn()
    const { error } = await runScenario(
      { steps: [agentMessageCompletedStep('ok')] },
      { config: { runtimeMetricsObserver } },
    )
    expect(error).toBeNull()
    expect(runtimeMetricsObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        appServerSpawnMs: expect.any(Number),
        appServerInitializeMs: expect.any(Number),
        appServerThreadStartMs: expect.any(Number),
        appServerPrepareMs: expect.any(Number),
        appServerThreadMode: 'start',
      }),
    )
    expect(runtimeMetricsObserver).toHaveBeenCalledWith(
      expect.objectContaining({ appServerTurnStartMs: expect.any(Number) }),
    )
  })

  it('工具生命周期：commandExecution started→outputDelta→completed 映射 tool_call/terminal_output/tool_result', async () => {
    const commandItem = (status: string, aggregatedOutput?: string, exitCode?: number) => ({
      type: 'commandExecution',
      id: 'cmd-1',
      command: 'echo hi',
      status,
      ...(aggregatedOutput != null ? { aggregatedOutput } : {}),
      ...(exitCode != null ? { exitCode } : {}),
    })
    const { events, error } = await runScenario({
      steps: [
        {
          kind: 'notify',
          method: 'item/started',
          params: { threadId: THREAD_ID, turnId: 'server-turn-1', item: commandItem('inProgress') },
        },
        {
          kind: 'notify',
          method: 'item/commandExecution/outputDelta',
          params: { threadId: THREAD_ID, turnId: 'server-turn-1', itemId: 'cmd-1', delta: 'hi\n' },
        },
        {
          kind: 'notify',
          method: 'item/completed',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            item: commandItem('completed', 'hi\n', 0),
          },
        },
        agentMessageDeltaStep('done'),
        agentMessageCompletedStep('done'),
      ],
    })
    expect(error).toBeNull()
    const toolCall = eventsOf(events, 'tool_call')[0]
    expect(toolCall).toMatchObject({ toolCallId: 'cmd-1', toolName: 'bash', source: 'builtin' })
    expect(eventsOf(events, 'agent_status')).toContainEqual(
      expect.objectContaining({ status: 'calling_tool', message: 'Calling bash' }),
    )
    const terminalOutputs = eventsOf(events, 'terminal_output')
    expect(terminalOutputs[0]).toMatchObject({ toolCallId: 'cmd-1', data: 'hi\n', isFinal: false })
    expect(terminalOutputs[1]).toMatchObject({ toolCallId: 'cmd-1', isFinal: true, exitCode: 0 })
    const toolResult = eventsOf(events, 'tool_result')[0]
    expect(toolResult).toMatchObject({
      toolCallId: 'cmd-1',
      toolName: 'bash',
      status: 'success',
      output: 'hi\n',
    })
    // 工具后的文本段落必须新开 segment（渲染分段约定）。
    const deltas = assistantEvents(events, 'delta')
    expect((deltas[0] as { segmentId?: string }).segmentId).toBe(`codex-sdk-${TURN_ID}-text-1`)
    // 事件 id 是 agent_events 主键：会持久化的事件必须两两不同，
    // 否则落库触发 UNIQUE constraint failed（生产 0.10.13 主进程崩溃事故）。
    const persistentIds = events
      .filter((event) => !(event.type === 'assistant_message' && event.mode === 'delta'))
      .map((event) => event.id)
    expect(new Set(persistentIds).size).toBe(persistentIds.length)
  })

  it('只展示推理摘要，并把多个 reasoning item 聚合到同一 turn 段', async () => {
    const { events } = await runScenario({
      steps: [
        {
          kind: 'notify',
          method: 'item/reasoning/textDelta',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            itemId: 'reason-1',
            delta: '不应展示的原始推理',
          },
        },
        {
          kind: 'notify',
          method: 'item/reasoning/summaryTextDelta',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            itemId: 'reason-1',
            summaryIndex: 0,
            delta: '先检查调用链',
          },
        },
        {
          kind: 'notify',
          method: 'item/reasoning/summaryTextDelta',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            itemId: 'reason-2',
            summaryIndex: 0,
            delta: '再验证兼容性',
          },
        },
        agentMessageDeltaStep('答案'),
        agentMessageCompletedStep('答案'),
      ],
    })
    const thinking = eventsOf(events, 'agent_thinking')
    expect(thinking).toHaveLength(2)
    expect(thinking).toEqual([
      expect.objectContaining({
        mode: 'delta',
        content: '先检查调用链',
        segmentId: `codex-sdk-thinking-${TURN_ID}`,
      }),
      expect.objectContaining({
        mode: 'delta',
        content: '\n\n再验证兼容性',
        segmentId: `codex-sdk-thinking-${TURN_ID}`,
      }),
    ])
  })

  it('mcpToolCall / fileChange / webSearch 映射', async () => {
    const { events } = await runScenario({
      steps: [
        {
          kind: 'notify',
          method: 'item/completed',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            item: {
              type: 'mcpToolCall',
              id: 'mcp-1',
              server: 'spark_files',
              tool: 'present_files',
              arguments: { files: [] },
              status: 'completed',
              result: { ok: true },
            },
          },
        },
        {
          kind: 'notify',
          method: 'item/completed',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            item: {
              type: 'fileChange',
              id: 'fc-1',
              status: 'completed',
              changes: [
                { kind: 'add', path: 'a.ts', diff: '' },
                { kind: 'update', path: 'b.ts', diff: '' },
              ],
            },
          },
        },
        {
          kind: 'notify',
          method: 'item/completed',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            item: { type: 'webSearch', id: 'ws-1', query: 'codex app-server' },
          },
        },
        agentMessageCompletedStep('done'),
      ],
    })
    expect(eventsOf(events, 'tool_call')[0]).toMatchObject({
      toolCallId: 'mcp-1',
      toolName: 'mcp__spark_files__present_files',
      source: 'mcp',
      mcpServerId: 'spark_files',
    })
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({
      toolCallId: 'mcp-1',
      status: 'success',
      output: { ok: true },
    })
    const fileChanges = eventsOf(events, 'file_change')
    expect(fileChanges.map((e) => (e as { changeType: string }).changeType)).toEqual([
      'create',
      'modify',
    ])
    expect(eventsOf(events, 'tool_result').at(-1)).toMatchObject({
      toolName: 'web_search',
      status: 'success',
    })
    // 持久化事件 id 两两不同：同 id 落库触发主键冲突（含多 fileChange 循环场景）。
    const persistentIds = events
      .filter((event) => !(event.type === 'assistant_message' && event.mode === 'delta'))
      .map((event) => event.id)
    expect(new Set(persistentIds).size).toBe(persistentIds.length)
  })

  it('取消：cancel() 发 turn/interrupt，interrupted 终态走 cancelled 收尾且不抛错', async () => {
    const { events, journal, error } = await runScenario(
      {
        steps: [agentMessageDeltaStep('部分输出'), { kind: 'waitInterrupt' }],
      },
      {
        onEvent: (event, executor) => {
          if (event.type === 'assistant_message' && event.mode === 'delta') {
            executor.cancel()
          }
        },
      },
    )
    expect(error).toBeNull()
    expect(journal.some((entry) => entry.kind === 'interrupt')).toBe(true)
    const statuses = eventsOf(events, 'agent_status')
    expect(statuses.at(-1)).toMatchObject({ status: 'cancelled' })
    const agentError = eventsOf(events, 'agent_error')[0]
    expect(agentError).toMatchObject({ code: 'CODEX_SDK_CANCELLED', retryable: false })
  })

  it('resume：thread/resume 失败时静默 thread/start（对齐 exec 未知 id 行为）', async () => {
    const { journal, error, events } = await runScenario(
      { resumeFails: true, steps: [agentMessageCompletedStep('ok')] },
      { config: { sdkSessionId: 'spark-hash-id', continueSession: true } },
    )
    expect(error).toBeNull()
    const methods = journal.filter((e) => e.kind === 'request').map((e) => e.method)
    expect(methods).toContain('thread/resume')
    expect(methods).toContain('thread/start')
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
  })

  it('resume：成功路径直接复用 thread', async () => {
    const { journal } = await runScenario(
      { steps: [agentMessageCompletedStep('ok')] },
      { config: { sdkSessionId: 'spark-hash-id', continueSession: true } },
    )
    const methods = journal.filter((e) => e.kind === 'request').map((e) => e.method)
    expect(methods).toContain('thread/resume')
    expect(methods).not.toContain('thread/start')
  })

  it('审批兜底：默认 deny 且 turn 不挂起', async () => {
    const { journal, error, events } = await runScenario({
      serverRequests: [
        {
          method: 'item/commandExecution/requestApproval',
          params: { threadId: THREAD_ID, turnId: 'server-turn-1', command: 'rm -rf /' },
        },
      ],
      steps: [agentMessageCompletedStep('denied by policy')],
    })
    expect(error).toBeNull()
    const clientResponse = journal.find((e) => e.kind === 'clientResponse')
    expect((clientResponse?.result as { decision?: string })?.decision).toBe('deny')
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
  })

  it('审批兜底：codex-full-access 档 accept', async () => {
    const { journal } = await runScenario(
      {
        serverRequests: [
          {
            method: 'item/fileChange/requestApproval',
            params: { threadId: THREAD_ID, turnId: 'server-turn-1', itemId: 'fc-9' },
          },
        ],
        steps: [agentMessageCompletedStep('approved')],
      },
      { config: { permissionMode: 'codex-full-access' } },
    )
    const clientResponse = journal.find((e) => e.kind === 'clientResponse')
    expect((clientResponse?.result as { decision?: string })?.decision).toBe('accept')
  })

  it('载具回退：二进制不可用时委托 Sdk 载具，事件经 raw bridge 转发', async () => {
    const fallback = new FakeEngineExecutor({
      events: [
        {
          type: 'assistant_message',
          mode: 'delta',
          content: 'from-fallback',
          provider: 'codex',
          isFinal: false,
          segmentId: `codex-sdk-${TURN_ID}-text-1`,
        },
      ],
      terminalStatus: 'completed',
    })
    const { events, error } = await runScenario(
      { steps: [] },
      {
        executor: {
          executablePath: join(tmpdir(), 'nonexistent-codex-binary.exe'),
          createFallback: () => fallback,
        },
      },
    )
    expect(error).toBeNull()
    expect(fallback.record).toMatchObject({
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      message: 'hello',
    })
    const deltas = assistantEvents(events, 'delta')
    expect((deltas[0] as { content: string }).content).toBe('from-fallback')
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    // app-server 路径未发出任何事件（回退在事件前决定），user_message 只来自本层一次都没有。
    expect(eventsOf(events, 'user_message')).toHaveLength(0)
  })

  it('运行时缺失：准备阶段错误交给 Sdk fallback 生成标准安装恢复事件', async () => {
    const runtimeSupervisor = {
      acquire: vi.fn(async () => {
        throw new CodexRuntimeNotInstalledError()
      }),
    } as unknown as CodexAppServerRuntimeSupervisor
    const fallback = new FakeEngineExecutor({
      events: [
        {
          type: 'agent_error',
          code: 'CODEX_RUNTIME_NOT_INSTALLED',
          message: 'Codex native runtime 未安装',
          retryable: true,
        },
      ],
      terminalStatus: 'error',
    })

    const { events, error } = await runScenario(
      { steps: [] },
      {
        executor: {
          executablePath: process.execPath,
          runtimeSupervisor,
          createFallback: () => fallback,
        },
      },
    )

    expect(error).toBeNull()
    expect(fallback.record).not.toBeNull()
    expect(eventsOf(events, 'agent_error')).toContainEqual(
      expect.objectContaining({ code: 'CODEX_RUNTIME_NOT_INSTALLED' }),
    )
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'error' })
  })

  it('fresh native thread 持久化失败时在 turn/start 前回退并注入备用历史', async () => {
    const supervisor = new CodexAppServerRuntimeSupervisor({ idleTtlMs: 60_000 })
    const fallback = new FakeEngineExecutor({ terminalStatus: 'completed' })
    try {
      const { journal, error } = await runScenario(
        { steps: [agentMessageCompletedStep('must not run')] },
        {
          config: {
            codexNativeThreadBindingKey: 'binding-persistence-failure',
            codexNativeThreadBindingObserver: () => {
              throw new Error('database unavailable')
            },
            resumeFallbackSystemPrompt: 'RECOVERY_HISTORY',
          },
          executor: {
            runtimeSupervisor: supervisor,
            createFallback: () => fallback,
          },
        },
      )

      expect(error).toBeNull()
      expect(journal.some((entry) => entry.method === 'thread/start')).toBe(true)
      expect(journal.some((entry) => entry.method === 'turn/start')).toBe(false)
      expect(fallback.record?.config.systemPrompt).toContain('RECOVERY_HISTORY')
    } finally {
      await supervisor.dispose()
    }
  })

  it('图片附件：直接走 Sdk 载具（不 spawn app-server）', async () => {
    const attachments: SDKTurnAttachment[] = [{ type: 'image', path: '/tmp/x.png', name: 'x.png' }]
    const fallback = new FakeEngineExecutor({ terminalStatus: 'completed' })
    const { events } = await runScenario(
      { steps: [] },
      {
        config: { attachments },
        executor: {
          executablePath: process.execPath,
          createFallback: () => fallback,
        },
      },
    )
    expect(fallback.record?.config.attachments).toEqual(attachments)
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
  })

  it('进程崩溃：error 收尾并抛错', async () => {
    const { events, error } = await runScenario({
      steps: [agentMessageDeltaStep('partial'), { kind: 'exit', code: 1 }],
    })
    expect(error).toBeInstanceOf(Error)
    const agentError = eventsOf(events, 'agent_error')[0]
    expect(agentError).toMatchObject({ code: 'CODEX_APPSERVER_ERROR', retryable: true })
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'error' })
  })

  it('turn failed：emit agent_error 但 turn 正常收尾（对齐 Sdk 载具语义）', async () => {
    const { events, error } = await runScenario({
      steps: [agentMessageDeltaStep('一部分')],
      finalStatus: 'failed',
      failureMessage: 'fake failure',
    })
    expect(error).toBeNull()
    expect(eventsOf(events, 'agent_error')[0]).toMatchObject({
      code: 'CODEX_SDK_TURN_FAILED',
      message: 'fake failure',
    })
    expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
  })

  it('实时用量：thread/tokenUsage/updated 映射 usage_update', async () => {
    const { events } = await runScenario({
      steps: [
        {
          kind: 'notify',
          method: 'thread/tokenUsage/updated',
          params: {
            threadId: THREAD_ID,
            turnId: 'server-turn-1',
            tokenUsage: {
              last: {
                inputTokens: 10,
                outputTokens: 5,
                cachedInputTokens: 2,
                reasoningOutputTokens: 1,
                totalTokens: 15,
              },
              total: {
                inputTokens: 100,
                outputTokens: 50,
                cachedInputTokens: 20,
                reasoningOutputTokens: 10,
                totalTokens: 150,
              },
            },
          },
        },
        agentMessageCompletedStep('ok'),
      ],
    })
    const usage = eventsOf(events, 'usage_update')[0]
    expect(usage).toMatchObject({
      provider: 'codex',
      model: 'gpt-test',
      inputTokens: 10,
      outputTokens: 5,
      cacheHitTokens: 2,
      reasoningOutputTokens: 1,
    })
  })

  describe('健壮性加固（迟到通知 / 畸形形状 / 异常兜底）', () => {
    it('迟到通知守卫：turn 收尾后到达的通知全部丢弃，不产生空主键脏事件', async () => {
      const { events, error } = await runScenario({
        steps: [agentMessageDeltaStep('正文'), agentMessageCompletedStep('正文')],
        postTurnSteps: [
          { kind: 'delay', ms: 80 },
          {
            kind: 'notify',
            method: 'error',
            params: {
              threadId: THREAD_ID,
              turnId: 'server-turn-1',
              error: { message: 'late stream error' },
              willRetry: false,
            },
          },
          {
            kind: 'notify',
            method: 'turn/started',
            params: { threadId: THREAD_ID, turn: { id: 'late-turn', status: 'inProgress' } },
          },
          {
            kind: 'notify',
            method: 'item/agentMessage/delta',
            params: { threadId: THREAD_ID, turnId: 'server-turn-1', itemId: 'late', delta: '迟到' },
          },
        ],
      })
      expect(error).toBeNull()
      // 不产生空 sessionId/turnId 的脏事件（会以空主键落库 + 干扰会话状态）。
      expect(
        events.every((event) => event.sessionId === SESSION_ID && event.turnId === TURN_ID),
      ).toBe(true)
      expect(eventsOf(events, 'agent_error')).toHaveLength(0)
      expect(
        assistantEvents(events, 'delta').map((e) => (e as { content: string }).content),
      ).toEqual(['正文'])
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    })

    it('迟到审批守卫：turn 收尾后的审批请求走确定性 deny，不触发 approvalCallback', async () => {
      const callback = vi.fn(async () => true)
      const { journal, events, error } = await runScenario(
        {
          steps: [agentMessageCompletedStep('done')],
          postTurnSteps: [
            { kind: 'delay', ms: 80 },
            {
              kind: 'serverRequest',
              method: 'item/commandExecution/requestApproval',
              params: { threadId: THREAD_ID, turnId: 'server-turn-1', command: 'rm -rf /tmp/late' },
            },
            { kind: 'delay', ms: 80 },
          ],
        },
        { config: { approvalCallback: callback } },
      )
      expect(error).toBeNull()
      expect(callback).not.toHaveBeenCalled()
      const lateResponse = journal
        .filter((entry) => entry.kind === 'clientResponse')
        .find((entry) => (entry.result as { decision?: string } | null)?.decision != null)
      expect((lateResponse?.result as { decision?: string })?.decision).toBe('deny')
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    })

    it('todoList 映射：todo 更新映射 todo_write 工具对（对齐 Sdk 载具与方案映射表）', async () => {
      const todoItem = (items: unknown[]) => ({ type: 'todoList', id: 'todo-1', items })
      const { events, error } = await runScenario({
        steps: [
          {
            kind: 'notify',
            method: 'item/started',
            params: {
              threadId: THREAD_ID,
              turnId: 'server-turn-1',
              item: todoItem([{ content: 'a', status: 'pending' }]),
            },
          },
          {
            kind: 'notify',
            method: 'item/completed',
            params: {
              threadId: THREAD_ID,
              turnId: 'server-turn-1',
              item: todoItem([
                { content: 'a', status: 'completed' },
                { content: 'b', status: 'in_progress' },
              ]),
            },
          },
          agentMessageCompletedStep('done'),
        ],
      })
      expect(error).toBeNull()
      const toolCalls = eventsOf(events, 'tool_call')
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0]).toMatchObject({
        toolCallId: 'todo-1',
        toolName: 'todo_write',
        source: 'builtin',
      })
      const toolResults = eventsOf(events, 'tool_result')
      expect(toolResults.at(-1)).toMatchObject({
        toolCallId: 'todo-1',
        toolName: 'todo_write',
        status: 'success',
        output: {
          todos: [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'in_progress' },
          ],
        },
      })
    })

    it('error item 映射：条目级错误 emit CODEX_SDK_ITEM_ERROR（对齐 Sdk 载具）', async () => {
      const { events, error } = await runScenario({
        steps: [
          {
            kind: 'notify',
            method: 'item/completed',
            params: {
              threadId: THREAD_ID,
              turnId: 'server-turn-1',
              item: { type: 'error', id: 'err-1', message: 'tool exploded' },
            },
          },
          agentMessageCompletedStep('recovered'),
        ],
      })
      expect(error).toBeNull()
      expect(eventsOf(events, 'agent_error')[0]).toMatchObject({
        code: 'CODEX_SDK_ITEM_ERROR',
        message: 'tool exploded',
        retryable: true,
      })
    })

    it('Skills 上下文预算裁剪告警不会被映射成执行失败', async () => {
      const { events, error } = await runScenario({
        steps: [
          {
            kind: 'notify',
            method: 'item/completed',
            params: {
              threadId: THREAD_ID,
              turnId: 'server-turn-1',
              item: {
                type: 'error',
                id: 'skills-budget-warning-1',
                message:
                  'Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.',
              },
            },
          },
          agentMessageCompletedStep('continued normally'),
        ],
      })

      expect(error).toBeNull()
      expect(eventsOf(events, 'agent_error')).toHaveLength(0)
      expect(eventsOf(events, 'assistant_message').at(-1)).toMatchObject({
        content: 'continued normally',
      })
    })

    it('畸形形状防御：fileChange.changes 不可迭代时不崩溃，turn 正常完成', async () => {
      const { events, error } = await runScenario({
        steps: [
          {
            kind: 'notify',
            method: 'item/completed',
            params: {
              threadId: THREAD_ID,
              turnId: 'server-turn-1',
              item: { type: 'fileChange', id: 'fc-bad', status: 'completed', changes: 42 },
            },
          },
          agentMessageCompletedStep('survived'),
        ],
      })
      expect(error).toBeNull()
      expect(eventsOf(events, 'file_change')).toHaveLength(0)
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    })

    it('agentMessage 空完成文本：保留已流式累积的内容，不丢段', async () => {
      const { events, error } = await runScenario({
        steps: [agentMessageDeltaStep('重要结论'), agentMessageCompletedStep('')],
      })
      expect(error).toBeNull()
      const completes = assistantEvents(events, 'complete')
      expect((completes[0] as { content: string }).content).toBe('重要结论')
      const finalMessage = completes.at(-1)
      expect((finalMessage as { content: string }).content).toBe('重要结论')
      expect((finalMessage as { isFinal?: boolean }).isFinal).toBe(true)
    })

    it('通知处理链异常兜底：监听方抛错不穿透成进程崩溃，后续通知继续处理', async () => {
      const protocolErrors: string[] = []
      const { events, error } = await runScenario(
        {
          steps: [
            {
              kind: 'notify',
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: THREAD_ID,
                turnId: 'server-turn-1',
                tokenUsage: {
                  last: {
                    inputTokens: 1,
                    outputTokens: 1,
                    cachedInputTokens: 0,
                    reasoningOutputTokens: 0,
                    totalTokens: 2,
                  },
                  total: {
                    inputTokens: 10,
                    outputTokens: 5,
                    cachedInputTokens: 0,
                    reasoningOutputTokens: 0,
                    totalTokens: 15,
                  },
                },
              },
            },
            agentMessageDeltaStep('after failure'),
            agentMessageCompletedStep('after failure'),
          ],
        },
        {
          executor: {
            onProtocolError: (err) => protocolErrors.push(err.message),
          },
          onEvent: (event) => {
            // 模拟会话层持久化抛错（生产 0.10.13 主键冲突即此形态）。
            if (event.type === 'usage_update') throw new Error('persist failed')
          },
        },
      )
      expect(error).toBeNull()
      expect(protocolErrors.length).toBeGreaterThan(0)
      expect(protocolErrors[0]).toContain('notification handler failed')
      // 异常被隔离后，同轮后续通知（delta/complete/终态）不受影响。
      expect(
        assistantEvents(events, 'delta').map((e) => (e as { content: string }).content),
      ).toEqual(['after failure'])
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    })
  })

  describe('交互审批回路（P2-1）', () => {
    const approvalScenario = {
      serverRequests: [
        {
          method: 'item/commandExecution/requestApproval',
          params: { threadId: THREAD_ID, turnId: 'server-turn-1', command: 'rm -rf /tmp/x' },
        },
      ],
      steps: [agentMessageCompletedStep('after approval')],
    }

    it('approvalCallback 放行 → accept；回调收到 bash 入参；状态含 waiting_permission→thinking', async () => {
      const callback = vi.fn(
        async (
          _sid: string,
          _toolName: string,
          _toolInput: Record<string, unknown>,
          _context: unknown,
        ) => true,
      )
      const { journal, events, error } = await runScenario(approvalScenario, {
        config: { approvalCallback: callback },
      })
      expect(error).toBeNull()
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0]?.[1]).toBe('bash')
      expect(callback.mock.calls[0]?.[2]).toEqual({ command: 'rm -rf /tmp/x' })
      const clientResponse = journal.find((e) => e.kind === 'clientResponse')
      expect((clientResponse?.result as { decision?: string })?.decision).toBe('accept')
      const statuses = eventsOf(events, 'agent_status').map((e) => (e as { status: string }).status)
      expect(statuses).toContain('waiting_permission')
      expect(statuses.at(-1)).toBe('completed')
    })

    it('scope=session → acceptForSession', async () => {
      const callback = vi.fn(async () => ({ allowed: true, scope: 'session' as const }))
      const { journal } = await runScenario(approvalScenario, {
        config: { approvalCallback: callback },
      })
      const clientResponse = journal.find((e) => e.kind === 'clientResponse')
      expect((clientResponse?.result as { decision?: string })?.decision).toBe('acceptForSession')
    })

    it('回调拒绝 → deny，turn 正常完成', async () => {
      const callback = vi.fn(async () => ({ allowed: false }))
      const { journal, events, error } = await runScenario(approvalScenario, {
        config: { approvalCallback: callback },
      })
      expect(error).toBeNull()
      const clientResponse = journal.find((e) => e.kind === 'clientResponse')
      expect((clientResponse?.result as { decision?: string })?.decision).toBe('deny')
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    })

    it('回调抛错 → 确定性 deny 兜底，turn 不挂起', async () => {
      const callback = vi.fn(async () => {
        throw new Error('approval UI crashed')
      })
      const { journal, events, error } = await runScenario(approvalScenario, {
        config: { approvalCallback: callback },
      })
      expect(error).toBeNull()
      const clientResponse = journal.find((e) => e.kind === 'clientResponse')
      expect((clientResponse?.result as { decision?: string })?.decision).toBe('deny')
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'completed' })
    })

    it('unattended → 不调用回调，确定性 deny', async () => {
      const callback = vi.fn(async () => true)
      const { journal } = await runScenario(approvalScenario, {
        config: { approvalCallback: callback, unattended: true },
      })
      expect(callback).not.toHaveBeenCalled()
      const clientResponse = journal.find((e) => e.kind === 'clientResponse')
      expect((clientResponse?.result as { decision?: string })?.decision).toBe('deny')
    })

    it('审批挂起中 cancel → signal abort 释放回调，turn 走 cancelled 收尾', async () => {
      let observedAbort = false
      const callback = vi.fn(
        (
          _sid: string,
          _tool: string,
          _input: Record<string, unknown>,
          context: { signal: AbortSignal },
        ) =>
          new Promise<boolean>((_, reject) => {
            // AbortSignal 对已中止的信号不再派发事件：先查 aborted 再挂监听。
            if (context.signal.aborted) {
              observedAbort = true
              reject(new Error('aborted'))
              return
            }
            context.signal.addEventListener('abort', () => {
              observedAbort = true
              reject(new Error('aborted'))
            })
          }),
      )
      const { events, journal, error } = await runScenario(
        {
          serverRequests: approvalScenario.serverRequests,
          steps: [{ kind: 'waitInterrupt' }],
        },
        {
          config: { approvalCallback: callback },
          onEvent: (event, executor) => {
            if (event.type === 'agent_status' && event.status === 'waiting_permission') {
              // 回调尚未完成调用（emit 同步先行）：延后一个宏任务再取消，
              // 保证 abort 监听器已挂上——对应真实「用户看到审批卡后点取消」时序。
              setTimeout(() => executor.cancel(), 20)
            }
          },
        },
      )
      expect(error).toBeNull()
      expect(observedAbort).toBe(true)
      const clientResponse = journal.find((e) => e.kind === 'clientResponse')
      expect((clientResponse?.result as { decision?: string })?.decision).toBe('deny')
      expect(eventsOf(events, 'agent_status').at(-1)).toMatchObject({ status: 'cancelled' })
    })
  })

  describe('载具能力：steer / compact（P2-2，载具级、未接线会话层）', () => {
    it('能力守卫：app-server 载具具备 steer/compact，其他 codex 载具不具备', () => {
      expect(isSteerCapable(new CodexAppServerExecutor())).toBe(true)
      expect(isCompactCapable(new CodexAppServerExecutor())).toBe(true)
      expect(isSteerCapable({ cancel: () => undefined } as EngineExecutor)).toBe(false)
      expect(isCompactCapable({ cancel: () => undefined } as EngineExecutor)).toBe(false)
    })

    it('steer：turn 进行中发 turn/steer（input 数组 + expectedTurnId）', async () => {
      const { journal, error } = await runScenario(
        { steps: [agentMessageDeltaStep('partial'), { kind: 'waitInterrupt' }] },
        {
          onEvent: (event, executor) => {
            if (event.type === 'assistant_message' && event.mode === 'delta') {
              void executor
                .steer('补充要求：改用中文回答')
                .then(() => {
                  executor.cancel()
                })
                .catch(() => {
                  executor.cancel()
                })
            }
          },
        },
      )
      expect(error).toBeNull()
      const steerRequest = journal.find((e) => e.kind === 'request' && e.method === 'turn/steer')
      expect(steerRequest?.params).toMatchObject({
        input: [{ type: 'text', text: '补充要求：改用中文回答' }],
      })
      expect((steerRequest?.params as { expectedTurnId?: string })?.expectedTurnId).toBe(
        'server-turn-1',
      )
    })

    it('compact：turn 进行中发 thread/compact/start', async () => {
      const { journal, error } = await runScenario(
        { steps: [agentMessageDeltaStep('partial'), { kind: 'waitInterrupt' }] },
        {
          onEvent: (event, executor) => {
            if (event.type === 'assistant_message' && event.mode === 'delta') {
              void executor
                .compact()
                .then(() => {
                  executor.cancel()
                })
                .catch(() => {
                  executor.cancel()
                })
            }
          },
        },
      )
      expect(error).toBeNull()
      expect(journal.some((e) => e.kind === 'request' && e.method === 'thread/compact/start')).toBe(
        true,
      )
    })

    it('无活动 turn 时 steer/compact 抛出描述性错误', async () => {
      const executor = new CodexAppServerExecutor()
      await expect(executor.steer('x')).rejects.toThrow('no active codex app-server turn')
      await expect(executor.compact()).rejects.toThrow('no active codex app-server thread')
    })
  })
})
