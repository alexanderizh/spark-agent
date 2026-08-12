/**
 * 画布专用流水线操作目录（「文本节点右键 → 专用流水线节点」改造的单一事实源）。
 *
 * 每个 op = 一个右键可执行的专用操作：源节点 → 任务节点 → 产物节点。
 * 这里只描述「有哪些 op / 适用于哪些源 / 产出什么 / 文本类 op 的提示词怎么拼」，
 * 真正的任务编排在 CanvasWorkspaceView（复用 handleCreateTask / runTrackedCanvasWorkflow）。
 * 纯逻辑、无 DOM/IPC，便于单测。
 */

import type { CanvasNodeType, CanvasOperationType, CanvasPipelineRole } from './canvas.types'
import { buildAgentPresetPrompt } from './canvasAgentPromptPresets'
import { buildEntityExtractionPrompt, type ExtractEntityKind } from './canvasEntityExtract'

/** op 类别：文本生成 / 实体抽取(一对多) / 图像生成 / 视频生成 */
export type PipelineOpKind = 'text' | 'extract' | 'image' | 'video'

/**
 * 专用流水线动作真正关心的是输入媒体，而不是输入节点在影视流水线里的语义角色。
 * 例如普通文本、章节文本和剧本文本都可以作为分镜脚本的输入。
 */
export type CanvasPipelineInputType = 'text' | 'prompt' | 'image' | 'video' | 'audio'

export const CANVAS_PIPELINE_MENU_GROUPS: ReadonlyArray<{
  id: PipelineOpKind
  label: string
}> = [
  { id: 'text', label: '文本编排' },
  { id: 'extract', label: '资产提取' },
  { id: 'image', label: '视觉生成' },
  { id: 'video', label: '视频生成' },
]

export type CanvasPipelineOp = {
  /** 稳定 id（UI 绑定 + dispatch + 测试） */
  id: string
  /** 中文菜单标签 */
  label: string
  /** 图标 key（映射到 Icons.*，避免在纯模块里引 JSX） */
  icon: string
  kind: PipelineOpKind
  /** 产出节点的流水线角色 */
  produces: CanvasPipelineRole
  /** 适用的源流水线角色（仅用于推荐顺序和角色化展示，不是输入校验） */
  appliesTo: CanvasPipelineRole[]
  /** @deprecated 兼容旧目录数据；节点动作发现改用 inputTypes。 */
  appliesToText?: boolean
  /** 真正的输入约束，只按内容媒体类型筛选。 */
  inputTypes: CanvasPipelineInputType[]
  /** 落为任务时的 operation */
  baseOperation?: CanvasOperationType
  /** 抽取类 op 的实体种类 */
  extractKind?: ExtractEntityKind
}

/** 可直接从同类型影视资产卡片继续创建的图像任务类型（保留作为旧调用的兼容类型）。 */
export type CanvasPipelineAssetKind = 'character' | 'scene' | 'prop' | 'effect'

