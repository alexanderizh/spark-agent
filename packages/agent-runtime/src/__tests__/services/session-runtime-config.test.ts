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
  agent_adapter: string
  permission_mode: string
  chat_mode: string
  reasoning_effort: string
  pinned_at: string | null
  archived_at: string | null
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

const mockState = vi.hoisted(() => ({
  sessions: new Map<string, SessionRow>(),
  providers: new Map<string, ProviderRow>(),
  events: [] as EventRow[],
  sdkConfigs: [] as Array<Record<string, unknown>>,
  sdkTurns: [] as Array<{ sessionId: string; turnId: string; message: string }>,
  workspaces: new Map<string, { id: string; root_path: string }>(),
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
        agent_adapter: params.agentAdapter ?? 'codex',
        permission_mode: params.permissionMode ?? 'codex-default',
        chat_mode: params.chatMode ?? 'agent',
        reasoning_effort: params.reasoningEffort ?? 'max',
        pinned_at: null,
        archived_at: null,
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
      agentAdapter?: string
      permissionMode?: string
      chatMode?: string
      reasoningEffort?: string
    }): void {
      const row = this.findByIdOrFail(id)
      if (params.providerProfileId !== undefined) row.provider_profile_id = params.providerProfileId
      if (params.modelId !== undefined) row.model_id = params.modelId
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
    get(): null { return null }
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

  return {
    SessionRepository,
    ProviderProfileRepository,
    EventRepository,
    UsageLedgerRepository,
    RulesRepository,
    WorkspaceRepository,
    McpServerRepository,
    SettingsRepository,
    SkillRepository,
    AgentRepository,
    ContextPreferenceRepository,
    SessionSummaryRepository,
  }
})

vi.mock('../../sdk/index.js', () => ({
  isSDKAvailable: vi.fn(async () => true),
  ClaudeSDKExecutor: class MockClaudeSDKExecutor {
    private handler: ((event: AgentEvent) => void) | null = null

    onEvent(handler: (event: AgentEvent) => void): void {
      this.handler = handler
    }

    cancel(): void {}

    async executeTurn(sessionId: string, turnId: string, message: string, config: Record<string, unknown>): Promise<void> {
      mockState.sdkTurns.push({ sessionId, turnId, message })
      mockState.sdkConfigs.push(config)
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

describe('SessionService runtime provider/model resolution', () => {
  let events: AgentEvent[]

  beforeEach(() => {
    mockState.sessions.clear()
    mockState.providers.clear()
    mockState.events.length = 0
    mockState.sdkConfigs.length = 0
    mockState.sdkTurns.length = 0
    mockState.workspaces.clear()
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
