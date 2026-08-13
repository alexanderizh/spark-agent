import crypto from 'node:crypto'

import type { ScheduledTaskItem } from '@spark/protocol'
import { z } from 'zod'

import type { ScheduledTaskService } from './scheduled-task.service.js'

const SessionScheduleCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
    enabled: z.boolean().optional(),
    skipIfSessionRunning: z.boolean().optional(),
    continueOnError: z.boolean().optional(),
    triggerType: z.enum(['interval', 'cron', 'once']),
    intervalSeconds: z.number().int().min(10).max(31_536_000).nullable().optional(),
    cronExpression: z.string().trim().min(1).max(200).nullable().optional(),
    runAt: z.string().trim().min(1).nullable().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    startAt: z.string().trim().min(1).nullable().optional(),
    endAt: z.string().trim().min(1).nullable().optional(),
    maxExecutions: z.number().int().min(0).max(1_000_000).optional(),
    promptTemplate: z.string().trim().min(1).max(100_000),
    timeoutSeconds: z.number().int().min(10).max(86_400).optional(),
    maxRetries: z.number().int().min(0).max(100).optional(),
    retryDelaySeconds: z.number().int().min(0).max(86_400).optional(),
    retryBackoff: z.enum(['fixed', 'linear', 'exponential']).optional(),
    concurrencyPolicy: z.enum(['skip', 'queue', 'cancel']).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    historyRetentionDays: z.number().int().min(1).max(3_650).optional(),
  })
  .strict()

const SessionScheduleUpdateInputSchema = SessionScheduleCreateInputSchema.partial()

export type SessionScheduleCreateInput = z.infer<typeof SessionScheduleCreateInputSchema>
export type SessionScheduleUpdateInput = z.infer<typeof SessionScheduleUpdateInputSchema>

export type SessionScheduleChangeHandler = (
  action: 'create' | 'update' | 'delete',
  taskId: string,
) => void

/**
 * Current-session-only facade used by Agent tools.
 *
 * Session binding is supplied by the runtime, never by model input. Every id-based
 * operation re-checks ownership before touching persistence so guessed ids cannot
 * cross session or global-task boundaries.
 */
export class SessionScheduleAgentTools {
  constructor(
    private readonly tasks: ScheduledTaskService,
    private readonly onChanged?: SessionScheduleChangeHandler,
  ) {}

  list(sessionId: string): ScheduledTaskItem[] {
    const currentSessionId = requireCurrentSessionId(sessionId)
    return this.tasks.listTasks({
      scope: 'session',
      sessionId: currentSessionId,
    }) as ScheduledTaskItem[]
  }

  get(sessionId: string, taskId: string): ScheduledTaskItem {
    return this.requireOwnedTask(sessionId, taskId)
  }

  create(sessionId: string, input: SessionScheduleCreateInput): ScheduledTaskItem {
    const currentSessionId = requireCurrentSessionId(sessionId)
    const parsed = SessionScheduleCreateInputSchema.parse(input)
    const task = this.tasks.createTask({
      id: crypto.randomUUID(),
      name: parsed.name,
      description: parsed.description ?? '',
      enabled: parsed.enabled !== false,
      scope: 'session',
      session_id: currentSessionId,
      paused_by_archive: false,
      skip_if_session_running: parsed.skipIfSessionRunning !== false,
      continue_on_error: parsed.continueOnError !== false,
      trigger_type: parsed.triggerType,
      interval_seconds: parsed.intervalSeconds ?? null,
      cron_expression: parsed.cronExpression ?? null,
      run_at: parsed.runAt ?? null,
      timezone: parsed.timezone ?? 'system',
      start_at: parsed.startAt ?? null,
      end_at: parsed.endAt ?? null,
      max_executions: parsed.maxExecutions ?? 0,
      // Session tasks intentionally follow the session's live runtime configuration.
      agent_id: null,
      team_id: null,
      model_id: null,
      workspace_id: null,
      prompt_template: parsed.promptTemplate,
      permission_mode: 'auto',
      permission_profile_id: null,
      timeout_seconds: parsed.timeoutSeconds ?? 300,
      max_retries: parsed.maxRetries ?? 0,
      retry_delay_seconds: parsed.retryDelaySeconds ?? 60,
      retry_backoff: parsed.retryBackoff ?? 'fixed',
      notifications: [],
      concurrency_policy: parsed.concurrencyPolicy ?? 'queue',
      tags: parsed.tags ?? [],
      history_retention_days: parsed.historyRetentionDays ?? 30,
    } as unknown as Parameters<ScheduledTaskService['createTask']>[0]) as ScheduledTaskItem
    this.onChanged?.('create', task.id)
    return task
  }

