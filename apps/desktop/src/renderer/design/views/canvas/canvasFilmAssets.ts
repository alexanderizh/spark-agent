/**
 * 影视项目公用资产管理 - 数据层（文档 §7.10）。
 *
 * 设计：剧本 / 角色 / 场景 / 道具 / 提示词库 都复用 CanvasAsset（含文本和图），
 * 用 metadata.kind 标记种类。这样可直接复用现有资产系统（编辑/AI 优化/插入画布/下载）。
 * 分镜分组（一级分组 → 多片段）存 project.metadata.film.shotGroups。
 *
 * 不新建数据库表（文档明确要求第一阶段），全部承载在 asset.metadata + project.metadata。
 */

import type { CanvasAsset, CanvasAssetType } from './canvas.types'
import type { FilmCharacterSubview } from './canvasCharacterLibrary'
import type { CanvasFilmProjectMetadata, FilmReference, FilmReferenceKind } from './canvasFilmTypes'

/** 公用资产种类 */
export type FilmAssetKind =
  | 'manuscript' // 整部文稿索引（设计 §S1，仅存分章索引，不内联全文）
  | 'chapter' // 单章原文（设计 §S1）
  | 'script' // 剧本
  | 'character' // 角色
  | 'scene' // 场景
  | 'prop' // 道具
  | 'effect' // 特效（v2：新增）
  | 'prompt_library' // 提示词模板库
  | 'shot_group' // 分镜分组（特殊：存 project.metadata，不占 asset）

export const FILM_ASSET_KIND_LABELS: Record<FilmAssetKind, string> = {
  manuscript: '文稿',
  chapter: '章节',
  script: '剧本',
  character: '角色',
  scene: '场景',
  prop: '道具',
  effect: '特效',
  prompt_library: '提示词库',
  shot_group: '分镜分组',
}

export const FILM_ASSET_KIND_ORDER: FilmAssetKind[] = [
  'manuscript',
  'chapter',
  'script',
  'character',
  'scene',
  'prop',
  'effect',
  'shot_group',
  'prompt_library',
]

export const FILM_REFERENCE_KIND_LABELS: Record<FilmReferenceKind, string> = {
  concept: '概念',
  reference: '参考',
  expression: '表情',
  costume: '服饰',
  action: '动作',
  storyboard: '分镜',
  angle: '角度',
  other: '其他',
}

export const FILM_REFERENCE_KIND_ORDER: FilmReferenceKind[] = [
  'concept',
  'reference',
  'expression',
  'costume',
  'action',
  'storyboard',
  'angle',
  'other',
]

/** 从 asset.metadata 读取种类 */
export function readAssetKind(asset: CanvasAsset): FilmAssetKind | null {
  const kind = asset.metadata?.kind
  return typeof kind === 'string' && FILM_ASSET_KIND_ORDER.includes(kind as FilmAssetKind)
    ? (kind as FilmAssetKind)
    : null
}

/** 判断是否为影视公用资产 */
export function isFilmAsset(asset: CanvasAsset): boolean {
  return readAssetKind(asset) !== null
}

/** 创建影视资产的输入参数（v2：图片+描述词模型） */
export type CreateFilmAssetInput = {
  kind: FilmAssetKind
  /** 资产名 */
  name: string
  /** 整体描述文本（剧情/概念/总体设定等） */
  text?: string
  /** 多图多描述：每张图配一段描述词 */
  references?: FilmReference[]
  /** 默认生成提示词（用于 AI 生成） */
  prompt?: string
  /** 标签（用于搜索/筛选） */
  tags?: string[]
  /** 类型专属附加属性（角色：外貌/服饰；场景：地点/光线；道具：用途；特效：触发条件/视觉效果） */
  attributes?: Record<string, string>
  /** 角色卡子视图（仅角色类使用） */
  characterSubviews?: FilmCharacterSubview[]
}

