import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { SessionService } from '../../services/session.service.js'

type GoalStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cleared' | 'stopped_by_budget' | 'pending_contract'
type ProgressStatus = GoalStatus | 'continue' | 'blocked'
type GoalProgressEntry = {
  iteration: number
  phase: 'review' | 'act' | 'validate'
  status: ProgressStatus
  summary: string
  evidence?: string[]
  nextStep?: string
  createdAt: string
}
type StoredGoal = {
  id: string
  sessionId: string
  objective: string
  successCriteria: string[]
  constraints: string[]
  validation: { commands?: string[]; checklist?: string[] }
  budget: {
    maxIterations?: number
    maxRuntimeMinutes?: number
    maxBudgetUsd?: number
    maxConsecutiveFailures?: number
    noProgressLimit?: number
  }
  progressLog: GoalProgressEntry[]
  status: GoalStatus
  mode: 'spark-loop' | 'codex-native'
  createdAt: string
  updatedAt: string
}

type StoredSession = {
  id: string
  agent_adapter?: string | null
  provider_profile_id?: string | null
  model_id?: string | null
  metadata_json?: string | null
}

const state = vi.hoisted(() => ({
  goals: new Map<string, StoredGoal>(),
  sessions: new Map<string, StoredSession>(),
  runtimeUpdates: [] as Array<{ sessionId: string; patch: Record<string, unknown> }>,
  usageSince: new Map<string, number>(),
  completedTurnRequests: [] as string[],
  events: [] as AgentEvent[],
}))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(async () => 'test-key'),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('@spark/storage', () => {
  const cloneGoal = (goal: StoredGoal): StoredGoal => ({
    ...goal,
    successCriteria: [...goal.successCriteria],
    constraints: [...goal.constraints],
    validation: { ...goal.validation },
    budget: { ...goal.budget },
    progressLog: goal.progressLog.map((entry) => ({ ...entry })),
  })

  class GoalRepository {
    getCurrent(sessionId: string): StoredGoal | null {
      const goal = Array.from(state.goals.values()).find(
        (item) =>
          item.sessionId === sessionId &&
          ['active', 'paused', 'stopped_by_budget', 'pending_contract'].includes(item.status),
      )
      return goal == null ? null : cloneGoal(goal)
    }

    updateStatus(id: string, status: GoalStatus): StoredGoal | null {
      const goal = state.goals.get(id)
      if (goal == null) return null
      goal.status = status
      return cloneGoal(goal)
    }

    appendProgress(
      id: string,
      entry: Omit<GoalProgressEntry, 'createdAt'> & { createdAt?: string },
    ): StoredGoal | null {
      const goal = state.goals.get(id)
      if (goal == null) return null
      goal.progressLog.push({ ...entry, createdAt: entry.createdAt ?? '2026-06-30T10:00:00.000Z' })
      return cloneGoal(goal)
    }

    createOrReplaceActiveGoal(params: {
      sessionId: string
      objective: string
      successCriteria?: string[]
      constraints?: string[]
      validation?: { commands?: string[]; checklist?: string[] }
      budget?: StoredGoal['budget']
      mode?: 'spark-loop' | 'codex-native'
    }): StoredGoal {
      const goal: StoredGoal = {
        id: 'goal-set-1',
        sessionId: params.sessionId,
        objective: params.objective,
        successCriteria: params.successCriteria ?? [],
        constraints: params.constraints ?? [],
        validation: params.validation ?? {},
        budget: params.budget ?? {},
        progressLog: [],
        status: 'active',
        mode: params.mode ?? 'spark-loop',
        createdAt: '2026-06-30T10:00:00.000Z',
        updatedAt: '2026-06-30T10:00:00.000Z',
      }
      state.goals.set(goal.id, goal)
      return cloneGoal(goal)
    }

    clearCurrent(sessionId: string): StoredGoal | null {
      const goal = this.getCurrent(sessionId)
      if (goal == null) return null
      goal.status = 'cleared'
      return cloneGoal(goal)
    }
  }

  class UsageLedgerRepository {
    getSessionUsage() {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalReasoningOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: 0,
        recordCount: 0,
      }
    }

    getSessionUsageSince(sessionId: string, sinceIso: string) {
      const cost = state.usageSince.get(`${sessionId}|${sinceIso}`) ?? 0
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalReasoningOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: cost,
        recordCount: cost > 0 ? 1 : 0,
      }
    }
  }

  class EventRepository {
    insert(params: { eventJson: string }): void {
      state.events.push(JSON.parse(params.eventJson) as AgentEvent)
    }

    countBySession(): number {
      return 0
    }
    nextSeqBySession(): number {
      return state.events.reduce((max, event) => Math.max(max, event.seq), -1) + 1
    }
    queryBySession(params: { eventType?: string }): { events: Array<{ event_json: string }>; hasMore: boolean } {
      const rows = state.events
        .filter((event) => params.eventType == null || event.type === params.eventType)
        .map((event) => ({ event_json: JSON.stringify(event) }))
      return { events: rows, hasMore: false }
    }
    queryStreamEventsByTurn(): unknown[] {
      return []
    }
    queryDialogueEvents(): unknown[] {
      return []
    }
    queryDialogueEventsAfterSeq(): unknown[] {
      return []
    }
    countDialogueEventsAfterSeq(): number {
      return 0
    }
    getLatestByTypeAndJsonValue(): null {
      return null
    }
    deleteOrphanedSessionEventsBatch(): number {
      return 0
    }
  }

  class EmptyRepository {
    list(): unknown[] {
      return []
    }
    listAll(): unknown[] {
      return []
    }
    findByScope(): unknown[] {
      return []
    }
    get(): null {
      return null
    }
    markStaleAsFailed(): number {
      return 0
    }
  }

  class SessionRepository {
    get(id: string): StoredSession | null {
      return state.sessions.get(id) ?? null
    }

    updateRuntime(id: string, patch: Record<string, unknown>): void {
      state.runtimeUpdates.push({ sessionId: id, patch })
      const row = state.sessions.get(id)
      if (row == null) return
      if (patch.providerProfileId !== undefined) {
        row.provider_profile_id = patch.providerProfileId as string
      }
      if (patch.modelId !== undefined) row.model_id = patch.modelId as string
    }

    patchMetadata(): void {}

    updateStatus(): void {}
  }

  return {
    EventRepository,
    ProviderProfileRepository: EmptyRepository,
    RulesRepository: EmptyRepository,
    SessionRepository,
    WorkspaceRepository: EmptyRepository,
    McpServerRepository: EmptyRepository,
    SettingsRepository: EmptyRepository,
    SkillRepository: EmptyRepository,
    ContextPreferenceRepository: EmptyRepository,
    AgentRepository: EmptyRepository,
    WorkflowRepository: EmptyRepository,
    TeamDispatchRepository: EmptyRepository,
    TurnRequestRepository: class {
      listRecoverable(): unknown[] {
        return []
      }
      markCompleted(id: string): boolean {
        state.completedTurnRequests.push(id)
        return true
      }
    },
    TeamDefinitionRepository: EmptyRepository,
    MediaModelManifestRepository: EmptyRepository,
    UsageLedgerRepository,
    GoalRepository,
    ConnectorConnectionRepository: EmptyRepository,
    MemoryRepository: EmptyRepository,
  }
})

