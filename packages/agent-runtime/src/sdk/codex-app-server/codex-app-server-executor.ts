import { randomUUID } from 'node:crypto'
import type { AgentEvent, TurnRuntimeMetrics } from '@spark/protocol'
import { estimateTokens, resolveModelContextWindow, resolveSoftContextLimit } from '@spark/shared'
import { extractCodexCompactionEvent } from '../codex-compaction-event.js'
import { CODEX_CONTEXT_POLICY_CONFIG } from '../codex-context-policy.js'
import { resolveCodexPermissionPolicy } from '../codex-permission-policy.js'
import { toCodexReasoningEffort } from '../reasoning-effort.js'
import { StreamTerminalizer } from '../stream-terminalizer.js'
import type {
  CompactCapableExecutor,
  EngineExecutor,
  SteerCapableExecutor,
} from '../engine-executor.js'
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
import type {
  CodexNativeThreadBinding,
  SDKApprovalResult,
  SDKExecutorConfig,
  SDKPermissionRequestContext,
  SDKTurnAttachment,
} from '../types.js'
import { buildDefaultGitChildEnvironment } from '../../services/git-command.service.js'
import type {
  AppServerThreadParamsBase,
  AppServerTurnStartParams,
  JsonRpcErrorShape,
} from './app-server-protocol.js'
import { CodexAppServerClient } from './codex-app-server-client.js'
import { CodexAppServerRouter, type CodexAppServerRoute } from './codex-app-server-router.js'
import {
  CodexAppServerRuntime,
  createCodexAppServerRuntimeFingerprint,
  createCodexAppServerThreadFingerprint,
} from './codex-app-server-runtime.js'
import {
  CodexAppServerRuntimeSupervisor,
  type CodexRuntimeLease,
} from './codex-runtime-supervisor.js'

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
  /** stdout 解析 / 通知处理链异常的兜底出口（不致命，但不应静默）。 */
  onProtocolError?: ((error: Error) => void) | undefined
  /** 由 EngineRegistry 注入；缺省保持旧的每-turn runtime，便于测试和回滚。 */
  runtimeSupervisor?: CodexAppServerRuntimeSupervisor | undefined
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

function roundedElapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

