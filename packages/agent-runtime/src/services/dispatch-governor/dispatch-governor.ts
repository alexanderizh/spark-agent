/**
 * @module dispatch-governor
 *
 * DispatchGovernor —— 全局成员派发并发闸门（M0 物理层，不依赖监控模块）。
 *
 * 设计要点（方案 §4 + 影响分析 §3/§4 结论）：
 *  - 双池防死锁：主池（depth=0 且非 peer call）+ 嵌套池（depth>0 或 countAsPeerCall）。
 *    同步 peer call（recordPeerMessage 强制 currentDepth:0 绕过嵌套校验）经
 *    countAsPeerCall===true 判别走嵌套池，消除主池死锁洞（影响分析 §3.2-a）。
 *  - 双旋钮语义：totalAgentProcessBudget 为唯一权威。宿主 inflight 计数只读采样，
 *    有效值 = min(inflight, hostInflightCap, budget − minMemberSlots)，保证成员槽
 *    恒 ≥ minMemberSlots（默认 3），且总占用（宿主计数 + 成员 permit）≤ budget。
 *  - FIFO 跨会话公平排队；120s 排队超时拒绝（消息含可行动建议）；
 *    嵌套池 15s 兜底放行（同时在逃 escape ≤2）防死锁等死。
 *  - AbortSignal 贯穿：等待 permit 期间 turn 取消要能退出排队。
 *  - permit 转移防超发：容量收缩（宿主 turn 增加）只影响新准入，不撤销在逃 permit；
 *    释放时按 FIFO 唤醒。
 */

import { createLogger } from '@spark/shared'
import {
  normalizeDispatchGovernanceConfig,
  type WorkflowExecutionGovernance,
} from './governance-config.js'
import type {
  DispatchGateError,
  DispatchGatePermit,
  DispatchGovernanceConfig,
  DispatchGovernorDiagnostics,
  DispatchGatePool,
  DispatchSource,
} from './types.js'
import { DispatchGateError as GateError } from './types.js'

const log = createLogger('dispatch-governor')

/** 全局同时在逃的嵌套兜底放行上限（方案 §4.1-4「全局同时在逃 ≤2」）。 */
const MAX_CONCURRENT_ESCAPES = 2
/** 容量回升轮询周期：宿主 inflight 下降没有显式通知点，靠低频 pump 兜底唤醒。 */
const HOUSEKEEPING_INTERVAL_MS = 1_000

export interface DispatchGovernorAcquireArgs {
  dispatchId: string
  sessionId: string
  turnId: string
  /** 派发深度（run ctx.currentDepth）。0 = Host 首层。 */
  depth: number
  /** true = 同步 peer call（发起者已持 permit，等待目标回复）。 */
  peerCall: boolean
  /** 派发来源显式标记（诊断可观测；M2 降级矩阵消费）。 */
  dispatchSource: DispatchSource
  /** turn 级取消信号；排队中 abort 会退出队列。 */
  signal?: AbortSignal
}

export interface DispatchGovernorOptions {
  /** 初始配置（局部即可，内部 normalize）。 */
  config?: Partial<DispatchGovernanceConfig> | DispatchGovernanceConfig
  /** 宿主 inflight 会话计数只读采样（接线 turnRegistry.inflightSessionCount）。 */
  getHostInflightCount?: () => number
}

interface Waiter {
  dispatchId: string
  sessionId: string
  enqueuedAt: number
  resolve: (permit: DispatchGatePermit) => void
  reject: (err: DispatchGateError) => void
  onAbort: (() => void) | null
  abortSignal: AbortSignal | null
  /** 排队超时/兜底放行计时器句柄。 */
  timer: ReturnType<typeof setTimeout> | null
  /** true = 该等待者已出队（被 grant / reject / escape），清理用。 */
  settled: boolean
}

interface ActivePermit {
  pool: DispatchGatePool
  escaped: boolean
  released: boolean
  interrupt: (() => void) | null
}

