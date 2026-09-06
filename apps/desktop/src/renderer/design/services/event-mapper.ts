import type {
  AgentEvent,
  GoalEvent,
  GoalEventStatus,
  ProposedGoalContract,
  TeamA2ATask,
  TeamA2AReply,
  TeamMemberEventContext,
  ToolSchemaTokenObservation,
  TurnPromptSnapshotEvent,
  TurnRuntimeMetrics,
  TurnSource,
  UserMessageVisibility,
  RuntimeEventOrigin,
  UserQuestionOption,
  UserQuestionPrompt,
  WorkflowProgressNode,
} from '@spark/protocol'
import { isEngineCompactSummaryText } from '@spark/protocol'
import {
  prepareTurnFileSummary,
  type TurnFileChangeCollectionSource,
  type TurnFileSummaryGeneratedGroup,
} from './turn-file-summary'
import { isQuickReplySuggestionsTool, parseQuickReplies } from './quick-reply-suggestions'
import { isRenderHtmlTool, parseRenderHtmlInput, parseRenderHtmlResult } from './render-html'
import {
  isRenderDiagramTool,
  parseRenderDiagramInput,
  parseRenderDiagramResult,
} from './render-diagram'
import type { DiagramRenderType } from '@spark/shared'

/** Renderer-only delivery state for a user message submitted optimistically. */
export type UserMessageDeliveryState = 'submitting' | 'queued' | 'accepted' | 'failed' | 'cancelled'

export interface UIMessageSessionReference {
  sourceSessionId: string
  snapshotSeq?: number
  /** Renderer-only title carried by optimistic messages; persisted events resolve it from session data. */
  title?: string
}

export interface UIMessage {
  id: string
  turnId?: string
  /** Persisted Turn source; used by the renderer's visible projection and audit-safe actions. */
  turnSource?: TurnSource
  /** The original user body is hidden; logical messages and assistant output remain available. */
  userMessageVisibility?: UserMessageVisibility
  /** Safe user-facing body for an otherwise hidden platform-generated message. */
  userMessageDisplayContent?: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'error' | 'cancelled'
  blocks: UIBlock[]
  attachments?: Array<{
    type: 'image' | 'file' | 'directory'
    path: string
    name?: string
    /** Renderer-only local preview fields used by optimistic user messages. */
    previewPath?: string
    previewUrl?: string
  }>
  /** Read-only session references submitted with this user turn. */
  sessionReferences?: UIMessageSessionReference[]
  usage: {
    inputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    estimatedCostUsd: number | undefined
  } | null
  /** 消息创建时间（ISO 8601），取自事件 timestamp */
  timestamp?: string | undefined
  /**
   * 该 assistant 消息整轮耗时（毫秒）：终态事件 timestamp − 消息创建 timestamp。
   * 只在消息进入终态（completed / error / cancelled）时写入一次；历史回放按同一
   * 事件序列重算可得相同值，无需持久化。用户消息与未完成消息恒为 undefined。
   */
  durationMs?: number | undefined
  /** 参与构建此消息的所有事件 ID（用于删除时定位数据库事件） */
  eventIds: string[]
  /** 团队模式：该用户消息通过 @ 指定的 Agent ID（未填 → Host 主循环） */
  mentionAgentId?: string
  /** Assistant Agent snapshot captured when this message was created. */
  agentId?: string
  agentName?: string
  /** Renderer-only state; persisted user_message events do not set this field. */
  deliveryState?: UserMessageDeliveryState
  /** Renderer-only error detail for a failed optimistic submission. */
  deliveryError?: string
  /** Renderer-only client id used to reconcile an optimistic message. */
  clientId?: string
}

export interface FileChangeSummary {
  path: string
  changeType: 'create' | 'modify' | 'delete' | 'rename'
  adds: number
  dels: number
  collectionSource?: TurnFileChangeCollectionSource
  /** 原始 unified diff，用于「重新应用」时正向 patch */
  diff?: string
}

export interface UserQuestionAnswerSummary {
  question: string
  answer: string
  skipped?: boolean
}

export type UIBlock =
  | {
      kind: 'text'
      content: string
      isStreaming: boolean
      segmentId?: string
      /** Renderer hint set only by the provider's final assistant_message event. */
      isFinalAnswer?: boolean
    }
  | {
      kind: 'thinking'
      content: string
      isStreaming: boolean
      segmentId?: string
      teamMemberContext?: TeamMemberEventContext
    }
  | { kind: 'cancelled'; message: string }
  | {
      kind: 'tool_call'
      toolCallId: string
      toolName: string
      toolInput: Record<string, unknown>
      status: 'pending' | 'running' | 'success' | 'error'
      output: string | undefined
      error: string | undefined
      durationMs: number | undefined
      teamMemberContext?: TeamMemberEventContext
    }
  | {
      kind: 'error'
      code: string
      title?: string
      message: string
      retryable: boolean
      actionHint?: string
      details?: Array<{ label: string; value: string }>
      origin?: RuntimeEventOrigin
      occurrenceCount?: number
    }
  | {
      kind: 'runtime_signal'
      signal: string
      level: 'info' | 'warning' | 'error'
      title: string
      message: string
      code?: string
      retryable: boolean
      actionHint?: string
      details?: Array<{ label: string; value: string }>
      origin?: RuntimeEventOrigin
      occurrenceCount?: number
    }
  | {
      kind: 'file_change'
      changeType: string
      path: string
      diff: string | undefined
      teamMemberContext?: TeamMemberEventContext
    }
  | {
      kind: 'checkpoint'
      checkpointId: string
      label: string | undefined
      path: string | undefined
      filePaths: string[] | undefined
    }
  | {
      kind: 'validation_suggestion'
      summary: string
      changedFiles: string[]
      commands: Array<{ id: string; label: string; command: string; reason: string }>
    }
  | { kind: 'quick_replies'; toolCallId: string; replies: string[] }
  | {
      kind: 'html_block'
      toolCallId: string
      html: string
      title: string
      height: number
      status: 'pending' | 'rendered' | 'error'
      error: string | undefined
      warnings: string[]
    }
  | {
      kind: 'diagram_block'
      toolCallId: string
      diagramType: DiagramRenderType
      source: string
      title: string
      height: number
      status: 'pending' | 'rendered' | 'error'
      error: string | undefined
      warnings: string[]
    }
  | {
      kind: 'terminal'
      toolCallId: string
      stdout: string
      stderr: string
      isStreaming: boolean
      exitCode: number | undefined
      teamMemberContext?: TeamMemberEventContext
    }
  | { kind: 'plan_proposed'; plan: string }
  | {
      /** goal 契约门控：起草完成的验收契约，等待用户确认/拒绝（GoalContractCard）。 */
      kind: 'goal_contract'
      goalId: string
      objective: string
      contract: ProposedGoalContract
      /** pending：等待确认；confirmed/rejected：已被 goal_started/goal_cleared 解决（历史回放保持终态）。 */
      state: 'pending' | 'confirmed' | 'rejected'
    }
  | {
      /** 目标模式：迭代轮次分割线。iteration_start 型 goal_progress 落块；
       *  轮末 iteration_result 回填 agent 自报小结；goal 终态事件置 completed/failed/stopped_by_budget。 */
      kind: 'goal_iteration_divider'
      goalId: string
      iteration: number
      maxIterations?: number
      phase?: 'review' | 'act' | 'validate'
      /** running：迭代进行中；result：本轮收尾（含小结）；completed/failed/stopped_by_budget：目标终态。 */
      state: 'running' | 'result' | 'completed' | 'failed' | 'stopped_by_budget'
      /** 轮末 agent 自报小结（iteration_result / 预算停止原因回填）。 */
      resultSummary?: string
      resultNextStep?: string
    }
  | {
      kind: 'permission_request'
      requestId: string
      action: string
      riskLevel: string
      description: string
      paths: string[] | undefined
      command: string | undefined
      domains: string[] | undefined
    }
  | {
      kind: 'subagent'
      toolCallId: string
      taskId?: string
      name: string
      role: string
      task: string
      status: 'running' | 'done' | 'error' | 'stopped' | 'paused'
      tokens: string
      progressSummary?: string
      resultSummary?: string
      lastToolName?: string
      toolUses?: number
      durationMs?: number
      transcript?: Array<{
        kind: 'text' | 'thinking'
        content: string
        segmentId: string
      }>
      /** Full output (available when status=done) */
      output?: string
    }
  | {
      kind: 'turn_file_summary'
      files: FileChangeSummary[]
      totalAdds: number
      totalDels: number
      /** 被判定为构建/缓存/大批量生成的文件目录聚合。 */
      generatedGroups?: TurnFileSummaryGeneratedGroup[]
      /** 该 turn 内最近一次 checkpoint，用于「撤销」 */
      latestCheckpointId: string | undefined
    }
  | {
      kind: 'presented_files'
      files: Array<{ path: string; title?: string }>
    }
  | {
      kind: 'application_snapshot'
      snapshotId: string
      previewUrl: string
      appName: string
      windowTitle: string
      capturedAt: string
    }
  | {
      kind: 'user_question'
      toolCallId: string
      questions: UserQuestionPrompt[]
      answered: boolean
      answerSummary?: UserQuestionAnswerSummary[]
      error?: string
    }
  | {
      kind: 'context_ledger'
      sections: Array<{
        label: string
        estimatedTokens: number
        charCount: number
        truncated: boolean
      }>
      totalEstimatedTokens: number
      softLimitTokens: number
      contextWindowTokens: number
      usagePercent: number
    }
  | {
      kind: 'context_summarized'
      summarizedEntryCount: number
      tokensSaved: number
      summaryTokens: number
    }
  | {
      kind: 'context_compaction'
      provider: 'claude' | 'codex' | 'spark'
      source: 'claude_code' | 'codex_cli' | 'codex_sdk' | 'spark_engine'
      phase: 'started' | 'completed' | 'failed' | 'boundary'
      trigger?: string
      preTokens?: number
      postTokens?: number
      durationMs?: number
      summary?: string
      message?: string
      rawType?: string
    }
  | {
      kind: 'retry_trail'
      target: string
      attempts: Array<{
        attempt: number
        action: string
        result: 'success' | 'failure' | 'partial'
        failureSummary?: string
        durationMs?: number
      }>
      finalOutcome: 'success' | 'failure' | 'abandoned'
    }
  | {
      /** Team Mode：Host 调用 Member 的调用卡片（team_dispatch_requested/completed） */
      kind: 'team_dispatch'
      dispatchId: string
      hostAgentId: string
      memberAgentId: string
      task: TeamA2ATask
      state: 'pending' | 'working' | 'completed' | 'failed' | 'canceled'
      reply?: TeamA2AReply
    }
  | {
      /** Team Mode：被调用 Member 的消息气泡（team_member_message） */
      kind: 'team_member_message'
      dispatchId: string
      memberAgentId: string
      content: string
      isStreaming: boolean
      segmentId?: string
      /** Renderer hint set only by the member's final team_member_message event. */
      isFinalAnswer?: boolean
      /** 产生/更新该 block 所消费的源 event id，用于「只删这条成员消息」时反查 event。 */
      eventIds?: string[]
    }
  | {
      /** Team Mode：团队讨论里的协作消息（team_peer_message） */
      kind: 'team_peer_message'
      discussionId: string
      memberAgentId: string
      targetAgentId?: string
      delivery?: 'call' | 'note'
      content: string
      /** true = 正文 @ 自动转发的回复原文副本，UI 降级为轻量转发提示 */
      autoForwarded?: boolean
    }
  | {
      /** Team Mode：团队讨论轮次分割线（team_round_advanced） */
      kind: 'team_round_divider'
      discussionId: string
      round: number
      maxRounds: number
    }
  | {
      /** Team Mode：团队讨论结束提示（team_discussion_concluded） */
      kind: 'team_discussion_status'
      discussionId: string
      reason: 'concluded' | 'canceled' | 'max_rounds'
    }
  | {
      /** workflow_run 的实时节点进度清单（workflow_progress 事件驱动，按 runId 更新）。 */
      kind: 'workflow_progress'
      workflowId: string
      /** 稳定运行标识；可选以兼容未持久化 runId 的旧 workflow_progress 事件。 */
      runId?: string
      runStatus: 'working' | 'completed' | 'failed' | 'canceled'
      nodes: WorkflowProgressNode[]
    }

