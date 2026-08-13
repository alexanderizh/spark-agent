import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { TeamA2ATask } from '@spark/protocol'
import {
  APP_IDENTITY_SYSTEM_PROMPT,
  MEMORY_BEHAVIOR_SYSTEM_PROMPT,
  buildConversationHistoryPromptFromEvents,
  buildMemberUserMessage,
  collectCompleteAssistantTurnText,
  createCodexExecutorForConfig,
  createInterruptedTurnEvents,
  createUserCancelledTurnEvent,
  hasWorkflowExecutableNodes,
  isSdkResumeSafe,
  makeSdkRuntimeSessionId,
  mapSessionAttachmentsToDispatch,
  isOpenAiOnlyCodexConsumer,
  resolveCodexMemberExecutionProfile,
  readRuntimeLogEnabled,
  SessionService,
  shouldAcceptSessionExecutorEvent,
  shouldRunTurnPostProcessing,
} from '../../services/session.service.js'
import { normalizeWorkflowGraph } from '../../services/workflow-executor.js'
import { SessionQuestionGate } from '../../services/session-question-gate.js'
import { CodexCliExecutor, CodexOpenAIExecutor, CodexSdkExecutor } from '../../sdk/index.js'
import {
  TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION,
  TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT,
  TeamDispatchAutoContinuationTracker,
} from '../../services/team-dispatch-auto-continuation.js'

describe('runtime log setting', () => {
  it('reads the toggle from telemetry data shared with the inspector panel', () => {
    const get = vi.fn((category: string, key: string): unknown => {
      if (category === 'telemetry' && key === 'data') {
        return { runtimeLogEnabled: true }
      }
      return null
    })

    expect(readRuntimeLogEnabled({ get })).toBe(true)
    expect(get).toHaveBeenCalledWith('telemetry', 'data')
  })

  it('does not treat the obsolete top-level setting as enabled', () => {
    const get = vi.fn((category: string, key: string): unknown => {
      if (category === 'telemetry' && key === 'runtimeLogEnabled') return true
      return null
    })

    expect(readRuntimeLogEnabled({ get })).toBe(false)
  })
})

describe('SparkWork application identity prompt', () => {
  it('introduces the platform and its core capabilities', () => {
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain('You are SparkWork')
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain('local-first dual-engine agent platform')
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain('documents and presentations')
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain('browser operations')
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain('multimedia creation on an infinite canvas')
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain("same language as the user's current message")
    expect(APP_IDENTITY_SYSTEM_PROMPT).toContain('explicitly requests another language')
  })
})

describe('SparkWork memory behavior prompt', () => {
  it('uses English-only instructions for both memory systems', () => {
    expect(MEMORY_BEHAVIOR_SYSTEM_PROMPT).toContain('Application Memory')
    expect(MEMORY_BEHAVIOR_SYSTEM_PROMPT).toContain('Project Rule Files')
    expect(MEMORY_BEHAVIOR_SYSTEM_PROMPT).toContain('in any language')
    expect(MEMORY_BEHAVIOR_SYSTEM_PROMPT).not.toMatch(/[\u3400-\u9fff]/u)
  })
})

function baseEvent(
  sessionId: string,
  turnId: string,
  seq: number,
): Pick<AgentEvent, 'id' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'> {
  return {
    id: `event-${seq}`,
    sessionId,
    turnId,
    timestamp: '2026-05-28T00:00:00.000Z',
    seq,
  }
}

