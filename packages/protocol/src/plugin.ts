/**
 * Spark Plugin Protocol
 *
 * Plugins are declarative capability packages. A package may contribute Skills,
 * MCP servers and connector manifests, but it cannot execute JavaScript in the
 * renderer or main process. Executable extensions must use a separately
 * sandboxed host in a future protocol revision.
 */

import { z } from 'zod'
import type { ConnectorProviderManifest } from './connectors.js'
import {
  PluginRuntimeContributionSchema,
  type PluginRuntimeContribution,
} from './plugin-runtime.js'

/** Current manifest protocol. v1 remains readable for installed packages. */
export const PLUGIN_PROTOCOL_VERSION = 2 as const
export const SUPPORTED_PLUGIN_PROTOCOL_VERSIONS = [1, PLUGIN_PROTOCOL_VERSION] as const

export const PluginPermissionSchema = z.enum([
  'network',
  'filesystem.read',
  'filesystem.write',
  'process.spawn',
  'secrets.read',
  'clipboard',
  'browser',
  'mcp.connect',
  'connector.account',
])
export type PluginPermission = z.infer<typeof PluginPermissionSchema>

export const PluginPermissionRiskSchema = z.enum(['low', 'medium', 'high', 'critical'])
export type PluginPermissionRisk = z.infer<typeof PluginPermissionRiskSchema>

const PluginIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,95}$/, 'Plugin id must be lowercase and folder-safe')

const RelativePackagePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith('/') && !value.includes('\\') && value !== '.', {
    message: 'Plugin contribution paths must be relative POSIX paths',
  })
  .refine((value) => !value.split('/').includes('..'), {
    message: 'Plugin contribution paths cannot escape the package root',
  })

export interface PluginSkillContribution {
  id: string
  path: string
  name?: string
  description?: string
}

export interface PluginMcpServerContribution {
  id: string
  name: string
  config: Record<string, unknown>
  permissions?: PluginPermission[]
}

export interface PluginConnectorContribution {
  id: string
  manifest: ConnectorProviderManifest
  permissions?: PluginPermission[]
}

export interface PluginManifest {
  schemaVersion: (typeof SUPPORTED_PLUGIN_PROTOCOL_VERSIONS)[number]
  id: string
  version: string
  displayName: string
  description: string
  author: {
    id?: string
    name: string
    url?: string
  }
  license?: string
  homepageUrl?: string
  repositoryUrl?: string
  icon?: string
  runtime?: {
    type: 'builtin'
    id: string
  }
  categories: string[]
  tags: string[]
  permissions: {
    required: PluginPermission[]
    optional: PluginPermission[]
  }
  activation: 'manual' | 'on-startup' | 'on-demand'
  contributions: {
    skills: PluginSkillContribution[]
    mcpServers: PluginMcpServerContribution[]
    connectors: PluginConnectorContribution[]
    /** Runtime contributions are optional for v1 packages and are activated by v2 hosts. */
    runtimes?: PluginRuntimeContribution[]
  }
}

const ConnectorCapabilitySchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  description: z.string().max(2_000),
  requiredScopes: z.array(z.string().max(200)).max(100).optional(),
  risk: z.enum(['low', 'medium', 'high']),
  enabledByDefault: z.boolean(),
})

const ConnectorManifestSchema = z.object({
  protocolVersion: z.literal('2026-06-25'),
  provider: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(4_000),
  icon: z.string().min(1).max(200),
  auth: z.array(z.record(z.string(), z.unknown())).max(32),
  capabilities: z.array(ConnectorCapabilitySchema).max(100),
  endpoints: z.record(z.string(), z.string().url()).optional(),
  security: z.object({
    preferredAuthFlow: z.string().min(1).max(100),
    tokenStorage: z.enum(['keystore', 'vault', 'memory-only', 'not-stored']),
    supportsPkce: z.boolean(),
    supportsDeviceFlow: z.boolean(),
    supportsInstallationTokens: z.boolean(),
    notes: z.array(z.string().max(1_000)).max(32),
  }),
})

