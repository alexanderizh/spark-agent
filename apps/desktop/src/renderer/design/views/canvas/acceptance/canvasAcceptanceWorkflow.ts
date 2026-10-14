import {
  CANVAS_ACCEPTANCE_FIXTURE_TITLE,
  CANVAS_ACCEPTANCE_NOVEL_FIXTURE,
} from './canvasAcceptanceFixture'
import { translate } from '../../../i18n'
import type {
  CanvasAcceptanceModelTarget,
  CanvasAcceptanceSelection,
  CanvasAcceptanceStageId,
  CanvasAcceptanceWorkflowBlueprint,
  CanvasAcceptanceWorkflowNode,
} from './canvasAcceptanceTypes'

export const CANVAS_ACCEPTANCE_FIXTURE_VERSION = 'novel-production-v1'

/** 阶段名：只存 i18n key（模块级不固化翻译结果）。 */
export const CANVAS_ACCEPTANCE_STAGE_LABEL_KEYS: Record<CanvasAcceptanceStageId, string> = {
  W0_SOURCE: 'canvasAcceptanceWorkflow.t1',
  W1_SCREENPLAY: 'canvasAcceptanceWorkflow.t2',
  W2_ENTITIES: 'canvasAcceptanceWorkflow.t3',
  W3_STYLE: 'canvasAcceptanceWorkflow.t4',
  W4_RESOURCE_CARDS: 'canvasAcceptanceWorkflow.t5',
  W5_RESOURCE_IMAGES: 'canvasAcceptanceWorkflow.t6',
  W6_SHOTS: 'canvasAcceptanceWorkflow.t7',
  W7_KEYFRAMES: 'canvasAcceptanceWorkflow.t8',
  W8_VIDEO: 'canvasAcceptanceWorkflow.t9',
  W9_AUDIO: 'canvasAcceptanceWorkflow.t10',
  W10_RECOVERY: 'canvasAcceptanceWorkflow.t11',
}

/** 阶段名译文（随语言变化）。 */
export function acceptanceStageLabel(stageId: CanvasAcceptanceStageId): string {
  return translate(CANVAS_ACCEPTANCE_STAGE_LABEL_KEYS[stageId])
}

export const CANVAS_ACCEPTANCE_DEFAULT_STAGE_IDS: CanvasAcceptanceStageId[] = [
  'W0_SOURCE',
  'W1_SCREENPLAY',
  'W2_ENTITIES',
  'W3_STYLE',
  'W4_RESOURCE_CARDS',
  'W5_RESOURCE_IMAGES',
  'W6_SHOTS',
  'W7_KEYFRAMES',
  'W8_VIDEO',
  'W10_RECOVERY',
]

export const CANVAS_ACCEPTANCE_MATRIX_CASES = [
  { caseId: 'W1-SCREENPLAY', labelKey: 'canvasAcceptanceWorkflow.t12', kind: 'text' },
  { caseId: 'W2-CHARACTERS', labelKey: 'canvasAcceptanceWorkflow.t13', kind: 'text' },
  { caseId: 'W2-SCENES', labelKey: 'canvasAcceptanceWorkflow.t14', kind: 'text' },
  { caseId: 'W2-PROPS', labelKey: 'canvasAcceptanceWorkflow.t15', kind: 'text' },
  { caseId: 'W2-EFFECTS', labelKey: 'canvasAcceptanceWorkflow.t16', kind: 'text' },
  { caseId: 'W5-CHARACTER-IMAGE', labelKey: 'canvasAcceptanceWorkflow.t17', kind: 'image' },
  { caseId: 'W5-SCENE-IMAGE', labelKey: 'canvasAcceptanceWorkflow.t18', kind: 'image' },
  { caseId: 'W7-STORYBOARD-GRID', labelKey: 'canvasAcceptanceWorkflow.t19', kind: 'image' },
  { caseId: 'W7-KEYFRAME', labelKey: 'canvasAcceptanceWorkflow.t20', kind: 'image' },
  { caseId: 'W8-VIDEO-CLIP', labelKey: 'canvasAcceptanceWorkflow.t21', kind: 'video' },
  { caseId: 'W9-VOICE', labelKey: 'canvasAcceptanceWorkflow.t22', kind: 'audio' },
  { caseId: 'W9-TRANSCRIPT', labelKey: 'canvasAcceptanceWorkflow.t23', kind: 'audio' },
] as const

