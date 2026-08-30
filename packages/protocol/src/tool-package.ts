import { z } from 'zod'
import {
  RuntimeEffectSchema,
  RuntimeIdempotencySchema,
  RuntimeRiskSchema,
} from './plugin-runtime.js'

export const TOOL_PACKAGE_SCHEMA_VERSION = 1 as const
export const TOOL_PROCESS_PROTOCOL_VERSION = 'spark-tool-process-v1' as const

export const ToolPackageIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,95}$/, 'Tool package id must be lowercase and folder-safe')

const ToolNameSchema = z
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

export const ToolPackageRemoteHttpRuntimeSchema = z.object({
  adapter: z.literal('remote-http'),
  protocol: z.literal(TOOL_PROCESS_PROTOCOL_VERSION),
  baseUrl: z.string().url().max(2_000),
})

export const ToolPackageMcpImportRuntimeSchema = z.object({
  adapter: z.literal('mcp-import'),
  serverId: z.string().min(1).max(160),
})

export const ToolPackageLegacyRuntimeSchema = z.object({
  adapter: z.literal('legacy-custom-tool'),
  toolId: z.string().min(1).max(160),
})

export const ToolPackageRuntimeSchema = z.discriminatedUnion('adapter', [
  ToolPackageProcessRuntimeSchema,
  ToolPackageRemoteHttpRuntimeSchema,
  ToolPackageMcpImportRuntimeSchema,
  ToolPackageLegacyRuntimeSchema,
])
export type ToolPackageRuntime = z.infer<typeof ToolPackageRuntimeSchema>

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

export interface ToolPackageDetail {
  package: ToolPackageSummary
  version: string
  manifest: ToolPackageManifest
  environment: ToolPackageEnvironmentStatus[]
  permissions: ToolPackagePermissionStatus[]
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

export interface ToolPackagesIpcChannelMap {
  'tool-packages:list': [Record<string, never>, { packages: ToolPackageSummary[] }]
  'tool-packages:get': [{ packageId: string; version?: string }, { detail: ToolPackageDetail }]
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
