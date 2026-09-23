import { randomUUID } from 'node:crypto'

import type { AgentEvent as SparkAgentEvent } from '@spark/agent'
import type { LlmDelta } from '@spark/agent'
import type { AgentEvent } from '@spark/protocol'
import { resolveSoftContextLimitForWindow } from '@spark/shared'

/**
 * spark-engine 事件/流式 delta → protocol AgentEvent 的逐 turn 映射器。
 *
 * 每 turn 一个实例（executor 每 turn 新建）；维护段（segment）计数与 usage
 * 累计。映射原则：
 * - 流式：onDelta 的 text/thinking 映射为 delta 模式事件，segmentId 按
 *   step（LLM 调用轮次）递增；assistant.completed 发 complete 收口同段文本。
 * - 工具：tool.call / tool.result（账本事件）映射；delta 的 tool_call 忽略
 *   （等待账本事件，避免半成品参数）。
 * - usage：以 assistant.completed 携带的 usage 累计发 UsageUpdateEvent。
 * - 终态：turn.completed/cancelled/failed → agent_status 终态；failed 前置
 *   agent_error。契约要求终态必须出现在事件流上（EngineExecutor 契约第 1 条）。
 * - 压缩：context.compacted → ContextCompactionEvent（phase=completed，M5 接入）。
 */

function formatRetryDelay(delayMs: number): string {
  return delayMs >= 1_000 ? `${(delayMs / 1_000).toFixed(1)}s` : `${delayMs}ms`
}

export interface SparkEventMapperOptions {
  readonly sessionId: string
  readonly turnId: string
  readonly model: string
  /** AssistantMessageEvent.provider / UsageUpdateEvent.provider 用；固定 'spark'。 */
  readonly providerId?: string
  /** 渠道解析出的上下文窗口；用于 context_usage 进度（缺省按 256k 兜底展示）。 */
  readonly contextWindowTokens?: number
}

export class SparkEventMapper {
  readonly #options: SparkEventMapperOptions
  readonly #provider: string
  #segmentCounter = 0
  #currentSegmentId: string | null = null
  /**
   * 本次 LLM 尝试是否已经流出过正文/思考。`retry` delta 带 resetOutput 时，
   * 引擎会丢弃失败尝试的输出并重放请求：必须先把这些段复位，否则失败正文会
   * 与重放正文在同一段里叠加（渲染层只在最终 complete 时才按包含关系收敛）。
   */
  #attemptTextEmitted = false
  #attemptThinkingEmitted = false
  #usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheWriteTokens: 0 }
  readonly #toolNames = new Map<string, string>()

  constructor(options: SparkEventMapperOptions) {
    this.#options = options
    this.#provider = options.providerId ?? 'spark'
  }

