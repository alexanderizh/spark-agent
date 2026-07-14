/**
 * @module schemas
 *
 * Spark Agent Zod Schema 基础设施
 *
 * 为 IPC 层的 payload 校验提供 zod schema
 * P0-07 中旭阳-高级开发将在 IPC handler 中使用这些 schema 做运行时校验
 */

import { z } from 'zod'
import { ProviderExportPayloadSchema, ProviderImportModeSchema } from '../provider-export.js'
import {
  MediaProviderKindSchema,
  MediaApiTypeSchema,
  MediaCapabilityIdSchema,
  ProviderMediaDefaultsSchema,
} from '../media-config.js'
import { ProviderMediaModelRefSchema, MediaModelManifestSchema } from '../media-model-manifest.js'
import { LOCAL_CLI_PROVIDER_ID, LOCAL_CODEX_CLI_PROVIDER_ID } from '../local-cli-provider.js'
import { CLAUDE_AUTO_ROUTER_PROVIDER_ID, CODEX_AUTO_ROUTER_PROVIDER_ID } from '../auto-router-provider.js'

const PLATFORM_NEWAPI_PROVIDER_ID = 'spark-platform-newapi'

// ─── 基础 Schema ─────────────────────────────────────────────────────────────

export const SessionIdSchema = z.string().uuid()
export const TurnIdSchema = z.string().uuid()
export const ProfileIdSchema = z.union([
  z.string().uuid(),
  z.literal(LOCAL_CLI_PROVIDER_ID),
  z.literal(LOCAL_CODEX_CLI_PROVIDER_ID),
  z.literal(CLAUDE_AUTO_ROUTER_PROVIDER_ID),
  z.literal(CODEX_AUTO_ROUTER_PROVIDER_ID),
  z.literal(PLATFORM_NEWAPI_PROVIDER_ID),
])
export const RuleIdSchema = z.string().uuid()

export const RuleScopeSchema = z.enum(['system', 'team', 'user', 'project', 'session'])
export const RuntimeConfigScopeSchema = z.enum(['system', 'agent', 'project', 'session'])
export const LocalSkillSourceSchema = z.enum([
  'claude',
  'codex',
  'agents',
  'bundled',
  'linked',
  'custom',
])
export const SessionChatModeSchema = z.enum(['agent', 'ask', 'edit', 'review'])
export const SessionReasoningEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
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
  observeDesktop: z.boolean().optional(),
  controlDesktop: z.boolean().optional(),
  useInternalBrowser: z.boolean().optional(),
  transferFiles: z.boolean().optional(),
  manageRuntime: z.boolean().optional(),
  dangerousActions: z.boolean().optional(),
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
  /** 团队讨论最大轮数，缺省 6，硬上限 20（后端会在写入时再兜底一次） */
  maxDiscussionRounds: z.number().int().min(1).max(20).optional(),
  /** 是否允许成员间对等消息（缺省 false 灰度，老会话零迁移兼容） */
  enablePeerMessaging: z.boolean().optional(),
  /** 注入成员/被 @ agent 的共享讨论快照 token 预算，缺省 6000。
   *  调大可让成员一次看到更多历史正文（代价是每次执行吃更多上下文）；全文始终可用
   *  team_thread_read 工具按需读取，故预算只影响「默认注入多少」。 */
  threadContextTokenBudget: z.number().int().min(500).max(40000).optional(),
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
  maxDiscussionRounds: z.number().int().min(1).max(20).optional(),
  enablePeerMessaging: z.boolean().optional(),
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
  maxDiscussionRounds: TeamDefBaseFields.maxDiscussionRounds,
  enablePeerMessaging: TeamDefBaseFields.enablePeerMessaging,
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
  reasoningEffort: SessionReasoningEffortSchema.optional().default('max'),
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
        type: z.enum(['image', 'file', 'directory']),
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
  allowDirectories: z.boolean().optional(),
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
  storageScope: z.enum(['temp', 'canvas']).optional(),
  projectRootPath: z.string().min(1).max(2000).optional(),
})

export const FilePrepareImagePreviewRequestSchema = z.object({
  sourcePath: z.string().min(1),
})

export const FileStatKindRequestSchema = z.object({
  path: z.string().min(1),
})

