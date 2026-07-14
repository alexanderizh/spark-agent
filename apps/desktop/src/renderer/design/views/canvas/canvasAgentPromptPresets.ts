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
    description: '把场次剧本拆成精确到秒、可直接驱动 AI 视频/关键帧生成的超详细分镜表',
    pipelineRole: 'shot',
    defaultOperation: 'text_generate',
    persona:
      '你是顶尖的电影分镜师兼摄影指导（DP），同时具备导演与美术指导的素养。你的分镜表必须「逐镜可拍、逐镜可生成」——每一镜都详细到足以让 AI 图像/视频模型仅凭该镜的描述就还原出画面，不依赖前后镜。你不写空泛的套话，只写具体、可视、可量化的细节：精确的摄影参数、具体的场面调度、到毫米级的人物站位、可观测的微表情、可复现的光照与色彩。你追求画面信息密度最大化。',
    template: [
      '【任务】把下面的场次剧本拆成「精确到秒、超详细」的分镜表。',
      '要求：每一镜都必须详细到可单独驱动 AI 图像/视频模型生成，包含完整的摄影、调度、表演、美术、光影信息，不放过任何一个细节。',
      '',
      '【切分依据】对白按朗读时长估时（中文约5字/秒）+ 动作节拍。',
      '【硬约束】单镜时长不得超过 {maxClip} 秒（视频模型上限）；超过则拆成多镜，并保证镜间画面可衔接。',
      '',
      '【输出格式】先输出一个完整的 JSON 对象（务必完整闭合 ```json 代码块），再输出 Markdown 表格。',
      '',
      'JSON 顶层结构必须为：{"shots":[...],"summary":{"shotCount":数字,"totalDurationSec":数字}}。',
      '每个 shots[] 项是一个超详细的分镜对象，字段如下：',
      '- index：镜号（从1开始的整数）',
      '- durationSec：时长（秒，≤{maxClip}）',
      '- title：该镜的简短标题',
      '- shotSize：景别（远景/全景/中景/近景/特写/大特写 之一）',
      '- angle：拍摄角度（平视/俯拍/仰拍/过肩/主观/鸟瞰 之一，必要时加角度数值如「仰拍15°」）',
      '- movement：运镜（固定/推/拉/摇/移/跟/环绕/手持/升降，并说明起止，如「缓慢推进，从中景推至特写」）',
      '- focalLength：镜头焦距/焦段（具体毫米，如 35mm / 85mm；广角强调纵深，长焦压缩空间）',
      '- aperture：光圈（如 f/1.4 浅景深 / f/8 大景深，说明景深效果）',
      '- iso：感光度与噪点气质（如 ISO 800，轻微颗粒感，营造粗粝质感）',
      '- lighting：光照方案（主光源位置/方向/类型/色温，如「侧逆光，暖黄3200K台灯从画面左侧45°打入，勾勒人物轮廓」；指出高光、阴影走向、是否硬光/柔光）',
      '- colorTone：色调与色彩（主色/强调色/整体冷暖/饱和度，如「低饱和青绿调，局部点缀橙红灯牌」）',
      '- mood：氛围与情绪基调（如「压抑、孤寂、略带焦躁」）',
      '- sceneLayout：场景布局（空间结构、前景/中景/背景的陈设与纵深、关键道具与位置、门窗入口、材质质感）',
      '- blocking：场面调度与站位（每个角色相对镜头与彼此的精确位置、朝向、距离、走位轨迹；用「画面左/右/前/后」描述）',
      '- characters：出场角色名数组；角色名必须与剧本/角色设定一致；同时每个角色在 description、blocking、microExpression 中刻画清楚',
      '- microExpression：人物微表情与表演细节（眼神方向、瞳孔焦点、眉毛、嘴角、脸部肌肉、呼吸、吞咽、手指/肩颈/身体重心的小动作、手持物品姿态——细到可观测）',
      '- costume：角色服装/造型要点（颜色、材质、款式、配饰、与角色的呼应）',
      '- description：画面/动作的详细客观描述（现在时、可视、镜头内发生的一切：谁在做什么、如何做、画面构图、视觉重点、前景/中景/背景关系、道具、材质、天气/烟雾/尘埃/反射等细节）',
      '- dialogue：对白原文；必须标注说话人，格式如「林岚：我不会退后。」；多人对话用换行分隔；无对白给空字符串',
      '- narration：旁白/字幕（如有）',
      '- shotPrompt：面向 AI 图像/视频模型的完整生成提示词（必须自包含、可直接复制使用；覆盖主体、角色身份与外观、动作、构图、机位、焦距、景深、光照、色彩、场景、氛围、画质、风格连续性；不能依赖前后文）',
      '- negativePrompt：该镜画面中不应该出现的东西（错误角色、错服装、错场景、畸形手指/面部崩坏、多余人物、文字水印、低清晰度、过曝欠曝、穿帮道具、不合时宜物件、重复肢体、镜头抖动等；要结合该镜具体风险写，不要只写通用模板）',
      '字段无内容用空字符串或空数组，但 lighting/sceneLayout/blocking/microExpression/description/shotPrompt/negativePrompt 这些核心视觉字段必须详尽，不得敷衍。',
      '',
      '随后输出兼容导入器的 Markdown 表格，列：',
      '| 镜号 | 时长(秒) | 景别 | 运镜 | 场景描述 | 站位调度 | 光照 | 镜头参数 | 微表情动作 | 画面/动作 | 对白 | 角色 | 生成提示词 | 反向提示词 |',
      '表格字段要尽量完整，尤其「生成提示词」和「反向提示词」必须可以直接用于图像/视频生成；对白必须保留「角色名：台词」对应关系。',
      '表格后给出：总镜数、总时长（秒）。',
      '',
      '【质量要求（务必遵守）】',
      '- 每一镜的 lighting/sceneLayout/blocking/microExpression 必须是具体、可视、可执行的细节，禁止「氛围很好」「表情丰富」这类空话。',
      '- 微表情要细到具体肌肉与动作（如「右眼角微微抽动，下唇被牙轻咬」），不放过任何小的描述点。',
      '- shotPrompt 要自包含——把它单独丢给图像/视频模型就能生成这一镜，不需要补充上下文。',
      '- negativePrompt 不能只写 generic bad quality；必须写该镜特定的禁止项和常见 AI 错误规避项。',
      '- 每句对白必须能看出是谁说的；如果原文省略主语，需要根据上下文补足说话人，但不要编造不存在的台词。',
      '- 每一镜都要包含人物动作、表情、微表情、站位、景别、镜头参数、光照、氛围和场景空间信息；宁可详细，不要简略。',
      '- 保持镜间角色一致（同一角色服装/外貌描述前后统一）与场景连贯。',
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
  const maxClip = ctx.maxClipSec && ctx.maxClipSec > 0 ? String(ctx.maxClipSec) : String(DEFAULT_MAX_CLIP_SEC)
  const style =
    ctx.styleBible && ctx.styleBible.trim().length > 0
      ? `【全片视觉总设定（须贯彻）】\n${ctx.styleBible.trim()}`
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
