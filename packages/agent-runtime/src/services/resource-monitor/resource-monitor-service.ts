/**
 * @module resource-monitor/resource-monitor-service
 *
 * ResourceMonitorService —— 资源监控编排层（性能监控体系 M1 核心）。
 *
 * 职责：按配置周期采样（宿主/子进程/系统内存/事件循环）→ 派生指标 →
 * 压力判定（逐指标最低水位 + 滞回状态机）→ 级别变更事件（持久化 +
 * stream 推送 + 联动回调）→ 历史环形缓冲 + 订阅节流推送。
 *
 * 设计约束：
 *  - 零 electron 依赖：推流/联动全部经回调注入（桌面装配层桥接
 *    broadcastToAppWindows / governor.setPressureLevel）。
 *  - 监控失败绝不影响应用：tick 全程 try-catch，采集失败指数退避
 *    （上限 60s）+ staleFields 标记，服务异常只降级不外抛。
 *  - 采集自身不能成为压力源：外部命令单次批量，子进程按 cadence 采集
 *    （nominal 慢周期，≥warning 每 tick）。
 */

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { createLogger } from '@spark/shared'
import type { ResourcePressureEventRow, SparkDatabase } from '@spark/storage'
import { ResourcePressureRepository } from '@spark/storage'
import type {
  ChildrenProcessSummary,
  EventLoopDelaySummary,
  HostProcessSummary,
  HostSpecBaseline,
  PressureIndicatorKey,
  PressureLevel,
  ResourceMetricsHistoryPoint,
  ResourceMonitorFullSnapshot,
  ResourceMonitorGetSnapshotResponse,
  ResourceMonitorRuntimeConfig,
  ResourceMonitorSnapshotStreamPayload,
  ResourceMonitorSummarySnapshot,
  ResourcePressureChangedPayload,
  ResourcePressureEventRecord,
  SystemMemorySummary,
  ThresholdSnapshot,
} from '@spark/protocol'
import {
  EventLoopDelayCollector,
  collectHostProcessSummary,
  collectSystemMemoryOnce,
  toSystemMemorySummary,
  type SystemMemorySample,
} from './collectors.js'
import { collectChildrenSummary } from './children-collector.js'
import {
  assessIndicatorLevels,
  PressureLevelStateMachine,
  triggeredByIndicators,
  type PressureIndicatorValues,
} from './pressure-evaluator.js'
import {
  bytesToPct,
  buildThresholdSnapshot,
  computeChildrenCountThresholds,
  DEFAULT_RESOURCE_MONITOR_CONFIG,
  normalizeResourceMonitorConfig,
  type ResourceMonitorConfig,
} from './monitor-config.js'
import { TrackedProcessRegistry } from './tracked-process-registry.js'

const log = createLogger('resource-monitor')

/** 压力事件 SQLite 保留窗口（早于 cutoff 的清理）。 */
const PRESSURE_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** 基线漂移重采样阈值（system totalBytes 相对偏差 >5%）。 */
const BASELINE_DRIFT_RATIO = 0.05
/** 采集失败指数退避上限。 */
const MAX_BACKOFF_MS = 60_000
/** 系统内存采集结果复用窗口（采集自身节流）。 */
const SYSTEM_MEMORY_REUSE_MS = 10_000

export interface ResourceMonitorServiceOptions {
  /** 压力事件持久化数据库；null = 不落库（纯内存模式）。 */
  db?: SparkDatabase | null
  /** 初始配置（任意原始形态，内部 normalize）。 */
  config?: unknown
  /** 时钟注入（测试）。 */
  now?: () => number
  /** 宿主进程 pid（默认 process.pid）。 */
  hostPid?: number
  /** stream 推流回调（桌面装配层桥接 broadcastToAppWindows）。 */
  pushStream?: (
    channel: 'stream:resource-monitor:pressure-changed' | 'stream:resource-monitor:snapshot',
    payload: unknown,
  ) => void
  /** 级别变更联动回调（M2：装配层桥接 governor.setPressureLevel）。 */
  onPressureChanged?: (
    previousLevel: PressureLevel,
    level: PressureLevel,
    triggeredBy: PressureIndicatorKey[],
  ) => void
  /** 子进程采集注入（测试）；默认批量 ps。 */
  collectChildren?: (args: {
    registry: TrackedProcessRegistry
    rootPid: number
    maxEntries: number
  }) => Promise<ChildrenProcessSummary | null>
  /** 系统内存采集注入（测试）；默认真实采集。 */
  collectSystemMemory?: () => Promise<SystemMemorySample | null>
}

