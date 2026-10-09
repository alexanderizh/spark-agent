// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SubAppSummary } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  UnifiedSessionSidePanel,
  defaultUnifiedSidePanelWidth,
  getUnifiedSidePanelWidth,
  maxSideChatWidthForViewport,
  resetUnifiedSidePanelWidthForTest,
  setUnifiedSidePanelWidth,
  subAppPanelKind,
  type UnifiedSidePanelKind,
} from './ChatSidePanels'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makePanelApp(over: Partial<SubAppSummary>): SubAppSummary {
  return {
    id: 'p1',
    name: '待办清单',
    description: '',
    icon: 'list-todo',
    surface: 'panel',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 1,
    publishedVersion: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...over,
  }
}

describe('UnifiedSessionSidePanel', () => {
  it('renders every opened panel as a distinct tab while keeping one active tab', () => {
    const tabs: UnifiedSidePanelKind[] = ['terminal', 'side-chat', 'review', 'plan', 'html']
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={tabs}
        activeTab="plan"
        width={560}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>panel content</div>
      </UnifiedSessionSidePanel>,
    )

    expect(markup.match(/class="unified-side-panel-tab(?: active)?"/g)).toHaveLength(5)
    expect(markup.match(/role="tab"/g)).toHaveLength(5)
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(markup).toContain('data-tab-kind="terminal"')
    expect(markup).toContain('data-tab-kind="side-chat"')
    expect(markup).toContain('data-tab-kind="review"')
    expect(markup).toContain('data-tab-kind="plan"')
    expect(markup).toContain('data-tab-kind="html"')
  })

  it('does not render duplicate tabs when an opened-tab list contains duplicates', () => {
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={['terminal', 'terminal', 'review']}
        activeTab="review"
        width={560}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>panel content</div>
      </UnifiedSessionSidePanel>,
    )

    expect(markup.match(/class="unified-side-panel-tab(?: active)?"/g)).toHaveLength(2)
    expect(markup.match(/data-tab-kind="terminal"/g)).toHaveLength(1)
  })

  it('offers HTML as a flat panel choice without creating a second side panel', () => {
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={['html']}
        activeTab="html"
        width={560}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>html panel content</div>
      </UnifiedSessionSidePanel>,
    )

    expect(markup).toContain('HTML')
    expect(markup).toContain('html panel content')
    expect(markup).toContain('class="unified-side-panel"')
  })

  it('panel 子应用以应用名渲染 tab，并出现在空状态快捷卡片中', () => {
    const app = makePanelApp({ id: 'p_todo', name: '待办清单' })
    const markup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={['terminal', subAppPanelKind('p_todo')]}
        activeTab={subAppPanelKind('p_todo')}
        width={560}
        panelApps={[app]}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>app runner</div>
      </UnifiedSessionSidePanel>,
    )
    expect(markup).toContain('data-tab-kind="subapp:p_todo"')
    expect(markup).toContain('待办清单')

    // 空状态（无任何 tab）时快捷卡片也应列出 panel 应用
    const emptyMarkup = renderToStaticMarkup(
      <UnifiedSessionSidePanel
        tabs={[]}
        activeTab={null}
        width={560}
        panelApps={[app]}
        onWidthChange={vi.fn()}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      >
        <div>ignored</div>
      </UnifiedSessionSidePanel>,
    )
    expect(emptyMarkup).toContain('快捷打开')
    expect(emptyMarkup).toContain('待办清单')
  })

  it('点击加号菜单外部时自动收起菜单', async () => {
    const container = document.createElement('div')
    const outside = document.createElement('button')
    document.body.append(container, outside)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          <UnifiedSessionSidePanel
            tabs={['terminal']}
            activeTab="terminal"
            width={560}
            onWidthChange={vi.fn()}
            onSelect={vi.fn()}
            onOpen={vi.fn()}
            onCloseTab={vi.fn()}
          >
            <div>panel content</div>
          </UnifiedSessionSidePanel>,
        )
      })

      const addButton = container.querySelector<HTMLButtonElement>('.unified-side-panel-add')
      expect(addButton).not.toBeNull()
      await act(async () => addButton?.click())
      expect(container.querySelector('.unified-side-panel-menu.compact')).not.toBeNull()

      await act(async () => {
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      })
      expect(container.querySelector('.unified-side-panel-menu.compact')).toBeNull()
    } finally {
      act(() => root.unmount())
      container.remove()
      outside.remove()
    }
  })
})

