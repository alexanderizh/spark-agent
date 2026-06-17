/**
 * 影视镜头语言提示词库（文档 §7.10）。
 *
 * 内置静态库：景别 / 角度 / 运镜 / 构图 / 镜头质感 / 剪辑节奏。
 * 用户可把任意组合保存为「镜头预设」（绑定适用场景 + 默认模型参数）。
 * 最终生成任务时，将选中的镜头语言合并到 prompt 和 modelParams。
 *
 * 注意（§7.10 镜头语言注意点）：这些是「短语积木」，应用到分镜时写入
 * shot spec 或 prompt metadata，方便追踪来源。
 */

export type CameraPromptCategory =
  | 'shot_size' // 景别
  | 'angle' // 角度
  | 'movement' // 运镜
  | 'composition' // 构图
  | 'texture' // 镜头质感
  | 'pacing' // 剪辑节奏

export type CameraPromptItem = {
  id: string
  label: string
  /** 英文 prompt 片段，用于拼接进生成任务的 prompt */
  promptFragment: string
  /** 可选的 modelParams 建议（如运动强度、时长倾向） */
  paramHints?: Record<string, unknown>
}

export type CameraPromptGroup = {
  category: CameraPromptCategory
  label: string
  items: CameraPromptItem[]
}

export const CAMERA_PROMPT_LIBRARY: CameraPromptGroup[] = [
  {
    category: 'shot_size',
    label: '景别',
    items: [
      { id: 'shot_size.extreme_long', label: '远景', promptFragment: 'extreme long shot, vast landscape' },
      { id: 'shot_size.long', label: '全景', promptFragment: 'full shot, wide angle, full body visible' },
      { id: 'shot_size.medium', label: '中景', promptFragment: 'medium shot, cowboy shot, waist up' },
      { id: 'shot_size.close', label: '近景', promptFragment: 'close-up shot, chest up' },
      { id: 'shot_size.big_close', label: '特写', promptFragment: 'close-up, face filling frame' },
      { id: 'shot_size.extreme_close', label: '大特写', promptFragment: 'extreme close-up, macro detail' },
    ],
  },
  {
    category: 'angle',
    label: '角度',
    items: [
      { id: 'angle.eye', label: '平视', promptFragment: 'eye-level angle' },
      { id: 'angle.high', label: '俯拍', promptFragment: 'high angle shot, looking down' },
      { id: 'angle.low', label: '仰拍', promptFragment: 'low angle shot, looking up, heroic' },
      { id: 'angle.over_shoulder', label: '过肩', promptFragment: 'over-the-shoulder shot' },
      { id: 'angle.pov', label: '主观视角', promptFragment: 'point of view shot, POV' },
      { id: 'angle.bird', label: '鸟瞰', promptFragment: "bird's eye view, top-down aerial" },
    ],
  },
  {
    category: 'movement',
    label: '运镜',
    items: [
      { id: 'movement.push', label: '推镜', promptFragment: 'push in, dolly in, zoom in slowly', paramHints: { motionStrength: 0.4 } },
      { id: 'movement.pull', label: '拉镜', promptFragment: 'pull back, dolly out', paramHints: { motionStrength: 0.4 } },
      { id: 'movement.pan', label: '摇镜', promptFragment: 'panning shot, horizontal sweep' },
      { id: 'movement.tracking', label: '移镜', promptFragment: 'tracking shot, lateral movement' },
      { id: 'movement.follow', label: '跟拍', promptFragment: 'follow shot, tracking subject' },
      { id: 'movement.orbit', label: '环绕', promptFragment: 'orbit shot, 360 degree around subject', paramHints: { motionStrength: 0.6 } },
      { id: 'movement.crane', label: '升降', promptFragment: 'crane shot, vertical movement' },
      { id: 'movement.handheld', label: '手持', promptFragment: 'handheld camera, documentary feel' },
      { id: 'movement.oner', label: '一镜到底', promptFragment: 'one-take, single continuous shot, no cuts' },
    ],
  },
  {
    category: 'composition',
    label: '构图',
    items: [
      { id: 'composition.rule_of_thirds', label: '三分法', promptFragment: 'rule of thirds composition' },
      { id: 'composition.center', label: '中心构图', promptFragment: 'centered composition, symmetrical balance' },
      { id: 'composition.symmetry', label: '对称构图', promptFragment: 'symmetrical composition' },
      { id: 'composition.foreground', label: '前景遮挡', promptFragment: 'foreground framing, depth layering' },
      { id: 'composition.frame', label: '框中框', promptFragment: 'frame within a frame composition' },
      { id: 'composition.depth', label: '纵深构图', promptFragment: 'deep depth composition, leading lines' },
    ],
  },
  {
    category: 'texture',
    label: '镜头质感',
    items: [
      { id: 'texture.shallow_dof', label: '浅景深', promptFragment: 'shallow depth of field, bokeh background' },
      { id: 'texture.telephoto', label: '长焦压缩', promptFragment: 'telephoto compression, compressed perspective' },
      { id: 'texture.wide', label: '广角透视', promptFragment: 'wide-angle perspective, lens distortion' },
      { id: 'texture.grain', label: '电影颗粒', promptFragment: 'cinematic film grain, 35mm texture' },
      { id: 'texture.soft_focus', label: '柔焦', promptFragment: 'soft focus, dreamy diffusion' },
      { id: 'texture.hdr', label: '高动态范围', promptFragment: 'high dynamic range, rich detail in shadows and highlights' },
    ],
  },
  {
    category: 'pacing',
    label: '剪辑节奏',
    items: [
      { id: 'pacing.fast', label: '快节奏', promptFragment: 'fast-paced, energetic, quick cuts' },
      { id: 'pacing.slow', label: '慢节奏', promptFragment: 'slow pace, lingering, contemplative' },
      { id: 'pacing.tension', label: '紧张停顿', promptFragment: 'tense pause, held beat' },
      { id: 'pacing.build', label: '情绪铺垫', promptFragment: 'emotional buildup, gradual escalation' },
      { id: 'pacing.montage', label: '蒙太奇', promptFragment: 'montage sequence, time compression' },
    ],
  },
]

