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
  // 2026-09-23 实测修正：2 会话真实机器（10 核/16G）治理进程即 37 个
  // （claude CLI 的 MCP node 载体计入口径），floor 必须高于正常峰值。
  it('公式 = max(floor, n×mult, b+offset)，预算默认 8', () => {
    const config = normalizeResourceMonitorConfig({})
    expect(computeChildrenCountThresholds(config, 8)).toEqual({
      warning: Math.max(80, 64, 8),
      critical: Math.max(128, 96, 16),
      emergency: Math.max(160, 128, 24),
    })
  })

  it('日常用量远离阈值：2 会话 37 个 < warning(80)，fork 失控才触 critical', () => {
    const config = normalizeResourceMonitorConfig({})
    const t = computeChildrenCountThresholds(config, 10) // 用户实测机：10 核/16G
    expect(t).toEqual({ warning: 80, critical: 128, emergency: 160 })
    expect(37).toBeLessThan(t.warning) // 实测 2 会话治理进程数
  })

  it('低核机器由 floor 兜底、高核随核数放大', () => {
    const config = normalizeResourceMonitorConfig({})
    expect(computeChildrenCountThresholds(config, 2).warning).toBe(80) // max(80, 16, 8)
    expect(computeChildrenCountThresholds(config, 16).warning).toBe(128) // max(80, 128, 8)
  })

  it('阈值随并发预算水涨船高（低 floor + 预算上限 32 时 offset 主导：32/40/48）', () => {
    // 预算受 TOTAL_AGENT_PROCESS_BUDGET_RANGE(4–32) clamp，默认 floor(80/128/160)
    // 下 offset 永不主导；只有用户手动调低 floor 时预算分支才生效，此处覆盖该分支。
    const config = normalizeResourceMonitorConfig({
      thresholds: {
        childrenCount: { warnFloor: 4, critFloor: 4, emgFloor: 4, processBudget: 32 },
      },
    })
    const t = computeChildrenCountThresholds(config, 2)
    expect(t.warning).toBe(Math.max(4, 16, 32 + 0))
    expect(t.critical).toBe(Math.max(4, 24, 32 + 8))
    expect(t.emergency).toBe(Math.max(4, 32, 32 + 16))
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
    // 百分比恒定 97（判定口径与宿主机规格无关）
    for (const item of pcts) expect(item.pct).toBe(97)
    // bytes 随宿主机规格线性放大（仅展示语义）
    expect(pcts[0]?.bytes).toBe(Math.round(0.97 * 8 * 1024 ** 3))
    expect(pcts[1]?.bytes).toBe(Math.round(0.97 * 16 * 1024 ** 3))
    expect(pcts[2]?.bytes).toBe(Math.round(0.97 * 64 * 1024 ** 3))
  })

  it('16G 宿主机 host-rss warning 45% 展示值（默认阈值不误伤常态使用）', () => {
    const config = normalizeResourceMonitorConfig({})
    const snapshot = buildThresholdSnapshot(config, baseline16G())
    const hostRss = snapshot.entries['host-rss-pct']
    expect(hostRss?.warning.pct).toBe(45)
    expect(hostRss?.warning.bytes).toBe(pctToBytes(45, 16 * 1024 ** 3))
  })

  it('bytesToPct 与 pctToBytes 互逆（一位小数精度）', () => {
    const total = 16 * 1024 ** 3
    const bytes = pctToBytes(35, total)
    expect(bytesToPct(bytes, total)).toBe(35)
    expect(bytesToPct(null, total)).toBeNull()
    expect(bytesToPct(1000, 0)).toBeNull()
  })
})
