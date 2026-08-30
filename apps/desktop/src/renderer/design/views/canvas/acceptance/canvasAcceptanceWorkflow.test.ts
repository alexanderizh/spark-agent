import { describe, expect, it } from 'vitest'
import {
  CANVAS_ACCEPTANCE_DEFAULT_STAGE_IDS,
  buildCanvasAcceptanceWorkflowBlueprint,
  expandCanvasAcceptanceStageDependencies,
} from './canvasAcceptanceWorkflow'
import { compileCanvasAcceptancePlan } from './canvasAcceptancePlan'
import type {
  CanvasAcceptanceModelTarget,
  CanvasAcceptanceSelection,
} from './canvasAcceptanceTypes'

const target = (
  kind: CanvasAcceptanceModelTarget['kind'],
  capabilities: string[] = [],
): CanvasAcceptanceModelTarget => ({
  kind,
  providerProfileId: `${kind}-provider`,
  providerName: `${kind} provider`,
  modelId: `${kind}-model`,
  displayName: `${kind} model`,
  ...(kind === 'text' ? {} : { manifestId: `${kind}:model` }),
  capabilities,
})

const selection = (): CanvasAcceptanceSelection => ({
  suite: 'workflow_smoke',
  stageIds: CANVAS_ACCEPTANCE_DEFAULT_STAGE_IDS,
  textTarget: target('text'),
  imageTarget: target('image', ['image.generate', 'image.edit']),
  videoTarget: target('video', ['video.image_to_video']),
  verifyReload: true,
  verifyPreview: true,
})

describe('canvas acceptance workflow', () => {
  it('adds upstream dependencies for a selected downstream stage', () => {
    expect(expandCanvasAcceptanceStageDependencies(['W8_VIDEO'])).toEqual([
      'W0_SOURCE',
      'W1_SCREENPLAY',
      'W2_ENTITIES',
      'W3_STYLE',
      'W4_RESOURCE_CARDS',
      'W5_RESOURCE_IMAGES',
      'W6_SHOTS',
      'W7_KEYFRAMES',
      'W8_VIDEO',
    ])
  })

  it('builds a real novel-to-video workflow instead of isolated smoke nodes', () => {
    const blueprint = buildCanvasAcceptanceWorkflowBlueprint(selection())
    expect(blueprint.nodes[0]).toMatchObject({ ref: 'novel-source', stageId: 'W0_SOURCE' })
    expect(blueprint.nodes.find((node) => node.ref === 'screenplay')?.inputRefs).toEqual([
      'novel-source',
    ])
    expect(blueprint.nodes.find((node) => node.ref === 'video-clip')?.inputRefs).toEqual([
      'keyframe',
    ])
    expect(blueprint.nodes.some((node) => node.modelParams?.workflow === 'shot_script')).toBe(true)
  })

  it('compiles explicit model targets and evidence requirements for every call', () => {
    const nextSelection = selection()
    const blueprint = buildCanvasAcceptanceWorkflowBlueprint(nextSelection)
    const plan = compileCanvasAcceptancePlan({
      selection: nextSelection,
      blueprint,
      now: () => new Date('2026-07-18T00:00:00.000Z'),
      randomId: () => 'run-1',
    })
    expect(plan.runId).toBe('acceptance_run-1')
    expect(plan.blockedCaseCount).toBe(0)
    expect(plan.highCostCaseCount).toBe(1)
    expect(plan.cases.find((item) => item.caseId === 'W8-VIDEO-CLIP')).toMatchObject({
      dependsOnCaseIds: ['W7-KEYFRAME'],
      target: { providerProfileId: 'video-provider', modelId: 'video-model' },
      expectedEvidence: expect.arrayContaining([
        'actual_request',
        'provider_poll_terminal',
        'video_probe',
        'canvas_materialize',
        'snapshot_reload',
      ]),
    })
  })

  it('marks unsupported or unconfigured calls as blocked before spending money', () => {
    const nextSelection = selection()
    nextSelection.videoTarget = target('video', ['video.generate'])
    const blueprint = buildCanvasAcceptanceWorkflowBlueprint(nextSelection)
    const plan = compileCanvasAcceptancePlan({
      selection: nextSelection,
      blueprint,
      randomId: () => 'run-2',
    })
    expect(plan.cases.find((item) => item.caseId === 'W8-VIDEO-CLIP')?.blockedReasons).toEqual([
      'unsupported_operation:image_to_video',
    ])
  })

  it('creates independent model-matrix branches on the same canonical upstream input', () => {
    const nextSelection = selection()
    const primaryImageTarget = nextSelection.imageTarget
    if (!primaryImageTarget) throw new Error('invalid test fixture')
    nextSelection.suite = 'model_matrix'
    nextSelection.matrixCaseIds = ['W5-CHARACTER-IMAGE']
    nextSelection.imageTargets = [
      primaryImageTarget,
      {
        ...target('image', ['image.generate']),
        providerProfileId: 'image-provider-b',
        providerName: 'Image Provider B',
        modelId: 'image-model-b',
        displayName: 'Image Model B',
        manifestId: 'image:model-b',
      },
    ]
    const blueprint = buildCanvasAcceptanceWorkflowBlueprint(nextSelection)
    const branch = blueprint.nodes.find((node) =>
      node.caseId.startsWith('W5-CHARACTER-IMAGE::image-provider-b'),
    )
    expect(branch).toMatchObject({
      inputRefs: ['character-card'],
      target: {
        providerProfileId: 'image-provider-b',
        modelId: 'image-model-b',
      },
    })
    const plan = compileCanvasAcceptancePlan({
      selection: nextSelection,
      blueprint,
      randomId: () => 'matrix',
    })
    expect(
      plan.cases.find((item) => item.caseId === branch?.caseId),
    ).toMatchObject({
      target: { providerProfileId: 'image-provider-b' },
      dependsOnCaseIds: ['W4-CHARACTER-CARD'],
    })
  })
})