interface LatestSample {
  host: HostProcessSummary
  eventLoop: EventLoopDelaySummary
  system: SystemMemorySummary
  children: ChildrenProcessSummary | null
  sampledAtMs: number
  /** 本轮采样中数据降级字段（children 沿用旧值 / system 采集失败等）。 */
  staleFields: string[]
}

/** 事件查询 limit 钳制（默认 20，1–200）。 */
export function clampPressureEventLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return 20
  return Math.min(Math.max(Math.floor(limit), 1), 200)
}

/** 单行映射（纯函数，供测试直接覆盖 JSON 解析容错）。 */
export function mapPressureEventRow(row: ResourcePressureEventRow): ResourcePressureEventRecord {
  let indicators: ResourcePressureEventRecord['indicators'] = []
  if (row.indicators_json != null && row.indicators_json.length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.indicators_json)
      if (Array.isArray(parsed)) indicators = parsed as ResourcePressureEventRecord['indicators']
    } catch {
      log.warn('压力事件 indicators JSON 解析失败（id=%s）', row.id)
    }
  }
  return {
    id: row.id,
    fromLevel: row.from_level as ResourcePressureEventRecord['fromLevel'],
    toLevel: row.to_level as ResourcePressureEventRecord['toLevel'],
    occurredAt: row.occurred_at,
    indicators,
  }
}

export class ResourceMonitorService {
  private config: ResourceMonitorConfig = DEFAULT_RESOURCE_MONITOR_CONFIG
  private readonly now: () => number
  private readonly hostPid: number
  private streamSink: ResourceMonitorServiceOptions['pushStream']
  private readonly onPressureChanged: ResourceMonitorServiceOptions['onPressureChanged']
  private readonly collectChildrenImpl: NonNullable<
    ResourceMonitorServiceOptions['collectChildren']
  >
  private readonly collectSystemMemoryImpl: NonNullable<
    ResourceMonitorServiceOptions['collectSystemMemory']
  >

  readonly registry = new TrackedProcessRegistry()
  private readonly eventLoopCollector = new EventLoopDelayCollector()
  private readonly stateMachine: PressureLevelStateMachine
  private pressureRepository: ResourcePressureRepository | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAtMs = 0
  /** tick 重入守卫：上一拍未完成时跳过本轮（防采集重叠与样本乱序覆盖）。 */
  private tickInFlight = false

  private baseline: HostSpecBaseline
  private thresholdSnapshot: ThresholdSnapshot
  private latest: LatestSample | null = null

  // 采集节奏 / 退避状态
  private lastChildrenScanAtMs = 0
  private systemMemoryBackoffUntilMs = 0
  private systemMemoryConsecutiveFailures = 0
  private childrenBackoffUntilMs = 0
  private childrenConsecutiveFailures = 0
  private lastSystemSample: SystemMemorySample | null = null
  private lastSystemSampleAtMs = 0

  // 历史 + 订阅
  private history: ResourceMetricsHistoryPoint[] = []
  private readonly subscribers = new Map<string, number>()
  private lastSnapshotPushAtMs = 0

  // 宿主 CPU 差分（process.cpuUsage 上一轮快照；null = 首轮无基准）
  private lastCpuUsage: { user: number; system: number } | null = null
  private lastCpuSampleAtMs = 0
  private cpuPeakPct: number | null = null

  // 快照压力明细缓存（每 tick 的最新评估结果）
  private latestIndicators: ResourceMonitorSummarySnapshot['pressure']['indicators'] | null = null
  private latestTriggeredBy: PressureIndicatorKey[] | null = null

  constructor(private readonly options: ResourceMonitorServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.hostPid = options.hostPid ?? process.pid
    this.streamSink = options.pushStream
    this.onPressureChanged = options.onPressureChanged
    this.collectChildrenImpl = options.collectChildren ?? collectChildrenSummary
    this.collectSystemMemoryImpl = options.collectSystemMemory ?? collectSystemMemoryOnce
    this.config = normalizeResourceMonitorConfig(options.config)
    this.stateMachine = new PressureLevelStateMachine(this.config.hysteresis, this.now)
    this.baseline = this.sampleBaseline()
    this.thresholdSnapshot = buildThresholdSnapshot(this.config, this.baseline)
    if (options.db != null) {
      this.pressureRepository = new ResourcePressureRepository(options.db)
    }
  }

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  start(): void {
    if (!this.config.enabled || this.timer != null) return
    this.startedAtMs = this.now()
    this.eventLoopCollector.start()
    this.timer = setInterval(() => {
      void this.tick()
    }, this.config.sampleIntervalMs)
    this.timer.unref?.()
    log.info(
      '监控启动 interval=%dms baseline={totalBytes:%d, cpuCores:%d}',
      this.config.sampleIntervalMs,
      this.baseline.totalBytes,
      this.baseline.cpuCores,
    )
    void this.tick()
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.eventLoopCollector.stop()
  }

