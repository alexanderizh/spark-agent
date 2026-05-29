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

  it('persists the settings permission mode to the shared composer preference', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'permission:list-profiles') {
        return {
          profiles: [{
            id: 'project-standard',
            name: 'Project Standard',
            sandboxLevel: 2,
            rules: [],
          }],
          activeProfileId: 'project-standard',
        }
      }
      if (channel === 'permission:set-active-profile') return { activeProfileId: 'project-standard' }
      if (channel === 'permission:update-sandbox') return {}
      if (channel === 'permission:update-rule') return {}
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { PermissionsSection } = await import('../design/views/SettingsView')
    act(() => {
      root = createRoot(container)
      root.render(React.createElement(PermissionsSection))
    })

    await act(async () => {
      await Promise.resolve()
    })

    const bypass = Array.from(container.querySelectorAll<HTMLButtonElement>('.runtime-permission-option'))
      .find((button) => button.textContent?.includes('Bypass permissions'))
    expect(bypass).toBeDefined()

    act(() => {
      bypass!.click()
    })

    const stored = JSON.parse(localStorage.getItem('spark-agent:composer-prefs') ?? '{}')
    expect(stored).toEqual(expect.objectContaining({
      adapter: 'claude-sdk',
      permissionMode: 'claude-bypass',
    }))
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      category: 'runtime-permissions',
      key: 'defaults',
      value: expect.objectContaining({
        adapter: 'claude-sdk',
        permissionMode: 'claude-bypass',
      }),
    })
    expect(container.textContent).toContain('当前默认策略会跳过人工审批')
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

  it('shows a running indicator at the bottom of a streaming agent message with content', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const historyEvents = [
      {
        id: 'assistant-1',
        type: 'assistant_message',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:00.000Z',
        seq: 1,
        mode: 'delta',
        content: '正在处理项目文件',
        provider: 'codex',
        isFinal: false,
      },
      {
        id: 'status-1',
        type: 'agent_status',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:01.000Z',
        seq: 2,
        status: 'thinking',
      },
    ]
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
      if (channel === 'workspace:get-current') {
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
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: historyEvents, hasMore: false }
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

    await vi.waitFor(() => {
      expect(container.textContent).toContain('正在处理项目文件')
    })
    const runningTail = container.querySelector('.agent-running-tail')
    expect(runningTail).not.toBeNull()
    expect(runningTail?.textContent).toContain('正在运行')
  })

  it('shows a running indicator while waiting for the first agent reply', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const historyEvents = [
      {
        id: 'user-1',
        type: 'user_message',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:00.000Z',
        seq: 1,
        content: '当前有没有未提交的代码',
      },
      {
        id: 'status-1',
        type: 'agent_status',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:01.000Z',
        seq: 2,
        status: 'thinking',
      },
    ]
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
      if (channel === 'workspace:get-current') {
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
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: historyEvents, hasMore: false }
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

    await vi.waitFor(() => {
      expect(container.textContent).toContain('当前有没有未提交的代码')
    })
    const runningTail = container.querySelector('.agent-running-tail')
    expect(runningTail).not.toBeNull()
    expect(runningTail?.textContent).toContain('正在运行')
  })

  it('clears the composer queue loading state from queue snapshots even when the session list is stale', async () => {
    const streamHandlers = new Map<string, Array<(payload: unknown) => void>>()
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
      if (channel === 'session:get-queue') return { sessionId: 'session-1', running: true, queuedTurns: [] }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') return { workspace: null }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        streamHandlers.set(channel, [...(streamHandlers.get(channel) ?? []), handler])
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
      expect(container.textContent).toContain('执行中')
    })

    await act(async () => {
      const snapshot = {
        sessionId: 'session-1',
        running: false,
        queuedTurns: [],
      }
      for (const handler of streamHandlers.get('stream:session:queue-changed') ?? []) {
        handler(snapshot)
      }
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.composer-queue-item.active')).toBeNull()
      expect(container.querySelector('.session-running-badge')).toBeNull()
    })
    expect(container.textContent).not.toContain('正在执行当前任务')
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
          action: string
          toolInput: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
          persistentScopes: Array<'project' | 'global'>
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
              action: 'command_exec',
              toolInput: { command: 'git log --oneline -20' },
              riskLevel: 'high',
              persistentScopes: ['project', 'global'],
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

  it('renders plan approval as the only approval surface for control tools', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const listeners = new Map<string, (payload: unknown) => void>()
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
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          }],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [{
            id: 'session-1',
            title: 'Plan mode session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'anthropic-provider',
            modelId: 'claude-sonnet-4-5',
            agentAdapter: 'claude-sdk',
            permissionMode: 'claude-plan',
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          }],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [{
            id: 'anthropic-provider',
            name: 'Anthropic',
            provider: 'anthropic',
            defaultModel: 'claude-sonnet-4-5',
            modelIds: ['claude-sonnet-4-5'],
            apiEndpoint: null,
            keystoreRef: 'anthropic-key',
            isDefault: true,
            createdAt: '2026-05-28T00:00:00.000Z',
          }],
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches') return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue') return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'session:update') {
        return {
          session: {
            id: 'session-1',
            title: 'Plan mode session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'anthropic-provider',
            modelId: 'claude-sonnet-4-5',
            agentAdapter: 'claude-sdk',
            permissionMode: request?.permissionMode,
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          },
        }
      }
      if (channel === 'session:send-turn') return { turnId: 'turn-continue', started: true }
      return {}
    })
    const onApprovalClose = vi.fn()
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (payload: unknown) => void) => {
        listeners.set(channel, callback)
        return vi.fn()
      }),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      const ChatViewWithApproval = ChatView as React.ComponentType<{
        approvalRequest: {
          requestId: string
          sessionId: string
          toolName: string
          action: string
          toolInput: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
          persistentScopes: Array<'project' | 'global'>
        }
        onApprovalClose: () => void
      }>
      root.render(
        React.createElement(ToastProvider, null,
          React.createElement(ChatViewWithApproval, {
            approvalRequest: {
              requestId: 'req-plan',
              sessionId: 'session-1',
              toolName: 'exit_plan_mode',
              action: 'control_plan',
              toolInput: { plan: '1. inspect\n2. patch\n3. verify' },
              riskLevel: 'low',
              persistentScopes: ['project', 'global'],
            },
            onApprovalClose,
          }),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('.composer-approval-card')).toBeNull()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Plan mode session')
    })
    await vi.waitFor(() => {
      expect(listeners.get('stream:session:agent-event')).toBeDefined()
    })

    await act(async () => {
      listeners.get('stream:session:agent-event')?.({
        id: 'evt-plan',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-28T00:00:01.000Z',
        type: 'plan_proposed',
        plan: '1. inspect\n2. patch\n3. verify',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.plan-approval-modal')).not.toBeNull()
    })
    expect(container.querySelector('.composer-approval-card')).toBeNull()
    expect(container.textContent).toContain('计划已就绪，等待你审批')

    const approveButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.plan-approval-modal button'))
      .find((button) => button.textContent?.includes('批准并执行'))
    expect(approveButton).toBeDefined()

    await act(async () => {
      approveButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('session:update', {
      sessionId: 'session-1',
      permissionMode: 'claude-auto-edits',
    })
    expect(invoke).toHaveBeenCalledWith('session:send-turn', {
      sessionId: 'session-1',
      message: expect.stringContaining('1. inspect\n2. patch\n3. verify'),
    })
    expect(onApprovalClose).not.toHaveBeenCalled()
  })

  it('uses the active session provider model instead of stale composer preferences', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    localStorage.setItem('spark-agent:composer-prefs', JSON.stringify({
      adapter: 'claude-sdk',
      providerProfileId: 'xiaomi-provider',
      modelId: 'mimo-v2.5-pro',
      permissionMode: 'claude-plan',
    }))

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
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          }],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [{
            id: 'session-1',
            title: 'Old GLM session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'tencent-provider',
            modelId: null,
            agentAdapter: 'claude-sdk',
            permissionMode: 'claude-plan',
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          }],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'tencent-provider',
              name: 'Tencent Coding Plan',
              provider: 'anthropic',
              defaultModel: 'glm-5',
              modelIds: ['glm-5'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'tencent-key',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
            {
              id: 'xiaomi-provider',
              name: 'Xiaomi MiMo',
              provider: 'anthropic',
              defaultModel: 'mimo-v2.5-pro',
              modelIds: ['mimo-v2.5-pro'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'xiaomi-key',
              isDefault: false,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches') return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue') return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'session:send-turn') return { turnId: 'turn-1', started: true }
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

    await vi.waitFor(() => {
      expect(container.textContent).toContain('glm-5')
    })
    expect(container.textContent).not.toContain('mimo-v2.5-pro')

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    const sendButton = container.querySelector<HTMLButtonElement>('.composer-send-round')
    expect(textarea).not.toBeNull()
    expect(sendButton).not.toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'hello from old session')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      sendButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('session:send-turn', expect.objectContaining({
      sessionId: 'session-1',
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    }))
  })

  it('switches same-adapter provider and model atomically for an existing session', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
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
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          }],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [{
            id: 'session-1',
            title: 'Switch model session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'tencent-provider',
            modelId: 'glm-5',
            agentAdapter: 'claude-sdk',
            permissionMode: 'claude-plan',
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          }],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'tencent-provider',
              name: 'Tencent Coding Plan',
              provider: 'anthropic',
              defaultModel: 'glm-5',
              modelIds: ['glm-5'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'tencent-key',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
            {
              id: 'xiaomi-provider',
              name: 'Xiaomi MiMo',
              provider: 'anthropic',
              defaultModel: 'mimo-v2.5-pro',
              modelIds: ['mimo-v2.5-pro'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'xiaomi-key',
              isDefault: false,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'session:update') {
        return {
          session: {
            id: 'session-1',
            title: 'Switch model session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: request?.providerProfileId,
            modelId: request?.modelId,
            agentAdapter: request?.agentAdapter,
            permissionMode: request?.permissionMode,
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          },
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches') return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue') return { sessionId: 'session-1', running: false, queuedTurns: [] }
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

    await vi.waitFor(() => {
      expect(container.textContent).toContain('glm-5')
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.composer-model-picker .composer-select-trigger')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const mimoButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.composer-model-menu .composer-menu-item'))
      .find((button) => button.textContent?.includes('mimo-v2.5-pro'))
    expect(mimoButton).toBeDefined()

    await act(async () => {
      mimoButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('session:update', expect.objectContaining({
      sessionId: 'session-1',
      providerProfileId: 'xiaomi-provider',
      modelId: 'mimo-v2.5-pro',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    }))
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

  it('shows the latest todo_write plan below session information in the inspector', async () => {
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
            title: 'Plan progress',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'provider-1',
            modelId: 'claude-3-5-sonnet',
            agentAdapter: 'claude',
            permissionMode: 'claude-plan',
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
            messageCount: 2,
          }],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
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
              content: 'make a plan',
            },
            {
              id: 'tool-1',
              type: 'tool_call',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:01.000Z',
              seq: 2,
              provider: 'claude',
              toolCallId: 'todo-1',
              toolName: 'todo_write',
              toolInput: {
                todos: [
                  { content: '确认空目录状态', status: 'completed' },
                  { content: '初始化 React 项目', activeForm: '执行 Vite 初始化命令', status: 'in_progress' },
                  { content: '验证启动脚本', status: 'pending' },
                ],
              },
              source: 'builtin',
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
      expect(container.textContent).toContain('todo_write')
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.tabbar-actions .icon-btn[aria-label="会话检查器"]')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const sections = Array.from(container.querySelectorAll<HTMLElement>('.inspector-section'))
    expect(sections[0]?.textContent).toContain('会话信息')
    expect(sections[1]?.textContent).toContain('计划')
    expect(sections[1]?.textContent).toContain('1/3')
    expect(sections[1]?.textContent).toContain('执行 Vite 初始化命令')
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
