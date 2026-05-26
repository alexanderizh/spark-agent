// @vitest-environment jsdom

/**
 * Renderer 测试 — 验证 React 组件渲染
 *
 * 使用 jsdom 环境模拟浏览器 DOM，
 * 验证核心组件能正确渲染和响应交互。
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Mock React Router 的 BrowserRouter
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  }
})

describe('Renderer Smoke Tests', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)

    class ResizeObserverMock {
      observe = vi.fn()
      disconnect = vi.fn()
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('spark', {
      invoke: vi.fn(),
      on: vi.fn(() => vi.fn()),
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root!.unmount())
      root = null
    }
    container.remove()
    vi.unstubAllGlobals()
  })

  it('should import ui-kit components without errors', async () => {
    const { Button, Card, Badge, Input } = await import('@spark/ui-kit')
    expect(Button).toBeDefined()
    expect(Card).toBeDefined()
    expect(Badge).toBeDefined()
    expect(Input).toBeDefined()
  })

  it('should import Tab components', async () => {
    const mod = await import('@spark/ui-kit')
    expect(mod.Tabs).toBeDefined()
    expect(mod.TabsList).toBeDefined()
    expect(mod.TabsTrigger).toBeDefined()
    expect(mod.TabsContent).toBeDefined()
  })

  it('should import Dialog components', async () => {
    const mod = await import('@spark/ui-kit')
    expect(mod.Dialog).toBeDefined()
    expect(mod.DialogContent).toBeDefined()
    expect(mod.DialogTitle).toBeDefined()
  })

  it('should have cn utility function', async () => {
    const { cn } = await import('@spark/ui-kit')
    expect(typeof cn).toBe('function')
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('toggles the primary sidebar from the bottom control and persists the state', async () => {
    const { App } = await import('../App')

    act(() => {
      root = createRoot(container)
      root.render(React.createElement(App))
    })

    const sidebar = container.querySelector('.sidebar')
    expect(sidebar?.classList.contains('expanded')).toBe(true)
    expect(container.querySelector('.sidebar-control')).toBeNull()

    const toggle = container.querySelector<HTMLButtonElement>('.sidebar-bottom [aria-label="Collapse sidebar"]')
    expect(toggle).not.toBeNull()

    act(() => {
      toggle!.click()
    })

    expect(sidebar?.classList.contains('collapsed')).toBe(true)
    expect(localStorage.getItem('spark-agent:sidebar')).toBe('collapsed')

    act(() => {
      root!.unmount()
      root = createRoot(container)
      root.render(React.createElement(App))
    })

    expect(container.querySelector('.sidebar')?.classList.contains('collapsed')).toBe(true)

    act(() => {
      container.querySelector<HTMLButtonElement>('.sidebar-bottom [aria-label="Expand sidebar"]')!.click()
    })

    expect(container.querySelector('.sidebar')?.classList.contains('expanded')).toBe(true)
    expect(localStorage.getItem('spark-agent:sidebar')).toBe('expanded')
  })

  it.todo('should render HomePage with metric cards')
  it.todo('should render SettingsPage with sub-navigation')
})
