import { readAssetKind, readFilmData, readReferences } from './canvasFilmAssets'
import type { CanvasAsset, CanvasNode } from './canvas.types'

export type CanvasAgentProductionStage =
  | 'manuscript'
  | 'screenplay'
  | 'assets'
  | 'design_assets'
  | 'episodes'
  | 'storyboard'
  | 'shot_assets'
  | 'keyframes'
  | 'video'
  | 'complete'

export type CanvasAgentProductionAction = {
  id: string
  label: string
  reason: string
  execution: 'requires_user_interaction' | 'create_operation_node' | 'tool_recipe'
  parallelizable?: boolean
}

export type CanvasAgentProductionWorkflowStage = {
  id: CanvasAgentProductionStage
  label: string
  objective: string
  recommendedActions: string[]
}

export type CanvasAgentProductionPlan = {
  currentStage: CanvasAgentProductionStage
  summary: string
  blockers: string[]
  nextActions: CanvasAgentProductionAction[]
  workflow: CanvasAgentProductionWorkflowStage[]
  guardrails: string[]
  counts: {
    chapters: number
    screenplays: number
    characters: number
    scenes: number
    props: number
    effects: number
    designCards: number
    designedAssets: number
    panoramas: number
    shotGroups: number
    shots: number
    keyframes: number
    videos: number
  }
}

export type CanvasAgentProductionPlanInput = {
  assets: readonly CanvasAsset[]
  nodes: readonly CanvasNode[]
  metadata: Record<string, unknown> | undefined
}

const STANDARD_WORKFLOW: CanvasAgentProductionWorkflowStage[] = [
  {
    id: 'manuscript',
    label: '文稿准备',
    objective: '导入文稿并按章节整理，保留原文资产。',
    recommendedActions: ['manuscript.import', 'chapter.to_screenplay'],
  },
  {
    id: 'screenplay',
    label: '剧本提取',
    objective: '把文稿改写为可拍摄的场次剧本并确认内容。',
    recommendedActions: ['chapter.to_screenplay'],
  },
  {
    id: 'assets',
    label: '角色与场景抽取',
    objective: '优先抽取并去重角色、场景，再补关键道具和特效。',
    recommendedActions: [
      'screenplay.extract_characters',
      'screenplay.extract_scenes',
      'screenplay.extract_props',
      'screenplay.extract_effects',
    ],
  },
  {
    id: 'design_assets',
    label: '视觉资产设计',
    objective: '生成角色身份板、场景图；为高频或关键场景生成 360 全景图。',
    recommendedActions: [
      'character.three_view',
      'scene.scene_image',
      'scene.panorama_360',
      'prop.prop_image',
      'effect.effect_image',
    ],
  },
  {
    id: 'episodes',
    label: '分集',
    objective: '按剧情冲突、目标时长和结尾钩子拆分剧集，仍在当前单画布组织。',
    recommendedActions: ['screenplay.split_episodes'],
  },
  {
    id: 'storyboard',
    label: '按集分镜',
    objective: '逐集生成分镜脚本并落为分镜分组与镜头片段。',
    recommendedActions: ['screenplay.to_shot_script'],
  },
  {
    id: 'shot_assets',
    label: '镜头资产齐套',
    objective: '逐镜检查角色、场景、道具、特效、动作、服装和空间调度资产。',
    recommendedActions: ['shot.audit_assets', 'shot.create_keyframes'],
  },
  {
    id: 'keyframes',
    label: '关键帧',
    objective: '优先使用已确认的角色和场景基准生成首尾帧，保持镜头连续性。',
    recommendedActions: ['shot.create_keyframes'],
  },
  {
    id: 'video',
    label: '视频节点',
    objective: '资产齐套后创建视频生成节点；默认不立即运行。',
    recommendedActions: ['video.create_nodes'],
  },
]

function action(
  id: string,
  label: string,
  reason: string,
  execution: CanvasAgentProductionAction['execution'] = 'create_operation_node',
  parallelizable = false,
): CanvasAgentProductionAction {
  return { id, label, reason, execution, ...(parallelizable ? { parallelizable: true } : {}) }
}

function countAssetKinds(assets: readonly CanvasAsset[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const asset of assets) {
    const kind = readAssetKind(asset)
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1
  }
  return counts
}

