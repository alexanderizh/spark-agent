import type { ScheduledTaskItem } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'

import { SessionScheduleAgentTools } from './session-schedule-agent-tools.js'

function makeTask(overrides: Partial<ScheduledTaskItem> = {}): ScheduledTaskItem {
  return {
    id: 'task-current',
    name: 'Poll vendor result',
    description: '',
    enabled: true,
    scope: 'session',
    sessionId: 'session-current',
    pausedByArchive: false,
    triggerType: 'interval',
    intervalSeconds: 300,
    cronExpression: null,
    runAt: null,
    timezone: 'system',
    startAt: null,
    endAt: null,
    maxExecutions: 0,
    agentId: null,
    teamId: null,
    modelId: null,
    workspaceId: null,
    promptTemplate: 'Check whether the vendor job is complete.',
    permissionMode: 'auto',
    permissionProfileId: null,
    timeoutSeconds: 300,
    maxRetries: 0,
    retryDelaySeconds: 60,
    retryBackoff: 'fixed',
    notifications: [],
    concurrencyPolicy: 'queue',
    tags: [],
    historyRetentionDays: 30,
    status: 'idle',
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRunAt: null,
    nextRunAt: '2026-08-04 10:05:00',
    lastError: null,
    currentExecutionId: null,
    createdAt: '2026-08-04 10:00:00',
    updatedAt: '2026-08-04 10:00:00',
    ...overrides,
  }
}

function makeService() {
  const current = makeTask()
  const other = makeTask({ id: 'task-other', sessionId: 'session-other' })
  const global = makeTask({ id: 'task-global', scope: 'global', sessionId: null })
  return {
    current,
    other,
    global,
    service: {
      listTasks: vi.fn(() => [current]),
      getTask: vi.fn((id: string) =>
        id === current.id ? current : id === other.id ? other : id === global.id ? global : null,
      ),
      createTask: vi.fn(() => current),
      updateTask: vi.fn(() => current),
      enableTask: vi.fn(() => current),
      disableTask: vi.fn(() => current),
      deleteTask: vi.fn(() => true),
    },
  }
}

describe('SessionScheduleAgentTools', () => {
  it('creates a task bound to the current session without runtime snapshots', () => {
    const { service, current } = makeService()
    const onChanged = vi.fn()
    const tools = new SessionScheduleAgentTools(service as never, onChanged)

    const task = tools.create('session-current', {
      name: 'Poll vendor result',
      promptTemplate: 'Check the vendor result; delete this task after completion.',
      triggerType: 'interval',
      intervalSeconds: 300,
    })

    expect(task).toBe(current)
    expect(service.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'session',
        session_id: 'session-current',
        agent_id: null,
        model_id: null,
        workspace_id: null,
        concurrency_policy: 'queue',
      }),
    )
    expect(onChanged).toHaveBeenCalledWith('create', current.id)
  })

  it('limits list/get/update/delete to tasks owned by the current session', () => {
    const { service, current } = makeService()
    const onChanged = vi.fn()
    const tools = new SessionScheduleAgentTools(service as never, onChanged)

    expect(tools.list('session-current')).toEqual([current])
    expect(service.listTasks).toHaveBeenCalledWith({
      scope: 'session',
      sessionId: 'session-current',
    })
    expect(tools.get('session-current', current.id)).toBe(current)

    tools.update('session-current', current.id, { enabled: false, intervalSeconds: 600 })
    expect(service.updateTask).toHaveBeenCalledWith(current.id, {
      interval_seconds: 600,
    })
    expect(service.disableTask).toHaveBeenCalledWith(current.id)
    expect(onChanged).toHaveBeenCalledWith('update', current.id)

    tools.update('session-current', current.id, { enabled: true })
    expect(service.enableTask).toHaveBeenCalledWith(current.id)

    expect(tools.delete('session-current', current.id)).toEqual({ success: true })
    expect(onChanged).toHaveBeenCalledWith('delete', current.id)

    expect(() => tools.get('session-current', 'task-other')).toThrow('not found')
    expect(() => tools.get('session-current', 'task-global')).toThrow('not found')
    expect(() => tools.update('session-current', 'task-other', { enabled: false })).toThrow(
      'not found',
    )
    expect(() => tools.delete('session-current', 'task-other')).toThrow('not found')
    expect(() => tools.list('   ')).toThrow('Current session id is unavailable')
  })

  it('rejects malformed or out-of-contract task fields before persistence', () => {
    const { service } = makeService()
    const tools = new SessionScheduleAgentTools(service as never)

    expect(() =>
      tools.create('session-current', {
        name: 'Too frequent',
        promptTemplate: 'Check progress.',
        triggerType: 'interval',
        intervalSeconds: 1,
      }),
    ).toThrow()
    expect(() =>
      tools.update('session-current', 'task-current', {
        concurrencyPolicy: 'parallel' as never,
      }),
    ).toThrow()
    expect(service.createTask).not.toHaveBeenCalled()
    expect(service.updateTask).not.toHaveBeenCalled()
  })
})
