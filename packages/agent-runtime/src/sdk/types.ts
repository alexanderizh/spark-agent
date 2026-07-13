/**
 * Types for Claude Agent SDK (@anthropic-ai/claude-agent-sdk) integration.
 *
 * These mirror the SDK's public API surface so we can type-check our executor
 * without hard-coupling to the SDK package at compile time.
 * When the SDK is not installed the runtime fails fast with SDK_REQUIRED.
 *
 * Source: https://code.claude.com/docs/en/agent-sdk/typescript
 * Package: @anthropic-ai/claude-agent-sdk ^0.3.152
 */

import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { HookNode, UserQuestionPrompt } from '@spark/protocol'
import type { SparkReasoningEffort } from './reasoning-effort.js'

// ── SDK Message Types ───────────────────────────────────────────────────────

export interface SDKAssistantMessage {
  type: 'assistant'
  uuid: string
  session_id: string
  message: {
    role: 'assistant'
    content: SDKContentBlock[]
    model?: string
    usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
  parent_tool_use_id: string | null
  error?: SDKAssistantMessageError
  subagent_type?: string
  task_description?: string
  supersedes?: string[]
}

export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'oauth_org_not_allowed'
  | 'billing_error'
  | 'rate_limit'
  | 'overloaded'
  | 'invalid_request'
  | 'model_not_found'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'

export interface SDKResultMessage {
  type: 'result'
  subtype:
    | 'success'
    | 'error_max_turns'
    | 'error_during_execution'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries'
  uuid: string
  session_id: string
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  result?: string
  total_cost_usd: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  modelUsage?: Record<string, {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    costUSD: number
  }>
  errors?: string[]
  checkpoint?: SDKCheckpointInfo
}

export interface SDKCheckpointInfo {
  id?: string
  checkpoint_id?: string
  path?: string
  label?: string
  file_paths?: string[]
  files?: string[]
}

export type SDKSystemMessage =
  | SDKInitSystemMessage
  | SDKStatusSystemMessage
  | SDKCompactBoundarySystemMessage
  | SDKApiRetrySystemMessage
  | SDKPermissionDeniedSystemMessage
  | SDKSessionStateChangedSystemMessage
  | SDKModelRefusalFallbackSystemMessage
  | SDKModelRefusalNoFallbackSystemMessage
  | SDKNotificationSystemMessage
  | SDKMirrorErrorSystemMessage
  | SDKWorkerShuttingDownSystemMessage
  | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage
  | SDKTaskProgressMessage
  | SDKTaskNotificationMessage
  | SDKBackgroundTasksChangedMessage

export interface SDKInitSystemMessage {
  type: 'system'
  subtype: 'init'
  uuid: string
  session_id: string
  tools: string[]
  model: string
  permissionMode: string
  mcp_servers: Array<{ name: string; status: string }>
  cwd: string
  skills: string[]
}

export interface SDKStatusSystemMessage {
  type: 'system'
  subtype: 'status'
  status: 'compacting' | 'requesting' | null
  permissionMode?: string
  compact_result?: 'success' | 'failed'
  compact_error?: string
  uuid: string
  session_id: string
}

export interface SDKCompactBoundarySystemMessage {
  type: 'system'
  subtype: 'compact_boundary'
  compact_metadata: {
    trigger: 'manual' | 'auto'
    pre_tokens: number
    post_tokens?: number
    duration_ms?: number
  }
  uuid: string
  session_id: string
}

export interface SDKApiRetrySystemMessage {
  type: 'system'
  subtype: 'api_retry'
  attempt: number
  max_retries: number
  retry_delay_ms: number
  error_status: number | null
  error: SDKAssistantMessageError
  uuid: string
  session_id: string
}

export interface SDKPermissionDeniedSystemMessage {
  type: 'system'
  subtype: 'permission_denied'
  tool_name: string
  tool_use_id: string
  agent_id?: string
  decision_reason_type?: string
  decision_reason?: string
  message: string
  uuid: string
  session_id: string
}

export interface SDKSessionStateChangedSystemMessage {
  type: 'system'
  subtype: 'session_state_changed'
  state: 'idle' | 'running' | 'requires_action'
  uuid: string
  session_id: string
}

export interface SDKModelRefusalFallbackSystemMessage {
  type: 'system'
  subtype: 'model_refusal_fallback'
  original_model: string
  fallback_model: string
  request_id: string | null
  api_refusal_category?: string | null
  api_refusal_explanation?: string | null
  retracted_message_uuids?: string[]
  content: string
  uuid: string
  session_id: string
}

export interface SDKModelRefusalNoFallbackSystemMessage {
  type: 'system'
  subtype: 'model_refusal_no_fallback'
  original_model: string
  request_id: string | null
  api_refusal_category?: string | null
  api_refusal_explanation?: string | null
  content: string
  uuid: string
  session_id: string
}

export interface SDKNotificationSystemMessage {
  type: 'system'
  subtype: 'notification'
  key: string
  text: string
  priority: 'low' | 'medium' | 'high' | 'immediate'
  color?: string
  timeout_ms?: number
  uuid: string
  session_id: string
}

export interface SDKMirrorErrorSystemMessage {
  type: 'system'
  subtype: 'mirror_error'
  error: string
  key: { projectKey: string; sessionId: string; subpath?: string }
  uuid: string
  session_id: string
}

export interface SDKWorkerShuttingDownSystemMessage {
  type: 'system'
  subtype: 'worker_shutting_down'
  reason: string
  uuid: string
  session_id: string
}

export interface SDKTaskStartedMessage {
  type: 'system'
  subtype: 'task_started'
  task_id: string
  tool_use_id?: string
  description: string
  subagent_type?: string
  task_type?: string
  workflow_name?: string
  prompt?: string
  skip_transcript?: boolean
  uuid: string
  session_id: string
}

export interface SDKTaskUpdatedMessage {
  type: 'system'
  subtype: 'task_updated'
  task_id: string
  patch: {
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'
    description?: string
    end_time?: number
    total_paused_ms?: number
    error?: string
    is_backgrounded?: boolean
  }
  uuid: string
  session_id: string
}

export interface SDKTaskProgressMessage {
  type: 'system'
  subtype: 'task_progress'
  task_id: string
  tool_use_id?: string
  description: string
  subagent_type?: string
  usage: { total_tokens: number; tool_uses: number; duration_ms: number }
  last_tool_name?: string
  summary?: string
  uuid: string
  session_id: string
}

export interface SDKTaskNotificationMessage {
  type: 'system'
  subtype: 'task_notification'
  task_id: string
  tool_use_id?: string
  status: 'completed' | 'failed' | 'stopped'
  output_file: string
  summary: string
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
  skip_transcript?: boolean
  uuid: string
  session_id: string
}

export interface SDKBackgroundTasksChangedMessage {
  type: 'system'
  subtype: 'background_tasks_changed'
  tasks: Array<{ task_id: string; task_type: string; description: string }>
  uuid: string
  session_id: string
}

export interface SDKAuthStatusMessage {
  type: 'auth_status'
  isAuthenticating: boolean
  output: string[]
  error?: string
  uuid: string
  session_id: string
}

export interface SDKRateLimitEvent {
  type: 'rate_limit_event'
  rate_limit_info: {
    status: 'allowed' | 'allowed_warning' | 'rejected'
    resetsAt?: number
    rateLimitType?: string
    utilization?: number
    overageStatus?: 'allowed' | 'allowed_warning' | 'rejected'
    overageResetsAt?: number
    overageDisabledReason?: string
    errorCode?: 'credits_required'
    canUserPurchaseCredits?: boolean
  }
  uuid: string
  session_id: string
}

export interface SDKStreamEvent {
  type: 'stream_event'
  event: {
    type: string
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string }
    content_block?: { type: string; id?: string; name?: string; text?: string; thinking?: string }
    index?: number
    message?: { usage?: { input_tokens: number; output_tokens: number } }
    usage?: { output_tokens: number }
  }
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export interface SDKUserMessage {
  type: 'user'
  uuid?: string
  session_id?: string
  parent_tool_use_id: string | null
  message: {
    role: 'user'
    content: string | SDKContentBlock[]
  }
}

export type SDKContentBlock =
  | BetaContentBlock
  | { type: 'text'; text: string; citations?: unknown[] }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | SDKContentBlock[]; is_error?: boolean }