  /** 配置热更新（settings performance 组变更）：normalize 后即时生效；interval/enabled 变更重启 timer。 */
  /**
   * 全量替换语义（有意不与当前配置合并，区别于 governor.reconfigure 的合并语义）：
   * 调用方（桌面装配层 applyPerformanceSettings）的输入基准是 settings.performance.data
   * 持久化 JSON——渲染端全量回写、恢复默认时写 `{}`（空对象在此 normalize 回全部默认）。
   * 若改为与 lastRaw 合并，`{}` 将无法表达「恢复默认」。局部写入方（如有）需在写入侧
   * 自行补全为完整对象。
   */
  reconfigure(raw: unknown): ResourceMonitorConfig {
    const previousInterval = this.config.sampleIntervalMs
    const previousEnabled = this.config.enabled
    this.config = normalizeResourceMonitorConfig(raw)
    this.thresholdSnapshot = buildThresholdSnapshot(this.config, this.baseline)
    // 滞回参数热更新只记日志：状态机沿用旧参数至重启（避免运行中重建丢失确认进度）。
    if (
      JSON.stringify(this.config.hysteresis) !==
      JSON.stringify(DEFAULT_RESOURCE_MONITOR_CONFIG.hysteresis)
    ) {
      log.info('滞回参数热更新（重启后生效），当前级别=%s', this.stateMachine.level)
    }
    if (previousEnabled && !this.config.enabled) {
      this.stop()
      log.info('监控已停用（enabled=false）')
      return this.config
    }
    if (this.config.enabled && this.timer == null) {
      this.start()
    } else if (this.timer != null && previousInterval !== this.config.sampleIntervalMs) {
      this.stop()
      this.start()
    }
    return this.config
  }

  /** 休眠恢复（装配层接 powerMonitor resume）：重采样基线 + 预热事件循环平滑。 */
  onPowerResume(): void {
    this.resampleBaseline('power-resume')
    this.eventLoopCollector.resetSmoothing()
  }

  /** 推流 sink 后注入（桌面装配层注册 IPC 时桥接 broadcastToAppWindows）。 */
  setStreamSink(sink: NonNullable<ResourceMonitorServiceOptions['pushStream']>): void {
    this.streamSink = sink
  }

  // ─── 查询（IPC 消费） ────────────────────────────────────────────────────────

  get currentLevel(): PressureLevel {
    return this.stateMachine.level
  }

  getSnapshot(detail: 'summary' | 'full' = 'summary'): ResourceMonitorGetSnapshotResponse {
    const summary = this.buildSummarySnapshot()
    if (detail === 'summary' || summary == null) {
      // monitorEnabled 常伴随返回：渲染端据此区分「监控未开启」与「已开启等首拍」。
      return { summary, full: null, monitorEnabled: this.config.enabled }
    }
    const latest = this.latest
    const full: ResourceMonitorFullSnapshot = {
      ...summary,
      childrenEntries: latest?.children?.entries ?? [],
      baseline: this.baseline,
      thresholds: this.thresholdSnapshot,
      intervalMs: this.config.sampleIntervalMs,
      runtimeConfig: this.buildRuntimeConfig(),
      workflowGovernance: null,
    }
    return { summary, full, monitorEnabled: this.config.enabled }
  }

  getHistory(windowMs?: number): ResourceMetricsHistoryPoint[] {
    const cutoff =
      windowMs != null && Number.isFinite(windowMs) && windowMs > 0 ? this.now() - windowMs : null
    if (cutoff == null) return [...this.history]
    return this.history.filter((point) => Date.parse(point.sampledAt) >= cutoff)
  }

