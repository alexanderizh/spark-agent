import { z } from 'zod'

export const SUB_APP_PROTOCOL_VERSION = 1

/**
 * 子应用源码的进程间硬安全上限（5 MB）。
 *
 * 历史值 200_000 已按「用户自担风险」模型放开：实际生效的长度限制由设置
 * sub-app.sourceLengthLimit 控制（0 = 不限制），仅在 IPC / 存储边界保留此
 * 硬上限，防止单条记录无限膨胀拖垮 SQLite 与结构化克隆传输。
 */
export const SUB_APP_SOURCE_HARD_LIMIT = 5_000_000

export const SUB_APP_SURFACES = [
  'content',
  'panel',
  'overlay',
  'global-window',
  'desktop-pet',
] as const
export type SubAppSurface = (typeof SUB_APP_SURFACES)[number]

export const SUB_APP_PUBLICATION_STATUSES = ['draft', 'published', 'archived'] as const
export type SubAppPublicationStatus = (typeof SUB_APP_PUBLICATION_STATUSES)[number]

export const SUB_APP_CAPABILITIES = [
  'runtime',
  'theme',
  'ui',
  'data',
  'navigation',
  'files',
  'clipboard',
  'notifications',
  'agent',
  'canvas',
  'media',
  'browser',
] as const
export type SubAppCapability = (typeof SUB_APP_CAPABILITIES)[number]

export interface SubAppManifest {
  name: string
  description: string
  icon: string | null
  entry: string
  surface: SubAppSurface
  permissions: string[]
}

export interface SubAppDraft {
  revision: number
  source: string
  config: Record<string, unknown>
  manifest: SubAppManifest
  updatedAt: string
}

export interface SubAppRelease {
  id: string
  appId: string
  version: number
  source: string
  config: Record<string, unknown>
  manifest: SubAppManifest
  publishedAt: string
}

export interface SubAppSummary {
  id: string
  name: string
  description: string
  icon: string | null
  surface: SubAppSurface
  publicationStatus: SubAppPublicationStatus
  enabled: boolean
  draftRevision: number
  publishedVersion: number | null
  createdAt: string
  updatedAt: string
}

export interface SubAppDetails extends SubAppSummary {
  draft: SubAppDraft
  publishedRelease: SubAppRelease | null
}

export interface SubAppDataRecord {
  appId: string
  namespace: string
  key: string
  value: unknown
  revision: number
  createdAt: string
  updatedAt: string
}

export interface SubAppListRequest {
  query?: string
  includeArchived?: boolean
  menuOnly?: boolean
  limit?: number
  offset?: number
}
export interface SubAppListResponse {
  items: SubAppSummary[]
  total: number
}
export interface SubAppGetRequest {
  appId: string
  releaseVersion?: number
}
export type SubAppGetResponse = SubAppDetails

export interface SubAppCreateRequest {
  name: string
  description?: string
  icon?: string | null
  entry?: string
  surface?: SubAppSurface
  permissions?: string[]
  source?: string
  config?: Record<string, unknown>
}
export type SubAppCreateResponse = SubAppDetails

export interface SubAppDraftPatch {
  name?: string
  description?: string
  icon?: string | null
  entry?: string
  surface?: SubAppSurface
  permissions?: string[]
  source?: string
  config?: Record<string, unknown>
}
export interface SubAppUpdateDraftRequest {
  appId: string
  expectedDraftRevision: number
  patch: SubAppDraftPatch
}
export type SubAppUpdateDraftResponse = SubAppDetails

export interface SubAppPublishRequest {
  appId: string
  expectedDraftRevision: number
}
export type SubAppPublishResponse = SubAppDetails

export interface SubAppSetEnabledRequest {
  appId: string
  enabled: boolean
}
export type SubAppSetEnabledResponse = SubAppSummary

export interface SubAppArchiveRequest {
  appId: string
}
export type SubAppArchiveResponse = SubAppSummary

export interface SubAppRollbackRequest {
  appId: string
  releaseVersion: number
  expectedDraftRevision: number
}
export type SubAppRollbackResponse = SubAppDetails

export interface SubAppDataGetRequest {
  appId: string
  namespace: string
  key: string
}
export type SubAppDataGetResponse = SubAppDataRecord | null

export interface SubAppDataListRequest {
  appId: string
  namespace: string
  prefix?: string
  limit?: number
  offset?: number
}
export interface SubAppDataListResponse {
  items: SubAppDataRecord[]
  total: number
}

