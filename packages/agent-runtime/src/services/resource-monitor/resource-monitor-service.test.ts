/**
 * ResourceMonitorService 编排单测（M1）：
 *  - 采样 → 评估 → 状态机 → 级别变更（联动回调 + 推流 + 持久化）
 *  - 动态阈值判定（百分比随宿主机基线，不写死绝对值）
 *  - 采集失败指数退避 + staleFields 标记 + 复用缓存
 *  - 订阅节流推送 / 历史窗口裁剪 / 快照 full|summary 两态
 *  - enabled=false 零采样（应用行为与未接入监控一致）
 *
 * 采集器全部注入伪实现（不依赖真实 ps/vm_stat）；时钟注入驱动滞回。
 */
import { describe, it, expect } from 'vitest'
import type { ChildrenProcessSummary, PressureLevel } from '@spark/protocol'
import { ResourceMonitorService } from './resource-monitor-service.js'

const TOTAL_16G = 16 * 1024 ** 3

interface Fixture {
  service: ResourceMonitorService
  streams: Array<{ channel: string; payload: unknown }>
  pressureChangedCalls: Array<{ previousLevel: PressureLevel; level: PressureLevel }>
  setSystem: (usedPct: number | null, totalBytes?: number) => void
  setChildren: (summary: ChildrenProcessSummary | null) => void
  advance: (ms: number) => void
}

function makeFixture(overrides: { config?: Record<string, unknown> } = {}): Fixture {
  let clock = 1_000_000
  let systemSample: {
    totalBytes: number
    availableBytes: number | null
    usedPct: number | null
  } | null = {
    totalBytes: TOTAL_16G,
    availableBytes: TOTAL_16G / 2,
    usedPct: 40,
  }
  let childrenSummary: ChildrenProcessSummary | null = {
    totalCount: 2,
    totalRssBytes: 1024,
    governedCount: 2,
    governedRssBytes: 1024,
    byKind: { 'claude-cli': 2 },
    registryTracked: 0,
    sweepDiscovered: 2,
    entries: [
      { pid: 2, kind: 'claude-cli', rssBytes: 512, governed: true, source: 'sweep' },
      { pid: 3, kind: 'claude-cli', rssBytes: 512, governed: true, source: 'sweep' },
    ],
  }
  const streams: Array<{ channel: string; payload: unknown }> = []
  const pressureChangedCalls: Array<{ previousLevel: PressureLevel; level: PressureLevel }> = []

  const service = new ResourceMonitorService({
    config: {
      sampleIntervalMs: 2_000,
      childScanIntervalMs: 2_000,
      snapshotStreamDefaultIntervalMs: 60_000,
      ...overrides.config,
    },
    now: () => clock,
    collectSystemMemory: () => Promise.resolve(systemSample),
    collectChildren: () => Promise.resolve(childrenSummary),
    pushStream: (channel, payload) => {
      streams.push({ channel, payload })
    },
    onPressureChanged: (previousLevel, level) => {
      pressureChangedCalls.push({ previousLevel, level })
    },
    // db 传 null：不落 SQLite（持久化路径由 repository 层单独覆盖）。
    db: null,
  })

  return {
    service,
    streams,
    pressureChangedCalls,
    setSystem: (usedPct, totalBytes = TOTAL_16G) => {
      systemSample = usedPct == null ? null : { totalBytes, availableBytes: null, usedPct }
    },
    setChildren: (summary) => {
      childrenSummary = summary
    },
    advance: (ms) => {
      clock += ms
    },
  }
}

/** 手动驱动一次采样轮（绕过 setInterval，配合注入时钟确定性执行）。 */
async function tickOnce(fixture: Fixture): Promise<void> {
  await (fixture.service as unknown as { tick: () => Promise<void> }).tick()
}

