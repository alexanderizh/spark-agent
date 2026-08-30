import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CustomToolRecord } from '@spark/protocol'
import { SparkDatabase } from '../database.js'
import { CustomToolRepository } from './custom-tool.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

type HttpToolRecord = Extract<CustomToolRecord, { type: 'http' }>
type VisionToolRecord = Extract<CustomToolRecord, { type: 'provider-vision' }>

function makeRecord(overrides: Partial<HttpToolRecord> = {}): HttpToolRecord {
  const now = new Date().toISOString()
  return {
    id: 'jira_search',
    title: 'Jira 查询',
    description: '按 issue key 查询内部 Jira issue 详情',
    type: 'http',
    inputSchema: {
      type: 'object',
      properties: { issueKey: { type: 'string' } },
      required: ['issueKey'],
    },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 30_000,
    secretRefs: { auth_token: 'custom-tool:jira_search:auth_token' },
    spec: {
      request: {
        method: 'GET',
        urlTemplate: 'https://jira.internal/v3/issue/{{issueKey}}',
        headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
      },
      response: { format: 'json' },
    },
    enabled: false,
    origin: 'local',
    publishedVersion: 1,
    draftVersion: 1,
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeVisionRecord(): VisionToolRecord {
  const now = new Date().toISOString()
  return {
    id: 'vision_fallback',
    title: '图像理解',
    description: '使用已有多模态 Provider 分析当前会话选择的图片附件',
    type: 'provider-vision',
    inputSchema: {
      type: 'object',
      properties: {
        images: { type: 'array', items: { type: 'string' } },
        question: { type: 'string' },
      },
      required: ['images'],
    },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 60_000,
    spec: {
      providerProfileId: 'vision-provider',
      instructions: '请完整、准确地描述图片内容，并回答用户提出的问题。',
      maxImages: 4,
      maxTokens: 4_096,
      autoRoute: { enabled: true, priority: 100 },
      exposeToAgent: false,
    },
    enabled: true,
    origin: 'local',
    publishedVersion: 1,
    draftVersion: 1,
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('CustomToolRepository', () => {
  let db: SparkDatabase
  let repository: CustomToolRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-custom-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    repository = new CustomToolRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('round-trips the full record including spec envelope and secret refs', () => {
    const record = makeRecord()
    repository.create(record)
    const loaded = repository.get('jira_search')
    expect(loaded).toEqual(record)
    expect(loaded?.spec).toMatchObject({
      request: { urlTemplate: 'https://jira.internal/v3/issue/{{issueKey}}' },
    })
    expect(loaded?.secretRefs).toEqual({ auth_token: 'custom-tool:jira_search:auth_token' })
  })

  it('round-trips provider vision specs without copying provider credentials', () => {
    const record = makeVisionRecord()
    repository.create(record)
    const loaded = repository.get('vision_fallback')
    expect(loaded).toEqual(record)
    expect(loaded?.secretRefs).toBeUndefined()
    expect(loaded?.spec).toMatchObject({ providerProfileId: 'vision-provider' })
  })

  it('omits secretRefs from the envelope when absent', () => {
    const record = makeRecord({ id: 'plain_tool', secretRefs: undefined })
    repository.create(record)
    const loaded = repository.get('plain_tool')
    expect(loaded?.secretRefs).toBeUndefined()
  })

  it('lists by recency and filters by query across id/title/description', () => {
    repository.create(
      makeRecord({ id: 'alpha_tool', title: 'Alpha', updatedAt: '2026-08-01T00:00:00.000Z' }),
    )
    repository.create(
      makeRecord({ id: 'beta_tool', title: 'Beta 报表', updatedAt: '2026-08-02T00:00:00.000Z' }),
    )
    repository.create(
      makeRecord({
        id: 'gamma_tool',
        description: '统计 gamma 数据库的会话情况',
        updatedAt: '2026-08-03T00:00:00.000Z',
      }),
    )

    expect(repository.list().map((tool) => tool.id)).toEqual([
      'gamma_tool',
      'beta_tool',
      'alpha_tool',
    ])
    expect(repository.list('BETA').map((tool) => tool.id)).toEqual(['beta_tool'])
    expect(repository.list('gamma 数据库').map((tool) => tool.id)).toEqual(['gamma_tool'])
    expect(repository.list('不存在')).toEqual([])
  })

  it('listEnabled returns only enabled tools', () => {
    repository.create(makeRecord({ id: 'enabled_one', enabled: true }))
    repository.create(makeRecord({ id: 'disabled_one', enabled: false }))
    expect(repository.listEnabled().map((tool) => tool.id)).toEqual(['enabled_one'])
  })

  it('updates selective fields without touching others', () => {
    repository.create(makeRecord())
    const updated = repository.update('jira_search', { enabled: true, timeoutMs: 60_000 })
    expect(updated?.enabled).toBe(true)
    expect(updated?.timeoutMs).toBe(60_000)
    expect(updated?.title).toBe('Jira 查询')
    expect(updated != null && updated.updatedAt >= updated.createdAt).toBe(true)
  })

  it('records last test timestamp', () => {
    repository.create(makeRecord())
    const stamp = new Date().toISOString()
    const updated = repository.update('jira_search', { lastTestAt: stamp })
    expect(updated?.lastTestAt).toBe(stamp)
  })

  it('keeps the stable body unchanged until a saved draft is published', () => {
    repository.create(makeRecord({ title: '稳定标题', enabled: true }))

    const draft = makeRecord({ title: '草稿标题' })
    const {
      enabled: _enabled,
      origin: _origin,
      publishedVersion: _publishedVersion,
      draftVersion: _draftVersion,
      lastTestAt: _lastTestAt,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...draftSpec
    } = draft
    const afterSave = repository.saveDraft('jira_search', draftSpec)

    expect(afterSave).toMatchObject({ title: '稳定标题', publishedVersion: 1, draftVersion: 2 })
    expect(repository.getDraft('jira_search')?.title).toBe('草稿标题')
    expect(repository.listVersions('jira_search')).toEqual([
      expect.objectContaining({ version: 2, status: 'draft' }),
      expect.objectContaining({ version: 1, status: 'published' }),
    ])

    const published = repository.publishDraft('jira_search', 2)
    expect(published).toMatchObject({ title: '草稿标题', publishedVersion: 2, draftVersion: 2 })
    expect(repository.listVersions('jira_search')).toEqual([
      expect.objectContaining({ version: 2, status: 'published' }),
      expect.objectContaining({ version: 1, status: 'archived' }),
    ])
  })

  it('rolls back by creating a new immutable version and records local traces', () => {
    repository.create(makeRecord({ title: 'v1', enabled: true }))
    const draftRecord = makeRecord({ title: 'v2' })
    const {
      enabled: _enabled,
      origin: _origin,
      publishedVersion: _publishedVersion,
      draftVersion: _draftVersion,
      lastTestAt: _lastTestAt,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...draft
    } = draftRecord
    repository.saveDraft('jira_search', draft)
    repository.publishDraft('jira_search')

    const rolledBack = repository.rollback('jira_search', 1)
    expect(rolledBack).toMatchObject({ title: 'v1', publishedVersion: 3, draftVersion: 3 })
    expect(repository.listVersions('jira_search')[0]).toMatchObject({
      version: 3,
      status: 'published',
      sourceVersion: 1,
    })

    const traceId = repository.recordInvocation({
      toolId: 'jira_search',
      toolVersion: 3,
      inputSha256: 'a'.repeat(64),
      source: 'host',
      status: 'ok',
      durationMs: 42,
      outputBytes: 128,
    })
    expect(repository.listInvocations({ toolId: 'jira_search' })).toEqual([
      expect.objectContaining({ id: traceId, source: 'host', durationMs: 42, toolVersion: 3 }),
    ])
  })

  it('applies configurable local trace retention and supports scoped clearing', () => {
    repository.create(makeRecord())
    expect(repository.getInvocationRetentionDays()).toBe(30)
    const expiredTrace = repository.recordInvocation({
      toolId: 'jira_search',
      toolVersion: 1,
      inputSha256: 'b'.repeat(64),
      source: 'direct',
      status: 'error',
      durationMs: 5,
    })
    db.raw
      .prepare('UPDATE custom_tool_invocations SET created_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:00.000Z', expiredTrace)
    const activeTrace = repository.recordInvocation({
      toolId: 'jira_search',
      toolVersion: 1,
      inputSha256: 'c'.repeat(64),
      source: 'model',
      status: 'ok',
      durationMs: 9,
    })

    expect(repository.setInvocationRetentionDays(7)).toBe(7)
    expect(repository.pruneInvocations(new Date('2026-08-31T00:00:00.000Z').getTime())).toBe(1)
    expect(repository.listInvocations({})).toEqual([
      expect.objectContaining({ id: activeTrace, source: 'model' }),
    ])
    expect(repository.deleteInvocations('jira_search')).toBe(1)
    expect(repository.listInvocations({})).toEqual([])
  })

  it('deletes tools and reports existence', () => {
    repository.create(makeRecord())
    expect(repository.exists('jira_search')).toBe(true)
    expect(repository.deleteById('jira_search')).toBe(true)
    expect(repository.exists('jira_search')).toBe(false)
    expect(repository.deleteById('jira_search')).toBe(false)
  })
})
