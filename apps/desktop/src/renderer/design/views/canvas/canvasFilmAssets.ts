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
import type { CanvasFilmProjectMetadata } from './canvasFilmTypes'

/** 公用资产种类 */
export type FilmAssetKind =
  | 'script' // 剧本
  | 'character' // 角色
  | 'scene' // 场景
  | 'prop' // 道具
  | 'prompt_library' // 提示词模板库
  | 'shot_group' // 分镜分组（特殊：存 project.metadata，不占 asset）

export const FILM_ASSET_KIND_LABELS: Record<FilmAssetKind, string> = {
  script: '剧本',
  character: '角色',
  scene: '场景',
  prop: '道具',
  prompt_library: '提示词库',
  shot_group: '分镜分组',
}

export const FILM_ASSET_KIND_ORDER: FilmAssetKind[] = [
  'script',
  'character',
  'scene',
  'prop',
  'shot_group',
  'prompt_library',
]

/** 从 asset.metadata 读取种类 */
export function readAssetKind(asset: CanvasAsset): FilmAssetKind | null {
  const kind = asset.metadata?.kind
  return typeof kind === 'string' ? (kind as FilmAssetKind) : null
}

/** 判断是否为影视公用资产 */
export function isFilmAsset(asset: CanvasAsset): boolean {
  return readAssetKind(asset) !== null
}

/** 创建影视资产的输入参数 */
export type CreateFilmAssetInput = {
  kind: FilmAssetKind
  /** 资产名 */
  name: string
  /** 内容文本（剧本/提示词/角色描述等） */
  text?: string
  /** 参考/定妆/概念图 assetId（角色/场景/道具可附图） */
  imageAssetId?: string
  /** 提示词（用于 AI 生成） */
  prompt?: string
  /** 附加属性（角色：外貌/服饰；场景：地点/光线；道具：用途） */
  attributes?: Record<string, string>
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
  /** 关联的画布节点 id（生成的 task/image 节点） */
  nodeIds?: string[]
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

/** 把影视资产种类映射到 CanvasAssetType（内容载体） */
export function filmKindToAssetType(kind: FilmAssetKind): CanvasAssetType {
  // 剧本/提示词/分镜 用 text；角色/场景/道具 若有图用 image 否则 prompt
  if (kind === 'script') return 'text'
  if (kind === 'prompt_library') return 'prompt'
  return 'prompt' // 角色/场景/道具默认 prompt（描述型），可附图
}
