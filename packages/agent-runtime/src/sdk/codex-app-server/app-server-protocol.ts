/**
 * codex app-server v2 协议类型（Spark 消费面子集）。
 *
 * 来源：`codex app-server generate-ts --out <dir>`（0.149.0 实测），
 * 本文件只收敛 CodexAppServerExecutor 实际读写的请求/通知/条目形状；
 * 未消费的字段一律不声明，避免与上游 experimental 协议过度耦合。
 * 升级 codex 运行时版本时重新生成 schema 并核对本文件。
 *
 * 关键协议事实（2026-08-16 运行时实验确认）：
 * - 帧格式是 NDJSON（每行一个 JSON-RPC 消息）；LSP Content-Length 帧会被拒绝。
 * - `turn/start` 的 input 是 UserInput 数组（字符串会报 -32600）。
 * - v2 没有 `item/updated` 通知：条目中间态经 `item/<类别>/delta` 定向通知投递。
 * - ThreadItem 判别值是 camelCase（agentMessage/commandExecution/…），
 *   与 @openai/codex-sdk 的 snake_case（agent_message/command_execution/…）不同。
 */

// ── JSON-RPC 帧 ────────────────────────────────────────────────────────────

export interface JsonRpcClientRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponseFrame {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: JsonRpcErrorShape
}

/** server → client 请求（审批等），必须回响应否则上游 turn 挂起。 */
export interface JsonRpcServerRequestFrame {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcNotificationFrame {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

// ── initialize / thread / turn 请求参数 ────────────────────────────────────

export interface AppServerClientInfo {
  name: string
  version: string
}

export interface AppServerInitializeParams {
  clientInfo: AppServerClientInfo
}

export type AppServerSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type AppServerApprovalPolicy = 'untrusted' | 'on-request' | 'never'
export type AppServerApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent'
export type AppServerSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess: boolean }
  | {
      type: 'workspaceWrite'
      writableRoots: string[]
      networkAccess: boolean
      excludeTmpdirEnvVar: boolean
      excludeSlashTmp: boolean
    }

/** thread/start 与 thread/resume 共享的会话级参数（resume 另需 threadId）。 */
export interface AppServerThreadParamsBase {
  cwd?: string | undefined
  model?: string | undefined
  sandbox?: AppServerSandboxMode | undefined
  approvalPolicy?: AppServerApprovalPolicy | undefined
  approvalsReviewer?: AppServerApprovalsReviewer | undefined
  /** codex TOML config 覆盖（model_providers / mcp_servers / web_search 等），等价 exec 的 `--config k=v`。 */
  config?: Record<string, unknown> | undefined
}

export interface AppServerThreadResponse {
  thread: { id: string }
}

export type AppServerUserInput = { type: 'text'; text: string }

export interface AppServerTurnStartParams {
  threadId: string
  clientUserMessageId?: string | null | undefined
  input: AppServerUserInput[]
  /** 0.149.0 官方 turn 级覆盖；同时作用于当前 turn 与后续 turn。 */
  approvalPolicy?: AppServerApprovalPolicy | null | undefined
  approvalsReviewer?: AppServerApprovalsReviewer | null | undefined
  sandboxPolicy?: AppServerSandboxPolicy | null | undefined
  effort?: string | undefined
  /** Official Fast mode override. null explicitly clears sticky state from a prior turn. */
  serviceTier?: 'fast' | null | undefined
}

export interface AppServerTurnInterruptParams {
  threadId: string
  turnId: string
}

// ── 通知（消费面） ─────────────────────────────────────────────────────────

export interface AgentMessageDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

export interface ReasoningDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
  contentIndex?: number | undefined
}

export interface CommandExecutionOutputDeltaNotification {
  threadId: string
  turnId: string
  itemId: string
  delta: string
}

export interface ItemLifecycleNotification {
  threadId: string
  turnId: string
  item: AppServerThreadItem
  startedAtMs?: number | undefined
  completedAtMs?: number | undefined
}

export interface TokenUsageBreakdown {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface ThreadTokenUsageUpdatedNotification {
  threadId: string
  turnId: string
  tokenUsage: {
    last: TokenUsageBreakdown
    total: TokenUsageBreakdown
    modelContextWindow?: number | null
  }
}

export type AppServerTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'

export interface TurnLifecycleNotification {
  threadId: string
  turn: {
    id: string
    status: AppServerTurnStatus
    error?: { message?: string } | null
  }
}

export interface ErrorNotificationParams {
  threadId: string
  turnId: string
  error: { message?: string }
  willRetry: boolean
}

// ── ThreadItem（v2 camelCase 判别联合，仅声明消费的变体） ───────────────────

/**
 * 仅声明消费的条目变体；上游新增未知变体时由 dispatch 的 default 分支忽略
 * （边界处以 `as AppServerThreadItem` 收窄，运行时宽容）。
 */
export type AppServerThreadItem =
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string }
  | {
      type: 'commandExecution'
      id: string
      command: string
      status: AppServerCommandStatus
      aggregatedOutput?: string | null
      exitCode?: number | null
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      arguments?: unknown
      status: AppServerMcpToolStatus
      result?: unknown
      error?: { message?: string } | null
    }
  | {
      type: 'fileChange'
      id: string
      status: AppServerPatchStatus
      changes: Array<{ kind: 'add' | 'delete' | 'update'; path: string; diff: string }>
    }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'plan'; id: string; text: string }
  | { type: 'contextCompaction'; id: string }

export type AppServerCommandStatus = 'inProgress' | 'completed' | 'failed' | 'declined'
export type AppServerMcpToolStatus = 'inProgress' | 'completed' | 'failed'
export type AppServerPatchStatus = 'inProgress' | 'completed' | 'failed' | 'declined'

// ── server → client 审批请求（Phase 1 需确定性响应防挂起） ──────────────────

export interface CommandExecutionApprovalParams {
  threadId: string
  turnId: string
  itemId?: string | null
  command?: string | null
}

export interface CommandExecutionApprovalResponse {
  decision: 'accept' | 'acceptForSession' | 'deny'
}

export interface FileChangeApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
}

export interface FileChangeApprovalResponse {
  decision: 'accept' | 'acceptForSession' | 'deny'
}

export interface PermissionsApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
}

/** 拒绝授予任何附加权限：全 null profile + turn 作用域。 */
export interface PermissionsApprovalResponse {
  permissions: {
    fileSystem?: null
    network?: null
  }
  scope: 'turn'
}

/** v1 兼容审批方法（applyPatchApproval / execCommandApproval）与 v2 同形决策。 */
export type LegacyApprovalResponse = CommandExecutionApprovalResponse | FileChangeApprovalResponse