  /** 最近压力事件（IPC resource-monitor:get-pressure-events；未落库时返回空）。 */
  getRecentPressureEvents(limit = 20): ResourcePressureEventRecord[] {
    if (this.pressureRepository == null) return []
    return this.pressureRepository
      .listRecent(clampPressureEventLimit(limit))
      .map(mapPressureEventRow)
  }

  /**
   * 订阅控制（IPC resource-monitor:subscribe）。subscriberId 为不透明标识
   * （装配层传 webContents id）；minIntervalMs 服务端取全部订阅者最小值。
   */
  setSubscription(
    subscriberId: string,
    enabled: boolean,
    minIntervalMs?: number,
  ): {
    subscriberCount: number
    minIntervalMs: number | null
  } {
    if (enabled) {
      const clamped =
        minIntervalMs != null && Number.isFinite(minIntervalMs) && minIntervalMs > 0
          ? Math.min(Math.max(Math.floor(minIntervalMs), 1_000), 600_000)
          : this.config.snapshotStreamDefaultIntervalMs
      this.subscribers.set(subscriberId, clamped)
    } else {
      this.subscribers.delete(subscriberId)
    }
    const values = [...this.subscribers.values()]
    return {
      subscriberCount: values.length,
      minIntervalMs: values.length > 0 ? Math.min(...values) : null,
    }
  }

  /** spawn 点注册/反注册透传（codex 池 / MCP 桥 / 终端等装配层增量接入）。 */
  registerChildProcess(
    pid: number,
    kind: Parameters<TrackedProcessRegistry['register']>[1],
    refId?: string,
  ): void {
    this.registry.register(pid, kind, refId)
  }

  unregisterChildProcess(pid: number): void {
    this.registry.unregister(pid)
  }