describe('SessionService recovery helpers', () => {
  it('rejects late events from a cancelled or replaced executor', () => {
    const oldExecutor = {}
    const currentExecutor = {}
    const activeLoops = new Map([['session-1', currentExecutor]])

    expect(
      shouldAcceptSessionExecutorEvent({
        activeLoops,
        cancelledTurnIds: new Set(),
        sessionId: 'session-1',
        turnId: 'turn-old',
        executor: oldExecutor,
      }),
    ).toBe(false)
    expect(
      shouldAcceptSessionExecutorEvent({
        activeLoops: new Map([['session-1', oldExecutor]]),
        cancelledTurnIds: new Set(['turn-old']),
        sessionId: 'session-1',
        turnId: 'turn-old',
        executor: oldExecutor,
      }),
    ).toBe(false)
    expect(
      shouldAcceptSessionExecutorEvent({
        activeLoops: new Map([['session-1', currentExecutor]]),
        cancelledTurnIds: new Set(),
        sessionId: 'session-1',
        turnId: 'turn-current',
        executor: currentExecutor,
      }),
    ).toBe(true)
  })

  it('cancels and waits for active executors before shutdown completes', async () => {
    let finishExecution: (() => void) | undefined
    const executionDone = new Promise<void>((resolve) => {
      finishExecution = resolve
    })
    let finishTeamDispatch: (() => void) | undefined
    const teamDispatchDone = new Promise<void>((resolve) => {
      finishTeamDispatch = resolve
    })
    const execution = { cancel: vi.fn() }
    const onApprovalCancel = vi.fn()
    const platformStop = vi.fn(async () => undefined)
    const service = Object.create(SessionService.prototype) as {
      activeExecutionPromises: Map<typeof execution, { sessionId: string; promise: Promise<void> }>
      activeLoops: Map<string, typeof execution>
      dispose: () => Promise<void>
      startingSessions: Set<string>
      startingTurnIds: Map<string, string>
      runningTurnIds: Map<string, string>
      cancelledTurnIds: Set<string>
      disposing: boolean
      onApprovalCancel: (sessionId: string) => void
      platformBridge: { stop: () => Promise<void> }
      pendingPlanApprovals: Set<string>
      pendingUserQuestionGate: SessionQuestionGate
      pendingTurns: Map<string, unknown[]>
      teamDispatchService: { cancelAllAndWait: () => Promise<void> }
      teamMcpHandlesByTurn: Map<string, unknown>
      teamDispatchBudgetExhaustedTurns: Map<string, string>
      teamDispatchAutoContinuationTracker: { clear: () => void; reset: (sessionId: string) => void }
    }
    service.activeExecutionPromises = new Map([
      [execution, { sessionId: 'session-1', promise: executionDone }],
    ])
    service.activeLoops = new Map([['session-1', execution]])
    service.startingSessions = new Set()
    service.startingTurnIds = new Map()
    service.runningTurnIds = new Map()
    service.cancelledTurnIds = new Set()
    service.disposing = false
    service.onApprovalCancel = onApprovalCancel
    service.platformBridge = { stop: platformStop }
    service.pendingPlanApprovals = new Set()
    service.pendingUserQuestionGate = new SessionQuestionGate()
    service.pendingTurns = new Map()
    service.teamDispatchService = { cancelAllAndWait: vi.fn(() => teamDispatchDone) }
    service.teamMcpHandlesByTurn = new Map()
    service.teamDispatchBudgetExhaustedTurns = new Map()
    service.teamDispatchAutoContinuationTracker = { clear: vi.fn(), reset: vi.fn() }

    let disposed = false
    const disposePromise = service.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()

    expect(execution.cancel).toHaveBeenCalledOnce()
    expect(onApprovalCancel).toHaveBeenCalledWith('session-1')
    expect(disposed).toBe(false)

    finishExecution?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(false)
    expect(platformStop).not.toHaveBeenCalled()

    finishTeamDispatch?.()
    await disposePromise

    expect(platformStop).toHaveBeenCalledOnce()
  })

  it('does not start queued work after shutdown begins', () => {
    const queuedTurn = { turnId: 'turn-1' }
    const service = Object.create(SessionService.prototype) as {
      activeLoops: Map<string, unknown>
      disposing: boolean
      pendingPlanApprovals: Set<string>
      pendingUserQuestionGate: SessionQuestionGate
      pendingTurns: Map<string, unknown[]>
      startingSessions: Set<string>
      startNextQueuedTurn: (sessionId: string) => void
    }
    service.activeLoops = new Map()
    service.disposing = true
    service.pendingPlanApprovals = new Set()
    service.pendingUserQuestionGate = new SessionQuestionGate()
    service.pendingTurns = new Map([['session-1', [queuedTurn]]])
    service.startingSessions = new Set()

    service.startNextQueuedTurn('session-1')

    expect(service.pendingTurns.get('session-1')).toEqual([queuedTurn])
  })

  it('does not start queued work while a structured user question is pending', () => {
    const queuedTurn = { turnId: 'turn-1' }
    const gate = new SessionQuestionGate()
    gate.enter('session-1')
    const service = Object.create(SessionService.prototype) as {
      activeLoops: Map<string, unknown>
      disposing: boolean
      pendingPlanApprovals: Set<string>
      pendingUserQuestionGate: SessionQuestionGate
      pendingTurns: Map<string, unknown[]>
      startingSessions: Set<string>
      startNextQueuedTurn: (sessionId: string) => void
    }
    service.activeLoops = new Map()
    service.disposing = false
    service.pendingPlanApprovals = new Set()
    service.pendingUserQuestionGate = gate
    service.pendingTurns = new Map([['session-1', [queuedTurn]]])
    service.startingSessions = new Set()

    service.startNextQueuedTurn('session-1')

    expect(service.pendingTurns.get('session-1')).toEqual([queuedTurn])
  })

  it('routes remote Chat Completions configs through the direct OpenAI executor', () => {
    expect(createCodexExecutorForConfig({ codexApiKind: 'chat' })).toBeInstanceOf(
      CodexOpenAIExecutor,
    )
  })

  it('keeps Chat Completions off the Codex SDK even when a CLI provider config exists', () => {
    expect(
      createCodexExecutorForConfig({
        codexApiKind: 'chat',
        codexCliProvider: {
          id: 'spark-provider',
          wireApi: 'chat',
          envKey: 'SPARK_CODEX_API_KEY_TEST',
          env: { SPARK_CODEX_API_KEY_TEST: 'sk-test' },
        },
      }),
    ).toBeInstanceOf(CodexOpenAIExecutor)
  })

  it('keeps Codex Responses providers on the Codex SDK executor', () => {
    expect(createCodexExecutorForConfig({ codexApiKind: 'responses' })).toBeInstanceOf(
      CodexSdkExecutor,
    )
    expect(createCodexExecutorForConfig({})).toBeInstanceOf(CodexSdkExecutor)
  })

  it('gives an explicit Responses selection precedence over stale Chat provider metadata', () => {
    expect(
      createCodexExecutorForConfig({
        codexApiKind: 'responses',
        codexCliProvider: {
          id: 'spark-provider',
          wireApi: 'chat',
          envKey: 'SPARK_CODEX_API_KEY_TEST',
        },
      }),
    ).toBeInstanceOf(CodexSdkExecutor)
  })

  it('keeps local Codex CLI providers on the CLI executor', () => {
    expect(
      createCodexExecutorForConfig({ useLocalConfig: true, codexApiKind: 'chat' }),
    ).toBeInstanceOf(CodexCliExecutor)
  })

  it('creates terminal events for a turn interrupted by app restart', () => {
    const events = createInterruptedTurnEvents('session-1', 'turn-1', 7, '2026-05-28T00:00:00.000Z')

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'agent_error',
        sessionId: 'session-1',
        turnId: 'turn-1',
        seq: 7,
        code: 'APP_RESTARTED',
        retryable: true,
      }),
    )
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'agent_status',
        sessionId: 'session-1',
        turnId: 'turn-1',
        seq: 8,
        status: 'cancelled',
      }),
    )
  })

  it('finalizes persisted deltas before app-restart terminal events', () => {
    const partial = {
      ...baseEvent('session-1', 'turn-1', 5),
      type: 'assistant_message',
      mode: 'delta',
      content: 'surviving partial answer',
      provider: 'claude',
      isFinal: false,
      segmentId: 'text-1',
    } satisfies AgentEvent

    const events = createInterruptedTurnEvents(
      'session-1',
      'turn-1',
      7,
      '2026-05-28T00:00:00.000Z',
      [partial],
    )

    expect(events).toHaveLength(3)
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'assistant_message',
        mode: 'complete',
        content: 'surviving partial answer',
        segmentId: 'text-1',
        seq: 7,
      }),
    )
    expect(events[1]).toEqual(expect.objectContaining({ type: 'agent_error', seq: 8 }))
    expect(events[2]).toEqual(expect.objectContaining({ type: 'agent_status', seq: 9 }))
  })

  it('runs post-processing only for completed turns', () => {
    expect(shouldRunTurnPostProcessing('completed')).toBe(true)
    expect(shouldRunTurnPostProcessing('cancelled')).toBe(false)
    expect(shouldRunTurnPostProcessing('error')).toBe(false)
    expect(shouldRunTurnPostProcessing(null)).toBe(false)
  })

  it('creates a terminal event for a user-cancelled turn', () => {
    const event = createUserCancelledTurnEvent('session-1', 'turn-1', '2026-05-28T00:00:00.000Z')

    expect(event).toEqual(
      expect.objectContaining({
        type: 'agent_status',
        sessionId: 'session-1',
        turnId: 'turn-1',
        status: 'cancelled',
        message: 'Stopped by user',
      }),
    )
  })

  it('builds a compact system prompt from persisted dialogue events', () => {
    const prompt = buildConversationHistoryPromptFromEvents([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'user_message',
        content: 'Earlier user request about database indexes',
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: 'Earlier assistant answer mentioning idx_sessions_updated_at',
        provider: 'claude',
        isFinal: true,
      },
      {
        ...baseEvent('session-1', 'turn-2', 2),
        type: 'agent_status',
        status: 'completed',
      },
    ])

    expect(prompt).toContain('[Spark Session History]')
    expect(prompt).toContain('Earlier user request about database indexes')
    expect(prompt).toContain('idx_sessions_updated_at')
    expect(prompt).not.toContain('completed')
  })

  it('recovers user turns from prompt snapshots when SDK did not persist user_message events', () => {
    const prompt = buildConversationHistoryPromptFromEvents([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'turn_prompt_snapshot',
        userMessage: 'Earlier user request about the resume bug',
        systemPromptSections: [],
        model: 'glm-5',
        adapterKind: 'claude-sdk',
        permissionMode: 'claude-plan',
        toolCount: 12,
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: 'Earlier assistant answer about Spark Session History',
        provider: 'claude',
        isFinal: true,
      },
    ])

    expect(prompt).toContain('Earlier user request about the resume bug')
    expect(prompt).toContain('Earlier assistant answer about Spark Session History')
  })

  it('keeps attachment ledger from prompt snapshots when user_message also exists', () => {
    const prompt = buildConversationHistoryPromptFromEvents([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'user_message',
        content: 'Use the attached report to make a deck',
        attachments: [{ type: 'file', path: '/tmp/第二季度工作述职报告.docx' }],
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'turn_prompt_snapshot',
        userMessage:
          'Use the attached report to make a deck\n\nAttachments:\n1. file: 第二季度工作述职报告.docx (/tmp/第二季度工作述职报告.docx)',
        systemPromptSections: [],
        model: 'glm-5',
        adapterKind: 'claude-sdk',
        permissionMode: 'claude-plan',
        toolCount: 12,
      },
      {
        ...baseEvent('session-1', 'turn-1', 2),
        type: 'assistant_message',
        mode: 'complete',
        content: 'I extracted the document and started the PPT flow.',
        provider: 'claude',
        isFinal: true,
      },
    ])

    expect(prompt).toContain('Attachments:')
    expect(prompt).toContain('/tmp/第二季度工作述职报告.docx')
    expect(prompt).toContain('I extracted the document')
  })

  it('enables SDK resume for native Anthropic + Claude model (D-09)', () => {
    // D-09 已打开：原生 Anthropic + Claude 模型走 SDK resume，其余分支仍是 fresh session
    expect(
      isSdkResumeSafe({
        providerType: 'anthropic',
        model: 'claude-sonnet-4-5',
        agentAdapter: 'claude-sdk',
      }),
    ).toBe(true)

    // GLM 走 lkeap 代理：不是 api.anthropic.com，仍走 fresh
    expect(
      isSdkResumeSafe({
        providerType: 'anthropic',
        apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
        model: 'glm-5',
        agentAdapter: 'claude-sdk',
      }),
    ).toBe(false)

    // Claude 模型但通过非 anthropic 域名代理：保持 fresh
    expect(
      isSdkResumeSafe({
        providerType: 'anthropic',
        apiEndpoint: 'https://api.anthropic.com/v1',
        model: 'glm-5',
        agentAdapter: 'claude-sdk',
      }),
    ).toBe(false)
  })

  it('generates unique SDK session ids for fresh turns when resume is disabled', () => {
    const stable = makeSdkRuntimeSessionId('spark-session', 'provider-1', 'glm-5', 'claude-sdk')
    const firstTurn = makeSdkRuntimeSessionId(
      'spark-session',
      'provider-1',
      'glm-5',
      'claude-sdk',
      'turn-1',
    )
    const secondTurn = makeSdkRuntimeSessionId(
      'spark-session',
      'provider-1',
      'glm-5',
      'claude-sdk',
      'turn-2',
    )

    expect(firstTurn).not.toBe(stable)
    expect(secondTurn).not.toBe(stable)
    expect(secondTurn).not.toBe(firstTurn)
    expect(firstTurn).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('prefers the final assistant complete block when present', () => {
    const text = collectCompleteAssistantTurnText([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'assistant_message',
        mode: 'complete',
        content: '第一段答复',
        provider: 'codex',
        isFinal: false,
        segmentId: 'seg-1',
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: '第二段答复',
        provider: 'codex',
        isFinal: false,
        segmentId: 'seg-2',
      },
      {
        ...baseEvent('session-1', 'turn-1', 2),
        type: 'assistant_message',
        mode: 'complete',
        content: '第一段答复\n\n第二段答复',
        provider: 'codex',
        isFinal: true,
        segmentId: 'codex-sdk-turn-1',
      },
    ])

    expect(text).toBe('第一段答复\n\n第二段答复')
  })

  it('joins complete assistant segments in order when no final block is emitted', () => {
    const text = collectCompleteAssistantTurnText([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'assistant_message',
        mode: 'complete',
        content: '第一段答复',
        provider: 'codex',
        isFinal: false,
        segmentId: 'seg-1',
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: '第一段答复（修订版）',
        provider: 'codex',
        isFinal: false,
        segmentId: 'seg-1',
      },
      {
        ...baseEvent('session-1', 'turn-1', 2),
        type: 'assistant_message',
        mode: 'complete',
        content: '第二段答复',
        provider: 'codex',
        isFinal: false,
        segmentId: 'seg-2',
      },
    ])

    expect(text).toBe('第一段答复（修订版）\n\n第二段答复')
  })
})

