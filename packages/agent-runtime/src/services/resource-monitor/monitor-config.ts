/**
 * @module resource-monitor/monitor-config
 *
 * 资源监控配置：默认值、normalize/钳制、阈值快照换算（性能监控体系 M1）。
 *
 * 核心原则（方案 §3.3）：任何内存类阈值不写死绝对值——配置与持久化只有
 * 百分比（0–100 整数）与核数推导系数；运行时按宿主机规格基线
 * （HostSpecBaseline）换算出展示用绝对值并缓存（ThresholdSnapshot）。
 * 判定以 pct 直比为准，bytes 仅用于展示/日志。
 *
 * 配置来源为 settings category=performance 的 monitor / thresholds /
 * hysteresis 组（每 category 单 data key JSON，见影响分析 §⑤）。
 */

import type {
  HostSpecBaseline,
  PressureIndicatorKey,
  PressureThresholdEntry,
  ThresholdSnapshot,
} from '@spark/protocol'
import {
  DEFAULT_TOTAL_AGENT_PROCESS_BUDGET,
  TOTAL_AGENT_PROCESS_BUDGET_RANGE,
} from '../dispatch-governor/governance-config.js'

/** 三档阈值（warning / critical / emergency）。内存类单位为百分比整数。 */
export interface PressureLevelTriple {
  warning: number
  critical: number
  emergency: number
}

/**
 * children-count 治理口径阈值（方案 §3.3.3）。
 * auto 模式：warning = max(warnFloor, n×warnMult, b+warnOffset)（n=核数，b=并发预算）。
 */
export interface ChildrenCountThresholdConfig {
  mode: 'auto' | 'manual'
  /** manual 模式下的绝对数覆盖（高级用户；auto 模式忽略）。 */
  manual: PressureLevelTriple | null
  warnMult: number
  critMult: number
  emgMult: number
  warnFloor: number
  critFloor: number
  emgFloor: number
  budgetOffset: PressureLevelTriple
  /**
   * 并发预算 b：与 dispatch-governor 的 totalAgentProcessBudget 对齐
   * （默认值与范围直接复用其常量，保证阈值随闸门水涨船高）。
   */
  processBudget: number
}

/** 压力阈值配置（全部为百分比 / 系数 / 固定毫秒，无字节）。 */
export interface PressureThresholdConfig {
  /** 系统内存占用率（%）。 */
  systemUsedPct: PressureLevelTriple
  /** 宿主 RSS + 治理口径子进程 RSS / 系统总内存（%）。 */
  appFootprintPct: PressureLevelTriple
  /** 宿主主进程 RSS / 系统总内存（%）。 */
  hostRssPct: PressureLevelTriple
  /** 治理口径子进程 RSS / 系统总内存（%）。 */
  childrenRssPct: PressureLevelTriple
  /** 治理口径子进程数（线程爆炸代理指标，按核数/预算推导）。 */
  childrenCount: ChildrenCountThresholdConfig
  /** 事件循环延迟（EMA 平滑，固定毫秒——时间感知指标不做基线换算，§3.3.4）。 */
  eventLoopDelayMs: PressureLevelTriple
}

/** 滞回参数（方案 §3.3：升级快、降级慢，一次只降一级，升档可跳级）。 */
export interface PressureHysteresisConfig {
  /** warning/critical 升档需连续确认的采样数。 */
  confirmSamplesToUpgrade: number
  /** 降档需连续低于下沿的采样数。 */
  confirmSamplesToDowngrade: number
  /** 最短驻留：级别变更后至少停留该时长才允许降档。 */
  minDwellMs: number
  /** emergency 一轮立即升档（宁可误停不可溢出）。 */
  emergencyImmediateUpgrade: boolean
}