function levelOrder(level: string): number {
  // M2 压力联动预留的档位序（nominal < warning < critical < emergency）
  switch (level) {
    case 'warning':
      return 1
    case 'critical':
      return 2
    case 'emergency':
      return 3
    default:
      return 0
  }
}

export class DispatchGovernor {
  private config: DispatchGovernanceConfig
  private readonly getHostInflightCount: (() => number) | null
  /** FIFO 等待队列（队首 = 最早到达）。 */
  private readonly mainWaiters: Waiter[] = []
  private readonly nestedWaiters: Waiter[] = []
  /** 在逃 permit 簿记：dispatchId → 明细。 */
  private readonly activePermits = new Map<string, ActivePermit>()
  private mainInUse = 0
  private nestedInUse = 0
  private escapeInFlight = 0
  private shuttingDown = false
  private housekeepingTimer: ReturnType<typeof setInterval> | null = null
  private readonly counters = {
    acquisitions: 0,
    releases: 0,
    gateTimeouts: 0,
    canceledWhileWaiting: 0,
    escapeGrants: 0,
  }
  /** M2 预留：当前压力档位（缺省恒 nominal = 纯上限模式）。本轮仅存储可观测。 */
  private pressureLevel: 'nominal' | 'warning' | 'critical' | 'emergency' = 'nominal'

  constructor(options: DispatchGovernorOptions = {}) {
    this.config = normalizeDispatchGovernanceConfig(options.config ?? {})
    this.getHostInflightCount = options.getHostInflightCount ?? null
  }

  // ── 准入 ────────────────────────────────────────────────────────────────────

