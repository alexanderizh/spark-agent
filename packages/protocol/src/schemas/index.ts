/**
 * @module schemas
 *
 * Spark Agent Zod Schema 基础设施
 *
 * 为 IPC 层的 payload 校验提供 zod schema
 * P0-07 中旭阳-高级开发将在 IPC handler 中使用这些 schema 做运行时校验
 */

import { z } from 'zod'

// ─── 基础 Schema ─────────────────────────────────────────────────────────────

export const SessionIdSchema = z.string().uuid()
export const TurnIdSchema = z.string().uuid()
export const ProfileIdSchema = z.string().uuid()
export const RuleIdSchema = z.string().uuid()

export const RuleScopeSchema = z.enum(['system', 'team', 'user', 'project', 'session'])

// ─── Session Schema ───────────────────────────────────────────────────────────

export const SessionCreateRequestSchema = z.object({
  providerProfileId: ProfileIdSchema,
  title: z.string().max(200).optional(),
  workspaceId: z.string().uuid().optional(),
})

export const SessionSendTurnRequestSchema = z.object({
  sessionId: SessionIdSchema,
  message: z.string().min(1).max(100_000),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file']),
        path: z.string().min(1),
      }),
    )
    .max(20)
    .optional(),
})

export const SessionCancelRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionGetHistoryRequestSchema = z.object({
  sessionId: SessionIdSchema,
  limit: z.number().int().min(1).max(200).optional().default(50),
  beforeSeq: z.number().int().nonnegative().optional(),
})

// ─── Provider Schema ──────────────────────────────────────────────────────────

export const ProviderCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.enum(['anthropic', 'openai']),
  defaultModel: z.string().min(1).max(200),
  modelIds: z.array(z.string().min(1).max(200)).max(200).optional(),
  apiEndpoint: z.string().min(1).max(500).optional(),
  apiKey: z.string().min(1).max(500),
  isDefault: z.boolean().optional().default(false),
})

export const ProviderUpdateRequestSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().min(1).max(100).optional(),
  defaultModel: z.string().min(1).max(200).optional(),
  modelIds: z.array(z.string().min(1).max(200)).max(200).optional(),
  apiEndpoint: z.string().min(1).max(500).nullable().optional(),
  apiKey: z.string().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
})

export const ProviderDeleteRequestSchema = z.object({
  id: ProfileIdSchema,
})

// ─── Workspace Schema ─────────────────────────────────────────────────────────

export const WorkspaceOpenRequestSchema = z.object({
  rootPath: z.string().optional(),
  create: z
    .object({
      name: z.string().min(1).max(200),
      rootPath: z.string().min(1),
    })
    .optional(),
})

export const WorkspaceListDirectoryRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().max(500).optional().default(''),
  maxDepth: z.number().int().min(0).max(5).optional().default(3),
})

export const DialogOpenDirectoryRequestSchema = z.object({
  title: z.string().max(200).optional(),
  defaultPath: z.string().optional(),
})

// ─── Rules Schema ────────────────────────────────────────────────────────────

export const RulesListRequestSchema = z.object({
  scope: RuleScopeSchema.optional(),
  scopeRef: z.string().min(1).max(200).optional(),
})

export const RulesCreateRequestSchema = z.object({
  scope: RuleScopeSchema,
  scopeRef: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(120),
  content: z.string().min(1).max(20_000),
  priority: z.number().int().min(-10_000).max(10_000).optional().default(0),
  enabled: z.boolean().optional().default(true),
})

export const RulesUpdateRequestSchema = z.object({
  id: RuleIdSchema,
  name: z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(20_000).optional(),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
  enabled: z.boolean().optional(),
})

export const RulesDeleteRequestSchema = z.object({
  id: RuleIdSchema,
})

/**
 * IPC Schema 注册表
 *
 * P0-07 中的 handle 封装会用此表自动校验每个 channel 的 request payload
 */
export const IpcSchemaRegistry = {
  'session:create': SessionCreateRequestSchema,
  'session:send-turn': SessionSendTurnRequestSchema,
  'session:cancel': SessionCancelRequestSchema,
  'session:get-history': SessionGetHistoryRequestSchema,
  'provider:create': ProviderCreateRequestSchema,
  'provider:update': ProviderUpdateRequestSchema,
  'provider:delete': ProviderDeleteRequestSchema,
  'workspace:open': WorkspaceOpenRequestSchema,
  'workspace:get-current': z.object({}),
  'workspace:close': z.object({ workspaceId: z.string().uuid() }),
  'workspace:list-directory': WorkspaceListDirectoryRequestSchema,
  'dialog:open-directory': DialogOpenDirectoryRequestSchema,
  'rules:list': RulesListRequestSchema,
  'rules:create': RulesCreateRequestSchema,
  'rules:update': RulesUpdateRequestSchema,
  'rules:delete': RulesDeleteRequestSchema,
  'permission:list-profiles': z.object({}),
  'permission:create-profile': z.object({ name: z.string().min(1).max(80), sandboxLevel: z.number().int().min(0).max(4).optional() }),
  'permission:delete-profile': z.object({ id: z.string().min(1) }),
  'permission:update-sandbox': z.object({ profileId: z.string().min(1), sandboxLevel: z.number().int().min(0).max(4) }),
  'permission:update-rule': z.object({ profileId: z.string().min(1), action: z.string().min(1), mode: z.enum(['allow', 'ask', 'ask-twice', 'deny']) }),
  'model:list': z.object({ providerId: z.string().uuid().optional() }),
  'model:create': z.object({ providerId: z.string().uuid(), name: z.string().min(1).max(200), configJson: z.string().optional() }),
  'model:update': z.object({ id: z.string().uuid(), name: z.string().min(1).max(200).optional(), configJson: z.string().optional(), enabled: z.boolean().optional() }),
  'model:delete': z.object({ id: z.string().uuid() }),
  'mcp:list': z.object({ scope: z.string().min(1).max(80).optional() }),
  'mcp:create': z.object({
    scope: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    configJson: z.string().min(2).max(20_000),
    enabled: z.boolean().optional(),
  }),
  'mcp:update': z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    configJson: z.string().min(2).max(20_000).optional(),
    enabled: z.boolean().optional(),
  }),
  'mcp:delete': z.object({ id: z.string().uuid() }),
  'skill:list': z.object({ scope: z.string().min(1).max(80).optional() }),
  'skill:create': z.object({
    id: z.string().min(1).max(120),
    scope: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    rootPath: z.string().min(1).max(500),
    manifestJson: z.string().min(2).max(20_000),
    enabled: z.boolean().optional(),
  }),
  'skill:update': z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(120).optional(),
    version: z.string().min(1).max(80).optional(),
    rootPath: z.string().min(1).max(500).optional(),
    manifestJson: z.string().min(2).max(20_000).optional(),
    enabled: z.boolean().optional(),
  }),
  'skill:delete': z.object({ id: z.string().min(1).max(120) }),
} as const
