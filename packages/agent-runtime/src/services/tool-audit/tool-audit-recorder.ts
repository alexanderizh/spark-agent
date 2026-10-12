/**
 * ToolAuditRecorder —— 工具执行审计账本的唯一写入口（设计方案 §5 采集层）。
 *
 * 三个采集点：
 *   1. 事件漏斗（SessionService.emitAndPersist 内的 tool_call/tool_result，
 *      覆盖全引擎模型路径）；
 *   2. 统一工具目录（UnifiedToolCatalog entry.invoke 包装，覆盖进程内
 *      custom-tool / tool-package / connector 全来源——connector 从此有审计）；
 *   3. MCP 直调（workflow mcp 节点、工具包 mcp-import 内层、工具包测试路径）。
 *
 * 非功能约束（设计 §5.5）：采集点只做脱敏（有界）+ 入队；落库与归档由专职
 * flusher 批量执行；队列有界（满则丢最旧并计数）；审计任何故障都不得冒泡到
 * 工具执行路径。启动时悬挂对账（遗留 running → stale）。
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'
import {
  SessionRepository,
  ToolInvocationRepository,
  type AppendToolLedgerParams,
  type FinishToolInvocationParams,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import {
  archiveAuditedPayload,
  redactToolPayload,
  type AuditedPayload,
} from './tool-audit-payload.js'

const log = createLogger('tool-audit')

/** spark_plugins 桥接服务器给目录工具的前缀（claude/codex/spark 三引擎同口径）。 */
const SPARK_PLUGINS_PREFIX = 'mcp__spark_plugins__'
const SPARK_PLUGINS_SERVER = 'spark_plugins'

export type ToolAuditEngineKind = 'claude' | 'codex' | 'spark'

/** 目录包装层与直调路径共用的归因上下文（ToolProcessInvocationContext 的审计子集）。 */
export interface ToolAuditAttribution {
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  invocationSource: 'model' | 'workflow' | 'test' | 'platform' | 'nested' | 'hook'
  hookId?: string
  hookRunId?: string
  memberAgentId?: string
  dispatchId?: string
  engine?: ToolAuditEngineKind
  /** 调用方对账键（如工具包测试的 correlationId）；缺省用内部行 id。 */
  correlationId?: string
}

export interface ToolAuditToolMeta {
  sourceKind: 'connector' | 'custom-tool' | 'tool-package' | 'mcp'
  sourceId: string
  packageId?: string
  toolId?: string
  toolName: string
  qualifiedName?: string
  version?: string
  adapter?: string
  mcpServerId?: string
}

/** 队列项：append 必须先于对应 finish（FIFO 保序，flusher 逐条处理）。 */
type AuditQueueItem =
  | {
      kind: 'append'
      rowId: string
      params: AppendToolLedgerParams
      redactedInput: unknown
      /** 会话工作区根（载荷归档目标）；未登记的会话为 undefined（跳过归档）。 */
      workspaceRoot: string | undefined
    }
  | {
      kind: 'finish'
      rowId: string
      correlationId: string | undefined
      params: FinishToolInvocationParams
      redactedOutput: unknown
      workspaceRoot: string | undefined
    }

export interface ToolAuditRecorderOptions {
  db: SparkDatabase
  maxQueue?: number
  flushBatchSize?: number
  flushIntervalMs?: number
}

const DEFAULT_MAX_QUEUE = 4096
const DEFAULT_FLUSH_BATCH = 32
const DEFAULT_FLUSH_INTERVAL_MS = 250
/** 有界辅助表（在飞配对 / 引擎归因 / 目录名册）的容量上限：超限逐出最旧键。 */
const BOUNDED_MAP_CAPACITY = 1024

interface PendingFunnelEntry {
  startedAtMs: number
}

export class ToolAuditRecorder {
  private readonly repository: ToolInvocationRepository
  private readonly sessionRepo: SessionRepository
  private readonly maxQueue: number
  private readonly flushBatchSize: number
  private readonly flushIntervalMs: number

