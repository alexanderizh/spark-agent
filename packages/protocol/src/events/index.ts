/**
 * @module events
 *
 * Spark Agent 统一事件协议 (AgentEvent)
 *
 * 设计目标：
 *   - Claude Adapter 的输出必须转换为此格式
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
export type ProviderId = 'claude' | string

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
  /** 附件（图片/文件/目录路径，目录作为上下文引用）*/
  attachments?: Array<{
    type: 'image' | 'file' | 'directory'
    path: string
    name?: string
    mimeType?: string
  }>
  /** 团队模式：用户通过 @ 指定的直接处理 Agent ID（未填 → 走 Host 主循环） */
  mentionAgentId?: string
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
  /**
   * 消息段标识：同一 turn 内每条 SDK assistant message（被工具调用分隔的一段正文）
   * 对应一个稳定 segmentId。complete 只替换同 segment 的流式文本，不同 segment
   * 的文本在时间线上各自保留。缺省（历史事件）时退回“complete 替换最近流式文本”。
   */
  segmentId?: string
  agentId?: string
  agentName?: string
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
  /** Team Mode：该工具调用来自某个被调度成员 Agent 时的归属信息 */
  teamMemberContext?: TeamMemberEventContext
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
  /** Team Mode：该工具结果来自某个被调度成员 Agent 时的归属信息 */
  teamMemberContext?: TeamMemberEventContext
}

// ─── 子 Agent 事件 ──────────────────────────────────────────────────────────

/** 子 Agent 开始执行（由 Claude Code SDK 的 Agent 工具触发） */
export interface SubagentStartedEvent extends BaseEvent {
  type: 'subagent_started'
  /** 关联的 toolCallId（来自 SDK 的 tool_use block ID）*/
  toolCallId: string
  /** 子 Agent 名称 */
  name: string
  /** 角色/描述 */
  role: string
  /** 分配给子 Agent 的任务描述 */
  task: string
  /** Claude SDK 后台任务 ID。同步子 Agent 可能没有该字段。 */
  taskId?: string
}

/** 子 Agent / 后台任务的增量进度。 */
export interface SubagentProgressEvent extends BaseEvent {
  type: 'subagent_progress'
  toolCallId: string
  taskId?: string
  description?: string
  summary?: string
  lastToolName?: string
  totalTokens?: number
  toolUses?: number
  durationMs?: number
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'paused'
}

/** 转发到父会话的子 Agent 正文/思考，仅供嵌套 transcript 使用。 */
export interface SubagentMessageEvent extends BaseEvent {
  type: 'subagent_message'
  toolCallId: string
  contentKind: 'text' | 'thinking'
  mode: 'delta' | 'complete'
  content: string
  segmentId: string
}

/** 子 Agent 执行完成 */
export interface SubagentCompletedEvent extends BaseEvent {
  type: 'subagent_completed'
  /** 关联的 toolCallId（对应 SubagentStartedEvent.toolCallId）*/
  toolCallId: string
  /** 子 Agent 名称 */
  name: string
  /** 完成状态 */
  status: 'success' | 'error' | 'stopped'
  /** 结果摘要 */
  resultSummary: string
  /** 完整输出（可展开查看）*/
  output: string
  /** Token 用量 */
  inputTokens?: number
  outputTokens?: number
  /** SDK 后台任务仅提供合计 token 时使用。 */
  totalTokens?: number
  toolUses?: number
  /** 执行耗时 ms */
  durationMs?: number
}

// ─── Team Mode (A2A) 事件 ─────────────────────────────────────────────────────
//
// 团队模式：主 Agent（Host）通过 agent_team_dispatch 工具调用成员 Agent（Member）。
// A2A 调用的 Task / Reply 结构定义在事件层（被事件引用），ipc 层从此处复用，
// 以保持 ipc → events 的单向依赖（ipc/index.ts 已 import 本模块）。
//
// 注意：这些事件与 SDK 内置的 subagent_started/completed 是**两套独立抽象**。
// Team Member 的渲染粒度、审计、配色与 Claude SDK 内置 subagent 不同，
// 因此使用专属 team_dispatch_* / team_member_* 事件，详见「团队模式开发」设计文档 §3.4。

