/**
 * @module events
 *
 * Spark Agent 统一事件协议 (AgentEvent)
 *
 * 设计目标：
 *   - Claude Adapter 和 Codex Adapter 的输出都必须转换为此格式
 *   - Renderer 通过 IPC 接收这些事件并驱动 Timeline UI
 *   - 所有事件写入 SQLite agent_events 表，供回放和审计
 *
 * 事件分类：
 *   - 消息类：UserMessage, AssistantMessage (含流式)
 *   - 工具类：ToolCall, ToolResult
 *   - 权限类：PermissionRequest, PermissionResponse
 *   - 文件类：FileChange
 *   - 终端类：TerminalOutput
 *   - 状态类：AgentStatus, AgentThinking
 *   - 资源类：UsageUpdate
 *   - 错误类：AgentError
 *
 * 注：P1-01 中浩轩-特级开发将完整实现所有事件字段和校验逻辑
 *     本文件只建立类型框架，确保 P0-07 (IPC) 可以引用正确类型
 */

import { z } from 'zod'

// ─── 基础类型 ────────────────────────────────────────────────────────────────

/** 事件 ID，格式：nanoid */
export type EventId = string & { readonly __brand: 'EventId' }

/** Session ID */
export type SessionId = string & { readonly __brand: 'SessionId' }

/** Turn ID，一次用户输入到 Agent 完整响应为一个 Turn */
export type TurnId = string & { readonly __brand: 'TurnId' }

/** Provider 标识 */
export type ProviderId = 'claude' | 'codex' | string

// ─── 事件基础结构 ─────────────────────────────────────────────────────────────

export const BaseEventSchema = z.object({
  /** 事件唯一 ID */
  id: z.string(),
  /** 事件类型 */
  type: z.string(),
  /** 所属 Session ID */
  sessionId: z.string(),
  /** 所属 Turn ID（同一用户输入触发的所有事件共享同一 TurnId） */
  turnId: z.string(),
  /** 事件发生时间戳（ISO 8601） */
  timestamp: z.string().datetime(),
  /** 事件序号（同 session 内单调递增） */
  seq: z.number().int().nonnegative(),
})

export type BaseEvent = z.infer<typeof BaseEventSchema>

// ─── 消息类事件 ──────────────────────────────────────────────────────────────

/** 用户发送的消息 */
export interface UserMessageEvent extends BaseEvent {
  type: 'user_message'
  content: string
  /** 附件（图片/文件路径）*/
  attachments?: Array<{
    type: 'image' | 'file'
    path: string
    mimeType?: string
  }>
}

/** Assistant 文本消息（流式：delta 模式；完整：complete 模式） */
export interface AssistantMessageEvent extends BaseEvent {
  type: 'assistant_message'
  /** 消息模式 */
  mode: 'delta' | 'complete'
  /** delta 模式：增量文本；complete 模式：完整文本 */
  content: string
  /** 来源 Provider */
  provider: ProviderId
  /** 是否为最终完整消息 */
  isFinal: boolean
}

// ─── 工具类事件 ──────────────────────────────────────────────────────────────

/** 工具调用请求（Agent 发出） */
export interface ToolCallEvent extends BaseEvent {
  type: 'tool_call'
  /** 工具调用 ID（对应 ToolResultEvent.toolCallId）*/
  toolCallId: string
  /** 工具名称 */
  toolName: string
  /** 工具参数（JSON-serializable）*/
  toolInput: Record<string, unknown>
  /** 工具来源：内置工具 / MCP Server 工具 */
  source: 'builtin' | 'mcp'
  /** MCP Server 标识（仅 source=mcp 时） */
  mcpServerId?: string
}

/** 工具执行结果 */
export interface ToolResultEvent extends BaseEvent {
  type: 'tool_result'
  /** 对应的 ToolCallEvent.toolCallId */
  toolCallId: string
  toolName: string
  /** 执行状态 */
  status: 'success' | 'error' | 'denied'
  /** 结果内容（成功时）*/
  output?: unknown
  /** 错误信息（失败时）*/
  error?: string
  /** 执行耗时 ms */
  durationMs?: number
}

