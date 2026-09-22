/**
 * DispatchGovernor 单测（M0 物理闸门）。
 *
 * 覆盖：并发上限/双旋钮（预算唯一权威 + 宿主封顶 + 成员硬顶）、FIFO 跨会话
 * 公平排队、嵌套池 15s 兜底放行、主池 120s 超时拒绝、AbortSignal 退出排队、
 * peer call 嵌套池死锁场景（饱和态同步咨询不互等）、reconfigure 热更新、
 * disabled 直通、dispose。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DispatchGovernor } from './dispatch-governor.js'
import { DispatchGateError } from './types.js'

function makeGovernor(
  overrides: {
    config?: Record<string, unknown>
    inflight?: number
  } = {},
): DispatchGovernor {
  return new DispatchGovernor({
    ...(overrides.config != null ? { config: overrides.config } : {}),
    getHostInflightCount: () => overrides.inflight ?? 0,
  })
}

function acquireArgs(overrides: Partial<Parameters<DispatchGovernor['acquire']>[0]> = {}) {
  return {
    dispatchId: `d-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 's1',
    turnId: 't1',
    depth: 0,
    peerCall: false,
    dispatchSource: 'host' as const,
    ...overrides,
  }
}

describe('DispatchGovernor 主池并发上限', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('成员准入数不超过 min(budget − 宿主有效占用, maxMemberDispatches)', async () => {
    const governor = makeGovernor({ inflight: 0 })
    // budget=8, maxMemberDispatches=6 → 无宿主占用时容量 6（成员硬顶生效）
    const permits = []
    for (let i = 0; i < 8; i++) {
      const promise = governor.acquire(acquireArgs({ dispatchId: `d${i}` }))
      await vi.advanceTimersByTimeAsync(0)
      permits.push(promise)
    }
    const diag = governor.diagnostics()
    expect(diag.mainInUse).toBe(6)
    expect(diag.mainWaiting).toBe(2)
    expect(diag.mainCapacity).toBe(6)
    // 前 6 个已授予，后 2 个在等
    const settled = await Promise.allSettled(permits.slice(0, 6))
    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true)
  })

  it('宿主占用计入预算：min(inflight, hostInflightCap, budget − minMemberSlots) 封顶', async () => {
    // 6 个宿主会话在跑：有效占用 = min(6,5,5)=5，成员槽 = min(8−5,6)=3（下限保证 ≥3）
    const governor = makeGovernor({ inflight: 6 })
    const promises: Array<Promise<unknown>> = []
    for (let i = 0; i < 5; i++) {
      promises.push(governor.acquire(acquireArgs({ dispatchId: `d${i}` })))
      await vi.advanceTimersByTimeAsync(0)
    }
    const diag = governor.diagnostics()
    expect(diag.hostInflightCount).toBe(6)
    expect(diag.hostEffectiveCount).toBe(5)
    expect(diag.mainCapacity).toBe(3)
    expect(diag.mainInUse).toBe(3)
    expect(diag.mainWaiting).toBe(2)
  })

  it('宿主占用下降后容量回升，等待者被唤醒（housekeeping）', async () => {
    let inflight = 4
    const governor = new DispatchGovernor({ getHostInflightCount: () => inflight })
    // budget 8 − 4 占用 = 4 容量；先占满，再发等待者
    const held: Array<Awaited<ReturnType<DispatchGovernor['acquire']>>> = []
    for (let i = 0; i < 4; i++) {
      held.push(await governor.acquire(acquireArgs({ dispatchId: `d${i}` })))
    }
    const waiting = governor.acquire(acquireArgs({ dispatchId: 'd-wait' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(governor.diagnostics().mainWaiting).toBe(1)
    // 宿主全部退出 → 容量回到 min(8,6)=6 → 等待者经 housekeeping 唤醒
    inflight = 0
    await vi.advanceTimersByTimeAsync(1_100)
    const permit = await waiting
    permit.release()
    held.forEach((p) => p.release())
  })

  it('release 归还容量并按 FIFO 唤醒队首（跨会话公平）', async () => {
    const governor = makeGovernor({ config: { maxMemberDispatches: 1 } })
    const first = await governor.acquire(acquireArgs({ dispatchId: 'd-a', sessionId: 's-a' }))
    const order: string[] = []
    const p1 = governor.acquire(acquireArgs({ dispatchId: 'd-b', sessionId: 's-b' })).then((p) => {
      order.push('b')
      return p
    })
    const p2 = governor.acquire(acquireArgs({ dispatchId: 'd-c', sessionId: 's-c' })).then((p) => {
      order.push('c')
      return p
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual([])
    first.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['b'])
    ;(await p1).release()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['b', 'c'])
    ;(await p2).release()
  })
})

describe('DispatchGovernor 主池排队超时', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('120s 超时拒绝且消息含可行动建议', async () => {
    const governor = makeGovernor({ config: { maxMemberDispatches: 1 } })
    await governor.acquire(acquireArgs({ dispatchId: 'd-held' }))
    const promise = governor.acquire(acquireArgs({ dispatchId: 'd-wait' }))
    const expectation = expect(promise).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(DispatchGateError)
      const gateError = err as DispatchGateError
      expect(gateError.kind).toBe('timeout')
      expect(gateError.message).toMatch(/Reduce parallelism/)
      return true
    })
    await vi.advanceTimersByTimeAsync(120_000)
    await expectation
    expect(governor.diagnostics().counters.gateTimeouts).toBe(1)
  })

  it('AbortSignal 取消等待中的 acquire', async () => {
    const governor = makeGovernor({ config: { maxMemberDispatches: 1 } })
    await governor.acquire(acquireArgs({ dispatchId: 'd-held' }))
    const controller = new AbortController()
    const promise = governor.acquire(
      acquireArgs({ dispatchId: 'd-wait', signal: controller.signal }),
    )
    const expectation = expect(promise).rejects.toSatisfy((err: unknown) => {
      expect((err as DispatchGateError).kind).toBe('canceled')
      return true
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expectation
    expect(governor.diagnostics().counters.canceledWhileWaiting).toBe(1)
  })
})

describe('DispatchGovernor 嵌套池与 peer call 死锁消除', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('depth>0 与 peerCall 走嵌套池（不占主池容量）', async () => {
    const governor = makeGovernor()
    const nestedDepth = await governor.acquire(acquireArgs({ dispatchId: 'd-depth', depth: 1 }))
    const peerCall = await governor.acquire(
      acquireArgs({ dispatchId: 'd-peer', depth: 0, peerCall: true, dispatchSource: 'peer-call' }),
    )
    const diag = governor.diagnostics()
    expect(diag.nestedInUse).toBe(2)
    expect(diag.mainInUse).toBe(0)
    nestedDepth.release()
    peerCall.release()
  })

  it('嵌套池满 15s 后兜底放行（escape），在逃 escape ≤2 且不挤占标称配额', async () => {
    const governor = makeGovernor({ config: { nestedDispatchSlots: 1 } })
    const held = await governor.acquire(acquireArgs({ dispatchId: 'd-n0', depth: 1 }))
    const p1 = governor.acquire(acquireArgs({ dispatchId: 'd-n1', depth: 1 }))
    const p2 = governor.acquire(acquireArgs({ dispatchId: 'd-n2', depth: 1 }))
    const p3 = governor.acquire(acquireArgs({ dispatchId: 'd-n3', depth: 1 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(governor.diagnostics().nestedWaiting).toBe(3)
    await vi.advanceTimersByTimeAsync(15_000)
    // 15s：前两个兜底放行（全局同时在逃上限 2），第三个继续等待
    expect(governor.diagnostics().escapeInFlight).toBe(2)
    expect(governor.diagnostics().nestedWaiting).toBe(1)
    const escaped1 = await p1
    const escaped2 = await p2
    expect(escaped1.escaped).toBe(true)
    expect(escaped2.escaped).toBe(true)
    // escape 是溢出通行：不占标称配额 → 常规持有者释放后 p3 立即获得常规 permit
    held.release()
    await vi.advanceTimersByTimeAsync(0)
    const granted = await p3
    expect(granted.escaped).toBe(false)
    escaped1.release()
    escaped2.release()
    granted.release()
    expect(governor.diagnostics().counters.escapeGrants).toBe(2)
  })

  it('饱和态同步咨询不互等：主池满时 peer call 不进主池队列', async () => {
    // 场景（影响分析 §3.2-a）：全部主池 permit 被「正同步咨询队友的成员」持有，
    // 目标成员的 peer-call 派发若进主池 FIFO 会全队停摆；应立即可用嵌套池。
    const governor = makeGovernor({ config: { maxMemberDispatches: 3 } })
    const members: Array<Awaited<ReturnType<DispatchGovernor['acquire']>>> = []
    for (let i = 0; i < 3; i++) {
      members.push(await governor.acquire(acquireArgs({ dispatchId: `m${i}` })))
    }
    expect(governor.diagnostics().mainInUse).toBe(3)
    // 队友的同步咨询：不排队、立即拿嵌套池 permit
    const peer = await governor.acquire(
      acquireArgs({ dispatchId: 'peer', depth: 0, peerCall: true, dispatchSource: 'peer-call' }),
    )
    expect(peer.pool).toBe('nested')
    peer.release()
    members.forEach((m) => m.release())
  })
})

describe('DispatchGovernor 生命周期与配置', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('disabled 直通：不限流、计数零等待', async () => {
    const governor = makeGovernor({ config: { enabled: false, maxMemberDispatches: 1 } })
    const permits = []
    for (let i = 0; i < 5; i++) {
      permits.push(await governor.acquire(acquireArgs({ dispatchId: `d${i}` })))
    }
    expect(governor.diagnostics().mainWaiting).toBe(0)
    permits.forEach((p) => p.release())
  })

  it('reconfigure 热更新生效并放行开→关的等待者', async () => {
    const governor = makeGovernor({ config: { maxMemberDispatches: 1 } })
    const held = await governor.acquire(acquireArgs({ dispatchId: 'd0' }))
    const waiting = governor.acquire(acquireArgs({ dispatchId: 'd1' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(governor.diagnostics().mainWaiting).toBe(1)
    // 关闭闸门 → 全部等待者放行
    governor.reconfigure({ enabled: false })
    const permit = await waiting
    expect(permit.pool).toBe('main')
    permit.release()
    held.release()
    // 重新收紧后容量生效（budget 8 / hard cap 1 → 容量 1）
    governor.reconfigure({ enabled: true, maxMemberDispatches: 1 })
    const first = await governor.acquire(acquireArgs({ dispatchId: 'd2' }))
    const queued = governor.acquire(acquireArgs({ dispatchId: 'd3' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(governor.diagnostics().mainWaiting).toBe(1)
    first.release()
    await vi.advanceTimersByTimeAsync(0)
    ;(await queued).release()
  })

  it('dispose 拒绝排队中的等待者，之后 acquire 抛 shutdown', async () => {
    const governor = makeGovernor({ config: { maxMemberDispatches: 1 } })
    await governor.acquire(acquireArgs({ dispatchId: 'd0' }))
    const waiting = governor.acquire(acquireArgs({ dispatchId: 'd1' }))
    const disposeExpectation = expect(waiting).rejects.toSatisfy((err: unknown) => {
      expect((err as DispatchGateError).kind).toBe('shutdown')
      return true
    })
    await vi.advanceTimersByTimeAsync(0)
    governor.dispose()
    await disposeExpectation
    await expect(governor.acquire(acquireArgs())).rejects.toSatisfy((err: unknown) => {
      expect((err as DispatchGateError).kind).toBe('shutdown')
      return true
    })
  })

  it('bindInterrupt 回调链路（M2 熔断预留）可用', async () => {
    const governor = makeGovernor()
    const permit = await governor.acquire(acquireArgs({ dispatchId: 'd0' }))
    const interrupt = vi.fn()
    permit.bindInterrupt(interrupt)
    expect(governor.interrupt('d0')).toBe(true)
    expect(interrupt).toHaveBeenCalledOnce()
    expect(governor.interrupt('missing')).toBe(false)
    permit.release()
  })
})
