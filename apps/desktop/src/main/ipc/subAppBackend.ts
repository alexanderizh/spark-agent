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
  SubAppConnectionBindRequest,
  SubAppConnectionBinding,
  SubAppConnectionListRequest,
  SubAppConnectionListResponse,
  SubAppConnectionUnbindRequest,
  SubAppManagedRequest,
  SubAppManagedResponse,
  SubAppBackendInvokeRequest,
  SubAppBackendInvokeResponse,
  SubAppServiceStatus,
  SubAppServiceStatusRequest,
  SubAppServiceLogsRequest,
  SubAppServiceLogsResponse,
  SubAppJobCreateRequest,
  SubAppJobGetRequest,
  SubAppJobListRequest,
  SubAppJobListResponse,
  SubAppJobCancelRequest,
  SubAppJob,
  SubAppProjectReadFileRequest,
  SubAppProjectReadFileResponse,
  SubAppProjectStatus,
  SubAppProjectStatusRequest,
  SubAppProjectWriteFileRequest,
  SubAppProjectPublishRequest,
  SubAppPackageValidationResult,
  SubAppPackageDescriptor,
  SubAppRuntimePackagePutRequest,
  SubAppRuntimePackagePutResponse,
  SubAppRuntimePackageReleaseRequest,
  SubAppDiagnosticRequest,
  SubAppDiagnosticResult,
  SubAppRuntimeReportRequest,
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
  SubAppPackageService,
  SubAppPlatformRepository,
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
import { SubAppNetworkGateway } from '../services/SubAppNetworkGateway.js'
import { SubAppServiceManager } from '../services/SubAppServiceManager.js'
import { SubAppJobManager } from '../services/SubAppJobManager.js'
import {
  putSubAppRuntimePackage,
  releaseSubAppRuntimePackage,
} from '../services/SubAppPackageRuntime.js'
import { randomUUID } from 'node:crypto'

export interface SubAppBackendOptions {
  /** 当前平台版本（app.getVersion()），分享包导出时写入包内。 */
  platformVersion?: string
  /** 覆盖导入前自动备份的目录；缺省为 fileStoreRoot 同级的 sub-app-backups。 */
  backupsDir?: string
  onServiceEvent?: (event: { appId: string; event: string; payload: unknown }) => void
  onJobChanged?: (event: { appId: string; job: SubAppJob }) => void
}

export class SubAppBackend {
  private readonly repository: SubAppRepository
  private readonly fileStore: SubAppFileStore
  private readonly share: SubAppShareService
  private readonly packages: SubAppPackageService
  private readonly platform: SubAppPlatformRepository
  private readonly network: SubAppNetworkGateway
  private readonly services: SubAppServiceManager
  private readonly jobs: SubAppJobManager
  private readonly runtimeObservations = new Map<
    string,
    NonNullable<SubAppDiagnosticResult['runtimeObservation']>
  >()

  constructor(
    database: SparkDatabase,
    fileStoreRootDir: string,
    options: SubAppBackendOptions = {},
  ) {
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
    this.packages = new SubAppPackageService(database)
    this.platform = new SubAppPlatformRepository(database)
    this.network = new SubAppNetworkGateway(database)
    this.services = new SubAppServiceManager(database, options.onServiceEvent)
    this.jobs = new SubAppJobManager(database, this.services, options.onJobChanged)
  }

  async restoreServices(): Promise<void> {
    await this.services.restoreEnabledServices()
    this.jobs.restore()
  }

  async releaseChanged(appId: string): Promise<void> {
    await this.services.stop(appId)
    await this.services.startIfApplication(appId)
  }

  preflightProject(appId: string): Promise<void> {
    return this.services.preflightDraft(appId)
  }

