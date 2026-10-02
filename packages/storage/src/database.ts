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

export interface DatabaseMigration {
  version: number
  name: string
}

export interface DatabaseMigrationPlan {
  totalMigrations: number
  appliedMigrations: number
  pendingMigrations: DatabaseMigration[]
}

export interface DatabaseMigrationProgress {
  phase: 'applying' | 'applied'
  current: number
  total: number
  migration: DatabaseMigration
}

export interface RunMigrationsOptions {
  onProgress?: (progress: DatabaseMigrationProgress) => void
}

interface MigrationFile extends DatabaseMigration {
  path: string
}

function defaultMigrationsDir(): string {
  const currentDir =
    typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL('.', import.meta.url))
  return join(currentDir, '..', 'migrations')
}

function extractMigrationVersion(filename: string): number {
  const versionText = basename(filename).match(/^(\d+)/)?.[1]
  if (versionText == null) {
    throw new Error(`Invalid migration filename: ${filename}. Expected format: {number}_{name}.sql`)
  }
  return parseInt(versionText, 10)
}

function assertUniqueMigrationVersions(files: Array<{ name: string }>): void {
  const seen = new Map<number, string>()
  for (const file of files) {
    const version = extractMigrationVersion(file.name)
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

function getMigrationFiles(dir = defaultMigrationsDir()): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => ({
      version: extractMigrationVersion(name),
      name,
      path: join(dir, name),
    }))
  assertUniqueMigrationVersions(files)
  return files
}

interface AppliedMigrationRow {
  version: number
  name: string
}

/** 去掉 migration 文件名的序号前缀，留下描述部分（如 "workspace_default_agent.sql"）。 */
function extractMigrationSlug(filename: string): string {
  return basename(filename).replace(/^\d+_/, '')
}

/**
 * 计算"编号对账"修正：migration 文件重命名（改号）后，旧库里按旧号记录的
 * applied 记录会错位——同号新文件被误判已执行而永远缺表，改号文件被误判
 * 未执行而重跑（ALTER TABLE ADD COLUMN 重跑即 duplicate column 崩库）。
 *
 * 对账规则：改号会连文件名前缀一起变，因此按"去序号的描述部分"（slug）比对：
 * applied 记录的 slug 命中唯一一个现文件且其 version 与记录的 version 不同，
 * 说明该文件只是改了号，记录应修正到现号。slug 不唯一或无命中的记录保持原样，
 * 不做破坏性操作。
 */
function computeMigrationRenumbers(
  appliedRows: AppliedMigrationRow[],
  files: MigrationFile[],
): Array<{ from: number; to: number; name: string }> {
  const versionBySlug = new Map<string, number>()
  const ambiguousSlugs = new Set<string>()
  for (const file of files) {
    const slug = extractMigrationSlug(file.name)
    if (versionBySlug.has(slug)) {
      ambiguousSlugs.add(slug)
      continue
    }
    versionBySlug.set(slug, file.version)
  }
  for (const slug of ambiguousSlugs) versionBySlug.delete(slug)

  const occupiedVersions = new Set(appliedRows.map((row) => row.version))
  const corrections: Array<{ from: number; to: number; name: string }> = []
  for (const row of appliedRows) {
    const currentVersion = versionBySlug.get(extractMigrationSlug(row.name))
    if (currentVersion == null || currentVersion === row.version) continue
    if (occupiedVersions.has(currentVersion)) {
      // 目标号已被其他 applied 记录占用，改写会撞主键；保守放弃并留痕。
      log.warn(
        `Migration renumber conflict: "${row.name}" ${row.version} -> ${currentVersion} 目标号已被占用，跳过对账`,
      )
      continue
    }
    corrections.push({ from: row.version, to: currentVersion, name: row.name })
  }
  return corrections
}

function notifyMigrationProgress(
  onProgress: RunMigrationsOptions['onProgress'],
  progress: DatabaseMigrationProgress,
): void {
  try {
    onProgress?.(progress)
  } catch (error) {
    // 进度展示是旁路能力，观察者异常不能中止或回滚数据库 migration。
    log.warn(`Migration progress observer failed: ${String(error)}`)
  }
}

