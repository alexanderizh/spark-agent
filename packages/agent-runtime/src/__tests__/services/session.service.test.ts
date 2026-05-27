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

import {
  SessionRepository,
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ToolRegistry).mockImplementation(() => ({}) as never)
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
    const providerRepo = makeProviderRepo()
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
    const providerRepo = makeProviderRepo()
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
    const providerRepo = makeProviderRepo()
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
    expect(createAdapter).toHaveBeenCalledWith('claude')
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

    expect(createAdapter).toHaveBeenCalledWith('codex')
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

  it('uses the session agent adapter instead of provider type when present', async () => {
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

    expect(createAdapter).toHaveBeenCalledWith('claude')
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
    const providerRepo = makeProviderRepo()
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

    const svc = new SessionService(mockDb, vi.fn())
    const first = await svc.sendTurn({ sessionId: 'sess-1', message: 'first' })
    const second = await svc.sendTurn({ sessionId: 'sess-1', message: 'second' })

    expect(first.started).toBe(true)
    expect(second.started).toBe(false)
    expect(firstLoop.executeTurn).toHaveBeenCalledTimes(1)
    expect(secondLoop.executeTurn).not.toHaveBeenCalled()

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
  })

  it('assigns incrementing seq to events and calls onEvent', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeProviderRepo()
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

    expect(onEvent).toHaveBeenCalledTimes(2)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((onEvent.mock.calls[0] as unknown[][])[0]).toMatchObject({ seq: 0 })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect((onEvent.mock.calls[1] as unknown[][])[0]).toMatchObject({ seq: 1 })
  })
})

describe('SessionService.cancelTurn', () => {
  it('calls cancel on active loop', async () => {
    const sessionRepo = makeSessionRepo()
    const eventRepo = makeEventRepo()
    const providerRepo = makeProviderRepo()
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
    const providerRepo = makeProviderRepo()
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
