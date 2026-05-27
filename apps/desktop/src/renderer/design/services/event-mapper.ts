import type { AgentEvent } from '@spark/protocol'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'error'
  blocks: UIBlock[]
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | undefined } | null
}

export type UIBlock =
  | { kind: 'text'; content: string; isStreaming: boolean }
  | { kind: 'thinking'; content: string; isStreaming: boolean }
  | { kind: 'tool_call'; toolCallId: string; toolName: string; toolInput: Record<string, unknown>; status: 'pending' | 'running' | 'success' | 'error'; output: string | undefined; error: string | undefined; durationMs: number | undefined }
  | { kind: 'error'; code: string; message: string; retryable: boolean }
  | { kind: 'file_change'; changeType: string; path: string; diff: string | undefined }
  | { kind: 'terminal'; toolCallId: string; stdout: string; stderr: string; isStreaming: boolean; exitCode: number | undefined }
  | { kind: 'plan_proposed'; plan: string }
  | { kind: 'permission_request'; requestId: string; action: string; riskLevel: string; description: string; paths: string[] | undefined; command: string | undefined; domains: string[] | undefined }
  | { kind: 'subagent'; name: string; role: string; task: string; status: 'running' | 'done'; tokens: string }

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

  getLatestContextUsage(): ContextUsageSnapshot | null {
    return this.latestContextUsage
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
          usage: null,
        })
        break
      }

      case 'assistant_message': {
        let msg: UIMessage | undefined = this.currentAssistantId
          ? this.messages.find(m => m.id === this.currentAssistantId)
          : undefined

        if (!msg) {
          msg = { id: event.id, role: 'assistant', status: 'streaming', blocks: [], usage: null }
          this.messages.push(msg)
          this.currentAssistantId = msg.id
        }

        if (event.mode === 'complete') {
          msg.blocks = msg.blocks.filter(block => block.kind !== 'text')
          if (event.content.length > 0) {
            msg.blocks.push({ kind: 'text', content: event.content, isStreaming: false })
          }
          if (event.isFinal) {
            msg.status = 'completed'
            this.finishStreamingBlocks(msg)
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
          this.finishStreamingBlocks(msg)
        }
        break
      }

      case 'agent_thinking': {
        const msg = this.getOrCreateAssistant(event.id)
        if (event.mode === 'complete') {
          msg.blocks = msg.blocks.filter(block => block.kind !== 'thinking')
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
          ;(msg.blocks[lastThinkingIdx] as Extract<UIBlock, { kind: 'thinking' }>).content += event.content
        } else {
          // No thinking block yet — insert at beginning to keep thinking before text
          msg.blocks.unshift({ kind: 'thinking', content: event.content, isStreaming: true })
        }
        break
      }

      case 'tool_call': {
        const msg = this.getOrCreateAssistant(event.id)
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
        break
      }

      case 'tool_result': {
        const msg = this.currentAssistantId
          ? this.messages.find(m => m.id === this.currentAssistantId)
          : null
        if (msg) {
          const block = msg.blocks.find(
            b => b.kind === 'tool_call' && b.toolCallId === event.toolCallId
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
          ? this.messages.find(m => m.id === this.currentAssistantId)
          : null
        if (msg) {
          if (event.status === 'completed') {
            msg.status = 'completed'
            this.finishStreamingBlocks(msg)
          } else if (event.status === 'error' || event.status === 'cancelled') {
            msg.status = 'error'
            this.finishStreamingBlocks(msg)
          }
        }
        break
      }

      case 'agent_error': {
        const msg = this.getOrCreateAssistant(event.id)
        msg.status = 'error'
        this.finishStreamingBlocks(msg)
        msg.blocks.push({ kind: 'error', code: event.code, message: event.message, retryable: event.retryable })
        break
      }

      case 'terminal_output': {
        const msg = this.currentAssistantId
          ? this.messages.find(m => m.id === this.currentAssistantId)
          : null
        if (msg) {
          const block = msg.blocks.find(
            b => b.kind === 'terminal' && b.toolCallId === event.toolCallId
          ) as Extract<UIBlock, { kind: 'terminal' }> | undefined
          if (block) {
            if (event.stream === 'stdout') block.stdout += event.data
            else block.stderr += event.data
            if (event.isFinal) {
              block.isStreaming = false
              block.exitCode = event.exitCode ?? undefined
            }
          } else {
            const exitCode: number | undefined = event.isFinal ? (event.exitCode ?? undefined) : undefined
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
        const msg = this.getOrCreateAssistant(event.id)
        msg.blocks.push({ kind: 'file_change', changeType: event.changeType, path: event.path, diff: event.diff ?? undefined })
        break
      }

      case 'usage_update': {
        const msg = this.currentAssistantId
          ? this.messages.find(m => m.id === this.currentAssistantId)
          : null
        if (msg) {
          msg.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, estimatedCostUsd: event.estimatedCostUsd }
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

      case 'plan_proposed': {
        // Stash the plan for PlanApprovalModal (global overlay)
        this.latestPlanProposed = event.plan
        // Also emit a UIBlock so it renders inline in the message stream
        const planMsg = this.getOrCreateAssistant(event.id)
        planMsg.blocks.push({ kind: 'plan_proposed', plan: event.plan })
        break
      }

      case 'permission_request': {
        // Emit a UIBlock for inline rendering (also handled as global modal in App.tsx)
        const permMsg = this.getOrCreateAssistant(event.id)
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

  private getOrCreateAssistant(eventId: string): UIMessage {
    if (this.currentAssistantId) {
      const existing = this.messages.find(m => m.id === this.currentAssistantId)
      if (existing) return existing
    }
    const msg: UIMessage = { id: eventId, role: 'assistant', status: 'streaming', blocks: [], usage: null }
    this.messages.push(msg)
    this.currentAssistantId = msg.id
    return msg
  }

  private finishStreamingBlocks(msg: UIMessage): void {
    for (const block of msg.blocks) {
      if (block.kind === 'text' || block.kind === 'thinking' || block.kind === 'terminal') {
        block.isStreaming = false
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
