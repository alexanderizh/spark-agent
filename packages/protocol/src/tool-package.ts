import { z } from 'zod'
import {
  RuntimeEffectSchema,
  RuntimeIdempotencySchema,
  RuntimeRiskSchema,
} from './plugin-runtime.js'
import { HttpToolSpecSchema } from './custom-tools.js'

export const TOOL_PACKAGE_SCHEMA_VERSION = 1 as const
export const TOOL_PROCESS_PROTOCOL_VERSION = 'spark-tool-process-v1' as const

export const ToolPackageIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,95}$/, 'Tool package id must be lowercase and folder-safe')

export const ToolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{1,95}$/, 'Tool name must be lowercase and engine-safe')

export const ToolPackageRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !value.startsWith('/') && !value.includes('\\') && value !== '.', {
    message: 'Tool package paths must be relative POSIX paths',
  })
  .refine((value) => !value.split('/').includes('..'), {
    message: 'Tool package paths cannot escape the package root',
  })

export const ToolPackageSourceSchema = z.enum([
  'managed-project',
  'local-directory',
  'local-archive',
  'registry',
  'remote',
  'mcp-import',
])
export type ToolPackageSource = z.infer<typeof ToolPackageSourceSchema>

export const ToolPackageTrustSchema = z.enum(['trusted-local', 'verified', 'blocked'])
export type ToolPackageTrust = z.infer<typeof ToolPackageTrustSchema>

export const ToolPackageLifecycleSchema = z.enum(['per-call', 'persistent'])
export type ToolPackageLifecycle = z.infer<typeof ToolPackageLifecycleSchema>

export const ToolPackageProcessRuntimeSchema = z.object({
  adapter: z.literal('process'),
  protocol: z.literal(TOOL_PROCESS_PROTOCOL_VERSION),
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(2_000)).max(128).default([]),
  lifecycle: ToolPackageLifecycleSchema.default('per-call'),
  workingDirectory: ToolPackageRelativePathSchema.optional(),
})

const HTTP_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_|~-]+$/
/** fetch 会自行管理这些头，允许声明只会造成“看起来配置了”的假象。 */
const HTTP_FORBIDDEN_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
])

const ToolPackageHttpHeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(HTTP_HEADER_NAME_PATTERN, 'HTTP header name must be an RFC 7230 token')
  .refine((name) => !HTTP_FORBIDDEN_HEADER_NAMES.has(name.toLowerCase()), {
    message: 'HTTP header is managed by the HTTP client and cannot be declared',
  })

/** 与 ToolEnvironmentVariableSchema 的变量名约束保持一致。 */
const HTTP_HEADER_PLACEHOLDER_PATTERN = /\$\{[A-Z_][A-Z0-9_]{0,127}\}/g

/**
 * Header 值支持 `${ENV_NAME}` 模板：调用时用已解析的环境变量（含 Keychain 密钥）替换，
 * 未解析的占位符视为配置缺失并拒绝调用，避免把字面 `${...}` 发给远端。
 * 校验层要求每个 `${` 都闭合且内部是合法环境变量名，孤立 `}` 同样视为畸形模板。
 */
const ToolPackageHttpHeaderValueSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      const stripped = value.replace(HTTP_HEADER_PLACEHOLDER_PATTERN, '')
      return !stripped.includes('${') && !stripped.includes('}')
    },
    {
      message: 'HTTP header value template is malformed',
    },
  )

export const ToolPackageRemoteHttpRuntimeSchema = z.object({
  adapter: z.literal('remote-http'),
  protocol: z.literal(TOOL_PROCESS_PROTOCOL_VERSION),
  baseUrl: z.string().url().max(2_000),
  headers: z
    .record(ToolPackageHttpHeaderNameSchema, ToolPackageHttpHeaderValueSchema)
    .refine((headers) => Object.keys(headers).length <= 32, {
      message: 'Tool package HTTP headers are limited to 32 entries',
    })
    .optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
})

