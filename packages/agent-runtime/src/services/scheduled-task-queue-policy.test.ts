/**
 * 定时任务 concurrency_policy='queue' 串行化语义测试（M0 修复）。
 *
 * 修复前（存量 bug）：'queue' 注释写排队，实际「照样启动新执行」——同一任务
 * 并发叠跑。修复后：上一执行仍在运行时不创建新 execution、不推进
 * next_run_at，保持 due 状态等下次 tick 重查（运行结束后立即接上）。
 */
import { describe, expect, it, vi } from 'vitest'

import type { ScheduledTaskRow, TaskExecutionRow } from '@spark/storage'
import { ScheduledTaskService } from './scheduled-task.service.js'

function makeTask(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  const now = '2026-06-08T00:00:00.000Z'
  return {
    id: 'task-1',
    name: 'Queued Task',
    description: '',
    enabled: 1,
    scope: 'global',
    session_id: null,
    paused_by_archive: 0,
    skip_if_session_running: 0,
    continue_on_error: 1,
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
    prompt_template: 'do work',
    permission_mode: 'ask',
    permission_profile_id: null,
    timeout_seconds: 60,
    max_retries: 0,
    retry_delay_seconds: 5,
    retry_backoff: 'fixed',
    notifications: '[]',
    concurrency_policy: 'queue',
    tags: '[]',
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

function makeRunningExecution(): TaskExecutionRow {
  const now = '2026-06-08T00:04:00.000Z'
  return {
    id: 'execution-running',
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
    trigger_type: 'scheduled',
    created_at: now,
  }
}

function makeRepos() {
  const task = makeTask()
  const execution = makeRunningExecution()
  const taskRepo = {
    get: vi.fn((id: string) => (id === task.id ? task : null)),
    update: vi.fn((id: string, params: Partial<ScheduledTaskRow>) => {
      if (id !== task.id) return null
      Object.assign(task, params)
      return task
    }),
    updateStatus: vi.fn(),
    setCurrentExecution: vi.fn(),
    findDueTasks: vi.fn<() => ScheduledTaskRow[]>(() => []),
  }
  const executionRepo = {
    create: vi.fn(() => execution),
    findRunningByTaskId: vi.fn<() => TaskExecutionRow[]>(() => []),
    updateStatus: vi.fn(),
  }
  return { task, execution, taskRepo, executionRepo }
}

describe("concurrency_policy='queue' 串行排队语义", () => {
  it('上一执行仍在运行：不创建新 execution、不推进 next_run_at（保持 due 等下次 tick）', async () => {
    const { task, taskRepo, executionRepo } = makeRepos()
    executionRepo.findRunningByTaskId.mockReturnValue([makeRunningExecution()])
    const executor = vi.fn()
    const service = new ScheduledTaskService(taskRepo as never, executionRepo as never)
    service.setExecutor(executor)
    taskRepo.findDueTasks.mockReturnValue([task])
    const nextRunBefore = task.next_run_at

    await (service as unknown as { tick(): Promise<void> }).tick()

    expect(executor).not.toHaveBeenCalled()
    expect(executionRepo.create).not.toHaveBeenCalled()
    // 关键断言：next_run_at 未被推进（'queue' 排队 = 保持 due，运行结束后立即接上；
    // 若推进则本轮执行被静默丢弃，等于变相 skip）
    expect(task.next_run_at).toBe(nextRunBefore)
  })

  it('运行结束后：下次 tick 正常启动排队中的执行', async () => {
    const { task, taskRepo, executionRepo } = makeRepos()
    let running: TaskExecutionRow[] = [makeRunningExecution()]
    executionRepo.findRunningByTaskId.mockImplementation(() => running)
    const executor = vi.fn(async () => ({ output: 'done' }))
    const service = new ScheduledTaskService(taskRepo as never, executionRepo as never)
    service.setExecutor(executor)
    taskRepo.findDueTasks.mockReturnValue([task])

    // 第一轮 tick：排队（不启动）
    await (service as unknown as { tick(): Promise<void> }).tick()
    expect(executor).not.toHaveBeenCalled()

    // 上一执行完成 → 第二轮 tick 启动
    running = []
    await (service as unknown as { tick(): Promise<void> }).tick()
    await vi.waitFor(() => expect(executor).toHaveBeenCalledOnce())
    expect(executionRepo.create).toHaveBeenCalledTimes(1)
  })

  it("'skip' 语义不受影响：运行中直接推进 next_run_at", async () => {
    const { task, taskRepo, executionRepo } = makeRepos()
    task.concurrency_policy = 'skip'
    executionRepo.findRunningByTaskId.mockReturnValue([makeRunningExecution()])
    const executor = vi.fn()
    const service = new ScheduledTaskService(taskRepo as never, executionRepo as never)
    service.setExecutor(executor)
    taskRepo.findDueTasks.mockReturnValue([task])

    await (service as unknown as { tick(): Promise<void> }).tick()

    expect(executor).not.toHaveBeenCalled()
    expect(executionRepo.create).not.toHaveBeenCalled()
    expect(taskRepo.update).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ next_run_at: expect.any(String) }),
    )
  })
})
