import type { ActiveExecution } from '../../sdk/engine-executor.js'

/**
 * TurnRegistry —— turn 所有权状态的唯一管理者（W2-D1）。
 *
 * SessionService 此前用 6 个散落的私有集合管理「一个 turn 从启动到回收」的
 * 所有权（activeLoops / runningTurnIds / startingSessions / startingTurnIds /
 * cancelledTurnIds / activeExecutionPromises），112 个读写点五方交叉，正确的
 * 操作方式只能靠读上万行代码领悟。本类把六个集合封装为私有，只暴露语义明确
 * 的窄方法 —— 每个方法体都是对既有原语操作的逐字搬运（机械迁移，时序不变），
 * 行为由 turn-pipeline-baseline / turn-pipeline-lifecycle 两组行为锁钉死。
 *
 * 三条不变式（I1~I3，违反即产生幽灵事件或并发超限）：
 *   I1 注册先于执行：registerExecutor 必须发生在 executeTurn 之前
 *      —— 事件闸门靠 activeLoops 的引用相等判定丢弃迟到事件。
 *   I2 回收守恒：finally 的 releaseExecutorIfOwned 用引用相等防止旧 executor
 *      回收掉新 executor 的所有权。
 *   I3 并发计数恒等式：inflightSessionCount() = 活动执行器 + starting 过渡态，
 *      三处消费点（dispatchTurn 入口闸 / startNextQueuedTurn / 全局调度）共用。
 */
export interface TrackedExecution {
  sessionId: string
  promise: Promise<void>
}

export class TurnRegistry {
  private readonly loops = new Map<string, ActiveExecution>()
  private readonly executionPromises = new Map<ActiveExecution, TrackedExecution>()
  private readonly startingSessions = new Set<string>()
  private readonly startingTurnIds = new Map<string, string>()
  private readonly runningTurnIds = new Map<string, string>()
  private readonly cancelledTurnIds = new Set<string>()

  /** 事件闸门只读视图（shouldAcceptSessionExecutorEvent 直接消费，禁止写回）。 */
  get activeLoops(): ReadonlyMap<string, ActiveExecution> {
    return this.loops
  }

  /** 已取消 turn 只读视图（同上，供纯函数判定迟到事件）。 */
  get cancelledTurns(): ReadonlySet<string> {
    return this.cancelledTurnIds
  }

  // ── 启动簿记（executor 注册前的 async preflight 窗口）──────────────────────

  /** startTurn / startNextQueuedTurn 决定起跑时登记过渡态（并发计数含 starting）。 */
  beginStarting(sessionId: string, turnId: string): void {
    this.startingSessions.add(sessionId)
    this.startingTurnIds.set(sessionId, turnId)
  }

  /**
   * startTurn 的 finally 收尾三联：本 turn 仍持有 starting 登记时，摘除
   * starting 双集合并解除取消标记（starting 窗口内被取消的 turn 到此终结）。
   */
  finishStarting(sessionId: string, turnId: string): void {
    if (this.startingTurnIds.get(sessionId) === turnId) {
      this.startingTurnIds.delete(sessionId)
      this.startingSessions.delete(sessionId)
      this.cancelledTurnIds.delete(turnId)
    }
  }

  /**
   * startNextQueuedTurn 外层 finally 的清理变体：**无条件**摘除 startingSessions
   * （startTurn 内部 finally 的守卫清理已跑过一次，这里按现状语义做防御性双保险），
   * startingTurnIds / 取消标记仍带 turnId 守卫。
   */
  finishStartingForce(sessionId: string, turnId: string): void {
    this.startingSessions.delete(sessionId)
    if (this.startingTurnIds.get(sessionId) === turnId) {
      this.startingTurnIds.delete(sessionId)
    }
    this.cancelledTurnIds.delete(turnId)
  }

  /** 会话清除（clearSessionMemory）用：无条件摘除该会话的全部 starting 登记。 */
  clearStartingEntries(sessionId: string): void {
    this.startingSessions.delete(sessionId)
    this.startingTurnIds.delete(sessionId)
  }

  getStartingTurnId(sessionId: string): string | undefined {
    return this.startingTurnIds.get(sessionId)
  }

