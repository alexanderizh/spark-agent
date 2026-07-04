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
        return { sessionId: 'session-created', createdAt: '2026-05-27T00:00:00.000Z' }
      }
      if (channel === 'team:update') {
        window.setTimeout(() => {
          configChangedHandler?.({ scope: 'team', action: 'update', id: 'session-created' })
        }, 0)
        return { config: request?.config }
      }
      return {}
    })

    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:config:changed') configChangedHandler = callback
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
  })
})
