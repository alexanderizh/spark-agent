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
export const RuntimeConfigScopeSchema = z.enum(['system', 'agent', 'project', 'session'])
export const LocalSkillSourceSchema = z.enum(['claude', 'codex', 'agents', 'custom'])
export const SessionChatModeSchema = z.enum(['agent', 'ask', 'edit', 'review'])
export const SessionReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
export const SessionAgentAdapterSchema = z.enum(['claude', 'claude-sdk', 'codex'])
export const SessionPermissionModeSchema = z.enum([
  'claude-ask',
  'claude-auto-edits',
  'claude-plan',
  'claude-auto',
  'claude-bypass',
  'codex-default',
  'codex-auto-review',
  'codex-full-access',
])

// ─── Session Schema ───────────────────────────────────────────────────────────

export const SessionCreateRequestSchema = z.object({
  providerProfileId: ProfileIdSchema,
  modelId: z.string().min(1).max(200).optional(),
  agentAdapter: SessionAgentAdapterSchema.optional().default('codex'),
  permissionMode: SessionPermissionModeSchema.optional().default('codex-default'),
  chatMode: SessionChatModeSchema.optional().default('agent'),
  reasoningEffort: SessionReasoningEffortSchema.optional().default('medium'),
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
  limit: z.number().int().min(1).max(1000).optional().default(50),
  beforeSeq: z.number().int().nonnegative().optional(),
})

export const SessionSearchRequestSchema = z.object({
  query: z.string().min(1).max(200),
  workspaceId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

export const SessionListRequestSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
})

export const SessionUpdateRequestSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  providerProfileId: ProfileIdSchema.optional(),
  modelId: z.string().min(1).max(200).nullable().optional(),
  agentAdapter: SessionAgentAdapterSchema.optional(),
  permissionMode: SessionPermissionModeSchema.optional(),
  chatMode: SessionChatModeSchema.optional(),
  reasoningEffort: SessionReasoningEffortSchema.optional(),
})

export const SessionDeleteRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionSetMaxIterationsRequestSchema = z.object({
  sessionId: SessionIdSchema,
  maxIterations: z.number().int().min(1).max(1000).nullable(),
})

// ─── Provider Schema ──────────────────────────────────────────────────────────

const ProviderKindSchema = z.enum(['anthropic', 'openai', 'deepseek', 'ollama', 'openai-compatible'])

/**
 * 对 OpenAI 兼容后端而言，agent 可以使用两种 API：
 *   - 'chat'      使用传统 chat.completions（最广兼容性，DeepSeek/Ollama/智谱等）
 *   - 'responses' 使用 OpenAI Responses API（gpt-5-codex 等需要，支持 reasoning items 持久化、原生 apply_patch）
 *
 * 默认 'chat'。仅在 provider 是 'openai' 时切换到 'responses' 才有意义。
 */
export const CodexApiKindSchema = z.enum(['chat', 'responses']).optional()

export const ProviderCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  provider: ProviderKindSchema,
  defaultModel: z.string().min(1).max(200).optional(),
  modelIds: z.array(z.string().min(1).max(200)).max(200).optional(),
  model: z.string().min(1).max(200).optional(),
  apiEndpoint: z.string().min(1).max(500).optional(),
  apiKey: z.string().min(1).max(500),
  isDefault: z.boolean().optional().default(false),
  codexApiKind: CodexApiKindSchema,
}).superRefine((value, ctx) => {
  if ((value.defaultModel ?? value.model)?.trim().length) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'defaultModel is required',
    path: ['defaultModel'],
  })
})

export const ProviderUpdateRequestSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().min(1).max(100).optional(),
  defaultModel: z.string().min(1).max(200).optional(),
  modelIds: z.array(z.string().min(1).max(200)).max(200).optional(),
  model: z.string().min(1).max(200).optional(),
  apiEndpoint: z.string().min(1).max(500).nullable().optional(),
  apiKey: z.string().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
  codexApiKind: CodexApiKindSchema,
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

export const WorkspaceListBranchesRequestSchema = z.object({
  workspaceId: z.string().uuid(),
})

export const WorkspaceSwitchBranchRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  branch: z.string().min(1).max(200),
})

export const WorkspaceListRequestSchema = z.object({
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(200).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
})

export const WorkspaceUpdateRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
})

export const WorkspaceDeleteRequestSchema = z.object({
  workspaceId: z.string().uuid(),
})