export const PluginManifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(PLUGIN_PROTOCOL_VERSION)]),
    id: PluginIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    displayName: z.string().min(1).max(160),
    description: z.string().min(1).max(8_000),
    author: z.object({
      id: z.string().max(160).optional(),
      name: z.string().min(1).max(160),
      url: z.string().url().optional(),
    }),
    license: z.string().max(80).optional(),
    homepageUrl: z.string().url().optional(),
    repositoryUrl: z.string().url().optional(),
    icon: z.string().max(500).optional(),
    runtime: z.object({ type: z.literal('builtin'), id: z.string().min(1).max(120) }).optional(),
    categories: z.array(z.string().min(1).max(80)).max(20).default([]),
    tags: z.array(z.string().min(1).max(80)).max(50).default([]),
    permissions: z
      .object({
        required: z.array(PluginPermissionSchema).max(32).default([]),
        optional: z.array(PluginPermissionSchema).max(32).default([]),
      })
      .refine((value) => new Set(value.required).size === value.required.length, {
        message: 'Duplicate required plugin permissions',
      }),
    activation: z.enum(['manual', 'on-startup', 'on-demand']).default('manual'),
    contributions: z
      .object({
        skills: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/),
              path: RelativePackagePathSchema,
              name: z.string().max(160).optional(),
              description: z.string().max(2_000).optional(),
            }),
          )
          .max(100)
          .default([]),
        mcpServers: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/),
              name: z.string().min(1).max(160),
              config: z.record(z.string(), z.unknown()),
              permissions: z.array(PluginPermissionSchema).max(32).optional(),
            }),
          )
          .max(50)
          .default([]),
        connectors: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,95}$/),
              manifest: ConnectorManifestSchema,
              permissions: z.array(PluginPermissionSchema).max(32).optional(),
            }),
          )
          .max(50)
          .default([]),
        runtimes: z.array(PluginRuntimeContributionSchema).max(50).optional(),
      })
      .default({ skills: [], mcpServers: [], connectors: [] }),
  })
  .superRefine((manifest, ctx) => {
    const declared = new Set([...manifest.permissions.required, ...manifest.permissions.optional])
    for (const server of manifest.contributions.mcpServers) {
      for (const permission of server.permissions ?? []) {
        if (!declared.has(permission)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contributions', 'mcpServers'],
            message: `MCP contribution requests undeclared permission: ${permission}`,
          })
        }
      }
    }
    for (const connector of manifest.contributions.connectors) {
      for (const permission of connector.permissions ?? []) {
        if (!declared.has(permission)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contributions', 'connectors'],
            message: `Connector contribution requests undeclared permission: ${permission}`,
          })
        }
      }
    }
  })

export interface PluginPermissionGrant {
  permission: PluginPermission
  state: 'granted' | 'denied' | 'pending'
  grantedAt?: string
}

export interface InstalledPluginItem {
  id: string
  version: string
  displayName: string
  description: string
  author: string
  icon?: string
  runtimeId?: string
  installPath: string
  source: 'bundled' | 'local' | 'marketplace'
  enabled: boolean
  state: 'installed' | 'blocked' | 'error'
  trust: 'bundled' | 'verified' | 'unverified' | 'blocked'
  integritySha256: string
  permissions: PluginPermissionGrant[]
  contributionCounts: {
    skills: number
    mcpServers: number
    connectors: number
    runtimes?: number
  }
  installedAt: string
  updatedAt: string
}

export interface PluginRuntimeStatus {
  runtimeId: string
  pluginId: string
  enabled: boolean
  state: 'installed' | 'blocked' | 'error'
  permissionsReady: boolean
}

export interface PluginInspection {
  manifest: PluginManifest
  sourcePath: string
  packageSha256: string
  files: number
  requiredPermissions: Array<{ permission: PluginPermission; risk: PluginPermissionRisk }>
  warnings: string[]
}

export interface PluginMarketplaceItem {
  marketplaceId: string
  id: string
  version: string
  displayName: string
  description: string
  author: string
  categories: string[]
  tags: string[]
  iconUrl?: string
  homepageUrl?: string
  manifestUrl: string
  packageUrl: string
  packageSha256: string
  requiredPermissions: PluginPermission[]
  signature?: string
  signingKey?: string
  trust: 'verified' | 'unverified'
  installed: boolean
  installedVersion?: string
}

export interface PluginMarketplace {
  id: string
  name: string
  description: string
  apiBaseUrl: string
  enabled: boolean
  configured: boolean
  trustedKeyFingerprints: string[]
  lastSyncAt?: string
  createdAt: string
  updatedAt: string
}

