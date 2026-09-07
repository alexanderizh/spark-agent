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
  'network',
  'provider',
  'backend',
  'jobs',
  /** 可信内部子应用：直接访问宿主类型化 IPC 与 stream。 */
  'ipc',
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
  /** 缺省 v1；V2 为受管多文件项目。 */
  format?: 'v1' | 'v2'
  revision: number
  source: string
  config: Record<string, unknown>
  manifest: SubAppManifest
  updatedAt: string
}

export interface SubAppRelease {
  /** 缺省 v1；V2 发布版关联不可变制品。 */
  format?: 'v1' | 'v2'
  id: string
  appId: string
  version: number
  source: string
  config: Record<string, unknown>
  manifest: SubAppManifest
  publishedAt: string
}

export interface SubAppSummary {
  /** 当前草稿开发模式；缺省 v1 兼容旧数据。 */
  format?: 'v1' | 'v2'
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

// ---------------------------------------------------------------------------
// 分享 / 导入：单文件 .sparkapp 分享包（JSON，UTF-8）。
//
// 设计要点：
//   - 全量语义：manifest + 草稿 + 全部发布版本（保留原版本号与发布时间）+
//     全命名空间 data + 文件空间，导入即可用；不做差量/选择性导入。
//   - 任何密钥不进包：Provider API Key 存系统 Keychain，不在导出范围；
//     源码 / data 值里疑似明文密钥只做启发式提示，包内保留原文以保证可用性。
//   - 完整性：integrity.sha256 是对「不含 integrity 字段的包体 JSON」的哈希，
//     用于拦截截断/误改的文件；不是对抗性签名。
//   - 包内 platformVersion 仅供兼容性提示；formatVersion 不识别时导入拦截。
// ---------------------------------------------------------------------------

export const SUB_APP_SHARE_FORMAT_VERSION = 1

/** 分享包内单条应用数据（跨全部命名空间快照；导入后 revision 从 1 重建）。 */
export interface SubAppShareDataEntry {
  namespace: string
  key: string
  value: unknown
}

/** 分享包内单条文件空间记录（正斜杠相对路径 + UTF-8 文本内容）。 */
export interface SubAppShareFileEntry {
  path: string
  content: string
}

/** 发布版本快照：保留原版本号与发布时间；release id 在导入时重建。 */
export interface SubAppShareRelease {
  version: number
  source: string
  config: Record<string, unknown>
  manifest: SubAppManifest
  publishedAt: string
}

/** 静态能力依赖清单（导出时扫描源码/data，导入时对照本机平台检查）。 */
export interface SubAppShareCapabilityReport {
  /** 源码里引用的宿主 IPC 通道（sparkApp.ipc.invoke/on 的静态可解析字面量）。 */
  ipcChannels: string[]
  /** AI 渠道相关引用（provider:* 通道 / providerProfileId 字面量）——仅提示，导入后使用导入方自己的渠道。 */
  providerRefs: string[]
  /** 疑似明文密钥的位置（不含密钥内容本身）。 */
  secretHints: Array<{ scope: 'source' | 'data'; location: string }>
}

export interface SubAppSharePackage {
  formatVersion: number
  /** 原应用 id：用于导入时识别「本机同一应用」以支持覆盖导入。 */
  appId: string
  exportedAt: string
  /** 导出平台版本（app.getVersion()），仅用于导入时降级警告。 */
  platformVersion: string
  manifest: SubAppManifest
  draft: {
    source: string
    config: Record<string, unknown>
  }
  releases: SubAppShareRelease[]
  /** 导出时的当前生效版本；null 表示从未发布（导入后保持草稿态）。 */
  publishedVersion: number | null
  data: SubAppShareDataEntry[]
  files: SubAppShareFileEntry[]
  capabilities: SubAppShareCapabilityReport
  /** 包体完整性：sha256/byteSize 均针对「不含本字段的包体 JSON 文本」。 */
  integrity: { sha256: string; byteSize: number }
}

/** 分享包包体 = 完整包去掉 integrity（完整性计算的对象）。 */
export type SubAppSharePackageBody = Omit<SubAppSharePackage, 'integrity'>

export interface SubAppShareExportRequest {
  appId: string
  /** 是否包含应用数据（默认 true）。 */
  includeData?: boolean
  /** 是否包含文件空间（默认 true）。 */
  includeFiles?: boolean
}

export interface SubAppShareExportResponse {
  saved: boolean
  savedPath?: string
  canceled?: boolean
  error?: string
  counts: { releases: number; dataEntries: number; files: number }
  capabilities: SubAppShareCapabilityReport
  /** 导出侧发现的疑似密钥警告（源码 + data 值）。 */
  secretWarnings: string[]
}

export interface SubAppShareImportCheck {
  level: 'ok' | 'warning' | 'error'
  code:
    | 'FORMAT_VERSION'
    | 'PLATFORM_VERSION'
    | 'INTEGRITY'
    | 'IPC_CHANNELS'
    | 'SOURCE_RUNTIME_LIMIT'
    | 'SECRET_HINT'
    | 'DATA_LIMIT'
    | 'FILE_LIMIT'
    | 'DRAFT_EMPTY'
  message: string
  detail?: string[]
}

export interface SubAppShareConflictInfo {
  /** same-id：包内 appId 在本机已存在（可覆盖）；same-name：仅同名不同 id。 */
  kind: 'none' | 'same-id' | 'same-name'
  appId?: string
  current?: {
    name: string
    publicationStatus: SubAppPublicationStatus
    publishedVersion: number | null
    releaseCount: number
    dataEntries: number
    files: number
  }
}

export interface SubAppShareImportPreviewRequest {
  // 文件选择对话框在主进程弹出；本通道无参数。
}

export interface SubAppShareImportPreviewResponse {
  started: boolean
  canceled?: boolean
  error?: string
  /** 主进程内存中的包句柄（有 TTL 与数量上限），后续 apply 凭它取包。 */
  importToken?: string
  fileName?: string
  /** 分享包文件总字节数。 */
  byteSize?: number
  packageSummary?: {
    formatVersion: number
    appId: string
    exportedAt: string
    platformVersion: string
    manifest: SubAppManifest
    counts: { releases: number; dataEntries: number; files: number; draftChars: number }
    capabilities: SubAppShareCapabilityReport
  }
  integrityOk?: boolean
  checks: SubAppShareImportCheck[]
  conflict: SubAppShareConflictInfo
}

export interface SubAppShareImportApplyRequest {
  importToken: string
  /** overwrite：整体替换本机同 id 应用；new-app：作为新应用导入。 */
  mode: 'overwrite' | 'new-app'
}

export interface SubAppShareImportApplyResponse {
  appId: string
  name: string
  publicationStatus: SubAppPublicationStatus
  publishedVersion: number | null
  importedReleases: number
  importedDataEntries: number
  importedFiles: number
  /** 覆盖导入前自动生成的本机应用备份（.sparkapp）路径；新建导入为 null。 */
  backupPath: string | null
  warnings: string[]
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
  'sub-app:share:export': [SubAppShareExportRequest, SubAppShareExportResponse]
  'sub-app:share:import-preview': [
    SubAppShareImportPreviewRequest,
    SubAppShareImportPreviewResponse,
  ]
  'sub-app:share:import-apply': [SubAppShareImportApplyRequest, SubAppShareImportApplyResponse]
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
  /** 平台核心子应用标记；为 true 时 manifest permissions 不再裁剪 IPC 能力。 */
  trusted?: boolean
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
  | {
      type: 'app/diagnostic'
      instanceId: string
      diagnostic: { kind: string; message: string; source?: string }
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
  | {
      type: 'host/event'
      instanceId: string
      subscriptionId: string
      channel: string
      payload: unknown
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
  z
    .object({
      type: z.literal('app/diagnostic'),
      instanceId: z.string().min(1).max(80),
      diagnostic: z
        .object({
          kind: z.string().min(1).max(80),
          message: z.string().min(1).max(2_000),
          source: z.string().max(500).optional(),
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
  'sub-app:share:export': z
    .object({
      appId,
      includeData: z.boolean().optional(),
      includeFiles: z.boolean().optional(),
    })
    .strict(),
  'sub-app:share:import-preview': z.object({}).strict(),
  'sub-app:share:import-apply': z
    .object({
      importToken: z.string().regex(/^[A-Za-z0-9-]{8,80}$/),
      mode: z.enum(['overwrite', 'new-app']),
    })
    .strict(),
} as const
