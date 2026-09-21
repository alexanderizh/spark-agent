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
