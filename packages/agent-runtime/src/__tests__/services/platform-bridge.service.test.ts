/**
 * @module platform-bridge.service.test
 *
 * 单元测试：PlatformBridgeService.agentDelete
 *
 * 覆盖 Bug1（团队模式成员计数残留）：
 *   - 删除 agent 后，agent_teams 中仍引用该 id 的 hostAgentId / memberAgentIds
 *     必须联动清理，否则被删 agent 仍出现在团队成员计数中。
 *   - member 命中：过滤掉该 id。
 *   - host 命中：重置为过滤后 memberAgentIds 的第一个；清空则置 ''。
 *   - 完全无关的 team 不动、不广播 onConfigChanged。
 *   - 未实际变化的 team 也不重复广播。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  setSecret: vi.fn(),
  getSecret: vi.fn(async () => null),
  deleteSecret: vi.fn(async () => true),
  maskSecret: (value: string) => `${value.slice(0, 4)}****`,
}))

import {
  AgentRepository,
  ProviderProfileRepository,
  SparkDatabase,
  SubAppRepository,
  TeamDefinitionRepository,
} from '@spark/storage'
import {
  PlatformBridgeService,
  type PlatformBridgeDeps,
} from '../../services/platform-bridge.service.js'
import * as keystore from '@spark/shared/keystore'

type ConfigChange = {
  scope:
    | 'provider'
    | 'agent'
    | 'team'
    | 'skill'
    | 'mcp'
    | 'workflow'
    | 'rule'
    | 'prompt'
    | 'sub-app'
  action: 'create' | 'update' | 'delete' | 'import'
  id?: string | undefined
}

describe('PlatformBridgeService.agentDelete 联动清理 agent_teams 残留', () => {
  let db: SparkDatabase
  let testDir: string
  let agentRepo: AgentRepository
  let teamRepo: TeamDefinitionRepository
  let service: PlatformBridgeService
  let port = 0
  const changes: ConfigChange[] = []
  const canvasCalls: Array<{ sessionId: string; toolName: string; args: unknown }> = []

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `spark-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    mkdirSync(testDir, { recursive: true })
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), '..', 'storage', 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)
    agentRepo = new AgentRepository(db)
    teamRepo = new TeamDefinitionRepository(db)
    changes.length = 0
    canvasCalls.length = 0

    service = new PlatformBridgeService()
    const deps = {
      agentRepo,
      teamRepo,
      sessionService: {
        bridgeCanvasToolCall: async (params: {
          sessionId: string
          toolName: string
          args: unknown
        }) => {
          canvasCalls.push(params)
          return { ok: true, toolName: params.toolName }
        },
      },
      onConfigChanged: (
        scope: ConfigChange['scope'],
        action: ConfigChange['action'],
        id?: string,
      ) => changes.push({ scope, action, id }),
    } as unknown as PlatformBridgeDeps
    port = await service.start(deps)
  })

  afterEach(async () => {
    await service.stop()
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function callRpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const body = JSON.stringify({ method, params })
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/rpc',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch (err) {
              reject(err)
            }
          })
        },
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  it('删除 agent 后清理 memberAgentIds + 重置 hostAgentId,无关 team 不动', async () => {
    agentRepo.create({ id: 'agent-a', name: 'A', builtIn: false, enabled: true })
    agentRepo.create({ id: 'agent-b', name: 'B', builtIn: false, enabled: true })
    agentRepo.create({ id: 'agent-c', name: 'C', builtIn: false, enabled: true })

    teamRepo.create({
      id: 'team-member',
      name: 'member-only',
      hostAgentId: 'agent-b',
      memberAgentIds: ['agent-a', 'agent-c'],
    })
    teamRepo.create({
      id: 'team-host',
      name: 'host-is-deleted',
      hostAgentId: 'agent-a',
      memberAgentIds: ['agent-a', 'agent-b'],
    })
    teamRepo.create({
      id: 'team-unrelated',
      name: 'unrelated',
      hostAgentId: 'agent-b',
      memberAgentIds: ['agent-b', 'agent-c'],
    })

    const res = await callRpc('agents.delete', { id: 'agent-a' })
    expect(res).toMatchObject({ ok: true, data: { success: true } })

    const memberTeam = teamRepo.get('team-member')!
    expect(memberTeam.memberAgentIds).toEqual(['agent-c'])
    expect(memberTeam.hostAgentId).toBe('agent-b')

    const hostTeam = teamRepo.get('team-host')!
    expect(hostTeam.memberAgentIds).toEqual(['agent-b'])
    expect(hostTeam.hostAgentId).toBe('agent-b')

    const unrelated = teamRepo.get('team-unrelated')!
    expect(unrelated.memberAgentIds).toEqual(['agent-b', 'agent-c'])
    expect(unrelated.hostAgentId).toBe('agent-b')

    expect(agentRepo.get('agent-a')).toBeNull()

    const teamUpdateIds = changes
      .filter((c) => c.scope === 'team' && c.action === 'update')
      .map((c) => c.id)
    expect(teamUpdateIds.sort()).toEqual(['team-host', 'team-member'])
    expect(changes).toContainEqual({ scope: 'agent', action: 'delete', id: 'agent-a' })
    expect(changes).not.toContainEqual(
      expect.objectContaining({ scope: 'team', id: 'team-unrelated' }),
    )
  })

  it('host 命中且过滤后 members 为空时,hostAgentId 重置为空串', async () => {
    agentRepo.create({ id: 'agent-solo', name: 'Solo', builtIn: false, enabled: true })
    teamRepo.create({
      id: 'team-solo',
      name: 'lone-host',
      hostAgentId: 'agent-solo',
      memberAgentIds: ['agent-solo'],
    })

    const res = await callRpc('agents.delete', { id: 'agent-solo' })
    expect(res).toMatchObject({ ok: true })

    const team = teamRepo.get('team-solo')!
    expect(team.memberAgentIds).toEqual([])
    expect(team.hostAgentId).toBe('')
    expect(changes).toContainEqual({ scope: 'team', action: 'update', id: 'team-solo' })
  })

  it('agent 不在任何一个 team 中时,不广播任何 team 事件', async () => {
    agentRepo.create({ id: 'agent-orphan', name: 'Orphan', builtIn: false, enabled: true })
    agentRepo.create({ id: 'agent-other', name: 'Other', builtIn: false, enabled: true })
    teamRepo.create({
      id: 'team-distinct',
      name: 'distinct',
      hostAgentId: 'agent-other',
      memberAgentIds: ['agent-other'],
    })

    const res = await callRpc('agents.delete', { id: 'agent-orphan' })
    expect(res).toMatchObject({ ok: true })

    expect(teamRepo.get('team-distinct')!.hostAgentId).toBe('agent-other')
    expect(changes).toEqual([{ scope: 'agent', action: 'delete', id: 'agent-orphan' }])
  })

  it('删除不存在的 agent 返回 success=false,不触发任何清理', async () => {
    const res = await callRpc('agents.delete', { id: 'agent-nope' })
    expect(res).toMatchObject({ ok: true, data: { success: false } })
    expect(changes).toEqual([])
  })

  it('canvas.call_tool 转发到 session canvas bridge', async () => {
    const res = await callRpc('canvas.call_tool', {
      sessionId: 'session-canvas',
      toolName: 'get_project',
      args: { includeNodes: true },
    })

    expect(res).toMatchObject({
      ok: true,
      data: { ok: true, toolName: 'get_project' },
    })
    expect(canvasCalls).toEqual([
      {
        sessionId: 'session-canvas',
        toolName: 'get_project',
        args: { includeNodes: true },
      },
    ])
  })
})

describe('PlatformBridgeService tool_packages 分发完整性', () => {
  /**
   * 回归防护：MCP server 已 advertised 且 methodMap 已映射的每个 tool_packages.* 方法，
   * 主进程 dispatch 必须放行。曾经 run_project_step 等 7 个方法缺失 case，
   * Agent 调用报 Unknown method 后被迫绕过平台受控路径直接 Bash 执行安装命令。
   *
   * 方法清单直接从 platform-management-mcp-server.mjs 的 methodMap 提取，
   * 未来新增 MCP 工具若忘记补 dispatch 会立刻在此失败。
   */
  let service: PlatformBridgeService
  let port = 0

  afterEach(async () => {
    await service.stop()
  })

  function callRpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const body = JSON.stringify({ method, params })
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/rpc',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch (err) {
              reject(err)
            }
          })
        },
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  it('methodMap 中每个 tool_packages.* 方法都能通过 dispatch（不返回 Unknown method）', async () => {
    const mjsSource = readFileSync(
      join(process.cwd(), 'src', 'tools', 'platform-management-mcp-server.mjs'),
      'utf8',
    )
    const methods = [...mjsSource.matchAll(/tool_packages_\w+:\s*'(tool_packages\.\w+)'/g)].map(
      (match) => match[1]!,
    )
    expect(methods.length).toBeGreaterThanOrEqual(22)

    const serviceCalls: string[] = []
    const toolPackageService = new Proxy({} as Record<string, unknown>, {
      get: (_target, prop: string) =>
        (..._args: unknown[]) => {
          serviceCalls.push(prop)
          if (prop === 'listSummaries') return []
          return undefined
        },
    })
    service = new PlatformBridgeService()
    port = await service.start({ toolPackageService } as unknown as PlatformBridgeDeps)

    for (const method of methods) {
      const res = await callRpc(method, {})
      // 空 params 下允许参数校验/confirm 门控失败，但不允许 Unknown method——
      // 后者说明 dispatch 缺 case，工具在 Agent 侧永远调不通。
      expect(res.ok === true || (res.error != null && !/Unknown method/.test(res.error))).toBe(true)
    }
    // 至少一个方法真正触达了 service 层，证明链路完整而非全部被门控挡回。
    expect(serviceCalls.length).toBeGreaterThan(0)
  })
})