/** 一次 A2A 调用的任务描述（Host → Member 投递的工作单元） */
export interface TeamA2ATask {
  /** 任务唯一 ID（uuid） */
  taskId: string
  /** 发起调用的主持 Agent ID */
  hostAgentId: string
  /** 被调用的成员 Agent ID */
  memberAgentId: string
  /** 触发本次 dispatch 的用户 turn ID（用于审计；可能为空） */
  rootTurnId: string
  /** Host 想让 Member 做什么的自然语言描述（自包含） */
  instruction: string
  /** 可选的结构化输入 */
  inputs?: Record<string, unknown>
  /** 引用的产物（来自 Host 之前一步的输出，按 ID 或内联） */
  attachments?: Array<{
    type: 'text' | 'file_ref' | 'image_ref'
    value: string
  }>
  /** Host 期望的输出形态提示 */
  expectedOutput?: 'text' | 'json' | 'code' | 'mixed'
  /** 此次调用超时（ms），默认 120_000 */
  timeoutMs?: number
}

/** Member 完成 A2A 调用后返回给 Host 的结构化回复 */
export interface TeamA2AReply {
  taskId: string
  /** 返回该结果的成员 Agent ID；Host 用它对应 batch 中每个 dispatch */
  memberAgentId: string
  /** 返回该结果的成员显示名（可选，用于 Host/日志可读性） */
  memberName?: string
  state: 'completed' | 'failed' | 'canceled'
  /** 主要文本输出（给 Host LLM 看的） */
  content: string
  /** 结构化产物（可选） */
  artifacts?: Array<{
    type: 'text' | 'file' | 'image' | 'json'
    name?: string
    /** file/image: 路径；json: stringified */
    value: string
  }>
  /** 用量 */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    durationMs: number
  }
  error?: {
    code:
      | 'timeout'
      | 'denied'
      | 'depth_exceeded'
      | 'member_disabled'
      | 'invalid_member'
      | 'internal'
    message: string
  }
}

/** Host 发起一次 dispatch（UI: 出现「Host → Member」调用卡片） */
export interface TeamDispatchRequestedEvent extends BaseEvent {
  type: 'team_dispatch_requested'
  dispatchId: string
  hostAgentId: string
  memberAgentId: string
  task: TeamA2ATask
}

/** Member 的流式/完整文本输出（复用 AssistantMessageEvent 的 mode/content 语义） */
export interface TeamMemberMessageEvent extends BaseEvent {
  type: 'team_member_message'
  dispatchId: string
  memberAgentId: string
  mode: 'delta' | 'complete'
  content: string
  isFinal: boolean
  /** 同 AssistantMessageEvent.segmentId：member 一次 dispatch 内的消息段标识 */
  segmentId?: string
}

export interface TeamMemberEventContext {
  dispatchId: string
  memberAgentId: string
}

/** Member 在一次 dispatch 内的状态流转 */
export interface TeamMemberStatusEvent extends BaseEvent {
  type: 'team_member_status'
  dispatchId: string
  memberAgentId: string
  status: 'pending' | 'working' | 'idle' | 'completed' | 'failed'
}

/** 一次 dispatch 收尾，附带 Member 的结构化回复（UI: 收口 status chip） */
export interface TeamDispatchCompletedEvent extends BaseEvent {
  type: 'team_dispatch_completed'
  dispatchId: string
  hostAgentId: string
  memberAgentId: string
  reply: TeamA2AReply
}

/**
 * 成员对等消息（peer-to-peer）入线程事件。
 *
 * 由 `agent_message` 工具调用产生：
 *  - 广播（不填 targetAgentId）：仅写线程，不触发任何成员执行；
 *  - 定向 @（填 targetAgentId）：触发目标一次完整 turn，本事件在写入线程时同步发出。
 *
 * UI 据此渲染 Member→Member / Member 广播气泡（区别于 Host→Member 的 team_member_message）。
 */
export interface TeamPeerMessageEvent extends BaseEvent {
  type: 'team_peer_message'
  /** 关联讨论 ID（团队讨论线程），用于把消息归到正确的时间线 */
  discussionId: string
  /** 发言者 Agent ID（可以是 Host 或 Member） */
  memberAgentId: string
  /** 定向目标 Agent ID；缺省 = 广播 */
  targetAgentId?: string | undefined
  /** 关联的 dispatch（定向 @ 场景下指向被触发的那次 dispatch） */
  dispatchId?: string | undefined
  /** 投递语义；缺省按历史事件处理为 call（广播仍是异步写线程）。 */
  delivery?: 'call' | 'note' | undefined
  /** 消息文本 */
  content: string
  /**
   * true = 由「正文 @ 自动转发」产生，content 是发送者刚说完的回复原文的副本。
   * UI 应降级为轻量转发提示，避免同一段内容渲染两遍。
   */
  autoForwarded?: boolean | undefined
}

