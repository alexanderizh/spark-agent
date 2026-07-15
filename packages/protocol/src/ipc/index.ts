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
  ProviderMediaDefaults,
  MediaProviderKind,
  MediaApiType,
  MediaCapabilityId,
  CanvasOperationType,
  MediaRequestCall,
} from '../media-config.js'
import type { MediaModelManifest, ProviderMediaModelRef } from '../media-model-manifest.js'
import type {
  MediaContractIssue,
  MediaContractWarning,
  MediaDroppedParam,
} from '../media-model-contract.js'
import type {
  ProviderExportPayload,
  ProviderImportResult,
  ProviderImportMode,
} from '../provider-export.js'
import type {
  ScheduledTaskExportPayload,
  ScheduledTaskImportResult,
  ScheduledTaskImportMode,
} from '../scheduled-task-export.js'
import type {
  HistoryImportSource,
  HistoryImportScanRequest,
  HistoryImportScanResponse,
  HistoryImportPreviewRequest,
  HistoryImportPreviewResponse,
  HistoryImportRequest,
  HistoryImportResponse,
  HistoryImportProgress,
} from '../history-import.js'
import type {
  ConnectorAuthMethod,
  ConnectorCapabilityKind,
  GitHubConnectorConnection,
} from '../connectors.js'

export type SessionChatMode = 'agent' | 'ask' | 'edit' | 'review'
export type SessionReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
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
  type: 'image' | 'file' | 'directory'
  path: string
}

export type GoalStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cleared'
  | 'stopped_by_budget'
export type GoalLoopPhase = 'review' | 'act' | 'validate'
export type GoalControlAction = 'pause' | 'resume' | 'clear' | 'complete'

export interface SessionGoalBudget {
  maxIterations?: number
  maxRuntimeMinutes?: number
  maxBudgetUsd?: number
  maxConsecutiveFailures?: number
  noProgressLimit?: number
}

export interface SessionGoalValidation {
  commands?: string[]
  checklist?: string[]
}

export interface SessionGoalProgressEntry {
  iteration: number
  phase: GoalLoopPhase
  status: GoalStatus | 'continue' | 'blocked'
  summary: string
  evidence?: string[]
  nextStep?: string
  validation?: Record<string, unknown>
  createdAt: string
}

