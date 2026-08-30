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
    setPanelOpenHandler: vi.fn(),
    ...over,
  }
}

describe('SubAppSurfaceLauncher', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.removeItem('spark-agent:subapp-launcher-pos:v1')
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

  // jsdom 无 PointerEvent capture；用 MouseEvent 派发 pointer* 类型即可触发 React 合成事件
  const firePointer = (el: Element, type: string, x: number, y: number): void => {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    )
  }

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
          icon: null,
          manifest: {
            name: '悬浮待办',
            description: '',
            icon: null,
            entry: 'index.html',
            surface: 'overlay',
            permissions: [],
          } satisfies SubAppSurfaceController['instances'][number]['manifest'],
          source: '',
          mode: 'draft',
          release: null,
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

  it('拖动胶囊超过阈值后移动位置并持久化，紧随的点击不误开菜单', () => {
    const controller = makeController({ directory: [makeApp({ id: 'ov1', name: '悬浮待办' })] })
    render(controller)
    const launcherEl = container.querySelector<HTMLElement>(
      '[data-testid="subapp-surface-launcher"]',
    )
    expect(launcherEl).not.toBeNull()
    // 未拖动前走 CSS 默认右下角，无内联定位
    expect(launcherEl?.style.right).toBe('')

    const btn = capsule()
    expect(btn).not.toBeNull()
    act(() => {
      firePointer(btn as Element, 'pointerdown', 500, 400)
      firePointer(btn as Element, 'pointermove', 530, 420)
      firePointer(btn as Element, 'pointerup', 530, 420)
    })
    // 拖动后右下锚定位置写入内联样式并持久化
    expect(launcherEl?.style.right).not.toBe('')
    expect(launcherEl?.style.bottom).not.toBe('')
    const saved = JSON.parse(
      window.localStorage.getItem('spark-agent:subapp-launcher-pos:v1') ?? '{}',
    ) as { right?: number; bottom?: number }
    expect(typeof saved.right).toBe('number')
    expect(typeof saved.bottom).toBe('number')
    // 拖动结束紧随的 click 被吸收，不展开菜单
    act(() => {
      btn?.click()
    })
    expect(container.querySelector('.subapp-launcher-panel')).toBeNull()
  })

  it('位移小于阈值的按下仍按点击处理，正常展开菜单', () => {
    const controller = makeController({ directory: [makeApp({ id: 'ov1', name: '悬浮待办' })] })
    render(controller)
    const btn = capsule()
    expect(btn).not.toBeNull()
    act(() => {
      firePointer(btn as Element, 'pointerdown', 500, 400)
      firePointer(btn as Element, 'pointermove', 502, 401)
      firePointer(btn as Element, 'pointerup', 502, 401)
      btn?.click()
    })
    expect(container.querySelector('.subapp-launcher-panel')).not.toBeNull()
  })

  it('hover 胶囊即展开菜单，移出启动器区域后延迟收起', () => {
    vi.useFakeTimers()
    try {
      const controller = makeController({ directory: [makeApp({ id: 'ov1', name: '悬浮待办' })] })
      render(controller)
      const btn = capsule()
      expect(btn).not.toBeNull()

      // 指针移入胶囊：立即展开，无需点击
      act(() => {
        btn?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(container.querySelector('.subapp-launcher-panel')).not.toBeNull()

      // 移出整个启动器区域：延迟 HOVER_CLOSE_DELAY(200ms) 收起
      const rootEl = container.querySelector('[data-testid="subapp-surface-launcher"]')
      act(() => {
        rootEl?.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
        )
      })
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(container.querySelector('.subapp-launcher-panel')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(container.querySelector('.subapp-launcher-panel')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
