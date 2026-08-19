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

function makeRecord(overrides: Partial<CustomToolRecord> = {}): CustomToolRecord {
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
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
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
    expect(updated?.updatedAt >= (updated?.createdAt ?? '')).toBe(true)
  })

  it('records last test timestamp', () => {
    repository.create(makeRecord())
    const stamp = new Date().toISOString()
    const updated = repository.update('jira_search', { lastTestAt: stamp })
    expect(updated?.lastTestAt).toBe(stamp)
  })

  it('deletes tools and reports existence', () => {
    repository.create(makeRecord())
    expect(repository.exists('jira_search')).toBe(true)
    expect(repository.deleteById('jira_search')).toBe(true)
    expect(repository.exists('jira_search')).toBe(false)
    expect(repository.deleteById('jira_search')).toBe(false)
  })
})
