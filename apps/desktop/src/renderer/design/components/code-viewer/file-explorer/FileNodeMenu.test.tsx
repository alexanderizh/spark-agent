// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { buildEmptyMenuItems, buildNodeMenuItems, type FileMenuActions } from './FileNodeMenu'
import { OPEN_IN_FILE_MANAGER_LABEL } from './fileExplorerActions'
import { ROOT_PATH, type FileClipboardEntry, type FileExplorerNode } from './fileExplorerTypes'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fileNode(path = 'src/a.ts'): FileExplorerNode {
  return { path, name: path.split('/').pop() ?? path, type: 'file', depth: 1 }
}

function dirNode(path = 'src'): FileExplorerNode {
  return { path, name: path.split('/').pop() ?? path, type: 'directory', depth: 1 }
}

function actions(overrides: Partial<FileMenuActions> = {}): FileMenuActions {
  return {
    onOpenFile: vi.fn(),
    onCopyPath: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onPasteInto: vi.fn(),
    onCreateFile: vi.fn(),
    onCreateDirectory: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

const noClipboard: FileClipboardEntry | null = null

describe('文件树右键菜单「在系统文件夹打开」', () => {
  it('文件节点：提供回调时显示该项，点击以 (path, false) 触发', () => {
    const onOpenInFileManager = vi.fn()
    const { items } = buildNodeMenuItems(fileNode(), actions({ onOpenInFileManager }), noClipboard)
    const targetIndex = items.findIndex((entry) => entry.key === OPEN_IN_FILE_MANAGER_LABEL)
    expect(targetIndex).toBeGreaterThan(0)
    // 位置语义：紧跟「复制路径」之后
    expect(items[targetIndex - 1]?.key).toBe('复制路径')
    items[targetIndex]?.onClick()
    expect(onOpenInFileManager).toHaveBeenCalledWith('src/a.ts', false)
  })

  it('目录节点：点击以 (path, true) 触发（直接打开该目录）', () => {
    const onOpenInFileManager = vi.fn()
    const { items } = buildNodeMenuItems(dirNode(), actions({ onOpenInFileManager }), noClipboard)
    const target = items.find((entry) => entry.key === OPEN_IN_FILE_MANAGER_LABEL)
    target?.onClick()
    expect(onOpenInFileManager).toHaveBeenCalledWith('src', true)
  })

  it('未提供回调时不显示该项', () => {
    const { items } = buildNodeMenuItems(fileNode(), actions(), noClipboard)
    expect(items.some((entry) => entry.key === OPEN_IN_FILE_MANAGER_LABEL)).toBe(false)
  })

  it('空白处菜单（工作区根）：显示该项并以 (root, true) 触发', () => {
    const onOpenInFileManager = vi.fn()
    const { items } = buildEmptyMenuItems(ROOT_PATH, actions({ onOpenInFileManager }), noClipboard)
    const target = items.find((entry) => entry.key === OPEN_IN_FILE_MANAGER_LABEL)
    expect(target).toBeDefined()
    target?.onClick()
    expect(onOpenInFileManager).toHaveBeenCalledWith(ROOT_PATH, true)
  })

  it('空白菜单未提供回调时不显示该项', () => {
    const { items } = buildEmptyMenuItems(ROOT_PATH, actions(), noClipboard)
    expect(items.some((entry) => entry.key === OPEN_IN_FILE_MANAGER_LABEL)).toBe(false)
  })
})
