export class RuntimePatchCoordinator<P extends object> {
  private readonly pendingByScope = new Map<string, Partial<P>>()
  private readonly writeChainsByScope = new Map<string, Promise<void>>()

  remember(scopeKey: string, patch: P): void {
    const pending = this.pendingByScope.get(scopeKey) ?? {}
    this.pendingByScope.set(scopeKey, { ...pending, ...patch })
  }

  snapshot(scopeKey: string, base: P): P {
    return { ...base, ...this.pendingByScope.get(scopeKey) }
  }

  async persist(scopeKey: string, patch: P, write?: (patch: P) => Promise<void>): Promise<void> {
    this.remember(scopeKey, patch)
    if (write == null) return

    const previousWrite = this.writeChainsByScope.get(scopeKey) ?? Promise.resolve()
    const writeTask = previousWrite.then(() => write(patch))
    const settledWrite = writeTask.catch(() => undefined)
    this.writeChainsByScope.set(scopeKey, settledWrite)
    try {
      await writeTask
      const pending: Partial<P> = { ...this.pendingByScope.get(scopeKey) }
      for (const key of Object.keys(patch) as Array<keyof P>) {
        if (Object.is(pending[key], patch[key])) delete pending[key]
      }
      if (Object.keys(pending).length === 0) this.pendingByScope.delete(scopeKey)
      else this.pendingByScope.set(scopeKey, pending)
    } finally {
      if (this.writeChainsByScope.get(scopeKey) === settledWrite) {
        this.writeChainsByScope.delete(scopeKey)
      }
    }
  }

  async flush(scopeKey: string, write?: (patch: P) => Promise<void>): Promise<void> {
    if (write == null) return
    await this.writeChainsByScope.get(scopeKey)

    const patch = { ...this.pendingByScope.get(scopeKey) }
    if (Object.keys(patch).length === 0) return
    await this.persist(scopeKey, patch as P, write)
  }
}
