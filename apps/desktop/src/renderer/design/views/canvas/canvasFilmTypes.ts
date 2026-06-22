/**
 * 影视剧集开发数据结构（文档 §7.10）。
 *
 * 分镜规格 ShotSpec + 影视项目元数据 CanvasFilmProjectMetadata。
 * 第一阶段不新增数据库表，承载在 snapshot 和 asset metadata 中（文档明确要求）。
 */

import type { CameraPresetScene } from './canvasFilmPrompts'

/** 项目资源库的引用图类型（图片+描述词，文档 §7.10 升级） */
export type FilmReferenceKind =
  | 'concept' // 概念图/定妆
  | 'reference' // 通用参考
  | 'expression' // 表情
  | 'costume' // 服饰
  | 'action' // 动作
  | 'storyboard' // 分镜/镜头
  | 'angle' // 角度/视角
  | 'other' // 其他

/** 一张引用图 = 一段描述词（文档 §7.10：图片+描述词模型） */
export type FilmReference = {
  /** 内部 uid（项目内唯一） */
  id: string
  /** 引用图类型 */
  kind: FilmReferenceKind
  /** 引用 CanvasAsset.id */
  assetId: string
  /** 该图的描述词（核心字段，AI 生成时使用） */
  description: string
  /** 可选短标签（例："正面"、"侧面"） */
  label?: string
  /** 排序权重（小→大） */
  order: number
  /** 是否为该资产的主基准图（角色身份 / 场景布局 / 风格锚点优先使用） */
  isPrimary?: boolean
  /** 锁定后表示下游生成必须优先继承该参考，不应被普通参考覆盖 */
  locked?: boolean
  /** 参考强度（0-1），不同模型可映射为 reference strength / denoise strength */
  strength?: number
  /** 参考用途，避免把色彩参考误当作角色身份参考 */
  usage?: 'identity' | 'style' | 'pose' | 'costume' | 'scene_layout' | 'lighting' | 'other'
}

/** 单个分镜规格（文档 §7.10 分镜结构建议） */
export type ShotSpec = {
  id: string
  /** 所属剧集 */
  episodeId?: string
  /** 所属场次 */
  sceneId?: string
  /** 镜号 */
  shotIndex: number
  /** 镜头摘要 */
  summary: string
  /** 对白 */
  dialogue?: string
  /** 旁白 */
  narration?: string
  /** 镜头语言 */
  camera: {
    /** 景别（远景/全景/中景/近景/特写） */
    shotSize?: string
    /** 角度（平视/俯拍/仰拍/过肩/主观/鸟瞰） */
    angle?: string
    /** 运镜（推/拉/摇/移/跟/环绕/升降/手持/一镜到底） */
    movement?: string
    /** 镜头焦段 */
    lens?: string
    /** 构图 */
    composition?: string
    /** 选中的镜头语言 prompt item ids（来自 canvasFilmPrompts） */
    cameraPromptItemIds?: string[]
  }
  /** 主体（角色/动作/表情/情绪/服饰/道具） */
  subject: {
    /** 涉及角色 id（角色库引用） */
    characters?: string[]
    /** 动作 */
    action?: string
    /** 表情 */
    expression?: string
    /** 情绪 */
    emotion?: string
    /** 服饰 */
    costume?: string
    /** 道具 */
    props?: string[]
    /** 选中的表演 prompt item ids（来自 canvasFilmPerformancePrompts） */
    performancePromptItemIds?: string[]
  }
  /** 环境（地点/时间/天气/光线/氛围） */
  environment: {
    location?: string
    timeOfDay?: string
    weather?: string
    lighting?: string
    mood?: string
  }
  /** 生成参数 */
  generation: {
    prompt?: string
    negativePrompt?: string
    durationSec?: number
    aspectRatio?: string
    stylePresetId?: string
    modelParams?: Record<string, unknown>
  }
  /** 适用场景预设（对话/打斗/悬疑等） */
  sceneType?: CameraPresetScene
  /** 状态：草稿/已确认/生成中/已生成 */
  status?: 'draft' | 'confirmed' | 'generating' | 'generated'
  /** 产物节点 id（视频/图片输出），允许多版本 */
  outputNodeIds?: string[]
}