export interface ContextUsageSnapshot {
  estimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  compactedThisTurn: boolean
}

/** Goal 状态轻量快照，用于 UI 侧右上角 GitEnvPanel 等浮窗展示。
 *  完整 SessionGoal 通过 IPC `session:get-goal` 获取；这里只保留事件流可派生的字段。 */
export interface GoalSnapshot {
  goalId: string
  objective: string
  status: GoalEventStatus
  iteration: number
  maxIterations?: number
  phase?: 'review' | 'act' | 'validate'
  summary: string
  nextStep?: string
}

/** 宿主是否处于编排（团队/工作流托管）模式——保留全量工具，提示词引导「优先派发」。 */
export interface OrchestrationSnapshot {
  source: 'team' | 'workflow'
  hostAgentId: string
  hostAgentName: string
  memberCount: number
}

const SUBAGENT_TRANSCRIPT_MAX_CHARS = 24_000

function isTerminalSubagentStatus(
  status: Extract<UIBlock, { kind: 'subagent' }>['status'],
): boolean {
  return status === 'done' || status === 'error' || status === 'stopped'
}

function trimSubagentTranscript(
  transcript: Array<{ kind: 'text' | 'thinking'; content: string; segmentId: string }>,
): void {
  let overflow =
    transcript.reduce((total, entry) => total + entry.content.length, 0) -
    SUBAGENT_TRANSCRIPT_MAX_CHARS
  while (overflow > 0 && transcript.length > 0) {
    const first = transcript[0]!
    if (first.content.length <= overflow) {
      overflow -= first.content.length
      transcript.shift()
    } else {
      first.content = first.content.slice(overflow)
      overflow = 0
    }
  }
}

function runtimeEventOriginKey(origin: RuntimeEventOrigin | undefined): string {
  if (origin == null) return 'host'
  return origin.kind === 'subagent' ? `subagent:${origin.toolCallId}` : `runtime:${origin.name}`
}

function runtimeSignalAggregationKey(signal: {
  signal: string
  code?: string
  message: string
  details?: Array<{ label: string; value: string }>
  origin?: RuntimeEventOrigin
}): string {
  const stableDetails =
    signal.signal === 'api_retry'
      ? signal.details?.filter(
          (detail) => detail.label !== '重试进度' && detail.label !== '等待时间',
        )
      : signal.details
  return JSON.stringify([
    signal.signal,
    signal.code ?? '',
    runtimeEventOriginKey(signal.origin),
    signal.message,
    stableDetails ?? [],
  ])
}

function agentErrorAggregationKey(error: {
  code: string
  message: string
  details?: Array<{ label: string; value: string }>
  origin?: RuntimeEventOrigin
}): string {
  return JSON.stringify([
    error.code,
    runtimeEventOriginKey(error.origin),
    error.message,
    error.details ?? [],
  ])
}

const CANCELLATION_ERROR_CODES = new Set(['ABORTED', 'CODEX_CLI_CANCELLED', 'CODEX_SDK_CANCELLED'])

function isCancellationErrorCode(code: string): boolean {
  return CANCELLATION_ERROR_CODES.has(code.trim().toUpperCase())
}

function isBenignCodexSkillsBudgetError(error: { code: string; message: string }): boolean {
  const code = error.code.trim().toUpperCase()
  if (code !== 'CODEX_SDK_ITEM_ERROR' && code !== 'CODEX_CLI_ITEM_ERROR') return false
  const message = error.message.toLowerCase()
  return (
    message.includes('skill descriptions were shortened to fit') &&
    message.includes('skills context budget') &&
    message.includes('codex can still see every skill')
  )
}

function mergeTurnRuntimeMetrics(
  current: TurnRuntimeMetrics | undefined,
  patch: TurnRuntimeMetrics | undefined,
): TurnRuntimeMetrics | undefined {
  if (current == null) return patch
  if (patch == null) return current

  const currentSchemas = current.toolSchemas
  const patchSchemas = patch.toolSchemas
  const mergedDeferred = mergeToolSchemaObservation(
    currentSchemas?.deferred,
    patchSchemas?.deferred,
  )
  const mergedLoaded = mergeToolSchemaObservation(currentSchemas?.loaded, patchSchemas?.loaded)
  const mergedSchemas =
    patchSchemas == null
      ? currentSchemas
      : {
          declared:
            mergeToolSchemaObservation(currentSchemas?.declared, patchSchemas.declared) ??
            patchSchemas.declared,
          ...(mergedDeferred != null ? { deferred: mergedDeferred } : {}),
          ...(mergedLoaded != null ? { loaded: mergedLoaded } : {}),
        }

  return {
    ...current,
    ...patch,
    ...(mergedSchemas != null ? { toolSchemas: mergedSchemas } : {}),
  }
}

function mergeToolSchemaObservation(
  current: ToolSchemaTokenObservation | undefined,
  patch: ToolSchemaTokenObservation | undefined,
): ToolSchemaTokenObservation | undefined {
  if (current == null) return patch
  if (patch == null) return current
  return { ...current, ...patch }
}

function canContinueLegacyWorkflowProgress(
  previous: readonly WorkflowProgressNode[],
  next: readonly WorkflowProgressNode[],
): boolean {
  const settledNodeIds = new Set(
    previous
      .filter((node) => node.status === 'completed' || node.status === 'skipped')
      .map((node) => node.nodeId),
  )
  if (settledNodeIds.size === 0) return false

  const nextSettledNodeIds = new Set(
    next
      .filter((node) => node.status === 'completed' || node.status === 'skipped')
      .map((node) => node.nodeId),
  )
  return [...settledNodeIds].every((nodeId) => nextSettledNodeIds.has(nodeId))
}

/** 压缩卡片的可合并字段；context_compaction 事件与旧版摘要分流共用此形状。 */
type CompactionCardFields = {
  provider: 'claude' | 'codex' | 'spark'
  source: 'claude_code' | 'codex_cli' | 'codex_sdk' | 'spark_engine'
  phase: 'started' | 'completed' | 'failed' | 'boundary'
  trigger?: string
  preTokens?: number
  postTokens?: number
  durationMs?: number
  summary?: string
  message?: string
  rawType?: string
}

export class MessageBuilder {
  private messages: UIMessage[] = []
  private processedEventIds = new Set<string>()
  private currentAssistantId: string | null = null
  private latestContextUsage: ContextUsageSnapshot | null = null
  private latestPlanProposed: string | null = null
  private activeGoal: GoalSnapshot | null = null
  private orchestrationStatus: OrchestrationSnapshot | null = null
  private turnPromptSnapshots: TurnPromptSnapshotEvent[] = []
  private turnRuntimeMetrics = new Map<string, TurnRuntimeMetrics>()
  /** 追踪当前 turn 的文件变更，用于生成汇总 */
  private currentTurnFileChanges: FileChangeSummary[] = []
  /** 当前 turn 内最近一次 checkpoint id，用于「撤销」 */
  private currentTurnCheckpointId: string | undefined
  /** 是否已经为当前 turn 生成了汇总 */
  private turnSummaryEmitted = false

  getLatestContextUsage(): ContextUsageSnapshot | null {
    return this.latestContextUsage
  }

  getTurnPromptSnapshots(): TurnPromptSnapshotEvent[] {
    // React state consumers need a fresh array when incremental metrics update
    // an existing snapshot; returning the mutable backing array would be Object.is-equal.
    return [...this.turnPromptSnapshots]
  }

  consumePlanProposed(): string | null {
    const plan = this.latestPlanProposed
    this.latestPlanProposed = null
    return plan
  }

  /** Peek the latest unresolved plan_proposed without clearing it.
   *  Used after history hydrate to detect a plan modal that was dismissed without
   *  approval/cancel (eg. APP_RESTARTED) so the UI can re-prompt the user. */
  getPendingPlan(): string | null {
    return this.latestPlanProposed
  }

  /** 当前活跃 Goal 的轻量快照；无活跃 Goal（未启动 / 已 completed/failed/cleared）返回 null。 */
  getActiveGoal(): GoalSnapshot | null {
    return this.activeGoal
  }

  /** 最近一次 turn 是否处于编排模式；null 表示这个会话至今没有触发过编排限制。 */
  getOrchestrationStatus(): OrchestrationSnapshot | null {
    return this.orchestrationStatus
  }

