/**
 * @module database
 *
 * Spark Agent 数据库连接管理器
 *
 * 职责：
 *   - 创建/打开 SQLite 数据库连接
 *   - 启用 WAL 模式和性能优化 pragma
 *   - 管理 migration 生命周期
 *   - 提供连接关闭和清理接口
 *
 * 约束（ADR-002）：
 *   - 使用 better-sqlite3 同步 API
 *   - 所有 SQL 通过 prepared statement 执行，禁止字符串拼接
 *   - 本模块是唯一合法的数据库连接创建入口
 */

import BetterSqlite3 from 'better-sqlite3'
import { readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from '@spark/shared'

/**
 * better-sqlite3 的 Database 类型，导出供 Repository 使用
 *
 * 通过 class 本身获取类型，避免直接引用 namespace member 导致的 TS4041
 */
export type SqliteDatabase = BetterSqlite3.Database

const log = createLogger('storage:database')

/**
 * Spark Agent 数据库实例
 *
 * 包装 better-sqlite3 的 Database，添加 migration 管理能力
 */
export class SparkDatabase {
  private readonly db: SqliteDatabase
  private closed = false
  /** 数据库文件绝对路径（位于 app-data）。用于派生同目录的附属存储，如 checkpoint 内容快照。 */
  readonly path: string

  constructor(dbPath: string) {
    log.info(`Opening database: ${dbPath}`)

    this.path = dbPath
    this.db = new BetterSqlite3(dbPath)

    // 启用 WAL 模式和性能优化 pragma（ADR-002）
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('temp_store = MEMORY')
    this.db.pragma('mmap_size = 268435456') // 256MB

    log.info('Database opened, WAL mode enabled')
  }

  /**
   * 获取原始 better-sqlite3 实例
   *
   * 用于 Repository 层直接操作数据库
   */
  get raw(): SqliteDatabase {
    if (this.closed) {
      throw new Error('Database is closed')
    }
    return this.db
  }

  /**
   * 运行所有待执行的 migration
   *
   * Migration 策略（ADR-002）：
   *   - SQL 文件放在 packages/storage/migrations/ 目录
   *   - 文件名格式：{序号}_{描述}.sql，如 001_initial_schema.sql
   *   - schema_migrations 表跟踪已执行的版本
   *   - 每次 migration 在事务中执行
   */
  runMigrations(migrationsDir?: string): void {
    // 确保 schema_migrations 表存在
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    const dir = migrationsDir ?? this.getDefaultMigrationsDir()
    const files = this.getMigrationFiles(dir)

    // 防止再次出现"撞号"：两个文件共享同一 version 时，按 version 去重会
    // 静默跳过其中一个 migration（历史上 028 撞号曾导致 media 表未被创建）。
    // 这里在启动时直接抛错，把问题暴露在开发期而不是用户机器上。
    this.assertUniqueVersions(files)

    for (const file of files) {
      const version = this.extractVersion(file.name)
      const applied = this.isMigrationApplied(version)

      if (!applied) {
        if (this.applyMigrationWithCompatibilityHandler(file, version)) {
          continue
        }
        if (this.shouldMarkMigrationAppliedWithoutRunning(version)) {
          this.recordMigration(version, file.name)
          log.info(`Migration ${version} already reflected in schema; marked as applied`)
          continue
        }
        this.applyMigration(file, version)
      }
    }

    log.info(`Migrations complete. Applied: ${files.length} migration(s)`)
  }

  /**
   * 关闭数据库连接
   *
   * 应用退出时必须调用，确保 WAL 日志正确清理
   */
  close(): void {
    if (!this.closed) {
      this.db.close()
      this.closed = true
      log.info('Database closed')
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * 获取默认 migrations 目录路径
   *
   * 返回 packages/storage/migrations/ 的绝对路径
   */
  private getDefaultMigrationsDir(): string {
    // ESM 环境下获取当前文件所在目录
    const currentDir =
      typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL('.', import.meta.url))
    return join(currentDir, '..', 'migrations')
  }

  /**
   * 获取 migrations 目录下所有 .sql 文件，按名称排序
   */
  private getMigrationFiles(dir: string): Array<{ name: string; path: string }> {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    return files.map((name) => ({
      name,
      path: join(dir, name),
    }))
  }

  /**
   * 校验所有 migration 文件的 version 唯一。
   *
   * schema_migrations 以 version 为主键去重，撞号会导致后出现的同号文件被静默跳过。
   */
  private assertUniqueVersions(files: Array<{ name: string }>): void {
    const seen = new Map<number, string>()
    for (const file of files) {
      const version = this.extractVersion(file.name)
      const existing = seen.get(version)
      if (existing != null) {
        throw new Error(
          `Duplicate migration version ${version}: "${existing}" 与 "${file.name}" 撞号。` +
            `请把其中一个重命名为未使用的序号。`,
        )
      }
      seen.set(version, file.name)
    }
  }

  /**
   * 从 migration 文件名中提取版本号
   * @example extractVersion('001_initial_schema.sql') → 1
   */
  private extractVersion(filename: string): number {
    const match = basename(filename).match(/^(\d+)/)
    if (match == null) {
      throw new Error(
        `Invalid migration filename: ${filename}. Expected format: {number}_{name}.sql`,
      )
    }
    return parseInt(match[1]!, 10)
  }

  /**
   * 检查指定版本号的 migration 是否已执行
   */
  private isMigrationApplied(version: number): boolean {
    const row = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(version) as { version: number } | undefined
    return row != null
  }

  /**
   * Compatibility guard for databases that were created from an intermediate
   * development build where the schema changed but schema_migrations did not.
   */
  private shouldMarkMigrationAppliedWithoutRunning(version: number): boolean {
    if (version === 18) {
      return this.columnExists('sessions', 'metadata_json')
    }
    if (version === 49) {
      return !this.tableExists('agents')
    }
    return false
  }

  private applyMigrationWithCompatibilityHandler(file: { name: string }, version: number): boolean {
    if (version !== 48) return false

    const transaction = this.db.transaction(() => {
      if (!this.columnExists('agent_events', 'seq')) {
        this.db.exec(`
          ALTER TABLE agent_events
            ADD COLUMN seq INTEGER
            GENERATED ALWAYS AS (CAST(json_extract(event_json, '$.seq') AS INTEGER)) VIRTUAL
        `)
      }

      if (!this.columnExists('agent_events', 'event_mode')) {
        this.db.exec(`
          ALTER TABLE agent_events
            ADD COLUMN event_mode TEXT
            GENERATED ALWAYS AS (json_extract(event_json, '$.mode')) VIRTUAL
        `)
      }

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq
          ON agent_events(session_id, seq, created_at);

        CREATE INDEX IF NOT EXISTS idx_agent_events_session_turn_seq
          ON agent_events(session_id, turn_id, seq);

        CREATE INDEX IF NOT EXISTS idx_agent_events_session_type_mode_seq
          ON agent_events(session_id, event_type, event_mode, seq);
      `)

      this.recordMigration(version, file.name)
    })

    try {
      transaction()
      log.info(`Migration ${version} applied successfully via compatibility handler`)
    } catch (err) {
      log.error(`Migration ${version} compatibility handler failed: ${String(err)}`)
      throw new Error(`Migration ${version} (${file.name}) failed: ${String(err)}`, { cause: err })
    }

    return true
  }

  private columnExists(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_xinfo(${tableName})`).all() as Array<{
      name: string
    }>
    return rows.some((row) => row.name === columnName)
  }

  private tableExists(tableName: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { name: string } | undefined
    return row != null
  }

  private recordMigration(version: number, name: string): void {
    this.db
      .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(version, name)
  }

  /**
   * 在事务中执行单个 migration
   */
  private applyMigration(file: { name: string; path: string }, version: number): void {
    log.info(`Applying migration ${version}: ${file.name}`)

    const sql = readFileSync(file.path, 'utf-8')

    // 每个 migration 在独立事务中执行
    const transaction = this.db.transaction(() => {
      this.db.exec(sql)
      this.recordMigration(version, file.name)
    })

    try {
      transaction()
      log.info(`Migration ${version} applied successfully`)
    } catch (err) {
      log.error(`Migration ${version} failed: ${String(err)}`)
      throw new Error(`Migration ${version} (${file.name}) failed: ${String(err)}`, { cause: err })
    }
  }
}

// ─── 便捷函数 ──────────────────────────────────────────────────────────

/**
 * 创建并初始化数据库
 *
 * 这是整个项目中唯一合法的数据库创建入口。
 * 返回已运行 migration 的 SparkDatabase 实例。
 *
 * @param dbPath - 数据库文件路径（由主进程的 db.ts 提供）
 * @param migrationsDir - 可选的自定义 migrations 目录路径
 * @returns 初始化完成的 SparkDatabase 实例
 *
 * @example
 * const db = createDatabase('/path/to/spark.db')
 * // db 已完成 migration，可直接使用
 * const stmt = db.raw.prepare('SELECT * FROM sessions')
 */
export function createDatabase(dbPath: string, migrationsDir?: string): SparkDatabase {
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}