/** 角色库条目（文档 §7.10 角色库） */
export type FilmCharacter = {
  id: string
  name: string
  aliases?: string[]
  ageStage?: string
  gender?: string
  occupation?: string
  /** 身高与体型（例：178cm 修长 / 微胖 / 健硕） */
  height?: string
  /** 肤色（例：小麦色 / 冷白 / 古铜） */
  skinTone?: string
  appearance?: string
  /** 五官特色：脸型 / 眉眼 / 鼻 / 唇等可观察细节 */
  facialFeatures?: string
  /** 眼睛：颜色与神态（例：琥珀色，眼神锐利） */
  eyeColor?: string
  hairstyle?: string
  costume?: string
  /** 配饰：首饰 / 眼镜 / 帽子 / 腰带等随身穿戴 */
  accessories?: string[]
  signatureProps?: string[]
  /** 标志特征：疤痕 / 纹身 / 胎记 / 痣等辨识点 */
  distinguishingMarks?: string
  /** 气质神态（例：沉静内敛 / 张扬桀骜），区别于性格关键词 */
  temperament?: string
  personalityKeywords?: string[]
  /** 表情基准（prompt） */
  expressionBaseline?: string
  /** 声线/口音 */
  voiceProfile?: string
  /** 参考图 assetIds */
  referenceAssetIds?: string[]
  /** 禁止变化项（一致性约束） */
  lockedAttributes?: string[]
  /** 生命周期变化记录（年龄/服装阶段） */
  lifecycleNotes?: Array<{ stage: string; note: string }>
}

/** 场景库条目（文档 §7.10 场景库） */
export type FilmScene = {
  id: string
  name: string
  /** 内景/外景 */
  settingType?: 'interior' | 'exterior'
  locationType?: string
  era?: string
  timeOfDay?: string
  weather?: string
  lighting?: string
  colorTone?: string
  artStyle?: string
  /** 空间层次 / 纵深：前景 / 中景 / 背景的陈设与遮挡关系 */
  spatialLayout?: string
  /** 视角与景别建议（例：低机位广角建立镜头 / 过肩中景） */
  perspective?: string
  /** 关键陈设 / 标志物：定义该场景辨识度的核心物件 */
  keyElements?: string
  /** 材质与质感：墙面 / 地面 / 家具的材料与新旧磨损 */
  materials?: string
  /** 体量 / 尺度：空间大小、层高、人物与环境的比例感 */
  scale?: string
  /** 风格参考：年代质感 / 画面风格锚点 */
  styleReference?: string
  /** 可复用场景 prompt */
  reusablePrompt?: string
  /** 参考图 assetIds */
  referenceAssetIds?: string[]
  /** 已使用镜头数 */
  usedShotCount?: number
}

/** 剧集信息（文档 §7.10 多集连续生产） */
export type FilmEpisode = {
  id: string
  title: string
  summary?: string
  /** 对应的 boardId（每集独立 board） */
  boardId?: string
  episodeNumber?: number
}

/** 文稿章节索引项（设计 §S1） */
export type ManuscriptChapterRef = {
  id: string
  title: string
  /** 0-based 顺序 */
  order: number
  status?: 'draft' | 'final'
  /** 对应 asset(kind=chapter) */
  chapterAssetId: string
  /** 该章在画布上的 board（一章一 board） */
  boardId?: string
  charCount?: number
  summary?: string
}

/** 文稿索引（设计 §S1，仅存索引，不内联全文） */
export type ManuscriptIndex = {
  /** 对应 asset(kind=manuscript) */
  sourceAssetId?: string
  title?: string
  chapters: ManuscriptChapterRef[]
}

