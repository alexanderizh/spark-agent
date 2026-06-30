import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import { SessionService } from '../../services/session.service.js'

type SessionRow = {
  id: string
  kind: string
  title: string
  status: string
  project_id: string
  workspace_ids_json: string
  rule_bundle_id: string | null
  permission_profile_id: string | null
  provider_profile_id: string | null
  model_id: string | null
  agent_id: string | null
  agent_adapter: string
  permission_mode: string
  chat_mode: string
  reasoning_effort: string
  pinned_at: string | null
  archived_at: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}

type ProviderRow = {
  id: string
  provider_type: string
  name: string
  config_json: string
  enabled: number
  keystore_ref: string | null
  is_default: number
  created_at: string
  updated_at: string
}

type EventRow = {
  id: string
  session_id: string
  run_id: string | null
  turn_id: string
  event_type: string
  event_json: string
  seq: number
  created_at: string
}

type MockAgentItem = {
  id: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  isDefault: boolean
  providerProfileId: string | null
  modelId: string | null
  agentAdapter: string
  permissionMode: string
  reasoningEffort: string
  prompt: string
  ruleIds: string[]
  skillIds: string[]
  disabledSkillIds: string[]
  mcpServerIds: string[]
  hookConfig: Record<string, unknown>
  workflowId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type MockWorkflowItem = {
  id: string
  name: string
  description: string
  graph: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }
}

