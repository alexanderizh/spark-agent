import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CustomToolDraft } from '@spark/protocol'
import type { KeystoreRef } from '@spark/shared/keystore'
import { SparkDatabase, ToolInvocationRepository } from '@spark/storage'
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

function codeDraft(
  id: string,
  toolIds: string[] = [],
  overrides: Partial<CustomToolDraft> = {},
): CustomToolDraft {
  const risk = overrides.risk ?? 'read'
  return {
    id,
    title: `代码工具 ${id}`,
    description: `组合已发布工具的原生 TypeScript 工具 ${id}`,
    type: 'code',
    inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
    risk,
    effect: risk === 'read' ? 'read' : 'update',
    idempotency: risk === 'read' ? 'safe' : 'unsafe',
    timeoutMs: 5_000,
    spec: {
      runtime: {
        kind: 'trusted-worker',
        language: 'typescript',
        source: 'export default async function(input) { return input }',
        entryExport: 'default',
      },
      permissions: { toolIds },
      limits: { memoryMb: 64, maxOutputBytes: 64 * 1024 },
      trust: 'trusted-local',
    },
    ...overrides,
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

  it('separates drafts from the stable runtime and publishes atomically', async () => {
    const created = await service.createDraft(httpDraft({ title: '草稿一' }))
    expect(created.tool).toMatchObject({
      enabled: false,
      publishedVersion: null,
      draftVersion: 1,
    })
    expect(service.listEnabledRecords()).toEqual([])

    const published = await service.publish('jira_search', 1)
    expect(published.tool).toMatchObject({
      title: '草稿一',
      enabled: true,
      publishedVersion: 1,
      draftVersion: 1,
    })

    const saved = await service.saveDraft('jira_search', httpDraft({ title: '草稿二' }))
    expect(saved.tool).toMatchObject({ title: '草稿一', publishedVersion: 1, draftVersion: 2 })
    expect(saved.draft.title).toBe('草稿二')
    expect(service.listEnabledRecords()[0]?.title).toBe('草稿一')

    const updated = await service.publish('jira_search', 2)
    expect(updated.tool).toMatchObject({ title: '草稿二', publishedVersion: 2, draftVersion: 2 })
  })

  it('publishes code tools only when every dependency is published and enabled', async () => {
    await service.createDraft(httpDraft({ id: 'lookup' }))
    await service.createDraft(codeDraft('composer', ['lookup']))

    await expect(service.publish('composer', 1)).rejects.toThrow(/不存在或尚未发布/)
    await service.publish('lookup', 1)
    await service.setEnabled('lookup', false)
    await expect(service.publish('composer', 1)).rejects.toThrow(/当前已停用/)

    await service.setEnabled('lookup', true)
    await expect(service.publish('composer', 1)).resolves.toMatchObject({
      tool: { enabled: true, publishedVersion: 1 },
    })
  })

  it('enforces dependency risk inheritance on immediate and versioned mutations', async () => {
    await service.create(
      httpDraft({
        id: 'writer',
        risk: 'high-write',
        effect: 'update',
        idempotency: 'unsafe',
        spec: {
          request: { method: 'POST', urlTemplate: 'https://example.com/write' },
          response: { format: 'json' },
        },
      } as Partial<CustomToolDraft>),
    )

    await expect(service.create(codeDraft('unsafe_wrapper', ['writer']))).rejects.toThrow(
      /风险等级不能低于依赖 writer/,
    )
    await service.createDraft(codeDraft('reviewed_wrapper', ['writer']))
    await expect(service.publish('reviewed_wrapper', 1)).rejects.toThrow(/风险等级不能低于/)
    await service.saveDraft(
      'reviewed_wrapper',
      codeDraft('reviewed_wrapper', ['writer'], { risk: 'high-write' }),
    )
    await expect(service.publish('reviewed_wrapper', 1)).resolves.toMatchObject({
      tool: { risk: 'high-write', enabled: true },
    })
  })

  it('rejects circular and over-depth code-tool dependency graphs before activation', async () => {
    await service.create(codeDraft('cycle_a'))
    await service.create(codeDraft('cycle_b', ['cycle_a']))
    await expect(service.update('cycle_a', codeDraft('cycle_a', ['cycle_b']))).rejects.toThrow(
      /循环依赖：cycle_a → cycle_b → cycle_a/,
    )

    await service.create(codeDraft('depth_8'))
    for (let depth = 7; depth >= 1; depth -= 1) {
      await service.create(codeDraft(`depth_${depth}`, [`depth_${depth + 1}`]))
    }
    await expect(service.create(codeDraft('depth_0', ['depth_1']))).rejects.toThrow(
      /组合依赖深度超过 8/,
    )
  })

  it('executes recursive native composition through the service broker', async () => {
    await service.create(
      codeDraft('leaf', [], {
        spec: {
          runtime: {
            kind: 'trusted-worker',
            language: 'typescript',
            source: 'export default async function(input) { return { value: input.value + 1 } }',
            entryExport: 'default',
          },
          permissions: { toolIds: [] },
          limits: { memoryMb: 64, maxOutputBytes: 64 * 1024 },
          trust: 'trusted-local',
        },
      }),
    )
    await service.create(
      codeDraft('middle', ['leaf'], {
        spec: {
          runtime: {
            kind: 'trusted-worker',
            language: 'typescript',
            source:
              "export default async function(input, sdk) { return sdk.tools.call('leaf', input) }",
            entryExport: 'default',
          },
          permissions: { toolIds: ['leaf'] },
          limits: { memoryMb: 64, maxOutputBytes: 64 * 1024 },
          trust: 'trusted-local',
        },
      }),
    )
    await service.create(
      codeDraft('top', ['middle'], {
        spec: {
          runtime: {
            kind: 'trusted-worker',
            language: 'typescript',
            source:
              "export default async function(input, sdk) { return sdk.tools.call('middle', input) }",
            entryExport: 'default',
          },
          permissions: { toolIds: ['middle'] },
          limits: { memoryMb: 64, maxOutputBytes: 64 * 1024 },
          trust: 'trusted-local',
        },
      }),
    )

    const result = await service.executeEnabled({ toolId: 'top', input: { value: 4 } })
    expect(JSON.parse(result.text)).toEqual({ value: 5 })
    expect(service.listInvocations({}).map((trace) => trace.toolId)).toEqual([
      'top',
      'middle',
      'leaf',
    ])
  })

  it('keeps the stable version live when a draft cannot pass secret validation', async () => {
    await service.create(httpDraft({ title: '稳定版本' }))
    await service.saveDraft('jira_search', httpDraftWithSecret())

    await expect(service.publish('jira_search', 2)).rejects.toThrow(/缺少密钥/)
    expect(service.listEnabledRecords()[0]).toMatchObject({
      title: '稳定版本',
      enabled: true,
      publishedVersion: 1,
      draftVersion: 2,
    })
  })

  it('does not let missing draft-only secrets block the stable version from being enabled', async () => {
    await service.create(httpDraft({ title: '稳定版本' }))
    await service.setEnabled('jira_search', false)
    await service.saveDraft('jira_search', httpDraftWithSecret())

    await expect(service.setEnabled('jira_search', true)).resolves.toMatchObject({
      title: '稳定版本',
      enabled: true,
      publishedVersion: 1,
      draftVersion: 2,
    })
  })

  it('rolls back through a new version instead of rewriting history', async () => {
    await service.create(httpDraft({ title: '版本一' }))
    await service.saveDraft('jira_search', httpDraft({ title: '版本二' }))
    await service.publish('jira_search', 2)

    const rolledBack = await service.rollback('jira_search', 1)
    expect(rolledBack.tool).toMatchObject({
      title: '版本一',
      publishedVersion: 3,
      draftVersion: 3,
    })
    expect(rolledBack.versions[0]).toMatchObject({ sourceVersion: 1, status: 'published' })
  })

  it('keeps the stable version live when rollback target secrets no longer exist', async () => {
    await service.createDraft(httpDraftWithSecret())
    await service.writeSecret('jira_search', 'auth_token', 'token-value')
    await service.publish('jira_search', 1)
    await service.saveDraft('jira_search', httpDraft({ title: '无密钥版本' }))
    await service.publish('jira_search', 2)

    await expect(service.rollback('jira_search', 1)).rejects.toThrow(/历史版本 v1 缺少密钥/)
    expect(service.listEnabledRecords()[0]).toMatchObject({
      title: '无密钥版本',
      enabled: true,
      publishedVersion: 2,
      draftVersion: 2,
    })
  })

  it('rejects duplicate ids and unavailable types', async () => {
    await service.create(httpDraft())
    await expect(service.create(httpDraft())).rejects.toThrow(/已存在/)
    await expect(
      service.create(httpDraft({ id: 'sql_one', type: 'sql' } as Partial<CustomToolDraft>)),
    ).rejects.toThrow(/尚未开放/)
  })

  it('writes and reports secret status; rejects undeclared secret names', async () => {
    const created = await service.create(httpDraftWithSecret())
    expect(created.enabled).toBe(false)
    expect(await service.secretStatus('jira_search')).toEqual({ auth_token: false })
    await expect(service.setEnabled('jira_search', true)).rejects.toThrow(/缺少密钥/)
    await service.writeSecret('jira_search', 'auth_token', 'token-value')
    expect((await service.setEnabled('jira_search', true)).enabled).toBe(true)
    expect(await service.secretStatus('jira_search')).toEqual({ auth_token: true })
    await expect(service.writeSecret('jira_search', 'ghost', 'x')).rejects.toThrow(/未声明/)
    const details = await service.get('jira_search')
    expect(details.secretStatus).toEqual({ auth_token: true })
  })

  it('records disabled and missing-secret runtime denials for diagnosis', async () => {
    await service.createDraft(httpDraftWithSecret())

    const denied = await service
      .executeEnabled({ toolId: 'jira_search', input: { issueKey: 'SPARK-1' }, source: 'model' })
      .catch((reason: unknown) => reason)
    expect(denied).toMatchObject({ toolCode: 'DENIED', traceId: expect.any(Number) })

    await service.writeSecret('jira_search', 'auth_token', 'token-value')
    await service.publish('jira_search', 1)
    const keystore = await import('@spark/shared/keystore')
    await keystore.deleteSecret('custom-tool:jira_search:auth_token' as KeystoreRef)
    keystore.clearSecretCache()

    const missingSecret = await service
      .executeEnabled({ toolId: 'jira_search', input: { issueKey: 'SPARK-2' }, source: 'model' })
      .catch((reason: unknown) => reason)
    expect(missingSecret).toMatchObject({
      toolCode: 'SECRET_MISSING',
      traceId: expect.any(Number),
    })
    expect(service.listInvocations({ toolId: 'jira_search' })).toEqual([
      expect.objectContaining({ status: 'error', errorCode: 'SECRET_MISSING' }),
      expect.objectContaining({ status: 'denied', errorCode: 'DENIED' }),
    ])
  })

  it('testRun refuses drafts referencing secrets before save', async () => {
    await expect(
      service.testRun({ draftSpec: httpDraftWithSecret(), input: { issueKey: 'X-1' } }),
    ).rejects.toThrow(/先保存/)
  })

  it('tests the current draft with Keychain secrets from the matching saved tool', async () => {
    const paths: string[] = []
    const server = createServer((request, response) => {
      paths.push(request.url ?? '')
      expect(request.headers.authorization).toBe('token-value')
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('draft response')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const saved = {
        ...httpDraftWithSecret(),
        spec: {
          request: {
            method: 'GET' as const,
            urlTemplate: `${endpoint}/saved`,
            headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
          },
          response: { format: 'text' as const },
        },
      } as CustomToolDraft
      await service.create(saved)
      await service.writeSecret('jira_search', 'auth_token', 'token-value')

      const draft = {
        ...saved,
        spec: {
          request: {
            method: 'GET' as const,
            urlTemplate: `${endpoint}/draft`,
            headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
          },
          response: { format: 'text' as const },
        },
      } as CustomToolDraft
      const result = await service.testRun({
        toolId: 'jira_search',
        draftSpec: draft,
        input: {},
      })

      expect(result).toMatchObject({ ok: true, text: 'draft response' })
      expect(result.traceId).toEqual(expect.any(Number))
      expect(service.listInvocations({ toolId: 'jira_search' })[0]).toMatchObject({
        id: result.traceId,
        source: 'direct',
        status: 'ok',
        toolVersion: null,
      })
      expect(paths).toEqual(['/draft'])
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error != null ? reject(error) : resolve())),
      )
    }
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

  it('attaches a failed runtime invocation trace to the thrown error', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/plain' })
      response.end('provider unavailable')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      await service.create(
        httpDraft({
          spec: {
            request: { method: 'GET', urlTemplate: endpoint },
            response: { format: 'text' },
          },
        } as Partial<CustomToolDraft>),
      )

      const error = await service
        .executeEnabled({
          toolId: 'jira_search',
          input: {},
          sessionId: 'session-1',
          turnId: 'turn-1',
          source: 'host',
        })
        .catch((reason: unknown) => reason)

      expect(error).toBeInstanceOf(CustomToolError)
      expect(error).toMatchObject({ toolCode: 'HTTP_ERROR', traceId: expect.any(Number) })
      if (!(error instanceof CustomToolError)) throw error
      expect(service.listInvocations({ toolId: 'jira_search' })[0]).toMatchObject({
        id: error.traceId,
        source: 'host',
        status: 'error',
        errorCode: 'HTTP_ERROR',
        sessionId: 'session-1',
        turnId: 'turn-1',
      })
      expect(
        new ToolInvocationRepository(db).list({ sourceKind: 'custom-tool' }).items[0],
      ).toMatchObject({
        source_id: 'jira_search',
        tool_id: 'jira_search',
        session_id: 'session-1',
        turn_id: 'turn-1',
        invocation_source: 'platform',
        status: 'error',
        error_code: 'HTTP_ERROR',
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error != null ? reject(error) : resolve())),
      )
    }
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

  it('keeps a tool disabled and retryable when Keychain cleanup fails', async () => {
    const keytar = (await import('keytar')).default
    await service.create(httpDraftWithSecret())
    await service.writeSecret('jira_search', 'auth_token', 'token-value')
    vi.mocked(keytar.deletePassword).mockRejectedValueOnce(new Error('keychain unavailable'))

    await expect(service.delete('jira_search')).rejects.toThrow(/工具已停用.*重试删除/)
    expect(service.list()).toEqual([expect.objectContaining({ id: 'jira_search', enabled: false })])
  })

  it('setEnabled toggles and keeps other fields', async () => {
    await service.create(httpDraft())
    const disabled = await service.setEnabled('jira_search', false)
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
      expect(result.imported[0]?.publishedVersion).toBeNull()
      expect(result.imported[0]?.hasUnpublishedDraft).toBe(true)
      expect(targetService.listEnabledRecords()).toEqual([])
    } finally {
      targetDb.close()
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('import rejects malformed payloads', async () => {
    await expect(service.import({ formatVersion: 99, tools: [] })).rejects.toThrow(/不合法/)
  })

  it('stores and applies the local trace retention policy', async () => {
    expect(service.getInvocationRetentionDays()).toBe(30)
    expect(service.setInvocationRetentionDays(14)).toEqual({ retentionDays: 14, deleted: 0 })
    expect(service.getInvocationRetentionDays()).toBe(14)
    await service.create(httpDraft())
    await service.testRun({ toolId: 'jira_search', input: { issueKey: 'SPARK-1' } })
    expect(service.clearInvocations('jira_search')).toBe(1)
    expect(service.listInvocations({ toolId: 'jira_search' })).toEqual([])
  })

  it('emits change events for mutations', async () => {
    const events: Array<{ change: string; id?: string }> = []
    service.onChange((event) => events.push(event))
    await service.create(httpDraft())
    await service.setEnabled('jira_search', false)
    await service.delete('jira_search')
    expect(events.map((event) => event.change)).toEqual(['created', 'enabled', 'deleted'])
  })

  it('update preserves enabled/origin and type is immutable', async () => {
    await service.create(httpDraft())
    await service.setEnabled('jira_search', false)
    const updated = await service.update('jira_search', httpDraft({ title: '新标题' }))
    expect(updated.title).toBe('新标题')
    expect(updated.enabled).toBe(false)
    expect(updated.origin).toBe('local')
    await expect(
      service.update('jira_search', httpDraft({ type: 'sql' } as Partial<CustomToolDraft>)),
    ).rejects.toThrow(/类型创建后不可修改/)
  })

  it('atomically disables an enabled tool before exposing a newly declared secret', async () => {
    await service.create(httpDraft())

    const updated = await service.update('jira_search', httpDraftWithSecret())

    expect(updated.enabled).toBe(false)
    await expect(service.setEnabled('jira_search', true)).rejects.toThrow(/缺少密钥/)
  })

  it('throws CustomToolError NOT_FOUND for missing tools', async () => {
    await expect(service.get('ghost')).rejects.toBeInstanceOf(CustomToolError)
  })
})
