/**
 * @module resource-monitor
 *
 * 资源性能监控契约（性能监控与并发控制体系 · 模块一，M1）。
 *
 * 核心原则（方案 §3.3）：任何内存类阈值不写死绝对值——配置/持久化/代码常量
 * 三层只有百分比与核数推导系数；运行时按宿主机规格基线（HostSpecBaseline）
 * 换算出展示用绝对值并缓存（ThresholdSnapshot）。判定以 pct 直比为准，
 * bytes 仅用于展示/日志。
 */

/** 压力档位（四级，逐指标最低水位取 max-of-levels）。 */
export type PressureLevel = 'nominal' | 'warning' | 'critical' | 'emergency'

/** 参与压力判定的六类指标。 */
export type PressureIndicatorKey =
  | 'system-used-pct'
  | 'app-footprint-pct'
  | 'host-rss-pct'
  | 'children-rss-pct'
  | 'children-count'
  | 'event-loop-delay-ms'

/** 宿主机规格基线：启动采样 + 三触发重采样（漂移>5% / 休眠恢复 / 配置热更新）。 */
export interface HostSpecBaseline {
  totalBytes: number
  cpuCores: number
  sampledAt: string
}

/** 子进程分类口径（树扫描按 comm 分类 + 注册表精确标注）。 */
export type TrackedProcessKind =
  | 'claude-cli'
  | 'codex-cli'
  | 'agent-unknown'
  | 'mcp-bridge'
  | 'platform-pool'
  | 'codex-pool'
  | 'engine-subagent'
  | 'media-mcp'
  | 'tool-package'
  | 'terminal-pty'
  | 'subapp-service'
  | 'media-tool'
  | 'other'

/** 单个子进程采样（隐私红线：只读 comm 可执行名与 RSS，不读 argv/env/打开文件）。 */
export interface ChildProcessSample {
  pid: number
  kind: TrackedProcessKind
  rssBytes: number | null
  /** governed = claude/codex 家族（宿主 CLI + 成员 CLI + CLI 内部 Task 孙进程）。 */
  governed: boolean
  source: 'registry' | 'sweep' | 'both'
}

/** 子进程汇总：双口径并存（全量诊断 + 治理判定）。 */
export interface ChildrenProcessSummary {
  totalCount: number
  totalRssBytes: number | null
  /** 治理口径计数：剔除 MCP stdio 桥与平台常驻池后的 claude/codex 家族进程数。 */
  governedCount: number
  governedRssBytes: number | null
  byKind: Partial<Record<TrackedProcessKind, number>>
  registryTracked: number
  sweepDiscovered: number
  entries: ChildProcessSample[]
}

/** 系统内存（macOS 用 vm_stat 口径，os.freemem 不含 purgeable 不采用）。 */
export interface SystemMemorySummary {
  totalBytes: number
  availableBytes: number | null
  usedPct: number | null
  platform: NodeJS.Platform
  stale: boolean
}

/** 宿主主进程采样。 */
export interface HostProcessSummary {
  rssBytes: number
  heapUsedBytes: number
  heapTotalBytes: number
  externalBytes: number
  arrayBuffersBytes: number
  activeResources: number | null
  /** 宿主主进程 CPU 占用（%，相对全部逻辑核归一；process.cpuUsage 差分，首轮为 null）。 */
  cpuPct: number | null
  /** 本次监控会话内观测到的 cpuPct 峰值（%，随快照滚动更新）。 */
  cpuPeakPct: number | null
}

/** 事件循环延迟（EMA 平滑）。 */
export interface EventLoopDelaySummary {
  maxDelayMs: number
  meanDelayMs: number
  smoothedMaxDelayMs: number
}

/** 派生指标（全部按治理口径计算）。 */
export interface ResourceDerivedMetrics {
  appFootprintBytes: number
  appFootprintPct: number | null
  hostRssPct: number | null
  childrenRssPct: number | null
}

/** 压力判定结果。 */
export interface PressureAssessment {
  level: PressureLevel
  confirmedSamples: number
  indicators: Array<{
    key: PressureIndicatorKey
    level: PressureLevel
    value: number | null
    thresholdPct: number | null
  }>
  levelChangedAt: string
  triggeredBy: PressureIndicatorKey[]
}

/** 完整资源快照（summary 形态裁剪掉 entries/baseline/thresholds）。 */
export interface ResourceMetricsSnapshot {
  sampledAt: string
  intervalMs: number
  host: HostProcessSummary
  children: ChildrenProcessSummary
  system: SystemMemorySummary
  baseline: HostSpecBaseline
  eventLoop: EventLoopDelaySummary
  derived: ResourceDerivedMetrics
  pressure: PressureAssessment
  staleFields: string[]
}

/** 单指标三档阈值（pct 判定基准 + bytes 展示换算值）。 */
export interface PressureThresholdEntry {
  warning: { pct: number; bytes: number | null }
  critical: { pct: number; bytes: number | null }
  emergency: { pct: number; bytes: number | null }
}

/** 换算缓存：判定 pct 直比；bytes 供 UI/日志，基线不变期间零重复计算。 */
export interface ThresholdSnapshot {
  baseline: HostSpecBaseline
  entries: Partial<Record<PressureIndicatorKey, PressureThresholdEntry>>
}

/** 三档数值组（按指标语义为百分比 / 毫秒 / 个数）。 */
export interface PressureLevelTripleNumbers {
  warning: number
  critical: number
  emergency: number
}

