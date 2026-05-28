import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionService } from '../../services/session.service.js'

// Mock all external dependencies
vi.mock('@spark/storage', () => ({
  SessionRepository: vi.fn(),
  EventRepository: vi.fn(),
  ProviderProfileRepository: vi.fn(),
  WorkspaceRepository: vi.fn(),
  RulesRepository: vi.fn(),
  McpServerRepository: vi.fn(),
  SkillRepository: vi.fn(),
  SettingsRepository: vi.fn(),
}))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(),
}))

vi.mock('../../services/adapter-factory.js', () => ({
  createAdapter: vi.fn(),
}))

vi.mock('../../core/index.js', () => ({
  AgentLoop: vi.fn(),
  ToolRegistry: vi.fn(),
  isCommand: vi.fn(() => false),
  parseCommand: vi.fn(() => null),
  createBuiltinRegistry: vi.fn(() => ({
    list: vi.fn(() => []),
    get: vi.fn(() => undefined),
    execute: vi.fn(async () => ({ success: false, message: '' })),
    register: vi.fn(),
  })),
}))

vi.mock('../../services/mcp-server.service.js', () => ({
  McpService: vi.fn().mockImplementation(() => ({
    registerToToolRegistry: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
    startAllEnabled: vi.fn(),
    stopAll: vi.fn(),
    listServers: vi.fn(() => []),
    getServerStatus: vi.fn(() => ({ connected: false, toolCount: 0 })),
    getServerTools: vi.fn(() => []),
    getAllMcpTools: vi.fn(() => []),
  })),
}))

// SDK not available in test environment — Claude SDK sessions fail fast.
vi.mock('../../sdk/index.js', () => ({
  ClaudeSDKExecutor: vi.fn(),
  isSDKAvailable: vi.fn(async () => false),
  SDKNotAvailableError: class extends Error { constructor() { super('SDK not available') } },
}))

import {
  SessionRepository,
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  SkillRepository,
  SettingsRepository,
} from '@spark/storage'
import * as keystore from '@spark/shared/keystore'
import { createAdapter } from '../../services/adapter-factory.js'
import { AgentLoop, ToolRegistry } from '../../core/index.js'

const mockDb = {} as never

function makeSessionRepo(overrides = {}) {
  return {
    create: vi.fn().mockReturnValue({ id: 'sess-1', created_at: '2024-01-01T00:00:00.000Z', status: 'idle', provider_profile_id: 'prov-1', title: 'New Session', workspace_ids_json: '[]' }),
    findByIdOrFail: vi.fn().mockReturnValue({ id: 'sess-1', provider_profile_id: 'prov-1', status: 'running', title: '新会话', workspace_ids_json: '[]' }),
    getWorkspaceIds: vi.fn().mockReturnValue([]),
    updateTitle: vi.fn(),
    updateStatus: vi.fn(),
    list: vi.fn().mockReturnValue({ sessions: [], total: 0 }),
    ...overrides,
  }
}

function makeEventRepo(overrides = {}) {
  return {
    insert: vi.fn(),
    countBySession: vi.fn().mockReturnValue(0),
    queryBySession: vi.fn().mockReturnValue({ events: [], hasMore: false }),
    ...overrides,
  }
}

function makeProviderRepo(overrides = {}) {
  return {
    get: vi.fn().mockReturnValue({ id: 'prov-1', provider_type: 'anthropic', keystore_ref: 'ref-1', config_json: '{"defaultModel":"claude-3-5-sonnet-20241022","modelIds":["claude-3-5-sonnet-20241022"]}' }),
    ...overrides,
  }
}

function makeOpenAIProviderRepo(overrides = {}) {
  return makeProviderRepo({
    get: vi.fn().mockReturnValue({ id: 'prov-1', provider_type: 'openai', keystore_ref: 'ref-1', config_json: '{"defaultModel":"gpt-4.1","modelIds":["gpt-4.1"]}' }),
    ...overrides,
  })
}

