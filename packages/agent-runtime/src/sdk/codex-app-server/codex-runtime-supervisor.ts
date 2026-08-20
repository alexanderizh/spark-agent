import { createHash } from 'node:crypto'
import type { CodexAppServerRuntime } from './codex-app-server-runtime.js'
import type { CodexRuntimeResource } from '../types.js'

export interface ManagedCodexRuntime {
  readonly hasExited: boolean
  dispose(): Promise<void>
  getDiagnostics?(): Promise<{
    pid: number
    rssBytes: number | null
    handleCount: number | null
    loadedThreadCount?: number | undefined
  } | null>
}

export interface CodexRuntimeLease<T extends ManagedCodexRuntime = CodexAppServerRuntime> {
  readonly runtime: T
  /** true 表示复用了已存在的 initialized runtime。 */
  readonly warm: boolean
  release(options?: { invalidate?: boolean } | undefined): Promise<void>
}

export interface CodexRuntimeAcquireOptions {
  resources?: readonly CodexRuntimeResource[] | undefined
}

export interface CodexAppServerRuntimeSupervisorOptions {
  idleTtlMs?: number | undefined
  maxRuntimes?: number | undefined
}

export type CodexAppServerThreadMode = 'loaded' | 'resume' | 'start' | 'resume-fallback-start'

export interface CodexRuntimeSupervisorDiagnostics {
  disposed: boolean
  activeRuntimeCount: number
  leasedRuntimeCount: number
  processCount: number
  totalRssBytes: number | null
  totalHandleCount: number | null
  counters: {
    acquireCount: number
    coldStartCount: number
    warmHitCount: number
    warmHitRate: number
    fingerprintRotationCount: number
    crashReplacementCount: number
    invalidationCount: number
    startFailureCount: number
    ttlEvictionCount: number
    lruEvictionCount: number
    manualRestartCount: number
    threadLoadedCount: number
    threadResumeCount: number
    threadStartCount: number
    threadResumeFallbackCount: number
  }
  runtimes: Array<{
    leaseId: string
    state: 'starting' | 'running' | 'idle' | 'exited'
    lastUsedAt: string
    resourceCount: number
    pid: number | null
    rssBytes: number | null
    handleCount: number | null
    loadedThreadCount: number | null
  }>
}

export interface CodexRuntimeRestartResult {
  restartedLeaseIds: string[]
  busyLeaseIds: string[]
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
  resources: Map<string, CodexRuntimeResource>
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
  private readonly counters = {
    acquireCount: 0,
    coldStartCount: 0,
    warmHitCount: 0,
    fingerprintRotationCount: 0,
    crashReplacementCount: 0,
    invalidationCount: 0,
    startFailureCount: 0,
    ttlEvictionCount: 0,
    lruEvictionCount: 0,
    manualRestartCount: 0,
    threadLoadedCount: 0,
    threadResumeCount: 0,
    threadStartCount: 0,
    threadResumeFallbackCount: 0,
  }

  constructor(options: CodexAppServerRuntimeSupervisorOptions = {}) {
    this.idleTtlMs = Math.max(0, options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS)
    this.maxRuntimes = Math.max(1, options.maxRuntimes ?? DEFAULT_MAX_RUNTIMES)
  }