/**
 * Host（首版仅 Host）调用 `team_round_advance` 推进讨论轮次。
 *
 * UI 据此画一条轮次分割线；后端据此把 `team_discussions.round_index` +1。
 * 超过 maxRounds 时后端拒绝推进（不发出本事件）。
 */
export interface TeamRoundEvent extends BaseEvent {
  type: 'team_round_advanced'
  /** 关联讨论 ID */
  discussionId: string
  /** 推进后的轮序号（从 0 起算，advance 后写入） */
  round: number
  /** 本讨论配置的最大轮数（来自 TeamModeConfig.maxDiscussionRounds） */
  maxRounds: number
}

/**
 * 讨论收尾事件（team_conclude）。
 *
 * 讨论被 Host 显式 conclude、或被会话取消、或因其它终止条件触发时发出。
 * 之后该 discussionId 不再接受任何 advance/peer_message（除非用户新开一场讨论）。
 */
export interface TeamDiscussionConcludedEvent extends BaseEvent {
  type: 'team_discussion_concluded'
  /** 关联讨论 ID */
  discussionId: string
  /** 收尾原因：'concluded'（Host 显式收尾）/ 'canceled'（会话取消）/ 'max_rounds'（硬上限兜底） */
  reason: 'concluded' | 'canceled' | 'max_rounds'
}

/**
 * 宿主本轮进入"编排模式"：Edit/Write/Bash/Task 等自实现工具被移出上下文
 * （见 ORCHESTRATOR_HOST_DISALLOWED_TOOLS），只能通过 dispatch 工具委派给成员/
 * workflow worker 执行。`source` 区分触发来源——显式打开的团队模式，还是当前
 * agent 挂了带真实派发节点的 workflow（用户未必知道自己在这个模式里）。
 * UI 据此显示编排态标识，agent 系统提示词也据此主动跟用户解释这个限制。
 */
export interface OrchestrationStatusEvent extends BaseEvent {
  type: 'orchestration_status'
  active: boolean
  source: 'team' | 'workflow'
  hostAgentId: string
  hostAgentName: string
  memberCount: number
}

export type WorkflowProgressNodeStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface WorkflowProgressNode {
  nodeId: string
  title: string
  kind: string
  status: WorkflowProgressNodeStatus
  /** 仅 agent/subagent 节点有意义：实际派发目标与本次实际生效的模型（节点覆盖优先于成员默认值）。 */
  agentId?: string
  agentName?: string
  modelId?: string
}

/**
 * workflow_run 单次调用期间的实时节点进度快照——每个节点开始/完成/失败时都会重新
 * 发一份完整列表（不是增量），UI 据此渲染类似任务面板的实时清单。
 */
export interface WorkflowProgressEvent extends BaseEvent {
  type: 'workflow_progress'
  workflowId: string
  runStatus: 'working' | 'completed' | 'failed' | 'canceled'
  nodes: WorkflowProgressNode[]
}

// ─── 权限类事件 ──────────────────────────────────────────────────────────────

export type PermissionRiskLevel = 'safe' | 'moderate' | 'high' | 'critical'
export type PermissionAction =
  | 'file_read'
  | 'file_write'
  | 'command_exec'
  | 'network'
  | 'mcp'
  | 'git'

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
  /** Team Mode：该文件变更来自某个被调度成员 Agent 时的归属信息 */
  teamMemberContext?: TeamMemberEventContext
}

/** Agent 显式选择在本轮回复中呈现给用户的文件。 */
export interface PresentedFilesEvent extends BaseEvent {
  type: 'presented_files'
  files: Array<{
    /** 已通过 Runtime 校验的绝对文件路径。 */
    path: string
    /** Agent 提供的可选展示标题。 */
    title?: string
  }>
}

/** Checkpoint metadata emitted by SDK-backed agent turns. */
export interface CheckpointEvent extends BaseEvent {
  type: 'checkpoint'
  checkpointId: string
  label?: string
  path?: string
  filePaths?: string[]
  /** SDK 会话 id：restore 时 resume 出 Query 调 rewindFiles(checkpointId) 用。 */
  sdkSessionId?: string
}

