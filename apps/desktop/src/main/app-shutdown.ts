export interface BeforeQuitEventLike {
  preventDefault(): void
}

export interface QuitAppLike {
  quit(): void
}

export interface ProcessExitLike {
  once(event: 'exit', listener: () => void): void
}

export interface AppShutdownCoordinatorOptions {
  app: QuitAppLike
  disposeSessionService: () => Promise<void>
  disposeTimeoutMs?: number
  cleanup: () => void | Promise<void>
  onError?: (error: unknown) => void
}

export interface ShutdownCleanupStep {
  name: string
  run: () => void | Promise<void>
}

export async function runShutdownCleanupSteps(
  steps: ShutdownCleanupStep[],
  onError?: (stepName: string, error: unknown) => void,
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run()
    } catch (error) {
      onError?.(step.name, error)
    }
  }
}

export function registerEmergencySessionShutdown(
  process: ProcessExitLike,
  disposeSessionService: () => Promise<void>,
): void {
  process.once('exit', () => {
    // Promise continuations cannot run during exit, but dispose synchronously
    // cancels executions and calls SDK query.close() before its first await.
    void disposeSessionService().catch(() => undefined)
  })
}

/**
 * Electron does not await async before-quit listeners. The first quit must be
 * prevented while Agent subprocesses still own stdin/control pipes; after the
 * bounded cleanup finishes, a second quit is allowed through.
 */
export function createAppShutdownCoordinator(
  options: AppShutdownCoordinatorOptions,
): (event: BeforeQuitEventLike) => void {
  let shutdownStarted = false
  let shutdownComplete = false

  return (event) => {
    if (shutdownComplete) return

    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true

    void (async () => {
      try {
        const timeoutMs = Math.max(1, options.disposeTimeoutMs ?? 10_000)
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            options.disposeSessionService(),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                reject(new Error(`Timed out waiting for Agent shutdown after ${timeoutMs}ms`))
              }, timeoutMs)
            }),
          ])
        } finally {
          if (timeout != null) clearTimeout(timeout)
        }
      } catch (error) {
        options.onError?.(error)
      }

      try {
        await options.cleanup()
      } catch (error) {
        options.onError?.(error)
      } finally {
        shutdownComplete = true
        options.app.quit()
      }
    })()
  }
}