  processEvent(event: AgentEvent): void {
    if (this.processedEventIds.has(event.id)) return
    if (event.type !== 'session_history_reset') {
      this.processedEventIds.add(event.id)
    }
    switch (event.type) {
      case 'session_history_reset': {
        // /clear 等清空历史的命令在写入新事件之前会发这条标记，回放时遇到它要把
        // 之前累积的消息状态丢弃，只保留之后到达的事件。
        this.clearAll()
        this.processedEventIds.add(event.id)
        this.latestContextUsage = null
        this.latestPlanProposed = null
        break
      }
      case 'transcript_retraction': {
        const retracted = new Set(event.eventIds)
        const previousCount = this.messages.length
        this.messages = this.messages.filter(
          (message) => !message.eventIds.some((eventId) => retracted.has(eventId)),
        )
        if (this.messages.length !== previousCount) {
          this.currentTurnFileChanges = []
          this.currentTurnCheckpointId = undefined
          this.turnSummaryEmitted = false
        }
        if (
          this.currentAssistantId != null &&
          !this.messages.some((message) => message.id === this.currentAssistantId)
        ) {
          this.currentAssistantId =
            [...this.messages].reverse().find((message) => message.role === 'assistant')?.id ?? null
        }
        break
      }
      case 'user_message': {
        // 新用户消息抵达 = 上一个待审批的 plan 已被处理（批准发送 send-turn 或被取消后用户重新发言）
        this.latestPlanProposed = null
        const userMessage: UIMessage = {
          id: event.id,
          turnId: event.turnId,
          role: 'user',
          status: 'completed',
          blocks: [{ kind: 'text', content: event.content, isStreaming: false }],
          ...(event.attachments != null && event.attachments.length > 0
            ? { attachments: event.attachments }
            : {}),
          ...(event.sessionReferences != null && event.sessionReferences.length > 0
            ? {
                sessionReferences: event.sessionReferences.map((reference) => ({
                  sourceSessionId: reference.sourceSessionId,
                  ...(reference.snapshotSeq !== undefined
                    ? { snapshotSeq: reference.snapshotSeq }
                    : {}),
                })),
              }
            : {}),
          usage: null,
          timestamp: event.timestamp,
          eventIds: [event.id],
          ...(event.clientMessageId != null ? { clientId: event.clientMessageId } : {}),
          ...(event.mentionAgentId != null ? { mentionAgentId: event.mentionAgentId } : {}),
          ...(event.turnSource != null ? { turnSource: event.turnSource } : {}),
          ...(event.userMessageVisibility != null
            ? { userMessageVisibility: event.userMessageVisibility }
            : {}),
          ...(event.userMessageDisplayContent != null
            ? { userMessageDisplayContent: event.userMessageDisplayContent }
            : {}),
        }
        const existingAssistantIndex = this.messages.findIndex(
          (message) => message.role === 'assistant' && message.turnId === event.turnId,
        )
        if (existingAssistantIndex >= 0) {
          this.messages.splice(existingAssistantIndex, 0, userMessage)
          const existingAssistant = this.messages[existingAssistantIndex + 1]
          this.currentAssistantId = existingAssistant?.id ?? null
        } else {
          this.currentAssistantId = null
          this.messages.push(userMessage)
        }
        break
      }

      case 'assistant_message': {
        let msg = this.findAssistantForEvent(event)

        if (!msg) {
          msg = {
            id: event.id,
            turnId: event.turnId,
            role: 'assistant',
            status: 'streaming',
            blocks: [],
            usage: null,
            timestamp: event.timestamp,
            eventIds: [event.id],
            ...(event.agentId != null ? { agentId: event.agentId } : {}),
            ...(event.agentName != null ? { agentName: event.agentName } : {}),
          }
          this.messages.push(msg)
          this.currentAssistantId = msg.id
        } else {
          if (!msg.eventIds.includes(event.id)) {
            msg.eventIds.push(event.id)
          }
          this.applyAgentSnapshot(msg, event)
        }

        if (event.mode === 'complete') {
          if (event.isFinal) {
            // 最终 result 文本只做去重收尾；整轮终态仍需等 agent_status，避免后续事件被提前折叠。
            this.reconcileFinalText(msg, event.content, event.provider)
            if (event.provider === 'spark') {
              msg.status = 'completed'
              // spark provider 以最终 assistant_message 收尾，不再有 agent_status 终态事件。
              this.markTurnDuration(msg, event)
            }
            break
          }
          if (isEngineCompactSummaryText(event.content)) {
            // 旧版本把引擎注入的压缩承接摘要持久化为 assistant_message 正文；回放时
            // 改挂到压缩卡片的 summary（与 runtime 新链路的 context_compaction 事件同构）。
            this.upsertCompactionBlock(msg, {
              provider: 'claude',
              source: 'claude_code',
              phase: 'boundary',
              summary: event.content,
              rawType: 'assistant_message/compact_summary',
            })
            break
          }
          this.applySegmentComplete(msg.blocks, 'text', event.content, event.segmentId)
          break
        }

        this.applySegmentDelta(msg.blocks, 'text', event.content, event.segmentId)

        if (event.isFinal) {
          this.reconcileFinalText(msg, event.content, event.provider)
        }
        break
      }

      case 'agent_thinking': {
        const home =
          event.teamMemberContext != null
            ? this.findTeamMemberDispatchHome(event.teamMemberContext.dispatchId)
            : undefined
        const msg =
          home ?? this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (home != null && !home.eventIds.includes(event.id)) home.eventIds.push(event.id)
        this.applyAgentSnapshot(msg, event)
        if (event.mode === 'complete') {
          this.applySegmentComplete(msg.blocks, 'thinking', event.content, event.segmentId)
        } else {
          this.applySegmentDelta(msg.blocks, 'thinking', event.content, event.segmentId)
        }
        if (event.teamMemberContext != null) {
          const block = [...msg.blocks]
            .reverse()
            .find(
              (candidate): candidate is Extract<UIBlock, { kind: 'thinking' }> =>
                candidate.kind === 'thinking' &&
                (event.segmentId == null || candidate.segmentId === event.segmentId),
            )
          if (block != null) block.teamMemberContext = event.teamMemberContext
        }
        break
      }

      case 'tool_call': {
        // member 工具调用归位到该 dispatch 的宿主消息，避免气泡分裂
        const home =
          event.teamMemberContext != null
            ? this.findTeamMemberDispatchHome(event.teamMemberContext.dispatchId)
            : undefined
        const msg =
          home ?? this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (home != null && !home.eventIds.includes(event.id)) home.eventIds.push(event.id)
        // AskUserQuestion gets its own dedicated inline block
        const isAskQuestion =
          event.toolName.replace(/[-_]/g, '').toLowerCase() === 'askuserquestion'
        if (isAskQuestion) {
          const questions = extractQuestions(event.toolInput)
          msg.blocks.push({
            kind: 'user_question',
            toolCallId: event.toolCallId,
            questions,
            answered: false,
          })
        } else if (isQuickReplySuggestionsTool(event.toolName)) {
          const replies = parseQuickReplies(event.toolInput)
          if (replies.length > 0) {
            msg.blocks.push({
              kind: 'quick_replies',
              toolCallId: event.toolCallId,
              replies,
            })
          }
        } else if (isRenderHtmlTool(event.toolName)) {
          const input = parseRenderHtmlInput(event.toolInput)
          if (input != null) {
            msg.blocks.push({
              kind: 'html_block',
              toolCallId: event.toolCallId,
              html: input.html,
              title: input.title,
              height: input.height,
              status: 'pending',
              error: undefined,
              warnings: [],
            })
          }
        } else if (isRenderDiagramTool(event.toolName)) {
          const input = parseRenderDiagramInput(event.toolInput)
          if (input != null) {
            msg.blocks.push({
              kind: 'diagram_block',
              toolCallId: event.toolCallId,
              diagramType: input.diagramType,
              source: input.source,
              title: input.title,
              height: input.height,
              status: 'pending',
              error: undefined,
              warnings: [],
            })
          }
        } else {
          msg.blocks.push({
            kind: 'tool_call',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            status: 'pending',
            output: undefined,
            error: undefined,
            durationMs: undefined,
            ...(event.teamMemberContext != null
              ? { teamMemberContext: event.teamMemberContext }
              : {}),
          })
        }
        break
      }

      case 'tool_result': {
        // 优先在「包含该 toolCall block 的消息」上更新（member 工具结果可能不在当前消息）
        const owner = this.findToolEventOwner(event.turnId, event.toolCallId)
        const msg = owner ?? this.findAssistantForEvent(event)
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          // Update user_question block answered state
          const questionBlock = msg.blocks.find(
            (b) => b.kind === 'user_question' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'user_question' }> | undefined
          if (questionBlock) {
            if (event.status === 'success') {
              questionBlock.answered = true
              delete questionBlock.error
              // Only overwrite answerSummary if we don't already have one
              // (answers may have been populated when the user submitted via the dock)
              if (!questionBlock.answerSummary || questionBlock.answerSummary.length === 0) {
                questionBlock.answerSummary = extractQuestionAnswerSummary(
                  event.output,
                  questionBlock.questions,
                )
              }
            } else {
              questionBlock.answered = false
              questionBlock.error = event.error ?? '提问工具未能完成'
            }
          }
          const htmlBlock = msg.blocks.find(
            (b) => b.kind === 'html_block' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'html_block' }> | undefined
          if (htmlBlock) {
            if (event.status === 'success') {
              const result = parseRenderHtmlResult(event.output)
              if (result?.accepted === true) {
                htmlBlock.status = 'rendered'
                htmlBlock.error = undefined
                if (result.html != null) htmlBlock.html = result.html
                if (result.title != null) htmlBlock.title = result.title
                if (result.height != null) htmlBlock.height = result.height
                htmlBlock.warnings = result.warnings ?? []
              } else {
                htmlBlock.status = 'error'
                htmlBlock.error = result?.reason ?? 'HTML 渲染工具未返回有效内容'
              }
            } else {
              htmlBlock.status = 'error'
              htmlBlock.error = event.error ?? 'HTML 渲染工具执行失败'
            }
          }
          const diagramBlock = msg.blocks.find(
            (b) => b.kind === 'diagram_block' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'diagram_block' }> | undefined
          if (diagramBlock) {
            if (event.status === 'success') {
              const result = parseRenderDiagramResult(event.output)
              if (result?.accepted === true) {
                diagramBlock.status = 'rendered'
                diagramBlock.error = undefined
                if (result.type != null) diagramBlock.diagramType = result.type
                if (result.source != null) diagramBlock.source = result.source
                if (result.title != null) diagramBlock.title = result.title
                if (result.height != null) diagramBlock.height = result.height
                diagramBlock.warnings = result.warnings ?? []
              } else {
                diagramBlock.status = 'error'
                diagramBlock.error = result?.reason ?? '图表渲染工具未返回有效内容'
              }
            } else {
              diagramBlock.status = 'error'
              diagramBlock.error = event.error ?? '图表渲染工具执行失败'
            }
          }
          // Update tool_call block
          const block = msg.blocks.find(
            (b) => b.kind === 'tool_call' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'tool_call' }> | undefined
          if (block) {
            block.status = event.status === 'success' ? 'success' : 'error'
            block.output = formatToolOutput(event.output)
            block.error = event.error
            block.durationMs = event.durationMs
            if (event.teamMemberContext != null) block.teamMemberContext = event.teamMemberContext
          }
          if (
            event.status === 'success' &&
            event.toolName.toLowerCase().endsWith('capture_app_snapshot')
          ) {
            const snapshot = extractApplicationSnapshotPreview(event.output)
            if (
              snapshot != null &&
              !msg.blocks.some(
                (candidate) =>
                  candidate.kind === 'application_snapshot' &&
                  candidate.snapshotId === snapshot.snapshotId,
              )
            ) {
              msg.blocks.push({ kind: 'application_snapshot', ...snapshot })
            }
          }
        }
        break
      }

      case 'agent_status': {
        // 注意：plan turn 的正常结束顺序就是 plan_proposed → agent_status(completed)，
        // 计划在此刻依然「待审批」。因此这里绝不能清空 latestPlanProposed，否则历史回放
        // （切换/重开会话）走到 completed 时会把待审批计划抹掉，导致审批面板消失、只剩
        // 「历史计划」。待审批状态只应由 user_message（已批准/已重新发言）或
        // session_history_reset 清除。
        const msg =
          this.findAssistantForEvent(event) ??
          (event.status === 'cancelled'
            ? this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
            : null)
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          this.applyAgentSnapshot(msg, event)
          if (event.status === 'completed') {
            msg.status = 'completed'
            this.finishStreamingBlocks(msg, 'completed')
            this.markTurnDuration(msg, event)
            // 在 turn 完成时生成文件变更汇总
            this.appendTurnSummary(msg)
          } else if (event.status === 'error') {
            msg.status = 'error'
            this.finishStreamingBlocks(msg, 'error')
            this.markTurnDuration(msg, event)
            // 即使出错也生成文件变更汇总
            this.appendTurnSummary(msg)
          } else if (event.status === 'cancelled') {
            this.finishStreamingBlocks(msg, 'error')
            this.markTurnDuration(msg, event)
            const hasHostFailure = msg.blocks.some(
              (block) => block.kind === 'error' && block.origin?.kind !== 'subagent',
            )
            if (hasHostFailure) {
              msg.status = 'error'
            } else {
              msg.status = 'cancelled'
              if (!msg.blocks.some((block) => block.kind === 'cancelled')) {
                msg.blocks.push({ kind: 'cancelled', message: '已取消本次任务' })
              }
            }
            this.appendTurnSummary(msg)
          }
        }
        break
      }

      case 'agent_error': {
        // Codex 会把 Skills 初始目录的渐进披露裁剪作为 error item 上报；它不影响
        // 后续读取完整 SKILL.md。这里兼容已经持久化的旧事件，避免历史会话继续显示假失败。
        if (isBenignCodexSkillsBudgetError(event)) break
        if (event.origin?.kind !== 'subagent' && isCancellationErrorCode(event.code)) {
          const msg =
            this.findAssistantForEvent(event) ??
            this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          msg.status = 'cancelled'
          this.finishStreamingBlocks(msg, 'error')
          this.markTurnDuration(msg, event)
          if (!msg.blocks.some((block) => block.kind === 'cancelled')) {
            msg.blocks.push({ kind: 'cancelled', message: '已取消本次任务' })
          }
          break
        }

        const aggregationKey = agentErrorAggregationKey(event)
        const existing = this.findRuntimeIssueBlock(
          event.turnId,
          (block) => block.kind === 'error' && agentErrorAggregationKey(block) === aggregationKey,
        )
        const relatedSubagent =
          event.origin?.kind === 'subagent'
            ? this.findSubagentBlock({
                turnId: event.turnId,
                toolCallId: event.origin.toolCallId,
              })
            : null
        const msg =
          existing?.message ??
          relatedSubagent?.message ??
          this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)

        if (event.origin?.kind === 'subagent') {
          if (relatedSubagent != null && !isTerminalSubagentStatus(relatedSubagent.block.status)) {
            relatedSubagent.block.status = 'error'
            relatedSubagent.block.resultSummary = event.message
          }
        } else {
          msg.status = 'error'
          this.finishStreamingBlocks(msg, 'error')
          this.markTurnDuration(msg, event)
        }