export const ClipboardWriteTextRequestSchema = z.object({
  text: z.string().max(10_000_000),
})

export const SessionCancelRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionRejectPlanRequestSchema = z.object({
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
  turnLimit: z.number().int().min(1).max(500).optional(),
  eventLimit: z.number().int().min(100).max(10_000).optional(),
  beforeSeq: z.number().int().nonnegative().optional(),
})

export const SessionSearchRequestSchema = z.object({
  query: z.string().min(1).max(200),
  workspaceId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

export const SessionListCheckpointsRequestSchema = z.object({
  sessionId: SessionIdSchema,
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
  debugMode: z.boolean().optional(),
})

export const SessionDeleteRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionSetMaxIterationsRequestSchema = z.object({
  sessionId: SessionIdSchema,
  maxIterations: z.number().int().min(1).max(1000).nullable(),
})

const GoalBudgetSchema = z
  .object({
    maxIterations: z.number().int().min(1).max(500).optional(),
    maxRuntimeMinutes: z.number().int().min(1).max(10080).optional(),
    maxBudgetUsd: z.number().min(0).max(10000).optional(),
    maxConsecutiveFailures: z.number().int().min(1).max(50).optional(),
    noProgressLimit: z.number().int().min(1).max(50).optional(),
  })
  .optional()

const GoalValidationSchema = z
  .object({
    commands: z.array(z.string().min(1).max(500)).max(20).optional(),
    checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
  })
  .optional()

export const SessionSetGoalRequestSchema = z.object({
  sessionId: SessionIdSchema,
  objective: z.string().min(1).max(8000),
  successCriteria: z.array(z.string().min(1).max(1000)).max(50).optional(),
  constraints: z.array(z.string().min(1).max(1000)).max(50).optional(),
  validation: GoalValidationSchema,
  budget: GoalBudgetSchema,
  mode: z.enum(['spark-loop', 'codex-native', 'auto']).optional(),
})

export const SessionGetGoalRequestSchema = z.object({
  sessionId: SessionIdSchema,
})

export const SessionGoalControlRequestSchema = z.object({
  sessionId: SessionIdSchema,
  action: z.enum(['pause', 'resume', 'clear', 'complete']),
  summary: z.string().max(4000).optional(),
})

// ─── Provider Schema ──────────────────────────────────────────────────────────

const ProviderKindSchema = z.enum([
  'anthropic',
  'openai',
  'deepseek',
  'ollama',
  'openai-compatible',
])

export const ProviderModelTypeSchema = z.enum(['image', 'text', 'multimodal', 'voice', 'video'])
export type ProviderModelType = z.infer<typeof ProviderModelTypeSchema>
export const ImageGenApiTypeSchema = z.enum(['sync', 'async', 'auto'])
export const ProviderIconStyleSchema = z.enum(['avatar', 'mono'])
export const ProviderIconConfigSchema = z.object({
  id: z.string().min(1).max(80),
  style: ProviderIconStyleSchema.default('avatar'),
})

export const ProviderCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(100),
    provider: ProviderKindSchema,
    defaultModel: z.string().min(1).max(200).optional(),
    modelIds: z.array(z.string().min(1).max(200)).max(200).optional(),
    providerIcon: ProviderIconConfigSchema.optional(),
    model: z.string().min(1).max(200).optional(),
    apiEndpoint: z.string().min(1).max(500).optional(),
    codexApiKind: z.enum(['chat', 'responses', 'embedding']).optional(),
    apiKey: z.string().min(1).max(500),
    isDefault: z.boolean().optional().default(false),
    supportsMillionContext: z.boolean().optional().default(false),
    /** 自定义上下文窗口（tokens）。优先级高于 supportsMillionContext；<=0 视为未配置。 */
    contextWindow: z.number().int().min(0).max(10_000_000).optional(),
    /** 文本任务默认最大输出 tokens；<=0 视为未配置。 */
    maxTokens: z.number().int().min(0).max(10_000_000).optional(),
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
    /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
    mediaProvider: MediaProviderKindSchema.nullable().optional(),
    /** 多媒体调用方式 */
    mediaApiType: MediaApiTypeSchema.nullable().optional(),
    /** 已声明支持的多媒体能力列表 */
    mediaCapabilities: z.array(MediaCapabilityIdSchema).max(20).optional(),
    /** 多媒体能力默认值 */
    mediaDefaults: ProviderMediaDefaultsSchema.optional(),
    /** 启用的多媒体模型 manifest 引用 */
    mediaModelRefs: z.array(ProviderMediaModelRefSchema).max(200).optional(),
  })
  .superRefine((value, ctx) => {
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
  providerIcon: ProviderIconConfigSchema.nullable().optional(),
  model: z.string().min(1).max(200).optional(),
  apiEndpoint: z.string().min(1).max(500).nullable().optional(),
  codexApiKind: z.enum(['chat', 'responses', 'embedding']).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
  supportsMillionContext: z.boolean().optional(),
  /** 自定义上下文窗口（tokens）。优先级高于 supportsMillionContext；传 0 表示清除自定义。 */
  contextWindow: z.number().int().min(0).max(10_000_000).optional(),
  /** 文本任务默认最大输出 tokens；传 0 表示清除。 */
  maxTokens: z.number().int().min(0).max(10_000_000).optional(),
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
  /** 多媒体平台 adapter 种类；传 null 清除 */
  mediaProvider: MediaProviderKindSchema.nullable().optional(),
  /** 多媒体调用方式；传 null 清除 */
  mediaApiType: MediaApiTypeSchema.nullable().optional(),
  /** 已声明支持的多媒体能力列表；传空数组清空 */
  mediaCapabilities: z.array(MediaCapabilityIdSchema).max(20).optional(),
  /** 多媒体能力默认值 */
  mediaDefaults: ProviderMediaDefaultsSchema.optional(),
  /** 启用的多媒体模型 manifest 引用 */
  mediaModelRefs: z.array(ProviderMediaModelRefSchema).max(200).optional(),
})

