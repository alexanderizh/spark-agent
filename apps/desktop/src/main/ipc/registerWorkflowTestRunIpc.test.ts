import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentRepository,
  TurnRequestRepository,
  WorkflowRepository,
  WorkflowRunRepository,
} from '@spark/storage'
import type { ProviderService, SessionService } from '@spark/agent-runtime'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))

vi.mock('../db.js', () => ({
  getDatabase: vi.fn(),
}))

import { registerWorkflowTestRunIpc } from './registerWorkflowTestRunIpc.js'

const acyclicGraph = {
  nodes: [
    { id: 'a', kind: 'agent', title: 'A', config: {} },
    { id: 'b', kind: 'agent', title: 'B', config: {} },
  ],
  edges: [{ from: 'a', to: 'b' }],
}

const cyclicGraph = {
  nodes: [
    { id: 'a', kind: 'agent', title: '环一', config: {} },
    { id: 'b', kind: 'agent', title: '环二', config: {} },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ],
}

const invalidConditionReferenceGraph = {
  nodes: [
    {
      id: 'route-scope',
      kind: 'route',
      title: '判断核对深度',
      config: { outputKey: 'audit_mode' },
    },
    { id: 'full-audit', kind: 'agent', title: '完整核对', config: {} },
  ],
  edges: [
    {
      id: 'route-full',
      from: 'route-scope',
      to: 'full-audit',
      condition: { op: 'equals', key: 'route_mode', value: 'full' },
    },
  ],
}

interface RegisterOptions {
  workflowGraph?: Record<string, unknown>
  boundAgents?: Array<{ id: string; name: string; workflowId: string | null; enabled?: boolean }>
  activeRun?: boolean
  listProviders?: () => Promise<Array<{ id: string; isDefault: boolean }>>
  findWorkingByWorkflow?: () => { id: string; status: 'working' } | null
  turnRequestStatus?: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
}

function register(options: RegisterOptions = {}): {
  agentRepo: { create: ReturnType<typeof vi.fn> }
  sessionService: { createSession: ReturnType<typeof vi.fn>; submitTurn: ReturnType<typeof vi.fn> }
  workflowRunRepo: {
    findWorkingByWorkflow: ReturnType<typeof vi.fn>
  }
} {
  const workflowRepo = {
    get: vi.fn(() => ({
      id: 'wf-1',
      name: '发布流程',
      description: '  ',
      graph: options.workflowGraph ?? acyclicGraph,
    })),
  } as unknown as WorkflowRepository
  let workingLookupCount = 0
  const findWorkingByWorkflow = vi.fn(() => {
    workingLookupCount += 1
    if (options.findWorkingByWorkflow != null) return options.findWorkingByWorkflow()
    if (options.activeRun === true || workingLookupCount > 1) {
      return { id: 'run-active', status: 'working' as const }
    }
    return null
  })
  const workflowRunRepo = {
    findWorkingByWorkflow,
  } as unknown as WorkflowRunRepository
  const turnRequestRepo = {
    get: vi.fn(() => ({ id: 'turn-1', status: options.turnRequestStatus ?? 'accepted' })),
  } as unknown as TurnRequestRepository

  const create = vi.fn(() => ({
    id: 'agent-tmp',
    name: '发布流程 · 试跑',
    workflowId: 'wf-1',
  }))
  const agentRepo = {
    list: vi.fn(() =>
      (options.boundAgents ?? []).map((agent) => ({
        enabled: true,
        providerProfileId: null,
        ...agent,
      })),
    ),
    get: vi.fn(() => null),
    create,
  } as unknown as AgentRepository & { create: ReturnType<typeof vi.fn> }

  const providerService = {
    listProviders: vi.fn(
      options.listProviders ??
        (async () => [
          { id: 'p-default', isDefault: true },
          { id: 'p-other', isDefault: false },
        ]),
    ),
  } as unknown as ProviderService

  const createSession = vi.fn(async () => ({ sessionId: 'sess-1', session: {} }))
  const submitTurn = vi.fn(async () => ({ turnId: 'turn-1', accepted: true, started: true }))
  const sessionService = {
    createSession,
    submitTurn,
    hasActiveTurnLoop: vi.fn(() => false),
  } as unknown as SessionService

  registerWorkflowTestRunIpc({
    workflowRepo,
    workflowRunRepo,
    turnRequestRepo,
    agentRepo: agentRepo as AgentRepository,
    providerService,
    sessionService,
    launchingWorkflowIds: new Set<string>(),
  })
  return {
    agentRepo: { create },
    sessionService: { createSession, submitTurn },
    workflowRunRepo: { findWorkingByWorkflow },
  }
}

beforeEach(() => {
  harness.handlers.clear()
})