const mockState = vi.hoisted(() => ({
  sessions: new Map<string, SessionRow>(),
  providers: new Map<string, ProviderRow>(),
  events: [] as EventRow[],
  sdkConfigs: [] as Array<Record<string, unknown>>,
  sdkTurns: [] as Array<{ sessionId: string; turnId: string; message: string }>,
  workspaces: new Map<string, { id: string; root_path: string }>(),
  agents: new Map<string, MockAgentItem>(),
  workflows: new Map<string, MockWorkflowItem>(),
  nextSdkTurnErrors: [] as string[],
  usageRecords: [] as Array<{ sessionId: string; providerId: string; modelId: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number; requestTimestamp?: string }>,
}))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(async () => 'test-api-key'),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('@spark/storage', () => {
  const now = () => '2026-05-28T00:00:00.000Z'

  class SessionRepository {
    create(params: {
      id: string
      kind: string
      title: string
      status: string
      projectId: string
      workspaceIds?: string[]
      providerProfileId?: string
      modelId?: string
      agentId?: string
      agentAdapter?: string
      permissionMode?: string
      chatMode?: string
      reasoningEffort?: string
    }): SessionRow {
      const row: SessionRow = {
        id: params.id,
        kind: params.kind,
        title: params.title,
        status: params.status,
        project_id: params.projectId,
        workspace_ids_json: JSON.stringify(params.workspaceIds ?? []),
        rule_bundle_id: null,
        permission_profile_id: null,
        provider_profile_id: params.providerProfileId ?? null,
        model_id: params.modelId ?? null,
        agent_id: params.agentId ?? null,
        agent_adapter: params.agentAdapter ?? 'codex',
        permission_mode: params.permissionMode ?? 'codex-default',
        chat_mode: params.chatMode ?? 'agent',
        reasoning_effort: params.reasoningEffort ?? 'max',
        pinned_at: null,
        archived_at: null,
        metadata_json: '{}',
        created_at: now(),
        updated_at: now(),
      }
      mockState.sessions.set(row.id, row)
      return row
    }

    get(id: string): SessionRow | null {
      return mockState.sessions.get(id) ?? null
    }

    findByIdOrFail(id: string): SessionRow {
      const row = this.get(id)
      if (row == null) throw new Error(`Session not found: ${id}`)
      return row
    }

    getWorkspaceIds(id: string): string[] {
      const row = this.findByIdOrFail(id)
      return JSON.parse(row.workspace_ids_json) as string[]
    }

    updateTitle(id: string, title: string): void {
      const row = this.findByIdOrFail(id)
      row.title = title
      row.updated_at = now()
    }

    updateStatus(id: string, status: string): void {
      const row = this.findByIdOrFail(id)
      row.status = status
      row.updated_at = now()
    }

    updateRuntime(id: string, params: {
      providerProfileId?: string
      modelId?: string | null
      agentId?: string
      agentAdapter?: string
      permissionMode?: string
      chatMode?: string
      reasoningEffort?: string
    }): void {
      const row = this.findByIdOrFail(id)
      if (params.providerProfileId !== undefined) row.provider_profile_id = params.providerProfileId
      if (params.modelId !== undefined) row.model_id = params.modelId
      if (params.agentId !== undefined) row.agent_id = params.agentId
      if (params.agentAdapter !== undefined) row.agent_adapter = params.agentAdapter
      if (params.permissionMode !== undefined) row.permission_mode = params.permissionMode
      if (params.chatMode !== undefined) row.chat_mode = params.chatMode
      if (params.reasoningEffort !== undefined) row.reasoning_effort = params.reasoningEffort
      row.updated_at = now()
    }

    list(params: { status?: string; limit?: number } = {}): { sessions: SessionRow[]; total: number } {
      const rows = Array.from(mockState.sessions.values())
        .filter((row) => params.status == null || row.status === params.status)
      const limit = params.limit ?? rows.length
      return { sessions: rows.slice(0, limit), total: rows.length }
    }
  }

  class ProviderProfileRepository {
    get(id: string): ProviderRow | null {
      return mockState.providers.get(id) ?? null
    }
  }

  class UsageLedgerRepository {
    record(params: { sessionId: string; providerId: string; modelId: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number; requestTimestamp?: string }): string {
      mockState.usageRecords.push(params)
      return `usage-${mockState.usageRecords.length}`
    }

    getSessionUsage(_sessionId: string): {
      totalInputTokens: number
      totalOutputTokens: number
      totalCacheReadTokens: number
      totalCacheWriteTokens: number
      totalCostUsd: number
      recordCount: number
    } {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: 0,
        recordCount: 0,
      }
    }
  }

  class TeamDispatchRepository {
    create(): void {}
    update(): void {}
  }

  class EventRepository {
    countBySession(sessionId: string): number {
      return mockState.events.filter((row) => row.session_id === sessionId).length
    }

    insert(params: { id: string; sessionId: string; turnId?: string; eventType: string; eventJson: string }): void {
      mockState.events.push({
        id: params.id,
        session_id: params.sessionId,
        run_id: null,
        turn_id: params.turnId ?? '',
        event_type: params.eventType,
        event_json: params.eventJson,
        seq: mockState.events.length,
        created_at: now(),
      })
    }

    queryBySession(params: { sessionId: string; eventType?: string; limit?: number }): { events: EventRow[]; hasMore: boolean } {
      const rows = mockState.events
        .filter((row) => row.session_id === params.sessionId)
        .filter((row) => params.eventType == null || row.event_type === params.eventType)
        .slice()
        .reverse()
      const limit = params.limit ?? rows.length
      return { events: rows.slice(0, limit), hasMore: rows.length > limit }
    }

    queryDialogueEvents(_sessionId: string, _limit: number): EventRow[] {
      return []
    }
  }

  class RulesRepository { list(): unknown[] { return [] } }
  class WorkspaceRepository {
    get(id: string): { id: string; root_path: string } | null {
      return mockState.workspaces.get(id) ?? null
    }
  }
  class McpServerRepository { listAll(): unknown[] { return [] } }
  class SettingsRepository { get(): null { return null } }
  class SkillRepository {
    list(): unknown[] { return [] }
    get(): null { return null }
  }
  class AgentRepository {
    get(id: string): MockAgentItem | null {
      return mockState.agents.get(id) ?? null
    }
  }
  class WorkflowRepository {
    get(id: string): MockWorkflowItem | null {
      return mockState.workflows.get(id) ?? null
    }
  }
  class ContextPreferenceRepository {
    getPreference(): null { return null }
    getOverrides(): { pinnedPaths: string[]; excludedPaths: string[] } { return { pinnedPaths: [], excludedPaths: [] } }
    upsertPreference(): void {}
  }
  class SessionSummaryRepository {
    getLatest(): null { return null }
    create(): void {}
  }
  class GoalRepository {
    getCurrent(): null { return null }
  }

  return {
    SessionRepository,
    ProviderProfileRepository,
    EventRepository,
    UsageLedgerRepository,
    TeamDispatchRepository,
    RulesRepository,
    WorkspaceRepository,
    McpServerRepository,
    SettingsRepository,
    SkillRepository,
    AgentRepository,
    WorkflowRepository,
    ContextPreferenceRepository,
    SessionSummaryRepository,
    GoalRepository,
  }
})

