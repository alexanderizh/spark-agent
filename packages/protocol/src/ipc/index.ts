/**
 * @module ipc
 *
 * Spark Agent IPC Channel 类型定义
 *
 * 设计原则：
 *   - 所有 IPC 调用都有明确的 Request / Response 类型
 *   - Channel 名称使用命名空间前缀："{namespace}:{action}"
 *   - 主进程 handle + renderer invoke 的类型安全由此模块保障
 *   - 流式数据通过 on/off 事件而非 invoke（使用 "stream:" 前缀）
 *
 * 命名约定：
 *   invoke channel："{namespace}:{verb}"         e.g. "session:create"
 *   event channel： "stream:{namespace}:{event}" e.g. "stream:session:agent-event"
 *
 * 注：P0-07 中旭阳-高级开发将基于此类型实现 typesafe invoke/handle 封装
 */

import type { AgentEvent, SessionId, TurnId, TeamA2ATask, TeamA2AReply } from '../events/index.js'
import type { HookNode } from '../hooks.js'
import type {
  ProviderExportPayload,
  ProviderImportResult,
  ProviderImportMode,
} from '../provider-export.js'

export type SessionChatMode = 'agent' | 'ask' | 'edit' | 'review'
export type SessionReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type SessionAgentAdapter = 'claude' | 'claude-sdk' | 'codex'
export type SessionPermissionMode =
  | 'claude-ask'
  | 'claude-auto-edits'
  | 'claude-plan'
  | 'claude-auto'
  | 'claude-bypass'
  | 'codex-default'
  | 'codex-auto-review'
  | 'codex-full-access'

export interface SessionAttachment {
  type: 'image' | 'file'
  path: string
}

// ─── Session Channels ─────────────────────────────────────────────────────────

export interface SessionCreateRequest {
  /** Provider 配置 Profile ID */
  providerProfileId: string
  /** Model Profile ID（可选）*/
  modelProfileId?: string
  /** 运行模型 ID（可选，默认取 Provider 默认模型）*/
  modelId?: string
  /** SDK/runtime adapter used to execute the task */
  agentAdapter?: SessionAgentAdapter
  /** Managed agent profile; defaults to built-in code-agent. */
  agentId?: string
  permissionMode?: SessionPermissionMode
  chatMode?: SessionChatMode
  reasoningEffort?: SessionReasoningEffort
  /** 会话标题（可选，默认自动生成）*/
  title?: string
  /** 关联的 Workspace ID（可选）*/
  workspaceId?: string
}

export interface SessionCreateResponse {
  sessionId: SessionId
  createdAt: string
}

export interface SessionSendTurnRequest {
  sessionId: SessionId
  message: string
  providerProfileId?: string
  modelId?: string | null
  agentAdapter?: SessionAgentAdapter
  agentId?: string
  permissionMode?: SessionPermissionMode
  chatMode?: SessionChatMode
  reasoningEffort?: SessionReasoningEffort
  skillId?: string
  skillParams?: Record<string, unknown>
  attachments?: SessionAttachment[]
  /** 团队模式配置：仅在 Team Mode 下随 turn 提交，主进程据此分支到 runHostTurn */
  teamConfig?: TeamModeConfig
  /**
   * 团队模式：用户在 Composer 中通过 @ 指定的直接处理 Agent。
   * - 未填或等于 hostAgentId → 走 Host 主循环（保持原行为）
   * - 命中 memberAgentIds 中的某个 Member → 跳过 Host，直接由该 Member 响应
   */
  mentionAgentId?: string
}

export interface SessionSendTurnResponse {
  turnId: string
  /** Turn 是否立即开始执行（false 表示排队中） */
  started: boolean
}

export interface SessionQueuedTurn {
  turnId: string
  message: string
  enqueuedAt: string
  attachments?: SessionAttachment[]
}

export interface SessionGetQueueRequest {
  sessionId: SessionId
}

export interface SessionGetQueueResponse {
  sessionId: SessionId
  running: boolean
  queuedTurns: SessionQueuedTurn[]
}

export interface SessionCancelQueuedTurnRequest {
  sessionId: SessionId
  turnId: string
}

export interface SessionCancelQueuedTurnResponse {
  cancelled: boolean
  queuedTurns: SessionQueuedTurn[]
}

export interface SessionSendQueuedTurnNowRequest {
  sessionId: SessionId
  turnId: string
}

export interface SessionSendQueuedTurnNowResponse {
  started: boolean
  queuedTurns: SessionQueuedTurn[]
}

export interface SessionCancelRequest {
  sessionId: SessionId
}

export interface SessionCancelResponse {
  cancelled: boolean
}

export interface SessionGetHistoryRequest {
  sessionId: SessionId
  /** 分页：取最近 N 个事件 */
  limit?: number
  /** 分页：游标（上次返回的最小 seq）*/
  beforeSeq?: number
}

export interface SessionGetHistoryResponse {
  events: AgentEvent[]
  hasMore: boolean
}

