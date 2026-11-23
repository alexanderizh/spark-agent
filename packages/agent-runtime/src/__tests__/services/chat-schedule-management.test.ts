import { resolve } from 'node:path'

import {
  ScheduledTaskRepository,
  SessionRepository,
  SparkDatabase,
  TaskExecutionRepository,
} from '@spark/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationScheduleAgentTools } from '../../services/application-schedule-agent-tools.js'
import { ScheduledTaskService } from '../../services/scheduled-task.service.js'
import { SessionScheduleAgentTools } from '../../services/session-schedule-agent-tools.js'
import { ProjectScheduleAgentTools } from '../../services/session/project-schedule-agent-tools.js'
import { assertSessionWorkflowBindingCreationReady } from '../../services/workflow/session-workflow-creation.js'
import type { SessionService } from '../../services/session.service.js'

const schedule = {
  name: 'Daily brief',
  triggerType: 'interval' as const,
  intervalSeconds: 7200,
  promptTemplate: 'Summarize updates',
}

let db: SparkDatabase
let tasks: ScheduledTaskService
let sessions: SessionRepository
let current: SessionScheduleAgentTools
const changed = vi.fn()

beforeEach(() => {
  db = new SparkDatabase(':memory:')
  db.runMigrations(resolve(import.meta.dirname, '../../../../storage/migrations'))
  tasks = new ScheduledTaskService(new ScheduledTaskRepository(db), new TaskExecutionRepository(db))
  sessions = new SessionRepository(db)
  current = new SessionScheduleAgentTools(tasks, changed)
  changed.mockClear()
})

afterEach(() => db?.close())

function addSession(id: string, workspaceId = 'project-1', title = id) {
  return sessions.create({
    id,
    title,
    kind: 'agent',
    status: 'idle',
    projectId: workspaceId,
    workspaceIds: [workspaceId],
  })
}

function projectTools() {
  const createSession = vi.fn<SessionService['createSession']>(async (params, origin) => {
    if (origin == null) throw new Error('Expected a stable identity for the new session')
    assertSessionWorkflowBindingCreationReady(db, params.workflowBinding, params.agentId, {
      scheduledTaskSession: origin.origin === 'scheduled-task',
    })
    addSession(origin.sessionId, params.workspaceId, params.title)
    sessions.patchMetadata(origin.sessionId, { dispatchFingerprint: origin.dispatchFingerprint })
    return { sessionId: origin.sessionId } as Awaited<ReturnType<SessionService['createSession']>>
  })
  const confirm = vi.fn<SessionService['confirmScheduleOperation']>(async () => {})
  const created = vi.fn()
  return {
    tools: new ProjectScheduleAgentTools(
      sessions,
      { createSession, confirmScheduleOperation: confirm },
      current,
      tasks,
      created,
    ),
    confirm,
    createSession,
    created,
  }
}