// ─── 权限类事件 ──────────────────────────────────────────────────────────────

export type PermissionRiskLevel = 'safe' | 'moderate' | 'high' | 'critical'
export type PermissionAction = 'file_read' | 'file_write' | 'command_exec' | 'network' | 'mcp' | 'git'

/** Agent 请求权限（需用户审批时触发）*/
export interface PermissionRequestEvent extends BaseEvent {
  type: 'permission_request'
  /** 权限请求 ID */
  requestId: string
  /** 权限动作 */
  action: PermissionAction
  /** 风险等级 */
  riskLevel: PermissionRiskLevel
  /** 请求描述（显示给用户）*/
  description: string
  /** 涉及的路径（file_read/file_write/git）*/
  paths?: string[]
  /** 涉及的命令（command_exec）*/
  command?: string
  /** 涉及的域名（network）*/
  domains?: string[]
}

/** 用户对权限请求的响应 */
export interface PermissionResponseEvent extends BaseEvent {
  type: 'permission_response'
  requestId: string
  /** 用户决策 */
  decision: 'allow_once' | 'allow_session' | 'allow_project' | 'deny'
  /** 用户响应时间戳 */
  respondedAt: string
}

// ─── 文件类事件 ──────────────────────────────────────────────────────────────

/** 文件变更事件（用于 Diff UI 展示） */
export interface FileChangeEvent extends BaseEvent {
  type: 'file_change'
  /** 变更类型 */
  changeType: 'create' | 'modify' | 'delete' | 'rename'
  /** 文件路径（相对于 workspace root）*/
  path: string
  /** rename 时的旧路径 */
  oldPath?: string
  /** unified diff 格式的内容变更 */
  diff?: string
  /** 文件大小（bytes） */
  sizeBytes?: number
}

/** Checkpoint metadata emitted by SDK-backed agent turns. */
export interface CheckpointEvent extends BaseEvent {
  type: 'checkpoint'
  checkpointId: string
  label?: string
  path?: string
  filePaths?: string[]
}

// ─── 终端类事件 ──────────────────────────────────────────────────────────────

/** 命令执行输出（用于 xterm.js 渲染） */
export interface TerminalOutputEvent extends BaseEvent {
  type: 'terminal_output'
  /** 关联的 ToolCallEvent.toolCallId */
  toolCallId: string
  /** 输出类型 */
  stream: 'stdout' | 'stderr'
  /** 原始输出（含 ANSI 转义序列）*/
  data: string
  /** 是否为最终输出（命令执行完毕）*/
  isFinal: boolean
  /** 退出码（仅 isFinal=true 时） */
  exitCode?: number
}

// ─── 状态类事件 ──────────────────────────────────────────────────────────────

export type AgentStatusValue =
  | 'idle'
  | 'thinking'
  | 'calling_tool'
  | 'waiting_permission'
  | 'waiting_user'
  | 'cancelled'
  | 'completed'
  | 'error'

/** Agent 状态变更 */
export interface AgentStatusEvent extends BaseEvent {
  type: 'agent_status'
  status: AgentStatusValue
  /** 状态描述（显示在 Agent Card 上）*/
  message?: string
}

/** Agent 思考过程（extended thinking，可折叠展示） */
export interface AgentThinkingEvent extends BaseEvent {
  type: 'agent_thinking'
  mode: 'delta' | 'complete'
  content: string
}

// ─── 资源使用类事件 ──────────────────────────────────────────────────────────

/** Token 和成本使用更新 */
export interface UsageUpdateEvent extends BaseEvent {
  type: 'usage_update'
  provider: ProviderId
  model: string
  /** 累计输入 token（当前 Turn）*/
  inputTokens: number
  /** 累计输出 token（当前 Turn）*/
  outputTokens: number
  /** 缓存命中 token（Anthropic 特有）*/
  cacheHitTokens?: number
  /** 预估成本（USD）*/
  estimatedCostUsd?: number
}