describe('PlatformBridgeService referenced sessions payload privacy', () => {
  let service: PlatformBridgeService
  let port = 0

  afterEach(async () => {
    await service.stop()
  })

  it('strips source and target session IDs from list/read/search responses', async () => {
    const reference = {
      id: 'reference-opaque-id',
      targetSessionId: 'target-session-secret',
      sourceSessionId: 'source-session-secret',
      title: 'Research notes',
      sourceTitleSnapshot: 'Research notes',
      projectId: 'project-1',
      snapshotSeq: 12,
      status: 'active',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      turnCount: 2,
    }
    const sessionService = {
      listActiveSessionReferences: vi.fn(async () => ({ references: [reference] })),
      readReferencedSession: vi.fn(async () => ({
        reference,
        turns: [
          {
            turnId: 'turn-1',
            userMessage: 'Question',
            assistantMessages: ['Answer'],
            activities: [],
            firstSeq: 0,
            lastSeq: 2,
          },
        ],
        nextCursor: null,
        hasMore: false,
      })),
      searchReferencedSession: vi.fn(async () => ({
        reference,
        hits: [{ turnId: 'turn-1', seq: 1, role: 'assistant', snippet: 'Answer' }],
      })),
    }

    service = new PlatformBridgeService()
    port = await service.start({ sessionService } as unknown as PlatformBridgeDeps)

    const list = await callBridgeRpc(port, 'referenced_sessions.list', {
      sessionId: 'target-session-secret',
    })
    const read = await callBridgeRpc(port, 'referenced_session.read', {
      sessionId: 'target-session-secret',
      referenceId: 'reference-opaque-id',
    })
    const search = await callBridgeRpc(port, 'referenced_session.search', {
      sessionId: 'target-session-secret',
      referenceId: 'reference-opaque-id',
      query: 'Answer',
    })

    for (const response of [list, read, search]) {
      expect(JSON.stringify(response)).not.toContain('source-session-secret')
      expect(JSON.stringify(response)).not.toContain('target-session-secret')
    }
    expect(list).toMatchObject({ ok: true, data: { references: [{ id: 'reference-opaque-id' }] } })
    expect(read).toMatchObject({ ok: true, data: { reference: { id: 'reference-opaque-id' } } })
    expect(search).toMatchObject({ ok: true, data: { reference: { id: 'reference-opaque-id' } } })
    expect(sessionService.listActiveSessionReferences).toHaveBeenCalledWith('target-session-secret')
    expect(sessionService.readReferencedSession).toHaveBeenCalledWith({
      targetSessionId: 'target-session-secret',
      referenceId: 'reference-opaque-id',
      actor: 'agent',
    })
    expect(sessionService.searchReferencedSession).toHaveBeenCalledWith({
      targetSessionId: 'target-session-secret',
      referenceId: 'reference-opaque-id',
      query: 'Answer',
      actor: 'agent',
    })
  })
})

