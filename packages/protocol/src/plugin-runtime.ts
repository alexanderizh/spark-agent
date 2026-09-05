/**
 * Provider-neutral plugin runtime protocol.
 *
 * A plugin owns lifecycle and permissions. A runtime owns authenticated
 * accounts and provider calls. Keeping these types separate is what lets the
 * same Agent tool bridge serve built-in adapters and future isolated workers.
 */

import { z } from 'zod'
import type {
  ConnectorAuthMethod,
  ConnectorCapabilityKind,
  ConnectorConnectionStatus,
} from './connectors.js'

export const PLUGIN_RUNTIME_PROTOCOL_VERSION = 2 as const

export const RuntimeExecutionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('builtin'), adapter: z.string().min(1).max(160) }),
  z.object({ type: z.literal('remote-mcp'), url: z.string().url().max(2_000) }),
  z.object({
    type: z.literal('worker'),
    entrypoint: z.string().min(1).max(240),
    packageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
])
export type RuntimeExecution = z.infer<typeof RuntimeExecutionSchema>

export const RuntimeRiskSchema = z.enum(['read', 'low-write', 'high-write', 'destructive'])
export type RuntimeRisk = z.infer<typeof RuntimeRiskSchema>

export const RuntimeEffectSchema = z.enum(['read', 'create', 'update', 'delete', 'send', 'publish'])
export type RuntimeEffect = z.infer<typeof RuntimeEffectSchema>

export const RuntimeIdempotencySchema = z.enum(['safe', 'keyed', 'unsafe'])
export type RuntimeIdempotency = z.infer<typeof RuntimeIdempotencySchema>

export interface RuntimeToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  /** Bounded, model-facing guidance projected from untrusted tool metadata. */
  guidance?: {
    whenToUse?: string[] | undefined
    whenNotToUse?: string[] | undefined
    instructions?: string | undefined
    resultSemantics?: string | undefined
  }
  requiredCapabilities: ConnectorCapabilityKind[]
  risk: RuntimeRisk
  effect: RuntimeEffect
  idempotency: RuntimeIdempotency
  /** Provider/resource preview shown before a high-risk action. */
  preview?: (input: unknown) => Record<string, unknown>
}

export const RuntimeToolDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,95}$/),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(4_000),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  guidance: z
    .object({
      whenToUse: z.array(z.string()).optional(),
      whenNotToUse: z.array(z.string()).optional(),
      instructions: z.string().optional(),
      resultSemantics: z.string().optional(),
    })
    .optional(),
  requiredCapabilities: z.array(z.string().min(1).max(120)).max(32),
  risk: RuntimeRiskSchema,
  effect: RuntimeEffectSchema,
  idempotency: RuntimeIdempotencySchema,
})

export interface ConnectorRuntimeDescriptor {
  id: string
  pluginId: string
  provider: string
  displayName: string
  description: string
  icon: string
  toolNamespace: string
  accountMode: 'single' | 'multiple'
  execution: RuntimeExecution
  authMethods: ConnectorAuthMethod[]
  /** Official setup pages for credentials or OAuth client configuration. */
  authGuides?: {
    token?: ConnectorAuthGuide
    oauth?: ConnectorAuthGuide
  }
  capabilities: Array<{
    id: ConnectorCapabilityKind
    label: string
    description: string
    requiredScopes?: string[]
    enabledByDefault: boolean
  }>
}

export interface ConnectorAuthGuide {
  label: string
  url: string
  description?: string
}

export const PluginRuntimeContributionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/),
  kind: z.literal('connector'),
  execution: RuntimeExecutionSchema,
  toolNamespace: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),
  accountMode: z.enum(['single', 'multiple']).default('multiple'),
  activation: z.enum(['on-demand', 'on-startup']).default('on-demand'),
  provider: z.string().min(1).max(100),
})
export type PluginRuntimeContribution = z.infer<typeof PluginRuntimeContributionSchema>

