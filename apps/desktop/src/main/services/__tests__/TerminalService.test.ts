import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionInfo } from '@spark/protocol'

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}))

vi.mock('@spark/storage', () => ({
  WorkspaceRepository: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  getDatabase: vi.fn(),
}))

vi.mock('../../ipc/typed-ipc.js', () => ({
  pushStreamEvent: vi.fn(),
}))

import { buildTerminalSessionActivity } from '../TerminalService.js'

const terminal = (
  sessionId: string,
  status: TerminalSessionInfo['status'],
): TerminalSessionInfo =>
  ({
    id: `${sessionId}-${status}`,
    sessionId,
    title: 'Terminal',
    cwd: '/tmp',
    shell: '/bin/zsh',
    cols: 80,
    rows: 24,
    status,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  }) as TerminalSessionInfo

describe('TerminalService activity summary', () => {
  it('only exposes sessions with running terminals', () => {
    expect(
      buildTerminalSessionActivity([
        terminal('session-running', 'running'),
        terminal('session-running', 'exited'),
        terminal('session-exited', 'exited'),
      ]),
    ).toEqual([
      {
        sessionId: 'session-running',
        running: 1,
        total: 2,
      },
    ])
  })
})
