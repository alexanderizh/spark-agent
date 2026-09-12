import { describe, expect, it, vi } from 'vitest'
import type { AgentItem } from '@spark/storage'
import { WorkflowSessionLauncher } from './workflow-session-launcher.js'

const acyclicGraph = {
  nodes: [
    { id: 'a', kind: 'agent', title: 'A', config: {} },
    { id: 'b', kind: 'agent', title: 'B', config: {} },
  ],
  edges: [{ from: 'a', to: 'b' }],
}

interface HarnessOptions {
  status?: 'draft' | 'active' | 'archived'
  enabled?: boolean
  boundAgents?: Array<Partial<AgentItem> & { id: string }>
  flagsOn?: boolean
  submitTurnError?: Error
}

function makeLauncher(options: HarnessOptions = {}) {
  const agentCreate = vi.fn(() => ({
    id: 'agent-tmp-legacy',
    name: '启动工作流 · 试跑',
    workflowId: 'wf-launch',
  }))
  const createSession = vi.fn(async (params: Record<string, unknown>) => ({
    sessionId: 'sess-launch',
    session: { agentId: 'platform-manager-agent' },
    // record what the launcher passed for assertions
    ...(params.workflowBinding != null ? { bindingSeen: params.workflowBinding } : {}),
  }))
  const submitTurn = vi.fn(async () => {
    if (options.submitTurnError != null) throw options.submitTurnError
    return { turnId: 'turn-1', accepted: true as const, started: true }
  })
  const deleteSession = vi.fn(async () => ({ deleted: true }))
  const launcher = new WorkflowSessionLauncher({
    workflowRepo: {
      get: vi.fn(() => ({
        id: 'wf-launch',
        name: '启动工作流',
        description: '',
        status: options.status ?? 'active',
        enabled: options.enabled ?? true,
        graph: acyclicGraph,
      })),
    } as never,
    workflowRunRepo: { findWorkingByWorkflow: vi.fn(() => null) } as never,
    turnRequestRepo: { get: vi.fn(() => ({ id: 'turn-1', status: 'running' })) } as never,
    agentRepo: {
      get: vi.fn(() => null),
      list: vi.fn(() => (options.boundAgents ?? []).map((agent) => ({ enabled: true, ...agent }))),
      create: agentCreate,
    } as never,
    settingsRepo: {
      get: vi.fn((_category: string, key: string) => (options.flagsOn === true ? true : undefined)),
    } as never,
    providerService: {
      listProviders: vi.fn(async () => [
        {
          id: 'p-default',
          name: 'Default',
          provider: 'openai' as const,
          defaultModel: 'm',
          modelIds: [],
          isDefault: true,
        },
      ]),
    } as never,
    sessionService: {
      createSession,
      submitTurn,
      deleteSession,
    } as never,
    launchingWorkflowIds: new Set<string>(),
    launchPollMs: 1,
    launchTimeoutMs: 5,
  })
  return { launcher, agentCreate, createSession, submitTurn, deleteSession }
}

describe('WorkflowSessionLauncher', () => {
  it('uses the session binding path and never creates a trial agent when flags are on', async () => {
    const { launcher, agentCreate, createSession } = makeLauncher({ flagsOn: true })

    const result = await launcher.launch({
      workflowId: 'wf-launch',
      objective: '发布',
      source: 'editor-test',
    })

    expect(agentCreate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      sessionId: 'sess-launch',
      createdAgent: false,
      usedSessionBinding: true,
      providerProfileId: 'p-default',
    })
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerProfileId: 'p-default',
        title: '试跑 · 启动工作流',
        workflowBinding: { mode: 'override', workflowId: 'wf-launch' },
        workflowBindingSource: 'editor-test',
      }),
    )
    expect(createSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentId: expect.anything() }),
    )
  })

  it('reuses an existing bound agent on both paths', async () => {
    const { launcher, agentCreate, createSession } = makeLauncher({
      flagsOn: true,
      boundAgents: [{ id: 'agent-bound', name: '编排 Agent', workflowId: 'wf-launch' }],
    })

    const result = await launcher.launch({
      workflowId: 'wf-launch',
      source: 'tool-package',
      providerProfileId: 'p-default',
    })

    expect(agentCreate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ hostAgentId: 'agent-bound', createdAgent: false })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-bound' }))
  })

  it('keeps the legacy editor fallback (temp trial agent) when flags are off', async () => {
    const { launcher, agentCreate, createSession } = makeLauncher({ flagsOn: false })

    const result = await launcher.launch({ workflowId: 'wf-launch', source: 'editor-test' })

    expect(agentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-launch', name: '启动工作流 · 试跑' }),
    )
    expect(result).toMatchObject({ createdAgent: true, usedSessionBinding: false })
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-tmp-legacy' }),
    )
  })

  it('rejects tool-package launches without a bound agent on the legacy path', async () => {
    const { launcher } = makeLauncher({ flagsOn: false })
    await expect(
      launcher.launch({ workflowId: 'wf-launch', source: 'tool-package' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('allows draft workflows only for editor test runs', async () => {
    const draft = { status: 'draft' as const }
    const editor = makeLauncher({ ...draft, flagsOn: true })
    await expect(
      editor.launcher.launch({ workflowId: 'wf-launch', source: 'editor-test' }),
    ).resolves.toMatchObject({ usedSessionBinding: true })

    const toolPackage = makeLauncher({ ...draft, flagsOn: true })
    await expect(
      toolPackage.launcher.launch({ workflowId: 'wf-launch', source: 'tool-package' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    const archivedEditor = makeLauncher({ status: 'archived' as const, flagsOn: true })
    await expect(
      archivedEditor.launcher.launch({ workflowId: 'wf-launch', source: 'editor-test' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('deletes the freshly created session when the turn fails to be accepted', async () => {
    const { launcher, deleteSession } = makeLauncher({
      flagsOn: true,
      submitTurnError: new Error('provider unavailable'),
    })

    await expect(
      launcher.launch({ workflowId: 'wf-launch', source: 'editor-test' }),
    ).rejects.toThrow('provider unavailable')
    expect(deleteSession).toHaveBeenCalledWith('sess-launch')
  })
})
