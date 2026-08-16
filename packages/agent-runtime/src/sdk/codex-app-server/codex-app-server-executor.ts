import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'
import { estimateTokens, resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import { extractCodexCompactionEvent } from '../codex-compaction-event.js'
import { resolveCodexPermissionPolicy } from '../codex-permission-policy.js'
import { toCodexReasoningEffort } from '../reasoning-effort.js'
import { StreamTerminalizer } from '../stream-terminalizer.js'
import type { EngineExecutor } from '../engine-executor.js'
import {
  CodexRuntimeNotInstalledError,
  CodexSdkExecutor,
  buildCodexGoalPrompt,
  buildCodexMcpConfig,
  buildCodexMcpEnv,
  buildCodexModelProviderConfig,
  buildCodexSdkPrompt,
  isBenignCodexSdkError,
  prependPathDirs,
  resolveBundledCodexCli,
  stringifyEnv,
} from '../codex-sdk-executor.js'
import type { SDKExecutorConfig, SDKTurnAttachment } from '../types.js'
import type {
  AppServerThreadParamsBase,
  AppServerTurnStartParams,
  JsonRpcErrorShape,
} from './app-server-protocol.js'
import {
  CodexAppServerClient,
  CodexAppServerProcessExitedError,
} from './codex-app-server-client.js'

/**
 * codex 引擎的 app-server 载具（流式修复主路径）。
 *
 * 背景：`codex exec --experimental-json`（Sdk/Cli 载具底层）在协议层面不投递
 * agent 文本增量（生成期间 0 输出，完成后一次性全文），见
 * docs/plans/2026-08-16-codex-app-server-streaming.md。app-server 传输
 * （codex IDE 扩展同款）提供 token 级 `item/agentMessage/delta`，并附带
 * 思考流、`turn/interrupt` 优雅取消与实时用量。
 *
 * 行为契约（与 CodexSdkExecutor 对齐，renderer / session.service 零改动）：
 * - segmentId 沿用 `codex-sdk-{turnId}-text-{N}` / `codex-sdk-thinking-{itemId}` 约定。
 * - 终态只经事件流；取消 emit agent_error(CODEX_SDK_CANCELLED) + agent_status(cancelled)。
 * - prepare 阶段（spawn + initialize + thread 建立）失败时静默回退 CodexSdkExecutor，
 *   事件经 raw bridge 转发——最坏情况等于现状，不存在「比 exec 更差」的结局。
 * - 所有 server→client 审批请求必须确定性响应（Phase 1 无交互 UI：默认拒绝、
 *   bypass 档放行），杜绝 turn 挂起（方案风险项 2）。
 * - resume 语义对齐 exec 现状：`thread/resume` 失败（Spark 侧 hash id 无对应
 *   rollout）时静默 `thread/start`——与 `codex exec resume` 对未知 id 的行为一致。
 */

type Listener = (event: AgentEvent) => void
type EventBase = { id: string; sessionId: string; turnId: string; timestamp: string; seq: number }
type TurnOutcome = { status: 'completed' | 'interrupted' | 'failed'; errorMessage?: string }

/** 测试注入点：替身二进制 / 环境覆盖 / 回退执行器工厂。 */
export interface CodexAppServerExecutorOptions {
  executablePath?: string | undefined
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  /** 默认 `() => new CodexSdkExecutor()`；测试注入 FakeEngineExecutor 验证回退。 */
  createFallback?: (() => EngineExecutor) | undefined
  /** initialize / thread 握手超时（默认 15s）。 */
  handshakeTimeoutMs?: number | undefined
}

/** 单个 turn 的流式累积状态（delta 原生，无需前缀切片推断）。 */
type AppServerStreamState = {
  rawText: string
  rawTextSegmentId: string | null
  textSegmentCounter: number
  completedTextBySegmentId: Map<string, string>
  completedTextOrder: string[]
  toolCalledSinceText: boolean
  emittedToolCalls: Set<string>
}

const INTERRUPT_WATCHDOG_MS = 8_000
const APP_SERVER_CLIENT_INFO = { name: 'spark-agent', version: '1' }

export class CodexAppServerExecutor implements EngineExecutor {
  readonly engine = 'codex' as const

  private readonly listeners = new Set<Listener>()
  private readonly options: CodexAppServerExecutorOptions

  // ── 当前 turn 的运行现场（executeTurn 进入时设置，finally 清空） ──
  private activeSessionId: string | null = null
  private activeSparkTurnId: string | null = null
  private activeConfig: SDKExecutorConfig | null = null
  private activeClient: CodexAppServerClient | null = null
  private activeThreadId: string | null = null
  private activeServerTurnId: string | null = null
  private currentState: AppServerStreamState | null = null
  private streamTerminalizer: StreamTerminalizer | null = null
  private fallbackExecutor: EngineExecutor | null = null
  private turnResolver: ((outcome: TurnOutcome) => void) | null = null
  private processFailureResolver: ((error: Error) => void) | null = null
  private lastThreadParams: AppServerThreadParamsBase | null = null
  private cancelRequested = false
  private interruptWatchdog: NodeJS.Timeout | null = null

  constructor(options: CodexAppServerExecutorOptions = {}) {
    this.options = options
  }

  onEvent(listener: Listener): void {
    this.listeners.add(listener)
  }

  offEvent(listener: Listener): void {
    this.listeners.delete(listener)
  }

  cancel(): void {
    this.cancelRequested = true
    // 回退路径：转发给底层载具，保证 cancel 语义不因回退而丢失。
    if (this.activeClient == null) {
      this.fallbackExecutor?.cancel()
      return
    }
    const client = this.activeClient
    const serverTurnId = this.activeServerTurnId
    if (client.hasExited) return
    if (serverTurnId == null || this.activeThreadId == null) {
      // turn/start 尚未返回：interrupt 无 id 可用，直接杀进程（与 exec abort 等价）。
      client.kill()
      return
    }
    // 优雅中断优先；请求失败（进程僵死/方法不支持）则退回杀进程。
    client
      .request('turn/interrupt', { threadId: this.activeThreadId, turnId: serverTurnId }, 5_000)
      .catch(() => {
        client.kill()
      })
    if (this.interruptWatchdog == null) {
      this.interruptWatchdog = setTimeout(() => {
        if (!client.hasExited) client.kill()
      }, INTERRUPT_WATCHDOG_MS)
      this.interruptWatchdog.unref()
    }
  }

  async executeTurn(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    this.cancelRequested = false
    // 图片附件走 Sdk 载具：app-server 的 UserInput 图片变体（url）与 exec 的
    // local_image（本地路径）语义不同，Phase 1 不冒险，文本 turn 才走流式新路径。
    if (turnHasImageAttachments(config.attachments)) {
      await this.runViaFallback(sessionId, turnId, userMessage, config)
      return
    }

    let prepared: { client: CodexAppServerClient; threadId: string } | null = null
    try {
      prepared = await this.prepareSession(config)
    } catch (err) {
      if (err instanceof CodexRuntimeNotInstalledError) throw err
    }
    if (prepared == null) {
      await this.runViaFallback(sessionId, turnId, userMessage, config)
      return
    }
    if (this.cancelRequested) {
      // cancel 在握手期间到达：session.service 已补发取消终态，这里静默收尾。
      await prepared.client.dispose().catch(() => undefined)
      return
    }

    const { client, threadId } = prepared
    this.activeSessionId = sessionId
    this.activeSparkTurnId = turnId
    this.activeConfig = config
    this.activeClient = client
    this.activeThreadId = threadId
    const state: AppServerStreamState = {
      rawText: '',
      rawTextSegmentId: null,
      textSegmentCounter: 0,
      completedTextBySegmentId: new Map(),
      completedTextOrder: [],
      toolCalledSinceText: false,
      emittedToolCalls: new Set(),
    }
    this.currentState = state
    const streamTerminalizer = new StreamTerminalizer()
    this.streamTerminalizer = streamTerminalizer
    const makeBase = (): EventBase => ({
      id: randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const prompt = buildCodexSdkPrompt(buildCodexGoalPrompt(userMessage, config), config)
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
      message: 'Codex app-server is running',
    })
    this.emit({
      ...makeBase(),
      type: 'context_usage',
      estimatedTokens: estimateTokens(prompt),
      softLimitTokens: resolveSoftContextLimit(config.model),
      contextWindowTokens: config.contextWindowTokens ?? resolveModelContextWindow(config.model),
      compacted: false,
    })

    let turnOutcome: TurnOutcome | null = null
    let processFailure: Error | null = null
    const turnSettled = new Promise<void>((resolve) => {
      this.turnResolver = (outcome) => {
        turnOutcome = outcome
        resolve()
      }
    })
    const processFailed = new Promise<void>((resolve) => {
      this.processFailureResolver = (error) => {
        processFailure = error
        resolve()
      }
    })
    // TS 不跨闭包收窄可变捕获变量——经声明返回类型的读取器取值。
    const readOutcome = (): TurnOutcome | null => turnOutcome
    const readFailure = (): Error | null => processFailure

    try {
      const turnParams: AppServerTurnStartParams = {
        threadId,
        input: [{ type: 'text', text: prompt }],
      }
      const effort = toCodexReasoningEffort(config.reasoningEffort)
      if (effort != null) turnParams.effort = effort
      config.invocationObserver?.({
        transport: 'codex-app-server',
        request: {
          threadId,
          input: turnParams.input,
          effort: turnParams.effort ?? null,
          threadParams: sanitizeThreadParamsForDiagnostics(this.lastThreadParams),
        },
      })
      const turnResponse = await client.request<{ turn?: { id?: string } }>(
        'turn/start',
        turnParams,
      )
      const serverTurnId = turnResponse.turn?.id
      if (typeof serverTurnId === 'string' && serverTurnId.length > 0) {
        this.activeServerTurnId = serverTurnId
      }
      if (this.cancelRequested) {
        // cancel 在 turn/start 返回前到达且尚未拿到 turnId：杀进程，
        // 进程退出会触发 processFailure / pending reject，进入下方取消收尾。
        client.kill()
      }

      await Promise.race([turnSettled, processFailed])

      const failure = readFailure()
      if (failure != null) throw failure
      const outcome = readOutcome()
      if (outcome == null) {
        throw new Error('codex app-server turn ended without a terminal notification')
      }

      if (outcome.status === 'interrupted') {
        for (const event of streamTerminalizer.finalize(makeBase)) this.emit(event)
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_SDK_CANCELLED',
          message: 'Codex app-server turn was interrupted',
          retryable: false,
        })
        this.emit({
          ...makeBase(),
          type: 'agent_status',
          status: 'cancelled',
          message: 'Codex app-server turn interrupted',
        })
        return
      }

      if (outcome.status === 'failed') {
        const message = outcome.errorMessage ?? 'Codex turn failed'
        this.emit({
          ...makeBase(),
          type: 'agent_error',
          code: 'CODEX_SDK_TURN_FAILED',
          message,
          retryable: true,
          rawError: message,
        })
      }

      completeRawTextSegment(state)
      const finalText = getCompletedAssistantText(state)
      if (finalText.trim().length > 0) {
        this.emit({
          ...makeBase(),
          type: 'assistant_message',
          mode: 'complete',
          content: finalText,
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
      const aborted = this.cancelRequested
      for (const event of streamTerminalizer.finalize(makeBase)) this.emit(event)
      this.emit({
        ...makeBase(),
        type: 'agent_error',
        code: aborted ? 'CODEX_SDK_CANCELLED' : 'CODEX_APPSERVER_ERROR',
        message: aborted
          ? 'Codex app-server run was cancelled'
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
        message: aborted ? 'Codex app-server cancelled' : 'Codex app-server failed',
      })
      if (!aborted) throw err
    } finally {
      if (this.interruptWatchdog != null) {
        clearTimeout(this.interruptWatchdog)
        this.interruptWatchdog = null
      }
      this.turnResolver = null
      this.processFailureResolver = null
      this.activeConfig = null
      this.activeClient = null
      this.activeThreadId = null
      this.activeServerTurnId = null
      this.currentState = null
      if (this.streamTerminalizer === streamTerminalizer) this.streamTerminalizer = null
      await client.dispose().catch(() => undefined)
    }
  }

  // ── prepare / fallback ────────────────────────────────────────────────────

  private async prepareSession(
    config: SDKExecutorConfig,
  ): Promise<{ client: CodexAppServerClient; threadId: string } | null> {
    let executablePath = this.options.executablePath
    let pathDirs: string[] = []
    if (executablePath == null) {
      const bundled = resolveBundledCodexCli()
      if (bundled == null) {
        // 无受管运行时且未强制要求：回退 Sdk 载具（其内部再尝试 PATH 解析）。
        if (process.env.SPARK_CODEX_REQUIRE_RUNTIME === '1') {
          throw new CodexRuntimeNotInstalledError()
        }
        return null
      }
      executablePath = bundled.executablePath
      pathDirs = bundled.pathDirs
    }
    const env = this.options.env ?? buildAppServerEnv(config, pathDirs)
    const client = CodexAppServerClient.spawn({
      executablePath,
      args: this.options.args,
      env,
      onNotification: (method, params) => {
        this.dispatchNotification(method, params)
      },
      onServerRequest: (method, params, respond, reject) => {
        respondToServerRequest(method, params, respond, reject, config)
      },
      onExit: (code, signal, stderrTail) => {
        this.processFailureResolver?.(
          new CodexAppServerProcessExitedError(code, signal, stderrTail),
        )
      },
    })
    try {
      await client.initialize(APP_SERVER_CLIENT_INFO, this.options.handshakeTimeoutMs ?? 15_000)
      const threadParams = buildAppServerThreadParams(config)
      this.lastThreadParams = threadParams
      if (config.sdkSessionId != null && config.continueSession === true) {
        try {
          const resumed = await client.request<{ thread?: { id?: string } }>(
            'thread/resume',
            { ...threadParams, threadId: config.sdkSessionId },
            30_000,
          )
          const threadId = resumed.thread?.id
          if (typeof threadId === 'string' && threadId.length > 0) {
            return { client, threadId }
          }
        } catch {
          // exec 载具对未知 session id 的既有行为是静默新开线程，这里保持等价。
        }
      }
      const started = await client.request<{ thread?: { id?: string } }>(
        'thread/start',
        threadParams,
        30_000,
      )
      const threadId = started.thread?.id
      if (typeof threadId !== 'string' || threadId.length === 0) {
        throw new Error('codex app-server thread/start returned no thread id')
      }
      return { client, threadId }
    } catch (err) {
      await client.dispose().catch(() => undefined)
      if (err instanceof CodexRuntimeNotInstalledError) throw err
      return null
    }
  }

  private async runViaFallback(
    sessionId: string,
    turnId: string,
    userMessage: string,
    config: SDKExecutorConfig,
  ): Promise<void> {
    const createFallback = this.options.createFallback ?? (() => new CodexSdkExecutor())
    const fallback = createFallback()
    const bridge = (event: AgentEvent): void => {
      // raw 转发：回退载具自带 StreamTerminalizer，这里不得再套一层。
      for (const listener of this.listeners) listener(event)
    }
    fallback.onEvent(bridge)
    this.fallbackExecutor = fallback
    try {
      await fallback.executeTurn(sessionId, turnId, userMessage, config)
    } finally {
      this.fallbackExecutor = null
      fallback.offEvent(bridge)
    }
  }

  // ── 通知分发（app-server v2 → AgentEvent） ───────────────────────────────

  private dispatchNotification(method: string, params: unknown): void {
    const record = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = readString(record.delta)
        if (delta != null && delta.length > 0) this.emitAgentTextDelta(delta)
        return
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const delta = readString(record.delta)
        const itemId = readString(record.itemId)
        if (delta != null && delta.length > 0 && itemId != null) {
          this.emit({
            type: 'agent_thinking',
            mode: 'delta',
            content: delta,
            segmentId: `codex-sdk-thinking-${itemId}`,
            ...this.makeCurrentBase(),
          })
        }
        return
      }
      case 'item/commandExecution/outputDelta': {
        const delta = readString(record.delta)
        const itemId = readString(record.itemId)
        if (delta != null && delta.length > 0 && itemId != null) {
          this.emit({
            type: 'terminal_output',
            toolCallId: itemId,
            stream: 'stdout',
            data: delta,
            isFinal: false,
            ...this.makeCurrentBase(),
          })
        }
        return
      }
      case 'item/started':
        this.dispatchItemLifecycle(false, record)
        return
      case 'item/completed':
        this.dispatchItemLifecycle(true, record)
        return
      case 'turn/started':
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          message: 'Codex app-server turn started',
          ...this.makeCurrentBase(),
        })
        return
      case 'turn/completed': {
        const turn = (record.turn ?? {}) as {
          status?: string
          error?: { message?: string } | null
        }
        const status =
          turn.status === 'interrupted' || turn.status === 'failed' ? turn.status : 'completed'
        this.turnResolver?.({
          status,
          ...(turn.error?.message != null ? { errorMessage: turn.error.message } : {}),
        })
        return
      }
      case 'error': {
        const message = readNestedMessage(record.error)
        if (message != null && isBenignCodexSdkError(message)) return
        const willRetry = record.willRetry !== false
        this.emit({
          type: 'agent_error',
          code: 'CODEX_SDK_STREAM_ERROR',
          message: message ?? 'codex app-server stream error',
          retryable: willRetry,
          rawError: message ?? 'codex app-server stream error',
          ...this.makeCurrentBase(),
        })
        return
      }
      case 'thread/tokenUsage/updated': {
        const usage = record.tokenUsage as
          | {
              total?: {
                inputTokens?: number
                outputTokens?: number
                cachedInputTokens?: number
                reasoningOutputTokens?: number
              }
            }
          | undefined
        const total = usage?.total
        if (
          total == null ||
          typeof total.inputTokens !== 'number' ||
          typeof total.outputTokens !== 'number'
        ) {
          return
        }
        this.emit({
          type: 'usage_update',
          provider: 'codex',
          model: this.activeConfig?.model ?? '',
          inputTokens: total.inputTokens,
          outputTokens: total.outputTokens,
          cacheHitTokens: typeof total.cachedInputTokens === 'number' ? total.cachedInputTokens : 0,
          reasoningOutputTokens:
            typeof total.reasoningOutputTokens === 'number' ? total.reasoningOutputTokens : 0,
          ...this.makeCurrentBase(),
        })
        return
      }
      case 'thread/compacted': {
        const compactEvent = extractCodexCompactionEvent(
          record,
          'codex_sdk',
          this.makeCurrentBase(),
        )
        if (compactEvent != null) this.emit(compactEvent)
        return
      }
      default:
        // 未消费的通知（fs/changed、account/* 等）静默忽略。
        return
    }
  }

  private dispatchItemLifecycle(completed: boolean, record: Record<string, unknown>): void {
    const state = this.currentState
    if (state == null) return
    const item = record.item as
      | {
          type?: string
          id?: string
          text?: string
          command?: string
          status?: string
          aggregatedOutput?: string | null
          exitCode?: number | null
          server?: string
          tool?: string
          arguments?: unknown
          result?: unknown
          error?: { message?: string } | null
          changes?: Array<{ kind?: string; path?: string }>
          query?: string
        }
      | undefined
    if (item == null || typeof item.type !== 'string' || typeof item.id !== 'string') return
    const base = this.makeCurrentBase()
    switch (item.type) {
      case 'agentMessage': {
        // completed 的 text 是该条目全文；delta 路径已流式投递过，
        // 这里补 complete（复用当前 raw 段；无 delta 到达时防御性新开段）。
        if (!completed || typeof item.text !== 'string') return
        const activeSegmentId = state.rawTextSegmentId
        const segmentId = activeSegmentId ?? nextTextSegmentId(state, this.requireTurnId())
        recordCompletedSegment(state, segmentId, item.text)
        this.emit({
          type: 'assistant_message',
          mode: 'complete',
          content: item.text,
          provider: 'codex',
          isFinal: false,
          segmentId,
          ...base,
        })
        state.rawText = ''
        state.rawTextSegmentId = null
        return
      }
      case 'commandExecution': {
        state.toolCalledSinceText = true
        this.emitToolCallOnce(state, item.id, 'bash', { command: item.command ?? '' }, 'builtin')
        if (!completed) return
        const aggregated = item.aggregatedOutput ?? ''
        this.emit({
          type: 'terminal_output',
          toolCallId: item.id,
          stream: 'stdout',
          data: '',
          isFinal: true,
          exitCode: item.exitCode ?? (item.status === 'completed' ? 0 : 1),
          ...base,
        })
        this.emit({
          type: 'tool_result',
          toolCallId: item.id,
          toolName: 'bash',
          status: item.status === 'completed' ? 'success' : 'error',
          output: aggregated,
          ...(item.status !== 'completed' ? { error: aggregated || 'Command failed' } : {}),
          ...base,
        })
        return
      }
      case 'mcpToolCall': {
        state.toolCalledSinceText = true
        const toolName = `mcp__${item.server ?? 'unknown'}__${item.tool ?? 'unknown'}`
        this.emitToolCallOnce(
          state,
          item.id,
          toolName,
          normalizeToolInput(item.arguments),
          'mcp',
          item.server,
        )
        if (!completed) return
        this.emit({
          type: 'tool_result',
          toolCallId: item.id,
          toolName,
          status: item.status === 'completed' ? 'success' : 'error',
          ...(item.status === 'completed' ? { output: item.result ?? null } : {}),
          ...(item.status === 'failed' ? { error: item.error?.message ?? 'MCP tool failed' } : {}),
          ...base,
        })
        return
      }
      case 'fileChange': {
        state.toolCalledSinceText = true
        if (!completed || item.status !== 'completed' || item.changes == null) return
        for (const change of item.changes) {
          if (change.kind == null || change.path == null) continue
          this.emit({
            type: 'file_change',
            changeType: mapPatchKind(change.kind as 'add' | 'delete' | 'update'),
            path: change.path,
            ...base,
          })
        }
        return
      }
      case 'webSearch': {
        state.toolCalledSinceText = true
        const query = typeof item.query === 'string' ? item.query : ''
        this.emitToolCallOnce(state, item.id, 'web_search', { query }, 'builtin')
        if (!completed) return
        this.emit({
          type: 'tool_result',
          toolCallId: item.id,
          toolName: 'web_search',
          status: 'success',
          output: { query },
          ...base,
        })
        return
      }
      case 'contextCompaction': {
        if (!completed) return
        const compactEvent = extractCodexCompactionEvent(
          { type: 'contextCompaction' },
          'codex_sdk',
          base,
        )
        if (compactEvent != null) this.emit(compactEvent)
        return
      }
      default:
        return
    }
  }

  private emitAgentTextDelta(delta: string): void {
    const state = this.currentState
    if (state == null) return
    if (state.toolCalledSinceText) {
      completeRawTextSegment(state)
      state.rawText = ''
      state.rawTextSegmentId = null
      state.toolCalledSinceText = false
    }
    if (state.rawTextSegmentId == null) {
      state.textSegmentCounter += 1
      state.rawTextSegmentId = `codex-sdk-${this.requireTurnId()}-text-${state.textSegmentCounter}`
    }
    state.rawText += delta
    this.emit({
      type: 'assistant_message',
      mode: 'delta',
      content: delta,
      provider: 'codex',
      isFinal: false,
      segmentId: state.rawTextSegmentId,
      ...this.makeCurrentBase(),
    })
  }

  private emitToolCallOnce(
    state: AppServerStreamState,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    source: 'builtin' | 'mcp',
    mcpServerId?: string,
  ): void {
    if (state.emittedToolCalls.has(toolCallId)) return
    state.emittedToolCalls.add(toolCallId)
    const base = this.makeCurrentBase()
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName,
      toolInput,
      source,
      ...(mcpServerId != null ? { mcpServerId } : {}),
      ...base,
    })
    this.emit({
      type: 'agent_status',
      status: 'calling_tool',
      message: `Calling ${toolName}`,
      ...base,
    })
  }

  private emit(event: AgentEvent): void {
    this.streamTerminalizer?.observe(event)
    for (const listener of this.listeners) listener(event)
  }

  private makeCurrentBase(): EventBase {
    return {
      id: randomUUID(),
      sessionId: this.activeSessionId ?? '',
      turnId: this.activeSparkTurnId ?? '',
      timestamp: new Date().toISOString(),
      seq: 0,
    }
  }

  private requireTurnId(): string {
    return this.activeSparkTurnId ?? 'unknown'
  }
}