/** 镜头预设适用场景（文档 §7.10） */
export type CameraPresetScene =
  | 'dialogue'
  | 'action'
  | 'suspense'
  | 'romance'
  | 'chase'
  | 'memory'
  | 'dream'

export const CAMERA_PRESET_SCENE_LABELS: Record<CameraPresetScene, string> = {
  dialogue: '对话',
  action: '打斗',
  suspense: '悬疑',
  romance: '爱情',
  chase: '追逐',
  memory: '回忆',
  dream: '梦境',
}

/** 用户保存的镜头预设（文档 §7.10：预设可绑定适用场景 + 默认模型参数） */
export type CameraPreset = {
  id: string
  name: string
  /** 选中的镜头语言 item id 组合 */
  itemIds: string[]
  scenes?: CameraPresetScene[]
  defaultParams?: {
    durationSec?: number
    aspectRatio?: string
    motionStrength?: number
    style?: string
    negativePrompt?: string
  }
}

/** 把选中的镜头语言 itemIds 合并成 prompt 片段 */
export function buildCameraPromptFragment(itemIds: string[]): string {
  if (itemIds.length === 0) return ''
  const idSet = new Set(itemIds)
  const fragments: string[] = []
  for (const group of CAMERA_PROMPT_LIBRARY) {
    for (const item of group.items) {
      if (idSet.has(item.id)) fragments.push(item.promptFragment)
    }
  }
  return fragments.join(', ')
}

/** 收集选中项的 modelParams 建议 */
export function collectCameraParamHints(itemIds: string[]): Record<string, unknown> {
  if (itemIds.length === 0) return {}
  const idSet = new Set(itemIds)
  const merged: Record<string, unknown> = {}
  for (const group of CAMERA_PROMPT_LIBRARY) {
    for (const item of group.items) {
      if (idSet.has(item.id) && item.paramHints) {
        Object.assign(merged, item.paramHints)
      }
    }
  }
  return merged
}
