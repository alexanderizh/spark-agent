import { describe, expect, it } from 'vitest'
import type { ScheduledTaskItem } from '@spark/protocol'

import { buildSessionScheduleSummaries } from './session-schedule-summary'

describe('buildSessionScheduleSummaries', () => {
  it('counts attached and enabled tasks per session while ignoring global tasks', () => {
    const tasks = [
      { id: 'task-a1', scope: 'session', sessionId: 'session-a', enabled: true },
      { id: 'task-a2', scope: 'session', sessionId: 'session-a', enabled: false },
      { id: 'task-b1', scope: 'session', sessionId: 'session-b', enabled: false },
      { id: 'task-global', scope: 'global', sessionId: null, enabled: true },
    ] as ScheduledTaskItem[]

    expect(buildSessionScheduleSummaries(tasks)).toEqual({
      'session-a': { total: 2, enabled: 1 },
      'session-b': { total: 1, enabled: 0 },
    })
  })
})