// ── 纯函数助手 ─────────────────────────────────────────────────────────────

function buildAppServerEnv(config: SDKExecutorConfig, pathDirs: string[]): Record<string, string> {
  const env = stringifyEnv({
    ...process.env,
    ...(config.codexCliProvider?.env ?? {}),
    ...(config.customEnv ?? {}),
    ...buildCodexMcpEnv(config.mcpServers),
  })
  if (pathDirs.length > 0) prependPathDirs(env, pathDirs)
  if (config.apiKey != null && config.apiKey.length > 0) {
    // 与 @openai/codex-sdk 一致：api key 经 CODEX_API_KEY 传递。
    env.CODEX_API_KEY = config.apiKey
  }
  return env
}

function buildAppServerThreadParams(config: SDKExecutorConfig): AppServerThreadParamsBase {
  const policy = resolveCodexPermissionPolicy(config.permissionMode, config.unattended === true)
  const sandboxWorkspaceWrite: Record<string, unknown> = {
    network_access: config.networkAccessEnabled ?? false,
  }
  if (config.additionalDirectories != null && config.additionalDirectories.length > 0) {
    sandboxWorkspaceWrite.writable_roots = [...config.additionalDirectories]
  }
  const configOverrides: Record<string, unknown> = {
    model_reasoning_summary: 'concise',
    hide_agent_reasoning: false,
    ...(policy.approvalsReviewer == null ? {} : { approvals_reviewer: policy.approvalsReviewer }),
    ...buildCodexModelProviderConfig(config),
    ...buildCodexMcpConfig(config.mcpServers),
    sandbox_workspace_write: sandboxWorkspaceWrite,
    web_search: config.webSearchMode ?? (config.webSearchEnabled === true ? 'live' : 'disabled'),
    ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
      ? { openai_base_url: config.apiEndpoint.trim().replace(/\/+$/, '') }
      : {}),
  }
  return {
    cwd: config.workspaceRootPath,
    model: config.model,
    sandbox: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    ...(policy.approvalsReviewer == null ? {} : { approvalsReviewer: policy.approvalsReviewer }),
    config: configOverrides,
  }
}