  dispose(): Promise<void> {
    return this.services.dispose()
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
      if (!request.enabled) void this.services.stop(request.appId)
      else void this.services.startIfApplication(request.appId).catch(() => {})
      return summary
    } catch (error) {
      throw this.mapError(error)
    }
  }

  archive(request: SubAppArchiveRequest): SubAppArchiveResponse {
    try {
      const summary = this.repository.archive(request.appId)
      if (summary == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
      void this.services.stop(request.appId)
      return summary
    } catch (error) {
      throw this.mapError(error)
    }
  }

  async rollback(request: SubAppRollbackRequest): Promise<SubAppRollbackResponse> {
    try {
      if (this.platform.getPackageByVersion(request.appId, request.releaseVersion) != null) {
        await this.packages.rollback(
          request.appId,
          request.releaseVersion,
          request.expectedDraftRevision,
        )
        const details = this.repository.get(request.appId)
        if (details == null) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
        return details
      }
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
      void this.packages.cleanupOrphanedArtifacts()
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
    await this.services.stop(request.appId)
    try {
      const deleted = this.repository.delete(request.appId)
      if (!deleted) throw new SparkError('NOT_FOUND', '子应用不存在或已被删除。')
    } catch (error) {
      throw this.mapError(error)
    }
    await this.fileStore.removeApp(request.appId).catch(() => {})
    await this.packages.cleanupDeletedApp(request.appId).catch(() => {})
    this.runtimeObservations.delete(request.appId)
    return { deleted: true, appId: request.appId }
  }

  projectStatus(request: SubAppProjectStatusRequest): Promise<SubAppProjectStatus> {
    return this.packages.status(request.appId)
  }

  projectReadFile(request: SubAppProjectReadFileRequest): Promise<SubAppProjectReadFileResponse> {
    return this.packages.readFile(request.appId, request.path, request.encoding)
  }

  projectWriteFile(request: SubAppProjectWriteFileRequest): Promise<SubAppProjectStatus> {
    return this.packages.writeFile({
      appId: request.appId,
      expectedDraftRevision: request.expectedDraftRevision,
      filePath: request.path,
      content: request.content,
      ...(request.encoding != null ? { encoding: request.encoding } : {}),
    })
  }

  async projectPublish(request: SubAppProjectPublishRequest): Promise<{
    releaseId: string
    version: number
    descriptor: SubAppPackageDescriptor
  }> {
    await this.services.preflightDraft(request.appId)
    const result = await this.packages.publish(request.appId, request.expectedDraftRevision)
    await this.releaseChanged(request.appId).catch(() => {})
    return result
  }

  async projectValidate(appId: string): Promise<SubAppPackageValidationResult> {
    return (await this.packages.status(appId)).validation
  }

  runtimePutPackage(
    request: SubAppRuntimePackagePutRequest,
  ): Promise<SubAppRuntimePackagePutResponse> {
    return putSubAppRuntimePackage(this.packages, request)
  }

  runtimeReleasePackage(request: SubAppRuntimePackageReleaseRequest): { ok: true } {
    releaseSubAppRuntimePackage(request.token)
    return { ok: true }
  }

  connectionList(request: SubAppConnectionListRequest): SubAppConnectionListResponse {
    return { items: this.platform.listBindings(request.appId) }
  }

  connectionBind(request: SubAppConnectionBindRequest): SubAppConnectionBinding {
    const published = this.platform.getPublishedPackage(request.appId)
    const declaration = published?.manifest.connections?.[request.slot]
    if (declaration == null) throw new SparkError('VALIDATION_FAILED', '应用未声明该连接槽。')
    const expectedBindingKind =
      declaration.kind === 'provider' ? 'provider-profile' : 'api-connection'
    if (request.bindingKind !== expectedBindingKind) {
      throw new SparkError(
        'VALIDATION_FAILED',
        `连接槽 ${request.slot} 必须绑定 ${expectedBindingKind}。`,
      )
    }
    const declared = new Set(declaration.allowedOrigins.map((value) => new URL(value).origin))
    const granted = (request.grantedOrigins ?? declaration.allowedOrigins).map(
      (value) => new URL(value).origin,
    )
    if (granted.some((value) => !declared.has(value))) {
      throw new SparkError('PERMISSION_DENIED', '授权 origin 超出 manifest 声明范围。')
    }
    return this.platform.upsertBinding({
      appId: request.appId,
      slot: request.slot,
      bindingKind: request.bindingKind,
      bindingId: request.bindingId,
      grantedOrigins: [...new Set(granted)],
      allowPrivateNetwork:
        declaration.allowPrivateNetwork === true && request.allowPrivateNetwork === true,
    })
  }

  connectionUnbind(request: SubAppConnectionUnbindRequest): { deleted: boolean } {
    return { deleted: this.platform.deleteBinding(request.appId, request.slot) }
  }

  networkRequest(request: SubAppManagedRequest): Promise<SubAppManagedResponse> {
    return this.network.request(request)
  }

  async backendInvoke(request: SubAppBackendInvokeRequest): Promise<SubAppBackendInvokeResponse> {
    const result = await this.services.invoke(
      request.appId,
      request.action,
      request.input,
      request.timeoutMs,
    )
    return { output: result.output, durationMs: result.durationMs }
  }

  serviceStatus(request: SubAppServiceStatusRequest): SubAppServiceStatus {
    return this.services.status(request.appId)
  }

  serviceLogs(request: SubAppServiceLogsRequest): SubAppServiceLogsResponse {
    return this.services.getLogs(request.appId, request.limit)
  }

  serviceRestart(request: SubAppServiceStatusRequest): Promise<SubAppServiceStatus> {
    return this.services.restart(request.appId)
  }

  jobCreate(request: SubAppJobCreateRequest): SubAppJob {
    return this.jobs.create(request.appId, request.type, request.input)
  }

  jobGet(request: SubAppJobGetRequest): SubAppJob {
    return this.jobs.get(request.appId, request.jobId)
  }

  jobList(request: SubAppJobListRequest): SubAppJobListResponse {
    return this.jobs.list(request)
  }

  jobCancel(request: SubAppJobCancelRequest): SubAppJob {
    return this.jobs.cancel(request.appId, request.jobId)
  }

  async diagnose(request: SubAppDiagnosticRequest): Promise<SubAppDiagnosticResult> {
    const mode = request.mode ?? 'draft'
    const correlationId = randomUUID()
    try {
      const project =
        mode === 'draft' ? (await this.packages.status(request.appId)).validation : null
      const published =
        mode === 'published' ? this.platform.getPublishedPackage(request.appId) : null
      const diagnostics =
        project?.diagnostics ??
        (published == null
          ? [{ level: 'error' as const, code: 'RELEASE_MISSING', message: '尚未发布 V2 应用包。' }]
          : [])
      const service = request.includeService === false ? null : this.services.status(request.appId)
      const runtimeObservation = this.runtimeObservations.get(request.appId) ?? null
      const activeVersionId = mode === 'published' ? (published?.releaseId ?? null) : null
      const currentDetails = this.repository.get(request.appId)
      const observationMatches =
        runtimeObservation?.mode === mode &&
        (activeVersionId == null || runtimeObservation.versionId === activeVersionId) &&
        (mode !== 'draft' ||
          (currentDetails != null &&
            new Date(runtimeObservation.observedAt).getTime() >=
              new Date(currentDetails.draft.updatedAt).getTime()))
      const runtimeErrors = observationMatches
        ? runtimeObservation.errors.map((item) => ({
            level: 'error' as const,
            code: `RUNTIME_${item.kind.toUpperCase()}`,
            message: item.message,
          }))
        : []
      const observationDiagnostics = observationMatches
        ? []
        : [
            {
              level: 'warning' as const,
              code: 'RUNTIME_NOT_OBSERVED',
              message: '当前草稿/发布版尚无真实 iframe 运行观测；请打开应用后重新诊断。',
            },
          ]
      const allDiagnostics = [...diagnostics, ...runtimeErrors, ...observationDiagnostics]
      return {
        appId: request.appId,
        mode,
        ready:
          observationMatches &&
          runtimeObservation.status === 'ready' &&
          allDiagnostics.every((item) => item.level !== 'error') &&
          (service == null || service.status !== 'crashed'),
        package: project,
        service,
        diagnostics: allDiagnostics,
        correlationId,
        runtimeObservation: observationMatches ? runtimeObservation : null,
      }
    } catch (error) {
      return {
        appId: request.appId,
        mode,
        ready: false,
        package: null,
        service: null,
        diagnostics: [
          {
            level: 'error',
            code: 'DIAGNOSE_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        correlationId,
      }
    }
  }

  reportRuntime(request: SubAppRuntimeReportRequest): { ok: true } {
    this.runtimeObservations.set(request.appId, {
      status: request.status,
      mode: request.mode,
      versionId: request.versionId,
      observedAt: new Date().toISOString(),
      errors: request.errors ?? [],
      audit: request.audit ?? [],
    })
    return { ok: true }
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
  async sharePreviewFromFile(
    filePath: string,
    fileName?: string,
  ): Promise<SubAppSharePreviewResult> {
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