vi.mock('../../sdk/index.js', () => ({
  loadSdkMcpFactory: vi.fn(async () => null),
  isSDKAvailable: vi.fn(async () => true),
  getResumeCircuitBreaker: vi.fn(() => ({
    canAttempt: () => true,
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  })),
  ClaudeSDKExecutor: class {},
  CodexCliExecutor: class {},
  CodexOpenAIExecutor: class {},
  CodexSdkExecutor: class {},
}))

class TestSessionService extends SessionService {
  override recoverInterruptedSessions(): { recovered: number } {
    return { recovered: 0 }
  }
}

function seedGoal(patch: Partial<StoredGoal> = {}): StoredGoal {
  const goal: StoredGoal = {
    id: patch.id ?? 'goal-1',
    sessionId: patch.sessionId ?? 'session-1',
    objective: patch.objective ?? 'Ship the goal',
    successCriteria: patch.successCriteria ?? ['done'],
    constraints: patch.constraints ?? [],
    validation: patch.validation ?? {},
    budget: patch.budget ?? {},
    progressLog: patch.progressLog ?? [],
    status: patch.status ?? 'active',
    mode: patch.mode ?? 'spark-loop',
    createdAt: patch.createdAt ?? '2026-06-30T10:00:00.000Z',
    updatedAt: patch.updatedAt ?? '2026-06-30T10:00:00.000Z',
  }
  state.goals.set(goal.id, goal)
  return goal
}

function seedSession(patch: Partial<StoredSession> = {}): StoredSession {
  const session: StoredSession = {
    id: patch.id ?? 'session-1',
    agent_adapter: patch.agent_adapter ?? 'claude-sdk',
    provider_profile_id: patch.provider_profile_id ?? 'provider-session',
    model_id: patch.model_id ?? 'model-session',
    metadata_json: patch.metadata_json ?? null,
  }
  state.sessions.set(session.id, session)
  return session
}

