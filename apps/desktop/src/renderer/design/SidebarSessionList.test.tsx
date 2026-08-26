// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceInfo } from '@spark/protocol'
import type { SessionSummary } from './SessionSidebarContext'
import {
  applySessionFilters,
  FlatGroup,
  ProjectSessionGroup,
  SidebarProjectsEmptyState,
  SidebarProjectToolbar,
} from './SidebarSessionList'
import { DEFAULT_SIDEBAR_FILTER } from './SidebarFilterMenu'
import { filterCanvasWorkspaces } from './workspace-visibility'
import { readSessionReferenceDragPayload } from './views/chat/session-reference-dnd'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sidebarMock = vi.hoisted(() => ({
  openSessionSchedule: vi.fn(),
  sessionScheduleSummaries: {} as Record<string, { total: number; enabled: number }>,
}))
const { openSessionSchedule } = sidebarMock

vi.mock('./SessionSidebarContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./SessionSidebarContext')>()),
  useSessionSidebar: () => ({
    workspaces: [],
    openSessionSchedule,
    sessionScheduleSummaries: sidebarMock.sessionScheduleSummaries,
  }),
}))

vi.mock('./i18n', () => ({
  useI18n: () => ({
    lang: 'zh',
    t: (key: string) =>
      ({
        'sidebar.showLess': '收起',
        'sidebar.showMore': '显示更多',
        'sidebar.project.openInEditor': '打开项目',
        'sidebar.projectsToolbar.title': '项目',
        'sidebar.projectsToolbar.collapseAll': '折叠所有项目',
        'sidebar.projectsToolbar.expandAll': '展开所有项目',
        'sidebar.importHistory': '「从Claude、Codex」导入继续会话',
        'sidebar.addProject': '添加项目',
        'sidebar.empty.welcomeTitle': '从这里开始',
        'sidebar.empty.welcomeDesc': '选择一种方式，马上进入你的工作空间',
        'sidebar.empty.createProject': '新建项目',
        'sidebar.empty.createProjectDesc': '从本地文件夹开始',
        'sidebar.empty.startSession': '直接开始会话',
        'sidebar.empty.startingSession': '正在准备会话…',
        'sidebar.empty.startSessionDesc': '使用临时会话，不绑定项目',
        'sidebar.empty.dropFolder': '把文件夹拖到这里',
        'sidebar.empty.dropFolderDesc': '自动添加为项目',
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

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, value: string) => {
      values.set(format, value)
    },
    get types() {
      return Array.from(values.keys())
    },
  } as unknown as DataTransfer
}

describe('ProjectSessionGroup pagination', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sidebarMock.sessionScheduleSummaries = {}
    window.localStorage.setItem('spark-settings-general', JSON.stringify({ language: 'zh-CN' }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.localStorage.clear()
    vi.unstubAllGlobals()
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={onArchiveSession}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const actions = container.querySelector('.session-item-actions')
    const archiveButton = actions?.querySelector<HTMLButtonElement>('.session-archive-btn')
    const moreButton =
      actions?.querySelector<HTMLButtonElement>('.item-menu-wrap .item-menu-btn') ?? null

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

  it('uses the session row as a reference drag source when sorting is disabled', () => {
    const sessions = createSessions(1)
    const session = sessions[0]
    if (session == null) throw new Error('Missing session fixture')
    session.turnCount = 7
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const row = container.querySelector<HTMLElement>('.proj-session')
    if (row == null) throw new Error('Missing session reference drag source')
    expect(row.getAttribute('draggable')).toBe('true')

    const dataTransfer = createDataTransfer()
    const dragStart = new Event('dragstart', { bubbles: true })
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer })
    act(() => row.dispatchEvent(dragStart))

    expect(readSessionReferenceDragPayload(dataTransfer)).toMatchObject({
      sessionId: session.id,
      title: session.title,
      turnCount: 7,
    })
  })

  it('keeps native reference dragging disabled while session sorting is enabled', () => {
    const sessions = createSessions(1)
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
          sessionSortProjectId={workspace.id}
        />,
      )
    })

    const row = container.querySelector<HTMLElement>('.proj-session')
    if (row == null) throw new Error('Missing sortable session row')
    expect(row.getAttribute('draggable')).toBeNull()
  })

  it('copies the project path from the project actions menu', async () => {
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
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    act(() => {
      root.render(
        <ProjectSessionGroup
          group={{ workspace, sessions: [] }}
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const projectMenuButton = container.querySelector<HTMLButtonElement>(
      '.proj-head .item-menu-btn',
    )
    if (projectMenuButton == null) throw new Error('Missing project actions button')
    await act(async () => projectMenuButton.click())
    expect(document.querySelectorAll('.action-menu')).toHaveLength(1)

    const copyPathButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.action-menu-item'),
    ).find((button) => button.textContent?.includes('复制路径'))
    if (copyPathButton == null) throw new Error('Missing copy path menu item')
    await act(async () => {
      copyPathButton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(writeText).toHaveBeenCalledWith(workspace.rootPath)
  })

  it('opens project actions from the project row context menu', async () => {
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
          group={{ workspace, sessions: [] }}
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const projectHead = container.querySelector<HTMLElement>('.proj-head')
    if (projectHead == null) throw new Error('Missing project row')

    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 240,
    })
    await act(async () => {
      projectHead.dispatchEvent(contextMenuEvent)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(contextMenuEvent.defaultPrevented).toBe(true)
    expect(document.querySelectorAll('.action-menu')).toHaveLength(1)
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>('.action-menu-item')).some((button) =>
        button.textContent?.includes('复制路径'),
      ),
    ).toBe(true)
  })

  it('opens the project in the editor from the project actions menu', async () => {
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
    const onOpenProjectInEditor = vi.fn()

    act(() => {
      root.render(
        <ProjectSessionGroup
          group={{ workspace, sessions: [] }}
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
          onOpenProjectInEditor={onOpenProjectInEditor}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const projectMenuButton = container.querySelector<HTMLButtonElement>(
      '.proj-head .item-menu-btn',
    )
    if (projectMenuButton == null) throw new Error('Missing project actions button')
    await act(async () => projectMenuButton.click())
    expect(document.querySelectorAll('.action-menu')).toHaveLength(1)

    const openInEditorButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.action-menu-item'),
    ).find((button) => button.textContent?.trim() === '打开项目')
    if (openInEditorButton == null) throw new Error('Missing open-in-editor menu item')
    await act(async () => openInEditorButton.click())

    expect(onOpenProjectInEditor).toHaveBeenCalledWith(workspace)
  })

  it('opens session schedules from the session actions menu', async () => {
    const sessions = createSessions(1)
    const onSelectSession = vi.fn()
    const onAddToConversation = vi.fn()
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
          onSelectSession={onSelectSession}
          onNewSession={() => undefined}
          onRenameProject={() => undefined}
          onToggleProjectPinned={() => undefined}
          onArchiveProject={() => undefined}
          onDeleteProject={() => undefined}
          onOpenProjectFolder={() => undefined}
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
          onAddToConversation={onAddToConversation}
        />,
      )
    })

    const moreButton = container.querySelector<HTMLButtonElement>(
      '.session-item-actions .item-menu-wrap .item-menu-btn',
    )
    if (moreButton == null) throw new Error('Missing session actions button')
    await act(async () => moreButton.click())

    const copySessionButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.action-menu-item'),
    ).find((button) => button.textContent?.includes('复制会话'))
    expect(copySessionButton).not.toBeUndefined()

    const addToConversationButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.action-menu-item'),
    ).find((button) => button.textContent?.includes('添加到对话'))
    if (addToConversationButton == null) throw new Error('Missing add to conversation menu item')
    await act(async () => {
      addToConversationButton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onAddToConversation).toHaveBeenCalledWith(sessions[0])

    await act(async () => moreButton.click())
    const scheduleButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.action-menu-item'),
    ).find((button) => button.textContent?.includes('计划任务'))
    if (scheduleButton == null) throw new Error('Missing session schedule menu item')
    await act(async () => {
      scheduleButton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onSelectSession).toHaveBeenCalledWith(sessions[0])
    expect(openSessionSchedule).toHaveBeenCalledWith(sessions[0]!.id)
  })

  it('shows Lobe clock indicators for enabled and paused session tasks', () => {
    const sessions = createSessions(2)
    sidebarMock.sessionScheduleSummaries = {
      'session-0': { total: 2, enabled: 1 },
      'session-1': { total: 1, enabled: 0 },
    }
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
          onOpenProjectInEditor={() => undefined}
          onRenameSession={() => undefined}
          onCommitSessionTitle={async () => undefined}
          onToggleSessionPinned={() => undefined}
          onArchiveSession={() => undefined}
          onDeleteSession={() => undefined}
        />,
      )
    })

    const indicators = container.querySelectorAll('.session-schedule-indicator')
    expect(indicators).toHaveLength(2)
    expect(indicators[0]?.classList.contains('is-enabled')).toBe(true)
    expect(indicators[1]?.classList.contains('is-paused')).toBe(true)
    expect(indicators[0]?.querySelector('.anticon')).not.toBeNull()
  })
})