export interface ValidationCommandSuggestion {
  id: string
  label: string
  command: string
  reason: string
}

export interface ValidationSuggestionEvent extends BaseEvent {
  type: 'validation_suggestion'
  summary: string
  changedFiles: string[]
  commands: ValidationCommandSuggestion[]
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
  /** Team Mode：该终端输出来自某个被调度成员 Agent 时的归属信息 */
  teamMemberContext?: TeamMemberEventContext
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
  agentId?: string
  agentName?: string
}

/**
 * 会话历史重置事件 —— 由 `/clear` 等命令触发
 *
 * 语义：renderer 收到此事件后，**清空当前 session 的本地缓存**（消息、usage、
 *      context、状态指示等），但**保留**此事件之后到达的所有事件，让随后的
 *      user_message/assistant_message 在干净的状态下重新渲染。
 *
 * 持久化：写入 SQLite，hydrate 时只需把本事件出现位置之前的事件视为「已废弃」
 *        即可（当前实现里我们在 emit 之前已经把旧事件从 DB 删除，因此回放时
 *        本事件只是一个无副作用的分隔符）。
 */
export interface SessionHistoryResetEvent extends BaseEvent {
  type: 'session_history_reset'
  /** 触发原因，例如 'clear-command'，便于审计/调试 */
  reason: string
}

/** Agent 思考过程（extended thinking，可折叠展示） */
export interface AgentThinkingEvent extends BaseEvent {
  type: 'agent_thinking'
  mode: 'delta' | 'complete'
  content: string
  /** 同 AssistantMessageEvent.segmentId：complete 只替换同 segment 的思考文本 */
  segmentId?: string
  agentId?: string
  agentName?: string
}

export type GoalEventStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cleared'
  | 'stopped_by_budget'
  | 'pending_contract'
export type GoalEventType =
  | 'goal_started'
  | 'goal_progress'
  | 'goal_paused'
  | 'goal_resumed'
  | 'goal_completed'
  | 'goal_failed'
  | 'goal_cleared'
  | 'goal_budget_stopped'
  | 'goal_contract_drafting'
  | 'goal_contract_proposed'

/** 验收门槛（Gate）：编排者起草、待用户确认的目标验收契约。 */
export interface ProposedGoalContract {
  successCriteria: string[]
  constraints: string[]
  validation: { commands?: string[]; checklist?: string[] }
}

export interface GoalEvent extends BaseEvent {
  type: GoalEventType
  goalId: string
  objective: string
  status: GoalEventStatus
  iteration: number
  phase?: 'review' | 'act' | 'validate'
  summary: string
  evidence?: string[]
  nextStep?: string
  validation?: Record<string, unknown>
  budget?: Record<string, unknown>
  /** 仅 goal_contract_proposed 事件携带：编排者起草的待确认验收契约。 */
  proposedContract?: ProposedGoalContract
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
  /** 累计推理输出 token（当前 Turn，Codex reasoning token）*/
  reasoningOutputTokens?: number
  /** 缓存命中 token（Anthropic 特有，cache_read）*/
  cacheHitTokens?: number
  /** 缓存写入 token（Anthropic 特有，cache_creation）*/
  cacheWriteTokens?: number
  /** 预估成本（USD）*/
  estimatedCostUsd?: number
}

/**
 * 当前 turn 内 SDK prompt / messages 上下文占用估算。
 * 与 UsageUpdateEvent 的区别：
 *   - UsageUpdateEvent 由 adapter 发出，反映"刚发生的一次 LLM 调用的 token"
 *   - ContextUsageEvent 由 SDK executor 发出，反映本轮即将携带的上下文规模
 * UI 可用 estimatedTokens / softLimitTokens 显示进度条；接近上限时弹「即将自动压缩」提示。
 */