export const ProviderGetApiKeyRequestSchema = z.object({
  id: ProfileIdSchema,
})

export const ProviderDeleteRequestSchema = z.object({
  id: ProfileIdSchema,
})

export const ProviderConnectionTestRequestSchema = z.object({
  id: ProfileIdSchema.optional(),
  provider: ProviderKindSchema,
  apiEndpoint: z.string().min(1).max(500).nullable().optional(),
  defaultModel: z.string().min(1).max(200),
  codexApiKind: z.enum(['chat', 'responses', 'embedding']).optional(),
  apiKey: z.string().max(500).optional(),
})

export const ProviderFetchModelsRequestSchema = z.object({
  id: ProfileIdSchema.optional(),
  provider: ProviderKindSchema,
  apiEndpoint: z.string().min(1).max(500).nullable().optional(),
  apiKey: z.string().max(500).optional(),
  modelsUrl: z.string().min(1).max(500).nullable().optional(),
  isFullUrl: z.boolean().optional(),
})

export const GitHubConnectorVerifyRequestSchema = z.object({
  token: z.string().min(1).max(2000),
  apiBaseUrl: z.string().url().max(1000).optional(),
})

const GitHubConnectorCapabilitySchema = z.string().min(1).max(100)
const GitHubConnectorRepoScopeSchema = z.array(z.string().min(1).max(200)).max(500)

export const GitHubConnectorConnectRequestSchema = z.object({
  token: z.string().min(1).max(2000),
  name: z.string().min(1).max(200).optional(),
  apiBaseUrl: z.string().url().max(1000).optional(),
  webBaseUrl: z.string().url().max(1000).optional(),
  selectedRepos: GitHubConnectorRepoScopeSchema.optional(),
  enabledCapabilities: z.array(GitHubConnectorCapabilitySchema).max(100).optional(),
  allowWrites: z.boolean().optional(),
})

export const GitHubConnectorUpdateRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  authMethod: z.literal('pat').optional(),
  apiBaseUrl: z.string().url().max(1000).optional(),
  webBaseUrl: z.string().url().max(1000).optional(),
  selectedRepos: GitHubConnectorRepoScopeSchema.optional(),
  enabledCapabilities: z.array(GitHubConnectorCapabilitySchema).max(100).optional(),
  allowWrites: z.boolean().optional(),
  enabled: z.boolean().optional(),
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