export type SDKMessage =
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKStreamEvent
  | SDKUserMessage
  | SDKAuthStatusMessage
  | SDKRateLimitEvent
  | { type: string; [key: string]: unknown }

// ── SDK Query API ───────────────────────────────────────────────────────────

export interface SDKMcpServerConfig {
  type?: 'stdio' | 'sse' | 'http' | 'sdk'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  /** in-process MCP server (type='sdk')：createSdkMcpServer 返回的 name/instance。
   *  config.mcpServers 原样传给 SDK query()，SDK 原生支持同进程实例。 */
  name?: string
  instance?: unknown
}

export type SDKPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto'

export type SDKEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type SDKPermissionDecisionClassification =
  | 'user_temporary'
  | 'user_permanent'
  | 'user_reject'

export type SDKPermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'

export type SDKPermissionUpdate =
  | {
      type: 'addRules' | 'replaceRules' | 'removeRules'
      rules: Array<{ toolName: string; ruleContent?: string }>
      behavior: 'allow' | 'deny' | 'ask'
      destination: SDKPermissionUpdateDestination
    }
  | {
      type: 'setMode'
      mode: SDKPermissionMode
      destination: SDKPermissionUpdateDestination
    }
  | {
      type: 'addDirectories' | 'removeDirectories'
      directories: string[]
      destination: SDKPermissionUpdateDestination
    }

