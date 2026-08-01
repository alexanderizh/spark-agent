// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  addProjectsFromDroppedPaths,
  formatDroppedProjectSummary,
  getDirectoryDropIntent,
  isSidebarProjectDropTarget,
} from './project-folder-drop'

function makeTransfer(entries: Array<{ isDirectory: boolean } | null>): DataTransfer {
  return {
    files: [],
    items: entries.map((entry) => ({
      kind: 'file',
      ...(entry == null ? {} : { webkitGetAsEntry: () => entry }),
    })),
    types: ['Files'],
  } as unknown as DataTransfer
}

describe('project folder drop helpers', () => {
  it('accepts a drag when any top-level item is a directory', () => {
    expect(
      getDirectoryDropIntent(
        makeTransfer([{ isDirectory: false }, { isDirectory: true }]),
      ),
    ).toBe('accept')
  })

  it('rejects a drag when every inspectable top-level item is a file', () => {
    expect(getDirectoryDropIntent(makeTransfer([{ isDirectory: false }]))).toBe('reject')
  })

  it('keeps an unknown intent when the platform exposes files without entry metadata', () => {
    expect(getDirectoryDropIntent(makeTransfer([null]))).toBe('unknown')
  })

  it('recognizes descendants of the sidebar project drop zone', () => {
    const zone = document.createElement('div')
    const child = document.createElement('span')
    zone.dataset.sidebarProjectDropZone = ''
    zone.appendChild(child)

    expect(isSidebarProjectDropTarget(child)).toBe(true)
    expect(isSidebarProjectDropTarget(document.createElement('main'))).toBe(false)
  })
})

describe('addProjectsFromDroppedPaths', () => {
  it('adds only top-level directories and activates the final successful project', async () => {
    const refreshData = vi.fn(async () => undefined)
    const setActiveWorkspace = vi.fn()
    const openWorkspace = vi.fn(async ({ create }: { create: { name: string; rootPath: string } }) => ({
      workspace: { id: `ws:${create.rootPath}` },
    }))

    const result = await addProjectsFromDroppedPaths(
      ['/work/alpha', '/work/readme.md', '/work/beta', '/work/alpha'],
      {
        existingRootPaths: ['/work/existing'],
        statFileKind: async ({ path }) => ({
          kind: path.endsWith('.md') ? 'file' : 'directory',
        }),
        openWorkspace,
        refreshData,
        setActiveWorkspace,
      },
    )

    expect(result).toEqual({ added: 2, ignoredFiles: 1, duplicates: 1, failed: 0 })
    expect(openWorkspace).toHaveBeenNthCalledWith(1, {
      create: { name: 'alpha', rootPath: '/work/alpha' },
    })
    expect(openWorkspace).toHaveBeenNthCalledWith(2, {
      create: { name: 'beta', rootPath: '/work/beta' },
    })
    expect(refreshData).toHaveBeenCalledTimes(1)
    expect(setActiveWorkspace).toHaveBeenCalledWith('ws:/work/beta')
  })

  it('treats equivalent Windows paths and existing roots as duplicates', async () => {
    const openWorkspace = vi.fn()
    const result = await addProjectsFromDroppedPaths(['c:\\Work\\Alpha\\'], {
      existingRootPaths: ['C:/Work/Alpha'],
      statFileKind: vi.fn(),
      openWorkspace,
      refreshData: vi.fn(),
      setActiveWorkspace: vi.fn(),
    })

    expect(result).toEqual({ added: 0, ignoredFiles: 0, duplicates: 1, failed: 0 })
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it('continues after stat and project creation failures', async () => {
    const refreshData = vi.fn(async () => undefined)
    const setActiveWorkspace = vi.fn()
    const openWorkspace = vi.fn(async ({ create }: { create: { rootPath: string } }) => {
      if (create.rootPath.endsWith('/broken')) throw new Error('cannot create')
      return { workspace: { id: `ws:${create.rootPath}` } }
    })

    const result = await addProjectsFromDroppedPaths(
      ['/work/unreadable', '/work/broken', '/work/good'],
      {
        existingRootPaths: [],
        statFileKind: async ({ path }) => {
          if (path.endsWith('/unreadable')) throw new Error('cannot stat')
          return { kind: 'directory' }
        },
        openWorkspace,
        refreshData,
        setActiveWorkspace,
      },
    )

    expect(result).toEqual({ added: 1, ignoredFiles: 0, duplicates: 0, failed: 2 })
    expect(refreshData).toHaveBeenCalledTimes(1)
    expect(setActiveWorkspace).toHaveBeenCalledWith('ws:/work/good')
  })

  it('does not refresh or switch projects when nothing was added', async () => {
    const refreshData = vi.fn()
    const setActiveWorkspace = vi.fn()
    const result = await addProjectsFromDroppedPaths(['/work/readme.md'], {
      existingRootPaths: [],
      statFileKind: async () => ({ kind: 'file' }),
      openWorkspace: vi.fn(),
      refreshData,
      setActiveWorkspace,
    })

    expect(result).toEqual({ added: 0, ignoredFiles: 1, duplicates: 0, failed: 0 })
    expect(refreshData).not.toHaveBeenCalled()
    expect(setActiveWorkspace).not.toHaveBeenCalled()
  })

  it('formats a single aggregate result message', () => {
    expect(
      formatDroppedProjectSummary({ added: 2, ignoredFiles: 1, duplicates: 1, failed: 1 }),
    ).toBe('已添加 2 个项目；忽略 1 个文件、1 个重复目录，1 个目录添加失败')
  })
})
