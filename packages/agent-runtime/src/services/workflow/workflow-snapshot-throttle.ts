/**
 * @module workflow/workflow-snapshot-throttle
 *
 * M4 快照写放大治理（方案 §4.4）：working 快照按 snapshotMinIntervalMs 节流 +
 * trailing 补写，终态（succeeded/failed/cancelled，即 status !== 'working'）快照
 * 永远立即落库。
 *
 * 每个节点完成都会触发快照回调（executor 的节点级实时上报），长跑工作流下
 * 每次快照整包 JSON 覆写 SQLite 形成 O(n²) 写放大；节流把落库频率压到
 * interval 维度，间隔内的 working 快照只保留最新一份作为 trailing 待写，
 * 到期补写——DB 状态最多落后 interval，终态不受影响。
 *
 * 只作用于持久化落库；UI 进度事件不经本节流器（方案 §4.4「UI 进度事件不节流」）。
 * intervalMs <= 0 时全部立即写（行为与现状一致）。
 */

import type { WorkflowRunSnapshot } from '../workflow-executor.js'
import { createLogger } from '@spark/shared'

const log = createLogger('workflow:snapshot-throttle')

export interface WorkflowSnapshotWriteThrottleOptions {
  /** working 快照落库最小间隔；0 或负数 = 不节流。 */
  intervalMs: number
  /** 可注入时钟（测试用 fake timers 之外的即时控制）。 */
  now?: () => number
  /** 可注入调度器（测试用）；返回的句柄需支持 clearTimeout。 */
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

const WORKING_STATUS = 'working'

export class WorkflowSnapshotWriteThrottle {
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly scheduleImpl: (callback: () => void, delayMs: number) => unknown
  private readonly cancelImpl: (handle: unknown) => void

  private lastPersistAt = Number.NEGATIVE_INFINITY
  private pendingSnapshot: WorkflowRunSnapshot | null = null
  private pendingPersist: ((snapshot: WorkflowRunSnapshot) => void) | null = null
  private timerHandle: unknown = null
  private disposed = false

  /** 测试观测：实际落库次数。 */
  persistCount = 0

  constructor(options: WorkflowSnapshotWriteThrottleOptions) {
    this.intervalMs = options.intervalMs
    this.now = options.now ?? (() => Date.now())
    this.scheduleImpl = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancelImpl =
      options.cancel ??
      ((handle) => {
        if (handle != null) clearTimeout(handle as ReturnType<typeof setTimeout>)
      })
  }

  /**
   * 提交一份快照。persist 回调由调用方闭包持有落库逻辑（如
   * runRepo.updateSnapshot）；终态快照立即写并清空 trailing 待写。
   */
  offer(snapshot: WorkflowRunSnapshot, persist: (snapshot: WorkflowRunSnapshot) => void): void {
    if (this.disposed) {
      // 已 dispose 后到达的迟到快照直接落库，宁可多写不可丢终态。
      persist(snapshot)
      this.persistCount += 1
      return
    }
    if (this.intervalMs <= 0 || snapshot.status !== WORKING_STATUS) {
      this.writeNow(snapshot, persist)
      return
    }
    const at = this.now()
    if (at - this.lastPersistAt >= this.intervalMs) {
      this.writeNow(snapshot, persist)
      return
    }
    // 间隔内：合并（只保留最新一份），安排 trailing 补写。
    this.pendingSnapshot = snapshot
    this.pendingPersist = persist
    if (this.timerHandle == null) {
      const delay = Math.max(0, this.lastPersistAt + this.intervalMs - at)
      this.timerHandle = this.scheduleImpl(() => {
        this.timerHandle = null
        this.flushPending()
      }, delay)
    }
  }

  /** 立即写出 trailing 待写（若有）。终态已写或无待写时为 no-op。 */
  flush(): void {
    if (this.timerHandle != null) {
      this.cancelImpl(this.timerHandle)
      this.timerHandle = null
    }
    this.flushPending()
  }

  /** 终止节流：清 timer 并写出剩余待写，之后到达的快照直接落库。 */
  dispose(): void {
    this.flush()
    this.disposed = true
  }

  private flushPending(): void {
    const snapshot = this.pendingSnapshot
    const persist = this.pendingPersist
    this.pendingSnapshot = null
    this.pendingPersist = null
    if (snapshot == null || persist == null) return
    this.doPersist(snapshot, persist)
  }

  private writeNow(
    snapshot: WorkflowRunSnapshot,
    persist: (snapshot: WorkflowRunSnapshot) => void,
  ): void {
    if (this.timerHandle != null) {
      this.cancelImpl(this.timerHandle)
      this.timerHandle = null
    }
    this.pendingSnapshot = null
    this.pendingPersist = null
    this.doPersist(snapshot, persist)
  }

  private doPersist(
    snapshot: WorkflowRunSnapshot,
    persist: (snapshot: WorkflowRunSnapshot) => void,
  ): void {
    this.lastPersistAt = this.now()
    this.persistCount += 1
    try {
      persist(snapshot)
    } catch (error) {
      // 治理组件绝不外抛：本方法会从 trailing timer 回调与 dispose()（调用方
      // finally 中）触发，裸抛会产生未捕获 timer 异常 / 替换工作流原始异常；
      // 落库失败只记日志（DB 停留在旧 working 状态，终态快照由调用方保证）。
      log.error(
        '快照节流落库失败（status=%s）: %s',
        snapshot.status,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
