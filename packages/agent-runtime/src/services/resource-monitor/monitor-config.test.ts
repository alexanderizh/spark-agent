/**
 * 监控配置单测（M1）：normalize 钳制/回落、children-count 治理公式、
 * 动态基线换算（16G/8G/64G 宿主机同一百分比阈值，bytes 仅展示）。
 */
import { describe, it, expect } from 'vitest'
import {
  bytesToPct,
  buildThresholdSnapshot,
  computeChildrenCountThresholds,
  normalizeResourceMonitorConfig,
  DEFAULT_PRESSURE_THRESHOLDS,
  DEFAULT_RESOURCE_MONITOR_CONFIG,
  pctToBytes,
} from './monitor-config.js'
import type { HostSpecBaseline } from '@spark/protocol'

function baseline16G(cpuCores = 12): HostSpecBaseline {
  return { totalBytes: 16 * 1024 ** 3, cpuCores, sampledAt: '2026-09-23T00:00:00.000Z' }
}

describe('normalizeResourceMonitorConfig', () => {
  it('空输入回落全部默认值', () => {
    const config = normalizeResourceMonitorConfig(null)
    expect(config).toEqual(DEFAULT_RESOURCE_MONITOR_CONFIG)
  })

  it('未知字段忽略、越界钳制', () => {
    const config = normalizeResourceMonitorConfig({
      sampleIntervalMs: 10, // 低于 min 1000 → 钳到 1000
      historyWindowMinutes: 99999, // 超过 max 240 → 钳到 240
      thresholds: { systemUsedPct: { warning: 95, critical: 5, emergency: 'bad' } },
      unknownField: true,
    })
    expect(config.sampleIntervalMs).toBe(1_000)
    expect(config.historyWindowMinutes).toBe(240)
    // critical 5 低于 pct min → 钳到 5；emergency 'bad' → 回落默认
    expect(config.thresholds.systemUsedPct.warning).toBe(95)
    expect(config.thresholds.systemUsedPct.critical).toBe(5)
    expect(config.thresholds.systemUsedPct.emergency).toBe(
      DEFAULT_PRESSURE_THRESHOLDS.systemUsedPct.emergency,
    )
  })

  it('enabled 仅显式 false 才关闭', () => {
    expect(normalizeResourceMonitorConfig({ enabled: false }).enabled).toBe(false)
    expect(normalizeResourceMonitorConfig({ enabled: 'false' }).enabled).toBe(true)
    expect(normalizeResourceMonitorConfig({}).enabled).toBe(true)
  })

  it('children-count manual 模式覆盖值合法、auto 忽略 manual', () => {
    const manual = normalizeResourceMonitorConfig({
      thresholds: {
        childrenCount: { mode: 'manual', manual: { warning: 3, critical: 5, emergency: 7 } },
      },
    })
    expect(computeChildrenCountThresholds(manual, 32)).toEqual({
      warning: 3,
      critical: 5,
      emergency: 7,
    })
    const auto = normalizeResourceMonitorConfig({
      thresholds: {
        childrenCount: { mode: 'auto', manual: { warning: 3, critical: 5, emergency: 7 } },
      },
    })
    expect(computeChildrenCountThresholds(auto, 32).warning).toBeGreaterThan(7)
  })
})

describe('computeChildrenCountThresholds 治理口径', () => {
  it('公式 = max(floor, n×mult, b+offset)，预算默认 8', () => {
    const config = normalizeResourceMonitorConfig({})
    expect(computeChildrenCountThresholds(config, 8)).toEqual({
      warning: Math.max(10, 16, 8 + 4),
      critical: Math.max(16, 32, 8 + 12),
      emergency: Math.max(24, 48, 8 + 24),
    })
  })

  it('低核机器由 floor 兜底、高核随核数放大', () => {
    const config = normalizeResourceMonitorConfig({})
    expect(computeChildrenCountThresholds(config, 2).warning).toBe(12) // max(10, 4, 12)
    expect(computeChildrenCountThresholds(config, 32).warning).toBe(64) // max(10, 64, 12)
  })

  it('阈值随并发预算水涨船高（预算 16 时 warning ≥ 20）', () => {
    const config = normalizeResourceMonitorConfig({
      thresholds: { childrenCount: { processBudget: 16 } },
    })
    expect(computeChildrenCountThresholds(config, 8).warning).toBe(Math.max(10, 16, 20))
  })
})

describe('动态基线换算（阈值不写死绝对值）', () => {
  it('同一百分比在 8G/16G/64G 宿主机换算出不同 bytes 展示值', () => {
    const config = normalizeResourceMonitorConfig({})
    const hosts: Array<[number, number]> = [
      [8 * 1024 ** 3, 8],
      [16 * 1024 ** 3, 12],
      [64 * 1024 ** 3, 32],
    ]
    const pcts = hosts.map(([totalBytes, cores]) => {
      const snapshot = buildThresholdSnapshot(config, {
        totalBytes,
        cpuCores: cores,
        sampledAt: 'x',
      })
      const entry = snapshot.entries['system-used-pct']
      return { pct: entry?.emergency.pct, bytes: entry?.emergency.bytes }
    })
    // 百分比恒定 93（判定口径与宿主机规格无关）
    for (const item of pcts) expect(item.pct).toBe(93)
    // bytes 随宿主机规格线性放大（仅展示语义）
    expect(pcts[0]?.bytes).toBe(Math.round(0.93 * 8 * 1024 ** 3))
    expect(pcts[1]?.bytes).toBe(Math.round(0.93 * 16 * 1024 ** 3))
    expect(pcts[2]?.bytes).toBe(Math.round(0.93 * 64 * 1024 ** 3))
  })

  it('16G 宿主机 host-rss warning 25% = 4GB 展示值（用户反馈场景）', () => {
    const config = normalizeResourceMonitorConfig({})
    const snapshot = buildThresholdSnapshot(config, baseline16G())
    const hostRss = snapshot.entries['host-rss-pct']
    expect(hostRss?.warning.pct).toBe(25)
    expect(hostRss?.warning.bytes).toBe(pctToBytes(25, 16 * 1024 ** 3))
  })

  it('bytesToPct 与 pctToBytes 互逆（一位小数精度）', () => {
    const total = 16 * 1024 ** 3
    const bytes = pctToBytes(35, total)
    expect(bytesToPct(bytes, total)).toBe(35)
    expect(bytesToPct(null, total)).toBeNull()
    expect(bytesToPct(1000, 0)).toBeNull()
  })
})
