import type {
  CanvasAcceptanceModelTarget,
  CanvasAcceptanceSelection,
  CanvasAcceptanceStageId,
  CanvasAcceptanceWorkflowBlueprint,
  CanvasAcceptanceWorkflowNode,
} from './canvasAcceptanceTypes'

export const CANVAS_ACCEPTANCE_FIXTURE_VERSION = 'novel-production-v1'

export const CANVAS_ACCEPTANCE_NOVEL_FIXTURE = `# 雾港最后一班车

凌晨两点，海雾吞没了临港车站。年轻维修师林默提着一只旧铜箱，赶上即将停运的最后一班列车。候车厅里只有失明的小提琴手苏弦和神情紧张的站长周衡。

广播忽然播放出十年前失踪列车的报站声，站台尽头亮起一排幽蓝色信号灯。周衡认出铜箱上的编号，阻止林默登车；苏弦却听见车厢里传来与亡母相同的旋律。铜箱自行开启，投射出一张不断变化的星图，雾中随即浮现没有车头的银色列车。

林默决定带苏弦上车寻找真相。周衡拉下紧急制动闸，整座车站开始震动，破碎的时钟倒转。列车门开启的一刻，三人看见车厢内部并非座椅，而是一片悬浮在夜空中的海。`

export const CANVAS_ACCEPTANCE_STAGE_LABELS: Record<CanvasAcceptanceStageId, string> = {
  W0_SOURCE: 'W0 小说原文',
  W1_SCREENPLAY: 'W1 剧本生成',
  W2_ENTITIES: 'W2 实体抽取',
  W3_STYLE: 'W3 视觉风格',
  W4_RESOURCE_CARDS: 'W4 资源设定卡',
  W5_RESOURCE_IMAGES: 'W5 资源设定图',
  W6_SHOTS: 'W6 分镜脚本',
  W7_KEYFRAMES: 'W7 故事板与关键帧',
  W8_VIDEO: 'W8 视频片段',
  W9_AUDIO: 'W9 配音与转写',
  W10_RECOVERY: 'W10 保存与恢复验证',
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
  { caseId: 'W1-SCREENPLAY', label: '小说转剧本', kind: 'text' },
  { caseId: 'W2-CHARACTERS', label: '角色抽取', kind: 'text' },
  { caseId: 'W2-SCENES', label: '场景抽取', kind: 'text' },
  { caseId: 'W2-PROPS', label: '道具抽取', kind: 'text' },
  { caseId: 'W2-EFFECTS', label: '特效抽取', kind: 'text' },
  { caseId: 'W5-CHARACTER-IMAGE', label: '角色设定图', kind: 'image' },
  { caseId: 'W5-SCENE-IMAGE', label: '场景设定图', kind: 'image' },
  { caseId: 'W7-STORYBOARD-GRID', label: '故事板总览', kind: 'image' },
  { caseId: 'W7-KEYFRAME', label: '视频关键帧', kind: 'image' },
  { caseId: 'W8-VIDEO-CLIP', label: '图生视频片段', kind: 'video' },
  { caseId: 'W9-VOICE', label: '旁白配音', kind: 'audio' },
  { caseId: 'W9-TRANSCRIPT', label: '音频转写', kind: 'audio' },
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

const STAGE_ORDER = Object.keys(CANVAS_ACCEPTANCE_STAGE_LABELS) as CanvasAcceptanceStageId[]

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
    fixtureTitle: '雾港最后一班车',
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
      title: '🧪 [W0] 小说原文 · 雾港最后一班车',
      x: 0,
      y: 0,
      inputRefs: [],
      text: CANVAS_ACCEPTANCE_NOVEL_FIXTURE,
    },
    {
      ref: 'screenplay',
      caseId: 'W1-SCREENPLAY',
      stageId: 'W1_SCREENPLAY',
      title: '🧪 [W1] 小说转分场剧本',
      x: 420,
      y: 0,
      inputRefs: ['novel-source'],
      operation: 'text_rewrite',
      prompt: '把输入小说改编为可拍摄的分场剧本，保留关键人物、冲突、场景、对白与视觉事件。',
      systemPrompt:
        '你是影视编剧。输出完整、可继续拆解的中文分场剧本，明确场次、内外景、时间、人物、动作和对白，不要省略结尾。',
      outputPipelineRole: 'screenplay',
      outputTitle: '验收剧本',
      targetKind: 'text',
    },
    ...entityExtractionNodes(),
    {
      ref: 'style-bible',
      caseId: 'W3-STYLE-BIBLE',
      stageId: 'W3_STYLE',
      title: '🧪 [W3] 视觉风格总设定',
      x: 840,
      y: 760,
      inputRefs: ['screenplay'],
      operation: 'text_generate',
      prompt: '基于剧本制定统一视觉风格、色彩、光线、材质、时代感、镜头语言和负面约束。',
      systemPrompt:
        '你是影视美术指导。输出能被后续角色图、场景图、分镜和视频节点共同引用的视觉风格总设定。',
      outputPipelineRole: 'style_bible',
      outputTitle: '视觉风格总设定',
      targetKind: 'text',
    },
    {
      ref: 'character-card',
      caseId: 'W4-CHARACTER-CARD',
      stageId: 'W4_RESOURCE_CARDS',
      title: '🧪 [W4] 角色视觉设定卡',
      x: 1260,
      y: 0,
      inputRefs: ['characters', 'style-bible'],
      operation: 'text_generate',
      prompt: '把角色抽取结果和视觉风格整理为稳定、可复用的角色图生成设定卡。',
      outputPipelineRole: 'design_card',
      outputTitle: '角色视觉设定卡',
      targetKind: 'text',
    },
    {
      ref: 'scene-card',
      caseId: 'W4-SCENE-CARD',
      stageId: 'W4_RESOURCE_CARDS',
      title: '🧪 [W4] 场景视觉设定卡',
      x: 1260,
      y: 360,
      inputRefs: ['scenes', 'props', 'effects', 'style-bible'],
      operation: 'text_generate',
      prompt: '把场景、道具、特效和视觉风格整理为稳定、可复用的场景图生成设定卡。',
      outputPipelineRole: 'design_card',
      outputTitle: '场景视觉设定卡',
      targetKind: 'text',
    },
    {
      ref: 'character-image',
      caseId: 'W5-CHARACTER-IMAGE',
      stageId: 'W5_RESOURCE_IMAGES',
      title: '🧪 [W5] 角色设定图',
      x: 1680,
      y: 0,
      inputRefs: ['character-card'],
      operation: 'text_to_image',
      prompt: '生成一张角色设定图，角色身份清楚、正面主体明确、服装材质和视觉风格稳定。',
      outputPipelineRole: 'design_card',
      outputTitle: '角色设定图',
      targetKind: 'image',
    },
    {
      ref: 'scene-image',
      caseId: 'W5-SCENE-IMAGE',
      stageId: 'W5_RESOURCE_IMAGES',
      title: '🧪 [W5] 场景设定图',
      x: 1680,
      y: 360,
      inputRefs: ['scene-card'],
      operation: 'text_to_image',
      prompt: '生成临港车站主场景设定图，体现海雾、幽蓝信号灯、旧车站材质和超现实氛围。',
      outputPipelineRole: 'design_card',
      outputTitle: '场景设定图',
      targetKind: 'image',
    },
    {
      ref: 'shot-script',
      caseId: 'W6-SHOT-SCRIPT',
      stageId: 'W6_SHOTS',
      title: '🧪 [W6] 结构化分镜脚本',
      x: 1680,
      y: 760,
      inputRefs: ['screenplay', 'characters', 'scenes', 'props', 'effects', 'style-bible'],
      operation: 'text_generate',
      prompt: '把剧本拆成可生成关键帧和视频的结构化分镜，每镜不超过 6 秒。',
      modelParams: { workflow: 'shot_script', responseFormat: 'json' },
      taskPipelineRole: 'screenplay',
      outputPipelineRole: 'shot',
      outputTitle: '结构化分镜脚本',
      shotScriptConfig: { maxClipSec: 6 },
      targetKind: 'text',
    },
    {
      ref: 'storyboard-grid',
      caseId: 'W7-STORYBOARD-GRID',
      stageId: 'W7_KEYFRAMES',
      title: '🧪 [W7] 故事板总览',
      x: 2100,
      y: 360,
      inputRefs: ['shot-script', 'character-image', 'scene-image'],
      operation: 'storyboard_grid',
      prompt: '根据分镜、角色和场景设定生成一张具有清晰镜号和阅读顺序的故事板总览。',
      outputPipelineRole: 'keyframe',
      outputTitle: '故事板总览',
      targetKind: 'image',
    },
    {
      ref: 'keyframe',
      caseId: 'W7-KEYFRAME',
      stageId: 'W7_KEYFRAMES',
      title: '🧪 [W7] 视频关键帧',
      x: 2100,
      y: 760,
      inputRefs: ['shot-script', 'character-image', 'scene-image'],
      operation: 'image_compose',
      prompt: '生成银色列车门开启、车厢内悬浮夜海的电影关键帧，保持角色和场景设定一致。',
      outputPipelineRole: 'keyframe',
      outputTitle: '视频关键帧',
      targetKind: 'image',
    },
    {
      ref: 'video-clip',
      caseId: 'W8-VIDEO-CLIP',
      stageId: 'W8_VIDEO',
      title: '🧪 [W8] 图生视频片段',
      x: 2520,
      y: 760,
      inputRefs: ['keyframe'],
      operation: 'image_to_video',
      prompt: '镜头缓慢推进，银色列车门完全开启，悬浮夜海泛起波纹，人物衣角被风吹动，保持主体一致。',
      modelParams: { duration: 5 },
      outputPipelineRole: 'clip',
      outputTitle: '验收视频片段',
      targetKind: 'video',
    },
    {
      ref: 'voice',
      caseId: 'W9-VOICE',
      stageId: 'W9_AUDIO',
      title: '🧪 [W9] 剧本旁白配音',
      x: 2100,
      y: 1140,
      inputRefs: ['screenplay'],
      operation: 'text_to_audio',
      prompt: '选择剧本中的旁白生成一段自然、克制、有悬疑氛围的中文配音。',
      targetKind: 'audio',
    },
    {
      ref: 'transcript',
      caseId: 'W9-TRANSCRIPT',
      stageId: 'W9_AUDIO',
      title: '🧪 [W9] 配音回转写',
      x: 2520,
      y: 1140,
      inputRefs: ['voice'],
      operation: 'audio_transcribe',
      prompt: '准确转写输入音频，保留中文标点。',
      targetKind: 'audio',
    },
  ]
}

function entityExtractionNodes(): CanvasAcceptanceWorkflowNode[] {
  const definitions = [
    ['characters', 'W2-CHARACTERS', '角色', 'extract_character', 'character'],
    ['scenes', 'W2-SCENES', '场景', 'extract_scene', 'scene'],
    ['props', 'W2-PROPS', '道具', 'extract_prop', 'prop'],
    ['effects', 'W2-EFFECTS', '特效', 'extract_effect', 'effect'],
  ] as const
  return definitions.map(([ref, caseId, label, workflow, role], index) => ({
    ref,
    caseId,
    stageId: 'W2_ENTITIES' as const,
    title: `🧪 [W2] 提取${label}`,
    x: 840,
    y: index * 190,
    inputRefs: ['screenplay'],
    operation: 'text_generate' as const,
    prompt: `从输入剧本中完整提取${label}，不要编造剧本中不存在的实体。`,
    modelParams: { workflow, responseFormat: 'json' },
    outputPipelineRole: role,
    outputTitle: `${label}资源`,
    targetKind: 'text' as const,
  }))
}