        const nextBlock: Extract<UIBlock, { kind: 'error' }> = {
          kind: 'error',
          code: event.code,
          ...(event.title != null ? { title: event.title } : {}),
          message: event.message,
          retryable: event.retryable,
          ...(event.actionHint != null ? { actionHint: event.actionHint } : {}),
          ...(event.details != null ? { details: event.details } : {}),
          ...(event.origin != null ? { origin: event.origin } : {}),
          occurrenceCount: (existing?.block.occurrenceCount ?? 0) + 1,
        }
        if (existing != null) this.replaceRuntimeIssueBlock(existing.block, nextBlock)
        else msg.blocks.push(nextBlock)
        break
      }

      case 'runtime_signal': {
        const aggregationKey = runtimeSignalAggregationKey(event)
        // 重连提示按「信号 + 来源」聚合而不是按原文：每次尝试的 message 携带最新
        // 进度（Reconnecting... 1/5 → 2/5），按原文聚合会在会话里堆叠多条提示行。
        const matchesAggregation = (
          block: Extract<UIBlock, { kind: 'error' | 'runtime_signal' }>,
        ): boolean =>
          event.signal === 'stream_reconnect'
            ? block.kind === 'runtime_signal' &&
              block.signal === 'stream_reconnect' &&
              runtimeEventOriginKey(block.origin) === runtimeEventOriginKey(event.origin)
            : block.kind === 'runtime_signal' &&
              runtimeSignalAggregationKey(block) === aggregationKey
        const existing = this.findRuntimeIssueBlock(event.turnId, matchesAggregation)
        const relatedSubagent =
          event.origin?.kind === 'subagent'
            ? this.findSubagentBlock({
                turnId: event.turnId,
                toolCallId: event.origin.toolCallId,
              })
            : null
        const msg =
          existing?.message ??
          relatedSubagent?.message ??
          this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
        const nextBlock: Extract<UIBlock, { kind: 'runtime_signal' }> = {
          kind: 'runtime_signal',
          signal: event.signal,
          level: event.level,
          title: event.title,
          message: event.message,
          ...(event.code != null ? { code: event.code } : {}),
          retryable: event.retryable === true,
          ...(event.actionHint != null ? { actionHint: event.actionHint } : {}),
          ...(event.details != null ? { details: event.details } : {}),
          ...(event.origin != null ? { origin: event.origin } : {}),
          occurrenceCount: (existing?.block.occurrenceCount ?? 0) + 1,
        }
        if (event.signal === 'background_tasks') {
          const currentSnapshot = msg.blocks.find(
            (block): block is Extract<UIBlock, { kind: 'runtime_signal' }> =>
              block.kind === 'runtime_signal' && block.signal === 'background_tasks',
          )
          if (currentSnapshot != null) this.replaceRuntimeIssueBlock(currentSnapshot, nextBlock)
          else msg.blocks.push(nextBlock)
        } else if (existing != null) {
          this.replaceRuntimeIssueBlock(existing.block, nextBlock)
        } else {
          msg.blocks.push(nextBlock)
        }
        break
      }

      case 'terminal_output': {
        const msg =
          this.findToolEventOwner(event.turnId, event.toolCallId) ??
          this.findAssistantForEvent(event)
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          const block = msg.blocks.find(
            (b) => b.kind === 'terminal' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'terminal' }> | undefined
          if (block) {
            if (event.stream === 'stdout') block.stdout += event.data
            else block.stderr += event.data
            if (event.teamMemberContext != null) block.teamMemberContext = event.teamMemberContext
            if (event.isFinal) {
              block.isStreaming = false
              block.exitCode = event.exitCode ?? undefined
            }
          } else {
            const exitCode: number | undefined = event.isFinal
              ? (event.exitCode ?? undefined)
              : undefined
            msg.blocks.push({
              kind: 'terminal',
              toolCallId: event.toolCallId,
              stdout: event.stream === 'stdout' ? event.data : '',
              stderr: event.stream === 'stderr' ? event.data : '',
              isStreaming: !event.isFinal,
              exitCode,
              ...(event.teamMemberContext != null
                ? { teamMemberContext: event.teamMemberContext }
                : {}),
            })
          }
        }
        break
      }

      case 'file_change': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        msg.blocks.push({
          kind: 'file_change',
          changeType: event.changeType,
          path: event.path,
          diff: event.diff ?? undefined,
          ...(event.teamMemberContext != null
            ? { teamMemberContext: event.teamMemberContext }
            : {}),
        })

        // 追踪文件变更用于生成汇总
        const stats = event.diff ? parseDiffStats(event.diff) : { adds: 0, dels: 0 }
        const existingIdx = this.currentTurnFileChanges.findIndex((f) => f.path === event.path)
        if (existingIdx >= 0) {
          // 同一文件多次修改：累加 stats 并覆盖最新 diff（用于反向/正向 patch）
          const existing = this.currentTurnFileChanges[existingIdx]!
          existing.adds += stats.adds
          existing.dels += stats.dels
          if (event.collectionSource == null || event.collectionSource === 'agent') {
            existing.collectionSource = 'agent'
          }
          if (event.diff != null) existing.diff = event.diff
        } else {
          this.currentTurnFileChanges.push({
            path: event.path,
            changeType: event.changeType,
            adds: stats.adds,
            dels: stats.dels,
            ...(event.collectionSource != null ? { collectionSource: event.collectionSource } : {}),
            ...(event.diff != null ? { diff: event.diff } : {}),
          })
        }
        break
      }

      case 'presented_files': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        const existing = msg.blocks.find(
          (block): block is Extract<UIBlock, { kind: 'presented_files' }> =>
            block.kind === 'presented_files',
        )
        const files = event.files.map((file) => ({
          path: file.path,
          ...(file.title != null ? { title: file.title } : {}),
        }))
        if (existing != null) existing.files = files
        else msg.blocks.push({ kind: 'presented_files', files })
        break
      }

      case 'checkpoint': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        msg.blocks.push({
          kind: 'checkpoint',
          checkpointId: event.checkpointId,
          label: event.label,
          path: event.path,
          filePaths: event.filePaths,
        })
        // 记录该 turn 内最近的 checkpoint id，用于「撤销」
        this.currentTurnCheckpointId = event.checkpointId
        break
      }

      case 'validation_suggestion': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        msg.blocks.push({
          kind: 'validation_suggestion',
          summary: event.summary,
          changedFiles: event.changedFiles,
          commands: event.commands,
        })
        break
      }

      case 'usage_update': {
        const msg = this.currentAssistantId
          ? this.messages.find((m) => m.id === this.currentAssistantId)
          : null
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          msg.usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            reasoningOutputTokens: event.reasoningOutputTokens ?? 0,
            estimatedCostUsd: event.estimatedCostUsd,
          }
        }
        break
      }

      case 'runtime_context_snapshot': {
        // 仅供 Composer / Inspector 的上下文仪表消费，不创建时间线消息或气泡。
        break
      }

      case 'context_usage': {
        this.latestContextUsage = {
          estimatedTokens: event.estimatedTokens,
          softLimitTokens: event.softLimitTokens,
          contextWindowTokens: event.contextWindowTokens,
          compactedThisTurn: event.compacted,
        }
        break
      }

      case 'context_ledger': {
        // Context Ledger 不再在消息流中渲染 — 上下文信息已在底部 ComposerV2 的 ContextMeterWithPopup 中显示。
        // 不创建 assistant 消息，避免 context_ledger 事件先于 user_message 到达时
        // 导致 running 动画出现在用户消息上方。
        break
      }

      case 'context_summarized': {
        const sumMsg = this.getOrCreateAssistant(event.id, event.timestamp, {
          turnId: event.turnId,
        })
        sumMsg.blocks.push({
          kind: 'context_summarized',
          summarizedEntryCount: event.summarizedEntryCount,
          tokensSaved: event.tokensSaved,
          summaryTokens: event.summaryTokens,
        })
        break
      }

      case 'context_compaction': {
        const compactMsg = this.getOrCreateAssistant(event.id, event.timestamp, {
          turnId: event.turnId,
        })
        this.upsertCompactionBlock(compactMsg, event)
        break
      }

      case 'retry_trail': {
        const rtMsg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        rtMsg.blocks.push({
          kind: 'retry_trail',
          target: event.target,
          attempts: event.attempts,
          finalOutcome: event.finalOutcome,
        })
        break
      }

      case 'subagent_started': {
        const existing = this.findSubagentBlock(event)
        if (existing != null) {
          if (!isTerminalSubagentStatus(existing.block.status)) {
            existing.block.name = event.name
            existing.block.role = event.role
            existing.block.task = event.task
            existing.block.status = 'running'
          }
          existing.block.toolCallId = event.toolCallId
          if (event.taskId != null) existing.block.taskId = event.taskId
          if (!existing.message.eventIds.includes(event.id))
            existing.message.eventIds.push(event.id)
        } else {
          const saMsg = this.getOrCreateAssistant(event.id, event.timestamp, {
            turnId: event.turnId,
          })
          saMsg.blocks.push({
            kind: 'subagent',
            toolCallId: event.toolCallId,
            ...(event.taskId != null ? { taskId: event.taskId } : {}),
            name: event.name,
            role: event.role,
            task: event.task,
            status: 'running',
            tokens: '',
          })
        }
        break
      }

      case 'subagent_progress': {
        const { message, block } = this.getOrCreateSubagentBlock(event)
        block.toolCallId = event.toolCallId
        if (event.taskId != null) block.taskId = event.taskId
        if (event.description != null && block.task.trim().length === 0) {
          block.task = event.description
        }
        const wasTerminal = isTerminalSubagentStatus(block.status)
        if (!wasTerminal) {
          if (event.summary != null) block.progressSummary = event.summary
          if (event.lastToolName != null) block.lastToolName = event.lastToolName
          if (event.totalTokens != null) block.tokens = event.totalTokens.toLocaleString()
          if (event.toolUses != null) block.toolUses = event.toolUses
          if (event.durationMs != null) block.durationMs = event.durationMs
          if (event.status != null) {
            block.status =
              event.status === 'completed'
                ? 'done'
                : event.status === 'failed'
                  ? 'error'
                  : event.status === 'pending'
                    ? 'running'
                    : event.status
          }
        }
        if (!message.eventIds.includes(event.id)) message.eventIds.push(event.id)
        break
      }

      case 'subagent_message': {
        const { message, block } = this.getOrCreateSubagentBlock(event)
        const transcript = (block.transcript ??= [])
        const existing = transcript.find(
          (entry) => entry.kind === event.contentKind && entry.segmentId === event.segmentId,
        )
        if (existing == null) {
          transcript.push({
            kind: event.contentKind,
            content: event.content,
            segmentId: event.segmentId,
          })
        } else if (event.mode === 'delta') {
          existing.content += event.content
        } else {
          existing.content = event.content
        }
        trimSubagentTranscript(transcript)
        if (!message.eventIds.includes(event.id)) message.eventIds.push(event.id)
        break
      }

      case 'subagent_completed': {
        const { message, block } = this.getOrCreateSubagentBlock(event)
        block.toolCallId = event.toolCallId
        if (event.taskId != null) block.taskId = event.taskId
        if (block.name === 'Subagent' || block.name.trim().length === 0) block.name = event.name
        const tokenCount = event.totalTokens ?? (event.inputTokens ?? 0) + (event.outputTokens ?? 0)
        const nextStatus =
          event.status === 'success' ? 'done' : event.status === 'stopped' ? 'stopped' : 'error'
        const wasTerminal = isTerminalSubagentStatus(block.status)
        const canEnrich = !wasTerminal || block.status === nextStatus
        if (!wasTerminal) block.status = nextStatus
        if (canEnrich) {
          const currentTokenCount = Number(block.tokens.replace(/[^0-9]/g, '')) || 0
          if (tokenCount > currentTokenCount) block.tokens = tokenCount.toLocaleString()
          if (
            event.output.trim().length > 0 &&
            (block.output == null || event.output.length > block.output.length)
          ) {
            block.output = event.output
          }
          if (block.resultSummary == null || block.resultSummary.trim().length === 0) {
            block.resultSummary = event.resultSummary
          }
          if (event.toolUses != null) block.toolUses = Math.max(block.toolUses ?? 0, event.toolUses)
          if (event.durationMs != null) {
            block.durationMs = Math.max(block.durationMs ?? 0, event.durationMs)
          }
        }
        if (!message.eventIds.includes(event.id)) message.eventIds.push(event.id)
        break
      }

      case 'turn_prompt_snapshot': {
        const runtimeMetrics = mergeTurnRuntimeMetrics(
          event.runtimeMetrics,
          this.turnRuntimeMetrics.get(event.turnId),
        )
        this.turnPromptSnapshots.push(runtimeMetrics != null ? { ...event, runtimeMetrics } : event)
        break
      }

      case 'turn_runtime_metrics': {
        const runtimeMetrics = mergeTurnRuntimeMetrics(
          this.turnRuntimeMetrics.get(event.turnId),
          event.metrics,
        )
        if (runtimeMetrics != null) {
          this.turnRuntimeMetrics.set(event.turnId, runtimeMetrics)
          const snapshotIndex = this.turnPromptSnapshots.findIndex(
            (snapshot) => snapshot.turnId === event.turnId,
          )
          if (snapshotIndex >= 0) {
            const snapshot = this.turnPromptSnapshots[snapshotIndex]
            if (snapshot != null) {
              this.turnPromptSnapshots[snapshotIndex] = { ...snapshot, runtimeMetrics }
            }
          }
        }
        break
      }

      case 'orchestration_status': {
        this.orchestrationStatus = event.active
          ? {
              source: event.source,
              hostAgentId: event.hostAgentId,
              hostAgentName: event.hostAgentName,
              memberCount: event.memberCount,
            }
          : null
        break
      }

      case 'workflow_progress': {
        // workflow_run 每次节点开始/完成/失败都重发一份完整节点列表（见 session.service.ts
        // 的 emitWorkflowProgress），不是增量。Run 可能在中断后跨 turn 续跑，因此优先按
        // runId 跨消息定位；旧事件没有 runId 时，只保守复用最近的同 workflowId working 卡。
        const existing = this.findWorkflowProgressBlock(event)
        if (existing != null) {
          const nextBlock: Extract<UIBlock, { kind: 'workflow_progress' }> = {
            ...existing.block,
            ...(event.runId != null ? { runId: event.runId } : {}),
            runStatus: event.runStatus,
            nodes: event.nodes,
          }
          // MessageBuilder 的消息/blocks 通常原地维护，但跨 turn 命中的卡可能已不在最近消息中；
          // 必须替换 blocks 引用，才能穿过 ChatView 的 React.memo 比较器刷新旧消息行。
          existing.message.blocks = existing.message.blocks.map((block, index) =>
            index === existing.blockIndex ? nextBlock : block,
          )
          if (!existing.message.eventIds.includes(event.id)) {
            existing.message.eventIds = [...existing.message.eventIds, event.id]
          }
        } else {
          const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
          msg.blocks = [
            ...msg.blocks,
            {
              kind: 'workflow_progress',
              workflowId: event.workflowId,
              ...(event.runId != null ? { runId: event.runId } : {}),
              runStatus: event.runStatus,
              nodes: event.nodes,
            },
          ]
        }
        break
      }

      case 'goal_started':
      case 'goal_progress':
      case 'goal_resumed':
      case 'goal_paused': {
        // 契约被确认（confirm → goal_started）后，内联契约卡片转「已确认」终态。
        if (event.type === 'goal_started') {
          this.resolveGoalContractBlocks(event.goalId, 'confirmed')
        }
        const budget = (event.budget ?? {}) as { maxIterations?: unknown }
        const maxIterations =
          typeof budget.maxIterations === 'number' ? budget.maxIterations : undefined
        this.activeGoal = {
          goalId: event.goalId,
          objective: event.objective,
          status: event.status,
          iteration: event.iteration,
          ...(maxIterations != null ? { maxIterations } : {}),
          ...(event.phase != null ? { phase: event.phase } : {}),
          summary: event.summary,
          ...(event.nextStep != null ? { nextStep: event.nextStep } : {}),
        }
        // 迭代分割线：iteration_start 落块（resume 重跑同轮时复用重置）；
        // iteration_result 回填轮末小结。老事件无 progressKind，按 summary 前缀回退识别。
        if (event.type === 'goal_progress') {
          const progressKind =
            event.progressKind ??
            (event.summary.startsWith('Started iteration') ? 'iteration_start' : 'iteration_result')
          if (progressKind === 'iteration_start') {
            this.upsertGoalIterationDivider(event, maxIterations)
          } else {
            this.backfillGoalIterationResult(event)
          }
        }
        break
      }

      case 'goal_contract_drafting':
      case 'goal_contract_proposed': {
        // 契约门控：目标停在 pending_contract。drafting 只刷新浮窗快照；
        // proposed 额外在起草 turn 的消息里落一张内联审批卡片，
        // 确认/拒绝由 GoalContractCard 走 session:goal-control，不再依赖用户知道 /goal confirm。
        this.activeGoal = {
          goalId: event.goalId,
          objective: event.objective,
          status: event.status,
          iteration: event.iteration,
          summary: event.summary,
        }
        if (event.type === 'goal_contract_proposed' && event.proposedContract != null) {
          const msg = this.getOrCreateAssistant(event.id, event.timestamp, {
            turnId: event.turnId,
          })
          msg.blocks.push({
            kind: 'goal_contract',
            goalId: event.goalId,
            objective: event.objective,
            contract: event.proposedContract,
            state: 'pending',
          })
          // 该事件由编排层在起草 turn 收尾后发出（携带独立 turnId），若上面新建了消息，
          // 不会再有 agent_status 终态来收尾——直接置 completed，避免永久停在 streaming。
          if (msg.status === 'streaming' && msg.blocks.every((b) => b.kind === 'goal_contract')) {
            msg.status = 'completed'
          }
        }
        break
      }

      case 'goal_completed':
      case 'goal_failed':
      case 'goal_cleared':
      case 'goal_budget_stopped': {
        // 契约被拒绝（reject → goal_cleared）后，内联契约卡片转「已拒绝」终态。
        if (event.type === 'goal_cleared') {
          this.resolveGoalContractBlocks(event.goalId, 'rejected')
        }
        if (event.type === 'goal_completed' || event.type === 'goal_failed') {
          this.finalizeGoalIterationDividers(
            event.goalId,
            event.type === 'goal_completed' ? 'completed' : 'failed',
            event.id,
          )
        } else if (event.type === 'goal_budget_stopped') {
          // 预算停止发生在新迭代启动前：最后一条 divider 可能仍是 running 态，回填停止原因。
          this.finalizeGoalIterationDividers(
            event.goalId,
            'stopped_by_budget',
            event.id,
            event.summary,
          )
        } else {
          // goal_cleared：目标被显式清除，把悬挂的 running divider 收敛为 result（无小结），
          // 避免 spinner 永久旋转。
          this.finalizeGoalIterationDividers(event.goalId, 'result', event.id)
        }
        this.activeGoal = null
        break
      }

      case 'plan_proposed': {
        // Stash the plan for PlanApprovalModal (global overlay)
        this.latestPlanProposed = event.plan
        // Also emit a UIBlock so it renders inline in the message stream
        const planMsg = this.getOrCreateAssistant(event.id, event.timestamp, {
          turnId: event.turnId,
        })
        planMsg.blocks.push({ kind: 'plan_proposed', plan: event.plan })
        break
      }

      case 'plan_rejected': {
        // 用户已拒绝该计划：清空待审批态，使历史回放（重开/切换会话）后不再弹出审批面板。
        this.latestPlanProposed = null
        break
      }

      case 'permission_request': {
        // Emit a UIBlock for inline rendering (also handled as global modal in App.tsx)
        const permMsg = this.getOrCreateAssistant(event.id, event.timestamp, {
          turnId: event.turnId,
        })
        permMsg.blocks.push({
          kind: 'permission_request',
          requestId: event.requestId,
          action: event.action,
          riskLevel: event.riskLevel,
          description: event.description,
          paths: event.paths,
          command: event.command,
          domains: event.domains,
        })
        break
      }

      // ─── Team Mode (A2A) ───────────────────────────────────────────────
      // 所有事件按 seq 全局有序渲染，不分泳道（设计文档 §5.2.2）。Host 调用与
      // Member 输出都作为 block 追加到当前 Host assistant 消息的时间线中。

      case 'team_dispatch_requested': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        msg.blocks.push({
          kind: 'team_dispatch',
          dispatchId: event.dispatchId,
          hostAgentId: event.hostAgentId,
          memberAgentId: event.memberAgentId,
          task: event.task,
          state: 'working',
        })
        break
      }

      case 'team_member_message': {
        // member 的所有事件归位到「该 dispatch 已有 block 所在的消息」，
        // 避免 currentAssistantId 漂移把同一 dispatch 拆进多条消息（气泡分裂）。
        const home = this.findTeamMemberDispatchHome(event.dispatchId)
        const msg =
          home ?? this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) {
          msg.eventIds.push(event.id)
        }
        const memberBlocks = msg.blocks.filter(
          (b): b is Extract<UIBlock, { kind: 'team_member_message' }> =>
            b.kind === 'team_member_message' && b.dispatchId === event.dispatchId,
        )
        // 记录该 block 消费的源 event id，供「只删这条成员消息」反查 event。
        const recordEventId = (
          block: Extract<UIBlock, { kind: 'team_member_message' }>,
          id: string,
        ) => {
          if (block.eventIds == null) block.eventIds = []
          if (!block.eventIds.includes(id)) block.eventIds.push(id)
        }
        const pushBlock = (content: string, isStreaming: boolean, isFinalAnswer = false) => {
          const block: Extract<UIBlock, { kind: 'team_member_message' }> = {
            kind: 'team_member_message',
            dispatchId: event.dispatchId,
            memberAgentId: event.memberAgentId,
            content,
            isStreaming,
            ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
            eventIds: [event.id],
          }
          if (isFinalAnswer) block.isFinalAnswer = true
          msg.blocks.push(block)
        }

        if (event.mode === 'complete') {
          if (event.isFinal) {
            // 最终回复：通常等于最后一段 complete，按内容去重收尾；不覆盖此前各段叙述。
            const last = memberBlocks[memberBlocks.length - 1]
            for (const block of memberBlocks) delete block.isFinalAnswer
            if (event.content.length > 0) {
              if (last == null) pushBlock(event.content, false, true)
              else if (
                memberBlocks.length > 1 &&
                containsAllContentBlocks(event.content, memberBlocks)
              ) {
                for (const block of memberBlocks) block.isStreaming = false
                last.isFinalAnswer = true
                recordEventId(last, event.id)
              } else if (last.isStreaming) {
                last.content = event.content
                last.isStreaming = false
                last.isFinalAnswer = true
                recordEventId(last, event.id)
              } else if (contentExtendsBlock(event.content, last.content)) {
                last.content = event.content
                last.isFinalAnswer = true
                recordEventId(last, event.id)
              } else if (last.content.trim() !== event.content.trim()) {
                pushBlock(event.content, false, true)
              } else {
                last.isFinalAnswer = true
                recordEventId(last, event.id)
              }
            } else if (last != null) {
              last.isFinalAnswer = true
              recordEventId(last, event.id)
            }
            for (const b of memberBlocks) b.isStreaming = false
            break
          }
          if (event.segmentId != null) {
            const block = memberBlocks.find((b) => b.segmentId === event.segmentId)
            if (block) {
              if (block.isStreaming) {
                block.content = event.content
                block.isStreaming = false
              } else if (event.content.length > 0) {
                block.content += event.content
              }
              recordEventId(block, event.id)
            } else if (event.content.length > 0) {
              pushBlock(event.content, false)
            }
            break
          }
          // legacy（无 segmentId 的历史事件）：替换最近仍在流式的段
          const lastStreaming = [...memberBlocks].reverse().find((b) => b.isStreaming)
          if (lastStreaming) {
            lastStreaming.content = event.content
            lastStreaming.isStreaming = false
            recordEventId(lastStreaming, event.id)
          } else if (event.content.length > 0) {
            pushBlock(event.content, false)
          }
          break
        }

        // delta
        if (event.segmentId != null) {
          const block = memberBlocks.find((b) => b.segmentId === event.segmentId)
          if (block) {
            block.content += event.content
            recordEventId(block, event.id)
          } else if (event.content.length > 0) pushBlock(event.content, true)
          break
        }
        const lastStreaming = [...memberBlocks].reverse().find((b) => b.isStreaming)
        if (lastStreaming) {
          lastStreaming.content += event.content
          recordEventId(lastStreaming, event.id)
        } else if (event.content.length > 0) pushBlock(event.content, true)
        break
      }

      case 'team_member_status': {
        // 更新对应 dispatch 卡片状态（working/failed 等）
        for (const msg of this.messages) {
          const block = msg.blocks.find(
            (b) => b.kind === 'team_dispatch' && b.dispatchId === event.dispatchId,
          ) as Extract<UIBlock, { kind: 'team_dispatch' }> | undefined
          if (block) {
            if (event.status === 'failed') block.state = 'failed'
            else if (event.status === 'completed') block.state = 'completed'
            else if (event.status === 'working' || event.status === 'pending')
              block.state = 'working'
            if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
            break
          }
        }
        break
      }

      case 'team_peer_message': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) {
          msg.eventIds.push(event.id)
        }
        msg.blocks.push({
          kind: 'team_peer_message',
          discussionId: event.discussionId,
          memberAgentId: event.memberAgentId,
          ...(event.targetAgentId != null ? { targetAgentId: event.targetAgentId } : {}),
          ...(event.delivery != null ? { delivery: event.delivery } : {}),
          content: event.content,
          ...(event.autoForwarded === true ? { autoForwarded: true } : {}),
        })
        break
      }

      case 'team_round_advanced': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) {
          msg.eventIds.push(event.id)
        }
        msg.blocks.push({
          kind: 'team_round_divider',
          discussionId: event.discussionId,
          round: event.round,
          maxRounds: event.maxRounds,
        })
        break
      }

      case 'team_discussion_concluded': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) {
          msg.eventIds.push(event.id)
        }
        msg.blocks.push({
          kind: 'team_discussion_status',
          discussionId: event.discussionId,
          reason: event.reason,
        })
        break
      }

      case 'team_dispatch_completed': {
        for (const msg of this.messages) {
          const block = msg.blocks.find(
            (b) => b.kind === 'team_dispatch' && b.dispatchId === event.dispatchId,
          ) as Extract<UIBlock, { kind: 'team_dispatch' }> | undefined
          if (block) {
            block.state = event.reply.state
            block.reply = event.reply
            if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          }
          // 收尾该 dispatch 仍在流式的 member 气泡
          for (const b of msg.blocks) {
            if (b.kind === 'team_member_message' && b.dispatchId === event.dispatchId) {
              b.isStreaming = false
            }
          }
        }
        break
      }
    }
  }

  /** 契约被确认（goal_started）或拒绝（goal_cleared）后，把同 goal 的内联契约卡片转成终态。 */
  private resolveGoalContractBlocks(goalId: string, state: 'confirmed' | 'rejected'): void {
    for (const msg of this.messages) {
      for (const block of msg.blocks) {
        if (block.kind === 'goal_contract' && block.goalId === goalId) {
          if (block.state !== 'pending') continue
          block.state = state
        }
      }
    }
  }

  /** 迭代启动型 goal_progress → 落轮次分割线（同 goal 同轮已存在时复用并重置 running 态）。 */
  private upsertGoalIterationDivider(event: GoalEvent, maxIterations: number | undefined): void {
    for (const msg of this.messages) {
      for (const block of msg.blocks) {
        if (
          block.kind === 'goal_iteration_divider' &&
          block.goalId === event.goalId &&
          block.iteration === event.iteration
        ) {
          // resume 重跑同轮：复用既有分割线，清掉上一轮残留小结。
          block.state = 'running'
          if (event.phase != null) block.phase = event.phase
          else delete block.phase
          delete block.resultSummary
          delete block.resultNextStep
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          return
        }
      }
    }
    const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
    if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
    msg.blocks.push({
      kind: 'goal_iteration_divider',
      goalId: event.goalId,
      iteration: event.iteration,
      ...(maxIterations != null ? { maxIterations } : {}),
      ...(event.phase != null ? { phase: event.phase } : {}),
      state: 'running',
    })
    // 该事件由编排层在迭代 turn 之前发出（携带独立 turnId），新建消息不会再有
    // agent_status 终态来收尾——直接置 completed，避免永久停在 streaming。
    if (
      msg.status === 'streaming' &&
      msg.blocks.every((b) => b.kind === 'goal_iteration_divider')
    ) {
      msg.status = 'completed'
    }
  }

  /** 轮末型 goal_progress → 按 goalId + iteration 回填 agent 自报小结到既有分割线。 */
  private backfillGoalIterationResult(event: GoalEvent): void {
    for (const msg of this.messages) {
      for (const block of msg.blocks) {
        if (
          block.kind === 'goal_iteration_divider' &&
          block.goalId === event.goalId &&
          block.iteration === event.iteration
        ) {
          block.state = 'result'
          if (event.phase != null) block.phase = event.phase
          if (event.summary.length > 0) block.resultSummary = event.summary
          if (event.nextStep != null) block.resultNextStep = event.nextStep
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          return
        }
      }
    }
  }

  /** 目标终态 → 把该 goal 最后一条分割线置终态；budget 停止时回填停止原因。 */
  private finalizeGoalIterationDividers(
    goalId: string,
    state: 'result' | 'completed' | 'failed' | 'stopped_by_budget',
    eventId: string,
    summary?: string,
  ): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i]!
      for (let j = msg.blocks.length - 1; j >= 0; j--) {
        const block = msg.blocks[j]!
        if (block.kind !== 'goal_iteration_divider' || block.goalId !== goalId) continue
        if (state === 'stopped_by_budget' && block.resultSummary == null && summary != null) {
          block.resultSummary = summary
        }
        block.state = state
        if (!msg.eventIds.includes(eventId)) msg.eventIds.push(eventId)
        return
      }
    }
  }

  getAllMessages(): UIMessage[] {
    return [...this.messages]
  }

  /**
   * Renderer 明确收到 session stop 后的兜底收尾。
   * 正常路径仍由 agent_status 终态驱动；这里只处理终态事件丢失/晚到时仍停在
   * streaming 的消息，避免“会话已结束但气泡仍显示执行任务中”。
   */
  finalizeRunningMessages(finalStatus: 'completed' | 'error' | 'cancelled' = 'completed'): boolean {
    let changed = false
    for (const message of this.messages) {
      if (message.status !== 'streaming') continue
      changed = true
      message.status = finalStatus
      this.finishStreamingBlocks(message, finalStatus === 'completed' ? 'completed' : 'error')
      if (finalStatus === 'cancelled') {
        if (!message.blocks.some((block) => block.kind === 'cancelled')) {
          message.blocks.push({ kind: 'cancelled', message: '已取消本次任务' })
        }
      }
      this.appendTurnSummary(message)
    }
    return changed
  }

  private findSubagentBlock(identity: { turnId: string; toolCallId: string; taskId?: string }): {
    message: UIMessage
    block: Extract<UIBlock, { kind: 'subagent' }>
  } | null {
    for (const message of this.messages) {
      if (message.turnId !== identity.turnId) continue
      const block = message.blocks.find(
        (candidate): candidate is Extract<UIBlock, { kind: 'subagent' }> =>
          candidate.kind === 'subagent' &&
          identity.taskId != null &&
          candidate.taskId === identity.taskId,
      )
      if (block != null) return { message, block }
    }
    for (const message of this.messages) {
      if (message.turnId !== identity.turnId) continue
      const block = message.blocks.find(
        (candidate): candidate is Extract<UIBlock, { kind: 'subagent' }> =>
          candidate.kind === 'subagent' &&
          candidate.toolCallId === identity.toolCallId &&
          (identity.taskId == null ||
            candidate.taskId == null ||
            candidate.taskId === identity.taskId),
      )
      if (block != null) return { message, block }
    }
    return null
  }

  private findRuntimeIssueBlock(
    turnId: string,
    predicate: (block: Extract<UIBlock, { kind: 'error' | 'runtime_signal' }>) => boolean,
  ): {
    message: UIMessage
    block: Extract<UIBlock, { kind: 'error' | 'runtime_signal' }>
  } | null {
    for (const message of this.messages) {
      if (message.turnId !== turnId) continue
      const block = message.blocks.find(
        (candidate): candidate is Extract<UIBlock, { kind: 'error' | 'runtime_signal' }> =>
          (candidate.kind === 'error' || candidate.kind === 'runtime_signal') &&
          predicate(candidate),
      )
      if (block != null) return { message, block }
    }
    return null
  }

  private replaceRuntimeIssueBlock(
    current: Extract<UIBlock, { kind: 'error' | 'runtime_signal' }>,
    next: Extract<UIBlock, { kind: 'error' | 'runtime_signal' }>,
  ): void {
    delete current.title
    delete current.actionHint
    delete current.details
    delete current.origin
    Object.assign(current, next)
  }

  private getOrCreateSubagentBlock(event: {
    id: string
    timestamp: string
    turnId: string
    toolCallId: string
    taskId?: string
  }): {
    message: UIMessage
    block: Extract<UIBlock, { kind: 'subagent' }>
  } {
    const existing = this.findSubagentBlock(event)
    if (existing != null) return existing
    const message = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
    const block: Extract<UIBlock, { kind: 'subagent' }> = {
      kind: 'subagent',
      toolCallId: event.toolCallId,
      ...(event.taskId != null ? { taskId: event.taskId } : {}),
      name: 'Subagent',
      role: '',
      task: '',
      status: 'running',
      tokens: '',
    }
    message.blocks.push(block)
    return { message, block }
  }

  removeMessage(messageId: string): void {
    this.messages = this.messages.filter((m) => m.id !== messageId)
    if (this.currentAssistantId === messageId) {
      this.currentAssistantId = null
    }
  }

  /** 删除 message 内由指定 event 产生的 team_member_message block（保留 message 本身）。
   *  用于团队模式「只删这条成员消息气泡」：host 回复与其他成员不受影响。 */
  removeEventsFromMessage(messageId: string, eventIds: string[]): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (msg == null) return
    const remove = new Set(eventIds)
    msg.eventIds = msg.eventIds.filter((id) => !remove.has(id))
    msg.blocks = msg.blocks.filter((b) => {
      if (b.kind !== 'team_member_message') return true
      const ids = b.eventIds
      return !(ids != null && ids.some((id) => remove.has(id)))
    })
  }

  clearAll(): void {
    this.messages = []
    this.processedEventIds.clear()
    this.currentAssistantId = null
    this.turnPromptSnapshots = []
    this.turnRuntimeMetrics.clear()
    this.activeGoal = null
    this.orchestrationStatus = null
    this.currentTurnFileChanges = []
    this.currentTurnCheckpointId = undefined
    this.turnSummaryEmitted = false
  }

  private getOrCreateAssistant(
    eventId: string,
    timestamp?: string | undefined,
    event?: { agentId?: string; agentName?: string; turnId?: string },
  ): UIMessage {
    const existing = this.findAssistantForEvent(event)
    if (existing) {
      if (!existing.eventIds.includes(eventId)) {
        existing.eventIds.push(eventId)
      }
      if (existing.turnId == null && event?.turnId != null) existing.turnId = event.turnId
      if (event != null) this.applyAgentSnapshot(existing, event)
      this.currentAssistantId = existing.id
      return existing
    }
    const msg: UIMessage = {
      id: eventId,
      role: 'assistant',
      status: 'streaming',
      blocks: [],
      usage: null,
      timestamp,
      eventIds: [eventId],
      ...(event?.turnId != null ? { turnId: event.turnId } : {}),
      ...(event?.agentId != null ? { agentId: event.agentId } : {}),
      ...(event?.agentName != null ? { agentName: event.agentName } : {}),
    }
    this.messages.push(msg)
    this.currentAssistantId = msg.id
    // 新消息开始时重置 turn 追踪状态
    this.currentTurnFileChanges = []
    this.currentTurnCheckpointId = undefined
    this.turnSummaryEmitted = false
    return msg
  }

  /**
   * 追加或合并压缩卡片。同一次压缩的连续阶段事件（started → completed →
   * boundary → 摘要）会合并进同一张卡，避免一次压缩在时间线上出现三、四张
   * 重复卡片。合并判据：目标消息的最后一个 block 仍是压缩卡（中间没有其他
   * 内容插入），且新事件不是新一轮压缩的 started、preTokens 不冲突。
   */
  private upsertCompactionBlock(msg: UIMessage, compaction: CompactionCardFields): void {
    const lastBlock = msg.blocks[msg.blocks.length - 1]
    if (
      lastBlock != null &&
      lastBlock.kind === 'context_compaction' &&
      compaction.phase !== 'started' &&
      (compaction.preTokens == null ||
        lastBlock.preTokens == null ||
        lastBlock.preTokens === compaction.preTokens)
    ) {
      lastBlock.phase = compaction.phase
      if (compaction.trigger != null && lastBlock.trigger == null)
        lastBlock.trigger = compaction.trigger
      if (compaction.preTokens != null && lastBlock.preTokens == null)
        lastBlock.preTokens = compaction.preTokens
      if (compaction.postTokens != null && lastBlock.postTokens == null)
        lastBlock.postTokens = compaction.postTokens
      if (compaction.durationMs != null && lastBlock.durationMs == null)
        lastBlock.durationMs = compaction.durationMs
      // 摘要取最新；message/rawType 同名补齐
      if (compaction.summary != null) lastBlock.summary = compaction.summary
      if (compaction.message != null && lastBlock.message == null)
        lastBlock.message = compaction.message
      if (compaction.rawType != null) lastBlock.rawType = compaction.rawType
      return
    }
    msg.blocks.push({
      kind: 'context_compaction',
      provider: compaction.provider,
      source: compaction.source,
      phase: compaction.phase,
      ...(compaction.trigger != null ? { trigger: compaction.trigger } : {}),
      ...(compaction.preTokens != null ? { preTokens: compaction.preTokens } : {}),
      ...(compaction.postTokens != null ? { postTokens: compaction.postTokens } : {}),
      ...(compaction.durationMs != null ? { durationMs: compaction.durationMs } : {}),
      ...(compaction.summary != null ? { summary: compaction.summary } : {}),
      ...(compaction.message != null ? { message: compaction.message } : {}),
      ...(compaction.rawType != null ? { rawType: compaction.rawType } : {}),
    })
  }

  private findAssistantForEvent(event?: { turnId?: string }): UIMessage | undefined {
    if (this.currentAssistantId) {
      const current = this.messages.find((m) => m.id === this.currentAssistantId)
      if (
        current != null &&
        (event?.turnId == null || current.turnId == null || current.turnId === event.turnId)
      ) {
        return current
      }
    }
    if (event?.turnId == null) return undefined
    return this.messages.find((m) => m.role === 'assistant' && m.turnId === event.turnId)
  }

  private findWorkflowProgressBlock(event: {
    turnId: string
    workflowId: string
    runId?: string
    nodes: WorkflowProgressNode[]
  }): {
    message: UIMessage
    block: Extract<UIBlock, { kind: 'workflow_progress' }>
    blockIndex: number
  } | null {
    const findLatest = (
      predicate: (
        block: Extract<UIBlock, { kind: 'workflow_progress' }>,
        message: UIMessage,
      ) => boolean,
    ) => {
      for (let messageIndex = this.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = this.messages[messageIndex]
        if (message == null || message.role !== 'assistant') continue
        for (let blockIndex = message.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
          const block = message.blocks[blockIndex]
          if (block?.kind === 'workflow_progress' && predicate(block, message)) {
            return { message, block, blockIndex }
          }
        }
      }
      return null
    }

    if (event.runId != null) {
      const exact = findLatest((block) => block.runId === event.runId)
      if (exact != null) return exact
    }

    // 同一 turn 内仍按 workflowId 更新，兼容旧事件及尚未携带 runId 的发送端。
    const sameTurn = findLatest(
      (block, message) =>
        message.turnId === event.turnId &&
        block.workflowId === event.workflowId &&
        (event.runId == null || block.runId == null || block.runId === event.runId),
    )
    if (sameTurn != null) return sameTurn

    // 历史兼容仅触碰没有 runId 的 working 卡，并要求新快照保留全部已完成/跳过节点。
    // 新 Run 通常从空快照开始，不会误覆盖已有进度；零进度旧卡则宁可保留两张也不猜测。
    return findLatest(
      (block) =>
        block.runId == null &&
        block.workflowId === event.workflowId &&
        block.runStatus === 'working' &&
        canContinueLegacyWorkflowProgress(block.nodes, event.nodes),
    )
  }

  private applyAgentSnapshot(
    msg: UIMessage,
    event: { agentId?: string; agentName?: string },
  ): void {
    if (msg.agentId == null && event.agentId != null) msg.agentId = event.agentId
    if (msg.agentName == null && event.agentName != null) msg.agentName = event.agentName
  }

  /**
   * Populate answer summaries on a user_question block *before* the
   * tool_result event arrives, so the UI can show the user's answers
   * immediately even if the CLI tool_result output format can't be parsed.
   */
  setQuestionAnswerSummary(
    questions: UserQuestionPrompt[],
    summaries: UserQuestionAnswerSummary[],
  ): boolean {
    for (const msg of this.messages) {
      for (const block of msg.blocks) {
        if (block.kind !== 'user_question') continue
        const qb = block as Extract<UIBlock, { kind: 'user_question' }>
        if (qb.answered) continue
        const bQuestions = qb.questions
        if (
          bQuestions.length === questions.length &&
          bQuestions.every((q, i) => q.question === questions[i]?.question)
        ) {
          qb.answerSummary = summaries
          qb.answered = true
          return true
        }
      }
    }
    return false
  }

  /**
   * 找到某个 dispatch 的「宿主消息」：包含该 dispatch 任意 block（member 文本
   * 或带 teamMemberContext 的工具/终端/文件块）的第一条消息。后续同 dispatch
   * 的事件都归位到这里，保证一个 dispatch 只渲染为一个气泡。
   */
  private findTeamMemberDispatchHome(dispatchId: string): UIMessage | undefined {
    for (const msg of this.messages) {
      const hit = msg.blocks.some((b) => {
        if (b.kind === 'team_member_message' || b.kind === 'team_dispatch') {
          return b.dispatchId === dispatchId
        }
        if (b.kind === 'tool_call' || b.kind === 'terminal' || b.kind === 'file_change') {
          return b.teamMemberContext?.dispatchId === dispatchId
        }
        return false
      })
      if (hit) return msg
    }
    return undefined
  }

  /**
   * Tool call IDs are only unique within a provider turn. Codex reuses IDs such as
   * `item_6` across turns, so matching without the turn would update stale history.
   */
  private findToolEventOwner(turnId: string, toolCallId: string): UIMessage | undefined {
    return this.messages.find(
      (message) =>
        message.turnId === turnId &&
        message.blocks.some(
          (block) =>
            (block.kind === 'tool_call' ||
              block.kind === 'user_question' ||
              block.kind === 'terminal') &&
            block.toolCallId === toolCallId,
        ),
    )
  }

  /** delta：追加到同 segment 的流式块；无 segmentId（历史事件）退回最近流式块 */
  private applySegmentDelta(
    blocks: UIBlock[],
    kind: 'text' | 'thinking',
    content: string,
    segmentId: string | undefined,
  ): void {
    if (content.length === 0) return
    type StreamBlock = Extract<UIBlock, { kind: 'text' } | { kind: 'thinking' }>
    if (segmentId != null) {
      const block = blocks.find((b) => b.kind === kind && b.segmentId === segmentId) as
        | StreamBlock
        | undefined
      if (block) {
        block.content += content
      } else {
        blocks.push({ kind, content, isStreaming: true, segmentId })
      }
      return
    }
    const lastStreaming = [...blocks]
      .reverse()
      .find((b) => b.kind === kind && (b as StreamBlock).isStreaming) as StreamBlock | undefined
    if (lastStreaming) {
      lastStreaming.content += content
    } else {
      blocks.push({ kind, content, isStreaming: true })
    }
  }

  /** complete：只替换同 segment 的流式块，不再清空全部同类块（避免多段正文互相覆盖） */
  private applySegmentComplete(
    blocks: UIBlock[],
    kind: 'text' | 'thinking',
    content: string,
    segmentId: string | undefined,
  ): void {
    type StreamBlock = Extract<UIBlock, { kind: 'text' } | { kind: 'thinking' }>
    if (segmentId != null) {
      const block = blocks.find((b) => b.kind === kind && b.segmentId === segmentId) as
        | StreamBlock
        | undefined
      if (block) {
        block.content = block.isStreaming
          ? content
          : mergeCompletedBlockContent(block.content, content)
        block.isStreaming = false
      } else if (content.length > 0) {
        blocks.push({ kind, content, isStreaming: false, segmentId })
      }
      return
    }
    // legacy：替换最近仍在流式的同类块
    const lastStreaming = [...blocks]
      .reverse()
      .find((b) => b.kind === kind && (b as StreamBlock).isStreaming) as StreamBlock | undefined
    if (lastStreaming) {
      lastStreaming.content = content
      lastStreaming.isStreaming = false
    } else if (content.length > 0) {
      blocks.push({ kind, content, isStreaming: false })
    }
  }

  /** 最终 result 文本：与最后一段正文按内容去重，并按 Provider 语义标记最终答复 */
  private reconcileFinalText(msg: UIMessage, content: string, provider: string): void {
    this.applyFinalTextReconcile(msg, content, provider)
    if (provider === 'claude') this.extendClaudeFinalAnswerRun(msg)
  }

  /**
   * Claude 权威 final（result 事件）只携带最后一条 assistant message 的文本。
   * 当正文主体位于 UI 附着工具（如 suggest_replies）调用之前——该类工具在时间线
   * 上不产生可见块，正文视觉连续——把 isFinalAnswer 向前扩展到仅被附着块分隔的
   * 连续正文段，折叠态才能保留完整的最终答复而不是只剩最后一句。
   */
  private extendClaudeFinalAnswerRun(msg: UIMessage): void {
    const blocks = msg.blocks
    let anchorIndex = -1
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block?.kind === 'text' && block.isFinalAnswer === true) {
        anchorIndex = index
        break
      }
    }
    if (anchorIndex < 0) return
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block?.kind === 'quick_replies') continue
      if (block?.kind === 'text' && block.content.trim().length > 0) {
        block.isFinalAnswer = true
        continue
      }
      break
    }
  }

  private applyFinalTextReconcile(msg: UIMessage, content: string, provider: string): void {
    type TextBlock = Extract<UIBlock, { kind: 'text' }>
    const textBlocks = msg.blocks.filter((b): b is TextBlock => b.kind === 'text')
    for (const block of textBlocks) delete block.isFinalAnswer
    const lastText = textBlocks.at(-1)
    if (content.length === 0) {
      if (lastText != null) lastText.isFinalAnswer = true
      return
    }
    if (textBlocks.length > 1 && containsAllTextBlocks(content, textBlocks)) {
      for (const block of textBlocks) block.isStreaming = false
      if (provider === 'claude') {
        for (const block of textBlocks) block.isFinalAnswer = true
      } else if (lastText != null) {
        lastText.isFinalAnswer = true
      }
      return
    }
    if (lastText == null) {
      msg.blocks.push({ kind: 'text', content, isStreaming: false, isFinalAnswer: true })
    } else if (lastText.isStreaming) {
      lastText.content = content
      lastText.isStreaming = false
      lastText.isFinalAnswer = true
    } else if (contentExtendsBlock(content, lastText.content)) {
      lastText.content = content
      lastText.isFinalAnswer = true
    } else if (lastText.content.trim() !== content.trim()) {
      msg.blocks.push({ kind: 'text', content, isStreaming: false, isFinalAnswer: true })
    } else {
      lastText.isFinalAnswer = true
    }
  }

  /** 在消息末尾追加文件变更汇总块 */
  private appendTurnSummary(msg: UIMessage): void {
    if (this.turnSummaryEmitted || this.currentTurnFileChanges.length === 0) return
    this.turnSummaryEmitted = true

    const prepared = prepareTurnFileSummary(this.currentTurnFileChanges)
    const totalAdds = prepared.files.reduce((s, f) => s + f.adds, 0)
    const totalDels = prepared.files.reduce((s, f) => s + f.dels, 0)

    msg.blocks.push({
      kind: 'turn_file_summary',
      files: [...prepared.files],
      totalAdds,
      totalDels,
      ...(prepared.generatedGroups.length > 0 ? { generatedGroups: prepared.generatedGroups } : {}),
      latestCheckpointId: this.currentTurnCheckpointId,
    })
  }

  private finishStreamingBlocks(msg: UIMessage, finalStatus?: 'completed' | 'error'): void {
    for (const block of msg.blocks) {
      if (block.kind === 'text' || block.kind === 'thinking' || block.kind === 'terminal') {
        block.isStreaming = false
      }
      if (
        block.kind === 'tool_call' &&
        (block.status === 'pending' || block.status === 'running')
      ) {
        block.status = finalStatus === 'error' ? 'error' : 'success'
      }
    }
  }

  /**
   * 在消息进入终态时记录整轮耗时：终态事件 timestamp − 消息创建 timestamp。
   * 首次写入后不再覆盖（同一消息可能先后收到 error 与后续状态事件）；
   * 时间戳缺失或倒挂（终态早于创建）时保持 undefined，由 UI 回退到默认文案。
   */
  private markTurnDuration(msg: UIMessage, event: AgentEvent): void {
    if (msg.durationMs != null) return
    if (msg.timestamp == null) return
    const start = Date.parse(msg.timestamp)
    const end = Date.parse(event.timestamp)
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return
    msg.durationMs = end - start
  }
}

