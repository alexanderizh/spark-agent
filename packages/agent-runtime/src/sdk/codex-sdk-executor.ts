import { randomUUID } from 'node:crypto'
import type {
  Codex,
  Thread,
  ThreadEvent,
  ThreadItem,
  Input,
  CodexOptions,
  ThreadOptions,
} from '@openai/codex-sdk'
import type { AgentEvent } from '@spark/protocol'
import { resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import { extractCodexCompactionEvent } from './codex-compaction-event.js'
import { toCodexReasoningEffort } from './reasoning-effort.js'
import type { SDKExecutorConfig, SDKMcpServerConfig, SDKTurnAttachment } from './types.js'

type Listener = (event: AgentEvent) => void
type EventBase = { id: string; sessionId: string; turnId: string; timestamp: string; seq: number }
type CodexSdkModule = typeof import('@openai/codex-sdk')
type CodexThread = Thread
type CodexClient = Codex
type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject
type CodexConfigObject = { [key: string]: CodexConfigValue }
type StreamState = {
  textByItemId: Map<string, string>
  thinkingByItemId: Map<string, string>
  finalText: string
  activeCommandOutputById: Map<string, string>
  emittedToolCalls: Set<string>
}

export class CodexSDKNotAvailableError extends Error {
  constructor(cause?: unknown) {
    super('OpenAI Codex SDK is not installed or could not be loaded')
    this.name = 'CodexSDKNotAvailableError'
    if (cause != null) this.cause = cause
  }
}

let codexSdkLoadPromise: Promise<CodexSdkModule> | null = null

export async function isCodexSDKAvailable(): Promise<boolean> {
  try {
    await loadCodexSdk()
    return true
  } catch {
    return false
  }
}

async function loadCodexSdk(): Promise<CodexSdkModule> {
  codexSdkLoadPromise ??= import('@openai/codex-sdk').catch((err: unknown) => {
    codexSdkLoadPromise = null
    throw new CodexSDKNotAvailableError(err)
  })
  return codexSdkLoadPromise
}

export class CodexSdkExecutor {
  private listeners = new Set<Listener>()
  private abortController: AbortController | null = null
  private thread: CodexThread | null = null

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
    const prompt = buildCodexSdkPrompt(buildCodexGoalPrompt(userMessage, config), config)
    const input = buildCodexSdkInput(prompt, config.attachments)
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
      message: 'OpenAI Codex SDK is running',
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
      const sdk = await loadCodexSdk()
      const codex = new sdk.Codex(buildCodexOptions(config)) as CodexClient
      const thread = config.sdkSessionId != null && config.continueSession === true
        ? codex.resumeThread(config.sdkSessionId, buildThreadOptions(config))
        : codex.startThread(buildThreadOptions(config))
      this.thread = thread

      const state: StreamState = {
        textByItemId: new Map(),
        thinkingByItemId: new Map(),
        finalText: '',
        activeCommandOutputById: new Map(),
        emittedToolCalls: new Set(),
      }
      const streamed = await thread.runStreamed(input, { signal: controller.signal })
      for await (const event of streamed.events) {
        this.dispatchEvent(event, makeBase, config, state)
      }

      if (state.finalText.trim().length > 0) {
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'complete',
          content: state.finalText,
          provider: 'codex',
          isFinal: true,
          segmentId: `codex-sdk-${turnId}`,
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
        code: aborted ? 'CODEX_SDK_CANCELLED' : 'CODEX_SDK_ERROR',
        message: aborted ? 'Codex SDK run was cancelled' : err instanceof Error ? err.message : String(err),
        retryable: !aborted,
        rawError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      this.emit({
        ...makeBase(),
        type: 'agent_status',
        status: aborted ? 'cancelled' : 'error',
        message: aborted ? 'Codex SDK cancelled' : 'Codex SDK failed',
      })
      if (!aborted) throw err
    } finally {
      if (this.abortController === controller) this.abortController = null
      this.thread = null
    }
  }

  private dispatchEvent(
    event: ThreadEvent,
    makeBase: () => EventBase,
    config: SDKExecutorConfig,
    state: StreamState,
  ): void {
    const compactEvent = extractCodexCompactionEvent(
      event as unknown as Record<string, unknown>,
      'codex_sdk',
      makeBase(),
    )
    if (compactEvent != null) {
      this.emit(compactEvent)
      return
    }

    switch (event.type) {
      case 'thread.started':
        this.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'thinking',
          message: `Codex SDK thread started: ${event.thread_id}`,
        })
        return
      case 'turn.started':
        this.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'thinking',
          message: 'Codex SDK turn started',
        })
        return
      case 'turn.completed':
        this.emit({
          ...makeBase(),
          type: 'usage_update',
          provider: 'codex',
          model: config.model,
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
          cacheHitTokens: event.usage.cached_input_tokens,
        })
        return
      case 'turn.failed':
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_SDK_TURN_FAILED',
          message: event.error.message,
          retryable: true,
          rawError: event.error.message,
        })
        return
      case 'error':
        if (isBenignCodexSdkError(event.message)) return
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_SDK_STREAM_ERROR',
          message: event.message,
          retryable: true,
          rawError: event.message,
        })
        return
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.dispatchItemEvent(event.type, event.item, makeBase, state)
        return
    }
  }

  private dispatchItemEvent(
    eventType: 'item.started' | 'item.updated' | 'item.completed',
    item: ThreadItem,
    makeBase: () => EventBase,
    state: StreamState,
  ): void {
    const completed = eventType === 'item.completed'
    switch (item.type) {
      case 'agent_message': {
        const previous = state.textByItemId.get(item.id) ?? ''
        const delta = computeDelta(item.text, previous)
        if (delta.length > 0) {
          this.emit({
            ...makeBase(),
            type: 'assistant_message',
            mode: 'delta',
            content: delta,
            provider: 'codex',
            isFinal: false,
            segmentId: `codex-sdk-${item.id}`,
          })
        }
        state.textByItemId.set(item.id, item.text)
        if (completed) state.finalText = item.text
        return
      }
      case 'reasoning': {
        const previous = state.thinkingByItemId.get(item.id) ?? ''
        const delta = computeDelta(item.text, previous)
        if (delta.length > 0) {
          this.emit({
            ...makeBase(),
            type: 'agent_thinking',
            mode: 'delta',
            content: delta,
            segmentId: `codex-sdk-thinking-${item.id}`,
          })
        }
        state.thinkingByItemId.set(item.id, item.text)
        return
      }
      case 'command_execution':
        this.dispatchCommandItem(item, makeBase, state)
        return
      case 'mcp_tool_call':
        this.dispatchMcpToolItem(item, makeBase, state)
        return
      case 'file_change':
        if (completed && item.status === 'completed') {
          for (const change of item.changes) {
            this.emit({
              ...makeBase(),
              type: 'file_change',
              changeType: mapPatchKind(change.kind),
              path: change.path,
            })
          }
        }
        return
      case 'web_search':
        this.emitToolCallOnce(
          state,
          item.id,
          'web_search',
          { query: item.query },
          'builtin',
          makeBase,
        )
        if (completed) {
          this.emit({
            ...makeBase(),
            type: 'tool_result',
            toolCallId: item.id,
            toolName: 'web_search',
            status: 'success',
            output: { query: item.query },
          })
        }
        return
      case 'todo_list':
        this.emitToolCallOnce(
          state,
          item.id,
          'todo_write',
          { todos: item.items },
          'builtin',
          makeBase,
        )
        this.emit({
          ...makeBase(),
          type: 'tool_result',
          toolCallId: item.id,
          toolName: 'todo_write',
          status: 'success',
          output: { todos: item.items },
        })
        return
      case 'error':
        if (isBenignCodexSdkError(item.message)) return
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_SDK_ITEM_ERROR',
          message: item.message,
          retryable: true,
          rawError: item.message,
        })
        return
    }
  }

  private dispatchCommandItem(
    item: Extract<ThreadItem, { type: 'command_execution' }>,
    makeBase: () => EventBase,
    state: StreamState,
  ): void {
    this.emitToolCallOnce(
      state,
      item.id,
      'bash',
      { command: item.command },
      'builtin',
      makeBase,
    )
    const previousOutput = state.activeCommandOutputById.get(item.id) ?? ''
    const delta = computeDelta(item.aggregated_output, previousOutput)
    if (delta.length > 0) {
      this.emit({
        ...makeBase(),
        type: 'terminal_output',
        toolCallId: item.id,
        stream: 'stdout',
        data: delta,
        isFinal: false,
      })
    }
    state.activeCommandOutputById.set(item.id, item.aggregated_output)
    if (item.status !== 'in_progress') {
      this.emit({
        ...makeBase(),
        type: 'terminal_output',
        toolCallId: item.id,
        stream: 'stdout',
        data: '',
        isFinal: true,
        exitCode: item.exit_code ?? (item.status === 'completed' ? 0 : 1),
      })
      this.emit({
        ...makeBase(),
        type: 'tool_result',
        toolCallId: item.id,
        toolName: 'bash',
        status: item.status === 'completed' ? 'success' : 'error',
        output: item.aggregated_output,
        ...(item.status === 'failed' ? { error: item.aggregated_output || 'Command failed' } : {}),
      })
    }
  }

  private dispatchMcpToolItem(
    item: Extract<ThreadItem, { type: 'mcp_tool_call' }>,
    makeBase: () => EventBase,
    state: StreamState,
  ): void {
    const toolName = `mcp__${item.server}__${item.tool}`
    this.emitToolCallOnce(
      state,
      item.id,
      toolName,
      normalizeToolInput(item.arguments),
      'mcp',
      makeBase,
      item.server,
    )
    if (item.status !== 'in_progress') {
      this.emit({
        ...makeBase(),
        type: 'tool_result',
        toolCallId: item.id,
        toolName,
        status: item.status === 'completed' ? 'success' : 'error',
        ...(item.status === 'completed' ? { output: item.result ?? null } : {}),
        ...(item.status === 'failed' ? { error: item.error?.message ?? 'MCP tool failed' } : {}),
      })
    }
  }

  private emitToolCallOnce(
    state: StreamState,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    source: 'builtin' | 'mcp',
    makeBase: () => EventBase,
    mcpServerId?: string,
  ): void {
    if (state.emittedToolCalls.has(toolCallId)) return
    state.emittedToolCalls.add(toolCallId)
    this.emit({
      ...makeBase(),
      type: 'tool_call',
      toolCallId,
      toolName,
      toolInput,
      source,
      ...(mcpServerId != null ? { mcpServerId } : {}),
    })
    this.emit({
      ...makeBase(),
      type: 'agent_status',
      status: 'calling_tool',
      message: `Calling ${toolName}`,
    })
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function buildCodexOptions(config: SDKExecutorConfig): CodexOptions {
  return {
    apiKey: config.apiKey,
    ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
      ? { baseUrl: config.apiEndpoint.trim().replace(/\/+$/, '') }
      : {}),
    config: buildCodexConfig(config),
    env: stringifyEnv({
      ...process.env,
      ...(config.customEnv ?? {}),
      ...buildCodexMcpEnv(config.mcpServers),
    }),
  }
}