describe('SessionService team dispatch auto-continuation', () => {
  it('starts a hidden continuation turn only after the exhausted turn is marked', async () => {
    const startTurn = vi.fn(async (..._args: unknown[]) => undefined)
    const continueGoalOrQueue = vi.fn(async () => undefined)
    const service = Object.create(SessionService.prototype) as {
      disposing: boolean
      pendingTurns: Map<string, unknown[]>
      pendingPlanApprovals: Set<string>
      pendingUserQuestionGate: SessionQuestionGate
      teamDispatchBudgetExhaustedTurns: Map<string, string>
      teamDispatchAutoContinuationTracker: TeamDispatchAutoContinuationTracker
      startTurn: (...args: unknown[]) => Promise<void>
      continueGoalOrQueue: (sessionId: string) => Promise<void>
      hasActiveSessionExecution: (sessionId: string) => boolean
      continueAfterTeamDispatchBudget: (sessionId: string, turnId: string) => Promise<void>
    }
    service.disposing = false
    service.pendingTurns = new Map()
    service.pendingPlanApprovals = new Set()
    service.pendingUserQuestionGate = new SessionQuestionGate()
    service.teamDispatchBudgetExhaustedTurns = new Map([['session-1', 'turn-1']])
    service.teamDispatchAutoContinuationTracker = new TeamDispatchAutoContinuationTracker()
    service.startTurn = startTurn
    service.continueGoalOrQueue = continueGoalOrQueue
    service.hasActiveSessionExecution = () => false

    await service.continueAfterTeamDispatchBudget('session-1', 'turn-1')

    expect(startTurn).toHaveBeenCalledOnce()
    expect(startTurn.mock.calls[0]?.[0]).toBe('session-1')
    expect(startTurn.mock.calls[0]?.[1]).not.toBe('turn-1')
    expect(startTurn.mock.calls[0]?.[2]).toBe(TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT)
    expect(startTurn.mock.calls[0]?.[3]).toEqual(TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION)
    expect(continueGoalOrQueue).not.toHaveBeenCalled()
  })

  it('stops automatic continuation when the Host is waiting for user approval', async () => {
    const startTurn = vi.fn(async (..._args: unknown[]) => undefined)
    const service = Object.create(SessionService.prototype) as {
      disposing: boolean
      pendingTurns: Map<string, unknown[]>
      pendingPlanApprovals: Set<string>
      pendingUserQuestionGate: SessionQuestionGate
      teamDispatchBudgetExhaustedTurns: Map<string, string>
      teamDispatchAutoContinuationTracker: TeamDispatchAutoContinuationTracker
      startTurn: (...args: unknown[]) => Promise<void>
      continueAfterTeamDispatchBudget: (sessionId: string, turnId: string) => Promise<void>
      emitQueueChanged: (sessionId: string) => void
    }
    service.disposing = false
    service.pendingTurns = new Map()
    service.pendingPlanApprovals = new Set(['session-1'])
    service.pendingUserQuestionGate = new SessionQuestionGate()
    service.teamDispatchBudgetExhaustedTurns = new Map([['session-1', 'turn-1']])
    service.teamDispatchAutoContinuationTracker = new TeamDispatchAutoContinuationTracker()
    service.startTurn = startTurn
    service.emitQueueChanged = vi.fn()

    await service.continueAfterTeamDispatchBudget('session-1', 'turn-1')

    expect(startTurn).not.toHaveBeenCalled()
    expect(service.emitQueueChanged).toHaveBeenCalledWith('session-1')
  })

  it('removes queued team continuations when a visible user turn arrives', () => {
    const service = Object.create(SessionService.prototype) as {
      pendingTurns: Map<string, Array<{ turnId: string; isTeamDispatchAutoContinuation?: boolean }>>
      removeQueuedTeamDispatchAutoContinuations: (sessionId: string) => void
      emitQueueChanged: (sessionId: string) => void
    }
    service.pendingTurns = new Map([
      [
        'session-1',
        [
          { turnId: 'hidden-continuation', isTeamDispatchAutoContinuation: true },
          { turnId: 'visible-user-turn' },
        ],
      ],
    ])
    service.emitQueueChanged = vi.fn()

    service.removeQueuedTeamDispatchAutoContinuations('session-1')

    expect(service.pendingTurns.get('session-1')).toEqual([{ turnId: 'visible-user-turn' }])
    expect(service.emitQueueChanged).toHaveBeenCalledWith('session-1')
  })

  it('clears queued turns without cancelling the active executor', () => {
    const activeExecution = { cancel: vi.fn() }
    const prepare = vi.fn(() => ({ run: vi.fn(() => ({ changes: 1 })) }))
    const service = Object.create(SessionService.prototype) as {
      activeLoops: Map<string, { cancel: () => void }>
      db: { raw: { prepare: typeof prepare } }
      pendingTurns: Map<string, Array<{ turnId: string; message: string; enqueuedAt: string }>>
      startingSessions: Set<string>
      resetTeamDispatchAutoContinuation: (sessionId: string) => void
      emitQueueChanged: (sessionId: string) => void
      clearQueuedTurns: (params: { sessionId: string }) => {
        cancelledCount: number
        queuedTurns: unknown[]
      }
    }
    service.activeLoops = new Map([['session-1', activeExecution]])
    service.db = { raw: { prepare } }
    service.pendingTurns = new Map([
      [
        'session-1',
        [
          { turnId: 'turn-1', message: 'first', enqueuedAt: '2026-08-14T00:00:00.000Z' },
          { turnId: 'turn-2', message: 'second', enqueuedAt: '2026-08-14T00:01:00.000Z' },
        ],
      ],
    ])
    service.startingSessions = new Set()
    service.resetTeamDispatchAutoContinuation = vi.fn()
    service.emitQueueChanged = vi.fn()

    const result = service.clearQueuedTurns({ sessionId: 'session-1' })

    expect(result.cancelledCount).toBe(2)
    expect(result.queuedTurns).toEqual([])
    expect(service.pendingTurns.has('session-1')).toBe(false)
    expect(activeExecution.cancel).not.toHaveBeenCalled()
    expect(service.resetTeamDispatchAutoContinuation).toHaveBeenCalledWith('session-1')
    expect(service.emitQueueChanged).toHaveBeenCalledWith('session-1')
    expect(prepare).toHaveBeenCalledTimes(2)
  })
})

