import { describe, expect, it, vi } from 'vitest'

import type { ScheduledTaskRow, TaskExecutionRow } from '@spark/storage'
import { ScheduledTaskService } from './scheduled-task.service.js'

function makeTask(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  const now = '2026-06-08T00:00:00.000Z'
  return {
    id: 'task-1',
    name: 'Daily Review',
    description: 'Scan recent changes',
    enabled: 1,
    trigger_type: 'interval',
    interval_seconds: 300,
    cron_expression: null,
    run_at: null,
    timezone: 'system',
    start_at: null,
    end_at: null,
    max_executions: 0,
    agent_id: 'agent-1',
    team_id: null,
    model_id: null,
    workspace_id: null,
    prompt_template: 'review the repo',
    permission_mode: 'ask',
    permission_profile_id: null,
    timeout_seconds: 60,
    max_retries: 0,
    retry_delay_seconds: 5,
    retry_backoff: 'fixed',
    notifications: '[]',
    concurrency_policy: 'skip',
    tags: '["review"]',
    history_retention_days: 30,
    status: 'idle',
    execution_count: 0,
    success_count: 0,
    failure_count: 0,
    last_run_at: null,
    next_run_at: '2026-06-08T00:05:00.000Z',
    last_error: null,
    current_execution_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeExecution(overrides: Partial<TaskExecutionRow> = {}): TaskExecutionRow {
  const now = '2026-06-08T00:00:00.000Z'
  return {
    id: 'execution-1',
    task_id: 'task-1',
    session_id: null,
    started_at: now,
    completed_at: null,
    duration_ms: null,
    status: 'running',
    output: null,
    error: null,
    token_usage: null,
    retry_attempt: 0,
    parent_execution_id: null,
    trigger_type: 'manual',
    created_at: now,
    ...overrides,
  }
}

function makeRepos() {
  const task = makeTask()
  const execution = makeExecution()

  const taskRepo = {
    listAll: vi.fn(() => [task]),
    get: vi.fn((id: string) => (id === task.id ? task : null)),
    create: vi.fn((params: Partial<ScheduledTaskRow>) => {
      Object.assign(task, params)
      return task
    }),
    update: vi.fn((id: string, params: Partial<ScheduledTaskRow>) => {
      if (id !== task.id) return null
      Object.assign(task, params)
      return task
    }),
    deleteById: vi.fn((id: string) => id === task.id),
    updateStatus: vi.fn((id: string, status: ScheduledTaskRow['status']) => {
      if (id === task.id) task.status = status
    }),
    setCurrentExecution: vi.fn((id: string, executionId: string | null) => {
      if (id === task.id) task.current_execution_id = executionId
    }),
    incrementExecutionCount: vi.fn((id: string, success: boolean) => {
      if (id !== task.id) return
      task.execution_count += 1
      if (success) task.success_count += 1
      else task.failure_count += 1
    }),
    setLastError: vi.fn((id: string, error: string | null) => {
      if (id === task.id) task.last_error = error
    }),
    findDueTasks: vi.fn<() => ScheduledTaskRow[]>(() => []),
  }

  const executionRepo = {
    create: vi.fn(() => execution),
    get: vi.fn((id: string) => (id === execution.id ? execution : null)),
    updateStatus: vi.fn((id: string, status: TaskExecutionRow['status'], params?: Record<string, unknown>) => {
      if (id !== execution.id) return
      execution.status = status
      if (params?.completedAt !== undefined) execution.completed_at = String(params.completedAt)
      if (params?.durationMs !== undefined) execution.duration_ms = Number(params.durationMs)
      if (params?.output !== undefined) execution.output = String(params.output)
      if (params?.sessionId !== undefined) execution.session_id = String(params.sessionId)
    }),
    findRunningByTaskId: vi.fn(() => []),
    findByTaskId: vi.fn(() => ({ executions: [execution], total: 1 })),
    cleanupOlderThan: vi.fn(() => 0),
    getStats: vi.fn(() => ({ total: 1, completed: 1, failed: 0, avgDurationMs: 1200, totalTokenUsage: 12 })),
  }

  return { task, execution, taskRepo, executionRepo }
}

describe('ScheduledTaskService', () => {
  it('lists, updates, runs, and deletes tasks through repositories', async () => {
    const { task, execution, taskRepo, executionRepo } = makeRepos()
    const executor = vi.fn(async (params: {
      onSessionCreated?: (sessionId: string) => void
    }) => {
      params.onSessionCreated?.('session-1')
      return {
        sessionId: 'session-1',
        output: 'done',
        tokenUsage: { total: 12 },
      }
    })

    const service = new ScheduledTaskService(taskRepo as never, executionRepo as never)
    service.setExecutor(executor)

    expect(service.listTasks()).toHaveLength(1)
    expect(service.getTask('task-1')?.name).toBe('Daily Review')

    const updated = service.updateTask('task-1', {
      name: 'Daily Review v2',
      prompt_template: 'review the repo carefully',
      interval_seconds: 600,
    })

    expect(updated?.name).toBe('Daily Review v2')
    expect(taskRepo.update).toHaveBeenCalledWith('task-1', expect.objectContaining({
      name: 'Daily Review v2',
      prompt_template: 'review the repo carefully',
      interval_seconds: 600,
    }))

    const manualExecution = await service.runNow('task-1')
    expect(manualExecution.taskId).toBe('task-1')
    await Promise.resolve()
    await Promise.resolve()

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      taskName: 'Daily Review v2',
      promptTemplate: expect.stringContaining('review the repo carefully'),
    }))
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      promptTemplate: expect.stringContaining("[Scheduled Task Context]"),
    }))
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      promptTemplate: expect.stringContaining('The schedule has already been configured. Do not ask the user what frequency, interval, cron, or timing to use.'),
    }))
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      promptTemplate: expect.stringContaining('Configured schedule: interval every 600 seconds'),
    }))
    expect(task.execution_count).toBe(1)
    expect(task.success_count).toBe(1)
    expect(execution.status).toBe('completed')

    expect(service.getExecutions('task-1').executions).toHaveLength(1)
    expect(service.getExecutionStats('task-1').completed).toBe(1)
    expect(service.deleteTask('task-1')).toBe(true)
  })

  it('uses the refreshed nextRunAt when building a scheduled execution prompt', async () => {
    const { task, taskRepo, executionRepo } = makeRepos()
    task.next_run_at = '2026-06-08T00:05:00.000Z'
    task.trigger_type = 'interval'
    task.interval_seconds = 300
    taskRepo.findDueTasks.mockReturnValue([task])

    const executor = vi.fn(async (params: {
      promptTemplate: string
      onSessionCreated?: (sessionId: string) => void
    }) => {
      params.onSessionCreated?.('session-2')
      return {
        sessionId: 'session-2',
        output: params.promptTemplate,
        tokenUsage: { total: 3 },
      }
    })

    const service = new ScheduledTaskService(taskRepo as never, executionRepo as never)
    service.setExecutor(executor)

    await (service as any).tick()
    await Promise.resolve()
    await Promise.resolve()

    expect(taskRepo.update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        next_run_at: expect.any(String),
      }),
    )

    const updatedNextRunAt = task.next_run_at
    expect(updatedNextRunAt).not.toBe('2026-06-08T00:05:00.000Z')
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      promptTemplate: expect.stringContaining(`Next scheduled run: ${updatedNextRunAt}`),
    }))
  })
})
