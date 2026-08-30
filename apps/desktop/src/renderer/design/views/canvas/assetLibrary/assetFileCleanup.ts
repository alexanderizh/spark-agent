/**
 * 资产源文件清理（步骤模式设计文档 §4.4 缺陷 2 / 缺陷 4）。
 *
 * 删除语义（与 canvas.api 保持一致）：
 *  - 画布内删节点只做软删（hidden=true），不清理任何源文件；
 *  - 资产管理入口删除资产（hardDelete）才继续清理源文件。
 *
 * 清理请求从 `CanvasAsset` 上识别 (providerProfileId, fileId) / 本地路径，去重后
 * 通过 `canvas:asset:cleanup-files` 让主进程执行删除。批量入口
 * `cleanupAssetsSourceFiles` 一次遍历收集全部请求后**单次 IPC** 发出，消灭批删
 * 场景的 N+1 串行调用。
 *
 * storageKey 兼容：历史资产存绝对路径；P1 起新写入存相对 key（相对项目根目录）。
 * 本模块统一经 `resolveStorageKeyToAbsolutePath` 归一，确保发给主进程的是绝对路径。
 */

import type { CanvasAsset } from '../canvas.types'
import { resolveStorageKeyToAbsolutePath } from './storageKey'

export type CleanupRequest = {
  providerFiles: Array<{ providerProfileId: string; fileId: string }>
  localPaths: string[]
}

export type CleanupContext = {
  /** 资产所属项目的根目录；用于把相对 storageKey 解析回绝对路径 */
  projectRootPath?: string | null
}

export function logCanvasAssetCleanupWarning(source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[canvas-asset-cleanup] ${source} failed:`, message)
}

function invokeCleanup(request: CleanupRequest): Promise<unknown> {
  // 去重，避免多次清理同一文件
  const providerMap = new Map<string, { providerProfileId: string; fileId: string }>()
  for (const item of request.providerFiles) {
    if (!item.providerProfileId || !item.fileId) continue
    const key = `${item.providerProfileId}::${item.fileId}`
    if (!providerMap.has(key)) providerMap.set(key, item)
  }
  const localSet = new Set<string>()
  for (const path of request.localPaths) {
    if (typeof path === 'string' && path.length > 0) localSet.add(path)
  }
  const providerFiles = [...providerMap.values()]
  const localPaths = [...localSet]
  if (providerFiles.length === 0 && localPaths.length === 0) return Promise.resolve(null)
  return window.spark.invoke('canvas:asset:cleanup-files', { providerFiles, localPaths })
}

function collectCleanupRequestFromAsset(
  asset: CanvasAsset,
  context?: CleanupContext,
): CleanupRequest {
  const providerFiles: CleanupRequest['providerFiles'] = []
  const localPaths: string[] = []
  const meta = (asset.metadata ?? {}) as Record<string, unknown>
  const metaProviderProfileId =
    typeof meta.providerProfileId === 'string' ? meta.providerProfileId : undefined
  const metaFileId = typeof meta.fileId === 'string' ? meta.fileId : undefined
  if (metaProviderProfileId && metaFileId) {
    providerFiles.push({ providerProfileId: metaProviderProfileId, fileId: metaFileId })
  }

  // 本地路径：storageKey 历史为项目目录内绝对路径，新写入为相对 key，读取端统一归一
  const storagePath = resolveStorageKeyToAbsolutePath(asset.storageKey, context?.projectRootPath)
  if (storagePath) localPaths.push(storagePath)
  // 兼容 metadata.filePath 老格式（历史上始终是绝对路径）
  if (typeof meta.filePath === 'string' && meta.filePath.length > 0) {
    localPaths.push(meta.filePath)
  }
  // 缩略图（不强制）：仅当能解析为本地路径时才纳入
  const thumbnailPath = resolveStorageKeyToAbsolutePath(
    asset.thumbnailKey,
    context?.projectRootPath,
  )
  if (thumbnailPath && thumbnailPath !== storagePath) {
    localPaths.push(thumbnailPath)
  }
  return { providerFiles, localPaths }
}

/** 单资产清理：收集请求并单次发出（无请求时不发 IPC） */
export async function cleanupAssetSourceFiles(
  asset: CanvasAsset,
  context?: CleanupContext,
): Promise<unknown> {
  const request = collectCleanupRequestFromAsset(asset, context)
  if (request.providerFiles.length === 0 && request.localPaths.length === 0) return null
  return invokeCleanup(request)
}

/**
 * 批量清理：一次遍历收集全部资产的清理请求（跨资产去重），单次 IPC 发出。
 * 返回 true 表示发出了清理请求；false 表示没有可清理内容。
 */
export async function cleanupAssetsSourceFiles(
  assets: readonly CanvasAsset[],
  context?: CleanupContext,
): Promise<boolean> {
  const merged: CleanupRequest = { providerFiles: [], localPaths: [] }
  for (const asset of assets) {
    const request = collectCleanupRequestFromAsset(asset, context)
    merged.providerFiles.push(...request.providerFiles)
    merged.localPaths.push(...request.localPaths)
  }
  if (merged.providerFiles.length === 0 && merged.localPaths.length === 0) return false
  await invokeCleanup(merged)
  return true
}
