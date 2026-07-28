// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from './views/canvas/canvas.types'
import { CanvasProjectSidebarList } from './CanvasProjectSidebarList'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  selectProject: vi.fn(),
  requestProjectEdit: vi.fn(),
  setTweak: vi.fn(),
  openProject: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
  setProjectPinned: vi.fn(async () => undefined),
  updateProject: vi.fn(async () => undefined),
  openProjectFolder: vi.fn(async () => ({ opened: true })),
  exportProjectPackage: vi.fn(async () => ({ exported: true })),
  confirm: vi.fn(),
}))

const project: CanvasProject = {
  id: 'project-1',
  userId: 0,
  title: '电影项目',
  status: 'active',
  nodeCount: 3,
  assetCount: 2,
  taskCount: 1,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T01:00:00.000Z',
}

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Dropdown: ({
      children,
      menu,
      trigger,
    }: {
      children: React.ReactNode
      menu: {
        items: Array<
          | { key: string; label: React.ReactNode; onClick?: () => void; disabled?: boolean }
          | { type: 'divider' }
        >
      }
      trigger?: string[]
    }) =>
      ReactActual.createElement(
        'div',
        { 'data-dropdown-trigger': trigger?.join(',') },
        children,
        ReactActual.createElement(
          'div',
          { 'data-testid': 'context-menu' },
          menu.items.map((item, index) =>
            'type' in item
              ? ReactActual.createElement('hr', { key: `divider-${index}` })
              : ReactActual.createElement(
                  'button',
                  {
                    key: item.key,
                    type: 'button',
                    disabled: item.disabled,
                    onClick: item.onClick,
                  },
                  item.label,
                ),
          ),
        ),
      ),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Empty = Object.assign(
    ({ description }: { description?: React.ReactNode }) =>
      ReactActual.createElement('div', null, description),
    { PRESENTED_IMAGE_SIMPLE: 'simple' },
  )
  return {
    Empty,
    Spin: () => ReactActual.createElement('span', null, 'loading'),
    Modal: { confirm: mocks.confirm },
    message: { error: vi.fn(), success: vi.fn() },
  }
})

vi.mock('./views/canvas/canvas.store', () => ({
  useCanvasProjects: () => ({ projects: [project], loading: false, refresh: mocks.refresh }),
}))

vi.mock('./views/canvas/canvas.api', () => ({
  canvasApi: {
    deleteProject: mocks.deleteProject,
    setProjectPinned: mocks.setProjectPinned,
    updateProject: mocks.updateProject,
    openProjectFolder: mocks.openProjectFolder,
    exportProjectPackage: mocks.exportProjectPackage,
  },
}))

vi.mock('./views/canvas/canvas-window-client', () => ({
  openCanvasProjectWindow: mocks.openProject,
}))

vi.mock('./views/canvas/CanvasProjectSelectionContext', () => ({
  useCanvasProjectSelection: () => ({
    selectedProjectId: project.id,
    selectProject: mocks.selectProject,
    requestProjectEdit: mocks.requestProjectEdit,
  }),
}))

vi.mock('./AppContext', () => ({
  useApp: () => ({ t: { view: 'canvas' }, setTweak: mocks.setTweak }),
}))

vi.mock('./i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

let container: HTMLDivElement
let root: Root

function menuButton(label: string): HTMLButtonElement {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>('[data-testid="context-menu"] button'),
  ].find((item) => item.textContent === label)
  if (!button) throw new Error(`Missing context menu action: ${label}`)
  return button
}

beforeEach(async () => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<CanvasProjectSidebarList />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CanvasProjectSidebarList context menu', () => {
  it('exposes the complete project action menu on right click', () => {
    expect(container.querySelector('[data-dropdown-trigger="contextMenu"]')).not.toBeNull()
    expect(
      [...container.querySelectorAll('[data-testid="context-menu"] button')].map(
        (button) => button.textContent,
      ),
    ).toEqual(['打开', '编辑', '置顶', '打开文件夹', '导出', '归档', '删除'])
  })

  it('opens the project and forwards edit to the shared project dialog', async () => {
    await act(async () => menuButton('打开').click())
    expect(mocks.openProject).toHaveBeenCalledWith(project.id)

    act(() => menuButton('编辑').click())
    expect(mocks.selectProject).toHaveBeenCalledWith(project.id)
    expect(mocks.requestProjectEdit).toHaveBeenCalledWith(project.id)
  })

  it('routes the remaining menu actions through the existing project APIs', async () => {
    await act(async () => menuButton('置顶').click())
    expect(mocks.setProjectPinned).toHaveBeenCalledWith(project.id, true)

    await act(async () => menuButton('打开文件夹').click())
    expect(mocks.openProjectFolder).toHaveBeenCalledWith(project.id)

    await act(async () => menuButton('导出').click())
    expect(mocks.exportProjectPackage).toHaveBeenCalledWith(project.id)

    await act(async () => menuButton('归档').click())
    expect(mocks.updateProject).toHaveBeenCalledWith(project.id, { status: 'archived' })
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it('confirms deletion, clears selection, and refreshes every project list', async () => {
    act(() => menuButton('删除').click())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    const options = mocks.confirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> }

    await act(async () => options.onOk())

    expect(mocks.deleteProject).toHaveBeenCalledWith(project.id)
    expect(mocks.selectProject).toHaveBeenCalledWith(null)
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
