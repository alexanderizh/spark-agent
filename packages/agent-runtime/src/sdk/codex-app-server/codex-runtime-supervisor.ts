import type { CodexAppServerRuntime } from './codex-app-server-runtime.js'

export interface ManagedCodexRuntime {
  readonly hasExited: boolean
  dispose(): Promise<void>
}

export interface CodexRuntimeLease<T extends ManagedCodexRuntime = CodexAppServerRuntime> {
  readonly runtime: T
  /** true 表示复用了已存在的 initialized runtime。 */
  readonly warm: boolean
  release(options?: { invalidate?: boolean } | undefined): Promise<void>
}

export interface CodexAppServerRuntimeSupervisorOptions {
  idleTtlMs?: number | undefined
  maxRuntimes?: number | undefined
}

type RuntimeEntry<T extends ManagedCodexRuntime> = {
  leaseKey: string
  fingerprint: string
  startPromise: Promise<T>
  runtime: T | null
  leased: boolean
  lastUsedAt: number
  idleTimer: NodeJS.Timeout | null
  waiters: Set<() => void>
}

const DEFAULT_IDLE_TTL_MS = 2 * 60_000
const DEFAULT_MAX_RUNTIMES = 4

/**
 * 第一阶段按 host session / nested member continuity key 独占 runtime 的生命周期管理器。
 *
 * 同 lease key 的 acquire 串行；并发请求共享同一个启动 Promise，但后来的 turn 必须等
 * 当前 lease release。fingerprint 变化、transport 退出或显式 invalidate 都会原子摘除
 * 旧 entry，下一次 acquire 才创建新进程。
 */
export class CodexAppServerRuntimeSupervisor<
  T extends ManagedCodexRuntime = CodexAppServerRuntime,
> {
  private readonly entries = new Map<string, RuntimeEntry<T>>()
  private readonly idleTtlMs: number
  private readonly maxRuntimes: number
  private disposed = false

  constructor(options: CodexAppServerRuntimeSupervisorOptions = {}) {
    this.idleTtlMs = Math.max(0, options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS)
    this.maxRuntimes = Math.max(1, options.maxRuntimes ?? DEFAULT_MAX_RUNTIMES)
  }

  async acquire(
    leaseKey: string,
    fingerprint: string,
    createRuntime: () => Promise<T>,
  ): Promise<CodexRuntimeLease<T>> {
    if (leaseKey.length === 0) throw new Error('codex runtime lease requires a non-empty key')
    for (;;) {
      this.assertActive()
      const existing = this.entries.get(leaseKey)
      if (existing != null) {
        if (existing.leased) {
          await this.waitForEntryChange(existing)
          continue
        }
        const runtime = await this.resolveRuntime(existing)
        if (this.entries.get(leaseKey) !== existing) continue
        if (existing.fingerprint !== fingerprint || runtime.hasExited) {
          await this.removeAndDispose(existing)
          continue
        }
        existing.leased = true
        this.clearIdleTimer(existing)
        return this.createLease(existing, runtime, true)
      }

      const entry: RuntimeEntry<T> = {
        leaseKey,
        fingerprint,
        startPromise: Promise.resolve().then(createRuntime),
        runtime: null,
        leased: true,
        lastUsedAt: Date.now(),
        idleTimer: null,
        waiters: new Set(),
      }
      this.entries.set(leaseKey, entry)
      let runtime: T
      try {
        runtime = await this.resolveRuntime(entry)
      } catch (error) {
        if (this.entries.get(leaseKey) === entry) this.entries.delete(leaseKey)
        entry.leased = false
        this.notifyWaiters(entry)
        throw error
      }
      if (this.disposed || this.entries.get(leaseKey) !== entry) {
        await runtime.dispose().catch(() => undefined)
        this.assertActive()
        continue
      }
      await this.evictOverflow(leaseKey)
      return this.createLease(entry, runtime, false)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const entries = [...this.entries.values()]
    this.entries.clear()
    for (const entry of entries) {
      this.clearIdleTimer(entry)
      entry.leased = false
      this.notifyWaiters(entry)
    }
    await Promise.all(entries.map((entry) => this.disposeEntry(entry)))
  }

  activeRuntimeCount(): number {
    return this.entries.size
  }

  private createLease(entry: RuntimeEntry<T>, runtime: T, warm: boolean): CodexRuntimeLease<T> {
    let released = false
    return {
      runtime,
      warm,
      release: async (options = {}) => {
        if (released) return
        released = true
        if (this.entries.get(entry.leaseKey) !== entry) return
        entry.leased = false
        entry.lastUsedAt = Date.now()
        if (options.invalidate === true || runtime.hasExited || this.disposed) {
          await this.removeAndDispose(entry)
          return
        }
        this.scheduleIdleEviction(entry)
        this.notifyWaiters(entry)
        await this.evictOverflow()
      },
    }
  }

  private async resolveRuntime(entry: RuntimeEntry<T>): Promise<T> {
    if (entry.runtime != null) return entry.runtime
    const runtime = await entry.startPromise
    entry.runtime = runtime
    return runtime
  }

  private async waitForEntryChange(entry: RuntimeEntry<T>): Promise<void> {
    if (this.entries.get(entry.leaseKey) !== entry || !entry.leased) return
    await new Promise<void>((resolve) => entry.waiters.add(resolve))
  }

  private notifyWaiters(entry: RuntimeEntry<T>): void {
    const waiters = [...entry.waiters]
    entry.waiters.clear()
    for (const resolve of waiters) resolve()
  }

  private scheduleIdleEviction(entry: RuntimeEntry<T>): void {
    this.clearIdleTimer(entry)
    if (this.idleTtlMs === 0) {
      void this.removeAndDispose(entry)
      return
    }
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null
      if (!entry.leased) void this.removeAndDispose(entry)
    }, this.idleTtlMs)
    if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref()
  }

  private clearIdleTimer(entry: RuntimeEntry<T>): void {
    if (entry.idleTimer == null) return
    clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }

  private async evictOverflow(protectedLeaseKey?: string): Promise<void> {
    while (this.entries.size > this.maxRuntimes) {
      const candidate = [...this.entries.values()]
        .filter((entry) => !entry.leased && entry.leaseKey !== protectedLeaseKey)
        .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0]
      if (candidate == null) return
      await this.removeAndDispose(candidate)
    }
  }

  private async removeAndDispose(entry: RuntimeEntry<T>): Promise<void> {
    if (this.entries.get(entry.leaseKey) === entry) this.entries.delete(entry.leaseKey)
    this.clearIdleTimer(entry)
    entry.leased = false
    this.notifyWaiters(entry)
    await this.disposeEntry(entry)
  }

  private async disposeEntry(entry: RuntimeEntry<T>): Promise<void> {
    try {
      const runtime = await this.resolveRuntime(entry)
      await runtime.dispose()
    } catch {
      // 启动失败或退出期 dispose 失败：entry 已从权威 map 摘除，不阻塞其他会话。
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('codex runtime supervisor is disposed')
  }
}
