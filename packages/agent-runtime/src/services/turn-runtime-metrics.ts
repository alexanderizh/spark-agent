import type { AgentEvent, ToolSchemaTokenObservation, TurnRuntimeMetrics } from '@spark/protocol'
import { estimateTokens } from '@spark/shared'
import type { McpToolDefinition } from '../mcp/index.js'

export interface ConnectedMcpToolCatalog {
  serverName: string
  tools: McpToolDefinition[]
}

interface TurnRuntimeMetricsTrackerOptions {
  emit: (metrics: TurnRuntimeMetrics) => void
  now?: () => number
  schedule?: (task: () => void) => void
  /** 轮次终态时回调一次，携带吞吐口径的完整终值（含此前已分批发出的字段）。 */
  onFinalized?: (summary: TurnThroughputSummary) => void
}

/** 终态吞吐摘要：吞吐口径所需的全部观测值（缺测字段保持 absent，不冒充为 0）。 */
export interface TurnThroughputSummary {
  terminalStatus: 'completed' | 'cancelled' | 'error'
  requestToFirstOutputMs?: number
  streamActiveMs?: number
  outputTokens?: number
  outputTokensPerSecond?: number
  turnDurationMs?: number
}

/** Tracks only observable facts; unavailable adapter data remains absent instead of becoming zero. */
export class TurnRuntimeMetricsTracker {
  private readonly now: () => number
  private readonly schedule: (task: () => void) => void
  private requestSentAt: number | null = null
  private mcpConfigurationActiveAt: number | null = null
  private mcpConfigurationElapsedMs = 0
  private mcpConfigurationMeasured = false
  private firstOutputObserved = false
  private mcpReadyObserved = false
  private pendingSchemaObservation: {
    serverNames: string[]
    connectedCatalogs: ConnectedMcpToolCatalog[]
  } | null = null
  private schemaObservationScheduled = false
  private pendingMetrics: TurnRuntimeMetrics = {}
  /** 跨增量批次的全量合并视图（pendingMetrics 交付后即清空，TTFT 等早发字段存这里）。 */
  private mergedMetrics: TurnRuntimeMetrics = {}
  private metricsDeliveryScheduled = false
  /** 轮次启动时刻（tracker 创建即轮次执行开始），终态时结算 turnDurationMs。 */
  private readonly trackerStartedAt: number
  /** 流窗口：首个可观测输出开窗；tool_call / usage_update（消息边界）关窗。 */
  private streamWindowActiveAt: number | null = null
  private streamActiveElapsedMs = 0
  private lastOutputTokens: number | null = null
  private finalized = false
  private ttftMeasured = false

  constructor(private readonly options: TurnRuntimeMetricsTrackerOptions) {
    this.now = options.now ?? (() => performance.now())
    this.schedule = options.schedule ?? ((task) => queueMicrotask(task))
    this.trackerStartedAt = this.now()
  }

  markMcpConfigurationStarted(): void {
    this.mcpConfigurationActiveAt ??= this.now()
  }

  pauseMcpConfiguration(): void {
    if (this.mcpConfigurationActiveAt == null) return
    this.mcpConfigurationElapsedMs += Math.max(0, this.now() - this.mcpConfigurationActiveAt)
    this.mcpConfigurationActiveAt = null
    this.mcpConfigurationMeasured = true
  }

  recordPromptEstimate(sparkPromptEstimatedTokens: number): void {
    this.mergePendingMetrics({
      sparkPromptEstimatedTokens: Math.max(0, sparkPromptEstimatedTokens),
    })
    if (this.firstOutputObserved) this.scheduleMetricsDelivery()
  }

  recordMcpConfiguration(
    serverNames: Iterable<string>,
    connectedCatalogs: ConnectedMcpToolCatalog[],
  ): void {
    this.pauseMcpConfiguration()
    const names = Array.from(new Set(serverNames))
    this.pendingSchemaObservation = { serverNames: names, connectedCatalogs }
    const metrics: TurnRuntimeMetrics = {
      mcpServerCount: names.length,
    }
    if (this.mcpConfigurationMeasured) {
      metrics.mcpConfigurationMs = Math.round(this.mcpConfigurationElapsedMs)
    }
    this.mergePendingMetrics(metrics)
    if (this.firstOutputObserved) {
      this.scheduleSchemaObservation()
      this.scheduleMetricsDelivery()
    }
  }

