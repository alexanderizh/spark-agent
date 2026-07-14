/**
 * 画布专用流水线操作目录（「文本节点右键 → 专用流水线节点」改造的单一事实源）。
 *
 * 每个 op = 一个右键可执行的专用操作：源节点 → 任务节点 → 产物节点。
 * 这里只描述「有哪些 op / 适用于哪些源 / 产出什么 / 文本类 op 的提示词怎么拼」，
 * 真正的任务编排在 CanvasWorkspaceView（复用 handleCreateTask / runTrackedCanvasWorkflow）。
 * 纯逻辑、无 DOM/IPC，便于单测。
 */

import type { CanvasOperationType, CanvasNodeType, CanvasPipelineRole } from './canvas.types'
import { buildAgentPresetPrompt } from './canvasAgentPromptPresets'
import { buildEntityExtractionPrompt, type ExtractEntityKind } from './canvasEntityExtract'

/** op 类别：文本生成 / 实体抽取(一对多) / 图像生成 / 视频生成 */
export type PipelineOpKind = 'text' | 'extract' | 'image' | 'video'

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
  /** 适用的源流水线角色 */
  appliesTo: CanvasPipelineRole[]
  /** 是否也适用于「无 pipelineRole 的纯文本/Prompt 节点」（让剧本文本节点右键即可用） */
  appliesToText?: boolean
  /** 落为任务时的 operation */
  baseOperation?: CanvasOperationType
  /** 抽取类 op 的实体种类 */
  extractKind?: ExtractEntityKind
}

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
    extractKind: 'scene',
  },
  {
    id: 'screenplay.storyboard_grid',
    label: '生成分镜关键帧图',
    icon: 'Image',
    kind: 'image',
    produces: 'keyframe',
    appliesTo: ['screenplay'],
    appliesToText: true,
    baseOperation: 'text_to_image',
  },
  // 角色 / 场景 / 道具 / 特效设计图
  {
    id: 'character.three_view',
    label: '生成角色身份板',
    icon: 'User',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['character'],
    baseOperation: 'text_to_image',
  },
  {
    id: 'scene.scene_image',
    label: '生成场景图',
    icon: 'Box',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['scene'],
    baseOperation: 'text_to_image',
  },
  {
    id: 'prop.prop_image',
    label: '生成道具图',
    icon: 'Box',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['prop'],
    baseOperation: 'text_to_image',
  },
  {
    id: 'effect.effect_image',
    label: '生成特效图',
    icon: 'Sparkles',
    kind: 'image',
    produces: 'design_card',
    appliesTo: ['effect'],
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
    baseOperation: 'text_to_image',
  },
  {
    id: 'shot.to_video',
    label: '生成视频',
    icon: 'Play',
    kind: 'video',
    produces: 'clip',
    appliesTo: ['shot'],
    baseOperation: 'image_to_video',
  },
  {
    id: 'keyframe.to_video',
    label: '出视频(首尾帧)',
    icon: 'Play',
    kind: 'video',
    produces: 'clip',
    appliesTo: ['keyframe'],
    baseOperation: 'image_to_video',
  },
]

export function getOp(id: string): CanvasPipelineOp | undefined {
  return CANVAS_PIPELINE_OPS.find((op) => op.id === id)
}

/** 某流水线角色「下一步」可执行的 op */
export function getOpsForRole(role: CanvasPipelineRole | undefined): CanvasPipelineOp[] {
  if (!role) return []
  return CANVAS_PIPELINE_OPS.filter((op) => op.appliesTo.includes(role))
}

/**
 * 某节点可执行的 op。
 * 文本/Prompt/组节点（chapter / screenplay / 普通文本 / 含文本的组）共享同一份「全量文本菜单」：
 * 合并「按角色匹配」与「appliesToText」两路，按 CANVAS_PIPELINE_OPS 原始顺序返回。
 * 这样章节、剧本、普通文本节点，以及包含文本的组节点，都能使用：转剧本 / 生成分镜脚本 / 提取角色 / 提取场景 / 生成分镜关键帧图。
 */
export function getOpsForNode(node: {
  type: CanvasNodeType
  data?: { pipelineRole?: CanvasPipelineRole }
}): CanvasPipelineOp[] {
  const role = node.data?.pipelineRole
  const isTextNode = node.type === 'text' || node.type === 'prompt' || node.type === 'group'
  if (!isTextNode) {
    return role ? getOpsForRole(role) : []
  }
  return CANVAS_PIPELINE_OPS.filter((op) => {
    if (role && op.appliesTo.includes(role)) return true
    return Boolean(op.appliesToText)
  })
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
    default:
      return ''
  }
}