/**
 * 只读检查现有数据库还缺哪些 migration。
 *
 * 不创建表、不切换 WAL 模式，也不修改 schema；调用方可据此决定是否需要在升级前
 * 创建恢复点。数据库不存在或无法读取时直接抛错，由上层选择保守备份路径。
 */
export function inspectPendingMigrations(
  dbPath: string,
  migrationsDir?: string,
): DatabaseMigrationPlan {
  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  try {
    const files = getMigrationFiles(migrationsDir)
    const migrationsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name: string } | undefined
    const appliedVersions = new Set<number>()
    if (migrationsTable != null) {
      const rows = db
        .prepare('SELECT version, name FROM schema_migrations')
        .all() as AppliedMigrationRow[]
      const toByName = new Map(
        computeMigrationRenumbers(rows, files).map(({ name, to }) => [name, to] as const),
      )
      for (const row of rows) appliedVersions.add(toByName.get(row.name) ?? row.version)
    }
    const pendingMigrations = files
      .filter((file) => !appliedVersions.has(file.version))
      .map(({ version, name }) => ({ version, name }))
    return {
      totalMigrations: files.length,
      appliedMigrations: files.length - pendingMigrations.length,
      pendingMigrations,
    }
  } finally {
    db.close()
  }
}

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
  runMigrations(migrationsDir?: string, options: RunMigrationsOptions = {}): void {
    // 确保 schema_migrations 表存在
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    const files = getMigrationFiles(migrationsDir)
    this.reconcileMigrationRenumbers(files)
    const pendingFiles = files.filter((file) => !this.isMigrationApplied(file.version))

    for (const [index, file] of pendingFiles.entries()) {
      const progress = {
        current: index + 1,
        total: pendingFiles.length,
        migration: { version: file.version, name: file.name },
      }
      notifyMigrationProgress(options.onProgress, { phase: 'applying', ...progress })

      if (this.applyMigrationWithCompatibilityHandler(file, file.version)) {
        notifyMigrationProgress(options.onProgress, { phase: 'applied', ...progress })
        continue
      }
      if (this.shouldMarkMigrationAppliedWithoutRunning(file.version)) {
        this.recordMigration(file.version, file.name)
        log.info(`Migration ${file.version} already reflected in schema; marked as applied`)
        notifyMigrationProgress(options.onProgress, { phase: 'applied', ...progress })
        continue
      }
      this.applyMigration(file, file.version)
      notifyMigrationProgress(options.onProgress, { phase: 'applied', ...progress })
    }

    log.info(`Migrations complete. Applied this run: ${pendingFiles.length}/${files.length}`)
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
   * 检查指定版本号的 migration 是否已执行
   */
  private isMigrationApplied(version: number): boolean {
    const row = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(version) as { version: number } | undefined
    return row != null
  }

  /**
   * 执行编号对账写库：把因文件改号而错位的 applied 记录修正到文件现号。
   * 必须在 pending 计算之前完成——否则旧号记录会挡住同号新文件（永远缺表），
   * 改号文件会被误判未执行而重跑（ALTER ADD COLUMN 重跑即崩库）。
   */
  private reconcileMigrationRenumbers(files: MigrationFile[]): void {
    const rows = this.db
      .prepare('SELECT version, name FROM schema_migrations')
      .all() as AppliedMigrationRow[]
    const corrections = computeMigrationRenumbers(rows, files)
    if (corrections.length === 0) return

    const update = this.db.prepare(
      'UPDATE schema_migrations SET version = ? WHERE version = ? AND name = ?',
    )
    this.db.transaction(() => {
      for (const { from, to, name } of corrections) {
        update.run(to, from, name)
      }
    })()
    for (const { from, to, name } of corrections) {
      log.info(`Migration renumber reconciled: ${name} ${from} -> ${to}`)
    }
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
export function createDatabase(
  dbPath: string,
  migrationsDir?: string,
  options: RunMigrationsOptions = {},
): SparkDatabase {
  const db = new SparkDatabase(dbPath)
  try {
    db.runMigrations(migrationsDir, options)
    return db
  } catch (error) {
    // 迁移失败时必须先释放 WAL/文件锁，主进程才能安全恢复升级前快照。
    db.close()
    throw error
  }
}
