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

import type { AgentEvent, SessionId } from '../events/index.js'

// ─── Session Channels ─────────────────────────────────────────────────────────

export interface SessionCreateRequest {
  /** Provider 配置 Profile ID */
  providerProfileId: string
  /** Model Profile ID（可选）*/
  modelProfileId?: string
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
  attachments?: Array<{
    type: 'image' | 'file'
    path: string
  }>
}

export interface SessionSendTurnResponse {
  turnId: string
  /** Turn 是否立即开始执行（false 表示排队中） */
  started: boolean
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
  limit?: number
  offset?: number
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
    providerProfileId: string
    status: 'idle' | 'running' | 'error'
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
  /** 更新 API Key 时传入，不更新则不传 */
  apiKey?: string
  isDefault?: boolean
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

// ─── Workspace Channels ──────────────────────────────────────────────────────

export interface WorkspaceInfo {
  id: string
  name: string
  rootPath: string
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

// ─── Dialog Channels ────────────────────────────────────────────────────────

export interface DialogOpenDirectoryRequest {
  title?: string
  defaultPath?: string
}

export interface DialogOpenDirectoryResponse {
  canceled: boolean
  filePath?: string
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

// ─── Permission Channels ─────────────────────────────────────────────────────

export type PermissionMode = 'allow' | 'ask' | 'ask-twice' | 'deny'

// Tool approval flow (main → renderer push, then renderer → main respond)
export interface PermissionApprovalRequest {
  requestId: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
}

export type PermissionApprovalDecision = 'allow-once' | 'allow-session' | 'deny'

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

export interface PermissionDeleteProfileRequest { id: string }
export interface PermissionDeleteProfileResponse { success: boolean }

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
  'session:cancel': [SessionCancelRequest, SessionCancelResponse]
  'session:get-history': [SessionGetHistoryRequest, SessionGetHistoryResponse]
  'session:list': [SessionListRequest, SessionListResponse]
  'session:search': [SessionSearchRequest, SessionSearchResponse]

  // Provider
  'provider:list': [ProviderListRequest, ProviderListResponse]
  'provider:create': [ProviderCreateRequest, ProviderCreateResponse]
  'provider:update': [ProviderUpdateRequest, ProviderUpdateResponse]
  'provider:delete': [ProviderDeleteRequest, ProviderDeleteResponse]
  'provider:health-check': [ProviderHealthCheckRequest, ProviderHealthCheckResponse]

  // Workspace
  'workspace:open': [WorkspaceOpenRequest, WorkspaceOpenResponse]
  'workspace:get-current': [WorkspaceGetCurrentRequest, WorkspaceGetCurrentResponse]
  'workspace:close': [WorkspaceCloseRequest, WorkspaceCloseResponse]
  'workspace:list-directory': [WorkspaceListDirectoryRequest, WorkspaceListDirectoryResponse]

  // Native dialog
  'dialog:open-directory': [DialogOpenDirectoryRequest, DialogOpenDirectoryResponse]

  // Rules
  'rules:list': [RulesListRequest, RulesListResponse]
  'rules:create': [RulesCreateRequest, RulesCreateResponse]
  'rules:update': [RulesUpdateRequest, RulesUpdateResponse]
  'rules:delete': [RulesDeleteRequest, RulesDeleteResponse]

  // Permissions
  'permission:list-profiles': [PermissionListProfilesRequest, PermissionListProfilesResponse]
  'permission:create-profile': [PermissionCreateProfileRequest, PermissionCreateProfileResponse]
  'permission:delete-profile': [PermissionDeleteProfileRequest, PermissionDeleteProfileResponse]
  'permission:update-sandbox': [PermissionUpdateSandboxRequest, PermissionUpdateSandboxResponse]
  'permission:update-rule': [PermissionUpdateRuleRequest, PermissionUpdateRuleResponse]
  'permission:approval-respond': [PermissionApprovalRespondRequest, PermissionApprovalRespondResponse]

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

  // Skills
  'skill:list': [SkillListRequest, SkillListResponse]
  'skill:create': [SkillCreateRequest, SkillCreateResponse]
  'skill:update': [SkillUpdateRequest, SkillUpdateResponse]
  'skill:delete': [SkillDeleteRequest, SkillDeleteResponse]
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
  /** 连接状态变化 */
  'stream:provider:status-changed': {
    profileId: string
    status: 'connected' | 'disconnected' | 'error'
    message?: string
  }
  /** 工具审批请求（主进程推送，渲染进程弹窗）*/
  'stream:permission:approval-request': PermissionApprovalRequest
}

export type IpcStreamChannel = keyof IpcStreamChannelMap
export type IpcStreamPayload<C extends IpcStreamChannel> = IpcStreamChannelMap[C]