export interface SessionGoal {
  id: string
  sessionId: SessionId
  objective: string
  successCriteria: string[]
  constraints: string[]
  validation: SessionGoalValidation
  budget: SessionGoalBudget
  status: GoalStatus
  mode: 'spark-loop' | 'codex-native'
  progressLog: SessionGoalProgressEntry[]
  lastError?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface SessionSetGoalRequest {
  sessionId: SessionId
  objective: string
  successCriteria?: string[]
  constraints?: string[]
  validation?: SessionGoalValidation
  budget?: SessionGoalBudget
  mode?: 'spark-loop' | 'codex-native' | 'auto'
}

export interface SessionGetGoalRequest {
  sessionId: SessionId
}

export interface SessionGoalControlRequest {
  sessionId: SessionId
  action: GoalControlAction
  summary?: string
}

export interface SessionGoalResponse {
  goal: SessionGoal | null
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
  /** Managed agent profile; defaults to built-in platform-manager-agent. */
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
  /** Complete summary for immediate renderer upsert without session:list. */
  session: SessionListResponse['sessions'][number]
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
  /**
   * 若为 true，则当 session 仍有活跃 loop（典型：plan 批准时上一个 plan turn 还没完全收尾）
   * 时显式中断并立即起跑新 turn，而不是入队等待。用于 Plan Approval Modal 的"批准并执行"。
   */
  interruptActive?: boolean
}

export interface SessionSendTurnResponse {
  turnId: string
  /** Turn 是否立即开始执行（false 表示排队中） */
  started: boolean
}

export type SessionSubmitTurnRequest = SessionSendTurnRequest

export interface SessionSubmitTurnResponse extends SessionSendTurnResponse {
  /** The request is durably stored and can be recovered after a process restart. */
  accepted: true
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

/** 用户拒绝当前会话的待审批计划（plan_proposed）。 */
export interface SessionRejectPlanRequest {
  sessionId: SessionId
}

export interface SessionRejectPlanResponse {
  /** 是否确实存在待审批计划并被解除（无待审批时为 false）。 */
  rejected: boolean
}

export interface SessionGetHistoryRequest {
  sessionId: SessionId
  /** 一次性取完整历史，避免大会话切换时反复 IPC 分页。 */
  full?: boolean
  /** 分页：取最近 N 个事件（事件级，排除流式 delta 行） */
  limit?: number
  /**
   * 按「轮次」分页：取最近 N 个完整轮次（turn）的可渲染事件。
   * Agentic 会话里一个轮次可能有上千条事件，按事件数分页会把一个轮次切碎、
   * 导致只显示「一条消息」；按轮次分页则每页都是完整对话、永不切碎。
   */
  turnLimit?: number
  /**
   * 轮次分页的软事件上限：按完整 turn 裁剪，避免一次 IPC 搬运过多历史事件。
   * 最新 turn 即使超过上限也会完整返回，保证消息结构不被切碎。
   */
  eventLimit?: number
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
  /** 调试模式开关（per-session，持久化到 metadata） */
  debugMode?: boolean
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

/**
 * 会话还原点（代码检查点）。由 Claude SDK 文件检查点机制在改动文件的 turn 后产生。
 * 用于「按会话撤回代码」的时间线视图与一键还原。
 */
export interface SessionCheckpoint {
  checkpointId: string
  label?: string
  /** 快照目录（相对工作区），还原时把其中文件拷回工作区 */
  path?: string
  /** 该检查点记录的受影响文件路径 */
  filePaths?: string[]
  /** ISO 时间戳 */
  timestamp?: string
}

export interface SessionGetCheckpointConfigRequest {
  sessionId: SessionId
}
export interface SessionGetCheckpointConfigResponse {
  /** 会话是否开启代码还原点（默认 false） */
  enabled: boolean
  /** 功能是否可用：仅当工作区是 git 仓库时为 true（非 git 前端隐藏入口） */
  available: boolean
}
export interface SessionSetCheckpointConfigRequest {
  sessionId: SessionId
  enabled: boolean
}
export interface SessionSetCheckpointConfigResponse {
  ok: boolean
  enabled: boolean
}

export interface SessionListCheckpointsRequest {
  sessionId: SessionId
}

export interface SessionListCheckpointsResponse {
  /** 倒序（最近在前）的还原点列表 */
  checkpoints: SessionCheckpoint[]
}

export interface SessionDeleteMessageRequest {
  sessionId: SessionId
  eventIds: string[]
}

export interface SessionDeleteMessageResponse {
  deleted: number
}

export type UserQuestionKind = 'single_choice' | 'multi_choice' | 'text'

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
  multiSelect?: boolean
}

export interface UserQuestionRequest {
  questionId: string
  sessionId: string
  questions: UserQuestionPrompt[]
  createdAt: string
}

/** Answer to an AskUserQuestion tool call */
export interface SessionAnswerQuestionRequest {
  sessionId: string
  questionId: string
  answers: Record<string, unknown>
}

export interface SessionAnswerQuestionResponse {
  ok: boolean
}

export interface SessionListPendingQuestionsRequest {
  sessionId?: string
}

export interface SessionListPendingQuestionsResponse {
  questions: UserQuestionRequest[]
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
    /** Number of user-submitted turns. Always populated by current desktop versions. */
    turnCount?: number
    /** User messages plus completed assistant messages. */
    logicalMessageCount?: number
    /** @deprecated Compatibility alias for logicalMessageCount. */
    messageCount: number
    /** 若该会话由宿主机历史导入而来，标记来源（用于侧边栏来源徽标）*/
    importedFrom?: HistoryImportSource
    /** 调试模式（per-session 能力开关）：与权限模式正交，开启后挂载 spark_debug + 显示快捷回复 */
    debugMode?: boolean
  }>
  total: number
}

// ─── Provider Channels ───────────────────────────────────────────────────────

export type ProviderIconStyle = 'avatar' | 'mono'

export interface ProviderIconConfig {
  id: string
  style: ProviderIconStyle
}

export interface ProviderProfile {
  id: string
  name: string
  provider: string
  defaultModel: string
  modelIds: string[]
  /** 受管 Provider 从服务端同步到的完整模型清单；modelIds 仅表示本机启用项。 */
  availableModelIds?: string[]
  /** Provider 列表和模型配置表单里展示的 LobeHub 图标配置。 */
  providerIcon?: ProviderIconConfig
  /** 自定义 API Endpoint */
  apiEndpoint?: string
  /** OpenAI/Codex provider API style. */
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  /** Whether this provider should use a 1M-token context window fallback. */
  supportsMillionContext?: boolean
  /** 自定义上下文窗口（tokens）。优先级高于 supportsMillionContext；<=0 / undefined 视为未配置。 */
  contextWindow?: number
  /** 文本任务默认最大输出 tokens。<=0 / undefined 视为未配置。 */
  maxTokens?: number
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
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider?: MediaProviderKind | null
  /** 多媒体调用方式（sync/async/auto） */
  mediaApiType?: MediaApiType | null
  /** 已声明支持的多媒体能力列表 */
  mediaCapabilities?: MediaCapabilityId[]
  /** 多媒体能力默认值（尺寸/语音/时长/轮询等） */
  mediaDefaults?: ProviderMediaDefaults
  /** 启用的多媒体模型 manifest 引用，用于 schema 驱动的参数面板和工具描述 */
  mediaModelRefs?: ProviderMediaModelRef[]
  /** Keychain 引用 ID（非明文 Key）*/
  keystoreRef: string
  /** 是否为默认 Profile */
  isDefault: boolean
  /** 平台官方受管 Provider；普通 Provider 省略。 */
  managed?: boolean
  managedType?: 'newapi'
  /** 受管凭据所属 Spark 用户，防止切换账号后串用。 */
  managedOwnerUserId?: string
  credentialState?: 'ready' | 'session_conflict' | 'quota_exhausted' | 'unavailable'
  createdAt: string
}

// ─── Platform Model Subscription ─────────────────────────────────────────────

export interface PlatformModelStatus {
  bound: boolean
  providerReady: boolean
  sessionConflict: boolean
  credentialState: 'unbound' | 'ready' | 'session_conflict' | 'quota_exhausted' | 'unavailable'
  models: string[]
  message?: string
  pendingPayment?: {
    planId: number
    createdAt: number
    baselineSubscriptionId?: number
    baselineExpiresAt?: number
  }
}

export interface PlatformModelPlan {
  id: number
  title: string
  subtitle?: string
  priceAmount: number
  currency?: string
  durationValue?: number
  durationUnit?: string
  totalAmount?: number
  allowBalancePay?: boolean
}

export interface PlatformModelSubscription {
  id: number
  planId: number
  planTitle?: string
  status: string
  startsAt?: number
  expiresAt?: number
  amountTotal: number
  amountUsed: number
  nextResetTime?: number
}

export interface PlatformModelRedeemRequest { code: string }
export interface PlatformModelRedeemResponse {
  benefitType: 'quota' | 'subscription'
  quotaAdded?: number
  planId?: number
  message: string
}

export interface PlatformModelPayRequest {
  planId: number
  paymentMethod: 'alipay' | 'wxpay'
}

export interface PlatformModelPayResponse {
  mode: 'browser'
  paid: boolean
}

export interface PlatformModelPurchaseLink {
  id: number
  name: string
  url: string
  description?: string
  sortOrder: number
}

export interface PlatformModelOpenPurchaseLinkRequest {
  id: number
}

export interface PlatformModelUpdatePreferencesRequest {
  modelIds: string[]
  defaultModel: string
}

export interface PlatformModelUpdatePreferencesResponse {
  modelIds: string[]
  defaultModel: string
}

export interface PlatformModelUsageLog {
  id: number
  createdAt: number
  model: string
  promptTokens: number
  completionTokens: number
  quota: number
}

export interface PlatformModelUsage {
  walletQuota: number
  cumulativeUsedQuota: number
  /** 与 NewAPI 控制台额度展示设置一致的货币符号；TOKENS 模式为空。 */
  currencySymbol: string
  logs: PlatformModelUsageLog[]
}

export interface ProviderListRequest {}

export interface ProviderListResponse {
  profiles: ProviderProfile[]
}

/**
 * 仅供 Provider 编辑界面按需回显当前凭据。不得并入 provider:list，
 * 避免一次性把所有明文凭据发送到 Renderer。
 */
export interface ProviderGetApiKeyRequest {
  id: string
}

export interface ProviderGetApiKeyResponse {
  apiKey: string
}

export interface ProviderCreateRequest {
  name: string
  provider: string
  defaultModel: string
  modelIds?: string[]
  /** Provider 列表和模型配置表单里展示的 LobeHub 图标配置。 */
  providerIcon?: ProviderIconConfig
  /** 兼容旧版 payload，运行时会映射到 defaultModel */
  model?: string
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  supportsMillionContext?: boolean
  /** 自定义上下文窗口（tokens）。<=0 / undefined 视为未配置；优先级高于 supportsMillionContext。 */
  contextWindow?: number
  /** 文本任务默认最大输出 tokens。<=0 / undefined 视为未配置。 */
  maxTokens?: number
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
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider?: MediaProviderKind | null
  /** 多媒体调用方式 */
  mediaApiType?: MediaApiType | null
  /** 已声明支持的多媒体能力列表 */
  mediaCapabilities?: MediaCapabilityId[]
  /** 多媒体能力默认值 */
  mediaDefaults?: ProviderMediaDefaults
  /** 启用的多媒体模型 manifest 引用 */
  mediaModelRefs?: ProviderMediaModelRef[]
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
  /** Provider 列表和模型配置表单里展示的 LobeHub 图标配置；传 null 清除。 */
  providerIcon?: ProviderIconConfig | null
  /** 兼容旧版 payload，运行时会映射到 defaultModel */
  model?: string
  /** 传入 null 可清除自定义 Endpoint */
  apiEndpoint?: string | null
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  supportsMillionContext?: boolean
  /** 自定义上下文窗口（tokens）。传 0 清除自定义；undefined 不修改；优先级高于 supportsMillionContext。 */
  contextWindow?: number
  /** 文本任务默认最大输出 tokens。传 0 清除；undefined 不修改。 */
  maxTokens?: number
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
  /** 多媒体平台 adapter 种类；传 null 清除 */
  mediaProvider?: MediaProviderKind | null
  /** 多媒体调用方式；传 null 清除 */
  mediaApiType?: MediaApiType | null
  /** 已声明支持的多媒体能力列表；传空数组清空 */
  mediaCapabilities?: MediaCapabilityId[]
  /** 多媒体能力默认值 */
  mediaDefaults?: ProviderMediaDefaults
  /** 启用的多媒体模型 manifest 引用 */
  mediaModelRefs?: ProviderMediaModelRef[]
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

export interface ProviderConnectionTestRequest {
  /** 已保存 profile 可传 id；apiKey 留空时主进程会读取 Keychain 中的现有 key */
  id?: string
  provider: string
  apiEndpoint?: string | null
  defaultModel: string
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  apiKey?: string
}

export interface ProviderFetchedModel {
  id: string
  ownedBy?: string | null
}

export interface ProviderFetchModelsRequest {
  /** 已保存 profile 可传 id；apiKey 留空时主进程会读取 Keychain 中的现有 key */
  id?: string
  provider: string
  apiEndpoint?: string | null
  apiKey?: string
  /** 精确覆写模型列表 endpoint；为空时从 apiEndpoint 生成候选 URL */
  modelsUrl?: string | null
  /** apiEndpoint 是完整 endpoint 而非 base URL 时启用 */
  isFullUrl?: boolean
}

export interface ProviderFetchModelsResponse {
  models: ProviderFetchedModel[]
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
  /** 该 workspace 为 git worktree 时的元数据，否则 null */
  worktreeMeta: {
    baseRepoRoot: string
    branch: string
    baseBranch: string
    baseWorkspaceId?: string
  } | null
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

export interface WorkspaceGitFileChange {
  path: string
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  additions: number
  deletions: number
}

export interface WorkspaceGitStatusRequest {
  workspaceId: string
}

export interface WorkspaceGitStashEntry {
  index: number
  selector: string
  hash: string
  date: string | null
  message: string
}

export interface WorkspaceGitStatusResponse {
  isGitRepo: boolean
  currentBranch: string | null
  branches: string[]
  ahead: number
  behind: number
  additions: number
  deletions: number
  changedFiles: number
  stagedFiles: number
  unstagedFiles: number
  untrackedFiles: number
  hasRemote: boolean
  remoteName: string | null
  remoteBranch: string | null
  pullRequestUrl: string | null
  stashEntries: WorkspaceGitStashEntry[]
  files: WorkspaceGitFileChange[]
}

export interface WorkspaceGitCheckIgnoreRequest {
  workspaceId: string
  paths: string[]
}

export interface WorkspaceGitCheckIgnoreResponse {
  ignoredPaths: string[]
}

export interface WorkspaceGitCommitRequest {
  workspaceId: string
  message: string
  includeUnstaged?: boolean
  push?: boolean
}

export interface WorkspaceGitCommitResponse {
  committed: boolean
  pushed: boolean
  commitSha: string | null
  status: WorkspaceGitStatusResponse
}

export interface WorkspaceGitPushRequest {
  workspaceId: string
}

export interface WorkspaceGitPushResponse {
  pushed: boolean
  status: WorkspaceGitStatusResponse
}

export interface WorkspaceGitFileDiffRequest {
  workspaceId: string
  path: string
  untracked?: boolean
}

export interface WorkspaceGitFileDiffResponse {
  diff: string
  isBinary: boolean
}

export interface WorkspaceCreateBranchRequest {
  workspaceId: string
  branch: string
}

export interface WorkspaceCreateBranchResponse {
  currentBranch: string
  branches: string[]
  status: WorkspaceGitStatusResponse
}

export interface WorktreeInfo {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isCurrent: boolean
  isMerged: boolean
  workspaceId?: string
  sessionTitle?: string
}

export interface WorkspaceListWorktreesRequest {
  workspaceId: string
}
export interface WorkspaceListWorktreesResponse {
  isGitRepo: boolean
  baseBranch: string | null
  /** 主仓库根的绝对路径；合并需在主仓库执行（base 分支无法在子 worktree 检出） */
  baseRepoRoot: string | null
  worktrees: WorktreeInfo[]
}

export interface WorkspaceCreateWorktreeRequest {
  baseWorkspaceId: string
  /** 显式分支名；留空则由 LLM 根据 taskText 生成（回退到任务 slug / 时间戳） */
  branch?: string
  baseBranch?: string
  /** 任务描述（通常是首条消息），用于 LLM 生成分支名 */
  taskText?: string
  /** 用于生成分支名的 provider profile 与模型（解析 API key/endpoint） */
  providerProfileId?: string
  model?: string
}
export interface WorkspaceCreateWorktreeResponse {
  workspace: WorkspaceInfo
}

export interface WorkspaceRemoveWorktreeRequest {
  workspaceId: string
  force?: boolean
}
export interface WorkspaceRemoveWorktreeResponse {
  removed: boolean
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
  /**
   * 允许在同一个对话框里同时选择「文件」和「目录」。
   * 开启时 properties 会带上 'openDirectory'（macOS 原生支持混选）。
   * 用于「添加相关文件或目录」这类需要目录引用的场景。
   */
  allowDirectories?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface DialogOpenFileResponse {
  canceled: boolean
  filePath?: string
  filePaths?: string[]
}

export interface DialogSaveFileRequest {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface DialogSaveFileResponse {
  canceled: boolean
  filePath?: string
}

export interface FileWriteTextRequest {
  path: string
  content: string
}

export interface FileWriteTextResponse {
  success: boolean
}

export interface FileReadTextRequest {
  path: string
}

export interface FileReadTextResponse {
  content: string
}

export interface ClipboardWriteTextRequest {
  text: string
}

export interface ClipboardWriteTextResponse {
  success: boolean
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
  canvasProjectsRoot: string
  databasePath: string
  databaseBytes: number
  cacheBytes: number
  projectsBytes: number
  canvasProjectsBytes: number
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
  /** Claude SDK control_request id, retained for out-of-band audit/correlation. */
  sdkRequestId?: string
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
  | 'deny-session'
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
  authStatus?: 'unconfigured' | 'needs-auth' | 'authorizing' | 'authorized' | 'failed'
}

export interface McpAuthorizeRequest {
  serverId: string
}
export interface McpAuthorizeResponse {
  authorized: boolean
}
export interface McpDeauthorizeRequest {
  serverId: string
}
export interface McpDeauthorizeResponse {
  deauthorized: boolean
}
export interface McpAuthStatusRequest {
  serverId: string
}
export interface McpAuthStatusResponse {
  status: 'unconfigured' | 'needs-auth' | 'authorizing' | 'authorized' | 'failed'
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

/** 单条环境变量：键名 / 键值 / 描述。键值为真实值（仅本机存储），脱敏只发生在注入提示词时。 */
export interface EnvVarItem {
  key: string
  value: string
  description?: string
}

/** 某一层级（项目/会话）的环境变量集合。 */
export interface EnvVarLayerValue {
  enabled: boolean
  vars: EnvVarItem[]
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

/** SkillHub 子分区：推荐精选（/api/v1/showcase/recommended）/ 下载热榜（/api/skills?sortBy=downloads） */
export type SkillHubShowcaseSection = 'recommended' | 'hot_downloads'

export interface SkillRegistryFeaturedRequest {
  registryId?: string
  limit?: number
  /** 仅 SkillHub 等支持多子分区的市场使用；其他市场忽略 */
  section?: SkillHubShowcaseSection
  /** 分类 key（如 SkillHub 的 office-efficiency / content-creation）；非空时透传给后端 */
  category?: string
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

export interface SkillRegistryCategoryItem {
  /** 分类 key（透传给后端做过滤，如 office-efficiency） */
  key: string
  /** 分类显示名（中文 / 英文，按后端返回原样） */
  name: string
}

export interface SkillRegistryCategoriesResponse {
  /** 已 prepend "全部"（key='all', name='全部'） */
  categories: SkillRegistryCategoryItem[]
}

// ─── Installable Skill Catalog（内置可安装技能卡片） ─────────────────────

/** 可安装技能的来源（与 InstallableSkillSource 运行时定义对齐） */
export interface InstallableSkillSourceInfo {
  type: 'artifact' | 'tarball' | 'github'
  repo?: string
  ref?: string
  path?: string
  artifactId?: string
  manifestUrl?: string
  fallback?: {
    type: 'tarball' | 'github'
    repo: string
    ref?: string
    path?: string
  }
}

/** 内置可安装技能清单中的一条（含运行时安装状态） */
export interface InstallableSkillCatalogItem {
  /** 卡片唯一标识 */
  id: string
  /** 落盘后的目录名（slug），安装状态判断与去重以此为准 */
  slug: string
  /** 显示名 */
  name: string
  /** 一句话描述 */
  description: string
  /** 图标 emoji */
  icon: string
  /** 作者 / 来源标注 */
  author: string
  /** 标签 */
  tags: string[]
  /** 来源信息 */
  source: InstallableSkillSourceInfo
  /** 主页 URL */
  homepageUrl?: string
  /** 安装后是否需要额外运行时依赖提示 */
  postInstallHint?: string
  /** 当前是否已安装 */
  installed: boolean
  /** 安装后的本地技能 ID */
  localId?: string
}

export interface SkillListInstallableRequest {}

export interface SkillListInstallableResponse {
  items: InstallableSkillCatalogItem[]
}

export interface SkillInstallCatalogRequest {
  /** 目录条目的 slug */
  slug: string
}

export interface SkillInstallCatalogResponse {
  skill: SkillItem
  /** 安装后提示（如依赖说明），用于 toast 展示 */
  postInstallHint?: string
}

export interface SkillInstallCatalogProgress {
  slug: string
  source: SkillInstallJobSource
  /** 已下载字节数 */
  downloaded: number
  /** 总字节数（未知为 0） */
  total: number
}

export type SkillInstallJobSource = 'catalog' | 'skillhub'
export type SkillInstallJobState = 'installing' | 'installed' | 'failed'

export interface SkillInstallStatusItem {
  slug: string
  source: SkillInstallJobSource
  state: SkillInstallJobState
  downloaded: number
  total: number
  updatedAt: string
  skillId?: string
  skillName?: string
  error?: string
}

export interface SkillInstallStatusRequest {}

export interface SkillInstallStatusResponse {
  installations: SkillInstallStatusItem[]
}

export interface SkillUninstallCatalogRequest {
  slug: string
}

export interface SkillUninstallCatalogResponse {
  success: boolean
}

/** 从远程市场安装技能（目前支持 SkillHub：zip 整包，腾讯云 COS 加速） */
export interface SkillInstallRemoteRequest {
  /** 市场 ID（目前支持 "skillhub"） */
  registryId: string
  /** 远程技能 slug */
  slug: string
  /** 可选指定版本，缺省取 latestVersion */
  version?: string
}

export interface SkillInstallRemoteResponse {
  skill: SkillItem
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

export interface EnvConfigGetRequest {
  workspaceId?: string
  sessionId?: string
  agentId?: string
}

export interface EnvConfigGetResponse {
  project: EnvVarLayerValue
  session: EnvVarLayerValue
  /** 合并后生效的环境变量（会话级覆盖项目级），真实值，仅供主进程注入使用。 */
  effectiveEnv: Record<string, string>
}

export interface EnvConfigUpdateRequest {
  scope: Extract<RuntimeConfigScope, 'project' | 'session'>
  scopeRef: string
  value: EnvVarLayerValue
}

export interface EnvConfigUpdateResponse extends EnvConfigGetResponse {}

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
  /** 单次 dispatch 超时（毫秒）。缺省 600_000（10 分钟），上限 1_800_000。
   *  Host 在 task.timeoutMs 中可按任务覆盖（仍受上限约束）。 */
  dispatchTimeoutMs?: number
  /** 当本配置由某个长期团队（ManagedTeam）应用而来时，此字段指向 ManagedTeam.id。
   *  会话仍以本配置为运行时权威；Inspector 可据此提供「保存修改回团队」入口。
   *  允许显式 undefined，便于 patch 风格的"解除关联"。 */
  teamId?: string | undefined
  /** 一场团队讨论最多允许多少轮（team_round_advance 调用次数）。
   *  默认 6，后端硬上限 20。老会话未带该字段时按默认 6 处理（零迁移兼容）。 */
  maxDiscussionRounds?: number | undefined
  /** 是否允许成员之间互发对等消息（agent_message 工具注入到成员）。
   *  默认 false：老会话/老 ManagedTeam 行为与现状完全一致（灰度放量）。 */
  enablePeerMessaging?: boolean | undefined
  /** 注入成员/被 @ agent 的共享讨论快照 token 预算，缺省 6000（DEFAULT_THREAD_TOKEN_BUDGET）。
   *  只影响「默认注入多少历史正文」；全文可用 team_thread_read 工具按需读取。 */
  threadContextTokenBudget?: number | undefined
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
  /** 一场团队讨论最多允许多少轮（缺省 6，硬上限 20）。会话应用团队时映射到 TeamModeConfig。 */
  maxDiscussionRounds?: number | undefined
  /** 是否允许成员间对等消息（缺省 false，灰度）。会话应用团队时映射到 TeamModeConfig。 */
  enablePeerMessaging?: boolean | undefined
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
  maxDiscussionRounds?: number | undefined
  enablePeerMessaging?: boolean | undefined
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
  | 'loop'

export interface WorkflowNodeConfig {
  prompt?: string
  role?: string
  modelId?: string | null
  providerProfileId?: string | null
  skillIds?: string[]
  toolIds?: string[]
  mcpServerIds?: string[]
  ruleIds?: string[]
  retryCount?: number
  outputKey?: string
  agentId?: string | null
  parallelism?: number
  verifyCommands?: string[]
  /** 原子节点执行模式：'static' 走静态回显（兼容/降本），缺省/'auto' 走真实执行。仅 input 永远透传。 */
  execution?: 'auto' | 'static'
  /** artifact 节点导出目标：工作区相对路径，配置后把最终内容写入该文件（防穿越，须在工作区内）。 */
  exportPath?: string
  /** loop 节点循环体：一张独立的 WorkflowGraph，v1 不支持嵌套 loop。 */
  body?: WorkflowGraph
  /** loop 节点最大迭代次数：缺省 5，运行时硬上限 50。 */
  maxIterations?: number
  /** loop 节点每轮结束后针对循环体 state 求值，满足即退出。 */
  breakCondition?: WorkflowEdgeCondition | undefined
  /** loop 节点注入循环体 state 的迭代序号键名，缺省 __loop_index。 */
  loopVar?: string
  /** loop 节点从循环体 state 读取的本轮产出键；缺省取循环体最后一个 outputKey。 */
  resultKey?: string
  /** loop 节点是否把每轮 resultKey 产出全部聚合；缺省 false，只返回最后一轮。 */
  collectAll?: boolean
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
  condition?: WorkflowEdgeCondition
}

export type WorkflowEdgeCondition =
  | { op: 'exists'; key: string }
  | { op: 'equals'; key: string; value: string | number | boolean | null }
  | { op: 'not_equals'; key: string; value: string | number | boolean | null }
  | { op: 'truthy'; key: string }
  | { op: 'falsy'; key: string }

export type WorkflowOrientation = 'horizontal' | 'vertical'

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  /**
   * 编排方向：决定节点 handle 朝向与连接线路由（横向 = 左右 handle，纵向 = 上下 handle）。
   * 旧数据缺省时按 'horizontal' 处理，保持向后兼容。运行时执行器不读取此字段。
   * 仅 'vertical' 时写入持久化 JSON，'horizontal' 省略以保持旧 JSON 整洁。
   */
  orientation?: WorkflowOrientation
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

// ─── GitHub Connector Channels ─────────────────────────────────────────────

export interface GitHubConnectorVerifyRequest {
  /** Fine-grained PAT，仅用于本次验证。 */
  token: string
  /** 可选：GitHub Enterprise API base URL。默认 https://api.github.com */
  apiBaseUrl?: string
}

export interface GitHubConnectorVerifyResponse {
  accountLogin: string
  accountAvatarUrl?: string
}

export interface GitHubConnectorGetRequest {}

export interface GitHubConnectorGetResponse {
  connection: GitHubConnectorConnection | null
}

export interface GitHubConnectorConnectRequest {
  token: string
  name?: string
  apiBaseUrl?: string
  webBaseUrl?: string
  selectedRepos?: string[]
  enabledCapabilities?: ConnectorCapabilityKind[]
  allowWrites?: boolean
}

export interface GitHubConnectorConnectResponse {
  connection: GitHubConnectorConnection
}

export interface GitHubConnectorUpdateRequest {
  name?: string
  authMethod?: ConnectorAuthMethod
  apiBaseUrl?: string
  webBaseUrl?: string
  selectedRepos?: string[]
  enabledCapabilities?: ConnectorCapabilityKind[]
  allowWrites?: boolean
  enabled?: boolean
}

export interface GitHubConnectorUpdateResponse {
  connection: GitHubConnectorConnection
}

export interface GitHubConnectorDisconnectRequest {}

export interface GitHubConnectorDisconnectResponse {
  disconnected: boolean
}

// ─── Settings Channels ──────────────────────────────────────────────────────

// ─── Memory（记忆系统 V2）──────────────────────────────────────────────────
export type MemoryScope = 'user' | 'project' | 'agent'
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

/** 记忆条目 DTO（渲染端用；字段驼峰，与 storage 的 MemoryEntryRow 隔离） */
export interface MemoryEntry {
  id: string
  scope: MemoryScope
  scopeRef: string | null
  type: MemoryType
  name: string
  description: string
  confidence: number
  hitCount: number
  lastHitAt: number | null
  sourceSessionId: string | null
  archived: boolean
  createdAt: number
  updatedAt: number
  validFrom: number | null
  invalidAt: number | null
  supersededBy: string | null
}

export interface MemoryListRequest {
  scope?: MemoryScope
  scopeRef?: string | null
  type?: MemoryType
  includeArchived?: boolean
  includeInvalid?: boolean
}
export interface MemoryListResponse {
  entries: MemoryEntry[]
}
export interface MemoryGetRequest {
  id: string
}
export interface MemoryGetResponse {
  entry: MemoryEntry | null
  body: string
}
export interface MemoryCreateRequest {
  scope: MemoryScope
  scopeRef: string | null
  type: MemoryType
  name: string
  description: string
  body: string
  entities?: string[]
}
export interface MemoryCreateResponse {
  entry: MemoryEntry
}
export interface MemoryUpdateRequest {
  id: string
  description?: string
  body?: string
  type?: MemoryType
}
export interface MemoryUpdateResponse {
  entry: MemoryEntry
}
export interface MemoryArchiveRequest {
  id: string
}
export interface MemoryArchiveResponse {
  ok: boolean
}
export interface MemoryDeleteRequest {
  id: string
}
export interface MemoryDeleteResponse {
  ok: boolean
}
export interface MemoryRebuildVectorsRequest {}
export interface MemoryRebuildVectorsResponse {
  ok: boolean
  reason?: string
}

/** 主动探测抽取配置是否可用（避免静默失败，审查 HIGH#6） */
export interface MemoryTestExtractionRequest {}
export interface MemoryTestExtractionResponse {
  ok: boolean
  /** 抽取配置来源：'settings' | 'fallback'（agent 对话模型回退）| 'none' */
  source: 'settings' | 'fallback' | 'none'
  providerId?: string
  model?: string
  reason?: string
  /** 探测 LLM 返回的样本文本（截断） */
  sample?: string
}

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

// ─── Log Channels ─────────────────────────────────────────────────────────────
// 本地日志读取与管理。日志路径由主进程 initFileLogger 决定（app.getPath('logs')）。

/** 日志级别，与 @spark/shared 的 LogLevel 保持值集一致。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogReadRequest {
  /** 返回的最近行数，默认 500。上限 5000，避免一次性回读超大文件。 */
  maxLines?: number
  /** 仅返回这些级别的行；为空/缺省表示不过滤。 */
  levels?: LogLevel[]
}

export interface LogReadResponse {
  lines: string[]
  filePath: string | null
  sizeBytes: number
}

export interface LogClearRequest {}

export interface LogClearResponse {
  ok: boolean
}

export interface LogRevealRequest {}

export interface LogRevealResponse {
  ok: boolean
}

// ─── Board Task Channels ──────────────────────────────────────────────────────

export type BoardTaskStatus = 'todo' | 'in-progress' | 'done' | 'accepted' | 'closed' | 'bug-fix'
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
  processingAgent: string
  acceptanceCriteria: string
  testAgent: string
  comments: BoardComment[]
  attachments: BoardTaskAttachment[]
  sortOrder: number
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
  processingAgent?: string
  acceptanceCriteria?: string
  testAgent?: string
  attachments?: BoardTaskAttachment[]
  sortOrder?: number
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
  processingAgent?: string
  acceptanceCriteria?: string
  testAgent?: string
  attachments?: BoardTaskAttachment[]
  sortOrder?: number
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
  reasoningOutputTokens?: number
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
    totalReasoningOutputTokens: number
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
    totalReasoningOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    totalCostUsd: number
    recordCount: number
  }
  currentMonth: {
    totalInputTokens: number
    totalOutputTokens: number
    totalReasoningOutputTokens: number
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
    totalReasoningOutputTokens: number
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
    reasoning_output_tokens: number
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
    totalReasoningOutputTokens: number
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
    totalReasoningOutputTokens: number
    totalCostUsd: number
    recordCount: number
  }>
  dailyGroups: Array<{
    date: string
    totalInputTokens: number
    totalOutputTokens: number
    totalReasoningOutputTokens: number
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
  lastCheckedAt?: string | null
  updateSource?: 'version-center' | 'github' | null
  downloadSource?: 'version-center' | 'github' | null
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
  autoInstall?: boolean
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

export type ExternalToolKind = 'ide' | 'terminal' | 'document'

export interface ExternalToolInfo {
  /** Tool unique identifier (e.g. "vscode", "iterm2") */
  id: string
  /** Display name */
  name: string
  /** Kind: IDE, terminal, or document app */
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

export interface ToolOpenFolderRequest {
  /** Folder path to open in the OS file manager (Finder on macOS, Explorer on Windows) */
  rootPath: string
}

export interface ToolOpenFolderResponse {
  opened: boolean
  /** Error message returned by shell.openPath when it fails; undefined on success */
  error?: string
}

// ─── Built-in Terminal Panel (session-scoped PTY dock) ─────────────────────

/**
 * PTY terminal id, opaque to renderer.
 *
 * Identifies a node-pty process owned by the main process. Lifecycle is
 * independent of the renderer panel — closing the panel only hides UI; only
 * explicit `terminal:kill` (e.g. closing the last tab) terminates the PTY.
 */
export type TerminalId = string

export type TerminalStatus = 'running' | 'exited' | 'error'

export interface TerminalSessionInfo {
  id: TerminalId
  sessionId: SessionId
  workspaceId?: string
  title: string
  cwd: string
  shell: string
  pid?: number
  cols: number
  rows: number
  status: TerminalStatus
  createdAt: string
  updatedAt: string
  exitCode?: number
  signal?: number
}

export interface TerminalListRequest {
  sessionId: SessionId
}

export interface TerminalListResponse {
  terminals: TerminalSessionInfo[]
}

export interface TerminalListActiveRequest {}

export interface TerminalSessionActivity {
  sessionId: SessionId
  running: number
  total: number
}

export interface TerminalListActiveResponse {
  sessions: TerminalSessionActivity[]
}

export interface TerminalCreateRequest {
  sessionId: SessionId
  workspaceId?: string
  /** Override cwd; main process validates against the workspace root. */
  cwd?: string
  /** Tab title; defaults to workspace name. */
  title?: string
  /** Initial pty cols; ignored if omitted, fit on first renderer resize. */
  cols?: number
  /** Initial pty rows. */
  rows?: number
}

export interface TerminalCreateResponse {
  terminal: TerminalSessionInfo
  /** Optional welcome output captured before stream subscription (usually empty). */
  initialOutput?: string
}

export interface TerminalInputRequest {
  terminalId: TerminalId
  data: string
}

export interface TerminalInputResponse {
  accepted: boolean
}

export interface TerminalResizeRequest {
  terminalId: TerminalId
  cols: number
  rows: number
}

export interface TerminalResizeResponse {
  resized: boolean
}

export interface TerminalKillRequest {
  terminalId: TerminalId
}

export interface TerminalKillResponse {
  killed: boolean
}

export interface TerminalRenameRequest {
  terminalId: TerminalId
  title: string
}

export interface TerminalRenameResponse {
  terminal: TerminalSessionInfo
}

export interface TerminalGetBufferRequest {
  terminalId: TerminalId
}

export interface TerminalGetBufferResponse {
  /** Cached output since the last renderer attach; may be empty if the PTY just started. */
  output: string
}

/**
 * Streamed events for the built-in terminal panel. Main → renderer fan-out.
 *
 * Renderer filters by `sessionId` to keep tabs isolated when the user
 * switches sessions.
 */
export type TerminalStreamEvent =
  | { type: 'created'; terminal: TerminalSessionInfo }
  | { type: 'data'; terminalId: TerminalId; sessionId: SessionId; data: string }
  | {
      type: 'exit'
      terminalId: TerminalId
      sessionId: SessionId
      exitCode?: number
      signal?: number
    }
  | { type: 'updated'; terminal: TerminalSessionInfo }
  | { type: 'removed'; terminalId: TerminalId; sessionId: SessionId }
  | { type: 'error'; terminalId?: TerminalId; sessionId?: SessionId; message: string }

// ─── Command Channels ────────────────────────────────────────────────────────

export type CommandLayer = 'sdk' | 'builtin' | 'skill' | 'custom'

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

export interface CommandPaletteMeta {
  hidden?: boolean
}

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
  palette?: CommandPaletteMeta
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
  /** Current Playwright run mode (headful shows Playwright's own browser) */
  mode: 'headful' | 'headless'
  /** Legacy embedded view flag; always false after spark_browser replaced it. */
  viewOpen: boolean
  /** Legacy CDP endpoint; always null after global CDP 9223 was removed. */
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

// ─── FFmpeg Integrity & Video Processing Channels ────────────────────────────

/**
 * FFmpeg 二进制完整性状态。由 `FfmpegIntegrityService` 产出，供设置-完整性面板展示。
 */
export interface FfmpegStatusRequest {}

export interface FfmpegStatusResponse {
  /** ffmpeg 是否可用 */
  ffmpegReady: boolean
  /** 'managed' = 从 minio 下载的；'system' = 系统 PATH；'none' = 不可用 */
  ffmpegSource: 'managed' | 'system' | 'none'
  /** ffmpeg 版本号（从 `ffmpeg -version` 解析） */
  ffmpegVersion: string | null
  /** ffprobe 是否可用（关键帧时间戳解析需要） */
  ffprobeReady: boolean
  /** ffmpeg 可执行文件路径 */
  binaryPath: string | null
  /** 上次安装/检测的错误信息 */
  lastError: string | null
}

export interface FfmpegInstallRequest {
  /** 可选：指定 manifest 里的 artifactId；缺省按当前平台自动选 */
  artifactId?: string
}

export interface FfmpegInstallResponse {
  success: boolean
  message?: string
}

export interface FfmpegInstallProgress {
  state: 'starting' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  /** 0~100；null 表示无法计算（如纯 JS 解压阶段） */
  percent: number | null
  message: string
  logLine: string | null
}

/**
 * 视频处理操作请求（通用 invoke，覆盖 probe/抽帧/剪辑/转码/画面处理）。
 *
 * 每个 operation 对应 FfmpegRunner 的一个方法，params 是该方法参数的序列化形式。
 * 进度通过 `stream:video:process-progress` 推送（按 requestId 关联）。
 */
export interface VideoProcessRequest {
  /** 操作类型 */
  operation:
    | 'probe'
    | 'extractKeyframes'
    | 'extractFramesAtTimes'
    | 'generateThumbnail'
    | 'trim'
    | 'concat'
    | 'segment'
    | 'transcode'
    | 'adjustSpeed'
    | 'reverse'
    | 'crop'
    | 'watermark'
    | 'burnSubtitle'
  /** 源视频文件绝对路径 */
  input: string
  /** 各操作的参数（结构因 operation 而异） */
  params: Record<string, unknown>
  /** 用于关联进度推送的唯一 id */
  requestId: string
}

export interface VideoProcessResponse {
  success: boolean
  /** 操作结果（结构因 operation 而异，如 probe 返回 VideoProbeInfo、抽帧返回帧列表） */
  result?: unknown
  error?: string
}

export interface VideoProcessProgress {
  requestId: string
  percent: number
  stage: string
}

/** 通用二进制产物安装（ffmpeg 等非技能包） */
export interface BinaryInstallRequest {
  artifactId: string
}

export interface BinaryInstallResponse {
  success: boolean
  destPath?: string
  message?: string
}

export interface BinaryInstallProgress {
  artifactId: string
  downloaded: number
  total: number
}

export interface BrowserOpenExternalRequest {
  url?: string
}

export interface BrowserOpenExternalResponse {
  success: boolean
}

// ─── Window Control Channels ───────────────────────────────────────────────────

export interface WindowMinimizeRequest {}
export interface WindowMinimizeResponse {
  success: boolean
}
export interface WindowMaximizeRequest {}
export interface WindowMaximizeResponse {
  success: boolean
  maximized: boolean
}
export interface WindowCloseRequest {}
export interface WindowCloseResponse {
  success: boolean
}
export interface WindowIsMaximizedRequest {}
export interface WindowIsMaximizedResponse {
  maximized: boolean
}
export interface WindowSetZoomRequest {
  zoomPercent: number
}
export interface WindowSetZoomResponse {
  success: boolean
  zoomPercent: number
}
export interface WindowEnsureWidthRequest {
  minWidth: number
  allowShrink?: boolean
  /**
   * 是否允许把窗口拉宽到 minWidth。
   * 默认 true（保持向后兼容）。
   *
   * 设置成 false 时，IPC 只会主动缩小窗口或保持当前宽度，
   * 绝不会把一个用户已经主动拖窄的窗口拉回更大的尺寸。
   * 用于在窗口 resize 回调里避免和用户的拖动意图打架，
   * 防止"缩小一点又弹回来"的视觉循环。
   */
  allowGrow?: boolean
}
export interface WindowEnsureWidthResponse {
  success: boolean
  width: number
  changed: boolean
}

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

// ─── File Reveal Channel ─────────────────────────────────────────────────────

export interface FileRevealRequest {
  /** Absolute path to the file or directory to highlight in the OS file manager. */
  filePath: string
}

export interface FileRevealResponse {
  /** True when shell.showItemInFolder was invoked. */
  revealed: boolean
  /** Populated when the path is invalid or the call failed. */
  error?: string
}

// ─── File Read Channel ───────────────────────────────────────────────────────

export interface FileReadRequest {
  /** Absolute path to the file to read. */
  filePath: string
}

export interface FileReadResponse {
  /** File content as UTF-8 string. */
  content?: string
  /** Populated with the error message when the read failed. */
  error?: string
}

// ─── File Save / Download Channels ────────────────────────────────────────────

/**
 * `file:save-image` — 让用户把生成的图片 / 附件另存到本地。
 *
 * 使用场景：
 *   - 会话里 agent 生成的图片（路径在 userData 或 workspace 的 .spark-artifacts 下），
 *     用户想保存到自己的下载目录或桌面。
 *   - 附件中的图片想"另存为"。
 *
 * 行为：
 *   - 主进程会调 `dialog.showSaveDialog` 让用户选择目标位置 + 文件名，
 *     然后把源文件复制过去。如果用户取消对话框，返回 saved:false 且无 error。
 *   - 源文件必须在 safe-file 白名单目录（userData / temp / workspace .spark-artifacts）下，
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
 * `file:save-pasted-image` — 把渲染进程剪贴板里的图片数据写入本地目录，
 * 返回绝对路径，供会话附件或画布资产继续复用。
 */
export interface FileSavePastedImageRequest {
  /** `data:image/png;base64,...` 形式的数据 URL */
  dataUrl: string
  /** 可选 MIME 类型；主进程会优先从 dataUrl 中解析 */
  mimeType?: string
  /** 可选建议文件名前缀，不含扩展名 */
  suggestedBaseName?: string
  /** 默认写临时目录；画布项目使用持久目录。 */
  storageScope?: 'temp' | 'canvas'
  /** 画布项目目录；提供时写入该项目的 assets/images。 */
  projectRootPath?: string
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

/** 路径类别探测：用于「添加相关文件或目录」在前端判断选中项是文件还是目录 */
export type FileStatKind = 'file' | 'directory' | 'absent'

export interface FileStatKindRequest {
  path: string
}

export interface FileStatKindResponse {
  /** 路径不存在时为 'absent' */
  kind: FileStatKind
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

// ─── Scheduled Task Import/Export ────────────────────────────────────────────

/**
 * `scheduled-task:export` — 内存内构造 ExportPayload（不写文件）。
 * 调用方一般会立刻跟 `scheduled-task:export-to-file` 写盘。
 */
export interface ScheduledTaskExportRequest {
  /** 要导出的任务 id 列表；空数组表示导出全部 */
  ids: string[]
}

export interface ScheduledTaskExportResponse {
  payload: ScheduledTaskExportPayload
}

/**
 * `scheduled-task:import` — 直接在内存里导入 ExportPayload。
 * 主要被 `scheduled-task:import-from-file` 在读取文件后调用。
 */
export interface ScheduledTaskImportRequest {
  payload: ScheduledTaskExportPayload
  mode: ScheduledTaskImportMode
}

export interface ScheduledTaskImportResponse extends ScheduledTaskImportResult {}

/**
 * `scheduled-task:export-to-file` — 弹保存对话框并写入 .json。
 * 返回 filePath 供 UI 提示用户。
 */
export interface ScheduledTaskExportToFileRequest {
  ids: string[]
}

export interface ScheduledTaskExportToFileResponse {
  /** 实际写入路径；用户取消时为空字符串 */
  filePath: string
  /** 写入的任务数量（仅用于 UI 反馈）*/
  count: number
}

/**
 * `scheduled-task:import-from-file` — 弹打开对话框、读文件、解析为 payload。
 * 实际写入数据库需要再调用 `scheduled-task:import`（让 UI 走预览流程）。
 */
export interface ScheduledTaskImportFromFileRequest {}

export interface ScheduledTaskImportFromFileResponse {
  /** 用户取消时为 null */
  payload: ScheduledTaskExportPayload | null
  /** 实际读取路径（成功或失败时都填，方便 UI 提示）*/
  filePath: string
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
export type RemoteConnectionStatus =
  | 'disabled'
  | 'draft'
  | 'pending-pairing'
  | 'connected'
  | 'error'
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
  observeDesktop: boolean
  controlDesktop: boolean
  useInternalBrowser: boolean
  transferFiles: boolean
  manageRuntime: boolean
  dangerousActions: boolean
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

export type SystemNotificationNavigateReason = HookNode | 'plan_approval'

export type SystemNotificationViewTarget =
  | 'chat'
  | 'workflows'
  | 'agents'
  | 'board'
  | 'canvas'
  | 'scheduled-tasks'
  | 'skills'
  | 'skill-store'
  | 'mcp'
  | 'providers'
  | 'settings'
  | 'lobe-preview'
  | 'account-center'
  | 'onboarding'

export type SystemNotificationNavigateRequest =
  | { target: 'session'; sessionId: string; reason?: SystemNotificationNavigateReason }
  | {
      target: 'view'
      view: SystemNotificationViewTarget
      reason?: SystemNotificationNavigateReason
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

// ─── Canvas Media Generation Channels ────────────────────────────────────────

/**
 * `canvas:media-capabilities:list` — 列出当前可用于画布多媒体任务的 provider profile。
 *
 * 返回的 profile 不含 API key（key 只在主进程内用于实际调用）。
 * 渲染进程据此决定哪些 operation（文生图 / 文生音频 / 文生视频 / 图生视频）可用。
 */
export interface CanvasMediaCapabilityItem {
  providerProfileId: string
  name: string
  defaultModel: string
  mediaProvider: MediaProviderKind | null
  mediaApiType: MediaApiType | null
  mediaCapabilities: MediaCapabilityId[]
  mediaModels?: CanvasMediaModelSummary[]
}

export interface CanvasMediaCapabilitiesListRequest {}

export interface CanvasMediaCapabilitiesListResponse {
  providers: CanvasMediaCapabilityItem[]
}

export interface CanvasMediaModelCapabilitySummary {
  id: string
  label: string
  input: MediaModelManifest['capabilities'][number]['input']
  output: MediaModelManifest['capabilities'][number]['output']
  paramSchema: Record<string, unknown>
  defaults?: Record<string, unknown>
}

export interface CanvasMediaModelSummary {
  manifestId: string
  providerProfileId?: string
  providerName?: string
  providerIcon?: ProviderIconConfig
  providerKind: string
  modelId: string
  effectiveModelId: string
  displayName: string
  domains: MediaModelManifest['domains']
  invocationMode: MediaModelManifest['invocation']['mode']
  capabilities: CanvasMediaModelCapabilitySummary[]
  sourceUrls: string[]
  enabled: boolean
  defaults?: Record<string, unknown>
}

export interface CanvasMediaModelsListRequest {
  providerProfileId?: string
  providerKind?: string
  capability?: string
  enabledOnly?: boolean
  /** Return global manifest catalog instead of only configured provider-bound models. */
  catalogOnly?: boolean
}

export interface CanvasMediaModelsListResponse {
  models: CanvasMediaModelSummary[]
}

export interface CanvasMediaModelDescribeRequest {
  manifestId: string
  providerProfileId?: string
}

export interface CanvasMediaModelDescribeResponse {
  manifest: MediaModelManifest | null
  model: CanvasMediaModelSummary | null
}

/**
 * `canvas:media:prune-model-params` — 画布提交前按目标 manifest 的 Contract V2
 * 裁剪 modelParams，避免上游节点继承 / preset / extraJson 中的字段误传给 provider
 * 触发 400。renderer 不直接持有 manifest，由 main 进程用 catalog 解析后调用
 * compileMediaRequest(mode='canvas')，返回裁剪结果与 droppedParams 供任务详情展示。
 */
export interface CanvasMediaPruneModelParamsRequest {
  manifestId: string
  providerProfileId?: string | undefined
  capabilityId: string
  modelParams: Record<string, unknown>
  /**
   * 输入文件类型摘要，供 conditionals.drop_when_input_kind 判定（如 image_to_video
   * 场景下禁止 maxImages 等）。仅传 type/role 字符串数组，避免传整个文件 buffer。
   */
  inputFiles?: Array<{ type: string; role?: string | undefined }> | undefined
}

export interface CanvasMediaPruneModelParamsResponse {
  /** 裁剪后的 modelParams（已应用 aliases 映射、过滤 forbidden/local/unknown）。 */
  prunedModelParams: Record<string, unknown>
  /** 被丢弃的字段及原因，用于任务详情展示和 agent 自我纠正。 */
  droppedParams: MediaDroppedParam[]
  /** 非阻断性提示（如 missing_param_policy、compat_passthrough）。 */
  warnings: MediaContractWarning[]
  /** Schema 校验失败摘要（severity='error' 仍允许任务下发，但应在 UI 提示）。 */
  validationIssues: MediaContractIssue[]
  /** 解析失败时（manifest 不存在等）返回 fallback 原值，由调用方决定是否继续。 */
  fallbackReason?: string | undefined
}

/**
 * `canvas:media:prune-model-params-by-inline-manifest` — Provider 配置 UX 的 dry-run：
 * 用户在自定义 manifest 编辑器中改完 JSON 还未保存时，按 inline manifest + capabilityId
 * 试编译一次，看裁剪结果与 droppedParams，避免「保存后才发现 strict 误删字段」。
 *
 * 与 `prune-model-params` 不同：manifest 内联传入，不查 catalog，不需要 manifestId。
 */
export interface CanvasMediaPruneModelParamsByInlineManifestRequest {
  manifest: MediaModelManifest
  capabilityId: string
  modelParams: Record<string, unknown>
  inputFiles?: Array<{ type: string; role?: string | undefined }> | undefined
}

export interface CanvasMediaPruneModelParamsByInlineManifestResponse {
  prunedModelParams: Record<string, unknown>
  droppedParams: MediaDroppedParam[]
  warnings: MediaContractWarning[]
  validationIssues: MediaContractIssue[]
  fallbackReason?: string | undefined
}

/**
 * `canvas:task:create-media` — 通过平台 adapter 执行一次多媒体生成。
 *
 * 主进程解析可用 provider + API key（不外泄），调用 MediaRouterService，
 * 把产物落盘到 `.spark-artifacts/media/<kind>`，返回 asset 元信息。
 */
export interface CanvasMediaTaskInputFile {
  path?: string
  url?: string
  dataUrl?: string
  mimeType?: string
  type: 'image' | 'audio' | 'video' | 'file'
  role?: 'input' | 'first_frame' | 'last_frame' | 'reference' | 'mask'
}

export interface CanvasMediaTaskCreateRequest {
  /** Renderer-local canvas project id, used only for async stream routing. */
  projectId?: string
  /** Renderer-local canvas task id, used only for async stream routing. */
  clientTaskId?: string
  operation: CanvasOperationType
  prompt?: string
  negativePrompt?: string
  inputFiles?: CanvasMediaTaskInputFile[]
  /** 指定 provider profile；缺省由 router 自动选择首个支持该 capability 的 */
  providerProfileId?: string | null
  /** 指定 manifest；用于精确匹配 requestTemplate/response/polling。 */
  manifestId?: string | null
  /** 指定 provider 内实际调用的模型；缺省使用 Provider defaultModel / manifest 默认模型 */
  modelId?: string | null
  modelParams?: Record<string, unknown>
  /** false means return immediately and push completion through stream:canvas:media-task. */
  waitForCompletion?: boolean
  /** 产物落盘根目录；缺省使用 userData/.spark-artifacts/media */
  outputDir?: string
}

export interface CanvasMediaTaskAsset {
  type: 'image' | 'audio' | 'video' | 'text'
  filePath?: string
  url?: string
  /** 图片预览用的 data URL（仅小图回传，避免 renderer 无法访问 file://） */
  previewDataUrl?: string
  mimeType?: string
  width?: number
  height?: number
  durationMs?: number
  contentText?: string
}

export interface CanvasMediaTaskCreateResponse {
  runtimeTaskId?: string
  status?: 'running' | 'succeeded' | 'failed' | 'cancelled'
  providerProfileId: string
  provider: string
  model: string
  mode: 'sync' | 'async'
  requestId?: string
  assets: CanvasMediaTaskAsset[]
  rawResponse?: unknown
  /** 实际发给 provider 的请求摘要（method + url + 已截断 body），用于任务详情展示。 */
  requestCall?: MediaRequestCall
  error?: { code: string; message: string }
}

/**
 * `canvas:task:generate-text` — 通过文本模型(Provider)执行一次文本生成。
 * 覆盖 text_generate / text_rewrite / prompt_optimize；走 anthropic/openai-compatible chat。
 */
export interface CanvasTextTaskCreateRequest {
  operation: CanvasOperationType
  /** 用户提示词 / 待改写或优化的文本 */
  prompt: string
  /** 反向/约束提示词（可选，拼进 system） */
  negativePrompt?: string
  /**
   * 上游输入文件（如「提取风格」节点接的图片）。文本/多模态模型需要把图片作为
   * vision 输入随消息一起发送，否则诸如「请分析输入图片的视觉风格」之类的提示词
   * 因为没收到图而凭空作答。仅图片类型会被转成 vision 输入。
   */
  inputFiles?: CanvasMediaTaskInputFile[]
  /** 模型参数（如 temperature / maxTokens），透传给文本模型。 */
  modelParams?: Record<string, unknown>
  /** Spark 统一推理强度；主进程会按目标 provider/adapter 映射成合法枚举。 */
  reasoningEffort?: SessionReasoningEffort
  /** 指定 provider profile；缺省自动选第一个可用文本 provider */
  providerProfileId?: string | null
  /** 指定模型；缺省用 provider defaultModel */
  modelId?: string | null
  /**
   * 指定专属 agent（应用内 agent 管理配置的 ManagedAgent）。
   * 命中时：用 agent 的人设 prompt 作为 system，并在未显式指定 provider/model 时
   * 优先沿用 agent 绑定的 provider / model（实现「操作节点内指定专属 agent」）。
   */
  agentId?: string | null
  /** 文本任务额外启用的 Skill ID 列表；仅文本模型任务生效。 */
  skillIds?: string[]
  /** 任务在画布流水线中的语义角色；用于主进程启用特定运行策略（如分镜输出预算）。 */
  taskPipelineRole?: string | null
  /** false：立即返回 running，完成后通过 stream:canvas:text-task 推送（画布任务后台执行）。 */
  waitForCompletion?: boolean
  /** 后台模式：回写流事件时携带，供渲染端匹配到具体画布任务。 */
  projectId?: string
  /** 后台模式：渲染端的画布任务 id（clientTaskId）。 */
  clientTaskId?: string
}

export interface CanvasTextTaskCreateResponse {
  /** running：后台模式（waitForCompletion:false）立即返回，完成后通过 stream:canvas:text-task 推送 */
  status: 'running' | 'succeeded' | 'failed'
  providerProfileId: string
  provider: string
  model: string
  /** 生成的文本（成功时） */
  text: string
  /** 非敏感调用摘要：用于画布任务详情排查 prompt / agent / model。 */
  rawResponse?: unknown
  /** 实际发给 provider 的请求摘要（method + url + 已截断 body），用于任务详情展示。 */
  requestCall?: MediaRequestCall
  error?: { code: string; message: string }
}

export interface CanvasMediaTaskCancelRequest {
  runtimeTaskId: string
}

export interface CanvasMediaTaskCancelResponse {
  runtimeTaskId: string
  cancelled: boolean
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null
  error?: { code: string; message: string }
}

export interface CanvasMediaTaskStreamPayload {
  projectId?: string
  clientTaskId?: string
  runtimeTaskId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  response: CanvasMediaTaskCreateResponse
}

/**
 * `canvas:task:generate-text` 在 `waitForCompletion: false` 模式下，
 * 完成后通过 `stream:canvas:text-task` 推送（结构与 media-task 对称，但承载文本响应）。
 * 渲染端监听后调用 canvasApi.applyTextTaskResult 回写任务节点/资产/产物节点。
 */
export interface CanvasTextTaskStreamPayload {
  projectId?: string
  clientTaskId?: string
  status: 'succeeded' | 'failed'
  response: CanvasTextTaskCreateResponse
}

// ─── Canvas Persistence Channels (SQLite-backed) ────────────────────────────

/**
 * `canvas:snapshot:save` — 把整张画布快照（projects/boards/nodes/edges/assets/tasks）
 * 持久化到 SQLite canvas_snapshots 表（生产级存储，替代纯 localStorage demo）。
 */
export interface CanvasSnapshotSaveRequest {
  projectId: string
  /** 整个画布的序列化 JSON（renderer 侧 localStorage db 的快照） */
  snapshotJson: string
  /** 项目元数据（用于 canvas_projects 列表展示） */
  meta?: {
    title?: string
    description?: string | null
    status?: 'active' | 'archived' | 'deleted'
    nodeCount?: number
    assetCount?: number
    taskCount?: number
    coverAssetId?: string | null
    coverUrl?: string | null
    rootPath?: string | null
    pinned?: boolean
    pinnedAt?: string | null
  }
}

export interface CanvasSnapshotSaveResponse {
  saved: boolean
  updatedAt: string
}

/** `canvas:snapshot:load` — 从 SQLite 读回某项目的完整快照 */
export interface CanvasSnapshotLoadRequest {
  projectId: string
}
export interface CanvasSnapshotLoadResponse {
  snapshotJson: string | null
}

/** `canvas:project:list` — 列出所有已持久化的画布项目（不含快照体） */
export interface CanvasProjectListRequest {
  includeDeleted?: boolean
}
export interface CanvasProjectListItem {
  id: string
  title: string
  description: string | null
  status: 'active' | 'archived' | 'deleted'
  rootPath: string | null
  /** 项目封面图 URL（safe-file:// 指向项目目录内文件，或 http(s):// 外链） */
  coverUrl?: string | null
  /** 是否置顶（列表里优先展示） */
  pinned: boolean
  /** 置顶时间（置顶内部排序） */
  pinnedAt: string | null
  nodeCount: number
  assetCount: number
  taskCount: number
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface CanvasProjectListResponse {
  projects: CanvasProjectListItem[]
}

/** `canvas:window:open` — 打开或复用独立画布详情窗口 */
export interface CanvasWindowOpenRequest {
  projectId: string
}
export interface CanvasWindowOpenResponse {
  success: boolean
  windowId: number
  projectId: string
}
/** `canvas:window:close-confirmed` — renderer 已通过画布离开守卫，允许关闭独立画布窗口 */
export interface CanvasWindowCloseConfirmedRequest {}
export interface CanvasWindowCloseConfirmedResponse {
  success: boolean
}
export interface CanvasWindowCloseRequestPayload {
  projectId: string | null
}

/** `canvas:project:delete` — 软删除（status=deleted）或物理删除项目+快照 */
export interface CanvasProjectDeleteRequest {
  projectId: string
  hard?: boolean
}
export interface CanvasProjectDeleteResponse {
  deleted: boolean
}

/**
 * `canvas:project:update-cover` — 更新项目封面图。
 *
 * 上传流程：渲染端把用户选中的图片读成 data URL，先走 {@link CanvasAssetWriteDataUrlRequest}
 * 把文件落到 `<projectRoot>/assets/images/` 下拿到 filePath，再调本 channel 把 safe-file URL
 * 写入 `canvas_projects.cover_url`。传 null 清除封面。
 */
export interface CanvasProjectUpdateCoverRequest {
  projectId: string
  /** safe-file:// URL 或 http(s):// 外链；传 null 清除封面 */
  coverUrl: string | null
}
export interface CanvasProjectUpdateCoverResponse {
  coverUrl: string | null
  updatedAt: string
}

export interface CanvasProjectDefaultRootRequest {}
export interface CanvasProjectDefaultRootResponse {
  rootPath: string
}

export interface CanvasProjectEnsureDirectoryRequest {
  projectId: string
  title?: string
  /** Parent folder selected by the user. The app creates a project subfolder inside it. */
  parentDirectory?: string
  /** Existing final project directory; used when reopening/migrating old projects. */
  rootPath?: string | null
}
export interface CanvasProjectEnsureDirectoryResponse {
  rootPath: string
  created: boolean
  assetsDir: string
  snapshotsDir: string
}

export interface CanvasAssetWriteDataUrlRequest {
  projectId: string
  projectRootPath?: string | null
  dataUrl: string
  mimeType?: string
  suggestedBaseName?: string
  type?: 'image' | 'audio' | 'video' | 'file'
}
export interface CanvasAssetWriteDataUrlResponse {
  filePath: string
  fileName: string
  relativePath: string
}

export interface CanvasAssetCopyToProjectRequest {
  projectId: string
  projectRootPath?: string | null
  sourcePath?: string
  sourceUrl?: string
  suggestedBaseName?: string
  type?: 'image' | 'audio' | 'video' | 'file'
}
export interface CanvasAssetCopyToProjectResponse {
  copied: boolean
  filePath?: string
  fileName?: string
  relativePath?: string
  error?: string
}

export interface CanvasAssetDownloadRequest {
  sourcePath?: string
  sourceUrl?: string
  contentText?: string
  mimeType?: string | null
  type?: 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'file'
  suggestedFileName?: string
  defaultDirectory?: string
}
export interface CanvasAssetDownloadResponse {
  saved: boolean
  savedPath?: string
  error?: string
}

export interface CanvasAssetDownloadBatchItem {
  sourcePath?: string
  sourceUrl?: string
  contentText?: string
  mimeType?: string | null
  type?: 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'file'
  suggestedFileName?: string
}
export interface CanvasAssetDownloadBatchRequest {
  items: CanvasAssetDownloadBatchItem[]
  defaultDirectory?: string
}
export interface CanvasAssetDownloadBatchResultItem {
  /** 匹配请求 items 的索引，便于定位失败项 */
  index: number
  saved: boolean
  savedPath?: string
  error?: string
}
export interface CanvasAssetDownloadBatchResponse {
  /** 用户取消目录选择时为 true，此时不进行任何下载 */
  canceled: boolean
  targetDirectory?: string
  succeeded: number
  failed: number
  results: CanvasAssetDownloadBatchResultItem[]
}

export interface CanvasProjectExportPackageRequest {
  projectId: string
  title?: string
  projectRootPath?: string | null
  snapshotJson: string
  targetParentDirectory?: string
}
export interface CanvasProjectExportPackageResponse {
  exported: boolean
  directoryPath?: string
}

export interface CanvasProjectMigrateAssetsRequest {
  projectId: string
  projectRootPath?: string | null
  snapshotJson: string
}
export interface CanvasProjectMigrateAssetsResponse {
  migrated: boolean
  movedAssets: number
  skippedAssets: number
  snapshotJson: string
}

export interface CanvasProjectCleanupOrphansRequest {
  dryRun?: boolean
}
export interface CanvasProjectCleanupOrphansResponse {
  deletedFiles: number
  deletedBytes: number
  scannedFiles: number
  dryRun: boolean
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
  'session:submit-turn': [SessionSubmitTurnRequest, SessionSubmitTurnResponse]
  'session:get-queue': [SessionGetQueueRequest, SessionGetQueueResponse]
  'session:cancel-queued-turn': [SessionCancelQueuedTurnRequest, SessionCancelQueuedTurnResponse]
  'session:send-queued-turn-now': [
    SessionSendQueuedTurnNowRequest,
    SessionSendQueuedTurnNowResponse,
  ]
  'session:cancel': [SessionCancelRequest, SessionCancelResponse]
  'session:reject-plan': [SessionRejectPlanRequest, SessionRejectPlanResponse]
  'session:get-history': [SessionGetHistoryRequest, SessionGetHistoryResponse]
  'session:list': [SessionListRequest, SessionListResponse]
  'session:search': [SessionSearchRequest, SessionSearchResponse]
  'session:update': [SessionUpdateRequest, SessionUpdateResponse]
  'session:delete': [SessionDeleteRequest, SessionDeleteResponse]
  'session:set-max-iterations': [SessionSetMaxIterationsRequest, SessionSetMaxIterationsResponse]
  'session:set-goal': [SessionSetGoalRequest, SessionGoalResponse]
  'session:get-goal': [SessionGetGoalRequest, SessionGoalResponse]
  'session:goal-control': [SessionGoalControlRequest, SessionGoalResponse]
  'session:clear-events': [SessionClearEventsRequest, SessionClearEventsResponse]
  'session:list-checkpoints': [SessionListCheckpointsRequest, SessionListCheckpointsResponse]
  'session:get-checkpoint-config': [
    SessionGetCheckpointConfigRequest,
    SessionGetCheckpointConfigResponse,
  ]
  'session:set-checkpoint-config': [
    SessionSetCheckpointConfigRequest,
    SessionSetCheckpointConfigResponse,
  ]
  'session:delete-message': [SessionDeleteMessageRequest, SessionDeleteMessageResponse]
  'session:answer-question': [SessionAnswerQuestionRequest, SessionAnswerQuestionResponse]
  'session:list-pending-questions': [
    SessionListPendingQuestionsRequest,
    SessionListPendingQuestionsResponse,
  ]

  // Provider
  'provider:list': [ProviderListRequest, ProviderListResponse]
  'provider:get-api-key': [ProviderGetApiKeyRequest, ProviderGetApiKeyResponse]
  'provider:create': [ProviderCreateRequest, ProviderCreateResponse]
  'provider:update': [ProviderUpdateRequest, ProviderUpdateResponse]
  'provider:delete': [ProviderDeleteRequest, ProviderDeleteResponse]
  'provider:health-check': [ProviderHealthCheckRequest, ProviderHealthCheckResponse]
  'provider:test-connection': [ProviderConnectionTestRequest, ProviderHealthCheckResponse]
  'provider:fetch-models': [ProviderFetchModelsRequest, ProviderFetchModelsResponse]
  // Provider 导入/导出（多选 + 文件 IO + JSON 序列化）
  'provider:export': [ProviderExportRequest, ProviderExportResponse]
  'provider:import': [ProviderImportRequest, ProviderImportResponse]
  'provider:export-to-file': [ProviderExportToFileRequest, ProviderExportToFileResponse]
  'provider:import-from-file': [ProviderImportFromFileRequest, ProviderImportFromFileResponse]

  // Spark 平台官方模型（NewAPI 受管 Provider）
  'platform-model:get-status': [void, PlatformModelStatus]
  'platform-model:bootstrap': [void, PlatformModelStatus]
  'platform-model:continue-on-this-device': [void, PlatformModelStatus]
  'platform-model:get-plans': [void, { plans: PlatformModelPlan[] }]
  'platform-model:get-subscription': [void, { subscription: PlatformModelSubscription | null }]
  'platform-model:get-purchase-links': [void, { links: PlatformModelPurchaseLink[] }]
  'platform-model:open-purchase-link': [PlatformModelOpenPurchaseLinkRequest, { ok: true }]
  'platform-model:redeem': [PlatformModelRedeemRequest, PlatformModelRedeemResponse]
  'platform-model:pay': [PlatformModelPayRequest, PlatformModelPayResponse]
  'platform-model:get-usage': [void, PlatformModelUsage]
  'platform-model:update-model-preferences': [
    PlatformModelUpdatePreferencesRequest,
    PlatformModelUpdatePreferencesResponse,
  ]

  // History Import（检测 + 导入宿主机 Claude Code / Codex 对话历史）
  'history-import:scan': [HistoryImportScanRequest, HistoryImportScanResponse]
  'history-import:preview': [HistoryImportPreviewRequest, HistoryImportPreviewResponse]
  'history-import:import': [HistoryImportRequest, HistoryImportResponse]

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
  'workspace:git-status': [WorkspaceGitStatusRequest, WorkspaceGitStatusResponse]
  'workspace:git-file-diff': [WorkspaceGitFileDiffRequest, WorkspaceGitFileDiffResponse]
  'workspace:git-check-ignore': [WorkspaceGitCheckIgnoreRequest, WorkspaceGitCheckIgnoreResponse]
  'workspace:git-commit': [WorkspaceGitCommitRequest, WorkspaceGitCommitResponse]
  'workspace:git-push': [WorkspaceGitPushRequest, WorkspaceGitPushResponse]
  'workspace:create-branch': [WorkspaceCreateBranchRequest, WorkspaceCreateBranchResponse]
  'workspace:list-worktrees': [WorkspaceListWorktreesRequest, WorkspaceListWorktreesResponse]
  'workspace:create-worktree': [WorkspaceCreateWorktreeRequest, WorkspaceCreateWorktreeResponse]
  'workspace:remove-worktree': [WorkspaceRemoveWorktreeRequest, WorkspaceRemoveWorktreeResponse]
  'workspace:watch-start': [WorkspaceWatchStartRequest, WorkspaceWatchStartResponse]
  'workspace:watch-stop': [WorkspaceWatchStopRequest, WorkspaceWatchStopResponse]

  // Native dialog
  'dialog:open-directory': [DialogOpenDirectoryRequest, DialogOpenDirectoryResponse]
  'dialog:open-file': [DialogOpenFileRequest, DialogOpenFileResponse]
  'dialog:save-file': [DialogSaveFileRequest, DialogSaveFileResponse]

  // File operations
  'file:write-text': [FileWriteTextRequest, FileWriteTextResponse]
  'file:read-text': [FileReadTextRequest, FileReadTextResponse]
  'clipboard:write-text': [ClipboardWriteTextRequest, ClipboardWriteTextResponse]

  // App Info
  'app:get-info': [AppGetInfoRequest, AppGetInfoResponse]
  'github-connector:verify': [GitHubConnectorVerifyRequest, GitHubConnectorVerifyResponse]
  'github-connector:get': [GitHubConnectorGetRequest, GitHubConnectorGetResponse]
  'github-connector:connect': [GitHubConnectorConnectRequest, GitHubConnectorConnectResponse]
  'github-connector:update': [GitHubConnectorUpdateRequest, GitHubConnectorUpdateResponse]
  'github-connector:disconnect': [
    GitHubConnectorDisconnectRequest,
    GitHubConnectorDisconnectResponse,
  ]

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
  'mcp:authorize': [McpAuthorizeRequest, McpAuthorizeResponse]
  'mcp:deauthorize': [McpDeauthorizeRequest, McpDeauthorizeResponse]
  'mcp:auth-status': [McpAuthStatusRequest, McpAuthStatusResponse]

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
  'env-config:get': [EnvConfigGetRequest, EnvConfigGetResponse]
  'env-config:update': [EnvConfigUpdateRequest, EnvConfigUpdateResponse]

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
  // Installable Skill Catalog（内置可安装技能卡片）
  'skill:list-installable': [SkillListInstallableRequest, SkillListInstallableResponse]
  'skill:install-catalog': [SkillInstallCatalogRequest, SkillInstallCatalogResponse]
  'skill:install-status': [SkillInstallStatusRequest, SkillInstallStatusResponse]
  'skill:uninstall-catalog': [SkillUninstallCatalogRequest, SkillUninstallCatalogResponse]
  'skill:install-remote': [SkillInstallRemoteRequest, SkillInstallRemoteResponse]

  // External Tools (IDE / Terminal)
  'tool:detect': [ToolDetectRequest, ToolDetectResponse]
  'tool:open-project': [ToolOpenProjectRequest, ToolOpenProjectResponse]
  'tool:open-folder': [ToolOpenFolderRequest, ToolOpenFolderResponse]

  // Built-in Terminal Panel (session-scoped PTY dock)
  'terminal:list': [TerminalListRequest, TerminalListResponse]
  'terminal:list-active': [TerminalListActiveRequest, TerminalListActiveResponse]
  'terminal:create': [TerminalCreateRequest, TerminalCreateResponse]
  'terminal:input': [TerminalInputRequest, TerminalInputResponse]
  'terminal:resize': [TerminalResizeRequest, TerminalResizeResponse]
  'terminal:kill': [TerminalKillRequest, TerminalKillResponse]
  'terminal:rename': [TerminalRenameRequest, TerminalRenameResponse]
  'terminal:get-buffer': [TerminalGetBufferRequest, TerminalGetBufferResponse]

  // Command
  'command:execute': [CommandExecuteRequest, CommandExecuteResponse]
  'command:list': [CommandListRequest, CommandListResponse]
  'command:parse': [CommandParseRequest, CommandParseResponse]

  // Memory（记忆系统 V2）
  'memory:list': [MemoryListRequest, MemoryListResponse]
  'memory:get': [MemoryGetRequest, MemoryGetResponse]
  'memory:create': [MemoryCreateRequest, MemoryCreateResponse]
  'memory:update': [MemoryUpdateRequest, MemoryUpdateResponse]
  'memory:archive': [MemoryArchiveRequest, MemoryArchiveResponse]
  'memory:delete': [MemoryDeleteRequest, MemoryDeleteResponse]
  'memory:rebuild-vectors': [MemoryRebuildVectorsRequest, MemoryRebuildVectorsResponse]
  'memory:test-extraction': [MemoryTestExtractionRequest, MemoryTestExtractionResponse]

  // Settings
  'settings:get': [SettingsGetRequest, SettingsGetResponse]
  'settings:set': [SettingsSetRequest, SettingsSetResponse]
  'settings:get-category': [SettingsGetCategoryRequest, SettingsGetCategoryResponse]
  'settings:get-all': [SettingsGetAllRequest, SettingsGetAllResponse]

  // Log
  'log:read': [LogReadRequest, LogReadResponse]
  'log:clear': [LogClearRequest, LogClearResponse]
  'log:reveal': [LogRevealRequest, LogRevealResponse]

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

  // File Reveal — highlight a file/directory in the OS file manager
  'file:reveal': [FileRevealRequest, FileRevealResponse]

  // File Read — read a file's content as UTF-8 text
  'file:read': [FileReadRequest, FileReadResponse]

  // File Save Image — show save dialog and copy a local image to the user's chosen path
  'file:save-image': [FileSaveImageRequest, FileSaveImageResponse]
  'file:save-pasted-image': [FileSavePastedImageRequest, FileSavePastedImageResponse]
  'file:prepare-image-preview': [FilePrepareImagePreviewRequest, FilePrepareImagePreviewResponse]
  'file:stat-kind': [FileStatKindRequest, FileStatKindResponse]

  // Canvas Media Generation (infinite canvas → platform adapter)
  'canvas:media-capabilities:list': [
    CanvasMediaCapabilitiesListRequest,
    CanvasMediaCapabilitiesListResponse,
  ]
  'canvas:media-models:list': [CanvasMediaModelsListRequest, CanvasMediaModelsListResponse]
  'canvas:media-models:describe': [
    CanvasMediaModelDescribeRequest,
    CanvasMediaModelDescribeResponse,
  ]
  'canvas:media:prune-model-params': [
    CanvasMediaPruneModelParamsRequest,
    CanvasMediaPruneModelParamsResponse,
  ]
  'canvas:media:prune-model-params-by-inline-manifest': [
    CanvasMediaPruneModelParamsByInlineManifestRequest,
    CanvasMediaPruneModelParamsByInlineManifestResponse,
  ]
  'canvas:task:create-media': [CanvasMediaTaskCreateRequest, CanvasMediaTaskCreateResponse]
  'canvas:task:generate-text': [CanvasTextTaskCreateRequest, CanvasTextTaskCreateResponse]
  'canvas:task:cancel-media': [CanvasMediaTaskCancelRequest, CanvasMediaTaskCancelResponse]

  // Canvas Persistence (SQLite-backed production storage)
  'canvas:snapshot:save': [CanvasSnapshotSaveRequest, CanvasSnapshotSaveResponse]
  'canvas:snapshot:load': [CanvasSnapshotLoadRequest, CanvasSnapshotLoadResponse]
  'canvas:project:list': [CanvasProjectListRequest, CanvasProjectListResponse]
  'canvas:window:open': [CanvasWindowOpenRequest, CanvasWindowOpenResponse]
  'canvas:window:close-confirmed': [
    CanvasWindowCloseConfirmedRequest,
    CanvasWindowCloseConfirmedResponse,
  ]
  'canvas:project:delete': [CanvasProjectDeleteRequest, CanvasProjectDeleteResponse]
  'canvas:project:update-cover': [CanvasProjectUpdateCoverRequest, CanvasProjectUpdateCoverResponse]
  'canvas:project:default-root': [CanvasProjectDefaultRootRequest, CanvasProjectDefaultRootResponse]
  'canvas:project:ensure-directory': [
    CanvasProjectEnsureDirectoryRequest,
    CanvasProjectEnsureDirectoryResponse,
  ]
  'canvas:asset:write-data-url': [CanvasAssetWriteDataUrlRequest, CanvasAssetWriteDataUrlResponse]
  'canvas:asset:copy-to-project': [
    CanvasAssetCopyToProjectRequest,
    CanvasAssetCopyToProjectResponse,
  ]
  'canvas:asset:download': [CanvasAssetDownloadRequest, CanvasAssetDownloadResponse]
  'canvas:asset:download-batch': [
    CanvasAssetDownloadBatchRequest,
    CanvasAssetDownloadBatchResponse,
  ]
  'canvas:project:export-package': [
    CanvasProjectExportPackageRequest,
    CanvasProjectExportPackageResponse,
  ]
  'canvas:project:migrate-assets': [
    CanvasProjectMigrateAssetsRequest,
    CanvasProjectMigrateAssetsResponse,
  ]
  'canvas:project:cleanup-orphans': [
    CanvasProjectCleanupOrphansRequest,
    CanvasProjectCleanupOrphansResponse,
  ]

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

  // FFmpeg Integrity & Video Processing
  'ffmpeg:status': [FfmpegStatusRequest, FfmpegStatusResponse]
  'ffmpeg:install': [FfmpegInstallRequest, FfmpegInstallResponse]
  'video:probe': [VideoProcessRequest, VideoProcessResponse]
  'video:process': [VideoProcessRequest, VideoProcessResponse]
  'binary:install': [BinaryInstallRequest, BinaryInstallResponse]

  // Browser helpers
  'browser:open-external': [BrowserOpenExternalRequest, BrowserOpenExternalResponse]

  // Window Controls (renderer → main process)
  'window:minimize': [WindowMinimizeRequest, WindowMinimizeResponse]
  'window:maximize': [WindowMaximizeRequest, WindowMaximizeResponse]
  'window:close': [WindowCloseRequest, WindowCloseResponse]
  'window:is-maximized': [WindowIsMaximizedRequest, WindowIsMaximizedResponse]
  'window:set-zoom': [WindowSetZoomRequest, WindowSetZoomResponse]
  'window:ensure-width': [WindowEnsureWidthRequest, WindowEnsureWidthResponse]

  // Scheduled Tasks
  'scheduled-task:list': [ScheduledTaskListRequest, ScheduledTaskListResponse]
  'scheduled-task:get': [ScheduledTaskGetRequest, ScheduledTaskGetResponse]
  'scheduled-task:create': [ScheduledTaskCreateRequest, ScheduledTaskCreateResponse]
  'scheduled-task:update': [ScheduledTaskUpdateRequest, ScheduledTaskUpdateResponse]
  'scheduled-task:delete': [ScheduledTaskDeleteRequest, ScheduledTaskDeleteResponse]
  'scheduled-task:toggle': [ScheduledTaskToggleRequest, ScheduledTaskToggleResponse]
  'scheduled-task:run-now': [ScheduledTaskRunNowRequest, ScheduledTaskRunNowResponse]
  'scheduled-task:export': [ScheduledTaskExportRequest, ScheduledTaskExportResponse]
  'scheduled-task:import': [ScheduledTaskImportRequest, ScheduledTaskImportResponse]
  'scheduled-task:export-to-file': [
    ScheduledTaskExportToFileRequest,
    ScheduledTaskExportToFileResponse,
  ]
  'scheduled-task:import-from-file': [
    ScheduledTaskImportFromFileRequest,
    ScheduledTaskImportFromFileResponse,
  ]
  'task-execution:list': [TaskExecutionListRequest, TaskExecutionListResponse]
  'task-execution:get': [TaskExecutionGetRequest, TaskExecutionGetResponse]
  'task-execution:cancel': [TaskExecutionCancelRequest, TaskExecutionCancelResponse]
  'task-execution:stats': [TaskExecutionStatsRequest, TaskExecutionStatsResponse]

  // ─── Cloud Auth (对接 spark-edugen/edu-server 的登录/注册/微信扫码) ────────

  /** 获取图片验证码 */
  'auth:captcha': [AuthCaptchaRequest, AuthCaptchaResponse]
  /** 发送邮箱验证码（注册 / 验证码登录通用，需先通过图片验证码）*/
  'auth:send-code': [AuthSendCodeRequest, AuthSendCodeResponse]
  /** 注册 */
  'auth:register': [AuthRegisterRequest, AuthRegisterResponse]
  /** 登录（password 模式 / emailCode 模式）*/
  'auth:login': [AuthLoginRequest, AuthLoginResponse]
  /** refreshToken 换发新 token */
  'auth:refresh': [AuthRefreshRequest, AuthRefreshResponse]
  /** 退出登录（撤销服务端 session）*/
  'auth:logout': [AuthLogoutRequest, AuthLogoutResponse]
  /** 获取当前用户信息 */
  'auth:me': [AuthMeRequest, AuthMeResponse]
  /** 查询账号绑定状态（邮箱/手机/微信/密码）*/
  'auth:bind-status': [AuthBindStatusRequest, AuthBindStatusResponse]
  /** 修改密码 */
  'auth:change-password': [AuthChangePasswordRequest, AuthChangePasswordResponse]
  /** 获取微信扫码登录参数（state + qrUrl）*/
  'auth:wechat-qr': [AuthWechatQrRequest, AuthWechatQrResponse]
  /** 轮询微信扫码登录状态 */
  'auth:wechat-poll': [AuthWechatPollRequest, AuthWechatPollResponse]
  /** 微信扫码后绑定邮箱 — 发送验证码 */
  'auth:wechat-bind-email-send-code': [
    AuthWechatBindEmailSendCodeRequest,
    AuthWechatBindEmailSendCodeResponse,
  ]
  /** 微信扫码后绑定邮箱 — 校验验证码 */
  'auth:wechat-bind-email': [AuthWechatBindEmailRequest, AuthWechatBindEmailResponse]
  /** 切换 edu-server base URL（设置页用，无需重启）*/
  'auth:set-base-url': [AuthSetBaseUrlRequest, AuthSetBaseUrlResponse]
  /** 读取当前 edu-server base URL */
  'auth:get-base-url': [AuthGetBaseUrlRequest, AuthGetBaseUrlResponse]
  /** 启动时尝试自动登录（从 keytar 读取已存 token 并验证有效性）*/
  'auth:bootstrap': [AuthBootstrapRequest, AuthBootstrapResponse]
  /** 登录后上传文件到云端存储，返回可供模型访问的公网链接 */
  'auth:upload-file': [AuthUploadFileRequest, AuthUploadFileResponse]
  /** 更新当前用户资料（目前仅 nickname）— PUT /me */
  'auth:update-me': [AuthUpdateMeRequest, AuthUpdateMeResponse]
  /** 上传/更新当前用户头像（multipart → POST /me/avatar），返回完整 avatarUrl */
  'auth:upload-avatar': [AuthUploadAvatarRequest, AuthUploadAvatarResponse]
  /** 发送短信验证码（需先通过图片验证码）— POST /auth/send-sms */
  'auth:send-sms': [AuthSendSmsRequest, AuthSendSmsResponse]
  /** 手机号 + 短信验证码登录（首次自动注册）— POST /auth/login-sms */
  'auth:login-sms': [AuthLoginSmsRequest, AuthLoginSmsResponse]
  /** 拉取客户端公开配置（含认证能力开关 smsEnabled/wechatEnabled）— GET /client-config */
  'auth:client-config': [AuthClientConfigRequest, AuthClientConfigResponse]

  // ─── Canvas Agent Bridge ─────────────────────────────────────────────────
  /** 渲染端声明：本 session 绑定到当前画布项目，主进程可以把工具调用打回来 */
  'canvas:host-attach': [CanvasHostAttachRequest, CanvasHostAttachResponse]
  /** 渲染端声明：本 session 不再绑定画布（弹窗关闭或会话切换） */
  'canvas:host-detach': [CanvasHostDetachRequest, CanvasHostDetachResponse]
  /** 渲染端把工具调用结果回报给主进程 */
  'canvas:tool-result': [CanvasToolResultRequest, CanvasToolResultResponse]
  /** 渲染端确认已收到工具调用，即将开始执行（主进程据此启动超时计时器） */
  'canvas:tool-ack': [CanvasToolAckRequest, CanvasToolAckResponse]
}

// ─── Canvas Agent Bridge Types ─────────────────────────────────────────────

export interface CanvasToolSchemaPayload {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export interface CanvasHostAttachRequest {
  sessionId: string
  projectId: string
  /** 渲染端同步过来的工具 schema 列表（每次 attach 都会同步，主进程覆盖更新） */
  toolSchemas: CanvasToolSchemaPayload[]
}
export interface CanvasHostAttachResponse {
  ok: true
}

export interface CanvasHostDetachRequest {
  sessionId: string
}
export interface CanvasHostDetachResponse {
  ok: true
}

export interface CanvasToolResultRequest {
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}
export interface CanvasToolResultResponse {
  ok: true
}

/** 渲染端 → 主进程：确认已收到工具调用并即将开始执行（用于精确计时） */
export interface CanvasToolAckRequest {
  requestId: string
}
export interface CanvasToolAckResponse {
  ok: true
}

/** 主进程 → 渲染端：请求执行画布工具，渲染端用 canvas:tool-result 回报 */
export interface CanvasToolCallEvent {
  requestId: string
  sessionId: string
  toolName: string
  args: unknown
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
  'stream:session:created': {
    sessionId: string
    /** Optional for compatibility with older main processes. */
    session?: SessionListResponse['sessions'][number]
  }
  /** 用户问题请求（AskUserQuestion 工具，主进程推送，渲染进程显示选择界面）*/
  'stream:session:user-question': UserQuestionRequest
  /** 用户问题已回答、取消或随会话终止，渲染进程应移除对应问题。 */
  'stream:session:user-question-closed': {
    questionId: string
    sessionId: string
    reason: 'answered' | 'cancelled' | 'aborted'
  }
  /** 系统通知被点击，请渲染进程跳转到对应目标 */
  'stream:system-notification:navigate': SystemNotificationNavigateRequest
  /** 连接状态变化 */
  'stream:provider:status-changed': {
    profileId: string
    status: 'connected' | 'disconnected' | 'error'
    message?: string
  }
  /** 历史导入进度（主进程推送，渲染进程更新进度条）*/
  'stream:history-import:progress': HistoryImportProgress
  /** Global runtime configuration changed; renderer should refresh cached pickers/lists. */
  'stream:config:changed': {
    scope: 'provider' | 'model' | 'agent' | 'team' | 'skill' | 'mcp' | 'rule' | 'prompt'
    action: 'create' | 'update' | 'delete' | 'import'
    id?: string
  }
  /** Canvas media task status update. Pushed at task start/completion, not on every UI frame. */
  'stream:canvas:media-task': CanvasMediaTaskStreamPayload
  /** Canvas text task（generate-text 后台模式）完成回写。 */
  'stream:canvas:text-task': CanvasTextTaskStreamPayload
  /** 画布 Agent 工具调用请求（主进程 → 渲染进程）。渲染端执行后用 canvas:tool-result 回报。 */
  'stream:canvas:tool-call': CanvasToolCallEvent
  /** 独立画布窗口收到系统关闭请求，renderer 应先弹出画布离开守卫。 */
  'stream:canvas-window:close-request': CanvasWindowCloseRequestPayload
  /** Remote connection config/runtime changed */
  'stream:remote:changed': {
    reason: 'connection-saved' | 'connection-deleted' | 'pairing-updated' | 'runtime-updated'
    connectionId?: string
  }
  /** 工具审批请求（主进程推送，渲染进程弹窗）*/
  'stream:permission:approval-request': PermissionApprovalRequest
  /** 工作区文件变更（由 fs.watch 检测外部文件变化，主进程推送）*/
  'stream:workspace:file-change': WorkspaceFileChangePayload
  /** 可安装技能下载进度（主进程推送，渲染进程显示进度条）*/
  'stream:skill:install-progress': SkillInstallCatalogProgress
  /** 更新可用（主进程推送，渲染进程显示通知）*/
  'stream:update:available': UpdateInfo
  /** 更新下载进度（主进程推送，渲染进程显示进度条）*/
  'stream:update:progress': UpdateProgressInfo
  /** 更新下载完成（主进程推送，渲染进程显示安装提示）*/
  'stream:update:downloaded': UpdateInfo
  /** 更新状态变化（主进程推送，渲染进程同步状态）*/
  'stream:update:status': UpdateStatus

  // ─── Cloud Auth 流式事件 ──────────────────────────────────────────────────
  /** token 续期成功（主进程推送，渲染端刷新内存缓存 + 状态）*/
  'stream:auth:token-refreshed': {
    token: string
    refreshToken: string
    userId: string
  }
  /** session 过期（refresh 也失败，渲染端跳到登录页）*/
  'stream:auth:session-expired': {}
  /** 登录状态变化（已登录 ↔ 已登出）*/
  'stream:auth:state-changed': {
    isAuthenticated: boolean
    userId?: string
  }
  /** SDK 完整性自检结果（启动时自动推送）*/
  'stream:sdk:integrity': SdkIntegrityCheckResponse
  /** Shell 环境状态（PATH 修复 + 运行时工具检测结果）*/
  'stream:env:status': ShellEnvironmentStatus
  /** Playwright 安装/状态变化推送（Settings UI 监听）*/
  'stream:playwright:status': PlaywrightStatusResponse
  /** Playwright MCP / Chromium 安装进度推送 */
  'stream:playwright:install-progress': PlaywrightInstallProgress
  /** FFmpeg 状态变化推送（启动自检 + 安装后刷新）*/
  'stream:ffmpeg:status': FfmpegStatusResponse
  /** FFmpeg 下载安装进度推送 */
  'stream:ffmpeg:install-progress': FfmpegInstallProgress
  /** 视频处理进度推送（按 requestId 关联请求）*/
  'stream:video:process-progress': VideoProcessProgress
  /** 通用二进制产物下载进度推送 */
  'stream:binary:install-progress': BinaryInstallProgress
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
  /** 用户从系统托盘菜单触发「新建会话」（主进程展示主窗口后推送，渲染端走新建会话流程）*/
  'stream:tray:new-session': Record<string, never>
  /** 用户从系统托盘菜单点击某个最近会话（主进程展示主窗口后推送，渲染端切换到该会话）*/
  'stream:tray:open-session': { sessionId: string }
  /** Built-in terminal panel events: data / exit / removed / etc. */
  'stream:terminal:event': TerminalStreamEvent
}

export type IpcStreamChannel = keyof IpcStreamChannelMap

// ─── Cloud Auth 类型定义（对接 spark-edugen/edu-server）────────────────────────

/** 登录模式 */
export type AuthLoginMode = 'password' | 'code'

/** 验证码用途 */
export type AuthSendCodeType = 'register' | 'login'

/** 用户信息 */
export interface AuthUserInfo {
  id: number
  account: string
  nickname: string
  avatarUrl: string
  role: string
  createdAt: string
  lastLoginAt: string | null
  /** 服务档位 */
  tier?: {
    key: string
    name: string
    isPaid: boolean
  }
}

/** 登录成功的会话（access token + refresh token + userId）*/
export interface AuthSession {
  token: string
  refreshToken: string
  userId: string
}

/** 图片验证码响应 */
export interface AuthCaptchaRequest {
  /** 强制刷新（默认 true，避免缓存）*/
  fresh?: boolean
}
export type AuthCaptchaResponse = {
  id: string
  /** SVG 字符串，可直接 inline 渲染 */
  svg: string
}

/** 发送邮箱验证码 */
export interface AuthSendCodeRequest {
  account: string
  type: AuthSendCodeType
  captchaId: string
  captchaText: string
}
export type AuthSendCodeResponse = {
  expire_in: number
}

/** 注册 */
export interface AuthRegisterRequest {
  account: string
  password: string
  code: string
  inviteCode?: string
}
export type AuthRegisterResponse = AuthSession

/** 登录 */
export interface AuthLoginRequest {
  account: string
  loginMode: AuthLoginMode
  password?: string
  captchaId?: string
  captchaText?: string
  emailCode?: string
}
export type AuthLoginResponse = AuthSession

/** 刷新 token */
export interface AuthRefreshRequest {
  /** 可选 — 主进程默认从 keytar 自动读取 */
  refreshToken?: string
}
export type AuthRefreshResponse = AuthSession

/** 退出登录 */
export interface AuthLogoutRequest {}
export type AuthLogoutResponse = {
  ok: true
}

/** 当前用户信息 */
export interface AuthMeRequest {}
export type AuthMeResponse = AuthUserInfo

/** 账号绑定状态 */
export interface AuthBindStatusRequest {}
export type AuthBindStatusResponse = {
  hasEmail: boolean
  hasPhone: boolean
  hasWechat: boolean
  hasPassword: boolean
  account: string
}

/** 修改密码 */
export interface AuthChangePasswordRequest {
  oldPassword: string
  newPassword: string
}
export type AuthChangePasswordResponse = {
  ok: true
}

/** 微信扫码 */
export interface AuthWechatQrRequest {}
export type AuthWechatQrResponse = {
  state: string
  qrUrl: string
  appId?: string
  redirectUri?: string
}

/** 微信扫码轮询 */
export interface AuthWechatPollRequest {
  state: string
}
export type AuthWechatPollResponse = {
  status: 'pending' | 'success' | 'pending_bind' | 'error'
  token?: string
  refreshToken?: string
  userId?: string
  isNew?: boolean
  needsSetup?: boolean
  bindSession?: string
  message?: string
}

/** 微信扫码后绑定邮箱 — 发送验证码 */
export interface AuthWechatBindEmailSendCodeRequest {
  bindSession: string
  email: string
  captchaId: string
  captchaText: string
}
export type AuthWechatBindEmailSendCodeResponse = {
  expire_in: number
}

/** 微信扫码后绑定邮箱 — 校验验证码 */
export interface AuthWechatBindEmailRequest {
  bindSession: string
  code: string
}
export type AuthWechatBindEmailResponse = AuthSession & { isNew: boolean }

/** 设置 edu-server base URL */
export interface AuthSetBaseUrlRequest {
  /** 形如 `http://localhost:7002` 或 `https://api.example.com`，留空则用默认值 */
  baseUrl: string
}
export type AuthSetBaseUrlResponse = {
  baseUrl: string
}

/** 读取当前 edu-server base URL */
export interface AuthGetBaseUrlRequest {}
export type AuthGetBaseUrlResponse = {
  baseUrl: string
  source: 'default' | 'env' | 'user'
}

/** 启动时自动登录（读取 keytar 中已存 token，验证有效性）*/
export interface AuthBootstrapRequest {}
export type AuthBootstrapResponse = {
  isAuthenticated: boolean
  user?: AuthUserInfo
  baseUrl: string
  reason?: 'no-session' | 'refresh-failed' | 'me-fetch-failed'
  /** keytar 是否可用；false 表示 token 仅在内存，重启会丢失（dev 模式常见）*/
  keytarAvailable?: boolean
  /** keytar 最近一次错误信息（诊断用，不含敏感数据）*/
  keytarError?: string
}

/** 云端文件上传。dataUrl 和 filePath 二选一，桌面端会带登录 token 调用 edu-server /upload。 */
export interface AuthUploadFileRequest {
  dataUrl?: string
  filePath?: string
  fileName?: string
  mimeType?: string
}
export type AuthUploadFileResponse = {
  fileName: string
  fileKey: string
  staticUrl: string
  aiUrl: string
  fileUrl?: string
}

/** 更新当前用户资料（目前仅 nickname，服务端对 nickname 做长度校验 ≤ 20）*/
export interface AuthUpdateMeRequest {
  nickname: string
}
/** 返回更新后的完整用户信息（便于渲染端直接刷新本地缓存）*/
export type AuthUpdateMeResponse = AuthUserInfo

/** 上传/更新当前用户头像。dataUrl 为 base64 dataURL（主进程转 multipart 调 /me/avatar）。 */
export interface AuthUploadAvatarRequest {
  dataUrl: string
  fileName?: string
  mimeType?: string
}
/** 服务端返回的完整头像 URL（已落库）*/
export type AuthUploadAvatarResponse = {
  avatarUrl: string
}

/** 发送短信验证码 */
export interface AuthSendSmsRequest {
  /** 手机号 */
  phone: string
  /** 图片验证码 ID（来自 auth:captcha）*/
  captchaId: string
  /** 图片验证码文本 */
  captchaText: string
}
export type AuthSendSmsResponse = {
  expire_in: number
}

/** 手机号 + 短信验证码登录（首次自动注册）*/
export interface AuthLoginSmsRequest {
  phone: string
  smsCode: string
}
/** 登录成功：会话 + 是否为新注册用户 */
export type AuthLoginSmsResponse = AuthSession & {
  isNew: boolean
}

/** 客户端公开配置请求（无需登录）*/
export interface AuthClientConfigRequest {}
/** 认证能力开关（决定前端是否展示短信/微信登录入口）*/
export interface AuthCapabilities {
  smsEnabled: boolean
  wechatEnabled: boolean
}
/** 客户端公开配置响应（仅保留与认证相关字段，其余忽略）*/
export interface AuthClientConfigResponse {
  authCapabilities?: AuthCapabilities
}
export type IpcStreamPayload<C extends IpcStreamChannel> = IpcStreamChannelMap[C]
