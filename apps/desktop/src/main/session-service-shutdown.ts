interface DisposableSessionService {
  dispose(): Promise<void>
}

export class SessionServiceShutdownRegistry {
  private sessionService: DisposableSessionService | null = null
  private shuttingDown = false

  register(service: DisposableSessionService): boolean {
    if (this.shuttingDown) {
      void service.dispose().catch(() => undefined)
      return false
    }
    this.sessionService = service
    return true
  }

  isShuttingDown(): boolean {
    return this.shuttingDown
  }

  async dispose(): Promise<void> {
    this.shuttingDown = true
    const service = this.sessionService
    this.sessionService = null
    await service?.dispose()
  }
}

const registry = new SessionServiceShutdownRegistry()

export function registerSessionServiceForShutdown(service: DisposableSessionService): void {
  registry.register(service)
}

export function isSessionServiceShutdownStarted(): boolean {
  return registry.isShuttingDown()
}

export async function disposeSessionServiceForShutdown(): Promise<void> {
  await registry.dispose()
}