  async acquire(
    leaseKey: string,
    fingerprint: string,
    createRuntime: () => Promise<T>,
    options: CodexRuntimeAcquireOptions = {},
  ): Promise<CodexRuntimeLease<T>> {
    if (leaseKey.length === 0) throw new Error('codex runtime lease requires a non-empty key')
    this.counters.acquireCount += 1
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
          if (runtime.hasExited) this.counters.crashReplacementCount += 1
          else this.counters.fingerprintRotationCount += 1
          const transferable = this.findTransferableResources(existing, options.resources)
          await this.removeAndDispose(existing, transferable)
          if (this.disposed) {
            await Promise.all(
              [...transferable.values()].map((resource) =>
                resource.dispose().catch(() => undefined),
              ),
            )
          }
          continue
        }
        this.attachResources(existing, options.resources)
        existing.leased = true
        this.clearIdleTimer(existing)
        this.counters.warmHitCount += 1
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
        resources: new Map(),
      }
      this.attachResources(entry, options.resources)
      this.entries.set(leaseKey, entry)
      this.counters.coldStartCount += 1
      let runtime: T
      try {
        runtime = await this.resolveRuntime(entry)
      } catch (error) {
        if (this.entries.get(leaseKey) === entry) this.entries.delete(leaseKey)
        entry.leased = false
        this.notifyWaiters(entry)
        await this.disposeResources(entry)
        this.counters.startFailureCount += 1
        throw error
      }
      if (this.disposed || this.entries.get(leaseKey) !== entry) {
        await runtime.dispose().catch(() => undefined)
        await this.disposeResources(entry)
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

  recordThreadMode(mode: CodexAppServerThreadMode): void {
    switch (mode) {
      case 'loaded':
        this.counters.threadLoadedCount += 1
        return
      case 'resume':
        this.counters.threadResumeCount += 1
        return
      case 'start':
        this.counters.threadStartCount += 1
        return
      case 'resume-fallback-start':
        this.counters.threadResumeFallbackCount += 1
    }
  }

  async restartIdle(leaseKey?: string): Promise<CodexRuntimeRestartResult> {
    const candidates = leaseKey == null ? [...this.entries.values()] : [this.entries.get(leaseKey)]
    const restartedLeaseIds: string[] = []
    const busyLeaseIds: string[] = []
    for (const entry of candidates) {
      if (entry == null) continue
      const leaseId = opaqueLeaseId(entry.leaseKey)
      if (entry.leased) {
        busyLeaseIds.push(leaseId)
        continue
      }
      this.counters.manualRestartCount += 1
      restartedLeaseIds.push(leaseId)
      await this.removeAndDispose(entry)
    }
    return { restartedLeaseIds, busyLeaseIds }
  }

  async getDiagnostics(): Promise<CodexRuntimeSupervisorDiagnostics> {
    const runtimes = await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        const diagnostics =
          entry.runtime != null && entry.runtime.getDiagnostics != null
            ? await entry.runtime.getDiagnostics().catch(() => null)
            : null
        const state =
          entry.runtime == null
            ? ('starting' as const)
            : entry.runtime.hasExited
              ? ('exited' as const)
              : entry.leased
                ? ('running' as const)
                : ('idle' as const)
        return {
          leaseId: opaqueLeaseId(entry.leaseKey),
          state,
          lastUsedAt: new Date(entry.lastUsedAt).toISOString(),
          resourceCount: entry.resources.size,
          pid: diagnostics?.pid ?? null,
          rssBytes: diagnostics?.rssBytes ?? null,
          handleCount: diagnostics?.handleCount ?? null,
          loadedThreadCount: diagnostics?.loadedThreadCount ?? null,
        }
      }),
    )
    const rssValues = runtimes.flatMap((runtime) =>
      runtime.rssBytes == null ? [] : [runtime.rssBytes],
    )
    const handleValues = runtimes.flatMap((runtime) =>
      runtime.handleCount == null ? [] : [runtime.handleCount],
    )
    return {
      disposed: this.disposed,
      activeRuntimeCount: runtimes.length,
      leasedRuntimeCount: runtimes.filter((runtime) => runtime.state === 'running').length,
      processCount: runtimes.filter((runtime) => runtime.pid != null && runtime.state !== 'exited')
        .length,
      totalRssBytes: rssValues.length > 0 ? rssValues.reduce((sum, value) => sum + value, 0) : null,
      totalHandleCount:
        handleValues.length > 0 ? handleValues.reduce((sum, value) => sum + value, 0) : null,
      counters: {
        ...this.counters,
        warmHitRate:
          this.counters.acquireCount > 0
            ? this.counters.warmHitCount / this.counters.acquireCount
            : 0,
      },
      runtimes,
    }
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
          if (runtime.hasExited) this.counters.crashReplacementCount += 1
          else if (options.invalidate === true) this.counters.invalidationCount += 1
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
      if (!entry.leased) {
        this.counters.ttlEvictionCount += 1
        void this.removeAndDispose(entry)
      }
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
      this.counters.lruEvictionCount += 1
      await this.removeAndDispose(candidate)
    }
  }

  private async removeAndDispose(
    entry: RuntimeEntry<T>,
    preservedResources: ReadonlyMap<string, CodexRuntimeResource> = new Map(),
  ): Promise<void> {
    if (this.entries.get(entry.leaseKey) === entry) this.entries.delete(entry.leaseKey)
    this.clearIdleTimer(entry)
    entry.leased = false
    this.notifyWaiters(entry)
    await this.disposeEntry(entry, preservedResources)
  }

  private async disposeEntry(
    entry: RuntimeEntry<T>,
    preservedResources: ReadonlyMap<string, CodexRuntimeResource> = new Map(),
  ): Promise<void> {
    try {
      const runtime = await this.resolveRuntime(entry)
      await runtime.dispose()
    } catch {
      // 启动失败或退出期 dispose 失败：entry 已从权威 map 摘除，不阻塞其他会话。
    } finally {
      await this.disposeResources(entry, preservedResources)
    }
  }

  private attachResources(
    entry: RuntimeEntry<T>,
    resources: readonly CodexRuntimeResource[] | undefined,
  ): void {
    for (const resource of resources ?? []) {
      const id = resource.id.trim()
      if (id.length === 0) throw new Error('codex runtime resource requires a non-empty id')
      const existing = entry.resources.get(id)
      if (existing != null && existing !== resource) {
        throw new Error(`codex runtime resource identity changed for ${id}`)
      }
    }
    for (const resource of resources ?? []) {
      const id = resource.id.trim()
      const existing = entry.resources.get(id)
      if (existing == null) entry.resources.set(id, resource)
      resource.onAttached?.()
    }
  }

  private findTransferableResources(
    entry: RuntimeEntry<T>,
    requested: readonly CodexRuntimeResource[] | undefined,
  ): Map<string, CodexRuntimeResource> {
    const transferable = new Map<string, CodexRuntimeResource>()
    for (const resource of requested ?? []) {
      const existing = entry.resources.get(resource.id)
      if (existing === resource) transferable.set(resource.id, resource)
    }
    return transferable
  }

  private async disposeResources(
    entry: RuntimeEntry<T>,
    preservedResources: ReadonlyMap<string, CodexRuntimeResource> = new Map(),
  ): Promise<void> {
    const resources = [...entry.resources.entries()]
    entry.resources.clear()
    await Promise.all(
      resources.map(async ([id, resource]) => {
        if (preservedResources.get(id) === resource) return
        await resource.dispose().catch(() => undefined)
      }),
    )
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('codex runtime supervisor is disposed')
  }
}

function opaqueLeaseId(leaseKey: string): string {
  return createHash('sha256').update(leaseKey).digest('hex').slice(0, 12)
}