/** 生效配置回显（M3 配置面板展示；判定与持久化仍以主进程归一化结果为准）。 */
export interface ResourceMonitorRuntimeConfig {
  monitorEnabled: boolean
  sampleIntervalMs: number
  thresholds: {
    systemUsedPct: PressureLevelTripleNumbers
    appFootprintPct: PressureLevelTripleNumbers
    hostRssPct: PressureLevelTripleNumbers
    childrenRssPct: PressureLevelTripleNumbers
    eventLoopDelayMs: PressureLevelTripleNumbers
    childrenCount: {
      mode: 'auto' | 'manual'
      manual: PressureLevelTripleNumbers | null
      /** auto 模式按当前基线/预算推导出的生效值。 */
      derived: PressureLevelTripleNumbers | null
    }
  }
}

/** 工作流执行治理回显（装配层从 SessionService 合并进 full 快照）。 */
export interface WorkflowGovernanceEcho {
  waveWidth: number
  fanoutClamp: number
  loopFanoutProductCap: number
  maxDispatchesPerRun: number
}

/** 历史趋势点（降采样后）。 */
export interface ResourceMetricsHistoryPoint {
  sampledAt: string
  level: PressureLevel
  hostRssBytes: number
  appFootprintBytes: number
  appFootprintPct: number | null
  systemUsedPct: number | null
  childrenCount: number
  governedChildrenCount: number
  childrenRssBytes: number | null
  eventLoopMaxDelayMs: number
}

// ─── IPC 请求/响应 ────────────────────────────────────────────────────────────

export interface ResourceMonitorGetSnapshotRequest {
  /** summary = 日常展示（裁剪 pid 明细）；full 附 baseline 与 ThresholdSnapshot。 */
  detail?: 'summary' | 'full'
}

export interface ResourceMonitorSummarySnapshot {
  monitorEnabled: boolean
  sampledAt: string
  host: HostProcessSummary
  children: {
    totalCount: number
    governedCount: number
    totalRssBytes: number | null
    governedRssBytes: number | null
    byKind: Partial<Record<TrackedProcessKind, number>>
  }
  system: SystemMemorySummary
  eventLoop: EventLoopDelaySummary
  derived: ResourceDerivedMetrics
  pressure: PressureAssessment
  staleFields: string[]
}

export interface ResourceMonitorFullSnapshot extends ResourceMonitorSummarySnapshot {
  childrenEntries: ChildProcessSample[]
  baseline: HostSpecBaseline
  thresholds: ThresholdSnapshot | null
  intervalMs: number
  /** 生效监控配置回显（服务层填充；配置面板初始值来源）。 */
  runtimeConfig: ResourceMonitorRuntimeConfig | null
  /** 工作流治理回显（装配层合并；null = 未设置）。 */
  workflowGovernance: WorkflowGovernanceEcho | null
}

export interface ResourceMonitorGetSnapshotResponse {
  summary: ResourceMonitorSummarySnapshot | null
  full: ResourceMonitorFullSnapshot | null
  /** 服务端监控开关当前值：summary/full 均为 null 时据此区分「未开启」与「等首拍」。 */
  monitorEnabled: boolean
}

export interface ResourceMonitorGetHistoryRequest {
  /** 历史窗口时长（毫秒，60_000–7_200_000，与 IPC schema 校验范围一致）。 */
  windowMs?: number
}

export interface ResourceMonitorGetHistoryResponse {
  points: ResourceMetricsHistoryPoint[]
}

export interface ResourceMonitorSubscribeRequest {
  enabled: boolean
  /** 订阅者最小推送间隔档（毫秒，1_000–600_000；服务端取全部订阅者最小值，与 IPC schema 校验范围一致）。 */
  minIntervalMs?: number
}

export interface ResourceMonitorSubscribeResponse {
  ok: boolean
  subscriberCount: number
  minIntervalMs: number | null
}

// ─── 压力事件回看（M3 性能页「治理事件」） ───────────────────────────────────

export interface ResourceMonitorGetPressureEventsRequest {
  /** 最近事件条数（默认 20，上限 200）。 */
  limit?: number
}

/** 持久化的级别迁移事件（resource_pressure_events 行的应用层形态）。 */
export interface ResourcePressureEventRecord {
  id: string
  fromLevel: PressureLevel
  toLevel: PressureLevel
  occurredAt: string
  /** 触发指标明细（落库 JSON 解析结果；解析失败为空数组）。 */
  indicators: PressureAssessment['indicators']
}

export interface ResourceMonitorGetPressureEventsResponse {
  events: ResourcePressureEventRecord[]
}

/** 级别变更事件（持久化 + stream 推送，无论有无订阅恒推）。 */
export interface ResourcePressureEvent {
  id: string
  sessionId: null
  fromLevel: PressureLevel
  toLevel: PressureLevel
  occurredAt: string
  indicators: PressureAssessment['indicators']
}

/** stream:resource-monitor:pressure-changed 载荷。 */
export interface ResourcePressureChangedPayload {
  previousLevel: PressureLevel
  level: PressureLevel
  changedAt: string
  triggeredBy: PressureIndicatorKey[]
  summary: ResourceMonitorSummarySnapshot | null
}

/** stream:resource-monitor:snapshot 载荷（订阅制节流推送）。 */
export interface ResourceMonitorSnapshotStreamPayload {
  summary: ResourceMonitorSummarySnapshot
}
