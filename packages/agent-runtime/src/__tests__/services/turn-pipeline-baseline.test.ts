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
 * Turn 管道贯穿基线（W1-D2）—— P1 引擎接口化的行为锁。
 *
 * 与既有测试的分层差异：session-runtime-config.test mock 了整个存储层，
 * plan-mode-e2e 只到执行器层。这组测试用**真实 SQLite**（临时目录 +
 * runMigrations）+ FakeEngineExecutor（脚本化事件注入），从 SessionService
 * 公开入口 sendTurn 一路贯穿到 agent_events 落库与终态收尾，锁定的正是
 * P1 要重构的 L3463 两侧分支（claude / codex）的可观测行为：
 *   ① 完整 turn 的事件顺序、终态与落库
 *   ② cancel 路径（cancelled 终态、闸门丢弃迟到事件、所有权回收）
 *   ③ resume id 的稳定性与 adapterKind 快照匹配
 *
 * 之后 W1~W3 的每一步重构都要求这组测试「不改一字全绿」。
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

async function waitUntil(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.each(ENGINES)('turn 管道贯穿基线（$adapter 引擎）', (engine) => {
  let db: SparkDatabase
  let testDir: string
  let sessionId: string
  let service: InstanceType<typeof SessionService>
  let eventRepo: EventRepository

  beforeEach(async () => {
    resetFakeEngineHarness()
    testDir = mkdtempSync(path.join(tmpdir(), `spark-turn-baseline-${engine.adapter}-`))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    new ProviderProfileRepository(db).create({
      id: 'provider-baseline',
      providerType: engine.providerType,
      name: 'Baseline Provider',
      config: { defaultModel: engine.modelId, modelIds: [engine.modelId] },
      keystoreRef: 'key-baseline',
      isDefault: true,
    })

    service = new SessionService(db, () => {})
    const created = await service.createSession({
      providerProfileId: 'provider-baseline',
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

  it('① 完整 turn：事件顺序、终态与落库', async () => {
    queueFakeEngineScript({
      events: [
        { type: 'user_message', content: 'baseline hello' },
        { type: 'assistant_message', content: 'working on it', isFinal: false },
        { type: 'assistant_message', content: 'done', isFinal: true },
      ],
      terminalStatus: 'completed',
    })

    const { turnId, started } = await service.sendTurn({
      sessionId,
      message: 'baseline hello',
    })
    expect(started).toBe(true)
    expect(turnId).toBeTruthy()

    const terminal = await waitForTurnTerminal()
    expect(terminal.turnId).toBe(turnId)
    expect((terminal.event as { status?: unknown }).status).toBe('completed')

    const persisted = loadPersistedEvents().filter((entry) => entry.turnId === turnId)
    // seq 由 session 层统一分配：单调递增且无重复。
    const seqs = persisted.map((entry) => entry.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
    expect(new Set(seqs).size).toBe(seqs.length)

    // 顺序锁：prompt 快照（session 层）→ 用户消息（执行器回显）→ 助手流 → 终态。
    const order = persisted.map((entry) => entry.type)
    expect(order.indexOf('turn_prompt_snapshot')).toBeLessThan(order.indexOf('user_message'))
    expect(order.indexOf('user_message')).toBeLessThan(order.indexOf('assistant_message'))
    // 终态由 session 层在 executeTurn resolve 后补发，必然最后。
    expect(order[order.length - 1]).toBe('agent_status')

    // 用户消息回显带上本轮 prompt 原文（executor 事件 + session 层 presentation）。
    const userMessage = loadPersistedEvents().find((entry) => entry.type === 'user_message')
    expect((userMessage?.event as { content?: unknown } | undefined)?.content).toBe(
      'baseline hello',
    )

    // 执行器收到完整的 turn 上下文：消息与模型配置。
    const calls = fakeEngineCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.message).toBe('baseline hello')
    expect(calls[0]?.sessionId).toBe(sessionId)

    // 终态后宿主会话回到 idle。
    const sessionRow = new SessionRepository(db).get(sessionId)
    expect(sessionRow?.status).toBe('idle')
  })

  it('② cancel：cancelled 终态、迟到事件被闸门丢弃、所有权回收', async () => {
    queueFakeEngineScript({
      events: [
        { type: 'user_message', content: 'long running' },
        { type: 'assistant_message', content: 'step 1', isFinal: false },
      ],
      holdUntilCancel: true,
      cancelEvents: [{ type: 'assistant_message', content: 'late leakage', isFinal: false }],
      cancelTerminal: 'cancelled',
    })

    const { turnId } = await service.sendTurn({ sessionId, message: 'long running' })

    // 等 executeTurn 进入挂起（此时 activeLoops 已注册、前置事件已落库）。
    const executor = fakeEngineInstances()[0]
    if (executor == null) throw new Error('executor was never created')
    await waitUntil(() => executor.holding, 5000, 'executor to enter hold')

    const result = await service.cancelTurn(sessionId)
    expect(result.cancelled).toBe(true)

    const terminal = await waitForTurnTerminal()
    expect(terminal.turnId).toBe(turnId)
    expect(terminal.event).toMatchObject({
      type: 'agent_status',
      status: 'cancelled',
      message: 'Stopped by user',
    })

    // 迟到事件：执行器确实 emit 过，但被所有权闸门挡在落库之外。
    expect(executor.emitted.some((event) => event.content === 'late leakage')).toBe(true)
    expect(
      loadPersistedEvents().some(
        (entry) =>
          entry.type === 'assistant_message' &&
          (entry.event as { content?: unknown }).content === 'late leakage',
      ),
    ).toBe(false)
    // cancel 后执行器自行补发的 cancelled 终态同样进不了库（闸门先于 emitAndPersist）。
    expect(
      loadPersistedEvents().filter(
        (entry) => entry.turnId === turnId && entry.type === 'agent_status',
      ),
    ).toHaveLength(1)

    // 取消后会话回到 idle，且所有权已回收：新的 turn 可以立即启动并完整跑通。
    expect(new SessionRepository(db).get(sessionId)?.status).toBe('idle')

    queueFakeEngineScript({
      events: [{ type: 'assistant_message', content: 'fresh after cancel', isFinal: true }],
      terminalStatus: 'completed',
    })
    const second = await service.sendTurn({ sessionId, message: 'after cancel' })
    expect(second.started).toBe(true)
    const secondTerminal = await waitForTurnTerminal(5000, second.turnId)
    expect((secondTerminal.event as { status?: unknown }).status).toBe('completed')
    expect(secondTerminal.turnId).toBe(second.turnId)
  })

  it('③ resume：sdkSessionId 稳定性与 adapterKind 快照', async () => {
    for (const message of ['first turn', 'second turn']) {
      queueFakeEngineScript({
        events: [{ type: 'assistant_message', content: message, isFinal: true }],
        terminalStatus: 'completed',
      })
      const sent = await service.sendTurn({ sessionId, message })
      expect(sent.started).toBe(true)
      await waitForTurnTerminal(5000, sent.turnId)
    }

    const snapshots = loadPersistedEvents().filter((entry) => entry.type === 'turn_prompt_snapshot')
    expect(snapshots).toHaveLength(2)
    const first = snapshots[0]?.event as unknown as {
      adapterKind?: string
      sdkSessionId?: string
    }
    const second = snapshots[1]?.event as unknown as {
      adapterKind?: string
      sdkSessionId?: string
    }

    // adapterKind 快照按引擎二值归并：claude 系 → claude-sdk，其余 → codex。
    expect(first?.adapterKind).toBe(engine.adapter === 'claude-sdk' ? 'claude-sdk' : 'codex')
    expect(second?.adapterKind).toBe(first?.adapterKind)

    const calls = fakeEngineCalls()
    expect(calls).toHaveLength(2)

    if (engine.adapter === 'claude-sdk') {
      // anthropic + claude 模型 + 无自定义 endpoint → resume safe：
      // sdkSessionId 跨 turn 稳定（stable id，不含 turnId），并透传给执行器。
      expect(first?.sdkSessionId).toBeTruthy()
      expect(second?.sdkSessionId).toBe(first?.sdkSessionId)
      expect(calls[1]?.config.sdkSessionId).toBe(second?.sdkSessionId)
    } else {
      // 非 resume-safe 引擎：sdkSessionId 由 turnId 参与散列，逐 turn 演进。
      expect(first?.sdkSessionId).toBeTruthy()
      expect(second?.sdkSessionId).not.toBe(first?.sdkSessionId)
    }

    // 两个 turn 各自的执行器调用都带上了当轮快照里的 sdkSessionId。
    expect(calls[0]?.config.sdkSessionId).toBe(first?.sdkSessionId)
  })
})
