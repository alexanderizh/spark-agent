import type {
  CanvasAcceptanceCasePlan,
  CanvasAcceptanceModelTarget,
  CanvasAcceptancePlan,
  CanvasAcceptanceSelection,
  CanvasAcceptanceTargetKind,
  CanvasAcceptanceWorkflowBlueprint,
} from './canvasAcceptanceTypes'

const EVIDENCE_BY_KIND: Record<CanvasAcceptanceTargetKind, string[]> = {
  text: [
    'preflight',
    'compiled_prompt',
    'actual_request',
    'provider_response',
    'model_output',
    'structured_parse',
    'canvas_materialize',
  ],
  image: [
    'preflight',
    'compiled_params',
    'input_transport',
    'actual_request',
    'provider_response',
    'asset_download',
    'image_probe',
    'canvas_materialize',
    'preview_render',
  ],
  video: [
    'preflight',
    'compiled_params',
    'input_transport',
    'actual_request',
    'provider_submit',
    'provider_poll_terminal',
    'asset_download',
    'video_probe',
    'canvas_materialize',
    'preview_render',
  ],
  audio: [
    'preflight',
    'compiled_params',
    'input_transport',
    'actual_request',
    'provider_response',
    'asset_download',
    'audio_probe',
    'canvas_materialize',
  ],
}

export function compileCanvasAcceptancePlan(input: {
  selection: CanvasAcceptanceSelection
  blueprint: CanvasAcceptanceWorkflowBlueprint
  now?: () => Date
  randomId?: () => string
}): CanvasAcceptancePlan {
  const now = input.now ?? (() => new Date())
  const runId = `acceptance_${(input.randomId ?? defaultRandomId)()}`
  const operationCaseByRef = new Map(
    input.blueprint.nodes
      .filter((node) => node.operation != null)
      .map((node) => [node.ref, node.caseId] as const),
  )
  const cases = input.blueprint.nodes.flatMap<CanvasAcceptanceCasePlan>((node) => {
    if (!node.operation || !node.targetKind) return []
    const target = node.target ?? targetForKind(input.selection, node.targetKind)
    const blockedReasons = validateTarget(node.targetKind, node.operation, target)
    return [
      {
        caseId: node.caseId,
        stageId: node.stageId,
        nodeRef: node.ref,
        title: node.title,
        operation: node.operation,
        targetKind: node.targetKind,
        dependsOnCaseIds: node.inputRefs
          .map((ref) => operationCaseByRef.get(ref))
          .filter((caseId): caseId is string => Boolean(caseId)),
        ...(target ? { target } : {}),
        blockedReasons,
        expectedEvidence: [
          ...EVIDENCE_BY_KIND[node.targetKind].filter(
            (evidence) => evidence !== 'preview_render' || input.selection.verifyPreview,
          ),
          ...(input.selection.verifyReload ? ['snapshot_reload'] : []),
        ],
      },
    ]
  })
  return {
    runId,
    suite: input.selection.suite,
    fixtureVersion: input.blueprint.fixtureVersion,
    createdAt: now().toISOString(),
    selectedStageIds: input.blueprint.selectedStageIds,
    cases,
    executableCaseCount: cases.filter((item) => item.blockedReasons.length === 0).length,
    blockedCaseCount: cases.filter((item) => item.blockedReasons.length > 0).length,
    highCostCaseCount: cases.filter((item) => item.targetKind === 'video').length,
    verifyReload: input.selection.verifyReload,
    verifyPreview: input.selection.verifyPreview,
  }
}

export function targetForKind(
  selection: CanvasAcceptanceSelection,
  kind: CanvasAcceptanceTargetKind,
): CanvasAcceptanceModelTarget | undefined {
  if (kind === 'text') return selection.textTarget
  if (kind === 'image') return selection.imageTarget
  if (kind === 'video') return selection.videoTarget
  return selection.audioTarget
}

function validateTarget(
  kind: CanvasAcceptanceTargetKind,
  operation: string,
  target?: CanvasAcceptanceModelTarget,
): string[] {
  if (!target) return [`missing_${kind}_target`]
  if (!target.providerProfileId.trim()) return ['missing_provider_profile']
  if (!target.modelId.trim()) return ['missing_model_id']
  if (kind === 'text') return []
  const expectedCapabilities = operationCapabilities(operation)
  if (
    expectedCapabilities.length > 0 &&
    !expectedCapabilities.some((capability) => target.capabilities.includes(capability))
  ) {
    return [`unsupported_operation:${operation}`]
  }
  if (!target.manifestId) return ['missing_manifest_id']
  return []
}

function operationCapabilities(operation: string): string[] {
  switch (operation) {
    case 'text_to_image':
      return ['image.generate']
    case 'image_to_image':
    case 'image_edit':
    case 'image_compose':
      return ['image.edit']
    case 'storyboard_grid':
      return ['image.generate', 'image.edit']
    case 'text_to_audio':
      return ['audio.speech']
    case 'audio_transcribe':
      return ['audio.transcription']
    case 'text_to_video':
      return ['video.generate']
    case 'image_to_video':
      return ['video.image_to_video']
    case 'video_edit':
      return ['video.edit']
    case 'video_extend':
      return ['video.extend']
    default:
      return []
  }
}

function defaultRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}
