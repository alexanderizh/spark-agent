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

export class MessageBuilder {
  private messages: UIMessage[] = []
  private currentAssistantId: string | null = null

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

        const lastBlock = msg.blocks[msg.blocks.length - 1]
        if (lastBlock?.kind === 'text') {
          if (event.mode === 'delta') {
            lastBlock.content += event.content
          } else {
            lastBlock.content = event.content
            lastBlock.isStreaming = false
          }
        } else {
          msg.blocks.push({
            kind: 'text',
            content: event.content,
            isStreaming: event.mode === 'delta',
          })
        }

        if (event.isFinal) {
          msg.status = 'completed'
        }
        break
      }

      case 'agent_thinking': {
        const msg = this.getOrCreateAssistant(event.id)
        const lastBlock = msg.blocks[msg.blocks.length - 1]
        if (lastBlock?.kind === 'thinking') {
          if (event.mode === 'delta') {
            lastBlock.content += event.content
          } else {
            lastBlock.content = event.content
            lastBlock.isStreaming = false
          }
        } else {
          msg.blocks.push({ kind: 'thinking', content: event.content, isStreaming: event.mode === 'delta' })
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
            block.output = event.output != null ? String(event.output) : undefined
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
          if (event.status === 'completed') msg.status = 'completed'
          else if (event.status === 'error' || event.status === 'cancelled') msg.status = 'error'
        }
        break
      }

      case 'agent_error': {
        const msg = this.getOrCreateAssistant(event.id)
        msg.status = 'error'
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
}