  private queue: AuditQueueItem[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private droppedCount = 0
  private rejectedCount = 0
  private lastDroppedLogAt = 0

  /** 事件漏斗在飞配对表：correlationId(toolCallId) → 开始时刻（duration 兜底用）。 */
  private readonly pendingFunnel = new Map<string, PendingFunnelEntry>()
  /** turnId → 引擎归因（4 个 executor 建立点喂入；有界，懒逐出）。 */
  private readonly turnEngines = new Map<string, ToolAuditEngineKind>()
  /** sessionId → 工作区根目录（载荷归档目标；有界，executor 建立点喂入）。 */
  private readonly sessionWorkspaces = new Map<string, string>()
  /** 统一目录合格名名册：事件漏斗的去重依据（目录工具的账本行由包装层负责）。 */
  private readonly catalogQualifiedNames = new Set<string>()

  constructor(options: ToolAuditRecorderOptions) {
    this.repository = new ToolInvocationRepository(options.db)
    this.sessionRepo = new SessionRepository(options.db)
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    // 崩溃恢复：遗留 running 行对账为 stale（设计 §5.4）。
    this.tryRecoverStaleRows()
  }

  // ── 采集点 1：事件漏斗 ─────────────────────────────────────────────────────

  recordEventFunnel(
    sessionId: string,
    turnId: string,
    event:
      | {
          type: 'tool_call'
          toolCallId: string
          toolName: string
          toolInput: Record<string, unknown>
          source: 'builtin' | 'mcp'
          mcpServerId?: string
          timestamp: string
          teamMemberContext?: { memberAgentId?: string; dispatchId?: string }
        }
      | {
          type: 'tool_result'
          toolCallId: string
          toolName: string
          status: 'success' | 'error' | 'denied'
          output?: unknown
          error?: string
          durationMs?: number
          timestamp: string
        },
  ): void {
    try {
      if (event.type === 'tool_call') {
        if (this.isCatalogOwnedTool(event.toolName, event.source, event.mcpServerId)) return
        this.enqueueAppendFromEvent(sessionId, turnId, event)
      } else {
        this.enqueueFinishFromEvent(sessionId, event)
      }
    } catch (error) {
      // 审计故障绝不冒泡到事件管线。
      this.rejectedCount += 1
      log.warn('tool audit funnel capture rejected', {
        sessionId,
        turnId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private enqueueAppendFromEvent(
    sessionId: string,
    turnId: string,
    event: {
      type: 'tool_call'
      toolCallId: string
      toolName: string
      toolInput: Record<string, unknown>
      source: 'builtin' | 'mcp'
      mcpServerId?: string
      timestamp: string
      teamMemberContext?: { memberAgentId?: string; dispatchId?: string }
    },
  ): void {
    const mcpServerId = event.mcpServerId ?? parseMcpServerId(event.toolName)
    const session = this.lookupSession(sessionId)
    const workspaceRoot = this.sessionWorkspaces.get(sessionId)
    const turnEngine = this.turnEngines.get(turnId)
    this.pendingFunnelSet(event.toolCallId, {
      startedAtMs: Date.parse(event.timestamp) || Date.now(),
    })
    this.enqueue({
      kind: 'append',
      rowId: randomUUID(),
      workspaceRoot,
      params: {
        id: randomUUID(),
        correlationId: event.toolCallId,
        sourceKind: event.source === 'mcp' ? 'mcp' : 'sdk-builtin',
        sourceId: event.source === 'mcp' ? (mcpServerId ?? event.toolName) : event.toolName,
        toolName: event.toolName,
        invocationSource: 'model',
        sessionId,
        turnId,
        ...(session?.project_id != null && session.project_id !== ''
          ? { projectId: session.project_id }
          : {}),
        ...(session?.agent_id != null && session.agent_id !== ''
          ? { agentId: session.agent_id }
          : {}),
        ...(mcpServerId != null ? { mcpServerId } : {}),
        ...(turnEngine != null ? { engine: turnEngine } : {}),
        ...(event.teamMemberContext?.memberAgentId != null
          ? { memberAgentId: event.teamMemberContext.memberAgentId }
          : {}),
        ...(event.teamMemberContext?.dispatchId != null
          ? { dispatchId: event.teamMemberContext.dispatchId }
          : {}),
        startedAt: event.timestamp,
      },
      redactedInput: redactToolPayload(event.toolInput),
    })
  }

  private enqueueFinishFromEvent(
    sessionId: string,
    event: {
      type: 'tool_result'
      toolCallId: string
      toolName: string
      status: 'success' | 'error' | 'denied'
      output?: unknown
      error?: string
      durationMs?: number
      timestamp: string
    },
  ): void {
    const pending = this.pendingFunnel.get(event.toolCallId)
    this.pendingFunnel.delete(event.toolCallId)
    const finishedAtMs = Date.parse(event.timestamp) || Date.now()
    const durationMs =
      event.durationMs ??
      (pending != null ? Math.max(0, finishedAtMs - pending.startedAtMs) : undefined)
    this.enqueue({
      kind: 'finish',
      rowId: '',
      correlationId: event.toolCallId,
      workspaceRoot: this.sessionWorkspaces.get(sessionId),
      params: {
        status: event.status === 'success' ? 'ok' : event.status === 'denied' ? 'denied' : 'error',
        ...(event.error != null
          ? { errorMessage: truncateMessage(redactToolPayload(event.error)) }
          : {}),
        ...(durationMs != null ? { durationMs } : {}),
        finishedAt: event.timestamp,
      },
      redactedOutput: event.output === undefined ? null : redactToolPayload(event.output),
    })
  }

  // ── 采集点 2：统一工具目录包装 ─────────────────────────────────────────────

  /** 目录快照登记：喂去重名册（同步生效——事件漏斗在建行判定前就能看到）。 */
  noteCatalogSnapshot(metas: Array<{ qualifiedName: string }>): void {
    try {
      this.catalogQualifiedNames.clear()
      for (const meta of metas) this.catalogQualifiedNames.add(meta.qualifiedName)
    } catch (error) {
      log.warn('tool audit catalog snapshot register failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 目录 invoke 包装：invoke 前 append（真实 started_at，修复 F4 事后补记），
   * invoke 后 finish（ok/error/timeout/denied + 真实 duration）。审计故障时直接
   * 透传原 invoke——账本缺行不阻断工具执行。泛型 T 透传 invoke 返回类型。
   */
  async wrapCatalogInvoke<T>(
    meta: ToolAuditToolMeta,
    attribution: ToolAuditAttribution,
    input: Record<string, unknown>,
    invoke: (input: Record<string, unknown>) => Promise<T>,
  ): Promise<T> {
    const rowId = randomUUID()
    const startedAt = new Date().toISOString()
    const appendParams = this.buildWrappedAppendParams(rowId, meta, attribution, startedAt)
    const workspaceRoot =
      attribution.sessionId != null ? this.sessionWorkspaces.get(attribution.sessionId) : undefined
    this.enqueue({
      kind: 'append',
      rowId,
      workspaceRoot,
      params: appendParams,
      redactedInput: redactToolPayload(input),
    })
    const startedAtMs = Date.now()
    try {
      const output = await invoke(input)
      this.enqueue({
        kind: 'finish',
        rowId,
        correlationId: undefined,
        workspaceRoot,
        params: {
          status: 'ok',
          durationMs: Date.now() - startedAtMs,
        },
        redactedOutput: output === undefined ? null : redactToolPayload(output),
      })
      return output
    } catch (error) {
      const errorCode = toolErrorCode(error)
      this.enqueue({
        kind: 'finish',
        rowId,
        correlationId: undefined,
        workspaceRoot,
        params: {
          status: classifyThrownToolFailure(error),
          ...(errorCode != null ? { errorCode } : {}),
          errorMessage: truncateMessage(
            redactToolPayload(error instanceof Error ? error.message : String(error)),
          ),
          durationMs: Date.now() - startedAtMs,
        },
        redactedOutput: null,
      })
      throw error
    }
  }

  // ── 采集点 3：直调路径（workflow mcp 节点 / 工具包测试 / mcp-import 内层）──

  /** 直调包装：与目录包装同构，供不经事件漏斗的确定性调用路径使用；T 透传 invoke 返回类型。 */
  async wrapDirectInvocation<T>(
    meta: ToolAuditToolMeta,
    attribution: ToolAuditAttribution,
    input: unknown,
    invoke: () => Promise<T>,
  ): Promise<T> {
    return this.wrapCatalogInvoke(meta, attribution, input as Record<string, unknown>, async () =>
      invoke(),
    )
  }

  /**
   * 既有 start/finish 形态调用方的直记入口（tool-package 升级迁移用）：
   * start 在真实 invoke 前调用（真实 started_at），finish 按行 id 收尾。
   * 输入输出过同一脱敏/归档管道。
   */
  recordDirectStart(
    meta: ToolAuditToolMeta,
    attribution: ToolAuditAttribution,
    input: unknown,
  ): string {
    const rowId = randomUUID()
    const workspaceRoot =
      attribution.sessionId != null ? this.sessionWorkspaces.get(attribution.sessionId) : undefined
    this.enqueue({
      kind: 'append',
      rowId,
      workspaceRoot,
      params: this.buildWrappedAppendParams(rowId, meta, attribution, new Date().toISOString()),
      redactedInput: redactToolPayload(input),
    })
    return rowId
  }

  recordDirectFinish(
    rowId: string,
    params: FinishToolInvocationParams,
    output: unknown,
    sessionId?: string,
  ): void {
    this.enqueue({
      kind: 'finish',
      rowId,
      correlationId: undefined,
      workspaceRoot: sessionId != null ? this.sessionWorkspaces.get(sessionId) : undefined,
      params,
      redactedOutput: output === undefined ? null : redactToolPayload(output),
    })
  }

  // ── 归因喂入（SessionService 侧调用） ─────────────────────────────────────

  /** executor 建立点喂入：turn 引擎归因 + 会话工作区根（载荷归档目标）。 */
  noteTurnRuntime(
    sessionId: string,
    turnId: string,
    engine: ToolAuditEngineKind,
    workspaceRoot: string | null | undefined,
  ): void {
    setBounded(this.turnEngines, turnId, engine)
    if (workspaceRoot != null && workspaceRoot !== '') {
      setBounded(this.sessionWorkspaces, sessionId, workspaceRoot)
    }
  }

  // ── flusher ───────────────────────────────────────────────────────────────

  /** 同步排空队列（测试与 dispose 用）。 */
  flushSync(): void {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, Math.max(1, this.flushBatchSize))
      for (const item of batch) this.processItem(item)
    }
    if (this.flushTimer != null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  dispose(): void {
    try {
      this.flushSync()
    } catch (error) {
      log.warn('tool audit final flush failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** 观测指标（P4 治理与日志周期性上报用）。 */
  stats(): { queued: number; droppedCount: number; rejectedCount: number } {
    return {
      queued: this.queue.length,
      droppedCount: this.droppedCount,
      rejectedCount: this.rejectedCount,
    }
  }

  private enqueue(item: AuditQueueItem): void {
    if (this.queue.length >= this.maxQueue) {
      // 有界背压：丢最旧 + 计数（设计 D6：事件真值在 agent_events，审计丢失可降级）。
      this.queue.shift()
      this.droppedCount += 1
      this.reportDroppedThrottled()
    }
    this.queue.push(item)
    if (this.queue.length >= this.flushBatchSize) {
      this.flushBatch()
    } else {
      this.ensureFlushTimer()
    }
  }

  private flushBatch(): void {
    try {
      const batch = this.queue.splice(0, Math.max(1, this.flushBatchSize))
      for (const item of batch) this.processItem(item)
    } catch (error) {
      log.warn('tool audit flush batch failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (this.queue.length > 0) this.ensureFlushTimer()
    }
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer != null) return
    this.flushTimer = setInterval(() => {
      if (this.queue.length === 0) {
        if (this.flushTimer != null) {
          clearInterval(this.flushTimer)
          this.flushTimer = null
        }
        return
      }
      this.flushBatch()
    }, this.flushIntervalMs)
    this.flushTimer.unref?.()
  }

  private processItem(item: AuditQueueItem): void {
    try {
      if (item.kind === 'append') {
        const audited = archiveAuditedPayload(item.redactedInput, item.workspaceRoot)
        this.repository.appendLedger({
          ...item.params,
          ...(audited.sha256 != null ? { inputSha256: audited.sha256 } : {}),
          ...(audited.bytes != null ? { inputBytes: audited.bytes } : {}),
          ...(audited.artifactId != null ? { inputArtifactId: audited.artifactId } : {}),
        })
      } else if (item.rowId !== '') {
        const audited = archiveAuditedPayload(item.redactedOutput, item.workspaceRoot)
        this.repository.finish(item.rowId, {
          ...item.params,
          ...mergeAuditedOutput(audited),
        })
      } else if (item.correlationId != null) {
        const audited = archiveAuditedPayload(item.redactedOutput, item.workspaceRoot)
        this.repository.finalizeByCorrelation(item.correlationId, {
          ...item.params,
          ...mergeAuditedOutput(audited),
        })
      }
    } catch (error) {
      this.rejectedCount += 1
      log.warn('tool audit ledger write rejected', {
        kind: item.kind,
        correlationId:
          item.kind === 'finish' ? (item.correlationId ?? item.rowId) : item.params.correlationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ── 内部辅助 ──────────────────────────────────────────────────────────────

  private buildWrappedAppendParams(
    rowId: string,
    meta: ToolAuditToolMeta,
    attribution: ToolAuditAttribution,
    startedAt: string,
  ): AppendToolLedgerParams {
    // 引擎归因：调用方未显式给时按 turnId 从 executor 建立点喂入的名册补全。
    const engine =
      attribution.engine ??
      (attribution.turnId != null ? this.turnEngines.get(attribution.turnId) : undefined)
    return {
      id: rowId,
      // 对账键优先用调用方 correlationId（如工具包测试 id）；缺省回落内部行 id。
      correlationId: attribution.correlationId ?? rowId,
      sourceKind: meta.sourceKind,
      sourceId: meta.sourceId,
      ...(meta.packageId != null ? { packageId: meta.packageId } : {}),
      ...(meta.toolId != null ? { toolId: meta.toolId } : {}),
      toolName: meta.toolName,
      ...(meta.version != null ? { version: meta.version } : {}),
      ...(meta.adapter != null ? { adapter: meta.adapter } : {}),
      ...(attribution.sessionId != null ? { sessionId: attribution.sessionId } : {}),
      ...(attribution.turnId != null ? { turnId: attribution.turnId } : {}),
      ...(attribution.projectId != null ? { projectId: attribution.projectId } : {}),
      ...(attribution.agentId != null ? { agentId: attribution.agentId } : {}),
      ...(attribution.workflowId != null ? { workflowId: attribution.workflowId } : {}),
      ...(attribution.memberAgentId != null ? { memberAgentId: attribution.memberAgentId } : {}),
      ...(attribution.dispatchId != null ? { dispatchId: attribution.dispatchId } : {}),
      ...(attribution.hookId != null ? { hookId: attribution.hookId } : {}),
      ...(attribution.hookRunId != null ? { hookRunId: attribution.hookRunId } : {}),
      invocationSource: attribution.invocationSource,
      ...(meta.mcpServerId != null ? { mcpServerId: meta.mcpServerId } : {}),
      ...(engine != null ? { engine } : {}),
      startedAt,
    }
  }

  /**
   * 去重判定：目录工具（custom-tool/tool-package/connector）经 spark_plugins 桥接
   * 暴露给引擎，账本行由目录包装层负责——事件漏斗跳过，避免双行。
   */
  private isCatalogOwnedTool(
    toolName: string,
    source: 'builtin' | 'mcp',
    mcpServerId?: string,
  ): boolean {
    if (source !== 'mcp') return false
    if (mcpServerId === SPARK_PLUGINS_SERVER) return true
    if (toolName.startsWith(SPARK_PLUGINS_PREFIX)) {
      const qualified = toolName.slice(SPARK_PLUGINS_PREFIX.length)
      return this.catalogQualifiedNames.has(qualified)
    }
    return false
  }

  private pendingFunnelSet(key: string, entry: PendingFunnelEntry): void {
    setBounded(this.pendingFunnel, key, entry)
  }

  private lookupSession(sessionId: string): { project_id: string; agent_id: string } | null {
    try {
      const row = this.sessionRepo.get(sessionId) as
        | { project_id: string; agent_id: string }
        | undefined
      return row ?? null
    } catch {
      return null
    }
  }

  private tryRecoverStaleRows(): void {
    try {
      this.repository.reconcileStale(new Date().toISOString())
    } catch (error) {
      log.warn('tool audit startup stale reconcile failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private reportDroppedThrottled(): void {
    const now = Date.now()
    if (now - this.lastDroppedLogAt < 60_000) return
    this.lastDroppedLogAt = now
    log.warn('tool audit queue overflow: oldest entries dropped', {
      droppedCount: this.droppedCount,
      maxQueue: this.maxQueue,
    })
  }
}

// ── 纯函数辅助 ───────────────────────────────────────────────────────────────

function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= BOUNDED_MAP_CAPACITY) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

function parseMcpServerId(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined
  const rest = toolName.slice(5)
  const separator = rest.indexOf('__')
  if (separator <= 0) return undefined
  return rest.slice(0, separator)
}

function truncateMessage(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  return text.length > 2000 ? `${text.slice(0, 2000)}…[truncated]` : text
}

function toolErrorCode(error: unknown): string | null {
  if (error == null || typeof error !== 'object') return null
  const candidate = error as { toolCode?: unknown; code?: unknown }
  if (typeof candidate.toolCode === 'string' && candidate.toolCode.length > 0) {
    return candidate.toolCode
  }
  if (typeof candidate.code === 'string' && candidate.code.length > 0) return candidate.code
  return null
}

function classifyThrownToolFailure(error: unknown): 'error' | 'timeout' | 'denied' | 'cancelled' {
  const code = toolErrorCode(error)
  if (code === 'DENIED') return 'denied'
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    const message = error instanceof Error ? error.message : ''
    return /cancel/i.test(message) ? 'cancelled' : 'timeout'
  }
  return 'error'
}

function mergeAuditedOutput(audited: AuditedPayload): Partial<FinishToolInvocationParams> {
  const merged: Partial<FinishToolInvocationParams> = {}
  if (audited.sha256 != null) merged.outputSha256 = audited.sha256
  if (audited.bytes != null) merged.outputBytes = audited.bytes
  if (audited.artifactId != null) merged.outputArtifactId = audited.artifactId
  if (audited.truncated) merged.resultTruncated = true
  return merged
}
