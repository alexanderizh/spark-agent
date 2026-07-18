import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'

export type CanvasAcceptanceAttemptRow = {
  key: string
  caseId: string
  title: string
  attemptIndex: number
  taskId: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled'
  startedAt: string
  endedAt: string
  eventCount: number
  failedAssertions: number
  observabilityGap: boolean
}

export function buildCanvasAcceptanceAttemptRows(
  plan: CanvasAcceptancePlan,
  events: readonly CanvasAcceptanceEvidenceEvent[],
): CanvasAcceptanceAttemptRow[] {
  const titles = new Map(plan.cases.map((item) => [item.caseId, item.title]))
  const grouped = new Map<string, CanvasAcceptanceEvidenceEvent[]>()
  for (const event of events) {
    const bucket = grouped.get(event.attemptId) ?? []
    bucket.push(event)
    grouped.set(event.attemptId, bucket)
  }
  return Array.from(grouped.entries())
    .map(([attemptId, attemptEvents]) => {
      const ordered = [...attemptEvents].sort((left, right) => left.sequence - right.sequence)
      const first = ordered[0]
      const latest = ordered[ordered.length - 1]
      if (!first || !latest) return null
      const failedAssertions = latest.assertions.filter((item) => item.status === 'failed').length
      return {
        key: attemptId,
        caseId: latest.caseId,
        title: stripAcceptanceTitle(titles.get(latest.caseId) ?? latest.caseId),
        attemptIndex: latest.attemptIndex,
        taskId: latest.taskId,
        status: resolveAttemptStatus(latest, failedAssertions),
        startedAt: first.at,
        endedAt: latest.at,
        eventCount: ordered.length,
        failedAssertions,
        observabilityGap: ordered.some((event) => event.observabilityGap),
      } satisfies CanvasAcceptanceAttemptRow
    })
    .filter((item): item is CanvasAcceptanceAttemptRow => item != null)
    .sort((left, right) => right.endedAt.localeCompare(left.endedAt))
}

export function collectCanvasAcceptanceRetryCaseIds(
  plan: CanvasAcceptancePlan,
  events: readonly CanvasAcceptanceEvidenceEvent[],
): string[] {
  const latestByCase = new Map<string, CanvasAcceptanceEvidenceEvent>()
  for (const event of events) latestByCase.set(event.caseId, event)
  return plan.cases
    .filter((casePlan) => {
      const latest = latestByCase.get(casePlan.caseId)
      if (!latest) return false
      if (latest.stage === 'blocked_by_upstream' || latest.stage.startsWith('preflight_')) {
        return false
      }
      return (
        latest.taskStatus === 'failed' ||
        latest.taskStatus === 'cancelled' ||
        latest.assertions.some((assertion) => assertion.status === 'failed')
      )
    })
    .map((casePlan) => casePlan.caseId)
}

function resolveAttemptStatus(
  latest: CanvasAcceptanceEvidenceEvent,
  failedAssertions: number,
): CanvasAcceptanceAttemptRow['status'] {
  if (latest.stage === 'blocked_by_upstream' || latest.stage.startsWith('preflight_')) {
    return latest.assertions.some((item) => item.status === 'failed') ? 'blocked' : 'pending'
  }
  if (latest.taskStatus === 'cancelled') return 'cancelled'
  if (latest.taskStatus === 'running') return 'running'
  if (latest.taskStatus === 'pending') return 'pending'
  if (latest.taskStatus === 'failed' || failedAssertions > 0) return 'failed'
  return 'passed'
}

function stripAcceptanceTitle(title: string): string {
  return title.replace(/^🧪\s*\[[^\]]+\]\s*/, '').split(' · ')[0] ?? title
}
