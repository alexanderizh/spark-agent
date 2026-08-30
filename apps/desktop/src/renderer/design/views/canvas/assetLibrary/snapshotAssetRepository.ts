/**
 * AssetRepository 一期实现：基于内存快照 db（步骤模式设计文档 §4.3）。
 *
 * 持久化原语（readDb / writeDb + 防抖 flush）由调用方注入 —— 本模块不反向依赖
 * canvas.api，避免循环引用；canvas.api 以 `createSnapshotAssetRepository({ readDb, writeDb })`
 * 装配出单例。未来抽独立资产表时替换本实现即可，接口契约不变。
 *
 * 语义要点：
 *  - 引用计数存 `asset.metadata.usageCount`（与 insertAssetToBoard 的既有口径一致），
 *    引用统计的展示口径见 `collectAssetReferences`（过滤 hidden 软删节点）；
 *  - batchDelete 一次遍历完成：级联软删引用节点 → 移除资产记录 → 计数同步 →
 *    源文件清理请求去重后单次 IPC（缺陷 4）；
 *  - recordGenerationOrigin 既有值不覆盖（缺陷 2）。
 */

import { readAssetKind, filmUid } from '../canvasFilmAssets'
import { removeDeletedCanvasNodeReferencesFromTask } from '../canvasNodeDeletion'
import type { CanvasAsset, CanvasAssetType } from '../canvas.types'
import { cleanupAssetsSourceFiles, logCanvasAssetCleanupWarning } from './assetFileCleanup'
import { countAssetReferences } from './assetReferences'
import { isStructuredFilmAssetPayload, parseFilmAssetPayload } from './filmAssetPayload'
import type {
  AssetBatchDeleteOptions,
  AssetGenerationOrigin,
  AssetListQuery,
  AssetPage,
  AssetRepository,
  BatchDeleteResult,
  CanvasAssetUpsertInput,
  SnapshotAssetDb,
  SnapshotAssetDbAccess,
} from './assetRepository'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function now(): string {
  return new Date().toISOString()
}

/** 与 canvas.api.updateProjectCounts 同口径的最小计数同步 */
function syncProjectCounts(db: SnapshotAssetDb, projectId: string): void {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) return
  project.nodeCount = db.nodes.filter((node) => node.projectId === projectId && !node.hidden).length
  project.assetCount = db.assets.filter((asset) => asset.projectId === projectId).length
  project.taskCount = db.tasks.filter((task) => task.projectId === projectId).length
  project.updatedAt = now()
}

function toSet<T>(value: T | T[] | undefined): Set<T> | null {
  if (value == null) return null
  return new Set(Array.isArray(value) ? value : [value])
}

function keywordMatches(asset: CanvasAsset, keyword: string): boolean {
  const meta = asset.metadata ?? {}
  const prompt = typeof meta['prompt'] === 'string' ? (meta['prompt'] as string) : ''
  const tags = Array.isArray(meta['tags'])
    ? (meta['tags'] as unknown[]).filter((tag): tag is string => typeof tag === 'string')
    : []
  // 影视资产的结构化描述（角色外貌/性格、场景/道具描述）纳入搜索，
  // 与资产库 UI 展示的描述字段保持同一命中面。raw 分支 kind 为宽 string，
  // 直接按 kind 比较 无法收窄，必须先经 isStructuredFilmAssetPayload 守卫。
  const payload = parseFilmAssetPayload(asset.metadata)
  let structuredDescription = ''
  if (payload && isStructuredFilmAssetPayload(payload)) {
    if (payload.kind === 'character') {
      structuredDescription = `${payload.character.appearance} ${payload.character.personality ?? ''}`
    } else if (payload.kind === 'scene') {
      structuredDescription = payload.scene.description
    } else if (payload.kind === 'prop') {
      structuredDescription = payload.prop.description
    } else {
      structuredDescription = payload.effect.description
    }
  }
  return [asset.title, asset.contentText, prompt, structuredDescription, ...tags]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(keyword))
}

function applyListFilters(
  assets: readonly CanvasAsset[],
  projectId: string,
  query: AssetListQuery,
): CanvasAsset[] {
  const kinds = toSet(query.kind)
  const types = toSet<CanvasAssetType>(query.type)
  const keyword = query.keyword?.trim().toLowerCase() ?? ''
  return assets.filter((asset) => {
    if (asset.projectId !== projectId) return false
    if (kinds) {
      const kind = readAssetKind(asset)
      if (!kind || !kinds.has(kind)) return false
    }
    if (types && !types.has(asset.type)) return false
    if (query.favorite === true && asset.metadata?.['favorite'] !== true) return false
    if (query.archived === true && asset.metadata?.['archived'] !== true) return false
    if (query.archived === false && asset.metadata?.['archived'] === true) return false
    if (keyword && !keywordMatches(asset, keyword)) return false
    return true
  })
}