  // ─── 采样主循环 ──────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    // 重入守卫：高负载下 ps/vm_stat 可能慢于采样周期，放任重叠会重复 spawn 采集
    // 子进程且后发先至的旧样本覆盖 this.latest（时间回退）。上一拍未完成则跳过本轮。
    if (this.tickInFlight) return
    this.tickInFlight = true
    try {
      const nowMs = this.now()
      const staleFields: string[] = []

      const host = collectHostProcessSummary()
      this.applyHostCpuDelta(host, nowMs)
      const eventLoop = this.eventLoopCollector.sample()
      const system = await this.collectSystem(nowMs, staleFields)
      if (system != null) {
        this.maybeResampleOnDrift(system)
      }
      // 完全失败且无缓存时回退基线空壳（契约 system 字段非空；usedPct 缺测不参与定级）。
      const systemSummary: SystemMemorySummary = system ?? {
        totalBytes: this.baseline.totalBytes,
        availableBytes: null,
        usedPct: null,
        platform: os.platform(),
        stale: true,
      }
      const children = await this.collectChildren(nowMs, staleFields)

      this.latest = {
        host,
        eventLoop,
        system: systemSummary,
        children,
        sampledAtMs: nowMs,
        staleFields,
      }
      const assessment = this.evaluate(host, eventLoop, systemSummary, children)
      this.appendHistory(nowMs, host, system, children, eventLoop, assessment.level)
      this.maybePushSnapshotStream(nowMs)
    } catch (error) {
      // 监控自身异常只记日志，绝不外抛（不阻断应用主流程）。
      log.error('采样轮异常（已吞掉）: %s', error instanceof Error ? error.message : String(error))
    } finally {
      this.tickInFlight = false
    }
  }

  private async collectSystem(
    nowMs: number,
    staleFields: string[],
  ): Promise<SystemMemorySummary | null> {
    // 复用窗口内不重复采集（采集自身节流）。
    if (
      nowMs - this.lastSystemSampleAtMs < SYSTEM_MEMORY_REUSE_MS &&
      this.lastSystemSample != null
    ) {
      return toSystemMemorySummary(this.lastSystemSample, false)
    }
    if (nowMs < this.systemMemoryBackoffUntilMs) {
      if (this.lastSystemSample != null) {
        staleFields.push('system')
        return toSystemMemorySummary(this.lastSystemSample, true)
      }
      return null
    }
    const sample = await this.collectSystemMemoryImpl()
    if (sample == null) {
      this.systemMemoryConsecutiveFailures += 1
      const backoff = Math.min(
        MAX_BACKOFF_MS,
        2 ** this.systemMemoryConsecutiveFailures * this.config.sampleIntervalMs,
      )
      this.systemMemoryBackoffUntilMs = nowMs + backoff
      log.warn(
        '系统内存采集失败（连续 %d 次，退避 %dms）',
        this.systemMemoryConsecutiveFailures,
        backoff,
      )
      if (this.lastSystemSample != null) {
        staleFields.push('system')
        return toSystemMemorySummary(this.lastSystemSample, true)
      }
      return null
    }
    this.systemMemoryConsecutiveFailures = 0
    this.systemMemoryBackoffUntilMs = 0
    this.lastSystemSample = sample
    this.lastSystemSampleAtMs = nowMs
    return toSystemMemorySummary(sample, false)
  }

  private async collectChildren(
    nowMs: number,
    staleFields: string[],
  ): Promise<ChildrenProcessSummary | null> {
    const pressureActive = this.stateMachine.level !== 'nominal'
    const cadence = pressureActive ? 0 : this.config.childScanIntervalMs
    const previous = this.latest?.children ?? null
    if (nowMs - this.lastChildrenScanAtMs < cadence) {
      if (previous != null) staleFields.push('children')
      return previous
    }
    if (nowMs < this.childrenBackoffUntilMs) {
      if (previous != null) staleFields.push('children')
      return previous
    }
    const summary = await this.collectChildrenImpl({
      registry: this.registry,
      rootPid: this.hostPid,
      maxEntries: this.config.maxTrackedChildren,
    })
    this.lastChildrenScanAtMs = nowMs
    if (summary == null) {
      this.childrenConsecutiveFailures += 1
      const backoff = Math.min(
        MAX_BACKOFF_MS,
        2 ** this.childrenConsecutiveFailures * this.config.childScanIntervalMs,
      )
      this.childrenBackoffUntilMs = nowMs + backoff
      log.warn('子进程采集失败（连续 %d 次，退避 %dms）', this.childrenConsecutiveFailures, backoff)
      if (previous != null) staleFields.push('children')
      return previous
    }
    this.childrenConsecutiveFailures = 0
    this.childrenBackoffUntilMs = 0
    return summary
  }

  /**
   * 生效配置回显（M3 配置面板初始值；判定仍以归一化后的内部配置为准）。
   */
  private buildRuntimeConfig(): ResourceMonitorRuntimeConfig {
    const t = this.config.thresholds
    const cc = t.childrenCount
    return {
      monitorEnabled: this.config.enabled,
      sampleIntervalMs: this.config.sampleIntervalMs,
      thresholds: {
        systemUsedPct: { ...t.systemUsedPct },
        appFootprintPct: { ...t.appFootprintPct },
        hostRssPct: { ...t.hostRssPct },
        childrenRssPct: { ...t.childrenRssPct },
        eventLoopDelayMs: { ...t.eventLoopDelayMs },
        childrenCount: {
          mode: cc.mode,
          manual: cc.manual == null ? null : { ...cc.manual },
          derived:
            cc.mode === 'auto'
              ? computeChildrenCountThresholds(this.config, this.baseline.cpuCores)
              : null,
        },
      },
    }
  }

  /**
   * 宿主 CPU 差分（M3 性能页 CPU 卡）：process.cpuUsage 两轮差分 /
   * (全部逻辑核 × 采样间隔) 归一为 0–100%。首轮无基准输出 null；
   * 异常（时钟回拨/超长间隔）放弃本轮并重置基准，不产生尖刺。
   */
  private applyHostCpuDelta(host: HostProcessSummary, nowMs: number): void {
    try {
      const usage = process.cpuUsage()
      const previous = this.lastCpuUsage
      const elapsedMs = nowMs - this.lastCpuSampleAtMs
      this.lastCpuUsage = { user: usage.user, system: usage.system }
      this.lastCpuSampleAtMs = nowMs
      if (previous == null || elapsedMs <= 0 || elapsedMs > 10 * 60_000) {
        if (previous == null) host.cpuPct = null
        return
      }
      const consumedMs = (usage.user - previous.user + (usage.system - previous.system)) / 1000
      if (consumedMs < 0) return
      const capacityMs = elapsedMs * this.baseline.cpuCores
      const pct = Math.round(Math.min((consumedMs / capacityMs) * 100, 100) * 10) / 10
      host.cpuPct = pct
      this.cpuPeakPct = this.cpuPeakPct == null ? pct : Math.max(this.cpuPeakPct, pct)
    } catch {
      // CPU 差分失败不影响其余指标。
    }
    host.cpuPeakPct = this.cpuPeakPct
  }

  private evaluate(
    host: HostProcessSummary,
    eventLoop: EventLoopDelaySummary,
    system: SystemMemorySummary | null,
    children: ChildrenProcessSummary | null,
  ): { level: PressureLevel; changed: boolean; previousLevel: PressureLevel } {
    const governedRss = children?.governedRssBytes ?? null
    const appFootprintBytes = host.rssBytes + (governedRss ?? 0)
    const values: PressureIndicatorValues = {
      systemUsedPct: system?.usedPct ?? null,
      appFootprintPct:
        children != null && governedRss != null && system != null
          ? bytesToPct(appFootprintBytes, system.totalBytes)
          : null,
      hostRssPct: system != null ? bytesToPct(host.rssBytes, system.totalBytes) : null,
      childrenRssPct:
        children != null && governedRss != null && system != null
          ? bytesToPct(governedRss, system.totalBytes)
          : null,
      governedChildrenCount: children != null ? children.governedCount : null,
      eventLoopSmoothedDelayMs: eventLoop.smoothedMaxDelayMs,
    }
    const { indicators, overall } = assessIndicatorLevels(values, {
      config: this.config,
      cpuCores: this.baseline.cpuCores,
    })
    const result = this.stateMachine.feed(overall)
    // 快照明细缓存：无论是否变更，本轮指标与触发集始终反映最新一轮评估。
    this.latestIndicators = indicators
    this.latestTriggeredBy = triggeredByIndicators(indicators, result.level)
    if (result.changed) {
      this.handleLevelChange(result.previousLevel, result.level, this.latestTriggeredBy, indicators)
    }
    return { level: result.level, changed: result.changed, previousLevel: result.previousLevel }
  }

  private handleLevelChange(
    previousLevel: PressureLevel,
    level: PressureLevel,
    triggeredBy: PressureIndicatorKey[],
    indicators: ReturnType<typeof assessIndicatorLevels>['indicators'],
  ): void {
    const changedAt = new Date(this.now()).toISOString()
    log.info('压力级别变更 %s → %s（触发: %s）', previousLevel, level, triggeredBy.join(',') || '-')
    this.persistPressureEvent(previousLevel, level, changedAt, indicators)
    const payload: ResourcePressureChangedPayload = {
      previousLevel,
      level,
      changedAt,
      triggeredBy,
      summary: this.buildSummarySnapshot(),
    }
    try {
      this.streamSink?.('stream:resource-monitor:pressure-changed', payload)
    } catch (error) {
      log.warn(
        'pressure-changed 推流失败: %s',
        error instanceof Error ? error.message : String(error),
      )
    }
    try {
      this.onPressureChanged?.(previousLevel, level, triggeredBy)
    } catch (error) {
      log.warn(
        'onPressureChanged 回调失败: %s',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private persistPressureEvent(
    previousLevel: PressureLevel,
    level: PressureLevel,
    occurredAt: string,
    indicators: ReturnType<typeof assessIndicatorLevels>['indicators'],
  ): void {
    if (!this.config.persistPressureEvents || this.pressureRepository == null) return
    try {
      this.pressureRepository.insert({
        id: randomUUID(),
        fromLevel: previousLevel,
        toLevel: level,
        occurredAt,
        indicatorsJson: JSON.stringify(indicators),
      })
      const cutoff = new Date(this.now() - PRESSURE_EVENT_RETENTION_MS).toISOString()
      const pruned = this.pressureRepository.pruneBefore(cutoff)
      if (pruned > 0) log.info('清理过期压力事件 %d 条', pruned)
    } catch (error) {
      // 落库失败不影响监控主流程；下次变更重试。
      log.error('压力事件落库失败: %s', error instanceof Error ? error.message : String(error))
    }
  }

  // ─── 派生与快照 ──────────────────────────────────────────────────────────────

  private buildSummarySnapshot(): ResourceMonitorSummarySnapshot | null {
    const latest = this.latest
    if (latest == null) return null
    const governedRss = latest.children?.governedRssBytes ?? null
    const appFootprintBytes = latest.host.rssBytes + (governedRss ?? 0)
    const staleFields = [...latest.staleFields]
    if (latest.system.stale && !staleFields.includes('system')) staleFields.push('system')
    return {
      monitorEnabled: this.config.enabled,
      sampledAt: new Date(latest.sampledAtMs).toISOString(),
      host: latest.host,
      children: {
        totalCount: latest.children?.totalCount ?? 0,
        governedCount: latest.children?.governedCount ?? 0,
        totalRssBytes: latest.children?.totalRssBytes ?? null,
        governedRssBytes: governedRss,
        byKind: latest.children?.byKind ?? {},
      },
      system: latest.system,
      eventLoop: latest.eventLoop,
      derived: {
        appFootprintBytes,
        appFootprintPct:
          latest.children != null && governedRss != null
            ? bytesToPct(appFootprintBytes, latest.system.totalBytes)
            : null,
        hostRssPct: bytesToPct(latest.host.rssBytes, latest.system.totalBytes),
        childrenRssPct:
          latest.children != null && governedRss != null
            ? bytesToPct(governedRss, latest.system.totalBytes)
            : null,
      },
      pressure: {
        level: this.stateMachine.level,
        confirmedSamples: this.stateMachine.confirmedSamples,
        indicators: this.latestIndicators ?? [],
        levelChangedAt: new Date(this.stateMachine.levelChangedAtMs).toISOString(),
        triggeredBy: this.latestTriggeredBy ?? [],
      },
      staleFields,
    }
  }

  private appendHistory(
    nowMs: number,
    host: HostProcessSummary,
    system: SystemMemorySummary | null,
    children: ChildrenProcessSummary | null,
    eventLoop: EventLoopDelaySummary,
    level: PressureLevel,
  ): void {
    const governedRss = children?.governedRssBytes ?? null
    this.history.push({
      sampledAt: new Date(nowMs).toISOString(),
      level,
      hostRssBytes: host.rssBytes,
      appFootprintBytes: host.rssBytes + (governedRss ?? 0),
      appFootprintPct:
        children != null && governedRss != null && system != null
          ? bytesToPct(host.rssBytes + governedRss, system.totalBytes)
          : null,
      systemUsedPct: system?.usedPct ?? null,
      childrenCount: children?.totalCount ?? 0,
      governedChildrenCount: children?.governedCount ?? 0,
      childrenRssBytes: governedRss,
      eventLoopMaxDelayMs: eventLoop.maxDelayMs,
    })
    const windowMs = this.config.historyWindowMinutes * 60 * 1000
    const cutoff = nowMs - windowMs
    let oldest = this.history[0]
    while (oldest != null && Date.parse(oldest.sampledAt) < cutoff) {
      this.history.shift()
      oldest = this.history[0]
    }
  }

  private maybePushSnapshotStream(nowMs: number): void {
    if (this.subscribers.size === 0 || this.streamSink == null) return
    const minInterval = Math.min(...this.subscribers.values())
    if (nowMs - this.lastSnapshotPushAtMs < minInterval) return
    const summary = this.buildSummarySnapshot()
    if (summary == null) return
    this.lastSnapshotPushAtMs = nowMs
    try {
      const payload: ResourceMonitorSnapshotStreamPayload = { summary }
      this.streamSink('stream:resource-monitor:snapshot', payload)
    } catch (error) {
      log.warn('snapshot 推流失败: %s', error instanceof Error ? error.message : String(error))
    }
  }

  // ─── 基线管理 ────────────────────────────────────────────────────────────────

  private sampleBaseline(observedTotalBytes?: number): HostSpecBaseline {
    return {
      // 观测值优先（与 drift 检测同源，避免 vm_stat 与 os.totalmem 口径差循环重采样）。
      totalBytes:
        observedTotalBytes != null && observedTotalBytes > 0 ? observedTotalBytes : os.totalmem(),
      cpuCores: os.cpus().length,
      sampledAt: new Date(this.now()).toISOString(),
    }
  }

  private resampleBaseline(reason: string, observedTotalBytes?: number): void {
    const next = this.sampleBaseline(observedTotalBytes)
    this.baseline = next
    this.thresholdSnapshot = buildThresholdSnapshot(this.config, next)
    log.info('基线重采样（%s）：totalBytes=%d cpuCores=%d', reason, next.totalBytes, next.cpuCores)
  }

  private maybeResampleOnDrift(system: SystemMemorySummary): void {
    if (system.totalBytes <= 0) return
    const drift = Math.abs(system.totalBytes - this.baseline.totalBytes) / this.baseline.totalBytes
    if (drift > BASELINE_DRIFT_RATIO) {
      this.resampleBaseline(`totalmem-drift:${(drift * 100).toFixed(1)}%`, system.totalBytes)
      this.eventLoopCollector.resetSmoothing()
    }
  }
}
