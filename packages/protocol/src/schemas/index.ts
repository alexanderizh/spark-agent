/**
 * @module schemas
 *
 * Spark Agent Zod Schema 基础设施
 *
 * 为 IPC 层的 payload 校验提供 zod schema
 * P0-07 中旭阳-高级开发将在 IPC handler 中使用这些 schema 做运行时校验
 */

import { z } from 'zod'
import {
  ProviderExportPayloadSchema,
  ProviderImportModeSchema,
} from '../provider-export.js'
import { LOCAL_CLI_PROVIDER_ID, LOCAL_CODEX_CLI_PROVIDER_ID } from '../local-cli-provider.js'

// ─── 基础 Schema ─────────────────────────────────────────────────────────────

export const SessionIdSchema = z.string().uuid()
export const TurnIdSchema = z.string().uuid()
export const ProfileIdSchema = z.union([
  z.string().uuid(),
  z.literal(LOCAL_CLI_PROVIDER_ID),
  z.literal(LOCAL_CODEX_CLI_PROVIDER_ID),
])
export const RuleIdSchema = z.string().uuid()

export const RuleScopeSchema = z.enum(['system', 'team', 'user', 'project', 'session'])
export const RuntimeConfigScopeSchema = z.enum(['system', 'agent', 'project', 'session'])
export const LocalSkillSourceSchema = z.enum(['claude', 'codex', 'agents', 'bundled', 'linked', 'custom'])
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
export const RemoteChannelTypeSchema = z.enum(['telegram', 'feishu', 'qq', 'wechat-claw'])
export const RemotePairingModeSchema = z.enum(['code', 'qr'])

const RemoteCredentialsSchema = z.object({
  botToken: z.string().max(400).optional(),
  appId: z.string().max(200).optional(),
  appSecret: z.string().max(400).optional(),
  webhookUrl: z.string().max(2000).optional(),
  qqBotAppId: z.string().max(200).optional(),
  qqBotToken: z.string().max(400).optional(),
  qqBotSecret: z.string().max(400).optional(),
  clawEndpoint: z.string().max(2000).optional(),
  clawAccessToken: z.string().max(400).optional(),
})

const RemoteCapabilitiesSchema = z.object({
  sendMessages: z.boolean(),
  switchModel: z.boolean(),
  switchSession: z.boolean(),
  switchAgent: z.boolean(),
  manageWorkspace: z.boolean(),
  runCommands: z.boolean(),
  approvePermissions: z.boolean(),
})

const RemoteConnectionPatchSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  channel: RemoteChannelTypeSchema,
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  status: z.enum(['disabled', 'draft', 'pending-pairing', 'connected', 'error']).optional(),
  credentials: RemoteCredentialsSchema.optional(),
  commandPrefix: z.string().min(1).max(4).optional(),
  allowedUserIds: z.array(z.string().min(1).max(160)).max(200).optional(),
  allowedChatIds: z.array(z.string().min(1).max(160)).max(200).optional(),
  defaultSessionId: z.string().min(1).max(160).optional(),
  defaultProviderProfileId: z.string().min(1).max(160).optional(),
  defaultModelId: z.string().min(1).max(200).optional(),
  defaultAgentId: z.string().min(1).max(160).optional(),
  telegramCommands: z.array(z.string().min(1).max(80)).max(80).optional(),
  capabilities: RemoteCapabilitiesSchema.optional(),
})

// ─── Team Mode Schema ─────────────────────────────────────────────────────────

export const TeamModeConfigSchema = z.object({
  enabled: z.boolean(),
  hostAgentId: z.string().min(1).max(160),
  memberAgentIds: z.array(z.string().min(1).max(160)).max(20),
  maxDepth: z.number().int().min(1).max(3),
  allowNesting: z.boolean(),
  /** 来源长期团队 ID，可选 */
  teamId: z.string().min(1).max(160).optional(),
})

// ── 长期团队定义（agent_teams）CRUD 请求 ────────────────────────────────────
export const TeamListDefsRequestSchema = z.object({
  includeDisabled: z.boolean().optional(),
})

export const TeamGetDefRequestSchema = z.object({
  id: z.string().min(1).max(160),
})

const TeamDefBaseFields = {
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  hostAgentId: z.string().min(1).max(160),
  memberAgentIds: z.array(z.string().min(1).max(160)).max(20).optional(),
  maxDepth: z.number().int().min(1).max(3).optional(),
  allowNesting: z.boolean().optional(),
  prompt: z.string().max(8_000).optional(),
  enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}