describe('SessionService.clearSessionMemory (删除/清空会话的执行器回收)', () => {
  type ClearSessionMemoryInternals = {
    activeLoops: Map<string, { cancel: () => void }>
    clearSessionMemory: (sessionId: string) => boolean
    eventSequencer: { clear: (sessionId: string) => void }
    iterationOverrides: Map<string, number>
    onApprovalCancel: (sessionId: string) => void
    onQueueChanged?: () => void
    pendingPlanApprovals: Set<string>
    pendingTurns: Map<string, unknown[]>
    pendingUserQuestionGate: SessionQuestionGate
    startingSessions: Set<string>
    startingTurnIds: Map<string, string>
    runningTurnIds: Map<string, string>
    cancelledTurnIds: Set<string>
    teamDispatchService: { cancelBySession: (sessionId: string) => number }
    teamDispatchBudgetExhaustedTurns: Map<string, string>
    teamDispatchAutoContinuationTracker: { clear: () => void; reset: (sessionId: string) => void }
  }

  function makeService(
    activeLoops: Array<[string, { cancel: () => void }]> = [],
  ): ClearSessionMemoryInternals {
    const service = Object.create(SessionService.prototype) as ClearSessionMemoryInternals
    service.activeLoops = new Map(activeLoops)
    service.eventSequencer = { clear: vi.fn() }
    service.iterationOverrides = new Map()
    service.onApprovalCancel = vi.fn()
    // emitQueueChanged 会走 onQueueChanged?.(queueSnapshot(...))，这里只关心不抛错
    service.onQueueChanged = vi.fn()
    service.pendingPlanApprovals = new Set()
    service.pendingTurns = new Map()
    service.pendingUserQuestionGate = new SessionQuestionGate()
    service.startingSessions = new Set()
    service.startingTurnIds = new Map()
    service.runningTurnIds = new Map()
    service.cancelledTurnIds = new Set()
    service.teamDispatchService = { cancelBySession: vi.fn(() => 0) }
    service.teamDispatchBudgetExhaustedTurns = new Map()
    service.teamDispatchAutoContinuationTracker = { clear: vi.fn(), reset: vi.fn() }
    return service
  }

  it('cancels the running executor before dropping it from activeLoops', () => {
    // 只 delete 不 cancel 会让 SDK/CLI 子进程成为孤儿：继续改磁盘、继续计费。
    const execution = { cancel: vi.fn() }
    const service = makeService([['session-1', execution]])
    service.pendingTurns.set('session-1', [{ turnId: 'turn-2' }])
    service.pendingPlanApprovals.add('session-1')
    service.startingSessions.add('session-1')
    service.iterationOverrides.set('session-1', 12)

    const wasRunning = service.clearSessionMemory('session-1')

    expect(execution.cancel).toHaveBeenCalledOnce()
    expect(wasRunning).toBe(true)
    expect(service.activeLoops.has('session-1')).toBe(false)
    expect(service.pendingTurns.has('session-1')).toBe(false)
    expect(service.pendingPlanApprovals.has('session-1')).toBe(false)
    expect(service.startingSessions.has('session-1')).toBe(false)
    expect(service.iterationOverrides.has('session-1')).toBe(false)
    expect(service.onApprovalCancel).toHaveBeenCalledWith('session-1')
  })

  it('cancels only this session team dispatches, not every session', () => {
    const service = makeService([['session-1', { cancel: vi.fn() }]])

    service.clearSessionMemory('session-1')

    expect(service.teamDispatchService.cancelBySession).toHaveBeenCalledWith('session-1')
  })

  it('releases a pending user-question gate so the session cannot stay blocked', () => {
    const service = makeService()
    service.pendingUserQuestionGate.enter('session-1')
    service.pendingUserQuestionGate.enter('session-1')
    expect(service.pendingUserQuestionGate.isBlocked('session-1')).toBe(true)

    service.clearSessionMemory('session-1')

    expect(service.pendingUserQuestionGate.isBlocked('session-1')).toBe(false)
  })

  it('reports false when the session had no running executor', () => {
    const service = makeService()

    expect(service.clearSessionMemory('session-1')).toBe(false)
  })

  it('still clears state when the executor throws on cancel', () => {
    const execution = {
      cancel: vi.fn(() => {
        throw new Error('executor already gone')
      }),
    }
    const service = makeService([['session-1', execution]])

    expect(() => service.clearSessionMemory('session-1')).not.toThrow()
    expect(service.activeLoops.has('session-1')).toBe(false)
  })
})

