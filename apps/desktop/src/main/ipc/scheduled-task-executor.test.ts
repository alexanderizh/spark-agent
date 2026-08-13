import { describe, expect, it, vi } from 'vitest'

import { runSessionScheduledTaskTurn } from './scheduled-task-executor.js'

describe('runSessionScheduledTaskTurn', () => {
  it('durably queues the prompt in the bound session without runtime overrides', async () => {
    const submitTurn = vi.fn(async () => ({ turnId: 'turn-1', accepted: true, started: false }))
    const onSessionCreated = vi.fn()

    const result = await runSessionScheduledTaskTurn(
      {
        sessionId: 'session-1',
        promptTemplate: 'Inspect the current repository state',
        onSessionCreated,
      },
      {
        getSession: () => ({ id: 'session-1', archived_at: null }),
        submitTurn,
      },
    )

    expect(submitTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: 'Inspect the current repository state',
      turnSource: 'scheduled_task',
      userMessageVisibility: 'hidden',
    })
    expect(onSessionCreated).toHaveBeenCalledWith('session-1')
    expect(result).toEqual({ sessionId: 'session-1', output: 'Turn turn-1 queued' })
  })

  it('rejects archived or missing target sessions', async () => {
    const submitTurn = vi.fn()

    await expect(
      runSessionScheduledTaskTurn(
        { sessionId: 'missing', promptTemplate: 'Run' },
        { getSession: () => null, submitTurn },
      ),
    ).rejects.toThrow('no longer exists')

    await expect(
      runSessionScheduledTaskTurn(
        { sessionId: 'archived', promptTemplate: 'Run' },
        {
          getSession: () => ({ id: 'archived', archived_at: '2026-08-01T08:00:00.000Z' }),
          submitTurn,
        },
      ),
    ).rejects.toThrow('is archived')
    expect(submitTurn).not.toHaveBeenCalled()
  })
})