  isSessionStarting(sessionId: string): boolean {
    return this.startingSessions.has(sessionId)
  }

  // ── 执行注册与所有权（I1：注册先于 executeTurn）────────────────────────────

  /** executor 就绪、即将发起 executeTurn 时登记所有权（两引擎路径对称调用）。 */
  registerExecutor(sessionId: string, turnId: string, executor: ActiveExecution): void {
    this.loops.set(sessionId, executor)
    this.runningTurnIds.set(sessionId, turnId)
  }

  executorFor(sessionId: string): ActiveExecution | undefined {
    return this.loops.get(sessionId)
  }

  runningTurnId(sessionId: string): string | undefined {
    return this.runningTurnIds.get(sessionId)
  }

  hasActiveSession(sessionId: string): boolean {
    return this.loops.has(sessionId)
  }

  /** 事件闸门同款判定：该 executor 是否仍持有此会话的所有权。 */
  isActiveExecutor(sessionId: string, executor: ActiveExecution): boolean {
    return this.loops.get(sessionId) === executor
  }

  /**
   * 并发计数恒等式（I3）：活动执行器数 + starting 过渡态数。
   * 消费点：dispatchTurn 入口闸、startNextQueuedTurn、schedulePendingQueuesGlobally。
   */
  inflightSessionCount(): number {
    return this.loops.size + this.startingSessions.size
  }

  // ── 回收（I2：引用相等守恒）────────────────────────────────────────────────

  /**
   * turn 收尾（finally / 启动早退路径）的守恒回收：仅当 executor 仍持有该会话
   * 所有权时摘除；runningTurnIds 仅在仍指向本 turn 时摘除。返回是否实际释放
   * （调用方据此决定是否推进队列）。
   */
  releaseExecutorIfOwned(sessionId: string, turnId: string, executor: ActiveExecution): boolean {
    if (this.loops.get(sessionId) !== executor) return false
    this.loops.delete(sessionId)
    if (this.runningTurnIds.get(sessionId) === turnId) this.runningTurnIds.delete(sessionId)
    return true
  }

  /**
   * cancelTurn 的强制回收：用户显式取消时无条件摘除（cancel 语义优先于守恒）。
   */
  forceRelease(sessionId: string, turnId: string | undefined): void {
    this.loops.delete(sessionId)
    if (turnId != null && this.runningTurnIds.get(sessionId) === turnId) {
      this.runningTurnIds.delete(sessionId)
    }
  }

  // ── 取消标记（迟到事件闸门）────────────────────────────────────────────────

  markTurnCancelled(turnId: string): void {
    this.cancelledTurnIds.add(turnId)
  }

  isTurnCancelled(turnId: string): boolean {
    return this.cancelledTurnIds.has(turnId)
  }

  /** turn 收尾 finally：解除取消标记，防止集合随时间无限增长。 */
  forgetTurnCancelled(turnId: string): void {
    this.cancelledTurnIds.delete(turnId)
  }

  // ── fire-and-forget 执行追踪（dispose 等待）────────────────────────────────

  trackExecution(executor: ActiveExecution, tracked: TrackedExecution): void {
    this.executionPromises.set(executor, tracked)
  }

  untrackExecution(executor: ActiveExecution): void {
    this.executionPromises.delete(executor)
  }

  /** dispose 用：全部在飞执行（含 sessionId 与 promise）的快照。 */
  trackedExecutions(): Array<{ executor: ActiveExecution } & TrackedExecution> {
    return [...this.executionPromises.entries()].map(([executor, tracked]) => ({
      executor,
      sessionId: tracked.sessionId,
      promise: tracked.promise,
    }))
  }

  // ── 全局操作（dispose）─────────────────────────────────────────────────────

  /** dispose 用：全部持有所有权的执行器快照（调用方逐个 cancel）。 */
  snapshotExecutors(): ActiveExecution[] {
    return [...this.loops.values()]
  }

  /** dispose 用：六集合一次性清空（此后所有事件被闸门丢弃）。 */
  clearAll(): void {
    this.loops.clear()
    this.executionPromises.clear()
    this.startingSessions.clear()
    this.startingTurnIds.clear()
    this.runningTurnIds.clear()
    this.cancelledTurnIds.clear()
  }
}
