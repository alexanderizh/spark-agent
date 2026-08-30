// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { SidebarGitFooter, shouldShowSidebarGitFooter } from './SidebarGitFooter'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function buildStatus(
  overrides: Partial<WorkspaceGitStatusResponse> = {},
): WorkspaceGitStatusResponse {
  return {
    state: {
      kind: 'ready',
      repositoryKind: 'worktree',
      runtimeSource: 'system',
      runtimeVersion: '2.0',
    },
    isGitRepo: true,
    currentBranch: 'release-5.3.0',
    branches: ['release-5.3.0'],
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
    remoteBranch: 'release-5.3.0',
    pullRequestUrl: null,
    stashEntries: [],
    files: [],
    ...overrides,
  }
}

describe('shouldShowSidebarGitFooter', () => {
  it('status 未加载（null）时显示占位 footer', () => {
    expect(shouldShowSidebarGitFooter(null)).toBe(true)
  })

  it('是 Git 仓库时显示', () => {
    expect(shouldShowSidebarGitFooter(buildStatus())).toBe(true)
  })

  it('非 Git 仓库时隐藏', () => {
    expect(shouldShowSidebarGitFooter(buildStatus({ isGitRepo: false }))).toBe(false)
  })
})

describe('SidebarGitFooter 渲染', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('显示分支名与待同步数量，有待同步时按钮高亮', () => {
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ ahead: 1, behind: 2 })}
          busy={false}
          onSync={() => {}}
        />,
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('release-5.3.0')
    expect(text).toContain('↑1')
    expect(text).toContain('↓2')
    expect(container.querySelector('.gp-sync-btn')?.className).toContain('pending')
  })

  it('没有配置远端时同步按钮禁用', () => {
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ hasRemote: false, remoteName: null })}
          busy={false}
          onSync={() => {}}
        />,
      )
    })
    expect((container.querySelector('.gp-sync-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('busy（同步进行中）时同步按钮禁用并显示 spinner', () => {
    act(() => {
      root.render(<SidebarGitFooter status={buildStatus()} busy onSync={() => {}} />)
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.querySelector('.gp-spin')).toBeTruthy()
  })
})
