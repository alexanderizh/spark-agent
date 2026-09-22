/**
 * @module resource-monitor/pressure-evaluator
 *
 * 压力判定（纯函数 + 滞回状态机，零 electron 依赖，可单测）。
 *
 * - 逐指标最低水位（max-of-levels，非加权平均）：单一爆表指标不被其他
 *   正常指标稀释（事故场景：只有子进程爆、宿主正常）。
 * - 判定以 pct 直比为准（采集侧已产出 pct，不做 bytes→pct 往返换算）。
 * - 滞回（方案 §3.3）：升级连续 2 轮确认（emergency 1 轮立即）；降级连续
 *   6 轮 + 最短驻留 30s + 一次只降一级（升档可跳级）。
 */

import type { PressureIndicatorKey, PressureLevel } from '@spark/protocol'
import type {
  PressureHysteresisConfig,
  PressureLevelTriple,
  ResourceMonitorConfig,
} from './monitor-config.js'
import { computeChildrenCountThresholds } from './monitor-config.js'

/** 参与判定的指标值（全部可空——缺测指标本轮不参与定级，不阻塞）。 */
export interface PressureIndicatorValues {
  systemUsedPct: number | null
  appFootprintPct: number | null
  hostRssPct: number | null
  childrenRssPct: number | null
  governedChildrenCount: number | null
  eventLoopSmoothedDelayMs: number | null
}

/** 单指标判定结果（对齐契约 PressureAssessment.indicators 元素）。 */
export interface IndicatorAssessment {
  key: PressureIndicatorKey
  level: PressureLevel
  value: number | null
  /** 达到档位对应的阈值（pct 类指标）；非 pct 指标（个数/毫秒）为 null。 */
  thresholdPct: number | null
}

/** 评估输入：配置 + 基线核数（children-count 公式按核数推导）。 */
export interface PressureEvaluationContext {
  config: ResourceMonitorConfig
  cpuCores: number
}

const LEVEL_ORDER: { readonly [K in PressureLevel]: number } = {
  nominal: 0,
  warning: 1,
  critical: 2,
  emergency: 3,
}

const LEVELS_ASC: readonly PressureLevel[] = ['nominal', 'warning', 'critical', 'emergency']

export function pressureLevelOrder(level: PressureLevel): number {
  return LEVEL_ORDER[level]
}

/** 单值对三档阈值的定级（value ≥ 阈值即计入该档）。 */
function levelForValue(value: number, triple: PressureLevelTriple): PressureLevel {
  if (value >= triple.emergency) return 'emergency'
  if (value >= triple.critical) return 'critical'
  if (value >= triple.warning) return 'warning'
  return 'nominal'
}

function levelToPct(triple: PressureLevelTriple, level: PressureLevel): number | null {
  return level === 'nominal' ? null : triple[level]
}

/**
 * 逐指标定级 + 整体级别（max-of-levels）。
 * 缺测（null）指标按 nominal 计但 value 保留 null（快照可见，本轮不参与定级）。
 */
export function assessIndicatorLevels(
  values: PressureIndicatorValues,
  context: PressureEvaluationContext,
): { indicators: IndicatorAssessment[]; overall: PressureLevel } {
  const t = context.config.thresholds
  const memoryTriples: ReadonlyArray<
    readonly [PressureIndicatorKey, PressureLevelTriple, number | null]
  > = [
    ['system-used-pct', t.systemUsedPct, values.systemUsedPct],
    ['app-footprint-pct', t.appFootprintPct, values.appFootprintPct],
    ['host-rss-pct', t.hostRssPct, values.hostRssPct],
    ['children-rss-pct', t.childrenRssPct, values.childrenRssPct],
  ]
  const countThresholds = computeChildrenCountThresholds(context.config, context.cpuCores)
  const indicators: IndicatorAssessment[] = []
  let overall: PressureLevel = 'nominal'

  const raise = (level: PressureLevel): void => {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[overall]) overall = level
  }
  for (const [key, triple, value] of memoryTriples) {
    if (value == null) {
      indicators.push({ key, level: 'nominal', value: null, thresholdPct: null })
      continue
    }
    const level = levelForValue(value, triple)
    indicators.push({ key, level, value, thresholdPct: levelToPct(triple, level) })
    raise(level)
  }
  // children-count：治理口径个数阈值（按核数/预算推导；单位非 pct）
  if (values.governedChildrenCount != null) {
    const level = levelForValue(values.governedChildrenCount, countThresholds)
    indicators.push({
      key: 'children-count',
      level,
      value: values.governedChildrenCount,
      thresholdPct: null,
    })
    raise(level)
  } else {
    indicators.push({ key: 'children-count', level: 'nominal', value: null, thresholdPct: null })
  }
  // event-loop-delay-ms：EMA 平滑毫秒（固定阈值，§3.3.4；单位非 pct）
  if (values.eventLoopSmoothedDelayMs != null) {
    const level = levelForValue(values.eventLoopSmoothedDelayMs, t.eventLoopDelayMs)
    indicators.push({
      key: 'event-loop-delay-ms',
      level,
      value: values.eventLoopSmoothedDelayMs,
      thresholdPct: null,
    })
    raise(level)
  } else {
    indicators.push({
      key: 'event-loop-delay-ms',
      level: 'nominal',
      value: null,
      thresholdPct: null,
    })
  }
  return { indicators, overall }
}

