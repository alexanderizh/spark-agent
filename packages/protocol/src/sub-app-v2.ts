import { z } from 'zod'
import { SUB_APP_CAPABILITIES, SUB_APP_SURFACES, type SubAppSurface } from './sub-app.js'

export const SUB_APP_PACKAGE_SCHEMA_VERSION = 2 as const
export const SUB_APP_PACKAGE_MAX_FILES = 1_000
export const SUB_APP_PACKAGE_MAX_BYTES = 20 * 1024 * 1024
export const SUB_APP_PACKAGE_MAX_FILE_BYTES = 5 * 1024 * 1024

export const SUB_APP_SERVICE_LIFECYCLES = ['on-demand', 'application'] as const
export type SubAppServiceLifecycle = (typeof SUB_APP_SERVICE_LIFECYCLES)[number]

export const SUB_APP_OS_EFFECTS = ['network', 'filesystem', 'process'] as const
export type SubAppOsEffect = (typeof SUB_APP_OS_EFFECTS)[number]

export interface SubAppPackageFrontend {
  entry: string
}

export interface SubAppPackageService {
  runtime: 'node'
  entry: string
  lifecycle: SubAppServiceLifecycle
  idleTimeoutSeconds?: number
  healthAction?: string
}

export interface SubAppConnectionDeclaration {
  kind: 'http-api' | 'provider'
  displayName: string
  allowedOrigins: string[]
  allowPrivateNetwork?: boolean
}

export interface SubAppPackageManifest {
  schemaVersion: typeof SUB_APP_PACKAGE_SCHEMA_VERSION
  name: string
  description?: string
  icon?: string | null
  surface: SubAppSurface
  frontend: SubAppPackageFrontend
  service?: SubAppPackageService
  permissions: {
    sparkCapabilities: string[]
    osEffects: SubAppOsEffect[]
    connections: string[]
  }
  connections?: Record<string, SubAppConnectionDeclaration>
  contracts?: {
    backendActions?: string
    jobs?: string
  }
}

export interface SubAppPackageDescriptor {
  schemaVersion: typeof SUB_APP_PACKAGE_SCHEMA_VERSION
  digest: string
  byteLength: number
  fileCount: number
  frontendEntry: string
  serviceEntry: string | null
  manifest: SubAppPackageManifest
}

export interface SubAppProjectFile {
  path: string
  byteLength: number
  updatedAt: string
}

export interface SubAppProjectStatus {
  appId: string
  revision: number
  files: SubAppProjectFile[]
  manifest: SubAppPackageManifest | null
  validation: SubAppPackageValidationResult
}

export interface SubAppPackageDiagnostic {
  level: 'error' | 'warning' | 'suggestion'
  code: string
  message: string
  file?: string
}

export interface SubAppPackageValidationResult {
  valid: boolean
  readyToPublish: boolean
  diagnostics: SubAppPackageDiagnostic[]
  detectedCapabilities: string[]
  manifest: SubAppPackageManifest | null
  fileCount: number
  byteLength: number
}

export interface SubAppScaffoldRequest {
  name: string
  description?: string
  icon?: string | null
  surface?: SubAppSurface
  template?: 'frontend' | 'fullstack'
}

export interface SubAppScaffoldResponse {
  appId: string
  draftRevision: number
  project: SubAppProjectStatus
}

