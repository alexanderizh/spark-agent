/**
 * @module scheduled-task.service
 *
 * 定时任务服务 + 调度引擎
 *
 * 职责：
 *   - 定时任务的 CRUD 操作
 *   - 调度器主循环（tick-based 轮询）
 *   - 任务执行（创建 Session → 发送 Prompt → 等待完成）
 *   - 失败重试策略
 *   - Webhook 通知
 */

import type { ScheduledTaskRepository, TaskExecutionRepository } from '@spark/storage'
import type { ScheduledTaskRow, TaskExecutionRow } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { CronExpressionParser } from 'cron-parser'
import {
  SCHEDULED_TASK_EXPORT_VERSION,
  type ScheduledTaskExportPayload,
  type ScheduledTaskExportTask,
  type ScheduledTaskImportMode,
  type ScheduledTaskImportResult,
} from '@spark/protocol'

const log = createLogger('scheduled-task:service')
const SESSION_TASK_RETRY_DELAY_MS = 60_000

// ─── Types ──────────────────────────────────────────────────────────────────

export type TriggerType = 'interval' | 'cron' | 'once'
export type TaskScope = 'global' | 'session'
export type ConcurrencyPolicy = 'skip' | 'queue' | 'cancel'
export type RetryBackoff = 'fixed' | 'linear' | 'exponential'
export type TaskStatus = 'idle' | 'running' | 'disabled' | 'error'
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export interface ScheduledTaskItem {
  id: string
  name: string
  description: string
  enabled: boolean
  scope: TaskScope
  sessionId: string | null
  pausedByArchive: boolean
  skipIfSessionRunning: boolean
  continueOnError: boolean
  triggerType: TriggerType
  intervalSeconds: number | null
  cronExpression: string | null
  runAt: string | null
  timezone: string
  startAt: string | null
  endAt: string | null
  maxExecutions: number
  agentId: string | null
  teamId: string | null
  modelId: string | null
  workspaceId: string | null
  promptTemplate: string
  permissionMode: string
  permissionProfileId: string | null
  timeoutSeconds: number
  maxRetries: number
  retryDelaySeconds: number
  retryBackoff: RetryBackoff
  notifications: NotificationConfig[]
  concurrencyPolicy: ConcurrencyPolicy
  tags: string[]
  historyRetentionDays: number
  status: TaskStatus
  executionCount: number
  successCount: number
  failureCount: number
  lastRunAt: string | null
  nextRunAt: string | null
  lastError: string | null
  currentExecutionId: string | null
  createdAt: string
  updatedAt: string
}

export interface NotificationConfig {
  id: string
  url: string
  triggers: ('onSuccess' | 'onFailure' | 'onRetry' | 'onDisabled')[]
  headers?: Record<string, string>
  bodyTemplate?: string
}

export interface TaskExecutionItem {
  id: string
  taskId: string
  sessionId: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  status: ExecutionStatus
  output: string | null
  error: string | null
  tokenUsage: unknown | null
  retryAttempt: number
  parentExecutionId: string | null
  triggerType: string | null
  createdAt: string
}

export interface ExecutionStats {
  total: number
  completed: number
  failed: number
  avgDurationMs: number | null
  totalTokenUsage: number
}

export type TaskExecutorFn = (params: {
  sessionId?: string | null
  agentId?: string | null
  teamId?: string | null
  modelId?: string | null
  workspaceId?: string | null
  promptTemplate: string
  /** User-authored task body shown in chat; promptTemplate also contains scheduler context. */
  userMessageDisplayContent: string
  permissionMode?: string
  timeoutSeconds?: number
  taskName: string
  /**
   * 会话创建完成后立即触发的回调（在等待 turn 完成之前）。
   * 用于让上层（runNow / scheduler tick）尽早拿到 sessionId，
   * 以便 UI 跳转到刚创建的会话；turn 仍在后台异步运行。
   */
  onSessionCreated?: (sessionId: string) => void
}) => Promise<{ sessionId?: string; output?: string; error?: string; tokenUsage?: unknown }>

export interface SessionTaskRuntimeState {
  /** True while the session has an active or queued turn. */
  running: boolean
  /** Persisted session status, including `error` after a failed turn. */
  status: string
}

export type SessionTaskStateReadResult =
  | (SessionTaskRuntimeState & { kind: 'available' })
  | { kind: 'missing' }
  | { kind: 'unavailable'; error: string }

export type SessionTaskStateReader = (sessionId: string) => SessionTaskStateReadResult

// ─── Service ────────────────────────────────────────────────────────────────

export class ScheduledTaskService {
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  private executorFn: TaskExecutorFn | null = null
  private sessionTaskStateReader: SessionTaskStateReader | null = null
  /**
   * runNow 用：executionId → 等待 sessionId 的 resolver。
   * 当 executor 通过 onSessionCreated 回调上报 sessionId 时触发。
   */
  private runNowSessionResolvers = new Map<string, (sessionId: string) => void>()

  constructor(
    private readonly taskRepo: ScheduledTaskRepository,
    private readonly executionRepo: TaskExecutionRepository,
  ) {}

