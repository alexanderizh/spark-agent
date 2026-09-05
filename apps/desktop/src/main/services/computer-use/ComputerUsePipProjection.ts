import type { ComputerUseEvent } from '@spark/protocol'

/**
 * Pure state projection for the PIP live panel: folds timeline events into
 * "what is the agent doing right now" — target label, last action summary,
 * and a status kind that maps to the panel's accent color. Kept free of
 * Electron imports so it is unit-testable.
 */
export interface ComputerUsePipSessionState {
  readonly computerSessionId: string
  readonly label: string
  readonly status: PipStatus
  readonly lastSummary: string | null
  readonly lastEventAt: string
}

export type PipStatus =
  | 'running'
  | 'acting'
  | 'failed'
  | 'awaiting_approval'
  | 'completed'
  | 'stopped'

export interface ComputerUsePipProjectionSessions {
  /** computerSessionId -> label for sessions the PIP may display. */
  listLabeled(): Array<{ computerSessionId: string; label: string }>
}

export class ComputerUsePipProjection {
  private readonly sessions = new Map<string, ComputerUsePipSessionState>()
  private readonly known: ComputerUsePipProjectionSessions

  constructor(options: { sessions: ComputerUsePipProjectionSessions }) {
    this.known = options.sessions
  }

  /** Returns the mutable snapshot after folding one event (newest last). */
  record(event: ComputerUseEvent): ComputerUsePipSessionState[] {
    switch (event.type) {
      case 'computer_session_started':
      case 'computer_observation_created':
        this.patch(event.computerSessionId, { status: 'running' }, event.timestamp)
        break
      case 'computer_action_requested':
        this.patch(
          event.computerSessionId,
          {
            status: 'acting',
            lastSummary: event.summary ?? null,
          },
          event.timestamp,
        )
        break
      case 'computer_action_executed':
        this.patch(
          event.computerSessionId,
          { status: 'running', lastSummary: event.summary ?? null },
          event.timestamp,
        )
        break
      case 'computer_action_failed':
      case 'computer_action_blocked':
        this.patch(
          event.computerSessionId,
          {
            status: 'running',
            lastSummary: event.summary ?? null,
          },
          event.timestamp,
        )
        break
      case 'computer_approval_requested':
        this.patch(event.computerSessionId, { status: 'awaiting_approval' }, event.timestamp)
        break
      case 'computer_handoff_required':
        this.patch(event.computerSessionId, { status: 'stopped' }, event.timestamp)
        break
      case 'computer_session_completed':
        this.patch(event.computerSessionId, { status: 'completed' }, event.timestamp)
        this.retireSoon(event.computerSessionId)
        break
      case 'computer_session_failed':
        this.patch(event.computerSessionId, { status: 'failed' }, event.timestamp)
        this.retireSoon(event.computerSessionId)
        break
      case 'computer_session_canceled':
        this.patch(event.computerSessionId, { status: 'stopped' }, event.timestamp)
        this.retireSoon(event.computerSessionId)
        break
      default:
        break
    }
    return this.snapshot()
  }

  /** Drop sessions whose label source no longer knows them (cleared sessions). */
  prune(): ComputerUsePipSessionState[] {
    const known = new Set(this.known.listLabeled().map((item) => item.computerSessionId))
    for (const id of [...this.sessions.keys()]) {
      if (!known.has(id) && this.retirable.has(id)) this.sessions.delete(id)
    }
    return this.snapshot()
  }

  /** Remove one session after its terminal status has lingered for the user. */
  retire(computerSessionId: string): ComputerUsePipSessionState[] {
    this.sessions.delete(computerSessionId)
    return this.snapshot()
  }

  snapshot(): ComputerUsePipSessionState[] {
    return [...this.sessions.values()].sort((left, right) =>
      left.lastEventAt < right.lastEventAt ? -1 : 1,
    )
  }

  private readonly retirable = new Set<string>()

  private retireSoon(computerSessionId: string): void {
    this.retirable.add(computerSessionId)
  }

  private patch(
    computerSessionId: string,
    change: Partial<Pick<ComputerUsePipSessionState, 'status' | 'lastSummary'>>,
    timestamp: string,
  ): void {
    const current = this.sessions.get(computerSessionId)
    const label =
      this.known.listLabeled().find((item) => item.computerSessionId === computerSessionId)
        ?.label ??
      current?.label ??
      '电脑操作'
    const next: ComputerUsePipSessionState = {
      computerSessionId,
      label,
      status: change.status ?? current?.status ?? 'running',
      lastSummary:
        change.lastSummary !== undefined ? change.lastSummary : (current?.lastSummary ?? null),
      lastEventAt: timestamp,
    }
    this.sessions.set(computerSessionId, next)
  }
}
