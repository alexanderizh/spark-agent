// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAppSummary } from '@spark/protocol'
import type { SubAppSurfaceController } from './SubAppSurfaceHost'
import { SubAppSurfaceLauncher } from './SubAppSurfaceLauncher'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeApp(over: Partial<SubAppSummary>): SubAppSummary {
  return {
    id: 'app_x',
    name: 'X',
    description: '',
    icon: null,
    surface: 'overlay',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 1,
    publishedVersion: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...over,
  }
}

function makeController(over: Partial<SubAppSurfaceController>): SubAppSurfaceController {
  return {
    instances: [],
    directory: [],
    directoryLoaded: true,
    open: vi.fn(),
    close: vi.fn(),
    toggleCollapse: vi.fn(),
    setPanelOpenHandler: vi.fn(),
    ...over,
  }
}

describe('SubAppSurfaceLauncher', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (controller: SubAppSurfaceController): void => {
    act(() => {
      root.render(React.createElement(SubAppSurfaceLauncher, { controller }))
    })
  }

  const capsule = (): HTMLButtonElement | null =>
    container.querySelector<HTMLButtonElement>('.subapp-launcher-capsule')

  it('目录无浮层/侧板应用时不渲染胶囊', () => {
    render(makeController({ directory: [makeApp({ id: 'a', surface: 'content' })] }))
    expect(capsule()).toBeNull()
    expect(container.querySelector('[data-testid="subapp-surface-launcher"]')).toBeNull()
  })

  it('展开列表按浮层/侧板分组，点击未运行项调用 open 并收起', () => {
    const controller = makeController({
      directory: [
        makeApp({ id: 'ov1', name: '悬浮待办', surface: 'overlay' }),
        makeApp({ id: 'pn1', name: '侧板笔记', surface: 'panel' }),
      ],
    })
    render(controller)
    expect(capsule()).not.toBeNull()

    act(() => {
      capsule()?.click()
    })
    const panel = container.querySelector('.subapp-launcher-panel')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('浮层应用')
    expect(panel?.textContent).toContain('侧板应用')
    expect(panel?.textContent).toContain('悬浮待办')

    const item = [...container.querySelectorAll<HTMLButtonElement>('.subapp-launcher-item')].find(
      (btn) => btn.textContent?.includes('悬浮待办'),
    )
    expect(item).toBeDefined()
    expect(item?.getAttribute('aria-pressed')).toBe('false')
    act(() => {
      item?.click()
    })
    expect(controller.open).toHaveBeenCalledWith('ov1')
    // 启动后收起列表，让浮层立即可见
    expect(container.querySelector('.subapp-launcher-panel')).toBeNull()
  })

  it('运行中的项显示状态，点击关闭而非重复打开', () => {
    const controller = makeController({
      directory: [makeApp({ id: 'ov1', name: '悬浮待办' })],
      instances: [
        {
          key: 'overlay-ov1-1',
          kind: 'overlay',
          appId: 'ov1',
          name: '悬浮待办',
          manifest: {
            name: '悬浮待办',
            description: '',
            icon: null,
            entry: 'index.html',
            surface: 'overlay',
            permissions: [],
          } satisfies SubAppSurfaceController['instances'][number]['manifest'],
          source: '',
          collapsed: false,
        },
      ],
    })
    render(controller)
    expect(container.querySelector('.subapp-launcher-badge')?.textContent).toBe('1')

    act(() => {
      capsule()?.click()
    })
    const item = container.querySelector<HTMLButtonElement>('.subapp-launcher-item')
    expect(item?.classList.contains('is-running')).toBe(true)
    expect(item?.getAttribute('aria-pressed')).toBe('true')
    act(() => {
      item?.click()
    })
    expect(controller.close).toHaveBeenCalledWith('overlay-ov1-1')
    expect(controller.open).not.toHaveBeenCalled()
    // 关闭操作保持列表展开，便于连续管理多个浮层
    expect(container.querySelector('.subapp-launcher-panel')).not.toBeNull()
  })
})
