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
  validation?: Record<string, unknown>
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

const state = vi.hoisted(() => ({
  goals: new Map<string, StoredGoal>(),
  usageBySession: new Map<string, { totalCostUsd: number; recordCount: number }>(),
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
      const goal = Array.from(state.goals.values()).find((item) =>
        item.sessionId === sessionId &&
        ['active', 'paused', 'stopped_by_budget', 'pending_contract'].includes(item.status),
      )
      return goal == null ? null : cloneGoal(goal)
    }

    updateStatus(id: string, status: GoalStatus): StoredGoal | null {
      const goal = state.goals.get(id)
      if (goal == null) return null
      goal.status = status
      goal.updatedAt = '2026-06-30T10:00:00.000Z'
      return cloneGoal(goal)
    }

    appendProgress(id: string, entry: Omit<GoalProgressEntry, 'createdAt'> & { createdAt?: string }): StoredGoal | null {
      const goal = state.goals.get(id)
      if (goal == null) return null
      goal.progressLog.push({ ...entry, createdAt: entry.createdAt ?? '2026-06-30T10:00:00.000Z' })
      return cloneGoal(goal)
    }
  }

  class UsageLedgerRepository {
    getSessionUsage(sessionId: string) {
      const usage = state.usageBySession.get(sessionId) ?? { totalCostUsd: 0, recordCount: 0 }
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: usage.totalCostUsd,
        recordCount: usage.recordCount,
      }
    }
  }

  class EventRepository {
    insert(params: { eventJson: string }): void {
      state.events.push(JSON.parse(params.eventJson) as AgentEvent)
    }

    countBySession(): number { return 0 }
    nextSeqBySession(): number {
      return state.events.reduce((max, event) => Math.max(max, event.seq), -1) + 1
    }
    queryBySession(): { events: unknown[]; hasMore: boolean } { return { events: [], hasMore: false } }
    queryStreamEventsByTurn(): unknown[] { return [] }
    queryDialogueEvents(): unknown[] { return [] }
    deleteOrphanedSessionEventsBatch(): number { return 0 }
  }

  class EmptyRepository {
    list(): unknown[] { return [] }
    listAll(): unknown[] { return [] }
    findByScope(): unknown[] { return [] }
    get(): null { return null }
    markStaleAsFailed(): number { return 0 }
  }

  class SessionRepository extends EmptyRepository {
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
      listRecoverable(): unknown[] { return [] }
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
  getResumeCircuitBreaker: vi.fn(() => ({ canAttempt: () => true, recordFailure: vi.fn(), recordSuccess: vi.fn() })),
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

function createService() {
  const emitted: AgentEvent[] = []
  const service = new TestSessionService({} as never, (event) => emitted.push(event))
  const startTurn = vi.fn(async () => undefined)
  ;(service as unknown as { startTurn: typeof startTurn }).startTurn = startTurn
  const startGoalLoop = (service as unknown as { startGoalLoop(sessionId: string): Promise<void> }).startGoalLoop.bind(service)
  return { service, emitted, startTurn, startGoalLoop }
}

describe('SessionService goal loop budget enforcement', () => {
  beforeEach(() => {
    state.goals.clear()
    state.usageBySession.clear()
    state.events.length = 0
    vi.useRealTimers()
  })

  it('stops before another turn when the usage ledger reaches maxBudgetUsd', async () => {
    seedGoal({ budget: { maxBudgetUsd: 1.25 } })
    state.usageBySession.set('session-1', { totalCostUsd: 1.25, recordCount: 3 })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-1')?.status).toBe('stopped_by_budget')
    expect(state.goals.get('goal-1')?.progressLog).toHaveLength(0)
    expect(startTurn).not.toHaveBeenCalled()
    expect(state.events).toContainEqual(expect.objectContaining({
      type: 'goal_budget_stopped',
      status: 'stopped_by_budget',
      summary: expect.stringContaining('budget'),
    }))
  })

  it('stops before another turn when elapsed runtime reaches maxRuntimeMinutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T10:30:00.000Z'))
    seedGoal({
      createdAt: '2026-06-30T10:00:00.000Z',
      budget: { maxRuntimeMinutes: 30 },
    })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-1')?.status).toBe('stopped_by_budget')
    expect(state.goals.get('goal-1')?.progressLog).toHaveLength(0)
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('stops before another turn after maxConsecutiveFailures trailing failed or blocked entries', async () => {
    seedGoal({
      budget: { maxConsecutiveFailures: 2 },
      progressLog: [
        { iteration: 1, phase: 'validate', status: 'continue', summary: 'Earlier progress', createdAt: '2026-06-30T10:00:00.000Z' },
        { iteration: 2, phase: 'validate', status: 'failed', summary: 'Validation failed', createdAt: '2026-06-30T10:01:00.000Z' },
        { iteration: 3, phase: 'validate', status: 'blocked', summary: 'Paused by blocker', createdAt: '2026-06-30T10:02:00.000Z' },
      ],
    })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-1')?.status).toBe('stopped_by_budget')
    expect(state.goals.get('goal-1')?.progressLog).toHaveLength(3)
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('stops before another turn after noProgressLimit trailing continue entries without evidence or next-step change', async () => {
    seedGoal({
      budget: { noProgressLimit: 2 },
      progressLog: [
        { iteration: 1, phase: 'act', status: 'continue', summary: 'Made a change', evidence: ['file.ts'], nextStep: 'Run tests', createdAt: '2026-06-30T10:00:00.000Z' },
        { iteration: 2, phase: 'review', status: 'continue', summary: 'Still reviewing', nextStep: 'Run tests', createdAt: '2026-06-30T10:01:00.000Z' },
        { iteration: 3, phase: 'review', status: 'continue', summary: 'Still reviewing', nextStep: 'Run tests', createdAt: '2026-06-30T10:02:00.000Z' },
      ],
    })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-1')?.status).toBe('stopped_by_budget')
    expect(state.goals.get('goal-1')?.progressLog).toHaveLength(3)
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('starts another turn and appends progress when all budgets are below limit', async () => {
    seedGoal({
      budget: {
        maxIterations: 3,
        maxBudgetUsd: 1,
        maxRuntimeMinutes: 60,
        maxConsecutiveFailures: 2,
        noProgressLimit: 2,
      },
      createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      progressLog: [
        { iteration: 1, phase: 'validate', status: 'continue', summary: 'Found next work', evidence: ['test'], nextStep: 'Implement', createdAt: '2026-06-30T10:00:00.000Z' },
      ],
    })
    state.usageBySession.set('session-1', { totalCostUsd: 0.5, recordCount: 1 })
    const { startGoalLoop, startTurn } = createService()

    await startGoalLoop('session-1')

    expect(state.goals.get('goal-1')?.status).toBe('active')
    expect(state.goals.get('goal-1')?.progressLog).toHaveLength(2)
    expect(startTurn).toHaveBeenCalledTimes(1)
  })
})
