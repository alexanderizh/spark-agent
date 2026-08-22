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
  runnerProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('./subAppClient', () => ({
  subAppClient: { list: mocks.list, get: mocks.get },
}))

// SubAppRunner 会拉进沙箱文档/emoji 数据等重依赖；本测试只关注目录
// 加载与胶囊渲染，用占位组件断开依赖链。
vi.mock('./SubAppRunner', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    SubAppRunner: (props: Record<string, unknown>) => {
      mocks.runnerProps.push(props)
      return ReactActual.createElement('div', { 'data-testid': 'subapp-runner' })
    },
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
    mocks.get.mockReset()
    mocks.runnerProps = []
    // 清理浮窗几何持久化，避免用例间位置串扰
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('spark-agent:subapp-overlay-geometry'))
      .forEach((key) => window.localStorage.removeItem(key))
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

  it('从胶囊打开已发布应用时运行发布快照而不是草稿', async () => {
    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'o1', name: '浮层应用', surface: 'overlay' })],
      total: 1,
    })
    mocks.get.mockResolvedValue({
      ...makeApp({ id: 'o1', name: '浮层应用', surface: 'overlay' }),
      draft: {
        revision: 2,
        source: '<main>draft-v2</main>',
        config: {},
        manifest: {
          name: '浮层应用',
          description: '',
          icon: null,
          entry: 'index.html',
          surface: 'overlay',
          permissions: [],
        },
        updatedAt: '2026-08-18T01:00:00.000Z',
      },
      publishedRelease: {
        id: 'release-v1',
        appId: 'o1',
        version: 1,
        source: '<main>published-v1</main>',
        config: {},
        manifest: {
          name: '浮层应用',
          description: '',
          icon: null,
          entry: 'index.html',
          surface: 'overlay',
          permissions: [],
        },
        publishedAt: '2026-08-18T00:30:00.000Z',
      },
    })
    renderProvider()
    await act(async () => {})

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-capsule')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-item')?.click()
    })

    const lastRunnerProps = mocks.runnerProps[mocks.runnerProps.length - 1]
    expect(lastRunnerProps).toMatchObject({
      appId: 'o1',
      mode: 'published',
      source: '<main>published-v1</main>',
      release: { id: 'release-v1', version: 1 },
    })
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

  it('dock 打开时 ESC 关闭；宿主 antd 弹窗开着时 ESC 不连坐关闭侧板', async () => {
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

    // 宿主弹窗（Modal/Drawer）开着：ESC 只归弹窗，dock 不关
    const modalWrap = document.createElement('div')
    modalWrap.className = 'ant-modal-wrap'
    document.body.appendChild(modalWrap)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="subapp-panel-dock"]')).not.toBeNull()

    // 弹窗关闭后：ESC 关闭 dock
    modalWrap.remove()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('[data-testid="subapp-panel-dock"]')).toBeNull()
  })

  const overlayDetails = (id: string, name: string) => ({
    id,
    name,
    description: '',
    icon: 'builtin:list-todo',
    surface: 'overlay' as const,
    publicationStatus: 'published' as const,
    enabled: true,
    draftRevision: 1,
    publishedVersion: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    draft: {
      revision: 1,
      source: '<html></html>',
      manifest: { version: 1, surface: 'overlay' as const, permissions: [] },
    },
    publishedRelease: null,
  })

  /** 通过胶囊启动器打开第 index 个应用（0 起） */
  const openViaLauncher = async (index: number): Promise<void> => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.subapp-launcher-capsule')?.click()
    })
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('.subapp-launcher-item')[index]?.click()
    })
  }

  /** jsdom 无 PointerEvent capture；用 MouseEvent 派发 pointer* 类型即可触发 React 合成事件 */
  const firePointer = (el: Element, type: string, x: number, y: number): void => {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    )
  }

  it('浮窗带公用头部：应用标识+关闭入口，头部拖动、四个拉伸入口；关闭销毁可经胶囊重开', async () => {
    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'o1', name: '浮层应用', surface: 'overlay' })],
      total: 1,
    })
    mocks.get.mockResolvedValue(overlayDetails('o1', '浮层应用'))
    renderProvider()
    await act(async () => {})
    await openViaLauncher(0)

    const card = container.querySelector<HTMLElement>('[data-testid="subapp-overlay-card"]')
    expect(card).not.toBeNull()
    // 公用头部：仅关闭入口，不重复展示应用名/图标（应用自带标题），无收起入口
    const header = card?.querySelector<HTMLElement>('.subapp-overlay-header')
    expect(header).not.toBeNull()
    expect(header?.textContent).not.toContain('浮层应用')
    expect(header?.querySelector('[aria-label="关闭浮层"]')).not.toBeNull()
    expect(card?.querySelector('[aria-label="收起浮层"]')).toBeNull()
    // 应用本体（runner）直接是卡片的子元素，铺满头部之下
    const runner = card?.querySelector('[data-testid="subapp-runner"]')
    expect(runner?.parentElement).toBe(card)
    // 自由浮窗手势件：右/下/右下角/左上角四个拉伸入口
    const dirs = [...(card?.querySelectorAll('.subapp-overlay-resize') ?? [])].map((el) =>
      el.getAttribute('data-dir'),
    )
    expect(dirs).toEqual(['e', 's', 'se', 'nw'])
    // 窗口有独立几何（默认内容区 85%），不是铺满视口
    expect(card?.style.left).not.toBe('')
    expect(card?.style.width).not.toBe('')

    // 关闭即销毁（无收起态）；重新打开走胶囊启动器菜单
    await act(async () => {
      header?.querySelector<HTMLButtonElement>('[aria-label="关闭浮层"]')?.click()
    })
    expect(container.querySelector('[data-testid="subapp-overlay-card"]')).toBeNull()
    expect(container.querySelector('[data-testid="subapp-runner"]')).toBeNull()
    await openViaLauncher(0)
    expect(container.querySelector('[data-testid="subapp-overlay-card"]')).not.toBeNull()
  })

  it('浮窗默认几何取内容区 85% 居中，持久化几何恢复时优先', async () => {
    // 模拟主窗口内容区节点（.main-content-area > .main），固定视口矩形
    const area = document.createElement('div')
    area.className = 'main-content-area'
    const main = document.createElement('div')
    main.className = 'main'
    main.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect
    area.appendChild(main)
    document.body.appendChild(area)
    try {
      mocks.list.mockResolvedValue({
        items: [makeApp({ id: 'o1', name: '浮层应用', surface: 'overlay' })],
        total: 1,
      })
      mocks.get.mockResolvedValue(overlayDetails('o1', '浮层应用'))

      // 已有持久化几何：恢复优先于默认值
      window.localStorage.setItem(
        'spark-agent:subapp-overlay-geometry-v3:o1',
        JSON.stringify({ left: 40, top: 60, width: 500, height: 400 }),
      )
      renderProvider()
      await act(async () => {})
      await openViaLauncher(0)
      let card = container.querySelector<HTMLElement>('[data-testid="subapp-overlay-card"]')
      expect(card?.style.left).toBe('40px')
      expect(card?.style.top).toBe('60px')
      expect(card?.style.width).toBe('500px')
      expect(card?.style.height).toBe('400px')
      act(() => root.unmount())
      window.localStorage.removeItem('spark-agent:subapp-overlay-geometry-v3:o1')

      // 无持久化：默认 85% 内容区居中（680x510，中心对齐 left=160/top=95）
      root = createRoot(container)
      renderProvider()
      await act(async () => {})
      await openViaLauncher(0)
      card = container.querySelector<HTMLElement>('[data-testid="subapp-overlay-card"]')
      expect(card?.style.width).toBe('680px')
      expect(card?.style.height).toBe('510px')
      expect(card?.style.left).toBe('160px')
      expect(card?.style.top).toBe('95px')
    } finally {
      area.remove()
    }
  })

  it('拖动浮窗移动位置并持久化；右下角和左上角均可拉伸', async () => {
    mocks.list.mockResolvedValue({
      items: [makeApp({ id: 'o1', name: '浮层应用', surface: 'overlay' })],
      total: 1,
    })
    mocks.get.mockResolvedValue(overlayDetails('o1', '浮层应用'))
    renderProvider()
    await act(async () => {})
    await openViaLauncher(0)

    const card = () => container.querySelector<HTMLElement>('[data-testid="subapp-overlay-card"]')
    const before = {
      left: Number.parseInt(card()?.style.left ?? '0', 10),
      top: Number.parseInt(card()?.style.top ?? '0', 10),
      width: Number.parseInt(card()?.style.width ?? '0', 10),
      height: Number.parseInt(card()?.style.height ?? '0', 10),
    }

    // 拖动公用头部：窗口平移
    await act(async () => {
      const header = card()?.querySelector<HTMLElement>('.subapp-overlay-header')
      expect(header).not.toBeNull()
      firePointer(header as Element, 'pointerdown', 400, 300)
      firePointer(header as Element, 'pointermove', 460, 340)
      firePointer(header as Element, 'pointerup', 460, 340)
    })
    expect(Number.parseInt(card()?.style.left ?? '0', 10)).toBe(before.left + 60)
    expect(Number.parseInt(card()?.style.top ?? '0', 10)).toBe(before.top + 40)

    // 右下角拉伸：宽高同增
    await act(async () => {
      const se = card()?.querySelector<HTMLElement>('.subapp-overlay-resize[data-dir="se"]')
      expect(se).not.toBeNull()
      firePointer(se as Element, 'pointerdown', 700, 500)
      firePointer(se as Element, 'pointermove', 740, 530)
      firePointer(se as Element, 'pointerup', 740, 530)
    })
    expect(Number.parseInt(card()?.style.width ?? '0', 10)).toBe(before.width + 40)
    expect(Number.parseInt(card()?.style.height ?? '0', 10)).toBe(before.height + 30)

    // 左上角向内拉伸：左/上边界移动，右/下边界保持不动
    const beforeNw = {
      left: Number.parseInt(card()?.style.left ?? '0', 10),
      top: Number.parseInt(card()?.style.top ?? '0', 10),
      width: Number.parseInt(card()?.style.width ?? '0', 10),
      height: Number.parseInt(card()?.style.height ?? '0', 10),
    }
    await act(async () => {
      const nw = card()?.querySelector<HTMLElement>('.subapp-overlay-resize[data-dir="nw"]')
      expect(nw).not.toBeNull()
      firePointer(nw as Element, 'pointerdown', 200, 160)
      firePointer(nw as Element, 'pointermove', 225, 180)
      firePointer(nw as Element, 'pointerup', 225, 180)
    })
    const afterNw = {
      left: Number.parseInt(card()?.style.left ?? '0', 10),
      top: Number.parseInt(card()?.style.top ?? '0', 10),
      width: Number.parseInt(card()?.style.width ?? '0', 10),
      height: Number.parseInt(card()?.style.height ?? '0', 10),
    }
    expect(afterNw.left).toBe(beforeNw.left + 25)
    expect(afterNw.top).toBe(beforeNw.top + 20)
    expect(afterNw.width).toBe(beforeNw.width - 25)
    expect(afterNw.height).toBe(beforeNw.height - 20)
    expect(afterNw.left + afterNw.width).toBe(beforeNw.left + beforeNw.width)
    expect(afterNw.top + afterNw.height).toBe(beforeNw.top + beforeNw.height)

    // 几何持久化：卸载重挂后恢复拖拽后的位置
    const savedLeft = Number.parseInt(card()?.style.left ?? '0', 10)
    act(() => root.unmount())
    root = createRoot(container)
    renderProvider()
    await act(async () => {})
    await openViaLauncher(0)
    expect(Number.parseInt(card()?.style.left ?? '0', 10)).toBe(savedLeft)
  })

  it('多浮层同开：各自独立浮窗按序级联偏移，互不收起', async () => {
    mocks.list.mockResolvedValue({
      items: [
        makeApp({ id: 'o1', name: '浮层一', surface: 'overlay' }),
        makeApp({ id: 'o2', name: '浮层二', surface: 'overlay' }),
      ],
      total: 2,
    })
    mocks.get.mockImplementation(async (args: { appId: string }) =>
      overlayDetails(args.appId, args.appId === 'o1' ? '浮层一' : '浮层二'),
    )
    renderProvider()
    await act(async () => {})

    await openViaLauncher(0)
    await openViaLauncher(1)
    const cards = container.querySelectorAll<HTMLElement>('[data-testid="subapp-overlay-card"]')
    expect(cards).toHaveLength(2)
    // 级联偏移：第二个浮窗相对第一个偏移 OVERLAY_CASCADE_STEP(32px)
    const first = cards[0]
    const second = cards[1]
    if (first == null || second == null) throw new Error('浮窗卡片缺失')
    const left1 = Number.parseInt(first.style.left ?? '0', 10)
    const top1 = Number.parseInt(first.style.top ?? '0', 10)
    const left2 = Number.parseInt(second.style.left ?? '0', 10)
    const top2 = Number.parseInt(second.style.top ?? '0', 10)
    expect(left2 - left1).toBe(32)
    expect(top2 - top1).toBe(32)
    // 两个浮窗并存，互不收起/销毁
    expect(container.querySelectorAll('[data-testid="subapp-overlay-card"]')).toHaveLength(2)
  })
})