/** 资源监控服务配置（normalize 后的完整形态）。 */
export interface ResourceMonitorConfig {
  /** 总开关。false 时不采样不推送（应用行为与未接入监控完全一致）。 */
  enabled: boolean
  /** 采样周期（ms），默认 2s。 */
  sampleIntervalMs: number
  /** 子进程批量采集周期间隔（nominal 态；≥warning 时每 tick，方案 §3.1）。 */
  childScanIntervalMs: number
  /** 进程树扫描兜底间隔（nominal 态；活跃或加压时 10s）。 */
  processSweepIntervalMs: number
  /** 历史环形缓冲窗口（分钟），默认 30。 */
  historyWindowMinutes: number
  /** 快照 pid 明细上限（超限按 RSS 取 top）。 */
  maxTrackedChildren: number
  /** 级别变更事件是否落 SQLite（resource_pressure_events）。 */
  persistPressureEvents: boolean
  /** snapshot 流默认推送最小间隔（订阅者未指定时的档位，默认 60s）。 */
  snapshotStreamDefaultIntervalMs: number
  thresholds: PressureThresholdConfig
  hysteresis: PressureHysteresisConfig
}

export const DEFAULT_PRESSURE_THRESHOLDS: PressureThresholdConfig = {
  // 默认阈值表（方案 §3.3.5，定义态只有百分比/系数/固定毫秒）
  systemUsedPct: { warning: 80, critical: 88, emergency: 93 },
  appFootprintPct: { warning: 50, critical: 65, emergency: 78 },
  hostRssPct: { warning: 25, critical: 35, emergency: 45 },
  childrenRssPct: { warning: 35, critical: 50, emergency: 65 },
  childrenCount: {
    mode: 'auto',
    manual: null,
    warnMult: 2,
    critMult: 4,
    emgMult: 6,
    warnFloor: 10,
    critFloor: 16,
    emgFloor: 24,
    budgetOffset: { warning: 4, critical: 12, emergency: 24 },
    processBudget: DEFAULT_TOTAL_AGENT_PROCESS_BUDGET,
  },
  eventLoopDelayMs: { warning: 300, critical: 600, emergency: 1200 },
}

export const DEFAULT_PRESSURE_HYSTERESIS: PressureHysteresisConfig = {
  confirmSamplesToUpgrade: 2,
  confirmSamplesToDowngrade: 6,
  minDwellMs: 30_000,
  emergencyImmediateUpgrade: true,
}

export const DEFAULT_RESOURCE_MONITOR_CONFIG: ResourceMonitorConfig = {
  enabled: true,
  sampleIntervalMs: 2_000,
  childScanIntervalMs: 10_000,
  processSweepIntervalMs: 30_000,
  historyWindowMinutes: 30,
  maxTrackedChildren: 64,
  persistPressureEvents: true,
  snapshotStreamDefaultIntervalMs: 60_000,
  thresholds: DEFAULT_PRESSURE_THRESHOLDS,
  hysteresis: DEFAULT_PRESSURE_HYSTERESIS,
}

export const RESOURCE_MONITOR_RANGES = {
  sampleIntervalMs: { min: 1_000, max: 300_000 },
  childScanIntervalMs: { min: 1_000, max: 300_000 },
  processSweepIntervalMs: { min: 1_000, max: 300_000 },
  historyWindowMinutes: { min: 5, max: 240 },
  maxTrackedChildren: { min: 8, max: 256 },
  snapshotStreamDefaultIntervalMs: { min: 1_000, max: 600_000 },
  pct: { min: 5, max: 100 },
  eventLoopDelayMs: { min: 50, max: 10_000 },
} as const

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function clampBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeTriple(
  raw: unknown,
  fallback: PressureLevelTriple,
  min: number,
  max: number,
): PressureLevelTriple {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    warning: clampInt(source.warning, min, max, fallback.warning),
    critical: clampInt(source.critical, min, max, fallback.critical),
    emergency: clampInt(source.emergency, min, max, fallback.emergency),
  }
}