export const TeamCreateDefRequestSchema = z.object(TeamDefBaseFields)

export const TeamUpdateDefRequestSchema = z.object({
  id: z.string().min(1).max(160),
  name: TeamDefBaseFields.name.optional(),
  description: TeamDefBaseFields.description,
  hostAgentId: TeamDefBaseFields.hostAgentId.optional(),
  memberAgentIds: TeamDefBaseFields.memberAgentIds,
  maxDepth: TeamDefBaseFields.maxDepth,
  allowNesting: TeamDefBaseFields.allowNesting,
  prompt: TeamDefBaseFields.prompt,
  enabled: TeamDefBaseFields.enabled,
  metadata: TeamDefBaseFields.metadata,
})

export const TeamDeleteDefRequestSchema = z.object({
  id: z.string().min(1).max(160),
})

export const TeamUpdateRequestSchema = z.object({
  sessionId: SessionIdSchema,
  config: TeamModeConfigSchema,
})

export const TeamListMembersRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const TeamListDispatchesRequestSchema = z.object({
  sessionId: SessionIdSchema,
  turnId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
})

// ─── Session Schema ───────────────────────────────────────────────────────────

export const SessionCreateRequestSchema = z.object({
  providerProfileId: ProfileIdSchema,
  modelId: z.string().min(1).max(200).optional(),
  agentId: z.string().min(1).max(160).optional(),
  agentAdapter: SessionAgentAdapterSchema.optional(),
  permissionMode: SessionPermissionModeSchema.optional(),
  chatMode: SessionChatModeSchema.optional().default('agent'),
  reasoningEffort: SessionReasoningEffortSchema.optional().default('medium'),
  title: z.string().max(200).optional(),
  workspaceId: z.string().uuid().optional(),
})

export const SessionSendTurnRequestSchema = z.object({
  sessionId: SessionIdSchema,
  message: z.string().min(1).max(100_000),
  providerProfileId: ProfileIdSchema.optional(),
  modelId: z.string().min(1).max(200).nullable().optional(),
  agentId: z.string().min(1).max(160).optional(),
  agentAdapter: SessionAgentAdapterSchema.optional(),
  permissionMode: SessionPermissionModeSchema.optional(),
  chatMode: SessionChatModeSchema.optional(),
  reasoningEffort: SessionReasoningEffortSchema.optional(),
  skillId: z.string().min(1).max(160).optional(),
  skillParams: z.record(z.string(), z.unknown()).optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file']),
        path: z.string().min(1),
      }),
    )
    .max(20)
    .optional(),
  teamConfig: TeamModeConfigSchema.optional(),
  mentionAgentId: z.string().min(1).max(160).optional(),
})

export const DialogOpenDirectoryRequestSchema = z.object({
  title: z.string().max(200).optional(),
  defaultPath: z.string().optional(),
})

export const DialogOpenFileRequestSchema = z.object({
  title: z.string().max(200).optional(),
  defaultPath: z.string().optional(),
  multiple: z.boolean().optional(),
  filters: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        extensions: z.array(z.string().min(1).max(32)).min(1).max(50),
      }),
    )
    .max(20)
    .optional(),
})

export const FileSavePastedImageRequestSchema = z.object({
  dataUrl: z.string().min(1).max(40_000_000),
  mimeType: z.string().min(1).max(120).optional(),
  suggestedBaseName: z.string().min(1).max(120).optional(),
})

export const FilePrepareImagePreviewRequestSchema = z.object({
  sourcePath: z.string().min(1),
})

export const SessionCancelRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionGetQueueRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionCancelQueuedTurnRequestSchema = z.object({
  sessionId: SessionIdSchema,
  turnId: z.string().uuid(),
})

