import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentStatusValue, ToolCallEvent } from '@spark/protocol'
import type { IModelAdapter, ChatMessage, ChatParams } from '../adapters/types.js'
import { ToolRegistry, type ToolContext } from './tool-registry.js'
import { AgentEventEmitter } from './event-emitter.js'

export type PermissionMode = 'auto' | 'ask'

/** Called before a tool executes. Return true to allow, false to deny. */
export type ApprovalCallback = (
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<boolean>

/** Structured context injected into the system prompt */
export interface AgentContext {
  /** Workspace information */
  workspace?: {
    name: string
    rootPath: string
    projectKind: string
  }
  /** Active project rules (content strings) */
  projectRules?: string[]
  /** Recent session summary for continuity */
  sessionSummary?: string
}

export interface AgentConfig {
  adapter: IModelAdapter
  apiKey: string
  model: string
  apiEndpoint?: string
  systemPrompt?: string
  tools: ToolRegistry
  toolContext: ToolContext
  maxTurnIterations?: number
  permissionMode?: PermissionMode
  temperature?: number
  maxTokens?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  /** Optional approval callback; if provided, called before each tool execution */
  approvalCallback?: ApprovalCallback
  /** Optional structured context injected into system prompt */
  context?: AgentContext
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
    const { adapter, apiKey, model, apiEndpoint, tools, toolContext, temperature, maxTokens, reasoningEffort, approvalCallback, context } = config
    const maxIter = config.maxTurnIterations ?? 20

    // Build system prompt with injected context
    const systemPrompt = buildSystemPrompt(config.systemPrompt, context)

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

    // Emit user_message event so the renderer can display the user's input
    this.emitter.emit({
      ...makeBase(),
      type: 'user_message',
      content: userMessage,
    })

    emitStatus('thinking')

    try {
      for (let iter = 0; iter < maxIter; iter++) {
        if (signal.aborted) break

        const params: ChatParams = {
          apiKey,
          model,
          messages,
          tools: tools.getDefinitions(),
          ...(apiEndpoint !== undefined && { apiEndpoint }),
          ...(systemPrompt !== undefined && { systemPrompt }),
          ...(temperature !== undefined && { temperature }),
          ...(maxTokens !== undefined && { maxTokens }),
          ...(reasoningEffort !== undefined && { reasoningEffort }),
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

            // Permission approval check
            if (approvalCallback) {
              const allowed = await approvalCallback(sessionId, pendingToolCall.toolName, pendingToolCall.toolInput)
              if (!allowed) {
                this.emitter.emit({
                  ...resultBase,
                  type: 'tool_result',
                  toolCallId: pendingToolCall.toolCallId,
                  toolName: pendingToolCall.toolName,
                  status: 'denied',
                  error: 'User denied tool execution',
                  durationMs: 0,
                })
                emitStatus('thinking')
                messages.push({
                  role: 'assistant',
                  content: [{ type: 'tool_use', id: pendingToolCall.toolCallId, name: pendingToolCall.toolName, input: pendingToolCall.toolInput }],
                })
                messages.push({
                  role: 'user',
                  content: [{ type: 'tool_result', tool_use_id: pendingToolCall.toolCallId, content: 'Tool execution denied by user' }],
                })
                break
              }
            }

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

/**
 * Build the final system prompt by injecting structured context.
 *
 * Format:
 *   [Workspace]
 *   Name: xxx
 *   Path: xxx
 *   Type: xxx
 *
 *   [Rules]
 *   - rule content 1
 *   - rule content 2
 *
 *   [Session Summary]
 *   summary text...
 *
 *   {original system prompt}
 */
function buildSystemPrompt(basePrompt: string | undefined, context: AgentContext | undefined): string | undefined {
  if (context == null) return basePrompt

  const sections: string[] = []

  if (context.workspace != null) {
    sections.push(
      `[Workspace]\nName: ${context.workspace.name}\nPath: ${context.workspace.rootPath}\nType: ${context.workspace.projectKind}`,
    )
  }

  if (context.projectRules != null && context.projectRules.length > 0) {
    sections.push(`[Rules]\n${context.projectRules.map((r) => `- ${r}`).join('\n')}`)
  }

  if (context.sessionSummary != null && context.sessionSummary.length > 0) {
    sections.push(`[Session Summary]\n${context.sessionSummary}`)
  }

  if (sections.length === 0) return basePrompt

  const contextBlock = sections.join('\n\n')
  return basePrompt != null && basePrompt.length > 0
    ? `${contextBlock}\n\n${basePrompt}`
    : contextBlock
}