function makeLoop(overrides = {}) {
  return {
    onEvent: vi.fn(),
    cancel: vi.fn(),
    executeTurn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function makeRulesRepo(overrides = {}) {
  return {
    list: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

function makeSkillRepo(overrides = {}) {
  return {
    list: vi.fn().mockReturnValue([
      {
        id: 'skill:review',
        scope: 'user',
        name: 'Review',
        version: '1.0.0',
        root_path: '/skills/review',
        manifest_json: JSON.stringify({
          description: 'Review description',
          source: 'Test',
          systemPrompt: 'Review instructions',
          requiredTools: ['read_file'],
          tags: ['review'],
        }),
        enabled: 1,
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:00:00.000Z',
        registry_id: null,
        remote_id: null,
        author: 'Test',
        category: 'coding',
        tags_json: '["review"]',
        rating: 0,
        download_count: 0,
        homepage_url: null,
        icon_url: null,
      },
    ]),
    get: vi.fn().mockImplementation((id: string) => {
      if (id !== 'skill:review') return undefined
      return {
        id: 'skill:review',
        scope: 'user',
        name: 'Review',
        version: '1.0.0',
        root_path: '/skills/review',
        manifest_json: JSON.stringify({
          description: 'Review description',
          source: 'Test',
          systemPrompt: 'Review instructions',
          requiredTools: ['read_file'],
          tags: ['review'],
        }),
        enabled: 1,
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:00:00.000Z',
      }
    }),
    ...overrides,
  }
}

function makeSettingsRepo(overrides = {}) {
  return {
    get: vi.fn().mockImplementation((category: string, key: string) => {
      if (category === 'runtime.prompts' && key === 'system') {
        return { enabled: true, content: 'System prompt from settings' }
      }
      return null
    }),
    set: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ToolRegistry).mockImplementation(() => ({}) as never)
  vi.mocked(SkillRepository).mockImplementation(() => makeSkillRepo() as never)
  vi.mocked(SettingsRepository).mockImplementation(() => makeSettingsRepo() as never)
})

describe('SessionService.createSession', () => {
  it('creates a session and returns sessionId + createdAt', async () => {
    const sessionRepo = makeSessionRepo()
    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => makeEventRepo() as never)

    const svc = new SessionService(mockDb, vi.fn())
    const result = await svc.createSession({ providerProfileId: 'prov-1' })

    expect(sessionRepo.create).toHaveBeenCalledWith(expect.objectContaining({ providerProfileId: 'prov-1', title: '新会话' }))
    expect(result.sessionId).toBe('sess-1')
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
  })
})

describe('SessionService.sendTurn', () => {
  it('derives the default session title from the first user message', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(SkillRepository).mockImplementation(() => makeSkillRepo() as never)
    vi.mocked(SettingsRepository).mockImplementation(() => makeSettingsRepo() as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: '# 修复登录超时问题\n请先排查接口' })

    expect(sessionRepo.updateTitle).toHaveBeenCalledWith('sess-1', '修复登录超时问题')
  })

  it('does not overwrite a custom session title', async () => {
    const sessionRepo = makeSessionRepo({
      findByIdOrFail: vi.fn().mockReturnValue({
        id: 'sess-1',
        provider_profile_id: 'prov-1',
        title: '手动命名',
        status: 'running',
        workspace_ids_json: '[]',
      }),
    })
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: '新的需求说明' })

    expect(sessionRepo.updateTitle).not.toHaveBeenCalled()
  })

  it('returns turnId immediately without awaiting loop completion', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const onEvent = vi.fn()
    const svc = new SessionService(mockDb, onEvent)
    const result = await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })

    expect(result.started).toBe(true)
    expect(typeof result.turnId).toBe('string')
    expect(loop.onEvent).toHaveBeenCalled()
    expect(loop.executeTurn).toHaveBeenCalled()
    expect(createAdapter).toHaveBeenCalledWith('codex', 'chat')
  })

  it('uses provider defaultModel as the runtime model', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeProviderRepo({
      get: vi.fn().mockReturnValue({
        id: 'prov-1',
        provider_type: 'openai',
        keystore_ref: 'ref-1',
        config_json: '{"defaultModel":"gpt-4.1","modelIds":["gpt-4.1","gpt-4o-mini"],"apiEndpoint":"https://api.example.com/v1"}',
      }),
    })
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })

    expect(createAdapter).toHaveBeenCalledWith('codex', 'chat')
    expect(loop.executeTurn).toHaveBeenCalledWith(
      'sess-1',
      expect.any(String),
      'hello',
      expect.objectContaining({
        model: 'gpt-4.1',
        apiEndpoint: 'https://api.example.com/v1',
      }),
    )
  })

  it('passes layered prompts and visible skills into the agent config', async () => {
    const sessionRepo = makeSessionRepo({
      findByIdOrFail: vi.fn().mockReturnValue({
        id: 'sess-1',
        provider_profile_id: 'prov-1',
        model_id: 'gpt-custom',
        agent_adapter: 'codex',
        permission_mode: 'codex-default',
        reasoning_effort: 'medium',
        chat_mode: 'agent',
        status: 'running',
        title: '新会话',
        workspace_ids_json: '["workspace-1"]',
      }),
      getWorkspaceIds: vi.fn().mockReturnValue(['workspace-1']),
    })
    const eventRepo = makeEventRepo()
    const providerRepo = makeProviderRepo({
      get: vi.fn().mockReturnValue({
        id: 'prov-1',
        provider_type: 'openai',
        keystore_ref: 'ref-1',
        config_json: '{"defaultModel":"gpt-4.1","modelIds":["gpt-4.1"]}',
      }),
    })
    const rulesRepo = makeRulesRepo()
    const workspaceRepo = {
      get: vi.fn().mockReturnValue({
        id: 'workspace-1',
        name: 'Workspace',
        root_path: '/workspace',
        project_kind: 'generic',
      }),
    }
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(SkillRepository).mockImplementation(() => makeSkillRepo() as never)
    vi.mocked(SettingsRepository).mockImplementation(() => makeSettingsRepo({
      get: vi.fn().mockImplementation((category: string, key: string) => {
        if (category === 'runtime.skills' && key === 'project:workspace-1') return ['skill:review']
        if (category === 'runtime.prompts' && key === 'system') return { enabled: true, content: 'System prompt from settings' }
        if (category === 'runtime.prompts' && key === 'project:workspace-1') return { enabled: true, content: 'Project prompt from settings' }
        if (category === 'runtime.prompts' && key === 'session:sess-1') return { enabled: true, content: 'Session prompt from settings' }
        return null
      }),
    }) as never)
    const { WorkspaceRepository } = await import('@spark/storage')
    vi.mocked(WorkspaceRepository).mockImplementation(() => workspaceRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })

    expect(loop.executeTurn).toHaveBeenCalledWith(
      'sess-1',
      expect.any(String),
      'hello',
      expect.objectContaining({
        systemPrompt: expect.stringContaining('System prompt from settings'),
        skillSystemPrompt: expect.stringContaining('Review instructions'),
      }),
    )
    const config = vi.mocked(loop.executeTurn).mock.calls[0]?.[3] as { systemPrompt?: string; skillSystemPrompt?: string }
    expect(config.systemPrompt).toContain('Project prompt from settings')
    expect(config.systemPrompt).toContain('Session prompt from settings')
    expect(config.skillSystemPrompt).toContain('[Available Skills]')
  })

  it('passes prior session messages and tool context into direct model turns', async () => {
    const sessionRepo = makeSessionRepo({
      findByIdOrFail: vi.fn().mockReturnValue({
        id: 'sess-1',
        provider_profile_id: 'prov-1',
        model_id: 'gpt-custom',
        agent_adapter: 'codex',
        permission_mode: 'codex-default',
        chat_mode: 'agent',
        status: 'running',
        title: 'Existing Session',
        workspace_ids_json: '[]',
      }),
    })
    const historyEvents = [
      {
        type: 'user_message',
        sessionId: 'sess-1',
        turnId: 'turn-1',
        seq: 0,
        content: 'Remember this requirement',
      },
      {
        type: 'assistant_message',
        sessionId: 'sess-1',
        turnId: 'turn-1',
        seq: 1,
        mode: 'delta',
        content: 'partial should be ignored',
        provider: 'openai',
        isFinal: false,
      },
      {
        type: 'assistant_message',
        sessionId: 'sess-1',
        turnId: 'turn-1',
        seq: 2,
        mode: 'complete',
        content: 'I will remember it',
        provider: 'openai',
        isFinal: true,
      },
      {
        type: 'tool_call',
        sessionId: 'sess-1',
        turnId: 'turn-2',
        seq: 3,
        toolCallId: 'tool-1',
        toolName: 'read_file',
        toolInput: { path: 'README.md' },
        source: 'builtin',
      },
      {
        type: 'tool_result',
        sessionId: 'sess-1',
        turnId: 'turn-2',
        seq: 4,
        toolCallId: 'tool-1',
        toolName: 'read_file',
        status: 'success',
        output: { text: 'File contents' },
      },
    ]
    const eventRepo = makeEventRepo({
      countBySession: vi.fn().mockReturnValue(historyEvents.length),
      queryBySession: vi.fn().mockReturnValue({
        events: historyEvents.map((event) => ({ event_json: JSON.stringify(event) })),
        hasMore: false,
      }),
    })
    const providerRepo = makeProviderRepo({
      get: vi.fn().mockReturnValue({
        id: 'prov-1',
        provider_type: 'openai',
        keystore_ref: 'ref-1',
        config_json: '{"defaultModel":"gpt-4.1","modelIds":["gpt-4.1"]}',
      }),
    })
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'Use the previous context' })

    expect(loop.executeTurn).toHaveBeenCalledWith(
      'sess-1',
      expect.any(String),
      'Use the previous context',
      expect.any(Object),
      [
        { role: 'user', content: 'Remember this requirement' },
        { role: 'assistant', content: 'I will remember it' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'README.md' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '{"text":"File contents"}' }],
        },
      ],
    )
  })

  it('fails fast when legacy Claude adapter is selected and the SDK is unavailable', async () => {
    const sessionRepo = makeSessionRepo({
      findByIdOrFail: vi.fn().mockReturnValue({
        id: 'sess-1',
        provider_profile_id: 'prov-1',
        chat_mode: 'claude',
        status: 'running',
        workspace_ids_json: '[]',
      }),
    })
    const eventRepo = makeEventRepo()
    const providerRepo = makeProviderRepo({
      get: vi.fn().mockReturnValue({
        id: 'prov-1',
        provider_type: 'openai',
        keystore_ref: 'ref-1',
        config_json: '{"defaultModel":"glm-5","modelIds":["glm-5"]}',
      }),
    })
    const rulesRepo = makeRulesRepo()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })

    expect(createAdapter).not.toHaveBeenCalled()
    expect(eventRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'agent_error',
      eventJson: expect.stringContaining('SDK_REQUIRED'),
    }))
    expect(sessionRepo.updateStatus).toHaveBeenCalledWith('sess-1', 'error')
  })

  it('passes session runtime parameters into the agent config', async () => {
    const sessionRepo = makeSessionRepo({
      findByIdOrFail: vi.fn().mockReturnValue({
        id: 'sess-1',
        provider_profile_id: 'prov-1',
        model_id: 'gpt-custom',
        agent_adapter: 'codex',
        permission_mode: 'codex-full-access',
        reasoning_effort: 'high',
        chat_mode: 'agent',
        status: 'running',
        workspace_ids_json: '[]',
      }),
    })
    const eventRepo = makeEventRepo()
    const providerRepo = makeProviderRepo({
      get: vi.fn().mockReturnValue({
        id: 'prov-1',
        provider_type: 'openai',
        keystore_ref: 'ref-1',
        config_json: '{"defaultModel":"gpt-4.1","modelIds":["gpt-4.1"]}',
      }),
    })
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })

    expect(loop.executeTurn).toHaveBeenCalledWith(
      'sess-1',
      expect.any(String),
      'hello',
      expect.objectContaining({
        model: 'gpt-custom',
        permissionMode: 'codex-full-access',
        reasoningEffort: 'high',
      }),
    )
  })

  it('queues another turn for the same session until the active loop finishes', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    let resolveFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const firstLoop = makeLoop({ executeTurn: vi.fn().mockReturnValue(firstDone) })
    const secondLoop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop)
      .mockImplementationOnce(() => firstLoop as never)
      .mockImplementationOnce(() => secondLoop as never)

    const onQueueChanged = vi.fn()
    const svc = new SessionService(mockDb, vi.fn(), undefined, undefined, onQueueChanged)
    const first = await svc.sendTurn({ sessionId: 'sess-1', message: 'first' })
    const second = await svc.sendTurn({ sessionId: 'sess-1', message: 'second' })

    expect(first.started).toBe(true)
    expect(second.started).toBe(false)
    expect(firstLoop.executeTurn).toHaveBeenCalledTimes(1)
    expect(secondLoop.executeTurn).not.toHaveBeenCalled()
    expect(svc.getQueueState({ sessionId: 'sess-1' }).queuedTurns).toMatchObject([
      { turnId: second.turnId, message: 'second' },
    ])
    expect(onQueueChanged).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-1',
      queuedTurns: [expect.objectContaining({ turnId: second.turnId, message: 'second' })],
    }))

    resolveFirst()
    await firstDone

    await vi.waitFor(() => {
      expect(secondLoop.executeTurn).toHaveBeenCalled()
    })
    expect(secondLoop.executeTurn).toHaveBeenCalledWith(
      'sess-1',
      second.turnId,
      'second',
      expect.any(Object),
    )
    expect(svc.getQueueState({ sessionId: 'sess-1' }).queuedTurns).toHaveLength(0)
  })

  it('cancels one queued turn without dropping the rest', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    const firstLoop = makeLoop({ executeTurn: vi.fn().mockReturnValue(new Promise<void>(() => {})) })

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => firstLoop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'first' })
    const second = await svc.sendTurn({ sessionId: 'sess-1', message: 'second' })
    const third = await svc.sendTurn({ sessionId: 'sess-1', message: 'third' })

    const cancelled = svc.cancelQueuedTurn({ sessionId: 'sess-1', turnId: second.turnId })

    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.queuedTurns).toMatchObject([{ turnId: third.turnId, message: 'third' }])
    expect(svc.getQueueState({ sessionId: 'sess-1' }).queuedTurns).toMatchObject([
      { turnId: third.turnId, message: 'third' },
    ])
  })

  it('assigns incrementing seq to events and calls onEvent', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()

    let capturedListener: ((e: unknown) => void) | null = null
    const loop = {
      onEvent: vi.fn((fn) => { capturedListener = fn }),
      cancel: vi.fn(),
      executeTurn: vi.fn().mockResolvedValue(undefined),
    }

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const onEvent = vi.fn()
    const svc = new SessionService(mockDb, onEvent)
    await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })

    // Simulate events from the loop
    const fakeEvent = { id: 'e1', type: 'assistant_message', seq: 0 }
    capturedListener!(fakeEvent)
    capturedListener!(fakeEvent)

    expect(onEvent).toHaveBeenCalledTimes(3)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((onEvent.mock.calls[0] as unknown[][])[0]).toMatchObject({ type: 'project_context_loaded', seq: 0 })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((onEvent.mock.calls[1] as unknown[][])[0]).toMatchObject({ seq: 1 })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((onEvent.mock.calls[2] as unknown[][])[0]).toMatchObject({ seq: 2 })
  })

  it('emits validation suggestions after code file changes complete', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()

    let capturedListener: ((e: unknown) => void) | null = null
    const loop = {
      onEvent: vi.fn((fn) => { capturedListener = fn }),
      cancel: vi.fn(),
      executeTurn: vi.fn().mockResolvedValue(undefined),
    }

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const onEvent = vi.fn()
    const svc = new SessionService(mockDb, onEvent)
    await svc.sendTurn({ sessionId: 'sess-1', message: 'change code' })

    capturedListener!({
      id: 'file-1',
      type: 'file_change',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      timestamp: '2026-05-28T00:00:00.000Z',
      seq: 0,
      changeType: 'modify',
      path: 'packages/agent-runtime/src/services/session.service.ts',
    })
    capturedListener!({
      id: 'status-1',
      type: 'agent_status',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      timestamp: '2026-05-28T00:00:01.000Z',
      seq: 0,
      status: 'completed',
    })

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'validation_suggestion',
      changedFiles: ['packages/agent-runtime/src/services/session.service.ts'],
      commands: expect.arrayContaining([
        expect.objectContaining({ command: expect.stringMatching(/^(pnpm|npm|yarn) run typecheck$/) }),
      ]),
    }))
  })
})