const STAGE_DEPENDENCIES: Record<CanvasAcceptanceStageId, CanvasAcceptanceStageId[]> = {
  W0_SOURCE: [],
  W1_SCREENPLAY: ['W0_SOURCE'],
  W2_ENTITIES: ['W1_SCREENPLAY'],
  W3_STYLE: ['W1_SCREENPLAY'],
  W4_RESOURCE_CARDS: ['W2_ENTITIES', 'W3_STYLE'],
  W5_RESOURCE_IMAGES: ['W4_RESOURCE_CARDS'],
  W6_SHOTS: ['W1_SCREENPLAY', 'W2_ENTITIES', 'W3_STYLE'],
  W7_KEYFRAMES: ['W5_RESOURCE_IMAGES', 'W6_SHOTS'],
  W8_VIDEO: ['W7_KEYFRAMES'],
  W9_AUDIO: ['W1_SCREENPLAY'],
  W10_RECOVERY: [],
}

const STAGE_ORDER = Object.keys(CANVAS_ACCEPTANCE_STAGE_LABEL_KEYS) as CanvasAcceptanceStageId[]

export function expandCanvasAcceptanceStageDependencies(
  stageIds: readonly CanvasAcceptanceStageId[],
): CanvasAcceptanceStageId[] {
  const selected = new Set<CanvasAcceptanceStageId>()
  const visit = (stageId: CanvasAcceptanceStageId): void => {
    if (selected.has(stageId)) return
    for (const dependency of STAGE_DEPENDENCIES[stageId]) visit(dependency)
    selected.add(stageId)
  }
  for (const stageId of stageIds) visit(stageId)
  return STAGE_ORDER.filter((stageId) => selected.has(stageId))
}

export function buildCanvasAcceptanceWorkflowBlueprint(
  selection: CanvasAcceptanceSelection,
): CanvasAcceptanceWorkflowBlueprint {
  const allNodes = workflowNodes()
  const matrixCaseIds = new Set(selection.matrixCaseIds ?? [])
  const matrixStageIds = allNodes
    .filter((node) => matrixCaseIds.has(node.caseId))
    .map((node) => node.stageId)
  const selectedStageIds = expandCanvasAcceptanceStageDependencies([
    ...selection.stageIds,
    ...matrixStageIds,
  ])
  const selected = new Set(selectedStageIds)
  const baseNodes = allNodes.filter((node) => selected.has(node.stageId))
  const nodes = [
    ...baseNodes,
    ...(selection.suite === 'model_matrix' || selection.suite === 'full_acceptance'
      ? buildMatrixNodes(baseNodes, selection, matrixCaseIds)
      : []),
  ]
  return {
    fixtureVersion: CANVAS_ACCEPTANCE_FIXTURE_VERSION,
    fixtureTitle: CANVAS_ACCEPTANCE_FIXTURE_TITLE,
    suite: selection.suite,
    selectedStageIds,
    nodes,
  }
}

function buildMatrixNodes(
  baseNodes: readonly CanvasAcceptanceWorkflowNode[],
  selection: CanvasAcceptanceSelection,
  matrixCaseIds: ReadonlySet<string>,
): CanvasAcceptanceWorkflowNode[] {
  return baseNodes.flatMap((node) => {
    if (!node.operation || !node.targetKind || !matrixCaseIds.has(node.caseId)) return []
    const primary = primaryTarget(selection, node.targetKind)
    const targets = matrixTargets(selection, node.targetKind).filter(
      (target) => !primary || targetIdentity(target) !== targetIdentity(primary),
    )
    return targets.map((target, index) => ({
      ...node,
      ref: `${node.ref}::matrix::${targetIdentity(target)}`,
      caseId: `${node.caseId}::${target.providerProfileId}::${target.modelId}`,
      title: `${node.title} · ${target.providerName}/${target.displayName}`,
      y: node.y + (index + 1) * 240,
      target,
    }))
  })
}

function primaryTarget(
  selection: CanvasAcceptanceSelection,
  kind: CanvasAcceptanceWorkflowNode['targetKind'],
): CanvasAcceptanceModelTarget | undefined {
  if (kind === 'text') return selection.textTarget
  if (kind === 'image') return selection.imageTarget
  if (kind === 'video') return selection.videoTarget
  if (kind === 'audio') return selection.audioTarget
  return undefined
}

function matrixTargets(
  selection: CanvasAcceptanceSelection,
  kind: CanvasAcceptanceWorkflowNode['targetKind'],
): CanvasAcceptanceModelTarget[] {
  const targets =
    kind === 'text'
      ? selection.textTargets
      : kind === 'image'
        ? selection.imageTargets
        : kind === 'video'
          ? selection.videoTargets
          : kind === 'audio'
            ? selection.audioTargets
            : undefined
  const unique = new Map<string, CanvasAcceptanceModelTarget>()
  for (const target of targets ?? []) unique.set(targetIdentity(target), target)
  return Array.from(unique.values())
}

