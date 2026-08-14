// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, DEFAULT_TWEAKS, useApp } from './AppContext'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('./components/PromptDialog', () => ({
  PromptDialog: () => null,
}))

vi.mock('./hooks/useAppDialogKeyboard', () => ({
  useGlobalDialogEnterConfirm: () => {},
}))

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('AppContext visual tweak persistence', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.documentElement.removeAttribute('style')
    vi.unstubAllGlobals()
  })

  it('uses a wider sidebar for new users', () => {
    expect(DEFAULT_TWEAKS.floatingSidebarWidth).toBe(288)
  })

  it('uses the floating sidebar by default on desktop platforms', async () => {
    vi.stubGlobal('spark', {
      platform: 'darwin',
      invoke: vi.fn(async () => ({ value: null })),
      on: vi.fn(() => vi.fn()),
    })

    function SidebarStyleHarness() {
      const { t } = useApp()
      return <span data-testid="sidebar-style">{t.sidebarStyle}</span>
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <SidebarStyleHarness />
        </AppProvider>,
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="sidebar-style"]')?.textContent).toBe('floating')
  })

  it('follows the system theme by default when no theme has been persisted', async () => {
    function ThemeHarness() {
      const { t } = useApp()
      return <span data-testid="theme">{t.theme}</span>
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <ThemeHarness />
        </AppProvider>,
      )
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="theme"]')?.textContent).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('hydrates visual tweaks from persisted appearance settings', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get') {
        return {
          value: {
            theme: 'dark',
            emptyHeroTheme: 'geometry',
            primary: '#10b981',
            density: 'compact',
            font: 'inter',
            fontSize: 16,
          },
        }
      }
      return { ok: true }
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    function VisualTweaksHarness() {
      const { t } = useApp()
      return (
        <span data-testid="visual-tweaks">
          {`${t.theme}:${t.emptyHeroTheme}:${t.primary}:${t.density}`}
        </span>
      )
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <VisualTweaksHarness />
        </AppProvider>,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    // emptyHeroTheme: 'geometry' 是已下线主题：守卫拒绝后状态回退默认星图（celestial），
    // 但本地存储的原始记录仍按数据透传保留旧值。
    expect(container.querySelector('[data-testid="visual-tweaks"]')?.textContent).toBe(
      'dark:celestial:#10b981:compact',
    )
    expect(JSON.parse(localStorage.getItem('spark-settings-appearance') ?? '{}')).toMatchObject({
      theme: 'dark',
      emptyHeroTheme: 'geometry',
      primary: '#10b981',
      density: 'compact',
      font: 'inter',
      fontSize: 16,
    })
    expect(localStorage.getItem('spark-agent:theme')).toBe('dark')
  })

  it('persists visual tweak changes without dropping existing appearance fields', async () => {
    let getCount = 0
    let resolvePostClickGet: ((value: { value: Record<string, unknown> }) => void) | null = null
    const invoke = vi.fn((channel: string) => {
      if (channel === 'settings:get') {
        getCount += 1
        if (getCount === 1) return Promise.resolve({ value: null })
        return new Promise((resolve) => {
          resolvePostClickGet = resolve
        })
      }
      return Promise.resolve({ ok: true })
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    function VisualTweaksHarness() {
      const { t, setTweak } = useApp()
      return (
        <>
          <button type="button" onClick={() => setTweak('theme', 'dark')}>
            Dark theme
          </button>
          <span data-testid="visual-tweaks">{t.theme}</span>
        </>
      )
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <VisualTweaksHarness />
        </AppProvider>,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      const button = container.querySelector('button')
      if (button == null) throw new Error('Button missing')
      click(button)
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="visual-tweaks"]')?.textContent).toBe('dark')
    expect(JSON.parse(localStorage.getItem('spark-settings-appearance') ?? '{}')).toMatchObject({
      theme: 'dark',
    })
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      category: 'appearance',
      key: 'data',
      value: expect.objectContaining({
        theme: 'dark',
      }),
    })

    await act(async () => {
      resolvePostClickGet?.({
        value: {
          font: 'inter',
          fontSize: 16,
        },
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith('settings:set', {
      category: 'appearance',
      key: 'data',
      value: expect.objectContaining({
        theme: 'dark',
        font: 'inter',
        fontSize: 16,
      }),
    })
  })
})