export interface ConnectorAccount {
  id: string
  pluginId: string
  runtimeId: string
  provider: string
  externalAccountId: string
  displayName: string
  avatarUrl?: string
  authMethod: ConnectorAuthMethod
  status: ConnectorConnectionStatus
  enabled: boolean
  grantedScopes: string[]
  enabledCapabilities: ConnectorCapabilityKind[]
  resourceScope: Record<string, unknown>
  config: Record<string, unknown>
  tokenExpiresAt?: string
  lastHealthAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface RuntimeHealth {
  status: 'healthy' | 'degraded' | 'needs-auth' | 'unavailable'
  checkedAt: string
  latencyMs?: number
  message?: string
}

export interface RuntimeConnectRequest {
  authMethod: ConnectorAuthMethod
  /** Secret values are accepted at the main-process boundary and never persisted in SQLite. */
  secrets?: Record<string, string>
  config?: Record<string, unknown>
  enabledCapabilities?: ConnectorCapabilityKind[]
  resourceScope?: Record<string, unknown>
}

export interface RuntimeUpdateAccountRequest {
  enabled?: boolean
  config?: Record<string, unknown>
  enabledCapabilities?: ConnectorCapabilityKind[]
  resourceScope?: Record<string, unknown>
}

export interface RuntimeToolInvokeRequest {
  runtimeId: string
  accountId?: string
  toolName: string
  input: unknown
  /** Set only after the UI/Agent has shown and accepted the action preview. */
  confirmationToken?: string
}

export interface PluginRuntimeStatusItem {
  runtime: ConnectorRuntimeDescriptor
  enabled: boolean
  accountCount: number
  defaultAccountId?: string
}

export interface RuntimeErrorShape {
  code:
    | 'PLUGIN_DISABLED'
    | 'RUNTIME_UNAVAILABLE'
    | 'ACCOUNT_REQUIRED'
    | 'ACCOUNT_SELECTION_REQUIRED'
    | 'AUTH_REQUIRED'
    | 'AUTH_EXPIRED'
    | 'SCOPE_REQUIRED'
    | 'CAPABILITY_DISABLED'
    | 'RESOURCE_OUT_OF_SCOPE'
    | 'CONFIRMATION_REQUIRED'
    | 'RATE_LIMITED'
    | 'CONFLICT'
    | 'PROVIDER_UNAVAILABLE'
    | 'INVALID_PROVIDER_RESPONSE'
  message: string
  retryAfterMs?: number
}

export interface PluginRuntimeListRequest {}
export interface PluginRuntimeListResponse {
  runtimes: PluginRuntimeStatusItem[]
}
export interface PluginRuntimeAccountsListRequest {
  runtimeId: string
}
export interface PluginRuntimeAccountsListResponse {
  accounts: ConnectorAccount[]
}
export interface PluginRuntimeAccountsConnectRequest {
  runtimeId: string
  request: RuntimeConnectRequest
}
export interface PluginRuntimeAccountsConnectResponse {
  account: ConnectorAccount
}
export interface PluginRuntimeAccountsAuthorizeRequest {
  runtimeId: string
  clientId: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  redirectPath?: string
  extraAuthorizationParams?: Record<string, string>
  config?: Record<string, unknown>
  enabledCapabilities?: ConnectorCapabilityKind[]
  resourceScope?: Record<string, unknown>
}
export interface PluginRuntimeAccountsAuthorizeResponse {
  account: ConnectorAccount
}
export interface PluginRuntimeAccountsUpdateRequest {
  runtimeId: string
  accountId: string
  request: RuntimeUpdateAccountRequest
}
export interface PluginRuntimeAccountsUpdateResponse {
  account: ConnectorAccount
}
export interface PluginRuntimeAccountsDisconnectRequest {
  runtimeId: string
  accountId: string
}
export interface PluginRuntimeAccountsDisconnectResponse {
  disconnected: boolean
}
export interface PluginRuntimeAccountsSetDefaultRequest {
  runtimeId: string
  accountId: string
}
export interface PluginRuntimeAccountsSetDefaultResponse {
  account: ConnectorAccount
}
export interface PluginRuntimeHealthCheckRequest {
  runtimeId: string
  accountId: string
}
export interface PluginRuntimeHealthCheckResponse {
  health: RuntimeHealth
}
export interface PluginRuntimeToolsListRequest {
  runtimeId: string
  accountId?: string
}
export interface PluginRuntimeToolsListResponse {
  tools: RuntimeToolDefinition[]
}
export interface PluginRuntimeIssueConfirmationRequest {
  runtimeId: string
  accountId: string
  toolName: string
  ttlMs?: number
}
export interface PluginRuntimeIssueConfirmationResponse {
  token: string
  expiresAt: string
}

export interface PluginRuntimeIpcChannelMap {
  'plugin-runtime:list': [PluginRuntimeListRequest, PluginRuntimeListResponse]
  'plugin-runtime:accounts:list': [
    PluginRuntimeAccountsListRequest,
    PluginRuntimeAccountsListResponse,
  ]
  'plugin-runtime:accounts:connect': [
    PluginRuntimeAccountsConnectRequest,
    PluginRuntimeAccountsConnectResponse,
  ]
  'plugin-runtime:accounts:authorize': [
    PluginRuntimeAccountsAuthorizeRequest,
    PluginRuntimeAccountsAuthorizeResponse,
  ]
  'plugin-runtime:accounts:update': [
    PluginRuntimeAccountsUpdateRequest,
    PluginRuntimeAccountsUpdateResponse,
  ]
  'plugin-runtime:accounts:disconnect': [
    PluginRuntimeAccountsDisconnectRequest,
    PluginRuntimeAccountsDisconnectResponse,
  ]
  'plugin-runtime:accounts:set-default': [
    PluginRuntimeAccountsSetDefaultRequest,
    PluginRuntimeAccountsSetDefaultResponse,
  ]
  'plugin-runtime:health-check': [PluginRuntimeHealthCheckRequest, PluginRuntimeHealthCheckResponse]
  'plugin-runtime:tools:list': [PluginRuntimeToolsListRequest, PluginRuntimeToolsListResponse]
  'plugin-runtime:issue-confirmation': [
    PluginRuntimeIssueConfirmationRequest,
    PluginRuntimeIssueConfirmationResponse,
  ]
}

const RuntimeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/)
const AccountIdSchema = z.string().min(1).max(200)
const RuntimeSecretSchema = z.record(z.string(), z.string().max(16_000))
const RuntimeConfigSchema = z.record(z.string(), z.unknown()).default({})