describe('buildMemberUserMessage (agent_dispatch / workflow_run inputs delivery)', () => {
  const baseTask: TeamA2ATask = {
    taskId: 'task-1',
    hostAgentId: 'host',
    memberAgentId: 'member',
    rootTurnId: 'turn-1',
    instruction: 'Implement the feature.',
  }

  it('renders task.inputs into the member-visible prompt', () => {
    // Regression for a real bug found while wiring up workflow_run's outputKey → inputs
    // chaining: buildWorkflowNodeInputs computes the upstream node's output and attaches it
    // to TeamA2ATask.inputs, but the dispatched member never actually saw it — this function
    // dropped the field entirely, so multi-node state passing was silently inert.
    const message = buildMemberUserMessage({
      ...baseTask,
      inputs: { impact_analysis: 'Touches src/auth.ts and its 3 callers.' },
    })
    expect(message).toContain('[Inputs]')
    expect(message).toContain('impact_analysis')
    expect(message).toContain('Touches src/auth.ts and its 3 callers.')
  })

  it('omits the [Inputs] section when inputs is absent or empty', () => {
    expect(buildMemberUserMessage(baseTask)).not.toContain('[Inputs]')
    expect(buildMemberUserMessage({ ...baseTask, inputs: {} })).not.toContain('[Inputs]')
  })

  it('renders file_ref/image_ref attachments with a Read-tool instruction', () => {
    const message = buildMemberUserMessage({
      ...baseTask,
      attachments: [
        { type: 'image_ref', value: '/tmp/screenshot.png' },
        { type: 'file_ref', value: '/tmp/spec.md' },
      ],
    })
    expect(message).toContain('[Attachments]')
    expect(message).toContain('image_ref: /tmp/screenshot.png')
    expect(message).toContain('file_ref: /tmp/spec.md')
    expect(message).toContain('Use the Read tool')
  })
})

describe('SessionService.startNextQueuedTurn (全局并发上限)', () => {
  type ConcurrencyInternals = {
    activeLoops: Map<string, { cancel: () => void }>
    disposing: boolean
    maxConcurrentSessions: number
    pendingPlanApprovals: Set<string>
    pendingTurns: Map<string, unknown[]>
    pendingUserQuestionGate: SessionQuestionGate
    startingSessions: Set<string>
    startNextQueuedTurn: (sessionId: string) => void
    emitQueueChanged: (sessionId: string) => void
  }

  function makeService(maxConcurrent: number, activeCount: number): ConcurrencyInternals {
    const activeLoops = new Map<string, { cancel: () => void }>()
    for (let i = 0; i < activeCount; i++) {
      activeLoops.set(`active-${i}`, { cancel: vi.fn() })
    }
    const service = Object.create(SessionService.prototype) as ConcurrencyInternals
    service.activeLoops = activeLoops
    service.disposing = false
    service.maxConcurrentSessions = maxConcurrent
    service.pendingPlanApprovals = new Set()
    service.pendingTurns = new Map()
    service.pendingUserQuestionGate = new SessionQuestionGate()
    service.startingSessions = new Set()
    service.emitQueueChanged = vi.fn()
    return service
  }

  it('达到全局上限时不再起跑新 turn，保留在队列里', () => {
    // 全局已有 3 个执行器在跑，上限=3；新 turn 必须排队等待
    const service = makeService(3, 3)
    service.pendingTurns.set('session-new', [
      { turnId: 'turn-1', message: 'hi', enqueuedAt: '2026-07-26T00:00:00.000Z' },
    ])

    service.startNextQueuedTurn('session-new')

    // 队列没被消费——turn 留在里面等槽位释放
    expect(service.pendingTurns.get('session-new')).toHaveLength(1)
    expect(service.activeLoops.has('session-new')).toBe(false)
  })

  it('同一 session 已在跑时即使全局未满也不重复起跑', () => {
    const service = makeService(6, 1)
    service.activeLoops.set('session-a', { cancel: vi.fn() })
    service.pendingTurns.set('session-a', [
      { turnId: 'turn-2', message: 'second', enqueuedAt: '2026-07-26T00:00:00.000Z' },
    ])

    service.startNextQueuedTurn('session-a')

    expect(service.pendingTurns.get('session-a')).toHaveLength(1)
  })

  it('全局上限不阻挡已在跑的 session 继续推进自己的队列（单 session 串行由 activeLoops 检查保证）', () => {
    // 关键不变量：全局上限只压跨 session 并行度，不破坏单 session 的串行语义
    const service = makeService(1, 1) // 上限=1，已有一个在跑
    // 那个在跑的就是 session-a 自己；它的队列不应被全局上限二次阻挡
    service.activeLoops.clear()
    service.activeLoops.set('session-a', { cancel: vi.fn() })
    service.pendingTurns.set('session-a', [
      { turnId: 'turn-2', message: 'next', enqueuedAt: '2026-07-26T00:00:00.000Z' },
    ])

    service.startNextQueuedTurn('session-a')

    // session-a 自己还在跑（activeLoops.has），turn 留在队列等当前 turn 结束
    expect(service.pendingTurns.get('session-a')).toHaveLength(1)
  })

  it('上限检查把 startingSessions 也算进去（防止同步调度循环放行超限）', () => {
    // 场景：schedulePendingQueuesGlobally 的同步循环里调 startNextQueuedTurn，
    // 后者 startingSessions.add 是同步的、activeLoops.set 要等异步 startTurn。
    // 如果上限只看 activeLoops.size，循环里它永远是 0，全部 candidates 被放行。
    // 这条用例锁住 startingSessions 必须纳入计数。
    const service = makeService(3, 1) // 上限 3，1 个已在 activeLoops
    // 再模拟 2 个已进入 startingSessions（刚 startNextQueuedTurn 还没注册 activeLoops）
    service.startingSessions.add('starting-1')
    service.startingSessions.add('starting-2')
    // 此时 inflight = activeLoops(1) + startingSessions(2) = 3 = 上限
    service.pendingTurns.set('session-new', [
      { turnId: 'turn-1', message: 'hi', enqueuedAt: '2026-07-26T00:00:00.000Z' },
    ])

    service.startNextQueuedTurn('session-new')

    // 被上限挡住，队列保留
    expect(service.pendingTurns.get('session-new')).toHaveLength(1)
  })
})