export const WorkspaceGitStatusRequestSchema = z.object({
  workspaceId: z.string().uuid(),
})

export const WorkspaceGitCommitRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().min(1).max(20_000),
  includeUnstaged: z.boolean().optional().default(false),
  push: z.boolean().optional().default(false),
})

export const WorkspaceGitPushRequestSchema = z.object({
  workspaceId: z.string().uuid(),
})

export const WorkspaceGitFileDiffRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  path: z.string().min(1).max(2000),
  untracked: z.boolean().optional().default(false),
})

export const WorkspaceCreateBranchRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  branch: z.string().min(1).max(240),
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

export const SessionAnswerQuestionRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  questionId: z.string().min(1).max(500),
  answers: z.record(z.string(), z.unknown()),
})

export const SessionListPendingQuestionsRequestSchema = z.object({
  sessionId: z.string().min(1).max(200).optional(),
})

const CanvasPromptRelationSchema = z.enum([
  'character',
  'supporting_character',
  'scene',
  'prop',
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
  'storyboard',
  'screenplay',
  'generic',
])
const CanvasPromptBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), id: z.string().max(200), text: z.string().max(100_000) }),
  z.object({
    kind: z.literal('reference'),
    id: z.string().max(200),
    source: z.enum(['connection', 'manual']),
    sourceNodeId: z.string().max(200),
    relation: CanvasPromptRelationSchema,
    connectionRelation: CanvasPromptRelationSchema.optional(),
    disconnected: z.boolean().optional(),
    suppressed: z.boolean().optional(),
    label: z.string().max(500),
    order: z.number().int().min(0),
    note: z.string().max(10_000).optional(),
  }),
  z.object({
    kind: z.literal('parameter'),
    id: z.string().max(200),
    parameter: z.enum(['duration', 'dialogue', 'blocking', 'custom']),
    value: z.union([z.string().max(10_000), z.number()]),
    unit: z.string().max(80).optional(),
    relation: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('structured'),
    id: z.string().max(200),
    sourceNodeId: z.string().max(200),
    schema: z.enum(['storyboard', 'screenplay', 'json', 'table']),
    summary: z.string().max(10_000),
  }),
])
const CanvasPromptDocumentSchema = z.object({
  version: z.literal(2),
  blocks: z.array(CanvasPromptBlockSchema).max(2_000),
})
const CanvasPromptTaskFieldsSchema = {
  promptDocument: CanvasPromptDocumentSchema.optional(),
  promptSnapshot: CanvasPromptDocumentSchema.extend({ capturedAt: z.string().max(80).optional() }).optional(),
  compiledUserText: z.string().max(100_000).optional(),
  inputSnapshots: z.array(z.record(z.unknown())).max(64).optional(),
  relationManifest: z.array(z.object({
    blockId: z.string().max(200),
    sourceNodeId: z.string().max(200),
    relation: CanvasPromptRelationSchema,
    order: z.number().int().min(0),
    label: z.string().max(500).optional(),
    contentHash: z.string().max(200).optional(),
  })).max(64).optional(),
  promptWarnings: z.array(z.object({
    code: z.string().max(200),
    message: z.string().max(10_000),
    blockId: z.string().max(200).optional(),
  })).max(64).optional(),
  systemPrompt: z.string().max(100_000).optional(),
}

/**
 * IPC Schema 注册表
 *
 * P0-07 中的 handle 封装会用此表自动校验每个 channel 的 request payload
 */
