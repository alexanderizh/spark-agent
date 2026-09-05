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
  SubAppDeleteReleaseRequest,
  SubAppDeleteReleaseResponse,
  SubAppDetails,
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
  SubAppRuntimeDocAck,
  SubAppRuntimeDocPutRequest,
  SubAppRuntimeDocReleaseRequest,
  SubAppShareExportRequest,
  SubAppShareExportResponse,
  SubAppShareImportApplyRequest,
  SubAppShareImportApplyResponse,
  SubAppShareImportPreviewResponse,
  SubAppSetEnabledRequest,
  SubAppSetEnabledResponse,
  SubAppUpdateDraftRequest,
  SubAppUpdateDraftResponse,
} from '@spark/protocol'

/**
 * 子应用 IPC 的 renderer 封装。
 *
 * 所有操作显式携带 appId，不依赖当前会话上下文；
 * 会话只是调用入口之一（UI、Agent 工具、命令路由共用这里）。
 * 删除是破坏性操作，调用方必须先完成影响范围确认。
 */
export const subAppClient = {
  list: (request: SubAppListRequest = {}): Promise<SubAppListResponse> =>
    window.spark.invoke('sub-app:list', request),

  get: (request: SubAppGetRequest): Promise<SubAppGetResponse> =>
    window.spark.invoke('sub-app:get', request),

  create: (request: SubAppCreateRequest): Promise<SubAppCreateResponse> =>
    window.spark.invoke('sub-app:create', request),

  updateDraft: (request: SubAppUpdateDraftRequest): Promise<SubAppUpdateDraftResponse> =>
    window.spark.invoke('sub-app:update-draft', request),

  publish: (request: SubAppPublishRequest): Promise<SubAppPublishResponse> =>
    window.spark.invoke('sub-app:publish', request),

  setEnabled: (request: SubAppSetEnabledRequest): Promise<SubAppSetEnabledResponse> =>
    window.spark.invoke('sub-app:set-enabled', request),

  archive: (request: SubAppArchiveRequest): Promise<SubAppArchiveResponse> =>
    window.spark.invoke('sub-app:archive', request),

  rollback: (request: SubAppRollbackRequest): Promise<SubAppRollbackResponse> =>
    window.spark.invoke('sub-app:rollback', request),

  listReleases: (request: SubAppListReleasesRequest): Promise<SubAppListReleasesResponse> =>
    window.spark.invoke('sub-app:releases:list', request),

  deleteRelease: (request: SubAppDeleteReleaseRequest): Promise<SubAppDeleteReleaseResponse> =>
    window.spark.invoke('sub-app:releases:delete', request),

  delete: (request: SubAppDeleteRequest): Promise<SubAppDeleteResponse> =>
    window.spark.invoke('sub-app:delete', request),

  dataGet: (request: SubAppDataGetRequest): Promise<SubAppDataGetResponse> =>
    window.spark.invoke('sub-app:data:get', request),

  dataList: (request: SubAppDataListRequest): Promise<SubAppDataListResponse> =>
    window.spark.invoke('sub-app:data:list', request),

  dataUpsert: (request: SubAppDataUpsertRequest): Promise<SubAppDataUpsertResponse> =>
    window.spark.invoke('sub-app:data:upsert', request),

  dataDelete: (request: SubAppDataDeleteRequest): Promise<SubAppDataDeleteResponse> =>
    window.spark.invoke('sub-app:data:delete', request),

  putRuntimeDoc: (request: SubAppRuntimeDocPutRequest): Promise<SubAppRuntimeDocAck> =>
    window.spark.invoke('sub-app:runtime:put-doc', request),

  releaseRuntimeDoc: (request: SubAppRuntimeDocReleaseRequest): Promise<SubAppRuntimeDocAck> =>
    window.spark.invoke('sub-app:runtime:release-doc', request),

  // ─── 分享 / 导入（.sparkapp）──────────────────────────────────────────────
  // 大包在主进程打包/解析：export 返回保存结果摘要，import-preview 返回
  // 预览报告并持有主进程侧 token，import-apply 凭 token 应用导入。

  shareExport: (request: SubAppShareExportRequest): Promise<SubAppShareExportResponse> =>
    window.spark.invoke('sub-app:share:export', request),

  shareImportPreview: (): Promise<SubAppShareImportPreviewResponse> =>
    window.spark.invoke('sub-app:share:import-preview', {}),

  shareImportApply: (request: SubAppShareImportApplyRequest): Promise<SubAppShareImportApplyResponse> =>
    window.spark.invoke('sub-app:share:import-apply', request),
} as const

export type SubAppDetailsLike = SubAppDetails
