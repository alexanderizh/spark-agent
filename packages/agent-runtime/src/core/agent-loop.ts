import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentStatusValue, ToolCallEvent } from '@spark/protocol'
import type { IModelAdapter, ChatMessage, ChatParams } from '../adapters/types.js'
import { ToolRegistry, type ToolContext } from './tool-registry.js'
import { AgentEventEmitter } from './event-emitter.js'

export type PermissionMode = 'auto' | 'ask'

export interface AgentConfig {
  adapter: IModelAdapter
  apiKey: string
  model: string
  systemPrompt?: string
  tools: ToolRegistry
  toolContext: ToolContext
  maxTurnIterations?: number
  permissionMode?: PermissionMode
  temperature?: number
  maxTokens?: number
}

export class AgentLoop {
  private emitter = new AgentEventEmitter()
  private abortController: AbortController | null = null

  onEvent(listener: (event: AgentEvent) => void): void {
    this.emitter.on(listener)
  }

  offEvent(listener: (event: AgentEvent) => void): void {
    this.emitter.off(listener)
  }

  cancel(): void {
    this.abortController?.abort()
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: AgentConfig,
    historyMessages: ChatMessage[] = [],
  ): Promise<void> {
    const { adapter, apiKey, model, systemPrompt, tools, toolContext, temperature, maxTokens } = config
    const maxIter = config.maxTurnIterations ?? 20

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const makeBase = () => ({
      id: randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const emitStatus = (status: AgentStatusValue) => {
      this.emitter.emit({ ...makeBase(), type: 'agent_status', status })
    }

    const messages: ChatMessage[] = [
      ...historyMessages,
      { role: 'user', content: userMessage },
    ]

    emitStatus('thinking')

    try {
      for (let iter = 0; iter < maxIter; iter++) {
        if (signal.aborted) break

        const params: ChatParams = {
          apiKey,
          model,
          messages,
          tools: tools.getDefinitions(),
          ...(systemPrompt !== undefined && { systemPrompt }),
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { maxTokens }),
        }

        let pendingToolCall: ToolCallEvent | null = null
        let gotToolCall = false

        for await (const event of adapter.streamChat(params, sessionId, turnId, signal)) {
          if (signal.aborted) break

          if (event.type === 'tool_call') {
            pendingToolCall = event as ToolCallEvent
            gotToolCall = true
            this.emitter.emit(event)
            emitStatus('calling_tool')

            const resultBase = makeBase()
            const toolResult = await tools.execute(toolContext, pendingToolCall, resultBase)
            this.emitter.emit(toolResult)

            // Append assistant tool_use + tool_result to messages for next iteration
            messages.push({
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: pendingToolCall.toolCallId,
                  name: pendingToolCall.toolName,
                  input: pendingToolCall.toolInput,
                },
              ],
            })
            messages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: pendingToolCall.toolCallId,
                  content: toolResult.status === 'success'
                    ? JSON.stringify(toolResult.output)
                    : (toolResult.error ?? 'error'),
                },
              ],
            })

            emitStatus('thinking')
            break // restart loop with updated messages
          } else {
            this.emitter.emit(event)
          }
        }

        if (signal.aborted) {
          this.emitter.emit({
            ...makeBase(),
            type: 'agent_error',
            code: 'ABORTED',
            message: 'Turn cancelled by user',
            retryable: false,
          })
          emitStatus('cancelled')
          return
        }

        if (!gotToolCall) {
          // LLM finished without requesting a tool
          emitStatus('completed')
          return
        }
      }

      // Exceeded maxTurnIterations
      this.emitter.emit({
        ...makeBase(),
        type: 'agent_error',
        code: 'MAX_ITERATIONS',
        message: `Exceeded max turn iterations (${maxIter})`,
        retryable: false,
      })
      emitStatus('error')
    } catch (err) {
      if (signal.aborted) {
        this.emitter.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'ABORTED',
          message: 'Turn cancelled',
          retryable: false,
        })
        emitStatus('cancelled')
      } else {
        this.emitter.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'RUNTIME_ERROR',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        })
        emitStatus('error')
      }
    }
  }
}