function normalizeChildrenCount(raw: unknown): ChildrenCountThresholdConfig {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_PRESSURE_THRESHOLDS.childrenCount
  const manual =
    source.manual != null && typeof source.manual === 'object'
      ? normalizeTriple(
          source.manual,
          defaults.manual ?? { warning: 10, critical: 16, emergency: 24 },
          1,
          512,
        )
      : null
  const budgetOffset =
    source.budgetOffset != null && typeof source.budgetOffset === 'object'
      ? normalizeTriple(source.budgetOffset, defaults.budgetOffset, 0, 64)
      : defaults.budgetOffset
  return {
    mode: source.mode === 'manual' ? 'manual' : 'auto',
    manual,
    warnMult: clampInt(source.warnMult, 1, 16, defaults.warnMult),
    critMult: clampInt(source.critMult, 1, 16, defaults.critMult),
    emgMult: clampInt(source.emgMult, 1, 16, defaults.emgMult),
    warnFloor: clampInt(source.warnFloor, 1, 128, defaults.warnFloor),
    critFloor: clampInt(source.critFloor, 1, 128, defaults.critFloor),
    emgFloor: clampInt(source.emgFloor, 1, 256, defaults.emgFloor),
    budgetOffset,
    processBudget: clampInt(
      source.processBudget,
      TOTAL_AGENT_PROCESS_BUDGET_RANGE.min,
      TOTAL_AGENT_PROCESS_BUDGET_RANGE.max,
      defaults.processBudget,
    ),
  }
}

function normalizeThresholds(raw: unknown): PressureThresholdConfig {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_PRESSURE_THRESHOLDS
  const pctRange = RESOURCE_MONITOR_RANGES.pct
  return {
    systemUsedPct: normalizeTriple(
      source.systemUsedPct,
      defaults.systemUsedPct,
      pctRange.min,
      pctRange.max,
    ),
    appFootprintPct: normalizeTriple(
      source.appFootprintPct,
      defaults.appFootprintPct,
      pctRange.min,
      pctRange.max,
    ),
    hostRssPct: normalizeTriple(source.hostRssPct, defaults.hostRssPct, pctRange.min, pctRange.max),
    childrenRssPct: normalizeTriple(
      source.childrenRssPct,
      defaults.childrenRssPct,
      pctRange.min,
      pctRange.max,
    ),
    childrenCount: normalizeChildrenCount(source.childrenCount),
    eventLoopDelayMs: normalizeTriple(
      source.eventLoopDelayMs,
      defaults.eventLoopDelayMs,
      RESOURCE_MONITOR_RANGES.eventLoopDelayMs.min,
      RESOURCE_MONITOR_RANGES.eventLoopDelayMs.max,
    ),
  }
}

function normalizeHysteresis(raw: unknown): PressureHysteresisConfig {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_PRESSURE_HYSTERESIS
  return {
    confirmSamplesToUpgrade: clampInt(
      source.confirmSamplesToUpgrade,
      1,
      10,
      defaults.confirmSamplesToUpgrade,
    ),
    confirmSamplesToDowngrade: clampInt(
      source.confirmSamplesToDowngrade,
      1,
      30,
      defaults.confirmSamplesToDowngrade,
    ),
    minDwellMs: clampInt(source.minDwellMs, 1_000, 600_000, defaults.minDwellMs),
    emergencyImmediateUpgrade: clampBool(
      source.emergencyImmediateUpgrade,
      defaults.emergencyImmediateUpgrade,
    ),
  }
}

/**
 * 把任意输入（settings JSON 局部 / 完整对象）归一为合法配置。
 * 未知字段忽略；字段缺失回落默认值；越界钳制。始终返回完整对象。
 */
