// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitReviewPanel } from './ChatGitReview'

vi.mock('../../components/SessionFileOpenPicker', () => ({
  SessionFileOpenPicker: ({ filePath }: { filePath: string }) => (
    <button type="button" data-testid="git-review-file-open">
      {filePath}
    </button>
  ),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createStatus(additions: number, fileStatus = 'M'): WorkspaceGitStatusResponse {
  return {
    isGitRepo: true,
    currentBranch: 'master',
    branches: ['master'],
    ahead: 0,
    behind: 0,
    additions,
    deletions: additions,
    changedFiles: 1,
    stagedFiles: 1,
    unstagedFiles: 0,
    untrackedFiles: 0,
    hasRemote: true,
    remoteName: 'origin',
    remoteBranch: 'master',
    pullRequestUrl: null,
    stashEntries: [],
    files: [
      {
        path: 'src/prod.js',
        status: fileStatus,
        staged: true,
        unstaged: false,
        untracked: false,
        additions,
        deletions: additions,
      },
    ],
  }
}

describe('GitReviewPanel diff refresh', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reloads an expanded diff when status refreshes for the same path', async () => {
    let diffCall = 0
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:git-file-diff') {
        diffCall += 1
        return {
          diff:
            diffCall === 1
              ? '@@ -1 +1 @@\n-old value\n+first value'
              : '@@ -1 +1 @@\n-old value\n+refreshed value',
          isBinary: false,
        }
      }
      return {}
    })
    vi.stubGlobal('spark', { invoke, on: vi.fn(() => vi.fn()) })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <GitReviewPanel
          workspaceId="workspace-1"
          workspaceRootPath={'G:\\worktrees\\feature'}
          status={createStatus(1)}
          width={520}
          onWidthChange={vi.fn()}
          onRefresh={vi.fn(async () => {})}
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.git-review-file-row')?.click()
    })
    await vi.waitFor(() => expect(container.textContent).toContain('first value'))

    await act(async () => {
      root.render(
        <GitReviewPanel
          workspaceId="workspace-1"
          workspaceRootPath={'G:\\worktrees\\feature'}
          status={createStatus(2)}
          width={520}
          onWidthChange={vi.fn()}
          onRefresh={vi.fn(async () => {})}
          onClose={vi.fn()}
        />,
      )
    })

    await vi.waitFor(() => expect(container.textContent).toContain('refreshed value'))
    expect(diffCall).toBe(2)
  })

  it('offers the same absolute file target in the diff list and file tree', async () => {
    vi.stubGlobal('spark', { invoke: vi.fn(async () => ({})), on: vi.fn(() => vi.fn()) })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <GitReviewPanel
          workspaceId="workspace-1"
          workspaceRootPath={'G:\\worktrees\\feature'}
          status={createStatus(1)}
          width={640}
          onWidthChange={vi.fn()}
          onRefresh={vi.fn(async () => {})}
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click()
    })

    const openers = container.querySelectorAll('[data-testid="git-review-file-open"]')
    expect(openers).toHaveLength(2)
    expect(openers[0]?.closest('.git-review-file-row')).toBeNull()
    expect(openers[1]?.closest('.git-review-tree-row')).toBeNull()
    expect(Array.from(openers, (node) => node.textContent)).toEqual([
      'G:\\worktrees\\feature\\src/prod.js',
      'G:\\worktrees\\feature\\src/prod.js',
    ])
  })

  it('does not offer opening for deleted files', async () => {
    vi.stubGlobal('spark', { invoke: vi.fn(async () => ({})), on: vi.fn(() => vi.fn()) })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <GitReviewPanel
          workspaceId="workspace-1"
          workspaceRootPath={'G:\\worktrees\\feature'}
          status={createStatus(1, 'D')}
          width={640}
          onWidthChange={vi.fn()}
          onRefresh={vi.fn(async () => {})}
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click()
    })

    expect(container.querySelector('[data-testid="git-review-file-open"]')).toBeNull()
  })
})