export interface SubAppDataUpsertRequest {
  appId: string
  namespace: string
  key: string
  value: unknown
  expectedRevision?: number
}
export type SubAppDataUpsertResponse = SubAppDataRecord

// ---------------------------------------------------------------------------
// files 能力域：应用专属文件空间（userData/sub-app-files/<appId>/ 下的相对路径）。
// 与 data 域（结构化 KV）互补：存导出的 JSON 快照、生成的 markdown、素材等
// 大文本/文件型内容。路径由主进程规范化校验，禁止逃逸应用目录。
// ---------------------------------------------------------------------------

export interface SubAppFileReadRequest {
  appId: string
  /** 应用空间内相对路径（正斜杠分隔） */
  path: string
}
export interface SubAppFileReadResponse {
  content: string
  byteLength: number
  updatedAt: string
}

export interface SubAppFileWriteRequest {
  appId: string
  path: string
  content: string
}
export interface SubAppFileWriteResponse {
  byteLength: number
  updatedAt: string
}

export interface SubAppFileListRequest {
  appId: string
  /** 只返回该前缀下的文件（可选） */
  prefix?: string
}
export interface SubAppFileEntry {
  path: string
  size: number
  updatedAt: string
}
export interface SubAppFileListResponse {
  files: SubAppFileEntry[]
}

export interface SubAppFileDeleteRequest {
  appId: string
  path: string
}
export interface SubAppFileDeleteResponse {
  deleted: true
}

export interface SubAppReleaseSummary {
  id: string
  version: number
  name: string
  description: string
  icon: string | null
  surface: SubAppSurface
  entry: string
  publishedAt: string
  isPublished: boolean
}

export interface SubAppListReleasesRequest {
  appId: string
  limit?: number
  offset?: number
}
export interface SubAppListReleasesResponse {
  items: SubAppReleaseSummary[]
  total: number
}

export interface SubAppDeleteReleaseRequest {
  appId: string
  releaseVersion: number
}
export interface SubAppDeleteReleaseResponse {
  deleted: true
  appId: string
  releaseVersion: number
}

export interface SubAppDeleteRequest {
  appId: string
}
export interface SubAppDeleteResponse {
  deleted: true
  appId: string
}

export interface SubAppDataDeleteRequest {
  appId: string
  namespace: string
  key: string
  expectedRevision: number
}
export interface SubAppDataDeleteResponse {
  deleted: true
  appId: string
  namespace: string
  key: string
}

/**
 * 子应用沙箱文档的内存登记协议。
 *
 * srcdoc 文档会继承 renderer CSP（script-src 'self' capability-asset:）导致
 * 子应用内联脚本被拦；改为 renderer 把合成文档登记到主进程，再以
 * `capability-asset://subapp-runtime/<token>` 导航加载（自定义 scheme 文档
 * 不继承父策略容器）。put 在挂载/重载时调用，release 在卸载时调用。
 */
export interface SubAppRuntimeDocPutRequest {
  token: string
  document: string
}
export interface SubAppRuntimeDocReleaseRequest {
  token: string
}
export interface SubAppRuntimeDocAck {
  ok: true
}

export interface SubAppIpcChannelMap {
  'sub-app:list': [SubAppListRequest, SubAppListResponse]
  'sub-app:get': [SubAppGetRequest, SubAppGetResponse]
  'sub-app:create': [SubAppCreateRequest, SubAppCreateResponse]
  'sub-app:update-draft': [SubAppUpdateDraftRequest, SubAppUpdateDraftResponse]
  'sub-app:publish': [SubAppPublishRequest, SubAppPublishResponse]
  'sub-app:set-enabled': [SubAppSetEnabledRequest, SubAppSetEnabledResponse]
  'sub-app:archive': [SubAppArchiveRequest, SubAppArchiveResponse]
  'sub-app:rollback': [SubAppRollbackRequest, SubAppRollbackResponse]
  'sub-app:releases:list': [SubAppListReleasesRequest, SubAppListReleasesResponse]
  'sub-app:releases:delete': [SubAppDeleteReleaseRequest, SubAppDeleteReleaseResponse]
  'sub-app:delete': [SubAppDeleteRequest, SubAppDeleteResponse]
  'sub-app:data:get': [SubAppDataGetRequest, SubAppDataGetResponse]
  'sub-app:data:list': [SubAppDataListRequest, SubAppDataListResponse]
  'sub-app:data:upsert': [SubAppDataUpsertRequest, SubAppDataUpsertResponse]
  'sub-app:data:delete': [SubAppDataDeleteRequest, SubAppDataDeleteResponse]
  'sub-app:file:read': [SubAppFileReadRequest, SubAppFileReadResponse]
  'sub-app:file:write': [SubAppFileWriteRequest, SubAppFileWriteResponse]
  'sub-app:file:list': [SubAppFileListRequest, SubAppFileListResponse]
  'sub-app:file:delete': [SubAppFileDeleteRequest, SubAppFileDeleteResponse]
  'sub-app:runtime:put-doc': [SubAppRuntimeDocPutRequest, SubAppRuntimeDocAck]
  'sub-app:runtime:release-doc': [SubAppRuntimeDocReleaseRequest, SubAppRuntimeDocAck]
}