export interface SDKPermissionRequestContext {
  signal: AbortSignal
  suggestions?: SDKPermissionUpdate[]
  blockedPath?: string
  decisionReason?: string
  title?: string
  displayName?: string
  description?: string
  toolUseID: string
  agentID?: string
  requestId: string
}

/** Correlation and cancellation metadata for a host-rendered user question. */
export interface SDKQuestionRequestContext {
  questionId?: string
  requestId?: string
  signal?: AbortSignal
}

export interface SDKApprovalResult {
  allowed: boolean
  scope?: 'once' | 'session' | 'project' | 'global'
}

export type SDKPermissionResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: SDKPermissionUpdate[]
      toolUseID?: string
      decisionClassification?: SDKPermissionDecisionClassification
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      toolUseID?: string
      decisionClassification?: SDKPermissionDecisionClassification
    }

export interface SDKToolConfig {
  askUserQuestion?: {
    previewFormat?: 'markdown' | 'html'
  }
}

export interface SDKSettings {
  model?: string | undefined
  env?: Record<string, string> | undefined
  permissions?: {
    defaultMode?: SDKPermissionMode | undefined
    allow?: string[] | undefined
    deny?: string[] | undefined
    ask?: string[] | undefined
  } | undefined
  [key: string]: unknown
}

export type SDKSettingSource = 'user' | 'project' | 'local'

export interface SDKTurnAttachment {
  type: 'image' | 'file' | 'directory'
  path: string
  name: string
  sizeBytes?: number
}

