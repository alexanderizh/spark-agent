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
} as const

export type SubAppDetailsLike = SubAppDetails
