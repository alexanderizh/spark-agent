import { createLogger, type Logger } from '@spark/shared'

const log = createLogger('renderer-crash-recovery')
const AUTO_RELOAD_INTERVAL_MS = 60_000
const AUTO_RELOAD_REASONS = new Set(['crashed', 'killed', 'oom'])

export interface RendererReloadTarget {
  getURL(): string
  isDestroyed(): boolean
  reload(): void
}

interface RendererRecoveryState {
  lastReloadAt: number | null
  pendingTimer: ReturnType<typeof setTimeout> | null
}

/** Recover crashed renderer windows independently, with a trailing retry per window. */
export class RendererCrashRecovery {
  private readonly states = new WeakMap<RendererReloadTarget, RendererRecoveryState>()

  constructor(
    private readonly isQuitting: () => boolean,
    private readonly logger: Pick<Logger, 'warn'> = log,
    private readonly now: () => number = Date.now,
  ) {}

  handleGone(target: RendererReloadTarget, reason: string): void {
    if (this.isQuitting() || !AUTO_RELOAD_REASONS.has(reason) || target.isDestroyed()) return

    const state = this.getState(target)
    const reload = (): void => {
      if (this.isQuitting() || target.isDestroyed()) return
      state.lastReloadAt = this.now()
      this.logger.warn(
        `[process-gone-forensics] auto-reload renderer after '${reason}': url=${target.getURL()}`,
      )
      target.reload()
    }

    const now = this.now()
    const elapsed = state.lastReloadAt == null ? AUTO_RELOAD_INTERVAL_MS : now - state.lastReloadAt
    if (elapsed >= AUTO_RELOAD_INTERVAL_MS) {
      reload()
      return
    }
    if (state.pendingTimer != null) return

    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = null
      reload()
    }, AUTO_RELOAD_INTERVAL_MS - elapsed)
  }

  private getState(target: RendererReloadTarget): RendererRecoveryState {
    let state = this.states.get(target)
    if (state == null) {
      state = { lastReloadAt: null, pendingTimer: null }
      this.states.set(target, state)
    }
    return state
  }
}