function containsAllTextBlocks(
  content: string,
  blocks: Array<Extract<UIBlock, { kind: 'text' }>>,
): boolean {
  return containsAllContentBlocks(content, blocks)
}

function containsAllContentBlocks(
  content: string,
  blocks: ReadonlyArray<{ content: string }>,
): boolean {
  const normalizedContent = normalizeTextForCompare(content)
  if (normalizedContent.length === 0) return false
  let cursor = 0
  for (const block of blocks) {
    const part = normalizeTextForCompare(block.content)
    if (part.length === 0) continue
    const index = normalizedContent.indexOf(part, cursor)
    if (index < 0) return false
    cursor = index + part.length
  }
  return true
}

function normalizeTextForCompare(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function contentExtendsBlock(content: string, current: string): boolean {
  const normalizedContent = normalizeTextForCompare(content)
  const normalizedCurrent = normalizeTextForCompare(current)
  return normalizedCurrent.length > 0 && normalizedContent.startsWith(normalizedCurrent)
}

function mergeCompletedBlockContent(current: string, incoming: string): string {
  if (incoming.length === 0) return current
  if (current.length === 0) return incoming
  if (current === incoming) return current

  const normalizedCurrent = normalizeTextForCompare(current)
  const normalizedIncoming = normalizeTextForCompare(incoming)
  if (normalizedCurrent === normalizedIncoming) return current
  if (normalizedIncoming.includes(normalizedCurrent)) return incoming
  if (normalizedCurrent.includes(normalizedIncoming)) return current
  return `${current}${incoming}`
}

function formatToolOutput(output: unknown): string | undefined {
  if (output == null) return undefined
  if (typeof output === 'string') return output
  if (typeof output === 'number' || typeof output === 'boolean' || typeof output === 'bigint') {
    return String(output)
  }

  try {
    return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``
  } catch {
    return String(output)
  }
}

function extractApplicationSnapshotPreview(
  output: unknown,
): Omit<Extract<UIBlock, { kind: 'application_snapshot' }>, 'kind'> | null {
  const candidates: unknown[] = [output]
  for (let index = 0; index < candidates.length && index < 12; index += 1) {
    let candidate = candidates[index]
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate) as unknown
      } catch {
        continue
      }
    }
    if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const record = candidate as Record<string, unknown>
    const snapshot = record.snapshot
    if (snapshot != null && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const parsed = parseApplicationSnapshotRecord(snapshot as Record<string, unknown>)
      if (parsed != null) return parsed
    }
    for (const key of ['structuredContent', 'result', 'data']) {
      if (record[key] != null) candidates.push(record[key])
    }
    if (Array.isArray(record.content)) {
      for (const item of record.content.slice(0, 4)) {
        if (item != null && typeof item === 'object' && !Array.isArray(item)) {
          const text = (item as Record<string, unknown>).text
          if (typeof text === 'string') candidates.push(text)
        }
      }
    }
  }
  return null
}