describe('SessionService.startTurn (入口全局上限兜底)', () => {
  type StartTurnInternals = {
    activeLoops: Map<string, { cancel: () => void }>
    enqueueTurn: (sessionId: string, turn: unknown) => void
    makePendingTurn: (
      turnId: string,
      message: string,
    ) => { turnId: string; message: string; enqueuedAt: string }
    maxConcurrentSessions: number
    startingSessions: Set<string>
    startingTurnIds: Map<string, string>
    cancelledTurnIds: Set<string>
    startNextQueuedTurn: (sessionId: string) => void
    startTurn: (
      sessionId: string,
      turnId: string,
      message: string,
      presentation?: {
        turnSource?: 'user' | 'scheduled_task' | 'goal_contract_draft' | 'goal_iteration'
        userMessageVisibility?: 'visible' | 'hidden'
      },
    ) => Promise<void>
  }

  function makeStartTurnService(maxConcurrent: number, activeCount: number): StartTurnInternals {
    const activeLoops = new Map<string, { cancel: () => void }>()
    for (let i = 0; i < activeCount; i++) {
      activeLoops.set(`active-${i}`, { cancel: vi.fn() })
    }
    const service = Object.create(SessionService.prototype) as StartTurnInternals
    service.activeLoops = activeLoops
    service.maxConcurrentSessions = maxConcurrent
    service.startingSessions = new Set()
    service.startingTurnIds = new Map()
    service.cancelledTurnIds = new Set()
    service.startNextQueuedTurn = vi.fn()
    service.enqueueTurn = vi.fn()
    service.makePendingTurn = vi.fn((turnId: string, message: string) => ({
      turnId,
      message,
      enqueuedAt: '2026-07-26T00:00:00.000Z',
    }))
    return service
  }

  it('全局已满时，直接调 startTurn 也被挡住并入队（兜底 sendTurn/goal 等绕过路径）', async () => {
    // sendTurn（非 durable）、命令 follow-up、goal 迭代直接调 startTurn，
    // 不经过 startNextQueuedTurn。startTurn 入口必须有全局检查，否则上限形同虚设。
    const service = makeStartTurnService(2, 2) // 上限 2，2 个在跑
    const enqueueTurn = service.enqueueTurn as unknown as ReturnType<typeof vi.fn>

    await service.startTurn('session-new', 'turn-1', 'hi')

    // 没注册成 activeLoop，而是被入队
    expect(service.activeLoops.has('session-new')).toBe(false)
    expect(enqueueTurn).toHaveBeenCalledOnce()
    expect(enqueueTurn.mock.calls[0]![0]).toBe('session-new')
  })

  it('入队时保留内部 Turn 的来源与用户消息可见性', async () => {
    const service = makeStartTurnService(1, 1)
    const presentation = {
      turnSource: 'scheduled_task' as const,
      userMessageVisibility: 'hidden' as const,
    }

    await service.startTurn('session-new', 'turn-1', 'internal prompt', presentation)

    expect(service.makePendingTurn).toHaveBeenCalledWith(
      'turn-1',
      'internal prompt',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      presentation,
      undefined,
      false,
    )
  })

  it('全局未满时 startTurn 正常进入（不被误拦）', async () => {
    const service = makeStartTurnService(3, 2) // 上限 3，2 个在跑，还有 1 个槽位

    // startTurn 内部会调 sessionRepo/providerRepo 等（需要完整 db），这里只验证
    // 它没有被上限挡回 enqueueTurn——抛错说明它通过了上限检查、进入了后续逻辑
    const enqueueTurn = service.enqueueTurn as unknown as ReturnType<typeof vi.fn>
    await service.startTurn('session-new', 'turn-1', 'hi').catch(() => {
      // 后续逻辑因桩 db 抛错，预期内
    })

    expect(enqueueTurn).not.toHaveBeenCalled()
  })

  it('direct startTurn registers a preflight guard and releases it on failure', async () => {
    const service = makeStartTurnService(3, 2)

    await service.startTurn('session-new', 'turn-1', 'hi').catch(() => {
      // Minimal test double has no database; the assertion is about guard cleanup.
    })

    expect(service.startingSessions.has('session-new')).toBe(false)
    expect(service.startingTurnIds.has('session-new')).toBe(false)
    expect(service.cancelledTurnIds.has('turn-1')).toBe(false)
  })

  it('does not count its own queued preflight slot against the concurrency limit', async () => {
    const service = makeStartTurnService(1, 0)
    service.startingSessions.add('session-new')
    service.startingTurnIds.set('session-new', 'turn-1')
    const enqueueTurn = service.enqueueTurn as unknown as ReturnType<typeof vi.fn>

    await service.startTurn('session-new', 'turn-1', 'hi').catch(() => {
      // Minimal test double has no database; the assertion is about the limit check.
    })

    expect(enqueueTurn).not.toHaveBeenCalled()
  })
})

