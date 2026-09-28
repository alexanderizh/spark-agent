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
          onPublish={() => {}}
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
          onPublish={() => {}}
        />,
      )
    })
    expect((container.querySelector('.gp-sync-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('busy（同步进行中）时同步按钮禁用并显示 spinner', () => {
    act(() => {
      root.render(
        <SidebarGitFooter status={buildStatus()} busy onSync={() => {}} onPublish={() => {}} />,
      )
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.querySelector('.gp-spin')).toBeTruthy()
  })
})

describe('SidebarGitFooter 发布态（本地新分支未发布）', () => {
  let container: HTMLDivElement
  let root: Root
  const onSync = vi.fn()
  const onPublish = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onSync.mockClear()
    onPublish.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('有远端且无上游时按钮切换为「发布」并高亮', () => {
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ branchHasUpstream: false })}
          busy={false}
          onSync={onSync}
          onPublish={onPublish}
        />,
      )
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    expect(btn.textContent).toContain('发布')
    expect(btn.className).toContain('pending')
    expect(btn.title).toContain('发布')
  })

  it('发布态点击触发 onPublish（推送建立上游），不触发 onSync', () => {
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ branchHasUpstream: false })}
          busy={false}
          onSync={onSync}
          onPublish={onPublish}
        />,
      )
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    btn.click()
    expect(onPublish).toHaveBeenCalledTimes(1)
    expect(onSync).not.toHaveBeenCalled()
  })

  it('已发布分支（有上游）保持「同步」语义，点击触发 onSync', () => {
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ branchHasUpstream: true })}
          busy={false}
          onSync={onSync}
          onPublish={onPublish}
        />,
      )
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    expect(btn.textContent).toContain('同步')
    btn.click()
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('无远端时不进入发布态（按钮保持禁用的同步）', () => {
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ hasRemote: false, remoteName: null, branchHasUpstream: false })}
          busy={false}
          onSync={onSync}
          onPublish={onPublish}
        />,
      )
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    expect(btn.textContent).toContain('同步')
    expect(btn.disabled).toBe(true)
  })

  it('分离头指针（detachedHead）不进入发布态，保持同步语义', () => {
    // detached 下 @{u} 必然解析失败（branchHasUpstream false），但 currentBranch 是
    // tag/短 SHA，不构成可发布分支；误入发布态会诱导用户点击必然失败的动作。
    act(() => {
      root.render(
        <SidebarGitFooter
          status={buildStatus({ branchHasUpstream: false, detachedHead: true })}
          busy={false}
          onSync={onSync}
          onPublish={onPublish}
        />,
      )
    })
    const btn = container.querySelector('.gp-sync-btn') as HTMLButtonElement
    expect(btn.textContent).toContain('同步')
    expect(btn.title).toContain('同步')
    btn.click()
    expect(onSync).toHaveBeenCalledTimes(1)
    expect(onPublish).not.toHaveBeenCalled()
  })
})
