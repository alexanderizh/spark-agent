/**
 * SidebarSessionList — Complete conversation list extracted from ChatView.
 * Renders search, time filter, project groups, session items, and all context menus.
 */
import React, { useRef, useState, useCallback, useMemo, useEffect, useLayoutEffect } from 'react'
import './SidebarSessionList.less'
import type { ReactNode } from 'react'
import { ActionIcon, Button, Dropdown, Input, Modal } from '@lobehub/ui'
import { Icons } from './Icons'
import {
  useSessionSidebar,
  buildProjectGroups,
  sortSessionsByPinned,
  type SessionSummary,
  type ProjectGroup,
} from './SessionSidebarContext'
import type {
  SessionId,
  WorkspaceInfo,
  AgentStatusValue,
  SessionSearchResult,
  TerminalSessionActivity,
} from '@spark/protocol'
import { useApp } from './AppContext'
import { useI18n } from './i18n'
import {
  SidebarFilterMenu,
  DEFAULT_SIDEBAR_FILTER,
  type SidebarFilterState,
  type SidebarStatusFilter,
  type SidebarLastActivityFilter,
} from './SidebarFilterMenu'
import { isModalOverlayVisible, useSessionDeleteShortcut } from './hooks/useAppDialogKeyboard'
import {
  resolveSidebarActiveWorkspaceId,
  resolveSpecialSidebarGroupWorkspaceId,
} from './sidebar-session-routing'

/* ─── Project collapsed state persistence ─── */
const PROJECT_COLLAPSED_KEY = 'spark-agent:project-collapsed'