export interface SparkAppBridgeRequest {
  protocolVersion: number
  appId: string
  versionId: string
  instanceId: string
  requestId: string
  capability: SubAppCapability
  operation: string
  payload: unknown
}

export interface SparkAppBridgeResponse {
  protocolVersion: number
  requestId: string
  ok: boolean
  retryable: boolean
  error?: {
    code: string
    message: string
  }
  revision?: number
  data?: unknown
}

// ---------------------------------------------------------------------------
// Spark App Bridge postMessage 协议（iframe 应用 ↔ 宿主 renderer）
//
// 消息方向由 type 前缀区分：
//   - `app/...`：iframe 内应用发出（宿主必须校验 event.source 与 instanceId）
//   - `host/...`：宿主发出（目标为指定 iframe 的 contentWindow）
// 沙箱 iframe 为 opaque origin，宿主回发必须使用 targetOrigin '*'，
// 安全边界来自 source 校验 + envelope zod 校验 + 权限声明检查。
// ---------------------------------------------------------------------------

export interface SparkAppRuntimeInfo {
  appId: string
  name: string
  description: string
  surface: SubAppSurface
  entry: string
  versionId: string
  instanceId: string
  mode: 'draft' | 'published'
  permissions: string[]
}

export interface SparkAppThemeState {
  theme: 'light' | 'dark'
  /** 宿主解析后的只读语义 token（如 colorBgContainer），值来自宿主 CSS 变量。 */
  tokens: Record<string, string>
  /** 主色，tokens 内也会有，单独给出便于应用快速取用。 */
  primaryColor: string
  fontSize: number
  reducedMotion: boolean
}

export type SparkAppBridgeInboundMessage =
  | {
      type: 'app/ready'
      instanceId: string
      protocolVersion: number
    }
  | {
      type: 'app/request'
      instanceId: string
      request: SparkAppBridgeRequest
    }

export type SparkAppBridgeOutboundMessage =
  | {
      type: 'host/theme'
      instanceId: string
      theme: SparkAppThemeState
    }
  | {
      type: 'host/response'
      instanceId: string
      response: SparkAppBridgeResponse
    }

export const SPARK_APP_BRIDGE_INBOUND_SCHEMA = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('app/ready'),
      instanceId: z.string().min(1).max(80),
      // 放宽上限：未来版本必须能通过 schema 拿到 PROTOCOL_VERSION_MISMATCH
      // 响应，而不是被静默丢弃。
      protocolVersion: z.number().int().positive().max(999),
    })
    .strict(),
  z
    .object({
      type: z.literal('app/request'),
      instanceId: z.string().min(1).max(80),
      request: z
        .object({
          protocolVersion: z.number().int().positive().max(999),
          appId: z.string().uuid(),
          versionId: z.string().min(1).max(80),
          instanceId: z.string().min(1).max(80),
          requestId: z.string().min(1).max(80),
          capability: z.enum(SUB_APP_CAPABILITIES),
          operation: z.string().min(1).max(60),
          payload: z.unknown(),
        })
        .strict(),
    })
    .strict(),
])

const appId = z.string().uuid()
const text = (max: number) => z.string().trim().min(1).max(max)
const surface = z.enum(SUB_APP_SURFACES)
/**
 * 应用文件空间内相对路径：正斜杠分隔、非空、无 `..` 段、无盘符/协议前缀，
 * 总长 ≤ 240。主进程仍会做 join+resolve 二次校验（防逃逸）。
 */
