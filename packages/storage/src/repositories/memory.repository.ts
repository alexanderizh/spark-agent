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

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

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
}

export class MemoryRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'memory_entry')
  }

  /**
   * Insert a new memory entry.
   * Timestamps (created_at, updated_at) are auto-set to now.
   */
  insert(row: Omit<MemoryEntryRow, 'created_at' | 'updated_at'>): MemoryEntryRow {
    const now = Date.now()
    this.raw
      .prepare(
        `INSERT INTO memory_entry
         (id, scope, scope_ref, type, name, description, file_path,
          confidence, hit_count, last_hit_at, source_session_id,
          archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
    return this.findById<MemoryEntryRow>(row.id)!
  }

  /**
   * Update specific fields of a memory entry.
   * Always refreshes updated_at.
   */
  update(id: string, patch: Partial<Omit<MemoryEntryRow, 'id' | 'created_at'>>): MemoryEntryRow {
    const existing = this.findById<MemoryEntryRow>(id)
    if (existing == null) throw new Error(`Memory entry not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []

    const updatable = [
      'scope', 'scope_ref', 'type', 'name', 'description', 'file_path',
      'confidence', 'hit_count', 'last_hit_at', 'source_session_id', 'archived',
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

    this.raw
      .prepare(`UPDATE memory_entry SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values)

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
   * Archive an entry (soft delete).
   */
  archive(id: string): void {
    this.raw
      .prepare(`UPDATE memory_entry SET archived = 1, updated_at = ? WHERE id = ?`)
      .run(Date.now(), id)
  }

  /**
   * Permanently delete an entry.
   */
  delete(id: string): void {
    this.raw.prepare(`DELETE FROM memory_entry WHERE id = ?`).run(id)
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
}