export interface SDKQueryOptions {
  abortController?: AbortController | undefined
  cwd?: string | undefined
  pathToClaudeCodeExecutable?: string | undefined
  env?: Record<string, string | undefined> | undefined
  model?: string | undefined
  effort?: SDKEffort | undefined
  permissionMode?: SDKPermissionMode | undefined
  allowedTools?: string[] | undefined
  disallowedTools?: string[] | undefined
  mcpServers?: Record<string, SDKMcpServerConfig> | undefined
  strictMcpConfig?: boolean | undefined
  forwardSubagentText?: boolean | undefined
  agentProgressSummaries?: boolean | undefined
  disableWorkflows?: boolean | undefined
  workflowKeywordTriggerEnabled?: boolean | undefined
  hooks?: Partial<Record<SDKHookEvent, SDKHookCallbackMatcher[]>> | undefined
  onElicitation?: ((
    request: SDKElicitationRequest,
    options: { signal: AbortSignal },
  ) => Promise<SDKElicitationResult>) | undefined
  skills?: string[] | 'all' | undefined
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string | undefined } | undefined
  toolConfig?: SDKToolConfig | undefined
  maxTurns?: number | undefined
  maxBudgetUsd?: number | undefined
  sessionId?: string | undefined
  resume?: string | undefined
  continue?: boolean | undefined
  settings?: string | SDKSettings | undefined
  settingSources?: SDKSettingSource[] | undefined
  persistSession?: boolean | undefined
  additionalDirectories?: string[] | undefined
  debug?: boolean | undefined
  stderr?: ((data: string) => void) | undefined
  includePartialMessages?: boolean | undefined
  enableFileCheckpointing?: boolean | undefined
  canUseTool?: ((
    toolName: string,
    input: Record<string, unknown>,
    options: SDKPermissionRequestContext,
  ) => Promise<SDKPermissionResult | null>) | undefined
  agents?: Record<string, {
    description: string
    prompt: string
    tools?: string[] | undefined
    model?: string | undefined
    maxTurns?: number | undefined
  }> | undefined
}

export type SDKHookEvent = 'PermissionRequest'

export interface SDKPermissionRequestHookInput {
  hook_event_name: 'PermissionRequest'
  session_id: string
  transcript_path: string
  cwd: string
  tool_name: string
  tool_input: unknown
  permission_suggestions?: SDKPermissionUpdate[]
}

export type SDKHookCallback = (
  input: SDKPermissionRequestHookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<{ continue?: boolean; suppressOutput?: boolean }>

export interface SDKHookCallbackMatcher {
  matcher?: string
  hooks: SDKHookCallback[]
  timeout?: number
}

export interface SDKElicitationRequest {
  serverName: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitationId?: string
  requestedSchema?: Record<string, unknown>
  title?: string
  displayName?: string
  description?: string
}

export type SDKElicitationResult =
  | { action: 'accept'; content?: Record<string, unknown> }
  | { action: 'decline' | 'cancel' }

/**
 * The Query object returned by the SDK's query() function.
 * It is an AsyncGenerator<SDKMessage> with additional control methods.
 */
export interface SDKQuery extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>
  setPermissionMode?(mode: SDKPermissionMode): Promise<void>
  close(): void
}

export interface SDKQueryFunction {
  (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: SDKQueryOptions }): SDKQuery
}

// ── Spark ↔ SDK Permission Mode Mapping ─────────────────────────────────────

export type SparkPermissionMode =
  | 'claude-ask'
  | 'claude-auto-edits'
  | 'claude-plan'
  | 'claude-auto'
  | 'claude-bypass'
  | 'codex-default'
  | 'codex-auto-review'
  | 'codex-full-access'

// ── Executor Configuration ──────────────────────────────────────────────────

export interface CodexCliModelProviderConfig {
  id: string
  name?: string | undefined
  baseUrl?: string | undefined
  wireApi: 'chat' | 'responses'
  envKey?: string | undefined
  env?: Record<string, string | undefined> | undefined
}

