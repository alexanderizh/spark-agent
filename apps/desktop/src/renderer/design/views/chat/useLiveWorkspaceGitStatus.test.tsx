// @vitest-environment jsdom

import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SessionId, WorkspaceGitStatusResponse } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveWorkspaceGitStatus } from './useLiveWorkspaceGitStatus'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createGitStatus(
  overrides: Partial<WorkspaceGitStatusResponse> = {},
): WorkspaceGitStatusResponse {
  return {
    isGitRepo: true,
    currentBranch: 'master',
    branches: ['master'],
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
    remoteBranch: 'master',
    pullRequestUrl: null,
    stashEntries: [],
    files: [],
    ...overrides,
  }
}

function GitStatusProbe() {
  const [, setBranchState] = useState({
    currentBranch: null as string | null,
    branches: [] as string[],
  })
  const { gitStatus, refreshGitStatus } = useLiveWorkspaceGitStatus({
    workspaceId: 'workspace-1',
    sessionId: 'session-1' as SessionId,
    refreshSignal: 0,
    live: false,
    onBranchStateChange: setBranchState,
  })
  return (
    <div>
      <span data-testid="changed-files">{gitStatus?.changedFiles ?? -1}</span>
      <button type="button" onClick={() => void refreshGitStatus()}>
        refresh
      </button>
    </div>
  )
}

describe('useLiveWorkspaceGitStatus', () => {
  let container: HTMLDivElement
  let root: Root
  let streamHandlers: Map<string, (payload: never) => void>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    streamHandlers = new Map()
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('refreshes the Git snapshot after a workspace file event', async () => {
    let status = createGitStatus()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:git-status') return status
      if (channel === 'workspace:watch-start') return { watching: true }
      if (channel === 'workspace:watch-stop') return { stopped: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (payload: never) => void) => {
        streamHandlers.set(channel, callback)
        return vi.fn()
      }),
    })

    await act(async () => {
      root = createRoot(container)
      root.render(<GitStatusProbe />)
    })
    await vi.waitFor(() => expect(container.textContent).toContain('0'))

    status = createGitStatus({ changedFiles: 1, additions: 3, deletions: 3 })
    await act(async () => {
      streamHandlers.get('stream:workspace:file-change')?.({
        workspaceId: 'workspace-1',
        changeType: 'modify',
        path: 'src/prod.js',
        timestamp: new Date().toISOString(),
      } as never)
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(container.querySelector('[data-testid="changed-files"]')?.textContent).toBe('1')
    expect(invoke).toHaveBeenCalledWith('workspace:watch-start', { workspaceId: 'workspace-1' })
    expect(invoke).toHaveBeenCalledWith('workspace:git-status', { workspaceId: 'workspace-1' })
  })

  it('does not let a slower stale request overwrite a newer refresh', async () => {
    let resolveFirst!: (status: WorkspaceGitStatusResponse) => void
    let resolveSecond!: (status: WorkspaceGitStatusResponse) => void
    const first = new Promise<WorkspaceGitStatusResponse>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<WorkspaceGitStatusResponse>((resolve) => {
      resolveSecond = resolve
    })
    let statusCall = 0
    const invoke = vi.fn((channel: string) => {
      if (channel === 'workspace:git-status') {
        statusCall += 1
        return statusCall === 1 ? first : second
      }
      if (channel === 'workspace:watch-start') return Promise.resolve({ watching: true })
      if (channel === 'workspace:watch-stop') return Promise.resolve({ stopped: true })
      return Promise.resolve({})
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (payload: never) => void) => {
        streamHandlers.set(channel, callback)
        return vi.fn()
      }),
    })

    await act(async () => {
      root = createRoot(container)
      root.render(<GitStatusProbe />)
    })
    await vi.waitFor(() => expect(statusCall).toBe(1))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click()
    })
    await vi.waitFor(() => expect(statusCall).toBe(2))

    await act(async () => resolveSecond(createGitStatus({ changedFiles: 2 })))
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="changed-files"]')?.textContent).toBe('2')
    })

    await act(async () => resolveFirst(createGitStatus({ changedFiles: 1 })))
    expect(container.querySelector('[data-testid="changed-files"]')?.textContent).toBe('2')
  })
})