vi.mock('../../sdk/index.js', () => ({
  isSDKAvailable: vi.fn(async () => true),
  loadSdkMcpFactory: vi.fn(async () => ({
    createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => ({
      type: 'sdk',
      name: opts.name,
      instance: { tools: opts.tools },
    }),
    tool: (name: string, _description: string, _inputSchema: Record<string, unknown>, handler: unknown) => ({
      name,
      handler,
    }),
  })),
  ClaudeSDKExecutor: class MockClaudeSDKExecutor {
    private handler: ((event: AgentEvent) => void) | null = null

    onEvent(handler: (event: AgentEvent) => void): void {
      this.handler = handler
    }

    cancel(): void {}

    async executeTurn(sessionId: string, turnId: string, message: string, config: Record<string, unknown>): Promise<void> {
      mockState.sdkTurns.push({ sessionId, turnId, message })
      mockState.sdkConfigs.push(config)
      const nextError = mockState.nextSdkTurnErrors.shift()
      if (nextError != null) {
        this.handler?.({
          id: `error-${turnId}`,
          sessionId,
          turnId,
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 0,
          type: 'agent_error',
          message: nextError,
          code: 'mock_error',
          retryable: false,
        })
      }
      this.handler?.({
        id: `completed-${turnId}`,
        sessionId,
        turnId,
        timestamp: '2026-05-28T00:00:00.000Z',
        seq: 0,
        type: 'agent_status',
        status: 'completed',
      })
    }
  },
}))

function seedProvider(row: Omit<ProviderRow, 'enabled' | 'created_at' | 'updated_at'>): void {
  mockState.providers.set(row.id, {
    ...row,
    enabled: 1,
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
  })
}

function makeAgent(params: Partial<MockAgentItem> & Pick<MockAgentItem, 'id' | 'name'>): MockAgentItem {
  return {
    id: params.id,
    name: params.name,
    description: params.description ?? '',
    builtIn: params.builtIn ?? false,
    enabled: params.enabled ?? true,
    isDefault: params.isDefault ?? false,
    providerProfileId: params.providerProfileId ?? null,
    modelId: params.modelId ?? null,
    agentAdapter: params.agentAdapter ?? 'claude-sdk',
    permissionMode: params.permissionMode ?? 'claude-plan',
    reasoningEffort: params.reasoningEffort ?? 'max',
    prompt: params.prompt ?? '',
    ruleIds: params.ruleIds ?? [],
    skillIds: params.skillIds ?? [],
    disabledSkillIds: params.disabledSkillIds ?? [],
    mcpServerIds: params.mcpServerIds ?? [],
    hookConfig: params.hookConfig ?? {},
    workflowId: params.workflowId ?? null,
    metadata: params.metadata ?? {},
    createdAt: params.createdAt ?? '2026-05-28T00:00:00.000Z',
    updatedAt: params.updatedAt ?? '2026-05-28T00:00:00.000Z',
  }
}