export const ToolPackageMcpImportRuntimeSchema = z.object({
  adapter: z.literal('mcp-import'),
  serverId: z.string().min(1).max(160),
  /**
   * manifest 工具名 → MCP 服务器真实工具名。MCP 工具名可以任意大小写/点号，
   * manifest 名必须满足引擎目录约束；导入时自动归一化并在此记录映射。
   */
  toolNameOverrides: z
    .record(ToolNameSchema, z.string().min(1).max(200))
    .refine((overrides) => Object.keys(overrides).length <= 200, {
      message: 'Tool name overrides are limited to 200 entries',
    })
    .optional(),
})

/**
 * No-code HTTP adapter. Both HTTP and HTTPS, including localhost/private
 * networks, remain valid; each tool owns its declarative request/response spec.
 */
export const ToolPackageDeclarativeHttpRuntimeSchema = z.object({
  adapter: z.literal('declarative-http'),
  tools: z.record(ToolNameSchema, HttpToolSpecSchema),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
})

export const ToolPackageLegacyRuntimeSchema = z.object({
  adapter: z.literal('legacy-custom-tool'),
  toolId: z.string().min(1).max(160),
})

export const ToolPackageRuntimeSchema = z.discriminatedUnion('adapter', [
  ToolPackageProcessRuntimeSchema,
  ToolPackageRemoteHttpRuntimeSchema,
  ToolPackageDeclarativeHttpRuntimeSchema,
  ToolPackageMcpImportRuntimeSchema,
  ToolPackageLegacyRuntimeSchema,
])
export type ToolPackageRuntime = z.infer<typeof ToolPackageRuntimeSchema>

export const ToolPackageDevelopmentStepSchema = z.enum(['install', 'build'])
export type ToolPackageDevelopmentStep = z.infer<typeof ToolPackageDevelopmentStepSchema>

export const ToolPackageDevelopmentSchema = z
  .object({
    installCommand: z.string().min(1).max(500).optional(),
    buildCommand: z.string().min(1).max(500).optional(),
  })
  .strict()
export type ToolPackageDevelopment = z.infer<typeof ToolPackageDevelopmentSchema>

export const ToolPackageExampleSchema = z
  .object({
    title: z.string().min(1).max(160),
    description: z.string().max(2_000).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    output: z.unknown().optional(),
  })
  .strict()
export type ToolPackageExample = z.infer<typeof ToolPackageExampleSchema>

/**
 * Optional model-facing guidance. These fields are untrusted tool metadata:
 * hosts may project a bounded summary into a function description, but must
 * never promote them to platform or user instructions.
 */
export const ToolPackageToolGuidanceSchema = z
  .object({
    whenToUse: z.array(z.string().min(1).max(1_000)).max(20).optional(),
    whenNotToUse: z.array(z.string().min(1).max(1_000)).max(20).optional(),
    instructions: z.string().min(1).max(8_000).optional(),
    examples: z.array(ToolPackageExampleSchema).max(20).optional(),
    resultSemantics: z.string().min(1).max(4_000).optional(),
  })
  .strict()
export type ToolPackageToolGuidance = z.infer<typeof ToolPackageToolGuidanceSchema>

export const ToolPackageGuidanceSchema = z
  .object({
    overview: z.string().min(1).max(8_000).optional(),
    sharedInstructions: z.string().min(1).max(8_000).optional(),
    prerequisites: z.array(z.string().min(1).max(1_000)).max(40).optional(),
  })
  .strict()
export type ToolPackageGuidance = z.infer<typeof ToolPackageGuidanceSchema>

