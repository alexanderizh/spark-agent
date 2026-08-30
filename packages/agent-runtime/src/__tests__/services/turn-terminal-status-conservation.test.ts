import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import {
  EventRepository,
  ProviderProfileRepository,
  SessionRepository,
  SparkDatabase,
} from '@spark/storage'

/**
 * 轮次终态守恒 —— 「思考日志一直显示运行中」断流问题的行为锁。
 *
 * 两个守恒层：
 *   ① settle 层兜底：executor 结束（then/catch）却从未 emit 终态时，合成
 *      completed / error 终态落库，保证每个 turn 100% 以终态事件收尾；
 *   ② getHistory 懒恢复：sessions.status='running' 但主进程无任何执行
 *      （进程重启硬杀 / 执行器死亡 / 启动恢复未覆盖）时，打开会话补齐
 *      断流轮终态并把状态落回 idle。
 *
 * 任何一层失守，历史重放出的消息都会永远停留在 streaming。
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
const { fakeEngineInstances, queueFakeEngineScript, resetFakeEngineHarness } =
  await import('../sdk/fake-engine-executor.js')

interface EngineFixture {
  adapter: 'claude-sdk' | 'codex'
  providerType: string
  modelId: string
}

const ENGINES: EngineFixture[] = [
  { adapter: 'claude-sdk', providerType: 'anthropic', modelId: 'claude-sonnet-5' },
  { adapter: 'codex', providerType: 'openai', modelId: 'gpt-5' },
]

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'error'])

interface PersistedStatus {
  turnId: string
  status: string
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.each(ENGINES)('轮次终态守恒（$adapter 引擎）', (engine) => {
  let db: SparkDatabase
  let service: InstanceType<typeof SessionService>
  let sessionRepo: SessionRepository
  let eventRepo: EventRepository
  let sessionId: string
  let testDir: string

  beforeEach(async () => {
    resetFakeEngineHarness()
    testDir = mkdtempSync(path.join(tmpdir(), `spark-terminal-conservation-${engine.adapter}-`))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    new ProviderProfileRepository(db).create({
      id: 'provider-conservation',
      providerType: engine.providerType,
      name: 'Conservation Provider',
      config: { defaultModel: engine.modelId, modelIds: [engine.modelId] },
      keystoreRef: 'key-conservation',
      isDefault: true,
    })

    service = new SessionService(db, () => {})
    const created = await service.createSession({
      providerProfileId: 'provider-conservation',
      modelId: engine.modelId,
      agentAdapter: engine.adapter,
    })
    sessionId = created.sessionId
    sessionRepo = new SessionRepository(db)
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

  function loadTerminalStatuses(turnId?: string): PersistedStatus[] {
    return eventRepo.queryAllBySession(sessionId).flatMap((row) => {
      if (row.event_type !== 'agent_status' || row.turn_id == null) return []
      if (turnId != null && row.turn_id !== turnId) return []
      const event = JSON.parse(row.event_json) as AgentEvent
      if (event.type !== 'agent_status') return []
      return [{ turnId: row.turn_id, status: String(event.status) }]
    })
  }

  function countTerminal(turnId?: string): number {
    return loadTerminalStatuses(turnId).filter((item) => TERMINAL_STATUSES.has(item.status)).length
  }

  async function sendTurnAndWaitSettled(message: string): Promise<string> {
    const started = await service.sendTurn({ sessionId, message })
    expect(started.started).toBe(true)
    const turnId = started.turnId
    // 轮次终态落库（executor 终态或合成兜底终态都算），再让出一拍等所有权回收。
    await waitUntil(() => countTerminal(turnId) > 0, 5000, `terminal for turn ${turnId}`)
    await new Promise((resolve) => setTimeout(resolve, 80))
    return turnId
  }

  it('① executor 正常结束但从未 emit 终态 → 合成 completed 落库', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'did the work', isFinal: true }],
      terminalStatus: null,
    })
    const turnId = await sendTurnAndWaitSettled('no terminal please')

    const terminals = loadTerminalStatuses(turnId).filter((item) =>
      TERMINAL_STATUSES.has(item.status),
    )
    expect(terminals).toHaveLength(1)
    expect(terminals[0]?.status).toBe('completed')
    // 合成终态带 message 区分来源（completed 不带，与正常 completed 同形）
    expect(sessionRepo.get(sessionId)?.status).not.toBe('running')
  })

  it('② executor 异常退出且从未 emit 终态 → 合成 error 落库', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'partial', isFinal: false }],
      terminalStatus: null,
      rejectWith: new Error('engine died silently'),
    })
    const turnId = await sendTurnAndWaitSettled('fail without terminal')

    const terminals = loadTerminalStatuses(turnId).filter((item) =>
      TERMINAL_STATUSES.has(item.status),
    )
    expect(terminals).toHaveLength(1)
    expect(terminals[0]?.status).toBe('error')
    expect(sessionRepo.get(sessionId)?.status).toBe('error')
  })

  it('③ executor 正常 emit 终态 → 不产生合成重复终态', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'all good', isFinal: true }],
      terminalStatus: 'completed',
    })
    const turnId = await sendTurnAndWaitSettled('normal turn')

    expect(countTerminal(turnId)).toBe(1)
    expect(sessionRepo.get(sessionId)?.status).not.toBe('running')
  })

  it('③b 终态即时广播：终态先于 promise 收尾落库，会话状态仍等收尾落定', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'content done', isFinal: true }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    const started = await service.sendTurn({ sessionId, message: 'immediate terminal' })
    expect(started.started).toBe(true)
    const executor = fakeEngineInstances()[0]
    if (executor == null) throw new Error('executor was never created')
    await waitUntil(() => executor.holding, 5000, 'executor holding')

    // promise 仍挂起、settle/后处理都未跑：终态必须已即时落库（UI 立即收尾）。
    expect(countTerminal(started.turnId)).toBe(1)
    // 会话级状态与队列推进同一时序，此刻仍是 running。
    expect(sessionRepo.get(sessionId)?.status).toBe('running')

    executor.release()
    await waitUntil(
      () => sessionRepo.get(sessionId)?.status !== 'running',
      5000,
      'session settles after release',
    )
    // settle 不重复补发终态。
    expect(countTerminal(started.turnId)).toBe(1)
  })

  it('③c 流中途可重试 error（无 result 标记）不落终态：唯一终态为最终 completed', async () => {
    queueFakeEngineScript({
      events: [
        { type: 'assistant_message', content: 'working', isFinal: false },
        // 模拟映射层对「assistant 消息带 error 字段」的中途 error：无 terminalSource 标记。
        { type: 'agent_status', status: 'error', message: 'rate limited, retrying' },
        { type: 'assistant_message', content: 'recovered and finished', isFinal: true },
      ],
      terminalStatus: 'completed',
    })
    const turnId = await sendTurnAndWaitSettled('retry then finish')

    // 中途 error 被扣留不广播不落库，一轮只有一个终态且是最终 completed。
    expect(loadTerminalStatuses(turnId)).toEqual([{ turnId, status: 'completed' }])
    expect(sessionRepo.get(sessionId)?.status).not.toBe('running')
  })

  it('③d 无标记 error 终态被扣留后由 settle 补发：终态不丢失', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'partial', isFinal: false }],
      // FakeEngine 的终态不带 terminalSource 标记：claude 路径应扣留到 settle 补发。
      terminalStatus: 'error',
    })
    const turnId = await sendTurnAndWaitSettled('fail with held terminal')

    expect(loadTerminalStatuses(turnId)).toEqual([{ turnId, status: 'error' }])
    expect(sessionRepo.get(sessionId)?.status).toBe('error')
  })

  it('③e result 标记的 error 终态即时广播，settle 不重复补发', async () => {
    queueFakeEngineScript({
      events: [
        { type: 'assistant_message', content: 'done', isFinal: true },
        { type: 'agent_status', status: 'error', terminalSource: 'result' },
      ],
      terminalStatus: null,
      holdForRelease: true,
    })
    const started = await service.sendTurn({ sessionId, message: 'result error terminal' })
    expect(started.started).toBe(true)
    const executor = fakeEngineInstances()[0]
    if (executor == null) throw new Error('executor was never created')
    await waitUntil(() => executor.holding, 5000, 'executor holding')

    // promise 仍挂起：result 派生的 error 终态必须已即时落库。
    expect(loadTerminalStatuses(started.turnId)).toEqual([
      { turnId: started.turnId, status: 'error' },
    ])
    expect(sessionRepo.get(sessionId)?.status).toBe('running')

    executor.release()
    await waitUntil(
      () => sessionRepo.get(sessionId)?.status !== 'running',
      5000,
      'session settles after release',
    )
    // settle 不重复补发。
    expect(countTerminal(started.turnId)).toBe(1)
  })

  describe('④⑤⑥ getHistory 僵尸懒恢复', () => {
    /** 直接向库内写入一段「断流轮」事件：有正文、无终态。 */
    function insertInterruptedTurn(turnId: string, turnIndex: number): void {
      const insert = (event: AgentEvent) => {
        eventRepo.insertBatch([
          {
            id: event.id,
            sessionId,
            turnId,
            eventType: event.type,
            eventJson: JSON.stringify(event),
          },
        ])
      }
      const base = (type: AgentEvent['type'], extra: Record<string, unknown>) => ({
        id: `evt-${turnId}-${type}-${turnIndex}`,
        type,
        sessionId,
        turnId,
        timestamp: new Date(Date.now() + turnIndex).toISOString(),
        seq: 0,
        ...extra,
      })
      insert(base('user_message', { content: `user ${turnIndex}` }) as AgentEvent)
      insert(base('agent_thinking', { content: 'thinking hard', mode: 'complete' }) as AgentEvent)
      insert(
        base('assistant_message', {
          content: `partial ${turnIndex}`,
          mode: 'complete',
        }) as AgentEvent,
      )
    }

    it('④ status=running 且无执行 → getHistory 补齐断流轮终态并落回 idle', async () => {
      const zombieTurnA = 'zombie-turn-a'
      const zombieTurnB = 'zombie-turn-b'
      insertInterruptedTurn(zombieTurnA, 1)
      insertInterruptedTurn(zombieTurnB, 2)
      sessionRepo.updateStatus(sessionId, 'running')

      // 构造期已过（SessionService 创建于 beforeEach），此刻库态即「进程重启后」的僵尸形态。
      const history = await service.getHistory({ sessionId, turnLimit: 10 })

      expect(sessionRepo.get(sessionId)?.status).toBe('idle')
      // 多个断流轮都被补齐，且补的是 cancelled（中断语义，与重启恢复事件一致）
      expect(loadTerminalStatuses(zombieTurnA)).toEqual([
        { turnId: zombieTurnA, status: 'cancelled' },
      ])
      expect(loadTerminalStatuses(zombieTurnB)).toEqual([
        { turnId: zombieTurnB, status: 'cancelled' },
      ])
      // 懒恢复发生在查询前：本次返回的事件里已包含收尾，渲染端正常重放即可复位。
      const returnedTerminals = history.events.filter(
        (event) =>
          event.type === 'agent_status' &&
          TERMINAL_STATUSES.has(String((event as { status?: unknown }).status)),
      )
      expect(returnedTerminals.length).toBeGreaterThanOrEqual(2)
      // 补发的 agent_error(APP_RESTARTED) 说明事件也一并下发
      expect(
        history.events.some(
          (event) => event.type === 'agent_error' && event.code === 'APP_RESTARTED',
        ),
      ).toBe(true)
    })

    it('⑤ 会话在跑（executor 存活）→ getHistory 不做懒恢复', async () => {
      queueFakeEngineScript({
        events: [{ type: 'assistant_message', content: 'working', isFinal: false }],
        terminalStatus: null,
        holdForRelease: true,
      })
      const started = await service.sendTurn({ sessionId, message: 'long turn' })
      expect(started.started).toBe(true)
      const executor = fakeEngineInstances()[0]
      if (executor == null) throw new Error('executor was never created')
      await waitUntil(() => executor.holding, 5000, 'executor holding')
      expect(sessionRepo.get(sessionId)?.status).toBe('running')

      await service.getHistory({ sessionId, turnLimit: 10 })

      // 无终态补发、状态不被误杀：轮次还在跑。
      expect(countTerminal()).toBe(0)
      expect(sessionRepo.get(sessionId)?.status).toBe('running')

      executor.release()
      await waitUntil(() => countTerminal(started.turnId) > 0, 5000, 'turn terminal after release')
    })

    it('⑥ 非 running 会话 getHistory 零额外写入', async () => {
      const zombieTurn = 'already-idle-turn'
      insertInterruptedTurn(zombieTurn, 1)
      sessionRepo.updateStatus(sessionId, 'idle')

      const before = eventRepo.queryAllBySession(sessionId).length
      await service.getHistory({ sessionId, turnLimit: 10 })
      const after = eventRepo.queryAllBySession(sessionId).length

      expect(after).toBe(before)
      expect(sessionRepo.get(sessionId)?.status).toBe('idle')
    })
  })
})
