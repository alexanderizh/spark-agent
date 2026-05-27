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

  it('saves the OpenAI Responses API kind from the provider edit panel', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'provider:create') {
        return {
          profile: {
            id: 'provider-1',
            name: 'OpenAI Codex',
            provider: 'openai',
            defaultModel: 'gpt-5-codex',
            modelIds: ['gpt-5-codex'],
            apiEndpoint: 'https://api.openai.com/v1',
            keystoreRef: 'openai-provider-1',
            isDefault: false,
            createdAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:update') return { profile: null }
      if (channel === 'provider:list') return { profiles: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    const { ProviderEditPanel } = await import('../design/views/SettingsView')
    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      expect(setter).toBeDefined()
      if (setter == null) throw new Error('HTMLInputElement value setter unavailable')
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const setSelectValue = (select: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      expect(setter).toBeDefined()
      if (setter == null) throw new Error('HTMLSelectElement value setter unavailable')
      setter.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }

    act(() => {
      root = createRoot(container)
      root.render(
        React.createElement(ToastProvider, null,
          React.createElement(ProviderEditPanel, { onClose: vi.fn() }),
        ),
      )
    })

    let selects = container.querySelectorAll<HTMLSelectElement>('select')
    expect(selects.length).toBe(2)

    await act(async () => {
      const providerSelect = selects[1]
      expect(providerSelect).toBeDefined()
      if (providerSelect == null) throw new Error('Provider select missing')
      setSelectValue(providerSelect, 'openai')
    })

    selects = container.querySelectorAll<HTMLSelectElement>('select')
    expect(selects.length).toBeGreaterThanOrEqual(3)

    await act(async () => {
      const codexKindSelect = selects[2]
      expect(codexKindSelect).toBeDefined()
      if (codexKindSelect == null) throw new Error('Codex API kind select missing')
      setSelectValue(codexKindSelect, 'responses')
    })

    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      const nameInput = inputs[0]
      const modelInput = inputs[1]
      const apiKeyInput = inputs[3]
      const saveButton = container.querySelector<HTMLButtonElement>('.slide-panel-foot .btn.primary')
      expect(nameInput).toBeDefined()
      expect(modelInput).toBeDefined()
      expect(apiKeyInput).toBeDefined()
      expect(saveButton).not.toBeNull()
      if (nameInput == null || modelInput == null || apiKeyInput == null || saveButton == null) {
        throw new Error('Provider form controls missing')
      }
      setInputValue(nameInput, 'OpenAI Codex')
      setInputValue(modelInput, 'gpt-5-codex')
      setInputValue(apiKeyInput, 'sk-openai')
      saveButton.click()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith('provider:create', expect.objectContaining({
      provider: 'openai',
      defaultModel: 'gpt-5-codex',
      codexApiKind: 'responses',
    }))
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