describe('chat scheduled tasks through the shared scheduler', () => {
  it('persists global tasks, respects scope, and gates deletion against the current version', async () => {
    addSession('source')
    const sessionTask = current.create('source', schedule)
    const app = new ApplicationScheduleAgentTools(tasks, changed)
    const result = (await app.dispatch('create', {
      ...schedule,
      enabled: false,
      tags: ['chat'],
    })) as {
      task: { id: string; version: string }
    }
    const { id, version } = result.task
    expect(tasks.getTask(id)).toMatchObject({
      scope: 'global',
      sessionId: null,
      enabled: false,
      tags: ['chat'],
      nextRunAt: null,
    })
    await expect(app.dispatch('list', {})).resolves.toMatchObject({ tasks: [{ id }], total: 1 })
    await expect(
      app.dispatch('update', { id: sessionTask.id, name: 'wrong scope' }),
    ).rejects.toThrow('not found')
    await expect(
      app.dispatch('create', { ...schedule, workspaceId: 'any', scope: 'session' }),
    ).rejects.toThrow()
    await expect(
      app.dispatch('create', { ...schedule, triggerType: 'cron', cronExpression: '61 * * * *' }),
    ).rejects.toThrow()

    await app.dispatch('update', { id, enabled: true, description: 'Updated' })
    expect(tasks.getTask(id)).toMatchObject({
      enabled: true,
      intervalSeconds: 7200,
      status: 'idle',
      nextRunAt: expect.any(String),
    })
    const approved = vi.fn(async () => {})
    await expect(
      app.dispatch('delete', { id, expectedVersion: version }, approved),
    ).rejects.toThrow('changed')
    expect(approved).not.toHaveBeenCalled()
    const latest = (await app.dispatch('get', { id })) as { task: { version: string } }
    await expect(
      app.dispatch('delete', { id, expectedVersion: latest.task.version }),
    ).rejects.toThrow('confirmation')
    await app.dispatch('delete', { id, expectedVersion: latest.task.version }, approved)
    expect(tasks.getTask(id)).toBeNull()
    expect(tasks.getTask(sessionTask.id)).not.toBeNull()
    expect(changed).toHaveBeenCalledWith('delete', id)
  })

  it('recomputes Cron schedules after timezone-only updates and isolates execution history', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T01:00:00Z'))
    try {
      const app = new ApplicationScheduleAgentTools(tasks)
      const { task } = (await app.dispatch('create', {
        ...schedule,
        triggerType: 'cron',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
      })) as { task: { id: string; nextRunAt: string } }
      expect(task.nextRunAt).toBe('2026-11-20 09:00:00')
      await expect(
        app.dispatch('update', { id: task.id, timezone: 'Asia/Shanghai' }),
      ).resolves.toMatchObject({ task: { nextRunAt: '2026-11-21 01:00:00' } })
      addSession('source')
      const bound = current.create('source', schedule)
      const executions = new TaskExecutionRepository(db)
      executions.create({ id: 'a-bound-execution', task_id: bound.id, trigger_type: 'manual' })
      await expect(
        app.dispatch('execution_get', { id: task.id, executionId: 'a-bound-execution' }),
      ).rejects.toThrow('not found')
      await expect(app.dispatch('executions', { id: task.id })).resolves.toMatchObject({
        executions: [],
        total: 0,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs a persisted application task through the injected executor and returns its recorded history', async () => {
    const app = new ApplicationScheduleAgentTools(tasks)
    const executor = vi.fn(
      async (input: Parameters<Parameters<ScheduledTaskService['setExecutor']>[0]>[0]) => {
        input.onSessionCreated?.('scheduled-run')
        return { sessionId: 'scheduled-run', output: 'Ran the brief' }
      },
    )
    tasks.setExecutor(executor)
    const { task } = (await app.dispatch('create', schedule)) as { task: { id: string } }
    await expect(app.dispatch('run_now', { id: task.id })).resolves.toMatchObject({
      execution: { taskId: task.id, sessionId: 'scheduled-run' },
    })
    await vi.waitFor(async () => {
      await expect(
        app.dispatch('executions', { id: task.id, status: 'completed' }),
      ).resolves.toMatchObject({ total: 1, executions: [{ output: 'Ran the brief' }] })
    })
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: null,
        userMessageDisplayContent: schedule.promptTemplate,
      }),
    )
  })

  it('reuses the desktop export format, previews collisions and confirms replacement', async () => {
    const app = new ApplicationScheduleAgentTools(tasks)
    const { task } = (await app.dispatch('create', {
      ...schedule,
      enabled: false,
      tags: ['chat'],
    })) as { task: { id: string } }
    const { payload } = (await app.dispatch('export', { ids: [task.id] })) as {
      payload: import('@spark/protocol').ScheduledTaskExportPayload
    }
    expect(payload.tasks[0]).toMatchObject({ enabled: false, tags: ['chat'], notifications: [] })
    await expect(
      app.dispatch('import_preview', { mode: 'replace', payload }),
    ).resolves.toMatchObject({ collisions: [{ id: task.id, name: schedule.name }] })
    const importedPayload = {
      ...payload,
      tasks: payload.tasks.map((entry) => ({
        ...entry,
        intervalSeconds: 3600,
        tags: ['replacement'],
      })),
    }
    await expect(
      app.dispatch('import', { mode: 'replace', payload: importedPayload }),
    ).rejects.toThrow('confirmation')
    const confirm = vi.fn(async () => {})
    await expect(
      app.dispatch('import', { mode: 'replace', payload: importedPayload }, confirm),
    ).resolves.toMatchObject({ imported: 1 })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(tasks.getTask(task.id)).toMatchObject({
      enabled: false,
      tags: ['replacement'],
      intervalSeconds: 3600,
    })
    await expect(
      app.dispatch('import', {
        payload: {
          ...payload,
          tasks: payload.tasks.map((entry) => ({ ...entry, name: 'Imported' })),
        },
      }),
    ).resolves.toMatchObject({ imported: 1 })
    expect(tasks.listTasks({ query: 'Imported' })).toEqual([
      expect.objectContaining({ enabled: false, tags: ['chat'] }),
    ])
  })

  it('discovers only local project candidates and requires real authorization for cross-session mutations', async () => {
    addSession('source')
    addSession('target', 'project-1', 'Version checks')
    addSession('different-project', 'project-2', 'Version checks')
    addSession('remote', 'project-1', 'Version checks')
    sessions.patchMetadata('remote', { remoteAgentLinkId: 'remote-link' })
    const { tools, confirm } = projectTools()
    await expect(
      tools.dispatch('source', 'list_sessions', { query: 'version' }),
    ).resolves.toMatchObject({
      total: 1,
      sessions: [{ id: 'target', title: 'Version checks' }],
    })
    await expect(
      tools.dispatch('source', 'create', { targetId: 'different-project', schedule }),
    ).rejects.toThrow('outside')
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRejectedValueOnce(new Error('declined'))
    await expect(
      tools.dispatch('source', 'create', { targetId: 'target', schedule }),
    ).rejects.toThrow('declined')
    expect(current.list('target')).toEqual([])
    const { task } = (await tools.dispatch('source', 'create', {
      targetId: 'target',
      schedule,
    })) as { task: { id: string } }
    await expect(
      tools.dispatch('source', 'update', {
        targetId: 'target',
        id: task.id,
        patch: { enabled: false },
      }),
    ).resolves.toMatchObject({ task: { enabled: false } })
    await expect(tools.dispatch('source', 'list', {})).resolves.toMatchObject({
      sessions: expect.arrayContaining([
        {
          id: 'target',
          title: 'Version checks',
          status: 'idle',
          tasks: [expect.objectContaining({ id: task.id })],
        },
      ]),
    })
    await tools.dispatch('source', 'delete', { targetId: 'target', id: task.id })
    expect(current.list('target')).toEqual([])
  })

  it('creates an empty session and only one task even after concurrent retries', async () => {
    addSession('source')
    const { tools, createSession, created } = projectTools()
    const request = { requestKey: 'checks-on-friday', title: 'Version checks', schedule }
    await expect(
      tools.dispatch('source', 'new_session', {
        ...request,
        schedule: { ...schedule, intervalSeconds: 5 },
      }),
    ).rejects.toThrow()
    expect(createSession).not.toHaveBeenCalled()
    const [a, b] = await Promise.all([
      tools.dispatch('source', 'new_session', request),
      tools.dispatch('source', 'new_session', request),
    ])
    expect(a).toEqual(b)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(created).toHaveBeenCalledTimes(1)
    const { sessionId, task } = a as { sessionId: string; task: { id: string } }
    expect(sessions.get(sessionId)).toMatchObject({ title: request.title, turn_count: 0 })
    expect(current.list(sessionId)).toHaveLength(1)
    await expect(tools.dispatch('source', 'new_session', request)).resolves.toEqual(a)
    await expect(
      tools.dispatch('source', 'new_session', { ...request, title: 'Different' }),
    ).rejects.toThrow('different parameters')
    current.delete(sessionId, task.id)
    await expect(tools.dispatch('source', 'new_session', request)).resolves.toMatchObject({
      sessionId,
      task: null,
    })
    expect(current.list(sessionId)).toHaveLength(0)
  })
})