describe('采样 → 评估 → 级别变更闭环', () => {
  it('system-used 连续 2 轮超 warning → 升 warning，联动回调与 pressure-changed 推流', async () => {
    const fixture = makeFixture()
    // 16G 宿主机 warning=90%：rss 类指标全压制，仅 system-used 驱动
    fixture.setSystem(92)
    await tickOnce(fixture)
    expect(fixture.service.currentLevel).toBe('nominal') // 第 1 轮确认中
    await tickOnce(fixture)
    expect(fixture.service.currentLevel).toBe('warning')
    expect(fixture.pressureChangedCalls).toEqual([{ previousLevel: 'nominal', level: 'warning' }])
    const pressureStream = fixture.streams.find(
      (entry) => entry.channel === 'stream:resource-monitor:pressure-changed',
    )
    expect(pressureStream).toBeDefined()
    const payload = pressureStream?.payload as { level: PressureLevel; triggeredBy: string[] }
    expect(payload.level).toBe('warning')
    expect(payload.triggeredBy).toContain('system-used-pct')
  })

  it('children-count 爆表场景：远超 emergency 阈值一轮立即熔断（emergencyImmediateUpgrade）', async () => {
    const fixture = makeFixture()
    fixture.setChildren({
      totalCount: 500,
      totalRssBytes: 4096,
      governedCount: 500,
      governedRssBytes: 4096,
      byKind: { 'claude-cli': 500 },
      registryTracked: 0,
      sweepDiscovered: 500,
      entries: [],
    })
    await tickOnce(fixture)
    // 500 > emergency（floor 160，核数 ≤31 时 max 均 ≤ 500）：立即升档不等待确认。
    expect(fixture.service.currentLevel).toBe('emergency')
    expect(fixture.pressureChangedCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('降级滞后：回落 nominal 后需 6 轮 + 30s 驻留', async () => {
    const fixture = makeFixture()
    fixture.setSystem(92)
    await tickOnce(fixture)
    await tickOnce(fixture) // warning
    fixture.setSystem(40)
    fixture.advance(10_000)
    for (let i = 0; i < 6; i += 1) await tickOnce(fixture)
    expect(fixture.service.currentLevel).toBe('warning') // 驻留不足
    fixture.advance(30_000)
    for (let i = 0; i < 5; i += 1) await tickOnce(fixture)
    await tickOnce(fixture)
    expect(fixture.service.currentLevel).toBe('nominal')
  })
})

describe('采集失败退避与 stale 标记', () => {
  it('系统内存连续失败 → 指数退避 + 沿用旧值 + staleFields 标记 system', async () => {
    const fixture = makeFixture()
    fixture.setSystem(92)
    await tickOnce(fixture)
    await tickOnce(fixture) // warning（顺便抬高子进程采集频率档）
    fixture.setSystem(null)
    fixture.advance(60_000) // 越过复用窗口
    await tickOnce(fixture)
    const snapshot = fixture.service.getSnapshot('summary').summary
    expect(snapshot?.staleFields).toContain('system')
    expect(snapshot?.system.stale).toBe(true)
    // 旧值沿用（退避期内不再采集）
    await tickOnce(fixture)
    expect(fixture.service.getSnapshot('summary').summary?.system.usedPct).toBe(92)
  })

  it('子进程采集失败 → 沿用上次汇总 + stale 标记 children', async () => {
    const fixture = makeFixture()
    await tickOnce(fixture)
    fixture.setChildren(null)
    fixture.advance(60_000)
    await tickOnce(fixture)
    const snapshot = fixture.service.getSnapshot('summary').summary
    expect(snapshot?.staleFields).toContain('children')
    expect(snapshot?.children.governedCount).toBe(2)
  })
})

describe('快照与历史', () => {
  it('enabled=false：getSnapshot 恒返回 monitorEnabled=false（渲染端据此区分「未开启」与「等首拍」）', () => {
    const fixture = makeFixture({ config: { enabled: false } })
    expect(fixture.service.getSnapshot('full')).toEqual({
      summary: null,
      full: null,
      monitorEnabled: false,
    })
  })

  it('enabled=true 未首拍：monitorEnabled=true 但 summary/full 为 null（loading 语义）', () => {
    const fixture = makeFixture()
    expect(fixture.service.getSnapshot('full')).toEqual({
      summary: null,
      full: null,
      monitorEnabled: true,
    })
  })

  it('tick 重入守卫：上一拍未完成时跳过本轮（不重复采集、不产出样本）', async () => {
    const fixture = makeFixture()
    const internal = fixture.service as unknown as { tickInFlight: boolean }
    internal.tickInFlight = true
    await tickOnce(fixture)
    // 被守卫跳过：未产生任何样本
    expect(fixture.service.getSnapshot('summary').summary).toBeNull()
    internal.tickInFlight = false
    await tickOnce(fixture)
    expect(fixture.service.getSnapshot('summary').summary).not.toBeNull()
  })

  it('full 快照含 baseline / thresholds / entries；summary 裁剪明细', async () => {
    const fixture = makeFixture()
    await tickOnce(fixture)
    const { summary, full } = fixture.service.getSnapshot('full')
    expect(summary).not.toBeNull()
    expect(full?.baseline.totalBytes).toBe(TOTAL_16G)
    // 16G 宿主机：host-rss warning 45% 换算 bytes ≈ 7.2GB（展示语义）
    const hostRss = full?.thresholds?.entries['host-rss-pct']
    expect(hostRss?.warning.pct).toBe(45)
    expect(Math.round((hostRss?.warning.bytes ?? 0) / 1024 ** 3)).toBe(7)
    expect(Array.isArray(full?.childrenEntries)).toBe(true)
  })

  it('历史点入环形缓冲并按窗口裁剪', async () => {
    const fixture = makeFixture({ config: { historyWindowMinutes: 5 } })
    await tickOnce(fixture)
    fixture.advance(60_000)
    await tickOnce(fixture)
    expect(fixture.service.getHistory(120_000)).toHaveLength(2)
    // 窗口外（5 分钟前）的点被裁剪
    fixture.advance(6 * 60_000)
    await tickOnce(fixture)
    expect(fixture.service.getHistory()).toHaveLength(1)
  })
})

describe('订阅节流推送', () => {
  it('无订阅者不推 snapshot 流；订阅后按最小间隔节流', async () => {
    const fixture = makeFixture({ config: { snapshotStreamDefaultIntervalMs: 60_000 } })
    await tickOnce(fixture)
    expect(
      fixture.streams.filter((entry) => entry.channel === 'stream:resource-monitor:snapshot'),
    ).toHaveLength(0)
    const result = fixture.service.setSubscription('win-1', true)
    expect(result.subscriberCount).toBe(1)
    fixture.advance(61_000)
    await tickOnce(fixture)
    const pushes = fixture.streams.filter(
      (entry) => entry.channel === 'stream:resource-monitor:snapshot',
    )
    expect(pushes).toHaveLength(1)
    // 间隔内不重复推
    fixture.advance(10_000)
    await tickOnce(fixture)
    expect(
      fixture.streams.filter((entry) => entry.channel === 'stream:resource-monitor:snapshot'),
    ).toHaveLength(1)
    // 退订后停止
    fixture.service.setSubscription('win-1', false)
    fixture.advance(120_000)
    await tickOnce(fixture)
    expect(
      fixture.streams.filter((entry) => entry.channel === 'stream:resource-monitor:snapshot'),
    ).toHaveLength(1)
  })

  it('多订阅者取最小间隔', () => {
    const fixture = makeFixture()
    fixture.service.setSubscription('win-1', true, 10_000)
    const result = fixture.service.setSubscription('win-2', true, 30_000)
    expect(result.minIntervalMs).toBe(10_000)
  })
})

describe('enabled=false 与生命周期', () => {
  it('enabled=false：start 零采样，快照 summary 为 null（monitorEnabled 不可用）', () => {
    const fixture = makeFixture({ config: { enabled: false } })
    fixture.service.start()
    const { summary } = fixture.service.getSnapshot('summary')
    expect(summary).toBeNull()
    fixture.service.stop()
  })

  it('reconfigure 热更新：阈值即时生效', async () => {
    const fixture = makeFixture()
    fixture.setSystem(92)
    await tickOnce(fixture)
    await tickOnce(fixture)
    expect(fixture.service.currentLevel).toBe('warning')
    // 放宽阈值到 96 → 92 回到 nominal 评估（状态机降级仍受滞回约束）
    fixture.service.reconfigure({
      thresholds: { systemUsedPct: { warning: 96, critical: 98, emergency: 99 } },
    })
    fixture.setSystem(92)
    expect(
      fixture.service.getSnapshot('full').full?.thresholds?.entries['system-used-pct']?.warning.pct,
    ).toBe(96)
  })
})

describe('基线漂移重采样', () => {
  it('系统总内存漂移 >5% → 基线重采样 + 阈值快照重建', async () => {
    const fixture = makeFixture()
    await tickOnce(fixture)
    // 16G → 32G（漂移 100%）
    fixture.setSystem(40, 32 * 1024 ** 3)
    fixture.advance(60_000)
    await tickOnce(fixture)
    const full = fixture.service.getSnapshot('full').full
    expect(full?.baseline.totalBytes).toBe(32 * 1024 ** 3)
    // 换算缓存跟随新基线：host-rss warning 45% ≈ 14.4GB
    expect(
      Math.round((full?.thresholds?.entries['host-rss-pct']?.warning.bytes ?? 0) / 1024 ** 3),
    ).toBe(14)
  })
})

describe('spawn 点注册透传', () => {
  it('register/unregister 透传到注册表', () => {
    const fixture = makeFixture()
    fixture.service.registerChildProcess(12345, 'codex-pool', 'lease-1')
    expect(fixture.service.registry.kindFor(12345)).toBe('codex-pool')
    fixture.service.unregisterChildProcess(12345)
    expect(fixture.service.registry.kindFor(12345)).toBeNull()
  })
})