export function buildCanvasAgentProductionPlan(
  input: CanvasAgentProductionPlanInput,
): CanvasAgentProductionPlan {
  const kinds = countAssetKinds(input.assets)
  const film = readFilmData(input.metadata)
  const shotGroups = film?.shotGroups ?? []
  const shots = shotGroups.reduce((total, group) => total + group.segments.length, 0)
  const manuscriptChapters = film?.manuscript?.chapters.length ?? 0
  const screenplayNodes = input.nodes.filter((node) => node.data.pipelineRole === 'screenplay').length
  const requiredDesignAssetIds = new Set(
    input.assets
      .filter((asset) => {
        const kind = readAssetKind(asset)
        return kind === 'character' || kind === 'scene'
      })
      .map((asset) => asset.id),
  )
  const designedAssetIds = new Set<string>()
  for (const asset of input.assets) {
    if (requiredDesignAssetIds.has(asset.id) && readReferences(asset.metadata).length > 0) {
      designedAssetIds.add(asset.id)
    }
  }
  for (const node of input.nodes) {
    const targetAssetId = node.data.outputFilmAssetId
    if (targetAssetId && requiredDesignAssetIds.has(targetAssetId)) {
      designedAssetIds.add(targetAssetId)
    }
  }
  const counts = {
    chapters: Math.max(manuscriptChapters, kinds['chapter'] ?? 0),
    screenplays: Math.max(kinds['script'] ?? 0, screenplayNodes),
    characters: kinds['character'] ?? 0,
    scenes: kinds['scene'] ?? 0,
    props: kinds['prop'] ?? 0,
    effects: kinds['effect'] ?? 0,
    designCards: input.nodes.filter((node) => node.data.pipelineRole === 'design_card').length,
    designedAssets: designedAssetIds.size,
    panoramas: input.nodes.filter((node) => Boolean(node.data.panorama360)).length,
    shotGroups: shotGroups.length,
    shots,
    keyframes: input.nodes.filter((node) => node.data.pipelineRole === 'keyframe').length,
    videos: input.nodes.filter(
      (node) => node.type === 'video' || node.data.pipelineRole === 'clip',
    ).length,
  }
  const blockers: string[] = []
  let currentStage: CanvasAgentProductionStage
  let nextActions: CanvasAgentProductionAction[]

  if (counts.chapters === 0 && counts.screenplays === 0) {
    currentStage = 'manuscript'
    blockers.push('尚未导入文稿或建立剧本')
    nextActions = [
      action(
        'manuscript.import',
        '导入文稿并分章',
        '影视生产需要可追踪的文稿或章节作为来源。',
        'requires_user_interaction',
      ),
    ]
  } else if (counts.screenplays === 0) {
    currentStage = 'screenplay'
    blockers.push('已有文稿，但尚未生成场次剧本')
    nextActions = [
      action('chapter.to_screenplay', '提取场次剧本', '先把章节改写为可拍摄剧本并由用户确认。'),
    ]
  } else if (counts.characters === 0 || counts.scenes === 0) {
    currentStage = 'assets'
    if (counts.characters === 0) blockers.push('尚未建立角色资产')
    if (counts.scenes === 0) blockers.push('尚未建立场景资产')
    nextActions = [
      ...(counts.characters === 0
        ? [action('screenplay.extract_characters', '提取角色', '角色身份是后续视觉一致性的基础。', 'create_operation_node', true)]
        : []),
      ...(counts.scenes === 0
        ? [action('screenplay.extract_scenes', '提取场景', '场景资产用于场景图、全景图和镜头空间连续性。', 'create_operation_node', true)]
        : []),
      action('screenplay.extract_props', '提取关键道具', '提前识别影响叙事和镜头连续性的道具。', 'create_operation_node', true),
      action('screenplay.extract_effects', '提取关键特效', '提前识别需要独立视觉设计的特效。', 'create_operation_node', true),
    ]
  } else if (counts.designedAssets < requiredDesignAssetIds.size) {
    currentStage = 'design_assets'
    blockers.push('角色身份板或场景设计图尚未齐套')
    nextActions = [
      action('character.three_view', '生成角色身份板', '先锁定角色外貌与服装基准。', 'create_operation_node', true),
      action('scene.scene_image', '生成场景图', '先建立场景视觉和材质基准。', 'create_operation_node', true),
      action('scene.panorama_360', '评估重点场景并生成全景图', '高频、关键或复杂调度场景需要空间基准。'),
    ]
  } else if (counts.shotGroups === 0) {
    currentStage = 'episodes'
    blockers.push('尚未按集建立分镜分组')
    nextActions = [
      action('screenplay.split_episodes', '按剧情分集', '先确定每集边界、时长和结尾钩子。'),
      action('screenplay.to_shot_script', '按集生成分镜脚本', '每集独立生成并落为分镜分组。'),
    ]
  } else if (counts.shots === 0) {
    currentStage = 'storyboard'
    blockers.push('已有分镜分组，但组内没有镜头片段')
    nextActions = [
      action('screenplay.to_shot_script', '按集生成分镜脚本', '逐集拆成精确到秒的镜头。'),
    ]
  } else if (counts.keyframes === 0) {
    currentStage = 'shot_assets'
    blockers.push('分镜已有，但尚未完成镜头资产检查和关键帧')
    nextActions = [
      action('shot.audit_assets', '检查镜头资产', '补齐关键道具、特效、服装、动作和空间调度资产。', 'tool_recipe'),
      action('shot.create_keyframes', '创建关键帧节点', '使用已确认的角色与场景基准生成首尾帧。'),
    ]
  } else if (counts.videos === 0) {
    currentStage = 'video'
    nextActions = [
      action('video.create_nodes', '创建视频生成节点', '关键帧已具备，可按分镜批量创建待确认视频任务。'),
    ]
  } else {
    currentStage = 'complete'
    nextActions = [
      action('edl.create', '生成成片清单 EDL', '汇总现有视频片段、镜号和累计时间码。', 'tool_recipe'),
    ]
  }

  return {
    currentStage,
    summary: `当前处于“${STANDARD_WORKFLOW.find((stage) => stage.id === currentStage)?.label ?? '成片整理'}”阶段。`,
    blockers,
    nextActions,
    workflow: STANDARD_WORKFLOW,
    guardrails: [
      '宽泛创作请求先读取项目摘要和本制作计划，再操作节点。',
      '优先复用已有节点和同名影视资产，创建前先搜索去重。',
      '剧本、角色/场景设计、分镜和关键帧按阶段确认后再推进下游。',
      '默认只创建并配置操作节点；用户明确要求立即执行时才运行媒体任务。',
      '分集使用当前单画布中的分组、集号和命名组织，不创建或切换画板。',
    ],
    counts,
  }
}