describe('scheduled-task session filtering', () => {
  it('includes paused tasks in the attached filter and supports unattached sessions', () => {
    const sessions = createSessions(3)
    const summaries = {
      'session-0': { total: 1, enabled: 1 },
      'session-1': { total: 2, enabled: 0 },
    }

    expect(
      applySessionFilters(
        sessions,
        { ...DEFAULT_SIDEBAR_FILTER, scheduledTasks: 'attached' },
        summaries,
      ).map((session) => session.id),
    ).toEqual(['session-0', 'session-1'])
    expect(
      applySessionFilters(
        sessions,
        { ...DEFAULT_SIDEBAR_FILTER, scheduledTasks: 'none' },
        summaries,
      ).map((session) => session.id),
    ).toEqual(['session-2'])
  })
})

describe('canvas-project session filtering', () => {
  it('hides canvas sessions while preserving ordinary sessions', () => {
    const workspaces: WorkspaceInfo[] = [
      {
        id: 'workspace-1',
        name: '普通项目',
        rootPath: '/tmp/workspace-1',
        canvasProjectId: null,
        pinnedAt: null,
        archivedAt: null,
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-29T08:00:00.000Z',
        worktreeMeta: null,
      },
      {
        id: 'canvas-workspace',
        name: '画布项目',
        rootPath: '/tmp/canvas-workspace',
        canvasProjectId: 'canvas-project',
        pinnedAt: null,
        archivedAt: null,
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-29T08:00:00.000Z',
        worktreeMeta: null,
      },
      {
        id: 'canvas-worktree',
        name: '画布项目 Worktree',
        rootPath: '/tmp/canvas-worktree',
        canvasProjectId: null,
        pinnedAt: null,
        archivedAt: null,
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-29T08:00:00.000Z',
        worktreeMeta: {
          baseRepoRoot: '/tmp/canvas-workspace',
          branch: 'feature/canvas',
          baseBranch: 'main',
          baseWorkspaceId: 'canvas-workspace',
        },
      },
    ]
    const baseSession = createSessions(1)[0]
    if (baseSession === undefined) throw new Error('Expected a base session fixture')
    const sessions: SessionSummary[] = [
      baseSession,
      {
        ...baseSession,
        id: 'canvas-session' as SessionId,
        workspaceIds: ['canvas-workspace'],
      },
      {
        ...baseSession,
        id: 'canvas-worktree-session' as SessionId,
        workspaceIds: ['canvas-worktree'],
      },
    ]

    expect(
      applySessionFilters(
        sessions,
        { ...DEFAULT_SIDEBAR_FILTER, canvasProjects: 'hide' },
        {},
        workspaces,
      ).map((session) => session.id),
    ).toEqual(['session-0'])
    expect(filterCanvasWorkspaces(workspaces, false).map(({ id }) => id)).toEqual(['workspace-1'])
  })
})

