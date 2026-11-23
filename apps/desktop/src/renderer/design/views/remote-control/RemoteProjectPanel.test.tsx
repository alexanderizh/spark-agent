// @vitest-environment jsdom

import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteProjectPanel } from './RemoteProjectPanel'
import type { RemoteProjectPanelTab } from './remoteProjectPanelState'

const mocks = vi.hoisted(() => ({
  onResize: vi.fn(),
  onSelectSession: vi.fn(),
  store: {
    version: 1,
    projects: [{ id: 'project-1', name: 'Project One', rootPath: '/workspace/project-one' }],
    sessions: {
      'project-1': {
        rows: [
          {
            id: 'session-1',
            title: 'Current session',
            preview: 'Current preview',
            status: 'idle',
            updatedAt: '2026-11-18T00:00:00.000Z',
          },
          {
            id: 'session-2',
            title: 'Other session',
            preview: 'Other preview',
            status: 'running',
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
        total: 2,
      },
    },
    allSessions: null,
  },
}))

vi.mock('./remoteSessionStore', () => ({
  getRemoteSessionStore: () => mocks.store,
  formatRelativeTime: () => '刚刚',
  sortSessionRows: (rows: unknown[]) => rows,
  subscribeRemoteSessionStore: () => () => undefined,
  UNASSIGNED_PROJECT_ID: 'default',
}))

vi.mock('./useRemoteProjectPanel', () => ({
  useRemoteProjectPanel: () => ({
    snapshot: {
      git: null,
      artifacts: {
        projectId: 'project-1',
        artifacts: [
          {
            path: '/workspace/project-one/current.png',
            sessionId: 'session-1',
            sessionTitle: 'Current session',
            presentedAt: '2026-11-18T00:00:00.000Z',
          },
          {
            path: '/workspace/project-one/other.ts',
            sessionId: 'session-2',
            sessionTitle: 'Other session',
            presentedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
      },
      fetchedAt: 1,
    },
    loading: false,
    refreshing: false,
    error: null,
    unsupported: false,
    refresh: vi.fn(),
    loadDiff: vi.fn().mockResolvedValue({ diff: '' }),
  }),
}))

vi.mock('./RemoteFileCards', () => ({
  RemoteFileCards: ({ files }: { files: Array<{ path: string }> }) => (
    <div data-testid="artifact-files">
      {files.map((file) => (
        <span key={file.path}>{file.path}</span>
      ))}
    </div>
  ),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function PanelHarness() {
  const [activeTab, setActiveTab] = useState<RemoteProjectPanelTab>('session')
  return (
    <RemoteProjectPanel
      deviceId="device-1"
      projectId="project-1"
      sessionId="session-1"
      sessionTitle="Current session"
      activeTab={activeTab}
      width={340}
      onResize={mocks.onResize}
      onTabChange={setActiveTab}
      onSelectSession={mocks.onSelectSession}
      onClose={() => undefined}
    />
  )
}

describe('RemoteProjectPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<PanelHarness />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function clickButton(label: string): void {
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(label),
    )
    if (button == null) throw new Error(`Missing button: ${label}`)
    act(() => button.click())
  }

  it('switches sessions from the session view', () => {
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('会话')
    clickButton('Other session')
    expect(mocks.onSelectSession).toHaveBeenCalledWith('session-2')
  })

  it('filters project artifacts by session, scope, and file type', () => {
    clickButton('产物')
    expect(container.querySelector('[data-testid="artifact-files"]')?.textContent).toContain(
      '/workspace/project-one/current.png',
    )
    expect(container.querySelector('[data-testid="artifact-files"]')?.textContent).not.toContain(
      '/workspace/project-one/other.ts',
    )

    clickButton('项目近期')
    expect(container.querySelector('[data-testid="artifact-files"]')?.textContent).toContain(
      '/workspace/project-one/other.ts',
    )

    const select = container.querySelector('select')
    if (select == null) throw new Error('Missing artifact type filter')
    act(() => {
      select.value = 'image'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="artifact-files"]')?.textContent).toContain(
      '/workspace/project-one/current.png',
    )
    expect(container.querySelector('[data-testid="artifact-files"]')?.textContent).not.toContain(
      '/workspace/project-one/other.ts',
    )
  })

  it('supports keyboard resizing with bounded width callbacks', () => {
    const separator = container.querySelector('[role="separator"]')
    if (separator == null) throw new Error('Missing panel resize separator')
    act(() => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(mocks.onResize).toHaveBeenCalledWith(356, true)
  })
})