export interface SessionListRequest {
  workspaceId?: string
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export interface SessionUpdateRequest {
  sessionId: SessionId
  title?: string
  pinned?: boolean
  archived?: boolean
  providerProfileId?: string
  modelId?: string | null
  agentAdapter?: SessionAgentAdapter
  agentId?: string
  permissionMode?: SessionPermissionMode
  chatMode?: SessionChatMode
  reasoningEffort?: SessionReasoningEffort
}

export interface SessionUpdateResponse {
  session: SessionListResponse['sessions'][number]
}

export interface SessionDeleteRequest {
  sessionId: SessionId
}

export interface SessionDeleteResponse {
  deleted: boolean
}

export interface SessionClearEventsRequest {
  sessionId: SessionId
}

export interface SessionClearEventsResponse {
  cleared: boolean
}

export interface SessionDeleteMessageRequest {
  sessionId: SessionId
  eventIds: string[]
}

export interface SessionDeleteMessageResponse {
  deleted: number
}

export type UserQuestionKind = 'single_choice' | 'text'

export interface UserQuestionOption {
  label: string
  description?: string
  preview?: string
  value?: string
  allowsFreeText?: boolean
  freeTextPlaceholder?: string
}

export interface UserQuestionPrompt {
  id?: string
  question: string
  header: string
  type?: UserQuestionKind
  required?: boolean
  placeholder?: string
  multiline?: boolean
  allowSkip?: boolean
  allowOther?: boolean
  otherOptionLabel?: string
  otherPlaceholder?: string
  options?: UserQuestionOption[]
}

/** Answer to an AskUserQuestion tool call */
export interface SessionAnswerQuestionRequest {
  questionId: string
  answers: Record<string, unknown>
}

export interface SessionAnswerQuestionResponse {
  ok: boolean
}

/**
 * 为指定 session 设置临时的 maxTurnIterations 上限。
 * 主要场景：用户在收到 MAX_ITERATIONS 错误后通过 UI 调高上限。
 * 传 null 清除 override，恢复 SDK 默认值（claude 80，自动扩展最多 2 次，最高 500）。
 */
export interface SessionSetMaxIterationsRequest {
  sessionId: SessionId
  /** 1~1000。null 表示清除 override。 */
  maxIterations: number | null
}

export interface SessionSetMaxIterationsResponse {
  applied: number | null
}

export interface SessionSearchRequest {
  /** 搜索关键词 */
  query: string
  /** 限定工作区 */
  workspaceId?: string
  /** 结果数量限制 */
  limit?: number
}

export interface SessionSearchResult {
  sessionId: SessionId
  title: string
  /** 匹配的内容片段（用于高亮显示） */
  snippet: string
  /** 匹配类型 */
  matchType: 'title' | 'content'
  updatedAt: string
}

export interface SessionSearchResponse {
  results: SessionSearchResult[]
}

export interface SessionListResponse {
  sessions: Array<{
    id: SessionId
    title: string
    projectId: string
    workspaceIds: string[]
    providerProfileId: string
    modelId: string | null
    agentId: string
    agentAdapter: SessionAgentAdapter
    permissionMode: SessionPermissionMode
    chatMode: SessionChatMode
    reasoningEffort: SessionReasoningEffort
    status: 'idle' | 'running' | 'error'
    pinnedAt: string | null
    archivedAt: string | null
    createdAt: string
    updatedAt: string
    messageCount: number
  }>
  total: number
}

// ─── Provider Channels ───────────────────────────────────────────────────────

export interface ProviderProfile {
  id: string
  name: string
  provider: string
  defaultModel: string
  modelIds: string[]
  /** 自定义 API Endpoint */
  apiEndpoint?: string
  /** OpenAI/Codex provider API style. */
  codexApiKind?: 'chat' | 'responses'
  /** Whether this provider should use a 1M-token context window fallback. */
  supportsMillionContext?: boolean
  /** Haiku 档（子 agent / Task 工具默认）；为空时回落 defaultModel */
  haikuModel?: string
  /** Sonnet 档（主对话默认）；为空时回落 defaultModel */
  sonnetModel?: string
  /** Opus 档（Plan/Review 等高能力 agent）；为空时回落 defaultModel */
  opusModel?: string
  /** 模型能力类型 */
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video'
  /** 图片模型供应商类型，例如 openai、apimart、openrouter、gemini、seeddance */
  imageProvider?: string | null
  /** 图片模型调用方式 */
  imageApiType?: 'sync' | 'async' | 'auto' | null
  /** Keychain 引用 ID（非明文 Key）*/
  keystoreRef: string
  /** 是否为默认 Profile */
  isDefault: boolean
  createdAt: string
}

export interface ProviderListRequest {}

export interface ProviderListResponse {
  profiles: ProviderProfile[]
}

export interface ProviderCreateRequest {
  name: string
  provider: string
  defaultModel: string
  modelIds?: string[]
  /** 兼容旧版 payload，运行时会映射到 defaultModel */
  model?: string
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses'
  supportsMillionContext?: boolean
  /** 档位映射：留空则回落 defaultModel */
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  /** 模型能力类型 */
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video'
  /** 图片模型供应商类型，仅 modelType=image 时使用 */
  imageProvider?: string | null
  /** 图片模型调用方式，仅 modelType=image 时使用 */
  imageApiType?: 'sync' | 'async' | 'auto' | null
  /** 明文 API Key（主进程收到后立即存入 Keychain，不落 SQLite）*/
  apiKey: string
  isDefault?: boolean
}

export interface ProviderCreateResponse {
  profile: ProviderProfile
}

export interface ProviderUpdateRequest {
  id: string
  name?: string
  defaultModel?: string
  modelIds?: string[]
  /** 兼容旧版 payload，运行时会映射到 defaultModel */
  model?: string
  /** 传入 null 可清除自定义 Endpoint */
  apiEndpoint?: string | null
  codexApiKind?: 'chat' | 'responses'
  supportsMillionContext?: boolean
  /** 档位映射：传 string 设置；传 null 清除（回落 defaultModel）；undefined 不修改 */
  haikuModel?: string | null
  sonnetModel?: string | null
  opusModel?: string | null
  /** 更新 API Key 时传入，不更新则不传 */
  apiKey?: string
  isDefault?: boolean
  /** 模型能力类型 */
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video'
  /** 图片模型供应商类型，仅 modelType=image 时使用 */
  imageProvider?: string | null
  /** 图片模型调用方式，仅 modelType=image 时使用 */
  imageApiType?: 'sync' | 'async' | 'auto' | null
}

export interface ProviderUpdateResponse {
  profile: ProviderProfile
}

export interface ProviderDeleteRequest {
  id: string
}

export interface ProviderDeleteResponse {
  deleted: boolean
}

export interface ProviderHealthCheckRequest {
  id: string
}

export interface ProviderHealthCheckResponse {
  healthy: boolean
  latencyMs?: number
  errorMessage?: string
}

// ─── Provider Import/Export Channels ──────────────────────────────────────────

/**
 * `provider:export` — 内存内构造 ExportPayload（不写文件）。
 * 调用方一般会立刻跟 `provider:export-to-file` 写盘，
 * 或在 UI 里直接复制 JSON 到剪贴板。
 */
export interface ProviderExportRequest {
  /** 要导出的 profile id 列表；空数组表示导出全部 */
  ids: string[]
}

export interface ProviderExportResponse {
  payload: ProviderExportPayload
}

/**
 * `provider:import` — 直接在内存里导入 ExportPayload。
 * 主要被 `provider:import-from-file` 在读取文件后调用，
 * 也支持从剪贴板 JSON 字符串导入。
 */
export interface ProviderImportRequest {
  payload: ProviderExportPayload
  mode: ProviderImportMode
}

export interface ProviderImportResponse extends ProviderImportResult {}

/**
 * `provider:export-to-file` — 弹保存对话框并写入 .json。
 * 返回 filePath 供 UI 提示用户。
 */
export interface ProviderExportToFileRequest {
  ids: string[]
}

export interface ProviderExportToFileResponse {
  /** 实际写入路径；用户取消时为空字符串 */
  filePath: string
  /** 写入的 profile 数量（仅用于 UI 反馈）*/
  count: number
}

/**
 * `provider:import-from-file` — 弹打开对话框、读文件、解析为 payload。
 * 实际写入数据库需要再调用 `provider:import`（让 UI 走预览流程）。
 */
export interface ProviderImportFromFileRequest {}

export interface ProviderImportFromFileResponse {
  /** 用户取消时为 null */
  payload: ProviderExportPayload | null
  /** 实际读取路径（成功或失败时都填，方便 UI 提示）*/
  filePath: string
}

// ─── Workspace Channels ──────────────────────────────────────────────────────

export interface WorkspaceInfo {
  id: string
  name: string
  rootPath: string
  pinnedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceOpenRequest {
  /** 打开已有目录 */
  rootPath?: string
  /** 新建空白 Workspace */
  create?: {
    name: string
    rootPath: string
  }
}

export interface WorkspaceOpenResponse {
  workspace: WorkspaceInfo
}

export interface WorkspaceGetCurrentRequest {}

export interface WorkspaceGetCurrentResponse {
  workspace: WorkspaceInfo | null
}

export interface WorkspaceListRequest {
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceInfo[]
  total: number
}

export interface WorkspaceUpdateRequest {
  workspaceId: string
  name?: string
  pinned?: boolean
  archived?: boolean
}

export interface WorkspaceUpdateResponse {
  workspace: WorkspaceInfo
}

export interface WorkspaceDeleteRequest {
  workspaceId: string
}

export interface WorkspaceDeleteResponse {
  deleted: boolean
  deletedSessionIds: string[]
}

export interface WorkspaceOpenFolderRequest {
  workspaceId: string
}

export interface WorkspaceOpenFolderResponse {
  opened: boolean
}

export interface WorkspaceCloseRequest {
  workspaceId: string
}

export interface WorkspaceCloseResponse {
  closed: boolean
}

export interface WorkspaceTreeEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink'
  depth: number
  extension?: string
  childrenCount?: number
}

export interface WorkspaceListDirectoryRequest {
  workspaceId: string
  path?: string
  maxDepth?: number
}

export interface WorkspaceListDirectoryResponse {
  entries: WorkspaceTreeEntry[]
}

export interface WorkspaceListBranchesRequest {
  workspaceId: string
}

export interface WorkspaceListBranchesResponse {
  currentBranch: string | null
  branches: string[]
}

export interface WorkspaceSwitchBranchRequest {
  workspaceId: string
  branch: string
}

export interface WorkspaceSwitchBranchResponse {
  currentBranch: string
  branches: string[]
}

// ─── Dialog Channels ────────────────────────────────────────────────────────

export interface DialogOpenDirectoryRequest {
  title?: string
  defaultPath?: string
}

export interface DialogOpenDirectoryResponse {
  canceled: boolean
  filePath?: string
}

export interface DialogOpenFileRequest {
  title?: string
  defaultPath?: string
  multiple?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface DialogOpenFileResponse {
  canceled: boolean
  filePath?: string
  filePaths?: string[]
}

// ─── App Paths Channels ──────────────────────────────────────────────────────

export interface AppGetTempProjectDirRequest {}

export interface AppGetTempProjectDirResponse {
  tempDir: string
}

export interface AppGetStorageStatsRequest {}

export interface AppGetStorageStatsResponse {
  userDataPath: string
  projectsDir: string
  databasePath: string
  databaseBytes: number
  cacheBytes: number
  projectsBytes: number
  totalBytes: number
}

export interface AppClearCacheRequest {
  /** 是否同时清空临时项目目录下不再被任何 workspace 引用的孤儿目录。默认 false */
  pruneOrphanProjects?: boolean
}

export interface AppClearCacheResponse {
  clearedBytes: number
  clearedCache: boolean
  clearedOrphanProjects: boolean
}

export interface AppOpenDataDirRequest {}

export interface AppOpenDataDirResponse {
  opened: boolean
}

// ─── Rules Channels ─────────────────────────────────────────────────────────

export type RuleScope = 'system' | 'team' | 'user' | 'project' | 'session'

export interface RuleItem {
  id: string
  scope: RuleScope
  scopeRef: string | null
  name: string
  content: string
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface RulesListRequest {
  scope?: RuleScope
  scopeRef?: string
}

export interface RulesListResponse {
  rules: RuleItem[]
}

export interface RulesCreateRequest {
  scope: RuleScope
  scopeRef?: string
  name: string
  content: string
  priority?: number
  enabled?: boolean
}

export interface RulesCreateResponse {
  rule: RuleItem
}

export interface RulesUpdateRequest {
  id: string
  name?: string
  content?: string
  priority?: number
  enabled?: boolean
}

export interface RulesUpdateResponse {
  rule: RuleItem
}

export interface RulesDeleteRequest {
  id: string
}

export interface RulesDeleteResponse {
  success: boolean
}

export type RuleConflictStrategy = 'override' | 'merge'

export interface RulesComposeRequest {
  scopes?: RuleScope[]
  scopeRefs?: Partial<Record<RuleScope, string>>
  conflictStrategy?: RuleConflictStrategy
}

export interface ComposedRuleItem {
  id: string
  name: string
  content: string
  priority: number
  sourceScope: RuleScope
  overrode: boolean
}

export interface RulesComposeResponse {
  rules: ComposedRuleItem[]
  prompt: string
  includedScopes: RuleScope[]
}

// ─── Permission Channels ─────────────────────────────────────────────────────

export type PermissionMode = 'allow' | 'ask' | 'ask-twice' | 'deny'
export type PermissionDecisionScope = 'project' | 'global'

// Tool approval flow (main → renderer push, then renderer → main respond)
export interface PermissionApprovalRequest {
  requestId: string
  sessionId: string
  toolName: string
  action: string
  toolInput: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
  projectId?: string
  workspaceIds?: string[]
  persistentScopes: PermissionDecisionScope[]
}

export type PermissionApprovalDecision =
  | 'allow-once'
  | 'allow-session'
  | 'allow-project'
  | 'allow-global'
  | 'deny'
  | 'deny-project'
  | 'deny-global'

export interface PermissionApprovalRespondRequest {
  requestId: string
  decision: PermissionApprovalDecision
}
export interface PermissionApprovalRespondResponse {
  ok: boolean
}

export interface PermissionProfileItem {
  id: string
  name: string
  sandboxLevel: number
  isBuiltin: boolean
  rules: PermissionRuleItem[]
}

export interface PermissionRuleItem {
  id: string
  profileId: string
  action: string
  scope: string
  mode: PermissionMode
  sortOrder: number
}

export interface PermissionListProfilesRequest {}
export interface PermissionListProfilesResponse {
  profiles: PermissionProfileItem[]
  activeProfileId: string
}

export interface PermissionCreateProfileRequest {
  name: string
  sandboxLevel?: number
}
export interface PermissionCreateProfileResponse {
  profile: PermissionProfileItem
}

export interface PermissionDeleteProfileRequest {
  id: string
}
export interface PermissionDeleteProfileResponse {
  success: boolean
}

export interface PermissionUpdateSandboxRequest {
  profileId: string
  sandboxLevel: number
}
export interface PermissionUpdateSandboxResponse {
  profile: PermissionProfileItem
}

export interface PermissionUpdateRuleRequest {
  profileId: string
  action: string
  mode: PermissionMode
}
export interface PermissionUpdateRuleResponse {
  rule: PermissionRuleItem
}

export interface PermissionSetActiveProfileRequest {
  profileId: string
}
export interface PermissionSetActiveProfileResponse {
  activeProfileId: string
}

// ─── Model Channels ──────────────────────────────────────────────────────────

export interface ModelProfile {
  id: string
  providerId: string
  name: string
  configJson: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelListRequest {
  providerId?: string
}

export interface ModelListResponse {
  models: ModelProfile[]
}

export interface ModelCreateRequest {
  providerId: string
  name: string
  configJson?: string
}

export interface ModelCreateResponse {
  model: ModelProfile
}

export interface ModelUpdateRequest {
  id: string
  name?: string
  configJson?: string
  enabled?: boolean
}

export interface ModelUpdateResponse {
  model: ModelProfile
}

export interface ModelDeleteRequest {
  id: string
}

export interface ModelDeleteResponse {
  deleted: boolean
}

// ─── MCP Channels ───────────────────────────────────────────────────────────

export interface McpServerItem {
  id: string
  scope: string
  name: string
  configJson: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface McpListRequest {
  scope?: string
}

export interface McpListResponse {
  servers: McpServerItem[]
}

export interface McpCreateRequest {
  scope: string
  name: string
  configJson: string
  enabled?: boolean
}

export interface McpCreateResponse {
  server: McpServerItem
}

export interface McpUpdateRequest {
  id: string
  name?: string
  configJson?: string
  enabled?: boolean
}

export interface McpUpdateResponse {
  server: McpServerItem
}

export interface McpDeleteRequest {
  id: string
}

export interface McpDeleteResponse {
  success: boolean
}

// ─── MCP Gateway Channels (Lifecycle) ──────────────────────────────────────

export interface McpStartServerRequest {
  serverId: string
}

export interface McpStartServerResponse {
  started: boolean
  toolCount: number
}

export interface McpStopServerRequest {
  serverId: string
}

export interface McpStopServerResponse {
  stopped: boolean
}

export interface McpServerStatusRequest {
  serverId: string
}

export interface McpServerStatusResponse {
  connected: boolean
  toolCount: number
  error?: string
}

export interface McpServerToolsRequest {
  serverId: string
}

export interface McpServerToolsResponse {
  tools: Array<{
    name: string
    description: string
  }>
}

// ─── Skill Channels ─────────────────────────────────────────────────────────

export interface SkillItem {
  id: string
  scope: string
  name: string
  version: string
  rootPath: string
  manifestJson: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type RuntimeConfigScope = 'system' | 'agent' | 'project' | 'session'

export interface LocalSkillCandidate {
  id: string
  name: string
  description: string
  source: 'claude' | 'codex' | 'agents' | 'bundled' | 'linked' | 'custom'
  rootPath: string
  skillFilePath: string
  installed: boolean
  localSkillId?: string
}

export interface PromptLayerValue {
  enabled: boolean
  content: string
}

export interface SkillListRequest {
  scope?: string
}

export interface SkillListResponse {
  skills: SkillItem[]
}

export interface SkillCreateRequest {
  id: string
  scope: string
  name: string
  version: string
  rootPath: string
  manifestJson: string
  enabled?: boolean
}

export interface SkillCreateResponse {
  skill: SkillItem
}

export interface SkillUpdateRequest {
  id: string
  name?: string
  version?: string
  rootPath?: string
  manifestJson?: string
  enabled?: boolean
}

export interface SkillUpdateResponse {
  skill: SkillItem
}

export interface SkillDeleteRequest {
  id: string
}

export interface SkillDeleteResponse {
  success: boolean
}

// ─── Skill Extended Channels ────────────────────────────────────────────

/** Skill 参数定义 */
export interface SkillParameterDef {
  name: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  defaultValue?: unknown
  options?: Array<{ label: string; value: string }>
  required?: boolean
}

/** Skill 详情（含定义） */
export interface SkillDetailInfo {
  item: SkillItem
  definition: {
    id: string
    name: string
    description: string
    version: string
    author: string
    category: string
    icon?: string
    tags: string[]
    systemPrompt: string
    requiredTools: string[]
    parameters: SkillParameterDef[]
  } | null
  builtin: boolean
}

export interface SkillDetailRequest {
  id: string
}

export interface SkillDetailResponse {
  detail: SkillDetailInfo | null
}

export interface SkillToggleRequest {
  id: string
}

export interface SkillToggleResponse {
  skill: SkillItem
}

export interface SkillSearchRequest {
  query: string
}

export interface SkillSearchResponse {
  skills: SkillItem[]
}

export interface SkillExecuteRequest {
  skillId: string
  params?: Record<string, unknown>
}

export interface SkillExecuteResponse {
  systemPrompt: string
  requiredTools: string[]
}

// ─── Skill Registry Channels (Skill Store) ─────────────────────────────────

/** 远程市场中的 Skill 条目 */
export interface RemoteSkillItem {
  /** 市场 ID（带前缀，如 "skillsmp:xxx"）*/
  id: string
  name: string
  description: string
  version: string
  author: string
  registryId: string
  registryName: string
  category: string
  tags: string[]
  rating: number
  downloadCount: number
  homepageUrl?: string
  manifestUrl: string
  iconUrl?: string
  /** 是否已安装到本地 */
  installed: boolean
  /** 安装后的本地 ID */
  localId?: string
}

/** Skill 市场源配置 */
export interface SkillRegistry {
  id: string
  name: string
  description: string
  iconUrl?: string
  apiBaseUrl: string
  enabled: boolean
  type: 'remote' | 'local'
  localPath?: string
  lastSyncAt?: string
  createdAt: string
  updatedAt: string
}

export interface SkillRegistryListRequest {}

export interface SkillRegistryListResponse {
  registries: SkillRegistry[]
}

export interface SkillRegistryUpdateRequest {
  id: string
  enabled?: boolean
  configJson?: string
}

export interface SkillRegistryUpdateResponse {
  registry: SkillRegistry
}

export interface SkillRegistrySearchRequest {
  query: string
  registryId?: string
  category?: string
  limit?: number
  offset?: number
}

export interface SkillRegistrySearchResponse {
  skills: RemoteSkillItem[]
  total: number
}

export interface SkillRegistryFeaturedRequest {
  registryId?: string
  limit?: number
}

export interface SkillRegistryFeaturedResponse {
  skills: RemoteSkillItem[]
}

export interface SkillRegistryInstallRequest {
  remoteSkillId: string
  registryId: string
}

export interface SkillRegistryInstallResponse {
  skill: SkillItem
}

export interface SkillRegistryUninstallRequest {
  localSkillId: string
}

export interface SkillRegistryUninstallResponse {
  success: boolean
}

export interface SkillRegistryCategoriesRequest {
  registryId: string
}

export interface SkillRegistryCategoriesResponse {
  categories: string[]
}

export interface SkillImportFileRequest {
  filePath: string
}

export interface SkillImportFileResponse {
  skill: SkillItem
}

export interface SkillImportDirectoryRequest {
  directoryPath: string
  source?: 'claude' | 'codex' | 'agents' | 'bundled' | 'linked' | 'custom'
}

export interface SkillImportDirectoryResponse {
  skills: SkillItem[]
  failed: number
}

export interface SkillImportBatchLocalRequest {
  candidates: Array<{
    rootPath: string
    source: 'claude' | 'codex' | 'agents' | 'bundled' | 'linked' | 'custom'
  }>
}

export interface SkillImportBatchLocalResponse {
  skills: SkillItem[]
  failed: number
  errors: string[]
}

export interface SkillExportRequest {
  skillId: string
  targetPath: string
}

export interface SkillExportResponse {
  filePath: string
}

export interface SkillExportBatchRequest {
  skillIds: string[]
  targetPath: string
}

export interface SkillExportBatchResponse {
  filePath: string
  count: number
}

export interface SkillInstallToAppRequest {
  sourcePath: string
}

export interface SkillInstallToAppResponse {
  skill: SkillItem
  destPath: string
}

export interface SkillUninstallFromAppRequest {
  name: string
}

export interface SkillUninstallFromAppResponse {
  success: boolean
}

export interface SkillLinkRequest {
  targetPath: string
  name?: string
}

export interface SkillLinkResponse {
  skill: SkillItem
  linkPath: string
}

export interface SkillUnlinkRequest {
  name: string
}

export interface SkillUnlinkResponse {
  success: boolean
}

export interface SkillAppPathsRequest {}

export interface SkillAppPathsResponse {
  bundledDir: string
  userDir: string
  linksDir: string
  bundledSkills: string[]
  userSkills: string[]
  linkedSkills: string[]
}

export interface SkillDetectLocalRequest {
  searchRoots?: string[]
}

export interface SkillDetectLocalResponse {
  candidates: LocalSkillCandidate[]
}

export interface SkillConfigGetRequest {
  workspaceId?: string
  sessionId?: string
  agentId?: string
}

export interface SkillConfigGetResponse {
  skills: SkillItem[]
  systemSkillIds: string[]
  agentSkillIds: string[]
  projectSkillIds: string[]
  sessionSkillIds: string[]
  agentDisabledSkillIds: string[]
  projectDisabledSkillIds: string[]
  sessionDisabledSkillIds: string[]
  effectiveSkillIds: string[]
}

export interface SkillConfigUpdateRequest {
  scope: Exclude<RuntimeConfigScope, 'system'>
  scopeRef: string
  skillIds: string[]
  disabledSkillIds?: string[]
}

export interface SkillConfigUpdateResponse extends SkillConfigGetResponse {}

export interface PromptConfigGetRequest {
  workspaceId?: string
  sessionId?: string
  agentId?: string
}

export interface PromptConfigGetResponse {
  system: PromptLayerValue
  agent: PromptLayerValue
  project: PromptLayerValue
  session: PromptLayerValue
  effectivePrompt: string
}

export interface PromptConfigUpdateRequest {
  scope: RuntimeConfigScope
  scopeRef?: string
  value: PromptLayerValue
}

export interface PromptConfigUpdateResponse extends PromptConfigGetResponse {}

// ─── Agent Management Channels ─────────────────────────────────────────────

export interface ManagedAgent {
  id: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  isDefault: boolean
  providerProfileId?: string | null
  modelId?: string | null
  agentAdapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
  reasoningEffort: SessionReasoningEffort
  prompt: string
  ruleIds: string[]
  skillIds: string[]
  disabledSkillIds: string[]
  mcpServerIds: string[]
  hookConfig: Record<string, unknown>
  workflowId?: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AgentListRequest {
  includeDisabled?: boolean
}

export interface AgentListResponse {
  agents: ManagedAgent[]
}

export interface AgentGetRequest {
  id: string
}

export interface AgentGetResponse {
  agent: ManagedAgent | null
}

export interface AgentCreateRequest {
  name: string
  description?: string
  enabled?: boolean
  isDefault?: boolean
  providerProfileId?: string | null
  modelId?: string | null
  agentAdapter?: SessionAgentAdapter
  permissionMode?: SessionPermissionMode
  reasoningEffort?: SessionReasoningEffort
  prompt?: string
  ruleIds?: string[]
  skillIds?: string[]
  disabledSkillIds?: string[]
  mcpServerIds?: string[]
  hookConfig?: Record<string, unknown>
  workflowId?: string | null
  metadata?: Record<string, unknown>
}

export interface AgentCreateResponse {
  agent: ManagedAgent
}

export interface AgentUpdateRequest extends Partial<AgentCreateRequest> {
  id: string
}

export interface AgentUpdateResponse {
  agent: ManagedAgent
}

export interface AgentDeleteRequest {
  id: string
}

export interface AgentDeleteResponse {
  deleted: boolean
}

// ─── Agent Import/Export Channels ──────────────────────────────────────────

export interface AgentExportPayload {
  version: 1
  exportedAt: string
  exportedBy: 'spark-agent'
  agents: Array<{
    name: string
    description: string
    agentAdapter: SessionAgentAdapter
    permissionMode: SessionPermissionMode
    reasoningEffort: SessionReasoningEffort
    prompt: string
    skillIds: string[]
    disabledSkillIds: string[]
    mcpServerIds: string[]
    ruleIds: string[]
    hookConfig: Record<string, unknown>
    workflowId: string | null
    metadata: Record<string, unknown>
  }>
}

export interface AgentExportToFileRequest {
  /** 要导出的 agent id 列表；空数组表示导出全部 */
  ids: string[]
}

export interface AgentExportToFileResponse {
  filePath: string
  count: number
}

export interface AgentImportFromFileRequest {}

export interface AgentImportFromFileResponse {
  payload: AgentExportPayload | null
  filePath: string
}

// ─── Team Mode Channels ────────────────────────────────────────────────────

/**
 * 会话级团队模式配置。持久化在 sessions.metadata.team（JSON），
 * 不在 agents 表新增字段——「是否允许被 dispatch」是会话级而非 Agent 全局级决策。
 */
export interface TeamModeConfig {
  enabled: boolean
  /** 主持 Agent（用户直接对话的 Agent） */
  hostAgentId: string
  /** 当前会话授权可被 dispatch 的成员 Agent 集合（不含 Host 自身） */
  memberAgentIds: string[]
  /** 最大链式 dispatch 深度，默认 1 */
  maxDepth: number
  /** 是否允许 Member 嵌套调用 dispatch，默认 false */
  allowNesting: boolean
  /** 当本配置由某个长期团队（ManagedTeam）应用而来时，此字段指向 ManagedTeam.id。
   *  会话仍以本配置为运行时权威；Inspector 可据此提供「保存修改回团队」入口。
   *  允许显式 undefined，便于 patch 风格的"解除关联"。 */
  teamId?: string | undefined
}

/**
 * 长期团队定义（Long-lived Team）。
 * 用户在 AgentsView「Teams」Tab 维护；持久化在 agent_teams 表。
 * 会话可一键应用某个 ManagedTeam 得到 TeamModeConfig（teamId 指向此处的 id）。
 */
export interface ManagedTeam {
  id: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  hostAgentId: string
  memberAgentIds: string[]
  maxDepth: number
  allowNesting: boolean
  /** 团队专属 system prompt 段，附加在 [Team Roster] 之后作为 [Team Instructions] 注入 */
  prompt: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface TeamListDefsRequest {
  includeDisabled?: boolean
}
export interface TeamListDefsResponse {
  teams: ManagedTeam[]
}

export interface TeamGetDefRequest {
  id: string
}
export interface TeamGetDefResponse {
  team: ManagedTeam | null
}

export interface TeamCreateDefRequest {
  name: string
  description?: string
  hostAgentId: string
  memberAgentIds?: string[]
  maxDepth?: number
  allowNesting?: boolean
  prompt?: string
  enabled?: boolean
  metadata?: Record<string, unknown>
}
export interface TeamCreateDefResponse {
  team: ManagedTeam
}

export interface TeamUpdateDefRequest extends Partial<TeamCreateDefRequest> {
  id: string
}
export interface TeamUpdateDefResponse {
  team: ManagedTeam
}

export interface TeamDeleteDefRequest {
  id: string
}
export interface TeamDeleteDefResponse {
  deleted: boolean
}

/** 从 ManagedAgent 投影出的团队成员卡片（借鉴 Google A2A 的 AgentCard） */
export interface TeamMemberCard {
  agentId: string
  name: string
  description: string
  builtIn: boolean
  providerProfileId?: string | null
  modelId?: string | null
  /** 头像（派生）：基于 agentId hash 生成首字母 + 配色 */
  avatar: { type: 'initial'; text: string; color: string }
  /** 用于 system prompt 中的简略能力说明 */
  capabilitiesSummary: string
}

export interface TeamUpdateRequest {
  sessionId: SessionId
  config: TeamModeConfig
}
export interface TeamUpdateResponse {
  config: TeamModeConfig
}

export interface TeamListMembersRequest {
  sessionId: SessionId
}
export interface TeamListMembersResponse {
  hostAgentId: string
  members: TeamMemberCard[]
  /** 当前未加入但可用的 Agent（用于「邀请成员」面板） */
  candidates: TeamMemberCard[]
  /** 当前会话的完整团队配置（来自 sessions.metadata.team）；
   *  团队模式未启用时该字段为 null，调用方可据此恢复或新建配置。 */
  config: TeamModeConfig | null
}

export interface TeamListDispatchesRequest {
  sessionId: SessionId
  turnId?: TurnId
  limit?: number
}
export interface TeamListDispatchesResponse {
  dispatches: Array<{
    id: string
    state: TeamA2AReply['state'] | 'pending' | 'working'
    hostAgentId: string
    memberAgentId: string
    task: TeamA2ATask
    reply?: TeamA2AReply
    startedAt: string
    endedAt?: string
  }>
}

// ─── Workflow Channels ─────────────────────────────────────────────────────

export type WorkflowStatus = 'draft' | 'active' | 'archived'
export type WorkflowNodeKind =
  | 'input'
  | 'plan'
  | 'agent'
  | 'subagent'
  | 'skill'
  | 'tool'
  | 'mcp'
  | 'approval'
  | 'verify'
  | 'review'
  | 'artifact'

export interface WorkflowNodeConfig {
  prompt?: string
  role?: string
  modelId?: string | null
  providerProfileId?: string | null
  skillIds?: string[]
  toolIds?: string[]
  mcpServerIds?: string[]
  ruleIds?: string[]
  permissionMode?: SessionPermissionMode
  retryCount?: number
  timeoutMs?: number
  outputKey?: string
  agentId?: string | null
  parallelism?: number
  verifyCommands?: string[]
  [key: string]: unknown
}

export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  title: string
  x: number
  y: number
  config: WorkflowNodeConfig
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowItem {
  id: string
  scope: string
  name: string
  version: string
  description: string
  status: WorkflowStatus
  tags: string[]
  enabled: boolean
  graph: WorkflowGraph
  createdAt: string
  updatedAt: string
}

export interface WorkflowListRequest {
  scope?: string
  includeArchived?: boolean
}

export interface WorkflowListResponse {
  workflows: WorkflowItem[]
}

export interface WorkflowGetRequest {
  id: string
}

export interface WorkflowGetResponse {
  workflow: WorkflowItem | null
}

export interface WorkflowCreateRequest {
  scope?: string
  name: string
  version?: string
  description?: string
  status?: WorkflowStatus
  tags?: string[]
  enabled?: boolean
  graph?: WorkflowGraph
}

export interface WorkflowCreateResponse {
  workflow: WorkflowItem
}

export interface WorkflowUpdateRequest extends Partial<WorkflowCreateRequest> {
  id: string
}

export interface WorkflowUpdateResponse {
  workflow: WorkflowItem
}

export interface WorkflowDeleteRequest {
  id: string
}

export interface WorkflowDeleteResponse {
  deleted: boolean
}

// ─── App Info Channels ──────────────────────────────────────────────────────

export interface AppGetInfoRequest {}

export interface AppGetInfoResponse {
  /** 应用版本号（package.json version） */
  appVersion: string
  /** 应用名称 */
  appName: string
  /** Electron 版本 */
  electronVersion: string
  /** Chrome 版本 */
  chromeVersion: string
  /** Node.js 版本 */
  nodeVersion: string
  /** 操作系统信息 */
  platform: string
  /** 构建日期 */
  buildDate?: string
}

// ─── Settings Channels ──────────────────────────────────────────────────────

export interface SettingsGetRequest {
  category: string
  key: string
}

export interface SettingsGetResponse {
  value: unknown | null
}

export interface SettingsSetRequest {
  category: string
  key: string
  value: unknown
}

export interface SettingsSetResponse {
  ok: boolean
}

export interface SettingsGetCategoryRequest {
  category: string
}

export interface SettingsGetCategoryResponse {
  settings: Record<string, unknown>
}

export interface SettingsGetAllRequest {}

export interface SettingsGetAllResponse {
  settings: Record<string, Record<string, unknown>>
}

// ─── Board Task Channels ──────────────────────────────────────────────────────

export type BoardTaskStatus = 'todo' | 'in-progress' | 'done' | 'closed' | 'bug-fix'
export type BoardTaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface BoardComment {
  id: string
  taskId: string
  author: string
  content: string
  createdAt: string
}

export interface BoardTaskAttachment {
  id: string
  type: 'image' | 'file'
  name: string
  path: string
  previewPath?: string
}

export interface BoardTask {
  id: string
  title: string
  description: string
  status: BoardTaskStatus
  priority: BoardTaskPriority
  assignee: string
  project: string
  tags: string[]
  dueDate: string
  comments: BoardComment[]
  attachments: BoardTaskAttachment[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface BoardListRequest {
  status?: BoardTaskStatus
  priority?: BoardTaskPriority
  assignee?: string
  project?: string
  query?: string
  includeDeleted?: boolean
}

export interface BoardListResponse {
  tasks: BoardTask[]
  total: number
}

export interface BoardGetRequest {
  id: string
}

export interface BoardGetResponse {
  task: BoardTask
}

export interface BoardCreateRequest {
  title: string
  description?: string
  status?: BoardTaskStatus
  priority?: BoardTaskPriority
  assignee?: string
  project?: string
  tags?: string[]
  dueDate?: string
  attachments?: BoardTaskAttachment[]
}

export interface BoardCreateResponse {
  task: BoardTask
}

export interface BoardUpdateRequest {
  id: string
  title?: string
  description?: string
  status?: BoardTaskStatus
  priority?: BoardTaskPriority
  assignee?: string
  project?: string
  tags?: string[]
  dueDate?: string
  attachments?: BoardTaskAttachment[]
}

export interface BoardUpdateResponse {
  task: BoardTask
}

export interface BoardDeleteRequest {
  id: string
}

export interface BoardDeleteResponse {
  success: boolean
}

export interface BoardBatchCreateRequest {
  tasks: Omit<BoardCreateRequest, 'id'>[]
}

export interface BoardBatchCreateResponse {
  created: number
  tasks: BoardTask[]
}

export interface BoardBatchUpdateRequest {
  updates: BoardUpdateRequest[]
}

export interface BoardBatchUpdateResponse {
  updated: number
  tasks: BoardTask[]
}

export interface BoardBatchDeleteRequest {
  ids: string[]
}

export interface BoardBatchDeleteResponse {
  deleted: number
}

export interface BoardRestoreRequest {
  id: string
}

export interface BoardRestoreResponse {
  task: BoardTask
}

export interface BoardPermanentDeleteRequest {
  id: string
}

export interface BoardPermanentDeleteResponse {
  success: boolean
}

// ── Board Comments ──

export interface BoardCommentListRequest {
  taskId: string
}

export interface BoardCommentListResponse {
  comments: BoardComment[]
}

export interface BoardCommentCreateRequest {
  taskId: string
  author: string
  content: string
}

export interface BoardCommentCreateResponse {
  comment: BoardComment
}

export interface BoardCommentDeleteRequest {
  taskId: string
  commentId: string
}

export interface BoardCommentDeleteResponse {
  success: boolean
}

export interface BoardCommentUpdateRequest {
  taskId: string
  commentId: string
  content: string
}

export interface BoardCommentUpdateResponse {
  comment: BoardComment
}

// ─── Usage Ledger Channels ────────────────────────────────────────────────────

export interface UsageRecordRequest {
  sessionId: string
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  requestTimestamp?: string
}

export interface UsageRecordResponse {
  id: string
}

export interface UsageGetSessionRequest {
  sessionId: string
}

export interface UsageGetSessionResponse {
  summary: {
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    totalCostUsd: number
    recordCount: number
  }
}

export interface UsageGetDashboardRequest {}

export interface UsageGetDashboardResponse {
  total: {
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    totalCostUsd: number
    recordCount: number
  }
  currentMonth: {
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    totalCostUsd: number
    recordCount: number
  }
  topModels: Array<{
    modelId: string
    providerId: string
    totalInputTokens: number
    totalOutputTokens: number
    totalCostUsd: number
    recordCount: number
  }>
  recentRecords: Array<{
    id: string
    session_id: string
    provider_id: string
    model_id: string
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    cost_usd: number
    request_timestamp: string
    created_at: string
  }>
}

export interface UsageGetByDateRangeRequest {
  startDate: string
  endDate: string
}

export interface UsageGetByDateRangeResponse {
  summary: {
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    totalCostUsd: number
    recordCount: number
  }
  modelGroups: Array<{
    modelId: string
    providerId: string
    totalInputTokens: number
    totalOutputTokens: number
    totalCostUsd: number
    recordCount: number
  }>
  dailyGroups: Array<{
    date: string
    totalInputTokens: number
    totalOutputTokens: number
    totalCostUsd: number
    recordCount: number
  }>
}

export interface UsagePurgeRequest {
  olderThanDays: number
}

export interface UsagePurgeResponse {
  deletedCount: number
}

// ─── Auto-Update Channels ──────────────────────────────────────────────────

/** 更新通道类型 */
export type UpdateChannel = 'stable' | 'beta'

/** 更新状态 */
export type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'not-available'

/** 更新信息 */
export interface UpdateInfo {
  /** 新版本号 */
  version: string
  /** 发布日期 */
  releaseDate: string
  /** 更新说明 (release notes) */
  releaseNotes?: string
  /** 更新文件大小（字节） */
  fileSize?: number
}

/** 下载进度 */
export interface UpdateProgressInfo {
  /** 每秒字节数 */
  bytesPerSecond: number
  /** 已传输百分比 (0-100) */
  percent: number
  /** 已下载字节数 */
  transferred: number
  /** 总字节数 */
  total: number
}

/** 更新状态信息 */
export interface UpdateStatus {
  state: UpdateStatusState
  currentVersion: string
  updateInfo: UpdateInfo | null
  progress: UpdateProgressInfo | null
  error: string | null
}

/** 检查更新请求 */
export interface UpdateCheckRequest {}

/** 检查更新响应 */
export interface UpdateCheckResponse {
  status: UpdateStatus
}

/** 下载更新请求 */
export interface UpdateDownloadRequest {}

/** 下载更新响应 */
export interface UpdateDownloadResponse {
  started: boolean
}

/** 安装并重启请求 */
export interface UpdateInstallRestartRequest {}

/** 安装并重启响应 */
export interface UpdateInstallRestartResponse {
  willInstall: boolean
}

/** 获取更新状态请求 */
export interface UpdateGetStatusRequest {}

/** 获取更新状态响应 */
export interface UpdateGetStatusResponse {
  status: UpdateStatus
}

/** 更新设置请求 */
export interface UpdateSettingsRequest {
  autoCheck?: boolean
  autoDownload?: boolean
  channel?: UpdateChannel
}

/** 更新设置响应 */
export interface UpdateSettingsResponse {
  ok: boolean
}

// ─── File Watcher Channels ─────────────────────────────────────────────────

export interface WorkspaceWatchStartRequest {
  workspaceId: string
  /** 需要忽略的 glob 模式（默认包含 node_modules, .git 等） */
  ignorePatterns?: string[]
}

export interface WorkspaceWatchStartResponse {
  watching: boolean
}

export interface WorkspaceWatchStopRequest {
  workspaceId: string
}

export interface WorkspaceWatchStopResponse {
  stopped: boolean
}

/** 外部文件变更事件（由 fs.watch 检测，推送至渲染进程） */
export interface WorkspaceFileChangePayload {
  workspaceId: string
  /** 变更类型 */
  changeType: 'create' | 'modify' | 'delete' | 'rename'
  /** 文件路径（相对于 workspace root） */
  path: string
  /** rename 时的旧路径 */
  oldPath?: string
  /** 时间戳 */
  timestamp: string
}

// ─── External Tool Channels ────────────────────────────────────────────────

export type ExternalToolKind = 'ide' | 'terminal'

export interface ExternalToolInfo {
  /** Tool unique identifier (e.g. "vscode", "iterm2") */
  id: string
  /** Display name */
  name: string
  /** Kind: IDE or terminal */
  kind: ExternalToolKind
  /** Whether the tool was found installed on this machine */
  available: boolean
  /** Optional icon hint (for future use) */
  iconHint?: string
}

export interface ToolDetectRequest {
  /** If provided, only detect tools of this kind */
  kind?: ExternalToolKind
}

export interface ToolDetectResponse {
  tools: ExternalToolInfo[]
}

export interface ToolOpenProjectRequest {
  /** Tool ID to open with */
  toolId: string
  /** Workspace root path to open */
  rootPath: string
}

export interface ToolOpenProjectResponse {
  opened: boolean
}

// ─── Command Channels ────────────────────────────────────────────────────────

export type CommandLayer = 'sdk' | 'builtin' | 'skill'

export type CommandGroup =
  | 'session'
  | 'model'
  | 'context'
  | 'permission'
  | 'workflow'
  | 'agent'
  | 'mcp'
  | 'skill'
  | 'resource'
  | 'team'
  | 'git'
  | 'utility'
  | 'system'

export type CommandScope = 'global' | 'workspace' | 'session' | 'workflow' | 'team'

export type CommandRisk = 'none' | 'low' | 'medium' | 'high'

export interface CommandExecuteRequest {
  sessionId: string
  message: string
}

export interface CommandExecuteResponse {
  success: boolean
  message?: string
  data?: Record<string, unknown>
  forwardToAgent?: boolean
  inChat?: boolean
  started?: boolean
  session?: SessionListResponse['sessions'][number]
}

export interface CommandListRequest {}

export interface CommandListItem {
  id: string
  name: string
  aliases: string[]
  layer: CommandLayer
  group: CommandGroup
  description: string
  scope: CommandScope
  risk: CommandRisk
  usage?: string
  hasSubcommands?: boolean
}

export interface CommandListResponse {
  commands: CommandListItem[]
}

export interface CommandParseRequest {
  message: string
}

export interface CommandParseResponse {
  isCommand: boolean
  name?: string
  subcommand?: string
  args?: string[]
  flags?: Record<string, string>
  targets?: string[]
  freeText?: string
}

// ─── SDK Integrity Channels ──────────────────────────────────────────────────

export interface SdkIntegrityItem {
  /** SDK package name, e.g. '@anthropic-ai/claude-agent-sdk' */
  packageName: string
  /** Display name */
  displayName: string
  /** Whether the SDK is installed and loadable */
  installed: boolean
  /** Installed version string (null if not installed) */
  installedVersion: string | null
  /** Latest version from npm registry (null if check failed) */
  latestVersion: string | null
  /** Whether an update is available */
  updateAvailable: boolean
  /** Whether a latest-version check has been performed */
  latestChecked: boolean
  /** Error message if detection failed */
  error?: string
}

export interface SdkIntegrityCheckRequest {
  /** If true, also check npm registry for latest versions */
  checkLatest?: boolean
}

export interface SdkIntegrityCheckResponse {
  sdks: SdkIntegrityItem[]
  /** Host runtime tool check results (node, npm, git, etc.) */
  tools: RuntimeToolStatus[]
  /** Timestamp of the check */
  checkedAt: string
}

export interface SdkIntegrityInstallRequest {
  /** Package name to install/update */
  packageName: string
}

export interface SdkIntegrityInstallResponse {
  success: boolean
  message: string
  newVersion?: string
}

// ─── Shell Environment Channels ───────────────────────────────────────────────

export interface RuntimeToolStatus {
  /** Tool command name (e.g. 'node', 'python') */
  command: string
  /** Display name */
  displayName: string
  /** Whether the tool was found in PATH */
  available: boolean
  /** Resolved absolute path (null if not found) */
  resolvedPath: string | null
  /** Version string (null if not found) */
  version: string | null
  /** Download URL for installation */
  downloadUrl: string
}

export interface ShellEnvironmentStatus {
  /** Whether PATH was fixed */
  pathFixed: boolean
  /** The original PATH before fixing */
  originalPath: string | null
  /** The new PATH after fixing (null if unchanged) */
  fixedPath: string | null
  /** Detected runtime tools */
  tools: RuntimeToolStatus[]
  /** Timestamp of last check */
  checkedAt: string
}

export interface EnvGetStatusRequest {}

export interface EnvGetStatusResponse {
  status: ShellEnvironmentStatus
}

export interface EnvRecheckRequest {}

export interface EnvRecheckResponse {
  status: ShellEnvironmentStatus
}

// ─── Playwright Browser Automation Channels ───────────────────────────────────

/**
 * Playwright auto-managed MCP integration status.
 *
 * Exposed by `PlaywrightIntegrityService` and surfaced to the Settings UI.
 */
export interface PlaywrightStatusRequest {}

export interface PlaywrightStatusResponse {
  /** Whether `@playwright/mcp` package is resolvable */
  mcpInstalled: boolean
  /** Resolved version of `@playwright/mcp` (null if not installed) */
  mcpVersion: string | null
  /** Whether `playwright` package is resolvable */
  playwrightInstalled: boolean
  /** Whether any Playwright-compatible browser source is ready */
  browserReady: boolean
  /** Which browser source is currently available for Playwright */
  browserSource: 'bundled' | 'system' | 'none'
  /** Whether the managed `playwright` row exists in `mcp_servers` */
  mcpRegistered: boolean
  /** Whether the user has the managed MCP enabled (DB row `enabled=1`) */
  mcpEnabled: boolean
  /** Current run mode (headful shows the embedded window) */
  mode: 'headful' | 'headless'
  /** Whether the embedded BrowserWindow is currently open */
  viewOpen: boolean
  /** CDP endpoint URL the MCP server connects to (null if view not open) */
  cdpEndpoint: string | null
  /** Last error encountered during install / browser launch */
  lastError: string | null
}

export interface PlaywrightInstallRequest {
  /** `'mcp'` installs `@playwright/mcp`; `'browser'` runs `playwright install chromium` */
  target: 'mcp' | 'browser'
}

export interface PlaywrightInstallResponse {
  success: boolean
  message: string
  /** Updated version after install (when applicable) */
  newVersion?: string
}

export interface PlaywrightInstallProgress {
  target: 'mcp' | 'browser'
  state: 'starting' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  percent: number | null
  message: string
  logLine: string | null
}

export interface PlaywrightResetConfigRequest {}

export interface PlaywrightResetConfigResponse {
  success: boolean
}

export interface PlaywrightSetModeRequest {
  mode: 'headful' | 'headless'
}

export interface PlaywrightSetModeResponse {
  success: boolean
  mode: 'headful' | 'headless'
}

export interface PlaywrightSetEnabledRequest {
  enabled: boolean
}

export interface PlaywrightSetEnabledResponse {
  success: boolean
  enabled: boolean
}

export interface PlaywrightOpenViewRequest {
  /** Optional initial URL; if omitted opens `about:blank` */
  url?: string
}

export interface PlaywrightOpenViewResponse {
  success: boolean
  /** The CDP endpoint that Playwright MCP should connect to */
  cdpEndpoint: string | null
}

export interface PlaywrightCloseViewRequest {}

export interface PlaywrightCloseViewResponse {
  success: boolean
}

export interface PlaywrightCaptureViewRequest {}

export interface PlaywrightCaptureViewResponse {
  /** PNG screenshot encoded as base64 data URL (null if view not open) */
  dataUrl: string | null
  /** Current page title (null if view not open) */
  title: string | null
  /** Current page URL (null if view not open) */
  url: string | null
}

// ─── Pop-out Browser Window Channels ───────────────────────────────────────

export interface BrowserPopOutRequest {
  url?: string
}

export interface BrowserPopOutResponse {
  success: boolean
}

export interface BrowserPopInRequest {}

export interface BrowserPopInResponse {
  success: boolean
}

// ─── Window Control Channels ───────────────────────────────────────────────────

export interface WindowMinimizeRequest {}
export interface WindowMinimizeResponse { success: boolean }
export interface WindowMaximizeRequest {}
export interface WindowMaximizeResponse { success: boolean; maximized: boolean }
export interface WindowCloseRequest {}
export interface WindowCloseResponse { success: boolean }
export interface WindowIsMaximizedRequest {}
export interface WindowIsMaximizedResponse { maximized: boolean }

// ─── File Patch Channels ───────────────────────────────────────────────────────

export interface FileApplyHunkPatchRequest {
  /** Absolute workspace root path */
  workspaceRootPath: string
  /** File path relative to workspace root */
  filePath: string
  /** The unified diff hunk text to reverse-apply (e.g. the `@@ ... @@` block) */
  hunkDiff: string
  /** Direction: 'reverse' means revert (undo the hunk) */
  direction: 'forward' | 'reverse'
}

export interface FileApplyHunkPatchResponse {
  applied: boolean
  error?: string
}

// ─── File Open Channel ─────────────────────────────────────────────────────────

export interface FileOpenRequest {
  /**
   * Absolute path to the file to open with the OS default application.
   * On Windows the path is opened with the user's default association
   * (e.g. .html → browser, .png → image viewer, .md → editor).
   */
  filePath: string
}

export interface FileOpenResponse {
  /** True when shell.openPath succeeded (returned an empty error string). */
  opened: boolean
  /** Populated with the OS error message when opened=false. */
  error?: string
}

// ─── File Save / Download Channels ────────────────────────────────────────────

/**
 * `file:save-image` — 让用户把生成的图片 / 附件另存到本地。
 *
 * 使用场景：
 *   - 会话里 agent 生成的图片（路径在 userData/.spark-artifacts 下），
 *     用户想保存到自己的下载目录或桌面。
 *   - 附件中的图片想"另存为"。
 *
 * 行为：
 *   - 主进程会调 `dialog.showSaveDialog` 让用户选择目标位置 + 文件名，
 *     然后把源文件复制过去。如果用户取消对话框，返回 saved:false 且无 error。
 *   - 源文件必须在 safe-file 白名单目录（userData / temp）下，
 *     与协议保持一致的安全约束。
 */
export interface FileSaveImageRequest {
  /** 源文件绝对路径（必须在 safe-file 白名单内） */
  sourcePath: string
  /**
   * 推荐的默认文件名（不含目录），例如 "cat.png"。
   * 可选；省略时取源文件的 basename。
   */
  suggestedFileName?: string
  /**
   * 推荐的默认保存目录。可选；省略时用系统 Downloads 目录。
   */
  defaultDirectory?: string
}

export interface FileSaveImageResponse {
  /** 用户确认后实际写入的目标绝对路径（用户取消时为空字符串） */
  savedPath: string
  /** 是否真的写盘成功（用户取消对话框 = false） */
  saved: boolean
  /** 写入失败时的错误信息 */
  error?: string
}

/**
 * `file:save-pasted-image` — 把渲染进程剪贴板里的图片数据写入本地临时目录，
 * 返回绝对路径，供会话附件继续复用现有的 `SessionAttachment` 流程。
 */
export interface FileSavePastedImageRequest {
  /** `data:image/png;base64,...` 形式的数据 URL */
  dataUrl: string
  /** 可选 MIME 类型；主进程会优先从 dataUrl 中解析 */
  mimeType?: string
  /** 可选建议文件名前缀，不含扩展名 */
  suggestedBaseName?: string
}

export interface FileSavePastedImageResponse {
  /** 写入后的绝对路径 */
  filePath: string
  /** 根据 MIME / 文件名推导出的 basename */
  fileName: string
}

export interface FilePrepareImagePreviewRequest {
  sourcePath: string
}

export interface FilePrepareImagePreviewResponse {
  filePath: string
  fileName: string
  fileUrl: string
}

// ─── Scheduled Task Channels ──────────────────────────────────────────────────

export type ScheduledTaskTriggerType = 'interval' | 'cron' | 'once'
export type ScheduledTaskStatus = 'idle' | 'running' | 'disabled' | 'error'
export type ScheduledTaskConcurrencyPolicy = 'skip' | 'queue' | 'cancel'
export type ScheduledTaskRetryBackoff = 'fixed' | 'linear' | 'exponential'

export interface ScheduledTaskNotification {
  id: string
  url: string
  triggers: ('onSuccess' | 'onFailure' | 'onRetry' | 'onDisabled')[]
  headers?: Record<string, string>
  bodyTemplate?: string
}

export interface ScheduledTaskItem {
  id: string
  name: string
  description: string
  enabled: boolean
  triggerType: ScheduledTaskTriggerType
  intervalSeconds: number | null
  cronExpression: string | null
  runAt: string | null
  timezone: string
  startAt: string | null
  endAt: string | null
  maxExecutions: number
  agentId: string | null
  teamId: string | null
  modelId: string | null
  workspaceId: string | null
  promptTemplate: string
  permissionMode: string
  permissionProfileId: string | null
  timeoutSeconds: number
  maxRetries: number
  retryDelaySeconds: number
  retryBackoff: ScheduledTaskRetryBackoff
  notifications: ScheduledTaskNotification[]
  concurrencyPolicy: ScheduledTaskConcurrencyPolicy
  tags: string[]
  historyRetentionDays: number
  status: ScheduledTaskStatus
  executionCount: number
  successCount: number
  failureCount: number
  lastRunAt: string | null
  nextRunAt: string | null
  lastError: string | null
  currentExecutionId: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduledTaskCreateRequest {
  name: string
  description?: string
  enabled?: boolean
  triggerType: ScheduledTaskTriggerType
  intervalSeconds?: number | null
  cronExpression?: string | null
  runAt?: string | null
  timezone?: string
  startAt?: string | null
  endAt?: string | null
  maxExecutions?: number
  agentId?: string | null
  teamId?: string | null
  modelId?: string | null
  workspaceId?: string | null
  promptTemplate: string
  permissionMode?: string
  permissionProfileId?: string | null
  timeoutSeconds?: number
  maxRetries?: number
  retryDelaySeconds?: number
  retryBackoff?: ScheduledTaskRetryBackoff
  notifications?: ScheduledTaskNotification[]
  concurrencyPolicy?: ScheduledTaskConcurrencyPolicy
  tags?: string[]
  historyRetentionDays?: number
}

export interface ScheduledTaskCreateResponse {
  task: ScheduledTaskItem
}

export interface ScheduledTaskUpdateRequest {
  id: string
  name?: string
  description?: string
  enabled?: boolean
  triggerType?: ScheduledTaskTriggerType
  intervalSeconds?: number | null
  cronExpression?: string | null
  runAt?: string | null
  timezone?: string
  startAt?: string | null
  endAt?: string | null
  maxExecutions?: number
  agentId?: string | null
  teamId?: string | null
  modelId?: string | null
  workspaceId?: string | null
  promptTemplate?: string
  permissionMode?: string
  permissionProfileId?: string | null
  timeoutSeconds?: number
  maxRetries?: number
  retryDelaySeconds?: number
  retryBackoff?: ScheduledTaskRetryBackoff
  notifications?: ScheduledTaskNotification[]
  concurrencyPolicy?: ScheduledTaskConcurrencyPolicy
  tags?: string[]
  historyRetentionDays?: number
}

export interface ScheduledTaskUpdateResponse {
  task: ScheduledTaskItem
}

export interface ScheduledTaskDeleteRequest {
  id: string
}

export interface ScheduledTaskDeleteResponse {
  success: boolean
}

export interface ScheduledTaskListRequest {
  status?: string
  enabled?: boolean
  tags?: string[]
  query?: string
}

export interface ScheduledTaskListResponse {
  tasks: ScheduledTaskItem[]
}

export interface ScheduledTaskGetRequest {
  id: string
}

export interface ScheduledTaskGetResponse {
  task: ScheduledTaskItem | null
}

export interface ScheduledTaskToggleRequest {
  id: string
  enabled: boolean
}

export interface ScheduledTaskToggleResponse {
  task: ScheduledTaskItem
}

export interface ScheduledTaskRunNowRequest {
  id: string
}

export interface ScheduledTaskRunNowResponse {
  execution: TaskExecutionItem
}

// ─── Task Execution ──────────────────────────────────────────────────────────

export type TaskExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export interface TaskExecutionItem {
  id: string
  taskId: string
  sessionId: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  status: TaskExecutionStatus
  output: string | null
  error: string | null
  tokenUsage: unknown | null
  retryAttempt: number
  parentExecutionId: string | null
  triggerType: string | null
  createdAt: string
}

export interface TaskExecutionListRequest {
  taskId: string
  page?: number
  pageSize?: number
  status?: string
}

export interface TaskExecutionListResponse {
  executions: TaskExecutionItem[]
  total: number
}

export interface TaskExecutionGetRequest {
  id: string
}

export interface TaskExecutionGetResponse {
  execution: TaskExecutionItem | null
}

export interface TaskExecutionCancelRequest {
  id: string
}

export interface TaskExecutionCancelResponse {
  success: boolean
}

export interface TaskExecutionStatsRequest {
  taskId: string
}

export interface TaskExecutionStatsResponse {
  stats: {
    total: number
    completed: number
    failed: number
    avgDurationMs: number | null
    totalTokenUsage: number
  }
}

// ─── Remote Connections Channels ────────────────────────────────────────────

export type RemoteChannelType = 'telegram' | 'feishu' | 'qq' | 'wechat-claw'
export type RemoteConnectionStatus = 'disabled' | 'draft' | 'pending-pairing' | 'connected' | 'error'
export type RemotePairingMode = 'code' | 'qr'

export interface RemoteConnectionCredentials {
  botToken?: string
  appId?: string
  appSecret?: string
  webhookUrl?: string
  qqBotAppId?: string
  qqBotToken?: string
  qqBotSecret?: string
  clawEndpoint?: string
  clawAccessToken?: string
}

export interface RemoteConnectionCapabilities {
  sendMessages: boolean
  switchModel: boolean
  switchSession: boolean
  switchAgent: boolean
  manageWorkspace: boolean
  runCommands: boolean
  approvePermissions: boolean
}

export interface RemotePairedDevice {
  id: string
  remoteUserId: string
  displayName?: string
  channelThreadId?: string
  pairedAt: string
  lastSeenAt?: string
}

export interface RemotePairingChallenge {
  code: string
  mode: RemotePairingMode
  expiresAt: string
  qrPayload: string
}

export interface RemoteConnectionConfig {
  id: string
  channel: RemoteChannelType
  name: string
  enabled: boolean
  status: RemoteConnectionStatus
  credentials: RemoteConnectionCredentials
  commandPrefix: string
  allowedUserIds: string[]
  allowedChatIds: string[]
  defaultSessionId?: string
  defaultProviderProfileId?: string
  defaultModelId?: string
  defaultAgentId?: string
  telegramCommands: string[]
  capabilities: RemoteConnectionCapabilities
  pairing?: RemotePairingChallenge
  pairedDevices: RemotePairedDevice[]
  createdAt: string
  updatedAt: string
  lastConnectedAt?: string
  lastError?: string
}

export interface RemoteConnectionGlobalSettings {
  enabled: boolean
  requirePairing: boolean
  allowQrPairing: boolean
  pairingTtlMinutes: number
  localWebhookPort: number
  publicBaseUrl?: string
}

export interface RemoteCommandDefinition {
  name: string
  usage: string
  description: string
  capability: keyof RemoteConnectionCapabilities | 'system'
}

export interface RemoteListRequest {}
export interface RemoteListResponse {
  connections: RemoteConnectionConfig[]
  global: RemoteConnectionGlobalSettings
  commandCatalog: RemoteCommandDefinition[]
}

export interface RemoteSaveRequest {
  connection: Partial<RemoteConnectionConfig> & Pick<RemoteConnectionConfig, 'channel' | 'name'>
}
export interface RemoteSaveResponse {
  connection: RemoteConnectionConfig
}

export interface RemoteDeleteRequest {
  id: string
}
export interface RemoteDeleteResponse {
  deleted: boolean
}

export interface RemoteTestRequest {
  id: string
}
export interface RemoteTestResponse {
  ok: boolean
  status: RemoteConnectionStatus
  message: string
}

export interface RemoteCreateBotDraftRequest {
  channel: RemoteChannelType
  name?: string
  openConsole?: boolean
}
export interface RemoteCreateBotDraftResponse {
  connection: RemoteConnectionConfig
  consoleUrl: string
  instructions: string[]
}

export interface RemoteGeneratePairingRequest {
  id: string
  mode: RemotePairingMode
}
export interface RemoteGeneratePairingResponse {
  connection: RemoteConnectionConfig
  pairing: RemotePairingChallenge
}

export interface RemoteConfirmPairingRequest {
  id: string
  code: string
  remoteUserId: string
  displayName?: string
  channelThreadId?: string
}
export interface RemoteConfirmPairingResponse {
  ok: boolean
  connection: RemoteConnectionConfig
}

export interface RemoteCommandCatalogRequest {}
export interface RemoteCommandCatalogResponse {
  commands: RemoteCommandDefinition[]
}

export interface RemoteExecuteCommandRequest {
  id: string
  message: string
  sessionId?: string
}
export interface RemoteExecuteCommandResponse {
  ok: boolean
  title: string
  text: string
}

export interface RemoteRuntimeStatusRequest {}
export interface RemoteRuntimeStatusResponse {
  running: boolean
  port: number | null
  localBaseUrl: string | null
  polling: Array<{
    connectionId: string
    running: boolean
    lastError?: string
  }>
  longConnections: Array<{
    connectionId: string
    channel: 'feishu'
    running: boolean
    lastError?: string
  }>
}

// ─── App Startup Channels ────────────────────────────────────────────────────

export interface AppStartupSettingsRequest {}
export interface AppStartupSettingsResponse {
  supported: boolean
  openAtLogin: boolean
  openAsHidden: boolean
}

export interface AppSetStartupSettingsRequest {
  openAtLogin: boolean
  openAsHidden?: boolean
}
export interface AppSetStartupSettingsResponse extends AppStartupSettingsResponse {}

// ─── Context Governor Channels ───────────────────────────────────────────────

export interface ContextPreferenceItem {
  id: string
  workspaceId: string
  filePath: string
  action: 'pin' | 'exclude'
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface ContextPreferenceListRequest {
  workspaceId: string
  action?: 'pin' | 'exclude'
}

export interface ContextPreferenceListResponse {
  preferences: ContextPreferenceItem[]
}

export interface ContextPreferenceSetRequest {
  workspaceId: string
  filePath: string
  action: 'pin' | 'exclude'
  enabled?: boolean
}

export interface ContextPreferenceSetResponse {
  preference: ContextPreferenceItem
}

export interface ContextPreferenceDeleteRequest {
  id: string
}

export interface ContextPreferenceDeleteResponse {
  deleted: boolean
}

// ─── Hook Channels ───────────────────────────────────────────────────────

export interface HookTriggerRequest {
  sessionId: string
  node: HookNode
  title?: string
  body?: string
}

export interface HookTriggerResponse {
  triggered: boolean
}

export interface HookPlaySoundRequest {}

export interface HookPlaySoundResponse {
  played: boolean
}

export interface HookShowNotificationRequest {
  title: string
  body?: string
}

export interface HookShowNotificationResponse {
  shown: boolean
}

// ─── IPC Channel Map ─────────────────────────────────────────────────────────

/**
 * 完整的 IPC Channel 映射表
 *
 * 格式：channel -> [RequestType, ResponseType]
 *
 * 用于 typesafe invoke/handle 封装：
 * @example
 * // 主进程
 * handle('session:create', async (req: SessionCreateRequest): Promise<SessionCreateResponse> => { ... })
 *
 * // 渲染进程
 * const res = await invoke('session:create', { providerProfileId: '...' })
 * //    ^-- 类型自动推断为 SessionCreateResponse
 */
export interface IpcChannelMap {
  // Session
  'session:create': [SessionCreateRequest, SessionCreateResponse]
  'session:send-turn': [SessionSendTurnRequest, SessionSendTurnResponse]
  'session:get-queue': [SessionGetQueueRequest, SessionGetQueueResponse]
  'session:cancel-queued-turn': [SessionCancelQueuedTurnRequest, SessionCancelQueuedTurnResponse]
  'session:send-queued-turn-now': [SessionSendQueuedTurnNowRequest, SessionSendQueuedTurnNowResponse]
  'session:cancel': [SessionCancelRequest, SessionCancelResponse]
  'session:get-history': [SessionGetHistoryRequest, SessionGetHistoryResponse]
  'session:list': [SessionListRequest, SessionListResponse]
  'session:search': [SessionSearchRequest, SessionSearchResponse]
  'session:update': [SessionUpdateRequest, SessionUpdateResponse]
  'session:delete': [SessionDeleteRequest, SessionDeleteResponse]
  'session:set-max-iterations': [SessionSetMaxIterationsRequest, SessionSetMaxIterationsResponse]
  'session:clear-events': [SessionClearEventsRequest, SessionClearEventsResponse]
  'session:delete-message': [SessionDeleteMessageRequest, SessionDeleteMessageResponse]
  'session:answer-question': [SessionAnswerQuestionRequest, SessionAnswerQuestionResponse]

  // Provider
  'provider:list': [ProviderListRequest, ProviderListResponse]
  'provider:create': [ProviderCreateRequest, ProviderCreateResponse]
  'provider:update': [ProviderUpdateRequest, ProviderUpdateResponse]
  'provider:delete': [ProviderDeleteRequest, ProviderDeleteResponse]
  'provider:health-check': [ProviderHealthCheckRequest, ProviderHealthCheckResponse]
  // Provider 导入/导出（多选 + 文件 IO + JSON 序列化）
  'provider:export': [ProviderExportRequest, ProviderExportResponse]
  'provider:import': [ProviderImportRequest, ProviderImportResponse]
  'provider:export-to-file': [ProviderExportToFileRequest, ProviderExportToFileResponse]
  'provider:import-from-file': [ProviderImportFromFileRequest, ProviderImportFromFileResponse]

  // Workspace
  'workspace:open': [WorkspaceOpenRequest, WorkspaceOpenResponse]
  'workspace:get-current': [WorkspaceGetCurrentRequest, WorkspaceGetCurrentResponse]
  'workspace:list': [WorkspaceListRequest, WorkspaceListResponse]
  'workspace:update': [WorkspaceUpdateRequest, WorkspaceUpdateResponse]
  'workspace:delete': [WorkspaceDeleteRequest, WorkspaceDeleteResponse]
  'workspace:open-folder': [WorkspaceOpenFolderRequest, WorkspaceOpenFolderResponse]
  'workspace:close': [WorkspaceCloseRequest, WorkspaceCloseResponse]
  'workspace:list-directory': [WorkspaceListDirectoryRequest, WorkspaceListDirectoryResponse]
  'workspace:list-branches': [WorkspaceListBranchesRequest, WorkspaceListBranchesResponse]
  'workspace:switch-branch': [WorkspaceSwitchBranchRequest, WorkspaceSwitchBranchResponse]
  'workspace:watch-start': [WorkspaceWatchStartRequest, WorkspaceWatchStartResponse]
  'workspace:watch-stop': [WorkspaceWatchStopRequest, WorkspaceWatchStopResponse]

  // Native dialog
  'dialog:open-directory': [DialogOpenDirectoryRequest, DialogOpenDirectoryResponse]
  'dialog:open-file': [DialogOpenFileRequest, DialogOpenFileResponse]

  // App Info
  'app:get-info': [AppGetInfoRequest, AppGetInfoResponse]

  // App Paths
  'app:get-temp-project-dir': [AppGetTempProjectDirRequest, AppGetTempProjectDirResponse]
  'app:get-storage-stats': [AppGetStorageStatsRequest, AppGetStorageStatsResponse]
  'app:clear-cache': [AppClearCacheRequest, AppClearCacheResponse]
  'app:open-data-dir': [AppOpenDataDirRequest, AppOpenDataDirResponse]
  'app:get-startup-settings': [AppStartupSettingsRequest, AppStartupSettingsResponse]
  'app:set-startup-settings': [AppSetStartupSettingsRequest, AppSetStartupSettingsResponse]

  // Rules
  'rules:list': [RulesListRequest, RulesListResponse]
  'rules:create': [RulesCreateRequest, RulesCreateResponse]
  'rules:update': [RulesUpdateRequest, RulesUpdateResponse]
  'rules:delete': [RulesDeleteRequest, RulesDeleteResponse]
  'rules:compose': [RulesComposeRequest, RulesComposeResponse]

  // Permissions
  'permission:list-profiles': [PermissionListProfilesRequest, PermissionListProfilesResponse]
  'permission:create-profile': [PermissionCreateProfileRequest, PermissionCreateProfileResponse]
  'permission:delete-profile': [PermissionDeleteProfileRequest, PermissionDeleteProfileResponse]
  'permission:update-sandbox': [PermissionUpdateSandboxRequest, PermissionUpdateSandboxResponse]
  'permission:update-rule': [PermissionUpdateRuleRequest, PermissionUpdateRuleResponse]
  'permission:set-active-profile': [
    PermissionSetActiveProfileRequest,
    PermissionSetActiveProfileResponse,
  ]
  'permission:approval-respond': [
    PermissionApprovalRespondRequest,
    PermissionApprovalRespondResponse,
  ]

  // Model
  'model:list': [ModelListRequest, ModelListResponse]
  'model:create': [ModelCreateRequest, ModelCreateResponse]
  'model:update': [ModelUpdateRequest, ModelUpdateResponse]
  'model:delete': [ModelDeleteRequest, ModelDeleteResponse]

  // MCP
  'mcp:list': [McpListRequest, McpListResponse]
  'mcp:create': [McpCreateRequest, McpCreateResponse]
  'mcp:update': [McpUpdateRequest, McpUpdateResponse]
  'mcp:delete': [McpDeleteRequest, McpDeleteResponse]
  'mcp:start-server': [McpStartServerRequest, McpStartServerResponse]
  'mcp:stop-server': [McpStopServerRequest, McpStopServerResponse]
  'mcp:server-status': [McpServerStatusRequest, McpServerStatusResponse]
  'mcp:server-tools': [McpServerToolsRequest, McpServerToolsResponse]

  // Skills
  'skill:list': [SkillListRequest, SkillListResponse]
  'skill:create': [SkillCreateRequest, SkillCreateResponse]
  'skill:update': [SkillUpdateRequest, SkillUpdateResponse]
  'skill:delete': [SkillDeleteRequest, SkillDeleteResponse]
  'skill:detail': [SkillDetailRequest, SkillDetailResponse]
  'skill:toggle': [SkillToggleRequest, SkillToggleResponse]
  'skill:search': [SkillSearchRequest, SkillSearchResponse]
  'skill:execute': [SkillExecuteRequest, SkillExecuteResponse]
  'skill:detect-local': [SkillDetectLocalRequest, SkillDetectLocalResponse]
  'skill-config:get': [SkillConfigGetRequest, SkillConfigGetResponse]
  'skill-config:update': [SkillConfigUpdateRequest, SkillConfigUpdateResponse]
  'prompt-config:get': [PromptConfigGetRequest, PromptConfigGetResponse]
  'prompt-config:update': [PromptConfigUpdateRequest, PromptConfigUpdateResponse]

  // Agents
  'agent:list': [AgentListRequest, AgentListResponse]
  'agent:get': [AgentGetRequest, AgentGetResponse]
  'agent:create': [AgentCreateRequest, AgentCreateResponse]
  'agent:update': [AgentUpdateRequest, AgentUpdateResponse]
  'agent:delete': [AgentDeleteRequest, AgentDeleteResponse]
  'agent:export-to-file': [AgentExportToFileRequest, AgentExportToFileResponse]
  'agent:import-from-file': [AgentImportFromFileRequest, AgentImportFromFileResponse]

  // Team Mode
  'team:update': [TeamUpdateRequest, TeamUpdateResponse]
  'team:list-members': [TeamListMembersRequest, TeamListMembersResponse]
  'team:list-dispatches': [TeamListDispatchesRequest, TeamListDispatchesResponse]
  // 长期团队定义（agent_teams）CRUD
  'team:list-defs': [TeamListDefsRequest, TeamListDefsResponse]
  'team:get-def': [TeamGetDefRequest, TeamGetDefResponse]
  'team:create-def': [TeamCreateDefRequest, TeamCreateDefResponse]
  'team:update-def': [TeamUpdateDefRequest, TeamUpdateDefResponse]
  'team:delete-def': [TeamDeleteDefRequest, TeamDeleteDefResponse]

  // Workflows
  'workflow:list': [WorkflowListRequest, WorkflowListResponse]
  'workflow:get': [WorkflowGetRequest, WorkflowGetResponse]
  'workflow:create': [WorkflowCreateRequest, WorkflowCreateResponse]
  'workflow:update': [WorkflowUpdateRequest, WorkflowUpdateResponse]
  'workflow:delete': [WorkflowDeleteRequest, WorkflowDeleteResponse]

  // Skill Registry (Skill Store)
  'skill-registry:list': [SkillRegistryListRequest, SkillRegistryListResponse]
  'skill-registry:update': [SkillRegistryUpdateRequest, SkillRegistryUpdateResponse]
  'skill-registry:search': [SkillRegistrySearchRequest, SkillRegistrySearchResponse]
  'skill-registry:featured': [SkillRegistryFeaturedRequest, SkillRegistryFeaturedResponse]
  'skill-registry:install': [SkillRegistryInstallRequest, SkillRegistryInstallResponse]
  'skill-registry:uninstall': [SkillRegistryUninstallRequest, SkillRegistryUninstallResponse]
  'skill-registry:categories': [SkillRegistryCategoriesRequest, SkillRegistryCategoriesResponse]
  'skill:import-file': [SkillImportFileRequest, SkillImportFileResponse]
  'skill:import-directory': [SkillImportDirectoryRequest, SkillImportDirectoryResponse]
  'skill:import-batch-local': [SkillImportBatchLocalRequest, SkillImportBatchLocalResponse]
  'skill:export': [SkillExportRequest, SkillExportResponse]
  'skill:export-batch': [SkillExportBatchRequest, SkillExportBatchResponse]
  'skill:install-to-app': [SkillInstallToAppRequest, SkillInstallToAppResponse]
  'skill:uninstall-from-app': [SkillUninstallFromAppRequest, SkillUninstallFromAppResponse]
  'skill:link': [SkillLinkRequest, SkillLinkResponse]
  'skill:unlink': [SkillUnlinkRequest, SkillUnlinkResponse]
  'skill:app-paths': [SkillAppPathsRequest, SkillAppPathsResponse]

  // External Tools (IDE / Terminal)
  'tool:detect': [ToolDetectRequest, ToolDetectResponse]
  'tool:open-project': [ToolOpenProjectRequest, ToolOpenProjectResponse]

  // Command
  'command:execute': [CommandExecuteRequest, CommandExecuteResponse]
  'command:list': [CommandListRequest, CommandListResponse]
  'command:parse': [CommandParseRequest, CommandParseResponse]

  // Settings
  'settings:get': [SettingsGetRequest, SettingsGetResponse]
  'settings:set': [SettingsSetRequest, SettingsSetResponse]
  'settings:get-category': [SettingsGetCategoryRequest, SettingsGetCategoryResponse]
  'settings:get-all': [SettingsGetAllRequest, SettingsGetAllResponse]

  // Board Tasks
  'board:list': [BoardListRequest, BoardListResponse]
  'board:get': [BoardGetRequest, BoardGetResponse]
  'board:create': [BoardCreateRequest, BoardCreateResponse]
  'board:update': [BoardUpdateRequest, BoardUpdateResponse]
  'board:delete': [BoardDeleteRequest, BoardDeleteResponse]
  'board:batch-create': [BoardBatchCreateRequest, BoardBatchCreateResponse]
  'board:batch-update': [BoardBatchUpdateRequest, BoardBatchUpdateResponse]
  'board:batch-delete': [BoardBatchDeleteRequest, BoardBatchDeleteResponse]
  'board:restore': [BoardRestoreRequest, BoardRestoreResponse]
  'board:permanent-delete': [BoardPermanentDeleteRequest, BoardPermanentDeleteResponse]
  'board:comment:list': [BoardCommentListRequest, BoardCommentListResponse]
  'board:comment:create': [BoardCommentCreateRequest, BoardCommentCreateResponse]
  'board:comment:delete': [BoardCommentDeleteRequest, BoardCommentDeleteResponse]
  'board:comment:update': [BoardCommentUpdateRequest, BoardCommentUpdateResponse]

  // Usage Ledger
  'usage:record': [UsageRecordRequest, UsageRecordResponse]
  'usage:get-session': [UsageGetSessionRequest, UsageGetSessionResponse]
  'usage:get-dashboard': [UsageGetDashboardRequest, UsageGetDashboardResponse]
  'usage:get-by-date-range': [UsageGetByDateRangeRequest, UsageGetByDateRangeResponse]
  'usage:purge': [UsagePurgeRequest, UsagePurgeResponse]

  // Auto-Update
  'update:check': [UpdateCheckRequest, UpdateCheckResponse]
  'update:download': [UpdateDownloadRequest, UpdateDownloadResponse]
  'update:install-restart': [UpdateInstallRestartRequest, UpdateInstallRestartResponse]
  'update:get-status': [UpdateGetStatusRequest, UpdateGetStatusResponse]
  'update:settings': [UpdateSettingsRequest, UpdateSettingsResponse]

  // SDK Integrity
  'sdk:integrity-check': [SdkIntegrityCheckRequest, SdkIntegrityCheckResponse]
  'sdk:integrity-install': [SdkIntegrityInstallRequest, SdkIntegrityInstallResponse]

  // Shell Environment & Runtime Detection
  'env:get-status': [EnvGetStatusRequest, EnvGetStatusResponse]
  'env:recheck': [EnvRecheckRequest, EnvRecheckResponse]

  // Hooks
  'hook:trigger': [HookTriggerRequest, HookTriggerResponse]
  'hook:play-sound': [HookPlaySoundRequest, HookPlaySoundResponse]
  'hook:show-notification': [HookShowNotificationRequest, HookShowNotificationResponse]

  // Context Governor
  'context:list-preferences': [ContextPreferenceListRequest, ContextPreferenceListResponse]
  'context:set-preference': [ContextPreferenceSetRequest, ContextPreferenceSetResponse]
  'context:delete-preference': [ContextPreferenceDeleteRequest, ContextPreferenceDeleteResponse]

  // File Patch (hunk-level accept/reject)
  'file:apply-hunk-patch': [FileApplyHunkPatchRequest, FileApplyHunkPatchResponse]

  // File Open — open a file with the OS default application
  'file:open': [FileOpenRequest, FileOpenResponse]

  // File Save Image — show save dialog and copy a local image to the user's chosen path
  'file:save-image': [FileSaveImageRequest, FileSaveImageResponse]
  'file:save-pasted-image': [FileSavePastedImageRequest, FileSavePastedImageResponse]
  'file:prepare-image-preview': [FilePrepareImagePreviewRequest, FilePrepareImagePreviewResponse]

  // Remote Connections
  'remote:list': [RemoteListRequest, RemoteListResponse]
  'remote:save': [RemoteSaveRequest, RemoteSaveResponse]
  'remote:delete': [RemoteDeleteRequest, RemoteDeleteResponse]
  'remote:test': [RemoteTestRequest, RemoteTestResponse]
  'remote:create-bot-draft': [RemoteCreateBotDraftRequest, RemoteCreateBotDraftResponse]
  'remote:generate-pairing': [RemoteGeneratePairingRequest, RemoteGeneratePairingResponse]
  'remote:confirm-pairing': [RemoteConfirmPairingRequest, RemoteConfirmPairingResponse]
  'remote:command-catalog': [RemoteCommandCatalogRequest, RemoteCommandCatalogResponse]
  'remote:execute-command': [RemoteExecuteCommandRequest, RemoteExecuteCommandResponse]
  'remote:runtime-status': [RemoteRuntimeStatusRequest, RemoteRuntimeStatusResponse]

  // Playwright Browser Automation
  'playwright:status': [PlaywrightStatusRequest, PlaywrightStatusResponse]
  'playwright:install': [PlaywrightInstallRequest, PlaywrightInstallResponse]
  'playwright:reset-config': [PlaywrightResetConfigRequest, PlaywrightResetConfigResponse]
  'playwright:set-mode': [PlaywrightSetModeRequest, PlaywrightSetModeResponse]
  'playwright:set-enabled': [PlaywrightSetEnabledRequest, PlaywrightSetEnabledResponse]
  'playwright:open-view': [PlaywrightOpenViewRequest, PlaywrightOpenViewResponse]
  'playwright:close-view': [PlaywrightCloseViewRequest, PlaywrightCloseViewResponse]
  'playwright:capture-view': [PlaywrightCaptureViewRequest, PlaywrightCaptureViewResponse]

  // Pop-out Browser Window
  'browser:pop-out': [BrowserPopOutRequest, BrowserPopOutResponse]
  'browser:pop-in': [BrowserPopInRequest, BrowserPopInResponse]

  // Window Controls (renderer → main process)
  'window:minimize': [WindowMinimizeRequest, WindowMinimizeResponse]
  'window:maximize': [WindowMaximizeRequest, WindowMaximizeResponse]
  'window:close': [WindowCloseRequest, WindowCloseResponse]
  'window:is-maximized': [WindowIsMaximizedRequest, WindowIsMaximizedResponse]

  // Scheduled Tasks
  'scheduled-task:list': [ScheduledTaskListRequest, ScheduledTaskListResponse]
  'scheduled-task:get': [ScheduledTaskGetRequest, ScheduledTaskGetResponse]
  'scheduled-task:create': [ScheduledTaskCreateRequest, ScheduledTaskCreateResponse]
  'scheduled-task:update': [ScheduledTaskUpdateRequest, ScheduledTaskUpdateResponse]
  'scheduled-task:delete': [ScheduledTaskDeleteRequest, ScheduledTaskDeleteResponse]
  'scheduled-task:toggle': [ScheduledTaskToggleRequest, ScheduledTaskToggleResponse]
  'scheduled-task:run-now': [ScheduledTaskRunNowRequest, ScheduledTaskRunNowResponse]
  'task-execution:list': [TaskExecutionListRequest, TaskExecutionListResponse]
  'task-execution:get': [TaskExecutionGetRequest, TaskExecutionGetResponse]
  'task-execution:cancel': [TaskExecutionCancelRequest, TaskExecutionCancelResponse]
  'task-execution:stats': [TaskExecutionStatsRequest, TaskExecutionStatsResponse]
}

/** 所有 IPC Channel 名称的联合类型 */
export type IpcChannel = keyof IpcChannelMap

/** 获取指定 Channel 的 Request 类型 */
export type IpcRequest<C extends IpcChannel> = IpcChannelMap[C][0]

/** 获取指定 Channel 的 Response 类型 */
export type IpcResponse<C extends IpcChannel> = IpcChannelMap[C][1]

// ─── Stream Event Channels ───────────────────────────────────────────────────

/**
 * 流式事件 Channel（主进程 → 渲染进程，单向推送）
 *
 * 使用 ipcMain.webContents.send / ipcRenderer.on 监听
 */
export interface IpcStreamChannelMap {
  /** Agent 事件流（主进程推送，渲染进程监听驱动 Timeline UI）*/
  'stream:session:agent-event': AgentEvent
  /** Session 后端排队状态变化 */
  'stream:session:queue-changed': SessionGetQueueResponse
  /** Session 标题被异步重命名（首轮完成后 LLM 总结）*/
  'stream:session:renamed': { sessionId: string; title: string }
  /** Session created outside the renderer session sidebar flow */
  'stream:session:created': { sessionId: string }
  /** 用户问题请求（AskUserQuestion 工具，主进程推送，渲染进程显示选择界面）*/
  'stream:session:user-question': {
    questionId: string
    sessionId: string
    questions: UserQuestionPrompt[]
  }
  /** 连接状态变化 */
  'stream:provider:status-changed': {
    profileId: string
    status: 'connected' | 'disconnected' | 'error'
    message?: string
  }
  /** Remote connection config/runtime changed */
  'stream:remote:changed': {
    reason: 'connection-saved' | 'connection-deleted' | 'pairing-updated' | 'runtime-updated'
    connectionId?: string
  }
  /** 工具审批请求（主进程推送，渲染进程弹窗）*/
  'stream:permission:approval-request': PermissionApprovalRequest
  /** 工作区文件变更（由 fs.watch 检测外部文件变化，主进程推送）*/
  'stream:workspace:file-change': WorkspaceFileChangePayload
  /** 更新可用（主进程推送，渲染进程显示通知）*/
  'stream:update:available': UpdateInfo
  /** 更新下载进度（主进程推送，渲染进程显示进度条）*/
  'stream:update:progress': UpdateProgressInfo
  /** 更新下载完成（主进程推送，渲染进程显示安装提示）*/
  'stream:update:downloaded': UpdateInfo
  /** 更新状态变化（主进程推送，渲染进程同步状态）*/
  'stream:update:status': UpdateStatus
  /** SDK 完整性自检结果（启动时自动推送）*/
  'stream:sdk:integrity': SdkIntegrityCheckResponse
  /** Shell 环境状态（PATH 修复 + 运行时工具检测结果）*/
  'stream:env:status': ShellEnvironmentStatus
  /** Playwright 安装/状态变化推送（Settings UI 监听）*/
  'stream:playwright:status': PlaywrightStatusResponse
  /** Playwright MCP / Chromium 安装进度推送 */
  'stream:playwright:install-progress': PlaywrightInstallProgress
  /** Embedded browser view screenshot/page update (Renderer listens for live preview) */
  'stream:playwright:view': {
    title: string | null
    url: string | null
    /** PNG screenshot encoded as base64 data URL (omitted when unchanged) */
    dataUrl?: string
  }
  /** Scheduled task execution event (main → renderer push) */
  'stream:scheduled-task:execution': {
    taskId: string
    executionId: string
    type: 'started' | 'completed' | 'failed' | 'timeout' | 'retrying'
    durationMs?: number
    error?: string
    sessionId?: string
  }
}

export type IpcStreamChannel = keyof IpcStreamChannelMap
export type IpcStreamPayload<C extends IpcStreamChannel> = IpcStreamChannelMap[C]
