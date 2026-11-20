import { createHash, randomUUID } from 'node:crypto'

import {
  ScheduledTaskExportPayloadSchema,
  ScheduledTaskExportTaskSchema,
  type ScheduledTaskItem,
} from '@spark/protocol'
import { CronExpressionParser } from 'cron-parser'
import { z } from 'zod'

import type { ScheduledTaskService } from './scheduled-task.service.js'
import type { SessionScheduleChangeHandler } from './session-schedule-agent-tools.js'

const createSchema = ScheduledTaskExportTaskSchema.omit({
  permissionMode: true,
  permissionProfileId: true,
  notifications: true,
})
  .partial()
  .required({ name: true, triggerType: true, promptTemplate: true })
  .strict()
const updateSchema = createSchema.partial()
const idSchema = z.string().trim().min(1).max(200)
const paging = {
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
}
const listSchema = z
  .object({
    ...paging,
    enabled: z.boolean().optional(),
    status: z.enum(['idle', 'running', 'disabled', 'error']).optional(),
    query: z.string().trim().max(200).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  })
  .strict()
const executionsSchema = z
  .object({
    ...paging,
    status: z.enum(['running', 'completed', 'failed', 'cancelled', 'timeout']).optional(),
  })
  .strict()

type ScheduleInput = z.infer<typeof createSchema>

type ScheduleOptions = {
  agents: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  models: { id: string; providerName: string }[]
  workspaces: { id: string; name: string }[]
}

const fields = {
  name: 'name',
  description: 'description',
  enabled: 'enabled',
  triggerType: 'trigger_type',
  intervalSeconds: 'interval_seconds',
  cronExpression: 'cron_expression',
  runAt: 'run_at',
  timezone: 'timezone',
  startAt: 'start_at',
  endAt: 'end_at',
  maxExecutions: 'max_executions',
  agentId: 'agent_id',
  teamId: 'team_id',
  modelId: 'model_id',
  workspaceId: 'workspace_id',
  promptTemplate: 'prompt_template',
  timeoutSeconds: 'timeout_seconds',
  maxRetries: 'max_retries',
  retryDelaySeconds: 'retry_delay_seconds',
  retryBackoff: 'retry_backoff',
  concurrencyPolicy: 'concurrency_policy',
  tags: 'tags',
  historyRetentionDays: 'history_retention_days',
} satisfies Record<keyof ScheduleInput, string>

export class ApplicationScheduleAgentTools {
  constructor(
    private readonly tasks: ScheduledTaskService,
    private readonly onChanged?: SessionScheduleChangeHandler,
    private readonly readOptions?: () => Promise<ScheduleOptions>,
  ) {}

