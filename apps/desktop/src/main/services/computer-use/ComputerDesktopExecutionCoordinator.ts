export interface ComputerDesktopExecutionCoordinatorOptions {
  stopSession(computerSessionId: string): Promise<void>
}

/**
 * Owns the single desktop input lane in memory. A new claim stops the previous
 * Computer Use session before it becomes active, so coordination can never
 * expire, leak through persistence, or surface as a user-visible lease error.
 */
export class ComputerDesktopExecutionCoordinator {
  private readonly stopSession: (computerSessionId: string) => Promise<void>
  private ownerSessionId: string | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(options: ComputerDesktopExecutionCoordinatorOptions) {
    this.stopSession = options.stopSession
  }

  claim(computerSessionId: string): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.ownerSessionId === computerSessionId) return
      const previousSessionId = this.ownerSessionId
      if (previousSessionId != null) {
        try {
          await this.stopSession(previousSessionId)
        } finally {
          if (this.ownerSessionId === previousSessionId) this.ownerSessionId = null
        }
      }
      this.ownerSessionId = computerSessionId
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  release(computerSessionId: string): void {
    if (this.ownerSessionId === computerSessionId) this.ownerSessionId = null
  }

  activeSessionId(): string | null {
    return this.ownerSessionId
  }

  async dispose(): Promise<void> {
    await this.queue
    const computerSessionId = this.ownerSessionId
    if (computerSessionId == null) return
    try {
      await this.stopSession(computerSessionId)
    } finally {
      if (this.ownerSessionId === computerSessionId) this.ownerSessionId = null
    }
  }
}
