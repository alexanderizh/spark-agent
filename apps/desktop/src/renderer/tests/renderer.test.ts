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

  it('uses different project icons for expanded and collapsed sidebar groups', async () => {
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
      if (channel === 'session:list') return { sessions: [], total: 0 }
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
      return {}
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

    let projectHead: HTMLElement | null = null
    await vi.waitFor(() => {
      projectHead = container.querySelector('.proj-head')
      expect(projectHead).not.toBeNull()
    })

    const expandedIconPath = projectHead!.querySelector('.proj-folder-icon path')?.getAttribute('d')
    expect(expandedIconPath).toBeTruthy()

    await act(async () => {
      projectHead!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const collapsedIconPath = projectHead!.querySelector('.proj-folder-icon path')?.getAttribute('d')
    expect(collapsedIconPath).toBeTruthy()
    expect(collapsedIconPath).not.toBe(expandedIconPath)
  })

  it('renders permission approval inline above the composer', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') return { workspaces: [], total: 0 }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'permission:approval-respond') return { ok: true }
      return {}
    })
    const onApprovalClose = vi.fn()
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      const ChatViewWithApproval = ChatView as React.ComponentType<{
        approvalRequest: {
          requestId: string
          sessionId: string
          toolName: string
          toolInput: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
        }
        onApprovalClose: () => void
      }>
      root.render(
        React.createElement(ToastProvider, null,
          React.createElement(ChatViewWithApproval, {
            approvalRequest: {
              requestId: 'req-1',
              sessionId: '42e5391d-session',
              toolName: 'bash',
              toolInput: { command: 'git log --oneline -20' },
              riskLevel: 'high',
            },
            onApprovalClose,
          }),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const inlineCard = container.querySelector('.composer-approval-card')
    const composer = container.querySelector('.composer')
    expect(inlineCard).not.toBeNull()
    expect(composer).not.toBeNull()
    expect(inlineCard?.compareDocumentPosition(composer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(container.querySelector('.modal-backdrop')).toBeNull()

    const allowOnce = Array.from(container.querySelectorAll<HTMLButtonElement>('.composer-approval-btn'))
      .find((button) => button.textContent?.includes('允许一次'))
    expect(allowOnce).toBeDefined()

    await act(async () => {
      allowOnce?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('permission:approval-respond', {
      requestId: 'req-1',
      decision: 'allow-once',
    })
    expect(onApprovalClose).toHaveBeenCalled()
  })

  it('does not auto-collapse the latest assistant message body', async () => {
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
            title: 'Long answer',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'provider-1',
            modelId: 'claude-3-5-sonnet',
            agentAdapter: 'claude',
            permissionMode: 'claude-ask',
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
            messageCount: 4,
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
      if (channel === 'session:get-history') {
        return {
          events: [
            {
              id: 'user-1',
              type: 'user_message',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:00.000Z',
              seq: 1,
              content: 'first',
            },
            {
              id: 'assistant-1',
              type: 'assistant_message',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:01.000Z',
              seq: 2,
              mode: 'complete',
              provider: 'claude',
              content: 'Historical long answer',
              isFinal: true,
            },
            {
              id: 'user-2',
              type: 'user_message',
              sessionId: 'session-1',
              turnId: 'turn-2',
              timestamp: '2026-05-27T00:00:02.000Z',
              seq: 3,
              content: 'second',
            },
            {
              id: 'assistant-2',
              type: 'assistant_message',
              sessionId: 'session-1',
              turnId: 'turn-2',
              timestamp: '2026-05-27T00:00:03.000Z',
              seq: 4,
              mode: 'complete',
              provider: 'claude',
              content: 'Latest long answer',
              isFinal: true,
            },
          ],
          hasMore: false,
        }
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(800)

    try {
      const { ChatView } = await import('../design/views/ChatView')

      await act(async () => {
        root = createRoot(container)
        root.render(React.createElement(ToastProvider, null, React.createElement(ChatView)))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await vi.waitFor(() => {
        expect(container.querySelector('.chat-item-compact')).not.toBeNull()
      })

      await act(async () => {
        container.querySelector<HTMLElement>('.chat-item-compact')?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await vi.waitFor(() => {
        expect(container.querySelectorAll('.msg-agent').length).toBe(2)
      })

      await vi.waitFor(() => {
        expect(container.querySelectorAll('.collapse-overlay .collapse-toggle').length).toBe(1)
      })
      const latestMessage = container.querySelectorAll('.msg-agent')[1]
      expect(latestMessage?.querySelector('.collapse-overlay .collapse-toggle')).toBeNull()
    } finally {
      scrollHeightSpy.mockRestore()
    }
  })

  it('hydrates paged running history and merges live events received during reload', async () => {
    let streamHandler: ((event: Record<string, unknown>) => void) | null = null
    let resolveFirstHistory: ((value: unknown) => void) | null = null
    const firstHistory = new Promise((resolve) => {
      resolveFirstHistory = resolve
    })
    const historyCalls: Array<Record<string, unknown>> = []

    const userEvent = (seq: number, turnId: string, content: string) => ({
      id: `user-${seq}`,
      type: 'user_message',
      sessionId: 'session-1',
      turnId,
      timestamp: `2026-05-27T00:00:0${seq}.000Z`,
      seq,
      content,
    })
    const assistantEvent = (seq: number, turnId: string, content: string) => ({
      id: `assistant-${seq}`,
      type: 'assistant_message',
      sessionId: 'session-1',
      turnId,
      timestamp: `2026-05-27T00:00:0${seq}.000Z`,
      seq,
      mode: 'delta',
      provider: 'claude',
      content,
      isFinal: false,
    })

    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
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
            title: 'Running stream',
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
            messageCount: 5,
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
      if (channel === 'session:get-history') {
        historyCalls.push(request ?? {})
        if (historyCalls.length === 1) return firstHistory
        return {
          events: [
            userEvent(0, 'turn-1', 'first'),
            assistantEvent(1, 'turn-1', 'Older answer. '),
          ],
          hasMore: false,
        }
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:session:agent-event') streamHandler = callback
        return vi.fn()
      }),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(ToastProvider, null, React.createElement(ChatView)))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.chat-item-compact')).not.toBeNull()
    })

    await act(async () => {
      container.querySelector<HTMLElement>('.chat-item-compact')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(historyCalls.length).toBe(1)
      expect(streamHandler).not.toBeNull()
    })

    await act(async () => {
      streamHandler?.(assistantEvent(4, 'turn-2', 'live tail. '))
      resolveFirstHistory?.({
        events: [
          userEvent(2, 'turn-2', 'second'),
          assistantEvent(3, 'turn-2', 'Latest start. '),
        ],
        hasMore: true,
      })
      await firstHistory
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(historyCalls.length).toBe(2)
      expect(historyCalls[1]).toEqual(expect.objectContaining({ beforeSeq: 2 }))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Older answer.')
      expect(container.textContent).toContain('Latest start. live tail.')
    })
  })

  it.todo('should render HomePage with metric cards')
  it.todo('should render SettingsPage with sub-navigation')
})
