import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { TeamA2ATask } from '@spark/protocol'
import {
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
  SessionService,
  shouldRunTurnPostProcessing,
} from '../../services/session.service.js'
import { normalizeWorkflowGraph } from '../../services/workflow-executor.js'
import { CodexCliExecutor, CodexSdkExecutor } from '../../sdk/index.js'

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
      activeExecutionPromises: Map<
        typeof execution,
        { sessionId: string; promise: Promise<void> }
      >
      activeLoops: Map<string, typeof execution>
      dispose: () => Promise<void>
      startingSessions: Set<string>
      disposing: boolean
      onApprovalCancel: (sessionId: string) => void
      platformBridge: { stop: () => Promise<void> }
      pendingPlanApprovals: Set<string>
      pendingTurns: Map<string, unknown[]>
      teamDispatchService: { cancelAllAndWait: () => Promise<void> }
      teamMcpHandlesByTurn: Map<string, unknown>
    }
    service.activeExecutionPromises = new Map([
      [execution, { sessionId: 'session-1', promise: executionDone }],
    ])
    service.activeLoops = new Map([['session-1', execution]])
    service.startingSessions = new Set()
    service.disposing = false
    service.onApprovalCancel = onApprovalCancel
    service.platformBridge = { stop: platformStop }
    service.pendingPlanApprovals = new Set()
    service.pendingTurns = new Map()
    service.teamDispatchService = { cancelAllAndWait: vi.fn(() => teamDispatchDone) }
    service.teamMcpHandlesByTurn = new Map()

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
      pendingTurns: Map<string, unknown[]>
      startingSessions: Set<string>
      startNextQueuedTurn: (sessionId: string) => void
    }
    service.activeLoops = new Map()
    service.disposing = true
    service.pendingPlanApprovals = new Set()
    service.pendingTurns = new Map([['session-1', [queuedTurn]]])
    service.startingSessions = new Set()

    service.startNextQueuedTurn('session-1')

    expect(service.pendingTurns.get('session-1')).toEqual([queuedTurn])
  })

  it('routes bare Codex chat-compatible API configs through the Codex SDK executor', () => {
    expect(createCodexExecutorForConfig({ codexApiKind: 'chat' })).toBeInstanceOf(CodexSdkExecutor)
  })

  it('routes OpenAI-compatible Codex provider configs through the Codex SDK executor for tool access', () => {
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
    ).toBeInstanceOf(CodexSdkExecutor)
  })

  it('keeps Codex Responses providers on the Codex SDK executor', () => {
    expect(createCodexExecutorForConfig({ codexApiKind: 'responses' })).toBeInstanceOf(
      CodexSdkExecutor,
    )
    expect(createCodexExecutorForConfig({})).toBeInstanceOf(CodexSdkExecutor)
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

  it('keeps SDK resume disabled while persisted history provides continuity', () => {
    expect(
      isSdkResumeSafe({
        providerType: 'anthropic',
        model: 'claude-sonnet-4-5',
        agentAdapter: 'claude-sdk',
      }),
    ).toBe(false)

    expect(
      isSdkResumeSafe({
        providerType: 'anthropic',
        apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
        model: 'glm-5',
        agentAdapter: 'claude-sdk',
      }),
    ).toBe(false)

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

describe('isOpenAiOnlyCodexConsumer legacy compatibility hook', () => {
  it('does not mark Codex SDK chat-wire providers as OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: true,
        isLocalCli: false,
        providerType: 'anthropic',
        codexApiKind: 'chat',
      }),
    ).toBe(false)
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

  it('does not mark non-anthropic Codex SDK providers as OpenAI-only', () => {
    expect(
      isOpenAiOnlyCodexConsumer({
        isCodex: true,
        isLocalCli: false,
        providerType: 'openai',
        codexApiKind: 'chat',
      }),
    ).toBe(false)
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
