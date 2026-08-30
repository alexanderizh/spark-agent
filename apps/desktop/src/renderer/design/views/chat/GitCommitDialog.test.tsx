// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitCommitDialog } from './ChatGitDialogs'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const files: WorkspaceGitStatusResponse['files'] = [
  {
    path: 'packages/agent-runtime/src/a.ts',
    status: 'M',
    staged: true,
    unstaged: false,
    untracked: false,
    additions: 10,
    deletions: 2,
  },
  {
    path: 'packages/agent-runtime/src/b.ts',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    additions: 5,
    deletions: 1,
  },
  {
    path: 'scripts/new-tool.mjs',
    status: '??',
    staged: false,
    unstaged: true,
    untracked: true,
    additions: 30,
    deletions: 0,
  },
]

function createStatus(): WorkspaceGitStatusResponse {
  return {
    state: {
      kind: 'ready',
      repositoryKind: 'worktree',
      runtimeSource: 'system',
      runtimeVersion: '2.50.0',
    },
    isGitRepo: true,
    currentBranch: 'master',
    branches: ['master'],
    ahead: 0,
    behind: 0,
    additions: 45,
    deletions: 3,
    changedFiles: files.length,
    stagedFiles: 1,
    unstagedFiles: 2,
    untrackedFiles: 1,
    hasRemote: false,
    remoteName: null,
    remoteBranch: null,
    pullRequestUrl: null,
    stashEntries: [],
    files,
  }
}

type CommitCall = {
  message: string
  includeUnstaged: boolean
  push: boolean
  paths?: string[]
}

let container: HTMLDivElement
let root: Root | null = null

async function renderDialog(status: WorkspaceGitStatusResponse) {
  const calls: CommitCall[] = []
  const onCommit = vi.fn(async (options: CommitCall) => {
    calls.push(options)
  })
  const onPull = vi.fn(async () => {})
  const created: Root = createRoot(container)
  root = created
  await act(async () => {
    created.render(
      <GitCommitDialog
        status={status}
        branchState={{ currentBranch: 'master', branches: ['master'] }}
        onClose={() => {}}
        onCommit={onCommit}
        onPush={vi.fn(async () => {})}
        onPull={onPull}
        onRefresh={vi.fn(async () => {})}
      />,
    )
  })
  return { calls, onCommit, onPull }
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

function clickFirstMatching(label: string) {
  const button = [...document.body.querySelectorAll('button')].find((el) =>
    el.textContent?.includes(label),
  )
  if (button == null) throw new Error(`button not found: ${label}`)
  act(() => {
    button.click()
  })
  return button
}

function clickRowCheckbox(scopePath: string) {
  const input = document.body.querySelector<HTMLInputElement>(
    `.git-scope-tree-row input[type="checkbox"][data-scope-path="${scopePath}"]`,
  )
  if (input == null) throw new Error(`checkbox not found: ${scopePath}`)
  act(() => {
    input.click()
  })
}

function setSearchValue(value: string) {
  const search = document.body.querySelector<HTMLInputElement>('.git-scope-tree-search input')
  if (search == null) throw new Error('search input not found')
  // React 受控 input 需走原型 setter 绕过 value tracker，否则 onChange 不触发
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(search, value)
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('GitCommitDialog commit scope', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = null
    container.remove()
    document.body.innerHTML = ''
  })

  it('commits everything without paths until the user picks files', async () => {
    const { calls } = await renderDialog(createStatus())

    expect(bodyText()).toContain('全部 · 3 个文件')
    expect(bodyText()).not.toContain('已选')

    // 全量默认：提交不带 paths，维持既有语义
    clickFirstMatching('提交')
    await act(async () => {})
    expect(calls[0]).toMatchObject({ includeUnstaged: true, push: false })
    expect(calls[0]?.paths).toBeUndefined()
  })

  it('enters partial scope with everything selected and forwards only picked paths', async () => {
    const { calls } = await renderDialog(createStatus())

    clickFirstMatching('选择文件')
    expect(document.body.querySelector('.git-scope-tree-panel')).not.toBeNull()
    expect(bodyText()).toContain('已选 3/3')

    // 取消整个 agent-runtime/src 文件夹（两个文件）
    clickRowCheckbox('packages/agent-runtime/src')
    expect(bodyText()).toContain('已选 1/3')

    clickFirstMatching('提交')
    await act(async () => {})
    expect(calls[0]?.paths).toEqual(['scripts/new-tool.mjs'])
  })

  it('disables commit when the partial selection is empty', async () => {
    await renderDialog(createStatus())

    clickFirstMatching('选择文件')
    clickFirstMatching('清空')
    expect(bodyText()).toContain('已选 0/3')

    const commitButton = [...document.body.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('提交'),
    )
    expect(commitButton?.disabled).toBe(true)
    expect(document.body.querySelector('.git-commit-scope-chip.is-empty')).not.toBeNull()
  })

  it('keeps folder checkbox tri-state behavior and search filtering', async () => {
    await renderDialog(createStatus())

    clickFirstMatching('选择文件')
    // 取消文件夹里其中一个文件 → 文件夹进入半选（2/1 → 已选 2/3）
    clickRowCheckbox('packages/agent-runtime/src/b.ts')
    expect(bodyText()).toContain('已选 2/3')

    // 搜索裁剪：只命中 scripts 目录
    setSearchValue('scripts')
    expect(bodyText()).toContain('scripts')
    expect(bodyText()).not.toContain('a.ts')
  })

  it('narrows the selectable tree to staged files when excluding unstaged changes', async () => {
    await renderDialog(createStatus())

    // 关掉「包含未暂存的更改」再进入选择：树里只剩已暂存文件
    const includeToggle = document.body.querySelector<HTMLInputElement>(
      '.git-checkbox-row input[type="checkbox"]',
    )
    expect(includeToggle).not.toBeNull()
    act(() => {
      includeToggle!.click()
    })
    clickFirstMatching('选择文件')
    expect(bodyText()).toContain('已选 1/1')
    expect(bodyText()).toContain('a.ts')
    expect(bodyText()).not.toContain('b.ts')
  })
})

describe('GitCommitDialog pull action', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = null
    container.remove()
    document.body.innerHTML = ''
  })

  function findPullButton(): HTMLButtonElement | undefined {
    return [...document.body.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('拉取'),
    )
  }

  it('pulls remote updates when a remote is configured, showing the behind pill', async () => {
    const status = createStatus()
    status.hasRemote = true
    status.behind = 3
    const { onPull } = await renderDialog(status)

    expect(bodyText()).toContain('待拉取 3')
    const button = findPullButton()
    expect(button?.disabled).toBe(false)

    act(() => {
      button!.click()
    })
    await act(async () => {})
    expect(onPull).toHaveBeenCalledTimes(1)
  })

  it('keeps the pull button enabled even when behind is stale at zero', async () => {
    // behind 基于 remote-tracking 引用可能过期为 0，但远端实际有新提交；
    // pull 自带 fetch，因此只要配置了远端就允许随时拉取。
    const status = createStatus()
    status.hasRemote = true
    status.behind = 0
    await renderDialog(status)

    expect(bodyText()).not.toContain('待拉取')
    expect(findPullButton()?.disabled).toBe(false)
  })

  it('disables the pull button when no remote is configured', async () => {
    const status = createStatus()
    status.hasRemote = false
    await renderDialog(status)

    expect(findPullButton()?.disabled).toBe(true)
  })
})