export interface ContextUsageEvent extends BaseEvent {
  type: 'context_usage'
  /** 粗略估算的 prompt/messages tokens */
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

export interface ContextLedgerEntry {
  /** Section label (e.g., "System Prompt", "Project Context", "Conversation History", "Skill Prompt") */
  label: string
  /** Estimated token count for this section */
  estimatedTokens: number
  /** Character count for this section */
  charCount: number
  /** Whether this section was truncated to fit budget */
  truncated: boolean
}

export interface ContextLedgerEvent extends BaseEvent {
  type: 'context_ledger'
  /** Per-section token breakdown */
  sections: ContextLedgerEntry[]
  /** Total estimated tokens across all sections */
  totalEstimatedTokens: number
  /** Model soft context limit */
  softLimitTokens: number
  /** Model hard context window */
  contextWindowTokens: number
  /** Percentage of soft limit used */
  usagePercent: number
}

/** Emitted when the Context Governor summarizes older turns */
export interface ContextSummarizedEvent extends BaseEvent {
  type: 'context_summarized'
  /** Number of older dialogue entries that were summarized */
  summarizedEntryCount: number
  /** Seq range of the summarized entries */
  fromSeq: number
  toSeq: number
  /** Estimated tokens saved by summarization */
  tokensSaved: number
  /** Estimated tokens of the summary itself */
  summaryTokens: number
}

/** Emitted only when a provider/CLI reports a real context compaction event. */
export interface ContextCompactionEvent extends BaseEvent {
  type: 'context_compaction'
  provider: 'claude' | 'codex'
  source: 'claude_code' | 'codex_cli' | 'codex_sdk'
  phase: 'started' | 'completed' | 'failed' | 'boundary'
  /** Provider-reported trigger, when present. */
  trigger?: 'manual' | 'auto' | string
  /** Provider-reported token count before compaction, when present. */
  preTokens?: number
  /** Provider-reported token count after compaction, when present. */
  postTokens?: number
  /** Provider-reported compaction duration, when present. */
  durationMs?: number
  /** Provider/CLI supplied summary text; never synthesized by Spark. */
  summary?: string
  /** Provider/CLI supplied error or status text, when present. */
  message?: string
  /** Raw provider event discriminator for auditability. */
  rawType?: string
}

/** A single attempt in a self-correction retry trail */
export interface RetryAttempt {
  /** Attempt number (1-based) */
  attempt: number
  /** What was tried */
  action: string
  /** Result: 'success' | 'failure' | 'partial' */
  result: 'success' | 'failure' | 'partial'
  /** Brief failure summary (if failed) */
  failureSummary?: string
  /** Duration in ms */
  durationMs?: number
}

/** Emitted when the agent performs a self-correction retry loop */
export interface RetryTrailEvent extends BaseEvent {
  type: 'retry_trail'
  /** What was being validated/fixed */
  target: string
  /** All attempts in chronological order */
  attempts: RetryAttempt[]
  /** Final outcome */
  finalOutcome: 'success' | 'failure' | 'abandoned'
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
 *   - 批准：重新发送（或自动注入）一条 "继续执行该计划" 的消息，并在
 *     session:send-turn 上携带 permissionMode=claude-auto-edits + interruptActive=true；
 *     sendTurn 会持久化 runtime，发送成功后 UI 本地同步显示新的可编辑模式。
 *   - 拒绝：什么也不做，turn 已经结束，用户可以继续聊天调整计划。
 *
 * 当前 turn 在发出该事件后立即结束（status: completed），不会调用更多 tools。
 */
export interface PlanProposedEvent extends BaseEvent {
  type: 'plan_proposed'
  /** Markdown 格式的计划文本（agent 写的 plan） */
  plan: string
}

/**
 * 用户拒绝了 plan_proposed 的待审批计划。
 *
 * 拒绝是一个「已决议」标记：写入 append-only 事件流后，历史回放（切换/重开会话）
 * 时 MessageBuilder 会据此清空待审批状态，避免已拒绝的计划重新弹出审批面板。
 * 后端同时解除该会话的 plan 审批闸门（pendingPlanApprovals），让被阻塞的排队
 * turn 恢复自动起跑——无需用户先手动发一条消息。
 */
export interface PlanRejectedEvent extends BaseEvent {
  type: 'plan_rejected'
}

// ─── 错误类事件 ──────────────────────────────────────────────────────────────

/** Provider 运行时错误/信号的来源。省略时表示当前 Host Agent。 */
export type RuntimeEventOrigin =
  | {
      kind: 'subagent'
      toolCallId: string
      name: string
    }
  | {
      kind: 'runtime'
      name: string
    }

/** Agent 运行时错误 */
export interface AgentErrorEvent extends BaseEvent {
  type: 'agent_error'
  /** 错误码 */
  code: string
  /** 面向用户的短标题 */
  title?: string
  /** 错误消息 */
  message: string
  /** 是否可重试 */
  retryable: boolean
  /** 建议用户采取的下一步 */
  actionHint?: string
  /** 可展示的结构化诊断信息 */
  details?: RuntimeSignalDetail[]
  /** 协作 Agent 或 Provider SDK 来源；避免把子任务错误误认为 Host 错误。 */
  origin?: RuntimeEventOrigin
  /** 原始错误（调试用，不显示给普通用户）*/
  rawError?: string
}

export interface RuntimeSignalDetail {
  label: string
  value: string
}

/** Provider/SDK 运行时信号，不一定代表整轮失败。 */
export interface RuntimeSignalEvent extends BaseEvent {
  type: 'runtime_signal'
  signal:
    | 'api_retry'
    | 'permission_denied'
    | 'auth_status'
    | 'rate_limit'
    | 'model_refusal_fallback'
    | 'notification'
    | 'mirror_error'
    | 'worker_shutdown'
    | 'background_tasks'
  level: 'info' | 'warning' | 'error'
  title: string
  message: string
  code?: string
  retryable?: boolean
  actionHint?: string
  details?: RuntimeSignalDetail[]
  /** 协作 Agent 或 Provider SDK 来源；Provider 未提供关联 ID 时使用 runtime。 */
  origin?: RuntimeEventOrigin
}

/** 撤回 provider 已明确标记为被替代的旧事件。 */
export interface TranscriptRetractionEvent extends BaseEvent {
  type: 'transcript_retraction'
  eventIds: string[]
  reason: 'model_refusal_fallback'
}

// ─── 白盒调试类事件 ───────────────────────────────────────────────────────────

/** 提示词快照段落 */
export interface PromptSection {
  /** 段落标签（如 "Skill Prompt"、"System Prompt"、"Claude Code Preset"） */
  label: string
  /** 段落内容文本 */
  content: string
  /** 字符数 */
  charCount: number
}

/**
 * SDK/API 每次调用的真实全量提示词快照
 *
 * 在每个 turn 启动时发出，包含系统提示词、用户消息、模型配置等信息，
 * 用于白盒模式下的提示词审计与调试。
 */
export interface TurnPromptSnapshotEvent extends BaseEvent {
  type: 'turn_prompt_snapshot'
  turnId: string
  /** 触发本轮的用户消息 */
  userMessage: string
  /** 按顺序排列的系统提示词段落 */
  systemPromptSections: PromptSection[]
  /** 使用的模型名称 */
  model: string
  /** Provider 配置 Profile ID */
  providerProfileId?: string
  /** 执行适配器类型 */
  adapterKind: 'claude-sdk' | 'codex'
  /** 权限模式 */
  permissionMode: string
  /** 可用工具数量 */
  toolCount: number
  /** SDK 预设类型（如 'claude_code'），仅 claude-sdk 适配器有值 */
  sdkPreset?: string
  /** 底层 SDK 会话 ID，用于判断是否可以安全 resume */
  sdkSessionId?: string
  /** Runtime prompt composition audit, used to verify which context layers were loaded. */
  runtimeLoadStatus?: Array<{
    key: string
    label: string
    loaded: boolean
    charCount: number
    itemCount?: number
  }>
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
  | PresentedFilesEvent
  | CheckpointEvent
  | ValidationSuggestionEvent
  | TerminalOutputEvent
  | AgentStatusEvent
  | AgentThinkingEvent
  | SessionHistoryResetEvent
  | GoalEvent
  | UsageUpdateEvent
  | AgentErrorEvent
  | RuntimeSignalEvent
  | TranscriptRetractionEvent
  | PlanProposedEvent
  | PlanRejectedEvent
  | ContextUsageEvent
  | ProjectContextLoadedEvent
  | TurnPromptSnapshotEvent
  | ContextLedgerEvent
  | ContextSummarizedEvent
  | ContextCompactionEvent
  | RetryTrailEvent
  | SubagentStartedEvent
  | SubagentProgressEvent
  | SubagentMessageEvent
  | SubagentCompletedEvent
  | TeamDispatchRequestedEvent
  | TeamMemberMessageEvent
  | TeamMemberStatusEvent
  | TeamDispatchCompletedEvent
  | TeamPeerMessageEvent
  | TeamRoundEvent
  | TeamDiscussionConcludedEvent
  | OrchestrationStatusEvent
  | WorkflowProgressEvent

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