  async dispatch(
    operation: string,
    params: Record<string, unknown>,
    confirmOperation?: (message: string) => Promise<void>,
  ): Promise<unknown> {
    if (operation === 'export') {
      const { ids } = z
        .object({ ids: z.array(idSchema).min(1).max(100) })
        .strict()
        .parse(params)
      for (const id of ids) this.requireGlobalTask(id)
      const payload = this.tasks.exportTasks(ids)
      return {
        payload: {
          ...payload,
          tasks: payload.tasks.map((task) => ({
            ...task,
            notifications: [],
            permissionMode: 'auto',
            permissionProfileId: null,
          })),
        },
      }
    }
    if (operation === 'import_preview' || operation === 'import') {
      return this.importTasks(operation === 'import_preview', params, confirmOperation)
    }
    if (operation === 'options') {
      if (this.readOptions == null) throw new Error('Scheduling options are unavailable')
      return this.readOptions()
    }
    if (operation === 'list') {
      const { page, pageSize, ...filter } = listSchema.parse(params)
      const tasks = this.tasks.listTasks({
        scope: 'global',
        ...(filter.enabled !== undefined ? { enabled: filter.enabled } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
        ...(filter.query !== undefined ? { query: filter.query } : {}),
        ...(filter.tags !== undefined ? { tags: filter.tags } : {}),
      })
      return {
        tasks: tasks.slice((page - 1) * pageSize, page * pageSize).map((task) => ({
          id: task.id,
          name: task.name,
          scope: task.scope,
          enabled: task.enabled,
          status: task.status,
          triggerType: task.triggerType,
          timezone: task.timezone,
          nextRunAt: task.enabled ? task.nextRunAt : null,
          lastRunAt: task.lastRunAt,
          lastError: task.lastError,
          updatedAt: task.updatedAt,
        })),
        total: tasks.length,
        page,
        pageSize,
      }
    }
    if (operation === 'create') return { task: publicTask(await this.create(params)) }

    const { id, ...input } = params
    const task = this.requireGlobalTask(idSchema.parse(id))
    if (operation !== 'get' && /^dream-schedule-(memory|wiki)$/.test(task.id)) {
      throw new Error('Manage AutoDream schedules in the AutoDream settings')
    }
    switch (operation) {
      case 'get':
        return { task: publicTask(task) }
      case 'update':
        return { task: publicTask(await this.update(task, input)) }
      case 'delete': {
        const { expectedVersion } = z
          .object({ expectedVersion: z.string().length(64) })
          .strict()
          .parse(input)
        if (taskVersion(task) !== expectedVersion) {
          throw new Error('The task changed. Read its current details and confirm deletion again.')
        }
        if (task.currentExecutionId != null || task.status === 'running') {
          throw new Error('Wait for the scheduled task to finish before deleting it')
        }
        if (confirmOperation == null)
          throw new Error('An interactive deletion confirmation is required')
        await confirmOperation(
          `永久删除应用级定时任务「${task.name}」及其 ${task.executionCount} 次执行的关联历史？`,
        )
        if (taskVersion(this.requireGlobalTask(task.id)) !== expectedVersion) {
          throw new Error(
            'The task changed while awaiting approval. Read the latest task and retry.',
          )
        }
        if (!this.tasks.deleteTask(task.id)) throw new Error('Scheduled task no longer exists')
        this.onChanged?.('delete', task.id)
        return { success: true, id: task.id, name: task.name }
      }
      case 'run_now':
        return this.tasks.runNow(task.id).then((execution) => ({ execution }))
      case 'executions': {
        const { status, ...options } = executionsSchema.parse(input)
        return this.tasks.getExecutions(task.id, { ...options, ...(status ? { status } : {}) })
      }
      case 'execution_get': {
        const execution = this.tasks.getExecution(idSchema.parse(input.executionId))
        if (execution?.taskId !== task.id) throw new Error('Execution not found for this task')
        return { execution }
      }
      case 'stats':
        return { stats: this.tasks.getExecutionStats(task.id) }
      default:
        throw new Error('Unknown application schedule operation')
    }
  }

  private async importTasks(
    previewOnly: boolean,
    params: Record<string, unknown>,
    confirmOperation?: (message: string) => Promise<void>,
  ) {
    const { payload, mode } = z
      .object({
        payload: ScheduledTaskExportPayloadSchema,
        mode: z.enum(['merge', 'replace']).default('merge'),
      })
      .strict()
      .parse(params)
    const names = new Set<string>()
    for (const task of payload.tasks) {
      if (names.has(task.name)) throw new Error(`Duplicate import name: ${task.name}`)
      names.add(task.name)
      if (
        task.notifications.length > 0 ||
        task.permissionMode !== 'auto' ||
        task.permissionProfileId != null
      ) {
        throw new Error('Use desktop import for notification or custom permission settings')
      }
      validateSchedule(task)
      await this.validateOptions(task)
    }
    const readMatches = () =>
      this.tasks.listTasks({ scope: 'global' }).filter((task) => names.has(task.name))
    const matches = readMatches()
    const versions = new Map(matches.map((task) => [task.id, taskVersion(task)]))
    const collisions = matches.map(({ id, name }) => ({ id, name }))
    const existingNames = new Set(matches.map((task) => task.name))
    const toCreate = [...names].filter((name) => !existingNames.has(name))
    if (previewOnly) return { mode, toCreate, collisions }
    if (mode === 'replace' && matches.length > 0) {
      if (matches.length !== existingNames.size)
        throw new Error('Resolve duplicate task names before replacing')
      if (
        matches.some(
          (task) =>
            task.status === 'running' ||
            task.currentExecutionId != null ||
            task.notifications.length > 0 ||
            task.permissionMode !== 'auto' ||
            task.permissionProfileId != null ||
            /^dream-schedule-(memory|wiki)$/.test(task.id),
        )
      ) {
        throw new Error('Cannot replace running tasks or tasks with managed settings through chat')
      }
      if (confirmOperation == null)
        throw new Error('An interactive replacement confirmation is required')
      await confirmOperation(
        `覆盖 ${collisions.length} 条应用级定时任务（${collisions.map(({ name }) => name).join('、')}），并导入 ${toCreate.length} 条新任务？`,
      )
      const latest = readMatches()
      if (
        latest.length !== matches.length ||
        latest.some((task) => versions.get(task.id) !== taskVersion(task))
      ) {
        throw new Error('Matching tasks changed while awaiting approval. Run preview again.')
      }
    }
    const result = await this.tasks.importTasks(payload, mode)
    if (result.imported > 0) {
      for (const task of readMatches()) {
        const previous = versions.get(task.id)
        if (previous == null || previous !== taskVersion(task)) {
          this.onChanged?.(previous == null ? 'create' : 'update', task.id)
        }
      }
    }
    return result
  }

  private requireGlobalTask(id: string): ScheduledTaskItem {
    const task = this.tasks.getTask(id)
    if (task?.scope !== 'global') throw new Error(`Application scheduled task not found: ${id}`)
    return task
  }

  private async create(input: unknown): Promise<ScheduledTaskItem> {
    const parsed = createSchema.parse(input)
    validateSchedule(parsed)
    await this.validateOptions(parsed)
    const task = this.tasks.createTask({
      id: randomUUID(),
      scope: 'global',
      session_id: null,
      paused_by_archive: false,
      skip_if_session_running: true,
      continue_on_error: true,
      name: parsed.name.trim(),
      description: parsed.description ?? '',
      enabled: parsed.enabled !== false,
      trigger_type: parsed.triggerType,
      interval_seconds: parsed.intervalSeconds ?? null,
      cron_expression: parsed.cronExpression ?? null,
      run_at: parsed.runAt ?? null,
      timezone: parsed.timezone ?? 'system',
      start_at: parsed.startAt ?? null,
      end_at: parsed.endAt ?? null,
      max_executions: parsed.maxExecutions ?? 0,
      agent_id: parsed.agentId ?? null,
      team_id: parsed.teamId ?? null,
      model_id: parsed.modelId ?? null,
      workspace_id: parsed.workspaceId ?? null,
      prompt_template: parsed.promptTemplate,
      permission_mode: 'auto',
      permission_profile_id: null,
      timeout_seconds: parsed.timeoutSeconds ?? 300,
      max_retries: parsed.maxRetries ?? 0,
      retry_delay_seconds: parsed.retryDelaySeconds ?? 60,
      retry_backoff: parsed.retryBackoff ?? 'fixed',
      notifications: [],
      concurrency_policy: parsed.concurrencyPolicy ?? 'skip',
      tags: parsed.tags ?? [],
      history_retention_days: parsed.historyRetentionDays ?? 30,
    })
    this.onChanged?.('create', task.id)
    return task
  }

  private async update(task: ScheduledTaskItem, input: unknown): Promise<ScheduledTaskItem> {
    const { enabled, ...patch } = updateSchema.parse(input)
    const merged = {
      ...task,
      ...patch,
      name: patch.name ?? task.name,
      promptTemplate: patch.promptTemplate ?? task.promptTemplate,
      triggerType: patch.triggerType ?? task.triggerType,
    }
    const triggerChanged = [
      'triggerType',
      'intervalSeconds',
      'cronExpression',
      'runAt',
      'timezone',
      'startAt',
      'endAt',
    ].some((field) => Object.hasOwn(patch, field))
    if (triggerChanged || enabled === true) validateSchedule(merged)
    validateTaskText(merged)
    await this.validateOptions(patch)
    if (merged.agentId && merged.teamId && ('agentId' in patch || 'teamId' in patch)) {
      throw new Error('Select an agent or a team, and explicitly clear the other field')
    }
    if (taskVersion(this.requireGlobalTask(task.id)) !== taskVersion(task)) {
      throw new Error(
        'The task changed while validating the update. Read the latest task and retry.',
      )
    }
    const updateFields = Object.fromEntries(
      (Object.keys(patch) as Array<keyof typeof patch>).map((field) => [
        fields[field],
        patch[field],
      ]),
    )
    const updated = Object.keys(updateFields).length
      ? this.tasks.updateTask(task.id, updateFields)
      : task
    if (updated == null) throw new Error('Scheduled task no longer exists')
    const result =
      enabled === undefined || enabled === task.enabled
        ? updated
        : enabled
          ? this.tasks.enableTask(task.id)
          : this.tasks.disableTask(task.id)
    if (result == null) throw new Error('Scheduled task no longer exists')
    if (result !== task) this.onChanged?.('update', task.id)
    return result
  }

  private async validateOptions(
    input: Pick<ScheduleInput, 'agentId' | 'teamId' | 'modelId' | 'workspaceId'>,
  ): Promise<void> {
    if (input.agentId && input.teamId) throw new Error('Select an agent or a team, not both')
    if (
      this.readOptions == null ||
      !(input.agentId || input.teamId || input.modelId || input.workspaceId)
    )
      return
    const { agents, teams, models, workspaces } = await this.readOptions()
    if (input.agentId && !agents.some(({ id }) => id === input.agentId))
      throw new Error('Selected agent is unavailable')
    if (input.teamId && !teams.some(({ id }) => id === input.teamId))
      throw new Error('Selected team is unavailable')
    if (input.modelId && !models.some(({ id }) => id === input.modelId))
      throw new Error('Selected model is unavailable')
    if (input.workspaceId && !workspaces.some(({ id }) => id === input.workspaceId))
      throw new Error('Selected workspace is unavailable')
  }
}

function validateSchedule(input: ScheduleInput): void {
  validateTaskText(input)
  if (input.timezone != null && input.timezone !== 'system') {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone })
  }
  if (input.triggerType === 'interval' && input.intervalSeconds == null) {
    throw new Error('Interval schedules require intervalSeconds')
  }
  if (input.triggerType === 'cron') {
    const expression = input.cronExpression?.trim() ?? ''
    if (expression.split(/\s+/).length !== 5)
      throw new Error('Cron schedules require a five-field expression')
    CronExpressionParser.parse(
      expression,
      input.timezone && input.timezone !== 'system' ? { tz: input.timezone } : {},
    )
  }
  if (input.triggerType === 'once' && !(Date.parse(input.runAt ?? '') > Date.now())) {
    throw new Error('One-time schedules require a future runAt')
  }
  const start = input.startAt == null ? null : Date.parse(input.startAt)
  const end = input.endAt == null ? null : Date.parse(input.endAt)
  if ((start != null && !Number.isFinite(start)) || (end != null && !Number.isFinite(end))) {
    throw new Error('Schedule bounds must be valid timestamps')
  }
  if (start != null && end != null && start > end) throw new Error('startAt must precede endAt')
}

function validateTaskText(input: Pick<ScheduleInput, 'name' | 'promptTemplate'>): void {
  if (!input.name.trim() || !input.promptTemplate.trim())
    throw new Error('Name and prompt are required')
  if (/^\[dream:track=/.test(input.promptTemplate.trim()))
    throw new Error('Reserved AutoDream task prompt')
}

function taskVersion(task: ScheduledTaskItem): string {
  return createHash('sha256').update(JSON.stringify(task)).digest('hex')
}

function publicTask(item: ScheduledTaskItem) {
  const { notifications, ...task } = item
  return {
    ...task,
    nextRunAt: task.enabled ? task.nextRunAt : null,
    effectiveTimezone:
      task.timezone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : task.timezone,
    notificationCount: notifications.length,
    version: taskVersion(item),
  }
}
