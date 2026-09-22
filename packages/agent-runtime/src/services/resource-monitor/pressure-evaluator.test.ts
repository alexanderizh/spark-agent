/**
 * 压力判定单测（M1）：逐指标最低水位（max-of-levels）、缺测指标不阻塞、
 * children-count 核数推导、滞回状态机（升级确认 / emergency 立即 / 降级
 * 驻留+逐级+确认数 / 跳级）。
 */
import { describe, it, expect } from 'vitest'
import {
  assessIndicatorLevels,
  PressureLevelStateMachine,
  triggeredByIndicators,
  type PressureIndicatorValues,
} from './pressure-evaluator.js'
import {
  DEFAULT_PRESSURE_THRESHOLDS,
  DEFAULT_RESOURCE_MONITOR_CONFIG,
  type ResourceMonitorConfig,
} from './monitor-config.js'

function makeConfig(overrides: Partial<ResourceMonitorConfig> = {}): ResourceMonitorConfig {
  return { ...DEFAULT_RESOURCE_MONITOR_CONFIG, ...overrides }
}

function makeValues(overrides: Partial<PressureIndicatorValues> = {}): PressureIndicatorValues {
  return {
    systemUsedPct: 50,
    appFootprintPct: 30,
    hostRssPct: 10,
    childrenRssPct: 20,
    governedChildrenCount: 3,
    eventLoopSmoothedDelayMs: 5,
    ...overrides,
  }
}

describe('assessIndicatorLevels 逐指标最低水位', () => {
  it('单一指标爆表不被其他正常指标稀释（max-of-levels）', () => {
    const { overall, indicators } = assessIndicatorLevels(
      makeValues({ childrenRssPct: 66, systemUsedPct: 50, hostRssPct: 10 }),
      { config: makeConfig(), cpuCores: 8 },
    )
    expect(overall).toBe('emergency')
    const childrenRss = indicators.find((entry) => entry.key === 'children-rss-pct')
    expect(childrenRss?.level).toBe('emergency')
    expect(childrenRss?.thresholdPct).toBe(DEFAULT_PRESSURE_THRESHOLDS.childrenRssPct.emergency)
  })

  it('全部正常时 nominal，triggeredBy 为空', () => {
    const { overall, indicators } = assessIndicatorLevels(makeValues(), {
      config: makeConfig(),
      cpuCores: 8,
    })
    expect(overall).toBe('nominal')
    expect(triggeredByIndicators(indicators, 'nominal')).toEqual([])
  })

  it('缺测指标按 nominal 计且 value 保留 null（不阻塞整体判定）', () => {
    const { overall, indicators } = assessIndicatorLevels(
      makeValues({
        systemUsedPct: null,
        childrenRssPct: null,
        governedChildrenCount: null,
        eventLoopSmoothedDelayMs: null,
      }),
      { config: makeConfig(), cpuCores: 8 },
    )
    expect(overall).toBe('nominal')
    for (const key of [
      'system-used-pct',
      'children-rss-pct',
      'children-count',
      'event-loop-delay-ms',
    ] as const) {
      const entry = indicators.find((item) => item.key === key)
      expect(entry?.value).toBeNull()
      expect(entry?.level).toBe('nominal')
    }
  })

  it('children-count 阈值随核数推导（16 核 warning = max(10, 32, b+4)）', () => {
    const { overall } = assessIndicatorLevels(makeValues({ governedChildrenCount: 30 }), {
      config: makeConfig(),
      cpuCores: 16,
    })
    // 16 核：warning = max(10, 16×2, 8+4) = 32；30 < 32 → nominal
    expect(overall).toBe('nominal')
    const { overall: overallAt32 } = assessIndicatorLevels(
      makeValues({ governedChildrenCount: 32 }),
      { config: makeConfig(), cpuCores: 16 },
    )
    expect(overallAt32).toBe('warning')
  })

  it('低核数机器更保守（4 核 warning = max(10, 8, 12) = 12）', () => {
    const { overall } = assessIndicatorLevels(makeValues({ governedChildrenCount: 11 }), {
      config: makeConfig(),
      cpuCores: 4,
    })
    expect(overall).toBe('nominal')
    const { overall: at12 } = assessIndicatorLevels(makeValues({ governedChildrenCount: 12 }), {
      config: makeConfig(),
      cpuCores: 4,
    })
    expect(at12).toBe('warning')
  })
})

describe('PressureLevelStateMachine 滞回', () => {
  const hysteresis = DEFAULT_RESOURCE_MONITOR_CONFIG.hysteresis

  function makeMachine(now: () => number): PressureLevelStateMachine {
    return new PressureLevelStateMachine(hysteresis, now)
  }

  it('升级需连续 2 轮确认；单轮毛刺不升级', () => {
    let clock = 0
    const machine = makeMachine(() => clock)
    clock = 1_000
    expect(machine.feed('warning').changed).toBe(false)
    // 中途回落 → 确认计数清零
    expect(machine.feed('nominal').changed).toBe(false)
    expect(machine.feed('warning').changed).toBe(false)
    expect(machine.feed('warning').changed).toBe(true)
    expect(machine.level).toBe('warning')
  })

  it('emergency 一轮立即升级（宁可误停不可溢出）', () => {
    let clock = 0
    const machine = makeMachine(() => clock)
    clock = 1_000
    const result = machine.feed('emergency')
    expect(result.changed).toBe(true)
    expect(machine.level).toBe('emergency')
  })

  it('nominal → critical 升档可跳级', () => {
    let clock = 0
    const machine = makeMachine(() => clock)
    clock = 1_000
    machine.feed('critical')
    const result = machine.feed('critical')
    expect(result.changed).toBe(true)
    expect(machine.level).toBe('critical')
  })

  it('降级需连续 6 轮 + 最短驻留 30s；一次只降一级', () => {
    let clock = 0
    const machine = makeMachine(() => clock)
    clock = 1_000
    machine.feed('emergency')
    // 驻留不足：30s 内即使确认数累计 6 轮也不降（确认计数保留）
    clock = 10_000
    for (let i = 0; i < 6; i += 1) expect(machine.feed('nominal').changed).toBe(false)
    expect(machine.level).toBe('emergency')
    // 驻留足够后首轮即降，且评估为 nominal 也只降到 critical（一次一级）
    clock = 60_000
    expect(machine.feed('nominal').changed).toBe(true)
    expect(machine.level).toBe('critical')
    // 再降一级需重新累计 6 轮确认 + 新驻留窗口
    clock = 65_000
    for (let i = 0; i < 6; i += 1) expect(machine.feed('nominal').changed).toBe(false)
    clock = 100_000 // dwell = 100_000 - 60_000 ≥ 30_000
    expect(machine.feed('nominal').changed).toBe(true)
    expect(machine.level).toBe('warning')
  })

  it('confirmedSamples 反映当前确认进度', () => {
    let clock = 0
    const machine = makeMachine(() => clock)
    clock = 1_000
    machine.feed('warning')
    expect(machine.confirmedSamples).toBe(1)
    machine.feed('warning')
    expect(machine.confirmedSamples).toBe(0)
  })
})