/** 风格预设：运镜 / 画面 / 动作（设计 §S5，项目级可复用） */
export type FilmStylePreset = {
  id: string
  kind: 'production' | 'color' | 'camera' | 'frame' | 'action' | 'character' | 'scene'
  name: string
  /** 选中的提示词积木 item ids（来自 canvasFilmPrompts / canvasFilmPerformancePrompts） */
  promptItemIds: string[]
  /** 固化的 prompt 片段（积木合并结果，便于直接复用） */
  promptFragment?: string
  description?: string
  palette?: FilmColorSwatch[]
  negativePrompt?: string
  modelParams?: Record<string, unknown>
  aspectRatio?: string
  referenceAssetIds?: string[]
}

export type FilmColorSwatch = {
  name: string
  hex: string
  weight?: number
}

export type FilmProductionBible = {
  locked?: boolean
  updatedAt?: string
  source?: 'manual' | 'image_extract' | 'preset' | 'script_analysis' | 'mixed'
  visualStyle?: string
  colorPalette?: FilmColorSwatch[]
  colorMood?: string
  lighting?: string
  cameraLanguage?: string
  aspectRatio?: string
  worldBible?: string
  characterConsistency?: string
  sceneConsistency?: string
  negativePrompt?: string
  defaultModelParams?: Record<string, unknown>
  referenceAssetIds?: string[]
}

/** 影视项目元数据（文档 §7.10 数据结构补充建议）
 * 第一阶段承载在 CanvasProject.metadata 或 snapshot，不新增数据库表。
 */
export type CanvasFilmProjectMetadata = {
  series?: {
    title?: string
    format?: 'film' | 'series' | 'short_drama' | 'animation' | 'commercial'
    visualStyle?: '2d' | '3d' | 'realistic' | 'anime' | 'custom'
    aspectRatio?: string
    narrationStyle?: string
    /** 节奏基线：平均镜时（秒/镜），用于 §S6 按秒切分 */
    pacingSecPerShot?: number
  }
  /** 视觉总设定（设计 §S0 Style Bible）：被所有下游生成继承拼进 prompt */
  styleBible?: string
  /** 结构化项目视觉圣经：开拍前锁定，用于所有图片 / 视频生成一致性继承 */
  productionBible?: FilmProductionBible
  /** 文稿索引（设计 §S1） */
  manuscript?: ManuscriptIndex
  /** 风格预设：运镜 / 画面 / 动作（设计 §S5） */
  stylePresets?: FilmStylePreset[]
  scriptBreakdown?: {
    sourceAssetId: string
    episodes: FilmEpisode[]
    characters: FilmCharacter[]
    scenes: FilmScene[]
    timeline: Array<Record<string, unknown>>
  }
  /** 本项目的分镜规格集合（shotId → ShotSpec） */
  shots?: Record<string, ShotSpec>
  promptLibraries?: {
    cameraPresets?: Array<Record<string, unknown>>
    actionPresets?: Array<Record<string, unknown>>
    expressionPresets?: Array<Record<string, unknown>>
    userPresets?: Array<Record<string, unknown>>
  }
}

/** 影视项目 settings 扩展键名 */
export const FILM_METADATA_KEY = 'film'

/** 从 project.metadata 安全读取影视元数据 */
export function readFilmMetadata(
  metadata: Record<string, unknown> | undefined,
): CanvasFilmProjectMetadata | null {
  if (!metadata) return null
  const film = metadata[FILM_METADATA_KEY]
  if (!film || typeof film !== 'object') return null
  return film as CanvasFilmProjectMetadata
}

/** 读取/写入影视元数据的 helper：返回新 metadata 对象（不可变更新） */
export function writeFilmMetadata(
  metadata: Record<string, unknown> | undefined,
  film: CanvasFilmProjectMetadata,
): Record<string, unknown> {
  return { ...(metadata ?? {}), [FILM_METADATA_KEY]: film }
}
