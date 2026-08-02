import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { NativeHostConnection } from './NativeHostComputerUseBackend.js'
import {
  NativeHostHealthService,
  type NativeHostHealthServiceOptions,
} from './NativeHostHealthService.js'
import { createLogger } from '@spark/shared'
import { computerUseV2RolloutController } from './ComputerUseV2RolloutController.js'

const log = createLogger('computer-use-native-host-supervisor')

/**
 * Phase 2.1 — owns the Native Host connection lifecycle.
 *
 * State machine:
 *
 *   absent → starting → ready ⇄ degraded → restarting → ready
 *                                    ↓ (budget exhausted)
 *                                  failed
 *
 * Why this exists (the gap the backend alone could not close):
 *
 *  1. Proactive liveness — the backend only notices a dead host when a user
 *     action fails against it. The supervisor runs a heartbeat and reclaims
 *     the connection *before* the next action pays for the death.
 *  2. Bounded auto-restart — a transiently crashed host can come back within a
 *     per-session budget (default 1) so a single crash no longer kills the
 *     whole turn. The budget is hard-capped so a persistently broken (e.g.
 *     tampered) host cannot cause a reconnect loop.
 *  3. Re-bind enforcement — after a rebound connection is established, every
 *     cached observation for the session is invalidated, because the new host
 *     process lost all session state. Callers are forced to re-observe and
 *     re-bind the target window. We never continue executing an action that
 *     was planned against a frame the new host has never seen.
 *
 * Safety invariants this supervisor MUST NOT weaken:
 *  - It never weakens NativeHostClient's fail-closed SIGKILL on digest/timeout/
 *    protocol violation. Those still tear down the underlying child. The
 *    supervisor simply observes the death and decides whether to reconnect.
 *  - It never auto-restarts beyond the budget. Budget exhausted ⇒ `failed`.
 */
export type NativeHostSupervisorState =
  | 'absent'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'restarting'
  | 'failed'

export interface NativeHostHealthController {
  start(): void
  stop(): void
  reset(): void
}

export interface NativeHostSupervisorDeps {
  /** Produce a fresh, handshaked Native Host connection. */
  connect: () => Promise<NativeHostConnection>
  /** Lightweight liveness probe against the current connection. */
  probe: (connection: NativeHostConnection) => Promise<void>
  /**
   * Fired once after every connection that followed a prior terminal failure
   * (a "rebound"). Used to drop cached observations so callers re-bind.
   */
  onRebound?: () => void
  maxRestartsPerSession?: number
  /** Forwarded to the health service. */
  heartbeatIntervalMs?: number
  heartbeatFailureThreshold?: number
  /** Test injection for a deterministic clock/timer. */
  createHealthService?: (options: NativeHostHealthServiceOptions) => NativeHostHealthController
}

const DEFAULT_MAX_RESTARTS_PER_SESSION = 1

export class NativeHostSupervisor {
  private readonly connect: () => Promise<NativeHostConnection>
  private readonly probeConnection: (connection: NativeHostConnection) => Promise<void>
  private readonly onRebound: (() => void) | null
  private readonly maxRestartsPerSession: number
  private readonly health: NativeHostHealthController

  private state: NativeHostSupervisorState = 'absent'
  private current: NativeHostConnection | null = null
  private pending: Promise<NativeHostConnection> | null = null
  private restartCount = 0
  private lastError: ComputerUseBrokerError | null = null
  private disposed = false

  constructor(deps: NativeHostSupervisorDeps) {
    this.connect = deps.connect
    this.probeConnection = deps.probe
    this.onRebound = deps.onRebound ?? null
    this.maxRestartsPerSession = deps.maxRestartsPerSession ?? DEFAULT_MAX_RESTARTS_PER_SESSION
    const createHealthService =
      deps.createHealthService ?? ((options) => new NativeHostHealthService(options))
    this.health = createHealthService({
      ...(deps.heartbeatIntervalMs != null ? { intervalMs: deps.heartbeatIntervalMs } : {}),
      ...(deps.heartbeatFailureThreshold != null
        ? { failureThreshold: deps.heartbeatFailureThreshold }
        : {}),
      probe: () => (this.current != null ? this.probeConnection(this.current) : Promise.resolve()),
      onUnhealthy: () => {
        void this.handleUnhealthy()
      },
    })
  }

  getState(): NativeHostSupervisorState {
    return this.state
  }

  getRestartCount(): number {
    return this.restartCount
  }

  /** A live connection if one is established, otherwise null. */
  getCurrentConnection(): NativeHostConnection | null {
    return this.current
  }

  /**
   * A restart budget belongs to one governed task, while the supervisor itself is shared by
   * the desktop process. Ending a task must therefore clear a previously exhausted budget;
   * otherwise one old crash permanently bricks Computer Use until SparkWork is restarted.
   */
  resetSessionBudget(): void {
    if (this.disposed) return
    this.restartCount = 0
    this.lastError = null
    if (this.current != null) {
      this.state = 'ready'
      this.health.reset()
      this.health.start()
    } else {
      this.state = 'absent'
      this.health.stop()
    }
  }

