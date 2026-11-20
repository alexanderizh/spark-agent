import { createHash } from 'node:crypto'

import type { SessionRepository, SessionRow, WorkspaceRepository } from '@spark/storage'
import { z } from 'zod'

import {
  validateSessionTaskDefinition,
  type ScheduledTaskService,
} from '../scheduled-task.service.js'
import {
  SessionScheduleCreateInputSchema,
  SessionScheduleUpdateInputSchema,
  type SessionScheduleAgentTools,
} from '../session-schedule-agent-tools.js'
import type { SessionService } from '../session.service.js'
import { normalizeAgentAdapter } from './engine-kinds.js'

const id = z.string().trim().min(1).max(200)
const scope = { workspaceId: id.optional() }
const target = { ...scope, targetId: id }
const task = { ...target, id }
const pageSize = z.number().int().min(1).max(50).default(20)
const offset = z.number().int().min(0).max(100_000).default(0)
const newSessionSchema = z
  .object({
    ...scope,
    requestKey: id,
    title: z.string().trim().min(1).max(120),
    schedule: SessionScheduleCreateInputSchema,
  })
  .strict()

export class ProjectScheduleAgentTools {
  private readonly pending = new Map<string, { fingerprint: string; result: Promise<unknown> }>()

  constructor(
    private readonly sessions: SessionRepository,
    private readonly runtime: Pick<SessionService, 'createSession' | 'confirmScheduleOperation'>,
    private readonly schedules: SessionScheduleAgentTools,
    private readonly executions: ScheduledTaskService,
    private readonly onSessionCreated: (sessionId: string) => void,
    private readonly workspaces?: Pick<WorkspaceRepository, 'get'>,
  ) {}

