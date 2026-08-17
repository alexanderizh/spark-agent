// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAppSummary } from '@spark/protocol'
import { SUB_APP_DIRECTORY_CHANGED_EVENT } from './subAppEvents'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
}))

vi.mock('./subAppClient', () => ({
  subAppClient: { list: mocks.list, get: mocks.get },
}))

// SubAppRunner 会拉进沙箱文档/emoji 数据等重依赖；本测试只关注目录
// 加载与胶囊渲染，用占位组件断开依赖链。
vi.mock('./SubAppRunner', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    SubAppRunner: () => ReactActual.createElement('div', { 'data-testid': 'subapp-runner' }),
  }
})

const { SubAppSurfaceProvider, useSubAppSurfaces } = await import('./SubAppSurfaceHost')

function makeApp(over: Partial<SubAppSummary>): SubAppSummary {
  return {
    id: 'app_x',
    name: 'X',
    description: '',
    icon: null,
    surface: 'content',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 1,
    publishedVersion: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...over,
  }
}

describe('SubAppSurfaceProvider 目录加载', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.list.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const renderProvider = (): void => {
    act(() => {
      root.render(
        React.createElement(SubAppSurfaceProvider, null, React.createElement('div', null, 'child')),
      )
    })
  }

  // 注册 panel 打开处理器的探针组件：记录转发调用
  function PanelHandlerProbe({ onOpen }: { onOpen: (appId: string) => void }): React.ReactElement {
    const surfaces = useSubAppSurfaces()
    React.useEffect(() => {
      surfaces.setPanelOpenHandler(onOpen)
      return () => {
        surfaces.setPanelOpenHandler(null)
      }
    }, [surfaces.setPanelOpenHandler, onOpen])
    return React.createElement('div', null, 'probe')
  }

  const panelDetails = (id: string, name: string) => ({
    id,
    name,
    description: '',
    icon: null,
    surface: 'panel',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 1,
    publishedVersion: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    draft: {
      revision: 1,
      source: '<html></html>',
      manifest: { version: 1, surface: 'panel', permissions: [] },
    },
    publishedRelease: null,
  })

  it('目录只保留浮层/侧板应用；内容区应用不进胶囊', async () => {
    mocks.list.mockResolvedValue({
      items: [
        makeApp({ id: 'c1', name: '内容应用', surface: 'content' }),
        makeApp({ id: 'o1', name: '浮层应用', surface: 'overlay' }),
        makeApp({ id: 'p1', name: '侧板应用', surface: 'panel' }),
      ],
      total: 3,
    })
    renderProvider()
    await act(async () => {})
    expect(mocks.list).toHaveBeenCalledWith({ menuOnly: true, limit: 50 })

    const launcher = container.querySelector('[data-testid="subapp-surface-launcher"]')
    expect(launcher).not.toBeNull()
    expect(launcher?.textContent ?? '').not.toContain('内容应用')
  })

  it('目录无浮层/侧板应用时不渲染胶囊，children 正常渲染', async () => {
    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'c1', surface: 'content' })],
      total: 1,
    })
    renderProvider()
    await act(async () => {})
    expect(container.textContent).toContain('child')
    expect(container.querySelector('[data-testid="subapp-surface-launcher"]')).toBeNull()
  })

  it('目录变化事件触发重新加载', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 })
    renderProvider()
    await act(async () => {})
    expect(container.querySelector('.subapp-launcher-capsule')).toBeNull()

    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'o1', surface: 'overlay' })],
      total: 1,
    })
    await act(async () => {
      window.dispatchEvent(new Event(SUB_APP_DIRECTORY_CHANGED_EVENT))
    })
    expect(container.querySelector('.subapp-launcher-capsule')).not.toBeNull()
  })

  it('目录加载失败时静默降级为空目录', async () => {
    mocks.list.mockRejectedValue(new Error('ipc down'))
    renderProvider()
    await act(async () => {})
    expect(container.textContent).toContain('child')
    expect(container.querySelector('[data-testid="subapp-surface-launcher"]')).toBeNull()
  })

  it('侧板 dock 头部显示面板菜单，点击其他侧板应用切换', async () => {
    const panelApps = [
      makeApp({ id: 'p1', name: '侧板笔记', surface: 'panel' }),
      makeApp({ id: 'p2', name: '侧板待办', surface: 'panel' }),
    ]
    mocks.list.mockResolvedValue({ items: panelApps, total: 2 })
    const detailsOf = (app: SubAppSummary) => ({
      ...app,
      draft: {
        revision: 1,
        source: '<html></html>',
        manifest: { version: 1, surface: 'panel', permissions: [] },
      },
      publishedRelease: null,
    })
    mocks.get.mockImplementation(({ appId }: { appId: string }) => {
      const app = panelApps.find((item) => item.id === appId)
      if (app == null) throw new Error('not found')
      return detailsOf(app)
    })
    renderProvider()
    await act(async () => {})

    // 从胶囊启动第一个侧板应用
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-capsule')?.click()
    })
    const noteItem = [
      ...container.querySelectorAll<HTMLButtonElement>('.subapp-launcher-item'),
    ].find((btn) => btn.textContent?.includes('侧板笔记'))
    await act(async () => {
      noteItem?.click()
    })
    const dock = container.querySelector('[data-testid="subapp-panel-dock"]')
    expect(dock).not.toBeNull()

    // 面板菜单：两个侧板 tab，当前应用高亮，点击另一个切换
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.subapp-panel-tab')]
    expect(tabs.map((tab) => tab.textContent)).toEqual(['侧板笔记', '侧板待办'])
    const activeTab = tabs.find((tab) => tab.classList.contains('is-active'))
    expect(activeTab?.textContent).toContain('侧板笔记')
    await act(async () => {
      tabs.find((tab) => tab.textContent?.includes('侧板待办'))?.click()
    })
    expect(mocks.get).toHaveBeenCalledWith({ appId: 'p2' })
  })

  it('注册 panel 处理器后 open 转发给处理器，不再创建 dock 实例', async () => {
    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'p1', name: '侧板应用', surface: 'panel' })],
      total: 1,
    })
    mocks.get.mockResolvedValue(panelDetails('p1', '侧板应用'))
    const forwarded: string[] = []
    const handler = (appId: string): void => {
      forwarded.push(appId)
    }
    act(() => {
      root.render(
        React.createElement(
          SubAppSurfaceProvider,
          null,
          React.createElement(PanelHandlerProbe, { onOpen: handler }),
        ),
      )
    })
    await act(async () => {})

    // 胶囊启动 panel 应用：应转发给 handler，而非渲染 dock
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-capsule')?.click()
    })
    const item = container.querySelector<HTMLButtonElement>('.subapp-launcher-item')
    await act(async () => {
      item?.click()
    })
    expect(forwarded).toEqual(['p1'])
    expect(container.querySelector('[data-testid="subapp-panel-dock"]')).toBeNull()
  })

  it('未注册处理器时 panel 应用回落 dock 渲染（画布等无统一面板场景）', async () => {
    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'p1', name: '侧板应用', surface: 'panel' })],
      total: 1,
    })
    mocks.get.mockResolvedValue(panelDetails('p1', '侧板应用'))
    renderProvider()
    await act(async () => {})

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-capsule')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-item')?.click()
    })
    expect(container.querySelector('[data-testid="subapp-panel-dock"]')).not.toBeNull()
  })
})