  /**
   * Return a ready connection. Connects lazily on first call, and reconnects
   * within the restart budget after a terminal failure. Once the budget is
   * exhausted the supervisor is `failed` and every acquire rejects.
   */
  async acquire(): Promise<NativeHostConnection> {
    if (this.disposed) {
      throw new ComputerUseBrokerError('session_canceled', 'Native Host supervisor is disposed')
    }
    if (this.state === 'failed') {
      throw this.lastError ?? this.exhaustedError()
    }
    const connection = await this.establishConnection()
    // (Re)start probing now that we have a live connection. Idempotent.
    this.health.start()
    return connection
  }

  /**
   * Called by the backend when an operation failed in a way that invalidates
   * the connection (see `shouldInvalidateConnection`). Does not synchronously
   * reconnect — the next acquire() decides within budget. This keeps the
   * reconnect on a caller's tick so we never spin a reconnect loop in the
   * background without a consumer.
   */
  async reportTerminalFailure(
    connection: NativeHostConnection,
    error: ComputerUseBrokerError,
  ): Promise<void> {
    if (this.current !== connection) return
    this.current = null
    this.lastError = error
    if (this.restartCount >= this.maxRestartsPerSession) {
      this.state = 'failed'
      this.health.stop()
    } else {
      this.state = 'degraded'
    }
    log.warn('Native Host connection reported a terminal failure', {
      state: this.state,
      restartCount: this.restartCount,
      maxRestartsPerSession: this.maxRestartsPerSession,
      code: error.code,
    })
    computerUseV2RolloutController.recordHostSession(true)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.state = 'failed'
    this.health.stop()
    const current = this.current
    this.current = null
    this.pending = null
    if (current != null) {
      await current.close().catch(() => undefined)
    }
  }

  private async establishConnection(): Promise<NativeHostConnection> {
    if (this.current != null) return this.current
    if (this.pending != null) return this.pending

    const hadPriorFailure = this.lastError != null
    if (hadPriorFailure && this.restartCount >= this.maxRestartsPerSession) {
      this.state = 'failed'
      throw this.lastError ?? this.exhaustedError()
    }
    if (hadPriorFailure) {
      this.restartCount += 1
      this.state = 'restarting'
      log.warn('Restarting Native Host after a terminal failure', {
        restartCount: this.restartCount,
        maxRestartsPerSession: this.maxRestartsPerSession,
      })
    } else {
      this.state = 'starting'
    }

    const rebound = hadPriorFailure
    const pending = this.connect()
      .then((connection) => {
        this.current = connection
        this.lastError = null
        this.state = 'ready'
        this.health.reset()
        this.health.start()
        computerUseV2RolloutController.recordHostSession(false)
        if (rebound) {
          // The new host process lost all session state. Force callers to
          // re-bind the target window and re-observe before any action.
          try {
            this.onRebound?.()
          } catch (callbackError) {
            log.error('Native Host onRebound callback threw', {
              error: callbackError instanceof Error ? callbackError.message : String(callbackError),
            })
          }
        }
        return connection
      })
      .catch((error: unknown) => {
        const brokerError = this.normalizeConnectError(error)
        this.lastError = brokerError
        if (this.restartCount >= this.maxRestartsPerSession) {
          this.state = 'failed'
        } else {
          this.state = 'degraded'
        }
        throw brokerError
      })
      .finally(() => {
        if (this.pending === pending) this.pending = null
      })

    this.pending = pending
    return pending
  }

  private async handleUnhealthy(): Promise<void> {
    if (this.disposed) return
    const dead = this.current
    this.current = null
    if (dead == null) return
    this.lastError = new ComputerUseBrokerError(
      'native_host_incompatible',
      'Native Host heartbeat exceeded the failure threshold',
    )
    this.state = 'degraded'
    log.warn('Native Host heartbeat crossed the failure threshold; reclaiming connection', {
      restartCount: this.restartCount,
      maxRestartsPerSession: this.maxRestartsPerSession,
    })
    computerUseV2RolloutController.recordHostSession(true)
    await dead.close().catch(() => undefined)
    if (this.restartCount >= this.maxRestartsPerSession) {
      this.state = 'failed'
      return
    }
    try {
      await this.establishConnection()
    } catch (error) {
      log.warn('Immediate Native Host restart after heartbeat failure failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private normalizeConnectError(error: unknown): ComputerUseBrokerError {
    if (error instanceof ComputerUseBrokerError) return error
    return new ComputerUseBrokerError(
      'native_host_incompatible',
      'Native Host supervisor could not establish a trusted connection',
    )
  }

  private exhaustedError(): ComputerUseBrokerError {
    return new ComputerUseBrokerError(
      'native_host_incompatible',
      'Native Host supervisor exhausted its restart budget',
    )
  }
}