  async dispatch(
    sourceId: string,
    operation: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const source = this.requireLocal(sourceId)
    const workspaceId = this.resolveWorkspace(source, id.optional().parse(input.workspaceId))
    const externalWorkspace =
      workspaceId != null && !this.sessions.getWorkspaceIdsFromRow(source).includes(workspaceId)
    const workspaceName =
      workspaceId == null ? '未分组' : (this.workspaces?.get(workspaceId)?.name ?? workspaceId)
    if (operation === 'new_session') {
      if (externalWorkspace) {
        const { title } = newSessionSchema.parse(input)
        await this.runtime.confirmScheduleOperation(
          sourceId,
          `允许在工作区「${workspaceName}」创建会话「${title}」并设置计划任务？`,
        )
        this.requireLocal(sourceId)
      }
      return this.createSession(source, workspaceId, input)
    }
    if (operation === 'list_sessions' || operation === 'list') {
      const parsed = z
        .object({ ...scope, query: z.string().trim().max(200).optional(), offset, pageSize })
        .strict()
        .parse(input)
      const listTasks = operation === 'list'
      if (listTasks || externalWorkspace) {
        const subject = listTasks ? '会话计划任务' : '会话候选'
        await this.runtime.confirmScheduleOperation(
          sourceId,
          `允许查看工作区「${workspaceName}」中的${subject}？`,
        )
        if (this.resolveWorkspace(this.requireLocal(sourceId), workspaceId) !== workspaceId) {
          throw new Error('Source workspace changed')
        }
      }
      const query = parsed.query?.toLowerCase()
      const candidates: SessionRow[] = []
      for (let index = 0; ; index += 100) {
        const { sessions, total } = this.sessions.list({
          ...(workspaceId ? { workspaceId } : { projectId: 'default' }),
          limit: 100,
          offset: index,
        })
        for (const row of sessions) {
          if (
            this.isLocal(row) &&
            (workspaceId || this.sessions.getWorkspaceIdsFromRow(row).length === 0) &&
            (!query || row.title.toLowerCase().includes(query))
          )
            candidates.push(row)
        }
        if (sessions.length === 0 || index + sessions.length >= total) break
      }
      return {
        workspaceId: workspaceId ?? null,
        total: candidates.length,
        offset: parsed.offset,
        pageSize: parsed.pageSize,
        sessions: candidates.slice(parsed.offset, parsed.offset + parsed.pageSize).map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          ...(listTasks ? { tasks: this.schedules.list(row.id) } : {}),
        })),
      }
    }

    const targetId = id.parse(input.targetId)
    const row = this.requireTarget(sourceId, workspaceId, targetId)
    const label = `会话「${row.title}」（${workspaceName}）`
    const approve = async (message: string) => {
      await this.runtime.confirmScheduleOperation(sourceId, message)
      this.requireTarget(sourceId, workspaceId, targetId)
    }
    switch (operation) {
      case 'list_target': {
        z.object(target).strict().parse(input)
        await approve(`允许查看${label}的计划任务？`)
        return { session: { id: row.id, title: row.title }, tasks: this.schedules.list(row.id) }
      }
      case 'create': {
        const parsed = z
          .object({ ...target, schedule: SessionScheduleCreateInputSchema })
          .strict()
          .parse(input)
        validateCreate(parsed.schedule)
        await approve(`允许在${label}创建计划任务「${parsed.schedule.name}」？`)
        return { task: this.schedules.create(targetId, parsed.schedule) }
      }
      case 'update': {
        const parsed = z
          .object({ ...task, patch: SessionScheduleUpdateInputSchema })
          .strict()
          .parse(input)
        const previous = this.schedules.get(targetId, parsed.id)
        await approve(`允许修改${label}中的计划任务「${previous.name}」？`)
        this.requireUnchanged(targetId, previous)
        return { task: this.schedules.update(targetId, parsed.id, parsed.patch) }
      }
      case 'delete': {
        const parsed = z.object(task).strict().parse(input)
        const previous = this.schedules.get(targetId, parsed.id)
        await approve(`删除${label}中的计划任务「${previous.name}」及其执行历史？`)
        const current = this.requireUnchanged(targetId, previous)
        if (current.currentExecutionId != null || current.status === 'running') {
          throw new Error('Wait for the scheduled task to finish before deleting it')
        }
        return this.schedules.delete(targetId, parsed.id)
      }
      case 'run_now': {
        const parsed = z.object(task).strict().parse(input)
        const previous = this.schedules.get(targetId, parsed.id)
        await approve(`立即运行${label}中的计划任务「${previous.name}」？`)
        this.requireUnchanged(targetId, previous)
        return { execution: await this.executions.runNow(parsed.id) }
      }
      case 'executions': {
        const parsed = z
          .object({
            ...task,
            page: z.number().int().min(1).max(100_000).default(1),
            pageSize,
            status: z.enum(['running', 'completed', 'failed', 'cancelled', 'timeout']).optional(),
          })
          .strict()
          .parse(input)
        await approve(`允许查看${label}中的计划任务执行历史？`)
        this.schedules.get(targetId, parsed.id)
        return this.executions.getExecutions(parsed.id, {
          page: parsed.page,
          pageSize: parsed.pageSize,
          ...(parsed.status ? { status: parsed.status } : {}),
        })
      }
      default:
        throw new Error('Unknown project schedule operation')
    }
  }

  private requireUnchanged(
    targetId: string,
    previous: ReturnType<SessionScheduleAgentTools['get']>,
  ) {
    const current = this.schedules.get(targetId, previous.id)
    if (JSON.stringify(current) !== JSON.stringify(previous)) {
      throw new Error('The task changed while awaiting approval. Read the latest task and retry.')
    }
    return current
  }

  private isLocal(row: SessionRow): boolean {
    if (row.kind !== 'agent' || row.archived_at != null) return false
    const metadata = this.sessions.getMetadata(row.id)
    return metadata.remoteAgentLinkId == null && metadata.remoteAgentTaskId == null
  }

  private requireLocal(sessionId: string): SessionRow {
    const row = this.sessions.get(sessionId)
    if (row == null || !this.isLocal(row))
      throw new Error('An active local agent session is required')
    return row
  }

  private resolveWorkspace(source: SessionRow, requested?: string): string | undefined {
    const workspaces = this.sessions.getWorkspaceIdsFromRow(source)
    if (requested != null && !workspaces.includes(requested)) {
      const workspace = this.workspaces?.get(requested)
      if (workspace == null || workspace.archived_at != null)
        throw new Error('Selected workspace is unavailable')
    }
    if (requested == null && workspaces.length > 1)
      throw new Error('Choose a workspace attached to the current session')
    return requested ?? workspaces[0]
  }

  private requireTarget(
    sourceId: string,
    workspaceId: string | undefined,
    targetId: string,
  ): SessionRow {
    const source = this.requireLocal(sourceId)
    if (this.resolveWorkspace(source, workspaceId) !== workspaceId)
      throw new Error('Source workspace changed')
    const row = this.requireLocal(targetId)
    const targetWorkspaces = this.sessions.getWorkspaceIdsFromRow(row)
    if (
      workspaceId
        ? !targetWorkspaces.includes(workspaceId)
        : targetWorkspaces.length > 0 || row.project_id !== 'default'
    ) {
      throw new Error('Target session is outside the selected workspace')
    }
    return row
  }

  private async createSession(
    source: SessionRow,
    workspaceId: string | undefined,
    input: Record<string, unknown>,
  ) {
    const parsed = newSessionSchema.parse(input)
    const targetId = stableId('session', source.id, parsed.requestKey)
    const taskId = stableId('task', source.id, parsed.requestKey)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([workspaceId ?? null, parsed.title, parsed.schedule]))
      .digest('hex')
    const existing = this.pending.get(targetId)
    if (existing != null) {
      if (existing.fingerprint !== fingerprint)
        throw new Error('Request key already used with different parameters')
      return existing.result
    }
    const result = this.createSessionOnce(
      source,
      workspaceId,
      parsed,
      targetId,
      taskId,
      fingerprint,
    )
    this.pending.set(targetId, { result, fingerprint })
    try {
      return await result
    } finally {
      this.pending.delete(targetId)
    }
  }

  private async createSessionOnce(
    source: SessionRow,
    workspaceId: string | undefined,
    input: z.infer<typeof newSessionSchema>,
    targetId: string,
    taskId: string,
    fingerprint: string,
  ) {
    const existing = this.sessions.get(targetId)
    if (existing != null) {
      this.requireTarget(source.id, workspaceId, targetId)
      if (this.sessions.getMetadata(targetId).dispatchFingerprint !== fingerprint) {
        throw new Error('Request key already used with different parameters')
      }
      const prior = this.executions.getTask(taskId)
      if (prior != null) return { sessionId: targetId, task: this.schedules.get(targetId, taskId) }
      if (this.sessions.getMetadata(targetId).scheduledCreateCompleted === true) {
        return {
          sessionId: targetId,
          task: null,
          error: 'The previously created task has since been removed',
        }
      }
    }
    validateCreate(input.schedule)
    if (existing == null) {
      const adapter = normalizeAgentAdapter(source.agent_adapter)
      const permissionMode =
        adapter === 'codex' ? 'codex-default' : adapter === 'spark' ? 'spark-default' : 'claude-ask'
      try {
        await this.runtime.createSession(
          {
            title: input.title,
            providerProfileId: source.provider_profile_id ?? '',
            ...(source.model_id != null ? { modelId: source.model_id } : {}),
            ...(source.agent_id ? { agentId: source.agent_id } : {}),
            ...(workspaceId ? { workspaceId } : {}),
            agentAdapter: adapter,
            permissionMode,
            workflowBinding: { mode: 'disabled' },
          },
          { sessionId: targetId, dispatchFingerprint: fingerprint, origin: 'scheduled-task' },
        )
      } catch (error) {
        if (this.sessions.getMetadata(targetId).dispatchFingerprint !== fingerprint) throw error
      }
      try {
        this.onSessionCreated(targetId)
      } catch {
        // The persisted session will appear on the next list refresh.
      }
    }
    try {
      this.requireTarget(source.id, workspaceId, targetId)
      const result = this.schedules.create(targetId, input.schedule, taskId)
      this.sessions.patchMetadata(targetId, { scheduledCreateCompleted: true })
      return { sessionId: targetId, task: result }
    } catch (error) {
      const persisted = this.executions.getTask(taskId)
      if (persisted?.sessionId === targetId) return { sessionId: targetId, task: persisted }
      return {
        sessionId: targetId,
        task: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function validateCreate(input: z.infer<typeof SessionScheduleCreateInputSchema>) {
  if (/^\[dream:track=/.test(input.promptTemplate.trim()))
    throw new Error('Reserved AutoDream task prompt')
  validateSessionTaskDefinition({
    name: input.name,
    prompt_template: input.promptTemplate,
    trigger_type: input.triggerType,
    timezone: input.timezone ?? 'system',
    interval_seconds: input.intervalSeconds ?? null,
    cron_expression: input.cronExpression ?? null,
    run_at: input.runAt ?? null,
  })
}

function stableId(kind: string, sourceId: string, key: string): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify(['project-schedule', kind, sourceId, key]))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x80
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