const filePath = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^(?!\/)(?!\\)[^\\:]+$/, '相对路径，正斜杠分隔')
  .refine((value) => value.split('/').every((segment) => segment.length > 0 && segment !== '..'), {
    message: '路径不得包含空段或 .. 段',
  })
const permissions = z.array(text(80)).max(64)

const jsonValue = z.unknown().superRefine((value, context) => {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON value must be serializable' })
    } else if (serialized.length > 512_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON value exceeds 512 KB' })
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON value must be serializable' })
  }
})

const config = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Config must be serializable' })
    } else if (serialized.length > 512_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Config exceeds 512 KB' })
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Config must be serializable' })
  }
})

const appDraftPatch = z
  .object({
    name: text(120).optional(),
    description: z.string().max(400).optional(),
    icon: z.string().max(240).nullable().optional(),
    entry: text(240).optional(),
    surface: surface.optional(),
    permissions: permissions.optional(),
    source: z.string().max(SUB_APP_SOURCE_HARD_LIMIT).optional(),
    config: config.optional(),
  })
  .strict()

export const SubAppIpcSchemaRegistry = {
  'sub-app:list': z
    .object({
      query: z.string().max(120).optional(),
      includeArchived: z.boolean().optional(),
      menuOnly: z.boolean().optional(),
      // 管理面板一次拉全（无分页），上限与视图请求对齐；只放宽不收紧，向后兼容。
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    })
    .strict(),
  'sub-app:get': z
    .object({ appId, releaseVersion: z.number().int().positive().optional() })
    .strict(),
  'sub-app:create': z
    .object({
      name: text(120),
      description: z.string().max(400).optional(),
      icon: z.string().max(240).nullable().optional(),
      entry: text(240).optional(),
      surface: surface.optional(),
      permissions: permissions.optional(),
      source: z.string().max(SUB_APP_SOURCE_HARD_LIMIT).optional(),
      config: config.optional(),
    })
    .strict(),
  'sub-app:update-draft': z
    .object({
      appId,
      expectedDraftRevision: z.number().int().positive(),
      patch: appDraftPatch,
    })
    .strict(),
  'sub-app:publish': z
    .object({ appId, expectedDraftRevision: z.number().int().positive() })
    .strict(),
  'sub-app:set-enabled': z.object({ appId, enabled: z.boolean() }).strict(),
  'sub-app:archive': z.object({ appId }).strict(),
  'sub-app:rollback': z
    .object({
      appId,
      releaseVersion: z.number().int().positive(),
      expectedDraftRevision: z.number().int().positive(),
    })
    .strict(),
  'sub-app:releases:list': z
    .object({
      appId,
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    })
    .strict(),
  'sub-app:releases:delete': z
    .object({ appId, releaseVersion: z.number().int().positive() })
    .strict(),
  'sub-app:delete': z.object({ appId }).strict(),
  'sub-app:data:get': z.object({ appId, namespace: text(120), key: text(240) }).strict(),
  'sub-app:data:list': z
    .object({
      appId,
      namespace: text(120),
      prefix: z.string().max(240).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    })
    .strict(),
  'sub-app:data:upsert': z
    .object({
      appId,
      namespace: text(120),
      key: text(240),
      value: jsonValue,
      expectedRevision: z.number().int().positive().optional(),
    })
    .strict(),
  'sub-app:data:delete': z
    .object({
      appId,
      namespace: text(120),
      key: text(240),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  'sub-app:file:read': z.object({ appId, path: filePath }).strict(),
  'sub-app:file:write': z
    .object({
      appId,
      path: filePath,
      // 与 data 域 value 上限对齐的文件型内容上限（2MB 文本）。
      content: z.string().min(0).max(2_000_000),
    })
    .strict(),
  'sub-app:file:list': z.object({ appId, prefix: z.string().max(240).optional() }).strict(),
  'sub-app:file:delete': z.object({ appId, path: filePath }).strict(),
  'sub-app:runtime:put-doc': z
    .object({
      token: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/),
      // 合成文档 = 源码（≤200KB）+ bootstrap/CSP 头部，留足余量。
      document: z.string().min(1).max(260_000),
    })
    .strict(),
  'sub-app:runtime:release-doc': z
    .object({ token: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/) })
    .strict(),
} as const