function makeQueuedTurn(turnId: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    turnId,
    message,
    enqueuedAt: '2026-06-30T10:00:01.000Z',
    ...extra,
  }
}

function createService() {
  const emitted: AgentEvent[] = []
  const service = new TestSessionService({} as never, (event) => emitted.push(event))
  const startTurn = vi.fn(
    async (
      _sessionId: string,
      _turnId: string,
      _message: string,
      _presentation?: unknown,
      _runtimePatch?: unknown,
    ) => undefined,
  )
  ;(service as unknown as { startTurn: typeof startTurn }).startTurn = startTurn
  const startGoalLoop = (
    service as unknown as { startGoalLoop(sessionId: string): Promise<void> }
  ).startGoalLoop.bind(service)
  const continueGoalOrQueue = (
    service as unknown as { continueGoalOrQueue(sessionId: string): Promise<void> }
  ).continueGoalOrQueue.bind(service)
  const dispatchTurn = (
    service as unknown as {
      dispatchTurn(params: { sessionId: string; message: string }): Promise<{ started: boolean }>
    }
  ).dispatchTurn.bind(service)
  const pendingTurns = (service as unknown as { pendingTurns: Map<string, unknown[]> }).pendingTurns
  return { service, emitted, startTurn, startGoalLoop, continueGoalOrQueue, dispatchTurn, pendingTurns }
}