export function normalizeResourceMonitorConfig(raw: unknown): ResourceMonitorConfig {
  const source = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const defaults = DEFAULT_RESOURCE_MONITOR_CONFIG
  const ranges = RESOURCE_MONITOR_RANGES
  return {
    enabled: source.enabled === false ? false : true,
    sampleIntervalMs: clampInt(
      source.sampleIntervalMs,
      ranges.sampleIntervalMs.min,
      ranges.sampleIntervalMs.max,
      defaults.sampleIntervalMs,
    ),
    childScanIntervalMs: clampInt(
      source.childScanIntervalMs,
      ranges.childScanIntervalMs.min,
      ranges.childScanIntervalMs.max,
      defaults.childScanIntervalMs,
    ),
    processSweepIntervalMs: clampInt(
      source.processSweepIntervalMs,
      ranges.processSweepIntervalMs.min,
      ranges.processSweepIntervalMs.max,
      defaults.processSweepIntervalMs,
    ),
    historyWindowMinutes: clampInt(
      source.historyWindowMinutes,
      ranges.historyWindowMinutes.min,
      ranges.historyWindowMinutes.max,
      defaults.historyWindowMinutes,
    ),
    maxTrackedChildren: clampInt(
      source.maxTrackedChildren,
      ranges.maxTrackedChildren.min,
      ranges.maxTrackedChildren.max,
      defaults.maxTrackedChildren,
    ),
    persistPressureEvents: clampBool(source.persistPressureEvents, defaults.persistPressureEvents),
    snapshotStreamDefaultIntervalMs: clampInt(
      source.snapshotStreamDefaultIntervalMs,
      ranges.snapshotStreamDefaultIntervalMs.min,
      ranges.snapshotStreamDefaultIntervalMs.max,
      defaults.snapshotStreamDefaultIntervalMs,
    ),
    thresholds: normalizeThresholds(source.thresholds),
    hysteresis: normalizeHysteresis(source.hysteresis),
  }
}

/** children-count 三档阈值（方案 §3.3.3 公式；manual 模式直接返回覆盖值）。 */
export function computeChildrenCountThresholds(
  config: ResourceMonitorConfig,
  cpuCores: number,
): PressureLevelTriple {
  const cc = config.thresholds.childrenCount
  if (cc.mode === 'manual' && cc.manual != null) return cc.manual
  const n = Math.max(1, Math.floor(cpuCores))
  const b = cc.processBudget
  return {
    warning: Math.max(cc.warnFloor, n * cc.warnMult, b + cc.budgetOffset.warning),
    critical: Math.max(cc.critFloor, n * cc.critMult, b + cc.budgetOffset.critical),
    emergency: Math.max(cc.emgFloor, n * cc.emgMult, b + cc.budgetOffset.emergency),
  }
}

/**
 * 按宿主机规格基线换算阈值快照（判定 pct 直比；bytes 仅供展示/日志）。
 * 仅内存类四指标入表——children-count（个）与 event-loop-delay-ms（ms）
 * 非 pct/bytes 语义，不入 ThresholdSnapshot（契约 Partial 语义），
 * 由 computeChildrenCountThresholds / thresholds.eventLoopDelayMs 直接提供。
 */
export function buildThresholdSnapshot(
  config: ResourceMonitorConfig,
  baseline: HostSpecBaseline,
): ThresholdSnapshot {
  const t = config.thresholds
  const pctTriples: ReadonlyArray<readonly [PressureIndicatorKey, PressureLevelTriple]> = [
    ['system-used-pct', t.systemUsedPct],
    ['app-footprint-pct', t.appFootprintPct],
    ['host-rss-pct', t.hostRssPct],
    ['children-rss-pct', t.childrenRssPct],
  ]
  const entries: Partial<Record<PressureIndicatorKey, PressureThresholdEntry>> = {}
  for (const [key, triple] of pctTriples) {
    entries[key] = {
      warning: { pct: triple.warning, bytes: pctToBytes(triple.warning, baseline.totalBytes) },
      critical: { pct: triple.critical, bytes: pctToBytes(triple.critical, baseline.totalBytes) },
      emergency: {
        pct: triple.emergency,
        bytes: pctToBytes(triple.emergency, baseline.totalBytes),
      },
    }
  }
  return { baseline, entries }
}

/** pct → bytes 换算（展示用；四舍五入到整字节）。 */
export function pctToBytes(pct: number, totalBytes: number): number {
  return Math.round((pct / 100) * totalBytes)
}

/** bytes → pct（0–100，一位小数内精度）；totalBytes 无效时返回 null。 */
export function bytesToPct(bytes: number | null, totalBytes: number | null): number | null {
  if (bytes == null || totalBytes == null || !Number.isFinite(totalBytes) || totalBytes <= 0)
    return null
  return Math.round((bytes / totalBytes) * 1000) / 10
}