/** 分镜片段（一个分组下的单个分镜） */
export type ShotSegment = {
  id: string
  /** 镜号 */
  index: number
  title: string
  /** 描述/动作 */
  description?: string
  /** 对白 */
  dialogue?: string
  /** 旁白 */
  narration?: string
  /** 引用的角色 assetId 列表 */
  characterAssetIds?: string[]
  /** 引用的场景 assetId */
  sceneAssetId?: string
  /** 引用的道具 assetId 列表 */
  propAssetIds?: string[]
  /** 镜头提示词 */
  shotPrompt?: string
  /** 景别（远景/全景/中景/近景/特写等） */
  shotSize?: string
  /** 拍摄角度（平视/俯拍/仰拍/过肩/主观等） */
  angle?: string
  /** 运镜方式与起止变化 */
  movement?: string
  /** 场景空间布局与前中后景关系 */
  sceneLayout?: string
  /** 九宫格、视觉中心与画面分割 */
  composition?: string
  /** 人物站位、朝向和走位 */
  blocking?: string
  /** 光源、方向、色温和明暗关系 */
  lighting?: string
  /** 镜头焦距/焦段 */
  focalLength?: string
  /** 光圈与景深说明 */
  aperture?: string
  /** 感光度与颗粒说明 */
  iso?: string
  /** 色调与色彩方案 */
  colorTone?: string
  /** 镜头氛围与情绪 */
  mood?: string
  /** 微表情与表演细节 */
  microExpression?: string
  /** 服装与造型连续性 */
  costume?: string
  /** 角色图 / 角色资产参考与本镜造型状态 */
  characterReferences?: string
  /** 0.5s 精度的动作节拍 */
  actionBeats?: string
  /** 环境声、拟音、音乐等声音设计 */
  soundEffects?: string
  /** 入镜 / 出镜剪辑与转场标识 */
  transition?: string
  /** 镜头 0.0s 首帧描述 */
  firstFrame?: string
  /** 镜头末尾帧描述 */
  lastFrame?: string
  /** 轴线、道具、光向等镜间连续性约束 */
  continuity?: string
  /** 该镜专属反向提示词 */
  negativePrompt?: string
  /** 关联的画布节点 id（生成的 task/image 节点） */
  nodeIds?: string[]
  // ── 按秒分镜 + 关键帧（设计 §S6/§S7）─────────────────────────────
  /** 镜头入点（秒） */
  inSec?: number
  /** 镜头出点（秒） */
  outSec?: number
  /** 镜头时长（秒）；可由 out-in 推导，也可独立设置 */
  durationSec?: number
  /** 关联的关键帧节点 id（首/尾/中帧） */
  keyframeNodeIds?: string[]
  /** 引用的运镜风格预设 id（§S5） */
  cameraDesignId?: string
  /** 引用的动作风格预设 id（§S5） */
  actionDesignId?: string
  /** 引用的画面风格预设 id（§S5） */
  frameDesignId?: string
}

/** 分镜分组（一级分组，含多个片段） */
export type ShotGroup = {
  id: string
  /** 分组名（如「第一集 - 开场」「场景三 - 对峙」） */
  name: string
  /** 分组描述 */
  description?: string
  /** 排序 */
  sortOrder?: number
  segments: ShotSegment[]
}

/** 影视项目公用资产元数据（扩展 CanvasFilmProjectMetadata） */
export type FilmProjectData = CanvasFilmProjectMetadata & {
  /** 分镜分组 */
  shotGroups?: ShotGroup[]
}

/** 从 project.metadata 读取影视数据（含分镜分组） */
export function readFilmData(
  metadata: Record<string, unknown> | undefined,
): FilmProjectData | null {
  if (!metadata) return null
  const film = metadata['film']
  if (!film || typeof film !== 'object') return null
  return film as FilmProjectData
}

/** 写入影视数据到 project.metadata（不可变） */
export function writeFilmData(
  metadata: Record<string, unknown> | undefined,
  film: FilmProjectData,
): Record<string, unknown> {
  return { ...(metadata ?? {}), film }
}

/** 给资产生成 uid */
export function filmUid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ─── references / tags 读写 helper（v2）─────────────────────────────────────

const REFERENCE_KIND_SET: ReadonlySet<FilmReferenceKind> = new Set<FilmReferenceKind>([
  'concept',
  'reference',
  'expression',
  'costume',
  'action',
  'storyboard',
  'angle',
  'other',
])