/**
 * 压力级别滞回状态机（可注入假时钟）。
 *
 * feed() 每采样轮调用一次，传入本轮 max-of-levels 评估结果；
 * 返回是否发生级别变更。状态机不感知指标明细，只消费聚合级别。
 */
export class PressureLevelStateMachine {
  private currentLevel: PressureLevel = 'nominal'
  private changedAtMs: number
  private pendingUpgradeLevel: PressureLevel | null = null
  private pendingUpgradeSamples = 0
  private pendingDowngradeSamples = 0
  private currentConfirmedSamples = 0

  constructor(
    private readonly hysteresis: PressureHysteresisConfig,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.changedAtMs = this.now()
  }

  get level(): PressureLevel {
    return this.currentLevel
  }

  get levelChangedAtMs(): number {
    return this.changedAtMs
  }

  /** 当前滞回确认进度（升级或降级的连续采样数，供快照 confirmedSamples）。 */
  get confirmedSamples(): number {
    return this.currentConfirmedSamples
  }

  feed(assessedLevel: PressureLevel): {
    changed: boolean
    previousLevel: PressureLevel
    level: PressureLevel
  } {
    const nowMs = this.now()
    if (assessedLevel === this.currentLevel) {
      this.pendingUpgradeLevel = null
      this.pendingUpgradeSamples = 0
      this.pendingDowngradeSamples = 0
      this.currentConfirmedSamples = 0
      return { changed: false, previousLevel: this.currentLevel, level: this.currentLevel }
    }
    if (LEVEL_ORDER[assessedLevel] > LEVEL_ORDER[this.currentLevel]) {
      return this.considerUpgrade(assessedLevel, nowMs)
    }
    return this.considerDowngrade(nowMs)
  }

  private considerUpgrade(
    assessedLevel: PressureLevel,
    nowMs: number,
  ): { changed: boolean; previousLevel: PressureLevel; level: PressureLevel } {
    // 升档可跳级：candidate 直接取本轮评估级别（可能高出现级别多档）。
    // emergency 一轮立即（宁可误停不可溢出）。
    const immediate = assessedLevel === 'emergency' && this.hysteresis.emergencyImmediateUpgrade
    this.pendingDowngradeSamples = 0
    if (this.pendingUpgradeLevel === assessedLevel) {
      this.pendingUpgradeSamples += 1
    } else {
      this.pendingUpgradeLevel = assessedLevel
      this.pendingUpgradeSamples = 1
    }
    this.currentConfirmedSamples = this.pendingUpgradeSamples
    if (immediate || this.pendingUpgradeSamples >= this.hysteresis.confirmSamplesToUpgrade) {
      return this.commit(this.pendingUpgradeLevel, nowMs)
    }
    return { changed: false, previousLevel: this.currentLevel, level: this.currentLevel }
  }

  private considerDowngrade(nowMs: number): {
    changed: boolean
    previousLevel: PressureLevel
    level: PressureLevel
  } {
    this.pendingUpgradeLevel = null
    this.pendingUpgradeSamples = 0
    // 目标恒为当前级别下一档（一次只降一级）；无论评估值低几档都只降一级，
    // 后续轮次继续满足条件再逐级下降。
    this.pendingDowngradeSamples += 1
    this.currentConfirmedSamples = this.pendingDowngradeSamples
    const dwelled = nowMs - this.changedAtMs >= this.hysteresis.minDwellMs
    if (this.pendingDowngradeSamples >= this.hysteresis.confirmSamplesToDowngrade && dwelled) {
      const targetIndex = LEVEL_ORDER[this.currentLevel] - 1
      const target = targetIndex <= 0 ? 'nominal' : (LEVELS_ASC[targetIndex] ?? 'nominal')
      return this.commit(target, nowMs)
    }
    return { changed: false, previousLevel: this.currentLevel, level: this.currentLevel }
  }

  private commit(
    level: PressureLevel,
    nowMs: number,
  ): { changed: boolean; previousLevel: PressureLevel; level: PressureLevel } {
    const previousLevel = this.currentLevel
    this.currentLevel = level
    this.changedAtMs = nowMs
    this.pendingUpgradeLevel = null
    this.pendingUpgradeSamples = 0
    this.pendingDowngradeSamples = 0
    this.currentConfirmedSamples = 0
    return { changed: previousLevel !== level, previousLevel, level }
  }
}

/** 整体级别对应的触发指标集合（= 达到该级别的指标；nominal 为空）。 */
export function triggeredByIndicators(
  indicators: IndicatorAssessment[],
  level: PressureLevel,
): PressureIndicatorKey[] {
  if (level === 'nominal') return []
  return indicators.filter((entry) => entry.level === level).map((entry) => entry.key)
}