export class CodexAppServerExecutor
  implements EngineExecutor, SteerCapableExecutor, CompactCapableExecutor
{
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
  /** 交互审批中挂起的 AbortController（cancel/dispose 时统一 abort，杜绝回调悬挂）。 */
  private readonly pendingApprovals = new Set<AbortController>()

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
    // 挂起的交互审批统一 abort：审批实现经 signal 感知取消并释放，回退 deny 响应。
    for (const controller of this.pendingApprovals) controller.abort()
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

  /**
   * 能力：turn 中追加输入（`turn/steer`，P2-2 载具级能力）。
   * 仅在 turn 进行中可用；expectedTurnId 取 turn/start 返回的服务端 turnId，
   * 与协议的前置条件校验对齐（turn 已结束/被中断时请求会被上游拒绝）。
   * 会话层消费（排队语义 vs 注入运行中 turn）属跨引擎产品决策，当前未接线。
   */
  async steer(input: string): Promise<void> {
    const client = this.activeClient
    const threadId = this.activeThreadId
    const expectedTurnId = this.activeServerTurnId
    if (client == null || threadId == null || expectedTurnId == null) {
      throw new Error('no active codex app-server turn to steer')
    }
    await client.request('turn/steer', {
      threadId,
      expectedTurnId,
      input: [{ type: 'text', text: input }],
    })
  }

  /**
   * 能力：主动触发上下文压缩（`thread/compact/start`，P2-2 载具级能力）。
   * 压缩完成经 `thread/compacted` 通知回流（已在通知分发映射为 context_compaction
   * 事件）；Spark 当前无跨引擎主动压缩策略，消费属后续产品决策。
   */
  async compact(): Promise<void> {
    const client = this.activeClient
    const threadId = this.activeThreadId
    if (client == null || threadId == null) {
      throw new Error('no active codex app-server thread to compact')
    }
    await client.request('thread/compact/start', { threadId })
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

    let prepared: {
      client: CodexAppServerClient
      router: CodexAppServerRouter
      lease: CodexRuntimeLease
      threadId: string
      resumedThread: boolean
    } | null = null
    try {
      prepared = await this.prepareSession(sessionId, config)
    } catch (err) {
      if (err instanceof CodexRuntimeNotInstalledError) throw err
    }
    if (prepared == null) {
      await this.runViaFallback(sessionId, turnId, userMessage, config)
      return
    }
    if (this.cancelRequested) {
      // cancel 在握手期间到达：session.service 已补发取消终态，这里静默收尾。
      await prepared.lease.release().catch(() => undefined)
      return
    }

    const { client, router, threadId, resumedThread } = prepared
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

    const promptConfig = resumedThread ? config : withResumeFallbackSystemPrompt(config)
    const prompt = buildCodexSdkPrompt(
      buildCodexGoalPrompt(userMessage, promptConfig),
      promptConfig,
    )
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
    let route: CodexAppServerRoute | null = null
    let invalidateRuntime = false

    try {
      route = router.registerThread(threadId, {
        onNotification: (method, params) => this.dispatchNotification(method, params),
        onServerRequest: (method, params, respond, reject) => {
          this.handleServerRequest(method, params, respond, reject, config)
        },
        onTransportFailure: (error) => this.processFailureResolver?.(error),
      })
      const turnParams: AppServerTurnStartParams = {
        threadId,
        ...(config.clientUserMessageId != null
          ? { clientUserMessageId: config.clientUserMessageId }
          : {}),
        input: [{ type: 'text', text: prompt }],
        ...buildAppServerTurnPermissionParams(config),
      }
      const effort = toCodexReasoningEffort(config.reasoningEffort)
      if (effort != null) turnParams.effort = effort
      config.invocationObserver?.({
        transport: 'codex-app-server',
        request: {
          threadId,
          clientUserMessageId: turnParams.clientUserMessageId ?? null,
          input: turnParams.input,
          effort: turnParams.effort ?? null,
          approvalPolicy: turnParams.approvalPolicy ?? null,
          approvalsReviewer: turnParams.approvalsReviewer ?? null,
          sandboxPolicy: turnParams.sandboxPolicy ?? null,
          threadParams: sanitizeThreadParamsForDiagnostics(this.lastThreadParams),
        },
      })
      const turnStartAt = performance.now()
      let turnResponse: { turn?: { id?: string } }
      try {
        turnResponse = await client.request<{ turn?: { id?: string } }>('turn/start', turnParams)
      } finally {
        const turnStartMs = roundedElapsed(turnStartAt)
        this.options.runtimeSupervisor?.recordTurnStart(turnStartMs, prepared.lease.warm)
        config.runtimeMetricsObserver?.({
          appServerTurnStartMs: turnStartMs,
        })
      }
      const serverTurnId = turnResponse.turn?.id
      if (typeof serverTurnId !== 'string' || serverTurnId.length === 0) {
        throw new Error('codex app-server turn/start returned no turn id')
      }
      this.activeServerTurnId = serverTurnId
      route.bindTurn(serverTurnId)
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
      invalidateRuntime = true
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
      for (const controller of this.pendingApprovals) controller.abort()
      route?.close()
      this.turnResolver = null
      this.processFailureResolver = null
      this.activeConfig = null
      this.activeClient = null
      this.activeThreadId = null
      this.activeServerTurnId = null
      this.currentState = null
      if (this.streamTerminalizer === streamTerminalizer) this.streamTerminalizer = null
      await prepared.lease
        .release({ invalidate: invalidateRuntime || client.hasExited })
        .catch(() => undefined)
    }
  }

  // ── prepare / fallback ────────────────────────────────────────────────────

  private async prepareSession(
    sessionId: string,
    config: SDKExecutorConfig,
  ): Promise<{
    client: CodexAppServerClient
    router: CodexAppServerRouter
    lease: CodexRuntimeLease
    threadId: string
    resumedThread: boolean
  } | null> {
    const prepareStartedAt = performance.now()
    const lifecycleMetrics: TurnRuntimeMetrics = {}
    const publishLifecycleMetrics = (patch: TurnRuntimeMetrics = {}): void => {
      config.runtimeMetricsObserver?.({
        ...lifecycleMetrics,
        ...patch,
        appServerPrepareMs: roundedElapsed(prepareStartedAt),
      })
    }
    let executablePath = this.options.executablePath
    let pathDirs: string[] = []
    if (executablePath == null) {
      const bundled = resolveBundledCodexCli()
      if (bundled == null) {
        // 无受管运行时且未强制要求：回退 Sdk 载具（其内部再尝试 PATH 解析）。
        if (process.env.SPARK_CODEX_REQUIRE_RUNTIME === '1') {
          throw new CodexRuntimeNotInstalledError()
        }
        publishLifecycleMetrics({ appServerFallback: true })
        return null
      }
      executablePath = bundled.executablePath
      pathDirs = bundled.pathDirs
    }
    const env = this.options.env ?? buildAppServerEnv(config, pathDirs)
    const runtimeFingerprint = createCodexAppServerRuntimeFingerprint({
      executablePath,
      args: this.options.args,
      env,
    })
    let lease: CodexRuntimeLease | null = null
    try {
      const createRuntime = () =>
        CodexAppServerRuntime.start({
          executablePath,
          args: this.options.args,
          env,
          clientInfo: APP_SERVER_CLIENT_INFO,
          handshakeTimeoutMs: this.options.handshakeTimeoutMs,
          onProtocolError: this.options.onProtocolError,
        })
      const acquireStartedAt = performance.now()
      if (this.options.runtimeSupervisor != null) {
        const runtimeLeaseKey = config.codexRuntimeLeaseKey?.trim() || sessionId
        lease = await this.options.runtimeSupervisor.acquire(
          runtimeLeaseKey,
          runtimeFingerprint,
          createRuntime,
          { resources: config.codexRuntimeResources },
        )
      } else {
        const runtime = await createRuntime()
        let released = false
        lease = {
          runtime,
          warm: false,
          release: async () => {
            if (released) return
            released = true
            await runtime.dispose()
          },
        }
      }
      lifecycleMetrics.appServerAcquireMs = roundedElapsed(acquireStartedAt)
      lifecycleMetrics.appServerRuntimeWarm = lease.warm
      if (!lease.warm) {
        lifecycleMetrics.appServerSpawnMs = lease.runtime.startupMetrics.spawnMs
        lifecycleMetrics.appServerInitializeMs = lease.runtime.startupMetrics.initializeMs
      }
      const { client, router } = lease.runtime
      const threadParams = buildAppServerThreadParams(config)
      const threadFingerprint = createCodexAppServerThreadFingerprint(threadParams)
      this.lastThreadParams = threadParams
      const bindingKey =
        this.options.runtimeSupervisor != null && config.codexNativeThreadBindingKey != null
          ? config.codexNativeThreadBindingKey.trim()
          : ''
      if (bindingKey.length > 0) {
        const loadedThreadId = lease.runtime.findLoadedThread(bindingKey, threadFingerprint)
        if (loadedThreadId != null) {
          lifecycleMetrics.appServerThreadMode = 'loaded'
          this.options.runtimeSupervisor?.recordThreadMode('loaded')
          publishLifecycleMetrics()
          return {
            client,
            router,
            lease,
            threadId: loadedThreadId,
            resumedThread: true,
          }
        }
      }
      let resumeFailed = false
      const persistedBinding = config.codexNativeThreadBindings?.find(
        (binding) =>
          binding.bindingKey === bindingKey &&
          binding.runtimeFingerprint === runtimeFingerprint &&
          binding.threadFingerprint === threadFingerprint,
      )
      const nativeResumeThreadId =
        bindingKey.length > 0 && persistedBinding != null ? persistedBinding.threadId : null
      const legacyResumeThreadId =
        bindingKey.length === 0 && config.sdkSessionId != null && config.continueSession === true
          ? config.sdkSessionId
          : null
      const resumeThreadId = nativeResumeThreadId ?? legacyResumeThreadId
      if (resumeThreadId != null) {
        const resumeStartedAt = performance.now()
        try {
          const resumed = await client.request<{ thread?: { id?: string } }>(
            'thread/resume',
            { ...threadParams, threadId: resumeThreadId },
            30_000,
          )
          const threadId = resumed.thread?.id
          if (typeof threadId === 'string' && threadId.length > 0) {
            if (bindingKey.length > 0) {
              await this.rememberNativeThreadBinding({
                runtime: lease.runtime,
                config,
                bindingKey,
                threadId,
                runtimeFingerprint,
                threadFingerprint,
                requirePersistence: false,
              })
            }
            lifecycleMetrics.appServerThreadResumeMs = roundedElapsed(resumeStartedAt)
            lifecycleMetrics.appServerThreadMode = 'resume'
            this.options.runtimeSupervisor?.recordThreadMode('resume')
            publishLifecycleMetrics()
            return { client, router, lease, threadId, resumedThread: true }
          }
        } catch {
          lifecycleMetrics.appServerThreadResumeMs = roundedElapsed(resumeStartedAt)
          resumeFailed = true
          // exec 载具对未知 session id 的既有行为是静默新开线程，这里保持等价。
        }
      }
      const threadStartAt = performance.now()
      const started = await client.request<{ thread?: { id?: string } }>(
        'thread/start',
        threadParams,
        30_000,
      )
      const threadId = started.thread?.id
      lifecycleMetrics.appServerThreadStartMs = roundedElapsed(threadStartAt)
      const threadMode = resumeFailed ? 'resume-fallback-start' : 'start'
      lifecycleMetrics.appServerThreadMode = threadMode
      this.options.runtimeSupervisor?.recordThreadMode(threadMode)
      if (typeof threadId !== 'string' || threadId.length === 0) {
        throw new Error('codex app-server thread/start returned no thread id')
      }
      if (bindingKey.length > 0) {
        await this.rememberNativeThreadBinding({
          runtime: lease.runtime,
          config,
          bindingKey,
          threadId,
          runtimeFingerprint,
          threadFingerprint,
          requirePersistence: true,
        })
      }
      publishLifecycleMetrics()
      return { client, router, lease, threadId, resumedThread: false }
    } catch (err) {
      publishLifecycleMetrics({ appServerFallback: true })
      await lease?.release({ invalidate: true }).catch(() => undefined)
      if (err instanceof CodexRuntimeNotInstalledError) throw err
      return null
    }
  }

  private async rememberNativeThreadBinding(params: {
    runtime: CodexAppServerRuntime
    config: SDKExecutorConfig
    bindingKey: string
    threadId: string
    runtimeFingerprint: string
    threadFingerprint: string
    requirePersistence: boolean
  }): Promise<void> {
    params.runtime.rememberLoadedThread(
      params.bindingKey,
      params.threadFingerprint,
      params.threadId,
    )
    const observer = params.config.codexNativeThreadBindingObserver
    if (observer == null) {
      if (params.requirePersistence) {
        throw new Error('fresh codex native thread requires a persistence observer')
      }
      return
    }
    const binding: CodexNativeThreadBinding = {
      bindingKey: params.bindingKey,
      threadId: params.threadId,
      runtimeFingerprint: params.runtimeFingerprint,
      threadFingerprint: params.threadFingerprint,
    }
    try {
      await observer(binding)
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      const failure = new Error(`failed to persist codex native thread binding: ${cause.message}`)
      this.options.onProtocolError?.(failure)
      if (params.requirePersistence) throw failure
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
      await fallback.executeTurn(
        sessionId,
        turnId,
        userMessage,
        withResumeFallbackSystemPrompt(config),
      )
    } finally {
      this.fallbackExecutor = null
      fallback.offEvent(bridge)
    }
  }

  // ── 通知分发（app-server v2 → AgentEvent） ───────────────────────────────

  private dispatchNotification(method: string, params: unknown): void {
    // 无主通知守卫：prepare 阶段（turn 尚未开始）与 turn 收尾后（dispose 有
    // 2s 超时竞态，进程可能仍短暂存活并吐出迟到行）一律丢弃——否则会以
    // 空 sessionId/turnId 产出脏事件（落库 + 迟到 agent_error 干扰会话状态）。
    if (this.activeSessionId == null || this.currentState == null) return
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
              last?: {
                inputTokens?: number
                outputTokens?: number
                cachedInputTokens?: number
                reasoningOutputTokens?: number
              }
            }
          | undefined
        // `total` 是 native thread 跨 turn 的累计值；usage_update 的既有契约是本轮
        // 快照，必须使用 `last`，否则第 N 轮会把前 N-1 轮再次计入审计与成本台账。
        const last = usage?.last
        if (
          last == null ||
          typeof last.inputTokens !== 'number' ||
          typeof last.outputTokens !== 'number'
        ) {
          return
        }
        this.emit({
          type: 'usage_update',
          provider: 'codex',
          model: this.activeConfig?.model ?? '',
          inputTokens: last.inputTokens,
          outputTokens: last.outputTokens,
          cacheHitTokens: typeof last.cachedInputTokens === 'number' ? last.cachedInputTokens : 0,
          reasoningOutputTokens:
            typeof last.reasoningOutputTokens === 'number' ? last.reasoningOutputTokens : 0,
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
          items?: unknown
          message?: string
        }
      | undefined
    if (item == null || typeof item.type !== 'string' || typeof item.id !== 'string') return
    // 注意：每个 emit 独立 makeCurrentBase()——事件 id 是 agent_events 主键，
    // 一次生成多事件复用会触发 UNIQUE constraint failed（生产 0.10.13 崩溃事故）。
    switch (item.type) {
      case 'agentMessage': {
        // completed 的 text 是该条目全文；delta 路径已流式投递过，
        // 这里补 complete（复用当前 raw 段；无 delta 到达时防御性新开段）。
        if (!completed || typeof item.text !== 'string') return
        const activeSegmentId = state.rawTextSegmentId
        // 空完成文本防御：completed text 为空但 delta 已累积时保留流式内容，
        // 否则该段会被空文本覆盖并丢段（final 汇总与渲染 complete 双丢）。
        if (item.text.length === 0 && activeSegmentId == null) return
        const segmentId = activeSegmentId ?? nextTextSegmentId(state, this.requireTurnId())
        const content = item.text.length > 0 ? item.text : state.rawText
        recordCompletedSegment(state, segmentId, content)
        this.emit({
          type: 'assistant_message',
          mode: 'complete',
          content,
          provider: 'codex',
          isFinal: false,
          segmentId,
          ...this.makeCurrentBase(),
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
          ...this.makeCurrentBase(),
        })
        this.emit({
          type: 'tool_result',
          toolCallId: item.id,
          toolName: 'bash',
          status: item.status === 'completed' ? 'success' : 'error',
          output: aggregated,
          ...(item.status !== 'completed' ? { error: aggregated || 'Command failed' } : {}),
          ...this.makeCurrentBase(),
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
          ...this.makeCurrentBase(),
        })
        return
      }
      case 'fileChange': {
        state.toolCalledSinceText = true
        // changes 非数组（server 端形状异常）直接丢弃：for...of 对不可迭代
        // 值会抛 TypeError 并沿通知链穿透成主进程崩溃。
        if (!completed || item.status !== 'completed' || !Array.isArray(item.changes)) return
        for (const change of item.changes) {
          if (change.kind == null || change.path == null) continue
          this.emit({
            type: 'file_change',
            changeType: mapPatchKind(change.kind as 'add' | 'delete' | 'update'),
            path: change.path,
            ...this.makeCurrentBase(),
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
          ...this.makeCurrentBase(),
        })
        return
      }
      case 'todoList': {
        // 对齐 Sdk 载具与方案映射表：todo 更新映射 todo_write 工具对。
        // 每次 todo 版本（started/completed）都带 tool_result（tool_call 去重），
        // 渲染层按 toolCallId 关联最新版本。
        state.toolCalledSinceText = true
        const todos = Array.isArray(item.items) ? item.items : []
        this.emitToolCallOnce(state, item.id, 'todo_write', { todos }, 'builtin')
        this.emit({
          type: 'tool_result',
          toolCallId: item.id,
          toolName: 'todo_write',
          status: 'success',
          output: { todos },
          ...this.makeCurrentBase(),
        })
        return
      }
      case 'error': {
        // 条目级错误（对齐 Sdk 载具 CODEX_SDK_ITEM_ERROR）；良性错误静默。
        const message = typeof item.message === 'string' ? item.message : ''
        if (message.length === 0 || isBenignCodexSdkError(message)) return
        this.emit({
          type: 'agent_error',
          code: 'CODEX_SDK_ITEM_ERROR',
          message,
          retryable: true,
          rawError: message,
          ...this.makeCurrentBase(),
        })
        return
      }
      case 'contextCompaction': {
        if (!completed) return
        const compactEvent = extractCodexCompactionEvent(
          { type: 'contextCompaction' },
          'codex_sdk',
          this.makeCurrentBase(),
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

  /**
   * server→client 审批请求的分流（P2-1 交互审批回路）：
   * - 命令/文件变更类审批且宿主提供 approvalCallback 且非 unattended → 交互回路，
   *   用户决策映射 accept / acceptForSession / deny；
   * - 其余（无回调 / unattended / 权限画像类 / 未知方法）→ 确定性响应兜底，
   *   任何路径都保证 respond 被调用，杜绝上游 turn 挂起。
   */
  private handleServerRequest(
    method: string,
    params: unknown,
    respond: (result: unknown) => void,
    reject: (error: JsonRpcErrorShape) => void,
    config: SDKExecutorConfig,
  ): void {
    // 迟到的审批请求（turn 已收尾 / 握手期到达）：不再打扰审批 UI——
    // 对已死 turn 弹出的审批卡必然作废，直接走确定性响应兜底。
    if (this.activeSessionId == null || this.turnResolver == null) {
      respondToServerRequest(method, params, respond, reject, config)
      return
    }
    const interactive = classifyInteractiveApproval(method, params)
    if (interactive != null && config.approvalCallback != null && config.unattended !== true) {
      void this.resolveInteractiveApproval(interactive, method, params, config)
        .then((decision) => {
          respond({ decision })
        })
        .catch(() => {
          respond({ decision: 'deny' })
        })
      return
    }
    respondToServerRequest(method, params, respond, reject, config)
  }

  private async resolveInteractiveApproval(
    approval: { toolName: string; toolInput: Record<string, unknown> },
    method: string,
    params: unknown,
    config: SDKExecutorConfig,
  ): Promise<'accept' | 'acceptForSession' | 'deny'> {
    const record = (params ?? {}) as Record<string, unknown>
    const controller = new AbortController()
    this.pendingApprovals.add(controller)
    // cancel 后迟到到达的审批请求：不再打扰审批 UI（turn 即将收尾），
    // 直接确定性拒绝，避免用户看到一张必然作废的审批卡。
    if (this.cancelRequested) return 'deny'
    this.emit({
      type: 'agent_status',
      status: 'waiting_permission',
      message: `Waiting for approval: ${approval.toolName}`,
      ...this.makeCurrentBase(),
    })
    try {
      const context: SDKPermissionRequestContext = {
        signal: controller.signal,
        toolUseID: typeof record.itemId === 'string' ? record.itemId : '',
        requestId: `${method}:${randomUUID()}`,
      }
      const raw: boolean | SDKApprovalResult = await config.approvalCallback!(
        this.activeSessionId ?? '',
        approval.toolName,
        approval.toolInput,
        context,
      )
      if (raw === true) return 'accept'
      if (typeof raw === 'object' && raw.allowed === true) {
        return raw.scope != null && raw.scope !== 'once' ? 'acceptForSession' : 'accept'
      }
      return 'deny'
    } finally {
      this.pendingApprovals.delete(controller)
      this.emit({
        type: 'agent_status',
        status: 'thinking',
        message: 'Resuming after approval',
        ...this.makeCurrentBase(),
      })
    }
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
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName,
      toolInput,
      source,
      ...(mcpServerId != null ? { mcpServerId } : {}),
      ...this.makeCurrentBase(),
    })
    this.emit({
      type: 'agent_status',
      status: 'calling_tool',
      message: `Calling ${toolName}`,
      ...this.makeCurrentBase(),
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
  const env = stringifyEnv(
    buildDefaultGitChildEnvironment({
      ...process.env,
      ...(config.codexCliProvider?.env ?? {}),
      ...(config.customEnv ?? {}),
      ...buildCodexMcpEnv(config.mcpServers),
    }),
  )
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
    ...CODEX_CONTEXT_POLICY_CONFIG,
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

/**
 * 权限是官方 `turn/start` 的 sticky turn 级配置：每轮都显式下发，保证用户在 Spark
 * 切换权限后当前 turn 立即生效，同时不必为权限变化丢弃已加载的 native thread。
 * reviewer 必须始终显式给出；否则从 auto_review 切回默认档时会沿用上轮 sticky 值。
 */
function buildAppServerTurnPermissionParams(
  config: SDKExecutorConfig,
): Pick<AppServerTurnStartParams, 'approvalPolicy' | 'approvalsReviewer' | 'sandboxPolicy'> {
  const policy = resolveCodexPermissionPolicy(config.permissionMode, config.unattended === true)
  return {
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer ?? 'user',
    sandboxPolicy:
      policy.sandboxMode === 'danger-full-access'
        ? { type: 'dangerFullAccess' }
        : {
            type: 'workspaceWrite',
            writableRoots: [...(config.additionalDirectories ?? [])],
            networkAccess: config.networkAccessEnabled ?? false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
  }
}

/** native resume 成功时省略备用历史；fresh thread / SDK fallback 才把它并入系统上下文。 */
function withResumeFallbackSystemPrompt(config: SDKExecutorConfig): SDKExecutorConfig {
  const fallback = config.resumeFallbackSystemPrompt?.trim()
  if (fallback == null || fallback.length === 0) return config
  const current = config.systemPrompt?.trim()
  const next: SDKExecutorConfig = { ...config }
  delete next.resumeFallbackSystemPrompt
  next.systemPrompt = current != null && current.length > 0 ? `${current}\n\n${fallback}` : fallback
  return next
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
 * - 其余（含 unattended、无 approvalCallback）：deny——与 exec 载具「无客户端时
 *   升级请求不通过」的可观测效果等价（操作被拒、agent 收到反馈继续）。
 *   交互路径（approvalCallback 可用且非 unattended）在 handleServerRequest 分流。
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

/**
 * 可路由到宿主 approvalCallback 的交互审批（工具语义明确的命令/文件变更类）。
 * 权限画像（item/permissions/requestApproval）与问卷类不在此列，走确定性兜底。
 */
function classifyInteractiveApproval(
  method: string,
  params: unknown,
): { toolName: string; toolInput: Record<string, unknown> } | null {
  const record = (params ?? {}) as Record<string, unknown>
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return {
        toolName: 'bash',
        toolInput: { command: typeof record.command === 'string' ? record.command : '' },
      }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return {
        toolName: 'apply_patch',
        toolInput: {
          ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
          ...(typeof record.itemId === 'string' ? { itemId: record.itemId } : {}),
        },
      }
    default:
      return null
  }
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
