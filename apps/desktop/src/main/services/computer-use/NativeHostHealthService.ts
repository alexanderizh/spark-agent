import { createLogger } from '@spark/shared'

const log = createLogger('computer-use-native-host-health')

/**
 * Phase 2.1 — proactive Native Host liveness probe.
 *
 * The Native Host is a long-lived child process. Without proactive probing, a
 * host that crashed or hung is only noticed when the next user action hits it,
 * which means the user pays the full reconnect latency (and, for a hung host,
 * the 20 s request timeout) on a foreground action. This service pings the host
 * on a fixed cadence and, only after several consecutive failures, declares it
 * unhealthy so the supervisor can reclaim the connection.
 *
 * Three consecutive failures (not one) are required precisely because a single
 * missed heartbeat is cheap and common — the machine can be briefly busy, the
 * event loop momentarily delayed. Tearing down a healthy host on a single
 * transient miss would be a net regression. The threshold makes the probe
 * fail-closed against persistent death while tolerating ordinary jitter.
 */
export interface NativeHostHealthServiceOptions {
  probe: () => Promise<void>
  onUnhealthy: () => void
  intervalMs?: number
  failureThreshold?: number
  /** Test injection. Production uses the real globals. */
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000
const DEFAULT_HEARTBEAT_FAILURE_THRESHOLD = 3

export class NativeHostHealthService {
  private readonly probe: () => Promise<void>
  private readonly onUnhealthy: () => void
  private readonly intervalMs: number
  private readonly failureThreshold: number
  private readonly setTimer: typeof setInterval
  private readonly clearTimer: typeof clearInterval
  private timer: NodeJS.Timeout | null = null
  private consecutiveFailures = 0
  private running = false

  constructor(options: NativeHostHealthServiceOptions) {
    this.probe = options.probe
    this.onUnhealthy = options.onUnhealthy
    this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.failureThreshold = options.failureThreshold ?? DEFAULT_HEARTBEAT_FAILURE_THRESHOLD
    this.setTimer = options.setInterval ?? setInterval
    this.clearTimer = options.clearInterval ?? clearInterval
  }

  /** Idempotent: starts probing. Safe to call again after {@link stop}. */
  start(): void {
    if (this.running) return
    this.running = true
    this.consecutiveFailures = 0
    const timer = this.setTimer(() => {
      void this.tick()
    }, this.intervalMs)
    // A heartbeat must never keep the Electron main process alive on its own.
    timer.unref?.()
    this.timer = timer
  }

  stop(): void {
    this.running = false
    if (this.timer != null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  /** Acknowledge that the host responded, clearing the failure streak. */
  reset(): void {
    this.consecutiveFailures = 0
  }

  isRunning(): boolean {
    return this.running
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    try {
      await this.probe()
      this.consecutiveFailures = 0
    } catch (error) {
      this.consecutiveFailures += 1
      log.warn('Native Host heartbeat failed', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.failureThreshold,
        error: error instanceof Error ? error.message : String(error),
      })
      if (this.consecutiveFailures >= this.failureThreshold) {
        // Stop probing — the supervisor owns reclaim + restart now.
        this.running = false
        if (this.timer != null) {
          this.clearTimer(this.timer)
          this.timer = null
        }
        try {
          this.onUnhealthy()
        } catch (callbackError) {
          log.error('Native Host onUnhealthy callback threw', {
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          })
        }
      }
    }
  }
}
