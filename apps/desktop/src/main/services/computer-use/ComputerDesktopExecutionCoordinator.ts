export interface ComputerDesktopExecutionCoordinatorOptions {
  stopSession(computerSessionId: string): Promise<void>
}

/**
 * Owns the single desktop input lane in memory. Coordination never expires,
 * leaks through persistence, or surfaces as a user-visible lease error: a
 * claim from a different agent stops the previous owner's sessions outright.
 *
 * Lineage rule: one agent session legitimately holds several computer
 * sessions at once — a `start_task` run plus the implicit atomic-tool session
 * (screenshot/click/... calls the model issues from the same conversation).
 * A claim from the SAME agent session transfers the lane without touching its
 * siblings; without this guard, one `screenshot` call issued while the
 * model's own start_task was running evicted and killed that very task.
 * A claim from a DIFFERENT agent session stops every session the previous
 * agent still owned, keeping desktop control exclusive between agents.
 */
export class ComputerDesktopExecutionCoordinator {
  private readonly stopSession: (computerSessionId: string) => Promise<void>
  private ownerSessionId: string | null = null
  private readonly agentByComputer = new Map<string, string>()
  private readonly computersByAgent = new Map<string, Set<string>>()
  private queue: Promise<void> = Promise.resolve()

  constructor(options: ComputerDesktopExecutionCoordinatorOptions) {
    this.stopSession = options.stopSession
  }

  claim(computerSessionId: string, agentSessionId?: string): Promise<void> {
    const operation = this.queue.then(async () => {
      if (agentSessionId != null) this.register(computerSessionId, agentSessionId)
      const previousSessionId = this.ownerSessionId
      if (previousSessionId == null || previousSessionId === computerSessionId) {
        this.ownerSessionId = computerSessionId
        return
      }
      const previousAgent = this.agentByComputer.get(previousSessionId)
      const sameAgent =
        agentSessionId != null && previousAgent != null && previousAgent === agentSessionId
      if (!sameAgent) {
        // Different agent (or a legacy lineage-less claim): evict everything the
        // previous agent still owns — the lane holder and its siblings. Any stop
        // failure fails the claim (documented contract: a retry can recover) but
        // victims are always unregistered first so a retry never re-stops them.
        const victims = new Set([previousSessionId])
        if (previousAgent != null) {
          for (const sibling of this.computersByAgent.get(previousAgent) ?? []) {
            victims.add(sibling)
          }
        }
        let firstFailure: unknown = null
        for (const victim of victims) {
          try {
            await this.stopSession(victim)
          } catch (error) {
            firstFailure ??= error
          } finally {
            if (this.ownerSessionId === victim) this.ownerSessionId = null
            this.unregister(victim)
          }
        }
        if (firstFailure != null) throw firstFailure
      }
      this.ownerSessionId = computerSessionId
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  release(computerSessionId: string): void {
    this.unregister(computerSessionId)
    if (this.ownerSessionId === computerSessionId) this.ownerSessionId = null
  }

  activeSessionId(): string | null {
    return this.ownerSessionId
  }

  async dispose(): Promise<void> {
    await this.queue
    const victims = new Set(this.agentByComputer.keys())
    if (this.ownerSessionId != null) victims.add(this.ownerSessionId)
    for (const computerSessionId of victims) {
      try {
        await this.stopSession(computerSessionId)
      } catch {
        // disposal is best-effort by contract
      } finally {
        this.unregister(computerSessionId)
        if (this.ownerSessionId === computerSessionId) this.ownerSessionId = null
      }
    }
  }

  private register(computerSessionId: string, agentSessionId: string): void {
    this.agentByComputer.set(computerSessionId, agentSessionId)
    const owned = this.computersByAgent.get(agentSessionId) ?? new Set<string>()
    owned.add(computerSessionId)
    this.computersByAgent.set(agentSessionId, owned)
  }

  private unregister(computerSessionId: string): void {
    const agentSessionId = this.agentByComputer.get(computerSessionId)
    this.agentByComputer.delete(computerSessionId)
    if (agentSessionId == null) return
    const owned = this.computersByAgent.get(agentSessionId)
    if (owned == null) return
    owned.delete(computerSessionId)
    if (owned.size === 0) this.computersByAgent.delete(agentSessionId)
  }
}
