/**
 * @module base.repository
 *
 * Repository 基类 — 所有具体 Repository 的公共父类
 *
 * 设计原则：
 *   - 每个 Repository 对应一张 SQLite 表
 *   - 所有 SQL 通过 prepared statement 执行，禁止字符串拼接
 *   - Repository 不持有数据库连接，每次操作通过引用获取
 *   - JSON 字段的序列化/反序列化由 Repository 负责
 */

import type { SparkDatabase, SqliteDatabase } from '../database.js'

export type { SqliteDatabase }

/**
 * Repository 基类
 *
 * 提供通用的 CRUD 操作模板，子类通过指定表名和字段映射来复用
 */
export abstract class BaseRepository {
  constructor(
    protected readonly db: SparkDatabase,
    protected readonly tableName: string,
  ) {}

  /**
   * 获取原始 better-sqlite3 实例
   */
  protected get raw(): SqliteDatabase {
    return this.db.raw
  }

  /**
   * 根据 ID 查找单条记录
   */
  protected findById<T>(id: string): T | null {
    const stmt = this.raw.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
    const row = stmt.get(id) as T | undefined
    return row ?? null
  }

  /**
   * 查找表中所有记录（带可选 limit）
   */
  protected findAll<T>(limit = 100, offset = 0): T[] {
    const stmt = this.raw.prepare(`SELECT * FROM ${this.tableName} LIMIT ? OFFSET ?`)
    return stmt.all(limit, offset) as T[]
  }

  /**
   * 根据 ID 删除记录
   */
  protected deleteById(id: string): boolean {
    const stmt = this.raw.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * 统计表中记录总数
   */
  protected count(): number {
    const stmt = this.raw.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`)
    const row = stmt.get() as { count: number }
    return row.count
  }

  /**
   * 安全地将对象序列化为 JSON 字符串
   *
   * 用于 SQLite 中 JSON 字段的写入
   */
  protected toJson(value: unknown): string {
    return JSON.stringify(value)
  }

  /**
   * 安全地从 JSON 字符串反序列化为对象
   *
   * 处理 null/undefined/空字符串等边界情况
   */
  protected fromJson<T>(json: string | null | undefined, fallback: T): T {
    if (json == null || json === '') return fallback
    try {
      return JSON.parse(json) as T
    } catch {
      return fallback
    }
  }
}
