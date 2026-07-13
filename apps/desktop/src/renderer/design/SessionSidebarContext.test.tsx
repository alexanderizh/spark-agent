// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./AppContext', () => {
  return {
    useApp: () => ({
      requestConfirm: vi.fn(),
      requestPrompt: vi.fn(),
    }),
  }
})

import { ToastProvider } from './components/Toast'
import { SessionSidebarProvider, useSessionSidebar } from './SessionSidebarContext'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SessionSidebarContext', () => {
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
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps the selected workspace after creating a team-mode session', async () => {
    const workspaceA = {
      id: 'workspace-1',
      name: 'Alpha',
      rootPath: '/tmp/alpha',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
    }
    const workspaceB = {
      id: 'workspace-2',
      name: 'Beta',
      rootPath: '/tmp/beta',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
    }
    const providerId = 'provider-1'
    const agentId = 'platform-manager-agent'
    let sessionCreated = false
    let configChangedHandler: ((event: Record<string, unknown>) => void) | null = null
    let sessionCreatedHandler: ((event: Record<string, unknown>) => void) | null = null

    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') {
        return { workspaces: [workspaceA, workspaceB], total: 2 }
      }
      if (channel === 'session:list') {
        return {
          sessions: sessionCreated
            ? [
                {
                  id: 'session-created',
                  title: 'Team session',
                  projectId: 'workspace-1',
                  workspaceIds: ['workspace-1'],
                  providerProfileId: providerId,
                  modelId: null,
                  agentId,
                  agentAdapter: 'claude',
                  permissionMode: 'claude-ask',
                  chatMode: 'agent',
                  reasoningEffort: 'medium',
                  status: 'idle',
                  pinnedAt: null,
                  archivedAt: null,
                  createdAt: '2026-05-27T00:00:00.000Z',
                  updatedAt: '2026-05-27T00:00:00.000Z',
                  messageCount: 0,
                },
              ]
            : [],
          total: sessionCreated ? 1 : 0,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: workspaceB }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: providerId,
              name: 'Claude',
              provider: 'anthropic',
              defaultModel: 'claude-3-5-sonnet',
              modelIds: ['claude-3-5-sonnet'],
              apiEndpoint: 'https://api.example.com',
              keystoreRef: providerId,
              isDefault: true,
              createdAt: '2026-05-27T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') {
        return {
          agents: [
            {
              id: agentId,
              name: 'Platform Manager',
              description: 'host',
              enabled: true,
              builtIn: true,
              isDefault: true,
              providerProfileId: providerId,
              modelId: null,
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              reasoningEffort: 'medium',
            },
          ],
        }
      }
      if (channel === 'session:create') {
        sessionCreated = true
        window.setTimeout(() => {
          sessionCreatedHandler?.({ sessionId: 'session-created' })
        }, 5)
        return { sessionId: 'session-created', createdAt: '2026-05-27T00:00:00.000Z' }
      }
      if (channel === 'team:update') {
        window.setTimeout(() => {
          configChangedHandler?.({ scope: 'team', action: 'update', id: 'session-created' })
        }, 0)
        return { config: request?.config }
      }
      if (channel === 'terminal:list-active') return { sessions: [] }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:config:changed') configChangedHandler = callback
        if (channel === 'stream:session:created') sessionCreatedHandler = callback
        return vi.fn()
      }),
    })

    localStorage.setItem(
      'spark-agent:composer-prefs',
      JSON.stringify({
        modelId: '',
        agentId: '',
        providerProfileId: providerId,
      }),
    )

    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <SessionSidebarProvider>
            <CaptureSessionSidebarContext />
          </SessionSidebarProvider>
        </ToastProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      latestCtxRef.current?.setActiveWorkspace('workspace-1')
    })

    const refreshCountBeforeCreate = invoke.mock.calls.filter(
      ([channel]) => channel === 'workspace:list',
    ).length

    await act(async () => {
      await latestCtxRef.current?.handleNewSession('workspace-1', {
        teamConfig: {
          enabled: true,
          hostAgentId: agentId,
          memberAgentIds: [],
          maxDepth: 1,
          allowNesting: false,
          maxDiscussionRounds: 6,
          enablePeerMessaging: false,
        },
      })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(latestCtxRef.current?.activeWorkspaceId).toBe('workspace-1')
    expect(latestCtxRef.current?.activeSessionId).toBe('session-created')
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'workspace:list').length -
        refreshCountBeforeCreate,
    ).toBe(1)
  })

  it('keeps a newly created session active when an older refresh resolves late', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Alpha',
      rootPath: '/tmp/alpha',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    }
    const providerId = 'provider-1'
    const agentId = 'platform-manager-agent'
    const oldSession = {
      id: 'session-old',
      title: 'Old session',
      projectId: workspace.id,
      workspaceIds: [workspace.id],
      providerProfileId: providerId,
      modelId: null,
      agentId,
      agentAdapter: 'claude',
      permissionMode: 'claude-ask',
      chatMode: 'agent',
      reasoningEffort: 'medium',
      status: 'idle',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      messageCount: 1,
    }
    const createdSession = {
      ...oldSession,
      id: 'session-created',
      title: 'New session',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
      messageCount: 0,
    }
    let sessionCreated = false
    let sessionCreatedHandler: ((event: Record<string, unknown>) => void) | null = null
    let blockNextRefresh = false
    let releaseRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        if (blockNextRefresh) {
          blockNextRefresh = false
          await refreshGate
        }
        return { workspaces: [workspace], total: 1 }
      }
      if (channel === 'session:list') {
        const sessions = sessionCreated ? [createdSession, oldSession] : [oldSession]
        return { sessions, total: sessions.length }
      }
      if (channel === 'workspace:get-current') return { workspace }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: providerId,
              name: 'Claude',
              provider: 'anthropic',
              defaultModel: 'claude-3-5-sonnet',
              modelIds: ['claude-3-5-sonnet'],
              apiEndpoint: 'https://api.example.com',
              keystoreRef: providerId,
              isDefault: true,
              createdAt: '2026-07-12T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') {
        return {
          agents: [
            {
              id: agentId,
              name: 'Platform Manager',
              description: 'host',
              enabled: true,
              builtIn: true,
              isDefault: true,
              providerProfileId: providerId,
              modelId: null,
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              reasoningEffort: 'medium',
            },
          ],
        }
      }
      if (channel === 'session:create') {
        sessionCreated = true
        sessionCreatedHandler?.({ sessionId: createdSession.id })
        return { sessionId: createdSession.id, createdAt: createdSession.createdAt }
      }
      if (channel === 'terminal:list-active') return { sessions: [] }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:session:created') sessionCreatedHandler = callback
        return vi.fn()
      }),
    })
    localStorage.setItem(
      'spark-agent:composer-prefs',
      JSON.stringify({ providerProfileId: providerId }),
    )

    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <SessionSidebarProvider>
            <CaptureSessionSidebarContext />
          </SessionSidebarProvider>
        </ToastProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    blockNextRefresh = true
    const sessionListCallsBeforeRefresh = invoke.mock.calls.filter(
      ([channel]) => channel === 'session:list',
    ).length
    let staleRefresh: Promise<void> | undefined
    act(() => {
      staleRefresh = latestCtxRef.current?.refreshData()
    })
    await vi.waitFor(() => {
      expect(invoke.mock.calls.filter(([channel]) => channel === 'session:list')).toHaveLength(
        sessionListCallsBeforeRefresh + 1,
      )
    })

    await act(async () => {
      await latestCtxRef.current?.handleNewSession(workspace.id)
    })
    expect(latestCtxRef.current?.activeSessionId).toBe(createdSession.id)

    await act(async () => {
      releaseRefresh()
      await staleRefresh
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(latestCtxRef.current?.sessions.some((session) => session.id === createdSession.id)).toBe(
      true,
    )
    expect(latestCtxRef.current?.activeSessionId).toBe(createdSession.id)

    await new Promise((resolve) => setTimeout(resolve, 0))
    sessionCreated = false
    await act(async () => {
      await latestCtxRef.current?.refreshData()
    })
    await vi.waitFor(() => {
      expect(latestCtxRef.current?.activeSessionId).toBeNull()
    })
  })

  it('coalesces concurrent refresh requests into one IPC batch', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Alpha',
      rootPath: '/tmp/alpha',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    }
    let blockRefresh = false
    let releaseRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const invoke = vi.fn(async (channel: string) => {
      if (blockRefresh) await refreshGate
      if (channel === 'workspace:list') return { workspaces: [workspace], total: 1 }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'agent:list') return { agents: [] }
      if (channel === 'terminal:list-active') return { sessions: [] }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <SessionSidebarProvider>
            <CaptureSessionSidebarContext />
          </SessionSidebarProvider>
        </ToastProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    invoke.mockClear()
    blockRefresh = true
    const context = latestCtxRef.current
    if (context == null) throw new Error('Session sidebar context was not captured')
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = context.refreshData()
      second = context.refreshData()
    })

    expect(first).toBe(second)
    await vi.waitFor(() => {
      expect(invoke.mock.calls.filter(([channel]) => channel === 'workspace:list')).toHaveLength(1)
    })

    await act(async () => {
      releaseRefresh()
      await Promise.all([first, second])
    })
  })

  it('syncs the active workspace to the restored active session workspace', async () => {
    const workspaceAlpha = {
      id: 'workspace-alpha',
      name: 'Alpha',
      rootPath: '/tmp/alpha',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    }
    const workspaceBeta = {
      id: 'workspace-beta',
      name: 'Beta',
      rootPath: '/tmp/beta',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    }
    const providerId = 'provider-1'
    const agentId = 'platform-manager-agent'

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return { workspaces: [workspaceAlpha, workspaceBeta], total: 2 }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-beta',
              title: 'Beta session',
              projectId: 'workspace-beta',
              workspaceIds: ['workspace-beta'],
              providerProfileId: providerId,
              modelId: null,
              agentId,
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-07-08T00:00:00.000Z',
              updatedAt: '2026-07-08T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: workspaceAlpha }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: providerId,
              name: 'Claude',
              provider: 'anthropic',
              defaultModel: 'claude-3-5-sonnet',
              modelIds: ['claude-3-5-sonnet'],
              apiEndpoint: 'https://api.example.com',
              keystoreRef: providerId,
              isDefault: true,
              createdAt: '2026-07-08T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') {
        return {
          agents: [
            {
              id: agentId,
              name: 'Platform Manager',
              description: 'host',
              enabled: true,
              builtIn: true,
              isDefault: true,
              providerProfileId: providerId,
              modelId: null,
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              reasoningEffort: 'medium',
            },
          ],
        }
      }
      if (channel === 'terminal:list-active') return { sessions: [] }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    localStorage.setItem('spark-agent:last-active-session', 'session-beta')

    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <SessionSidebarProvider>
            <CaptureSessionSidebarContext />
          </SessionSidebarProvider>
        </ToastProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(latestCtxRef.current?.activeSessionId).toBe('session-beta')
      expect(latestCtxRef.current?.activeWorkspaceId).toBe('workspace-beta')
    })

    await act(async () => {
      await latestCtxRef.current?.refreshData()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(latestCtxRef.current?.activeWorkspaceId).toBe('workspace-beta')
    })

    await act(async () => {
      latestCtxRef.current?.setActiveWorkspace('workspace-alpha')
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(latestCtxRef.current?.activeWorkspaceId).toBe('workspace-alpha')

    await act(async () => {
      await latestCtxRef.current?.refreshData()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(latestCtxRef.current?.activeWorkspaceId).toBe('workspace-alpha')
    })
  })

  it('syncs runtime selection when reusing an unused session', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Alpha',
      rootPath: '/tmp/alpha',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    }
    const oldProviderId = 'old-provider'
    const nextProviderId = 'next-provider'
    const agentId = 'platform-manager-agent'
    const updatedSessions: Record<string, unknown>[] = []
    const updatedTeamConfigs: Record<string, unknown>[] = []

    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') return { workspaces: [workspace], total: 1 }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'unused-session',
              title: 'Unused session',
              projectId: workspace.id,
              workspaceIds: [workspace.id],
              providerProfileId: oldProviderId,
              modelId: 'old-model',
              agentId,
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-07-09T00:00:00.000Z',
              updatedAt: '2026-07-09T00:00:00.000Z',
              messageCount: 0,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: oldProviderId,
              name: 'Old Provider',
              provider: 'anthropic',
              defaultModel: 'old-model',
              modelIds: ['old-model'],
              apiEndpoint: 'https://old.example.com',
              keystoreRef: oldProviderId,
              isDefault: false,
              createdAt: '2026-07-09T00:00:00.000Z',
            },
            {
              id: nextProviderId,
              name: 'Next Provider',
              provider: 'anthropic',
              defaultModel: 'next-model',
              modelIds: ['next-model'],
              apiEndpoint: 'https://next.example.com',
              keystoreRef: nextProviderId,
              isDefault: true,
              createdAt: '2026-07-09T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') {
        return {
          agents: [
            {
              id: agentId,
              name: 'Platform Manager',
              description: 'host',
              enabled: true,
              builtIn: true,
              isDefault: true,
              providerProfileId: nextProviderId,
              modelId: 'next-model',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              reasoningEffort: 'high',
            },
          ],
        }
      }
      if (channel === 'session:update') {
        updatedSessions.push(request ?? {})
        return {
          session: {
            id: 'unused-session',
            title: 'Unused session',
            projectId: workspace.id,
            workspaceIds: [workspace.id],
            providerProfileId: request?.providerProfileId,
            modelId: request?.modelId,
            agentId: request?.agentId,
            agentAdapter: request?.agentAdapter,
            permissionMode: request?.permissionMode,
            chatMode: 'agent',
            reasoningEffort: request?.reasoningEffort,
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
            messageCount: 0,
          },
        }
      }
      if (channel === 'team:update') {
        updatedTeamConfigs.push(request ?? {})
        return { config: request?.config }
      }
      if (channel === 'terminal:list-active') return { sessions: [] }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    localStorage.setItem(
      'spark-agent:composer-prefs',
      JSON.stringify({
        adapter: 'claude',
        providerProfileId: nextProviderId,
        modelId: 'next-model',
        permissionMode: 'claude-auto-edits',
        reasoningEffort: 'high',
        agentId,
      }),
    )

    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <SessionSidebarProvider>
            <CaptureSessionSidebarContext />
          </SessionSidebarProvider>
        </ToastProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(latestCtxRef.current?.sessions).toHaveLength(1)
      expect(latestCtxRef.current?.providers).toHaveLength(2)
      expect(latestCtxRef.current?.agents).toHaveLength(1)
    })

    await act(async () => {
      await latestCtxRef.current?.handleNewSession(workspace.id)
    })

    expect(updatedSessions).toHaveLength(1)
    expect(updatedSessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'unused-session',
        providerProfileId: nextProviderId,
        modelId: 'next-model',
        agentId,
        agentAdapter: 'claude',
        permissionMode: 'claude-ask',
        reasoningEffort: 'high',
      }),
    )
    expect(latestCtxRef.current?.activeSessionId).toBe('unused-session')
    expect(latestCtxRef.current?.selectedProviderId).toBe(nextProviderId)
    expect(updatedTeamConfigs).toEqual([
      {
        sessionId: 'unused-session',
        config: {
          enabled: false,
          hostAgentId: agentId,
          memberAgentIds: [],
          maxDepth: 1,
          allowNesting: false,
          maxDiscussionRounds: 6,
          enablePeerMessaging: false,
        },
      },
    ])
  })

  it('keeps the created session model aligned with the selected provider', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Alpha',
      rootPath: '/tmp/alpha',
      projectKind: 'node',
      pinnedAt: null,
      archivedAt: null,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    }
    const oldProviderId = 'old-provider'
    const nextProviderId = 'next-provider'
    const createdSessions: Record<string, unknown>[] = []

    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') return { workspaces: [workspace], total: 1 }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: oldProviderId,
              name: 'Old Provider',
              provider: 'anthropic',
              defaultModel: 'old-model',
              modelIds: ['old-model'],
              apiEndpoint: 'https://old.example.com',
              keystoreRef: oldProviderId,
              isDefault: false,
              createdAt: '2026-07-09T00:00:00.000Z',
            },
            {
              id: nextProviderId,
              name: 'Next Provider',
              provider: 'anthropic',
              defaultModel: 'next-model',
              modelIds: ['next-model'],
              apiEndpoint: 'https://next.example.com',
              keystoreRef: nextProviderId,
              isDefault: true,
              createdAt: '2026-07-09T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') {
        return {
          agents: [
            {
              id: 'platform-manager-agent',
              name: 'Platform Manager',
              description: 'host',
              enabled: true,
              builtIn: true,
              isDefault: true,
              providerProfileId: oldProviderId,
              modelId: 'old-model',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              reasoningEffort: 'medium',
            },
          ],
        }
      }
      if (channel === 'session:create') {
        createdSessions.push(request ?? {})
        return { sessionId: 'created-session' }
      }
      if (channel === 'terminal:list-active') return { sessions: [] }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <SessionSidebarProvider>
            <CaptureSessionSidebarContext />
          </SessionSidebarProvider>
        </ToastProvider>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(latestCtxRef.current?.providers).toHaveLength(2)
      expect(latestCtxRef.current?.agents).toHaveLength(1)
    })

    await act(async () => {
      await latestCtxRef.current?.handleNewSession(workspace.id, {
        providerProfileId: nextProviderId,
        forceNew: true,
      })
    })

    expect(createdSessions).toHaveLength(1)
    expect(createdSessions[0]).toEqual(
      expect.objectContaining({
        providerProfileId: nextProviderId,
        modelId: 'next-model',
      }),
    )
  })
})
