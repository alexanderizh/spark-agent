/**
 * @module scheduled-task.repository
 *
 * 定时任务数据仓库
 *
 * 负责 scheduled_tasks 表的 CRUD 操作，
 * 包括触发时间计算、到期任务查询、执行计数更新等。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

// ─── Row Types ──────────────────────────────────────────────────────────────

export interface ScheduledTaskRow {
  id: string
  name: string
  description: string
  enabled: number
  scope: 'global' | 'session'
  session_id: string | null
  paused_by_archive: number
  trigger_type: 'interval' | 'cron' | 'once'
  interval_seconds: number | null
  cron_expression: string | null
  run_at: string | null
  timezone: string
  start_at: string | null
  end_at: string | null
  max_executions: number
  agent_id: string | null
  team_id: string | null
  model_id: string | null
  workspace_id: string | null
  prompt_template: string
  permission_mode: string
  permission_profile_id: string | null
  timeout_seconds: number
  max_retries: number
  retry_delay_seconds: number
  retry_backoff: 'fixed' | 'linear' | 'exponential'
  notifications: string
  concurrency_policy: 'skip' | 'queue' | 'cancel'
  tags: string
  history_retention_days: number
  status: 'idle' | 'running' | 'disabled' | 'error'
  execution_count: number
  success_count: number
  failure_count: number
  last_run_at: string | null
  next_run_at: string | null
  last_error: string | null
  current_execution_id: string | null
  created_at: string
  updated_at: string
}

export interface CreateScheduledTaskParams {
  id: string
  name: string
  description?: string
  enabled?: boolean
  scope?: 'global' | 'session'
  session_id?: string | null
  paused_by_archive?: boolean
  trigger_type: 'interval' | 'cron' | 'once'
  interval_seconds?: number | null
  cron_expression?: string | null
  run_at?: string | null
  timezone?: string
  start_at?: string | null
  end_at?: string | null
  max_executions?: number
  agent_id?: string | null
  team_id?: string | null
  model_id?: string | null
  workspace_id?: string | null
  prompt_template: string
  permission_mode?: string
  permission_profile_id?: string | null
  timeout_seconds?: number
  max_retries?: number
  retry_delay_seconds?: number
  retry_backoff?: 'fixed' | 'linear' | 'exponential'
  notifications?: unknown[]
  concurrency_policy?: 'skip' | 'queue' | 'cancel'
  tags?: string[]
  history_retention_days?: number
  next_run_at?: string | null
}

export type UpdateScheduledTaskParams = Partial<CreateScheduledTaskParams> & {
  status?: ScheduledTaskRow['status']
  last_error?: string | null
}

export interface ScheduledTaskFilter {
  status?: string
  enabled?: boolean
  tags?: string[]
  query?: string
  scope?: 'global' | 'session'
  sessionId?: string
}

// ─── Repository ─────────────────────────────────────────────────────────────

export class ScheduledTaskRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'scheduled_tasks')
  }

  ensureSchema(): void {
    // Tables are created via migration 024; this method is a no-op.
    // Kept for consistency with the BaseRepository pattern.
  }

  /**
   * 根据 ID 查找任务
   */
  get(id: string): ScheduledTaskRow | null {
    return super.findById<ScheduledTaskRow>(id)
  }

  /**
   * 查询所有任务（支持过滤）
   */
  listAll(filter?: ScheduledTaskFilter): ScheduledTaskRow[] {
    if (!filter || Object.keys(filter).length === 0) {
      const stmt = this.raw.prepare(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`)
      return stmt.all() as ScheduledTaskRow[]
    }

    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.enabled !== undefined) {
      conditions.push('enabled = ?')
      params.push(filter.enabled ? 1 : 0)
    }
    if (filter.scope !== undefined) {
      conditions.push('scope = ?')
      params.push(filter.scope)
    }
    if (filter.sessionId !== undefined) {
      conditions.push('session_id = ?')
      params.push(filter.sessionId)
    }
    if (filter.status) {
      conditions.push('status = ?')
      params.push(filter.status)
    }
    if (filter.query) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.query}%`, `%${filter.query}%`)
    }
    if (filter.tags && filter.tags.length > 0) {
      // Tags stored as JSON array — check each tag with LIKE
      const tagConditions = filter.tags.map(() => `tags LIKE ?`)
      conditions.push(`(${tagConditions.join(' AND ')})`)
      filter.tags.forEach((tag) => params.push(`%"${tag}"%`))
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const stmt = this.raw.prepare(`SELECT * FROM scheduled_tasks ${where} ORDER BY created_at DESC`)
    return stmt.all(...params) as ScheduledTaskRow[]
  }

  /**
   * 创建新任务
   */
  create(params: CreateScheduledTaskParams): ScheduledTaskRow {
    this.raw
      .prepare(
        `
      INSERT INTO scheduled_tasks (
        id, name, description, enabled, scope, session_id, paused_by_archive,
        trigger_type, interval_seconds, cron_expression, run_at, timezone,
        start_at, end_at, max_executions,
        agent_id, team_id, model_id, workspace_id,
        prompt_template, permission_mode, permission_profile_id, timeout_seconds,
        max_retries, retry_delay_seconds, retry_backoff,
        notifications, concurrency_policy, tags, history_retention_days,
        status, next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        params.id,
        params.name,
        params.description ?? '',
        params.enabled !== false ? 1 : 0,
        params.scope ?? 'global',
        params.session_id ?? null,
        params.paused_by_archive === true ? 1 : 0,
        params.trigger_type,
        params.interval_seconds ?? null,
        params.cron_expression ?? null,
        params.run_at ?? null,
        params.timezone ?? 'system',
        params.start_at ?? null,
        params.end_at ?? null,
        params.max_executions ?? 0,
        params.agent_id ?? null,
        params.team_id ?? null,
        params.model_id ?? null,
        params.workspace_id ?? null,
        params.prompt_template,
        params.permission_mode ?? 'auto',
        params.permission_profile_id ?? null,
        params.timeout_seconds ?? 300,
        params.max_retries ?? 0,
        params.retry_delay_seconds ?? 60,
        params.retry_backoff ?? 'fixed',
        this.toJson(params.notifications ?? []),
        params.concurrency_policy ?? 'skip',
        this.toJson(params.tags ?? []),
        params.history_retention_days ?? 30,
        params.enabled !== false ? 'idle' : 'disabled',
        params.next_run_at ?? null,
      )
    return this.get(params.id)!
  }

  /**
   * 更新任务配置
   */
  update(id: string, params: UpdateScheduledTaskParams): ScheduledTaskRow | null {
    const task = this.get(id)
    if (!task) return null

    const sets: string[] = []
    const values: unknown[] = []

    const fieldMap: Record<string, unknown> = {
      name: params.name,
      description: params.description,
      enabled: params.enabled !== undefined ? (params.enabled ? 1 : 0) : undefined,
      scope: params.scope,
      session_id: params.session_id,
      paused_by_archive:
        params.paused_by_archive !== undefined ? (params.paused_by_archive ? 1 : 0) : undefined,
      trigger_type: params.trigger_type,
      interval_seconds: params.interval_seconds,
      cron_expression: params.cron_expression,
      run_at: params.run_at,
      timezone: params.timezone,
      start_at: params.start_at,
      end_at: params.end_at,
      max_executions: params.max_executions,
      agent_id: params.agent_id,
      team_id: params.team_id,
      model_id: params.model_id,
      workspace_id: params.workspace_id,
      prompt_template: params.prompt_template,
      permission_mode: params.permission_mode,
      permission_profile_id: params.permission_profile_id,
      timeout_seconds: params.timeout_seconds,
      max_retries: params.max_retries,
      retry_delay_seconds: params.retry_delay_seconds,
      retry_backoff: params.retry_backoff,
      concurrency_policy: params.concurrency_policy,
      history_retention_days: params.history_retention_days,
      next_run_at: params.next_run_at,
      status: params.status,
      last_error: params.last_error,
    }

    // Handle JSON fields separately
    if (params.notifications !== undefined) {
      sets.push('notifications = ?')
      values.push(this.toJson(params.notifications))
    }
    if (params.tags !== undefined) {
      sets.push('tags = ?')
      values.push(this.toJson(params.tags))
    }

    for (const [col, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        sets.push(`${col} = ?`)
        values.push(val)
      }
    }

    if (sets.length === 0) return task

    sets.push("updated_at = datetime('now')")
    values.push(id)

    this.raw.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    return this.get(id)
  }

  /**
   * 更新任务运行状态
   */
  updateStatus(id: string, status: ScheduledTaskRow['status'], nextRunAt?: string | null): void {
    const sets = ['status = ?', "updated_at = datetime('now')"]
    const values: unknown[] = [status]

    if (nextRunAt !== undefined) {
      sets.push('next_run_at = ?')
      values.push(nextRunAt)
    }

    values.push(id)
    this.raw.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  /**
   * 原子递增执行计数
   */
  incrementExecutionCount(id: string, success: boolean): void {
    this.raw
      .prepare(
        `
      UPDATE scheduled_tasks
      SET execution_count = execution_count + 1,
          ${success ? 'success_count = success_count + 1' : 'failure_count = failure_count + 1'},
          last_run_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(id)
  }

  /**
   * 查询当前需要执行的任务
   */
  findDueTasks(): ScheduledTaskRow[] {
    return this.raw
      .prepare(
        `
      SELECT * FROM scheduled_tasks
      WHERE enabled = 1
        AND status IN ('idle', 'error')
        AND next_run_at IS NOT NULL
        AND next_run_at <= datetime('now')
        AND (start_at IS NULL OR start_at <= datetime('now'))
        AND (end_at IS NULL OR end_at > datetime('now'))
        AND (max_executions = 0 OR execution_count < max_executions)
      ORDER BY next_run_at ASC
    `,
      )
      .all() as ScheduledTaskRow[]
  }

  /** Session tasks that became overdue while the desktop process was not running. */
  listOverdueSessionTasks(nowSql: string): ScheduledTaskRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM scheduled_tasks
         WHERE scope = 'session'
           AND enabled = 1
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(nowSql) as ScheduledTaskRow[]
  }

  /** Recover session executions left running when the desktop process terminated. */
  recoverInterruptedSessionTasks(): number {
    const recover = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE task_executions
           SET status = 'failed',
               completed_at = datetime('now'),
               error = COALESCE(error, 'Execution interrupted by application shutdown')
           WHERE status = 'running'
             AND task_id IN (
               SELECT id FROM scheduled_tasks WHERE scope = 'session'
             )`,
        )
        .run()

      return this.raw
        .prepare(
          `UPDATE scheduled_tasks
           SET status = CASE WHEN enabled = 1 THEN 'idle' ELSE 'disabled' END,
               current_execution_id = NULL,
               last_error = 'Execution interrupted by application shutdown',
               updated_at = datetime('now')
           WHERE scope = 'session'
             AND (status = 'running' OR current_execution_id IS NOT NULL)`,
        )
        .run().changes
    })
    return recover()
  }

  /** Pause only tasks that were enabled immediately before their session was archived. */
  pauseEnabledBySession(sessionId: string): number {
    return this.raw
      .prepare(
        `UPDATE scheduled_tasks
         SET enabled = 0,
             status = 'disabled',
             next_run_at = NULL,
             paused_by_archive = 1,
             updated_at = datetime('now')
         WHERE scope = 'session' AND session_id = ? AND enabled = 1`,
      )
      .run(sessionId).changes
  }

  listArchivePausedBySession(sessionId: string): ScheduledTaskRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM scheduled_tasks
         WHERE scope = 'session' AND session_id = ? AND paused_by_archive = 1
         ORDER BY created_at ASC`,
      )
      .all(sessionId) as ScheduledTaskRow[]
  }

  markRestoredFromArchive(id: string, nextRunAt: string | null): void {
    this.raw
      .prepare(
        `UPDATE scheduled_tasks
         SET enabled = 1,
             status = 'idle',
             next_run_at = ?,
             paused_by_archive = 0,
             last_error = NULL,
             updated_at = datetime('now')
         WHERE id = ? AND paused_by_archive = 1`,
      )
      .run(nextRunAt, id)
  }

  /**
   * 设置当前执行 ID
   */
  setCurrentExecution(id: string, executionId: string | null): void {
    this.raw
      .prepare(
        `
      UPDATE scheduled_tasks
      SET current_execution_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(executionId, id)
  }

  /**
   * 设置 last error
   */
  setLastError(id: string, error: string | null): void {
    this.raw
      .prepare(
        `
      UPDATE scheduled_tasks
      SET last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(error, id)
  }

  /**
   * 根据 ID 删除任务
   */
  override deleteById(id: string): boolean {
    // CASCADE will delete related task_executions
    return super.deleteById(id)
  }

  /**
   * 统计任务数量
   */
  countByStatus(): { enabled: number; disabled: number; total: number } {
    const row = this.raw
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled,
        SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as disabled
      FROM scheduled_tasks
    `,
      )
      .get() as { total: number; enabled: number; disabled: number }
    return row
  }
}
