// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceInfo } from '@spark/protocol'
import type { SessionSummary } from './SessionSidebarContext'
import { ProjectSessionGroup, SidebarProjectToolbar } from './SidebarSessionList'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./SessionSidebarContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./SessionSidebarContext')>()),
  useSessionSidebar: () => ({ workspaces: [] }),
}))

vi.mock('./i18n', () => ({
  useI18n: () => ({
    lang: 'zh',
    t: (key: string) =>
      ({
        'sidebar.showLess': '收起',
        'sidebar.showMore': '显示更多',
        'sidebar.projectsToolbar.title': '项目',
        'sidebar.projectsToolbar.collapseAll': '折叠所有项目',
        'sidebar.projectsToolbar.expandAll': '展开所有项目',
        'sidebar.importHistory': '「从Claude、Codex」导入继续会话',
        'sidebar.addProject': '添加项目',
      })[key] ?? key,
  }),
}))

function createSessions(count: number): SessionSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}` as SessionId,
    title: `会话 ${index + 1}`,
    status: 'idle',
    updatedAt: '2026-07-29T08:00:00.000Z',
    workspaceIds: ['workspace-1'],
  })) as SessionSummary[]
}

describe('ProjectSessionGroup pagination', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.setItem('spark-settings-general', JSON.stringify({ language: 'zh-CN' }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
  })

  it('reveals ten more sessions per click and collapses after all sessions are visible', () => {
    const sessions = createSessions(38)
    const workspace: WorkspaceInfo = {
      archivedAt: null,
      createdAt: '2026-07-29T08:00:00.000Z',
      id: 'workspace-1',
      name: 'Spark-Agent',
      pinnedAt: null,
      rootPath: '/tmp/spark-agent',
      updatedAt: '2026-07-29T08:00:00.000Z',
      worktreeMeta: null,
    }

    act(() => {
      root.render(
        <ProjectSessionGroup
          group={{ workspace, sessions }}
          activeSessionId={null}
          activeWorkspaceId={workspace.id}
          sessionAgentStatuses={{}}
          sessionTerminalActivity={{}}
          unreviewedCompletedSessions={new Set()}
          open
          onOpenChange={() => undefined}
          onSelectWorkspace={async () => undefined}
          onSelectSession={() => undefined}
          onNewSession={() => undefined}
          onRenameProject={() => undefined}
          onToggleProjectPinned={() => undefined}
          onArchiveProject={() => undefined}
          onDeleteProject={() => undefined}
          onOpenProjectFolder={() => undefined}
          onRenameSession={() => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const visibleSessionCount = () => container.querySelectorAll('.proj-session').length
    const paginationButton = () => {
      const button = container.querySelector<HTMLButtonElement>('.proj-show-more-btn')
      if (button == null) throw new Error('Missing project session pagination button')
      return button
    }

    expect(visibleSessionCount()).toBe(8)
    expect(paginationButton().textContent).toBe('显示更多30')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(18)
    expect(paginationButton().textContent).toBe('显示更多20')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(28)
    expect(paginationButton().textContent).toBe('显示更多10')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(38)
    expect(paginationButton().textContent).toBe('收起')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(8)
    expect(paginationButton().textContent).toBe('显示更多30')
  })

  it('places archive before the more-actions button and archives without opening a menu', () => {
    const sessions = createSessions(1)
    const onArchiveSession = vi.fn()
    const workspace: WorkspaceInfo = {
      archivedAt: null,
      createdAt: '2026-07-29T08:00:00.000Z',
      id: 'workspace-1',
      name: 'Spark-Agent',
      pinnedAt: null,
      rootPath: '/tmp/spark-agent',
      updatedAt: '2026-07-29T08:00:00.000Z',
      worktreeMeta: null,
    }

    act(() => {
      root.render(
        <ProjectSessionGroup
          group={{ workspace, sessions }}
          activeSessionId={null}
          activeWorkspaceId={workspace.id}
          sessionAgentStatuses={{}}
          sessionTerminalActivity={{}}
          unreviewedCompletedSessions={new Set()}
          open
          onOpenChange={() => undefined}
          onSelectWorkspace={async () => undefined}
          onSelectSession={() => undefined}
          onNewSession={() => undefined}
          onRenameProject={() => undefined}
          onToggleProjectPinned={() => undefined}
          onArchiveProject={() => undefined}
          onDeleteProject={() => undefined}
          onOpenProjectFolder={() => undefined}
          onRenameSession={() => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={onArchiveSession}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const actions = container.querySelector('.session-item-actions')
    const archiveButton = actions?.querySelector<HTMLButtonElement>('.session-archive-btn')
    const moreButton = actions?.querySelector<HTMLButtonElement>('.item-menu-btn')

    if (archiveButton == null || moreButton == null) {
      throw new Error('Missing session row actions')
    }
    expect(archiveButton).not.toBeNull()
    expect(moreButton).not.toBeNull()
    expect(archiveButton.compareDocumentPosition(moreButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    act(() => archiveButton.click())

    expect(onArchiveSession).toHaveBeenCalledOnce()
    expect(onArchiveSession).toHaveBeenCalledWith(sessions[0])
    expect(document.querySelector('.action-menu')).toBeNull()
  })
})

describe('SidebarProjectToolbar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens history import from the first action with the requested title', () => {
    const onImportHistory = vi.fn()

    act(() => {
      root.render(
        <SidebarProjectToolbar
          allCollapsed={false}
          filterSlot={<button type="button">筛选</button>}
          onImportHistory={onImportHistory}
          onToggleAll={() => undefined}
          onAddProject={() => undefined}
        />,
      )
    })

    const actions = container.querySelector('.sidebar-project-toolbar-actions')
    const importButton = actions?.querySelector<HTMLButtonElement>(
      '[title="「从Claude、Codex」导入继续会话"]',
    )
    expect(importButton).not.toBeNull()
    expect(actions?.querySelector('button')).toBe(importButton)

    act(() => importButton?.click())

    expect(onImportHistory).toHaveBeenCalledOnce()
  })
})
