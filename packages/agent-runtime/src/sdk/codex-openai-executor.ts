import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import type { AgentEvent } from '@spark/protocol'
import { resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import type { SDKExecutorConfig, SDKTurnAttachment } from './types.js'

type Listener = (event: AgentEvent) => void
type EventBase = { id: string; sessionId: string; turnId: string; timestamp: string; seq: number }
type ResponsesStreamEvent = {
  type: string
  delta?: unknown
  response?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
    } | null
  }
}

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
    const prompt = buildCodexApiPrompt(userMessage, config)
    const client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
        ? { baseURL: config.apiEndpoint.trim() }
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
      message: config.codexApiKind === 'responses'
        ? 'OpenAI Responses stream is running'
        : 'OpenAI Chat stream is running',
    })
    this.emit({
      ...makeBase(),
      type: 'context_usage',
      estimatedTokens: Math.ceil(prompt.length / 3),
      softLimitTokens: resolveSoftContextLimit(config.model),
      contextWindowTokens: config.contextWindowTokens ?? resolveModelContextWindow(config.model),
      compacted: false,
    })

    try {
      const finalText = config.codexApiKind === 'responses'
        ? await this.runResponsesStream(client, prompt, config, makeBase, controller)
        : await this.runChatStream(client, prompt, config, makeBase, controller)
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
        message: aborted ? 'Codex API run was cancelled' : err instanceof Error ? err.message : String(err),
        retryable: !aborted,
        rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      this.emit({
        ...makeBase(),
        type: 'agent_status',
        status: aborted ? 'cancelled' : 'error',
        message: aborted ? 'Codex API cancelled' : 'Codex API failed',
      })
      if (!aborted) throw err
    } finally {
      if (this.abortController === controller) this.abortController = null
    }
  }

  private async runResponsesStream(
    client: OpenAI,
    prompt: string,
    config: SDKExecutorConfig,
    makeBase: () => EventBase,
    controller: AbortController,
  ): Promise<string> {
    let finalText = ''
    const requestBody = {
      model: config.model,
      input: prompt,
      stream: true,
      ...(config.reasoningEffort != null
        ? { reasoning: { effort: config.reasoningEffort } }
        : {}),
    }
    const stream = await (client.responses.create as unknown as (
      body: typeof requestBody,
      options: { signal: AbortSignal },
    ) => Promise<AsyncIterable<ResponsesStreamEvent>>)(
      requestBody,
      { signal: controller.signal },
    )
    for await (const event of stream) {
      const deltaText = readTextDelta(event.delta)
      if ((event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') && deltaText.length > 0) {
        const delta = deltaText
        finalText += delta
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'delta',
          content: delta,
          provider: 'codex',
          isFinal: false,
          segmentId: `codex-api-${makeBase().turnId}`,
        })
      } else if (isResponsesReasoningDelta(event.type) && deltaText.length > 0) {
        this.emit({
          ...makeBase(),
          type: 'agent_thinking',
          mode: 'delta',
          content: deltaText,
          segmentId: `codex-api-thinking-${makeBase().turnId}`,
        })
      } else if (event.type === 'response.completed') {
        const usage = event.response?.usage
        if (usage != null) {
          this.emit({
            ...makeBase(),
            type: 'usage_update',
            provider: 'codex',
            model: config.model,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          })
        }
      }
    }
    return finalText
  }

  private async runChatStream(
    client: OpenAI,
    prompt: string,
    config: SDKExecutorConfig,
    makeBase: () => EventBase,
    controller: AbortController,
  ): Promise<string> {
    let finalText = ''
    const stream = await client.chat.completions.create(
      {
        model: config.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'user', content: prompt },
        ],
      },
      { signal: controller.signal },
    )
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
          segmentId: `codex-api-${makeBase().turnId}`,
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

function readTextDelta(delta: unknown): string {
  if (typeof delta === 'string') return delta
  if (delta == null || typeof delta !== 'object' || Array.isArray(delta)) return ''
  const record = delta as Record<string, unknown>
  for (const key of ['text', 'content', 'summary']) {
    if (typeof record[key] === 'string') return record[key]
  }
  return ''
}

function isResponsesReasoningDelta(type: string): boolean {
  return type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning_summary.delta'
}

function buildCodexApiPrompt(userMessage: string, config: SDKExecutorConfig): string {
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
    'Use the available context to reason about these files. Direct local file reads are only available through the local CLI adapter.',
    ...(hasDirectory
      ? [
          'Directory attachments are context references: explore them with file tools only when relevant, do not auto-read every file.',
        ]
      : []),
  ].join('\n')
}

function buildMcpNotice(mcpServers: SDKExecutorConfig['mcpServers']): string {
  const names = Object.keys(mcpServers ?? {})
  if (names.length === 0) return ''
  return [
    '# MCP Servers',
    'These MCP servers are enabled in Spark for local agent adapters:',
    ...names.map((name) => `- ${name}`),
    'When using an API-only Codex provider, local stdio MCP execution is not attached to the remote model; use the local Codex CLI provider for live MCP tool calls.',
  ].join('\n')
}
