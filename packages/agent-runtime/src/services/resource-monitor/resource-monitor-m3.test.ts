/**
 * @module resource-monitor-m3.test
 *
 * M3 增量能力聚焦测试：
 *  - 宿主 CPU 差分（首轮 null、次轮 0–100 数值、峰值单调不减）；
 *  - 事件查询：无库空数组 + limit 钳制 + 行映射（JSON 解析 / 坏 JSON 容错）
 *    ——纯函数直测（真实库往返受 better-sqlite3 Electron/Node ABI 切换限制，
 *    见项目 vendor/prebuilds + sqlite-abi.sh 约定，并发编辑期不切 ABI）；
 *  - full 快照 runtimeConfig 回显（阈值三元组 + childrenCount 推导）。
 */

import { describe, expect, it } from 'vitest'
import type { ChildrenProcessSummary } from '@spark/protocol'
import {
  clampPressureEventLimit,
  mapPressureEventRow,
  ResourceMonitorService,
} from './resource-monitor-service.js'
import type { ResourcePressureEventRow } from '@spark/storage'
import type { ResourceMonitorServiceOptions } from './resource-monitor-service.js'

const TOTAL_16G = 16 * 1024 * 1024 * 1024

interface Fixture {
  service: ResourceMonitorService
  advance: (ms: number) => void
  dispose: () => void
}

function makeFixture(overrides: Partial<ResourceMonitorServiceOptions> = {}): Fixture {
  let clock = 1_000_000
  const systemSample: {
    totalBytes: number
    availableBytes: number | null
    usedPct: number | null
  } = {
    totalBytes: TOTAL_16G,
    availableBytes: TOTAL_16G / 2,
    usedPct: 40,
  }
  const childrenSummary: ChildrenProcessSummary = {
    totalCount: 2,
    totalRssBytes: 1024,
    governedCount: 2,
    governedRssBytes: 1024,
    byKind: { 'claude-cli': 2 },
    registryTracked: 0,
    sweepDiscovered: 2,
    entries: [],
  }
  const service = new ResourceMonitorService({
    config: {
      sampleIntervalMs: 2_000,
      childScanIntervalMs: 2_000,
      snapshotStreamDefaultIntervalMs: 60_000,
    },
    now: () => clock,
    collectSystemMemory: () => Promise.resolve(systemSample),
    collectChildren: () => Promise.resolve(childrenSummary),
    db: null,
    ...overrides,
  })
  return {
    service,
    advance: (ms: number) => {
      clock += ms
    },
    dispose: () => service.stop(),
  }
}

async function tickOnce(fixture: Fixture): Promise<void> {
  await (fixture.service as unknown as { tick: () => Promise<void> }).tick()
}

describe('宿主 CPU 差分（M3 性能页 CPU 卡）', () => {
  it('首轮无基准 cpuPct=null；次轮为 0–100 数值；峰值单调不减', async () => {
    const fixture = makeFixture()
    try {
      await tickOnce(fixture)
      const first = fixture.service.getSnapshot('full').full
      expect(first?.host.cpuPct).toBeNull()

      fixture.advance(2_000)
      await tickOnce(fixture)
      const second = fixture.service.getSnapshot('full').full
      expect(second?.host.cpuPct).not.toBeNull()
      expect(second?.host.cpuPct ?? -1).toBeGreaterThanOrEqual(0)
      expect(second?.host.cpuPct ?? 999).toBeLessThanOrEqual(100)
      // 空闲测试进程 CPU 极低，但峰值字段必须已建立且与当前值一致。
      expect(second?.host.cpuPeakPct).toBe(second?.host.cpuPct)

      fixture.advance(2_000)
      await tickOnce(fixture)
      const third = fixture.service.getSnapshot('full').full
      expect(third?.host.cpuPeakPct ?? -1).toBeGreaterThanOrEqual(second?.host.cpuPeakPct ?? 0)
    } finally {
      fixture.dispose()
    }
  })
})

describe('getRecentPressureEvents（M3 事件列表）', () => {
  it('无库（db=null）返回空数组', () => {
    const fixture = makeFixture()
    try {
      expect(fixture.service.getRecentPressureEvents(10)).toEqual([])
    } finally {
      fixture.dispose()
    }
  })

  it('limit 钳制：非法回退 20，范围 1–200', () => {
    expect(clampPressureEventLimit(undefined)).toBe(20)
    expect(clampPressureEventLimit(Number.NaN)).toBe(20)
    expect(clampPressureEventLimit(0)).toBe(1)
    expect(clampPressureEventLimit(-5)).toBe(1)
    expect(clampPressureEventLimit(500)).toBe(200)
    expect(clampPressureEventLimit(35.7)).toBe(35)
  })

  it('行映射：snake_case → 协议形态、indicators JSON 解析、坏 JSON/非数组容错为空', () => {
    const indicators = [{ key: 'system-used-pct', level: 'warning', value: 85, thresholdPct: 80 }]
    const good: ResourcePressureEventRow = {
      id: 'e1',
      from_level: 'nominal',
      to_level: 'warning',
      occurred_at: '2026-09-23T10:00:00.000Z',
      indicators_json: JSON.stringify(indicators),
      created_at: '2026-09-23T10:00:01.000Z',
    }
    expect(mapPressureEventRow(good)).toEqual({
      id: 'e1',
      fromLevel: 'nominal',
      toLevel: 'warning',
      occurredAt: '2026-09-23T10:00:00.000Z',
      indicators,
    })

    const badJson: ResourcePressureEventRow = { ...good, id: 'e2', indicators_json: '{bad json' }
    expect(mapPressureEventRow(badJson).indicators).toEqual([])

    const notArray: ResourcePressureEventRow = { ...good, id: 'e3', indicators_json: '{"a":1}' }
    expect(mapPressureEventRow(notArray).indicators).toEqual([])

    const nullJson: ResourcePressureEventRow = { ...good, id: 'e4', indicators_json: null }
    expect(mapPressureEventRow(nullJson).indicators).toEqual([])
  })
})

describe('full 快照 runtimeConfig 回显（M3 配置面板初始值）', () => {
  it('阈值三元组与 childrenCount auto 推导随基线回显', async () => {
    const fixture = makeFixture()
    try {
      await tickOnce(fixture)
      const full = fixture.service.getSnapshot('full').full
      const runtime = full?.runtimeConfig
      expect(runtime).not.toBeNull()
      expect(runtime?.monitorEnabled).toBe(true)
      expect(runtime?.thresholds.systemUsedPct).toEqual({
        warning: 80,
        critical: 88,
        emergency: 93,
      })
      expect(runtime?.thresholds.hostRssPct).toEqual({ warning: 25, critical: 35, emergency: 45 })
      expect(runtime?.thresholds.eventLoopDelayMs).toEqual({
        warning: 300,
        critical: 600,
        emergency: 1200,
      })
      expect(runtime?.thresholds.childrenCount.mode).toBe('auto')
      // 测试机核数动态：推导值满足 max(下限, 核数×倍率, 预算+偏移) 下界。
      const derived = runtime?.thresholds.childrenCount.derived
      expect(derived).not.toBeNull()
      expect(derived?.warning ?? 0).toBeGreaterThanOrEqual(10)
      expect(derived?.critical ?? 0).toBeGreaterThanOrEqual(16)
      expect(derived?.emergency ?? 0).toBeGreaterThanOrEqual(24)
      // 装配层未合并前 workflowGovernance 为 null。
      expect(full?.workflowGovernance).toBeNull()
    } finally {
      fixture.dispose()
    }
  })
})
