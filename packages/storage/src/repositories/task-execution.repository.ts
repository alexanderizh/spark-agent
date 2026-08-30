/**
 * @module task-execution.repository
 *
 * 定时任务执行记录数据仓库
 *
 * 负责 task_executions 表的 CRUD 操作，
 * 包括分页查询、状态更新、统计聚合等。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

// ─── Row Types ──────────────────────────────────────────────────────────────

export interface TaskExecutionRow {
  id: string
  task_id: string
  session_id: string | null
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
  output: string | null
  error: string | null
  token_usage: string | null
  retry_attempt: number
  parent_execution_id: string | null
  trigger_type: 'scheduled' | 'manual' | 'retry' | null
  created_at: string
}

export interface CreateTaskExecutionParams {
  id: string
  task_id: string
  session_id?: string | null
  trigger_type?: 'scheduled' | 'manual' | 'retry'
  retry_attempt?: number
  parent_execution_id?: string | null
}

export interface ExecutionQueryOptions {
  page?: number
  pageSize?: number
  status?: string
}

export interface ExecutionStats {
  total: number
  completed: number
  failed: number
  avgDurationMs: number | null
  totalTokenUsage: number
}

// ─── Repository ─────────────────────────────────────────────────────────────

export class TaskExecutionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'task_executions')
  }

  ensureSchema(): void {
    // Tables are created via migration 024; this method is a no-op.
  }

  /**
   * 创建执行记录
   */
  create(params: CreateTaskExecutionParams): TaskExecutionRow {
    this.raw.prepare(`
      INSERT INTO task_executions (id, task_id, session_id, trigger_type, retry_attempt, parent_execution_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      params.id,
      params.task_id,
      params.session_id ?? null,
      params.trigger_type ?? 'scheduled',
      params.retry_attempt ?? 0,
      params.parent_execution_id ?? null,
    )
    return this.get(params.id)!
  }

  /**
   * 根据 ID 查找执行记录
   */
  get(id: string): TaskExecutionRow | null {
    return super.findById<TaskExecutionRow>(id)
  }

  /**
   * 分页查询某任务的执行记录
   */
  findByTaskId(taskId: string, options?: ExecutionQueryOptions): { executions: TaskExecutionRow[]; total: number } {
    const page = options?.page ?? 1
    const pageSize = options?.pageSize ?? 20
    const offset = (page - 1) * pageSize

    let countSql = `SELECT COUNT(*) as total FROM task_executions WHERE task_id = ?`
    let querySql = `SELECT * FROM task_executions WHERE task_id = ?`
    const params: unknown[] = [taskId]

    if (options?.status) {
      countSql += ` AND status = ?`
      querySql += ` AND status = ?`
      params.push(options.status)
    }

    querySql += ` ORDER BY started_at DESC LIMIT ? OFFSET ?`

    const totalRow = this.raw.prepare(countSql).get(...params) as { total: number }
    const executions = this.raw.prepare(querySql).all(...params, pageSize, offset) as TaskExecutionRow[]

    return { executions, total: totalRow.total }
  }

  /**
   * 查询某任务正在运行的执行
   */
  findRunningByTaskId(taskId: string): TaskExecutionRow[] {
    return this.raw.prepare(
      `SELECT * FROM task_executions WHERE task_id = ? AND status = 'running' ORDER BY started_at DESC`
    ).all(taskId) as TaskExecutionRow[]
  }

  /**
   * 更新执行状态
   */
  updateStatus(id: string, status: TaskExecutionRow['status'], params?: {
    completedAt?: string | undefined
    durationMs?: number | undefined
    output?: string | undefined
    error?: string | undefined
    tokenUsage?: unknown | undefined
    sessionId?: string | undefined
  }): void {
    const sets: string[] = ['status = ?']
    const values: unknown[] = [status]

    if (params?.completedAt !== undefined) {
      sets.push('completed_at = ?')
      values.push(params.completedAt)
    }
    if (params?.durationMs !== undefined) {
      sets.push('duration_ms = ?')
      values.push(params.durationMs)
    }
    if (params?.output !== undefined) {
      sets.push('output = ?')
      values.push(params.output)
    }
    if (params?.error !== undefined) {
      sets.push('error = ?')
      values.push(params.error)
    }
    if (params?.tokenUsage !== undefined) {
      sets.push('token_usage = ?')
      values.push(this.toJson(params.tokenUsage))
    }
    if (params?.sessionId !== undefined) {
      sets.push('session_id = ?')
      values.push(params.sessionId)
    }

    values.push(id)
    this.raw.prepare(
      `UPDATE task_executions SET ${sets.join(', ')} WHERE id = ?`
    ).run(...values)
  }

  /**
   * 聚合统计
   */
  getStats(taskId: string): ExecutionStats {
    const row = this.raw.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status IN ('failed', 'timeout') THEN 1 ELSE 0 END) as failed,
        AVG(CASE WHEN duration_ms IS NOT NULL AND status = 'completed' THEN duration_ms END) as avgDurationMs,
        0 as totalTokenUsage
      FROM task_executions
      WHERE task_id = ?
    `).get(taskId) as { total: number; completed: number; failed: number; avgDurationMs: number | null; totalTokenUsage: number }
    return row
  }

  /**
   * 清理过期执行记录
   */
  cleanupOlderThan(taskId: string, days: number): number {
    const result = this.raw.prepare(`
      DELETE FROM task_executions
      WHERE task_id = ?
        AND status != 'running'
        AND completed_at < datetime('now', ? || ' days')
    `).run(taskId, `-${days}`)
    return result.changes
  }

  /**
   * 根据 ID 删除
   */
  override deleteById(id: string): boolean {
    return super.deleteById(id)
  }
}