function buildThreadOptions(config: SDKExecutorConfig): ThreadOptions {
  const options: ThreadOptions = {
    model: config.model,
    workingDirectory: config.workspaceRootPath,
    skipGitRepoCheck: true,
  }
  const sandboxMode = mapSandboxMode(config.permissionMode)
  if (sandboxMode != null) options.sandboxMode = sandboxMode
  const approvalPolicy = mapApprovalPolicy(config.permissionMode, config.unattended === true)
  if (approvalPolicy != null) options.approvalPolicy = approvalPolicy
  if (config.reasoningEffort != null) {
    const effort = toCodexReasoningEffort(config.reasoningEffort)
    if (effort != null) options.modelReasoningEffort = effort
  }
  if (config.additionalDirectories != null && config.additionalDirectories.length > 0) {
    options.additionalDirectories = config.additionalDirectories
  }
  return options
}

function buildCodexConfig(config: SDKExecutorConfig): CodexConfigObject {
  return {
    model_reasoning_summary: 'concise',
    hide_agent_reasoning: false,
    ...buildCodexMcpConfig(config.mcpServers),
  }
}

function buildCodexMcpConfig(
  mcpServers: Record<string, SDKMcpServerConfig> | undefined,
): CodexConfigObject {
  const servers: Record<string, CodexConfigObject> = {}
  for (const [rawName, server] of Object.entries(mcpServers ?? {})) {
    if (server.type === 'sdk') continue
    const name = sanitizeConfigKey(rawName)
    const approvalMode = codexDefaultToolsApprovalMode(rawName)
    if (server.url != null) {
      const bearerEnvVar = codexBearerTokenEnvVarName(rawName, server)
      const httpHeaders = codexStaticHttpHeaders(server)
      servers[name] = {
        url: server.url,
        ...(approvalMode != null ? { default_tools_approval_mode: approvalMode } : {}),
        ...(bearerEnvVar != null ? { bearer_token_env_var: bearerEnvVar } : {}),
        ...(Object.keys(httpHeaders).length > 0 ? { http_headers: httpHeaders } : {}),
      }
      continue
    }
    if (server.command == null) continue
    servers[name] = {
      command: server.command,
      ...(approvalMode != null ? { default_tools_approval_mode: approvalMode } : {}),
      ...(server.args != null ? { args: server.args } : {}),
      ...(server.cwd != null ? { cwd: server.cwd } : {}),
      ...(server.env != null ? { env: server.env } : {}),
    }
  }
  return Object.keys(servers).length > 0 ? { mcp_servers: servers } : {}
}