describe('PlatformBridgeService session history retrieval', () => {
  let service: PlatformBridgeService
  let port = 0

  afterEach(async () => {
    await service.stop()
  })

  it('dispatches list/read/search to sessionHistoryTools with the injected session id', async () => {
    const sessionHistoryTools = {
      list: vi.fn(() => ({ turns: [], nextCursor: null, hasMore: false })),
      read: vi.fn((_sessionId: string, params: { mode: 'turns' | 'event' }) =>
        params.mode === 'event'
          ? {
              mode: 'event' as const,
              event: {
                turnId: 'turn-1',
                seq: 2,
                eventType: 'tool_result',
                role: 'tool' as const,
                toolName: 'Bash',
                content: 'output',
                truncated: false,
              },
            }
          : {
              mode: 'turns' as const,
              turns: [
                {
                  turnId: 'turn-1',
                  firstSeq: 0,
                  lastSeq: 3,
                  partial: false,
                  events: [
                    {
                      seq: 0,
                      eventType: 'tool_call',
                      role: 'tool',
                      toolName: 'Bash',
                      content: 'input: {"command":"ls"}',
                      truncated: false,
                    },
                  ],
                },
              ],
              nextCursor: null,
              hasMore: false,
            },
      ),
      search: vi.fn(() => ({
        hits: [{ turnId: 'turn-1', seq: 0, eventType: 'tool_call', role: 'tool', snippet: 'ls' }],
      })),
    }

    service = new PlatformBridgeService()
    port = await service.start({ sessionHistoryTools } as unknown as PlatformBridgeDeps)

    const list = await callBridgeRpc(port, 'session_history.list', { sessionId: 'session-a' })
    const read = await callBridgeRpc(port, 'session_history.read', {
      sessionId: 'session-a',
      mode: 'turns',
      turnLimit: 4,
      order: 'desc',
    })
    const readEvent = await callBridgeRpc(port, 'session_history.read', {
      sessionId: 'session-a',
      mode: 'event',
      turnId: 'turn-1',
      seq: 2,
    })
    const search = await callBridgeRpc(port, 'session_history.search', {
      sessionId: 'session-a',
      query: 'ls',
      limit: 10,
    })

    expect(list).toMatchObject({ ok: true, data: { turns: [] } })
    expect(read).toMatchObject({ ok: true, data: { mode: 'turns' } })
    expect(readEvent).toMatchObject({ ok: true, data: { mode: 'event', event: { seq: 2 } } })
    expect(search).toMatchObject({ ok: true, data: { hits: [{ seq: 0 }] } })
    expect(sessionHistoryTools.list).toHaveBeenCalledWith('session-a', {})
    expect(sessionHistoryTools.read).toHaveBeenCalledWith('session-a', {
      mode: 'turns',
      turnLimit: 4,
      order: 'desc',
    })
    expect(sessionHistoryTools.read).toHaveBeenCalledWith('session-a', {
      mode: 'event',
      turnId: 'turn-1',
      seq: 2,
    })
    expect(sessionHistoryTools.search).toHaveBeenCalledWith('session-a', { query: 'ls', limit: 10 })
  })

  it('rejects calls without a session id or search query', async () => {
    const sessionHistoryTools = {
      list: vi.fn(),
      read: vi.fn(),
      search: vi.fn(),
    }
    service = new PlatformBridgeService()
    port = await service.start({ sessionHistoryTools } as unknown as PlatformBridgeDeps)

    const noSession = await callBridgeRpc(port, 'session_history.list', {})
    expect(noSession.ok).toBe(false)
    expect(noSession.error).toContain('sessionId')

    const noQuery = await callBridgeRpc(port, 'session_history.search', { sessionId: 's' })
    expect(noQuery.ok).toBe(false)
    expect(noQuery.error).toContain('query')

    expect(sessionHistoryTools.list).not.toHaveBeenCalled()
    expect(sessionHistoryTools.read).not.toHaveBeenCalled()
    expect(sessionHistoryTools.search).not.toHaveBeenCalled()
  })
})