export interface SubAppProjectWriteFileRequest {
  appId: string
  expectedDraftRevision: number
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface SubAppProjectReadFileRequest {
  appId: string
  path: string
  encoding?: 'utf8' | 'base64'
}

export interface SubAppProjectReadFileResponse {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  byteLength: number
}

export interface SubAppProjectStatusRequest {
  appId: string
}

export interface SubAppProjectValidateRequest {
  appId: string
}

export interface SubAppProjectPublishRequest {
  appId: string
  expectedDraftRevision: number
}

export interface SubAppRuntimePackagePutRequest {
  appId: string
  releaseId?: string
  mode: 'draft' | 'published'
}

export interface SubAppRuntimePackagePutResponse {
  token: string
  entrySource: string
  assetsBaseUrl: string
  descriptor: SubAppPackageDescriptor
}

export interface SubAppRuntimePackageReleaseRequest {
  token: string
}

export interface SubAppConnectionBinding {
  appId: string
  slot: string
  bindingKind: 'api-connection' | 'provider-profile'
  bindingId: string
  grantedOrigins: string[]
  allowPrivateNetwork: boolean
  createdAt: string
  updatedAt: string
}

export interface SubAppConnectionBindRequest {
  appId: string
  slot: string
  bindingKind: SubAppConnectionBinding['bindingKind']
  bindingId: string
  grantedOrigins?: string[]
  allowPrivateNetwork?: boolean
}

export interface SubAppConnectionListRequest {
  appId: string
}

export interface SubAppConnectionListResponse {
  items: SubAppConnectionBinding[]
}

export interface SubAppConnectionUnbindRequest {
  appId: string
  slot: string
}

export interface SubAppManagedRequest {
  appId: string
  slot: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface SubAppManagedResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: unknown
}

export interface SubAppBackendInvokeRequest {
  appId: string
  action: string
  input?: unknown
  timeoutMs?: number
}

export interface SubAppBackendInvokeResponse {
  output: unknown
  durationMs: number
}

export type SubAppServiceRuntimeStatus = 'stopped' | 'starting' | 'running' | 'degraded' | 'crashed'

export interface SubAppServiceStatus {
  appId: string
  releaseId: string | null
  status: SubAppServiceRuntimeStatus
  pid: number | null
  startedAt: string | null
  lastExitAt: string | null
  lastError: string | null
  restartCount: number
}

export interface SubAppServiceStatusRequest {
  appId: string
}

export interface SubAppServiceLogsRequest {
  appId: string
  limit?: number
}

export interface SubAppServiceLogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface SubAppServiceLogsResponse {
  items: SubAppServiceLogEntry[]
}

export interface SubAppServiceRestartRequest {
  appId: string
}

export const SUB_APP_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const
export type SubAppJobStatus = (typeof SUB_APP_JOB_STATUSES)[number]

export interface SubAppJob {
  id: string
  appId: string
  releaseId: string
  type: string
  status: SubAppJobStatus
  input: unknown
  progress: number
  message: string | null
  checkpoint: unknown
  result: unknown
  error: { code: string; message: string } | null
  cancelRequested: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface SubAppJobCreateRequest {
  appId: string
  type: string
  input?: unknown
}

export interface SubAppJobGetRequest {
  appId: string
  jobId: string
}

export interface SubAppJobListRequest {
  appId: string
  status?: SubAppJobStatus
  limit?: number
  offset?: number
}

export interface SubAppJobListResponse {
  items: SubAppJob[]
  total: number
}

export interface SubAppJobCancelRequest {
  appId: string
  jobId: string
}

export interface SubAppDiagnosticRequest {
  appId: string
  mode?: 'draft' | 'published'
  includeService?: boolean
}

export interface SubAppDiagnosticResult {
  appId: string
  mode: 'draft' | 'published'
  ready: boolean
  package: SubAppPackageValidationResult | null
  service: SubAppServiceStatus | null
  diagnostics: SubAppPackageDiagnostic[]
  correlationId: string
  runtimeObservation?: {
    status: 'loading' | 'ready' | 'error'
    mode: 'draft' | 'published'
    versionId: string
    observedAt: string
    errors: Array<{ kind: string; message: string; source?: string }>
    audit: Array<{ capability: string; operation: string; ok: boolean; errorCode?: string }>
  } | null
}

export interface SubAppRuntimeReportRequest {
  appId: string
  instanceId: string
  mode: 'draft' | 'published'
  versionId: string
  status: 'loading' | 'ready' | 'error'
  errors?: Array<{ kind: string; message: string; source?: string }>
  audit?: Array<{ capability: string; operation: string; ok: boolean; errorCode?: string }>
}

const packagePath = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^(?!\/)(?!\\)(?![A-Za-z]:)(?![a-z]+:)[^\\]+$/i)
  .refine(
    (value) =>
      value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    '包路径不得包含空段、. 或 ..',
  )

const origin = z
  .string()
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须是 http(s) origin，不得包含路径、查询或片段',
      })
    }
  })