describe('SessionService goal queue semantics (P0-2 / P2)', () => {
  beforeEach(() => {
    state.goals.clear()
    state.sessions.clear()
    state.runtimeUpdates.length = 0
    state.usageSince.clear()
    state.completedTurnRequests.length = 0
    state.events.length = 0
    vi.useRealTimers()
  })

  it('drains queued plain user messages into the next iteration prompt and keeps complex turns queued', async () => {
    seedGoal({ budget: { maxIterations: 5 } })
    const { service, startGoalLoop, startTurn, emitted, pendingTurns } = createService()
    pendingTurns.set('session-1', [
      makeQueuedTurn('turn-a', 'Please also add unit tests'),
      makeQueuedTurn('turn-b', 'Skip the DB migration for now', {
        attachments: [{ kind: 'image', path: '/tmp/a.png' }],
      }),
      makeQueuedTurn('turn-c', 'Prioritize the API part'),
    ])

    await startGoalLoop('session-1')

    expect(startTurn).toHaveBeenCalledTimes(1)
    const prompt = startTurn.mock.calls[0]![2] as string
    // 两条纯文本消息按时间顺序注入「用户补充指令」段
    expect(prompt).toContain('User supplementary instructions')
    expect(prompt.indexOf('Please also add unit tests')).toBeLessThan(
      prompt.indexOf('Prioritize the API part'),
    )
    expect(prompt).not.toContain('Skip the DB migration')
    // 带附件的 turn 留在队列
    expect(pendingTurns.get('session-1')).toEqual([
      expect.objectContaining({ turnId: 'turn-b' }),
    ])
    // 被消费的消息在时间线上仍可见，且持久化请求闭环
    expect(emitted).toContainEqual(
      expect.objectContaining({ type: 'user_message', turnId: 'turn-a' }),
    )
    expect(emitted).toContainEqual(
      expect.objectContaining({ type: 'user_message', turnId: 'turn-c' }),
    )
    expect(state.completedTurnRequests).toEqual(['turn-a', 'turn-c'])
  })

  it('caps injected messages per iteration and leaves the overflow queued', async () => {
    seedGoal({ budget: { maxIterations: 50 } })
    const { service, startGoalLoop, startTurn, pendingTurns } = createService()
    const turns = Array.from({ length: 10 }, (_, i) => makeQueuedTurn(`turn-${i}`, `note ${i}`))
    pendingTurns.set('session-1', turns)

    await startGoalLoop('session-1')

    const prompt = startTurn.mock.calls[0]![2] as string
    for (let i = 0; i < 8; i += 1) expect(prompt).toContain(`note ${i}`)
    expect(prompt).not.toContain('note 8')
    expect(prompt).not.toContain('note 9')
    expect(pendingTurns.get('session-1')?.map((t) => (t as { turnId: string }).turnId)).toEqual([
      'turn-8',
      'turn-9',
    ])
  })

  it('does not dispatch another goal iteration for codex-native goals and drains the user queue instead', async () => {
    seedGoal({ mode: 'codex-native' })
    const { service, continueGoalOrQueue, startTurn } = createService()
    const startNextQueuedTurn = vi
      .spyOn(service as unknown as { startNextQueuedTurn(s: string): void }, 'startNextQueuedTurn')
      .mockImplementation(() => undefined)
    const startGoalLoop = vi
      .spyOn(service as unknown as { startGoalLoop(s: string): Promise<void> }, 'startGoalLoop')
      .mockResolvedValue(undefined)

    await continueGoalOrQueue('session-1')

    expect(startGoalLoop).not.toHaveBeenCalled()
    expect(startNextQueuedTurn).toHaveBeenCalledWith('session-1')
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('runs user messages immediately when an active goal is codex-native (no starvation gate)', async () => {
    seedGoal({ mode: 'codex-native' })
    const { dispatchTurn, startTurn, pendingTurns } = createService()

    const result = await dispatchTurn({ sessionId: 'session-1', message: 'status update please' })

    expect(result.started).toBe(true)
    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(pendingTurns.get('session-1') ?? []).toHaveLength(0)
  })

  it('still queues user messages behind an active spark-loop goal for iteration drain', async () => {
    seedGoal({ mode: 'spark-loop' })
    const { dispatchTurn, startTurn, pendingTurns } = createService()

    const result = await dispatchTurn({ sessionId: 'session-1', message: 'a mid-goal note' })

    expect(result.started).toBe(false)
    expect(startTurn).not.toHaveBeenCalled()
    expect(pendingTurns.get('session-1')).toEqual([expect.objectContaining({ message: 'a mid-goal note' })])
  })
})

describe('SessionService goal budget scoping (P1-3)', () => {
  beforeEach(() => {
    state.goals.clear()
    state.sessions.clear()
    state.runtimeUpdates.length = 0
    state.usageSince.clear()
    state.completedTurnRequests.length = 0
    state.events.length = 0
    vi.useRealTimers()
  })

  it('measures maxBudgetUsd against goal-scoped spend, not whole-session history', async () => {
    seedGoal({
      id: 'goal-2',
      budget: { maxBudgetUsd: 1.0 },
      createdAt: '2026-06-30T10:00:00.000Z',
    })
    // 目标起点之后只花了 0.2（目标之前的 5.0 不计入）
    state.usageSince.set('session-1|2026-06-30T10:00:00.000Z', 0.2)
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-2')?.status).toBe('active')
    expect(startTurn).toHaveBeenCalledTimes(1)

    state.usageSince.set('session-1|2026-06-30T10:00:00.000Z', 1.5)
    const second = createService()
    await second.startGoalLoop('session-1')
    expect(state.goals.get('goal-2')?.status).toBe('stopped_by_budget')
    expect(second.startTurn).not.toHaveBeenCalled()
  })

  it('excludes paused intervals from the maxRuntimeMinutes budget', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T10:40:00.000Z'))
    const goal = seedGoal({
      id: 'goal-3',
      createdAt: '2026-06-30T10:00:00.000Z',
      budget: { maxRuntimeMinutes: 30 },
    })
    // 10:05 暂停、10:25 恢复 → 暂停 20 分钟；墙钟 40 分钟，活跃仅 20 分钟，不应停
    state.events.push(
      {
        id: 'e1',
        type: 'goal_paused',
        sessionId: 'session-1',
        turnId: 't1',
        timestamp: '2026-06-30T10:05:00.000Z',
        seq: 1,
        goalId: goal.id,
        status: 'paused',
        iteration: 0,
        summary: 'paused',
      } as AgentEvent,
      {
        id: 'e2',
        type: 'goal_resumed',
        sessionId: 'session-1',
        turnId: 't2',
        timestamp: '2026-06-30T10:25:00.000Z',
        seq: 2,
        goalId: goal.id,
        status: 'active',
        iteration: 0,
        summary: 'resumed',
      } as AgentEvent,
    )
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-3')?.status).toBe('active')
    expect(startTurn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('still stops by runtime once active minutes exceed the limit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T10:35:00.000Z'))
    const goal = seedGoal({
      id: 'goal-4',
      createdAt: '2026-06-30T10:00:00.000Z',
      budget: { maxRuntimeMinutes: 30 },
    })
    // 仅暂停 2 分钟 → 活跃 33 分钟 ≥ 30，应停
    state.events.push(
      {
        id: 'e1',
        type: 'goal_paused',
        sessionId: 'session-1',
        turnId: 't1',
        timestamp: '2026-06-30T10:10:00.000Z',
        seq: 1,
        goalId: goal.id,
        status: 'paused',
        iteration: 0,
        summary: 'paused',
      } as AgentEvent,
      {
        id: 'e2',
        type: 'goal_resumed',
        sessionId: 'session-1',
        turnId: 't2',
        timestamp: '2026-06-30T10:12:00.000Z',
        seq: 2,
        goalId: goal.id,
        status: 'active',
        iteration: 0,
        summary: 'resumed',
      } as AgentEvent,
    )
    const { startGoalLoop, startTurn, emitted } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-4')?.status).toBe('stopped_by_budget')
    expect(startTurn).not.toHaveBeenCalled()
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: 'goal_budget_stopped',
        summary: expect.stringContaining('excludes 2.0 minutes paused'),
      }),
    )
    vi.useRealTimers()
  })
})

