// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  onOpenHistoricalFile: vi.fn(),
}))

vi.mock('../VscodeFileIcon', () => ({
  VscodeFileIcon: () => <span data-testid="file-icon" />,
}))

import { GitCommitHistory } from './GitCommitHistory'
import { GitCommitDetailPopover } from './GitCommitDetailPopover'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const commitHash = 'a'.repeat(40)
const historyHash = 'b'.repeat(40)

function commit(overrides: Record<string, unknown> = {}) {
  return {
    hash: commitHash,
    shortHash: 'aaaaaaa',
    subject: 'update feature',
    authorName: 'Spark Test',
    date: '2026-09-08T09:00:00.000Z',
    unpushed: false,
    ...overrides,
  }
}

describe('GitCommitHistory', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.invoke.mockReset().mockImplementation((channel: string) => {
      if (channel === 'workspace:git-commit-files') {
        return Promise.resolve({ files: [{ path: 'src/feature.ts', status: 'M' }] })
      }
      if (channel === 'workspace:git-file-history') {
        return Promise.resolve({
          commits: [commit({ hash: historyHash, shortHash: 'bbbbbbb', path: 'src/feature.ts' })],
        })
      }
      return Promise.resolve({})
    })
    mocks.onOpenHistoricalFile.mockReset()
    vi.stubGlobal('spark', { invoke: mocks.invoke })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('expands a commit, loads file history, and opens a selected historical diff', async () => {
    await act(async () => {
      root.render(
        <GitCommitHistory
          workspaceId="workspace-1"
          commits={[commit()]}
          loading={false}
          error={null}
          collapsed={false}
          onToggle={vi.fn()}
          onRefresh={vi.fn()}
          onOpenHistoricalFile={mocks.onOpenHistoricalFile}
        />,
      )
    })

    const commitRow = container.querySelector('.gp-commit-row')
    expect(commitRow).not.toBeNull()
    await act(async () => {
      ;(commitRow as HTMLButtonElement).click()
    })
    expect(mocks.invoke).toHaveBeenCalledWith('workspace:git-commit-files', {
      workspaceId: 'workspace-1',
      hash: commitHash,
    })
    expect(container.querySelector('.gp-commit-file-row')).not.toBeNull()

    await act(async () => {
      ;(container.querySelector('.gp-commit-file-row') as HTMLButtonElement).click()
    })
    expect(mocks.invoke).toHaveBeenCalledWith('workspace:git-file-history', {
      workspaceId: 'workspace-1',
      path: 'src/feature.ts',
      limit: 100,
    })
    expect(container.querySelector('.gp-commit-history-row')).not.toBeNull()

    await act(async () => {
      ;(container.querySelector('.gp-commit-history-row') as HTMLButtonElement).click()
    })
    expect(mocks.onOpenHistoricalFile).toHaveBeenCalledWith('src/feature.ts', historyHash, 'modify')
  })
})

describe('GitCommitDetailPopover', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelector('.gp-cpop')?.remove()
  })

  it('shows one short hash while copying the full hash', async () => {
    const anchor = document.createElement('div')
    document.body.appendChild(anchor)
    await act(async () => {
      root.render(
        <GitCommitDetailPopover
          commit={commit({ shortHash: 'short01' })}
          anchorEl={anchor}
          onMouseEnter={vi.fn()}
          onMouseLeave={vi.fn()}
        />,
      )
    })

    expect(document.querySelector('.gp-cpop-short')?.textContent).toBe('short01')
    expect(document.querySelector('.gp-cpop-hash')).toBeNull()
    await act(async () => {
      ;(document.querySelector('.gp-cpop-copy') as HTMLButtonElement).click()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(commitHash)
    anchor.remove()
  })
})