export const SessionGetHistoryRequestSchema = z.object({
  sessionId: SessionIdSchema,
  full: z.boolean().optional().default(false),
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
  agentId: z.string().min(1).max(160).optional(),
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

export const ProviderModelTypeSchema = z.enum(['image', 'text', 'multimodal', 'voice', 'video'])
export type ProviderModelType = z.infer<typeof ProviderModelTypeSchema>
export const ImageGenApiTypeSchema = z.enum(['sync', 'async', 'auto'])

export const ProviderCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  provider: ProviderKindSchema,
  defaultModel: z.string().min(1).max(200).optional(),
  modelIds: z.array(z.string().min(1).max(200)).max(200).optional(),
  model: z.string().min(1).max(200).optional(),
  apiEndpoint: z.string().min(1).max(500).optional(),
  apiKey: z.string().min(1).max(500),
  isDefault: z.boolean().optional().default(false),
  supportsMillionContext: z.boolean().optional().default(false),
  /** 子 agent 默认走 Haiku 档；可选。留空则回落 defaultModel。 */
  haikuModel: z.string().min(1).max(200).optional(),
  /** 主对话档；可选。留空则回落 defaultModel。 */
  sonnetModel: z.string().min(1).max(200).optional(),
  /** Plan/Review 等高能力 agent；可选。留空则回落 defaultModel。 */
  opusModel: z.string().min(1).max(200).optional(),
  /** 模型能力类型 */
  modelType: ProviderModelTypeSchema.optional().default('multimodal'),
  /** 图片模型供应商类型 */
  imageProvider: z.string().min(1).max(80).nullable().optional(),
  /** 图片模型调用方式 */
  imageApiType: ImageGenApiTypeSchema.nullable().optional(),
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
  supportsMillionContext: z.boolean().optional(),
  /** 传 null 清除该档自定义；string 设置；undefined 不修改 */
  haikuModel: z.string().min(1).max(200).nullable().optional(),
  sonnetModel: z.string().min(1).max(200).nullable().optional(),
  opusModel: z.string().min(1).max(200).nullable().optional(),
  /** 模型能力类型 */
  modelType: ProviderModelTypeSchema.optional(),
  /** 图片模型供应商类型 */
  imageProvider: z.string().min(1).max(80).nullable().optional(),
  /** 图片模型调用方式 */
  imageApiType: ImageGenApiTypeSchema.nullable().optional(),
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
  'session:get-queue': SessionGetQueueRequestSchema,
  'session:cancel-queued-turn': SessionCancelQueuedTurnRequestSchema,
  'session:cancel': SessionCancelRequestSchema,
  'session:get-history': SessionGetHistoryRequestSchema,
  'session:list': SessionListRequestSchema,
  'session:search': SessionSearchRequestSchema,
  'session:update': SessionUpdateRequestSchema,
  'session:delete': SessionDeleteRequestSchema,
  'session:set-max-iterations': SessionSetMaxIterationsRequestSchema,
  // Team Mode
  'team:update': TeamUpdateRequestSchema,
  'team:list-members': TeamListMembersRequestSchema,
  'team:list-dispatches': TeamListDispatchesRequestSchema,
  'team:list-defs': TeamListDefsRequestSchema,
  'team:get-def': TeamGetDefRequestSchema,
  'team:create-def': TeamCreateDefRequestSchema,
  'team:update-def': TeamUpdateDefRequestSchema,
  'team:delete-def': TeamDeleteDefRequestSchema,
  'provider:create': ProviderCreateRequestSchema,
  'provider:update': ProviderUpdateRequestSchema,
  'provider:delete': ProviderDeleteRequestSchema,
  // Provider 导入/导出 schema
  'provider:export': z.object({ ids: z.array(z.string().min(1).max(200)).max(500) }),
  'provider:import': z.object({ payload: ProviderExportPayloadSchema, mode: ProviderImportModeSchema }),
  'provider:export-to-file': z.object({ ids: z.array(z.string().min(1).max(200)).max(500) }),
  'provider:import-from-file': z.object({}),
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
  'dialog:open-file': DialogOpenFileRequestSchema,
  'file:save-pasted-image': FileSavePastedImageRequestSchema,
  'file:prepare-image-preview': FilePrepareImagePreviewRequestSchema,
  'app:get-startup-settings': z.object({}),
  'app:set-startup-settings': z.object({
    openAtLogin: z.boolean(),
    openAsHidden: z.boolean().optional(),
  }),
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
  'permission:set-active-profile': z.object({ profileId: z.string().min(1) }),
  'permission:approval-respond': z.object({
    requestId: z.string().min(1),
    decision: z.enum(['allow-once', 'allow-session', 'allow-project', 'allow-global', 'deny', 'deny-project', 'deny-global']),
  }),
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
  'skill:import-file': z.object({
    filePath: z.string().min(1).max(1000),
  }),
  'skill:export': z.object({}),
  'skill:export-batch': z.object({}),
  'skill:install-to-app': z.object({
    sourcePath: z.string().min(1).max(2000),
  }),
  'skill:uninstall-from-app': z.object({
    name: z.string().min(1).max(200),
  }),
  'skill:link': z.object({
    targetPath: z.string().min(1).max(2000),
    name: z.string().min(1).max(200).optional(),
  }),
  'skill:unlink': z.object({
    name: z.string().min(1).max(200),
  }),
  'skill:app-paths': z.object({}),
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

  // Remote Connections
  'remote:list': z.object({}),
  'remote:save': z.object({
    connection: RemoteConnectionPatchSchema,
  }),
  'remote:delete': z.object({
    id: z.string().min(1).max(160),
  }),
  'remote:test': z.object({
    id: z.string().min(1).max(160),
  }),
  'remote:create-bot-draft': z.object({
    channel: RemoteChannelTypeSchema,
    name: z.string().min(1).max(120).optional(),
    openConsole: z.boolean().optional(),
  }),
  'remote:generate-pairing': z.object({
    id: z.string().min(1).max(160),
    mode: RemotePairingModeSchema,
  }),
  'remote:confirm-pairing': z.object({
    id: z.string().min(1).max(160),
    code: z.string().min(4).max(20),
    remoteUserId: z.string().min(1).max(160),
    displayName: z.string().max(160).optional(),
    channelThreadId: z.string().max(160).optional(),
  }),
  'remote:command-catalog': z.object({}),
  'remote:execute-command': z.object({
    id: z.string().min(1).max(160),
    message: z.string().min(1).max(20_000),
    sessionId: z.string().min(1).max(160).optional(),
  }),
  'remote:runtime-status': z.object({}),

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
    autoInstall: z.boolean().optional(),
    channel: z.enum(['stable', 'beta']).optional(),
  }),

  // SDK Integrity
  'sdk:integrity-check': z.object({
    checkLatest: z.boolean().optional(),
  }),
  'sdk:integrity-install': z.object({
    packageName: z.string().min(1).max(200),
  }),

  // Playwright Browser Automation
  'playwright:status': z.object({}),
  'playwright:install': z.object({
    target: z.enum(['mcp', 'browser']),
  }),
  'playwright:reset-config': z.object({}),
  'playwright:set-mode': z.object({
    /** "headful" shows the embedded browser window; "headless" runs invisibly. */
    mode: z.enum(['headful', 'headless']),
  }),
  'playwright:set-enabled': z.object({
    enabled: z.boolean(),
  }),
  'playwright:open-view': z.object({
    url: z.string().min(1).max(2000).optional(),
  }),
  'playwright:close-view': z.object({}),
  'playwright:capture-view': z.object({}),

  // ─── Cloud Auth ────────────────────────────────────────────────────────
  'auth:captcha': z.object({
    fresh: z.boolean().optional(),
  }),
  'auth:send-code': z.object({
    account: z.string().min(1).max(200),
    type: z.enum(['register', 'login']),
    captchaId: z.string().min(1),
    captchaText: z.string().min(1).max(20),
  }),
  'auth:register': z.object({
    account: z.string().min(1).max(200),
    password: z.string().min(6).max(100),
    code: z.string().min(1).max(20),
    inviteCode: z.string().min(1).max(100).optional(),
  }),
  'auth:login': z.object({
    account: z.string().min(1).max(200),
    loginMode: z.enum(['password', 'code']),
    password: z.string().min(1).max(100).optional(),
    captchaId: z.string().min(1).max(100).optional(),
    captchaText: z.string().min(1).max(20).optional(),
    emailCode: z.string().min(1).max(20).optional(),
  }),
  'auth:refresh': z.object({
    refreshToken: z.string().min(1).optional(),
  }),
  'auth:logout': z.object({}),
  'auth:me': z.object({}),
  'auth:bind-status': z.object({}),
  'auth:change-password': z.object({
    oldPassword: z.string().min(1).max(100),
    newPassword: z.string().min(6).max(100),
  }),
  'auth:wechat-qr': z.object({}),
  'auth:wechat-poll': z.object({
    state: z.string().min(1).max(200),
  }),
  'auth:wechat-bind-email-send-code': z.object({
    bindSession: z.string().min(1).max(200),
    email: z.string().email().max(200),
    captchaId: z.string().min(1).max(100),
    captchaText: z.string().min(1).max(20),
  }),
  'auth:wechat-bind-email': z.object({
    bindSession: z.string().min(1).max(200),
    code: z.string().min(1).max(20),
  }),
  'auth:set-base-url': z.object({
    baseUrl: z.string().max(500),
  }),
  'auth:get-base-url': z.object({}),
  'auth:bootstrap': z.object({}),
} as const