  markRequestSent(): void {
    this.requestSentAt ??= this.now()
  }

  recordAdapterMetrics(metrics: TurnRuntimeMetrics): void {
    this.mergePendingMetrics(metrics)
    this.scheduleMetricsDelivery()
  }

  observe(event: AgentEvent): void {
    if (
      !this.mcpReadyObserved &&
      event.type === 'agent_status' &&
      event.runtimeInitialization != null
    ) {
      this.mcpReadyObserved = true
      const metrics: TurnRuntimeMetrics = {
        availableToolCount: event.runtimeInitialization.availableToolCount,
        mcpServerCount: event.runtimeInitialization.mcpServerCount,
      }
      if (this.requestSentAt != null) {
        metrics.requestToMcpReadyMs = roundedDuration(this.requestSentAt, this.now())
      }
      this.mergePendingMetrics(metrics)
    }

    if (event.type === 'tool_call') {
      // 工具执行开始 = 模型流式输出暂停；关窗使 tok/s 反映纯生成速度。
      this.closeStreamWindow()
    }

    if (isObservableOutput(event)) {
      this.firstOutputObserved = true
      const eventTime = this.now()
      if (this.requestSentAt != null && !this.ttftMeasured) {
        this.ttftMeasured = true
        this.mergePendingMetrics({
          requestToFirstOutputMs: roundedDuration(this.requestSentAt, eventTime),
          firstOutputKind: event.mode,
        })
      }
      this.streamWindowActiveAt ??= eventTime
      this.scheduleSchemaObservation()
      this.scheduleMetricsDelivery()
    }

    if (event.type === 'usage_update') {
      this.lastOutputTokens = Math.max(0, event.outputTokens)
      // usage_update 出现在消息边界（流已结束、工具/终态将至）：先结算开窗中的
      // 流时长再关窗，随后下发一次 live 口径（outputTokens + streamActiveMs），
      // 供渲染层在轮次进行中显示实时 tok/s。
      this.closeStreamWindow()
      this.mergePendingMetrics({
        providerInputTokens: Math.max(0, event.inputTokens),
        outputTokens: this.lastOutputTokens,
        ...(this.streamActiveElapsedMs > 0
          ? { streamActiveMs: Math.round(this.streamActiveElapsedMs) }
          : {}),
        ...(event.cacheHitTokens != null
          ? { cacheReadTokens: Math.max(0, event.cacheHitTokens) }
          : {}),
        ...(event.cacheWriteTokens != null
          ? { cacheWriteTokens: Math.max(0, event.cacheWriteTokens) }
          : {}),
      })
      if (this.firstOutputObserved) this.scheduleMetricsDelivery()
    }

    if (isTerminalAgentStatus(event)) {
      this.closeStreamWindow()
      this.finalize(event.status)
      this.scheduleSchemaObservation()
      this.scheduleMetricsDelivery()
    }
  }

  private closeStreamWindow(): void {
    if (this.streamWindowActiveAt == null) return
    this.streamActiveElapsedMs += Math.max(0, this.now() - this.streamWindowActiveAt)
    this.streamWindowActiveAt = null
  }

