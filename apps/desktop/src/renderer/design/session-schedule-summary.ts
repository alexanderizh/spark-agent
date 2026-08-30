import type { ScheduledTaskItem } from '@spark/protocol'

export type SessionScheduleSummary = {
  total: number
  enabled: number
}

export type SessionScheduleSummaries = Record<string, SessionScheduleSummary>

export function buildSessionScheduleSummaries(
  tasks: ScheduledTaskItem[],
): SessionScheduleSummaries {
  const summaries: SessionScheduleSummaries = {}
  for (const task of tasks) {
    if (task.scope !== 'session' || task.sessionId == null) continue
    const summary = summaries[task.sessionId] ?? { total: 0, enabled: 0 }
    summary.total += 1
    if (task.enabled) summary.enabled += 1
    summaries[task.sessionId] = summary
  }
  return summaries
}
