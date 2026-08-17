import { z } from 'zod'

export const SUB_APP_PROTOCOL_VERSION = 1
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
  'sub-app:delete': [SubAppDeleteRequest, SubAppDeleteResponse]
  'sub-app:data:get': [SubAppDataGetRequest, SubAppDataGetResponse]
  'sub-app:data:list': [SubAppDataListRequest, SubAppDataListResponse]
  'sub-app:data:upsert': [SubAppDataUpsertRequest, SubAppDataUpsertResponse]
  'sub-app:data:delete': [SubAppDataDeleteRequest, SubAppDataDeleteResponse]
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

const config = z.record(z.unknown()).superRefine((value, context) => {
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
    source: z.string().max(200_000).optional(),
    config: config.optional(),
  })
  .strict()

export const SubAppIpcSchemaRegistry = {
  'sub-app:list': z
    .object({
      query: z.string().max(120).optional(),
      includeArchived: z.boolean().optional(),
      menuOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
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
      source: z.string().max(200_000).optional(),
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
} as const
