import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  AccountSyncCategoryRequest,
  AccountSyncCategoryResult,
  AccountSyncExecuteRequestBody,
  AccountSyncExecuteResult,
  AccountSyncPreviewResult,
} from '@spark/protocol'
import { AgentRepository, SettingsRepository, SparkDatabase } from '@spark/storage'
import {
  AccountSyncService,
  type AccountSyncAdapterGateway,
  type AccountSyncAuthGateway,
} from './AccountSyncService.js'
import { AccountSyncAdapters } from './sync-adapters.js'
import { createSafeSyncItem } from './sync-policy.js'

type PostHandler = (path: string, body: unknown) => Promise<unknown>

class FakeAuth implements AccountSyncAuthGateway {
  userId: string | null = 'user-a'
  baseUrl = 'https://sync.example.com'
  readonly getCalls: string[] = []
  readonly postCalls: Array<{ path: string; body: unknown }> = []
  postHandler: PostHandler = async (_path, body) => body

  getCurrentUserId(): string | null {
    return this.userId
  }

  getEduClient(): { getBaseUrl(): string } {
    return { getBaseUrl: () => this.baseUrl }
  }

  async platformGet<T>(path: string): Promise<T> {
    this.getCalls.push(path)
    return { list: [], total: 0, page: 1, pageSize: 20 } as T
  }

  async platformPost<T>(path: string, body?: unknown): Promise<T> {
    this.postCalls.push({ path, body })
    return (await this.postHandler(path, body)) as T
  }
}

function categoryResult(
  request: AccountSyncCategoryRequest,
  records: AccountSyncCategoryResult['records'] = request.records,
): AccountSyncCategoryResult {
  return {
    category: request.category,
    schemaVersion: 1,
    revision: request.baseRevision + 1,
    records,
    hashes: {},
    stats: { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 },
    skippedItems: [],
  }
}

function successResult(
  request: AccountSyncExecuteRequestBody,
  categories = request.categories.map((item) => categoryResult(item)),
): AccountSyncExecuteResult {
  return {
    operationId: request.operationId,
    status: 'success',
    categories,
    stats: { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 },
    errorCodes: [],
  }
}

function isExecuteRequest(body: unknown): body is AccountSyncExecuteRequestBody {
  return body != null && typeof body === 'object' && 'operationId' in body
}

function firstCategory(body: AccountSyncExecuteRequestBody): AccountSyncCategoryRequest {
  const category = body.categories[0]
  if (category == null) throw new Error('test request has no category')
  return category
}

