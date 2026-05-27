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
import { ToastProvider } from '../design/components/Toast'

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

  it('shows running sessions in the list and allows stopping the active session', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [{
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          }],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [{
            id: 'session-1',
            title: 'Running task',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'provider-1',
            modelId: 'claude-3-5-sonnet',
            agentAdapter: 'claude',
            permissionMode: 'claude-ask',
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'running',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
            messageCount: 1,
          }],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:cancel') return { cancelled: true }
      throw new Error(`Unhandled channel ${channel}`)
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(ToastProvider, null, React.createElement(ChatView)))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.session-running-badge')).not.toBeNull()
    })

    const item = container.querySelector<HTMLElement>('.chat-item-compact')
    expect(item).not.toBeNull()

    await act(async () => {
      item?.click()
    })

    let stopButton: HTMLButtonElement | null = null
    await vi.waitFor(() => {
      stopButton = container.querySelector<HTMLButtonElement>('[title="停止会话"]')
      expect(stopButton).not.toBeNull()
    })

    await act(async () => {
      stopButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('session:cancel', { sessionId: 'session-1' })
  })

  it.todo('should render HomePage with metric cards')
  it.todo('should render SettingsPage with sub-navigation')
})
