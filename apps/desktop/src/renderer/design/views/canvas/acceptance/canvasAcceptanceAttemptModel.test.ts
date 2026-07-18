import { describe, expect, it } from 'vitest'
import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import {
  buildCanvasAcceptanceAttemptRows,
  collectCanvasAcceptanceRetryCaseIds,
} from './canvasAcceptanceAttemptModel'
import type { CanvasAcceptancePlan } from './canvasAcceptanceTypes'

function event(
  attemptIndex: number,
  taskStatus: CanvasAcceptanceEvidenceEvent['taskStatus'],
  failed = false,
): CanvasAcceptanceEvidenceEvent {
  return {
    sequence: attemptIndex,
    at: `2026-07-19T00:00:0${attemptIndex}.000Z`,
    source: 'manual-verification',
    runId: 'run-1',
    caseId: 'CASE_A',
    attemptId: `CASE_A:attempt:${attemptIndex}`,
    attemptIndex,
    taskId: `task-${attemptIndex}`,
    operationNodeId: 'node-1',
    taskStatus,
    stage: taskStatus === 'completed' ? 'materialized' : 'failed',
    preCall: null,
    providerCall: null,
    providerResult: null,
    canvasResult: null,
    assertions: failed
      ? [{ id: 'media.probe.asset', status: 'failed', message: 'invalid media' }]
      : [],
    observabilityGap: false,
  }
}

const plan = {
  cases: [{ caseId: 'CASE_A', title: '🧪 [W8] 视频生成', blockedReasons: [] }],
} as unknown as CanvasAcceptancePlan

describe('canvas acceptance attempt model', () => {
  it('keeps each retry as an independent attempt row', () => {
    const rows = buildCanvasAcceptanceAttemptRows(plan, [event(1, 'failed'), event(2, 'completed')])
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.attemptIndex)).toEqual([2, 1])
    expect(rows.map((row) => row.status)).toEqual(['passed', 'failed'])
  })

  it('selects terminal failures and completed assertion failures for retry', () => {
    expect(collectCanvasAcceptanceRetryCaseIds(plan, [event(1, 'completed', true)])).toEqual([
      'CASE_A',
    ])
  })
})