function sortAssets(
  assets: CanvasAsset[],
  sortBy: AssetListQuery['sortBy'],
  referenceCounts: Map<string, number>,
): CanvasAsset[] {
  const sorted = [...assets]
  switch (sortBy) {
    case 'created':
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    case 'title':
      return sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    case 'usage':
      return sorted.sort(
        (a, b) => (referenceCounts.get(b.id) ?? 0) - (referenceCounts.get(a.id) ?? 0),
      )
    default:
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}

/** 递减 usageCount（下限 0）；找不到资产返回 false */
function decrementUsageCount(db: SnapshotAssetDb, assetId: string, at: string): boolean {
  const asset = db.assets.find((item) => item.id === assetId)
  if (!asset) return false
  const current =
    typeof asset.metadata?.['usageCount'] === 'number' ? asset.metadata['usageCount'] : 0
  asset.metadata = {
    ...asset.metadata,
    usageCount: Math.max(0, current - 1),
  }
  asset.updatedAt = at
  return true
}

/**
 * 回收一批节点的引用计数（缺陷 1：删节点不回收资产引用计数）。
 *
 * 由 canvas.api.deleteNodes 在标记 hidden **之前**调用（同一 db 写入事务内），
 * 只对「可见 + 有 assetId」的节点生效，避免撤销后重复删除时重复递减。
 */
export function reclaimAssetReferencesForNodes(
  db: SnapshotAssetDb,
  nodeIds: ReadonlySet<string>,
): void {
  if (nodeIds.size === 0) return
  const at = now()
  for (const node of db.nodes) {
    if (!nodeIds.has(node.id)) continue
    if (node.hidden) continue
    if (!node.assetId) continue
    decrementUsageCount(db, node.assetId, at)
  }
}

export function createSnapshotAssetRepository(access: SnapshotAssetDbAccess): AssetRepository {
  return {
    async list(projectId: string, query: AssetListQuery = {}): Promise<AssetPage> {
      const db = access.readDb()
      const referenceCounts = countAssetReferences(db.nodes)
      const filtered = applyListFilters(db.assets, projectId, query)
      const sorted = sortAssets(filtered, query.sortBy, referenceCounts)
      const page = Math.max(1, Math.floor(query.page ?? 1))
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)),
      )
      const start = (page - 1) * pageSize
      const items = sorted.slice(start, start + pageSize)
      return {
        items,
        total: sorted.length,
        page,
        pageSize,
        hasMore: start + items.length < sorted.length,
      }
    },

    async get(projectId: string, assetId: string): Promise<CanvasAsset | null> {
      const db = access.readDb()
      return db.assets.find((item) => item.id === assetId && item.projectId === projectId) ?? null
    },

    async upsert(asset: CanvasAssetUpsertInput): Promise<CanvasAsset> {
      const db = access.readDb()
      const at = now()
      const existing = asset.id
        ? db.assets.find((item) => item.id === asset.id && item.projectId === asset.projectId)
        : undefined
      if (existing) {
        if (asset.title !== undefined) existing.title = asset.title
        if (asset.mimeType !== undefined) existing.mimeType = asset.mimeType
        if (asset.storageKey !== undefined) existing.storageKey = asset.storageKey
        if (asset.url !== undefined) existing.url = asset.url
        if (asset.thumbnailKey !== undefined) existing.thumbnailKey = asset.thumbnailKey
        if (asset.thumbnailUrl !== undefined) existing.thumbnailUrl = asset.thumbnailUrl
        if (asset.contentText !== undefined) existing.contentText = asset.contentText
        if (asset.width !== undefined) existing.width = asset.width
        if (asset.height !== undefined) existing.height = asset.height
        if (asset.durationMs !== undefined) existing.durationMs = asset.durationMs
        if (asset.sizeBytes !== undefined) existing.sizeBytes = asset.sizeBytes
        if (asset.metadata !== undefined) {
          existing.metadata = { ...existing.metadata, ...asset.metadata }
        }
        existing.updatedAt = at
        access.writeDb(db)
        return existing
      }
      const created: CanvasAsset = {
        id: asset.id ?? filmUid('canvas_asset'),
        projectId: asset.projectId,
        userId: 0,
        type: asset.type,
        source: asset.source,
        title: asset.title ?? null,
        mimeType: asset.mimeType ?? null,
        storageKey: asset.storageKey ?? null,
        url: asset.url ?? null,
        thumbnailKey: asset.thumbnailKey ?? null,
        thumbnailUrl: asset.thumbnailUrl ?? null,
        contentText: asset.contentText ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationMs: asset.durationMs ?? null,
        sizeBytes: asset.sizeBytes ?? null,
        metadata: { ...asset.metadata },
        createdAt: at,
        updatedAt: at,
      }
      db.assets.push(created)
      syncProjectCounts(db, asset.projectId)
      access.writeDb(db)
      return created
    },

    async batchDelete(
      projectId: string,
      assetIds: string[],
      options?: AssetBatchDeleteOptions,
    ): Promise<BatchDeleteResult> {
      const hardDelete = options?.hardDelete !== false
      const cascadeNodes = options?.cascadeNodes !== false
      const db = access.readDb()
      const targetIdSet = new Set(assetIds)
      const targets = db.assets.filter(
        (item) => item.projectId === projectId && targetIdSet.has(item.id),
      )
      const deletedAssetIds = targets.map((item) => item.id)
      const deletedAssetIdSet = new Set(deletedAssetIds)
      const missingAssetIds = assetIds.filter((id) => !deletedAssetIdSet.has(id))
      if (deletedAssetIds.length === 0) {
        return {
          deletedAssetIds: [],
          missingAssetIds: assetIds,
          removedNodeIds: [],
          cleanupDispatched: false,
        }
      }

      const at = now()
      let removedNodeIds: string[] = []
      if (cascadeNodes) {
        const nodesById = new Map(db.nodes.map((node) => [node.id, node]))
        const removed = new Set(
          db.nodes
            .filter(
              (node) =>
                node.projectId === projectId &&
                !node.hidden &&
                node.assetId != null &&
                deletedAssetIdSet.has(node.assetId),
            )
            .map((node) => node.id),
        )
        if (removed.size > 0) {
          removedNodeIds = [...removed]
          db.nodes = db.nodes.map((node) =>
            removed.has(node.id) ? { ...node, hidden: true, updatedAt: at } : node,
          )
          db.edges = db.edges.filter(
            (edge) => !removed.has(edge.sourceNodeId) && !removed.has(edge.targetNodeId),
          )
          db.tasks = db.tasks.map((task) => {
            if (task.projectId !== projectId) return task
            const next = removeDeletedCanvasNodeReferencesFromTask({
              task,
              nodesById,
              deletedNodeIds: removed,
            })
            return next === task ? task : { ...next, updatedAt: at }
          })
        }
      }

      db.assets = db.assets.filter(
        (item) => !(item.projectId === projectId && deletedAssetIdSet.has(item.id)),
      )
      syncProjectCounts(db, projectId)
      access.writeDb(db)

      let cleanupDispatched = false
      if (hardDelete) {
        const rootPath = db.projects.find((item) => item.id === projectId)?.rootPath ?? null
        try {
          cleanupDispatched = await cleanupAssetsSourceFiles(targets, { projectRootPath: rootPath })
        } catch (error) {
          logCanvasAssetCleanupWarning('batchDelete', error)
        }
      }
      return { deletedAssetIds, missingAssetIds, removedNodeIds, cleanupDispatched }
    },

    addReference(assetId: string, nodeId: string): void {
      const db = access.readDb()
      const asset = db.assets.find((item) => item.id === assetId)
      if (!asset) return
      // nodeId 属于接口契约（未来按节点登记引用关系时使用），一期只维护聚合计数
      void nodeId
      asset.metadata = {
        ...asset.metadata,
        lastUsedAt: now(),
        usageCount: ((asset.metadata?.['usageCount'] as number | undefined) ?? 0) + 1,
      }
      access.writeDb(db)
    },

    removeReference(nodeId: string): void {
      const db = access.readDb()
      const node = db.nodes.find((item) => item.id === nodeId)
      // 已软删节点的引用在 deleteNodes / deleteBoard 时已回收（reclaim 时机在
      // 标记 hidden 之前）；hidden 节点再次调用不得重复递减（与 reclaim 同口径）。
      if (!node || node.hidden || !node.assetId) return
      const at = now()
      if (decrementUsageCount(db, node.assetId, at)) access.writeDb(db)
    },

    recordGenerationOrigin(assetId: string, origin: AssetGenerationOrigin): void {
      const db = access.readDb()
      const asset = db.assets.find((item) => item.id === assetId)
      if (!asset) return
      // metadata 是可选字段（反序列化输入），统一经缺省对象读写，避免 undefined 索引抛错
      const prevMetadata: Record<string, unknown> = asset.metadata ?? {}
      const next: Record<string, unknown> = { ...prevMetadata }
      // 既有值不覆盖（缺陷 2）：metadata 可能已被调用方写入了更准确的信息
      if (next['originTaskId'] === undefined && origin.taskId) next['originTaskId'] = origin.taskId
      if (next['providerProfileId'] === undefined && origin.providerProfileId) {
        next['providerProfileId'] = origin.providerProfileId
      }
      if (next['fileId'] === undefined && origin.fileId) next['fileId'] = origin.fileId
      if (
        next['originTaskId'] === prevMetadata['originTaskId'] &&
        next['providerProfileId'] === prevMetadata['providerProfileId'] &&
        next['fileId'] === prevMetadata['fileId']
      ) {
        return
      }
      asset.metadata = next
      asset.updatedAt = now()
      access.writeDb(db)
    },
  }
}
