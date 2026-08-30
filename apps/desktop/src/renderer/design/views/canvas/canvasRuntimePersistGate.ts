/**
 * 任务运行态静默落盘的挂起门闩（gate）。
 *
 * writeTaskRuntimeDb 按「任务回写不新增 dirty」的约定写入热存储（不触发退出拦截与
 * 未保存徽标），代价是：clean 项目的任务终态只存在于热存储，磁盘 latest.json 停留在
 * 最后一次保存时的旧快照（通常仍是 running）。若此时 openSnapshot 走 clean 磁盘加载
 * 分支，会用旧快照整库替换热数据，把已显示的终态与产物覆盖回 loading，并连带污染
 * 退出守卫的 running 计数（幽灵运行任务拦截退出）。
 *
 * gate 的职责：
 * - markPending：项目收到运行态写入后立即挂起，并防抖调度一次单项目静默落盘；
 *   挂起期间 openSnapshot / hydrateFromStorage 不得用磁盘快照覆盖该项目热数据。
 *   clean 项目保存完整热快照；dirty 项目只把运行态字段合并进上次保存的磁盘基线。
 * - clearPersisted：静默落盘成功且期间无新写入（由调用方用 mutation 代次判定），
 *   或全量 flushPersist 已包含该项目时解除挂起。
 * - 落盘失败保留挂起：openSnapshot 继续读热数据，等待下一次回写防抖或任意保存兜底。
 */
export type RuntimePersistHandler = (projectId: string) => Promise<void>

export class CanvasRuntimePersistGate {
  private readonly pending = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private handler: RuntimePersistHandler | null = null

  constructor(private readonly delayMs = 1000) {}

  setHandler(handler: RuntimePersistHandler): void {
    this.handler = handler
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }

  isPending(projectId: string): boolean {
    return this.pending.has(projectId)
  }

  markPending(projectId: string): void {
    this.pending.add(projectId)
    const previous = this.timers.get(projectId)
    if (previous != null) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.timers.delete(projectId)
      void this.flush(projectId)
    }, this.delayMs)
    this.timers.set(projectId, timer)
  }

  /** 放弃修改/离开前立即冲刷当前项目的运行态，不等待防抖计时器。 */
  async flushPending(projectId: string): Promise<void> {
    const timer = this.timers.get(projectId)
    if (timer != null) {
      clearTimeout(timer)
      this.timers.delete(projectId)
    }
    await this.flush(projectId)
  }

  clearPersisted(projectId: string): void {
    this.pending.delete(projectId)
    const timer = this.timers.get(projectId)
    if (timer != null) {
      clearTimeout(timer)
      this.timers.delete(projectId)
    }
  }

  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
    this.inFlight.clear()
  }

  private flush(projectId: string): Promise<void> {
    if (!this.pending.has(projectId)) return Promise.resolve()
    const existing = this.inFlight.get(projectId)
    if (existing) return existing
    const run = (async () => {
      try {
        await this.handler?.(projectId)
      } catch (err) {
        // 静默落盘异常不向上抛：挂起保留，openSnapshot 继续读热数据，后续保存兜底。
        console.error('[canvas] task runtime persist crashed', projectId, err)
      }
    })().finally(() => {
      if (this.inFlight.get(projectId) === run) this.inFlight.delete(projectId)
    })
    this.inFlight.set(projectId, run)
    return run
  }
}
