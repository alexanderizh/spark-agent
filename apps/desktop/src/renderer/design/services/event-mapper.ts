import type {
  AgentEvent,
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
}

export interface FileChangeSummary {
  path: string
  changeType: 'create' | 'modify' | 'delete'
  adds: number
  dels: number
  /** 原始 unified diff，用于「重新应用」时正向 patch */
  diff?: string
}

export type UIBlock =
  | { kind: 'text'; content: string; isStreaming: boolean }
  | { kind: 'thinking'; content: string; isStreaming: boolean }
  | {
      kind: 'tool_call'
      toolCallId: string
      toolName: string
      toolInput: Record<string, unknown>
      status: 'pending' | 'running' | 'success' | 'error'
      output: string | undefined
      error: string | undefined
      durationMs: number | undefined
    }
  | { kind: 'error'; code: string; message: string; retryable: boolean }
  | { kind: 'file_change'; changeType: string; path: string; diff: string | undefined }
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
          msg.blocks = msg.blocks.filter((block) => block.kind !== 'text')
          if (event.content.length > 0) {
            msg.blocks.push({ kind: 'text', content: event.content, isStreaming: false })
          }
          if (event.isFinal) {
            msg.status = 'completed'
            this.finishStreamingBlocks(msg, 'completed')
          }
          break
        }

        const lastBlock = msg.blocks[msg.blocks.length - 1]
        if (lastBlock?.kind === 'text') {
          lastBlock.content += event.content
        } else {
          msg.blocks.push({
            kind: 'text',
            content: event.content,
            isStreaming: true,
          })
        }

        if (event.isFinal) {
          msg.status = 'completed'
          this.finishStreamingBlocks(msg, 'completed')
        }
        break
      }

      case 'agent_thinking': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
        if (event.mode === 'complete') {
          msg.blocks = msg.blocks.filter((block) => block.kind !== 'thinking')
          if (event.content.length > 0) {
            // Always insert thinking at the beginning so it appears before text blocks
            msg.blocks.unshift({ kind: 'thinking', content: event.content, isStreaming: false })
          }
          break
        }

        // Find the last thinking block — search from end, skip non-thinking blocks
        // This ensures thinking blocks are always grouped together (before text)
        let lastThinkingIdx = -1
        for (let i = msg.blocks.length - 1; i >= 0; i--) {
          if (msg.blocks[i]?.kind === 'thinking') {
            lastThinkingIdx = i
            break
          }
        }

        if (lastThinkingIdx >= 0) {
          ;(msg.blocks[lastThinkingIdx] as Extract<UIBlock, { kind: 'thinking' }>).content +=
            event.content
        } else {
          // No thinking block yet — insert at beginning to keep thinking before text
          msg.blocks.unshift({ kind: 'thinking', content: event.content, isStreaming: true })
        }
        break
      }

      case 'tool_call': {
        const msg = this.getOrCreateAssistant(event.id, event.timestamp)
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
          })
        }
        break
      }

      case 'tool_result': {
        const msg = this.currentAssistantId
          ? this.messages.find((m) => m.id === this.currentAssistantId)
          : null
        if (msg) {
          if (!msg.eventIds.includes(event.id)) msg.eventIds.push(event.id)
          // Update user_question block answered state
          const questionBlock = msg.blocks.find(
            (b) => b.kind === 'user_question' && b.toolCallId === event.toolCallId,
          ) as Extract<UIBlock, { kind: 'user_question' }> | undefined
          if (questionBlock) {
            questionBlock.answered = true
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