function isFilmReferenceKind(value: unknown): value is FilmReferenceKind {
  return typeof value === 'string' && REFERENCE_KIND_SET.has(value as FilmReferenceKind)
}

function isFilmReference(value: unknown): value is FilmReference {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v['id'] === 'string' && typeof v['kind'] === 'string' && typeof v['assetId'] === 'string'
  )
}

/** 归一化 reference（兜底字段，sort 排序） */
function normalizeReferences(refs: FilmReference[]): FilmReference[] {
  return refs
    .map((ref) => ({
      id: ref.id,
      kind: isFilmReferenceKind(ref.kind) ? ref.kind : 'other',
      assetId: ref.assetId,
      description: typeof ref.description === 'string' ? ref.description : '',
      ...(typeof ref.label === 'string' && ref.label.trim() ? { label: ref.label.trim() } : {}),
      order: typeof ref.order === 'number' && Number.isFinite(ref.order) ? ref.order : 0,
      ...(ref.isPrimary ? { isPrimary: true } : {}),
      ...(ref.locked ? { locked: true } : {}),
      ...(typeof ref.strength === 'number' && Number.isFinite(ref.strength)
        ? { strength: Math.max(0, Math.min(1, ref.strength)) }
        : {}),
      ...(ref.usage ? { usage: ref.usage } : {}),
    }))
    .sort((a, b) => a.order - b.order)
}

/** 从 asset.metadata 读取 references（自动迁移旧 imageAssetId） */
export function readReferences(metadata: Record<string, unknown> | undefined): FilmReference[] {
  if (!metadata) return []
  const raw = metadata['references']
  if (Array.isArray(raw)) {
    const valid = raw.filter(isFilmReference)
    return normalizeReferences(valid)
  }
  // 迁移：旧 imageAssetId -> 单条 references[concept]
  const oldImageId = metadata['imageAssetId']
  if (typeof oldImageId === 'string' && oldImageId) {
    return [
      {
        id: filmUid('ref'),
        kind: 'concept',
        assetId: oldImageId,
        description: '',
        order: 0,
      },
    ]
  }
  return []
}

/** 写入 references 到 metadata（不可变） */
export function writeReferences(
  metadata: Record<string, unknown> | undefined,
  references: FilmReference[],
): Record<string, unknown> {
  return { ...(metadata ?? {}), references: normalizeReferences(references) }
}

/** 从 metadata 读标签数组 */
export function readTags(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return []
  const raw = metadata['tags']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}

/** 写标签数组到 metadata（去重/去空白/保留顺序） */
export function writeTags(
  metadata: Record<string, unknown> | undefined,
  tags: string[],
): Record<string, unknown> {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const tag of tags) {
    const t = tag.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    cleaned.push(t)
  }
  return { ...(metadata ?? {}), tags: cleaned }
}

/** 一次性 metadata 迁移：老 imageAssetId/attributes 形式 → references（新）+ tags 数组 */
export function migrateFilmAssetMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {}
  // 已经有 references 数组就不再处理
  if (Array.isArray(metadata['references'])) {
    // 仅补齐 tags 字段（保证有 [] 兜底）
    if (!Array.isArray(metadata['tags'])) {
      return { ...metadata, tags: readTags(metadata) }
    }
    return metadata
  }
  const migrated = { ...metadata }
  // 老 imageAssetId -> references[concept]
  if (typeof migrated['imageAssetId'] === 'string' && migrated['imageAssetId']) {
    migrated['references'] = [
      {
        id: filmUid('ref'),
        kind: 'concept',
        assetId: migrated['imageAssetId'] as string,
        description: '',
        order: 0,
      },
    ]
  } else {
    migrated['references'] = []
  }
  if (!Array.isArray(migrated['tags'])) migrated['tags'] = readTags(migrated)
  return migrated
}

/** 把影视资产种类映射到 CanvasAssetType（内容载体） */
export function filmKindToAssetType(kind: FilmAssetKind): CanvasAssetType {
  // 文稿/章节/剧本 用 text；提示词用 prompt；角色/场景/道具默认 prompt（描述型），可附图
  if (kind === 'manuscript' || kind === 'chapter' || kind === 'script') return 'text'
  if (kind === 'prompt_library') return 'prompt'
  return 'prompt'
}
