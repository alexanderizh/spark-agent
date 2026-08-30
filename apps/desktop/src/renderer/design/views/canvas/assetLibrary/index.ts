/**
 * 资产数据层统一出口（步骤模式设计文档 §4.3 / §5.4）。
 *
 * P1 交付：FilmAssetPayload 判别联合 + 类型守卫、AssetRepository 接口与快照实现、
 * 引用统计 / 源文件清理 / storageKey 归一等纯函数模块。P2 的 ProjectAssetLibrary
 * UI 与后续步骤模式视图一律经由本目录访问资产数据。
 */

export type {
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
export { collectAssetReferences, countAssetReferences } from './assetReferences'
export {
  cleanupAssetSourceFiles,
  cleanupAssetsSourceFiles,
  logCanvasAssetCleanupWarning,
} from './assetFileCleanup'
export type { CleanupContext, CleanupRequest } from './assetFileCleanup'
export {
  isStructuredFilmAssetPayload,
  parseFilmAssetPayload,
  readFilmAssetPayload,
} from './filmAssetPayload'
export type {
  FilmAssetPayload,
  FilmCharacterPayload,
  FilmEffectPayload,
  FilmPropPayload,
  FilmScenePayload,
} from './filmAssetPayload'
export {
  createSnapshotAssetRepository,
  reclaimAssetReferencesForNodes,
} from './snapshotAssetRepository'
export {
  isAbsoluteStoragePath,
  resolveStorageKeyToAbsolutePath,
  toRelativeStorageKey,
} from './storageKey'
