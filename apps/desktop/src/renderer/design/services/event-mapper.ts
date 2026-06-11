import type {
  AgentEvent,
  TeamA2ATask,
  TeamA2AReply,
  TeamMemberEventContext,
  TurnPromptSnapshotEvent,
  UserQuestionOption,
  UserQuestionPrompt,
} from '@spark/protocol'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'error'
  blocks: UIBlock[]
  attachments?: Array<{
    type: 'image' | 'file'
    path: string
    name?: string
  }>
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | undefined } | null
  /** 消息创建时间（ISO 8601），取自事件 timestamp */
  timestamp?: string | undefined
  /** 参与构建此消息的所有事件 ID（用于删除时定位数据库事件） */
  eventIds: string[]
  /** 团队模式：该用户消息通过 @ 指定的 Agent ID（未填 → Host 主循环） */
  mentionAgentId?: string
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
  | { kind: 'error'; code: string; message: string; retryable: boolean }
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
      name: string
      role: string
      task: string
      status: 'running' | 'done'
      tokens: string
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
      kind: 'user_question'
      toolCallId: string
      questions: UserQuestionPrompt[]
      answered: boolean
      answerSummary?: UserQuestionAnswerSummary[]
    }
  | {
      kind: 'context_ledger'
      sections: Array<{ label: string; estimatedTokens: number; charCount: number; truncated: boolean }>
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
    }

export interface ContextUsageSnapshot {
  estimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  compactedThisTurn: boolean
}

export class MessageBuilder {
  private messages: UIMessage[] = []
  private currentAssistantId: string | null = null
  private latestContextUsage: ContextUsageSnapshot | null = null
  private latestPlanProposed: string | null = null
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

  processEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'user_message': {
        this.currentAssistantId = null
        this.messages.push({
          id: event.id,
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
        })
        break
      }

      case 'assistant_message': {
        let msg: UIMessage | undefined = this.currentAssistantId
          ? this.messages.find((m) => m.id === this.currentAssistantId)
          : undefined

        if (!msg) {
          msg = {
            id: event.id,
            role: 'assistant',
            status: 'streaming',
            blocks: [],
            usage: null,
            timestamp: event.timestamp,
            eventIds: [event.id],
          }
          this.messages.push(msg)
          this.currentAssistantId = msg.id
        } else {
          if (!msg.eventIds.includes(event.id)) {
            msg.eventIds.push(event.id)
          }
        }

        if (event.mode === 'complete') {
          if (event.isFinal) {
            // 最终 result 文本：通常与最后一段 complete 内容一致，仅做去重收尾，
            // 不再清空全部 text block（那会吃掉多段正文，见 segmentId 注释）。
            this.reconcileFinalText(msg, event.content)
            msg.status = 'completed'
            this.finishStreamingBlocks(msg, 'completed')
            break
          }
          this.applySegmentComplete(msg.blocks, 'text', event.content, event.segmentId)
          break
        }

        this.applySegmentDelta(msg.blocks, 'text', event.content, event.segmentId)

        if (event.isFinal) {
          msg.status = 'completed'
          this.finishStreamingBlocks(msg, 'completed')
        }
        break
      }