export const CANVAS_PIPELINE_OPS: CanvasPipelineOp[] = [
  // 章节（也适用于任意文本节点：剧本/普通文本都可发起剧本化改写）
  {
    id: 'chapter.to_screenplay',
    label: '转剧本',
    icon: 'FileText',
    kind: 'text',
    produces: 'screenplay',
    appliesTo: ['chapter'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    baseOperation: 'text_rewrite',
  },
  // 剧本（也适用于任意文本节点）
  {
    id: 'screenplay.to_shot_script',
    label: '生成分镜脚本',
    icon: 'Film',
    kind: 'text',
    produces: 'shot',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    baseOperation: 'text_generate',
  },
  {
    id: 'screenplay.extract_characters',
    label: '提取角色',
    icon: 'User',
    kind: 'extract',
    produces: 'character',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    extractKind: 'character',
  },
  {
    id: 'screenplay.extract_scenes',
    label: '提取场景',
    icon: 'Map',
    kind: 'extract',
    produces: 'scene',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    extractKind: 'scene',
  },
  {
    id: 'screenplay.extract_props',
    label: '提取道具',
    icon: 'Box',
    kind: 'extract',
    produces: 'prop',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    extractKind: 'prop',
  },
  {
    id: 'screenplay.extract_effects',
    label: '提取特效',
    icon: 'Sparkles',
    kind: 'extract',
    produces: 'effect',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    extractKind: 'effect',
  },
  {
    id: 'screenplay.storyboard_grid',
    label: '生成分镜关键帧图',
    icon: 'Image',
    kind: 'image',
    produces: 'keyframe',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'storyboard_grid',
  },
  // 角色 / 场景 / 道具 / 特效设计图
  {
    id: 'character.three_view',
    label: '生成角色身份板',
    icon: 'User',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['character'],
    appliesToText: true,
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'text_to_image',
  },
  {
    id: 'scene.scene_image',
    label: '生成场景图',
    icon: 'Box',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['scene'],
    appliesToText: true,
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'text_to_image',
  },
  {
    id: 'prop.prop_image',
    label: '生成道具图',
    icon: 'Box',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['prop'],
    appliesToText: true,
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'text_to_image',
  },
  {
    id: 'effect.effect_image',
    label: '生成特效图',
    icon: 'Sparkles',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['effect'],
    appliesToText: true,
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'text_to_image',
  },
  // 分镜 / 关键帧
  {
    id: 'shot.to_keyframes',
    label: '生成关键帧',
    icon: 'Image',
    kind: 'image',
    produces: 'keyframe',
    appliesTo: ['shot'],
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'storyboard_grid',
  },
  {
    id: 'keyframe.to_video',
    label: '出视频(首尾帧)',
    icon: 'Play',
    kind: 'video',
    produces: 'clip',
    appliesTo: ['keyframe'],
    inputTypes: ['image'],
    baseOperation: 'image_to_video',
  },
  {
    id: 'screenplay.split_episodes',
    label: '按剧情分集',
    icon: 'FileText',
    kind: 'text',
    produces: 'screenplay',
    appliesTo: ['screenplay'],
    appliesToText: true,
    inputTypes: ['text', 'prompt'],
    baseOperation: 'text_generate',
  },
  {
    id: 'scene.panorama_360',
    label: '生成重点场景 360 全景图',
    icon: 'Globe',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['scene'],
    appliesToText: true,
    inputTypes: ['text', 'prompt', 'image'],
    baseOperation: 'panorama_360',
  },
]

/**
 * 右键「影视创作」菜单使用的动作目录。
 *
 * 视频生成已经由「基础任务 → 视频」承载，影视创作菜单只保留文本、资产提取和视觉生成
 * 流水线，避免同一个视频入口同时出现在两个层级。
 */
export const CANVAS_FILM_PIPELINE_OPS: CanvasPipelineOp[] = CANVAS_PIPELINE_OPS.filter(
  (op) => op.kind !== 'video',
)

export function getOp(id: string): CanvasPipelineOp | undefined {
  return CANVAS_PIPELINE_OPS.find((op) => op.id === id)
}

/** 某流水线角色「下一步」可执行的 op */
export function getOpsForRole(role: CanvasPipelineRole | undefined): CanvasPipelineOp[] {
  if (!role) return []
  return CANVAS_PIPELINE_OPS.filter((op) => op.appliesTo.includes(role))
}

const OPERATION_OUTPUT_INPUT_TYPE: Partial<Record<CanvasNodeType, CanvasPipelineInputType>> = {
  text_to_image: 'image',
  image_to_image: 'image',
  image_edit: 'image',
  image_compose: 'image',
  storyboard_grid: 'image',
  panorama_360: 'image',
  text_generate: 'text',
  text_rewrite: 'text',
  prompt_optimize: 'prompt',
  image_prompt_reverse: 'text',
  text_to_video: 'video',
  image_to_video: 'video',
  video_edit: 'video',
  video_extend: 'video',
  video_depth_map: 'video',
  extract_audio: 'audio',
  text_to_audio: 'audio',
  audio_transcribe: 'text',
}

/** 读取节点实际承载的输入媒体类型；不读取 pipelineRole。 */
export function getCanvasPipelineInputType(node: {
  type: CanvasNodeType
  data?: {
    pipelineRole?: CanvasPipelineRole
    operation?: CanvasOperationType
    text?: string
    url?: string
    mimeType?: string
  }
}): CanvasPipelineInputType | undefined {
  if (node.type === 'text') return 'text'
  if (node.type === 'prompt') return 'prompt'
  if (node.type === 'image' || node.type === 'panorama_360') return 'image'
  if (node.type === 'video') return 'video'
  if (node.type === 'audio') return 'audio'
  if (node.type === 'group') return 'text'
  const operation = node.data?.operation ?? node.type
  const outputType = OPERATION_OUTPUT_INPUT_TYPE[operation]
  if (outputType) return outputType
  if (node.data?.mimeType?.startsWith('image/')) return 'image'
  if (node.data?.mimeType?.startsWith('video/')) return 'video'
  if (node.data?.mimeType?.startsWith('audio/')) return 'audio'
  if (node.data?.text?.trim()) return 'text'
  if (node.data?.url) return 'image'
  return undefined
}

/**
 * 某节点可执行的 op。
 * 节点动作发现只按节点实际输入媒体类型筛选；pipelineRole 不参与门控。
 * appliesTo 仍由 getOpsForRole 提供角色化推荐和兼容查询，但不能阻止普通文本、图片或其他
 * 合法媒体输入使用同一个专用动作。
 */
export function getOpsForNode(
  node: {
    type: CanvasNodeType
    data?: {
      pipelineRole?: CanvasPipelineRole
      operation?: CanvasOperationType
      text?: string
      url?: string
      mimeType?: string
    }
  },
  options: {
    assetKinds?: readonly CanvasPipelineAssetKind[]
    inputTypes?: readonly CanvasPipelineInputType[]
  } = {},
): CanvasPipelineOp[] {
  // assetKinds 仅保留在 API 中兼容旧调用；动作是否可用不再由影视资产语义决定。
  void options.assetKinds
  const inputTypes =
    options.inputTypes ??
    (() => {
      const inputType = getCanvasPipelineInputType(node)
      return inputType ? [inputType] : []
    })()
  if (inputTypes.length === 0) return []
  return CANVAS_PIPELINE_OPS.filter((op) =>
    op.inputTypes.some((inputType) => inputTypes.includes(inputType)),
  )
}

/** 文本/抽取类 op 的提示词（图像/视频类返回空，由 workspace 用各自资产构建） */
export function buildOpPrompt(
  id: string,
  ctx: {
    upstreamText?: string
    styleBible?: string
    maxClipSec?: number
    keepShotScriptPlaceholders?: boolean
  } = {},
): string {
  const op = getOp(id)
  if (!op) return ''
  switch (op.id) {
    case 'screenplay.to_shot_script':
      return buildAgentPresetPrompt('storyboard', {
        ...(ctx.upstreamText ? { upstreamText: ctx.upstreamText } : {}),
        ...(ctx.styleBible ? { styleBible: ctx.styleBible } : {}),
        ...(ctx.maxClipSec ? { maxClipSec: ctx.maxClipSec } : {}),
        ...(ctx.keepShotScriptPlaceholders ? { keepShotScriptPlaceholders: true } : {}),
      })
    case 'screenplay.extract_characters':
      return buildEntityExtractionPrompt('character', ctx.upstreamText ?? '', ctx.styleBible)
    case 'screenplay.extract_scenes':
      return buildEntityExtractionPrompt('scene', ctx.upstreamText ?? '', ctx.styleBible)
    case 'screenplay.extract_props':
      return buildEntityExtractionPrompt('prop', ctx.upstreamText ?? '', ctx.styleBible)
    case 'screenplay.extract_effects':
      return buildEntityExtractionPrompt('effect', ctx.upstreamText ?? '', ctx.styleBible)
    default:
      return ''
  }
}
