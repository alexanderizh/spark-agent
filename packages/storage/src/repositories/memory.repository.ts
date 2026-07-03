/**
 * @module memory.repository
 *
 * Agent Memory Repository — SQLite CRUD for long-term memory entries.
 *
 * 每条记忆由 markdown 文件（人类可读）+ SQLite 索引行组成。
 * 本 Repository 仅管理 SQLite 侧；文件操作由 MemoryStoreService 负责。
 *
 * 三层记忆模型：
 *   - user    : scope_ref = NULL，跨项目复用
 *   - project : scope_ref = workspaceId
 *   - agent   : scope_ref = agentId
 */

import { createLogger } from '@spark/shared'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import { upsertFtsRow, deleteFtsRow, ftsTableExists } from './memory-search.repository.js'

const log = createLogger('storage:memory')

export interface MemoryEntryRow {
  id: string
  scope: 'user' | 'project' | 'agent'
  scope_ref: string | null
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  file_path: string
  confidence: number
  hit_count: number
  last_hit_at: number | null
  source_session_id: string | null
  archived: number
  created_at: number
  updated_at: number
  /** 事实生效时间（bi-temporal，默认 = created_at）。V2 之前的行由 migration 回填。 */
  valid_from: number | null
  /** 事实失效时间；NULL = 仍有效。失效不删文件（M2 演化机制写入）。 */
  invalid_at: number | null
  /** 被哪条记忆取代（memory_entry.id） */
  superseded_by: string | null
}

/** insert 的入参：时间戳与 bi-temporal 列由 repository 自动填充 */
export type MemoryEntryInsert = Omit<
  MemoryEntryRow,
  'created_at' | 'updated_at' | 'valid_from' | 'invalid_at' | 'superseded_by'
> & Partial<Pick<MemoryEntryRow, 'valid_from' | 'invalid_at' | 'superseded_by'>>

export class MemoryRepository extends BaseRepository {
  /** memory_fts 表存在性缓存（migration 未跑到的旧库降级为不维护 FTS） */
  private ftsAvailable: boolean | null = null

  constructor(db: SparkDatabase) {
    super(db, 'memory_entry')
  }

