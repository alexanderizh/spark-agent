// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceGitFileChange } from '@spark/protocol'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onStage: vi.fn(),
  onUnstage: vi.fn(),
  onOpenFile: vi.fn(),
  onDiscardRequest: vi.fn(),
  onAddToChat: vi.fn(),
}))

vi.mock('../VscodeFileIcon', () => ({
  VscodeFileIcon: () => <span data-testid="file-icon" />,
}))

vi.mock('../../Toast', () => ({
  useToast: () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }),
}))

import { GitGroupSection } from './GitChangesSection'
import { OPEN_IN_FILE_MANAGER_LABEL } from '../file-explorer/fileExplorerActions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function change(overrides: Partial<WorkspaceGitFileChange> = {}): WorkspaceGitFileChange {
  return {
    path: 'src/a.ts',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    additions: 3,
    deletions: 1,
    ...overrides,
  }
}

interface RenderOptions {
  group: 'staged' | 'changes'
  files: WorkspaceGitFileChange[]
  busy?: boolean
  withAddToChat?: boolean
  /** rootAbsPath 是否已知（默认 true；false 时隐藏「在系统文件夹打开」） */
  withRoot?: boolean
}

describe('GitGroupSection 文件行右键菜单', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.onStage.mockReset()
    mocks.onUnstage.mockReset()
    mocks.onOpenFile.mockReset()
    mocks.onDiscardRequest.mockReset()
    mocks.onAddToChat.mockReset()
    vi.stubGlobal('spark', { invoke: mocks.invoke })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelector('.context-action-menu')?.remove()
    vi.unstubAllGlobals()
  })

  async function renderSection(options: RenderOptions): Promise<void> {
    await act(async () => {
      root.render(
        <GitGroupSection
          title={options.group === 'staged' ? '已暂存' : '更改'}
          group={options.group}
          files={options.files}
          labels={new Map()}
          viewMode="list"
          collapsed={false}
          busy={options.busy === true ? 'stage' : null}
          rootAbsPath={options.withRoot === false ? null : '/repo'}
          onAddToChat={options.withAddToChat === false ? undefined : mocks.onAddToChat}
          onToggle={vi.fn()}
          onStage={mocks.onStage}
          onUnstage={mocks.onUnstage}
          onOpenFile={mocks.onOpenFile}
          onDiscardRequest={mocks.onDiscardRequest}
        />,
      )
    })
  }

  async function openMenuOnRow(): Promise<void> {
    const row = container.querySelector('.gp-file-row') as HTMLDivElement
    expect(row).not.toBeNull()
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 60,
        }),
      )
    })
  }

  function menuItems(): HTMLButtonElement[] {
    return Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.context-action-menu .action-menu-item'),
    )
  }

  it('changes 组右键弹出完整菜单：打开 / 添加到对话 / 复制路径 / 在系统文件夹显示 / 暂存 / 丢弃更改', async () => {
    await renderSection({ group: 'changes', files: [change()] })
    await openMenuOnRow()
    expect(menuItems().map((item) => item.textContent)).toEqual([
      '在编辑器中打开',
      '添加到对话',
      '复制路径',
      OPEN_IN_FILE_MANAGER_LABEL,
      '暂存',
      '丢弃更改',
    ])
    expect(document.querySelector('.context-action-menu .action-menu-divider')).not.toBeNull()
  })

  it('复制路径写入绝对路径并提示成功，随后菜单收起', async () => {
    await renderSection({ group: 'changes', files: [change()] })
    await openMenuOnRow()
    await act(async () => {
      menuItems()[2]?.click()
    })
    expect(mocks.invoke).toHaveBeenCalledWith('clipboard:write-text', {
      text: '/repo/src/a.ts',
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已复制路径')
    expect(menuItems()).toHaveLength(0)
  })

  it('「在系统文件夹显示」调用 file:reveal 打开所在目录并选中文件', async () => {
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'file:reveal' ? Promise.resolve({ revealed: true }) : Promise.resolve(undefined),
    )
    await renderSection({ group: 'changes', files: [change()] })
    await openMenuOnRow()
    await act(async () => {
      menuItems()
        .find((item) => item.textContent === OPEN_IN_FILE_MANAGER_LABEL)
        ?.click()
    })
    expect(mocks.invoke).toHaveBeenCalledWith('file:reveal', { filePath: '/repo/src/a.ts' })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('已删除文件不显示「在系统文件夹显示」', async () => {
    await renderSection({ group: 'changes', files: [change({ status: 'D' })] })
    await openMenuOnRow()
    expect(menuItems().map((item) => item.textContent)).not.toContain(OPEN_IN_FILE_MANAGER_LABEL)
  })

  it('工作区根未知（rootAbsPath 为 null）时不显示「在系统文件夹显示」', async () => {
    await renderSection({ group: 'changes', files: [change()], withRoot: false })
    await openMenuOnRow()
    expect(menuItems().map((item) => item.textContent)).not.toContain(OPEN_IN_FILE_MANAGER_LABEL)
  })

  it('暂存与丢弃更改分别触发 onStage / onDiscardRequest', async () => {
    await renderSection({ group: 'changes', files: [change()] })
    await openMenuOnRow()
    await act(async () => {
      menuItems()
        .find((item) => item.textContent === '暂存')
        ?.click()
    })
    expect(mocks.onStage).toHaveBeenCalledWith(['src/a.ts'])

    await openMenuOnRow()
    await act(async () => {
      menuItems()
        .find((item) => item.textContent === '丢弃更改')
        ?.click()
    })
    expect(mocks.onDiscardRequest).toHaveBeenCalledWith(['src/a.ts'], 'a.ts')
  })

  it('staged 组显示取消暂存，不显示暂存与丢弃更改', async () => {
    await renderSection({ group: 'staged', files: [change({ staged: true, unstaged: false })] })
    await openMenuOnRow()
    const labels = menuItems().map((item) => item.textContent)
    expect(labels).toContain('取消暂存')
    expect(labels).not.toContain('丢弃更改')
    // 添加到对话与所在组无关，staged 组同样提供
    expect(labels).toContain('添加到对话')

    await act(async () => {
      menuItems().at(-1)?.click()
    })
    expect(mocks.onUnstage).toHaveBeenCalledWith(['src/a.ts'])
  })

  it('未接通添加到对话入口时不显示对应项', async () => {
    await renderSection({ group: 'changes', files: [change()], withAddToChat: false })
    await openMenuOnRow()
    expect(menuItems().map((item) => item.textContent)).not.toContain('添加到对话')
  })

  it('已删除文件不显示「在编辑器中打开」', async () => {
    await renderSection({ group: 'changes', files: [change({ status: 'D' })] })
    await openMenuOnRow()
    expect(menuItems().map((item) => item.textContent)).not.toContain('在编辑器中打开')
  })

  it('写操作进行中（busy）时暂存与丢弃更改禁用', async () => {
    await renderSection({ group: 'changes', files: [change()], busy: true })
    await openMenuOnRow()
    const items = menuItems()
    const stageItem = items.find((item) => item.textContent === '暂存')
    const discardItem = items.find((item) => item.textContent === '丢弃更改')
    expect(stageItem?.disabled).toBe(true)
    expect(discardItem?.disabled).toBe(true)
  })
})

describe('GitGroupSection 树形目录行批量操作', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.onStage.mockReset()
    mocks.onUnstage.mockReset()
    mocks.onOpenFile.mockReset()
    mocks.onDiscardRequest.mockReset()
    vi.stubGlobal('spark', { invoke: mocks.invoke })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelector('.context-action-menu')?.remove()
    vi.unstubAllGlobals()
  })

  async function renderTreeSection(options: {
    group: 'staged' | 'changes'
    files: WorkspaceGitFileChange[]
    busy?: boolean
    onToggle?: () => void
  }): Promise<void> {
    await act(async () => {
      root.render(
        <GitGroupSection
          title={options.group === 'staged' ? '已暂存' : '更改'}
          group={options.group}
          files={options.files}
          labels={new Map()}
          viewMode="tree"
          collapsed={false}
          busy={options.busy === true ? 'stage' : null}
          rootAbsPath="/repo"
          onToggle={options.onToggle ?? vi.fn()}
          onStage={mocks.onStage}
          onUnstage={mocks.onUnstage}
          onOpenFile={mocks.onOpenFile}
          onDiscardRequest={mocks.onDiscardRequest}
        />,
      )
    })
  }

  /** 嵌套两层的变更文件：src 目录下含本级 a.ts 与子目录 b/c.ts */
  const treeFiles = [
    change({ path: 'src/a.ts', additions: 1 }),
    change({ path: 'src/b/c.ts', additions: 2 }),
  ]

  function dirRow(): HTMLDivElement {
    const row = container.querySelector('.gp-tree-dir') as HTMLDivElement | null
    expect(row).not.toBeNull()
    return row as HTMLDivElement
  }

  it('changes 组点击文件夹暂存按钮：对该文件夹下全部文件路径调用一次 onStage', async () => {
    await renderTreeSection({ group: 'changes', files: treeFiles })
    const stageBtn = dirRow().querySelector<HTMLButtonElement>(
      '.gp-tree-dir-actions .gp-icon-btn[title="暂存"]',
    )
    expect(stageBtn).not.toBeNull()
    await act(async () => {
      ;(stageBtn as HTMLButtonElement).click()
    })
    // 一次调用传全量路径（含子目录递归），不是逐文件循环调用
    expect(mocks.onStage).toHaveBeenCalledTimes(1)
    expect(mocks.onStage).toHaveBeenCalledWith(['src/b/c.ts', 'src/a.ts'])
  })

  it('changes 组点击文件夹丢弃按钮：一次调用 onDiscardRequest 传全部路径与目录名（走既有确认流程）', async () => {
    await renderTreeSection({ group: 'changes', files: treeFiles })
    const discardBtn = dirRow().querySelector<HTMLButtonElement>(
      '.gp-tree-dir-actions .gp-icon-btn[title="丢弃更改"]',
    )
    expect(discardBtn).not.toBeNull()
    await act(async () => {
      ;(discardBtn as HTMLButtonElement).click()
    })
    expect(mocks.onDiscardRequest).toHaveBeenCalledTimes(1)
    expect(mocks.onDiscardRequest).toHaveBeenCalledWith(['src/b/c.ts', 'src/a.ts'], 'src')
  })

  it('staged 组文件夹只显示取消暂存，点击一次调用 onUnstage 传全部路径', async () => {
    await renderTreeSection({
      group: 'staged',
      files: [
        change({ path: 'src/a.ts', staged: true, unstaged: false }),
        change({ path: 'src/b/c.ts', staged: true, unstaged: false }),
      ],
    })
    const titles = Array.from(
      dirRow().querySelectorAll<HTMLButtonElement>('.gp-tree-dir-actions .gp-icon-btn'),
    ).map((btn) => btn.title)
    expect(titles).toEqual(['取消暂存'])
    const unstageBtn = dirRow().querySelector<HTMLButtonElement>(
      '.gp-tree-dir-actions .gp-icon-btn[title="取消暂存"]',
    )
    await act(async () => {
      ;(unstageBtn as HTMLButtonElement).click()
    })
    expect(mocks.onUnstage).toHaveBeenCalledTimes(1)
    expect(mocks.onUnstage).toHaveBeenCalledWith(['src/b/c.ts', 'src/a.ts'])
  })

  it('文件夹行不提供「打开 diff」按钮（仅文件行有），计数 pill 正常显示', async () => {
    await renderTreeSection({ group: 'changes', files: treeFiles })
    const row = dirRow()
    expect(row.querySelector('.gp-tree-dir-actions .gp-icon-btn[title*="打开"]')).toBeNull()
    expect(row.querySelector('.gp-group-count')?.textContent).toBe('2')
  })

  it('写操作进行中（busy）时文件夹批量按钮禁用', async () => {
    await renderTreeSection({ group: 'changes', files: treeFiles, busy: true })
    const buttons = Array.from(
      dirRow().querySelectorAll<HTMLButtonElement>('.gp-tree-dir-actions .gp-icon-btn'),
    )
    expect(buttons.length).toBeGreaterThan(0)
    for (const btn of buttons) expect(btn.disabled).toBe(true)
  })

  it('目录行主区域点击仍触发折叠切换（批量按钮不劫持折叠行为）', async () => {
    await renderTreeSection({ group: 'changes', files: treeFiles })
    // 初始：src 与 src/b 两个目录行、两个文件行
    expect(container.querySelectorAll('.gp-tree-dir')).toHaveLength(2)
    expect(container.querySelectorAll('.gp-file-row')).toHaveLength(2)
    const main = container.querySelector('.gp-tree-dir-main') as HTMLButtonElement
    expect(main).not.toBeNull()
    await act(async () => {
      main.click()
    })
    // 折叠 src 后，其子树（b 目录行与两个文件行）不再渲染
    expect(container.querySelectorAll('.gp-tree-dir')).toHaveLength(1)
    expect(container.querySelectorAll('.gp-file-row')).toHaveLength(0)
  })
})
