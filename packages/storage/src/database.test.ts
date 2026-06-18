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
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

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
    const rows = db.raw
      .prepare('SELECT COUNT(*) as count FROM schema_migrations')
      .get() as { count: number }
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
  })

  it('should not re-apply already applied migrations', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    db.runMigrations(migrationsDir)

    // 记录当前 migration 数量
    const countBefore = (db.raw
      .prepare('SELECT COUNT(*) as count FROM schema_migrations')
      .get() as { count: number }).count

    // 再次运行 migration，不应增加记录
    db.runMigrations(migrationsDir)

    const countAfter = (db.raw
      .prepare('SELECT COUNT(*) as count FROM schema_migrations')
      .get() as { count: number }).count

    expect(countAfter).toBe(countBefore)
  })

  it('should upgrade legacy usage ledger schema when applying migration 11', () => {
    const dbPath = join(testDir, 'test.db')
    const migrationsDir = join(process.cwd(), 'migrations')

    db = new SparkDatabase(dbPath)
    db.raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE usage_ledger (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        run_id TEXT,
        turn_id TEXT,
        workflow_node_id TEXT,
        agent_id TEXT,
        provider_id TEXT NOT NULL,
        model_profile_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        token_usage_json TEXT NOT NULL DEFAULT '{}',
        media_usage_json TEXT,
        cost_json TEXT NOT NULL DEFAULT '{}',
        latency_json TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT 'api',
        raw_usage_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    const insertMigration = db.raw.prepare(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
    )
    for (let version = 1; version <= 10; version += 1) {
      insertMigration.run(version, `${String(version).padStart(3, '0')}_legacy.sql`)
    }

    db.runMigrations(migrationsDir)

    const columns = db.raw
      .prepare('PRAGMA table_info(usage_ledger)')
      .all() as Array<{ name: string }>
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
    db.raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        project_id TEXT NOT NULL,
        workspace_ids_json TEXT NOT NULL DEFAULT '[]',
        rule_bundle_id TEXT,
        permission_profile_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    const insertMigration = db.raw.prepare(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
    )
    for (let version = 1; version <= 17; version += 1) {
      insertMigration.run(version, `${String(version).padStart(3, '0')}_legacy.sql`)
    }

    db.runMigrations(migrationsDir)

    const applied = db.raw
      .prepare('SELECT name FROM schema_migrations WHERE version = 18')
      .get() as { name: string } | undefined
    expect(applied?.name).toBe('018_add_session_metadata_json.sql')
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
      get(id: string) { return this.findById(id) }
      getAll() { return this.findAll() }
      getCount() { return this.count() }
      remove(id: string) { return this.deleteById(id) }
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