function parseApplicationSnapshotRecord(
  snapshot: Record<string, unknown>,
): Omit<Extract<UIBlock, { kind: 'application_snapshot' }>, 'kind'> | null {
  const app = snapshot.app
  const window = snapshot.window
  if (
    app == null ||
    typeof app !== 'object' ||
    Array.isArray(app) ||
    window == null ||
    typeof window !== 'object' ||
    Array.isArray(window)
  ) {
    return null
  }
  const snapshotId = snapshot.id
  const previewUrl = snapshot.previewUrl
  const appName = (app as Record<string, unknown>).name
  const windowTitle = (window as Record<string, unknown>).title
  const capturedAt = snapshot.capturedAt
  if (
    typeof snapshotId !== 'string' ||
    snapshotId.length < 1 ||
    snapshotId.length > 200 ||
    typeof previewUrl !== 'string' ||
    !/^spark-snapshot:\/\/snapshot\/[^/?#]+\/preview\?cap=[A-Za-z0-9_-]{43,128}$/u.test(
      previewUrl,
    ) ||
    typeof appName !== 'string' ||
    appName.length > 500 ||
    typeof windowTitle !== 'string' ||
    windowTitle.length > 2_000 ||
    typeof capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(capturedAt))
  ) {
    return null
  }
  return { snapshotId, previewUrl, appName, windowTitle, capturedAt }
}