  /**
   * 获取一次成员执行的准入许可。
   *
   * - disabled：立即放行（不计数，行为等同未挂闸门）。
   * - 主池：FIFO 排队，容量满时等待；gateWaitTimeoutMs 超时抛 DispatchGateError('timeout')。
   * - 嵌套池（depth>0 或 peerCall）：排队 deadlockEscapeAfterMs 后仍未获得则兜底放行
   *   （escapeInFlight < 2 时），否则继续等待。
   * - signal abort / dispose：以对应 kind 抛 DispatchGateError 退出排队。
   */
  async acquire(args: DispatchGovernorAcquireArgs): Promise<DispatchGatePermit> {
    if (this.shuttingDown) {
      throw new GateError(
        'shutdown',
        'Dispatch governor is shutting down; member dispatch is no longer accepted.',
      )
    }
    if (!this.config.enabled) {
      // 关闭态直通：仍按派发形态标注池归属（诊断口径一致），但不占配额判定路径
      // ——acquire 不入队，计数对 enabled 时的泵逻辑无影响（release 对称递减）。
      const pool: DispatchGatePool = args.depth > 0 || args.peerCall ? 'nested' : 'main'
      return this.grant(args.dispatchId, pool, false)
    }
    if (args.signal?.aborted) {
      throw new GateError('canceled', 'Dispatch was canceled before entering the concurrency gate.')
    }
    const pool: DispatchGatePool = args.depth > 0 || args.peerCall ? 'nested' : 'main'
    return new Promise<DispatchGatePermit>((resolve, reject) => {
      const waiter: Waiter = {
        dispatchId: args.dispatchId,
        sessionId: args.sessionId,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        onAbort: null,
        abortSignal: args.signal ?? null,
        timer: null,
        settled: false,
      }
      const queue = pool === 'main' ? this.mainWaiters : this.nestedWaiters
      queue.push(waiter)
      if (args.signal != null) {
        waiter.onAbort = () => {
          this.settleWaiter(waiter, queue, () =>
            reject(
              new GateError(
                'canceled',
                'Dispatch was canceled while waiting for a concurrency slot.',
              ),
            ),
          )
          this.counters.canceledWhileWaiting += 1
        }
        args.signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      if (pool === 'main') {
        waiter.timer = setTimeout(() => {
          this.settleWaiter(waiter, this.mainWaiters, () => {
            this.counters.gateTimeouts += 1
            log.warn('[dispatch-governor] gate wait timeout', {
              dispatchId: args.dispatchId,
              sessionId: args.sessionId,
              turnId: args.turnId,
              waitedMs: Date.now() - waiter.enqueuedAt,
              waiting: this.mainWaiters.length,
            })
            reject(
              new GateError(
                'timeout',
                `Concurrency gate: timed out after ${this.config.gateWaitTimeoutMs}ms waiting for a member execution slot (${this.mainWaiters.length} dispatch(es) still waiting, budget ${this.config.totalAgentProcessBudget}). ` +
                  'Reduce parallelism (fewer members per batch / lower subagent parallelism), or retry this dispatch later — long-running members must finish before new ones can start.',
              ),
            )
          })
        }, this.config.gateWaitTimeoutMs)
        if (typeof waiter.timer.unref === 'function') waiter.timer.unref()
      } else {
        waiter.timer = setTimeout(() => {
          this.maybeEscapeNestedWaiter(waiter)
        }, this.config.deadlockEscapeAfterMs)
        if (typeof waiter.timer.unref === 'function') waiter.timer.unref()
      }
      this.ensureHousekeeping()
      // 入队后立即泵一次：空闲容量直接授予（严格 FIFO——队首优先，本 waiter 即队首时等价直通）。
      this.pumpQueues()
    })
  }

  /** 嵌套池兜底放行：15s 仍未获得且在逃 escape 未达上限时强制授予。 */
  private maybeEscapeNestedWaiter(waiter: Waiter): void {
    if (waiter.settled) return
    if (this.escapeInFlight >= MAX_CONCURRENT_ESCAPES) {
      // 极端饱和：已有 2 个兜底 permit 在逃。继续排队（下一轮 housekeeping 再试），
      // 并重设计时器，保持「acquire 超时不死等」的兜底语义。
      waiter.timer = setTimeout(() => this.maybeEscapeNestedWaiter(waiter), 1_000)
      if (typeof waiter.timer.unref === 'function') waiter.timer.unref()
      return
    }
    this.settleWaiter(waiter, this.nestedWaiters, () => {
      this.escapeInFlight += 1
      this.counters.escapeGrants += 1
      log.warn('[dispatch-governor] nested-pool deadlock escape granted', {
        dispatchId: waiter.dispatchId,
        sessionId: waiter.sessionId,
        waitedMs: Date.now() - waiter.enqueuedAt,
        escapeInFlight: this.escapeInFlight,
      })
      waiter.resolve(this.grant(waiter.dispatchId, 'nested', true))
    })
  }

  /** 出队结算（grant / reject / escape 共用）：清监听、清计时器、从队列摘除。 */
  private settleWaiter(waiter: Waiter, queue: Waiter[], finalize: () => void): void {
    if (waiter.settled) return
    waiter.settled = true
    if (waiter.timer != null) clearTimeout(waiter.timer)
    if (waiter.onAbort != null && waiter.abortSignal != null) {
      waiter.abortSignal.removeEventListener('abort', waiter.onAbort)
    }
    const index = queue.indexOf(waiter)
    if (index >= 0) queue.splice(index, 1)
    finalize()
  }

  /** 授予 permit（disabled 直通 / 排队泵出 / 兜底放行共用）。 */
  private grant(dispatchId: string, pool: DispatchGatePool, escaped: boolean): DispatchGatePermit {
    const entry: ActivePermit = { pool, escaped, released: false, interrupt: null }
    // 同一 dispatchId 重复 acquire 属调用方 bug，后写覆盖并按新 permit 计数；
    // release 幂等保证不会双重递减。
    this.activePermits.set(dispatchId, entry)
    this.counters.acquisitions += 1
    // escape permit 是「溢出通行」，不挤占嵌套池标称配额（escape 上限独立判定，
    // 全局同时在逃 ≤2）——否则 15s 兜底放行会反过来饿死后续常规准入。
    if (entry.pool === 'nested' && !entry.escaped) this.nestedInUse += 1
    else if (entry.pool === 'main') this.mainInUse += 1
    let released = false
    return {
      dispatchId,
      pool: entry.pool,
      escaped: entry.escaped,
      release: () => {
        if (released || entry.released) return
        released = true
        entry.released = true
        this.activePermits.delete(dispatchId)
        this.counters.releases += 1
        if (entry.pool === 'nested') {
          if (entry.escaped) this.escapeInFlight = Math.max(0, this.escapeInFlight - 1)
          else this.nestedInUse = Math.max(0, this.nestedInUse - 1)
        } else {
          this.mainInUse = Math.max(0, this.mainInUse - 1)
        }
        this.pumpQueues()
      },
      bindInterrupt: (callback: () => void) => {
        entry.interrupt = callback
      },
    }
  }

  // ── 容量与队列泵 ─────────────────────────────────────────────────────────────

  /** 宿主 inflight 只读采样（拿不到回调时按 0 计，闸门退化为纯成员预算）。 */
  private sampleHostInflight(): number {
    try {
      const value = this.getHostInflightCount?.()
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 0
    } catch {
      return 0
    }
  }

  /** 计入主池占用的宿主计数：min(inflight, cap, budget − minMemberSlots)。 */
  hostEffectiveCount(): number {
    const inflight = this.sampleHostInflight()
    const budgetReserve = Math.max(
      this.config.totalAgentProcessBudget - this.config.minMemberSlots,
      0,
    )
    return Math.min(inflight, this.config.hostInflightCap, budgetReserve)
  }

  /**
   * 主池成员槽容量 = min(预算 − 宿主有效占用, maxMemberDispatches)。
   * 双旋钮语义：预算是唯一权威上限，maxMemberDispatches 是成员侧硬顶。
   * 容量收缩只影响新准入（在逃 permit 不撤销）。
   */
  mainCapacity(): number {
    const byBudget = Math.max(this.config.totalAgentProcessBudget - this.hostEffectiveCount(), 0)
    return Math.min(byBudget, this.config.maxMemberDispatches)
  }

  /**
   * 按序授予等待者直到容量用尽。主池严格 FIFO；嵌套池按到达序。
   * release / reconfigure / 周期 housekeeping 共用此入口。
   */
  private pumpQueues(): void {
    while (this.nestedWaiters.length > 0 && this.nestedInUse < this.config.nestedDispatchSlots) {
      const waiter = this.nestedWaiters[0]!
      this.settleWaiter(waiter, this.nestedWaiters, () => {
        waiter.resolve(this.grant(waiter.dispatchId, 'nested', false))
      })
    }
    while (this.mainWaiters.length > 0 && this.mainInUse < this.mainCapacity()) {
      const waiter = this.mainWaiters[0]!
      this.settleWaiter(waiter, this.mainWaiters, () => {
        waiter.resolve(this.grant(waiter.dispatchId, 'main', false))
      })
    }
  }

  private ensureHousekeeping(): void {
    if (this.housekeepingTimer != null || this.shuttingDown) return
    this.housekeepingTimer = setInterval(() => {
      if (this.shuttingDown) return
      // 宿主 inflight 下降 → 容量回升 → 唤醒等待者（无显式通知点，靠轮询兜底）。
      this.pumpQueues()
      // 嵌套等待者重试兜底放行判定（escape 槽位释放后）。
      if (
        this.nestedWaiters.length > 0 &&
        Date.now() - this.nestedWaiters[0]!.enqueuedAt >= this.config.deadlockEscapeAfterMs
      ) {
        this.maybeEscapeNestedWaiter(this.nestedWaiters[0]!)
      }
    }, HOUSEKEEPING_INTERVAL_MS)
    if (typeof this.housekeepingTimer.unref === 'function') this.housekeepingTimer.unref()
  }

  // ── 配置热更新 / 生命周期 ────────────────────────────────────────────────────

  /** 设置热更新入口：局部归一合并，容量变化立即泵队列。 */
  reconfigure(raw: unknown): DispatchGovernanceConfig {
    const previous = this.config
    const next = normalizeDispatchGovernanceConfig({
      ...previous,
      ...(raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}),
    })
    this.config = next
    if (previous.enabled && !next.enabled) {
      // 开→关：放行全部等待者（disabled 语义 = 无闸门）。
      for (const waiter of [...this.mainWaiters]) {
        this.settleWaiter(waiter, this.mainWaiters, () =>
          waiter.resolve(this.grant(waiter.dispatchId, 'main', false)),
        )
      }
      for (const waiter of [...this.nestedWaiters]) {
        this.settleWaiter(waiter, this.nestedWaiters, () =>
          waiter.resolve(this.grant(waiter.dispatchId, 'nested', false)),
        )
      }
    }
    this.pumpQueues()
    log.info('[dispatch-governor] reconfigured', {
      enabled: next.enabled,
      budget: next.totalAgentProcessBudget,
      nestedSlots: next.nestedDispatchSlots,
    })
    return next
  }

