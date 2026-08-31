import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import type { AgentEvent } from '@spark/protocol'
import { estimateTokens, resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import type { EngineExecutor } from './engine-executor.js'
import { buildOpenAIChatUserContent, redactOpenAIChatImages } from './openai-chat-image-input.js'
import type { OpenAIChatToolDefinition, SDKExecutorConfig, SDKTurnAttachment } from './types.js'

type Listener = (event: AgentEvent) => void
type EventBase = { id: string; sessionId: string; turnId: string; timestamp: string; seq: number }
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
type ChatRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
type ChatToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
const MAX_TOOL_ROUNDS = 16
const MAX_TOOL_CALLS_PER_RESPONSE = 64
const MAX_TOOL_CALL_ID_BYTES = 512
const MAX_TOOL_NAME_BYTES = 256
const MAX_TOOL_ARGUMENT_BYTES = 1024 * 1024
const MAX_TOOL_RESULT_BYTES = 2 * 1024 * 1024
const MAX_TOOL_RESULT_PREVIEW_BYTES = 64 * 1024
const MAX_TOOL_ERROR_BYTES = 16 * 1024

/**
 * Direct OpenAI-compatible Chat Completions executor.
 *
 * Codex CLI 0.144.5+ removed `wire_api = "chat"`, so Chat providers must not be
 * sent through CodexSdkExecutor (which starts that CLI internally). Responses
 * providers continue to use CodexSdkExecutor and retain the full Codex tool
 * runtime.
 */
export class CodexOpenAIExecutor implements EngineExecutor {
  readonly engine = 'codex' as const

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
      estimatedTokens: estimateTokens(prompt),
      softLimitTokens: resolveSoftContextLimit(config.model),
      contextWindowTokens: config.contextWindowTokens ?? resolveModelContextWindow(config.model),
      compacted: false,
    })

    try {
      const hasImageAttachments = config.attachments?.some(
        (attachment) => attachment.type === 'image',
      )
      const userContent = hasImageAttachments
        ? await buildOpenAIChatUserContent(prompt, config.attachments)
        : prompt
      controller.signal.throwIfAborted()
      const messages: ChatMessage[] = [{ role: 'user', content: userContent }]
      const requestBody: ChatRequest = {
        model: config.model,
        stream: true as const,
        stream_options: { include_usage: true },
        messages,
        ...(config.openAIChatTools != null && config.openAIChatTools.length > 0
          ? {
              tools: config.openAIChatTools.map((tool) => ({
                type: 'function' as const,
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
        ...(config.fastMode === true ? { service_tier: 'fast' as const } : {}),
      }
      config.invocationObserver?.({
        transport: 'openai-chat',
        request: {
          endpoint: resolveChatCompletionsEndpoint(config.apiEndpoint),
          body: { ...requestBody, messages: redactOpenAIChatImages(requestBody.messages) },
          credentials: '[redacted]',
        },
      })
      await this.runChatToolLoop(client, requestBody, config, makeBase, controller)
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

  private async runChatToolLoop(
    client: OpenAI,
    requestBody: ChatRequest,
    config: SDKExecutorConfig,
    makeBase: () => EventBase,
    controller: AbortController,
  ): Promise<void> {
    const tools = new Map((config.openAIChatTools ?? []).map((tool) => [tool.name, tool]))
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.runChatStream(
        client,
        requestBody,
        config,
        makeBase,
        controller,
        round,
      )
      const isFinal = response.toolCalls.length === 0
      if (response.text.trim().length > 0) {
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'complete',
          content: response.text,
          provider: 'codex',
          isFinal,
          segmentId: response.segmentId,
        })
      }
      if (isFinal) return

      requestBody.messages.push({
        role: 'assistant',
        content: response.text || null,
        tool_calls: response.toolCalls,
      })
      for (const toolCall of response.toolCalls) {
        const result = await this.invokeChatTool(toolCall, tools, config, makeBase, controller)
        requestBody.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.providerContent,
        })
      }
    }
    throw new Error(`Chat Completions exceeded ${MAX_TOOL_ROUNDS} tool-call rounds`)
  }

  private async runChatStream(
    client: OpenAI,
    requestBody: ChatRequest,
    config: SDKExecutorConfig,
    makeBase: () => EventBase,
    controller: AbortController,
    round: number,
  ): Promise<{ text: string; toolCalls: ChatToolCall[]; segmentId: string }> {
    let finalText = ''
    const segmentId = `codex-api-${makeBase().turnId}-${round}`
    const calls = new Map<
      number,
      {
        id: string
        name: string
        arguments: string
        idBytes: number
        nameBytes: number
        argumentBytes: number
      }
    >()
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
      for (const toolDelta of chunk.choices[0]?.delta?.tool_calls ?? []) {
        const index = toolDelta.index
        if (!calls.has(index) && calls.size >= MAX_TOOL_CALLS_PER_RESPONSE) {
          throw new Error(
            `Chat Completions returned more than ${MAX_TOOL_CALLS_PER_RESPONSE} tool calls in one response`,
          )
        }
        const current = calls.get(index) ?? {
          id: '',
          name: '',
          arguments: '',
          idBytes: 0,
          nameBytes: 0,
          argumentBytes: 0,
        }
        if (toolDelta.id != null) {
          current.idBytes += Buffer.byteLength(toolDelta.id, 'utf8')
          if (current.idBytes > MAX_TOOL_CALL_ID_BYTES) {
            throw new Error(
              `Chat Completions tool call id exceeded ${MAX_TOOL_CALL_ID_BYTES} bytes`,
            )
          }
          current.id += toolDelta.id
        }
        if (toolDelta.function?.name != null) {
          current.nameBytes += Buffer.byteLength(toolDelta.function.name, 'utf8')
          if (current.nameBytes > MAX_TOOL_NAME_BYTES) {
            throw new Error(`Chat Completions tool name exceeded ${MAX_TOOL_NAME_BYTES} bytes`)
          }
          current.name += toolDelta.function.name
        }
        if (toolDelta.function?.arguments != null) {
          current.argumentBytes += Buffer.byteLength(toolDelta.function.arguments, 'utf8')
          if (current.argumentBytes > MAX_TOOL_ARGUMENT_BYTES) {
            throw new Error(
              `Chat Completions tool arguments exceeded ${MAX_TOOL_ARGUMENT_BYTES} bytes`,
            )
          }
          current.arguments += toolDelta.function.arguments
        }
        calls.set(index, current)
      }
      if (chunk.usage != null) {
        // OpenAI 口径：prompt_tokens 已包含 cached_tokens（cached 是其子集）。
        // cacheHitTokens 直接透传，命中率由展示层按 provider 口径计算。
        const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens
        this.emit({
          ...makeBase(),
          type: 'usage_update',
          provider: 'codex',
          model: config.model,
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          ...(cachedTokens != null ? { cacheHitTokens: cachedTokens } : {}),
        })
      }
    }
    const toolCalls = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => ({
        id: call.id || `chat-tool-${round}-${index}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments || '{}' },
      }))
    return { text: finalText, toolCalls, segmentId }
  }

  private async invokeChatTool(
    toolCall: ChatToolCall,
    tools: Map<string, OpenAIChatToolDefinition>,
    config: SDKExecutorConfig,
    makeBase: () => EventBase,
    controller: AbortController,
  ): Promise<{ providerContent: string }> {
    const tool = tools.get(toolCall.function.name)
    let input: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(toolCall.function.arguments) as unknown
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Tool arguments must be a JSON object')
      }
      input = parsed as Record<string, unknown>
    } catch (error) {
      const message = boundedToolError(
        `Invalid tool arguments: ${error instanceof Error ? error.message : String(error)}`,
      )
      this.emitToolCall(makeBase, toolCall, input)
      this.emitToolResult(makeBase, toolCall, 'error', undefined, message, 0)
      return { providerContent: serializeToolError(message) }
    }
    this.emitToolCall(makeBase, toolCall, input)
    if (tool == null) {
      const message = boundedToolError(`Unknown Chat Completions tool: ${toolCall.function.name}`)
      this.emitToolResult(makeBase, toolCall, 'error', undefined, message, 0)
      return { providerContent: serializeToolError(message) }
    }
    if (tool.risk !== 'read') {
      if (config.unattended === true || config.approvalCallback == null) {
        const message = 'Write-capable Chat Completions tool requires interactive approval'
        this.emitToolResult(makeBase, toolCall, 'denied', undefined, message, 0)
        return { providerContent: serializeToolError(message) }
      }
      let approved: Awaited<ReturnType<NonNullable<SDKExecutorConfig['approvalCallback']>>>
      try {
        approved = await config.approvalCallback(makeBase().sessionId, tool.name, input, {
          signal: controller.signal,
          toolUseID: toolCall.id,
          requestId: toolCall.id,
          title: tool.name,
          description: tool.description,
        })
      } catch (error) {
        if (controller.signal.aborted) throw error
        const message = 'Tool approval could not be completed; the tool call was denied'
        this.emitToolResult(makeBase, toolCall, 'denied', undefined, message, 0)
        return { providerContent: serializeToolError(message) }
      }
      const allowed = typeof approved === 'boolean' ? approved : approved.allowed
      if (!allowed) {
        const message = 'User denied the tool call'
        this.emitToolResult(makeBase, toolCall, 'denied', undefined, message, 0)
        return { providerContent: serializeToolError(message) }
      }
    }
    const startedAt = Date.now()
    try {
      const output = await tool.invoke(input)
      const prepared = prepareToolSuccess(output)
      this.emitToolResult(
        makeBase,
        toolCall,
        'success',
        prepared.eventOutput,
        undefined,
        Date.now() - startedAt,
      )
      return { providerContent: prepared.providerContent }
    } catch (error) {
      const message = boundedToolError(error instanceof Error ? error.message : String(error))
      this.emitToolResult(makeBase, toolCall, 'error', undefined, message, Date.now() - startedAt)
      return { providerContent: serializeToolError(message) }
    }
  }

  private emitToolCall(
    makeBase: () => EventBase,
    toolCall: ChatToolCall,
    input: Record<string, unknown>,
  ): void {
    this.emit({
      ...makeBase(),
      type: 'tool_call',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      toolInput: input,
      source: 'builtin',
    })
  }

  private emitToolResult(
    makeBase: () => EventBase,
    toolCall: ChatToolCall,
    status: 'success' | 'error' | 'denied',
    output?: unknown,
    error?: string,
    durationMs?: number,
  ): void {
    this.emit({
      ...makeBase(),
      type: 'tool_result',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      status,
      ...(output !== undefined ? { output } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    })
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

interface TruncatedToolResult {
  truncated: true
  originalBytes: number
  preview: string
}

function prepareToolSuccess(output: unknown): {
  providerContent: string
  eventOutput: unknown
} {
  const serializedOutput = JSON.stringify(output) ?? 'null'
  const normalizedOutput = JSON.parse(serializedOutput) as unknown
  const providerContent = JSON.stringify({ result: normalizedOutput })
  if (Buffer.byteLength(providerContent, 'utf8') <= MAX_TOOL_RESULT_BYTES) {
    return { providerContent, eventOutput: normalizedOutput }
  }
  const truncated: TruncatedToolResult = {
    truncated: true,
    originalBytes: Buffer.byteLength(serializedOutput, 'utf8'),
    preview: truncateUtf8(serializedOutput, MAX_TOOL_RESULT_PREVIEW_BYTES),
  }
  return {
    providerContent: JSON.stringify({ result: truncated }),
    eventOutput: truncated,
  }
}

function serializeToolError(message: string): string {
  return JSON.stringify({ error: boundedToolError(message) })
}

function boundedToolError(message: string): string {
  if (Buffer.byteLength(message, 'utf8') <= MAX_TOOL_ERROR_BYTES) return message
  const marker = '\n[truncated by Spark runtime]'
  return `${truncateUtf8(
    message,
    MAX_TOOL_ERROR_BYTES - Buffer.byteLength(marker, 'utf8'),
  )}${marker}`
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  return bytes
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/, '')
}

function buildCodexChatPrompt(userMessage: string, config: SDKExecutorConfig): string {
  // 段序与 buildCompositeSystemPrompt 同原则：稳定段在前、易变段在后。
  // skill 段（技能目录/媒体路由，随配置变化）排在 runtime 主上下文之后，
  // 变化时只废其后前缀，不废其前。
  const sections = [
    config.systemPrompt != null && config.systemPrompt.trim().length > 0
      ? `# Spark Runtime Context\n${config.systemPrompt}`
      : '',
    config.skillSystemPrompt != null && config.skillSystemPrompt.trim().length > 0
      ? `# Spark Skills\n${config.skillSystemPrompt}`
      : '',
    buildMcpNotice(config.mcpServers),
    buildPromptWithAttachments(
      userMessage,
      config.attachments?.filter((attachment) => attachment.type !== 'image'),
    ),
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
