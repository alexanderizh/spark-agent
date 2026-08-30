import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'

export type CanvasAcceptanceMatrixRow = {
  key: string
  baseCaseId: string
  title: string
  providerName: string
  modelId: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled'
  failedAssertions: number
  observabilityGap: boolean
}

export function buildCanvasAcceptanceMatrixRows(
  plan: CanvasAcceptancePlan,
  events: readonly CanvasAcceptanceEvidenceEvent[],
): CanvasAcceptanceMatrixRow[] {
  const branchBaseIds = new Set(
    plan.cases
      .filter((item) => item.caseId.includes('::'))
      .map((item) => baseCaseId(item.caseId)),
  )
  if (branchBaseIds.size === 0) return []
  const latestByCase = new Map<string, CanvasAcceptanceEvidenceEvent>()
  for (const event of events) latestByCase.set(event.caseId, event)
  return plan.cases
    .filter(
      (item) => branchBaseIds.has(item.caseId) || branchBaseIds.has(baseCaseId(item.caseId)),
    )
    .map((item) => {
      const latest = latestByCase.get(item.caseId)
      const failedAssertions = latest?.assertions.filter((assertion) => assertion.status === 'failed').length ?? 0
      return {
        key: item.caseId,
        baseCaseId: baseCaseId(item.caseId),
        title: stripAcceptanceTitle(item.title),
        providerName: item.target?.providerName ?? '(未配置)',
        modelId: item.target?.modelId ?? '(未配置)',
        status: resolveMatrixStatus(item.blockedReasons, latest, failedAssertions),
        failedAssertions,
        observabilityGap: latest?.observabilityGap ?? false,
      }
    })
}

function resolveMatrixStatus(
  blockedReasons: readonly string[],
  event: CanvasAcceptanceEvidenceEvent | undefined,
  failedAssertions: number,
): CanvasAcceptanceMatrixRow['status'] {
  if (!event) return blockedReasons.length > 0 ? 'blocked' : 'pending'
  if (event.stage === 'blocked_by_upstream' || event.stage.startsWith('preflight_')) {
    return failedAssertions > 0 ? 'blocked' : 'running'
  }
  if (event.taskStatus === 'cancelled') return 'cancelled'
  if (event.taskStatus === 'running' || event.taskStatus === 'pending') return 'running'
  if (event.taskStatus === 'failed' || failedAssertions > 0) return 'failed'
  return 'passed'
}

function baseCaseId(caseId: string): string {
  return caseId.split('::')[0] ?? caseId
}

function stripAcceptanceTitle(title: string): string {
  return title.replace(/^🧪\s*\[[^\]]+\]\s*/, '').split(' · ')[0] ?? title
}