function targetIdentity(target: CanvasAcceptanceModelTarget): string {
  return [target.providerProfileId, target.manifestId ?? 'text', target.modelId].join('::')
}

function workflowNodes(): CanvasAcceptanceWorkflowNode[] {
  return [
    {
      ref: 'novel-source',
      caseId: 'W0-NOVEL-SOURCE',
      stageId: 'W0_SOURCE',
      title: translate('canvasAcceptanceWorkflow.tpl4Title', {
        title: CANVAS_ACCEPTANCE_FIXTURE_TITLE,
      }),
      x: 0,
      y: 0,
      inputRefs: [],
      text: CANVAS_ACCEPTANCE_NOVEL_FIXTURE,
    },
    {
      ref: 'screenplay',
      caseId: 'W1-SCREENPLAY',
      stageId: 'W1_SCREENPLAY',
      title: translate('canvasAcceptanceWorkflow.t24'),
      x: 420,
      y: 0,
      inputRefs: ['novel-source'],
      operation: 'text_rewrite',
      prompt: translate('canvasAcceptanceWorkflow.t25Instruction'),
      systemPrompt: translate('canvasAcceptanceWorkflow.t26Instruction'),
      outputPipelineRole: 'screenplay',
      outputTitle: translate('canvasAcceptanceWorkflow.t27'),
      targetKind: 'text',
    },
    ...entityExtractionNodes(),
    {
      ref: 'style-bible',
      caseId: 'W3-STYLE-BIBLE',
      stageId: 'W3_STYLE',
      title: translate('canvasAcceptanceWorkflow.t28'),
      x: 840,
      y: 760,
      inputRefs: ['screenplay'],
      operation: 'text_generate',
      prompt: translate('canvasAcceptanceWorkflow.t29Instruction'),
      systemPrompt: translate('canvasAcceptanceWorkflow.t30Instruction'),
      outputPipelineRole: 'style_bible',
      outputTitle: translate('canvasAcceptanceWorkflow.t31'),
      targetKind: 'text',
    },
    {
      ref: 'character-card',
      caseId: 'W4-CHARACTER-CARD',
      stageId: 'W4_RESOURCE_CARDS',
      title: translate('canvasAcceptanceWorkflow.t32'),
      x: 1260,
      y: 0,
      inputRefs: ['characters', 'style-bible'],
      operation: 'text_generate',
      prompt: translate('canvasAcceptanceWorkflow.t33Instruction'),
      outputPipelineRole: 'design_card',
      outputTitle: translate('canvasAcceptanceWorkflow.t34'),
      targetKind: 'text',
    },
    {
      ref: 'scene-card',
      caseId: 'W4-SCENE-CARD',
      stageId: 'W4_RESOURCE_CARDS',
      title: translate('canvasAcceptanceWorkflow.t35'),
      x: 1260,
      y: 360,
      inputRefs: ['scenes', 'props', 'effects', 'style-bible'],
      operation: 'text_generate',
      prompt: translate('canvasAcceptanceWorkflow.t36Instruction'),
      outputPipelineRole: 'design_card',
      outputTitle: translate('canvasAcceptanceWorkflow.t37'),
      targetKind: 'text',
    },
    {
      ref: 'character-image',
      caseId: 'W5-CHARACTER-IMAGE',
      stageId: 'W5_RESOURCE_IMAGES',
      title: translate('canvasAcceptanceWorkflow.t38'),
      x: 1680,
      y: 0,
      inputRefs: ['character-card'],
      operation: 'text_to_image',
      prompt: translate('canvasAcceptanceWorkflow.t39Instruction'),
      outputPipelineRole: 'design_card',
      outputTitle: translate('canvasAcceptanceWorkflow.t17'),
      targetKind: 'image',
    },
    {
      ref: 'scene-image',
      caseId: 'W5-SCENE-IMAGE',
      stageId: 'W5_RESOURCE_IMAGES',
      title: translate('canvasAcceptanceWorkflow.t40'),
      x: 1680,
      y: 360,
      inputRefs: ['scene-card'],
      operation: 'text_to_image',
      prompt: translate('canvasAcceptanceWorkflow.t41Instruction'),
      outputPipelineRole: 'design_card',
      outputTitle: translate('canvasAcceptanceWorkflow.t18'),
      targetKind: 'image',
    },
    {
      ref: 'shot-script',
      caseId: 'W6-SHOT-SCRIPT',
      stageId: 'W6_SHOTS',
      title: translate('canvasAcceptanceWorkflow.t42'),
      x: 1680,
      y: 760,
      inputRefs: ['screenplay', 'characters', 'scenes', 'props', 'effects', 'style-bible'],
      operation: 'text_generate',
      prompt: translate('canvasAcceptanceWorkflow.t43Instruction'),
      modelParams: { workflow: 'shot_script', responseFormat: 'json' },
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'shot',
      outputTitle: translate('canvasAcceptanceWorkflow.t44'),
      shotScriptConfig: { maxClipSec: 6 },
      targetKind: 'text',
    },
    {
      ref: 'storyboard-grid',
      caseId: 'W7-STORYBOARD-GRID',
      stageId: 'W7_KEYFRAMES',
      title: translate('canvasAcceptanceWorkflow.t45'),
      x: 2100,
      y: 360,
      inputRefs: ['shot-script', 'character-image', 'scene-image'],
      operation: 'storyboard_grid',
      prompt: translate('canvasAcceptanceWorkflow.t46Instruction'),
      outputPipelineRole: 'keyframe',
      outputTitle: translate('canvasAcceptanceWorkflow.t19'),
      targetKind: 'image',
    },
    {
      ref: 'keyframe',
      caseId: 'W7-KEYFRAME',
      stageId: 'W7_KEYFRAMES',
      title: translate('canvasAcceptanceWorkflow.t47'),
      x: 2100,
      y: 760,
      inputRefs: ['shot-script', 'character-image', 'scene-image'],
      operation: 'image_compose',
      prompt: translate('canvasAcceptanceWorkflow.t48Instruction'),
      outputPipelineRole: 'keyframe',
      outputTitle: translate('canvasAcceptanceWorkflow.t20'),
      targetKind: 'image',
    },
    {
      ref: 'video-clip',
      caseId: 'W8-VIDEO-CLIP',
      stageId: 'W8_VIDEO',
      title: translate('canvasAcceptanceWorkflow.t49'),
      x: 2520,
      y: 760,
      inputRefs: ['keyframe'],
      operation: 'image_to_video',
      prompt: translate('canvasAcceptanceWorkflow.t50Instruction'),
      modelParams: { duration: 5 },
      outputPipelineRole: 'clip',
      outputTitle: translate('canvasAcceptanceWorkflow.t51'),
      targetKind: 'video',
    },
    {
      ref: 'voice',
      caseId: 'W9-VOICE',
      stageId: 'W9_AUDIO',
      title: translate('canvasAcceptanceWorkflow.t52'),
      x: 2100,
      y: 1140,
      inputRefs: ['screenplay'],
      operation: 'text_to_audio',
      prompt: translate('canvasAcceptanceWorkflow.t53Instruction'),
      targetKind: 'audio',
    },
    {
      ref: 'transcript',
      caseId: 'W9-TRANSCRIPT',
      stageId: 'W9_AUDIO',
      title: translate('canvasAcceptanceWorkflow.t54'),
      x: 2520,
      y: 1140,
      inputRefs: ['voice'],
      operation: 'audio_transcribe',
      prompt: translate('canvasAcceptanceWorkflow.t55Instruction'),
      targetKind: 'audio',
    },
  ]
}