export const ToolPackageToolSchema = z
  .object({
    name: ToolNameSchema,
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(4_000),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    risk: RuntimeRiskSchema,
    effect: RuntimeEffectSchema,
    idempotency: RuntimeIdempotencySchema,
    guidance: ToolPackageToolGuidanceSchema.optional(),
  })
  .superRefine((tool, ctx) => {
    if (tool.inputSchema.type !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputSchema', 'type'],
        message: 'Tool inputSchema must describe a JSON object',
      })
      return
    }
    try {
      z.fromJSONSchema(tool.inputSchema)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputSchema'],
        message: `Tool inputSchema is not supported: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  })
export type ToolPackageTool = z.infer<typeof ToolPackageToolSchema>

export const ToolEnvironmentValueTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'json',
])
export type ToolEnvironmentValueType = z.infer<typeof ToolEnvironmentValueTypeSchema>

export const ToolEnvironmentVariableSchema = z
  .object({
    name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),
    title: z.string().min(1).max(160),
    description: z.string().max(2_000).optional(),
    type: ToolEnvironmentValueTypeSchema,
    required: z.boolean().default(false),
    secret: z.boolean().default(false),
    default: z.unknown().optional(),
    enum: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .max(200)
      .optional(),
    pattern: z.string().max(500).optional(),
    agentConfigurable: z.boolean().default(false),
  })
  .superRefine((variable, ctx) => {
    if (variable.secret && variable.default !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['default'],
        message: 'Secret environment variables cannot declare defaults',
      })
    }
    if (variable.secret && variable.type !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'Secret environment variables must use string type',
      })
    }
    if (variable.pattern != null && variable.type !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: 'Environment pattern is only valid for string variables',
      })
    }
    if (variable.pattern != null) {
      try {
        new RegExp(variable.pattern)
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pattern'],
          message: 'Environment pattern must be a valid regular expression',
        })
      }
    }
    if (variable.default !== undefined) {
      const issue = validateToolEnvironmentValue(variable, variable.default)
      if (issue != null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default'], message: issue })
      }
    }
  })
export type ToolEnvironmentVariable = z.infer<typeof ToolEnvironmentVariableSchema>

export const ToolPackageOsEffectSchema = z.enum([
  'network',
  'filesystem.read',
  'filesystem.write',
  'process.spawn',
  'clipboard',
  'browser',
])
export type ToolPackageOsEffect = z.infer<typeof ToolPackageOsEffectSchema>

const SparkCapabilityNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/)
  .max(160)

export const ToolPackagePermissionsSchema = z.object({
  declaredOsEffects: z.array(ToolPackageOsEffectSchema).max(32).default([]),
  requiredSparkCapabilities: z.array(SparkCapabilityNameSchema).max(64).default([]),
  optionalSparkCapabilities: z.array(SparkCapabilityNameSchema).max(64).default([]),
})
export type ToolPackagePermissions = z.infer<typeof ToolPackagePermissionsSchema>

export const ToolPackageManifestSchema = z
  .object({
    $schema: z.string().url().optional(),
    schemaVersion: z.literal(TOOL_PACKAGE_SCHEMA_VERSION),
    id: ToolPackageIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(8_000),
    author: z
      .object({
        name: z.string().min(1).max(160),
        url: z.string().url().optional(),
      })
      .optional(),
    runtime: ToolPackageRuntimeSchema,
    development: ToolPackageDevelopmentSchema.optional(),
    guidance: ToolPackageGuidanceSchema.optional(),
    tools: z.array(ToolPackageToolSchema).min(1).max(200),
    environment: z.array(ToolEnvironmentVariableSchema).max(200).default([]),
    permissions: ToolPackagePermissionsSchema.default({
      declaredOsEffects: [],
      requiredSparkCapabilities: [],
      optionalSparkCapabilities: [],
    }),
  })
  .superRefine((manifest, ctx) => {
    addDuplicateIssues(
      manifest.tools.map((tool) => tool.name),
      ['tools'],
      'tool name',
      ctx,
    )
    addDuplicateIssues(
      manifest.environment.map((variable) => variable.name),
      ['environment'],
      'environment variable',
      ctx,
    )
    if (manifest.runtime.adapter === 'declarative-http') {
      const declaredTools = new Set(manifest.tools.map((tool) => tool.name))
      for (const name of Object.keys(manifest.runtime.tools)) {
        if (!declaredTools.has(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['runtime', 'tools', name],
            message: `Declarative HTTP runtime references an undeclared tool: ${name}`,
          })
        }
      }
      for (const tool of manifest.tools) {
        if (manifest.runtime.tools[tool.name] == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['runtime', 'tools'],
            message: `Declarative HTTP runtime is missing a spec for tool: ${tool.name}`,
          })
        }
      }
    }
    const required = new Set(manifest.permissions.requiredSparkCapabilities)
    for (const capability of manifest.permissions.optionalSparkCapabilities) {
      if (required.has(capability)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['permissions', 'optionalSparkCapabilities'],
          message: `Spark capability cannot be both required and optional: ${capability}`,
        })
      }
    }
    for (const tool of manifest.tools) {
      if (tool.risk === 'read' && tool.effect !== 'read') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tools'],
          message: `Read tool ${tool.name} must use read effect`,
        })
      }
      if (tool.risk === 'destructive' && tool.idempotency !== 'unsafe') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tools'],
          message: `Destructive tool ${tool.name} must use unsafe idempotency`,
        })
      }
    }
  })
export type ToolPackageManifest = z.infer<typeof ToolPackageManifestSchema>

export interface ToolPackageInspection {
  manifest: ToolPackageManifest
  sourcePath: string
  integritySha256: string
  fileCount: number
  totalBytes: number
  warnings: string[]
}

export const ToolPackageConfigScopeSchema = z.enum([
  'package',
  'tool',
  'project',
  'agent',
  'workflow',
  'session',
])
export type ToolPackageConfigScope = z.infer<typeof ToolPackageConfigScopeSchema>

export interface ToolPackageConfigValue {
  packageId: string
  scope: ToolPackageConfigScope
  scopeId: string
  toolName?: string
  name: string
  secret: boolean
  configured: boolean
  value?: unknown
  updatedAt: string
}

export const ToolPackageSecureRequestStatusSchema = z.enum([
  'pending',
  'completed',
  'cancelled',
  'expired',
])
export type ToolPackageSecureRequestStatus = z.infer<typeof ToolPackageSecureRequestStatusSchema>

export interface ToolPackageSecureRequest {
  id: string
  packageId: string
  packageName: string
  version: string
  name: string
  title: string
  description?: string
  scope: ToolPackageConfigScope
  scopeId: string
  toolName?: string
  status: ToolPackageSecureRequestStatus
  expiresAt: string
  createdAt: string
}

export interface ToolPackageSummary {
  id: string
  name: string
  description: string
  source: ToolPackageSource
  trust: ToolPackageTrust
  state: 'inspected' | 'installed-disabled' | 'configuration-ready' | 'enabled' | 'error'
  enabledVersion: string | null
  versions: string[]
  updatedAt: string
}

export interface ToolPackagePermissionStatus {
  kind: 'os-effect' | 'spark-capability'
  permission: string
  required: boolean
  state: 'pending' | 'granted' | 'denied'
}

export interface ToolHostCapabilityDescriptor {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  risk?: 'read' | 'low-write' | 'high-write' | 'destructive'
  supportsCancellation?: boolean
  supportsProgress?: boolean
  requiresCallConfirmation?: boolean
  sensitiveDataPolicy?: string
}

export interface ToolPackageDetail {
  package: ToolPackageSummary
  version: string
  manifest: ToolPackageManifest
  environment: ToolPackageEnvironmentStatus[]
  permissions: ToolPackagePermissionStatus[]
  /** Available host metadata for Spark capabilities declared by this manifest. */
  hostCapabilities?: ToolHostCapabilityDescriptor[]
  /** Git 导入来源地址；本地目录 / 压缩包 / 受管工程导入时为 null。 */
  sourceUrl: string | null
  /** Git 导入时使用的分支或标签；未指定时为 null。 */
  sourceRef: string | null
  /** 包位于仓库（或压缩包）内的子目录；位于根时为 null。 */
  sourceSubdirectory: string | null
}

export interface ToolPackageEnvironmentStatus {
  name: string
  secret: boolean
  required: boolean
  agentConfigurable: boolean
  configured: boolean
  /** Present only for compatible non-secret configuration. */
  value?: unknown
  source: 'configured' | 'default' | 'missing'
}

export interface ToolPackageProjectStepResult {
  packageId: string
  step: ToolPackageDevelopmentStep
  command: string
  inferred: boolean
  exitCode: number | null
  timedOut: boolean
  cancelled?: boolean
  durationMs: number
  stdout: string
  stderr: string
  truncated: boolean
}

export interface ToolPackageTestResult {
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
  durationMs: number
  correlationId: string
}

export interface ToolInvocationTrace {
  id: string
  correlationId: string
  sourceKind: 'connector' | 'custom-tool' | 'tool-package' | 'workflow' | 'test'
  sourceId: string
  packageId: string | null
  toolId: string | null
  toolName: string
  version: string | null
  adapter: string | null
  sessionId: string | null
  turnId: string | null
  projectId: string | null
  agentId: string | null
  workflowId: string | null
  invocationSource: 'model' | 'workflow' | 'test' | 'platform' | 'nested'
  status: 'running' | 'ok' | 'error' | 'timeout' | 'denied' | 'cancelled'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  errorCode: string | null
  outputBytes: number | null
  resultArchived: boolean
  resultTruncated: boolean
  retryCount: number
}

/** Tool Process log/progress events forwarded by the host while an invocation is active. */
export type ToolPackageRuntimeEvent =
  | {
      type: 'log'
      packageId: string
      packageVersion: string
      invocationId?: string
      correlationId?: string
      toolName?: string
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
    }
  | {
      type: 'progress'
      packageId: string
      packageVersion: string
      invocationId: string
      correlationId?: string
      toolName?: string
      progress?: number
      message?: string
    }

export interface ToolPackageUninstallResult {
  packageId: string
  removedVersions: string[]
  removedSecrets: number
  removedManagedProject: boolean
}

export interface ToolPackageProjectFile {
  path: string
  size: number
}

export interface ToolPackagesIpcChannelMap {
  'tool-packages:list': [Record<string, never>, { packages: ToolPackageSummary[] }]
  'tool-packages:get': [{ packageId: string; version?: string }, { detail: ToolPackageDetail }]
  'tool-packages:install-directory': [
    { sourcePath: string },
    { package: ToolPackageSummary; version: string },
  ]
  'tool-packages:install-archive': [
    { archivePath: string },
    { package: ToolPackageSummary; version: string },
  ]
  'tool-packages:install-git': [
    { url: string; ref?: string; subdirectory?: string },
    { package: ToolPackageSummary; version: string },
  ]
  'tool-packages:install-mcp-import': [
    { serverId: string; name?: string; tools?: string[] },
    {
      package: ToolPackageSummary
      version: string
      importedTools: string[]
      skippedTools: Array<{ name: string; reason: string }>
    },
  ]
  'tool-packages:run-project-step': [
    { packageId: string; step: ToolPackageDevelopmentStep; operationId?: string },
    { result: ToolPackageProjectStepResult },
  ]
  'tool-packages:run-project-step:cancel': [{ operationId: string }, { cancelled: boolean }]
  'tool-packages:project-files:list': [
    { packageId: string },
    { projectPath: string; files: ToolPackageProjectFile[] },
  ]
  'tool-packages:project-file:read': [
    { packageId: string; path: string },
    { projectPath: string; path: string; content: string },
  ]
  'tool-packages:project-file:write': [
    { packageId: string; path: string; content: string },
    { projectPath: string; path: string },
  ]
  'tool-packages:project:install': [
    { packageId: string },
    { package: ToolPackageSummary; version: string },
  ]
  'tool-packages:test': [
    {
      packageId: string
      version?: string
      toolName: string
      input: Record<string, unknown>
      correlationId?: string
    },
    { test: ToolPackageTestResult },
  ]
  'tool-packages:test:cancel': [{ correlationId: string }, { cancelled: boolean }]
  'tool-packages:invocations:list': [
    {
      sourceKind?: ToolInvocationTrace['sourceKind']
      packageId?: string
      toolName?: string
      status?: ToolInvocationTrace['status']
      correlationId?: string
      from?: string
      to?: string
      limit?: number
      offset?: number
    },
    { invocations: ToolInvocationTrace[]; total: number },
  ]
  'tool-packages:configure-environment': [
    {
      packageId: string
      version?: string
      name: string
      value: unknown
      scope?: ToolPackageConfigScope
      scopeId?: string
      toolName?: string
    },
    { ok: true },
  ]
  'tool-packages:request-secret': [
    {
      packageId: string
      version?: string
      name: string
      scope?: ToolPackageConfigScope
      scopeId?: string
      toolName?: string
    },
    { request: ToolPackageSecureRequest },
  ]
  'tool-packages:set-permission': [
    {
      packageId: string
      version: string
      kind: 'os-effect' | 'spark-capability'
      permission: string
      state: 'pending' | 'granted' | 'denied'
    },
    { ok: true },
  ]
  'tool-packages:set-enabled': [
    { packageId: string; version: string | null },
    { package: ToolPackageSummary },
  ]
  'tool-packages:uninstall': [
    { packageId: string; removeManagedProject?: boolean },
    { result: ToolPackageUninstallResult },
  ]
  'tool-packages:delete-version': [
    { packageId: string; version: string },
    { removed: true; version: string },
  ]
  'tool-packages:secure-requests:list': [
    Record<string, never>,
    { requests: ToolPackageSecureRequest[] },
  ]
  'tool-packages:secure-request:fulfill': [{ requestId: string; value: string }, { ok: true }]
  'tool-packages:secure-request:cancel': [{ requestId: string }, { ok: true }]
}

const ToolPackageSecureRequestIdSchema = z.string().uuid()

export const ToolPackagesIpcSchemaRegistry = {
  'tool-packages:list': z.object({}).strict(),
  'tool-packages:get': z
    .object({ packageId: ToolPackageIdSchema, version: z.string().max(160).optional() })
    .strict(),
  'tool-packages:install-directory': z
    .object({
      sourcePath: z
        .string()
        .min(1)
        .max(1_000)
        .refine((value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), {
          message: 'Source path must be absolute',
        }),
    })
    .strict(),
  'tool-packages:install-archive': z
    .object({
      archivePath: z
        .string()
        .min(1)
        .max(1_000)
        .refine((value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), {
          message: 'Archive path must be absolute',
        })
        .refine((value) => /\.zip$/i.test(value), {
          message: 'Only .zip tool package archives are supported',
        }),
    })
    .strict(),
  'tool-packages:install-git': z
    .object({
      url: z.string().min(1).max(2_000),
      ref: z.string().min(1).max(200).optional(),
      subdirectory: z.string().min(1).max(300).optional(),
    })
    .strict(),
  'tool-packages:install-mcp-import': z
    .object({
      serverId: z.string().min(1).max(160),
      name: z.string().min(1).max(200).optional(),
      tools: z.array(z.string().min(1).max(200)).max(500).optional(),
    })
    .strict(),
  'tool-packages:run-project-step': z
    .object({
      packageId: ToolPackageIdSchema,
      step: ToolPackageDevelopmentStepSchema,
      operationId: z.string().uuid().optional(),
    })
    .strict(),
  'tool-packages:run-project-step:cancel': z.object({ operationId: z.string().uuid() }).strict(),
  'tool-packages:project-files:list': z.object({ packageId: ToolPackageIdSchema }).strict(),
  'tool-packages:project-file:read': z
    .object({ packageId: ToolPackageIdSchema, path: ToolPackageRelativePathSchema })
    .strict(),
  'tool-packages:project-file:write': z
    .object({
      packageId: ToolPackageIdSchema,
      path: ToolPackageRelativePathSchema,
      content: z.string().max(2 * 1024 * 1024),
    })
    .strict(),
  'tool-packages:project:install': z.object({ packageId: ToolPackageIdSchema }).strict(),
  'tool-packages:test': z
    .object({
      packageId: ToolPackageIdSchema,
      version: z.string().min(1).max(160).optional(),
      toolName: ToolNameSchema,
      input: z.record(z.string(), z.unknown()),
      correlationId: z.string().uuid().optional(),
    })
    .strict(),
  'tool-packages:test:cancel': z.object({ correlationId: z.string().uuid() }).strict(),
  'tool-packages:invocations:list': z
    .object({
      sourceKind: z
        .enum(['connector', 'custom-tool', 'tool-package', 'workflow', 'test'])
        .optional(),
      packageId: ToolPackageIdSchema.optional(),
      toolName: ToolNameSchema.optional(),
      status: z.enum(['running', 'ok', 'error', 'timeout', 'denied', 'cancelled']).optional(),
      correlationId: z.string().min(1).max(160).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .strict(),
  'tool-packages:configure-environment': z
    .object({
      packageId: ToolPackageIdSchema,
      version: z.string().max(160).optional(),
      name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),
      value: z.unknown(),
      scope: ToolPackageConfigScopeSchema.optional(),
      scopeId: z.string().max(300).optional(),
      toolName: z.string().max(96).optional(),
    })
    .strict(),
  'tool-packages:request-secret': z
    .object({
      packageId: ToolPackageIdSchema,
      version: z.string().max(160).optional(),
      name: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/),
      scope: ToolPackageConfigScopeSchema.optional(),
      scopeId: z.string().max(300).optional(),
      toolName: z.string().max(96).optional(),
    })
    .strict(),
  'tool-packages:set-permission': z
    .object({
      packageId: ToolPackageIdSchema,
      version: z.string().max(160),
      kind: z.enum(['os-effect', 'spark-capability']),
      permission: z.string().min(1).max(160),
      state: z.enum(['pending', 'granted', 'denied']),
    })
    .strict(),
  'tool-packages:set-enabled': z
    .object({
      packageId: ToolPackageIdSchema,
      version: z.string().max(160).nullable(),
    })
    .strict(),
  'tool-packages:uninstall': z
    .object({
      packageId: ToolPackageIdSchema,
      removeManagedProject: z.boolean().optional(),
    })
    .strict(),
  'tool-packages:delete-version': z
    .object({
      packageId: ToolPackageIdSchema,
      version: z.string().min(1).max(160),
    })
    .strict(),
  'tool-packages:secure-requests:list': z.object({}).strict(),
  'tool-packages:secure-request:fulfill': z
    .object({
      requestId: ToolPackageSecureRequestIdSchema,
      value: z.string().min(1).max(64_000),
    })
    .strict(),
  'tool-packages:secure-request:cancel': z
    .object({ requestId: ToolPackageSecureRequestIdSchema })
    .strict(),
}

export function validateToolEnvironmentValue(
  variable: Pick<ToolEnvironmentVariable, 'name' | 'type' | 'enum' | 'pattern'>,
  value: unknown,
): string | null {
  const typeValid =
    (variable.type === 'string' && typeof value === 'string') ||
    (variable.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (variable.type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
    (variable.type === 'boolean' && typeof value === 'boolean') ||
    (variable.type === 'json' && value !== undefined)
  if (!typeValid) return `${variable.name} must be ${variable.type}`
  if (variable.enum != null && !variable.enum.some((candidate) => Object.is(candidate, value))) {
    return `${variable.name} must be one of its declared enum values`
  }
  if (
    variable.pattern != null &&
    typeof value === 'string' &&
    !new RegExp(variable.pattern).test(value)
  ) {
    return `${variable.name} does not match its declared pattern`
  }
  return null
}

function addDuplicateIssues(
  values: string[],
  path: PropertyKey[],
  label: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `Duplicate ${label}: ${value}`,
      })
    }
    seen.add(value)
  }
}
