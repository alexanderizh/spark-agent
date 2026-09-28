/**
 * @module memory-operation.repository
 *
 * 记忆删除协调操作 repository（S1B.4）—— memory_operation 表的 CRUD。
 *
 * 删除/归档的协调流程与重试语义见 memory-lifecycle.service.ts；本模块只做
 * 持久化访问。状态机：pending → barrier_set → cleaning →
 * local_purge_complete / sync_pending / failed（终态）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type MemoryOperationKind = 'delete' | 'archive' | 'purge_orphan'

export type MemoryOperationStatus =
  | 'pending'
  | 'barrier_set'
  | 'cleaning'
  | 'local_purge_complete'
  | 'sync_pending'
  | 'failed'

/** 终态集合：重启恢复只重试 status NOT IN 终态 的记录 */
const TERMINAL_STATUSES: readonly MemoryOperationStatus[] = [
  'local_purge_complete',
  'sync_pending',
  'failed',
]

export interface MemoryOperationRow {
  id: string
  kind: MemoryOperationKind
  target_id: string
  target_version: number | null
  status: MemoryOperationStatus
  targets_json: string
  created_at: number
  updated_at: number
  last_error: string | null
}

export interface InsertMemoryOperationParams {
  id: string
  kind: MemoryOperationKind
  targetId: string
  targetVersion: number | null
  targetsJson: string
}

export class MemoryOperationRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'memory_operation')
  }

  insert(params: InsertMemoryOperationParams): MemoryOperationRow {
    const now = Date.now()
    this.raw
      .prepare(
        `INSERT INTO memory_operation
           (id, kind, target_id, target_version, status, targets_json, created_at, updated_at, last_error)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, NULL)`,
      )
      .run(
        params.id,
        params.kind,
        params.targetId,
        params.targetVersion,
        params.targetsJson,
        now,
        now,
      )
    return this.getById(params.id)!
  }

  getById(id: string): MemoryOperationRow | null {
    return (
      (this.raw.prepare('SELECT * FROM memory_operation WHERE id = ?').get(id) as
        | MemoryOperationRow
        | undefined) ?? null
    )
  }

  /** 目标的最近一次操作记录（重复删除/归档时查已有意图） */
  getLatestByTarget(targetId: string): MemoryOperationRow | null {
    return (
      (this.raw
        .prepare(
          'SELECT * FROM memory_operation WHERE target_id = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(targetId) as MemoryOperationRow | undefined) ?? null
    )
  }

  /** 非终态记录（重启恢复 / UI 待清理展示） */
  listUnfinished(): MemoryOperationRow[] {
    const placeholders = TERMINAL_STATUSES.map(() => '?').join(', ')
    return this.raw
      .prepare(
        `SELECT * FROM memory_operation WHERE status NOT IN (${placeholders}) ORDER BY created_at`,
      )
      .all(...TERMINAL_STATUSES) as MemoryOperationRow[]
  }

  /** 失败记录（UI 重试入口） */
  listFailed(): MemoryOperationRow[] {
    return this.raw
      .prepare(`SELECT * FROM memory_operation WHERE status = 'failed' ORDER BY created_at`)
      .all() as MemoryOperationRow[]
  }

  updateStatus(id: string, status: MemoryOperationStatus, lastError: string | null = null): void {
    this.raw
      .prepare(
        `UPDATE memory_operation
         SET status = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, lastError, Date.now(), id)
  }
}
