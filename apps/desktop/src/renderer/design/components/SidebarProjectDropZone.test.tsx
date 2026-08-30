// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('./Toast', () => ({
  useToast: () => ({ toast: { error: toastError } }),
}))

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'sidebar.dropProjects.title': '松开以添加项目',
        'sidebar.dropProjects.hint': '仅添加顶层文件夹',
        'sidebar.dropProjects.unresolvable': '无法读取拖入文件夹的路径，请改用“添加项目”按钮',
      })[key] ?? key,
  }),
}))

import { SidebarProjectDropZone } from './SidebarProjectDropZone'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeTransfer(items: Array<{ name: string; isDirectory: boolean }>): DataTransfer {
  const files = items.map(({ name }) => ({ name }) as File)
  return {
    files,
    items: items.map(({ isDirectory }, index) => ({
      kind: 'file',
      getAsFile: () => files[index] ?? null,
      webkitGetAsEntry: () => ({ isDirectory }),
    })),
    types: ['Files'],
    getData: () => '',
  } as unknown as DataTransfer
}

function fireDrag(target: Element, type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  target.dispatchEvent(event)
  return event
}

describe('SidebarProjectDropZone', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal('spark', {
      getPathForFile: (file: File) => `/work/${file.name}`,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows a centered drop state for directories and keeps it through nested dragleave', () => {
    act(() => {
      root.render(
        <SidebarProjectDropZone onDropPaths={vi.fn()}>
          <span className="nested">Projects</span>
        </SidebarProjectDropZone>,
      )
    })
    const zone = container.querySelector('[data-sidebar-project-drop-zone]') as HTMLElement
    const child = container.querySelector('.nested') as HTMLElement
    const transfer = makeTransfer([{ name: 'alpha', isDirectory: true }])

    act(() => {
      fireDrag(zone, 'dragenter', transfer)
      fireDrag(child, 'dragenter', transfer)
      fireDrag(child, 'dragleave', transfer)
    })

    expect(zone.classList.contains('is-file-drop-active')).toBe(true)
    expect(container.querySelector('.sidebar-project-drop-overlay')?.textContent).toContain(
      '松开以添加项目',
    )

    act(() => {
      fireDrag(zone, 'dragleave', transfer)
    })
    expect(zone.classList.contains('is-file-drop-active')).toBe(false)
  })

  it('passes every top-level dropped directory path to the project action', async () => {
    const onDropPaths = vi.fn(async () => undefined)
    act(() => {
      root.render(
        <SidebarProjectDropZone onDropPaths={onDropPaths}>Projects</SidebarProjectDropZone>,
      )
    })
    const zone = container.querySelector('[data-sidebar-project-drop-zone]') as HTMLElement
    const transfer = makeTransfer([
      { name: 'alpha', isDirectory: true },
      { name: 'beta', isDirectory: true },
    ])

    await act(async () => {
      fireDrag(zone, 'dragenter', transfer)
      fireDrag(zone, 'drop', transfer)
    })

    expect(onDropPaths).toHaveBeenCalledWith(['/work/alpha', '/work/beta'])
    expect(zone.classList.contains('is-file-drop-active')).toBe(false)
  })

  it('does not activate for an inspectable file-only drag', () => {
    act(() => {
      root.render(
        <SidebarProjectDropZone onDropPaths={vi.fn()}>Projects</SidebarProjectDropZone>,
      )
    })
    const zone = container.querySelector('[data-sidebar-project-drop-zone]') as HTMLElement

    act(() => {
      fireDrag(zone, 'dragenter', makeTransfer([{ name: 'readme.md', isDirectory: false }]))
    })

    expect(zone.classList.contains('is-file-drop-active')).toBe(false)
  })

  it('clears the drop state when the window loses focus', () => {
    act(() => {
      root.render(
        <SidebarProjectDropZone onDropPaths={vi.fn()}>Projects</SidebarProjectDropZone>,
      )
    })
    const zone = container.querySelector('[data-sidebar-project-drop-zone]') as HTMLElement

    act(() => {
      fireDrag(zone, 'dragenter', makeTransfer([{ name: 'alpha', isDirectory: true }]))
      window.dispatchEvent(new Event('blur'))
    })

    expect(zone.classList.contains('is-file-drop-active')).toBe(false)
  })
})