  /** M2 预留：压力联动入口（ResourceMonitor → governor）。本轮只记录档位。 */
  setPressureLevel(level: 'nominal' | 'warning' | 'critical' | 'emergency'): void {
    if (this.pressureLevel === level) return
    this.pressureLevel = level
    log.warn('[dispatch-governor] pressure level changed (M2 linkage pending)', {
      level,
      order: levelOrder(level),
    })
  }

  /** M2 预留：按池枚举在逃 permit 的中断回调（受害者选择用）。本轮不调用。 */
  activeDispatchIds(pool?: DispatchGatePool): string[] {
    const ids: string[] = []
    for (const [dispatchId, entry] of this.activePermits) {
      if (pool == null || entry.pool === pool) ids.push(dispatchId)
    }
    return ids
  }

  /** 触发某 dispatch 的中断回调（M2 熔断将复用；当前仅供测试验证 bindInterrupt 链路）。 */
  interrupt(dispatchId: string): boolean {
    const entry = this.activePermits.get(dispatchId)
    if (entry == null || entry.interrupt == null) return false
    entry.interrupt()
    return true
  }

  diagnostics(): DispatchGovernorDiagnostics {
    return {
      enabled: this.config.enabled,
      config: this.config,
      hostInflightCount: this.sampleHostInflight(),
      hostEffectiveCount: this.hostEffectiveCount(),
      mainCapacity: this.mainCapacity(),
      mainInUse: this.mainInUse,
      mainWaiting: this.mainWaiters.length,
      nestedSlots: this.config.nestedDispatchSlots,
      nestedInUse: this.nestedInUse,
      nestedWaiting: this.nestedWaiters.length,
      escapeInFlight: this.escapeInFlight,
      counters: { ...this.counters },
    }
  }

  dispose(): void {
    if (this.shuttingDown) return
    this.shuttingDown = true
    if (this.housekeepingTimer != null) {
      clearInterval(this.housekeepingTimer)
      this.housekeepingTimer = null
    }
    for (const waiter of [...this.mainWaiters]) {
      this.settleWaiter(waiter, this.mainWaiters, () =>
        waiter.reject(
          new GateError('shutdown', 'Dispatch governor disposed while dispatch was queued.'),
        ),
      )
    }
    for (const waiter of [...this.nestedWaiters]) {
      this.settleWaiter(waiter, this.nestedWaiters, () =>
        waiter.reject(
          new GateError('shutdown', 'Dispatch governor disposed while dispatch was queued.'),
        ),
      )
    }
  }

  get disposed(): boolean {
    return this.shuttingDown
  }
}

export { DispatchGateError } from './types.js'
export type {
  DispatchGatePermit,
  DispatchGovernanceConfig,
  DispatchGovernorDiagnostics,
  DispatchGatePool,
  DispatchGateRejectionKind,
  DispatchSource,
} from './types.js'
