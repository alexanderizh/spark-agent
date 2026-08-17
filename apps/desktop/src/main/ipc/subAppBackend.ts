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
  SubAppDeleteRequest,
  SubAppDeleteResponse,
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
  SubAppUpdateDraftRequest,
  SubAppUpdateDraftResponse,
} from '@spark/protocol'
import { SparkError } from '@spark/shared'
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

export class SubAppBackend {
  private readonly repository: SubAppRepository

  constructor(database: SparkDatabase) {
    this.repository = new SubAppRepository(database)
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

  /**
   * 删除应用是破坏性操作：调用前 UI/Agent 层必须完成影响范围确认。
   * 后端只做幂等失败——应用不存在时返回 NOT_FOUND，不重复删除。
   */
  delete(request: SubAppDeleteRequest): SubAppDeleteResponse {
    try {
      const deleted = this.repository.delete(request.appId)
      if (!deleted) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      return { deleted: true, appId: request.appId }
    } catch (error) {
      throw this.mapError(error)
    }
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
