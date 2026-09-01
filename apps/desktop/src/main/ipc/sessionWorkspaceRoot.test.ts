import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureSessionWorkspaceRootPath } from '@spark/agent-runtime'
import { SessionRepository, WorkspaceRepository } from '@spark/storage'

import { resolveSessionScopedWorkspaceRoot } from './sessionWorkspaceRoot.js'

vi.mock('../db.js', () => ({ getDatabase: vi.fn(() => ({})) }))
vi.mock('@spark/agent-runtime', () => ({
  ensureSessionWorkspaceRootPath: vi.fn(
    async (_workspace, sessionId: string) => `/data/no-project/${sessionId}`,
  ),
}))
vi.mock('@spark/storage', () => ({
  SessionRepository: vi.fn(),
  WorkspaceRepository: vi.fn(),
}))

describe('resolveSessionScopedWorkspaceRoot', () => {
  const workspace = {
    id: 'workspace-1',
    name: '不使用项目',
    root_path: '/data/no-project',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(WorkspaceRepository).mockImplementation(
      () => ({ findByIdOrFail: vi.fn(() => workspace) }) as never,
    )
    vi.mocked(SessionRepository).mockImplementation(
      () => ({ getWorkspaceIds: vi.fn(() => [workspace.id]) }) as never,
    )
  })

  it('resolves associated sessions through the shared session root helper', async () => {
    await expect(resolveSessionScopedWorkspaceRoot(workspace.id, 'session-1')).resolves.toBe(
      '/data/no-project/session-1',
    )
    expect(ensureSessionWorkspaceRootPath).toHaveBeenCalledWith(workspace, 'session-1')
  })

  it('rejects a session that is not associated with the workspace', async () => {
    vi.mocked(SessionRepository).mockImplementation(
      () => ({ getWorkspaceIds: vi.fn(() => ['workspace-2']) }) as never,
    )

    await expect(resolveSessionScopedWorkspaceRoot(workspace.id, 'session-1')).rejects.toThrow(
      'Session is not associated with the requested workspace',
    )
  })

  it('keeps legacy workspace-only operations on the stored root', async () => {
    await expect(resolveSessionScopedWorkspaceRoot(workspace.id)).resolves.toBe(workspace.root_path)
    expect(ensureSessionWorkspaceRootPath).not.toHaveBeenCalled()
  })
})