/** 从 unified diff 中解析新增/删除行数 */
function parseDiffStats(diff: string): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const line of diff.split('\n')) {
    // 跳过 diff 头部行
    if (
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@') ||
      line.startsWith('\\')
    ) {
      continue
    }
    if (line.startsWith('+')) {
      adds++
    } else if (line.startsWith('-')) {
      dels++
    }
  }
  return { adds, dels }
}

/** Extract question data from AskUserQuestion tool input */
function extractQuestions(toolInput: Record<string, unknown>): UserQuestionPrompt[] {
  // Support both single-question and multi-question formats
  const raw = toolInput.questions ?? toolInput
  if (Array.isArray(raw)) {
    return raw
      .map((q: unknown) => {
        if (typeof q !== 'object' || q == null) return null
        return normalizeQuestionPrompt(q as Record<string, unknown>)
      })
      .filter((q): q is NonNullable<UserQuestionPrompt> => q != null)
  }

  const normalized = normalizeQuestionPrompt(toolInput)
  return normalized == null ? [] : [normalized]
}

function extractQuestionAnswerSummary(
  output: unknown,
  questions: UserQuestionPrompt[],
): UserQuestionAnswerSummary[] {
  const parsed = parseQuestionOutput(output)
  const rawAnswers = parsed?.answers

  if (typeof rawAnswers === 'object' && rawAnswers != null && !Array.isArray(rawAnswers)) {
    const answerMap = rawAnswers as Record<string, unknown>
    return questions
      .map((question, index) => {
        const rawAnswer =
          answerMap[question.question] ??
          (question.id != null ? answerMap[question.id] : undefined) ??
          answerMap[String(index)]
        const answerText = stringifyQuestionAnswer(rawAnswer)
        if (!answerText) return null

        return {
          question: question.question,
          answer: answerText,
          ...(answerText === '用户拒绝回答' ? { skipped: true } : {}),
        }
      })
      .filter((item): item is UserQuestionAnswerSummary => item != null)
  }

  const answerList = Array.isArray(rawAnswers) ? rawAnswers : []
  if (answerList.length === 0) return []

  return answerList
    .map((rawAnswer, index) => {
      if (typeof rawAnswer !== 'object' || rawAnswer == null) return null
      const answer = rawAnswer as Record<string, unknown>
      const questionText =
        typeof answer.question === 'string'
          ? answer.question
          : (questions[index]?.question ?? `问题 ${index + 1}`)
      const answerText =
        typeof answer.answer === 'string'
          ? answer.answer
          : typeof answer.text === 'string'
            ? answer.text
            : typeof answer.optionLabel === 'string'
              ? answer.optionLabel
              : ''

      return {
        question: questionText,
        answer: answerText,
        ...(answer.skipped === true ? { skipped: true } : {}),
      }
    })
    .filter((item): item is UserQuestionAnswerSummary => item != null)
}

