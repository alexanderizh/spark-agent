import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CustomToolDraft } from '@spark/protocol'
import type { KeystoreRef } from '@spark/shared/keystore'
import { SparkDatabase } from '@spark/storage'
import { CustomToolService } from '../../services/custom-tools/custom-tool.service.js'
import { CustomToolError } from '../../services/custom-tools/custom-tool-errors.js'

const keytarStore = new Map<string, string>()
vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(
      async (service: string, account: string) => keytarStore.get(`${service}:${account}`) ?? null,
    ),
    setPassword: vi.fn(async (service: string, account: string, password: string) => {
      keytarStore.set(`${service}:${account}`, password)
    }),
    deletePassword: vi.fn(async (service: string, account: string) =>
      keytarStore.delete(`${service}:${account}`),
    ),
  },
}))

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), '../storage/migrations'))
  return db
}

function httpDraft(overrides: Partial<CustomToolDraft> = {}): CustomToolDraft {
  return {
    id: 'jira_search',
    title: 'Jira 查询',
    description: '按 issue key 查询内部 Jira issue 详情',
    type: 'http',
    inputSchema: { type: 'object', properties: { issueKey: { type: 'string' } } },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 1_500,
    spec: {
      request: { method: 'GET', urlTemplate: 'https://jira.internal/v3/issue/{{issueKey}}' },
      response: { format: 'json' },
    },
    ...overrides,
  } as CustomToolDraft
}

function httpDraftWithSecret(): CustomToolDraft {
  const draft = httpDraft()
  return {
    ...draft,
    secretRefs: { auth_token: 'custom-tool:jira_search:auth_token' },
    spec: {
      request: {
        method: 'GET',
        urlTemplate: 'https://jira.internal/v3/issue/{{issueKey}}',
        headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
      },
      response: { format: 'json' },
    },
  } as CustomToolDraft
}

describe('CustomToolService', () => {
  let db: SparkDatabase
  let service: CustomToolService
  let testDir: string

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `spark-test-custom-tool-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    service = new CustomToolService(db)
    keytarStore.clear()
    const keystore = await import('@spark/shared/keystore')
    keystore.configureCredentialVaultPersistence(null)
    keystore.clearSecretCache()
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates local tools enabled by default and lists them', async () => {
    const record = await service.create(httpDraft())
    expect(record.enabled).toBe(true)
    expect(record.origin).toBe('local')
    expect(service.list().map((tool) => tool.id)).toEqual(['jira_search'])
  })

  it('rejects duplicate ids and unavailable types', async () => {
    await service.create(httpDraft())
    await expect(service.create(httpDraft())).rejects.toThrow(/已存在/)
    await expect(
      service.create(httpDraft({ id: 'sql_one', type: 'sql' } as Partial<CustomToolDraft>)),
    ).rejects.toThrow(/尚未开放/)
  })

  it('writes and reports secret status; rejects undeclared secret names', async () => {
    await service.create(httpDraftWithSecret())
    expect(await service.secretStatus('jira_search')).toEqual({ auth_token: false })
    await service.writeSecret('jira_search', 'auth_token', 'token-value')
    expect(await service.secretStatus('jira_search')).toEqual({ auth_token: true })
    await expect(service.writeSecret('jira_search', 'ghost', 'x')).rejects.toThrow(/未声明/)
    const details = await service.get('jira_search')
    expect(details.secretStatus).toEqual({ auth_token: true })
  })

  it('testRun refuses drafts referencing secrets before save', async () => {
    await expect(
      service.testRun({ draftSpec: httpDraftWithSecret(), input: { issueKey: 'X-1' } }),
    ).rejects.toThrow(/先保存/)
  })

  it('testRun against unreachable host returns error result (not throw)', async () => {
    const draft = httpDraft({
      spec: {
        request: { method: 'GET', urlTemplate: 'http://127.0.0.1:1/never' },
        response: { format: 'text' },
      },
    } as Partial<CustomToolDraft>)
    await service.create(draft)
    const result = await service.testRun({ toolId: 'jira_search', input: {} })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('UNREACHABLE')
    const summary = service.list()[0]
    expect(summary?.lastTestAt).not.toBeNull()
  })

  it('delete cascades keystore entries', async () => {
    const keystore = await import('@spark/shared/keystore')
    await service.create(httpDraftWithSecret())
    await service.writeSecret('jira_search', 'auth_token', 'token-value')
    expect(await keystore.hasSecret('custom-tool:jira_search:auth_token' as KeystoreRef)).toBe(true)
    await service.delete('jira_search')
    keystore.clearSecretCache()
    expect(await keystore.hasSecret('custom-tool:jira_search:auth_token' as KeystoreRef)).toBe(
      false,
    )
    expect(service.list()).toEqual([])
  })

  it('setEnabled toggles and keeps other fields', async () => {
    await service.create(httpDraft())
    const disabled = service.setEnabled('jira_search', false)
    expect(disabled.enabled).toBe(false)
    expect(service.listEnabledRecords()).toEqual([])
  })

  it('export/import round-trip: imported tools disabled + origin imported; collisions skipped', async () => {
    await service.create(httpDraft())
    const payload = service.export()
    expect(payload.formatVersion).toBe(1)
    expect(payload.tools).toHaveLength(1)

    const first = await service.import(payload)
    expect(first.skipped.map((item) => item.id)).toEqual(['jira_search'])

    // 新库导入：全部落为待审（enabled=false, origin=imported）
    const targetDir = join(tmpdir(), `spark-test-custom-tool-import-${Date.now()}`)
    mkdirSync(targetDir, { recursive: true })
    const targetDb = createTestDb(targetDir)
    try {
      const targetService = new CustomToolService(targetDb)
      const result = await targetService.import(payload)
      expect(result.imported.map((tool) => tool.id)).toEqual(['jira_search'])
      expect(result.imported[0]?.enabled).toBe(false)
      expect(result.imported[0]?.origin).toBe('imported')
    } finally {
      targetDb.close()
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('import rejects malformed payloads', async () => {
    await expect(service.import({ formatVersion: 99, tools: [] })).rejects.toThrow(/不合法/)
  })

  it('emits change events for mutations', async () => {
    const events: Array<{ change: string; id?: string }> = []
    service.onChange((event) => events.push(event))
    await service.create(httpDraft())
    service.setEnabled('jira_search', false)
    await service.delete('jira_search')
    expect(events.map((event) => event.change)).toEqual(['created', 'enabled', 'deleted'])
  })

  it('update preserves enabled/origin and type is immutable', async () => {
    await service.create(httpDraft())
    service.setEnabled('jira_search', false)
    const updated = await service.update('jira_search', httpDraft({ title: '新标题' }))
    expect(updated.title).toBe('新标题')
    expect(updated.enabled).toBe(false)
    expect(updated.origin).toBe('local')
    await expect(
      service.update('jira_search', httpDraft({ type: 'sql' } as Partial<CustomToolDraft>)),
    ).rejects.toThrow(/类型创建后不可修改/)
  })

  it('throws CustomToolError NOT_FOUND for missing tools', async () => {
    await expect(service.get('ghost')).rejects.toBeInstanceOf(CustomToolError)
  })
})
