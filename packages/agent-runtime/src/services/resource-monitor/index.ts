/**
 * @module resource-monitor
 *
 * 资源性能监控体系（M1）：采集器 + 压力判定 + 进程注册表 + 编排服务。
 *
 * 与 dispatch-governor（M0 物理闸门）经 PressureLevel 联动构成
 * 「监控 → 调度」闭环：服务判定级别变更 → 装配层灌给闸门降级矩阵。
 */

export { ResourceMonitorService } from './resource-monitor-service.js'
export type { ResourceMonitorServiceOptions } from './resource-monitor-service.js'

export {
  EventLoopDelayCollector,
  collectHostProcessSummary,
  collectSystemMemoryOnce,
  toSystemMemorySummary,
  SYSTEM_MEMORY_CACHE_MS,
} from './collectors.js'
export type { SystemMemorySample } from './collectors.js'

export {
  buildDescendantRows,
  classifyByComm,
  collectChildrenSummary,
  parsePsOutput,
  parseWindowsProcessOutput,
  summarizeRows,
} from './children-collector.js'
export type { CollectChildrenArgs, PsRow } from './children-collector.js'

export {
  assessIndicatorLevels,
  PressureLevelStateMachine,
  pressureLevelOrder,
  triggeredByIndicators,
} from './pressure-evaluator.js'
export type {
  IndicatorAssessment,
  PressureEvaluationContext,
  PressureIndicatorValues,
} from './pressure-evaluator.js'

export {
  buildThresholdSnapshot,
  bytesToPct,
  computeChildrenCountThresholds,
  DEFAULT_PRESSURE_HYSTERESIS,
  DEFAULT_PRESSURE_THRESHOLDS,
  DEFAULT_RESOURCE_MONITOR_CONFIG,
  normalizeResourceMonitorConfig,
  pctToBytes,
  RESOURCE_MONITOR_RANGES,
} from './monitor-config.js'
export type {
  ChildrenCountThresholdConfig,
  PressureHysteresisConfig,
  PressureLevelTriple,
  PressureThresholdConfig,
  ResourceMonitorConfig,
} from './monitor-config.js'

export {
  GOVERNED_PROCESS_KINDS,
  TrackedProcessRegistry,
  isGovernedProcessKind,
} from './tracked-process-registry.js'
export type { TrackedProcessRegistration } from './tracked-process-registry.js'
