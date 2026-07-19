import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import type { AgentEvent } from '@spark/protocol'
import { resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import type { SDKExecutorConfig, SDKTurnAttachment } from './types.js'

type Listener = (event: AgentEvent) => void
type EventBase = { id: string; sessionId: string; turnId: string; timestamp: string; seq: number }

/**
 * Direct OpenAI-compatible Chat Completions executor.
 *
 * Codex CLI 0.144.5 removed `wire_api = "chat"`, so Chat providers must not be
 * sent through CodexSdkExecutor (which starts that CLI internally). Responses
 * providers continue to use CodexSdkExecutor and retain the full Codex tool
 * runtime.
 */
export class CodexOpenAIExecutor {
  private listeners = new Set<Listener>()
  private abortController: AbortController | null = null

  onEvent(listener: Listener): void {
    this.listeners.add(listener)
  }

  offEvent(listener: Listener): void {
    this.listeners.delete(listener)
  }

  cancel(): void {
    this.abortController?.abort()
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    const makeBase = (): EventBase => ({
      id: randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })
    const prompt = buildCodexChatPrompt(userMessage, config)
    const client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
        ? { baseURL: resolveChatApiBaseUrl(config.apiEndpoint) }
        : {}),
    })
    const controller = new AbortController()
    this.abortController = controller

    this.emit({
      ...makeBase(),
      type: 'user_message',
      content: userMessage,
      ...(config.attachments != null && config.attachments.length > 0
        ? {
            attachments: config.attachments.map((attachment) => ({
              type: attachment.type,
              path: attachment.path,
              name: attachment.name,
            })),
          }
        : {}),
    })
    this.emit({
      ...makeBase(),
      type: 'agent_status',
      status: 'thinking',
      message: 'OpenAI Chat Completions stream is running',
    })
    this.emit({
      ...makeBase(),
      type: 'context_usage',
      estimatedTokens: Math.ceil(prompt.length / 3),
      softLimitTokens: resolveSoftContextLimit(config.model),
      contextWindowTokens: config.contextWindowTokens ?? resolveModelContextWindow(config.model),
      compacted: false,
    })

    const requestBody = {
      model: config.model,
      stream: true as const,
      stream_options: { include_usage: true },
      messages: [{ role: 'user' as const, content: prompt }],
    }
    config.invocationObserver?.({
      transport: 'openai-chat',
      request: {
        endpoint: resolveChatCompletionsEndpoint(config.apiEndpoint),
        body: requestBody,
        credentials: '[redacted]',
      },
    })

    try {
      const finalText = await this.runChatStream(client, requestBody, config, makeBase, controller)
      if (finalText.trim().length > 0) {
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'complete',
          content: finalText,
          provider: 'codex',
          isFinal: true,
          segmentId: `codex-api-${turnId}`,
        })
      }
      this.emit({
        ...makeBase(),
        type: 'agent_status',
        status: 'completed',
      })
    } catch (err) {
      const aborted = controller.signal.aborted
      this.emit({
        ...makeBase(),
        type: 'agent_error',
        code: aborted ? 'CODEX_API_CANCELLED' : 'CODEX_API_ERROR',
        message: aborted
          ? 'Chat Completions run was cancelled'
          : err instanceof Error
            ? err.message
            : String(err),
        retryable: !aborted,
        rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      this.emit({
        ...makeBase(),
        type: 'agent_status',
        status: aborted ? 'cancelled' : 'error',
        message: aborted ? 'Chat Completions cancelled' : 'Chat Completions failed',
      })
      if (!aborted) throw err
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  private async runChatStream(
    client: OpenAI,
    requestBody: {
      model: string
      stream: true
      stream_options: { include_usage: boolean }
      messages: Array<{ role: 'user'; content: string }>
    },
    config: SDKExecutorConfig,
    makeBase: () => EventBase,
    controller: AbortController,
  ): Promise<string> {
    let finalText = ''
    const segmentId = `codex-api-${makeBase().turnId}`
    const stream = await client.chat.completions.create(requestBody, {
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        finalText += delta
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'delta',
          content: delta,
          provider: 'codex',
          isFinal: false,
          segmentId,
        })
      }
      if (chunk.usage != null) {
        this.emit({
          ...makeBase(),
          type: 'usage_update',
          provider: 'codex',
          model: config.model,
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        })
      }
    }
    return finalText
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function buildCodexChatPrompt(userMessage: string, config: SDKExecutorConfig): string {
  const sections = [
    config.skillSystemPrompt != null && config.skillSystemPrompt.trim().length > 0
      ? `# Spark Skills\n${config.skillSystemPrompt}`
      : '',
    config.systemPrompt != null && config.systemPrompt.trim().length > 0
      ? `# Spark Runtime Context\n${config.systemPrompt}`
      : '',
    buildMcpNotice(config.mcpServers),
    buildPromptWithAttachments(userMessage, config.attachments),
  ].filter((section) => section.trim().length > 0)
  return sections.join('\n\n')
}

function buildPromptWithAttachments(
  userMessage: string,
  attachments: SDKTurnAttachment[] | undefined,
): string {
  if (attachments == null || attachments.length === 0) return userMessage
  const lines = attachments.map((attachment, index) => {
    const size = attachment.sizeBytes != null ? `, size=${attachment.sizeBytes} bytes` : ''
    return `${index + 1}. type=${attachment.type}, name=${attachment.name}${size}, path=${attachment.path}`
  })
  const hasDirectory = attachments.some((attachment) => attachment.type === 'directory')
  return [
    userMessage,
    '',
    'User-selected attachments:',
    ...lines,
    '',
    'Use the available context to reason about these files. Direct local file reads are only available through a local CLI or Responses provider.',
    ...(hasDirectory
      ? [
          'Directory attachments are context references: do not claim to have read their contents unless they are included in the prompt.',
        ]
      : []),
  ].join('\n')
}

function buildMcpNotice(mcpServers: SDKExecutorConfig['mcpServers']): string {
  const names = Object.keys(mcpServers ?? {})
  if (names.length === 0) return ''
  return [
    '# MCP Servers',
    'These MCP servers are configured in Spark:',
    ...names.map((name) => `- ${name}`),
    'This Chat Completions provider does not expose the Codex local tool runtime. Do not claim to have called these tools.',
  ].join('\n')
}

function resolveChatCompletionsEndpoint(apiEndpoint: string | undefined): string {
  return `${resolveChatApiBaseUrl(apiEndpoint)}/chat/completions`
}

function resolveChatApiBaseUrl(apiEndpoint: string | undefined): string {
  const base = apiEndpoint?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1'
  if (base.endsWith('/chat/completions')) return base.slice(0, -'/chat/completions'.length)
  if (base.endsWith('/responses')) return base.slice(0, -'/responses'.length)
  return base
}