function getCollapsedProjects(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PROJECT_COLLAPSED_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function setProjectCollapsed(workspaceId: string, collapsed: boolean): void {
  const set = getCollapsedProjects()
  if (collapsed) set.add(workspaceId)
  else set.delete(workspaceId)
  try {
    window.localStorage.setItem(PROJECT_COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* */
  }
}

function setProjectCollapsedMany(workspaceIds: string[], collapsed: boolean): void {
  const set = getCollapsedProjects()
  for (const workspaceId of workspaceIds) {
    if (collapsed) set.add(workspaceId)
    else set.delete(workspaceId)
  }
  try {
    window.localStorage.setItem(PROJECT_COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* */
  }
}

/* ─── Flat group (date/state/none/no-project) collapsed state persistence ─── */
const FLAT_GROUP_COLLAPSED_KEY = 'spark-agent:flat-group-collapsed'

function getCollapsedFlatGroups(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FLAT_GROUP_COLLAPSED_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function setFlatGroupCollapsed(groupId: string, collapsed: boolean): void {
  const set = getCollapsedFlatGroups()
  if (collapsed) set.add(groupId)
  else set.delete(groupId)
  try {
    window.localStorage.setItem(FLAT_GROUP_COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* */
  }
}

function setFlatGroupCollapsedMany(groupIds: string[], collapsed: boolean): void {
  const set = getCollapsedFlatGroups()
  for (const groupId of groupIds) {
    if (collapsed) set.add(groupId)
    else set.delete(groupId)
  }
  try {
    window.localStorage.setItem(FLAT_GROUP_COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* */
  }
}

/* ─── Sidebar filter persistence ─── */
const SIDEBAR_FILTER_KEY = 'spark-agent:sidebar-filter'

function readSidebarFilter(): SidebarFilterState {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_FILTER_KEY)
    if (!raw) return { ...DEFAULT_SIDEBAR_FILTER }
    const parsed = JSON.parse(raw) as Partial<SidebarFilterState>
    return {
      status: parsed.status ?? DEFAULT_SIDEBAR_FILTER.status,
      projectId: parsed.projectId ?? DEFAULT_SIDEBAR_FILTER.projectId,
      lastActivity: parsed.lastActivity ?? DEFAULT_SIDEBAR_FILTER.lastActivity,
      groupBy: parsed.groupBy ?? DEFAULT_SIDEBAR_FILTER.groupBy,
    }
  } catch {
    return { ...DEFAULT_SIDEBAR_FILTER }
  }
}

function writeSidebarFilter(state: SidebarFilterState): void {
  try {
    window.localStorage.setItem(SIDEBAR_FILTER_KEY, JSON.stringify(state))
  } catch {
    /* */
  }
}

/* ─── Filter helpers ─── */
function filterByStatus(sessions: SessionSummary[], status: SidebarStatusFilter): SessionSummary[] {
  if (status === 'all') return sessions
  if (status === 'archived') return sessions.filter((s) => s.archivedAt != null)
  return sessions.filter((s) => s.archivedAt == null)
}

function filterByLastActivity(
  sessions: SessionSummary[],
  range: SidebarLastActivityFilter,
): SessionSummary[] {
  if (range === 'all') return sessions
  const days = Number.parseInt(range, 10)
  if (!Number.isFinite(days)) return sessions
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sessions.filter((session) => {
    const updatedAt = new Date(session.updatedAt).getTime()
    return Number.isFinite(updatedAt) && updatedAt >= cutoff
  })
}

function filterByProject(sessions: SessionSummary[], projectId: string): SessionSummary[] {
  if (projectId === 'all') return sessions
  return sessions.filter((s) => s.workspaceIds.includes(projectId))
}

function applySessionFilters(
  sessions: SessionSummary[],
  filter: SidebarFilterState,
): SessionSummary[] {
  return filterByLastActivity(
    filterByProject(filterByStatus(sessions, filter.status), filter.projectId),
    filter.lastActivity,
  )
}

/* ─── Group by helpers ─── */
type DisplayGroup = {
  id: string
  label: string
  sessions: SessionSummary[]
  workspace?: WorkspaceInfo
}

const DATE_GROUP_ORDER = [
  'sidebar.group.today',
  'sidebar.group.yesterday',
  'sidebar.group.thisWeek',
  'sidebar.group.thisMonth',
  'sidebar.group.older',
] as const

function getDateGroupLabel(updatedAt: string): string {
  const then = new Date(updatedAt).getTime()
  if (!Number.isFinite(then)) return 'sidebar.group.older'
  const now = Date.now()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  if (then >= todayMs) return 'sidebar.group.today'
  if (then >= todayMs - dayMs) return 'sidebar.group.yesterday'
  if (then >= now - 7 * dayMs) return 'sidebar.group.thisWeek'
  if (then >= now - 30 * dayMs) return 'sidebar.group.thisMonth'
  return 'sidebar.group.older'
}

const STATE_GROUP_ORDER = [
  'sidebar.status.running',
  'sidebar.status.waitingPermission',
  'sidebar.status.waitingUser',
  'sidebar.status.error',
  'sidebar.status.completed',
  'sidebar.status.cancelled',
  'sidebar.status.idle',
] as const

function getStateGroupLabel(sessionStatus: string, agentStatus?: AgentStatusValue): string {
  const display = getSessionDisplayStatus(sessionStatus, agentStatus)
  switch (display) {
    case 'running':
      return 'sidebar.status.running'
    case 'waiting_permission':
      return 'sidebar.status.waitingPermission'
    case 'waiting_user':
      return 'sidebar.status.waitingUser'
    case 'completed':
      return 'sidebar.status.completed'
    case 'error':
      return 'sidebar.status.error'
    case 'cancelled':
      return 'sidebar.status.cancelled'
    default:
      return 'sidebar.status.idle'
  }
}

function buildGroupsByDate(sessions: SessionSummary[]): DisplayGroup[] {
  const buckets = new Map<string, SessionSummary[]>()
  for (const label of DATE_GROUP_ORDER) buckets.set(label, [])
  for (const s of sessions) {
    const label = getDateGroupLabel(s.updatedAt)
    const bucket = buckets.get(label)
    if (bucket != null) bucket.push(s)
    else buckets.set(label, [s])
  }
  return DATE_GROUP_ORDER.flatMap((label) => {
    const bucket = buckets.get(label)
    if (bucket == null || bucket.length === 0) return []
    return [{ id: `date:${label}`, label, sessions: bucket }]
  })
}

function buildGroupsByState(
  sessions: SessionSummary[],
  agentStatuses: Record<string, AgentStatusValue>,
): DisplayGroup[] {
  const buckets = new Map<string, SessionSummary[]>()
  for (const label of STATE_GROUP_ORDER) buckets.set(label, [])
  for (const s of sessions) {
    const label = getStateGroupLabel(s.status, agentStatuses[s.id])
    const bucket = buckets.get(label)
    if (bucket != null) bucket.push(s)
    else buckets.set(label, [s])
  }
  return STATE_GROUP_ORDER.flatMap((label) => {
    const bucket = buckets.get(label)
    if (bucket == null || bucket.length === 0) return []
    return [{ id: `state:${label}`, label, sessions: bucket }]
  })
}

/* ─── Helper ─── */
function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime()
  const now = Date.now()
  if (!Number.isFinite(then)) return ''
  const diffMs = Math.max(0, now - then)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (diffMs < minute) return 'time.justNow'
  if (diffMs < hour) return `time.minutes:${Math.floor(diffMs / minute)}`
  if (diffMs < day) return `time.hours:${Math.floor(diffMs / hour)}`
  if (diffMs < week) return `time.days:${Math.floor(diffMs / day)}`
  return `time.weeks:${Math.floor(diffMs / week)}`
}

function getSessionDisplayStatus(
  sessionStatus: string,
  agentStatus?: AgentStatusValue,
):
  | 'running'
  | 'waiting_permission'
  | 'waiting_user'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'idle' {
  if (agentStatus) {
    switch (agentStatus) {
      case 'thinking':
      case 'calling_tool':
        return 'running'
      case 'waiting_permission':
        return 'waiting_permission'
      case 'waiting_user':
        return 'waiting_user'
      case 'completed':
        return 'completed'
      case 'error':
        return 'error'
      case 'cancelled':
        return 'cancelled'
      case 'idle':
        return 'idle'
    }
  }
  if (sessionStatus === 'running') return 'running'
  return 'idle'
}

function getStatusBadgeInfo(
  status:
    | 'running'
    | 'waiting_permission'
    | 'waiting_user'
    | 'completed'
    | 'error'
    | 'cancelled'
    | 'idle',
): {
  className: string
  icon: React.ReactNode
  title: string
  animate?: boolean
} {
  switch (status) {
    case 'running':
      return {
        className: 'session-badge-running session-running-badge',
        icon: <Icons.Spinner size={10} className="session-running-spinner" />,
        title: 'sidebar.status.running',
        animate: true,
      }
    case 'waiting_permission':
      return {
        className: 'session-badge-waiting-permission',
        icon: <Icons.Shield size={10} />,
        title: 'sidebar.status.waitingPermissionReview',
        animate: true,
      }
    case 'waiting_user':
      return {
        className: 'session-badge-waiting-user',
        icon: <Icons.Spinner size={10} />,
        title: 'sidebar.status.waitingUser',
        animate: true,
      }
    case 'completed':
      return {
        className: 'session-badge-completed',
        icon: <Icons.Check size={10} />,
        title: 'sidebar.status.completed',
      }
    case 'error':
      return {
        className: 'session-badge-error',
        icon: <Icons.X size={10} />,
        title: 'sidebar.status.failed',
      }
    case 'cancelled':
      return {
        className: 'session-badge-cancelled',
        icon: <Icons.Stop size={10} />,
        title: 'sidebar.status.cancelled',
      }
    default:
      return {
        className: '',
        icon: null,
        title: '',
      }
  }
}

/* ─── ActionMenu ─── */
function ActionMenu({
  items,
  onAction,
}: {
  items: Array<{ icon: ReactNode; label: string; danger?: boolean; onClick: () => void }>
  onAction?: () => void
}) {
  const actionQueuedRef = useRef(false)
  const runAction = (item: { onClick: () => void }) => {
    if (actionQueuedRef.current) return
    actionQueuedRef.current = true
    onAction?.()
    window.setTimeout(() => {
      actionQueuedRef.current = false
      item.onClick()
    }, 0)
  }

  return (
    <div
      className="action-menu"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          className={`action-menu-item${item.danger ? ' danger' : ''}`}
          onPointerDown={(e) => {
            e.stopPropagation()
            runAction(item)
          }}
          onClick={(e) => {
            e.stopPropagation()
            runAction(item)
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

// 注:ActionMenu 在 antd Dropdown 下通过 popupRender 注入 JSX 内容

/* ─── ChatListItem ─── */
function ChatListItem({
  session: s,
  active,
  agentStatus,
  terminalActivity,
  unreviewed,
  smallTitle,
  onClick,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  session: SessionSummary
  active: SessionId | null
  agentStatus?: AgentStatusValue | undefined
  terminalActivity?: TerminalSessionActivity | undefined
  unreviewed?: boolean
  smallTitle?: boolean
  onClick: (id: SessionId) => void
  onRename?: (session: SessionSummary) => void
  onTogglePinned?: (session: SessionSummary) => void
  onArchive?: (session: SessionSummary) => void
  onDelete?: (session: SessionSummary) => void
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const { workspaces } = useSessionSidebar()
  // 该会话若运行在隔离 worktree 中，取其分支名用于显示分支图标指示符
  const worktreeBranch = useMemo(() => {
    const wsId = s.workspaceIds[0]
    if (wsId == null) return undefined
    return workspaces.find((w) => w.id === wsId)?.worktreeMeta?.branch
  }, [s.workspaceIds, workspaces])
  const displayStatus = useMemo(
    () => getSessionDisplayStatus(s.status, agentStatus),
    [s.status, agentStatus],
  )
  const badgeInfo = useMemo(() => getStatusBadgeInfo(displayStatus), [displayStatus])
  const formatSidebarTime = (value: string) => {
    const formatted = formatRelativeTime(value)
    const [key, count] = formatted.split(':')
    return t(key ?? '', count != null ? { count } : undefined)
  }

  const statusClass = displayStatus !== 'idle' ? `is-${displayStatus}` : ''
  const terminalRunningCount = terminalActivity?.running ?? 0

  return (
    <div
      className={`chat-item proj-session chat-item-compact ${active === s.id ? 'active' : ''} ${contextOpen ? 'is-context-open' : ''} ${statusClass}`}
      onClick={() => onClick(s.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setContextOpen(true)
        setMenuOpen(true)
      }}
    >
      <div className="chat-item-row">
        <div className={`chat-item-title-compact${smallTitle ? ' session-title-small' : ''}`}>
          {(() => {
            const dotStatus =
              displayStatus === 'waiting_permission' || displayStatus === 'waiting_user'
                ? displayStatus
                : displayStatus === 'error'
                  ? 'error'
                  : unreviewed
                    ? 'completed'
                    : null
            return dotStatus ? (
              <span
                className={`session-status-dot session-status-dot-${dotStatus}`}
                title={
                  dotStatus === 'completed' ? t('sidebar.status.newCompleted') : t(badgeInfo.title)
                }
                aria-hidden
              >
                {dotStatus === 'error' && <Icons.AlertTriangle size={12} />}
              </span>
            ) : null
          })()}
          {s.pinnedAt != null && <Icons.Pin size={11} className="pinned-icon" />}
          {worktreeBranch != null && (
            <span
              className="worktree-branch-icon"
              title={t('sidebar.worktreeBranchWithName', { branch: worktreeBranch })}
              aria-label={t('sidebar.worktreeBranch')}
            >
              <Icons.GitBranch size={11} />
            </span>
          )}
          <span className="truncate">{s.title || t('sidebar.newSession')}</span>
        </div>
        {terminalRunningCount > 0 && (
          <span
            className="session-terminal-indicator"
            title={`终端运行中 (${terminalRunningCount})`}
            aria-label="终端运行中"
          >
            <Icons.Terminal size={12} strokeWidth={1.7} />
            {terminalRunningCount > 1 && (
              <span className="session-terminal-count">{terminalRunningCount}</span>
            )}
          </span>
        )}
        {displayStatus !== 'idle' && badgeInfo.icon ? (
          <span
            className={`session-status-badge ${badgeInfo.className}`}
            title={t(badgeInfo.title)}
          >
            {badgeInfo.icon}
            <span className="session-status-label">{t(badgeInfo.title)}</span>
          </span>
        ) : (
          <span className="chat-item-time-compact">{formatSidebarTime(s.updatedAt)}</span>
        )}
        <div className={`item-menu-wrap${menuOpen ? ' menu-open' : ''}`}>
          <Dropdown
            menu={{ items: [] }}
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open)
              if (!open) setContextOpen(false)
            }}
            trigger={['click']}
            placement="topRight"
            align={{ overflow: { shiftX: true, adjustY: true } }}
            popupRender={() => (
              <ActionMenu
                onAction={() => setMenuOpen(false)}
                items={[
                  {
                    icon: <Icons.Pin size={14} />,
                    label:
                      s.pinnedAt == null ? t('sidebar.session.pin') : t('sidebar.session.unpin'),
                    onClick: () => onTogglePinned?.(s),
                  },
                  {
                    icon: <Icons.Edit size={14} />,
                    label: t('sidebar.session.rename'),
                    onClick: () => onRename?.(s),
                  },
                  {
                    icon: <Icons.Box size={14} />,
                    label: t('sidebar.session.archive'),
                    onClick: () => onArchive?.(s),
                  },
                  {
                    icon: <Icons.Trash size={14} />,
                    label: t('sidebar.session.delete'),
                    danger: true,
                    onClick: () => onDelete?.(s),
                  },
                ]}
              />
            )}
          >
            <button
              className="icon-btn item-menu-btn"
              title={t('sidebar.session.actions')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Icons.More size={15} />
            </button>
          </Dropdown>
        </div>
      </div>
    </div>
  )
}

/* ─── ProjectSessionGroup ─── */
function ProjectSessionGroup({
  group,
  activeSessionId,
  activeWorkspaceId,
  sessionAgentStatuses,
  sessionTerminalActivity,
  unreviewedCompletedSessions,
  open,
  onOpenChange,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
  onRenameProject,
  onToggleProjectPinned,
  onArchiveProject,
  onDeleteProject,
  onOpenProjectFolder,
  onRenameSession,
  onToggleSessionPinned,
  onArchiveSession,
  onDeleteSession,
}: {
  group: ProjectGroup
  activeSessionId: SessionId | null
  activeWorkspaceId: string | null
  sessionAgentStatuses: Record<string, AgentStatusValue>
  sessionTerminalActivity: Record<string, TerminalSessionActivity>
  unreviewedCompletedSessions: Set<string>
  open: boolean
  onOpenChange: (next: boolean) => void
  onSelectWorkspace: (workspace: WorkspaceInfo) => Promise<void>
  onSelectSession: (session: SessionSummary) => void
  onNewSession: (workspaceId: string) => void
  onRenameProject: (workspace: WorkspaceInfo) => void
  onToggleProjectPinned: (workspace: WorkspaceInfo) => void
  onArchiveProject: (workspace: WorkspaceInfo) => void
  onDeleteProject: (workspace: WorkspaceInfo) => void
  onOpenProjectFolder: (workspace: WorkspaceInfo) => void
  onRenameSession: (session: SessionSummary) => void
  onToggleSessionPinned: (session: SessionSummary) => void
  onArchiveSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showAllSessions, setShowAllSessions] = useState(false)
  const isActiveProject = activeWorkspaceId === group.workspace.id

  const MAX_VISIBLE = 8
  const sessions = group.sessions
  const hasMore = sessions.length > MAX_VISIBLE
  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, MAX_VISIBLE)

  return (
    <div className={`proj-group ${isActiveProject ? 'active-project' : ''}`}>
      <div
        className="proj-head"
        onClick={() => {
          onOpenChange(!open)
          void onSelectWorkspace(group.workspace)
        }}
      >
        <span
          className="proj-toggle"
          onClick={(e) => {
            e.stopPropagation()
            onOpenChange(!open)
          }}
          role="button"
          aria-label={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
          title={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
        >
          {open ? (
            <Icons.FolderOpen className="chev" size={15} />
          ) : (
            <Icons.FolderClosed className="chev" size={15} />
          )}
        </span>
        {group.workspace.pinnedAt != null && <Icons.Pin size={15} className="pinned-icon" />}
        <span className="proj-name">{group.workspace.name}</span>
        <span className="proj-count">{group.sessions.length}</span>
        <button
          className="icon-btn proj-add-session-btn"
          title={t('sidebar.project.newSession')}
          onClick={(e) => {
            e.stopPropagation()
            onNewSession(group.workspace.id)
          }}
        >
          <Icons.Plus size={15} />
        </button>
        <div className={`item-menu-wrap${menuOpen ? ' menu-open' : ''}`}>
          <Dropdown
            menu={{ items: [] }}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={['click']}
            placement="topRight"
            align={{ overflow: { shiftX: true, adjustY: true } }}
            popupRender={() => (
              <ActionMenu
                onAction={() => setMenuOpen(false)}
                items={[
                  {
                    icon: <Icons.Pin size={14} />,
                    label:
                      group.workspace.pinnedAt == null
                        ? t('sidebar.project.pin')
                        : t('sidebar.project.unpin'),
                    onClick: () => onToggleProjectPinned(group.workspace),
                  },
                  {
                    icon: <Icons.Folder size={14} />,
                    label: t('sidebar.project.openFolder'),
                    onClick: () => onOpenProjectFolder(group.workspace),
                  },
                  {
                    icon: <Icons.Edit size={14} />,
                    label: t('sidebar.project.rename'),
                    onClick: () => onRenameProject(group.workspace),
                  },
                  {
                    icon: <Icons.Box size={14} />,
                    label: t('sidebar.project.archive'),
                    onClick: () => onArchiveProject(group.workspace),
                  },
                  {
                    icon: <Icons.Trash size={14} />,
                    label: t('sidebar.project.delete'),
                    danger: true,
                    onClick: () => onDeleteProject(group.workspace),
                  },
                ]}
              />
            )}
          >
            <button
              className="icon-btn item-menu-btn"
              title={t('sidebar.project.actions')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Icons.More size={15} />
            </button>
          </Dropdown>
        </div>
      </div>
      {open && (
        <div className="proj-sessions">
          {sessions.length === 0 ? (
            <button className="proj-session-empty" onClick={() => onNewSession(group.workspace.id)}>
              <Icons.Plus size={15} />
              {t('sidebar.project.newSession')}
            </button>
          ) : (
            <>
              {visibleSessions.map((session) => (
                <ChatListItem
                  key={session.id}
                  session={session}
                  active={activeSessionId}
                  agentStatus={sessionAgentStatuses[session.id]}
                  terminalActivity={sessionTerminalActivity[session.id]}
                  unreviewed={unreviewedCompletedSessions.has(session.id)}
                  onClick={() => onSelectSession(session)}
                  onRename={onRenameSession}
                  onTogglePinned={onToggleSessionPinned}
                  onArchive={onArchiveSession}
                  onDelete={onDeleteSession}
                />
              ))}
              {hasMore && (
                <button
                  className="proj-show-more-btn"
                  onClick={() => setShowAllSessions((prev) => !prev)}
                >
                  {showAllSessions ? (
                    <span className="proj-show-more-label">{t('sidebar.showLess')}</span>
                  ) : (
                    <>
                      <span className="proj-show-more-label">{t('sidebar.showMore')}</span>
                      <span className="proj-show-more-count">{sessions.length - MAX_VISIBLE}</span>
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── FlatGroup — date / state / none 分组用的轻量分组 ─── */
type FlatGroupActions = {
  onSelectSession: (session: SessionSummary) => void
  onRenameSession: (session: SessionSummary) => Promise<void>
  onToggleSessionPinned: (session: SessionSummary) => Promise<void>
  onArchiveSession: (session: SessionSummary) => Promise<void>
  onDeleteSession: (session: SessionSummary) => Promise<void>
}

function FlatGroup({
  groupId,
  label,
  sessions,
  activeSessionId,
  activeWorkspaceId,
  groupWorkspaceId,
  sessionAgentStatuses,
  sessionTerminalActivity,
  unreviewedCompletedSessions,
  onSelectGroup,
  onNewSession,
  menuItems = [],
  open,
  onOpenChange,
  actions,
}: {
  groupId: string
  label: string
  sessions: SessionSummary[]
  activeSessionId: SessionId | null
  activeWorkspaceId: string | null
  groupWorkspaceId?: string | null | undefined
  sessionAgentStatuses: Record<string, AgentStatusValue>
  sessionTerminalActivity: Record<string, TerminalSessionActivity>
  unreviewedCompletedSessions: Set<string>
  onSelectGroup?: (() => void) | undefined
  onNewSession?: (() => void | Promise<void>) | undefined
  open: boolean
  onOpenChange: (next: boolean) => void
  menuItems?: Array<{
    icon: ReactNode
    label: string
    danger?: boolean
    onClick: () => void
  }>
  actions: FlatGroupActions
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const smallTitle = groupId === 'project:no-project' || groupId === 'project:ungrouped'
  const isActiveProject = groupWorkspaceId != null && activeWorkspaceId === groupWorkspaceId

  if (sessions.length === 0) return null
  return (
    <div className={`proj-group flat-group${isActiveProject ? ' active-project' : ''}`}>
      <div
        className="proj-head flat-group-head"
        onClick={() => {
          onOpenChange(!open)
          onSelectGroup?.()
        }}
      >
        <span
          className="proj-toggle"
          onClick={(e) => {
            e.stopPropagation()
            onOpenChange(!open)
          }}
          role="button"
          aria-label={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
          title={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
        >
          {open ? (
            <Icons.FolderOpen className="chev" size={15} />
          ) : (
            <Icons.FolderClosed className="chev" size={15} />
          )}
        </span>
        <span className="proj-name">{t(label)}</span>
        <span className="proj-count">{sessions.length}</span>
        {onNewSession != null && (
          <button
            className="icon-btn proj-add-session-btn"
            title={
              groupId === 'project:no-project' ? '新建临时会话' : t('sidebar.project.newSession')
            }
            onClick={(e) => {
              e.stopPropagation()
              void onNewSession()
            }}
          >
            <Icons.Plus size={15} />
          </button>
        )}
        {menuItems.length > 0 && (
          <div className={`item-menu-wrap${menuOpen ? ' menu-open' : ''}`}>
            <Dropdown
              menu={{ items: [] }}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={['click']}
              placement="topRight"
              align={{ overflow: { shiftX: true, adjustY: true } }}
              popupRender={() => (
                <ActionMenu onAction={() => setMenuOpen(false)} items={menuItems} />
              )}
            >
              <button
                className="icon-btn item-menu-btn"
                title={
                  groupId === 'project:no-project' ? '临时会话操作' : t('sidebar.project.actions')
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <Icons.More size={15} />
              </button>
            </Dropdown>
          </div>
        )}
      </div>
      {open && (
        <div className="proj-sessions">
          {sessions.map((session) => (
            <ChatListItem
              key={session.id}
              session={session}
              active={activeSessionId}
              agentStatus={sessionAgentStatuses[session.id]}
              terminalActivity={sessionTerminalActivity[session.id]}
              unreviewed={unreviewedCompletedSessions.has(session.id)}
              smallTitle={smallTitle}
              onClick={() => actions.onSelectSession(session)}
              onRename={actions.onRenameSession}
              onTogglePinned={actions.onToggleSessionPinned}
              onArchive={actions.onArchiveSession}
              onDelete={actions.onDeleteSession}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── CreateProjectModal ─── */
function CreateProjectModal({
  name,
  path,
  notice,
  setName,
  setPath,
  onPickPath,
  onCancel,
  onCreate,
}: {
  name: string
  path: string
  notice: string
  setName: (v: string) => void
  setPath: (v: string) => void
  onPickPath: () => void
  onCancel: () => void
  onCreate: (useTempDir?: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <Modal
      centered
      open
      width={440}
      title={t('sidebar.project.createTitle')}
      onCancel={onCancel}
      className="project-create-modal"
      footer={
        <div className="project-create-modal-footer">
          <Button size="middle" type="text" onClick={() => onCreate(true)}>
            {t('sidebar.project.createEmpty')}
          </Button>
          <span className="project-create-modal-footer-spacer" />
          <Button size="middle" type="text" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="middle" type="primary" onClick={() => onCreate(false)}>
            {t('sidebar.project.create')}
          </Button>
        </div>
      }
    >
      <div className="project-create-modal-body">
        <div className="project-create-modal-desc">{t('sidebar.project.createSubtitle')}</div>
        {notice && (
          <div className="session-notice in-modal">
            <Icons.AlertTriangle size={12} />
            <span>{notice}</span>
          </div>
        )}
        <label className="field">
          <span>{t('sidebar.project.name')}</span>
          <Input
            value={name}
            placeholder={t('sidebar.project.placeholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('sidebar.project.folderOptional')}</span>
          <div className="path-picker">
            <Input
              value={path}
              placeholder="/Users/you/projects/my-agent"
              onChange={(e) => setPath(e.target.value)}
            />
            <Button size="middle" type="text" onClick={onPickPath}>
              {t('common.choose')}
            </Button>
          </div>
          <div className="field-hint">{t('sidebar.project.tempHint')}</div>
        </label>
      </div>
    </Modal>
  )
}

function SidebarProjectToolbar({
  allCollapsed,
  filterSlot,
  onToggleAll,
  onAddProject,
}: {
  allCollapsed: boolean
  filterSlot: ReactNode
  onToggleAll: () => void
  onAddProject: () => void
}) {
  const { t } = useI18n()
  const toggleTitle = allCollapsed
    ? t('sidebar.projectsToolbar.expandAll')
    : t('sidebar.projectsToolbar.collapseAll')

  return (
    <div className="sidebar-project-toolbar" aria-label={t('sidebar.projectsToolbar.title')}>
      <div className="sidebar-project-toolbar-label">
        <span>{t('sidebar.projectsToolbar.title')}</span>
      </div>
      <div className="sidebar-project-toolbar-actions">
        <ActionIcon
          className="sidebar-project-toolbar-btn"
          icon={allCollapsed ? Icons.ComposerExpand : Icons.ComposerCollapse}
          size="small"
          variant="borderless"
          title={toggleTitle}
          aria-label={toggleTitle}
          onClick={onToggleAll}
        />
        {filterSlot}
        <button
          type="button"
          className="icon-btn sidebar-project-toolbar-btn"
          title={t('sidebar.addProject')}
          aria-label={t('sidebar.addProject')}
          onClick={onAddProject}
        >
          <Icons.FolderPlus />
        </button>
      </div>
    </div>
  )
}

/* ============================================================
   Main exported component
   ============================================================ */
export function SidebarSessionList() {
  const { t } = useI18n()
  const ctx = useSessionSidebar()
  const { searchSessions } = ctx
  const { t: appState, setTweak, hasDialogOpen } = useApp()

  // Sidebar global filter (status / project / lastActivity / groupBy)
  const [filter, setFilter] = useState<SidebarFilterState>(() => readSidebarFilter())
  const handleFilterChange = useCallback((next: SidebarFilterState) => {
    setFilter(next)
    writeSidebarFilter(next)
  }, [])
  const handleFilterClear = useCallback(() => {
    const cleared = { ...DEFAULT_SIDEBAR_FILTER }
    setFilter(cleared)
    writeSidebarFilter(cleared)
  }, [])

  // Notice
  const [notice, setNotice] = useState('')

  // Hidden session search: Cmd/Ctrl+K reveals and focuses this search box.
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const pendingSearchFocusRef = useRef(false)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SessionSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => {
    const handler = () => {
      pendingSearchFocusRef.current = true
      setSearchVisible(true)
    }
    window.addEventListener('spark:focus-search', handler)
    return () => window.removeEventListener('spark:focus-search', handler)
  }, [])

  useLayoutEffect(() => {
    if (!searchVisible || !pendingSearchFocusRef.current) return
    pendingSearchFocusRef.current = false
    searchInputRef.current?.focus()
  }, [searchVisible])

  useEffect(() => {
    if (!searchVisible) return
    const query = searchQuery.trim()
    if (!query) {
      const timer = window.setTimeout(() => {
        setSearchResults([])
        setSearchLoading(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      searchSessions(query)
        .then((results) => {
          if (!cancelled) setSearchResults(results)
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery, searchSessions, searchVisible])

  const closeSearch = useCallback(() => {
    setSearchVisible(false)
    setSearchQuery('')
    setSearchResults([])
    setSearchLoading(false)
  }, [])

  const searchResultSessions = useMemo(() => {
    if (!searchQuery.trim()) return []
    const byId = new Map(ctx.sessions.map((session) => [session.id, session]))
    return searchResults.flatMap((result) => {
      const session = byId.get(result.sessionId)
      return session ? [session] : []
    })
  }, [ctx.sessions, searchQuery, searchResults])

  // Active session/workspace highlighting only applies while the chat view is
  // mounted. When the user navigates to Board/Agents/Settings/etc., the sidebar
  // should not show any session as "selected" because none is being edited.
  const isChatView = appState.view === 'chat'
  const effectiveActiveSessionId = isChatView ? ctx.activeSessionId : null
  const effectiveActiveWorkspaceId = isChatView ? ctx.activeWorkspaceId : null

  const isDeleteShortcutBlocked = useCallback(() => {
    if (hasDialogOpen || ctx.historyImportOpen) return true
    if (
      appState.showPalette ||
      appState.showPerm ||
      appState.showProviderEdit ||
      appState.showProfileEdit
    ) {
      return true
    }
    return isModalOverlayVisible()
  }, [
    appState.showPalette,
    appState.showPerm,
    appState.showProfileEdit,
    appState.showProviderEdit,
    ctx.historyImportOpen,
    hasDialogOpen,
  ])

  useSessionDeleteShortcut({
    enabled: isChatView && effectiveActiveSessionId != null,
    activeSessionId: effectiveActiveSessionId,
    sessions: ctx.sessions,
    onDeleteSession: ctx.handleDeleteSession,
    isBlocked: isDeleteShortcutBlocked,
  })

  // Apply status / project / lastActivity filters
  const filteredSessions = useMemo(() => {
    const source = searchVisible && searchQuery.trim() ? searchResultSessions : ctx.sessions
    // 与后端 SQL 对齐：置顶在前、未置顶按 updatedAt 倒序。
    // 乐观更新 pinnedAt 后由这里即时重排，覆盖 date/state/none 分组及 noProject/ungrouped。
    return sortSessionsByPinned(applySessionFilters(source, filter))
  }, [ctx.sessions, filter, searchQuery, searchResultSessions, searchVisible])

  // Build display groups based on groupBy mode
  const displayGroups = useMemo<DisplayGroup[]>(() => {
    if (filter.groupBy === 'date') return buildGroupsByDate(filteredSessions)
    if (filter.groupBy === 'state') {
      return buildGroupsByState(filteredSessions, ctx.sessionAgentStatuses)
    }
    if (filter.groupBy === 'none') {
      return [{ id: 'none:all', label: 'sidebar.allSessions', sessions: filteredSessions }]
    }
    // 'project' mode: each workspace is its own group
    const selectedWorkspace =
      filter.projectId === 'all' ? null : ctx.workspaces.find((w) => w.id === filter.projectId)
    const selectedBaseWorkspaceId = selectedWorkspace?.worktreeMeta?.baseWorkspaceId
    const selectedProjectGroupId =
      selectedBaseWorkspaceId != null && ctx.workspaces.some((w) => w.id === selectedBaseWorkspaceId)
        ? selectedBaseWorkspaceId
        : filter.projectId
    const projectGroups = buildProjectGroups(ctx.workspaces, filteredSessions).filter(
      (group) => filter.projectId === 'all' || group.workspace.id === selectedProjectGroupId,
    )
    const noProjectWorkspace = ctx.noProjectWorkspace
    const noProject = noProjectWorkspace
      ? filteredSessions.filter((s) => s.workspaceIds.includes(noProjectWorkspace.id))
      : []
    const ungrouped = filteredSessions.filter((s) => s.workspaceIds.length === 0)
    const list: DisplayGroup[] = projectGroups.map((g) => ({
      id: `project:${g.workspace.id}`,
      label: g.workspace.name,
      sessions: g.sessions,
      workspace: g.workspace,
    }))
    if (noProject.length > 0) {
      list.push({ id: 'project:no-project', label: 'sidebar.noProjectChats', sessions: noProject })
    }
    if (ungrouped.length > 0) {
      list.push({ id: 'project:ungrouped', label: 'sidebar.ungroupedChats', sessions: ungrouped })
    }
    return list
  }, [
    filter.groupBy,
    filter.projectId,
    filteredSessions,
    ctx.workspaces,
    ctx.noProjectWorkspace,
    ctx.sessionAgentStatuses,
  ])

  const noProjectWorkspace = ctx.noProjectWorkspace
  const filterSlot = (
    <SidebarFilterMenu
      state={filter}
      workspaces={ctx.workspaces}
      onChange={handleFilterChange}
      onClear={handleFilterClear}
    />
  )
  const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => getCollapsedProjects())
  const [collapsedFlatGroupIds, setCollapsedFlatGroupIds] = useState(() =>
    getCollapsedFlatGroups(),
  )
  const handleProjectOpenChange = useCallback((workspaceId: string, nextOpen: boolean) => {
    setProjectCollapsed(workspaceId, !nextOpen)
    setCollapsedProjectIds(getCollapsedProjects())
  }, [])
  const handleFlatGroupOpenChange = useCallback((groupId: string, nextOpen: boolean) => {
    setFlatGroupCollapsed(groupId, !nextOpen)
    setCollapsedFlatGroupIds(getCollapsedFlatGroups())
  }, [])
  const allVisibleGroupsCollapsed = useMemo(() => {
    if (displayGroups.length === 0) return false
    return displayGroups.every((group) =>
      group.workspace
        ? collapsedProjectIds.has(group.workspace.id)
        : collapsedFlatGroupIds.has(group.id),
    )
  }, [collapsedFlatGroupIds, collapsedProjectIds, displayGroups])
  const handleToggleAllGroups = useCallback(() => {
    const collapsed = !allVisibleGroupsCollapsed
    const workspaceIds: string[] = []
    const flatGroupIds: string[] = []
    for (const group of displayGroups) {
      if (group.workspace) workspaceIds.push(group.workspace.id)
      else flatGroupIds.push(group.id)
    }
    setProjectCollapsedMany(workspaceIds, collapsed)
    setFlatGroupCollapsedMany(flatGroupIds, collapsed)
    setCollapsedProjectIds(getCollapsedProjects())
    setCollapsedFlatGroupIds(getCollapsedFlatGroups())
  }, [allVisibleGroupsCollapsed, displayGroups])
  const showProjectToolbar = ctx.workspaces.length > 0 || ctx.sessions.length > 0

  return (
    <div className="sidebar-session-list-inner">
      {/* Current session params panel 已移除 — 权限/推理控制在 ChatView Composer param bar 中 */}

      {showProjectToolbar && (
        <SidebarProjectToolbar
          allCollapsed={allVisibleGroupsCollapsed}
          filterSlot={filterSlot}
          onToggleAll={handleToggleAllGroups}
          onAddProject={() => ctx.setProjectDialog('create')}
        />
      )}

      {/* Session list */}
      <div className="chat-list scroll">
        {notice && (
          <div className="session-notice">
            <Icons.AlertTriangle size={12} />
            <span>{notice}</span>
            <button className="icon-btn" onClick={() => setNotice('')}>
              <Icons.X size={10} />
            </button>
          </div>
        )}

        {searchVisible && (
          <div className="sidebar-search-bar">
            <div className="sidebar-search-input-wrap">
              <Icons.Search size={13} />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSearch()
                }}
                placeholder={t('sidebar.search.placeholder')}
              />
              {searchLoading ? <Icons.Spinner size={12} className="animate-spin" /> : null}
              <button
                type="button"
                className="icon-btn sidebar-search-close"
                title={t('common.cancel')}
                onClick={closeSearch}
              >
                <Icons.X size={11} />
              </button>
            </div>
            {searchQuery.trim() && (
              <div className="sidebar-search-count">
                {t('sidebar.search.resultCount', { count: searchResultSessions.length })}
              </div>
            )}
          </div>
        )}

        {ctx.workspaces.length === 0 && ctx.sessions.length === 0 ? (
          <div className="empty-compact sidebar-empty-state sidebar-empty-state--projects">
            <div className="empty-icon">
              <Icons.Folder size={18} />
            </div>
            <div className="empty-desc empty-desc-actions">
              <button
                type="button"
                className="empty-inline-action empty-inline-action-muted"
                onClick={() => ctx.setProjectDialog('create')}
              >
                <Icons.FolderPlus size={12} />
                {t('sidebar.addProject')}
              </button>
            </div>
          </div>
        ) : displayGroups.length === 0 ? (
          <div className="empty-compact sidebar-empty-state sidebar-empty-state--filtered">
            <div className="empty-icon">
              <Icons.Filter size={18} />
            </div>
            <div className="empty-title">{t('sidebar.empty.noMatches')}</div>
            <div className="empty-desc">{t('sidebar.empty.noMatchesDesc')}</div>
          </div>
        ) : (
          <>
            {displayGroups.map((group) => {
              if (group.workspace) {
                const workspace = group.workspace
                return (
                  <ProjectSessionGroup
                    key={group.id}
                    group={{ workspace, sessions: group.sessions }}
                    activeSessionId={effectiveActiveSessionId}
                    activeWorkspaceId={effectiveActiveWorkspaceId}
                    sessionAgentStatuses={ctx.sessionAgentStatuses}
                    sessionTerminalActivity={ctx.sessionTerminalActivity}
                    unreviewedCompletedSessions={ctx.unreviewedCompletedSessions}
                    open={!collapsedProjectIds.has(workspace.id)}
                    onOpenChange={(nextOpen) => handleProjectOpenChange(workspace.id, nextOpen)}
                    onSelectWorkspace={async (workspace) => {
                      ctx.setActiveWorkspace(workspace.id)
                      await ctx.handleOpenWorkspace(workspace)
                      setTweak('view', 'chat')
                    }}
                    onSelectSession={(session) => {
                      ctx.setActiveSession(session.id)
                      ctx.setActiveWorkspace(workspace.id)
                      setTweak('view', 'chat')
                    }}
                    onNewSession={async (workspaceId) => {
                      const id = await ctx.handleNewSession(workspaceId)
                      if (id != null) setTweak('view', 'chat')
                    }}
                    onRenameProject={ctx.handleRenameProject}
                    onToggleProjectPinned={ctx.handleToggleProjectPinned}
                    onArchiveProject={ctx.handleArchiveProject}
                    onDeleteProject={ctx.handleDeleteProject}
                    onOpenProjectFolder={ctx.handleOpenProjectFolder}
                    onRenameSession={ctx.handleRenameSession}
                    onToggleSessionPinned={ctx.handleToggleSessionPinned}
                    onArchiveSession={ctx.handleArchiveSession}
                    onDeleteSession={ctx.handleDeleteSession}
                  />
                )
              }
              return (
                <FlatGroup
                  key={group.id}
                  groupId={group.id}
                  label={group.label}
                  sessions={group.sessions}
                  activeSessionId={effectiveActiveSessionId}
                  activeWorkspaceId={effectiveActiveWorkspaceId}
                  groupWorkspaceId={resolveSpecialSidebarGroupWorkspaceId(
                    group.id,
                    noProjectWorkspace?.id ?? null,
                  )}
                  sessionAgentStatuses={ctx.sessionAgentStatuses}
                  sessionTerminalActivity={ctx.sessionTerminalActivity}
                  unreviewedCompletedSessions={ctx.unreviewedCompletedSessions}
                  open={!collapsedFlatGroupIds.has(group.id)}
                  onOpenChange={(nextOpen) => handleFlatGroupOpenChange(group.id, nextOpen)}
                  onSelectGroup={
                    group.id === 'project:no-project'
                      ? () => {
                          ctx.setActiveWorkspace(noProjectWorkspace?.id ?? null)
                          setTweak('view', 'chat')
                        }
                      : group.id === 'project:ungrouped'
                        ? () => {
                            ctx.setActiveWorkspace(null)
                            setTweak('view', 'chat')
                          }
                        : undefined
                  }
                  onNewSession={
                    group.id === 'project:no-project'
                      ? async () => {
                          const targetWorkspaceId = noProjectWorkspace?.id ?? null
                          const id = await ctx.handleNewSession(targetWorkspaceId)
                          if (id != null) setTweak('view', 'chat')
                        }
                      : undefined
                  }
                  menuItems={[
                    ...(group.id === 'project:no-project' && noProjectWorkspace != null
                      ? [
                          {
                            icon: <Icons.Chat size={14} />,
                            label: '新建临时会话',
                            onClick: () => {
                              void (async () => {
                                const id = await ctx.handleNewSession(noProjectWorkspace.id)
                                if (id != null) setTweak('view', 'chat')
                              })()
                            },
                          },
                          {
                            icon: <Icons.Folder size={14} />,
                            label: '打开临时目录',
                            onClick: () => {
                              void ctx.handleOpenProjectFolder(noProjectWorkspace)
                            },
                          },
                        ]
                      : []),
                    {
                      icon: <Icons.Trash size={14} />,
                      label: t('session.clearAll'),
                      onClick: () => {
                        void ctx.handleClearSessions(group.sessions)
                      },
                    },
                  ]}
                  actions={{
                    onSelectSession: (session) => {
                      ctx.setActiveSession(session.id)
                      const specialWorkspaceId = resolveSpecialSidebarGroupWorkspaceId(
                        group.id,
                        noProjectWorkspace?.id ?? null,
                      )
                      ctx.setActiveWorkspace(
                        specialWorkspaceId !== undefined
                          ? specialWorkspaceId
                          : resolveSidebarActiveWorkspaceId(session, ctx.workspaces),
                      )
                      setTweak('view', 'chat')
                    },
                    onRenameSession: ctx.handleRenameSession,
                    onToggleSessionPinned: ctx.handleToggleSessionPinned,
                    onArchiveSession: ctx.handleArchiveSession,
                    onDeleteSession: ctx.handleDeleteSession,
                  }}
                />
              )
            })}
          </>
        )}
      </div>

      {/* Create Project Modal */}
      {ctx.projectDialog === 'create' && (
        <CreateProjectModal
          name={ctx.projectName}
          path={ctx.projectPath}
          notice={ctx.projectNotice}
          setName={ctx.setProjectName}
          setPath={ctx.setProjectPath}
          onPickPath={() => {
            void ctx.handlePickProjectPath()
          }}
          onCancel={() => {
            ctx.setProjectDialog(null)
          }}
          onCreate={(useTempDir?: boolean) => {
            void ctx.handleCreateProject(useTempDir)
          }}
        />
      )}
    </div>
  )
}