describe('AccountSyncService', () => {
  let db: SparkDatabase
  let testDir: string
  let auth: FakeAuth
  let service: AccountSyncService
  let settings: SettingsRepository

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-account-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
    auth = new FakeAuth()
    service = new AccountSyncService(db, auth)
    settings = new SettingsRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('defaults every category to off and keeps preferences isolated by account', () => {
    expect(service.getPreferences()).toEqual({
      authenticated: true,
      preferences: {
        enabled: false,
        categories: {
          customCommands: false,
          prompts: false,
          memory: false,
          assistants: false,
          workflows: false,
          appearance: false,
          promptLibrary: false,
        },
      },
    })

    service.updatePreferences({ enabled: true, categories: { memory: true } })
    auth.userId = 'user-b'
    expect(service.getPreferences().preferences.enabled).toBe(false)
    expect(service.getPreferences().preferences.categories.memory).toBe(false)

    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    auth.userId = 'user-a'
    expect(service.getPreferences().preferences.categories).toMatchObject({
      memory: true,
      appearance: false,
    })
    expect(auth.getCalls).toEqual([])
    expect(auth.postCalls).toEqual([])
  })

  it('rejects malformed history responses at the main-process boundary', async () => {
    auth.platformGet = async <T>(path: string): Promise<T> => {
      auth.getCalls.push(path)
      return {
        list: [
          {
            operationId: 'operation',
            deviceLabel: 'macOS #1234',
            status: 'success',
            categories: ['providers'],
            stats: { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 },
            errorCodes: [],
            ackStatus: 'success',
            ackErrorCodes: [],
            durationMs: 10,
            createdAt: '2026-08-30T00:00:00.000Z',
            finishedAt: '2026-08-30T00:00:01.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      } as T
    }

    await expect(service.listHistory()).rejects.toThrow('同步服务返回了无效响应')
  })

  it('does not send a request when there is no authenticated account', () => {
    auth.userId = null
    expect(() => service.execute()).toThrow('请先登录 SparkWork 账号')
    expect(auth.postCalls).toEqual([])
  })

  it('coalesces duplicate execute clicks into one network operation', async () => {
    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      await gate
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      return successResult(body)
    }

    const first = service.execute()
    const second = service.execute()
    expect(second).toBe(first)
    release?.()
    await expect(first).resolves.toMatchObject({ result: { status: 'success' } })
    expect(auth.postCalls.filter((call) => call.path === '/desktop-sync/execute')).toHaveLength(1)
  })

  it('returns a precise compatibility message when the server endpoint is missing', async () => {
    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    auth.postHandler = async () => {
      throw new Error('请求失败 (404): Not Found')
    }

    await expect(service.execute()).rejects.toThrow(
      '当前服务端暂不支持账号同步，请升级服务端后重试',
    )
  })

  it('rejects duplicate response categories even when the category count matches', async () => {
    service.updatePreferences({
      enabled: true,
      categories: { appearance: true, workflows: true },
    })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      const appearance = body.categories.find((item) => item.category === 'appearance')
      if (appearance == null) throw new Error('test request has no appearance category')
      return successResult(body, [categoryResult(appearance), categoryResult(appearance)])
    }

    await expect(service.execute()).rejects.toThrow('类别不完整或重复')
  })

  it('rejects unsafe canonical fields and reports a failed apply when no category succeeds', async () => {
    service.updatePreferences({ enabled: true, categories: { customCommands: true } })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      const request = firstCategory(body)
      return successResult(body, [
        categoryResult(request, [
          {
            id: 'command:unsafe',
            updatedAt: '2026-08-30T00:00:00.000Z',
            deleted: false,
            value: {
              id: 'command:unsafe',
              name: '不安全命令',
              prompt: 'hello',
              providerProfileId: 'provider-local',
              updatedAt: '2026-08-30T00:00:00.000Z',
            },
          },
        ]),
      ])
    }

    const response = await service.execute()
    expect(response.result.status).toBe('failed')
    expect(response.result.errorCodes).toContain('SYNC_SERVER_ITEM_REJECTED')
    expect(settings.get('custom-commands', 'items')).toBe('[]')
  })

  it('rejects canonical fields with invalid types without corrupting local data', async () => {
    const localCommand = {
      id: 'command:typed',
      name: '本机命令',
      prompt: 'safe local content',
      enabled: true,
      updatedAt: '2026-08-30T00:00:00.000Z',
    }
    settings.set('custom-commands', 'items', JSON.stringify([localCommand]))
    service.updatePreferences({ enabled: true, categories: { customCommands: true } })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      const request = firstCategory(body)
      return successResult(body, [
        categoryResult(request, [
          {
            id: 'command:typed',
            updatedAt: '2026-08-30T01:00:00.000Z',
            deleted: false,
            value: {
              id: 'command:typed',
              name: { unexpected: true },
              prompt: 'safe cloud content',
              enabled: true,
              updatedAt: '2026-08-30T01:00:00.000Z',
            },
          },
        ]),
      ])
    }

    const response = await service.execute()

    expect(response.result.status).toBe('failed')
    expect(response.result.errorCodes).toContain('SYNC_SERVER_ITEM_REJECTED')
    expect(JSON.parse(String(settings.get('custom-commands', 'items')))).toEqual([localCommand])
  })

  it('keeps a local secret command out of uploads, tombstones, and cloud overwrites', async () => {
    const localCommand = {
      id: 'command:private',
      name: '本机命令',
      prompt: 'use sk-abcdefghijklmnopqrstuvwxyz123456',
      enabled: true,
      updatedAt: '2026-08-30T00:00:00.000Z',
    }
    settings.set('custom-commands', 'items', JSON.stringify([localCommand]))
    settings.set('account-sync.state', 'user-a:customCommands', {
      revision: 3,
      baseHashes: { 'command:private': 'a'.repeat(64) },
      tombstones: {},
    })
    service.updatePreferences({ enabled: true, categories: { customCommands: true } })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      expect(body.categories[0]?.records).toEqual([])
      return successResult(body, [
        categoryResult(firstCategory(body), [
          {
            id: 'command:private',
            updatedAt: '2026-08-30T01:00:00.000Z',
            deleted: false,
            value: {
              id: 'command:private',
              name: '云端旧副本',
              prompt: 'safe cloud content',
              enabled: true,
              updatedAt: '2026-08-30T01:00:00.000Z',
            },
          },
        ]),
      ])
    }

    await service.execute()
    expect(JSON.parse(String(settings.get('custom-commands', 'items')))).toEqual([localCommand])
  })

  it('does not apply a response after the authenticated account changes', async () => {
    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      auth.userId = 'user-b'
      return successResult(body)
    }

    await expect(service.execute()).rejects.toThrow('同步期间账号已切换')
    expect(settings.get('account-sync.state', 'user-a:appearance')).toBeNull()
  })

  it('continues later categories when one local adapter throws', async () => {
    const collected = {
      records: [],
      skippedItems: [],
      seenIds: new Set<string>(),
    }
    const appliedCategories: string[] = []
    const adapters: AccountSyncAdapterGateway = {
      collect: async () => collected,
      apply: async (result) => {
        appliedCategories.push(result.category)
        if (result.category === 'workflows') throw new Error('test apply failure')
        return { errorCodes: [] }
      },
    }
    service = new AccountSyncService(db, auth, adapters)
    service.updatePreferences({
      enabled: true,
      categories: { workflows: true, appearance: true },
    })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      return successResult(body)
    }

    const response = await service.execute()
    expect(appliedCategories).toEqual(['workflows', 'appearance'])
    expect(response.result.status).toBe('partial')
    expect(response.result.errorCodes).toContain('SYNC_LOCAL_APPLY_FAILED')
    expect(settings.get('account-sync.state', 'user-a:workflows')).toMatchObject({
      pendingApply: true,
      lastErrorCodes: ['SYNC_LOCAL_APPLY_FAILED'],
    })
    expect(settings.get('account-sync.state', 'user-a:appearance')).toMatchObject({ revision: 1 })
  })

  it('continues safe categories without uploading an empty snapshot when collection fails', async () => {
    const collected = {
      records: [],
      skippedItems: [],
      seenIds: new Set<string>(),
    }
    const appliedCategories: string[] = []
    const adapters: AccountSyncAdapterGateway = {
      collect: async (category) => {
        if (category === 'workflows') throw new Error('test collect failure')
        return collected
      },
      apply: async (result) => {
        appliedCategories.push(result.category)
        return { errorCodes: [] }
      },
    }
    service = new AccountSyncService(db, auth, adapters)
    service.updatePreferences({
      enabled: true,
      categories: { workflows: true, appearance: true },
    })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      expect(body.categories.map((item) => item.category)).toEqual(['appearance'])
      return successResult(body)
    }

    const response = await service.execute()

    expect(appliedCategories).toEqual(['appearance'])
    expect(response.result.status).toBe('partial')
    expect(response.result.errorCodes).toContain('SYNC_LOCAL_COLLECT_FAILED')
    expect(response.result.categories).toContainEqual(
      expect.objectContaining({
        category: 'workflows',
        errorCode: 'SYNC_LOCAL_COLLECT_FAILED',
      }),
    )
    expect(auth.postCalls.find((call) => call.path.endsWith('/ack'))?.body).toEqual({
      status: 'partial',
      errorCodes: ['SYNC_LOCAL_COLLECT_FAILED'],
    })
  })

  it('forwards manual conflict choices to the server on execute', async () => {
    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    let sentChoices: unknown
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      sentChoices = body.conflictChoices
      return successResult(body)
    }

    const response = await service.execute({
      conflictChoices: { 'appearance/appearance': 'local' },
    })

    expect(response.result.status).toBe('success')
    expect(sentChoices).toEqual({ 'appearance/appearance': 'local' })
  })

  it('omits conflict choices when executing without a resolution', async () => {
    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    let sentChoices: unknown = 'not-visited'
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      sentChoices = body.conflictChoices
      return successResult(body)
    }

    await service.execute({})
    expect(sentChoices).toBeUndefined()
  })

  it('requests a preview with mode=preview and leaves local state untouched', async () => {
    service.updatePreferences({ enabled: true, categories: { customCommands: true } })
    settings.set('account-sync.state', 'user-a:customCommands', {
      revision: 2,
      baseHashes: {},
      tombstones: {},
    })
    auth.postHandler = async (path, body) => {
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      expect(body.mode).toBe('preview')
      expect(body.conflictChoices).toBeUndefined()
      const categories = body.categories.map((item) => ({
        category: item.category,
        conflictCount: 1,
      }))
      const conflicts = body.categories.map((item) => ({
        category: item.category,
        items: [
          {
            id: 'command:one',
            local: {
              updatedAt: '2026-08-30T00:01:00.000Z',
              deleted: false,
              summary: '本机版本',
              preview: 'local preview content',
            },
            cloud: {
              updatedAt: '2026-08-30T00:02:00.000Z',
              deleted: false,
              summary: '云端版本',
              preview: 'cloud preview content',
            },
          },
        ],
      }))
      return {
        mode: 'preview',
        operationId: body.operationId,
        status: 'success',
        categories,
        conflicts,
        totalConflicts: 1,
      } satisfies AccountSyncPreviewResult
    }

    const preview = await service.preview()

    expect(preview.totalConflicts).toBe(1)
    expect(preview.conflicts[0]?.items[0]?.cloud?.summary).toBe('云端版本')
    expect(preview.conflicts[0]?.items[0]?.local?.preview).toBe('local preview content')
    // preview 不 ack、不写库：唯一的网络调用就是 execute
    expect(auth.postCalls.map((call) => call.path)).toEqual(['/desktop-sync/execute'])
    expect(settings.get('account-sync.state', 'user-a:customCommands')).toEqual({
      revision: 2,
      baseHashes: {},
      tombstones: {},
    })
    expect(service.getPreferences().preferences.lastOperation).toBeUndefined()
  })

  it('rejects a preview response whose conflict totals do not match', async () => {
    service.updatePreferences({ enabled: true, categories: { appearance: true } })
    auth.postHandler = async (path, body) => {
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      return {
        mode: 'preview',
        operationId: body.operationId,
        status: 'success',
        categories: body.categories.map((item) => ({ category: item.category, conflictCount: 1 })),
        conflicts: [],
        totalConflicts: 0,
      } satisfies AccountSyncPreviewResult
    }

    await expect(service.preview()).rejects.toThrow('同步服务返回了无效响应')
  })

  it('fails the preview locally when every category fails to collect', async () => {
    const adapters: AccountSyncAdapterGateway = {
      collect: async () => {
        throw new Error('test collect failure')
      },
      apply: async () => ({ errorCodes: [] }),
    }
    service = new AccountSyncService(db, auth, adapters)
    service.updatePreferences({ enabled: true, categories: { appearance: true } })

    const preview = await service.preview()

    expect(preview.status).toBe('failed')
    expect(preview.categories[0]).toMatchObject({
      category: 'appearance',
      conflictCount: 0,
      errorCode: 'SYNC_LOCAL_COLLECT_FAILED',
    })
    expect(auth.postCalls).toEqual([])
  })

  it('retries without promptLibrary when an old server rejects the category', async () => {
    const collected = {
      records: [],
      skippedItems: [],
      seenIds: new Set<string>(),
    }
    const adapters: AccountSyncAdapterGateway = {
      collect: async () => collected,
      apply: async () => ({ errorCodes: [] }),
    }
    service = new AccountSyncService(db, auth, adapters)
    service.updatePreferences({
      enabled: true,
      categories: { promptLibrary: true, appearance: true },
    })
    let attempts = 0
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      attempts += 1
      if (attempts === 1) throw new Error('同步服务暂时不可用 SYNC_INVALID_CATEGORY 同步类别无效')
      expect(body.categories.map((item) => item.category)).toEqual(['appearance'])
      return successResult(body)
    }

    const response = await service.execute()

    expect(attempts).toBe(2)
    expect(response.result.status).toBe('success')
    expect(response.result.errorCodes).toEqual(['SYNC_CATEGORY_UNSUPPORTED'])
  })

  it('does not degrade when a conflict choice is attached to an old server rejection', async () => {
    const collected = {
      records: [],
      skippedItems: [],
      seenIds: new Set<string>(),
    }
    const adapters: AccountSyncAdapterGateway = {
      collect: async () => collected,
      apply: async () => ({ errorCodes: [] }),
    }
    service = new AccountSyncService(db, auth, adapters)
    service.updatePreferences({
      enabled: true,
      categories: { promptLibrary: true },
    })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      throw new Error('同步服务暂时不可用 SYNC_INVALID_CATEGORY 同步类别无效')
    }

    // 携带冲突选择时不能悄悄剔除类别重试，否则会丢失用户的选择语义
    await expect(
      service.execute({ conflictChoices: { 'promptLibrary/abc': 'cloud' } }),
    ).rejects.toThrow('SYNC_INVALID_CATEGORY')
    expect(auth.postCalls.filter((call) => call.path === '/desktop-sync/execute')).toHaveLength(1)
  })

  it('applies cloud prompt library entries while preserving local usage counts', async () => {
    settings.set('prompt-library', 'data', {
      version: 1,
      categories: ['storyboard'],
      items: [
        {
          id: 'prompt-1',
          title: '旧标题',
          text: '旧正文',
          category: 'storyboard',
          tags: ['本地'],
          coverUrl: 'https://example.com/cover.png',
          coverMimeType: 'image/png',
          usageCount: 7,
          createdAt: '2026-08-29T00:00:00.000Z',
          updatedAt: '2026-08-29T00:00:00.000Z',
        },
      ],
      legacyMigrated: false,
    })
    service.updatePreferences({ enabled: true, categories: { promptLibrary: true } })
    auth.postHandler = async (path, body) => {
      if (path.endsWith('/ack')) return {}
      if (!isExecuteRequest(body)) throw new Error('invalid test request')
      const request = firstCategory(body)
      return successResult(body, [
        {
          ...categoryResult(request, [
            {
              id: 'promptLibrary:prompt-1',
              updatedAt: '2026-08-30T00:00:00.000Z',
              deleted: false,
              value: {
                id: 'prompt-1',
                title: '新标题',
                text: '新正文',
                category: 'storyboard',
                tags: ['云端'],
                coverUrl: 'https://example.com/cover-v2.png',
                coverMimeType: 'image/png',
                createdAt: '2026-08-29T00:00:00.000Z',
                updatedAt: '2026-08-30T00:00:00.000Z',
              },
            },
          ]),
        },
      ])
    }

    const response = await service.execute()

    expect(response.result.status).toBe('success')
    const state = settings.get('prompt-library', 'data') as {
      items: Array<Record<string, unknown>>
      categories: string[]
    }
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      id: 'prompt-1',
      title: '新标题',
      text: '新正文',
      tags: ['云端'],
      coverUrl: 'https://example.com/cover-v2.png',
      usageCount: 7,
    })
    expect(state.categories).toContain('storyboard')
  })
})

