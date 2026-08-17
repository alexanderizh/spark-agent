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
  private metricsDeliveryScheduled = false

  constructor(private readonly options: TurnRuntimeMetricsTrackerOptions) {
    this.now = options.now ?? (() => performance.now())
    this.schedule = options.schedule ?? ((task) => queueMicrotask(task))
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

    if (!this.firstOutputObserved && isObservableOutput(event)) {
      this.firstOutputObserved = true
      if (this.requestSentAt != null) {
        this.mergePendingMetrics({
          requestToFirstOutputMs: roundedDuration(this.requestSentAt, this.now()),
          firstOutputKind: event.mode,
        })
      }
      this.scheduleSchemaObservation()
      this.scheduleMetricsDelivery()
    }

    if (event.type === 'usage_update') {
      this.mergePendingMetrics({
        providerInputTokens: Math.max(0, event.inputTokens),
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
      this.scheduleSchemaObservation()
      this.scheduleMetricsDelivery()
    }
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
    this.pendingMetrics = {
      ...this.pendingMetrics,
      ...patch,
      ...(patch.toolSchemas != null
        ? {
            toolSchemas: {
              ...this.pendingMetrics.toolSchemas,
              ...patch.toolSchemas,
            },
          }
        : {}),
    }
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

function isTerminalAgentStatus(event: AgentEvent): boolean {
  return (
    event.type === 'agent_status' &&
    (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')
  )
}

function roundedDuration(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round(endedAt - startedAt))
}