function codexDefaultToolsApprovalMode(rawName: string): 'approve' | null {
  return rawName.startsWith('spark_') ? 'approve' : null
}

function buildCodexMcpEnv(
  mcpServers: Record<string, SDKMcpServerConfig> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [rawName, server] of Object.entries(mcpServers ?? {})) {
    const token = codexBearerToken(server)
    if (token == null) continue
    env[codexBearerTokenEnvVar(rawName)] = token
  }
  return env
}

function codexBearerTokenEnvVarName(
  rawName: string,
  server: SDKMcpServerConfig,
): string | null {
  return codexBearerToken(server) != null ? codexBearerTokenEnvVar(rawName) : null
}

function codexBearerToken(server: SDKMcpServerConfig): string | null {
  const auth = findHeader(server.headers, 'authorization')
  if (auth == null) return null
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return match?.[1]?.trim() || null
}

function codexStaticHttpHeaders(server: SDKMcpServerConfig): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    if (key.toLowerCase() === 'authorization' && /^Bearer\s+/i.test(value.trim())) continue
    out[key] = value
  }
  return out
}

function findHeader(headers: Record<string, string> | undefined, name: string): string | null {
  if (headers == null) return null
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value
  }
  return null
}

function codexBearerTokenEnvVar(rawName: string): string {
  const suffix = rawName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
  return `SPARK_MCP_${suffix.length > 0 ? suffix : 'SERVER'}_BEARER_TOKEN`
}

