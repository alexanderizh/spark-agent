import type {
  SubAppArchiveRequest,
  SubAppArchiveResponse,
  SubAppCreateRequest,
  SubAppCreateResponse,
  SubAppDataDeleteRequest,
  SubAppDataDeleteResponse,
  SubAppDataGetRequest,
  SubAppDataGetResponse,
  SubAppDataListRequest,
  SubAppDataListResponse,
  SubAppDataUpsertRequest,
  SubAppDataUpsertResponse,
  SubAppFileDeleteRequest,
  SubAppFileDeleteResponse,
  SubAppFileListRequest,
  SubAppFileListResponse,
  SubAppFileReadRequest,
  SubAppFileReadResponse,
  SubAppFileWriteRequest,
  SubAppFileWriteResponse,
  SubAppDeleteRequest,
  SubAppDeleteResponse,
  SubAppDeleteReleaseRequest,
  SubAppDeleteReleaseResponse,
  SubAppGetRequest,
  SubAppGetResponse,
  SubAppListReleasesRequest,
  SubAppListReleasesResponse,
  SubAppListRequest,
  SubAppListResponse,
  SubAppPublishRequest,
  SubAppPublishResponse,
  SubAppRollbackRequest,
  SubAppRollbackResponse,
  SubAppSetEnabledRequest,
  SubAppSetEnabledResponse,
  SubAppRuntimeDocPutRequest,
  SubAppRuntimeDocAck,
  SubAppRuntimeDocReleaseRequest,
  SubAppShareExportRequest,
  SubAppUpdateDraftRequest,
  SubAppUpdateDraftResponse,
} from '@spark/protocol'
import { SparkError } from '@spark/shared'
import path from 'node:path'
import {
  SubAppConflictError,
  SubAppDataConflictError,
  SubAppDataValidationError,
  SubAppNotFoundError,
  SubAppReleaseNotFoundError,
  SubAppRepository,
  SubAppStateError,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { putSubAppRuntimeDoc, releaseSubAppRuntimeDoc } from '../services/SubAppRuntimeDocs.js'
import { SubAppFileStore } from '../services/SubAppFileStore.js'
import { SubAppShareService } from '../services/SubAppShareService.js'
import type {
  SubAppShareApplyResult,
  SubAppShareExportResult,
  SubAppSharePreviewResult,
} from '../services/SubAppShareService.js'

export interface SubAppBackendOptions {
  /** 当前平台版本（app.getVersion()），分享包导出时写入包内。 */
  platformVersion?: string
  /** 覆盖导入前自动备份的目录；缺省为 fileStoreRoot 同级的 sub-app-backups。 */
  backupsDir?: string
}

export class SubAppBackend {
  private readonly repository: SubAppRepository
  private readonly fileStore: SubAppFileStore
  private readonly share: SubAppShareService

  constructor(database: SparkDatabase, fileStoreRootDir: string, options: SubAppBackendOptions = {}) {
    this.repository = new SubAppRepository(database)
    this.fileStore = new SubAppFileStore(fileStoreRootDir)
    this.share = new SubAppShareService({
      repository: this.repository,
      fileStore: this.fileStore,
      fileStoreRoot: fileStoreRootDir,
      backupsDir:
        options.backupsDir ?? path.join(path.dirname(fileStoreRootDir), 'sub-app-backups'),
      platformVersion: options.platformVersion ?? '0.0.0',
    })
  }

  list(request: SubAppListRequest): SubAppListResponse {
    return this.repository.list(request)
  }

  get(request: SubAppGetRequest): SubAppGetResponse {
    const details = this.repository.get(request.appId, request.releaseVersion)
    if (details == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
    if (request.releaseVersion !== undefined && details.publishedRelease == null) {
      throw new SparkError('NOT_FOUND', '指定的子应用发布版本不存在。')
    }
    return details
  }

  create(request: SubAppCreateRequest): SubAppCreateResponse {
    try {
      return this.repository.create(request)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  updateDraft(request: SubAppUpdateDraftRequest): SubAppUpdateDraftResponse {
    try {
      const details = this.repository.updateDraft(
        request.appId,
        request.expectedDraftRevision,
        request.patch,
      )
      if (details == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return details
    } catch (error) {
      throw this.mapError(error)
    }
  }

  publish(request: SubAppPublishRequest): SubAppPublishResponse {
    try {
      const details = this.repository.publish(request.appId, request.expectedDraftRevision)
      if (details == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return details
    } catch (error) {
      throw this.mapError(error)
    }
  }

  setEnabled(request: SubAppSetEnabledRequest): SubAppSetEnabledResponse {
    try {
      const summary = this.repository.setEnabled(request.appId, request.enabled)
      if (summary == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return summary
    } catch (error) {
      throw this.mapError(error)
    }
  }

  archive(request: SubAppArchiveRequest): SubAppArchiveResponse {
    try {
      const summary = this.repository.archive(request.appId)
      if (summary == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return summary
    } catch (error) {
      throw this.mapError(error)
    }
  }

  rollback(request: SubAppRollbackRequest): SubAppRollbackResponse {
    try {
      const details = this.repository.rollbackDraft(
        request.appId,
        request.releaseVersion,
        request.expectedDraftRevision,
      )
      if (details == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return details
    } catch (error) {
      throw this.mapError(error)
    }
  }

  listReleases(request: SubAppListReleasesRequest): SubAppListReleasesResponse {
    try {
      const page = this.repository.listReleases(request.appId, request)
      if (page == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return page
    } catch (error) {
      throw this.mapError(error)
    }
  }

  deleteRelease(request: SubAppDeleteReleaseRequest): SubAppDeleteReleaseResponse {
    try {
      const deleted = this.repository.deleteRelease(request.appId, request.releaseVersion)
      if (!deleted) throw new SparkError('NOT_FOUND', '指定的子应用发布版本不存在。')
      return {
        deleted: true,
        appId: request.appId,
        releaseVersion: request.releaseVersion,
      }
    } catch (error) {
      throw this.mapError(error)
    }
  }

  /**
   * 删除应用是破坏性操作：调用前 UI/Agent 层必须完成影响范围确认。
   * 后端只做幂等失败——应用不存在时返回 NOT_FOUND，不重复删除。
   * DB 删除成功后尽力清理应用文件空间（files 域）；清理失败不影响删除结果。
   */
  async delete(request: SubAppDeleteRequest): Promise<SubAppDeleteResponse> {
    try {
      const deleted = this.repository.delete(request.appId)
      if (!deleted) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
    } catch (error) {
      throw this.mapError(error)
    }
    await this.fileStore.removeApp(request.appId).catch(() => {})
    return { deleted: true, appId: request.appId }
  }

  dataGet(request: SubAppDataGetRequest): SubAppDataGetResponse {
    try {
      return this.repository.getData(request.appId, request.namespace, request.key)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  dataList(request: SubAppDataListRequest): SubAppDataListResponse {
    try {
      return this.repository.listData(request.appId, request.namespace, request)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  dataUpsert(request: SubAppDataUpsertRequest): SubAppDataUpsertResponse {
    try {
      return this.repository.upsertData(
        request.appId,
        request.namespace,
        request.key,
        request.value,
        request.expectedRevision,
      )
    } catch (error) {
      throw this.mapError(error)
    }
  }

  dataDelete(request: SubAppDataDeleteRequest): SubAppDataDeleteResponse {
    try {
      this.repository.deleteData(
        request.appId,
        request.namespace,
        request.key,
        request.expectedRevision,
      )
      return { deleted: true, appId: request.appId, namespace: request.namespace, key: request.key }
    } catch (error) {
      throw this.mapError(error)
    }
  }

  /** files 能力域：应用专属文件空间（文本文件，路径校验见 SubAppFileStore）。 */
  async fileRead(request: SubAppFileReadRequest): Promise<SubAppFileReadResponse> {
    try {
      return await this.fileStore.read(request.appId, request.path)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async fileWrite(request: SubAppFileWriteRequest): Promise<SubAppFileWriteResponse> {
    try {
      return await this.fileStore.write(request.appId, request.path, request.content)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async fileList(request: SubAppFileListRequest): Promise<SubAppFileListResponse> {
    try {
      return await this.fileStore.list(request.appId, request.prefix)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async fileDelete(request: SubAppFileDeleteRequest): Promise<SubAppFileDeleteResponse> {
    try {
      await this.fileStore.delete(request.appId, request.path)
      return { deleted: true }
    } catch (error) {
      throw this.mapError(error)
    }
  }

  putRuntimeDoc(request: SubAppRuntimeDocPutRequest): SubAppRuntimeDocAck {
    try {
      return putSubAppRuntimeDoc(request)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  releaseRuntimeDoc(request: SubAppRuntimeDocReleaseRequest): SubAppRuntimeDocAck {
    try {
      return releaseSubAppRuntimeDoc(request)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  // ─── 分享 / 导入（.sparkapp）───────────────────────────────────────────────
  // 对话框与导入 token 缓存在 registerSubAppIpc（electron 层）；这里只做
  // 打包 / 解析 / 应用。body 全程留在主进程内存，renderer 只接触摘要。

  /** 打包应用的完整分享包并序列化；调用方拿 text 写盘。 */
  async shareExportPackage(request: SubAppShareExportRequest): Promise<{
    name: string
    text: string
    counts: { releases: number; dataEntries: number; files: number }
    capabilities: SubAppShareExportResult['capabilities']
    secretWarnings: string[]
  }> {
    try {
      const result = await this.share.buildPackage(request.appId, {
        ...(request.includeData != null ? { includeData: request.includeData } : {}),
        ...(request.includeFiles != null ? { includeFiles: request.includeFiles } : {}),
      })
      return {
        name: result.body.manifest.name,
        text: result.text,
        counts: result.counts,
        capabilities: result.capabilities,
        secretWarnings: result.secretWarnings,
      }
    } catch (error) {
      throw this.mapError(error)
    }
  }

  /** 解析分享包文件并产出预览（能力检查 + 本机冲突识别）。 */
  async sharePreviewFromFile(filePath: string, fileName?: string): Promise<SubAppSharePreviewResult> {
    try {
      return await this.share.previewFromFile(filePath, fileName)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  /** 应用导入（overwrite=整体替换同 id 应用 / new-app=作为新应用导入）。 */
  async shareApply(
    body: SubAppSharePreviewResult['body'],
    mode: 'overwrite' | 'new-app',
    expectedSha256?: string,
  ): Promise<SubAppShareApplyResult> {
    try {
      return await this.share.applyImport(body, mode, expectedSha256)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  private mapError(error: unknown): SparkError {
    if (error instanceof SparkError) return error
    if (error instanceof SubAppConflictError || error instanceof SubAppDataConflictError) {
      return new SparkError('CONFLICT', error.message)
    }
    if (error instanceof SubAppReleaseNotFoundError) {
      return new SparkError('NOT_FOUND', error.message)
    }
    if (error instanceof SubAppNotFoundError) {
      return new SparkError('NOT_FOUND', error.message)
    }
    if (error instanceof SubAppStateError || error instanceof SubAppDataValidationError) {
      return new SparkError('VALIDATION_FAILED', error.message)
    }
    return new SparkError('UNKNOWN', '子应用操作未完成，请稍后重试。')
  }
}