describe('SessionService runtime provider/model resolution', () => {
  let events: AgentEvent[]

  beforeEach(() => {
    mockState.sessions.clear()
    mockState.providers.clear()
    mockState.events.length = 0
    mockState.sdkConfigs.length = 0
    mockState.sdkTurns.length = 0
    mockState.workspaces.clear()
    mockState.agents.clear()
    mockState.workflows.clear()
    mockState.nextSdkTurnErrors.length = 0
    mockState.usageRecords.length = 0
    events = []

    seedProvider({
      id: 'tencent-provider',
      provider_type: 'anthropic',
      name: 'Tencent Coding',
      config_json: JSON.stringify({
        defaultModel: 'glm-5',
        modelIds: ['glm-5'],
        apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      }),
      keystore_ref: 'key-tencent',
      is_default: 1,
    })
    seedProvider({
      id: 'xiaomi-provider',
      provider_type: 'anthropic',
      name: 'Xiaomi MiMo',
      config_json: JSON.stringify({
        defaultModel: 'mimo-v2.5-pro',
        modelIds: ['mimo-v2.5-pro'],
        apiEndpoint: 'https://api.example.test/xiaomi/anthropic',
      }),
      keystore_ref: 'key-xiaomi',
      is_default: 0,
    })
  })

  it('records usage_update deltas to the usage ledger without double-counting cumulative updates', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Usage ledger session',
    })
    const eventRepo = { insert: vi.fn() }
    const persist = (service as unknown as {
      emitAndPersist: (
        sessionId: string,
        turnId: string,
        event: AgentEvent,
        eventRepo: { insert: ReturnType<typeof vi.fn> },
      ) => void
    }).emitAndPersist.bind(service)

    persist(
      sessionId,
      'turn-usage',
      {
        id: 'usage-1',
        sessionId,
        turnId: 'turn-usage',
        timestamp: '2026-05-28T00:00:01.000Z',
        seq: 0,
        type: 'usage_update',
        provider: 'claude',
        model: '',
        inputTokens: 100,
        outputTokens: 20,
        cacheHitTokens: 5,
        estimatedCostUsd: 0.01,
      },
      eventRepo,
    )
    persist(
      sessionId,
      'turn-usage',
      {
        id: 'usage-2',
        sessionId,
        turnId: 'turn-usage',
        timestamp: '2026-05-28T00:00:02.000Z',
        seq: 0,
        type: 'usage_update',
        provider: 'claude',
        model: '',
        inputTokens: 140,
        outputTokens: 35,
        cacheHitTokens: 7,
        estimatedCostUsd: 0.015,
      },
      eventRepo,
    )

    expect(mockState.usageRecords).toEqual([
      expect.objectContaining({
        sessionId,
        providerId: 'tencent-provider',
        modelId: 'glm-5',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        costUsd: 0.01,
      }),
      expect.objectContaining({
        sessionId,
        providerId: 'tencent-provider',
        modelId: 'glm-5',
        inputTokens: 40,
        outputTokens: 15,
        cacheReadTokens: 2,
        costUsd: expect.closeTo(0.005),
      }),
    ])
  })


  it('uses the session provider default model when an old session has no model id', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Old GLM session',
    })

    await service.sendTurn({ sessionId, message: 'hello old session' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'glm-5',
      apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      permissionMode: 'claude-plan',
      continueSession: false,
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn_prompt_snapshot',
      providerProfileId: 'tencent-provider',
      model: 'glm-5',
      permissionMode: 'claude-plan',
    }))
  })

  it('uses the updated same-adapter provider and model on the next turn', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Switchable SDK session',
    })

    await service.sendTurn({ sessionId, message: 'first turn' })
    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })

    await service.updateSession({
      sessionId,
      providerProfileId: 'xiaomi-provider',
      modelId: 'mimo-v2.5-pro',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    })
    await service.sendTurn({ sessionId, message: 'second turn after switch' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(2)
    })
    expect(mockState.sdkConfigs[1]).toMatchObject({
      model: 'mimo-v2.5-pro',
      apiEndpoint: 'https://api.example.test/xiaomi/anthropic',
      permissionMode: 'claude-plan',
      continueSession: false,
    })
    expect(mockState.sdkConfigs[1]?.sdkSessionId).not.toBe(mockState.sdkConfigs[0]?.sdkSessionId)
    expect(mockState.sessions.get(sessionId)).toMatchObject({
      provider_profile_id: 'xiaomi-provider',
      model_id: 'mimo-v2.5-pro',
      agent_adapter: 'claude-sdk',
      permission_mode: 'claude-plan',
    })
  })

  it('updates the persisted session title when /rename is executed as chat events', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Old title',
    })

    const result = await service.executeCommandAsEvents({
      sessionId,
      message: '/rename New command title',
    })

    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: false })
    expect(mockState.sessions.get(sessionId)?.title).toBe('New command title')
    expect(mockState.sdkTurns).toHaveLength(0)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant_message',
      provider: 'spark',
      isFinal: true,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_status',
      status: 'completed',
      message: '/rename completed',
    }))
  })

  it('does not inject command completed before /validate --repair follow-up Agent turn', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-validate-repair-'))
    writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ scripts: { typecheck: 'node -e "process.exit(1)"' } }),
    )
    mockState.workspaces.set('repair-workspace', { id: 'repair-workspace', root_path: workspaceRoot })

    try {
      const service = new SessionService({} as never, (event) => events.push(event))
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
        title: 'Repair validation session',
        workspaceId: 'repair-workspace',
      })

      const result = await service.executeCommandAsEvents({
        sessionId,
        message: '/validate npm run typecheck --repair',
      })

      expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: true })
      expect(mockState.sdkTurns).toHaveLength(1)
      expect(mockState.sdkTurns[0]?.message).toContain('验证命令: npm run typecheck')
      expect(events).toContainEqual(expect.objectContaining({
        type: 'assistant_message',
        provider: 'spark',
        isFinal: true,
      }))
      const sparkCommandCompleted = events.find((event) =>
        event.type === 'agent_status' &&
        event.status === 'completed' &&
        event.message === '/validate completed'
      )
      expect(sparkCommandCompleted).toBeUndefined()
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_status',
        status: 'completed',
      }))
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('renders /usage from persisted usage_update events when ledger is empty', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Usage session',
    })

    mockState.events.push({
      id: 'usage-1',
      session_id: sessionId,
      run_id: null,
      turn_id: 'turn-1',
      event_type: 'usage_update',
      event_json: JSON.stringify({
        id: 'usage-1',
        sessionId,
        turnId: 'turn-1',
        timestamp: '2026-05-28T00:00:00.000Z',
        seq: 0,
        type: 'usage_update',
        provider: 'claude',
        model: 'glm-5',
        inputTokens: 100,
        outputTokens: 40,
        estimatedCostUsd: 0.0123,
      }),
      seq: 0,
      created_at: '2026-05-28T00:00:00.000Z',
    }, {
      id: 'usage-2',
      session_id: sessionId,
      run_id: null,
      turn_id: 'turn-2',
      event_type: 'usage_update',
      event_json: JSON.stringify({
        id: 'usage-2',
        sessionId,
        turnId: 'turn-2',
        timestamp: '2026-05-28T00:00:00.000Z',
        seq: 1,
        type: 'usage_update',
        provider: 'claude',
        model: 'glm-5',
        inputTokens: 25,
        outputTokens: 10,
        estimatedCostUsd: 0.0032,
      }),
      seq: 1,
      created_at: '2026-05-28T00:00:00.000Z',
    })

    const result = await service.executeCommandAsEvents({ sessionId, message: '/usage' })

    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: false })
    const assistant = events.slice().reverse().find((event: AgentEvent) => event.type === 'assistant_message')
    expect(assistant).toEqual(expect.objectContaining({
      type: 'assistant_message',
      provider: 'spark',
      content: expect.stringContaining('125'),
    }))
    expect((assistant as Extract<AgentEvent, { type: 'assistant_message' }> | undefined)?.content).toContain('50')
    expect((assistant as Extract<AgentEvent, { type: 'assistant_message' }> | undefined)?.content).toContain('$0.0155')
  })

  it('passes selected attachments into the Claude SDK turn config', async () => {
    const attachmentPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Attachment session',
    })

    await service.sendTurn({
      sessionId,
      message: 'inspect the selected file',
      attachments: [{ type: 'file', path: attachmentPath }],
    })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      attachments: [
        expect.objectContaining({
          type: 'file',
          name: 'package.json',
          path: attachmentPath,
        }),
      ],
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn_prompt_snapshot',
      userMessage: expect.stringContaining('package.json'),
    }))
  })

  it('marks scheduled automation turns as unattended in the SDK config', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto',
      title: 'Scheduled automation session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      automation: {
        source: 'scheduled-task',
        unattended: true,
      },
    })

    await service.sendTurn({ sessionId, message: 'run unattended automation' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      permissionMode: 'claude-auto',
      unattended: true,
    })
    expect(mockState.sdkConfigs[0]).not.toHaveProperty('questionCallback')
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain(
      'unattended scheduled automation',
    )
  })

  it('constrains team host tools to dispatch when resolved members exist', async () => {
    mockState.agents.set('host-agent', makeAgent({
      id: 'host-agent',
      name: 'Host',
      providerProfileId: 'tencent-provider',
    }))
    mockState.agents.set('worker-1', makeAgent({
      id: 'worker-1',
      name: 'Worker One',
      providerProfileId: 'tencent-provider',
    }))
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Team host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1'],
      },
    })

    await service.sendTurn({ sessionId, message: 'orchestrate this', agentId: 'host-agent' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]?.mcpServers).toMatchObject({
      spark_team: expect.objectContaining({ type: 'sdk', name: 'spark_team' }),
    })
    expect(mockState.sdkConfigs[0]?.allowedTools).toEqual(expect.arrayContaining([
      'mcp__spark_team__agent_dispatch',
      'mcp__spark_team__agent_dispatch_batch',
    ]))
    expect(mockState.sdkConfigs[0]?.disallowedTools).toEqual(expect.arrayContaining([
      'Task',
      'Edit',
      'Write',
      'MultiEdit',
      'NotebookEdit',
      'TodoWrite',
      'Bash',
    ]))
  })

  it('exposes workflow_run for a managed host with an enabled explicit workflow worker', async () => {
    mockState.agents.set('workflow-host', makeAgent({
      id: 'workflow-host',
      name: 'Workflow Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-1',
    }))
    mockState.agents.set('workflow-worker', makeAgent({
      id: 'workflow-worker',
      name: 'Workflow Worker',
      providerProfileId: 'tencent-provider',
    }))
    mockState.workflows.set('workflow-1', {
      id: 'workflow-1',
      name: 'Sequential workflow',
      description: 'Run the configured worker.',
      graph: {
        nodes: [{
          id: 'work',
          kind: 'agent',
          title: 'Do the work',
          config: { agentId: 'workflow-worker', outputKey: 'result' },
        }],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow host session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    expect(config?.mcpServers).toMatchObject({
      spark_team: expect.objectContaining({ type: 'sdk', name: 'spark_team' }),
    })
    const teamServer = (config?.mcpServers as {
      spark_team: { instance: { tools: Array<{ name: string }> } }
    }).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual(['workflow_run'])
    expect(config?.allowedTools).toEqual(expect.arrayContaining([
      'mcp__spark_team__workflow_run',
    ]))
    expect(config?.disallowedTools).toEqual(expect.arrayContaining([
      'Task',
      'Edit',
      'Write',
      'MultiEdit',
      'NotebookEdit',
      'TodoWrite',
      'Bash',
    ]))
    expect(String(config?.systemPrompt ?? '')).toContain(
      'call `mcp__spark_team__workflow_run` exactly once with the current user objective',
    )
  })

  it('exposes workflow_run for a managed host with a temporary subagent workflow worker', async () => {
    mockState.agents.set('workflow-host', makeAgent({
      id: 'workflow-host',
      name: 'Workflow Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-subagent',
    }))
    mockState.workflows.set('workflow-subagent', {
      id: 'workflow-subagent',
      name: 'Subagent workflow',
      description: 'Run a temporary subagent worker.',
      graph: {
        nodes: [{
          id: 'draft-temp',
          kind: 'subagent',
          title: 'Draft Temp',
          config: {
            prompt: 'Draft the section',
            outputKey: 'section',
            modelId: 'glm-5',
            providerProfileId: 'tencent-provider',
          },
        }],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Subagent workflow host session',
    })

    await service.sendTurn({ sessionId, message: 'run the subagent workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const teamServer = (config?.mcpServers as {
      spark_team: { instance: { tools: Array<{ name: string }> } }
    }).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual(['workflow_run'])
    expect(config?.allowedTools).toEqual(expect.arrayContaining([
      'mcp__spark_team__workflow_run',
    ]))
  })

  it('returns a structured failed workflow_run result when a workflow worker fails', async () => {
    mockState.agents.set('workflow-host', makeAgent({
      id: 'workflow-host',
      name: 'Workflow Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-fail',
    }))
    mockState.agents.set('workflow-worker', makeAgent({
      id: 'workflow-worker',
      name: 'Workflow Worker',
      providerProfileId: 'tencent-provider',
    }))
    mockState.workflows.set('workflow-fail', {
      id: 'workflow-fail',
      name: 'Failing workflow',
      description: 'Exercise failed worker responses.',
      graph: {
        nodes: [{
          id: 'work',
          kind: 'agent',
          title: 'Do the work',
          config: { agentId: 'workflow-worker', retryCount: 1, outputKey: 'result' },
        }],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow failure session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const tool = ((mockState.sdkConfigs[0]?.mcpServers as {
      spark_team: {
        instance: {
          tools: Array<{
            name: string
            handler: (args: Record<string, unknown>) => Promise<{
              content: Array<{ text: string }>
              structuredContent: unknown
            }>
          }>
        }
      }
    }).spark_team.instance.tools).find((item) => item.name === 'workflow_run')
    if (tool == null) throw new Error('expected workflow_run tool')
    mockState.nextSdkTurnErrors.push('member failure', 'member failure')

    const response = await tool.handler({ objective: 'attempt failed workflow' })

    expect(response.content[0]?.text).toContain('Workflow failed at node work after 2 attempt(s)')
    expect(response.structuredContent).toMatchObject({
      status: 'failed',
      failedNode: {
        nodeId: 'work',
        agentId: 'workflow-worker',
        attempt: 2,
        error: { message: 'member failure' },
      },
    })
  })

  it('applies workflow agent node runtime overrides to the dispatched member turn', async () => {
    mockState.agents.set('workflow-host', makeAgent({
      id: 'workflow-host',
      name: 'Workflow Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-overrides',
    }))
    mockState.agents.set('workflow-worker', makeAgent({
      id: 'workflow-worker',
      name: 'Workflow Worker',
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      permissionMode: 'claude-plan',
      prompt: 'Persisted worker prompt',
    }))
    mockState.workflows.set('workflow-overrides', {
      id: 'workflow-overrides',
      name: 'Override workflow',
      description: 'Dispatch with node-level runtime config.',
      graph: {
        nodes: [{
          id: 'work',
          kind: 'agent',
          title: 'Do override work',
          config: {
            agentId: 'workflow-worker',
            prompt: 'Node prompt wins',
            modelId: 'mimo-v2.5-pro',
            providerProfileId: 'xiaomi-provider',
            permissionMode: 'claude-auto',
            outputKey: 'result',
          },
        }],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow override session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const tool = ((mockState.sdkConfigs[0]?.mcpServers as {
      spark_team: {
        instance: {
          tools: Array<{
            name: string
            handler: (args: Record<string, unknown>) => Promise<unknown>
          }>
        }
      }
    }).spark_team.instance.tools).find((item) => item.name === 'workflow_run')
    if (tool == null) throw new Error('expected workflow_run tool')

    await tool.handler({ objective: 'exercise overrides' })

    expect(mockState.sdkConfigs[1]).toMatchObject({
      model: 'mimo-v2.5-pro',
      permissionMode: 'claude-auto',
    })
    expect(String(mockState.sdkConfigs[1]?.apiEndpoint ?? '')).toContain('/xiaomi/')
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).toContain('Node prompt wins')
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).not.toContain('Persisted worker prompt')
  })

  it('exposes both team dispatch and workflow_run when a managed host has team members and workflow workers', async () => {
    mockState.agents.set('hybrid-host', makeAgent({
      id: 'hybrid-host',
      name: 'Hybrid Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-hybrid',
    }))
    mockState.agents.set('team-worker', makeAgent({
      id: 'team-worker',
      name: 'Team Worker',
      providerProfileId: 'tencent-provider',
    }))
    mockState.agents.set('workflow-worker', makeAgent({
      id: 'workflow-worker',
      name: 'Workflow Worker',
      providerProfileId: 'tencent-provider',
    }))
    mockState.workflows.set('workflow-hybrid', {
      id: 'workflow-hybrid',
      name: 'Hybrid workflow',
      description: 'Dispatch through the managed workflow.',
      graph: {
        nodes: [{
          id: 'workflow-step',
          kind: 'agent',
          title: 'Workflow step',
          config: { agentId: 'workflow-worker', outputKey: 'result' },
        }],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'hybrid-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Hybrid host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'hybrid-host',
        memberAgentIds: ['team-worker'],
      },
    })

    await service.sendTurn({ sessionId, message: 'orchestrate the hybrid workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const teamServer = (config?.mcpServers as {
      spark_team: { instance: { tools: Array<{ name: string }> } }
    }).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual([
      'agent_dispatch',
      'agent_dispatch_batch',
      'workflow_run',
    ])
    expect(config?.allowedTools).toEqual(expect.arrayContaining([
      'mcp__spark_team__agent_dispatch',
      'mcp__spark_team__agent_dispatch_batch',
      'mcp__spark_team__workflow_run',
    ]))
  })

  it('keeps flattened workflow fallback when explicit workers are blank, disabled, or missing', async () => {
    mockState.agents.set('workflow-host', makeAgent({
      id: 'workflow-host',
      name: 'Workflow Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-fallback',
    }))
    mockState.agents.set('disabled-worker', makeAgent({
      id: 'disabled-worker',
      name: 'Disabled Worker',
      enabled: false,
      providerProfileId: 'tencent-provider',
    }))
    mockState.workflows.set('workflow-fallback', {
      id: 'workflow-fallback',
      name: 'Fallback workflow',
      description: 'Keep rendering this workflow as a prompt.',
      graph: {
        nodes: [
          { id: 'blank', kind: 'agent', title: 'Blank', config: {} },
          { id: 'disabled', kind: 'agent', title: 'Disabled', config: { agentId: 'disabled-worker' } },
          { id: 'missing', kind: 'agent', title: 'Missing', config: { agentId: 'missing-worker' } },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow fallback session',
    })

    await service.sendTurn({ sessionId, message: 'handle without dispatch' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]?.mcpServers).not.toHaveProperty('spark_team')
    expect(mockState.sdkConfigs[0]?.allowedTools).not.toEqual(expect.arrayContaining([
      'mcp__spark_team__workflow_run',
    ]))
    expect(mockState.sdkConfigs[0]?.disallowedTools).not.toEqual(expect.arrayContaining([
      'Edit',
      'Write',
      'Bash',
    ]))
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain('[Workflow Execution Plan]')
  })

  it('does not add orchestrator host restrictions when team members do not resolve', async () => {
    mockState.agents.set('host-agent', makeAgent({
      id: 'host-agent',
      name: 'Host',
      providerProfileId: 'tencent-provider',
    }))
    mockState.agents.set('worker-1', makeAgent({
      id: 'worker-1',
      name: 'Disabled Worker',
      enabled: false,
      providerProfileId: 'tencent-provider',
    }))
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Empty team host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1', 'missing-worker'],
      },
    })

    await service.sendTurn({ sessionId, message: 'handle solo fallback', agentId: 'host-agent' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]?.mcpServers).not.toHaveProperty('spark_team')
    expect(mockState.sdkConfigs[0]?.allowedTools).not.toEqual(expect.arrayContaining([
      'mcp__spark_team__agent_dispatch',
      'mcp__spark_team__agent_dispatch_batch',
    ]))
    expect(mockState.sdkConfigs[0]?.disallowedTools).not.toEqual(expect.arrayContaining([
      'Edit',
      'Write',
      'Bash',
    ]))
  })

  it('applies provider and model overrides atomically on send-turn', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Runtime patch session',
    })

    await service.sendTurn({
      sessionId,
      message: 'send with runtime switch',
      providerProfileId: 'xiaomi-provider',
      modelId: 'mimo-v2.5-pro',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'mimo-v2.5-pro',
      apiEndpoint: 'https://api.example.test/xiaomi/anthropic',
      permissionMode: 'claude-plan',
    })
    expect(mockState.sessions.get(sessionId)).toMatchObject({
      provider_profile_id: 'xiaomi-provider',
      model_id: 'mimo-v2.5-pro',
      agent_adapter: 'claude-sdk',
      permission_mode: 'claude-plan',
    })
  })
})
