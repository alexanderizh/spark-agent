/**
 * 画布「专属 agent」内置提示词预设（设计 §12 Agent 能力 / 用户诉求：剧本/分镜/导演/动作 agent）。
 *
 * 落点：不新增独立 agent 节点，而是作为 **AI 操作节点（文本类）的内置提示词预设**。
 * 用户在操作节点里：
 *   1. 可选一个应用内配置的专属 agent（ManagedAgent，提供人设 system prompt）；
 *   2. 选一个内置角色预设（本模块），把「写好的提示词」一键填入可编辑的提示词框；
 *   3. 自由编辑后发起 text_generate / text_rewrite。
 *
 * 与 canvasCharacterSheetPrompts（图像积木）同构：纯逻辑、可单测、无 DOM/IPC。
 * 这里产出的是**给文本模型/agent 的中文指令**（非英文积木），因为剧本/分镜/导演/动作
 * 是结构化创作任务，需要明确的角色身份 + 输入 + 输出格式约束。
 */

import type { CanvasOperationType, CanvasPipelineRole, ShotScriptConfig } from './canvas.types'
import { translate } from '../../i18n'

/** 专属创作 agent 角色 id */
export type CanvasAgentRoleId =
  | 'screenwriter' // 剧本 agent
  | 'storyboard' // 分镜 agent
  | 'director' // 导演 agent
  | 'action' // 动作设计 agent

/** 填充内置提示词模板的上下文（全部可选，便于解耦/测试） */
export type AgentPresetContext = {
  /** 上游已确认节点的文本（章节原文 / 场次剧本 / 分镜表等） */
  upstreamText?: string
  /** S0 视觉总设定（项目级风格），拼进指令尾部统一全片风格 */
  styleBible?: string
  /** 场次 / 段落标题，用于 prompt 抬头 */
  title?: string
  /** 单段视频模型时长上限（秒）；分镜 agent 据此保证每镜不超模型上限 */
  maxClipSec?: number
  /**
   * 分镜模板的 {maxClip} 占位槽是否保留（不替换成具体数值）。
   * 画布分镜任务节点创建时置 true，运行时再由 applyShotScriptConfigToPrompt 按用户
   * 在配置面板上选的每镜最长时间替换，确保改值即时生效。
   */
  keepShotScriptPlaceholders?: boolean
}

export type CanvasAgentPreset = {
  role: CanvasAgentRoleId
  /** 中文标签 */
  label: string
  /** 一句话职责 */
  description: string
  /** 关联流水线角色（用于节点着色 / 推荐匹配的 ManagedAgent） */
  pipelineRole: CanvasPipelineRole
  /** 默认 AI 操作：剧本改写走 text_rewrite，其余生成走 text_generate */
  defaultOperation: CanvasOperationType
  /**
   * 人设 system 提示词：当用户**未**选具体 ManagedAgent 时，可由调用方把它
   * 作为兜底 system（或前缀）使用，让"无 agent"也带角色身份。
   */
  persona: string
  /**
   * 可编辑的指令模板（一键填入操作节点的「提示词」框）。
   * `{upstream}` / `{title}` / `{style}` / `{maxClip}` 为占位槽，
   * 由 buildAgentPresetPrompt 用上下文替换；未提供的槽给出占位说明，提示用户补全。
   */
  template: string
}

/** 默认单段视频时长上限（秒）——多数图生视频模型支持 4~10s，取保守上限 */
export const DEFAULT_MAX_CLIP_SEC = 5

/** 分镜脚本任务的默认时长配置（每镜最长 5s） */
export const DEFAULT_SHOT_SCRIPT_CONFIG: ShotScriptConfig = {
  maxClipSec: DEFAULT_MAX_CLIP_SEC,
}

/**
 * 用分镜时长配置替换 prompt 里的 {maxClip} 占位槽。
 * 占位槽不存在时为 no-op（用户手编删了占位符 / 非分镜模板都能安全调用）。
 */