function stringifyQuestionAnswer(rawAnswer: unknown): string {
  if (typeof rawAnswer === 'string') return rawAnswer
  if (typeof rawAnswer === 'number' || typeof rawAnswer === 'boolean') return String(rawAnswer)
  return ''
}

function parseQuestionOutput(output: unknown): { answers?: unknown } | null {
  if (typeof output === 'object' && output != null) {
    return output as { answers?: unknown }
  }
  if (typeof output !== 'string' || output.trim().length === 0) return null

  try {
    const parsed = JSON.parse(output) as unknown
    return typeof parsed === 'object' && parsed != null ? (parsed as { answers?: unknown }) : null
  } catch {
    return null
  }
}

function normalizeOptions(options: unknown): UserQuestionOption[] {
  if (!Array.isArray(options)) return []
  return options
    .map((opt: unknown) => {
      if (typeof opt !== 'object' || opt == null) return null
      const obj = opt as Record<string, unknown>
      const label = typeof obj.label === 'string' ? obj.label : ''
      if (!label) return null
      return {
        label,
        ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
        ...(typeof obj.preview === 'string' ? { preview: obj.preview } : {}),
        ...(typeof obj.value === 'string' ? { value: obj.value } : {}),
        ...(obj.allowsFreeText === true ? { allowsFreeText: true } : {}),
        ...(typeof obj.freeTextPlaceholder === 'string'
          ? { freeTextPlaceholder: obj.freeTextPlaceholder }
          : {}),
      }
    })
    .filter((opt): opt is NonNullable<typeof opt> => opt != null)
}

function normalizeQuestionPrompt(
  questionInput: Record<string, unknown>,
): UserQuestionPrompt | null {
  const question = typeof questionInput.question === 'string' ? questionInput.question : ''
  if (!question) return null

  const rawType = questionInput.type
  const normalizedType =
    rawType === 'text' || rawType === 'single_choice'
      ? rawType
      : Array.isArray(questionInput.options)
        ? 'single_choice'
        : 'text'

  const options = normalizeOptions(questionInput.options)
  if (normalizedType === 'single_choice' && options.length === 0) return null

  return {
    ...(typeof questionInput.id === 'string' ? { id: questionInput.id } : {}),
    question,
    header: typeof questionInput.header === 'string' ? questionInput.header : '',
    type: normalizedType,
    ...(questionInput.required === false ? { required: false } : { required: true }),
    ...(typeof questionInput.placeholder === 'string'
      ? { placeholder: questionInput.placeholder }
      : {}),
    ...(questionInput.multiline === true ? { multiline: true } : {}),
    ...(questionInput.allowSkip === true ? { allowSkip: true } : {}),
    ...(questionInput.allowOther === true ? { allowOther: true } : {}),
    ...(typeof questionInput.otherOptionLabel === 'string'
      ? { otherOptionLabel: questionInput.otherOptionLabel }
      : {}),
    ...(typeof questionInput.otherPlaceholder === 'string'
      ? { otherPlaceholder: questionInput.otherPlaceholder }
      : {}),
    ...(options.length > 0 ? { options } : {}),
  }
}