describe('统一侧板默认宽度分档', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setViewportWidth(vw: number): void {
    vi.stubGlobal('window', {
      innerWidth: vw,
      localStorage: window.localStorage,
    })
  }

  it('超宽屏（≥2200）取 980', () => {
    setViewportWidth(2560)
    expect(defaultUnifiedSidePanelWidth()).toBe(980)
  })

  it('大屏（1700–2199）取 860', () => {
    setViewportWidth(1920)
    expect(defaultUnifiedSidePanelWidth()).toBe(860)
  })

  it('常规屏（1280–1699）取 760', () => {
    setViewportWidth(1440)
    expect(defaultUnifiedSidePanelWidth()).toBe(760)
  })

  it('窄屏（<1280）取 680，且各档不超过视口上限', () => {
    setViewportWidth(1100)
    expect(defaultUnifiedSidePanelWidth()).toBe(680)
    // 每个档位边界处的默认宽度都应 ≤ 85vw 上限，不会挤压主聊天区
    setViewportWidth(1280)
    expect(defaultUnifiedSidePanelWidth()).toBeLessThanOrEqual(maxSideChatWidthForViewport())
    setViewportWidth(1700)
    expect(defaultUnifiedSidePanelWidth()).toBeLessThanOrEqual(maxSideChatWidthForViewport())
    setViewportWidth(2200)
    expect(defaultUnifiedSidePanelWidth()).toBeLessThanOrEqual(maxSideChatWidthForViewport())
  })
})

describe('统一侧板宽度持久化', () => {
  const KEY = 'spark-agent:unified-side-panel-width'

  function stubWindow(store: Map<string, string>, vw = 1440): void {
    vi.stubGlobal('window', {
      innerWidth: vw,
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('未写入偏好时回退默认分档（1440 → 760）', () => {
    stubWindow(new Map())
    resetUnifiedSidePanelWidthForTest()
    expect(getUnifiedSidePanelWidth()).toBe(760)
  })

  it('设置后写入 localStorage，重启后恢复', () => {
    const store = new Map<string, string>()
    stubWindow(store)
    resetUnifiedSidePanelWidthForTest()
    setUnifiedSidePanelWidth(900)
    expect(store.get(KEY)).toBe('900')
    expect(getUnifiedSidePanelWidth()).toBe(900)
  })

  it('写入与读取均 clamp 到 [MIN, 视口上限]', () => {
    // 视口 1440 → 上限 floor(1440 * 0.85) = 1224
    stubWindow(new Map(), 1440)
    resetUnifiedSidePanelWidthForTest()
    setUnifiedSidePanelWidth(300)
    expect(getUnifiedSidePanelWidth()).toBe(360)
    setUnifiedSidePanelWidth(9999)
    expect(getUnifiedSidePanelWidth()).toBe(1224)

    // 存储里手改的越界值在读取时同样被 clamp
    stubWindow(new Map([[KEY, '9999']]), 1440)
    resetUnifiedSidePanelWidthForTest()
    expect(getUnifiedSidePanelWidth()).toBe(1224)
  })

  it('localStorage 不可用时退回内存状态', () => {
    vi.stubGlobal('window', {
      innerWidth: 1440,
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
    })
    resetUnifiedSidePanelWidthForTest()
    setUnifiedSidePanelWidth(900)
    expect(getUnifiedSidePanelWidth()).toBe(900)
  })
})