export function applyShotScriptConfigToPrompt(prompt: string, cfg: ShotScriptConfig): string {
  return prompt.replaceAll('{maxClip}', String(cfg.maxClipSec))
}

/** 内置专属 agent 预设 */
export const CANVAS_AGENT_PRESETS: CanvasAgentPreset[] = [
  {
    role: 'screenwriter',
    label: translate('canvasAgentPresets.t1'),
    description: translate('canvasAgentPresets.t2Desc'),
    pipelineRole: 'screenplay',
    defaultOperation: 'text_generate',
    persona: translate('canvasAgentPresets.t3Instruction'),
    template: [
      translate('canvasAgentPresets.t4Instruction'),
      '',
      translate('canvasAgentPresets.t5Instruction'),
      translate('canvasAgentPresets.t6Instruction'),
      translate('canvasAgentPresets.t7Instruction'),
      translate('canvasAgentPresets.t8Instruction'),
      translate('canvasAgentPresets.t9Instruction'),
      translate('canvasAgentPresets.t10Instruction'),
      translate('canvasAgentPresets.t11Instruction'),
      '',
      translate('canvasAgentPresets.t12Instruction'),
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
  {
    role: 'storyboard',
    label: translate('canvasAgentPresets.t13'),
    description: translate('canvasAgentPresets.t14Instruction'),
    pipelineRole: 'shot',
    defaultOperation: 'text_generate',
    persona: translate('canvasAgentPresets.t15Instruction'),
    template: [
      translate('canvasAgentPresets.t16Instruction'),
      translate('canvasAgentPresets.t17Instruction'),
      '',
      translate('canvasAgentPresets.t18Instruction'),
      translate('canvasAgentPresets.t19Instruction'),
      translate('canvasAgentPresets.t20Instruction'),
      translate('canvasAgentPresets.t21Instruction'),
      '',
      translate('canvasAgentPresets.t22Instruction'),
      '',
      translate('canvasAgentPresets.t23Instruction'),
      '',
      translate('canvasAgentPresets.t24Instruction'),
      translate('canvasAgentPresets.t25Instruction'),
      translate('canvasAgentPresets.t26Instruction'),
      translate('canvasAgentPresets.t27Instruction'),
      translate('canvasAgentPresets.t28Instruction'),
      translate('canvasAgentPresets.t29Instruction'),
      translate('canvasAgentPresets.t30Instruction'),
      translate('canvasAgentPresets.t31Instruction'),
      translate('canvasAgentPresets.t32Instruction'),
      translate('canvasAgentPresets.t33Instruction'),
      translate('canvasAgentPresets.t34Instruction'),
      translate('canvasAgentPresets.t35Instruction'),
      translate('canvasAgentPresets.t36Instruction'),
      translate('canvasAgentPresets.t37Instruction'),
      translate('canvasAgentPresets.t38Instruction'),
      translate('canvasAgentPresets.t39Instruction'),
      translate('canvasAgentPresets.t40Instruction'),
      translate('canvasAgentPresets.t41Instruction'),
      translate('canvasAgentPresets.t42Instruction'),
      translate('canvasAgentPresets.t43Instruction'),
      translate('canvasAgentPresets.t44Instruction'),
      translate('canvasAgentPresets.t45Instruction'),
      translate('canvasAgentPresets.t46Instruction'),
      translate('canvasAgentPresets.t47Instruction'),
      translate('canvasAgentPresets.t48Instruction'),
      translate('canvasAgentPresets.t49Instruction'),
      translate('canvasAgentPresets.t50Instruction'),
      translate('canvasAgentPresets.t51Instruction'),
      translate('canvasAgentPresets.t52Instruction'),
      translate('canvasAgentPresets.t53Instruction'),
      translate('canvasAgentPresets.t54Instruction'),
      translate('canvasAgentPresets.t55Instruction'),
      translate('canvasAgentPresets.t56Instruction'),
      translate('canvasAgentPresets.t57Instruction'),
      translate('canvasAgentPresets.t58Instruction'),
      '',
      translate('canvasAgentPresets.t59Instruction'),
      translate('canvasAgentPresets.t60Instruction'),
      translate('canvasAgentPresets.t61Instruction'),
      translate('canvasAgentPresets.t62Instruction'),
      translate('canvasAgentPresets.t63Instruction'),
      translate('canvasAgentPresets.t64Instruction'),
      translate('canvasAgentPresets.t65Instruction'),
      translate('canvasAgentPresets.t66Instruction'),
      '',
      translate('canvasAgentPresets.t67Instruction'),
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
  {
    role: 'director',
    label: translate('canvasAgentPresets.t68'),
    description: translate('canvasAgentPresets.t69Desc'),
    pipelineRole: 'camera',
    defaultOperation: 'text_generate',
    persona: translate('canvasAgentPresets.t70Instruction'),
    template: [
      translate('canvasAgentPresets.t71Instruction'),
      '',
      translate('canvasAgentPresets.t72Instruction'),
      translate('canvasAgentPresets.t73Instruction'),
      translate('canvasAgentPresets.t74Instruction'),
      translate('canvasAgentPresets.t75Instruction'),
      translate('canvasAgentPresets.t76Instruction'),
      translate('canvasAgentPresets.t77Instruction'),
      '',
      translate('canvasAgentPresets.t78Instruction'),
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
  {
    role: 'action',
    label: translate('canvasAgentPresets.t79'),
    description: translate('canvasAgentPresets.t80Desc'),
    pipelineRole: 'action',
    defaultOperation: 'text_generate',
    persona: translate('canvasAgentPresets.t81Instruction'),
    template: [
      translate('canvasAgentPresets.t82Instruction'),
      '',
      translate('canvasAgentPresets.t83Instruction'),
      translate('canvasAgentPresets.t84Instruction'),
      translate('canvasAgentPresets.t85Instruction'),
      translate('canvasAgentPresets.t86Instruction'),
      translate('canvasAgentPresets.t87Instruction'),
      translate('canvasAgentPresets.t88Instruction'),
      '',
      translate('canvasAgentPresets.t89Instruction'),
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
]

export function getAgentPreset(role: CanvasAgentRoleId): CanvasAgentPreset | undefined {
  return CANVAS_AGENT_PRESETS.find((preset) => preset.role === role)
}

/**
 * 用上下文填充内置提示词模板，返回可继续编辑的最终提示词。
 * 未提供的槽位给出中文占位提示（而非留空），引导用户补全。
 */
export function buildAgentPresetPrompt(
  role: CanvasAgentRoleId,
  ctx: AgentPresetContext = {},
): string {
  const preset = getAgentPreset(role)
  if (!preset) return ''

  const upstream =
    ctx.upstreamText && ctx.upstreamText.trim().length > 0
      ? ctx.upstreamText.trim()
      : translate('canvasAgentPresets.t90Desc')
  const maxClip =
    ctx.maxClipSec && ctx.maxClipSec > 0 ? String(ctx.maxClipSec) : String(DEFAULT_MAX_CLIP_SEC)
  const style =
    ctx.styleBible && ctx.styleBible.trim().length > 0
      ? translate('canvasAgentPresets.tpl1Instruction', { text: ctx.styleBible.trim() })
      : ''

  // keepShotScriptPlaceholders=true 时保留 {maxClip} 占位槽（画布分镜任务节点用，
  // 运行时由 applyShotScriptConfigToPrompt 按用户配置替换）；其余调用方默认替换成具体数值。
  const keepShotPlaceholders = ctx.keepShotScriptPlaceholders === true
  let result = preset.template.replaceAll('{upstream}', upstream).replaceAll('{style}', style)
  if (!keepShotPlaceholders) {
    result = result.replaceAll('{maxClip}', maxClip)
  }

  // title 槽位（可选，部分模板未使用）
  result = result.replaceAll('{title}', ctx.title?.trim() ?? '')

  // 清理 style 为空时残留的多余空行
  return result.replace(/\n{3,}/g, '\n\n').trim()
}
