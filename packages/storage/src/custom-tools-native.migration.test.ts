import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CustomToolRecord } from '@spark/protocol'

type CodeToolRecord = Extract<CustomToolRecord, { type: 'code' }>
import { SparkDatabase } from './database.js'
import { CustomToolRepository } from './repositories/custom-tool.repository.js'

const MIGRATIONS = join(process.cwd(), 'migrations')

/**
 * 复制编号 <= targetVersion 的迁移到临时目录，用真实迁移机制（含兼容处理器）
 * 构造一个停在历史版本的数据库，再对同一库跑完整目录即可只应用增量迁移。
 */
function buildPartialMigrations(dir: string, targetVersion: number): string {
  const partial = join(dir, `migrations-0-${targetVersion}`)
  mkdirSync(partial, { recursive: true })
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort()) {
    if (Number(name.slice(0, 3)) > targetVersion) break
    copyFileSync(join(MIGRATIONS, name), join(partial, name))
  }
  return partial
}

/**
 * 089 之前的 custom_tools 形态（0.11.27 线上库）：没有版本列，
 * type CHECK 只允许 http/sql/command/prompt/composite/provider-vision。
 */
function seedLegacyTool(db: SparkDatabase, id: string, type: 'http' | 'provider-vision'): void {
  db.raw
    .prepare(
      `INSERT INTO custom_tools
       (id, title, description, type, input_schema_json, spec_json,
        risk, effect, idempotency, timeout_ms, enabled, origin,
        last_test_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, '{"type":"object"}', '{"spec":{}}',
               'read', 'read', 'safe', 30000, 1, 'local',
               NULL, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z')`,
    )
    .run(id, `${id} 标题`, `${id} 的旧版工具说明`, type)
}

function insertToolWithType(db: SparkDatabase, id: string, type: string): void {
  db.raw
    .prepare(
      `INSERT INTO custom_tools
       (id, title, description, type, input_schema_json, spec_json,
        risk, effect, idempotency, timeout_ms, enabled, origin,
        last_test_at, created_at, updated_at)
       VALUES (?, '标题', '说明', ?, '{"type":"object"}', '{"spec":{}}',
               'read', 'read', 'safe', 30000, 0, 'local', NULL, ?, ?)`,
    )
    .run(id, type, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
}

function makeCodeRecord(): CodeToolRecord {
  const now = new Date().toISOString()
  return {
    id: 'text_summarize',
    title: '文本摘要',
    description: '组合已发布的 HTTP 抓取工具并对结果做本地摘要计算',
    type: 'code',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 30_000,
    spec: {
      runtime: {
        kind: 'trusted-worker',
        language: 'typescript',
        source:
          'export default async (input: { text: string }) => ({ summary: input.text.slice(0, 10) })',
        entryExport: 'default',
      },
      permissions: { toolIds: ['fetch_page'] },
      limits: { memoryMb: 128, maxOutputBytes: 1_048_576 },
      trust: 'trusted-local',
    },
    enabled: false,
    origin: 'local',
    publishedVersion: 1,
    draftVersion: 1,
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('custom tools native migration (089)', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `spark-custom-tools-native-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects code tools under the 088 constraint', () => {
    db = new SparkDatabase(join(dir, 'legacy.db'))
    db.runMigrations(buildPartialMigrations(dir, 88))
    expect(() => insertToolWithType(db, 'code_tool', 'code')).toThrow(/CHECK constraint failed/)
  })

  it('upgrades a 088 database without losing tools and starts accepting code tools', () => {
    db = new SparkDatabase(join(dir, 'legacy.db'))
    db.runMigrations(buildPartialMigrations(dir, 88))
    seedLegacyTool(db, 'jira_search', 'http')
    seedLegacyTool(db, 'vision_fallback', 'provider-vision')

    // 增量应用 089（001..088 已记录，只会执行 089）。
    db.runMigrations(MIGRATIONS)

    const rows = db.raw
      .prepare(
        `SELECT id, type, enabled, published_version, draft_version, created_at, updated_at
         FROM custom_tools ORDER BY id`,
      )
      .all() as Array<{
      id: string
      type: string
      enabled: number
      published_version: number | null
      draft_version: number
      created_at: string
      updated_at: string
    }>
    expect(rows).toEqual([
      {
        id: 'jira_search',
        type: 'http',
        enabled: 1,
        published_version: 1,
        draft_version: 1,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
      {
        id: 'vision_fallback',
        type: 'provider-vision',
        enabled: 1,
        published_version: 1,
        draft_version: 1,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    ])

    // 升级后 code 类型可以落库，版本表与调用账本新列同时就位。
    expect(() => insertToolWithType(db, 'code_tool', 'code')).not.toThrow()
    const versionTables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_tool_versions', 'custom_tool_trace_settings')",
      )
      .all() as Array<{ name: string }>
    expect(versionTables.map((row) => row.name).sort()).toEqual([
      'custom_tool_trace_settings',
      'custom_tool_versions',
    ])
    const invocationColumns = db.raw
      .prepare(
        "SELECT name FROM pragma_table_info('custom_tool_invocations') WHERE name IN ('tool_version', 'source')",
      )
      .all() as Array<{ name: string }>
    expect(invocationColumns.map((row) => row.name).sort()).toEqual(['source', 'tool_version'])
  })

  it('round-trips code tools through the repository on a fresh database', () => {
    db = new SparkDatabase(join(dir, 'fresh.db'))
    db.runMigrations(MIGRATIONS)
    const repository = new CustomToolRepository(db)
    const record = makeCodeRecord()
    repository.create(record)

    const loaded = repository.get('text_summarize')
    expect(loaded).toEqual(record)
    expect(loaded?.type).toBe('code')
    if (loaded?.type === 'code') {
      expect(loaded.spec.runtime.kind).toBe('trusted-worker')
      expect(loaded.spec.permissions.toolIds).toEqual(['fetch_page'])
    }

    expect(repository.listEnabled().map((tool) => tool.id)).toEqual([])
    repository.update('text_summarize', { enabled: true })
    expect(repository.listEnabled().map((tool) => tool.id)).toEqual(['text_summarize'])
  })

  it('backfills version-1 snapshots for tools upgraded from 0.11.27', () => {
    db = new SparkDatabase(join(dir, 'legacy.db'))
    db.runMigrations(buildPartialMigrations(dir, 88))
    seedLegacyTool(db, 'jira_search', 'http')
    db.runMigrations(MIGRATIONS)

    const repository = new CustomToolRepository(db)
    repository.ensureVersionHistory()

    const versions = repository.listVersions('jira_search')
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, status: 'published' })
    const draft = repository.getVersionDraft('jira_search', 1)
    expect(draft?.id).toBe('jira_search')
    expect(draft?.type).toBe('http')
  })
})