describe('AccountSyncAdapters', () => {
  it('updates assistant content while preserving local runtime and credential-adjacent fields', async () => {
    const testDir = join(
      tmpdir(),
      `spark-account-sync-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    const db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
    try {
      const agents = new AgentRepository(db)
      agents.create({
        id: 'agent-local',
        name: '旧名称',
        providerProfileId: 'provider-local',
        modelId: 'model-local',
        agentAdapter: 'codex-sdk',
        reasoningEffort: 'xhigh',
        mcpServerIds: ['mcp-local'],
        hookConfig: { onStop: 'local-hook' },
        disabledSkillIds: ['skill-local'],
      })

      const adapters = new AccountSyncAdapters(db)
      await adapters.apply(
        {
          category: 'assistants',
          schemaVersion: 1,
          revision: 1,
          hashes: {},
          stats: { uploaded: 0, downloaded: 1, conflicts: 0, skipped: 0 },
          skippedItems: [],
          records: [
            {
              id: 'agent:agent-local',
              updatedAt: '2026-08-30T00:00:00.000Z',
              deleted: false,
              value: {
                id: 'agent-local',
                kind: 'agent',
                name: '同步后的名称',
                description: '同步描述',
                enabled: true,
                isDefault: false,
                prompt: '同步提示词',
                permissionMode: 'claude-ask',
                skillIds: [],
                ruleIds: [],
                workflowIds: [],
                createdAt: '2026-08-30T00:00:00.000Z',
                updatedAt: '2026-08-30T00:00:00.000Z',
              },
            },
          ],
        },
        new Set(),
      )

      expect(agents.get('agent-local')).toMatchObject({
        name: '同步后的名称',
        providerProfileId: 'provider-local',
        modelId: 'model-local',
        agentAdapter: 'codex-sdk',
        reasoningEffort: 'xhigh',
        mcpServerIds: ['mcp-local'],
        hookConfig: { onStop: 'local-hook' },
        disabledSkillIds: ['skill-local'],
      })
    } finally {
      db.close()
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('applies cloud avatars while preserving local metadata keys', async () => {
    const testDir = join(
      tmpdir(),
      `spark-account-sync-avatar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    const db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
    try {
      const agents = new AgentRepository(db)
      agents.create({
        id: 'agent-avatar',
        name: '头像助手',
        providerProfileId: 'provider-local',
        metadata: { home: 'docs', customFlag: true },
      })

      const adapters = new AccountSyncAdapters(db)
      await adapters.apply(
        {
          category: 'assistants',
          schemaVersion: 1,
          revision: 1,
          hashes: {},
          stats: { uploaded: 0, downloaded: 1, conflicts: 0, skipped: 0 },
          skippedItems: [],
          records: [
            {
              id: 'agent:agent-avatar',
              updatedAt: '2026-08-30T00:00:00.000Z',
              deleted: false,
              value: {
                id: 'agent-avatar',
                kind: 'agent',
                name: '头像助手',
                prompt: '同步提示词',
                permissionMode: 'claude-ask',
                skillIds: [],
                ruleIds: [],
                workflowIds: [],
                metadata: {
                  avatar: { kind: 'upload', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
                },
                createdAt: '2026-08-30T00:00:00.000Z',
                updatedAt: '2026-08-30T00:00:00.000Z',
              },
            },
          ],
        },
        new Set(),
      )

      const agent = agents.get('agent-avatar')
      expect(agent?.metadata).toMatchObject({
        home: 'docs',
        customFlag: true,
        avatar: { kind: 'upload', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
      })
      expect(agent?.providerProfileId).toBe('provider-local')
    } finally {
      db.close()
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('skips protected prompt library entries and keeps their local usage counts', async () => {
    const testDir = join(
      tmpdir(),
      `spark-account-sync-library-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    const db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(resolve(process.cwd(), '../../packages/storage/migrations'))
    try {
      const settingsRepo = new SettingsRepository(db)
      settingsRepo.set('prompt-library', 'data', {
        version: 1,
        categories: ['storyboard'],
        items: [
          {
            id: 'local-only',
            title: '本机受保护',
            text: '含 /Users/me/private.key 的条目',
            category: 'storyboard',
            tags: [],
            usageCount: 4,
            createdAt: '2026-08-29T00:00:00.000Z',
            updatedAt: '2026-08-29T00:00:00.000Z',
          },
        ],
        legacyMigrated: false,
      })

      const adapters = new AccountSyncAdapters(db)
      await adapters.apply(
        {
          category: 'promptLibrary',
          schemaVersion: 1,
          revision: 1,
          hashes: {},
          stats: { uploaded: 0, downloaded: 1, conflicts: 0, skipped: 0 },
          skippedItems: [],
          records: [
            {
              id: 'promptLibrary:local-only',
              updatedAt: '2026-08-30T00:00:00.000Z',
              deleted: true,
            },
          ],
        },
        new Set(['promptLibrary:local-only']),
      )

      const state = settingsRepo.get('prompt-library', 'data') as {
        items: Array<Record<string, unknown>>
      }
      expect(state.items).toHaveLength(1)
      expect(state.items[0]).toMatchObject({ id: 'local-only', usageCount: 4 })
    } finally {
      db.close()
      rmSync(testDir, { recursive: true, force: true })
    }
  })
})

describe('account sync local-path policy', () => {
  it.each([
    '/root/app/config.json',
    '/tmp/spark/session.json',
    '/Volumes/Private/data.json',
    'D:\\workspace\\private\\config.json',
    '\\\\desktop\\share\\private.json',
  ])('rejects local absolute path %s before upload', (path) => {
    expect(
      createSafeSyncItem('customCommands', {
        id: 'command:path',
        updatedAt: '2026-08-30T00:00:00.000Z',
        value: {
          id: 'command:path',
          name: '本机路径',
          prompt: `读取 ${path}`,
          enabled: true,
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      }),
    ).toEqual({
      skipped: { id: 'command:path', reasonCode: 'LOCAL_ABSOLUTE_PATH' },
    })
  })
})
