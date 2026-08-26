import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import {
  EventRepository,
  ProviderProfileRepository,
  SettingsRepository,
  SparkDatabase,
} from '@spark/storage'

/**
 * 守卫测试：会话运行中发送 /xxx 命令时的排队行为。
 *
 * 契约（2026-08-26 修复）：
 *   - 会话有活跃执行时命令作为命令 turn 进入会话队列（queuedTurns 可见），
 *     不再绕过队列直接把结果事件注入正在运行的事件流；
 *   - 当前 turn 结束后由 startNextQueuedTurn 按 FIFO 出队执行命令本体；
 *   - 带 followUpPrompt 的命令出队执行后，follow-up turn 正常起跑；
 *   - goal 生命周期控制命令（/goal pause 等）豁免排队，立即执行。
 */

const keystoreGetSecret = vi.hoisted(() => vi.fn(async () => 'test-api-key'))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: keystoreGetSecret,
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('../../services/debug-log-server.service.js', () => ({
  getDebugLogServer: () => ({ start: async () => 43123 }),
}))

vi.mock('../../sdk/codex-app-server/codex-app-server-runtime.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../sdk/codex-app-server/codex-app-server-runtime.js')>()
  return { ...actual, isPersistentCodexRuntimeEnabled: () => false }
})

vi.mock('../../sdk/index.js', async () => {
  const { FakeEngineExecutor } = await import('../sdk/fake-engine-executor.js')
  return {
    isSDKAvailable: vi.fn(async () => true),
    loadSdkMcpFactory: vi.fn(async () => ({
      createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => ({
        type: 'sdk',
        name: opts.name,
        instance: { tools: opts.tools },
      }),
      tool: (
        name: string,
        _description: string,
        _inputSchema: Record<string, unknown>,
        handler: unknown,
      ) => ({ name, handler }),
    })),
    getResumeCircuitBreaker: vi.fn(() => ({
      recordSuccess: () => {},
      recordFailure: () => {},
      shouldSkipResume: () => false,
    })),
    ClaudeSDKExecutor: FakeEngineExecutor,
    CodexSdkExecutor: FakeEngineExecutor,
    CodexCliExecutor: FakeEngineExecutor,
    CodexOpenAIExecutor: FakeEngineExecutor,
    CodexAppServerExecutor: FakeEngineExecutor,
  }
})