  /** spark 账本事件 → protocol 事件（0..n 条）。 */
  mapSparkEvent(event: SparkAgentEvent): AgentEvent[] {
    switch (event.type) {
      case 'turn.queued':
      case 'turn.started':
      case 'session.started':
      case 'step.started':
        // step.started 换段：下一段正文归属新 segmentId。
        if (event.type === 'step.started') {
          this.#segmentCounter += 1
          this.#currentSegmentId = `spark-seg-${this.#segmentCounter}`
          this.#attemptTextEmitted = false
          this.#attemptThinkingEmitted = false
        }
        return event.type === 'step.started' ? [this.#status('thinking')] : []
      case 'assistant.completed': {
        const out: AgentEvent[] = []
        const message = event.message
        const segmentId = this.#currentSegmentId ?? this.#nextFallbackSegment()
        if (typeof message.text === 'string' && message.text.length > 0) {
          out.push(this.#assistantMessage('complete', message.text, segmentId, /* isFinal */ true))
        }
        if (typeof message.thinking === 'string' && message.thinking.length > 0) {
          out.push(this.#agentThinking('complete', message.thinking, segmentId))
        }
        this.#accumulateUsage(event.usage)
        out.push(this.#usageUpdate())
        out.push(this.#contextUsage(event.usage))
        return out
      }
      case 'tool.call':
        this.#toolNames.set(event.callId, event.tool)
        return [
          {
            ...this.#base(),
            type: 'tool_call',
            toolCallId: event.callId,
            toolName: event.tool,
            toolInput: (event.args ?? {}) as Record<string, unknown>,
            source: 'builtin',
          },
        ]
      case 'tool.result': {
        // spark 账本的 tool.result 不携带工具名，从先前 tool.call 记忆补齐。
        const toolName = this.#toolNames.get(event.callId) ?? 'unknown'
        this.#toolNames.delete(event.callId)
        return [
          {
            ...this.#base(),
            type: 'tool_result',
            toolCallId: event.callId,
            toolName,
            status: event.ok ? 'success' : 'error',
            ...(event.ok ? { output: event.content } : { error: event.content.slice(0, 2000) }),
            ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
          },
        ]
      }
      case 'turn.completed':
        return [this.#status('completed')]
      case 'turn.cancelled':
        return [this.#status('cancelled')]
      case 'turn.failed':
        return [
          {
            ...this.#base(),
            type: 'agent_error',
            code: event.error?.code ?? 'spark_turn_failed',
            title: 'Spark 引擎轮次失败',
            message: event.error?.message ?? 'Unknown spark engine failure',
            retryable: event.error?.retryable ?? false,
            // 引擎的 recoveryHint 是「下一步怎么办」的唯一权威来源，透传为
            // actionHint 后错误卡片才能给出可执行建议（否则只剩错误码）。
            ...(event.recoveryHint != null ? { actionHint: event.recoveryHint } : {}),
          },
          this.#status('error'),
        ]
      // M3 接入审批桥后映射为 PermissionRequest/ResponseEvent；此处内部消化。
      case 'permission.requested':
      case 'permission.evaluated':
      case 'permission.decided':
        return []
      // 引擎压缩完成后发账本事件（携带被折叠区间）；映射为压缩卡片（phase=completed）。
      case 'context.compacted':
        return [this.#contextCompacted(event.droppedRanges ?? [])]
      // CLI/TUI 侧事件（log.rewind 等）进程内 SDK 不产生或无需上抛。
      case 'log.rewind':
      case 'plugin.activated':
      case 'plugin.deactivated':
      case 'user.answered':
        return []
      default:
        return []
    }
  }

  /** spark 流式 delta → protocol 事件（0..n 条）。 */
  mapDelta(delta: LlmDelta): AgentEvent[] {
    switch (delta.type) {
      case 'text':
        this.#attemptTextEmitted = true
        return [this.#assistantMessage('delta', delta.text, this.#currentSegmentId ?? undefined)]
      case 'thinking':
        this.#attemptThinkingEmitted = true
        return [this.#agentThinking('delta', delta.text, this.#currentSegmentId ?? undefined)]
      case 'retry':
        return this.#retryEvents(delta)
      case 'tool_call':
      case 'usage':
      case 'continuation':
      case 'heartbeat':
      case 'done':
        return []
      default:
        return []
    }
  }

  /**
   * `retry` delta → 事件序列：
   * - resetOutput=true：先给失败尝试流出过的段发空 complete 复位，再让重放正文
   *   从空串重新累积（渲染层 complete 会覆盖仍处于流式态的段内容）。
   * - 可见性：映射为 runtime_signal(stream_reconnect)。前端按「信号 + 来源」聚合，
   *   多次尝试只保留一行轻量提示并持续刷新进度，不会把会话渲染成红色失败卡片。
   */
  #retryEvents(delta: Extract<LlmDelta, { type: 'retry' }>): AgentEvent[] {
    const events: AgentEvent[] = []
    const segmentId = this.#currentSegmentId ?? undefined
    if (delta.resetOutput) {
      if (this.#attemptTextEmitted) {
        events.push(this.#assistantMessage('complete', '', segmentId, false))
      }
      if (this.#attemptThinkingEmitted) {
        events.push(this.#agentThinking('complete', '', segmentId))
      }
    }
    this.#attemptTextEmitted = false
    this.#attemptThinkingEmitted = false
    events.push({
      ...this.#base(),
      type: 'runtime_signal',
      signal: 'stream_reconnect',
      level: 'info',
      title: '模型调用中断，正在自动重试',
      message: `等待 ${formatRetryDelay(delta.delayMs)} 后重试（第 ${delta.attempt}/${delta.maxRetries} 次）`,
      code: 'SPARK_LLM_RETRY',
      retryable: false,
      details: [
        { label: '重试进度', value: `${delta.attempt}/${delta.maxRetries}` },
        { label: '本次等待', value: formatRetryDelay(delta.delayMs) },
        {
          label: '失败原因',
          value: delta.error.code == null ? delta.error.message : delta.error.code,
        },
      ],
    })
    return events
  }

  #assistantMessage(
    mode: 'delta' | 'complete',
    content: string,
    segmentId: string | undefined,
    isFinal = false,
  ): AgentEvent {
    return {
      ...this.#base(),
      type: 'assistant_message',
      mode,
      content,
      provider: this.#provider,
      isFinal,
      ...(segmentId != null ? { segmentId } : {}),
    }
  }

  #agentThinking(
    mode: 'delta' | 'complete',
    content: string,
    segmentId: string | undefined,
  ): AgentEvent {
    return {
      ...this.#base(),
      type: 'agent_thinking',
      mode,
      content,
      ...(segmentId != null ? { segmentId } : {}),
    }
  }

  #status(status: 'thinking' | 'calling_tool' | 'completed' | 'cancelled' | 'error'): AgentEvent {
    return { ...this.#base(), type: 'agent_status', status }
  }

  #contextCompacted(droppedRanges: ReadonlyArray<readonly [number, number]>): AgentEvent {
    return {
      ...this.#base(),
      type: 'context_compaction',
      provider: 'spark',
      source: 'spark_engine',
      phase: 'completed',
      trigger: 'auto',
      // 引擎未上报压缩前后 token 数；用被折叠的事件区间描述压缩范围供 UI 展示。
      message:
        droppedRanges.length > 0
          ? `已折叠 ${droppedRanges.length} 段历史（${droppedRanges
              .map(([from, to]) => `#${from}-#${to}`)
              .join('、')}）`
          : '已压缩上下文',
      rawType: 'context.compacted',
    }
  }

  #usageUpdate(): AgentEvent {
    return {
      ...this.#base(),
      type: 'usage_update',
      provider: this.#provider,
      model: this.#options.model,
      inputTokens: this.#usage.inputTokens,
      outputTokens: this.#usage.outputTokens,
      cacheHitTokens: this.#usage.cacheHitTokens,
      cacheWriteTokens: this.#usage.cacheWriteTokens,
    }
  }

  /**
   * 步级真实上下文规模：该次 LLM 调用的 inputTokens（含 cache 读写）就是模型
   * 实际看到的 prompt 大小——比 claude 路径的事前字符估算更准，代价是首步
   * 响应到达后才更新进度。引擎自动压缩落地前 compacted 恒为 false。
   */
  #contextUsage(stepUsage: {
    inputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }): AgentEvent {
    const contextWindowTokens =
      this.#options.contextWindowTokens != null && this.#options.contextWindowTokens > 0
        ? this.#options.contextWindowTokens
        : 256_000
    return {
      ...this.#base(),
      type: 'context_usage',
      estimatedTokens:
        stepUsage.inputTokens +
        (stepUsage.cacheReadTokens ?? 0) +
        (stepUsage.cacheWriteTokens ?? 0),
      softLimitTokens: resolveSoftContextLimitForWindow(contextWindowTokens),
      contextWindowTokens,
      compacted: false,
    }
  }

  #accumulateUsage(usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }): void {
    // UsageUpdateEvent 语义为「当前 Turn 累计」；引擎每步的 usage 是该次 LLM 调用
    // 的用量，多步 turn（工具循环）需逐步累加。
    this.#usage.inputTokens += usage.inputTokens
    this.#usage.outputTokens += usage.outputTokens
    this.#usage.cacheHitTokens += usage.cacheReadTokens ?? 0
    this.#usage.cacheWriteTokens += usage.cacheWriteTokens ?? 0
  }

  #nextFallbackSegment(): string {
    this.#segmentCounter += 1
    this.#currentSegmentId = `spark-seg-${this.#segmentCounter}`
    return this.#currentSegmentId
  }

  #base() {
    return {
      id: randomUUID(),
      sessionId: this.#options.sessionId,
      turnId: this.#options.turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    }
  }
}
