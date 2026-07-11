/**
 * @spark/storage 单元测试
 *
 * 测试数据库初始化、migration、基础 CRUD 操作
 * 使用内存数据库（:memory:）避免文件系统依赖
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from './database.js'
import { BaseRepository } from './repository.js'
import { join } from 'path'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

function applyMigrationsThrough(
  db: SparkDatabase,
  migrationsDir: string,
  maxVersion: number,
): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const insertMigration = db.raw.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
  )
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const name of files) {
    const version = Number.parseInt(name, 10)
    if (!Number.isFinite(version) || version > maxVersion) continue
    db.raw.exec(readFileSync(join(migrationsDir, name), 'utf8'))
    insertMigration.run(version, name)
  }
}

describe('SparkDatabase', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    // 每个测试使用独立的临时目录
    testDir = join(tmpdir(), `spark-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (db != null) {
      db.close()
    }
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should open database and enable WAL mode', () => {
    const dbPath = join(testDir, 'test.db')
    db = new SparkDatabase(dbPath)

    const result = db.raw.pragma('journal_mode', { simple: true }) as string
    expect(result).toBe('wal')

    db.close()
  })

  it('should run migrations from specified directory', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    // 验证 schema_migrations 表中有记录
    const rows = db.raw.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as {
      count: number
    }
    expect(rows.count).toBeGreaterThanOrEqual(1)

    // 验证核心表已创建
    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>

    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('workspaces')
    expect(tableNames).toContain('sessions')
    expect(tableNames).toContain('agent_events')
    expect(tableNames).toContain('provider_profiles')
    expect(tableNames).toContain('model_profiles')
    expect(tableNames).toContain('usage_ledger')
    expect(tableNames).toContain('rules')
    expect(tableNames).toContain('mcp_servers')
    expect(tableNames).toContain('skills')
    expect(tableNames).toContain('workflows')
    expect(tableNames).toContain('slash_commands')
    expect(tableNames).toContain('resource_samples')
    expect(tableNames).toContain('media_model_manifests')
    expect(tableNames).toContain('media_provider_models')
    expect(tableNames).toContain('media_generation_tasks')

    const canvasAssistant = db.raw
      .prepare('SELECT name, built_in, enabled, skill_ids_json FROM agents WHERE id = ?')
      .get('canvas-assistant-agent') as
      | {
          name: string
          built_in: number
          enabled: number
          skill_ids_json: string
        }
      | undefined
    expect(canvasAssistant?.name).toBe('画布助手')
    expect(canvasAssistant?.built_in).toBe(1)
    expect(canvasAssistant?.enabled).toBe(1)
    expect(JSON.parse(canvasAssistant?.skill_ids_json ?? '[]')).toEqual([
      'builtin:platform-manager',
      'builtin:canvas-studio',
      'builtin:multimedia-use',
    ])
  })

  it('should not re-apply already applied migrations', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    // 记录当前 migration 数量
    const countBefore = (
      db.raw.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number }
    ).count

    // 再次运行 migration，不应增加记录
    db.runMigrations(migrationsDir)

    const countAfter = (
      db.raw.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number }
    ).count

    expect(countAfter).toBe(countBefore)
  })

  it('should upgrade legacy usage ledger schema when applying migration 11', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 10)

    db.runMigrations(migrationsDir)

    const columns = db.raw.prepare('PRAGMA table_info(usage_ledger)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)

    expect(columnNames).toContain('model_id')
    expect(columnNames).toContain('input_tokens')
    expect(columnNames).toContain('output_tokens')
    expect(columnNames).toContain('request_timestamp')
  })

  it('should mark session metadata migration applied when the column already exists', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 17)
    db.raw.exec("ALTER TABLE sessions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")

    db.runMigrations(migrationsDir)

    const applied = db.raw
      .prepare('SELECT name FROM schema_migrations WHERE version = 18')
      .get() as { name: string } | undefined
    expect(applied?.name).toBe('018_add_session_metadata_json.sql')
  })

  it('should complete agent event performance migration when one generated column already exists', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 47)
    db.raw.exec(`
      ALTER TABLE agent_events
        ADD COLUMN seq INTEGER
        GENERATED ALWAYS AS (CAST(json_extract(event_json, '$.seq') AS INTEGER)) VIRTUAL
    `)

    db.runMigrations(migrationsDir)

    const columns = db.raw.prepare('PRAGMA table_xinfo(agent_events)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('seq')
    expect(columnNames).toContain('event_mode')

    const indexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'agent_events'")
      .all() as Array<{ name: string }>
    const indexNames = indexes.map((index) => index.name)
    expect(indexNames).toContain('idx_agent_events_session_seq')
    expect(indexNames).toContain('idx_agent_events_session_turn_seq')
    expect(indexNames).toContain('idx_agent_events_session_type_mode_seq')

    const applied = db.raw
      .prepare('SELECT name FROM schema_migrations WHERE version = 48')
      .get() as { name: string } | undefined
    expect(applied?.name).toBe('048_agent_event_query_performance.sql')
  })

  it('should upgrade legacy agent teams with discussion settings defaults', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    applyMigrationsThrough(db, migrationsDir, 45)
    db.raw.exec(`
      INSERT INTO agent_teams (
        id, name, description, host_agent_id, member_agent_ids_json,
        max_depth, allow_nesting, prompt, metadata_json, created_at, updated_at
      ) VALUES (
        'legacy-team', 'Legacy Team', '', 'dev-agent', '["qa-agent"]',
        1, 0, '', '{}', datetime('now'), datetime('now')
      );
    `)

    db.runMigrations(migrationsDir)

    const columns = db.raw.prepare('PRAGMA table_info(agent_teams)').all() as Array<{
      name: string
    }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('max_discussion_rounds')
    expect(columnNames).toContain('enable_peer_messaging')

    const row = db.raw
      .prepare('SELECT max_discussion_rounds, enable_peer_messaging FROM agent_teams WHERE id = ?')
      .get('legacy-team') as {
      max_discussion_rounds: number
      enable_peer_messaging: number
    }
    expect(row.max_discussion_rounds).toBe(6)
    expect(row.enable_peer_messaging).toBe(0)
  })

  it('should throw error for invalid migration filename', () => {
    const dbPath = join(testDir, 'test.db')
    const invalidDir = join(testDir, 'migrations')

    mkdirSync(invalidDir, { recursive: true })

    // 创建一个不符合命名规范的 migration 文件
    writeFileSync(join(invalidDir, 'invalid_no_number.sql'), 'SELECT 1;')

    db = new SparkDatabase(dbPath)

    expect(() => db.runMigrations(invalidDir)).toThrow('Invalid migration filename')
  })

  it('should throw when two migrations share the same version number', () => {
    const dbPath = join(testDir, 'test.db')
    const dupDir = join(testDir, 'migrations')

    mkdirSync(dupDir, { recursive: true })
    // 两个文件撞号（都是 028）——历史上这会导致后者被静默跳过
    writeFileSync(join(dupDir, '028_first.sql'), 'CREATE TABLE a (id TEXT);')
    writeFileSync(join(dupDir, '028_second.sql'), 'CREATE TABLE b (id TEXT);')

    db = new SparkDatabase(dbPath)

    expect(() => db.runMigrations(dupDir)).toThrow(/Duplicate migration version 28/)
  })
})

describe('BaseRepository', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-test-repo-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })

    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')
    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should perform basic CRUD operations', () => {
    // 创建一个简单的 test repository，暴露 protected 方法用于测试
    class TestWorkspaceRepo extends BaseRepository {
      constructor(db: SparkDatabase) {
        super(db, 'workspaces')
      }

      insert(id: string, name: string, rootPath: string): void {
        this.raw
          .prepare(
            `INSERT INTO workspaces (id, name, root_path, spark_config_path, agent_runtime_path, project_kind)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, name, rootPath, `${rootPath}/.spark`, `${rootPath}/.agent_spark`, 'generic')
      }

      // 将 protected 方法暴露为 public，用于测试
      get(id: string) {
        return this.findById(id)
      }
      getAll() {
        return this.findAll()
      }
      getCount() {
        return this.count()
      }
      remove(id: string) {
        return this.deleteById(id)
      }
    }

    const repo = new TestWorkspaceRepo(db)

    // Create
    repo.insert('ws-1', 'test-project', '/tmp/test')
    repo.insert('ws-2', 'another-project', '/tmp/another')

    // Read by ID
    const ws = repo.get('ws-1')
    expect(ws).not.toBeNull()
    expect((ws as Record<string, unknown>)['name']).toBe('test-project')

    // Read all
    const all = repo.getAll()
    expect(all).toHaveLength(2)

    // Count
    expect(repo.getCount()).toBe(2)

    // Delete
    expect(repo.remove('ws-1')).toBe(true)
    expect(repo.getCount()).toBe(1)
    expect(repo.get('ws-1')).toBeNull()
  })
})
