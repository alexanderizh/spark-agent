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

  it('should throw error for invalid migration filename', () => {
    const dbPath = join(testDir, 'test.db')
    const invalidDir = join(testDir, 'migrations')

    mkdirSync(invalidDir, { recursive: true })

    // 创建一个不符合命名规范的 migration 文件
    writeFileSync(join(invalidDir, 'invalid_no_number.sql'), 'SELECT 1;')

    db = new SparkDatabase(dbPath)

    expect(() => db.runMigrations(invalidDir)).toThrow('Invalid migration filename')
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
