/**
 * AssetRepository 访问层契约（步骤模式设计文档 §4.3 / P1 交付物 1）。
 *
 * 背景：资产数据内嵌在 `CanvasSnapshot.assets`（快照 JSON 落 SQLite + 项目目录
 * latest.json），此前全部读写散落在 canvas.api / 各 UI 组件里。本接口把资产
 * CRUD、引用计数、生成血缘与批量删除收敛为唯一访问面：
 *  - 一期实现仍基于内存快照 db（`createSnapshotAssetRepository`，readDb/writeDb
 *    + 防抖 flush），**不建独立资产表**（2026-08-29 决策：抽表 = 表与快照节点
 *    双数据源双写同步，收益不抵风险）；
 *  - 未来若资产量级达到瓶颈需要抽表，只替换 Repository 实现，UI/视图层零改动。
 */

import type {
  CanvasAsset,
  CanvasAssetType,
  CanvasBoard,
  CanvasEdge,
  CanvasNode,
  CanvasProject,
  CanvasTask,
} from '../canvas.types'
import type { FilmAssetKind } from '../canvasFilmAssets'

/** list 查询条件：分页 + 筛选（kind / type / 关键词 / 收藏） */
export type AssetListQuery = {
  /** 页码，1 起；缺省 1 */
  page?: number
  /** 每页条数；缺省 50，最大 200 */
  pageSize?: number
  /** 影视资产细分（metadata.kind）；单值或多值 */
  kind?: FilmAssetKind | FilmAssetKind[]
  /** 资产载体类型；单值或多值 */
  type?: CanvasAssetType | CanvasAssetType[]
  /** 关键词：匹配 title / contentText / metadata.prompt / tags */
  keyword?: string
  /** 只看收藏（metadata.favorite） */
  favorite?: boolean
  /** 归档过滤（metadata.archived）：true 只看已归档；false 排除已归档；缺省不过滤 */
  archived?: boolean
  /** 排序；缺省 'updated' */
  sortBy?: 'updated' | 'created' | 'title' | 'usage'
}

/** list 分页结果 */
export type AssetPage = {
  items: CanvasAsset[]
  /** 筛选后的总条数 */
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** upsert 输入：id 存在则为更新（合并 patch），否则创建 */
export type CanvasAssetUpsertInput = {
  id?: string
  projectId: string
  type: CanvasAssetType
  source: CanvasAsset['source']
  title?: string | null
  mimeType?: string | null
  storageKey?: string | null
  url?: string | null
  thumbnailKey?: string | null
  thumbnailUrl?: string | null
  contentText?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  sizeBytes?: number | null
  /** 深合并到既有 metadata（浅合并各 key，引用计数等治理字段由 Repository 维护） */
  metadata?: Record<string, unknown>
}

/** 生成血缘：AI 生成资产落库时强制记录，供源文件清理与任务追溯使用 */
export type AssetGenerationOrigin = {
  taskId: string
  providerProfileId?: string
  fileId?: string
}

/** batchDelete 结果：删除了哪些资产、哪些 id 不存在、级联软删了哪些引用节点 */
export type BatchDeleteResult = {
  deletedAssetIds: string[]
  missingAssetIds: string[]
  removedNodeIds: string[]
  /** 是否已发出单次源文件清理 IPC */
  cleanupDispatched: boolean
}

export type AssetBatchDeleteOptions = {
  /** true（默认）：删除资产记录并单次 IPC 清理源文件；false：仅移除记录 */
  hardDelete?: boolean
  /** true（默认）：把引用被删资产的未软删节点级联软删并清理连线/任务引用 */
  cascadeNodes?: boolean
}

/**
 * 资产访问层。一期实现见 `createSnapshotAssetRepository`；
 * 所有资产读写应逐步收口到本接口（P1 起新代码不得再直读 db.assets）。
 */
export interface AssetRepository {
  /** 分页列出项目内资产 */
  list(projectId: string, query?: AssetListQuery): Promise<AssetPage>
  get(projectId: string, assetId: string): Promise<CanvasAsset | null>
  /** 创建或更新资产（含 metadata 合并；不负责引用计数增减，见 addReference） */
  upsert(asset: CanvasAssetUpsertInput): Promise<CanvasAsset>
  /**
   * 批量删除：一次遍历移除资产 +（可选）级联软删引用节点，源文件清理请求
   * 去重后**单次 IPC** 发出。
   */
  batchDelete(
    projectId: string,
    assetIds: string[],
    options?: AssetBatchDeleteOptions,
  ): Promise<BatchDeleteResult>
  /** 登记一次引用（如资产被插入画布）：usageCount + lastUsedAt */
  addReference(assetId: string, nodeId: string): void
  /**
   * 回收一次引用（节点被软删时调用）：按 nodeId 找到 assetId 并递减 usageCount
   * （下限 0）。节点不存在、已软删（引用已在 deleteNodes/deleteBoard 时回收）
   * 或未引用资产时为 no-op，重复调用不会重复递减。
   */
  removeReference(nodeId: string): void
  /**
   * 记录生成血缘（providerProfileId / fileId / originTaskId）；
   * 既有值不覆盖（缺陷 2：AI 生成资产缺 Provider 元数据导致文件清理泄漏）。
   */
  recordGenerationOrigin(assetId: string, origin: AssetGenerationOrigin): void
}

/**
 * Repository 所需的最小 db 形状（与 canvas.api 的 CanvasDb 结构兼容，避免反向依赖）。
 * 字段是 CanvasDb 的超集快照视图；未来抽表时以独立 SQLite 连接实现同一形状即可。
 */
export type SnapshotAssetDb = {
  projects: CanvasProject[]
  boards: CanvasBoard[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
}

/** 供实现注入的持久化原语：与 canvas.api 的 readDb / writeDb 同签名 */
export type SnapshotAssetDbAccess = {
  readDb: () => SnapshotAssetDb
  writeDb: (db: SnapshotAssetDb) => void
}
