import { describe, expect, it } from 'vitest'

import { buildCanvasAcceptanceMatrixRows } from './canvasAcceptanceMatrixModel'
import type { CanvasAcceptanceEvidenceEvent } from './canvasAcceptanceEvidence'
import type { CanvasAcceptanceCasePlan, CanvasAcceptancePlan } from './canvasAcceptanceTypes'

function casePlan(caseId: string, providerName: string, modelId: string): CanvasAcceptanceCasePlan {
  return {
    caseId,
    stageId: 'W5_RESOURCE_IMAGES',
    nodeRef: caseId,
    title: `🧪 [W5] 角色设定图 · ${providerName}/${modelId}`,
    operation: 'text_to_image',
    targetKind: 'image',
    dependsOnCaseIds: ['W4-CHARACTER-CARD'],
    target: {
      kind: 'image', providerProfileId: providerName, providerName,
      modelId, displayName: modelId, manifestId: `${providerName}:${modelId}`,
      capabilities: ['image.generate'],
    },
    blockedReasons: [],
    expectedEvidence: [],
  }
}

describe('CanvasAcceptanceMatrixReport', () => {
  it('includes the primary case and every matrix branch with latest evidence status', () => {
    const primary = casePlan('W5-CHARACTER-IMAGE', 'Provider A', 'model-a')
    const branch = casePlan(
      'W5-CHARACTER-IMAGE::provider-b::model-b',
      'Provider B',
      'model-b',
    )
    const event: CanvasAcceptanceEvidenceEvent = {
      sequence: 1,
      at: '',
      source: 'manual-verification',
      runId: 'run-1',
      caseId: branch.caseId,
      attemptId: `${branch.caseId}:attempt:1`,
      attemptIndex: 1,
      taskId: 'task-1',
      operationNodeId: 'node-1',
      taskStatus: 'completed',
      stage: 'materialized',
      preCall: null,
      providerCall: null,
      providerResult: null,
      canvasResult: null,
      assertions: [],
      observabilityGap: false,
    }
    const rows = buildCanvasAcceptanceMatrixRows(
      { cases: [primary, branch] } as CanvasAcceptancePlan,
      [event],
    )
    expect(rows).toEqual([
      expect.objectContaining({ modelId: 'model-a', status: 'pending' }),
      expect.objectContaining({ modelId: 'model-b', status: 'passed' }),
    ])
  })
})
