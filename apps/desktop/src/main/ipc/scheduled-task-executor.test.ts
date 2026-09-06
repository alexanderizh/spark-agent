import { describe, expect, it, vi } from 'vitest'

import { runSessionScheduledTaskTurn } from './scheduled-task-executor.js'
import { SCHEDULED_TASK_SESSION_TITLE_PREFIX } from '@spark/agent-runtime'

describe('runSessionScheduledTaskTurn', () => {
  it('durably queues the prompt in the bound session without runtime overrides', async () => {
    const submitTurn = vi.fn(async () => ({ turnId: 'turn-1', accepted: true, started: false }))
    const onSessionCreated = vi.fn()
    const renameSessionTitle = vi.fn()

    const result = await runSessionScheduledTaskTurn(
      {
        sessionId: 'session-1',
        promptTemplate: 'Inspect the current repository state',
        userMessageDisplayContent: 'Inspect the repository',
        onSessionCreated,
      },
      {
        getSession: () => ({ id: 'session-1', archived_at: null, title: '已有标题的会话' }),
        submitTurn,
        renameSessionTitle,
      },
    )

    expect(submitTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: 'Inspect the current repository state',
      turnSource: 'scheduled_task',
      userMessageVisibility: 'hidden',
      userMessageDisplayContent: 'Inspect the repository',
    })
    expect(onSessionCreated).toHaveBeenCalledWith('session-1')
    expect(renameSessionTitle).not.toHaveBeenCalled()
    expect(result).toEqual({ sessionId: 'session-1', output: 'Turn turn-1 queued' })
  })

  it('rejects archived or missing target sessions', async () => {
    const submitTurn = vi.fn()

    await expect(
      runSessionScheduledTaskTurn(
        { sessionId: 'missing', promptTemplate: 'Run', userMessageDisplayContent: 'Run' },
        { getSession: () => null, submitTurn },
      ),
    ).rejects.toThrow('no longer exists')

    await expect(
      runSessionScheduledTaskTurn(
        { sessionId: 'archived', promptTemplate: 'Run', userMessageDisplayContent: 'Run' },
        {
          getSession: () => ({
            id: 'archived',
            archived_at: '2026-08-01T08:00:00.000Z',
            title: '已归档会话',
          }),
          submitTurn,
        },
      ),
    ).rejects.toThrow('is archived')
    expect(submitTurn).not.toHaveBeenCalled()
  })

  it('derives the session title from the task prompt when the title is still a default', async () => {
    const submitTurn = vi.fn(async () => ({ turnId: 'turn-1', accepted: true, started: false }))
    const renameSessionTitle = vi.fn()

    await runSessionScheduledTaskTurn(
      {
        sessionId: 'session-1',
        promptTemplate: 'Inspect the current repository state',
        userMessageDisplayContent: '检查部署状态并汇报结果',
      },
      {
        getSession: () => ({ id: 'session-1', archived_at: null, title: '新会话' }),
        submitTurn,
        renameSessionTitle,
      },
    )

    expect(renameSessionTitle).toHaveBeenCalledWith(
      'session-1',
      `${SCHEDULED_TASK_SESSION_TITLE_PREFIX}检查部署状态并汇报结果`,
    )
  })

  it('replaces a synthetic title left by a parent scheduled task with the wake-up prompt title', async () => {
    const submitTurn = vi.fn(async () => ({ turnId: 'turn-1', accepted: true, started: false }))
    const renameSessionTitle = vi.fn()

    await runSessionScheduledTaskTurn(
      {
        sessionId: 'session-1',
        promptTemplate: 'Poll the deploy status',
        userMessageDisplayContent: '轮询发布流水线状态',
      },
      {
        getSession: () => ({ id: 'session-1', archived_at: null, title: '[⏰] 父定时任务' }),
        submitTurn,
        renameSessionTitle,
      },
    )

    expect(renameSessionTitle).toHaveBeenCalledWith(
      'session-1',
      `${SCHEDULED_TASK_SESSION_TITLE_PREFIX}轮询发布流水线状态`,
    )
  })

  it('skips retitling when the derived title matches or the prompt has no usable content', async () => {
    const submitTurn = vi.fn(async () => ({ turnId: 'turn-1', accepted: true, started: false }))
    const renameSessionTitle = vi.fn()

    await runSessionScheduledTaskTurn(
      {
        sessionId: 'session-1',
        promptTemplate: 'Inspect',
        userMessageDisplayContent: 'Inspect',
      },
      {
        getSession: () => ({ id: 'session-1', archived_at: null, title: '[⏰] Inspect' }),
        submitTurn,
        renameSessionTitle,
      },
    )

    await runSessionScheduledTaskTurn(
      {
        sessionId: 'session-2',
        promptTemplate: 'Inspect',
        userMessageDisplayContent: '',
      },
      {
        getSession: () => ({ id: 'session-2', archived_at: null, title: '新会话' }),
        submitTurn,
        renameSessionTitle,
      },
    )

    expect(renameSessionTitle).not.toHaveBeenCalled()
  })
})