describe('SessionService.cancelTurn', () => {
  it('calls cancel on active loop', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    const loop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop).mockImplementation(() => loop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'hello' })
    const result = await svc.cancelTurn('sess-1')

    expect(loop.cancel).toHaveBeenCalled()
    expect(result.cancelled).toBe(true)
  })

  it('releases the active loop and drops queued turns after cancellation', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeOpenAIProviderRepo()
    const rulesRepo = makeRulesRepo()
    const firstLoop = makeLoop({ executeTurn: vi.fn().mockReturnValue(new Promise<void>(() => {})) })
    const secondLoop = makeLoop()

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)
    vi.mocked(ProviderProfileRepository).mockImplementation(() => providerRepo as never)
    vi.mocked(RulesRepository).mockImplementation(() => rulesRepo as never)
    vi.mocked(keystore.getSecret).mockResolvedValue('sk-test')
    vi.mocked(createAdapter).mockReturnValue({} as never)
    vi.mocked(AgentLoop)
      .mockImplementationOnce(() => firstLoop as never)
      .mockImplementationOnce(() => secondLoop as never)

    const svc = new SessionService(mockDb, vi.fn())
    await svc.sendTurn({ sessionId: 'sess-1', message: 'first' })
    const queued = await svc.sendTurn({ sessionId: 'sess-1', message: 'queued' })
    const cancelled = await svc.cancelTurn('sess-1')
    const immediate = await svc.sendTurn({ sessionId: 'sess-1', message: 'immediate' })

    expect(queued.started).toBe(false)
    expect(cancelled.cancelled).toBe(true)
    expect(immediate.started).toBe(true)
    expect(firstLoop.cancel).toHaveBeenCalled()
    expect(secondLoop.executeTurn).toHaveBeenCalledWith(
      'sess-1',
      immediate.turnId,
      'immediate',
      expect.any(Object),
    )
    expect(secondLoop.executeTurn).not.toHaveBeenCalledWith(
      'sess-1',
      queued.turnId,
      'queued',
      expect.any(Object),
    )
  })
})