  /**
   * Insert a new memory entry.
   * Timestamps (created_at, updated_at) are auto-set to now; valid_from defaults to now.
   *
   * @param body markdown 正文（仅用于 FTS 索引；正文本体在文件系统）。
   *             与 memory_entry 写入同一事务维护 memory_fts。
   */
  insert(row: MemoryEntryInsert, body?: string): MemoryEntryRow {
    const now = Date.now()
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO memory_entry
           (id, scope, scope_ref, type, name, description, file_path,
            confidence, hit_count, last_hit_at, source_session_id,
            archived, created_at, updated_at, valid_from, invalid_at, superseded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.scope,
          row.scope_ref,
          row.type,
          row.name,
          row.description,
          row.file_path,
          row.confidence,
          row.hit_count,
          row.last_hit_at,
          row.source_session_id,
          row.archived,
          now,
          now,
          row.valid_from ?? now,
          row.invalid_at ?? null,
          row.superseded_by ?? null,
        )
      this.maintainFts('upsert', row.id, {
        name: row.name,
        description: row.description,
        ...(body != null ? { body } : {}),
      })
    })
    tx()
    return this.findById<MemoryEntryRow>(row.id)!
  }

  /**
   * Update specific fields of a memory entry.
   * Always refreshes updated_at.
   */
  update(
    id: string,
    patch: Partial<Omit<MemoryEntryRow, 'id' | 'created_at'>>,
    body?: string,
  ): MemoryEntryRow {
    const existing = this.findById<MemoryEntryRow>(id)
    if (existing == null) throw new Error(`Memory entry not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []

    const updatable = [
      'scope', 'scope_ref', 'type', 'name', 'description', 'file_path',
      'confidence', 'hit_count', 'last_hit_at', 'source_session_id', 'archived',
      'valid_from', 'invalid_at', 'superseded_by',
    ] as const

    for (const key of updatable) {
      if (key in patch) {
        fields.push(`${key} = ?`)
        values.push((patch as Record<string, unknown>)[key])
      }
    }

    if (fields.length === 0) return existing

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    const next = { ...existing, ...patch }
    // 归档或失效 → 从 FTS 移除；否则文本字段有变化（或带了 body）时重建 FTS 行
    const becomesInactive = next.archived === 1 || next.invalid_at != null
    const textChanged =
      body != null ||
      ('name' in patch && patch.name !== existing.name) ||
      ('description' in patch && patch.description !== existing.description)

    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(`UPDATE memory_entry SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values)
      if (becomesInactive) {
        this.maintainFts('delete', id)
      } else if (textChanged) {
        this.maintainFts('upsert', id, {
          name: next.name,
          description: next.description,
          ...(body != null ? { body } : {}),
        })
      }
    })
    tx()

    return this.findById<MemoryEntryRow>(id)!
  }

  /**
   * Get a single entry by id.
   */
  getById(id: string): MemoryEntryRow | null {
    return this.findById<MemoryEntryRow>(id)
  }

  /**
   * Find a non-archived entry by exact (scope, scope_ref, name).
   */
  findByName(scope: string, scopeRef: string | null, name: string): MemoryEntryRow | null {
    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry WHERE scope = ? AND scope_ref IS ? AND name = ? AND archived = 0`,
    )
    return stmt.get(scope, scopeRef, name) as MemoryEntryRow | null
  }

  /**
   * List entries by scope, optionally filtered by type and archived status.
   */
  listByScope(
    scope: string,
    scopeRef: string | null,
    opts?: { type?: string; includeArchived?: boolean },
  ): MemoryEntryRow[] {
    const conditions: string[] = ['scope = ?', 'scope_ref IS ?']
    const values: unknown[] = [scope, scopeRef]

    if (opts?.type) {
      conditions.push('type = ?')
      values.push(opts.type)
    }

    if (!opts?.includeArchived) {
      conditions.push('archived = 0')
    }

    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`,
    )
    return stmt.all(...values) as MemoryEntryRow[]
  }

  /**
   * Increment hit_count and update last_hit_at for an entry.
   */
  bumpHit(id: string): void {
    this.raw
      .prepare(
        `UPDATE memory_entry SET hit_count = hit_count + 1, last_hit_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), id)
  }

  /**
   * Archive an entry (soft delete)。同一事务内从 memory_fts 移除。
   */
  archive(id: string): void {
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(`UPDATE memory_entry SET archived = 1, updated_at = ? WHERE id = ?`)
        .run(Date.now(), id)
      this.maintainFts('delete', id)
    })
    tx()
  }

  /**
   * Permanently delete an entry。同一事务内从 memory_fts 移除。
   * （FTS 行删除必须先于 memory_entry 行删除，rowid 映射依赖该行存在。）
   */
  delete(id: string): void {
    const tx = this.raw.transaction(() => {
      this.maintainFts('delete', id)
      this.raw.prepare(`DELETE FROM memory_entry WHERE id = ?`).run(id)
    })
    tx()
  }

  /**
   * Count non-archived entries in a given scope.
   */
  countByScope(scope: string, scopeRef: string | null): number {
    const stmt = this.raw.prepare(
      `SELECT COUNT(*) as count FROM memory_entry WHERE scope = ? AND scope_ref IS ? AND archived = 0`,
    )
    const row = stmt.get(scope, scopeRef) as { count: number }
    return row.count
  }

  /**
   * Find entries eligible for eviction (lowest score first) in a scope.
   * Score = hit_count * 0.5 + recency(0~1) * 0.3 + confidence * 0.2
   */
  findEvictionCandidates(scope: string, scopeRef: string | null, limit: number): MemoryEntryRow[] {
    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry
       WHERE scope = ? AND scope_ref IS ? AND archived = 0
       ORDER BY (hit_count * 0.5 + (1.0 - ((? - COALESCE(updated_at, created_at)) / 86400000.0)) * 0.3 + confidence * 0.2) ASC
       LIMIT ?`,
    )
    return stmt.all(scope, scopeRef, Date.now(), limit) as MemoryEntryRow[]
  }

  // ─── FTS 同步维护 ──────────────────────────────────────────────────────

  /**
   * 在写路径事务内维护 memory_fts。
   *
   * 降级策略：FTS 表不存在（旧库未跑 042 migration）时静默跳过；
   * FTS 操作抛错只 log 不上抛 —— 记忆主行写入永远优先于索引一致性
   * （索引可通过 backfill 重建，主数据不能丢）。
   */
  private maintainFts(
    op: 'upsert' | 'delete',
    entryId: string,
    fields?: { name: string; description: string; body?: string },
  ): void {
    try {
      if (this.ftsAvailable == null) this.ftsAvailable = ftsTableExists(this.raw)
      if (!this.ftsAvailable) return
      if (op === 'upsert' && fields != null) {
        upsertFtsRow(this.raw, entryId, fields)
      } else if (op === 'delete') {
        deleteFtsRow(this.raw, entryId)
      }
    } catch (err) {
      log.warn(`memory_fts maintenance failed (${op} ${entryId}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