describe('PlatformBridgeService Codex runtime control', () => {
  let service: PlatformBridgeService

  afterEach(async () => {
    await service?.stop()
  })

  it('returns redacted diagnostics and restarts only through SessionService authority', async () => {
    const diagnostics = {
      activeRuntimeCount: 1,
      runtimes: [{ leaseId: 'a1b2c3d4e5f6', state: 'idle' }],
    }
    const restart = { restartedLeaseIds: ['a1b2c3d4e5f6'], busyLeaseIds: [] }
    const sessionService = {
      getCodexRuntimeDiagnostics: vi.fn(async () => diagnostics),
      restartIdleCodexRuntimes: vi.fn(async () => restart),
    }
    service = new PlatformBridgeService()
    const port = await service.start({ sessionService } as unknown as PlatformBridgeDeps)

    await expect(callBridgeRpc(port, 'codex_runtime.diagnostics', {})).resolves.toEqual({
      ok: true,
      data: { diagnostics },
    })
    await expect(callBridgeRpc(port, 'codex_runtime.restart_idle', {})).resolves.toEqual({
      ok: true,
      data: { result: restart },
    })
    expect(sessionService.getCodexRuntimeDiagnostics).toHaveBeenCalledTimes(1)
    expect(sessionService.restartIdleCodexRuntimes).toHaveBeenCalledTimes(1)
  })
})