export const PluginRuntimeIpcSchemaRegistry = {
  'plugin-runtime:list': z.object({}).strict(),
  'plugin-runtime:accounts:list': z.object({ runtimeId: RuntimeIdSchema }).strict(),
  'plugin-runtime:accounts:connect': z
    .object({
      runtimeId: RuntimeIdSchema,
      request: z
        .object({
          authMethod: z.string().min(1).max(80),
          secrets: RuntimeSecretSchema.optional(),
          config: RuntimeConfigSchema.optional(),
          enabledCapabilities: z.array(z.string().min(1).max(120)).max(64).optional(),
          resourceScope: RuntimeConfigSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  'plugin-runtime:accounts:authorize': z
    .object({
      runtimeId: RuntimeIdSchema,
      clientId: z.string().min(1).max(300),
      authorizationUrl: z.string().url().max(2_000),
      tokenUrl: z.string().url().max(2_000),
      scopes: z.array(z.string().min(1).max(500)).max(64),
      redirectPath: z
        .string()
        .regex(/^\/[A-Za-z0-9._/-]{1,120}$/)
        .optional(),
      extraAuthorizationParams: z.record(z.string(), z.string().max(500)).optional(),
      config: RuntimeConfigSchema.optional(),
      enabledCapabilities: z.array(z.string().min(1).max(120)).max(64).optional(),
      resourceScope: RuntimeConfigSchema.optional(),
    })
    .strict(),
  'plugin-runtime:accounts:update': z
    .object({
      runtimeId: RuntimeIdSchema,
      accountId: AccountIdSchema,
      request: z
        .object({
          enabled: z.boolean().optional(),
          config: RuntimeConfigSchema.optional(),
          enabledCapabilities: z.array(z.string().min(1).max(120)).max(64).optional(),
          resourceScope: RuntimeConfigSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  'plugin-runtime:accounts:disconnect': z
    .object({ runtimeId: RuntimeIdSchema, accountId: AccountIdSchema })
    .strict(),
  'plugin-runtime:accounts:set-default': z
    .object({ runtimeId: RuntimeIdSchema, accountId: AccountIdSchema })
    .strict(),
  'plugin-runtime:health-check': z
    .object({ runtimeId: RuntimeIdSchema, accountId: AccountIdSchema })
    .strict(),
  'plugin-runtime:tools:list': z
    .object({ runtimeId: RuntimeIdSchema, accountId: AccountIdSchema.optional() })
    .strict(),
  'plugin-runtime:issue-confirmation': z
    .object({
      runtimeId: RuntimeIdSchema,
      accountId: AccountIdSchema,
      toolName: z.string().min(1).max(120),
      ttlMs: z.number().int().min(1_000).max(300_000).optional(),
    })
    .strict(),
} as const
