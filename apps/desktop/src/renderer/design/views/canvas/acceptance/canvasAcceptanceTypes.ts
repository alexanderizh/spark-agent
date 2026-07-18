import type { CanvasOperationType, CanvasPipelineRole } from '../canvas.types'

export type CanvasAcceptanceSuite =
  | 'workflow_smoke'
  | 'model_matrix'
  | 'full_acceptance'
  | 'custom'

export type CanvasAcceptanceStageId =
  | 'W0_SOURCE'
  | 'W1_SCREENPLAY'
  | 'W2_ENTITIES'
  | 'W3_STYLE'
  | 'W4_RESOURCE_CARDS'
  | 'W5_RESOURCE_IMAGES'
  | 'W6_SHOTS'
  | 'W7_KEYFRAMES'
  | 'W8_VIDEO'
  | 'W9_AUDIO'
  | 'W10_RECOVERY'

export type CanvasAcceptanceTargetKind = 'text' | 'image' | 'video' | 'audio'

export type CanvasAcceptanceModelTarget = {
  kind: CanvasAcceptanceTargetKind
  providerProfileId: string
  providerName: string
  modelId: string
  displayName: string
  manifestId?: string
  providerKind?: string
  capabilities: string[]
}

export type CanvasAcceptanceSelection = {
  suite: CanvasAcceptanceSuite
  stageIds: CanvasAcceptanceStageId[]
  matrixCaseIds?: string[]
  textTarget?: CanvasAcceptanceModelTarget
  imageTarget?: CanvasAcceptanceModelTarget
  videoTarget?: CanvasAcceptanceModelTarget
  audioTarget?: CanvasAcceptanceModelTarget
  textTargets?: CanvasAcceptanceModelTarget[]
  imageTargets?: CanvasAcceptanceModelTarget[]
  videoTargets?: CanvasAcceptanceModelTarget[]
  audioTargets?: CanvasAcceptanceModelTarget[]
  verifyReload: boolean
  verifyPreview: boolean
}

export type CanvasAcceptanceWorkflowNode = {
  ref: string
  caseId: string
  stageId: CanvasAcceptanceStageId
  title: string
  x: number
  y: number
  inputRefs: string[]
  operation?: CanvasOperationType
  text?: string
  prompt?: string
  systemPrompt?: string
  modelParams?: Record<string, unknown>
  taskPipelineRole?: CanvasPipelineRole
  outputPipelineRole?: CanvasPipelineRole
  outputTitle?: string
  shotScriptConfig?: { maxClipSec: number }
  targetKind?: CanvasAcceptanceTargetKind
  target?: CanvasAcceptanceModelTarget
}

export type CanvasAcceptanceWorkflowBlueprint = {
  fixtureVersion: string
  fixtureTitle: string
  suite: CanvasAcceptanceSuite
  selectedStageIds: CanvasAcceptanceStageId[]
  nodes: CanvasAcceptanceWorkflowNode[]
}

export type CanvasAcceptanceCasePlan = {
  caseId: string
  stageId: CanvasAcceptanceStageId
  nodeRef: string
  title: string
  operation: CanvasOperationType
  targetKind: CanvasAcceptanceTargetKind
  dependsOnCaseIds: string[]
  target?: CanvasAcceptanceModelTarget
  blockedReasons: string[]
  expectedEvidence: string[]
}

export type CanvasAcceptancePlan = {
  runId: string
  suite: CanvasAcceptanceSuite
  fixtureVersion: string
  createdAt: string
  selectedStageIds: CanvasAcceptanceStageId[]
  cases: CanvasAcceptanceCasePlan[]
  executableCaseCount: number
  blockedCaseCount: number
  highCostCaseCount: number
  verifyReload: boolean
  verifyPreview: boolean
}

export type CanvasAcceptanceMaterializedRun = {
  runId: string
  projectId: string
  boardId: string
  caseNodeIds: Record<string, string>
  plan: CanvasAcceptancePlan
}