const { SessionService } = await import('../../services/session.service.js')
const { fakeEngineInstances, queueFakeEngineScript, resetFakeEngineHarness } = await import(
  '../sdk/fake-engine-executor.js'
)

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('命令在运行中会话的排队行为', () => {
  let db: SparkDatabase
  let service: InstanceType<typeof SessionService>
  let sessionId: string
  let eventRepo: EventRepository
  let testDir: string
  const events: AgentEvent[] = []

  beforeEach(async () => {
    resetFakeEngineHarness()
    events.length = 0
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-cmd-queue-'))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    new ProviderProfileRepository(db).create({
      id: 'provider-cmd-queue',
      providerType: 'anthropic',
      name: 'Cmd Queue Provider',
      config: { defaultModel: 'claude-sonnet-5', modelIds: ['claude-sonnet-5'] },
      keystoreRef: 'key-cmd-queue',
      isDefault: true,
    })

    service = new SessionService(db, (event) => events.push(event))
    const created = await service.createSession({
      providerProfileId: 'provider-cmd-queue',
      modelId: 'claude-sonnet-5',
      agentAdapter: 'claude-sdk',
    })
    sessionId = created.sessionId
    eventRepo = new EventRepository(db)
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      /* db already closed */
    }
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      /* Windows 句柄延迟释放时的残留目录交给系统临时区清理 */
    }
  })

  function persisted(): Array<{ seq: number; type: string; turnId: string; content: string }> {
    return eventRepo.queryAllBySession(sessionId).flatMap((row) =>
      row.seq != null && row.turn_id != null && row.event_type != null
        ? [
            {
              seq: row.seq,
              type: row.event_type,
              turnId: row.turn_id,
              content: (() => {
                try {
                  return (JSON.parse(row.event_json) as { content?: string }).content ?? ''
                } catch {
                  return ''
                }
              })(),
            },
          ]
        : [],
    )
  }

  /** 起跑一个挂起不结束的 turn（事件先注入，然后挂起等 release）。 */
  async function startHeldTurn(content: string) {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content, isFinal: false }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    await service.sendTurn({ sessionId, message: content })
    const executor = fakeEngineInstances()[0]
    if (executor == null) throw new Error('executor was never created')
    await waitUntil(() => executor.holding, 5000, 'executor holding')
    return executor
  }

  it('运行中发送 /status：命令入队不注入事件；turn 结束后自动出队执行', async () => {
    const executorA = await startHeldTurn('turn A working')
    const turnARow = persisted().find((r) => r.type === 'assistant_message')
    const eventCountWhileRunning = persisted().length

    const result = await service.executeCommandAsEvents({ sessionId, message: '/status' })

    // 入队反馈：queued 标记 + 队列里能看到命令
    expect(result).toEqual({ isCommand: true, forwardToAgent: false, queued: true })
    const queue = service.getQueueState({ sessionId })
    expect(queue.running).toBe(true)
    expect(queue.queuedTurns).toHaveLength(1)
    expect(queue.queuedTurns[0]?.message).toBe('/status')

    // 命令没有绕过队列：turn A 运行期间事件流无新增
    expect(persisted()).toHaveLength(eventCountWhileRunning)

    // turn A 结束 → 命令出队执行：命令 user_message + assistant_message 注入，
    // 且不混入 turn A 的事件（独立 turnId）
    executorA.release()
    await waitUntil(
      () =>
        persisted().some(
          (r) => r.type === 'user_message' && r.content === '/status' && r.turnId !== turnARow?.turnId,
        ),
      5000,
      'command user_message injected after turn A completes',
    )
    const commandRows = persisted().filter((r) => r.turnId !== turnARow?.turnId)
    expect(commandRows.map((r) => r.type)).toContain('assistant_message')

    // 命令执行完成后队列排空
    await waitUntil(
      () => service.getQueueState({ sessionId }).queuedTurns.length === 0,
      5000,
      'queue drained',
    )
  })

  it('运行中发送带 followUpPrompt 的命令：命令入队，turn 结束后命令执行且 follow-up 起跑', async () => {
    // 注册一个自定义命令 /validate（prompt → followUpPrompt 路径）
    new SettingsRepository(db).set(
      'custom-commands',
      'items',
      JSON.stringify([
        {
          id: 'validate',
          name: '/validate',
          description: 'Validate workspace',
          prompt: '验证当前工作区：',
          script: '',
          scriptLanguage: 'javascript',
          enabled: true,
        },
      ]),
    )

    const executorA = await startHeldTurn('turn A working')
    const turnARow = persisted().find((r) => r.type === 'assistant_message')
    const eventCountWhileRunning = persisted().length

    const result = await service.executeCommandAsEvents({ sessionId, message: '/validate' })
    expect(result.queued).toBe(true)
    expect(persisted()).toHaveLength(eventCountWhileRunning)

    // turn A 结束 → 命令执行（事件注入）→ follow-up turn 起跑（executor B 挂起）
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'follow-up working', isFinal: false }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    executorA.release()
    await waitUntil(() => fakeEngineInstances().length >= 2, 5000, 'follow-up executor created')
    const executorB = fakeEngineInstances()[1]!

    const commandRows = persisted().filter((r) => r.turnId !== turnARow?.turnId)
    expect(commandRows.some((r) => r.type === 'user_message' && r.content === '/validate')).toBe(true)

    executorB.release()
    await waitUntil(
      () => service.getQueueState({ sessionId }).queuedTurns.length === 0,
      5000,
      'queue drained',
    )
  })

  it('队列 FIFO：运行中先发命令再发普通消息，命令先出队执行、消息随后起跑', async () => {
    const executorA = await startHeldTurn('turn A working')
    const turnARow = persisted().find((r) => r.type === 'assistant_message')

    await service.executeCommandAsEvents({ sessionId, message: '/status' })
    // follow-up 队列脚本：命令后的普通消息 B
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'turn B working', isFinal: false }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    await service.sendTurn({ sessionId, message: 'turn B message' })

    const queue = service.getQueueState({ sessionId })
    expect(queue.queuedTurns.map((t) => t.message)).toEqual(['/status', 'turn B message'])

    executorA.release()
    // 命令先执行（事件注入）
    await waitUntil(
      () =>
        persisted().some(
          (r) => r.type === 'user_message' && r.content === '/status' && r.turnId !== turnARow?.turnId,
        ),
      5000,
      'command executed before turn B',
    )
    // turn B 随后起跑
    await waitUntil(() => fakeEngineInstances().length >= 2, 5000, 'turn B executor created')
    const executorB = fakeEngineInstances()[1]!
    await waitUntil(() => executorB.holding, 5000, 'turn B holding')

    // 顺序断言：普通 turn 的用户输入落在 turn_prompt_snapshot（user_message 是命令
    // turn 专属的注入事件），用两者的 seq 锁定出队顺序：命令先、turn B 后。
    const commandUserSeq = persisted().find(
      (r) => r.type === 'user_message' && r.content === '/status',
    )?.seq
    const turnBPromptSeq = persisted().find(
      (r) => r.type === 'turn_prompt_snapshot' && r.turnId !== turnARow?.turnId,
    )?.seq
    expect(commandUserSeq).toBeDefined()
    expect(turnBPromptSeq).toBeDefined()
    expect(commandUserSeq!).toBeLessThan(turnBPromptSeq!)

    executorB.release()
    await waitUntil(
      () => service.getQueueState({ sessionId }).queuedTurns.length === 0,
      5000,
      'queue drained',
    )
  })

  it('goal 生命周期控制命令豁免排队：运行中发送立即执行、不入队', async () => {
    const executorA = await startHeldTurn('turn A working')
    const turnARow = persisted().find((r) => r.type === 'assistant_message')

    const result = await service.executeCommandAsEvents({ sessionId, message: '/goal pause' })

    // 豁免：不返回 queued、不进队列
    expect(result.queued).toBeUndefined()
    const queue = service.getQueueState({ sessionId })
    expect(queue.queuedTurns).toHaveLength(0)

    // 命令结果立即注入（turn A 还在跑）——控制语义要求立即可见
    const commandRows = persisted().filter((r) => r.turnId !== turnARow?.turnId)
    expect(commandRows.some((r) => r.type === 'user_message' && r.content === '/goal pause')).toBe(
      true,
    )

    executorA.release()
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
})