export interface SDKExecutorConfig {
  apiKey: string
  /** True when the turn is running as unattended automation and must never wait on user input. */
  unattended?: boolean | undefined
  /**
   * 当为 true 时，executor 不向子进程注入 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL /
   * ANTHROPIC_MODEL 等覆盖，而是把宿主进程现有的 ANTHROPIC_ 与 CLAUDE_ 前缀的环境变量
   * 全部透传给 SDK。
   *
   * 用于内置 "本地 CLI" provider —— SDK 会沿用宿主机 Claude Code 的本地配置
   * （OAuth credentials、用户已设的 ANTHROPIC_BASE_URL 等），用户无需重复填一份。
   */
  useLocalConfig?: boolean | undefined
  model: string
  /** Haiku 档（SDK 派生子 agent 用）；缺省回落 model */
  haikuModel?: string | undefined
  /** Sonnet 档；缺省回落 model */
  sonnetModel?: string | undefined
  /** Opus 档（Plan/Review 等高能力 agent）；缺省回落 model */
  opusModel?: string | undefined
  apiEndpoint?: string | undefined
  codexApiKind?: 'chat' | 'responses' | 'embedding' | undefined
  codexCliProvider?: CodexCliModelProviderConfig | undefined
  systemPrompt?: string | undefined
  skillSystemPrompt?: string | undefined
  /**
   * 用户在会话/项目级配置的自定义环境变量（真实值）。注入子进程环境，使 agent 的
   * shell/工具可通过 $KEY 读取，而真实值不出现在对话或提示词中（提示词仅含脱敏清单）。
   */
  customEnv?: Record<string, string> | undefined
  permissionMode: SparkPermissionMode
  maxTurnCount?: number | undefined
  /** Number of automatic max-turn extensions before asking the user to decide. */
  maxTurnExtensionRetries?: number | undefined
  /** Hard cap for automatic max-turn extensions. */
  maxTurnExtensionCap?: number | undefined
  maxTokens?: number | undefined
  contextWindowTokens?: number | undefined
  maxBudgetUsd?: number | undefined
  workspaceRootPath: string
  reasoningEffort?: SparkReasoningEffort | undefined
  /** Codex sandbox network access. Defaults to false. */
  networkAccessEnabled?: boolean | undefined
  /** Codex built-in web search mode. Defaults to disabled. */
  webSearchMode?: 'disabled' | 'cached' | 'live' | undefined
  /** Legacy Codex web-search switch; explicit mode takes precedence. */
  webSearchEnabled?: boolean | undefined
  mcpServers?: Record<string, SDKMcpServerConfig> | undefined
  imageGenerationMcpServer?: SDKMcpServerConfig | undefined
  /** 统一多媒体 MCP server（spark_media）：图片/语音/视频生成 */
  mediaGenerationMcpServer?: SDKMcpServerConfig | undefined
  /** Team Mode：in-process spark_team MCP server（Host 调用成员的 agent_dispatch 工具） */
  teamMcpServer?: SDKMcpServerConfig | undefined
  /** Platform management MCP server (auto-injected for all sessions) */
  platformManagementMcpServer?: SDKMcpServerConfig | undefined
  /** Built-in web search MCP server (spark_search) — auto-injected for all sessions */
  webSearchMcpServer?: SDKMcpServerConfig | undefined
  /** Built-in user-facing file presentation MCP server (spark_files). */
  presentFilesMcpServer?: SDKMcpServerConfig | undefined
  /** Debug mode MCP server (spark_debug) — only injected when the session has debugMode enabled */
  debugMcpServer?: SDKMcpServerConfig | undefined
  /** Visible in-app browser MCP server (spark_browser) — provided by the desktop main process. */
  browserAutomationMcpServer?: SDKMcpServerConfig | undefined
  /** 画布 Agent in-process MCP server（spark_canvas）：仅在 session 已 attach 到画布弹窗时注入 */
  canvasMcpServer?: SDKMcpServerConfig | undefined
  nativeSkills?: string[] | 'all' | undefined
  /**
   * 本地技能插件目录列表（Claude Code 插件结构，含 .claude-plugin/plugin.json + skills/）。
   * 传给 SDK 的 `plugins` 选项，启用原生技能发现与渐进式披露。
   */
  skillPlugins?: string[] | undefined
  allowedTools?: string[] | undefined
  disallowedTools?: string[] | undefined
  attachments?: SDKTurnAttachment[] | undefined
  additionalDirectories?: string[] | undefined
  enableCheckpoints?: boolean | undefined
  sdkSessionId?: string | undefined
  continueSession?: boolean | undefined
  approvalCallback?: ((
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    context: SDKPermissionRequestContext,
  ) => Promise<boolean | SDKApprovalResult>) | undefined
  /** Callback for AskUserQuestion tool - returns user's answers to the questions */
  questionCallback?: ((
    sessionId: string,
    questions: UserQuestionPrompt[],
    context: SDKQuestionRequestContext,
  ) => Promise<Record<string, unknown>>) | undefined
  /** Bridge for the small set of application notification hooks Spark exposes. */
  applicationHookCallback?: ((
    sessionId: string,
    node: Extract<HookNode, 'permission_request'>,
    context: { title?: string; body?: string },
  ) => void | Promise<void>) | undefined
  goal?: {
    id: string
    objective: string
    mode: 'spark-loop' | 'codex-native'
    control?: 'start' | 'pause' | 'resume' | 'clear'
    successCriteria?: string[]
    progressLog?: Array<{ iteration: number; phase: string; status: string; summary: string; nextStep?: string }>
  } | undefined
}

