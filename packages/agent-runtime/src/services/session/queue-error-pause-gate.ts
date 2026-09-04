import type { SessionQueuePauseState } from '@spark/protocol'
import type { SessionRuntimePatch } from './session-pure-utils.js'

type QueueRuntimeCarrier = {
  runtimePatch?: SessionRuntimePatch
}

export type QueueRuntimeSelection = Pick<
  SessionRuntimePatch,
  'providerProfileId' | 'modelId' | 'cliSparkOverride'
>

type PersistedAgentStatusRow = {
  event_json: string
}

/**
 * Session-scoped queue barrier created by a terminal turn error.
 *
 * The session status remains the durable source used during restart recovery; this small in-memory
 * gate keeps the hot queue scheduler free of database reads and carries the exact failed turn that
 * the renderer can retry.
 */
export class QueueErrorPauseGate {
  private readonly pauses = new Map<string, SessionQueuePauseState>()

  pause(sessionId: string, pause: SessionQueuePauseState): void {
    this.pauses.set(sessionId, pause)
  }

  getPause(sessionId: string, queuedTurnCount: number): SessionQueuePauseState | null {
    if (queuedTurnCount <= 0) {
      this.pauses.delete(sessionId)
      return null
    }
    return this.pauses.get(sessionId) ?? null
  }

  isBlocked(sessionId: string, queuedTurnCount: number): boolean {
    return this.getPause(sessionId, queuedTurnCount) != null
  }

  resolve(sessionId: string): void {
    this.pauses.delete(sessionId)
  }

  clear(): void {
    this.pauses.clear()
  }
}

export function pickQueueRuntimeSelection(
  runtimePatch: SessionRuntimePatch | undefined,
): QueueRuntimeSelection | undefined {
  if (runtimePatch == null) return undefined
  const selection: QueueRuntimeSelection = {
    ...(runtimePatch.providerProfileId !== undefined
      ? { providerProfileId: runtimePatch.providerProfileId }
      : {}),
    ...(runtimePatch.modelId !== undefined ? { modelId: runtimePatch.modelId } : {}),
    ...(runtimePatch.cliSparkOverride !== undefined
      ? { cliSparkOverride: runtimePatch.cliSparkOverride }
      : {}),
  }
  return selection.providerProfileId === undefined &&
    selection.modelId === undefined &&
    selection.cliSparkOverride === undefined
    ? undefined
    : selection
}

export function applyQueueRuntimeSelection<T extends QueueRuntimeCarrier>(
  turn: T,
  selection: QueueRuntimeSelection | undefined,
): T {
  if (selection == null) return turn
  return {
    ...turn,
    runtimePatch: {
      ...(turn.runtimePatch ?? {}),
      ...selection,
    },
  }
}

export function recoverQueueErrorPause(
  rows: readonly PersistedAgentStatusRow[],
  fallbackPausedAt: string,
): SessionQueuePauseState {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row == null) continue
    try {
      const event = JSON.parse(row.event_json) as {
        status?: unknown
        turnId?: unknown
        message?: unknown
        timestamp?: unknown
      }
      if (event.status !== 'error') continue
      return {
        reason: 'turn_error',
        ...(typeof event.turnId === 'string' ? { failedTurnId: event.turnId } : {}),
        ...(typeof event.message === 'string' ? { errorMessage: event.message } : {}),
        pausedAt: typeof event.timestamp === 'string' ? event.timestamp : fallbackPausedAt,
      }
    } catch {
      // Ignore malformed historical events and keep looking for the latest usable error.
    }
  }
  return { reason: 'turn_error', pausedAt: fallbackPausedAt }
}
