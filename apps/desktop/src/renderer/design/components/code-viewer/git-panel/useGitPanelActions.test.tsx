// @vitest-environment jsdom

import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../Toast', () => ({
  useToast: () => ({ toast: { success: mocks.success, error: mocks.error } }),
}))

import { useGitPanelActions } from './useGitPanelActions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let currentSync: (() => Promise<boolean>) | null = null

function Harness() {
  const { sync } = useGitPanelActions({
    workspaceId: 'workspace-1',
    onStatusApplied: vi.fn(),
  })
  useEffect(() => {
    currentSync = sync
    return () => {
      currentSync = null
    }
  }, [sync])
  return null
}

function createStatus(): WorkspaceGitStatusResponse {
  return {
    state: {
      kind: 'ready',
      repositoryKind: 'worktree',
      runtimeSource: 'system',
      runtimeVersion: '2.50.1',
    },
    isGitRepo: true,
    currentBranch: 'feature/local-review',
    branches: ['feature/local-review'],
    ahead: 0,
    behind: 0,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    stagedFiles: 0,
    unstagedFiles: 0,
    untrackedFiles: 0,
    hasRemote: true,
    remoteName: 'origin',
    remoteBranch: 'feature/local-review',
    pullRequestUrl: null,
    stashEntries: [],
    files: [],
  }
}

describe('useGitPanelActions.sync', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    currentSync = null
    mocks.invoke.mockReset().mockResolvedValue({
      synchronized: true,
      mode: 'push',
      status: createStatus(),
    })
    mocks.success.mockReset()
    mocks.error.mockReset()
    vi.stubGlobal('spark', { invoke: mocks.invoke })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('uses the unified sync IPC so a new branch can push without pulling first', async () => {
    await act(async () => root.render(<Harness />))
    if (currentSync == null) throw new Error('Sync callback was not mounted')
    const sync = currentSync

    await act(async () => {
      await expect(sync()).resolves.toBe(true)
    })

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('workspace:git-sync', {
      workspaceId: 'workspace-1',
    })
    expect(mocks.invoke).not.toHaveBeenCalledWith('workspace:git-pull', {
      workspaceId: 'workspace-1',
    })
    expect(mocks.success).toHaveBeenCalledWith('已推送新分支')
  })
})