// ── Resume Recovery ──────────────────────────────────────────────────────────

/**
 * Error patterns that indicate a resume attempt failed because the SDK
 * session is stale, already in use, or otherwise unrecoverable.
 * When a resume error matches any of these patterns, the executor should
 * fall back to a fresh session automatically.
 */
export const SDK_RESUME_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /session\s+id\s+already\s+in\s+use/i,
  /session\s+not\s+found/i,
  /session\s+expired/i,
  /session\s+does\s+not\s+exist/i,
  /invalid\s+session/i,
  /session\s+is\s+no\s+longer\s+available/i,
  /failed\s+to\s+resume/i,
  /cannot\s+resume/i,
] as const

/**
 * Result of a resume error classification.
 */
export interface ResumeErrorClassification {
  /** Whether the error is a resume-specific failure that should trigger fallback */
  isResumeError: boolean
  /** Human-readable classification for telemetry */
  reason: string
}

/**
 * Classify an error from the SDK to determine if it's a resume-specific failure.
 */
export function classifyResumeError(err: unknown): ResumeErrorClassification {
  const message = err instanceof Error ? err.message : String(err)
  for (const pattern of SDK_RESUME_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { isResumeError: true, reason: `resume_error:${pattern.source}` }
    }
  }
  return { isResumeError: false, reason: 'unknown' }
}

/**
 * Circuit breaker state for SDK resume attempts.
 * Tracks consecutive resume failures per Spark session to automatically
 * disable resume when it keeps failing.
 */
export class ResumeCircuitBreaker {
  private failureCounts = new Map<string, number>()
  private readonly maxFailures: number

  constructor(maxFailures: number = 3) {
    this.maxFailures = maxFailures
  }

  /**
   * Record a resume failure for a session.
   * Returns true if the circuit is now open (resume should be disabled).
   */
  recordFailure(sessionId: string): boolean {
    const count = (this.failureCounts.get(sessionId) ?? 0) + 1
    this.failureCounts.set(sessionId, count)
    return count >= this.maxFailures
  }

  /**
   * Record a resume success for a session, resetting the failure counter.
   */
  recordSuccess(sessionId: string): void {
    this.failureCounts.delete(sessionId)
  }

  /**
   * Check if resume is allowed for a session (circuit is not open).
   */
  isResumeAllowed(sessionId: string): boolean {
    return (this.failureCounts.get(sessionId) ?? 0) < this.maxFailures
  }

  /**
   * Get the current failure count for a session.
   */
  getFailureCount(sessionId: string): number {
    return this.failureCounts.get(sessionId) ?? 0
  }

  /**
   * Reset the circuit breaker for a specific session or all sessions.
   */
  reset(sessionId?: string): void {
    if (sessionId != null) {
      this.failureCounts.delete(sessionId)
    } else {
      this.failureCounts.clear()
    }
  }
}
