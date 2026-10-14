/**
 * @module wiki-milestone-trigger.test
 *
 * 里程碑触发器单测（方案 §10）：门槛判定 / 防抖重置 / 到期复查各分支 /
 * 失败静默 / 水位线不推进重武装 / dispose 清理。延迟逻辑全部走 fake timers。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WikiExtractionReceipt } from '@spark/protocol'
import { WikiMilestoneTrigger, type WikiMilestoneTriggerDeps } from './wiki-milestone-trigger.js'
import { hasWikiMilestoneDeliverySignal } from './wiki-milestone-signals.js'

const DELIVERED_TEXT = '已修复登录态丢失问题，回归测试通过。'
const NO_SIGNAL_TEXT = '正在分析中，还没有结论'

function receipt(partial: Partial<WikiExtractionReceipt> = {}): WikiExtractionReceipt {
  return {
    ok: true,
    sampledTurns: 4,
    inserted: 2,
    duplicates: 0,
    ...partial,
  }
}

interface Harness {
  trigger: WikiMilestoneTrigger
  distill: ReturnType<typeof vi.fn>
  countUnextractedTurns: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  hasActiveSession: ReturnType<typeof vi.fn>
  settings: Record<string, unknown>
  settle: (signal?: { assistantTurnText?: string; fileChangeCount?: number }) => void
}

function createHarness(
  overrides: {
    receipt?: WikiExtractionReceipt | Error
    unextracted?: number
  } = {},
): Harness {
  const settings: Record<string, unknown> = {}
  const distill =
    overrides.receipt instanceof Error
      ? vi.fn(() => Promise.reject(overrides.receipt))
      : vi.fn(() => Promise.resolve(overrides.receipt ?? receipt()))
  const countUnextractedTurns = vi.fn(() => overrides.unextracted ?? 3)
  const notify = vi.fn()
  const hasActiveSession = vi.fn(() => false)
  const deps: WikiMilestoneTriggerDeps = {
    settingsGet: (_category, key) => settings[key],
    turnRegistry: { hasActiveSession },
    countUnextractedTurns,
    distill: distill as WikiMilestoneTriggerDeps['distill'],
    notifyCandidatesReady: notify,
  }
  const trigger = new WikiMilestoneTrigger(deps)
  return {
    trigger,
    distill,
    countUnextractedTurns,
    notify,
    hasActiveSession,
    settings,
    settle: (signal = {}) =>
      trigger.onTurnSettled({
        sessionId: 's1',
        turnId: `t${countUnextractedTurns.mock.calls.length}-${Date.now()}`,
        assistantTurnText: signal.assistantTurnText ?? DELIVERED_TEXT,
        ...(signal.fileChangeCount !== undefined
          ? { fileChangeCount: signal.fileChangeCount }
          : {}),
      }),
  }
}

const MINUTE = 60_000

describe('hasWikiMilestoneDeliverySignal', () => {
  it('交付 / 修复关键词命中（大小写不敏感）', () => {
    expect(hasWikiMilestoneDeliverySignal('Build succeeded, all green')).toBe(true)
    expect(hasWikiMilestoneDeliverySignal('All Tests Pass')).toBe(true)
    expect(hasWikiMilestoneDeliverySignal('问题已修复')).toBe(true)
  })

  it('普通叙述不命中', () => {
    expect(hasWikiMilestoneDeliverySignal(NO_SIGNAL_TEXT)).toBe(false)
    expect(hasWikiMilestoneDeliverySignal('')).toBe(false)
  })
})

describe('WikiMilestoneTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('关键词命中 → 防抖到期后发起 milestone 蒸馏并通知', async () => {
    const h = createHarness()
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    expect(h.distill).toHaveBeenCalledWith('s1')
    expect(h.notify).toHaveBeenCalledWith('s1', 2)
  })

  it('无关键词但本轮有文件变更 → 兜底触发', async () => {
    const h = createHarness()
    h.settle({ assistantTurnText: NO_SIGNAL_TEXT, fileChangeCount: 2 })
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
  })

  it('既无关键词也无文件变更 → 静默跳过，不武装定时器', async () => {
    const h = createHarness()
    h.settle({ assistantTurnText: NO_SIGNAL_TEXT, fileChangeCount: 0 })
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
  })

  it('水位线后新增有效轮次不足 minTurns → 跳过', async () => {
    const h = createHarness({ unextracted: 2 })
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
    // 门槛逐次重判：轮次攒够后同款信号可触发。
    h.countUnextractedTurns.mockReturnValue(3)
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
  })

  it('连续 settle 重置防抖：只在最后一次 settle 起 3 分钟后触发一次', async () => {
    const h = createHarness()
    h.settle()
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    h.settle()
    // 距第一次 settle 已 4 分钟，但距第二次仅 2 分钟：不应触发。
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
  })

  it('到期时会话又在跑 → 跳过；下一次 settle 重新武装后触发', async () => {
    const h = createHarness()
    h.settle()
    h.hasActiveSession.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
    h.hasActiveSession.mockReturnValue(false)
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
  })

  it('到期时 milestone 开关已关 → 跳过', async () => {
    const h = createHarness()
    h.settle()
    h.settings['extract/milestone'] = false
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
  })

  it('距上次发起不足最小间隔 → 拦截', async () => {
    const h = createHarness()
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    h.settle()
    // 距第一次发起仅 3 分钟（默认间隔 30 分钟）：拦截。
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    // 越过间隔后放行。
    await vi.advanceTimersByTimeAsync(27 * MINUTE)
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(2)
  })

  it('当日发起次数达到上限 → 拦截；跨日重置', async () => {
    const h = createHarness()
    h.settings['extract/milestoneDelayMinutes'] = 1
    h.settings['extract/milestoneIntervalMinutes'] = 5
    h.settings['extract/milestoneDailyCap'] = 2
    h.settle()
    await vi.advanceTimersByTimeAsync(1 * MINUTE) // t=1：第 1 次（名额 1/2）
    h.settle()
    await vi.advanceTimersByTimeAsync(5 * MINUTE) // t=2 时到期但间隔不足，拦截
    expect(h.distill).toHaveBeenCalledTimes(1)
    h.settle()
    await vi.advanceTimersByTimeAsync(1 * MINUTE) // t=7：越过间隔，第 2 次（名额 2/2）
    expect(h.distill).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5 * MINUTE) // 推进到 t=12
    h.settle()
    await vi.advanceTimersByTimeAsync(1 * MINUTE) // t=13：间隔已过但日限已满 → daily_cap 拦截
    expect(h.distill).toHaveBeenCalledTimes(2)
    // 跨日 + 越过间隔：名额重置。
    await vi.advanceTimersByTimeAsync(24 * 60 * MINUTE)
    h.settle()
    await vi.advanceTimersByTimeAsync(1 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(3)
  })

  it('distill 回执 ok:false → 静默不通知不重试；新 settle 重新武装（水位线未推进口径）', async () => {
    const h = createHarness({
      receipt: receipt({ ok: false, reason: 'model_failed', inserted: 0, sampledTurns: 4 }),
    })
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
    // 不重试：不 settle 就没有第二次触发。
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    // 失败后下一次合格 settle 重新武装，并重新读取水位线预演。
    h.settle()
    expect(h.countUnextractedTurns).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(2)
  })

  it('distill 抛出意外异常 → 不冒泡不通知', async () => {
    const h = createHarness({ receipt: new Error('unexpected boom') })
    h.settle()
    // 触发器内部 catch 全部异常：推进定时器不产生未处理拒绝。
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('零产出（inserted=0）→ 不发通知', async () => {
    const h = createHarness({ receipt: receipt({ inserted: 0, duplicates: 2 }) })
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('dispose 清理定时器：武装后销毁不再触发', async () => {
    const h = createHarness()
    h.settle()
    h.trigger.dispose()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
  })

  it('minTurns 存 0 → 钳到下限 1，空预演仍被拦截（护栏不失效）', async () => {
    const h = createHarness({ unextracted: 0 })
    h.settings['extract/milestoneMinTurns'] = 0
    h.settle()
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(h.distill).not.toHaveBeenCalled()
  })

  it('容量逐出最旧防抖时清除其定时器（无孤儿定时器）', async () => {
    const h = createHarness()
    const settleSession = (id: string) =>
      h.trigger.onTurnSettled({
        sessionId: id,
        turnId: `t-${id}`,
        assistantTurnText: DELIVERED_TEXT,
      })
    for (let i = 0; i < 500; i++) settleSession(`s-${i}`)
    settleSession('s-new') // 容量满：逐出最旧的 s-0
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    const fired = h.distill.mock.calls.map((call) => call[0] as string)
    expect(fired).not.toContain('s-0')
    expect(fired).toContain('s-new')
  })

  it('onTurnSettled 内部异常不冒泡（预演函数抛错）', () => {
    const h = createHarness()
    h.countUnextractedTurns.mockImplementation(() => {
      throw new Error('probe boom')
    })
    expect(() => h.settle()).not.toThrow()
  })
})