function sanitizeThreadParamsForDiagnostics(params: AppServerThreadParamsBase | null): unknown {
  if (params == null) return null
  return {
    cwd: params.cwd,
    model: params.model,
    sandbox: params.sandbox,
    approvalPolicy: params.approvalPolicy,
    config: '[redacted]',
  }
}

/**
 * Phase 1 审批兜底：无交互 UI，全部确定性响应，杜绝挂起。
 * - bypassPermissions / codex-full-access：用户已显式选择放行 → accept。
 * - 其余（含 unattended）：deny——与 exec 载具「无客户端时升级请求不通过」的
 *   可观测效果等价（操作被拒、agent 收到反馈继续），Phase 2 接交互审批回路。
 */
function respondToServerRequest(
  method: string,
  _params: unknown,
  respond: (result: unknown) => void,
  reject: (error: JsonRpcErrorShape) => void,
  config: SDKExecutorConfig,
): void {
  const allow =
    config.permissionMode === 'codex-full-access' || config.permissionMode === 'claude-bypass'
  const decision = allow ? 'accept' : 'deny'
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
    case 'execCommandApproval':
      respond({ decision })
      return
    case 'item/permissions/requestApproval':
      // 附加权限画像（越界写/网络）不按需授予：空 profile = 全部拒绝。
      respond({ permissions: { fileSystem: null, network: null }, scope: 'turn' })
      return
    case 'item/tool/requestUserInput':
      // 无问卷 UI：空答案集 = 全部未回答。
      respond({ answers: {} })
      return
    case 'mcpServer/elicitation/request':
      respond({ action: 'cancel' })
      return
    default:
      // 未知 server 请求：以方法不存在回拒，保证上游尽快失败而不是挂起。
      reject({ code: -32601, message: `spark client does not support ${method}` })
  }
}

function turnHasImageAttachments(attachments: SDKTurnAttachment[] | undefined): boolean {
  return (attachments ?? []).some((attachment) => attachment.type === 'image')
}

function nextTextSegmentId(state: AppServerStreamState, turnId: string): string {
  state.textSegmentCounter += 1
  return `codex-sdk-${turnId}-text-${state.textSegmentCounter}`
}

function recordCompletedSegment(
  state: AppServerStreamState,
  segmentId: string,
  text: string,
): void {
  if (!state.completedTextBySegmentId.has(segmentId)) state.completedTextOrder.push(segmentId)
  state.completedTextBySegmentId.set(segmentId, text)
}

function completeRawTextSegment(state: AppServerStreamState): void {
  const segmentId = state.rawTextSegmentId
  if (segmentId == null || state.rawText.trim().length === 0) return
  recordCompletedSegment(state, segmentId, state.rawText)
}

function getCompletedAssistantText(state: AppServerStreamState): string {
  return state.completedTextOrder
    .map((id) => state.completedTextBySegmentId.get(id) ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
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

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNestedMessage(value: unknown): string | null {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return null
}
