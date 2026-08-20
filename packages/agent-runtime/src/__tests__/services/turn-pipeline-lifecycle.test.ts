import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import {
  EventRepository,
  GoalRepository,
  ProviderProfileRepository,
  SessionRepository,
  SparkDatabase,
} from '@spark/storage'

/**
 * Turn 管道生命周期基线（W2-D0）—— 统一 turn 管道重构前的安全网。
 *
 * W1 的 turn-pipeline-baseline 锁定了单 turn 的正常路径 / cancel / resume；
 * W2 要动的是队列推进、并发上限、终态扣留时序、plan 审批闸门、dispose 等待
 * 这些**生命周期协作语义**，这里在未改动的现状代码上先把它们钉成断言：
 *   ④ 同会话队列推进：turn A 未结束前 B 只入队不启动，A 收尾后 B 自动起跑
 *   ⑤ 全局并发上限：第 maxConcurrentSessions+1 个 turn 留在队列，槽位释放后被调度
 *   ⑥ 终态扣留：executor 已 emit 终态但 executeTurn 未 resolve 时，终态不落库
 *   ⑦ dispose：cancel 传播到在飞执行器，且等待执行 promise settle 后才返回
 *   ⑧ plan 审批闸门：plan_proposed 后自动推进暂停，rejectPlan 解除并恢复
 *     （注意现状语义：用户提交新 turn 本身会解除闸门 —— B 必须先于 plan_proposed 入队）
 *   ⑨ error 收场：executor 先 emit error 终态再 reject → 扣留补发落库、会话标 error
 *
 * W2 每一步（TurnRegistry / Runner 提炼）都要求本文件与 W1 基线「不改一字全绿」；
 * W2-D3 的 codex 行为补齐（标题精炼 / goal 解析）落地时再显式更新对应断言。
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
const { fakeEngineCalls, fakeEngineInstances, queueFakeEngineScript, resetFakeEngineHarness } =
  await import('../sdk/fake-engine-executor.js')

interface PersistedEvent {
  seq: number
  turnId: string
  type: string
  event: AgentEvent
}

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
/** 与 session.service 的 DEFAULT_MAX_CONCURRENT_SESSIONS 保持一致（改默认值时同步更新）。 */
const MAX_CONCURRENT_SESSIONS = 6

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.each(ENGINES)('turn 管道生命周期基线（$adapter 引擎）', (engine) => {
  let db: SparkDatabase
  let service: InstanceType<typeof SessionService>
  let sessionId: string
  let eventRepo: EventRepository
  let testDir: string

  beforeEach(async () => {
    resetFakeEngineHarness()
    testDir = mkdtempSync(path.join(tmpdir(), `spark-turn-lifecycle-${engine.adapter}-`))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    new ProviderProfileRepository(db).create({
      id: 'provider-lifecycle',
      providerType: engine.providerType,
      name: 'Lifecycle Provider',
      config: { defaultModel: engine.modelId, modelIds: [engine.modelId] },
      keystoreRef: 'key-lifecycle',
      isDefault: true,
    })

    service = new SessionService(db, () => {})
    const created = await service.createSession({
      providerProfileId: 'provider-lifecycle',
      modelId: engine.modelId,
      agentAdapter: engine.adapter,
    })
    sessionId = created.sessionId
    eventRepo = new EventRepository(db)
  })

  afterEach(() => {
    // Windows 上 SQLite 句柄不释放则 rmSync 报 EBUSY：先关库，清理失败也不掩盖测试结果。
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

  function loadPersistedEvents(): PersistedEvent[] {
    return eventRepo.queryAllBySession(sessionId).flatMap((row) => {
      if (row.seq == null || row.turn_id == null) return []
      return [
        {
          seq: row.seq,
          turnId: row.turn_id,
          type: row.event_type,
          event: JSON.parse(row.event_json) as AgentEvent,
        },
      ]
    })
  }

  async function waitForTurnTerminal(timeoutMs = 5000, turnId?: string): Promise<PersistedEvent> {
    const isTerminal = (entry: PersistedEvent): boolean =>
      entry.type === 'agent_status' &&
      TERMINAL_STATUSES.has(String((entry.event as { status?: unknown }).status)) &&
      (turnId == null || entry.turnId === turnId)
    await waitUntil(() => loadPersistedEvents().some(isTerminal), timeoutMs, 'turn terminal event')
    // 终态落库后 .then/.finally 收尾仍在微任务队列里；让出一拍确保所有权回收完成。
    await new Promise((resolve) => setTimeout(resolve, 50))
    const terminal = loadPersistedEvents().find(isTerminal)
    if (terminal == null) throw new Error('terminal event disappeared after settle')
    return terminal
  }

  it('在引擎准备前持久化带 client id 的用户消息，并抑制 executor 重复事件', async () => {
    queueFakeEngineScript({
      events: [
        { type: 'user_message', content: 'executor duplicate' },
        { type: 'assistant_message', content: 'done', isFinal: true },
      ],
      terminalStatus: 'completed',
    })
    const submitted = await service.submitTurn({
      sessionId,
      message: 'visible immediately',
      clientMessageId: '00000000-0000-4000-8000-000000000123',
    })

    expect(submitted).toMatchObject({ accepted: true, started: true })
    await waitUntil(
      () => loadPersistedEvents().some((entry) => entry.type === 'user_message'),
      5000,
      'authoritative user message',
    )
    const beforeTerminal = loadPersistedEvents().filter(
      (entry) => entry.turnId === submitted.turnId && entry.type === 'user_message',
    )
    expect(beforeTerminal).toHaveLength(1)
    expect(beforeTerminal[0]?.event).toMatchObject({
      content: 'visible immediately',
      clientMessageId: '00000000-0000-4000-8000-000000000123',
    })

    await waitForTurnTerminal(5000, submitted.turnId)
    expect(
      loadPersistedEvents().filter(
        (entry) => entry.turnId === submitted.turnId && entry.type === 'user_message',
      ),
    ).toHaveLength(1)
  })

  it('④ 队列推进：A 未结束 B 只入队，A 收尾后 B 自动起跑', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'a working', isFinal: false }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    const first = await service.sendTurn({ sessionId, message: 'turn a' })
    expect(first.started).toBe(true)

    const executorA = fakeEngineInstances()[0]
    if (executorA == null) throw new Error('executor A was never created')
    await waitUntil(() => executorA.holding, 5000, 'executor A holding')

    // A 占据会话执行位：B 到达只入队，不创建执行器。
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'b done', isFinal: true }],
      terminalStatus: 'completed',
    })
    const second = await service.sendTurn({ sessionId, message: 'turn b' })
    expect(fakeEngineCalls()).toHaveLength(1)

    // 放行 A：终态落库、所有权回收，随后队列自动把 B 顶出来。
    executorA.release()
    const firstTerminal = await waitForTurnTerminal(5000, first.turnId)
    expect((firstTerminal.event as { status?: unknown }).status).toBe('completed')

    await waitUntil(() => fakeEngineCalls().length === 2, 5000, 'queued turn B auto-starts')
    const secondTerminal = await waitForTurnTerminal(5000, second.turnId)
    expect((secondTerminal.event as { status?: unknown }).status).toBe('completed')
    expect(new SessionRepository(db).get(sessionId)?.status).toBe('idle')

    // B 的执行器消息属于 B 自己的 turn（队列重放没有串位）。
    const bMessages = loadPersistedEvents().filter(
      (entry) => entry.turnId === second.turnId && entry.type === 'assistant_message',
    )
    expect(bMessages.length).toBeGreaterThan(0)
  })

  it('⑤ 全局并发上限：第 7 个 turn 入队等待，槽位释放后自动调度', async () => {
    // 并发上限是单个 SessionService 实例的全局状态（生产环境主进程单例）：
    // 全部会话必须挂在同一个 service 上，跨会话占用才计入同一上限。
    try {
      for (let i = 0; i < MAX_CONCURRENT_SESSIONS; i += 1) {
        const created = await service.createSession({
          providerProfileId: 'provider-lifecycle',
          modelId: engine.modelId,
          agentAdapter: engine.adapter,
        })
        queueFakeEngineScript({
          events: [{ type: 'assistant_message', content: `holding ${i}`, isFinal: false }],
          terminalStatus: 'completed',
          holdForRelease: true,
        })
        const sent = await service.sendTurn({
          sessionId: created.sessionId,
          message: `hold ${i}`,
        })
        expect(sent.started).toBe(true)
      }

      // 全部进入 hold 后，主 harness 会话的第 7 个 turn 只能入队。
      await waitUntil(
        () => fakeEngineInstances().every((instance) => instance.holding),
        5000,
        'all six holders holding',
      )
      expect(fakeEngineCalls()).toHaveLength(MAX_CONCURRENT_SESSIONS)

      queueFakeEngineScript({
        events: [{ type: 'assistant_message', content: 'seventh', isFinal: true }],
        terminalStatus: 'completed',
      })
      const overflow = await service.sendTurn({ sessionId, message: 'overflow turn' })
      // 调度器是异步的（setTimeout 0）：给一次调度机会后仍不得启动。
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(fakeEngineCalls()).toHaveLength(MAX_CONCURRENT_SESSIONS)

      // 释放第一个槽位：全局调度把排队的 turn 放出来。
      const firstHolder = fakeEngineInstances()[0]
      if (firstHolder == null) throw new Error('first holder missing')
      firstHolder.release()
      await waitUntil(
        () => fakeEngineCalls().length === MAX_CONCURRENT_SESSIONS + 1,
        5000,
        'overflow turn scheduled after slot release',
      )
      const overflowTerminal = await waitForTurnTerminal(5000, overflow.turnId)
      expect((overflowTerminal.event as { status?: unknown }).status).toBe('completed')
    } finally {
      // 收尾：放行其余 holder，让 afterEach 关库前不残留在飞执行。
      for (const instance of fakeEngineInstances().slice(1, MAX_CONCURRENT_SESSIONS)) {
        instance.release()
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })

  it('⑥ 终态即时广播：executor emit 终态后立即落库，不等 promise resolve', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'settling', isFinal: true }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    const { turnId } = await service.sendTurn({ sessionId, message: 'hold terminal' })

    const executor = fakeEngineInstances()[0]
    if (executor == null) throw new Error('executor was never created')
    await waitUntil(() => executor.holding, 5000, 'executor holding after terminal emit')

    // 执行器已 emit completed 且 promise 尚未 resolve：终态必须已经即时落库
    // （历史实测 SDK 流关闭比完成信号晚数秒，扣到收尾会让 UI 在内容已完成后
    // 继续显示「进行中」）。
    expect(
      executor.emitted.some(
        (event) => event.type === 'agent_status' && event.status === 'completed',
      ),
    ).toBe(true)
    const persistedWhileHolding = loadPersistedEvents().filter(
      (entry) => entry.turnId === turnId && entry.type === 'agent_status',
    )
    expect(persistedWhileHolding).toHaveLength(1)
    expect((persistedWhileHolding[0]!.event as { status?: unknown }).status).toBe('completed')

    // 会话级状态仍等 promise 收尾（updateStatusAfterHostTerminal 与队列推进
    // 保持同一时序），此刻尚未落定。
    expect(new SessionRepository(db).get(sessionId)?.status).toBe('running')

    executor.release()
    const terminal = await waitForTurnTerminal(5000, turnId)
    expect((terminal.event as { status?: unknown }).status).toBe('completed')

    // settle 不重复补发：终态全程只有一条。
    expect(
      loadPersistedEvents().filter(
        (entry) => entry.turnId === turnId && entry.type === 'agent_status',
      ),
    ).toHaveLength(1)
  })

  it('⑦ dispose：cancel 传播到在飞执行器并等待执行 promise settle', async () => {
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'in flight', isFinal: false }],
      terminalStatus: 'completed',
      holdForRelease: true,
    })
    await service.sendTurn({ sessionId, message: 'will be disposed' })

    const executor = fakeEngineInstances()[0]
    if (executor == null) throw new Error('executor was never created')
    await waitUntil(() => executor.holding, 5000, 'executor holding before dispose')

    const disposePromise = service.dispose()
    await waitUntil(() => executor.cancelRequested, 5000, 'dispose cancels in-flight executor')

    // cancel 释放 holdForRelease（取消收场），dispose 等待执行 promise settle 后返回。
    await disposePromise

    // dispose 已清空所有权集合：执行器取消路径上的任何事件都不得落库。
    expect(
      loadPersistedEvents().some(
        (entry) =>
          entry.type === 'agent_status' &&
          String((entry.event as { status?: unknown }).status) === 'cancelled',
      ),
    ).toBe(false)
  })

  it('⑧ plan 审批闸门：plan_proposed 后自动推进暂停，rejectPlan 解除恢复', async () => {
    // 闸门语义（现状）：用户提交新 turn 视为对计划的表态，会**解除**闸门（dispatchTurn
    // 无条件 pendingPlanApprovals.delete）。因此 B 必须在 plan_proposed 之前入队，
    // 闸门才对「A 收尾后的自动推进」生效 —— 用 holdAfterEvents 构造该时序：
    // A 第一段事件（无 plan）→ hold；B 入队 → release → 第二段注入 plan_proposed → 终态。
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'drafting plan', isFinal: false }],
      holdAfterEvents: true,
      postReleaseEvents: [{ type: 'plan_proposed', plan: '1. step one\n2. step two' }],
      terminalStatus: 'completed',
    })
    const planTurn = await service.sendTurn({ sessionId, message: 'make a plan' })
    const executorA = fakeEngineInstances()[0]
    if (executorA == null) throw new Error('plan executor missing')
    await waitUntil(() => executorA.holding, 5000, 'plan executor holding')

    // A 占位期间 B 到达 → 入队（此刻闸门尚未立起，B 的入队不会被自身 send 清除）。
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'queued after plan', isFinal: true }],
      terminalStatus: 'completed',
    })
    const queuedTurn = await service.sendTurn({ sessionId, message: 'after plan' })
    expect(fakeEngineCalls()).toHaveLength(1)

    // 放行 A：plan_proposed 注入（闸门立起）→ 终态 → finally 的自动推进被闸门拦下。
    executorA.release()
    await waitForTurnTerminal(5000, planTurn.turnId)
    expect(
      loadPersistedEvents().some(
        (entry) => entry.type === 'plan_proposed' && entry.turnId === planTurn.turnId,
      ),
    ).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(fakeEngineCalls()).toHaveLength(1)

    // 拒绝计划：闸门解除 + plan_rejected 落库 + 队列恢复自动起跑。
    const rejected = service.rejectPlan(sessionId)
    expect(rejected.rejected).toBe(true)
    expect(loadPersistedEvents().some((entry) => entry.type === 'plan_rejected')).toBe(true)

    await waitUntil(
      () => fakeEngineCalls().length === 2,
      5000,
      'queued turn resumes after rejection',
    )
    const queuedTerminal = await waitForTurnTerminal(5000, queuedTurn.turnId)
    expect((queuedTerminal.event as { status?: unknown }).status).toBe('completed')
  })

  it('⑨ error 收场：executor error 终态 + reject → 扣留补发、会话标错、新 turn 可用', async () => {
    // 真实执行器契约：异常前先 emit agent_status(error)，再以 reject 收场。
    // （纯 reject 无终态事件的路径不产生任何落库终态 —— 现状如此，此处锁真实契约路径。）
    queueFakeEngineScript({
      events: [
        { type: 'assistant_message', content: 'partial work', isFinal: false },
        { type: 'agent_status', status: 'error', message: 'engine boom' },
      ],
      rejectWith: new Error('engine boom'),
    })
    const { turnId } = await service.sendTurn({ sessionId, message: 'will fail' })

    // error 终态被扣留后在 catch 分支补发落库，且只落一次。
    const terminal = await waitForTurnTerminal(5000, turnId)
    expect((terminal.event as { status?: unknown }).status).toBe('error')
    expect(
      loadPersistedEvents().filter(
        (entry) => entry.turnId === turnId && entry.type === 'agent_status',
      ),
    ).toHaveLength(1)

    // error 收场：session status 停在 'error'（updateStatusAfterHostTerminal 语义）。
    expect(new SessionRepository(db).get(sessionId)?.status).toBe('error')

    // 所有权已回收：会话可立即接受新 turn 并完整跑通。
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'recovered', isFinal: true }],
      terminalStatus: 'completed',
    })
    const next = await service.sendTurn({ sessionId, message: 'after failure' })
    expect(next.started).toBe(true)
    const nextTerminal = await waitForTurnTerminal(5000, next.turnId)
    expect((nextTerminal.event as { status?: unknown }).status).toBe('completed')
  })

  it('⑩ goal 块解析：assistant 输出 spark-goal-status 后 goal 循环推进（双引擎）', async () => {
    // W2-D3 行为补齐的行为锁：goalConfig 对两引擎同样注入，assistant 会输出
    // spark-goal-status 块；此前仅 claude 路径解析 —— codex 会话的 goal 永远
    // 停在 active。本条断言两引擎的 goal 循环都能推进到 completed。
    // mode 用 codex-native：spark-loop 会被 goalOwnsDispatch 拦截（用户消息入队
    // 等 goal 泵排空，本测试无泵会超时）；codex-native 走普通 dispatch，
    // 而 updateGoalFromAssistantBlock 只看 status==='active'，解析路径相同。
    const goalId = new GoalRepository(db).createOrReplaceActiveGoal({
      sessionId,
      objective: 'finish the task',
      mode: 'codex-native',
    }).id
    const goalBlock =
      'working on it\n\n```spark-goal-status\nstatus: completed\nphase: validate\nsummary: objective met\n```'
    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: goalBlock, isFinal: true, mode: 'complete' }],
      terminalStatus: 'completed',
    })
    const { turnId } = await service.sendTurn({ sessionId, message: 'run the goal' })
    await waitForTurnTerminal(5000, turnId)

    // getCurrent 只查活跃状态集合（completed 后返回 null），按创建时的 id 直取。
    const goal = new GoalRepository(db).get(goalId)
    expect(goal?.status).toBe('completed')
    expect(goal?.progressLog.length).toBeGreaterThan(0)
    expect(goal?.progressLog[0]?.summary).toBe('objective met')

    // goal 事件按设计挂独立 turnId（不挂在触发它的对话 turn 下），全会话范围断言。
    const goalEventTypes = loadPersistedEvents()
      .filter((entry) => entry.type.startsWith('goal_'))
      .map((entry) => entry.type)
    expect(goalEventTypes).toContain('goal_progress')
    expect(goalEventTypes).toContain('goal_completed')
    // 轮末 goal_progress 带 progressKind=iteration_result：渲染端据此回填轮次分割线小结。
    const progressKinds = loadPersistedEvents()
      .filter((entry) => entry.type === 'goal_progress')
      .map((entry) => (entry.event as { progressKind?: string }).progressKind)
    expect(progressKinds).toContain('iteration_result')
  })
})