export const IpcSchemaRegistry = {
  'session:create': SessionCreateRequestSchema,
  'session:send-turn': SessionSendTurnRequestSchema,
  'session:submit-turn': SessionSendTurnRequestSchema,
  'session:get-queue': SessionGetQueueRequestSchema,
  'session:cancel-queued-turn': SessionCancelQueuedTurnRequestSchema,
  'session:cancel': SessionCancelRequestSchema,
  'session:reject-plan': SessionRejectPlanRequestSchema,
  'session:get-history': SessionGetHistoryRequestSchema,
  'session:list-checkpoints': SessionListCheckpointsRequestSchema,
  'session:list': SessionListRequestSchema,
  'session:search': SessionSearchRequestSchema,
  'session:update': SessionUpdateRequestSchema,
  'session:delete': SessionDeleteRequestSchema,
  'session:set-max-iterations': SessionSetMaxIterationsRequestSchema,
  'session:set-goal': SessionSetGoalRequestSchema,
  'session:get-goal': SessionGetGoalRequestSchema,
  'session:goal-control': SessionGoalControlRequestSchema,
  'session:answer-question': SessionAnswerQuestionRequestSchema,
  'session:list-pending-questions': SessionListPendingQuestionsRequestSchema,
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
  'provider:get-api-key': ProviderGetApiKeyRequestSchema,
  'provider:update': ProviderUpdateRequestSchema,
  'provider:delete': ProviderDeleteRequestSchema,
  'provider:test-connection': ProviderConnectionTestRequestSchema,
  'provider:fetch-models': ProviderFetchModelsRequestSchema,
  'platform-model:update-model-preferences': z.object({
    modelIds: z.array(z.string().min(1).max(200)).min(1).max(200),
    defaultModel: z.string().min(1).max(200),
  }),
  'github-connector:verify': GitHubConnectorVerifyRequestSchema,
  'github-connector:get': z.object({}),
  'github-connector:connect': GitHubConnectorConnectRequestSchema,
  'github-connector:update': GitHubConnectorUpdateRequestSchema,
  'github-connector:disconnect': z.object({}),
  // Provider 导入/导出 schema
  'provider:export': z.object({ ids: z.array(z.string().min(1).max(200)).max(500) }),
  'provider:import': z.object({
    payload: ProviderExportPayloadSchema,
    mode: ProviderImportModeSchema,
  }),
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
  'workspace:git-status': WorkspaceGitStatusRequestSchema,
  'workspace:git-file-diff': WorkspaceGitFileDiffRequestSchema,
  'workspace:git-commit': WorkspaceGitCommitRequestSchema,
  'workspace:git-push': WorkspaceGitPushRequestSchema,
  'workspace:create-branch': WorkspaceCreateBranchRequestSchema,
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
  'file:stat-kind': FileStatKindRequestSchema,
  'clipboard:write-text': ClipboardWriteTextRequestSchema,
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
  'window:set-zoom': z.object({
    zoomPercent: z.number().int().min(80).max(150),
  }),
  'window:ensure-width': z.object({
    minWidth: z.number().int().min(800).max(4096),
    allowShrink: z.boolean().optional().default(false),
    /**
     * 是否允许把窗口拉宽到 minWidth。默认 true。
     * false 时：仅在当前 width > minWidth 时允许 shrink，否则完全不动窗口。
     * 用于在窗口 resize 回调里避免和用户的拖动意图打架。
     */
    allowGrow: z.boolean().optional().default(true),
  }),
  'permission:list-profiles': z.object({}),
  'permission:create-profile': z.object({
    name: z.string().min(1).max(80),
    sandboxLevel: z.number().int().min(0).max(4).optional(),
  }),
  'permission:delete-profile': z.object({ id: z.string().min(1) }),
  'permission:update-sandbox': z.object({
    profileId: z.string().min(1),
    sandboxLevel: z.number().int().min(0).max(4),
  }),
  'permission:update-rule': z.object({
    profileId: z.string().min(1),
    action: z.string().min(1),
    mode: z.enum(['allow', 'ask', 'ask-twice', 'deny']),
  }),
  'permission:set-active-profile': z.object({ profileId: z.string().min(1) }),
  'permission:approval-respond': z.object({
    requestId: z.string().min(1),
    decision: z.enum([
      'allow-once',
      'allow-session',
      'allow-project',
      'allow-global',
      'deny',
      'deny-session',
      'deny-project',
      'deny-global',
    ]),
  }),
  'model:list': z.object({ providerId: ProfileIdSchema.optional() }),
  'model:create': z.object({
    providerId: ProfileIdSchema,
    name: z.string().min(1).max(200),
    configJson: z.string().optional(),
  }),
  'model:update': z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    configJson: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
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
  'mcp:authorize': z.object({ serverId: z.string().uuid() }),
  'mcp:deauthorize': z.object({ serverId: z.string().uuid() }),
  'mcp:auth-status': z.object({ serverId: z.string().uuid() }),
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
    candidates: z
      .array(
        z.object({
          rootPath: z.string().min(1).max(1000),
          source: LocalSkillSourceSchema,
        }),
      )
      .min(1)
      .max(100),
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
  'skill:install-status': z.object({}),
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
  // Memory（记忆系统 V2）
  'memory:list': z.object({
    scope: z.enum(['user', 'project', 'agent']).optional(),
    scopeRef: z.string().nullable().optional(),
    type: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
    includeArchived: z.boolean().optional(),
    includeInvalid: z.boolean().optional(),
  }),
  'memory:get': z.object({ id: z.string().min(1) }),
  'memory:create': z.object({
    scope: z.enum(['user', 'project', 'agent']),
    scopeRef: z.string().nullable(),
    type: z.enum(['user', 'feedback', 'project', 'reference']),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(300),
    body: z.string().max(10000),
    entities: z.array(z.string()).optional(),
  }),
  'memory:update': z.object({
    id: z.string().min(1),
    description: z.string().min(1).max(300).optional(),
    body: z.string().max(10000).optional(),
    type: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
  }),
  'memory:archive': z.object({ id: z.string().min(1) }),
  'memory:delete': z.object({ id: z.string().min(1) }),
  'memory:rebuild-vectors': z.object({}),
  'memory:test-extraction': z.object({}),
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
  'log:read': z.object({
    maxLines: z.number().int().min(1).max(5000).optional(),
    levels: z.array(z.enum(['debug', 'info', 'warn', 'error'])).optional(),
  }),
  'log:clear': z.object({}),
  'log:reveal': z.object({}),
  'canvas:media-capabilities:list': z.object({}),
  'canvas:media-models:list': z.object({
    providerProfileId: z.string().min(1).max(200).optional(),
    providerKind: z.string().min(1).max(120).optional(),
    capability: z.string().min(1).max(120).optional(),
    enabledOnly: z.boolean().optional(),
    catalogOnly: z.boolean().optional(),
  }),
  'canvas:media-models:describe': z.object({
    manifestId: z.string().min(1).max(160),
    providerProfileId: z.string().min(1).max(200).optional(),
  }),
  'canvas:media:prune-model-params': z.object({
    manifestId: z.string().min(1).max(160),
    providerProfileId: z.string().min(1).max(200).optional(),
    capabilityId: z.string().min(1).max(120),
    modelParams: z.record(z.unknown()),
    inputFiles: z
      .array(
        z.object({
          type: z.string().min(1).max(40),
          role: z.string().min(1).max(40).optional(),
        }),
      )
      .max(64)
      .optional(),
  }),
  'canvas:media:prune-model-params-by-inline-manifest': z.object({
    manifest: MediaModelManifestSchema,
    capabilityId: z.string().min(1).max(120),
    modelParams: z.record(z.unknown()),
    inputFiles: z
      .array(
        z.object({
          type: z.string().min(1).max(40),
          role: z.string().min(1).max(40).optional(),
        }),
      )
      .max(64)
      .optional(),
  }),
  'canvas:task:create-media': z.object({
    projectId: z.string().min(1).max(200).optional(),
    clientTaskId: z.string().min(1).max(200).optional(),
    operation: z.enum([
      'text_to_image',
      'image_to_image',
      'image_edit',
      'image_compose',
      'storyboard_grid',
      'panorama_360',
      'text_generate',
      'text_rewrite',
      'prompt_optimize',
      'text_to_audio',
      'audio_transcribe',
      'text_to_video',
      'image_to_video',
      'video_edit',
      'video_extend',
    ]),
    prompt: z.string().max(100_000).optional(),
    negativePrompt: z.string().max(100_000).optional(),
    inputFiles: z
      .array(
        z.object({
          path: z.string().max(2000).optional(),
          url: z.string().max(4000).optional(),
          dataUrl: z.string().max(100_000_000).optional(),
          mimeType: z.string().max(160).optional(),
          type: z.enum(['image', 'audio', 'video', 'file']),
          role: z.enum(['input', 'first_frame', 'last_frame', 'reference', 'mask']).optional(),
        }),
      )
      .max(64)
      .optional(),
    providerProfileId: z.string().min(1).max(200).nullable().optional(),
    manifestId: z.string().min(1).max(160).nullable().optional(),
    modelId: z.string().min(1).max(200).nullable().optional(),
    modelParams: z.record(z.unknown()).optional(),
    waitForCompletion: z.boolean().optional(),
    outputDir: z.string().max(2000).optional(),
    ...CanvasPromptTaskFieldsSchema,
  }),
  'canvas:task:cancel-media': z.object({
    runtimeTaskId: z.string().min(1).max(200),
  }),
  'canvas:snapshot:save': z.object({
    projectId: z.string().min(1).max(200),
    snapshotJson: z.string().min(1),
    meta: z
      .object({
        title: z.string().max(300).optional(),
        description: z.string().max(2000).nullable().optional(),
        status: z.enum(['active', 'archived', 'deleted']).optional(),
        nodeCount: z.number().int().min(0).optional(),
        assetCount: z.number().int().min(0).optional(),
        taskCount: z.number().int().min(0).optional(),
        coverAssetId: z.string().max(200).nullable().optional(),
        rootPath: z.string().max(2000).nullable().optional(),
      })
      .optional(),
  }),
  'canvas:snapshot:load': z.object({
    projectId: z.string().min(1).max(200),
  }),
  'canvas:project:list': z.object({
    includeDeleted: z.boolean().optional(),
  }),
  'canvas:window:open': z.object({
    projectId: z.string().min(1).max(200),
  }),
  'canvas:window:close-confirmed': z.object({}).optional().default({}),
  'canvas:project:delete': z.object({
    projectId: z.string().min(1).max(200),
    hard: z.boolean().optional(),
  }),
  'canvas:project:default-root': z.object({}),
  'canvas:project:ensure-directory': z.object({
    projectId: z.string().min(1).max(200),
    title: z.string().max(300).optional(),
    parentDirectory: z.string().min(1).max(2000).optional(),
    rootPath: z.string().max(2000).nullable().optional(),
  }),
  'canvas:asset:write-data-url': z.object({
    projectId: z.string().min(1).max(200),
    projectRootPath: z.string().max(2000).nullable().optional(),
    dataUrl: z.string().min(1).max(100_000_000),
    mimeType: z.string().min(1).max(160).optional(),
    suggestedBaseName: z.string().min(1).max(160).optional(),
    type: z.enum(['image', 'audio', 'video', 'file']).optional(),
  }),
  'canvas:asset:copy-to-project': z.object({
    projectId: z.string().min(1).max(200),
    projectRootPath: z.string().max(2000).nullable().optional(),
    sourcePath: z.string().max(4000).optional(),
    sourceUrl: z.string().max(8000).optional(),
    suggestedBaseName: z.string().min(1).max(160).optional(),
    type: z.enum(['image', 'audio', 'video', 'file']).optional(),
  }),
  'canvas:asset:download': z.object({
    sourcePath: z.string().max(4000).optional(),
    sourceUrl: z.string().max(8000).optional(),
    contentText: z.string().max(20_000_000).optional(),
    mimeType: z.string().max(160).nullable().optional(),
    type: z.enum(['image', 'audio', 'video', 'text', 'prompt', 'file']).optional(),
    suggestedFileName: z.string().min(1).max(220).optional(),
    defaultDirectory: z.string().max(2000).optional(),
  }),
  'canvas:asset:download-batch': z.object({
    items: z
      .array(
        z.object({
          sourcePath: z.string().max(4000).optional(),
          sourceUrl: z.string().max(8000).optional(),
          contentText: z.string().max(20_000_000).optional(),
          mimeType: z.string().max(160).nullable().optional(),
          type: z.enum(['image', 'audio', 'video', 'text', 'prompt', 'file']).optional(),
          suggestedFileName: z.string().min(1).max(220).optional(),
        }),
      )
      .min(1)
      .max(200),
    defaultDirectory: z.string().max(2000).optional(),
  }),
  'canvas:project:export-package': z.object({
    projectId: z.string().min(1).max(200),
    title: z.string().max(300).optional(),
    projectRootPath: z.string().max(2000).nullable().optional(),
    snapshotJson: z.string().min(1),
    targetParentDirectory: z.string().min(1).max(2000).optional(),
  }),
  'canvas:project:migrate-assets': z.object({
    projectId: z.string().min(1).max(200),
    projectRootPath: z.string().max(2000).nullable().optional(),
    snapshotJson: z.string().min(1),
  }),
  'canvas:project:cleanup-orphans': z.object({
    dryRun: z.boolean().optional(),
  }),

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

  // Built-in Terminal Panel (session-scoped PTY dock)
  // `data` 限制为 1MB 以内，避免粘贴巨量内容打爆 IPC。
  // `cols/rows` 有界，避免错误参数让 node-pty 拒绝 resize。
  'terminal:list': z.object({ sessionId: z.string().min(1) }),
  'terminal:list-active': z.object({}),
  'terminal:create': z.object({
    sessionId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    cwd: z.string().min(1).max(2000).optional(),
    title: z.string().min(1).max(80).optional(),
    cols: z.number().int().min(10).max(500).optional(),
    rows: z.number().int().min(3).max(200).optional(),
  }),
  'terminal:input': z.object({
    terminalId: z.string().min(1).max(200),
    // 上限 ~1MB；超长粘贴由 renderer 端分块，避免单条 IPC 把渲染进程 / 主进程卡住。
    data: z.string().max(1_000_000),
  }),
  'terminal:resize': z.object({
    terminalId: z.string().min(1).max(200),
    cols: z.number().int().min(10).max(500),
    rows: z.number().int().min(3).max(200),
  }),
  'terminal:kill': z.object({
    terminalId: z.string().min(1).max(200),
  }),
  'terminal:rename': z.object({
    terminalId: z.string().min(1).max(200),
    title: z.string().min(1).max(80),
  }),
  'terminal:get-buffer': z.object({
    terminalId: z.string().min(1).max(200),
  }),

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

  // ─── FFmpeg & Video Processing ─────────────────────────────────────────
  'ffmpeg:status': z.object({}),
  'ffmpeg:install': z.object({
    artifactId: z.string().min(1).max(200).optional(),
  }),
  'binary:install': z.object({
    artifactId: z.string().min(1).max(200),
  }),
  // video:probe 与 video:process 共享 VideoProcessRequest 结构。
  // params 是宽松的 Record（具体校验在主进程 videoProcessHandler 做路径白名单 + 数值范围）。
  'video:probe': z.object({
    operation: z.string().min(1).max(50),
    input: z.string().min(1).max(4096),
    params: z.record(z.unknown()),
    requestId: z.string().min(1).max(100),
  }),
  'video:process': z.object({
    operation: z.enum([
      'probe', 'extractKeyframes', 'extractFramesAtTimes', 'generateThumbnail',
      'trim', 'concat', 'segment', 'transcode',
      'adjustSpeed', 'reverse', 'crop', 'watermark', 'burnSubtitle',
    ]),
    input: z.string().min(1).max(4096),
    params: z.record(z.unknown()),
    requestId: z.string().min(1).max(100),
  }),

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
  'auth:send-sms': z.object({
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    captchaId: z.string().min(1).max(100),
    captchaText: z.string().min(1).max(20),
  }),
  'auth:login-sms': z.object({
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    smsCode: z.string().regex(/^\d{6}$/),
  }),
  'auth:client-config': z.object({}),
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
  'auth:upload-file': z.object({
    dataUrl: z.string().max(100_000_000).optional(),
    filePath: z.string().max(4000).optional(),
    fileName: z.string().max(300).optional(),
    mimeType: z.string().max(160).optional(),
  }),

  'platform-model:open-purchase-link': z.object({
    id: z.number().int().positive(),
  }),

  // Canvas Agent Bridge
  'canvas:host-attach': z.object({
    sessionId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    toolSchemas: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          description: z.string().max(8000),
          inputSchema: z.record(z.string(), z.unknown()),
        }),
      )
      .max(200),
  }),
  'canvas:host-detach': z.object({
    sessionId: z.string().min(1).max(200),
  }),
  'canvas:tool-result': z.object({
    requestId: z.string().min(1).max(200),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().max(8000).optional(),
  }),
  'canvas:tool-ack': z.object({
    requestId: z.string().min(1).max(200),
  }),
} as const
