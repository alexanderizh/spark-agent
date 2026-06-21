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

import type { CanvasOperationType, CanvasPipelineRole } from './canvas.types'

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
  /** 节奏基线：平均镜时（秒/镜），分镜 agent 切分用 */
  pacingSecPerShot?: number
  /** 单段视频模型时长上限（秒）；分镜 agent 据此保证每镜不超模型上限 */
  maxClipSec?: number
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
   * `{upstream}` / `{title}` / `{style}` / `{pacing}` / `{maxClip}` 为占位槽，
   * 由 buildAgentPresetPrompt 用上下文替换；未提供的槽给出占位说明，提示用户补全。
   */
  template: string
}

/** 默认单段视频时长上限（秒）——多数图生视频模型支持 4~10s，取保守上限 */
export const DEFAULT_MAX_CLIP_SEC = 5

/** 内置专属 agent 预设 */
export const CANVAS_AGENT_PRESETS: CanvasAgentPreset[] = [
  {
    role: 'screenwriter',
    label: '剧本 agent',
    description: '把章节原文改写为规范的场次剧本，或润色既有剧本的对白与节奏',
    pipelineRole: 'screenplay',
    defaultOperation: 'text_generate',
    persona:
      '你是资深影视编剧。擅长把小说/散文改写为可拍摄的场次剧本，精通场景切分、动作描述、对白塑造与节奏控制。严格遵循格式，直接输出剧本，不解释过程。',
    template: [
      '【任务】把下面的原文改写为规范的影视场次剧本。',
      '',
      '【输出格式】按场次组织，每场包含：',
      '- 场号 + 内/外景 + 地点 + 时间（例：场1 内景 茶馆 日）',
      '- 出场人物',
      '- 动作描述（客观、可视、现在时）',
      '- 对白（角色名：台词）',
      '- 必要时给出旁白/字幕',
      '不要加入镜头语言（景别/运镜留给分镜阶段）。保持原文情节与人物关系，可合并琐碎、强化戏剧张力。',
      '',
      '【原文】',
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
  {
    role: 'storyboard',
    label: '分镜 agent',
    description: '把场次剧本拆成精确到秒的分镜表，每镜不超过视频模型时长上限',
    pipelineRole: 'shot',
    defaultOperation: 'text_generate',
    persona:
      '你是专业分镜师。把剧本拆解为可逐镜生成的分镜表，精确到秒，兼顾对白朗读时长、动作节拍与整体节奏。每一镜都要能被图生视频模型单独生成。',
    template: [
      '【任务】把下面的场次剧本拆成「精确到秒」的分镜表。',
      '',
      '【切分依据】对白按朗读时长估时（中文约5字/秒）+ 动作节拍 + 节奏基线（约 {pacing} 秒/镜）。',
      '【硬约束】单镜时长不得超过 {maxClip} 秒（视频模型上限）；超过则拆成多镜，并保证镜间画面可衔接。',
      '',
      '【输出格式】先输出一个 JSON 对象，再输出 Markdown 表格。',
      'JSON 顶层结构必须为：{"shots":[...],"summary":{"shotCount":数字,"totalDurationSec":数字}}。',
      '每个 shots[] 项包含 index、durationSec、shotSize、movement、description、dialogue、characters、shotPrompt；字段无内容可用空字符串或空数组。',
      '',
      '随后输出兼容导入器的 Markdown 表格，列：',
      '| 镜号 | 时长(秒) | 景别 | 运镜 | 画面/动作 | 对白 | 角色 |',
      '景别用：远景/全景/中景/近景/特写；运镜用：固定/推/拉/摇/移/跟/环绕。',
      '表格后给出：总镜数、总时长（秒）。',
      '',
      '【场次剧本】',
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
  {
    role: 'director',
    label: '导演 agent',
    description: '为分镜补全镜头语言、调度与视觉方案，统一全片影像气质',
    pipelineRole: 'camera',
    defaultOperation: 'text_generate',
    persona:
      '你是电影导演。从场面调度、镜头语言、光影与色彩、表演情绪出发，给分镜注入电影感，并保证全片视觉统一。给出可执行的镜头方案，不空谈理论。',
    template: [
      '【任务】作为导演，审阅并增强下面的分镜，补全镜头语言与场面调度。',
      '',
      '【对每一镜给出】',
      '- 景别 / 角度（平视/俯/仰/过肩/主观）/ 运镜 / 焦段',
      '- 构图与视觉重点、光影与色调、氛围',
      '- 主要角色的位置关系、走位与表演情绪',
      '- 与上一镜、下一镜的衔接（动作衔接/视线匹配/转场）',
      '保持镜号与时长不变，只补充/优化镜头语言，输出与输入同结构的增强版分镜表。',
      '',
      '【分镜】',
      '{upstream}',
      '',
      '{style}',
    ].join('\n'),
  },
  {
    role: 'action',
    label: '动作设计 agent',
    description: '为打斗/特技/运动镜头做动作分解与节拍设计，配套运镜建议',
    pipelineRole: 'action',
    defaultOperation: 'text_generate',
    persona:
      '你是动作指导（武术指导）。擅长把一段冲突/打斗/追逐分解为清晰、安全、有节奏的动作节拍，并给出与之匹配的运镜与剪辑建议。动作要具体到招式与身体部位。',
    template: [
      '【任务】为下面的动作段落做专业动作设计与节拍分解。',
      '',
      '【输出】按节拍编号给出：',
      '- 节拍 N：双方/主体的具体动作（招式、发力、身体部位、移动方向）',
      '- 力度与速度（蓄力/爆发/停顿）、预期时长（秒）',
      '- 配套运镜与剪辑点（跟拍/甩镜/慢镜/硬切）',
      '- 安全与可拍性提示',
      '最后给出整段的动作高潮点与总时长建议。',
      '',
      '【动作段落】',
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
export function buildAgentPresetPrompt(role: CanvasAgentRoleId, ctx: AgentPresetContext = {}): string {
  const preset = getAgentPreset(role)
  if (!preset) return ''

  const upstream =
    ctx.upstreamText && ctx.upstreamText.trim().length > 0
      ? ctx.upstreamText.trim()
      : '（在此粘贴上游内容，或先选中上游节点再发起）'
  const pacing = ctx.pacingSecPerShot && ctx.pacingSecPerShot > 0 ? String(ctx.pacingSecPerShot) : '3'
  const maxClip = ctx.maxClipSec && ctx.maxClipSec > 0 ? String(ctx.maxClipSec) : String(DEFAULT_MAX_CLIP_SEC)
  const style =
    ctx.styleBible && ctx.styleBible.trim().length > 0
      ? `【全片视觉总设定（须贯彻）】\n${ctx.styleBible.trim()}`
      : ''

  let result = preset.template
    .replaceAll('{upstream}', upstream)
    .replaceAll('{pacing}', pacing)
    .replaceAll('{maxClip}', maxClip)
    .replaceAll('{style}', style)

  // title 槽位（可选，部分模板未使用）
  result = result.replaceAll('{title}', ctx.title?.trim() ?? '')

  // 清理 style 为空时残留的多余空行
  return result.replace(/\n{3,}/g, '\n\n').trim()
}
