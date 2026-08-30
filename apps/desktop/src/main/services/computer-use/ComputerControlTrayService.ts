import type { ComputerSession, ComputerSessionStatus } from '@spark/protocol'

export interface ComputerControlTrayEntry {
  computerSessionId: string
  label: string
  status: ComputerSessionStatus
  canPause: boolean
}

interface TraySessions {
  listActiveSessionIds(): string[]
  getSession(computerSessionId: string): ComputerSession | null
}

interface TrayBroker {
  pause(computerSessionId: string): Promise<unknown> | unknown
  stop(computerSessionId: string): Promise<unknown>
}

interface TrayCoordinator {
  release(computerSessionId: string): void
}

/** Read-only status projection plus explicit user controls for the system tray. */
export class ComputerControlTrayService {
  constructor(
    private readonly sessions: TraySessions,
    private readonly broker: TrayBroker,
    private readonly coordinator?: TrayCoordinator,
  ) {}

  list(): ComputerControlTrayEntry[] {
    return this.sessions.listActiveSessionIds().flatMap((computerSessionId) => {
      const session = this.sessions.getSession(computerSessionId)
      if (session == null) return []
      return [
        {
          computerSessionId,
          label: targetLabel(session),
          status: session.status,
          canPause: session.status !== 'paused' && session.status !== 'handoff_required',
        },
      ]
    })
  }

  async pause(computerSessionId: string): Promise<void> {
    try {
      await this.broker.pause(computerSessionId)
    } finally {
      this.coordinator?.release(computerSessionId)
    }
  }

  async takeover(computerSessionId: string): Promise<void> {
    // Taking over means the local user becomes authoritative and Agent execution is paused.
    try {
      await this.broker.pause(computerSessionId)
    } finally {
      this.coordinator?.release(computerSessionId)
    }
  }

  async stop(computerSessionId: string): Promise<void> {
    try {
      await this.broker.stop(computerSessionId)
    } finally {
      this.coordinator?.release(computerSessionId)
    }
  }
}

function targetLabel(session: ComputerSession): string {
  return session.environment === 'my_desktop' ? '所有应用' : '桌面'
}