/**
 * 当前 turn 内 messages 上下文占用估算（agent-loop 每轮 LLM 调用前发出）。
 * 与 UsageUpdateEvent 的区别：
 *   - UsageUpdateEvent 由 adapter 发出，反映"刚发生的一次 LLM 调用的 token"
 *   - ContextUsageEvent 由 agent-loop 发出，反映"下一次 LLM 调用即将携带的上下文规模"
 * UI 可用 estimatedTokens / softLimitTokens 显示进度条；接近上限时弹「即将自动压缩」提示。
 */
export interface ContextUsageEvent extends BaseEvent {
  type: 'context_usage'
  /** 粗略估算的 messages tokens（agent-loop 用 ~3 chars/token 估算） */
  estimatedTokens: number
  /** 模型的软上限（实际上下文窗口的 ~70%；超过即触发自动压缩） */
  softLimitTokens: number
  /** 该模型的硬上限（仅用于 UI 展示） */
  contextWindowTokens: number
  /** 本轮是否触发了自动压缩 */
  compacted: boolean
}

export interface ProjectContextSource {
  kind: 'rule' | 'skill' | 'agent'
  name: string
  path: string
  estimatedTokens?: number
  included?: boolean
  reason?: string
  truncated?: boolean
}

export interface ProjectContextBudget {
  mode: 'minimal' | 'project-smart' | 'deep-research' | 'review' | 'manual'
  budgetTokens: number
  usedTokens: number
  truncated: boolean
}

export interface ProjectContextLoadedEvent extends BaseEvent {
  type: 'project_context_loaded'
  workspaceRoot?: string
  sources: ProjectContextSource[]
  budget?: ProjectContextBudget
  counts: {
    rules: number
    skills: number
    agents: number
  }
}

// ─── Plan-mode 事件 ─────────────────────────────────────────────────────────

/**
 * Agent 在 claude-plan 模式下通过 exit_plan_mode 工具提交了一份计划，
 * 等待用户审批。UI 应在此事件触发后展示「批准/拒绝/编辑后批准」选项：
 *
 *   - 批准：调用 session:update 把 permissionMode 切到 claude-auto-edits，
 *     然后用户重新发送（或自动注入）一条 "继续执行该计划" 的消息。
 *   - 拒绝：什么也不做，turn 已经结束，用户可以继续聊天调整计划。
 *
 * 当前 turn 在发出该事件后立即结束（status: completed），不会调用更多 tools。
 */
export interface PlanProposedEvent extends BaseEvent {
  type: 'plan_proposed'
  /** Markdown 格式的计划文本（agent 写的 plan） */
  plan: string
}

// ─── 错误类事件 ──────────────────────────────────────────────────────────────

/** Agent 运行时错误 */
export interface AgentErrorEvent extends BaseEvent {
  type: 'agent_error'
  /** 错误码 */
  code: string
  /** 错误消息 */
  message: string
  /** 是否可重试 */
  retryable: boolean
  /** 原始错误（调试用，不显示给普通用户）*/
  rawError?: string
}

// ─── AgentEvent 联合类型 ──────────────────────────────────────────────────────

/**
 * 所有 Agent 事件的联合类型
 *
 * Adapter 层（Claude/Codex）输出此类型的事件流
 * IPC 层传输此类型
 * SQLite 存储此类型的序列化形式
 * Renderer Timeline UI 消费此类型
 */
export type AgentEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | PermissionResponseEvent
  | FileChangeEvent
  | CheckpointEvent
  | TerminalOutputEvent
  | AgentStatusEvent
  | AgentThinkingEvent
  | UsageUpdateEvent
  | AgentErrorEvent
  | PlanProposedEvent
  | ContextUsageEvent
  | ProjectContextLoadedEvent

/** AgentEvent 的 type 字段联合 */
export type AgentEventType = AgentEvent['type']

/**
 * 事件类型守卫工厂
 * @example
 * if (isEventType('tool_call')(event)) {
 *   // event 的类型被收窄为 ToolCallEvent
 * }
 */
export function isEventType<T extends AgentEventType>(
  type: T,
): (event: AgentEvent) => event is Extract<AgentEvent, { type: T }> {
  return (event): event is Extract<AgentEvent, { type: T }> => event.type === type
}