  /**
   * 注入任务执行函数（由 IPC 层注入，调用 SessionService）
   */
  setExecutor(fn: TaskExecutorFn): void {
    this.executorFn = fn
  }

  /**
   * Inject the live session state reader used by session-scoped schedules.
   * Keeping this callback at the desktop boundary avoids coupling the scheduler
   * to SessionService while still allowing it to see queued turns, not only task
   * execution records.
   */
  setSessionTaskStateReader(reader: SessionTaskStateReader | null): void {
    this.sessionTaskStateReader = reader
  }

  /**
   * Pause enabled session tasks as soon as the bound session reports a failed
   * turn. The scheduler tick keeps the persisted-status fallback for errors
   * that happened before the service was initialized or while it was offline.
   */
  handleSessionError(sessionId: string, errorMessage?: string): void {
    for (const task of this.taskRepo.listAll({
      scope: 'session',
      sessionId,
      enabled: true,
    })) {
      if (task.continue_on_error === 0) {
        this.pauseSessionTaskAfterError(task, errorMessage)
      }
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  listTasks(filter?: {
    status?: string
    enabled?: boolean
    tags?: string[]
    query?: string
    scope?: TaskScope
    sessionId?: string
  }): ScheduledTaskItem[] {
    const rows = this.taskRepo.listAll(filter)
    return rows.map(toTaskItem)
  }

  getTask(id: string): ScheduledTaskItem | null {
    const row = this.taskRepo.get(id)
    return row ? toTaskItem(row) : null
  }

  createTask(
    params: Omit<
      ScheduledTaskRow,
      | 'status'
      | 'execution_count'
      | 'success_count'
      | 'failure_count'
      | 'last_run_at'
      | 'next_run_at'
      | 'last_error'
      | 'current_execution_id'
      | 'created_at'
      | 'updated_at'
    > & {
      id: string
      name: string
      trigger_type: TriggerType
      prompt_template: string
    },
  ): ScheduledTaskItem {
    const scope = params.scope ?? 'global'
    if (scope === 'session' && !params.session_id) {
      throw new Error('Session-scoped scheduled tasks require a sessionId')
    }
    if (scope === 'global' && params.session_id) {
      throw new Error('Global scheduled tasks cannot be bound to a session')
    }
    if (scope === 'session') validateSessionTaskDefinition(params)
    const nextRunAt = this.calculateNextRunAt(params as unknown as ScheduledTaskRow)
    const row = this.taskRepo.create({
      ...params,
      next_run_at: nextRunAt,
    } as any)
    return toTaskItem(row)
  }

  updateTask(id: string, params: Record<string, unknown>): ScheduledTaskItem | null {
    if ('scope' in params || 'session_id' in params) {
      throw new Error('Scheduled task scope and session binding cannot be changed')
    }
    const existing = this.taskRepo.get(id)
    if (existing?.scope === 'session') {
      validateSessionTaskDefinition({ ...existing, ...params } as ScheduledTaskRow)
    }
    const updated = this.taskRepo.update(id, params as any)
    if (!updated) return null

    // Recalculate nextRunAt if trigger config changed
    const triggerFields = [
      'trigger_type',
      'interval_seconds',
      'cron_expression',
      'run_at',
      'start_at',
      'end_at',
      'enabled',
    ]
    const shouldRecalc = triggerFields.some((f) => f in params)
    if (shouldRecalc && updated.enabled) {
      const nextRunAt = this.calculateNextRunAt(updated)
      this.taskRepo.update(id, { next_run_at: nextRunAt } as any)
      const refreshed = this.taskRepo.get(id)
      return refreshed ? toTaskItem(refreshed) : null
    }

    return toTaskItem(updated)
  }

  deleteTask(id: string): boolean {
    return this.taskRepo.deleteById(id)
  }

  // ─── Import/Export ────────────────────────────────────────────────────────

  /**
   * 导出任务为 ExportPayload。
   *
   * - ids 为空数组表示导出全部
   * - 不包含运行时统计字段（executionCount/successCount/...）和 createdAt/updatedAt
   */
  exportTasks(ids: string[] = []): ScheduledTaskExportPayload {
    const rows = this.taskRepo.listAll({ scope: 'global' })
    const idSet = ids.length > 0 ? new Set(ids) : null
    const tasks: ScheduledTaskExportTask[] = []
    for (const row of rows) {
      if (idSet !== null && !idSet.has(row.id)) continue
      tasks.push(rowToExportTask(row))
    }
    return {
      version: SCHEDULED_TASK_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: 'spark-agent',
      tasks,
    }
  }

  /**
   * 导入 ExportPayload 到数据库。
   *
   * - 模式 merge：按 name 去重，已存在则跳过（计入 skipped）
   * - 模式 replace：按 name 去重，已存在则更新（保留运行时统计 status/nextRunAt/executionCount/...）
   * - 单个任务失败不中断整体流程；错误累加到 errors
   */
  async importTasks(
    payload: ScheduledTaskExportPayload,
    mode: ScheduledTaskImportMode,
  ): Promise<ScheduledTaskImportResult> {
    const result: ScheduledTaskImportResult = { imported: 0, skipped: 0, errors: [] }
    if (payload.tasks.length === 0) return result

    const existing = new Map<string, ScheduledTaskRow>()
    for (const row of this.taskRepo.listAll({ scope: 'global' })) {
      existing.set(row.name, row)
    }

    for (const task of payload.tasks) {
      try {
        const match = existing.get(task.name)
        if (match != null) {
          if (mode === 'merge') {
            result.skipped += 1
            continue
          }
          // replace: 更新已存在任务
          // 不重置 enabled（尊重用户的启用偏好）；运行时统计字段保留
          // 触发器字段变化时 updateTask 内部会重新计算 nextRunAt
          this.updateTask(match.id, exportTaskToUpdateFields(task) as Record<string, unknown>)
          result.imported += 1
          continue
        }

        // 新建
        const newId = generateId()
        const created = this.createTask({
          id: newId,
          name: task.name,
          description: task.description,
          enabled: task.enabled ? 1 : 0,
          scope: 'global',
          session_id: null,
          paused_by_archive: 0,
          skip_if_session_running: 1,
          continue_on_error: 1,
          trigger_type: task.triggerType,
          interval_seconds: task.intervalSeconds,
          cron_expression: task.cronExpression,
          run_at: task.runAt,
          timezone: task.timezone,
          start_at: task.startAt,
          end_at: task.endAt,
          max_executions: task.maxExecutions,
          agent_id: task.agentId,
          team_id: task.teamId,
          model_id: task.modelId,
          workspace_id: task.workspaceId,
          prompt_template: task.promptTemplate,
          permission_mode: task.permissionMode,
          permission_profile_id: task.permissionProfileId,
          timeout_seconds: task.timeoutSeconds,
          max_retries: task.maxRetries,
          retry_delay_seconds: task.retryDelaySeconds,
          retry_backoff: task.retryBackoff,
          notifications: JSON.stringify(task.notifications),
          concurrency_policy: task.concurrencyPolicy,
          tags: JSON.stringify(task.tags),
          history_retention_days: task.historyRetentionDays,
        })
        result.imported += 1
        log.info(`Imported task name="${created.name}" id=${newId}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`[${task.name}] ${message}`)
        log.warn(`Failed to import task "${task.name}": ${message}`)
      }
    }

    return result
  }

  // ─── Execution Control ────────────────────────────────────────────────────

  enableTask(id: string): ScheduledTaskItem | null {
    const task = this.taskRepo.get(id)
    if (!task) return null
    const nextRunAt = this.calculateNextRunAt(task)
    this.taskRepo.update(id, {
      enabled: true,
      status: 'idle',
      next_run_at: nextRunAt,
      paused_by_archive: false,
    } as any)
    return toTaskItem(this.taskRepo.get(id)!)
  }

  disableTask(id: string): ScheduledTaskItem | null {
    const task = this.taskRepo.get(id)
    if (!task) return null
    this.taskRepo.update(id, {
      enabled: false,
      status: 'disabled',
      paused_by_archive: false,
    } as any)
    return toTaskItem(this.taskRepo.get(id)!)
  }

  /**
   * 立即执行任务
   *
   * 不会等待 turn 跑完，但会等待"会话已创建"（最多 10s）。这样调用方（IPC / UI）
   * 能在返回值里拿到 sessionId，"保存并执行"后可直接跳转到该会话。
   */
  async runNow(id: string): Promise<TaskExecutionItem> {
    const task = this.taskRepo.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)

    const execution = this.executionRepo.create({
      id: generateId(),
      task_id: id,
      trigger_type: 'manual',
    })

    const sessionIdPromise = new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.runNowSessionResolvers.delete(execution.id)
        resolve(null)
      }, 10000)
      this.runNowSessionResolvers.set(execution.id, (sessionId) => {
        clearTimeout(timeout)
        resolve(sessionId)
      })
    })

    // Turn 在后台异步运行；执行失败时清理 resolver 防止 promise 卡住
    this.executeTask(task, execution.id, 'manual').catch((err) => {
      const resolver = this.runNowSessionResolvers.get(execution.id)
      if (resolver) {
        this.runNowSessionResolvers.delete(execution.id)
        resolver('')
      }
      log.error(`Manual execution failed for task ${id}: ${err}`)
    })

    await sessionIdPromise

    return toExecutionItem(this.executionRepo.get(execution.id) ?? execution)
  }

  /**
   * 取消执行中的任务
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.executionRepo.get(executionId)
    if (!execution || execution.status !== 'running') return false

    this.executionRepo.updateStatus(executionId, 'cancelled', {
      completedAt: new Date().toISOString(),
    })
    // Reset task status
    this.taskRepo.updateStatus(execution.task_id, 'idle')
    this.taskRepo.setCurrentExecution(execution.task_id, null)
    return true
  }

  // ─── Scheduler Engine ─────────────────────────────────────────────────────

  startScheduler(intervalMs = 1000): void {
    if (this.schedulerTimer) return
    this.taskRepo.recoverInterruptedSessionTasks()
    this.skipMissedSessionRuns()
    log.info(`Scheduler started (interval: ${intervalMs}ms)`)
    this.schedulerTimer = setInterval(() => {
      void this.tick().catch((err) => {
        log.error(`Scheduler tick error: ${err}`)
      })
    }, intervalMs)
  }

  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
      log.info('Scheduler stopped')
    }
  }

  /**
   * Session schedules intentionally do not catch up executions missed while the app was closed.
   * Move recurring tasks to their next future slot and retire missed one-time tasks.
   */
  skipMissedSessionRuns(now = new Date()): void {
    const overdue = this.taskRepo.listOverdueSessionTasks(toSQLiteUtc(now))
    for (const task of overdue) {
      if (task.trigger_type === 'once') {
        this.taskRepo.update(task.id, {
          enabled: false,
          status: 'disabled',
          next_run_at: null,
          last_error: null,
        } as any)
        continue
      }
      const nextRunAt = this.calculateNextRunAt(task, now)
      this.taskRepo.update(task.id, { next_run_at: nextRunAt } as any)
    }
  }

  /** Pause on archive and restore only tasks that were enabled immediately before archival. */
  setSessionArchived(sessionId: string, archived: boolean): void {
    if (archived) {
      this.taskRepo.pauseEnabledBySession(sessionId)
      return
    }
    for (const task of this.taskRepo.listArchivePausedBySession(sessionId)) {
      const nextRunAt = this.calculateNextRunAt(task)
      if (nextRunAt == null) {
        this.taskRepo.update(task.id, {
          paused_by_archive: false,
          last_error: 'Schedule has no future run after session restore',
        } as any)
        continue
      }
      this.taskRepo.markRestoredFromArchive(task.id, nextRunAt)
    }
  }

  private async tick(): Promise<void> {
    const dueTasks = this.taskRepo.findDueTasks()
    for (const task of dueTasks) {
      try {
        if (task.scope === 'session' && task.session_id != null) {
          const sessionState = this.readSessionTaskState(task.session_id)
          if (sessionState.kind === 'missing') {
            this.disableMissingSessionTask(task)
            continue
          }
          if (sessionState.kind === 'unavailable') {
            this.rescheduleUnreadableSessionTask(task, sessionState.error)
            continue
          }
          if (sessionState.running && task.skip_if_session_running !== 0) {
            this.rescheduleSkippedSessionTask(task, 'session is running')
            continue
          }
          if (sessionState.status === 'error' && task.continue_on_error === 0) {
            this.pauseSessionTaskAfterError(task)
            continue
          }
        }

        // Check concurrency
        const runningExecutions = this.executionRepo.findRunningByTaskId(task.id)
        if (runningExecutions.length > 0) {
          if (task.concurrency_policy === 'skip') {
            // Skip this run, recalculate nextRunAt
            const nextRunAt = this.calculateNextRunAt(task)
            this.taskRepo.update(task.id, { next_run_at: nextRunAt } as any)
            continue
          } else if (task.concurrency_policy === 'cancel') {
            // Cancel existing execution
            for (const ex of runningExecutions) {
              this.executionRepo.updateStatus(ex.id, 'cancelled', {
                completedAt: new Date().toISOString(),
                error: 'Cancelled by new scheduled execution',
              })
            }
          }
          // 'queue' policy: let the new execution start anyway
        }

        // Create execution record
        const execution = this.executionRepo.create({
          id: generateId(),
          task_id: task.id,
          trigger_type: 'scheduled',
        })

        // Update nextRunAt BEFORE executing (so it doesn't re-trigger)
        const nextRunAt = this.calculateNextRunAt(task)
        this.taskRepo.update(task.id, {
          next_run_at: nextRunAt,
          ...(task.trigger_type === 'once' && nextRunAt == null
            ? { enabled: false, status: 'disabled' }
            : {}),
        } as any)

        // Execute asynchronously
        this.executeTask(task, execution.id, 'scheduled').catch((err) => {
          log.error(`Scheduled execution failed for task ${task.id}: ${err}`)
        })
      } catch (err) {
        log.error(`Error processing due task ${task.id}: ${err}`)
      }
    }
  }

  // ─── Task Execution ───────────────────────────────────────────────────────

  private async executeTask(
    task: ScheduledTaskRow,
    executionId: string,
    _triggerType: string,
  ): Promise<void> {
    const startTime = Date.now()

    // Mark task as running
    this.taskRepo.updateStatus(task.id, 'running')
    this.taskRepo.setCurrentExecution(task.id, executionId)

    try {
      if (!this.executorFn) {
        throw new Error('Task executor not configured. Call setExecutor() first.')
      }

      // Resolve prompt template variables
      const promptContextTask = this.taskRepo.get(task.id) ?? task
      const userMessageDisplayContent = this.resolveTemplate(
        task.prompt_template,
        promptContextTask,
      )
      const prompt = this.buildExecutionPrompt(
        userMessageDisplayContent,
        promptContextTask,
        _triggerType,
      )

      // Execute via injected executor
      const result = await this.executeWithTimeout(
        this.executorFn({
          sessionId: task.session_id,
          agentId: task.agent_id,
          teamId: task.team_id,
          modelId: task.model_id,
          workspaceId: task.workspace_id,
          promptTemplate: prompt,
          userMessageDisplayContent,
          permissionMode: task.permission_mode,
          timeoutSeconds: task.timeout_seconds,
          taskName: task.name,
          onSessionCreated: (sessionId: string) => {
            // 会话已建好：尽早把 sessionId 写回执行记录，并通知 runNow 解锁返回
            try {
              this.executionRepo.updateStatus(executionId, 'running', { sessionId })
            } catch (err) {
              log.warn(`Failed to update execution sessionId early: ${err}`)
            }
            const resolver = this.runNowSessionResolvers.get(executionId)
            if (resolver) {
              this.runNowSessionResolvers.delete(executionId)
              resolver(sessionId)
            }
          },
        }),
        task.timeout_seconds * 1000,
      )

      const durationMs = Date.now() - startTime

      // Update execution record
      this.executionRepo.updateStatus(executionId, 'completed', {
        completedAt: new Date().toISOString(),
        durationMs,
        output: result.output ?? undefined,
        sessionId: result.sessionId ?? undefined,
        tokenUsage: result.tokenUsage,
      })

      // Update task counts
      this.taskRepo.incrementExecutionCount(task.id, true)
      this.taskRepo.setLastError(task.id, null)

      // Send success notifications
      await this.sendNotifications(task, {
        status: 'completed',
        output: result.output,
      })
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : String(err)
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('Timeout')

      // Update execution record
      this.executionRepo.updateStatus(executionId, isTimeout ? 'timeout' : 'failed', {
        completedAt: new Date().toISOString(),
        durationMs,
        error: errorMessage,
      })

      // Update task counts
      this.taskRepo.incrementExecutionCount(task.id, false)
      this.taskRepo.setLastError(task.id, errorMessage)

      if (task.scope === 'session' && task.continue_on_error === 0) {
        this.pauseSessionTaskAfterError(task, errorMessage)
      }

      // Send failure notifications
      await this.sendNotifications(task, {
        status: isTimeout ? 'timeout' : 'failed',
        error: errorMessage,
      })

      // Handle retry
      await this.handleRetry(task, executionId, errorMessage)
    } finally {
      // Reset task status
      const currentTask = this.taskRepo.get(task.id)
      if (currentTask?.enabled) {
        this.taskRepo.updateStatus(task.id, 'idle')
      } else if (currentTask != null && task.trigger_type === 'once') {
        this.taskRepo.updateStatus(task.id, 'disabled')
      }
      this.taskRepo.setCurrentExecution(task.id, null)

      // Check if max executions reached
      if (
        currentTask &&
        currentTask.max_executions > 0 &&
        currentTask.execution_count >= currentTask.max_executions
      ) {
        this.taskRepo.updateStatus(task.id, 'disabled')
      }

      // Cleanup old executions
      if (currentTask) {
        this.executionRepo.cleanupOlderThan(task.id, currentTask.history_retention_days)
      }
    }
  }

  private async handleRetry(
    task: ScheduledTaskRow,
    failedExecutionId: string,
    _error: string,
  ): Promise<void> {
    if (task.max_retries <= 0) return

    const failedExecution = this.executionRepo.get(failedExecutionId)
    if (!failedExecution) return

    const currentAttempt = failedExecution.retry_attempt
    if (currentAttempt >= task.max_retries) {
      log.info(`Max retries (${task.max_retries}) reached for task ${task.id}`)
      return
    }

    // Calculate retry delay based on backoff strategy
    const delay = this.calculateRetryDelay(
      task.retry_delay_seconds,
      currentAttempt,
      task.retry_backoff,
    )
    log.info(`Scheduling retry #${currentAttempt + 1} for task ${task.id} in ${delay}ms`)

    // Wait for the delay
    await sleep(delay)

    // Create retry execution
    const retryExecution = this.executionRepo.create({
      id: generateId(),
      task_id: task.id,
      trigger_type: 'retry',
      retry_attempt: currentAttempt + 1,
      parent_execution_id: failedExecutionId,
    })

    // Execute the retry
    try {
      await this.executeTask(task, retryExecution.id, 'retry')
    } catch (retryErr) {
      log.error(`Retry execution failed for task ${task.id}: ${retryErr}`)
    }
  }

  private calculateRetryDelay(
    baseDelaySeconds: number,
    attempt: number,
    backoff: RetryBackoff,
  ): number {
    const base = baseDelaySeconds * 1000
    switch (backoff) {
      case 'fixed':
        return base
      case 'linear':
        return base * (attempt + 1)
      case 'exponential':
        return base * Math.pow(2, attempt)
      default:
        return base
    }
  }

  private readSessionTaskState(sessionId: string): SessionTaskStateReadResult {
    if (this.sessionTaskStateReader == null) {
      return { kind: 'unavailable', error: 'Session state reader is not configured' }
    }
    try {
      return this.sessionTaskStateReader(sessionId)
    } catch (error) {
      const message = String(error)
      log.warn(`Failed to read session state for scheduled task session ${sessionId}: ${message}`)
      return { kind: 'unavailable', error: message }
    }
  }

  private disableMissingSessionTask(task: ScheduledTaskRow): void {
    this.taskRepo.update(task.id, {
      enabled: false,
      status: 'disabled',
      next_run_at: null,
      last_error: 'Bound session no longer exists',
    } as any)
    log.info(`Disabled session scheduled task ${task.id}: bound session no longer exists`)
  }

  private rescheduleUnreadableSessionTask(task: ScheduledTaskRow, error: string): void {
    const retryAt =
      this.calculateSkippedSessionNextRunAt(task) ??
      toSQLiteUtc(new Date(Date.now() + SESSION_TASK_RETRY_DELAY_MS))
    this.taskRepo.update(task.id, {
      next_run_at: retryAt,
      last_error: `Unable to read bound session state: ${error}`,
    } as any)
    log.warn(`Skipped session scheduled task ${task.id}: unable to read session state (${error})`)
  }

  private rescheduleSkippedSessionTask(task: ScheduledTaskRow, reason: string): void {
    const nextRunAt = this.calculateSkippedSessionNextRunAt(task)
    this.taskRepo.update(task.id, {
      next_run_at: nextRunAt,
      ...(task.trigger_type === 'once' && nextRunAt == null
        ? { enabled: false, status: 'disabled' }
        : {}),
    } as any)
    log.info(`Skipped session scheduled task ${task.id}: ${reason}`)
  }

  private calculateSkippedSessionNextRunAt(task: ScheduledTaskRow): string | null {
    if (task.trigger_type !== 'once') return this.calculateNextRunAt(task)

    const retryAt = new Date(Date.now() + SESSION_TASK_RETRY_DELAY_MS)
    if (task.end_at && new Date(task.end_at) <= retryAt) return null
    if (task.max_executions > 0 && task.execution_count >= task.max_executions) return null
    return toSQLiteUtc(retryAt)
  }

  private pauseSessionTaskAfterError(task: ScheduledTaskRow, errorMessage?: string): void {
    this.taskRepo.update(task.id, {
      enabled: false,
      status: 'disabled',
      next_run_at: null,
      last_error: errorMessage ?? task.last_error ?? 'Session is in error; scheduled task paused',
    } as any)
    log.info(`Paused session scheduled task ${task.id} after session error`)
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Execution timed out after ${timeoutMs / 1000}s`)),
          timeoutMs,
        ),
      ),
    ])
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private async sendNotifications(
    task: ScheduledTaskRow,
    event: { status: string; output?: string | undefined; error?: string | undefined },
  ): Promise<void> {
    const notifications = safeJsonParse<NotificationConfig[]>(task.notifications, [])
    for (const notif of notifications) {
      try {
        const shouldSend =
          (event.status === 'completed' && notif.triggers.includes('onSuccess')) ||
          ((event.status === 'failed' || event.status === 'timeout') &&
            notif.triggers.includes('onFailure'))

        if (!shouldSend) continue

        const body = notif.bodyTemplate
          ? this.resolveTemplate(notif.bodyTemplate, task, event)
          : JSON.stringify({
              task: { id: task.id, name: task.name },
              event: { status: event.status, output: event.output, error: event.error },
              timestamp: new Date().toISOString(),
            })

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...notif.headers,
        }

        await fetch(notif.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10000), // 10s timeout for webhook
        })

        log.info(`Webhook notification sent to ${notif.url} for task ${task.id}`)
      } catch (err) {
        log.warn(`Failed to send webhook notification for task ${task.id}: ${err}`)
      }
    }
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  getExecutions(
    taskId: string,
    options?: { page?: number; pageSize?: number; status?: string },
  ): { executions: TaskExecutionItem[]; total: number } {
    const result = this.executionRepo.findByTaskId(taskId, options)
    return {
      executions: result.executions.map(toExecutionItem),
      total: result.total,
    }
  }

  getExecution(executionId: string): TaskExecutionItem | null {
    const row = this.executionRepo.get(executionId)
    return row ? toExecutionItem(row) : null
  }

  getExecutionStats(taskId: string): ExecutionStats {
    return this.executionRepo.getStats(taskId)
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private calculateNextRunAt(task: ScheduledTaskRow, from = new Date()): string | null {
    const now = new Date(from)

    // Check if task has ended
    if (task.end_at && new Date(task.end_at) <= now) return null
    // Check if max executions reached
    if (task.max_executions > 0 && task.execution_count >= task.max_executions) return null

    switch (task.trigger_type) {
      case 'interval': {
        const seconds = task.interval_seconds ?? 60
        const next = new Date(now.getTime() + seconds * 1000)
        // If start_at is in the future, use that instead
        if (task.start_at && new Date(task.start_at) > now) {
          return toSQLiteUtc(new Date(task.start_at))
        }
        return toSQLiteUtc(next)
      }
      case 'cron': {
        const expr = task.cron_expression ?? '* * * * *'
        const next = this.parseCronNextRun(expr, now, task.timezone)
        if (task.start_at && next && new Date(task.start_at) > next) {
          return toSQLiteUtc(new Date(task.start_at))
        }
        return next ? toSQLiteUtc(next) : null
      }
      case 'once': {
        if (!task.run_at) return null
        const runAt = new Date(task.run_at)
        return runAt > now ? toSQLiteUtc(runAt) : null
      }
      default:
        return null
    }
  }

  private parseCronNextRun(expression: string, from: Date, timezone: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(expression, {
        currentDate: from,
        ...(timezone !== 'system' ? { tz: timezone } : {}),
      })
      return interval.next().toDate()
    } catch (error) {
      log.warn(`Invalid cron expression "${expression}": ${String(error)}`)
      return null
    }
  }

  private resolveTemplate(
    template: string,
    task: ScheduledTaskRow,
    extra?: Record<string, unknown>,
  ): string {
    const now = new Date()
    const vars: Record<string, string> = {
      date: now.toISOString().split('T')[0] ?? '',
      time: now.toTimeString().split(' ')[0] ?? '',
      taskName: task.name,
      triggerType: task.trigger_type,
      executionCount: String(task.execution_count),
      interval: String(task.interval_seconds ?? ''),
      cronExpression: String(task.cron_expression ?? ''),
      runAt: String(task.run_at ?? ''),
      timezone: String(task.timezone ?? ''),
      nextRunAt: String(task.next_run_at ?? ''),
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        vars[k] = typeof v === 'string' ? v : JSON.stringify(v)
      }
    }

    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
  }

  private buildExecutionPrompt(
    resolvedPrompt: string,
    task: ScheduledTaskRow,
    triggerType: string,
  ): string {
    const lines = [
      '[Scheduled Task Context]',
      `This turn was started by Spark's scheduled task runner, not by an interactive user chat.`,
      `Task name: ${task.name}`,
      ...(task.scope === 'session'
        ? [
            `Task id: ${task.id}`,
            'This task is bound to the current session. If its objective is complete, canceled, permanently blocked, or no longer useful, call `mcp__spark_platform__session_schedule_delete` with this task id before finishing. If the awaited result is still pending, keep the task and end this turn after recording the current status.',
          ]
        : []),
      `Execution trigger: ${triggerType}`,
      `Configured schedule: ${this.describeSchedule(task)}`,
      task.next_run_at ? `Next scheduled run: ${task.next_run_at}` : 'Next scheduled run: none',
      task.timezone ? `Timezone: ${task.timezone}` : 'Timezone: system',
      'The schedule has already been configured. Do not ask the user what frequency, interval, cron, or timing to use.',
      'Do not ask the user to confirm or redefine the automation cadence. Execute the task using the existing schedule.',
      '',
      '[Task Instructions]',
      resolvedPrompt,
    ]
    return lines.join('\n')
  }

  private describeSchedule(task: ScheduledTaskRow): string {
    switch (task.trigger_type) {
      case 'interval':
        return task.interval_seconds != null
          ? `interval every ${task.interval_seconds} seconds`
          : 'interval'
      case 'cron':
        return task.cron_expression != null && task.cron_expression.trim().length > 0
          ? `cron ${task.cron_expression}`
          : 'cron'
      case 'once':
        return task.run_at != null && task.run_at.trim().length > 0
          ? `once at ${task.run_at}`
          : 'once'
      default:
        return task.trigger_type
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toTaskItem(row: ScheduledTaskRow): ScheduledTaskItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    scope: row.scope,
    sessionId: row.session_id,
    pausedByArchive: row.paused_by_archive === 1,
    skipIfSessionRunning: row.skip_if_session_running !== 0,
    continueOnError: row.continue_on_error !== 0,
    triggerType: row.trigger_type,
    intervalSeconds: row.interval_seconds,
    cronExpression: row.cron_expression,
    runAt: row.run_at,
    timezone: row.timezone,
    startAt: row.start_at,
    endAt: row.end_at,
    maxExecutions: row.max_executions,
    agentId: row.agent_id,
    teamId: row.team_id,
    modelId: row.model_id,
    workspaceId: row.workspace_id,
    promptTemplate: row.prompt_template,
    permissionMode: row.permission_mode,
    permissionProfileId: row.permission_profile_id,
    timeoutSeconds: row.timeout_seconds,
    maxRetries: row.max_retries,
    retryDelaySeconds: row.retry_delay_seconds,
    retryBackoff: row.retry_backoff,
    notifications: safeJsonParse<NotificationConfig[]>(row.notifications, []),
    concurrencyPolicy: row.concurrency_policy,
    tags: safeJsonParse<string[]>(row.tags, []),
    historyRetentionDays: row.history_retention_days,
    status: row.status,
    executionCount: row.execution_count,
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    currentExecutionId: row.current_execution_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toExecutionItem(row: TaskExecutionRow): TaskExecutionItem {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    status: row.status,
    output: row.output,
    error: row.error,
    tokenUsage: row.token_usage ? safeJsonParse(row.token_usage, null) : null,
    retryAttempt: row.retry_attempt,
    parentExecutionId: row.parent_execution_id,
    triggerType: row.trigger_type,
    createdAt: row.created_at,
  }
}

function validateSessionTaskDefinition(task: {
  name: string
  prompt_template: string
  trigger_type: TriggerType
  interval_seconds?: number | null
  cron_expression?: string | null
  run_at?: string | null
  timezone: string
}): void {
  if (task.name.trim() === '') throw new Error('Session scheduled task name is required')
  if (task.prompt_template.trim() === '') {
    throw new Error('Session scheduled task prompt is required')
  }
  if (task.trigger_type === 'interval') {
    if (task.interval_seconds == null || task.interval_seconds < 10) {
      throw new Error('Session scheduled task interval must be at least 10 seconds')
    }
    return
  }
  if (task.trigger_type === 'cron') {
    const expression = task.cron_expression?.trim() ?? ''
    const parts = expression.split(/\s+/)
    try {
      if (parts.length !== 5) throw new Error('expected five fields')
      CronExpressionParser.parse(expression, {
        ...(task.timezone !== 'system' ? { tz: task.timezone } : {}),
      })
    } catch {
      throw new Error('Session scheduled task requires a valid five-field cron expression')
    }
    return
  }
  const runAt = task.run_at == null ? Number.NaN : Date.parse(task.run_at)
  if (!Number.isFinite(runAt) || runAt <= Date.now()) {
    throw new Error('Session scheduled task runAt must be in the future')
  }
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null || json === '') return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/**
 * Convert a Date to SQLite datetime('now')-compatible format: 'YYYY-MM-DD HH:MM:SS' (UTC).
 *
 * Why: findDueTasks() compares next_run_at against datetime('now'), which SQLite
 * returns as 'YYYY-MM-DD HH:MM:SS'. ISO strings ('YYYY-MM-DDTHH:MM:SS.sssZ') sort
 * incorrectly against that format (the 'T' vs ' ' separator and trailing Z), so
 * due tasks never match. Storing next_run_at in the same format fixes the comparison.
 */
function toSQLiteUtc(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '')
}

/**
 * 把数据库 row 转成可导出的 task 对象。
 * 排除运行时统计字段与时间戳字段（导入时新建/保留本地值）。
 */
function rowToExportTask(row: ScheduledTaskRow): ScheduledTaskExportTask {
  return {
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    triggerType: row.trigger_type,
    intervalSeconds: row.interval_seconds,
    cronExpression: row.cron_expression,
    runAt: row.run_at,
    timezone: row.timezone,
    startAt: row.start_at,
    endAt: row.end_at,
    maxExecutions: row.max_executions,
    agentId: row.agent_id,
    teamId: row.team_id,
    modelId: row.model_id,
    workspaceId: row.workspace_id,
    promptTemplate: row.prompt_template,
    permissionMode: row.permission_mode,
    permissionProfileId: row.permission_profile_id,
    timeoutSeconds: row.timeout_seconds,
    maxRetries: row.max_retries,
    retryDelaySeconds: row.retry_delay_seconds,
    retryBackoff: row.retry_backoff,
    notifications: safeJsonParse<ScheduledTaskExportTask['notifications']>(row.notifications, []),
    concurrencyPolicy: row.concurrency_policy,
    tags: safeJsonParse<string[]>(row.tags, []),
    historyRetentionDays: row.history_retention_days,
  }
}

/**
 * 把 export task 转为 update 字段映射（snake_case）。
 * 注意：不更新 name（name 是去重 key）、不更新 enabled（尊重用户启用偏好）。
 */
function exportTaskToUpdateFields(task: ScheduledTaskExportTask): Partial<ScheduledTaskRow> {
  return {
    description: task.description,
    trigger_type: task.triggerType,
    interval_seconds: task.intervalSeconds,
    cron_expression: task.cronExpression,
    run_at: task.runAt,
    timezone: task.timezone,
    start_at: task.startAt,
    end_at: task.endAt,
    max_executions: task.maxExecutions,
    agent_id: task.agentId,
    team_id: task.teamId,
    model_id: task.modelId,
    workspace_id: task.workspaceId,
    prompt_template: task.promptTemplate,
    permission_mode: task.permissionMode,
    permission_profile_id: task.permissionProfileId,
    timeout_seconds: task.timeoutSeconds,
    max_retries: task.maxRetries,
    retry_delay_seconds: task.retryDelaySeconds,
    retry_backoff: task.retryBackoff,
    notifications: JSON.stringify(task.notifications),
    concurrency_policy: task.concurrencyPolicy,
    tags: JSON.stringify(task.tags),
    history_retention_days: task.historyRetentionDays,
  } as Partial<ScheduledTaskRow>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