  /** 终态收尾：结算轮次时长与吞吐，只产出可观测字段（无流输出则吞吐缺测）。 */
  private finalize(status: 'completed' | 'cancelled' | 'error'): void {
    if (this.finalized) return
    this.finalized = true
    const turnDurationMs = roundedDuration(this.trackerStartedAt, this.now())
    const metrics: TurnRuntimeMetrics = {
      turnDurationMs,
      turnTerminalStatus: status,
    }
    const summary: TurnThroughputSummary = { terminalStatus: status, turnDurationMs }
    if (this.mergedMetrics.requestToFirstOutputMs != null) {
      summary.requestToFirstOutputMs = this.mergedMetrics.requestToFirstOutputMs
    }
    if (this.streamActiveElapsedMs > 0) {
      metrics.streamActiveMs = Math.round(this.streamActiveElapsedMs)
      summary.streamActiveMs = metrics.streamActiveMs
    }
    if (this.lastOutputTokens != null && this.lastOutputTokens > 0) {
      metrics.outputTokens = this.lastOutputTokens
      summary.outputTokens = this.lastOutputTokens
    }
    if (
      summary.outputTokens != null &&
      summary.streamActiveMs != null &&
      summary.streamActiveMs > 0
    ) {
      summary.outputTokensPerSecond =
        Math.round((summary.outputTokens / summary.streamActiveMs) * 1000 * 10) / 10
      metrics.outputTokensPerSecond = summary.outputTokensPerSecond
    }
    this.mergePendingMetrics(metrics)
    this.options.onFinalized?.(summary)
  }

  private scheduleSchemaObservation(): void {
    if (this.pendingSchemaObservation == null || this.schemaObservationScheduled) return
    this.schemaObservationScheduled = true
    this.schedule(() => {
      this.schemaObservationScheduled = false
      const pending = this.pendingSchemaObservation
      this.pendingSchemaObservation = null
      if (pending == null) return
      this.mergePendingMetrics({
        toolSchemas: {
          declared: measureDeclaredToolSchemas(pending.serverNames, pending.connectedCatalogs),
        },
      })
      this.scheduleMetricsDelivery()
    })
  }

  private mergePendingMetrics(patch: TurnRuntimeMetrics): void {
    const merge = (base: TurnRuntimeMetrics): TurnRuntimeMetrics => ({
      ...base,
      ...patch,
      ...(patch.toolSchemas != null
        ? {
            toolSchemas: {
              ...base.toolSchemas,
              ...patch.toolSchemas,
            },
          }
        : {}),
    })
    this.pendingMetrics = merge(this.pendingMetrics)
    this.mergedMetrics = merge(this.mergedMetrics)
  }

  private scheduleMetricsDelivery(): void {
    if (this.metricsDeliveryScheduled || Object.keys(this.pendingMetrics).length === 0) return
    this.metricsDeliveryScheduled = true
    this.schedule(() => {
      this.metricsDeliveryScheduled = false
      if (Object.keys(this.pendingMetrics).length === 0) return
      const metrics = this.pendingMetrics
      this.pendingMetrics = {}
      this.options.emit(metrics)
    })
  }
}

export function measureDeclaredToolSchemas(
  serverNames: Iterable<string>,
  connectedCatalogs: ConnectedMcpToolCatalog[],
): ToolSchemaTokenObservation {
  const declaredNames = new Set(serverNames)
  const measured = connectedCatalogs.filter((catalog) => declaredNames.has(catalog.serverName))
  const measuredServerCount = new Set(measured.map((catalog) => catalog.serverName)).size
  const serverCount = declaredNames.size
  if (measuredServerCount === 0) {
    return { serverCount, measuredServerCount: 0, coverage: 'unavailable' }
  }

  const tools = measured.flatMap((catalog) => catalog.tools)
  const schemaPayload = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
  return {
    serverCount,
    measuredServerCount,
    toolCount: tools.length,
    estimatedTokens: estimateTokens(JSON.stringify(schemaPayload)),
    coverage: measuredServerCount === serverCount ? 'complete' : 'partial',
  }
}

function isObservableOutput(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'assistant_message' | 'agent_thinking' }> {
  return (
    (event.type === 'assistant_message' || event.type === 'agent_thinking') &&
    event.content.length > 0
  )
}

function isTerminalAgentStatus(event: AgentEvent): event is Extract<
  AgentEvent,
  { type: 'agent_status' }
> & {
  status: 'completed' | 'cancelled' | 'error'
} {
  return (
    event.type === 'agent_status' &&
    (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')
  )
}

function roundedDuration(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round(endedAt - startedAt))
}