describe('SessionService.getHistory', () => {
  it('returns deserialized events from EventRepository', async () => {
    const event = { id: 'e1', type: 'assistant_message', seq: 0 }
    const eventRepo = makeEventRepo({
      queryBySession: vi.fn().mockReturnValue({
        events: [{ event_json: JSON.stringify(event) }],
        hasMore: false,
      }),
    })

    vi.mocked(SessionRepository).mockImplementation(() => makeSessionRepo() as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)

    const svc = new SessionService(mockDb, vi.fn())
    const result = await svc.getHistory({ sessionId: 'sess-1' })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual(event)
    expect(result.hasMore).toBe(false)
  })
})

describe('SessionService.listSessions', () => {
  it('returns sessions with messageCount', async () => {
    const sessionRepo = makeSessionRepo({
      list: vi.fn().mockReturnValue({
        sessions: [{ id: 'sess-1', title: 'Test', provider_profile_id: 'prov-1', status: 'idle', created_at: '2024-01-01', updated_at: '2024-01-01' }],
        total: 1,
      }),
    })
    const eventRepo = makeEventRepo({ countBySession: vi.fn().mockReturnValue(5) })

    vi.mocked(SessionRepository).mockImplementation(() => sessionRepo as never)
    vi.mocked(EventRepository).mockImplementation(() => eventRepo as never)

    const svc = new SessionService(mockDb, vi.fn())
    const result = await svc.listSessions()

    expect(result.total).toBe(1)
    expect(result.sessions[0]?.messageCount).toBe(5)
    expect(result.sessions[0]?.providerProfileId).toBe('prov-1')
  })
})