function mapSandboxMode(mode: SDKExecutorConfig['permissionMode']): ThreadOptions['sandboxMode'] {
  return mode === 'codex-full-access' ? 'danger-full-access' : 'workspace-write'
}

function mapApprovalPolicy(
  mode: SDKExecutorConfig['permissionMode'],
  unattended: boolean,
): ThreadOptions['approvalPolicy'] {
  if (unattended) return 'never'
  switch (mode) {
    case 'codex-full-access':
      return 'never'
    case 'codex-auto-review':
      return 'on-request'
    default:
      return 'on-request'
  }
}

function buildCodexSdkPrompt(userMessage: string, config: SDKExecutorConfig): string {
  const sections = [
    config.skillSystemPrompt != null && config.skillSystemPrompt.trim().length > 0
      ? `# Spark Skills\n${config.skillSystemPrompt}`
      : '',
    config.systemPrompt != null && config.systemPrompt.trim().length > 0
      ? `# Spark Runtime Context\n${config.systemPrompt}`
      : '',
    buildMcpPrompt(config.mcpServers),
    buildPromptWithAttachments(userMessage, config.attachments),
  ].filter((section) => section.trim().length > 0)
  return sections.join('\n\n')
}

function buildCodexSdkInput(
  prompt: string,
  attachments: SDKTurnAttachment[] | undefined,
): Input {
  const images = (attachments ?? []).filter((attachment) => attachment.type === 'image')
  if (images.length === 0) return prompt
  return [
    { type: 'text', text: prompt },
    ...images.map((attachment) => ({ type: 'local_image' as const, path: attachment.path })),
  ]
}