describe('SessionService.queueSnapshot (内部 Turn 展示隔离)', () => {
  it('给 Renderer 队列保留 hidden 展示元数据', () => {
    const service = Object.create(SessionService.prototype) as {
      toQueuedTurns: (
        turns: Array<{
          turnId: string
          message: string
          enqueuedAt: string
          userMessageVisibility?: 'visible' | 'hidden'
        }>,
      ) => Array<{ turnId: string; message: string }>
    }

    expect(
      service.toQueuedTurns([
        {
          turnId: 'internal-turn',
          message: 'internal prompt',
          enqueuedAt: '2026-08-13T00:00:00.000Z',
          userMessageVisibility: 'hidden',
        },
        {
          turnId: 'user-turn',
          message: 'visible prompt',
          enqueuedAt: '2026-08-13T00:00:01.000Z',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        turnId: 'internal-turn',
        message: 'internal prompt',
        userMessageVisibility: 'hidden',
      }),
      expect.objectContaining({ turnId: 'user-turn', message: 'visible prompt' }),
    ])
  })
})

describe('SessionService.deleteMessage (轮次完整性)', () => {
  type DeleteMessageInternals = {
    db: { raw: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } }
    deleteMessage: (sessionId: string, eventIds: string[]) => Promise<{ deleted: number }>
  }

  it('空 eventIds 直接返回 0，不查库', async () => {
    const prepare = vi.fn()
    const service = Object.create(SessionService.prototype) as DeleteMessageInternals
    service.db = { raw: { prepare } } as unknown as DeleteMessageInternals['db']

    const result = await service.deleteMessage('s1', [])

    expect(result).toEqual({ deleted: 0 })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('删 user_message 时把同轮的 assistant_message 一起纳入（避免留下半截轮次）', async () => {
    // 模拟：用户要删 user-1（turn-1），但 turn-1 还有 assistant-1。
    // 不展开就会留下 assistant-1，回放时模型会把上一轮回答当新输入。
    const userMessageRow = { id: 'user-1', turn_id: 'turn-1', event_type: 'user_message' }
    const expandedSameTurnRows = [{ id: 'user-1' }, { id: 'assistant-1' }]
    const allMock = vi
      .fn()
      // 第一次查询：按传入 eventIds 找命中的消息事件
      .mockReturnValueOnce([userMessageRow])
      // 第二次查询：按 turn_id 展开同轮所有消息事件
      .mockReturnValueOnce(expandedSameTurnRows)
    const prepare = vi.fn().mockReturnValue({ all: allMock })
    const service = Object.create(SessionService.prototype) as DeleteMessageInternals
    service.db = { raw: { prepare } } as unknown as DeleteMessageInternals['db']

    // deleteMessage 会走到 eventRepo.deleteEventsByIds（真实 EventRepository 构造
    // 需要完整 db）。我们只验证扩展查询发生了——这是完整性逻辑的核心。
    await service.deleteMessage('s1', ['user-1']).catch(() => {
      // deleteEventsByIds 因桩 db 抛错，预期内
    })

    // 验证完整性扩展查询发生过：一次按 event_id 查消息事件，一次按 turn_id 展开同轮。
    // 不锁定总调用次数——EventRepository 构造时的 sqlite_master 探测也会调 prepare。
    const sqls = prepare.mock.calls.map((call) => String(call[0]))
    expect(sqls.some((sql) => sql.includes('id IN') && sql.includes('event_type'))).toBe(true)
    expect(sqls.some((sql) => sql.includes('turn_id IN') && sql.includes('event_type'))).toBe(true)
  })
})

describe('mapSessionAttachmentsToDispatch (workflow_run attachment passthrough)', () => {
  it('maps session attachments to dispatch attachment refs by path, not content', () => {
    // Regression for a real gap: workflow_run dispatched nodes previously had no channel
    // at all for the attachments (images/files) the user attached to the triggering message
    // — WorkflowAgentDispatchRequest didn't even have an `attachments` field. Members can
    // read the shared workspace filesystem, so passing the path (same as the host's own
    // buildPromptWithAttachments does) is sufficient — no need to smuggle binary content.
    const result = mapSessionAttachmentsToDispatch([
      { type: 'image', path: '/tmp/screenshot.png' },
      { type: 'file', path: '/tmp/spec.md' },
      { type: 'directory', path: '/tmp/assets' },
    ])
    expect(result).toEqual([
      { type: 'image_ref', value: '/tmp/screenshot.png' },
      { type: 'file_ref', value: '/tmp/spec.md' },
      { type: 'file_ref', value: '/tmp/assets' },
    ])
  })
})

describe('hasWorkflowExecutableNodes (orchestrator-host gating)', () => {
  // Real graph shipped by migration 041 for the built-in 全栈开发标准流程 workflow:
  // 6 kind:"agent" nodes with role/prompt filled in but no config.agentId — the host
  // walks all phases itself in one continuous turn (guided mode), it never dispatches.
  const guidedFullstackWorkflowGraph = {
    nodes: [
      { id: 'n1', kind: 'agent', title: '需求理解', config: { role: '需求分析', prompt: '...' } },
      { id: 'n2', kind: 'agent', title: '影响分析', config: { role: '影响评估', prompt: '...' } },
      { id: 'n3', kind: 'agent', title: '方案设计', config: { role: '方案设计', prompt: '...' } },
      { id: 'n4', kind: 'agent', title: '编码实现', config: { role: '编码实现', prompt: '...' } },
      { id: 'n5', kind: 'agent', title: '测试修复', config: { role: '测试与修复', prompt: '...' } },
      { id: 'n6', kind: 'agent', title: '验证交付', config: { role: '验证交付', prompt: '...' } },
    ],
    edges: [],
  }

  it('classifies an unbound agent workflow as executable when host fallback is available', () => {
    // 空 agentId 表示继承宿主 Agent；workflow_run 会把这些节点派发给当前会话宿主。
    const graph = normalizeWorkflowGraph(guidedFullstackWorkflowGraph)
    expect(hasWorkflowExecutableNodes(graph, new Set(['host-agent']), 'host-agent')).toBe(true)
  })

  it('does not classify an unbound agent workflow as executable without host fallback', () => {
    const graph = normalizeWorkflowGraph(guidedFullstackWorkflowGraph)
    expect(hasWorkflowExecutableNodes(graph)).toBe(false)
  })

  it('classifies a workflow as executable once a kind:"agent" node binds a real agentId', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [{ id: 'n1', kind: 'agent', title: 'Review', config: { agentId: 'qa-agent' } }],
      edges: [],
    })
    expect(hasWorkflowExecutableNodes(graph, new Set(['qa-agent']))).toBe(true)
  })

  it('classifies a workflow as executable when it has a kind:"subagent" dispatch node', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [{ id: 'n1', kind: 'subagent', title: 'Review', config: {} }],
      edges: [],
    })
    expect(hasWorkflowExecutableNodes(graph)).toBe(true)
  })
})

