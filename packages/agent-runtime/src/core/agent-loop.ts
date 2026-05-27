import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentStatusValue, SessionPermissionMode, ToolCallEvent } from '@spark/protocol'
import type { IModelAdapter, ChatMessage, ChatParams } from '../adapters/types.js'
import { ToolRegistry, type ToolContext } from './tool-registry.js'
import { AgentEventEmitter } from './event-emitter.js'
import { isReadonlyCommand } from './tools/bash.js'
import { isGitReadonly, isGitDenied } from './tools/git.js'

type ToolPermissionDecision = 'allow' | 'ask' | 'deny'

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
  /** Skill 注入的 system prompt（在 base system prompt 之前） */
  skillSystemPrompt?: string
  tools: ToolRegistry
  toolContext: ToolContext
  maxTurnIterations?: number
  permissionMode?: SessionPermissionMode
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
    const { adapter, apiKey, model, apiEndpoint, tools, toolContext, temperature, maxTokens, reasoningEffort, permissionMode, approvalCallback, context } = config
    const maxIter = config.maxTurnIterations ?? 20

    // Build system prompt with injected context and optional skill prompt
    const systemPrompt = buildSystemPrompt(config.systemPrompt, context, config.skillSystemPrompt)

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

            const permissionDecision = getToolPermissionDecision(permissionMode, pendingToolCall.toolName, pendingToolCall.toolInput)
            if (permissionDecision === 'deny') {
              this.emitter.emit({
                ...resultBase,
                type: 'tool_result',
                toolCallId: pendingToolCall.toolCallId,
                toolName: pendingToolCall.toolName,
                status: 'denied',
                error: 'Tool execution denied by permission mode',
                durationMs: 0,
              })
              emitStatus('thinking')
              messages.push({
                role: 'assistant',
                content: [{ type: 'tool_use', id: pendingToolCall.toolCallId, name: pendingToolCall.toolName, input: pendingToolCall.toolInput }],
              })
              messages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: pendingToolCall.toolCallId, content: 'Tool execution denied by permission mode' }],
              })
              break
            }

            // Permission approval check
            if (approvalCallback && permissionDecision === 'ask') {
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

function getToolPermissionDecision(mode: SessionPermissionMode | undefined, toolName: string, toolInput?: Record<string, unknown>): ToolPermissionDecision {
  const permissionMode = mode ?? 'codex-default'
  const category = getToolCategory(toolName)

  // Full access modes: allow everything
  if (permissionMode === 'claude-bypass' || permissionMode === 'codex-full-access') return 'allow'

  // Plan mode: only reads allowed
  if (permissionMode === 'claude-plan') return category === 'read' ? 'allow' : 'deny'

  // Use fine-grained permission for bash and git tools
  if (toolInput && (toolName === 'bash' || toolName === 'git')) {
    const level = getToolPermissionLevel(toolName, toolInput)

    // Always deny 'deny' level regardless of mode
    if (level === 'deny') return 'deny'

    // Auto-approve 'auto' level in all modes except plan (handled above)
    if (level === 'auto') return 'allow'

    // 'ask' level: depends on permission mode
    if (permissionMode === 'claude-auto-edits') return category === 'command' ? 'ask' : 'allow'
    if (permissionMode === 'claude-auto' || permissionMode === 'codex-auto-review') return 'ask'
    // Default for ask-level: ask
    return 'ask'
  }

  // Standard category-based permissions for other tools
  if (permissionMode === 'claude-auto-edits') return category === 'command' || category === 'dangerous' ? 'ask' : 'allow'
  if (permissionMode === 'claude-auto' || permissionMode === 'codex-auto-review') return category === 'dangerous' ? 'ask' : 'allow'
  if (permissionMode === 'claude-ask' || permissionMode === 'codex-default') return category === 'read' ? 'allow' : 'ask'

  return category === 'read' ? 'allow' : 'ask'
}

function getToolCategory(toolName: string): 'read' | 'write' | 'command' | 'dangerous' {
  // File read tools — always auto-approved
  if (toolName === 'read_file' || toolName === 'list_directory' || toolName === 'search_files' || toolName === 'grep_files') return 'read'

  // grep tool — read-only, auto-approved
  if (toolName === 'grep') return 'read'

  // File write tools — require approval (except in full-access modes)
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'apply_patch') return 'write'

  // bash tool — categorized based on the command content
  // For permission purposes, bash is 'command' category (default: ask)
  // But we support fine-grained permission via tool metadata
  if (toolName === 'bash' || toolName === 'run_command') return 'command'

  // git tool — categorized based on operation type
  // For permission purposes, git defaults to 'command'
  // But individual operations can be auto-approved (readonly) or denied
  if (toolName === 'git') return 'command'

  // Dangerous tools — always denied
  if (toolName === 'delete_file' || toolName === 'git_push') return 'dangerous'

  return 'dangerous'
}

/**
 * Get fine-grained permission decision for a tool call.
 * This goes beyond the basic category-based check to support
 * per-command permission levels (e.g., read-only bash commands auto-approved).
 */
export function getToolPermissionLevel(
  toolName: string,
  toolInput: Record<string, unknown>,
): 'auto' | 'ask' | 'deny' {
  // bash: read-only commands auto-approved
  if (toolName === 'bash') {
    const command = String(toolInput['command'] ?? '')
    if (isReadonlyCommand(command)) return 'auto'
    return 'ask'
  }

  // git: read operations auto-approved, write operations ask
  if (toolName === 'git') {
    const operation = String(toolInput['operation'] ?? '')
    if (isGitReadonly(operation)) return 'auto'
    if (isGitDenied(operation)) return 'deny'
    return 'ask'
  }

  // Default: use category-based decision
  return 'ask'
}

/**
 * Build the final system prompt by injecting structured context and optional skill prompt.
 *
 * Format:
 *   [Skill Instructions]
 *   skill system prompt...
 *
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
function buildSystemPrompt(
  basePrompt: string | undefined,
  context: AgentContext | undefined,
  skillPrompt?: string,
): string | undefined {
  if (context == null && !skillPrompt) return basePrompt

  const sections: string[] = []

  // Skill prompt takes highest priority (prepended first)
  if (skillPrompt != null && skillPrompt.length > 0) {
    sections.push(`[Skill Instructions]\n${skillPrompt}`)
  }

  if (context?.workspace != null) {
    sections.push(
      `[Workspace]\nName: ${context.workspace.name}\nPath: ${context.workspace.rootPath}\nType: ${context.workspace.projectKind}`,
    )
  }

  if (context?.projectRules != null && context.projectRules.length > 0) {
    sections.push(`[Rules]\n${context.projectRules.map((r) => `- ${r}`).join('\n')}`)
  }

  if (context?.sessionSummary != null && context.sessionSummary.length > 0) {
    sections.push(`[Session Summary]\n${context.sessionSummary}`)
  }

  if (sections.length === 0) return basePrompt

  const contextBlock = sections.join('\n\n')
  return basePrompt != null && basePrompt.length > 0
    ? `${contextBlock}\n\n${basePrompt}`
    : contextBlock
}
