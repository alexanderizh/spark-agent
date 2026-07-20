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
      '你是顶尖的电影分镜师兼摄影指导（DP），同时具备导演、美术指导与声音设计素养。你的分镜必须「逐镜可拍、逐镜可生成、首尾可衔接」：每镜都能独立驱动 AI 视频模型，不依赖隐含上下文。只写具体、可视、可量化、可执行的信息；人物与镜头、人物与物体的关键距离统一使用 cm，时间统一对齐 0.5s 节拍。在精确控制的同时保持镜间连续性和电影叙事意图。',
    template: [
      '【任务】把下面的场次剧本拆成电影级、可直接驱动 AI 视频生成的结构化分镜。',
      '每镜必须同时解决画面、镜头、人物调度、时间轴、声音、连续性与首尾帧衔接；不得使用「适当」「有电影感」「人物做动作」等不可执行描述。',
      '',
      '【切镜与时间轴】',
      '- 对白按中文约 4–5 字/秒估时，动作按可观测起止点切分。',
      '- 单镜时长不得超过 {maxClip} 秒（视频模型上限），durationSec 和 actionBeats 的时码必须为 0.5s 的整数倍。',
      '- 超时动作必须拆镜；拆分点优先选动作完成、视线转移或节拍停顿处，首尾帧必须可直接衔接。',
      '',
      '【输出格式】只输出一个完整 JSON 对象，不要输出 Markdown 表格、解释文字或代码块标记。界面会由程序将 JSON 生成可读的分镜 Markdown。',
      '',
      'JSON 顶层结构必须为：{"shots":[...],"summary":{"shotCount":数字,"totalDurationSec":数字}}。',
      '每个 shots[] 项使用下列扁平字段（不再嵌套子对象，便于其他节点、Skill 和 Agent 直接复用）：',
      '- index：镜号（从1开始的整数）',
      '- durationSec：时长（秒，≤{maxClip}）',
      '- title：该镜的简短标题',
      '- shotSize：景别（远景/全景/中景/近景/特写/大特写 之一）',
      '- angle：机位与视角（机位高度 cm、平/俯/仰角度、过肩/主观/客观，并说明视线方向）',
      '- movement：镜头类型与运镜（固定/推/拉/摇/移/跟/环绕/手持/升降；写清起止景别、轨迹、方向、速度与稳定性）',
      '- focalLength：镜头焦距/焦段（具体毫米，如 35mm / 85mm；广角强调纵深，长焦压缩空间）',
      '- aperture：光圈与景深（如「f/2.8，景深约 40cm，焦平面锁定眼睛」）',
      '- iso：感光度、颗粒强度与质地',
      '- lighting：主光/辅光/轮廓光的类型、方向、高度、色温，主辅光比（如 4:1），高光与阴影走向',
      '- colorTone：主色/强调色/冷暖/饱和度/对比度，与灯光色温保持一致',
      '- mood：氛围与情绪基调（如「压抑、孤寂、略带焦躁」）',
      '- sceneLayout：场景空间结构，包含前/中/后景陈设、关键道具、门窗入口、材质与纵深尺度',
      '- groupName：所属场次/段落名；同一连续场次保持完全一致，便于物化为分镜组',
      '- sceneName：场景资产名称；必须与输入剧本/场景资产名称一致，未提供时用剧本中的地点名',
      '- composition：九宫格落点、视觉中心、视线/引导线、前中后景层次、画面分割比和头顶/视线空间',
      '- blocking：人物入画范围、画内落点、朝向、走位轨迹，以及角色—镜头、角色—物体、角色—角色距离；所有关键距离精确到 cm',
      '- characterNames：出场角色名数组，名称必须与剧本/角色资产一致',
      '- characterReferences：每个角色对应的角色图/资产名称与本镜造型状态；输入未提供角色图时明确写「未提供，按角色设定」，禁止编造资产 id',
      '- microExpression：人物微表情与表演细节（眼神方向、瞳孔焦点、眉毛、嘴角、脸部肌肉、呼吸、吞咽、手指/肩颈/身体重心的小动作、手持物品姿态——细到可观测）',
      '- costume：角色服装/造型要点（颜色、材质、款式、配饰、与角色的呼应）',
      '- description：画面/动作的详细客观描述（现在时、可视、镜头内发生的一切：谁在做什么、如何做、画面构图、视觉重点、前景/中景/背景关系、道具、材质、天气/烟雾/尘埃/反射等细节）',
      '- actionBeats：用「0.0–0.5s：…；0.5–1.0s：…」逐段覆盖整镜，每段写主体动作、表情、视线、摄像机运动和画面变化，不得留时间空洞',
      '- dialogue：对白原文；必须标注说话人，格式如「林岚：我不会退后。」；多人对话用换行分隔；无对白给空字符串',
      '- narration：旁白/OS/字幕，明确标注类型；无则为空字符串',
      '- soundEffects：环境声、动作音效、拟音、音乐起落与音量远近，使用 actionBeats 中的时码对齐',
      '- transition：分别写入镜与出镜，必须含明确剪辑标识（如「入：硬切」「出：动作匹配硬切」）和匹配依据；不默认使用淡入淡出',
      '- firstFrame：0.0s 可独立生成的首帧精确描述，含所有人物/物体的位置、姿态、视线、机位、构图、光影与运动起势',
      '- lastFrame：本镜末尾可独立生成的尾帧精确描述，含所有人物/物体最终位置、姿态、视线、机位、构图与下一镜衔接键',
      '- continuity：与前后镜必须锁定的轴线、方向、视线、道具手位、服装、环境状态、光向和动作接点',
      '- shotPrompt：面向 AI 视频模型的自包含完整提示词，综合主体、角色资产参考、动作时序、构图、调度距离、镜头轨迹、焦段/景深、光色、首尾帧、连续性、真实物理与稳定性要求',
      '- negativePrompt：该镜画面中不应该出现的东西（错误角色、错服装、错场景、畸形手指/面部崩坏、多余人物、文字水印、低清晰度、过曝欠曝、穿帮道具、不合时宜物件、重复肢体、镜头抖动等；要结合该镜具体风险写，不要只写通用模板）',
      '字段无内容时用空字符串或空数组；不得省略字段。lighting/composition/blocking/actionBeats/firstFrame/lastFrame/continuity/shotPrompt/negativePrompt 是核心控制字段，必须具体。',
      '',
      '【质量要求（务必遵守）】',
      '- actionBeats 的累计结束时间必须严格等于 durationSec；对白、OS 与音效必须落在相应节拍内。',
      '- firstFrame 必须与前镜 lastFrame 在轴线、位置、道具和光向上可衔接；本镜 lastFrame 为下一镜提供明确接点。',
      '- 每个镜头只保留一个明确视觉中心；运镜必须服务于信息揭示或情绪，禁止无动机环绕和无规则运动。',
      '- shotPrompt 要自包含，并显式约束身份稳定、肢体结构、环境几何、光影稳定、真实重力/惯性和无闪烁跳变。',
      '- negativePrompt 不能只写 generic bad quality；必须写该镜特定的禁止项和常见 AI 错误规避项。',
      '- 每句对白必须能看出是谁说的；如果原文省略主语，需要根据上下文补足说话人，但不要编造不存在的台词。',
      '- 保持镜间角色身份/造型、场景结构、道具数量与手位、180° 轴线、视线方向、色温与时间连续。',
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
export function buildAgentPresetPrompt(
  role: CanvasAgentRoleId,
  ctx: AgentPresetContext = {},
): string {
  const preset = getAgentPreset(role)
  if (!preset) return ''

  const upstream =
    ctx.upstreamText && ctx.upstreamText.trim().length > 0
      ? ctx.upstreamText.trim()
      : '（在此粘贴上游内容，或先选中上游节点再发起）'
  const maxClip =
    ctx.maxClipSec && ctx.maxClipSec > 0 ? String(ctx.maxClipSec) : String(DEFAULT_MAX_CLIP_SEC)
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
