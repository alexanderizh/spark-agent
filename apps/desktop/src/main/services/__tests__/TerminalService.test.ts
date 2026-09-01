import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
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

import { spawn } from 'node-pty'
import { WorkspaceRepository } from '@spark/storage'
import {
  _resetTerminalServiceForTests,
  buildTerminalSessionActivity,
  getTerminalService,
} from '../TerminalService.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  _resetTerminalServiceForTests()
  vi.clearAllMocks()
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

const terminal = (sessionId: string, status: TerminalSessionInfo['status']): TerminalSessionInfo =>
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

describe('TerminalService workspace isolation', () => {
  it('starts a no-project terminal inside the session directory', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'spark-terminal-no-project-'))
    temporaryRoots.push(rootPath)
    const workspace = { id: 'workspace-1', name: '不使用项目', root_path: rootPath }
    vi.mocked(WorkspaceRepository).mockImplementation(
      () =>
        ({
          get: vi.fn(() => workspace),
          listAll: vi.fn(() => [workspace]),
        }) as never,
    )
    vi.mocked(spawn).mockReturnValue(createPtyMock())

    const result = getTerminalService().create({
      sessionId: 'session-1' as never,
      workspaceId: workspace.id,
      // Compatibility path: older renderers send the shared workspace root.
      cwd: rootPath,
    })

    const expectedCwd = await realpath(path.join(rootPath, 'session-1'))
    expect(result.terminal.cwd).toBe(expectedCwd)
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ cwd: expectedCwd }),
    )
  })

  it('keeps project terminals on the project root', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'spark-terminal-project-'))
    temporaryRoots.push(rootPath)
    const workspace = { id: 'workspace-1', name: 'Spark Agent', root_path: rootPath }
    vi.mocked(WorkspaceRepository).mockImplementation(
      () =>
        ({
          get: vi.fn(() => workspace),
          listAll: vi.fn(() => [workspace]),
        }) as never,
    )
    vi.mocked(spawn).mockReturnValue(createPtyMock())

    const result = getTerminalService().create({
      sessionId: 'session-1' as never,
      workspaceId: workspace.id,
      cwd: rootPath,
    })

    expect(result.terminal.cwd).toBe(await realpath(rootPath))
  })
})

function createPtyMock(): ReturnType<typeof spawn> {
  return {
    pid: 123,
    onData: vi.fn(),
    onExit: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  } as unknown as ReturnType<typeof spawn>
}