export interface PluginListRequest {
  includeDisabled?: boolean
}
export interface PluginListResponse {
  plugins: InstalledPluginItem[]
}
export interface PluginInspectLocalRequest {
  sourcePath: string
}
export interface PluginInspectLocalResponse {
  inspection: PluginInspection
}
export interface PluginInstallLocalRequest {
  sourcePath: string
  approvedPermissions: PluginPermission[]
  enable?: boolean
}
export interface PluginInstallLocalResponse {
  plugin: InstalledPluginItem
}
export interface PluginUninstallRequest {
  id: string
}
export interface PluginUninstallResponse {
  success: boolean
}
export interface PluginSetEnabledRequest {
  id: string
  enabled: boolean
}
export interface PluginSetEnabledResponse {
  plugin: InstalledPluginItem
}
export interface PluginSetPermissionRequest {
  id: string
  permission: PluginPermission
  state: 'granted' | 'denied'
}
export interface PluginSetPermissionResponse {
  plugin: InstalledPluginItem
}
export interface PluginMarketplaceListRequest {}
export interface PluginMarketplaceListResponse {
  marketplaces: PluginMarketplace[]
}
export interface PluginMarketplaceUpdateRequest {
  id: string
  enabled?: boolean
  apiBaseUrl?: string
  trustedKeyFingerprints?: string[]
}
export interface PluginMarketplaceUpdateResponse {
  marketplace: PluginMarketplace
}
export interface PluginMarketplaceSearchRequest {
  query: string
  marketplaceId?: string
  category?: string
  limit?: number
  offset?: number
}
export interface PluginMarketplaceSearchResponse {
  plugins: PluginMarketplaceItem[]
  total: number
}
export interface PluginMarketplaceInstallRequest {
  pluginId: string
  marketplaceId: string
  approvedPermissions: PluginPermission[]
  enable?: boolean
}
export interface PluginMarketplaceInstallResponse {
  plugin: InstalledPluginItem
}

export interface PluginIpcChannelMap {
  'plugin:list': [PluginListRequest, PluginListResponse]
  'plugin:inspect-local': [PluginInspectLocalRequest, PluginInspectLocalResponse]
  'plugin:install-local': [PluginInstallLocalRequest, PluginInstallLocalResponse]
  'plugin:uninstall': [PluginUninstallRequest, PluginUninstallResponse]
  'plugin:set-enabled': [PluginSetEnabledRequest, PluginSetEnabledResponse]
  'plugin:set-permission': [PluginSetPermissionRequest, PluginSetPermissionResponse]
  'plugin-marketplace:list': [PluginMarketplaceListRequest, PluginMarketplaceListResponse]
  'plugin-marketplace:update': [PluginMarketplaceUpdateRequest, PluginMarketplaceUpdateResponse]
  'plugin-marketplace:search': [PluginMarketplaceSearchRequest, PluginMarketplaceSearchResponse]
  'plugin-marketplace:install': [PluginMarketplaceInstallRequest, PluginMarketplaceInstallResponse]
}

const EmptySchema = z.object({}).strict()
const PermissionArraySchema = z.array(PluginPermissionSchema).max(32)

export const PluginIpcSchemaRegistry = {
  'plugin:list': z.object({ includeDisabled: z.boolean().optional() }).strict(),
  'plugin:inspect-local': z.object({ sourcePath: z.string().min(1).max(4_000) }).strict(),
  'plugin:install-local': z
    .object({
      sourcePath: z.string().min(1).max(4_000),
      approvedPermissions: PermissionArraySchema,
      enable: z.boolean().optional(),
    })
    .strict(),
  'plugin:uninstall': z.object({ id: PluginIdSchema }).strict(),
  'plugin:set-enabled': z.object({ id: PluginIdSchema, enabled: z.boolean() }).strict(),
  'plugin:set-permission': z
    .object({
      id: PluginIdSchema,
      permission: PluginPermissionSchema,
      state: z.enum(['granted', 'denied']),
    })
    .strict(),
  'plugin-marketplace:list': EmptySchema,
  'plugin-marketplace:update': z
    .object({
      id: z.string().min(1).max(120),
      enabled: z.boolean().optional(),
      apiBaseUrl: z.string().url().optional(),
      trustedKeyFingerprints: z
        .array(z.string().regex(/^[a-f0-9]{16,128}$/i))
        .max(20)
        .optional(),
    })
    .strict(),
  'plugin-marketplace:search': z
    .object({
      query: z.string().max(200),
      marketplaceId: z.string().min(1).max(120).optional(),
      category: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    })
    .strict(),
  'plugin-marketplace:install': z
    .object({
      pluginId: z.string().min(1).max(200),
      marketplaceId: z.string().min(1).max(120),
      approvedPermissions: PermissionArraySchema,
      enable: z.boolean().optional(),
    })
    .strict(),
} as const
