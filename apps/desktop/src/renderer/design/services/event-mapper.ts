import type {
  AgentEvent,
  GoalEventStatus,
  TeamA2ATask,
  TeamA2AReply,
  TeamMemberEventContext,
  TurnPromptSnapshotEvent,
  RuntimeEventOrigin,
  UserQuestionOption,
  UserQuestionPrompt,
  WorkflowProgressNode,
} from '@spark/protocol'

export interface UIMessage {
  id: string
  turnId?: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'error' | 'cancelled'
  blocks: UIBlock[]
  attachments?: Array<{
    type: 'image' | 'file' | 'directory'
    path: string
    name?: string
  }>
  usage: {
    inputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    estimatedCostUsd: number | undefined
  } | null
  /** 消息创建时间（ISO 8601），取自事件 timestamp */
  timestamp?: string | undefined
  /** 参与构建此消息的所有事件 ID（用于删除时定位数据库事件） */
  eventIds: string[]
  /** 团队模式：该用户消息通过 @ 指定的 Agent ID（未填 → Host 主循环） */
  mentionAgentId?: string
  /** Assistant Agent snapshot captured when this message was created. */
  agentId?: string
  agentName?: string
}

export interface FileChangeSummary {
  path: string
  changeType: 'create' | 'modify' | 'delete'
  adds: number
  dels: number
  /** 原始 unified diff，用于「重新应用」时正向 patch */
  diff?: string
}

export interface UserQuestionAnswerSummary {
  question: string
  answer: string
  skipped?: boolean
}