describe('registerWorkflowTestRunIpc', () => {
  it('creates a temp agent, session and submits objective turn when no agent is bound', async () => {
    const { agentRepo, sessionService } = register()
    const res = await harness.handlers.get('workflow:test-run')!({ workflowId: 'wf-1' })

    expect(agentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-1' }))
    expect(res.createdAgent).toBe(true)
    expect(res.agentName).toBe('发布流程 · 试跑')
    expect(sessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerProfileId: 'p-default',
        agentId: 'agent-tmp',
        title: '试跑 · 发布流程',
      }),
    )
    // description 为空 + 未传 objective → 兜底 objective 里带工作流名
    expect(sessionService.submitTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        message: expect.stringContaining('发布流程'),
      }),
    )
    expect(res.sessionId).toBe('sess-1')
  })

  it('reuses an existing bound agent instead of creating one', async () => {
    const { agentRepo, sessionService } = register({
      boundAgents: [{ id: 'agent-user', name: '我的编排', workflowId: 'wf-1' }],
    })
    const res = await harness.handlers.get('workflow:test-run')!({
      workflowId: 'wf-1',
      objective: '  发布 v2  ',
    })

    expect(agentRepo.create).not.toHaveBeenCalled()
    expect(res).toMatchObject({ agentId: 'agent-user', agentName: '我的编排', createdAgent: false })
    expect(sessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-user' }),
    )
    // 显式 objective 原样透传（仅去首尾空白）
    expect(sessionService.submitTurn).toHaveBeenCalledWith(
      expect.objectContaining({ message: '发布 v2' }),
    )
  })

  it('rejects cyclic graph before creating any session', async () => {
    const { agentRepo, sessionService } = register({ workflowGraph: cyclicGraph })
    await expect(
      harness.handlers.get('workflow:test-run')!({ workflowId: 'wf-1' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('循环依赖'),
    })
    expect(agentRepo.create).not.toHaveBeenCalled()
    expect(sessionService.createSession).not.toHaveBeenCalled()
  })

  it('rejects a duplicate test run while the workflow already has a working run', async () => {
    const { agentRepo, sessionService } = register({ activeRun: true })

    await expect(
      harness.handlers.get('workflow:test-run')!({ workflowId: 'wf-1' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('已有运行中的工作流'),
    })
    expect(agentRepo.create).not.toHaveBeenCalled()
    expect(sessionService.createSession).not.toHaveBeenCalled()
  })

  it('rejects a concurrent launch before either call can create a workflow run', async () => {
    let resolveProviders:
      | ((profiles: Array<{ id: string; isDefault: boolean }>) => void)
      | undefined
    const providersPending = new Promise<Array<{ id: string; isDefault: boolean }>>((resolve) => {
      resolveProviders = resolve
    })
    const { sessionService } = register({
      listProviders: () => providersPending,
    })
    const handler = harness.handlers.get('workflow:test-run')!

    const first = handler({ workflowId: 'wf-1' })
    await Promise.resolve()
    await expect(handler({ workflowId: 'wf-1' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('已有运行中的工作流'),
    })
    expect(sessionService.createSession).not.toHaveBeenCalled()

    resolveProviders?.([{ id: 'p-default', isDefault: true }])
    await expect(first).resolves.toMatchObject({ sessionId: 'sess-1' })
    expect(sessionService.createSession).toHaveBeenCalledOnce()
  })

  it('releases the launch lock when submitting the turn fails', async () => {
    const { sessionService } = register({ findWorkingByWorkflow: () => null })
    const handler = harness.handlers.get('workflow:test-run')!
    sessionService.submitTurn.mockRejectedValueOnce(new Error('turn submission failed'))

    await expect(handler({ workflowId: 'wf-1' })).rejects.toThrow('turn submission failed')

    await expect(handler({ workflowId: 'wf-1' })).resolves.toMatchObject({ sessionId: 'sess-1' })
  })

  it('releases the launch lock when the accepted turn terminates before workflow_run starts', async () => {
    const { sessionService } = register({
      findWorkingByWorkflow: () => null,
      turnRequestStatus: 'failed',
    })
    const handler = harness.handlers.get('workflow:test-run')!

    await expect(handler({ workflowId: 'wf-1' })).resolves.toMatchObject({ sessionId: 'sess-1' })
    await expect(handler({ workflowId: 'wf-1' })).resolves.toMatchObject({ sessionId: 'sess-1' })
    expect(sessionService.submitTurn).toHaveBeenCalledTimes(2)
  })

  it('returns actionable condition-reference details as a safe business error', async () => {
    const { agentRepo, sessionService } = register({
      workflowGraph: invalidConditionReferenceGraph,
    })

    await expect(
      harness.handlers.get('workflow:test-run')!({ workflowId: 'wf-1' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringMatching(/route_mode.*outputKey/),
    })
    expect(agentRepo.create).not.toHaveBeenCalled()
    expect(sessionService.createSession).not.toHaveBeenCalled()
  })

  it('fails when no provider profile is available', async () => {
    const workflowRepo = {
      get: vi.fn(() => ({ id: 'wf-1', name: 'w', description: '', graph: acyclicGraph })),
    } as unknown as WorkflowRepository
    const agentRepo = {
      list: vi.fn(() => []),
      get: vi.fn(() => null),
      create: vi.fn(() => ({ id: 'a', name: 'n' })),
    } as unknown as AgentRepository
    const providerService = {
      listProviders: vi.fn(async () => []),
    } as unknown as ProviderService
    const sessionService = {
      createSession: vi.fn(),
      submitTurn: vi.fn(),
    } as unknown as SessionService
    const workflowRunRepo = {
      findWorkingByWorkflow: vi.fn(() => null),
    } as unknown as WorkflowRunRepository
    const turnRequestRepo = {
      get: vi.fn(() => null),
    } as unknown as TurnRequestRepository

    registerWorkflowTestRunIpc({
      workflowRepo,
      workflowRunRepo,
      turnRequestRepo,
      agentRepo,
      providerService,
      sessionService: sessionService as SessionService,
      launchingWorkflowIds: new Set<string>(),
    })

    await expect(
      harness.handlers.get('workflow:test-run')!({ workflowId: 'wf-1' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('Provider'),
    })
    expect(sessionService.createSession).not.toHaveBeenCalled()
  })
})