      case 'agent_thinking': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
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
        const msg = home ?? this.getOrCreateAssistant(event.id, event.timestamp)
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
            ...(event.teamMemberContext != null ? { teamMemberContext: event.teamMemberContext } : {}),
          })
        }
        break
      }

      case 'tool_result': {
        // 优先在「包含该 toolCall block 的消息」上更新（member 工具结果可能不在当前消息）
        const owner = this.messages.find((m) =>
          m.blocks.some(
            (b) =>
              (b.kind === 'tool_call' || b.kind === 'user_question') &&
              b.toolCallId === event.toolCallId,
          ),
        )
        const msg =
          owner ??
          (this.currentAssistantId
            ? this.messages.find((m) => m.id === this.currentAssistantId)
            : null)
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          // Update user_question block answered state
          const questionBlock = msg.blocks.find(
            (b) => b.kind === 'user_question' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'user_question' }> | undefined
          if (questionBlock) {
            questionBlock.answered = true
            // Only overwrite answerSummary if we don't already have one
            // (answers may have been populated when the user submitted via the dock)
            if (
              !questionBlock.answerSummary ||
              questionBlock.answerSummary.length === 0
            ) {
              questionBlock.answerSummary = extractQuestionAnswerSummary(
                event.output,
                questionBlock.questions,
              )
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
        const msg = this.currentAssistantId
          ? this.messages.find((m) => m.id === this.currentAssistantId)
          : null
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          if (event.status === 'completed') {
            msg.status = 'completed'
            this.finishStreamingBlocks(msg, 'completed')
            // 在 turn 完成时生成文件变更汇总
            this.appendTurnSummary(msg)
          } else if (event.status === 'error' || event.status === 'cancelled') {
            msg.status = 'error'
            this.finishStreamingBlocks(msg, 'error')
            // 即使出错也生成文件变更汇总
            this.appendTurnSummary(msg)
          }
        }
        break
      }

      case 'agent_error': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
        msg.status = 'error'
        this.finishStreamingBlocks(msg, 'error')
        msg.blocks.push({
          kind: 'error',
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        })
        break
      }

      case 'terminal_output': {
        const msg = this.currentAssistantId
          ? this.messages.find((m) => m.id === this.currentAssistantId)
          : null
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
              ...(event.teamMemberContext != null ? { teamMemberContext: event.teamMemberContext } : {}),
            })
          }
        }
        break
      }

      case 'file_change': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
        msg.blocks.push({
          kind: 'file_change',
          changeType: event.changeType,
          path: event.path,
          diff: event.diff ?? undefined,
          ...(event.teamMemberContext != null ? { teamMemberContext: event.teamMemberContext } : {}),
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

      case 'checkpoint': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
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
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
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
        const sumMsg = this.getOrCreateAssistant(event.id, event.timestamp)
        sumMsg.blocks.push({
          kind: 'context_summarized',
          summarizedEntryCount: event.summarizedEntryCount,
          tokensSaved: event.tokensSaved,
          summaryTokens: event.summaryTokens,
        })
        break
      }

      case 'retry_trail': {
        const rtMsg = this.getOrCreateAssistant(event.id, event.timestamp)
        rtMsg.blocks.push({
          kind: 'retry_trail',
          target: event.target,
          attempts: event.attempts,
          finalOutcome: event.finalOutcome,
        })
        break
      }

      case 'subagent_started': {
        const saMsg = this.getOrCreateAssistant(event.id, event.timestamp)
        saMsg.blocks.push({
          kind: 'subagent',
          toolCallId: event.toolCallId,
          name: event.name,
          role: event.role,
          task: event.task,
          status: 'running',
          tokens: '',
        })
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
              (event.inputTokens ?? 0) + (event.outputTokens ?? 0)
            ;(block as Record<string, unknown>).status = 'done'
            ;(block as Record<string, unknown>).tokens = `${tokenCount.toLocaleString()}`
            ;(block as Record<string, unknown>).output = event.output
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

      case 'plan_proposed': {
        // Stash the plan for PlanApprovalModal (global overlay)
        this.latestPlanProposed = event.plan
        // Also emit a UIBlock so it renders inline in the message stream
        const planMsg = this.getOrCreateAssistant(event.id, event.timestamp)
        planMsg.blocks.push({ kind: 'plan_proposed', plan: event.plan })
        break
      }

      case 'permission_request': {
        // Emit a UIBlock for inline rendering (also handled as global modal in App.tsx)
        const permMsg = this.getOrCreateAssistant(event.id, event.timestamp)
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
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
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
        const msg = home ?? this.getOrCreateAssistant(event.id, event.timestamp)
        if (!msg.eventIds.includes(event.id)) {
          msg.eventIds.push(event.id)
        }
        const memberBlocks = msg.blocks.filter(
          (b): b is Extract<UIBlock, { kind: 'team_member_message' }> =>
            b.kind === 'team_member_message' && b.dispatchId === event.dispatchId,
        )
        const pushBlock = (content: string, isStreaming: boolean) => {
          msg.blocks.push({
            kind: 'team_member_message',
            dispatchId: event.dispatchId,
            memberAgentId: event.memberAgentId,
            content,
            isStreaming,
            ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
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
              } else if (last.content.trim() !== event.content.trim()) {
                pushBlock(event.content, false)
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
          } else if (event.content.length > 0) {
            pushBlock(event.content, false)
          }
          break
        }

        // delta
        if (event.segmentId != null) {
          const block = memberBlocks.find((b) => b.segmentId === event.segmentId)
          if (block) block.content += event.content
          else pushBlock(event.content, true)
          break
        }
        const lastStreaming = [...memberBlocks].reverse().find((b) => b.isStreaming)
        if (lastStreaming) lastStreaming.content += event.content
        else pushBlock(event.content, true)
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
            else if (event.status === 'working' || event.status === 'pending') block.state = 'working'
            if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
            break
          }
        }
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

  removeMessage(messageId: string): void {
    this.messages = this.messages.filter((m) => m.id !== messageId)
    if (this.currentAssistantId === messageId) {
      this.currentAssistantId = null
    }
  }

  clearAll(): void {
    this.messages = []
    this.currentAssistantId = null
    this.turnPromptSnapshots = []
    this.currentTurnFileChanges = []
    this.currentTurnCheckpointId = undefined
    this.turnSummaryEmitted = false
  }

  private getOrCreateAssistant(eventId: string, timestamp?: string | undefined): UIMessage {
    if (this.currentAssistantId) {
      const existing = this.messages.find((m) => m.id === this.currentAssistantId)
      if (existing) {
        if (!existing.eventIds.includes(eventId)) {
          existing.eventIds.push(eventId)
        }
        return existing
      }
    }
    const msg: UIMessage = {
      id: eventId,
      role: 'assistant',
      status: 'streaming',
      blocks: [],
      usage: null,
      timestamp,
      eventIds: [eventId],
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
        if (block.isStreaming) {
          block.content = content
          block.isStreaming = false
        } else if (content.length > 0) {
          // 同一 SDK message 含多个同类 block（罕见）：追加而非覆盖
          block.content += content
        }
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
    const lastText = [...msg.blocks].reverse().find((b) => b.kind === 'text') as
      | TextBlock
      | undefined
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
function extractQuestions(
  toolInput: Record<string, unknown>,
): UserQuestionPrompt[] {
  // Support both single-question and multi-question formats
  const raw = toolInput.questions ?? toolInput
  if (Array.isArray(raw)) {
    return raw
      .map((q: unknown) => {
        if (typeof q !== 'object' || q == null) return null
        return normalizeQuestionPrompt(q as Record<string, unknown>)
      })
      .filter(
        (q): q is NonNullable<UserQuestionPrompt> => q != null,
      )
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
          : questions[index]?.question ?? `问题 ${index + 1}`
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

function normalizeQuestionPrompt(questionInput: Record<string, unknown>): UserQuestionPrompt | null {
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
    ...(typeof questionInput.placeholder === 'string' ? { placeholder: questionInput.placeholder } : {}),
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