  update(sessionId: string, taskId: string, input: SessionScheduleUpdateInput): ScheduledTaskItem {
    this.requireOwnedTask(sessionId, taskId)
    const parsed = SessionScheduleUpdateInputSchema.parse(input)
    const fields: Record<string, unknown> = {}
    copyDefined(fields, 'name', parsed.name)
    copyDefined(fields, 'description', parsed.description)
    copyDefined(fields, 'skip_if_session_running', parsed.skipIfSessionRunning)
    copyDefined(fields, 'continue_on_error', parsed.continueOnError)
    copyDefined(fields, 'trigger_type', parsed.triggerType)
    copyDefined(fields, 'interval_seconds', parsed.intervalSeconds)
    copyDefined(fields, 'cron_expression', parsed.cronExpression)
    copyDefined(fields, 'run_at', parsed.runAt)
    copyDefined(fields, 'timezone', parsed.timezone)
    copyDefined(fields, 'start_at', parsed.startAt)
    copyDefined(fields, 'end_at', parsed.endAt)
    copyDefined(fields, 'max_executions', parsed.maxExecutions)
    copyDefined(fields, 'prompt_template', parsed.promptTemplate)
    copyDefined(fields, 'timeout_seconds', parsed.timeoutSeconds)
    copyDefined(fields, 'max_retries', parsed.maxRetries)
    copyDefined(fields, 'retry_delay_seconds', parsed.retryDelaySeconds)
    copyDefined(fields, 'retry_backoff', parsed.retryBackoff)
    copyDefined(fields, 'concurrency_policy', parsed.concurrencyPolicy)
    copyDefined(fields, 'tags', parsed.tags)
    copyDefined(fields, 'history_retention_days', parsed.historyRetentionDays)

    if (Object.keys(fields).length === 0 && parsed.enabled === undefined) {
      return this.requireOwnedTask(sessionId, taskId)
    }

    let task =
      Object.keys(fields).length > 0
        ? (this.tasks.updateTask(taskId, fields) as ScheduledTaskItem | null)
        : this.requireOwnedTask(sessionId, taskId)
    if (task == null) throw taskNotFound(taskId)

    if (parsed.enabled !== undefined) {
      task = (
        parsed.enabled ? this.tasks.enableTask(taskId) : this.tasks.disableTask(taskId)
      ) as ScheduledTaskItem | null
    }
    if (task == null) throw taskNotFound(taskId)
    this.onChanged?.('update', task.id)
    return task
  }

  delete(sessionId: string, taskId: string): { success: true } {
    this.requireOwnedTask(sessionId, taskId)
    if (!this.tasks.deleteTask(taskId)) throw taskNotFound(taskId)
    this.onChanged?.('delete', taskId)
    return { success: true }
  }

  private requireOwnedTask(sessionId: string, taskId: string): ScheduledTaskItem {
    const currentSessionId = requireCurrentSessionId(sessionId)
    const task = this.tasks.getTask(taskId) as ScheduledTaskItem | null
    if (task == null || task.scope !== 'session' || task.sessionId !== currentSessionId) {
      throw taskNotFound(taskId)
    }
    return task
  }
}

function copyDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value
}

function taskNotFound(taskId: string): Error {
  return new Error(`Session scheduled task not found: ${taskId}`)
}

function requireCurrentSessionId(sessionId: string): string {
  const value = sessionId.trim()
  if (!value) throw new Error('Current session id is unavailable')
  return value
}

export const SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT = [
  '## Session Scheduled Tasks',
  'You can manage durable scheduled wake-ups for the current session only with the `mcp__spark_platform__session_schedule_*` tools.',
  'Use them when useful work must resume later, such as polling a long-running third-party job. Do not use them merely to continue work you can finish in the current turn.',
  'Scheduling fields: `interval` requires `intervalSeconds` of at least 10 (prefer 60 or more for polling); `cron` requires a valid five-field `cronExpression` and may include `timezone`; `once` requires a future ISO-8601 `runAt`.',
  'Session safety fields default to enabled: `skipIfSessionRunning` skips a trigger while this session has a running or queued turn; `continueOnError` keeps future triggers active after the session reports an error. Disable the latter to pause the task after an error.',
  '',
  'Lifecycle:',
  '1. Call `session_schedule_list` first when a similar wake-up may already exist; avoid duplicate pollers.',
  '2. Call `session_schedule_create` with a self-contained prompt: what to inspect, where the relevant state lives, what counts as complete, what to do while pending, and that the task must be deleted when no longer needed.',
  '3. After creation succeeds, tell the user briefly and end the current turn. The scheduler will queue a new turn in this same conversation using whatever Agent, model, permissions, and workspace configuration the session has at that future time.',
  '4. A scheduled wake-up includes `[Scheduled Task Context]` and its task id. Check the real status. If still pending, leave the recurring task in place and end the turn. If complete, canceled, permanently blocked, or otherwise no longer useful, call `session_schedule_delete` with that task id before finishing the follow-up work.',
  '5. Use `session_schedule_update` to change cadence, instructions, or enabled state. Disabling pauses a task but does not clean it up; recurring tasks persist until deleted.',
  '',
  'Prefer intervals of at least 60 seconds for polling unless a shorter cadence is genuinely necessary. Use a one-time task for a single future wake-up and an interval/Cron task for repeated checks.',
  "The tools are already bound to the current session: never ask for or invent a session id. You cannot inspect or mutate another session's tasks.",
  'Deleting a task you created for the current objective once it is finished is required lifecycle cleanup and does not need an extra user confirmation.',
].join('\n')