describe('resolveCodexMemberExecutionProfile (FR-0a codex member executor routing)', () => {
  it('routes claude-sdk members to claude-auto with NO codex fields, even on a non-anthropic provider', () => {
    // 关键回归点：claude 成员即便挂在 openai provider 下，也不注入任何 codex 字段，
    // sdkConfig 与改动前逐字节一致（不会误把 claude 成员塞进 codex 执行器）。
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'claude-sdk',
      isLocalCli: false,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'OpenAI',
      apiKey: 'sk-x',
      codexApiKind: 'chat',
      apiEndpoint: 'https://api.openai.com/v1',
    })
    expect(profile.isCodexMember).toBe(false)
    expect(profile.permissionMode).toBe('claude-auto')
    expect(profile.extras).toEqual({})
  })

  it('treats the bare "claude" adapter the same as "claude-sdk"', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'claude',
      isLocalCli: false,
      providerType: 'anthropic',
      providerProfileId: 'p1',
      providerName: 'Anthropic',
      apiKey: 'sk-ant',
    })
    expect(profile.isCodexMember).toBe(false)
    expect(profile.permissionMode).toBe('claude-auto')
    expect(profile.extras).toEqual({})
  })

  it('marks local-CLI claude members with useLocalConfig but still no codex fields', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'claude-sdk',
      isLocalCli: true,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'Local Claude CLI',
      apiKey: '',
    })
    expect(profile.isCodexMember).toBe(false)
    expect(profile.permissionMode).toBe('claude-auto')
    expect(profile.extras).toEqual({ useLocalConfig: true })
  })

  it('routes codex members to codex-auto-review and builds codexCliProvider for non-anthropic providers', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: false,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'OpenAI',
      apiKey: 'sk-x',
      codexApiKind: 'responses',
      apiEndpoint: 'https://api.openai.com/v1',
    })
    expect(profile.isCodexMember).toBe(true)
    expect(profile.permissionMode).toBe('codex-auto-review')
    expect(profile.extras.codexApiKind).toBe('responses')
    // 非 anthropic + 非本地 CLI → 构造 codexCliProvider（与 Host 主循环对称）
    expect(profile.extras.codexCliProvider).toBeDefined()
    expect(profile.extras.codexCliProvider?.wireApi).toBe('responses')
    expect(profile.extras.codexCliProvider?.baseUrl).toBe('https://api.openai.com/v1')
    expect(profile.extras.codexCliProvider?.envKey).toMatch(/SPARK_CODEX_API_KEY_P1/)
    // 非本地 CLI 不注入 useLocalConfig
    expect(profile.extras.useLocalConfig).toBeUndefined()
  })

  it('marks local-CLI codex members with useLocalConfig and skips codexCliProvider (host OAuth)', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: true,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'Local Codex CLI',
      apiKey: '',
    })
    expect(profile.isCodexMember).toBe(true)
    expect(profile.permissionMode).toBe('codex-auto-review')
    expect(profile.extras.useLocalConfig).toBe(true)
    // 本地 CLI 走宿主 OAuth/本地配置，不构造 codexCliProvider（与 Host 路径一致）
    expect(profile.extras.codexCliProvider).toBeUndefined()
  })

  it('keeps local Codex CLI while attaching a Spark provider for an override', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: true,
      cliSparkOverride: true,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'Spark OpenAI',
      apiKey: 'sk-x',
      codexApiKind: 'responses',
      apiEndpoint: 'https://api.openai.com/v1',
    })
    expect(profile.extras.useLocalConfig).toBe(true)
    expect(profile.extras.codexCliProvider).toMatchObject({
      wireApi: 'responses',
      envKey: 'SPARK_CODEX_API_KEY_P1',
    })
    expect(createCodexExecutorForConfig(profile.extras)).toBeInstanceOf(CodexCliExecutor)
  })

  it('does not inherit host Claude config when a local Claude member has a Spark override', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'claude-sdk',
      isLocalCli: true,
      cliSparkOverride: true,
      providerType: 'anthropic',
      providerProfileId: 'p1',
      providerName: 'Spark Anthropic',
      apiKey: 'sk-ant',
    })
    expect(profile.extras).toEqual({})
  })

  it('keeps anthropic-provider codex members free of codexCliProvider (native anthropic auth)', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: false,
      providerType: 'anthropic',
      providerProfileId: 'p1',
      providerName: 'Anthropic',
      apiKey: 'sk-ant',
      codexApiKind: 'responses',
    })
    expect(profile.isCodexMember).toBe(true)
    expect(profile.extras.codexApiKind).toBe('responses')
    expect(profile.extras.codexCliProvider).toBeUndefined()
  })

  it('defaults codexCliProvider.wireApi to responses when provider omits codexApiKind', () => {
    const profile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: false,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'OpenAI',
      apiKey: 'sk-x',
    })
    expect(profile.extras.codexApiKind).toBeUndefined()
    expect(profile.extras.codexCliProvider?.wireApi).toBe('responses')
  })

  it('compose: profile.extras feed createCodexExecutorForConfig to pick the right executor', () => {
    // 组合验证：本地 CLI codex 成员的 extras 选出 CodexCliExecutor
    const localProfile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: true,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'Local',
      apiKey: '',
    })
    expect(createCodexExecutorForConfig(localProfile.extras)).toBeInstanceOf(CodexCliExecutor)

    // 非 anthropic + codexCliProvider 存在 → CodexCliExecutor（与 Host 主循环一致）
    const remoteProfile = resolveCodexMemberExecutionProfile({
      memberAdapter: 'codex',
      isLocalCli: false,
      providerType: 'openai',
      providerProfileId: 'p1',
      providerName: 'OpenAI',
      apiKey: 'sk-x',
      codexApiKind: 'responses',
    })
    expect(createCodexExecutorForConfig(remoteProfile.extras)).toBeInstanceOf(CodexSdkExecutor)
  })
})

describe('isOpenAiOnlyCodexConsumer direct Chat routing', () => {
  it('marks remote anthropic-profile Chat consumers as direct OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: true,
        isLocalCli: false,
        providerType: 'anthropic',
        codexApiKind: 'chat',
      }),
    ).toBe(true)
  })

  it('does not mark Codex SDK responses providers as OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: true,
        isLocalCli: false,
        providerType: 'anthropic',
        codexApiKind: 'responses',
      }),
    ).toBe(false)
  })

  it('marks remote OpenAI-compatible Chat consumers as direct OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: true,
        isLocalCli: false,
        providerType: 'openai',
        codexApiKind: 'chat',
      }),
    ).toBe(true)
  })

  it('does not mark local CLI codex as OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: true,
        isLocalCli: true,
        providerType: 'anthropic',
        codexApiKind: 'chat',
      }),
    ).toBe(false)
  })

  it('does not mark claude consumers as OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: false,
        isLocalCli: false,
        providerType: 'anthropic',
        codexApiKind: 'chat',
      }),
    ).toBe(false)
  })
})