export type UIBlock =
  | { kind: 'text'; content: string; isStreaming: boolean; segmentId?: string }
  | { kind: 'thinking'; content: string; isStreaming: boolean; segmentId?: string }
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
      /** 该 turn 内最近一次 checkpoint，用于「撤销」 */
      latestCheckpointId: string | undefined
    }
  | {
      kind: 'presented_files'
      files: Array<{ path: string; title?: string }>
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
      provider: 'claude' | 'codex'
      source: 'claude_code' | 'codex_cli' | 'codex_sdk'
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
      /** workflow_run 一次调用期间的实时节点进度清单（workflow_progress 事件驱动，原地更新）。 */
      kind: 'workflow_progress'
      workflowId: string
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

export class MessageBuilder {
  private messages: UIMessage[] = []
  private processedEventIds = new Set<string>()
  private currentAssistantId: string | null = null
  private latestContextUsage: ContextUsageSnapshot | null = null
  private latestPlanProposed: string | null = null
  private activeGoal: GoalSnapshot | null = null
  private orchestrationStatus: OrchestrationSnapshot | null = null
  private turnPromptSnapshots: TurnPromptSnapshotEvent[] = []
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
    return this.turnPromptSnapshots
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
          usage: null,
          timestamp: event.timestamp,
          eventIds: [event.id],
          ...(event.mentionAgentId != null ? { mentionAgentId: event.mentionAgentId } : {}),
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
            // 最终 result 文本：通常与最后一段 complete 内容一致，仅做去重收尾，
            // 不再清空全部 text block（那会吃掉多段正文，见 segmentId 注释）。
            // isFinal 只表示最终文本到达；整轮终态必须等 agent_status，避免后续工具/文件事件
            // 仍在追加时提前把气泡标为 completed 并触发日志折叠。
            this.reconcileFinalText(msg, event.content)
            break
          }
          this.applySegmentComplete(msg.blocks, 'text', event.content, event.segmentId)
          break
        }

        this.applySegmentDelta(msg.blocks, 'text', event.content, event.segmentId)

        if (event.isFinal) {
          this.reconcileFinalText(msg, event.content)
        }
        break
      }

      case 'agent_thinking': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        this.applyAgentSnapshot(msg, event)
        if (event.mode === 'complete') {
          this.applySegmentComplete(msg.blocks, 'thinking', event.content, event.segmentId)
        } else {
          this.applySegmentDelta(msg.blocks, 'thinking', event.content, event.segmentId)
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
            // 在 turn 完成时生成文件变更汇总
            this.appendTurnSummary(msg)
          } else if (event.status === 'error') {
            msg.status = 'error'
            this.finishStreamingBlocks(msg, 'error')
            // 即使出错也生成文件变更汇总
            this.appendTurnSummary(msg)
          } else if (event.status === 'cancelled') {
            this.finishStreamingBlocks(msg, 'error')
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
        if (event.origin?.kind !== 'subagent' && isCancellationErrorCode(event.code)) {
          const msg =
            this.findAssistantForEvent(event) ??
            this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          msg.status = 'cancelled'
          this.finishStreamingBlocks(msg, 'error')
          if (!msg.blocks.some((block) => block.kind === 'cancelled')) {
            msg.blocks.push({ kind: 'cancelled', message: '已取消本次任务' })
          }
          break
        }

        const aggregationKey = agentErrorAggregationKey(event)
        const existing = this.findRuntimeIssueBlock(
          event.turnId,
          (block) =>
            block.kind === 'error' &&
            agentErrorAggregationKey(block) === aggregationKey,
        )
        const relatedSubagent =
          event.origin?.kind === 'subagent' ? this.findSubagentBlock(event.origin.toolCallId) : null
        const msg =
          existing?.message ??
          relatedSubagent?.message ??
          this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)

        if (event.origin?.kind === 'subagent') {
          if (relatedSubagent != null) {
            relatedSubagent.block.status = 'error'
            relatedSubagent.block.progressSummary = event.message
          }
        } else {
          msg.status = 'error'
          this.finishStreamingBlocks(msg, 'error')
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
        const existing = this.findRuntimeIssueBlock(
          event.turnId,
          (block) =>
            block.kind === 'runtime_signal' &&
            runtimeSignalAggregationKey(block) === aggregationKey,
        )
        const relatedSubagent =
          event.origin?.kind === 'subagent' ? this.findSubagentBlock(event.origin.toolCallId) : null
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
          if (event.diff != null) existing.diff = event.diff
        } else {
          this.currentTurnFileChanges.push({
            path: event.path,
            changeType: event.changeType as 'create' | 'modify' | 'delete',
            adds: stats.adds,
            dels: stats.dels,
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
        // 把 SDK checkpoint.file_paths 合并进 currentTurnFileChanges —— 这是兜底：
        // 覆盖 Bash/MCP 等间接产生但未被 edit/write 工具捕获的文件（例如 AI 跑
        // python 生成的 pdf/docx/xlsx/pptx 产物）。无 diff，changeType 用 modify
        // （checkpoint 不区分新建/修改；UI 不依赖该字段做严格判断）。
        if (Array.isArray(event.filePaths)) {
          for (const raw of event.filePaths) {
            if (typeof raw !== 'string' || raw.length === 0) continue
            const norm = raw
            if (this.currentTurnFileChanges.some((f) => f.path === norm)) continue
            this.currentTurnFileChanges.push({
              path: norm,
              changeType: 'modify',
              adds: 0,
              dels: 0,
            })
          }
        }
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
        compactMsg.blocks.push({
          kind: 'context_compaction',
          provider: event.provider,
          source: event.source,
          phase: event.phase,
          ...(event.trigger != null ? { trigger: event.trigger } : {}),
          ...(event.preTokens != null ? { preTokens: event.preTokens } : {}),
          ...(event.postTokens != null ? { postTokens: event.postTokens } : {}),
          ...(event.durationMs != null ? { durationMs: event.durationMs } : {}),
          ...(event.summary != null ? { summary: event.summary } : {}),
          ...(event.message != null ? { message: event.message } : {}),
          ...(event.rawType != null ? { rawType: event.rawType } : {}),
        })
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
        const existing = this.findSubagentBlock(event.toolCallId)
        if (existing != null) {
          existing.block.name = event.name
          existing.block.role = event.role
          existing.block.task = event.task
          existing.block.status = 'running'
          if (event.taskId != null) existing.block.taskId = event.taskId
          if (!existing.message.eventIds.includes(event.id)) existing.message.eventIds.push(event.id)
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
        if (event.taskId != null) block.taskId = event.taskId
        if (event.description != null) block.task = event.description
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
        // Find the existing subagent block by toolCallId and update it
        for (const msg of this.messages) {
          const block = msg.blocks.find(
            (b) => b.kind === 'subagent' && b.toolCallId === event.toolCallId,
          )
          if (block && block.kind === 'subagent') {
            const tokenCount =
              event.totalTokens ?? (event.inputTokens ?? 0) + (event.outputTokens ?? 0)
            block.status =
              event.status === 'success'
                ? 'done'
                : event.status === 'stopped'
                  ? 'stopped'
                  : 'error'
            block.tokens = tokenCount > 0 ? tokenCount.toLocaleString() : ''
            block.output = event.output
            block.progressSummary = event.resultSummary
            if (event.toolUses != null) block.toolUses = event.toolUses
            if (event.durationMs != null) block.durationMs = event.durationMs
            if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
            break
          }
        }
        break
      }

      case 'turn_prompt_snapshot': {
        this.turnPromptSnapshots.push(event)
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
        // 的 emitWorkflowProgress），不是增量——直接整块替换即可，不需要合并。一个 turn 内
        // 只会有一次 workflow_run，所以按 turnId 找现有 block、没有就新建一个。
        const msg = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
        const existing = msg.blocks.find(
          (b): b is Extract<UIBlock, { kind: 'workflow_progress' }> =>
            b.kind === 'workflow_progress',
        )
        if (existing != null) {
          existing.runStatus = event.runStatus
          existing.nodes = event.nodes
        } else {
          msg.blocks.push({
            kind: 'workflow_progress',
            workflowId: event.workflowId,
            runStatus: event.runStatus,
            nodes: event.nodes,
          })
        }
        break
      }

      case 'goal_started':
      case 'goal_progress':
      case 'goal_resumed':
      case 'goal_paused': {
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
        break
      }

      case 'goal_completed':
      case 'goal_failed':
      case 'goal_cleared':
      case 'goal_budget_stopped': {
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
        const pushBlock = (content: string, isStreaming: boolean) => {
          msg.blocks.push({
            kind: 'team_member_message',
            dispatchId: event.dispatchId,
            memberAgentId: event.memberAgentId,
            content,
            isStreaming,
            ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
            eventIds: [event.id],
          })
        }

        if (event.mode === 'complete') {
          if (event.isFinal) {
            // 最终回复：通常等于最后一段 complete，按内容去重收尾；不覆盖此前各段叙述。
            const last = memberBlocks[memberBlocks.length - 1]
            if (event.content.length > 0) {
              if (last == null) pushBlock(event.content, false)
              else if (last.isStreaming) {
                last.content = event.content
                last.isStreaming = false
                recordEventId(last, event.id)
              } else if (last.content.trim() !== event.content.trim()) {
                pushBlock(event.content, false)
              } else {
                recordEventId(last, event.id)
              }
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

  getAllMessages(): UIMessage[] {
    return [...this.messages]
  }

  private findSubagentBlock(toolCallId: string): {
    message: UIMessage
    block: Extract<UIBlock, { kind: 'subagent' }>
  } | null {
    for (const message of this.messages) {
      const block = message.blocks.find(
        (candidate): candidate is Extract<UIBlock, { kind: 'subagent' }> =>
          candidate.kind === 'subagent' && candidate.toolCallId === toolCallId,
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
  }): {
    message: UIMessage
    block: Extract<UIBlock, { kind: 'subagent' }>
  } {
    const existing = this.findSubagentBlock(event.toolCallId)
    if (existing != null) return existing
    const message = this.getOrCreateAssistant(event.id, event.timestamp, { turnId: event.turnId })
    const block: Extract<UIBlock, { kind: 'subagent' }> = {
      kind: 'subagent',
      toolCallId: event.toolCallId,
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

  /** 最终 result 文本：与最后一段正文按内容去重，避免重复或覆盖此前各段 */
  private reconcileFinalText(msg: UIMessage, content: string): void {
    if (content.length === 0) return
    type TextBlock = Extract<UIBlock, { kind: 'text' }>
    const textBlocks = msg.blocks.filter((b): b is TextBlock => b.kind === 'text')
    if (textBlocks.length > 0 && containsAllTextBlocks(content, textBlocks)) {
      for (const block of textBlocks) block.isStreaming = false
      return
    }
    const lastText = textBlocks.at(-1)
    if (lastText == null) {
      msg.blocks.push({ kind: 'text', content, isStreaming: false })
    } else if (lastText.isStreaming) {
      lastText.content = content
      lastText.isStreaming = false
    } else if (lastText.content.trim() !== content.trim()) {
      msg.blocks.push({ kind: 'text', content, isStreaming: false })
    }
  }

  /** 在消息末尾追加文件变更汇总块 */
  private appendTurnSummary(msg: UIMessage): void {
    if (this.turnSummaryEmitted || this.currentTurnFileChanges.length === 0) return
    this.turnSummaryEmitted = true

    const totalAdds = this.currentTurnFileChanges.reduce((s, f) => s + f.adds, 0)
    const totalDels = this.currentTurnFileChanges.reduce((s, f) => s + f.dels, 0)

    msg.blocks.push({
      kind: 'turn_file_summary',
      files: [...this.currentTurnFileChanges],
      totalAdds,
      totalDels,
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
}

function containsAllTextBlocks(
  content: string,
  blocks: Array<Extract<UIBlock, { kind: 'text' }>>,
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