describe('FlatGroup temporary session pagination', () => {
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

  it('uses the same incremental pagination and collapse behavior for temporary sessions', () => {
    const sessions = createSessions(29)

    act(() => {
      root.render(
        <FlatGroup
          groupId="project:no-project"
          label="sidebar.noProjectChats"
          sessions={sessions}
          activeSessionId={null}
          activeWorkspaceId={null}
          sessionAgentStatuses={{}}
          sessionTerminalActivity={{}}
          unreviewedCompletedSessions={new Set()}
          open
          onOpenChange={() => undefined}
          actions={{
            onSelectSession: () => undefined,
            onRenameSession: async () => undefined,
            onCommitSessionTitle: async () => undefined,
            onToggleSessionPinned: async () => undefined,
            onArchiveSession: async () => undefined,
            onDeleteSession: async () => undefined,
          }}
        />,
      )
    })

    const visibleSessionCount = () => container.querySelectorAll('.proj-session').length
    const paginationButton = () => {
      const button = container.querySelector<HTMLButtonElement>('.proj-show-more-btn')
      if (button == null) throw new Error('Missing temporary session pagination button')
      return button
    }

    expect(visibleSessionCount()).toBe(8)
    expect(paginationButton().textContent).toBe('显示更多21')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(18)
    expect(paginationButton().textContent).toBe('显示更多11')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(28)
    expect(paginationButton().textContent).toBe('显示更多1')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(29)
    expect(paginationButton().textContent).toBe('收起')

    act(() => paginationButton().click())
    expect(visibleSessionCount()).toBe(8)
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
      '[aria-label="「从Claude、Codex」导入继续会话"]',
    )
    expect(importButton).not.toBeNull()
    expect(actions?.querySelector('button')).toBe(importButton)

    act(() => importButton?.click())

    expect(onImportHistory).toHaveBeenCalledOnce()
  })
})

describe('SidebarProjectsEmptyState', () => {
  it('exposes project, temporary session, and folder drop entry points', () => {
    const onCreateProject = vi.fn()
    const onStartSession = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <SidebarProjectsEmptyState
          isStartingSession={false}
          onCreateProject={onCreateProject}
          onStartSession={onStartSession}
        />,
      )
    })

    expect(container.textContent).toContain('从这里开始')
    expect(container.textContent).toContain('把文件夹拖到这里')
    const actions = container.querySelectorAll<HTMLButtonElement>('.empty-action-card')
    expect(actions).toHaveLength(2)

    act(() => actions[0]?.click())
    act(() => actions[1]?.click())

    expect(onCreateProject).toHaveBeenCalledOnce()
    expect(onStartSession).toHaveBeenCalledOnce()

    act(() => root.unmount())
    container.remove()
  })

  it('shows a loading state while the temporary session is being created', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <SidebarProjectsEmptyState
          isStartingSession
          onCreateProject={() => undefined}
          onStartSession={() => undefined}
        />,
      )
    })

    const sessionAction = container.querySelector<HTMLButtonElement>(
      '.empty-action-card:nth-child(2)',
    )
    expect(sessionAction?.disabled).toBe(true)
    expect(sessionAction?.getAttribute('aria-busy')).toBe('true')
    expect(container.textContent).toContain('正在准备会话…')

    act(() => root.unmount())
    container.remove()
  })
})