export const WorkspaceOpenFolderRequestSchema = z.object({
  workspaceId: z.string().uuid(),
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

export const RulesComposeRequestSchema = z.object({
  scopes: z.array(RuleScopeSchema).optional(),
  scopeRefs: z.record(RuleScopeSchema, z.string()).optional(),
  conflictStrategy: z.enum(['override', 'merge']).optional(),
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
  'session:list': SessionListRequestSchema,
  'session:search': SessionSearchRequestSchema,
  'session:update': SessionUpdateRequestSchema,
  'session:delete': SessionDeleteRequestSchema,
  'session:set-max-iterations': SessionSetMaxIterationsRequestSchema,
  'provider:create': ProviderCreateRequestSchema,
  'provider:update': ProviderUpdateRequestSchema,
  'provider:delete': ProviderDeleteRequestSchema,
  'workspace:open': WorkspaceOpenRequestSchema,
  'workspace:get-current': z.object({}),
  'workspace:list': WorkspaceListRequestSchema,
  'workspace:update': WorkspaceUpdateRequestSchema,
  'workspace:delete': WorkspaceDeleteRequestSchema,
  'workspace:open-folder': WorkspaceOpenFolderRequestSchema,
  'workspace:close': z.object({ workspaceId: z.string().uuid() }),
  'workspace:list-directory': WorkspaceListDirectoryRequestSchema,
  'workspace:list-branches': WorkspaceListBranchesRequestSchema,
  'workspace:switch-branch': WorkspaceSwitchBranchRequestSchema,
  'workspace:watch-start': z.object({
    workspaceId: z.string().min(1),
    ignorePatterns: z.array(z.string()).optional(),
  }),
  'workspace:watch-stop': z.object({
    workspaceId: z.string().min(1),
  }),
  'dialog:open-directory': DialogOpenDirectoryRequestSchema,
  'rules:list': RulesListRequestSchema,
  'rules:create': RulesCreateRequestSchema,
  'rules:update': RulesUpdateRequestSchema,
  'rules:delete': RulesDeleteRequestSchema,
  'rules:compose': RulesComposeRequestSchema,
  'permission:list-profiles': z.object({}),
  'permission:create-profile': z.object({ name: z.string().min(1).max(80), sandboxLevel: z.number().int().min(0).max(4).optional() }),
  'permission:delete-profile': z.object({ id: z.string().min(1) }),
  'permission:update-sandbox': z.object({ profileId: z.string().min(1), sandboxLevel: z.number().int().min(0).max(4) }),
  'permission:update-rule': z.object({ profileId: z.string().min(1), action: z.string().min(1), mode: z.enum(['allow', 'ask', 'ask-twice', 'deny']) }),
  'permission:approval-respond': z.object({ requestId: z.string().min(1), decision: z.enum(['allow-once', 'allow-session', 'deny']) }),
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
    manifestJson: z.string().min(2).max(500_000),
    enabled: z.boolean().optional(),
  }),
  'skill:update': z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(120).optional(),
    version: z.string().min(1).max(80).optional(),
    rootPath: z.string().min(1).max(500).optional(),
    manifestJson: z.string().min(2).max(500_000).optional(),
    enabled: z.boolean().optional(),
  }),
  'skill:delete': z.object({ id: z.string().min(1).max(120) }),
  'skill:detail': z.object({ id: z.string().min(1).max(120) }),
  'skill:toggle': z.object({ id: z.string().min(1).max(120) }),
  'skill:search': z.object({ query: z.string().min(0).max(200) }),
  'skill:execute': z.object({
    skillId: z.string().min(1).max(120),
    params: z.record(z.unknown()).optional(),
  }),
  'skill:detect-local': z.object({
    searchRoots: z.array(z.string().min(1).max(1000)).max(20).optional(),
  }),
  'skill:import-directory': z.object({
    directoryPath: z.string().min(1).max(1000),
    source: LocalSkillSourceSchema.optional(),
  }),
  'skill:import-batch-local': z.object({
    candidates: z.array(z.object({
      rootPath: z.string().min(1).max(1000),
      source: LocalSkillSourceSchema,
    })).min(1).max(100),
  }),
  'skill-config:get': z.object({
    workspaceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
  }),
  'skill-config:update': z.object({
    scope: z.enum(['agent', 'project', 'session']),
    scopeRef: z.string().min(1).max(300),
    skillIds: z.array(z.string().min(1).max(160)).max(200),
    disabledSkillIds: z.array(z.string().min(1).max(160)).max(200).optional(),
  }),
  'prompt-config:get': z.object({
    workspaceId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
  }),
  'prompt-config:update': z.object({
    scope: RuntimeConfigScopeSchema,
    scopeRef: z.string().min(1).max(300).optional(),
    value: z.object({
      enabled: z.boolean(),
      content: z.string().max(200_000),
    }),
  }),
  'settings:get': z.object({
    category: z.string().min(1).max(80),
    key: z.string().min(1).max(200),
  }),
  'settings:set': z.object({
    category: z.string().min(1).max(80),
    key: z.string().min(1).max(200),
    value: z.unknown(),
  }),
  'settings:get-category': z.object({
    category: z.string().min(1).max(80),
  }),
  'settings:get-all': z.object({}),

  // Usage Ledger
  'usage:record': z.object({
    sessionId: z.string().min(1),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cacheReadTokens: z.number().int().min(0).optional(),
    cacheWriteTokens: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
    requestTimestamp: z.string().optional(),
  }),
  'usage:get-session': z.object({
    sessionId: z.string().min(1),
  }),
  'usage:get-dashboard': z.object({}),
  'usage:get-by-date-range': z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  }),
  'usage:purge': z.object({
    olderThanDays: z.number().int().min(1),
  }),

  // Auto-Update
  'update:check': z.object({}),
  'update:download': z.object({}),
  'update:install-restart': z.object({}),
  'update:get-status': z.object({}),
  'update:settings': z.object({
    autoCheck: z.boolean().optional(),
    autoDownload: z.boolean().optional(),
    channel: z.enum(['stable', 'beta']).optional(),
  }),

  // SDK Integrity
  'sdk:integrity-check': z.object({
    checkLatest: z.boolean().optional(),
  }),
  'sdk:integrity-install': z.object({
    packageName: z.string().min(1).max(200),
  }),
} as const