describe('SessionService goal synthetic turn runtime inheritance', () => {
  beforeEach(() => {
    state.goals.clear()
    state.sessions.clear()
    state.runtimeUpdates.length = 0
    state.usageSince.clear()
    state.completedTurnRequests.length = 0
    state.events.length = 0
    vi.useRealTimers()
  })

  it('dispatches the contract draft turn with the session runtime selection instead of the agent binding', async () => {
    // UI 选了 provider-a/model-a（会话运行时快照），Agent 绑定是 provider-b：
    // 起草 turn 必须继承会话快照，否则 provider 解析会静默落到 Agent 绑定。
    seedSession({ provider_profile_id: 'provider-a', model_id: 'model-a' })
    const { service, startTurn } = createService()

    await service.setGoal({ sessionId: 'session-1', objective: 'Ship it', mode: 'spark-loop' })

    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(startTurn.mock.calls[0]![4]).toEqual({
      providerProfileId: 'provider-a',
      modelId: 'model-a',
    })
    expect(state.goals.get('goal-set-1')?.status).toBe('pending_contract')
  })

  it('dispatches goal iterations with the session runtime selection', async () => {
    seedGoal({ status: 'active' })
    seedSession({ provider_profile_id: 'provider-a', model_id: 'model-a' })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(startTurn.mock.calls[0]![4]).toEqual({
      providerProfileId: 'provider-a',
      modelId: 'model-a',
    })
  })

  it('keeps host agent routing for team sessions (no runtime patch on goal turns)', async () => {
    seedGoal({ status: 'active' })
    seedSession({
      provider_profile_id: 'provider-a',
      model_id: 'model-a',
      metadata_json: JSON.stringify({
        team: { enabled: true, hostAgentId: 'host-1', memberAgentIds: [] },
      }),
    })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(startTurn).toHaveBeenCalledTimes(1)
    expect(startTurn.mock.calls[0]![4]).toBeUndefined()
  })

  it('drains queued turns whose patch only carries provider/model and applies the switch to the iteration turn', async () => {
    seedGoal({ status: 'active' })
    seedSession({ provider_profile_id: 'provider-a', model_id: 'model-a' })
    const { startGoalLoop, startTurn, pendingTurns } = createService()
    // 渲染端每条消息都带 provider/model patch：必须可排空，且切换对迭代生效
    pendingTurns.set('session-1', [
      makeQueuedTurn('turn-a', 'switch to the faster model please', {
        runtimePatch: { providerProfileId: 'provider-b', modelId: 'model-b' },
      }),
    ])

    await startGoalLoop('session-1')

    const prompt = startTurn.mock.calls[0]![2] as string
    expect(prompt).toContain('switch to the faster model please')
    expect(pendingTurns.get('session-1')).toBeUndefined()
    expect(state.runtimeUpdates).toContainEqual({
      sessionId: 'session-1',
      patch: { providerProfileId: 'provider-b', modelId: 'model-b' },
    })
    expect(startTurn.mock.calls[0]![4]).toEqual({
      providerProfileId: 'provider-b',
      modelId: 'model-b',
    })
  })

  it('keeps queued turns whose patch carries non-runtime fields (agent/permission) for normal execution', async () => {
    seedGoal({ status: 'active' })
    seedSession({ provider_profile_id: 'provider-a', model_id: 'model-a' })
    const { startGoalLoop, startTurn, pendingTurns } = createService()
    pendingTurns.set('session-1', [
      makeQueuedTurn('turn-a', 'route this to the reviewer agent', {
        runtimePatch: { providerProfileId: 'provider-b', agentId: 'agent-reviewer' },
      }),
    ])

    await startGoalLoop('session-1')

    const prompt = startTurn.mock.calls[0]![2] as string
    expect(prompt).not.toContain('route this to the reviewer agent')
    expect(pendingTurns.get('session-1')).toEqual([
      expect.objectContaining({ turnId: 'turn-a' }),
    ])
    expect(state.runtimeUpdates).toEqual([])
    expect(startTurn.mock.calls[0]![4]).toEqual({
      providerProfileId: 'provider-a',
      modelId: 'model-a',
    })
  })
})