const connectionDeclaration = z
  .object({
    kind: z.enum(['http-api', 'provider']),
    displayName: z.string().trim().min(1).max(120),
    allowedOrigins: z.array(origin).min(1).max(20),
    allowPrivateNetwork: z.boolean().optional(),
  })
  .strict()

export const SubAppPackageManifestSchema = z
  .object({
    schemaVersion: z.literal(SUB_APP_PACKAGE_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(400).optional(),
    icon: z.string().max(240).nullable().optional(),
    surface: z.enum(SUB_APP_SURFACES),
    frontend: z.object({ entry: packagePath }).strict(),
    service: z
      .object({
        runtime: z.literal('node'),
        entry: packagePath,
        lifecycle: z.enum(SUB_APP_SERVICE_LIFECYCLES),
        idleTimeoutSeconds: z.number().int().min(30).max(86_400).optional(),
        healthAction: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .optional(),
    permissions: z
      .object({
        sparkCapabilities: z.array(z.enum(SUB_APP_CAPABILITIES)).max(64),
        osEffects: z.array(z.enum(SUB_APP_OS_EFFECTS)).max(SUB_APP_OS_EFFECTS.length),
        connections: z.array(z.string().trim().min(1).max(80)).max(32),
      })
      .strict(),
    connections: z.record(z.string().trim().min(1).max(80), connectionDeclaration).optional(),
    contracts: z
      .object({ backendActions: packagePath.optional(), jobs: packagePath.optional() })
      .strict()
      .optional(),
  })
  .strict()

export const SubAppProjectPathSchema = packagePath

export interface SubAppV2IpcChannelMap {
  'sub-app:project:status': [SubAppProjectStatusRequest, SubAppProjectStatus]
  'sub-app:project:read-file': [SubAppProjectReadFileRequest, SubAppProjectReadFileResponse]
  'sub-app:project:write-file': [SubAppProjectWriteFileRequest, SubAppProjectStatus]
  'sub-app:project:validate': [SubAppProjectValidateRequest, SubAppPackageValidationResult]
  'sub-app:project:publish': [
    SubAppProjectPublishRequest,
    { releaseId: string; version: number; descriptor: SubAppPackageDescriptor },
  ]
  'sub-app:runtime:put-package': [SubAppRuntimePackagePutRequest, SubAppRuntimePackagePutResponse]
  'sub-app:runtime:release-package': [SubAppRuntimePackageReleaseRequest, { ok: true }]
  'sub-app:connections:list': [SubAppConnectionListRequest, SubAppConnectionListResponse]
  'sub-app:connections:bind': [SubAppConnectionBindRequest, SubAppConnectionBinding]
  'sub-app:connections:unbind': [SubAppConnectionUnbindRequest, { deleted: boolean }]
  'sub-app:network:request': [SubAppManagedRequest, SubAppManagedResponse]
  'sub-app:backend:invoke': [SubAppBackendInvokeRequest, SubAppBackendInvokeResponse]
  'sub-app:service:status': [SubAppServiceStatusRequest, SubAppServiceStatus]
  'sub-app:service:logs': [SubAppServiceLogsRequest, SubAppServiceLogsResponse]
  'sub-app:service:restart': [SubAppServiceRestartRequest, SubAppServiceStatus]
  'sub-app:jobs:create': [SubAppJobCreateRequest, SubAppJob]
  'sub-app:jobs:get': [SubAppJobGetRequest, SubAppJob]
  'sub-app:jobs:list': [SubAppJobListRequest, SubAppJobListResponse]
  'sub-app:jobs:cancel': [SubAppJobCancelRequest, SubAppJob]
  'sub-app:diagnose': [SubAppDiagnosticRequest, SubAppDiagnosticResult]
  'sub-app:runtime:report': [SubAppRuntimeReportRequest, { ok: true }]
}

const uuid = z.string().uuid()
const token = z.string().regex(/^[A-Za-z0-9-]{8,80}$/)
const slot = z.string().trim().min(1).max(80)
const jobType = z.string().trim().min(1).max(120)
const boundedJson = z.unknown().superRefine((value, context) => {
  try {
    const serialized = JSON.stringify(value ?? null)
    if (Buffer.byteLength(serialized, 'utf8') > 512_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON payload exceeds 512 KB' })
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Value must be JSON serializable' })
  }
})

export const SubAppV2IpcSchemaRegistry = {
  'sub-app:project:status': z.object({ appId: uuid }).strict(),
  'sub-app:project:read-file': z
    .object({ appId: uuid, path: packagePath, encoding: z.enum(['utf8', 'base64']).optional() })
    .strict(),
  'sub-app:project:write-file': z
    .object({
      appId: uuid,
      expectedDraftRevision: z.number().int().positive(),
      path: packagePath,
      content: z.string().max(8_000_000),
      encoding: z.enum(['utf8', 'base64']).optional(),
    })
    .strict(),
  'sub-app:project:validate': z.object({ appId: uuid }).strict(),
  'sub-app:project:publish': z
    .object({ appId: uuid, expectedDraftRevision: z.number().int().positive() })
    .strict(),
  'sub-app:runtime:put-package': z
    .object({ appId: uuid, releaseId: uuid.optional(), mode: z.enum(['draft', 'published']) })
    .strict(),
  'sub-app:runtime:release-package': z.object({ token }).strict(),
  'sub-app:connections:list': z.object({ appId: uuid }).strict(),
  'sub-app:connections:bind': z
    .object({
      appId: uuid,
      slot,
      bindingKind: z.enum(['api-connection', 'provider-profile']),
      bindingId: uuid,
      grantedOrigins: z.array(origin).max(20).optional(),
      allowPrivateNetwork: z.boolean().optional(),
    })
    .strict(),
  'sub-app:connections:unbind': z.object({ appId: uuid, slot }).strict(),
  'sub-app:network:request': z
    .object({
      appId: uuid,
      slot,
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      path: z.string().trim().min(1).max(2048),
      headers: z.record(z.string(), z.string().max(8_192)).optional(),
      body: boundedJson.optional(),
      timeoutMs: z.number().int().min(1_000).max(30_000).optional(),
    })
    .strict(),
  'sub-app:backend:invoke': z
    .object({
      appId: uuid,
      action: jobType,
      input: boundedJson.optional(),
      timeoutMs: z.number().int().min(100).max(30_000).optional(),
    })
    .strict(),
  'sub-app:service:status': z.object({ appId: uuid }).strict(),
  'sub-app:service:logs': z
    .object({ appId: uuid, limit: z.number().int().min(1).max(500).optional() })
    .strict(),
  'sub-app:service:restart': z.object({ appId: uuid }).strict(),
  'sub-app:jobs:create': z
    .object({ appId: uuid, type: jobType, input: boundedJson.optional() })
    .strict(),
  'sub-app:jobs:get': z.object({ appId: uuid, jobId: uuid }).strict(),
  'sub-app:jobs:list': z
    .object({
      appId: uuid,
      status: z.enum(SUB_APP_JOB_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    })
    .strict(),
  'sub-app:jobs:cancel': z.object({ appId: uuid, jobId: uuid }).strict(),
  'sub-app:diagnose': z
    .object({
      appId: uuid,
      mode: z.enum(['draft', 'published']).optional(),
      includeService: z.boolean().optional(),
    })
    .strict(),
  'sub-app:runtime:report': z
    .object({
      appId: uuid,
      instanceId: z.string().min(1).max(80),
      mode: z.enum(['draft', 'published']),
      versionId: z.string().min(1).max(80),
      status: z.enum(['loading', 'ready', 'error']),
      errors: z
        .array(
          z
            .object({
              kind: z.string().max(80),
              message: z.string().max(2_000),
              source: z.string().max(500).optional(),
            })
            .strict(),
        )
        .max(50)
        .optional(),
      audit: z
        .array(
          z
            .object({
              capability: z.string().max(80),
              operation: z.string().max(80),
              ok: z.boolean(),
              errorCode: z.string().max(80).optional(),
            })
            .strict(),
        )
        .max(200)
        .optional(),
    })
    .strict(),
} as const