function entityExtractionNodes(): CanvasAcceptanceWorkflowNode[] {
  const definitions = [
    [
      'characters',
      'W2-CHARACTERS',
      'canvasAcceptanceWorkflow.t56',
      'extract_character',
      'character',
    ],
    ['scenes', 'W2-SCENES', 'canvasAcceptanceWorkflow.t57', 'extract_scene', 'scene'],
    ['props', 'W2-PROPS', 'canvasAcceptanceWorkflow.t58', 'extract_prop', 'prop'],
    ['effects', 'W2-EFFECTS', 'canvasAcceptanceWorkflow.t59', 'extract_effect', 'effect'],
  ] as const
  return definitions.map(([ref, caseId, labelKey, workflow, role], index) => {
    const label = translate(labelKey)
    return {
      ref,
      caseId,
      stageId: 'W2_ENTITIES' as const,
      title: translate('canvasAcceptanceWorkflow.tpl1Title', { label }),
      x: 840,
      y: index * 190,
      inputRefs: ['screenplay'],
      operation: 'text_generate' as const,
      prompt: translate('canvasAcceptanceWorkflow.tpl2Instruction', { label }),
      modelParams: { workflow, responseFormat: 'json' },
      outputPipelineRole: role,
      outputTitle: translate('canvasAcceptanceWorkflow.tpl3', { label }),
      targetKind: 'text' as const,
    }
  })
}