function buildPromptWithAttachments(
  userMessage: string,
  attachments: SDKTurnAttachment[] | undefined,
): string {
  if (attachments == null || attachments.length === 0) return userMessage
  const nonImageAttachments = attachments.filter((attachment) => attachment.type !== 'image')
  if (nonImageAttachments.length === 0) return userMessage
  const lines = nonImageAttachments.map((attachment, index) => {
    const size = attachment.sizeBytes != null ? `, size=${attachment.sizeBytes} bytes` : ''
    return `${index + 1}. type=${attachment.type}, name=${attachment.name}${size}, path=${attachment.path}`
  })
  const hasDirectory = nonImageAttachments.some((attachment) => attachment.type === 'directory')
  return [
    userMessage,
    '',
    'User-selected attachments:',
    ...lines,
    '',
    'Use the available file tools to inspect these file paths when they are relevant.',
    ...(hasDirectory
      ? [
          'Directory attachments are context references: explore them with file tools only when relevant, do not auto-read every file.',
        ]
      : []),
  ].join('\n')
}

function buildMcpPrompt(mcpServers: Record<string, SDKMcpServerConfig> | undefined): string {
  const names = Object.keys(mcpServers ?? {})
  if (names.length === 0) return ''
  return [
    '# MCP Servers',
    'The following MCP servers have been configured for Codex SDK when supported:',
    ...names.map((name) => `- ${name}`),
  ].join('\n')
}

function buildCodexGoalPrompt(userMessage: string, config: SDKExecutorConfig): string {
  const goal = config.goal
  if (goal == null) return userMessage
  if (goal.mode === 'codex-native') {
    if (goal.control === 'pause') return '/goal pause'
    if (goal.control === 'resume') return '/goal resume'
    if (goal.control === 'clear') return '/goal clear'
    return `/goal ${goal.objective}\n\n${userMessage}`
  }
  const progress = goal.progressLog?.slice(-8).map((entry) => `- #${entry.iteration} [${entry.phase}/${entry.status}] ${entry.summary}${entry.nextStep ? ` Next: ${entry.nextStep}` : ''}`).join('\n') || '- No prior progress.'
  return [
    'Spark Goal Loop Contract:',
    `Goal ID: ${goal.id}`,
    `Objective: ${goal.objective}`,
    'Recent progress:',
    progress,
    '',
    userMessage,
    '',
    'End with a fenced spark-goal-status block containing status, phase, summary, evidence, and next_step.',
  ].join('\n')
}

function computeDelta(next: string, prev: string): string {
  if (next.length === 0) return ''
  if (next.startsWith(prev)) return next.slice(prev.length)
  return next
}

function isBenignCodexSdkError(message: string): boolean {
  const isUnsupportedResponsesWebSocket =
    message.includes('unexpected status 404 Not Found: endpoint not supported') &&
    message.includes('/v1/responses') &&
    (
      message.includes('ws://') ||
      message.includes('WebSockets') ||
      message.includes('WebSocket')
    )
  return message.includes('Skill descriptions were shortened to fit the 2% skills context budget') ||
    isUnsupportedResponsesWebSocket
}

function mapPatchKind(kind: 'add' | 'delete' | 'update'): 'create' | 'delete' | 'modify' {
  if (kind === 'add') return 'create'
  if (kind === 'delete') return 'delete'
  return 'modify'
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { input: value }
}

function sanitizeConfigKey(value: string): string {
  const key = value.replace(/[^A-Za-z0-9_-]/g, '_')
  return key.length > 0 ? key : 'server'
}

function stringifyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}
