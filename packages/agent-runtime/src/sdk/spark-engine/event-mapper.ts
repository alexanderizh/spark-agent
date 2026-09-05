import { randomUUID } from 'node:crypto'

import type { AgentEvent as SparkAgentEvent } from '@spark/agent'
import type { LlmDelta } from '@spark/agent'
import type { AgentEvent } from '@spark/protocol'

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
 * - M3 待接：permission.requested/decided → PermissionRequest/ResponseEvent；
 *   context.compacted → ContextCompactionEvent（首版不发）。
 */

export interface SparkEventMapperOptions {
  readonly sessionId: string
  readonly turnId: string
  readonly model: string
  /** AssistantMessageEvent.provider / UsageUpdateEvent.provider 用；固定 'spark'。 */
  readonly providerId?: string
}

export class SparkEventMapper {
  readonly #options: SparkEventMapperOptions
  readonly #provider: string
  #segmentCounter = 0
  #currentSegmentId: string | null = null
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
          },
          this.#status('error'),
        ]
      // M3 接入审批桥后映射为 PermissionRequest/ResponseEvent；此处内部消化。
      case 'permission.requested':
      case 'permission.evaluated':
      case 'permission.decided':
        return []
      // 首版不映射（引擎侧压缩通知，M5 评估接 ContextCompactionEvent）。
      // CLI/TUI 侧事件（log.rewind 等）进程内 SDK 不产生或无需上抛。
      case 'context.compacted':
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
        return [this.#assistantMessage('delta', delta.text, this.#currentSegmentId ?? undefined)]
      case 'thinking':
        return [this.#agentThinking('delta', delta.text, this.#currentSegmentId ?? undefined)]
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