describe('PlatformBridgeService sub-app directory notifications', () => {
  let db: SparkDatabase
  let testDir: string
  let subAppRepo: SubAppRepository
  let service: PlatformBridgeService
  let port = 0
  const changes: ConfigChange[] = []

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `spark-sub-app-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    subAppRepo = new SubAppRepository(db)
    changes.length = 0

    service = new PlatformBridgeService()
    port = await service.start({
      subAppRepo,
      onConfigChanged: (
        scope: ConfigChange['scope'],
        action: ConfigChange['action'],
        id?: string,
      ) => changes.push({ scope, action, id }),
    } as unknown as PlatformBridgeDeps)
  })

  afterEach(async () => {
    await service.stop()
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('broadcasts create and publish only after the repository mutation succeeds', async () => {
    const created = await callBridgeRpc(port, 'subapp.create', {
      name: 'Agent 发布应用',
      source: '<main>v1</main>',
      surface: 'content',
    })
    expect(created.ok).toBe(true)
    const appId = (created.data as { id: string }).id
    expect(changes).toEqual([{ scope: 'sub-app', action: 'create', id: appId }])

    const published = await callBridgeRpc(port, 'subapp.publish', {
      appId,
      expectedDraftRevision: 1,
    })
    expect(published).toMatchObject({
      ok: true,
      data: { id: appId, publicationStatus: 'published', publishedVersion: 1 },
    })
    expect(subAppRepo.get(appId)?.publishedRelease?.source).toBe('<main>v1</main>')
    expect(changes).toEqual([
      { scope: 'sub-app', action: 'create', id: appId },
      { scope: 'sub-app', action: 'update', id: appId },
    ])

    changes.length = 0
    const conflicted = await callBridgeRpc(port, 'subapp.publish', {
      appId,
      expectedDraftRevision: 99,
    })
    expect(conflicted.ok).toBe(false)
    expect(changes).toEqual([])
  })
})

describe('PlatformBridgeService Provider CRUD', () => {
  let db: SparkDatabase
  let testDir: string
  let providerRepo: ProviderProfileRepository
  let service: PlatformBridgeService
  let port = 0
  const changes: ConfigChange[] = []

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `spark-provider-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '..', 'storage', 'migrations'))
    providerRepo = new ProviderProfileRepository(db)
    changes.length = 0

    service = new PlatformBridgeService()
    port = await service.start({
      providerRepo,
      onConfigChanged: (
        scope: ConfigChange['scope'],
        action: ConfigChange['action'],
        id?: string,
      ) => changes.push({ scope, action, id }),
    } as unknown as PlatformBridgeDeps)
  })

  afterEach(async () => {
    await service.stop()
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('uses ProviderService for legacy-shaped create/update/get/list/health/delete calls', async () => {
    const created = await callBridgeRpc(port, 'providers.create', {
      id: 'provider-legacy-timestamp-id',
      name: 'Legacy OpenAI',
      providerType: 'openai',
      config: {
        defaultModel: 'gpt-5',
        modelIds: ['gpt-5', 'gpt-4o-mini'],
        apiEndpoint: 'https://api.example.com/v1',
      },
      keystoreRef: '',
    })

    expect(created.ok).toBe(true)
    const createdData = created.data as { provider: { id: string; providerType: string } }
    expect(createdData.provider.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(createdData.provider.providerType).toBe('openai')
    expect(providerRepo.get('provider-legacy-timestamp-id')).toBeNull()
    expect(providerRepo.get(createdData.provider.id)).not.toBeNull()

    const fetched = await callBridgeRpc(port, 'providers.get', { id: createdData.provider.id })
    expect(fetched).toMatchObject({
      ok: true,
      data: {
        provider: {
          id: createdData.provider.id,
          providerType: 'openai',
          config: {
            defaultModel: 'gpt-5',
            modelIds: ['gpt-5', 'gpt-4o-mini'],
            apiEndpoint: 'https://api.example.com/v1',
          },
        },
      },
    })

    const updated = await callBridgeRpc(port, 'providers.update', {
      id: createdData.provider.id,
      config: { defaultModel: 'gpt-5.1', modelIds: ['gpt-5.1'] },
      enabled: false,
    })
    expect(updated).toMatchObject({
      ok: true,
      data: { provider: { id: createdData.provider.id, enabled: false } },
    })

    const listed = await callBridgeRpc(port, 'providers.list', {})
    expect(listed.ok).toBe(true)
    const listedProviders = (listed.data as { providers: Array<{ id: string; enabled: boolean }> })
      .providers
    expect(listedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdData.provider.id, enabled: false }),
      ]),
    )

    const health = await callBridgeRpc(port, 'providers.health_check', {
      id: createdData.provider.id,
    })
    expect(health).toMatchObject({
      ok: true,
      data: { healthy: false, providerId: createdData.provider.id },
    })

    const deleted = await callBridgeRpc(port, 'providers.delete', { id: createdData.provider.id })
    expect(deleted).toMatchObject({ ok: true, data: { success: true, deleted: true } })
    expect(providerRepo.get(createdData.provider.id)).toBeNull()
    expect(changes).toEqual([
      { scope: 'provider', action: 'create', id: createdData.provider.id },
      { scope: 'provider', action: 'update', id: createdData.provider.id },
      { scope: 'provider', action: 'delete', id: createdData.provider.id },
    ])
  })

  it('passes API keys to ProviderService and keeps them out of SQLite and RPC responses', async () => {
    vi.mocked(keystore.setSecret).mockClear()
    const created = await callBridgeRpc(port, 'providers.create', {
      name: 'Keychain Provider',
      provider: 'openai',
      defaultModel: 'gpt-5',
      apiKey: 'sk-bridge-secret',
    })

    expect(created.ok).toBe(true)
    const createdData = created.data as { provider: { id: string } }
    expect(keystore.setSecret).toHaveBeenCalledWith(
      `openai-${createdData.provider.id}`,
      'sk-bridge-secret',
    )
    const row = providerRepo.get(createdData.provider.id)
    expect(row?.keystore_ref).toBe(`openai-${createdData.provider.id}`)
    expect(row?.config_json).not.toContain('sk-bridge-secret')
    expect(JSON.stringify(created)).not.toContain('sk-bridge-secret')
  })
})

async function callBridgeRpc(
  port: number,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const body = JSON.stringify({ method, params })
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
