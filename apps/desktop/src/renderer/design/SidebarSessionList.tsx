/**
 * SidebarSessionList — Complete conversation list extracted from ChatView.
 * Renders search, time filter, project groups, session items, and all context menus.
 */
import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
} from 'react'
import './SidebarSessionList.less'
import type { ReactNode } from 'react'
import { ActionIcon, Button, Dropdown, Icon, Input, Modal, Tooltip } from '@lobehub/ui'
import { Archive, Clock3, Maximize2, Minimize2, Pin, PinOff } from 'lucide-react'
import { Popover, message } from 'antd'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { Icons } from './Icons'
import { writeSessionReferenceDragPayload } from './views/chat/session-reference-dnd'
import { requestSessionReferenceAdd } from './views/chat/session-reference-control'
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
  type SidebarScheduledTasksFilter,
} from './SidebarFilterMenu'
import type { SessionScheduleSummaries } from './session-schedule-summary'
import { isModalOverlayVisible, useSessionDeleteShortcut } from './hooks/useAppDialogKeyboard'
import {
  resolveSidebarActiveWorkspaceId,
  resolveSpecialSidebarGroupWorkspaceId,
} from './sidebar-session-routing'
import { moveItem, sortByManualOrderWithinPinnedSections } from './sidebar-manual-order'
import {
  compareProjectDisplayGroups,
  composeProjectGroupSessions,
  getProjectGroupPinnedAt,
} from './sidebar-session-sort'
import { filterCanvasSessions, isCanvasWorkspace } from './workspace-visibility'
import { SidebarProjectDropZone } from './components/SidebarProjectDropZone'
import { useOptionalToast } from './components/Toast'
import {
  getDataTransferFilePaths,
  getFileNameFromPath,
  hasFileDataTransfer,
  isUnresolvableFileDrop,
} from './services/composer-attachments'
import { getDirectoryDropIntent } from './services/project-folder-drop'

const projectSortableId = (projectId: string): string => `project:${projectId}`
const sessionSortableId = (projectId: string, sessionId: string): string =>
  `session:${projectId}:${sessionId}`

type ParsedSortableId =
  | { type: 'project'; projectId: string }
  | { type: 'session'; projectId: string; sessionId: string }
  | null

function parseSortableId(value: string | number): ParsedSortableId {
  const [type, projectId, sessionId] = String(value).split(':')
  if (type === 'project' && projectId) return { type, projectId }
  if (type === 'session' && projectId && sessionId) return { type, projectId, sessionId }
  return null
}

function SortableProjectContainer({
  id,
  disabled,
  children,
}: {
  id: string
  disabled: boolean
  children: (dragActivatorProps?: React.HTMLAttributes<HTMLDivElement>) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const dragActivatorProps = disabled
    ? undefined
    : ({ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>)
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-sortable-project${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children(dragActivatorProps)}
    </div>
  )
}

/**
 * 拖拽进行中记录「被拖项是否置顶」，供 SortableSessionContainer 判断自身是否处于另一区，
 * 从而在拖拽时给另一区项加 is-cross-zone 禁用态。null 表示当前未拖拽会话。
 */
const SidebarDragContext = createContext<boolean | null>(null)

function SortableSessionContainer({
  id,
  pinned,
  children,
}: {
  id: string
  pinned: boolean
  children: (dragActivatorProps: React.HTMLAttributes<HTMLDivElement>) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const dragActivePinned = useContext(SidebarDragContext)
  const crossZone = dragActivePinned != null && dragActivePinned !== pinned
  const dragActivatorProps = {
    ...attributes,
    ...listeners,
  } as React.HTMLAttributes<HTMLDivElement>
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-sortable-session${isDragging ? ' is-dragging' : ''}${
        crossZone ? ' is-cross-zone' : ''
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children(dragActivatorProps)}
    </div>
  )
}

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
      scheduledTasks: parsed.scheduledTasks ?? DEFAULT_SIDEBAR_FILTER.scheduledTasks,
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
  if (range === 'today') {
    // 「今天」按自然日对齐当天 0 点，与会话分组的「今天」语义一致，
    // 区别于「1d / 3d ...」这类滚动 24 小时窗口。
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const cutoff = startOfToday.getTime()
    return sessions.filter((session) => {
      const updatedAt = new Date(session.updatedAt).getTime()
      return Number.isFinite(updatedAt) && updatedAt >= cutoff
    })
  }
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

function filterByScheduledTasks(
  sessions: SessionSummary[],
  filter: SidebarScheduledTasksFilter,
  summaries: SessionScheduleSummaries,
): SessionSummary[] {
  if (filter === 'all') return sessions
  return sessions.filter((session) => {
    const attached = (summaries[session.id]?.total ?? 0) > 0
    return filter === 'attached' ? attached : !attached
  })
}

export function applySessionFilters(
  sessions: SessionSummary[],
  filter: SidebarFilterState,
  scheduleSummaries: SessionScheduleSummaries = {},
): SessionSummary[] {
  return filterByLastActivity(
    filterByScheduledTasks(
      filterByProject(filterByStatus(sessions, filter.status), filter.projectId),
      filter.scheduledTasks,
      scheduleSummaries,
    ),
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

function getDisplayGroupProjectId(
  group: DisplayGroup,
  noProjectWorkspaceId: string | null,
): string | null {
  if (group.workspace != null) return group.workspace.id
  if (group.id === 'project:no-project') return noProjectWorkspaceId
  return null
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

/** 悬浮面板用的绝对时间：YYYY-MM-DD HH:mm（本地时区） */
function formatAbsoluteDateTime(value: string): string {
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function getSessionLocalDateKey(value: string): string | null {
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return null
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatSessionDateMarker(value: string): string | null {
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}`
}

function shouldShowSessionDateMarker(
  session: SessionSummary,
  previousSession: SessionSummary | undefined,
): boolean {
  if (previousSession == null) return false
  if (session.pinnedAt != null || previousSession.pinnedAt != null) return false
  const currentKey = getSessionLocalDateKey(session.updatedAt)
  const previousKey = getSessionLocalDateKey(previousSession.updatedAt)
  return currentKey != null && previousKey != null && currentKey !== previousKey
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

/* ─── SessionHoverCard — 会话行悬浮信息面板（扁平简约卡片） ─── */
function SessionHoverCard({
  title,
  projectName,
  branch,
  absoluteTime,
  relativeTime,
  editing,
  onEnterEdit,
  onExitEdit,
  onCommitTitle,
}: {
  title: string
  projectName: string | null
  branch?: string | undefined
  absoluteTime: string
  relativeTime: string
  editing: boolean
  onEnterEdit: () => void
  onExitEdit: () => void
  onCommitTitle?: (title: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(title)
  // 本次编辑是否已结算（commit/cancel），防止 onBlur 在回车/Esc 卸载时二次触发
  const settledRef = useRef(false)
  useEffect(() => {
    if (editing) {
      setDraft(title)
      settledRef.current = false
    }
  }, [editing, title])

  const finish = async (mode: 'commit' | 'cancel') => {
    if (settledRef.current) return
    settledRef.current = true
    if (mode === 'commit') {
      const trimmed = draft.trim()
      if (trimmed !== '' && trimmed !== title) {
        await onCommitTitle?.(trimmed)
      }
    }
    onExitEdit()
  }

  const rows: ReactNode[] = []
  if (projectName != null) {
    rows.push(
      <div className="session-hover-card-row" key="project">
        <Icons.FolderClosed size={13} />
        <span>{projectName}</span>
      </div>,
    )
  }
  if (branch != null && branch !== '') {
    rows.push(
      <div className="session-hover-card-row" key="branch">
        <Icons.GitBranch size={13} />
        <span className="is-branch">{branch}</span>
      </div>,
    )
  }
  if (absoluteTime !== '' || relativeTime !== '') {
    rows.push(
      <div className="session-hover-card-row" key="time">
        <Icons.Clock size={13} />
        <span>
          {absoluteTime}
          {relativeTime !== '' ? (
            <span className="session-hover-card-time-rel"> · {relativeTime}</span>
          ) : null}
        </span>
      </div>,
    )
  }
  return (
    <div className={`session-hover-card${editing ? ' is-editing' : ''}`}>
      <div className="session-hover-card-title">
        {editing ? (
          <Input
            value={draft}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              void finish('commit')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void finish('commit')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                void finish('cancel')
              }
            }}
            placeholder={t('session.titlePlaceholder')}
            className="session-hover-card-title-input"
          />
        ) : (
          <span
            className="session-hover-card-title-text"
            title={t('sidebar.session.rename')}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onEnterEdit()
            }}
          >
            {title}
          </span>
        )}
      </div>
      <div className="session-hover-card-rows">{rows}</div>
    </div>
  )
}

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
  onCommitTitle,
  onTogglePinned,
  onArchive,
  onDelete,
  onCollaborate,
  onAddToConversation,
  sessionReferenceDragEnabled = false,
  dragActivatorProps,
  revealSessionId,
  onRevealed,
}: {
  session: SessionSummary
  active: SessionId | null
  agentStatus?: AgentStatusValue | undefined
  terminalActivity?: TerminalSessionActivity | undefined
  unreviewed?: boolean
  smallTitle?: boolean
  onClick: (id: SessionId) => void
  onRename?: (session: SessionSummary) => void
  onCommitTitle?: (session: SessionSummary, title: string) => Promise<void>
  onTogglePinned?: (session: SessionSummary) => void
  onArchive?: (session: SessionSummary) => void
  onDelete?: (session: SessionSummary) => void
  onCollaborate?: (session: SessionSummary) => void
  onAddToConversation?: (session: SessionSummary) => void
  sessionReferenceDragEnabled?: boolean
  dragActivatorProps?: React.HTMLAttributes<HTMLDivElement> | undefined
  // When this id matches the session, scroll it into view (set by the command
  // palette via SessionSidebarContext.revealSession). Cleared via onRevealed.
  revealSessionId?: SessionId | null | undefined
  onRevealed?: (() => void) | undefined
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  // 悬浮卡 hover 开合（受控）；editing 时锁定不关，避免输入中被中断
  const [hoverOpen, setHoverOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  // Reveal: when this item is the reveal target, scroll it into view on the next
  // frame (the parent group expands / breaks pagination on the same reveal tick),
  // then notify the parent so the reveal flag can be cleared.
  useEffect(() => {
    if (!revealSessionId || revealSessionId !== s.id) return
    const raf = requestAnimationFrame(() => {
      itemRef.current?.scrollIntoView({ block: 'nearest' })
      onRevealed?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [revealSessionId, s.id, onRevealed])
  const { workspaces, noProjectWorkspace, openSessionSchedule, sessionScheduleSummaries } =
    useSessionSidebar()
  // 该会话关联的 workspace：用于解析项目名、worktree 分支等悬浮面板信息
  const sessionWorkspace = useMemo(() => {
    const wsId = s.workspaceIds[0]
    return wsId == null ? undefined : workspaces.find((w) => w.id === wsId)
  }, [s.workspaceIds, workspaces])
  // 该会话若运行在隔离 worktree 中，取其分支名用于显示分支图标指示符。
  // 应用自建 worktree 走 workspace.worktreeMeta；引擎级 worktree（agent 自行
  // 进入/创建）走 session.runtimeWorktree（agent 工具上报）。
  const worktreeBranch = sessionWorkspace?.worktreeMeta?.branch ?? s.runtimeWorktree?.branch
  const displayStatus = useMemo(
    () => getSessionDisplayStatus(s.status, agentStatus),
    [s.status, agentStatus],
  )
  const badgeInfo = useMemo(() => getStatusBadgeInfo(displayStatus), [displayStatus])
  // 悬浮信息面板：项目名（临时会话单独标注）、分支（仅 worktree）、绝对时间 + 相对时间
  const projectLabel = useMemo(() => {
    if (sessionWorkspace == null) return null
    if (noProjectWorkspace != null && sessionWorkspace.id === noProjectWorkspace.id) {
      return t('sidebar.noProjectChats')
    }
    return sessionWorkspace.name || null
  }, [sessionWorkspace, noProjectWorkspace, t])
  // 悬浮卡时间信息（hover 态才渲染，普通计算即可，无需 useMemo 缓存）
  const hoverTitle = s.title || t('sidebar.newSession')
  const absoluteTime = formatAbsoluteDateTime(s.updatedAt)
  const formatted = formatRelativeTime(s.updatedAt)
  const [timeKey, timeCount] = formatted.split(':')
  const relativeTime = t(timeKey ?? '', timeCount != null ? { count: timeCount } : undefined)

  const statusClass = displayStatus !== 'idle' ? `is-${displayStatus}` : ''
  const terminalRunningCount = terminalActivity?.running ?? 0
  const scheduleSummary = sessionScheduleSummaries[s.id]
  const scheduleSummaryLabel =
    scheduleSummary == null
      ? ''
      : t('sidebar.scheduleSummary', {
          total: scheduleSummary.total,
          enabled: scheduleSummary.enabled,
        })

  return (
    <Popover
      trigger="hover"
      placement="right"
      mouseEnterDelay={0.4}
      mouseLeaveDelay={0.12}
      destroyOnHidden
      open={hoverOpen || editing}
      onOpenChange={(open) => {
        if (!editing) setHoverOpen(open)
      }}
      overlayClassName="session-hover-card-popover"
      content={
        <SessionHoverCard
          title={hoverTitle}
          projectName={projectLabel}
          branch={worktreeBranch}
          absoluteTime={absoluteTime}
          relativeTime={relativeTime}
          editing={editing}
          onEnterEdit={() => setEditing(true)}
          onExitEdit={() => setEditing(false)}
          onCommitTitle={async (title) => {
            await onCommitTitle?.(s, title)
          }}
        />
      }
      align={{ offset: [-1, 0], overflow: { adjustY: true, shiftY: true } }}
    >
      <div
        ref={itemRef}
        className={`chat-item proj-session chat-item-compact ${active === s.id ? 'active' : ''} ${contextOpen ? 'is-context-open' : ''} ${statusClass}${sessionReferenceDragEnabled ? ' is-reference-draggable' : ''}`}
        {...dragActivatorProps}
        draggable={sessionReferenceDragEnabled || undefined}
        onDragStart={
          sessionReferenceDragEnabled
            ? (event) => {
                writeSessionReferenceDragPayload(event.dataTransfer, {
                  sessionId: s.id,
                  title: s.title || t('sidebar.newSession'),
                  projectId: s.projectId,
                  updatedAt: s.updatedAt,
                  turnCount: s.turnCount ?? s.messageCount,
                })
              }
            : undefined
        }
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
                    dotStatus === 'completed'
                      ? t('sidebar.status.newCompleted')
                      : t(badgeInfo.title)
                  }
                  aria-hidden
                >
                  {dotStatus === 'error' && <Icons.AlertTriangle size={12} />}
                </span>
              ) : null
            })()}
            {s.pinnedAt != null && <Pin size={11} fill="currentColor" className="pinned-icon" />}
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
          {scheduleSummary != null && scheduleSummary.total > 0 && (
            <Tooltip title={scheduleSummaryLabel} mouseEnterDelay={0.05}>
              <span
                className={`session-schedule-indicator${scheduleSummary.enabled > 0 ? ' is-enabled' : ' is-paused'}`}
                aria-label={scheduleSummaryLabel}
              >
                <Icon icon={Clock3} size={12} />
              </span>
            </Tooltip>
          )}
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
          ) : null}
          <div className={`session-item-actions${menuOpen ? ' menu-open' : ''}`}>
            <Tooltip title={t('sidebar.session.archive')} mouseEnterDelay={0.05}>
              <button
                type="button"
                className="icon-btn item-menu-btn session-row-action-btn session-archive-btn"
                aria-label={t('sidebar.session.archive')}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onArchive?.(s)
                }}
              >
                <Archive size={13} strokeWidth={1.35} />
              </button>
            </Tooltip>
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
                        icon: s.pinnedAt == null ? <Pin size={14} /> : <PinOff size={14} />,
                        label:
                          s.pinnedAt == null
                            ? t('sidebar.session.pin')
                            : t('sidebar.session.unpin'),
                        onClick: () => onTogglePinned?.(s),
                      },
                      {
                        icon: <Icons.Edit size={14} />,
                        label: t('sidebar.session.rename'),
                        onClick: () => onRename?.(s),
                      },
                      {
                        icon: <Clock3 size={14} />,
                        label: '计划任务',
                        onClick: () => {
                          onClick(s.id)
                          openSessionSchedule(s.id)
                        },
                      },
                      {
                        icon: <Icons.Copy size={14} />,
                        label: '复制会话',
                        onClick: () => onCollaborate?.(s),
                      },
                      {
                        icon: <Icons.MessageSquarePlus size={14} />,
                        label: '添加到对话',
                        onClick: () => onAddToConversation?.(s),
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
                <Tooltip title={t('sidebar.session.actions')} mouseEnterDelay={0.05}>
                  <button
                    type="button"
                    className="icon-btn item-menu-btn session-row-action-btn"
                    aria-label={t('sidebar.session.actions')}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icons.More size={15} />
                  </button>
                </Tooltip>
              </Dropdown>
            </div>
          </div>
        </div>
      </div>
    </Popover>
  )
}

/* ─── ProjectSessionGroup ─── */
const PROJECT_SESSION_INITIAL_VISIBLE = 8
const PROJECT_SESSION_PAGE_SIZE = 10

export function ProjectSessionGroup({
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
  onCommitSessionTitle,
  onToggleSessionPinned,
  onArchiveSession,
  onDeleteSession,
  onCollaborate,
  onAddToConversation,
  projectDragActivatorProps,
  sessionSortProjectId,
  revealSessionId,
  onSessionRevealed,
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
  onCommitSessionTitle: (session: SessionSummary, title: string) => Promise<void>
  onToggleSessionPinned: (session: SessionSummary) => void
  onArchiveSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
  onCollaborate?: (session: SessionSummary) => void
  onAddToConversation?: (session: SessionSummary) => void
  projectDragActivatorProps?: React.HTMLAttributes<HTMLDivElement> | undefined
  sessionSortProjectId?: string
  revealSessionId?: SessionId | null | undefined
  onSessionRevealed?: (() => void) | undefined
}) {
  const { t } = useI18n()
  const optionalToast = useOptionalToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [visibleSessionCount, setVisibleSessionCount] = useState(PROJECT_SESSION_INITIAL_VISIBLE)
  const isActiveProject = activeWorkspaceId === group.workspace.id

  const handleCopyProjectPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(group.workspace.rootPath)
      optionalToast?.toast.success('已复制路径')
    } catch (err) {
      optionalToast?.toast.error(err instanceof Error ? err.message : '复制失败')
    }
  }, [group.workspace.rootPath, optionalToast])

  const projectMenuItems = [
    {
      icon: group.workspace.pinnedAt == null ? <Pin size={14} /> : <PinOff size={14} />,
      label:
        group.workspace.pinnedAt == null ? t('sidebar.project.pin') : t('sidebar.project.unpin'),
      onClick: () => onToggleProjectPinned(group.workspace),
    },
    {
      icon: <Icons.Folder size={14} />,
      label: t('sidebar.project.openFolder'),
      onClick: () => onOpenProjectFolder(group.workspace),
    },
    {
      icon: <Icons.Copy size={14} />,
      label: '复制路径',
      onClick: () => void handleCopyProjectPath(),
    },
    {
      icon: <Icons.Edit size={14} />,
      label: t('sidebar.project.rename'),
      onClick: () => onRenameProject(group.workspace),
    },
    {
      icon: <Archive size={14} />,
      label: t('sidebar.project.archive'),
      onClick: () => onArchiveProject(group.workspace),
    },
    {
      icon: <Icons.Trash size={14} />,
      label: t('sidebar.project.delete'),
      danger: true,
      onClick: () => onDeleteProject(group.workspace),
    },
  ]

  const sessions = group.sessions
  // 置顶会话始终展示、不占用折叠阈值名额；阈值只作用于非置顶会话。
  // sessions 进入前已被 sortSessionsByPinned 预排为「置顶段在前、普通段在后」，
  // 因此按 pinnedAt 拆分后顺序稳定，不会打乱置顶段内 / 普通段内的既有序。
  const pinnedSessions = sessions.filter((s) => s.pinnedAt != null)
  const unpinnedSessions = sessions.filter((s) => s.pinnedAt == null)
  const hasMoreSessions = unpinnedSessions.length > visibleSessionCount
  const canCollapseSessions = visibleSessionCount > PROJECT_SESSION_INITIAL_VISIBLE
  const visibleSessions = [...pinnedSessions, ...unpinnedSessions.slice(0, visibleSessionCount)]
  // Reveal: if the target session lives in this group but falls beyond the
  // paginated window, expand the window so it renders before we scroll to it.
  // 置顶段始终全展示，故只需在非置顶段里定位目标；命中置顶则无需展开。
  useEffect(() => {
    if (revealSessionId == null) return
    const idx = unpinnedSessions.findIndex((s) => s.id === revealSessionId)
    if (idx >= visibleSessionCount) setVisibleSessionCount(idx + 1)
  }, [revealSessionId, unpinnedSessions, visibleSessionCount])

  return (
    <div className={`proj-group ${isActiveProject ? 'active-project' : ''}`}>
      <Dropdown
        menu={{ items: [] }}
        open={contextMenuOpen}
        onOpenChange={setContextMenuOpen}
        trigger={['contextMenu']}
        placement="bottomLeft"
        popupRender={() => (
          <ActionMenu onAction={() => setContextMenuOpen(false)} items={projectMenuItems} />
        )}
      >
        <div
          className="proj-head"
          {...projectDragActivatorProps}
          onClick={() => {
            onOpenChange(!open)
            void onSelectWorkspace(group.workspace)
          }}
        >
          <Tooltip
            title={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
            mouseEnterDelay={0.05}
          >
            <span
              className="proj-toggle"
              onClick={(e) => {
                e.stopPropagation()
                onOpenChange(!open)
              }}
              role="button"
              aria-label={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
            >
              {open ? (
                <Icons.FolderOpen className="chev" size={15} />
              ) : (
                <Icons.FolderClosed className="chev" size={15} />
              )}
            </span>
          </Tooltip>
          <span className="proj-name">{group.workspace.name}</span>
          <Tooltip
            title={
              group.workspace.pinnedAt != null
                ? t('sidebar.project.unpin')
                : t('sidebar.project.pin')
            }
            mouseEnterDelay={0.05}
          >
            <button
              className={`proj-pin-btn${group.workspace.pinnedAt != null ? ' is-pinned' : ''}`}
              aria-label={
                group.workspace.pinnedAt != null
                  ? t('sidebar.project.unpin')
                  : t('sidebar.project.pin')
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onToggleProjectPinned(group.workspace)
              }}
            >
              {group.workspace.pinnedAt != null ? (
                <Pin size={11} fill="currentColor" />
              ) : (
                <PinOff size={11} />
              )}
            </button>
          </Tooltip>
          <span className="proj-count">{group.sessions.length}</span>
          <Tooltip title={t('sidebar.project.newSession')} mouseEnterDelay={0.05}>
            <button
              className="icon-btn proj-add-session-btn"
              aria-label={t('sidebar.project.newSession')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onNewSession(group.workspace.id)
              }}
            >
              <Icons.Plus size={15} />
            </button>
          </Tooltip>
          <div className={`item-menu-wrap${menuOpen ? ' menu-open' : ''}`}>
            <Dropdown
              menu={{ items: [] }}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={['click']}
              placement="topRight"
              align={{ overflow: { shiftX: true, adjustY: true } }}
              popupRender={() => (
                <ActionMenu onAction={() => setMenuOpen(false)} items={projectMenuItems} />
              )}
            >
              <Tooltip title={t('sidebar.project.actions')} mouseEnterDelay={0.05}>
                <button
                  className="icon-btn item-menu-btn"
                  aria-label={t('sidebar.project.actions')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icons.More size={15} />
                </button>
              </Tooltip>
            </Dropdown>
          </div>
        </div>
      </Dropdown>
      {open && (
        <div className="proj-sessions">
          {sessions.length === 0 ? (
            <button className="proj-session-empty" onClick={() => onNewSession(group.workspace.id)}>
              <Icons.Plus size={15} />
              {t('sidebar.project.newSession')}
            </button>
          ) : (
            <>
              <SortableContext
                items={
                  sessionSortProjectId == null
                    ? []
                    : visibleSessions.map((session) =>
                        sessionSortableId(sessionSortProjectId, session.id),
                      )
                }
                strategy={verticalListSortingStrategy}
              >
                {visibleSessions.map((session, index) => {
                  const dateMarker =
                    sessionSortProjectId == null &&
                    shouldShowSessionDateMarker(session, visibleSessions[index - 1])
                      ? formatSessionDateMarker(session.updatedAt)
                      : null
                  const renderSession = (
                    dragActivatorProps?: React.HTMLAttributes<HTMLDivElement>,
                  ) => (
                    <React.Fragment key={session.id}>
                      {/* {dateMarker != null && (
                        <div className="session-date-marker" aria-label={`会话日期 ${dateMarker}`}>
                          {dateMarker}
                        </div>
                      )} */}
                      <ChatListItem
                        session={session}
                        active={activeSessionId}
                        agentStatus={sessionAgentStatuses[session.id]}
                        terminalActivity={sessionTerminalActivity[session.id]}
                        unreviewed={unreviewedCompletedSessions.has(session.id)}
                        revealSessionId={revealSessionId}
                        onRevealed={onSessionRevealed}
                        onClick={() => onSelectSession(session)}
                        onRename={onRenameSession}
                        onCommitTitle={onCommitSessionTitle}
                        onTogglePinned={onToggleSessionPinned}
                        onArchive={onArchiveSession}
                        onDelete={onDeleteSession}
                        {...(onCollaborate != null ? { onCollaborate } : {})}
                        {...(onAddToConversation != null ? { onAddToConversation } : {})}
                        sessionReferenceDragEnabled={sessionSortProjectId == null}
                        dragActivatorProps={dragActivatorProps}
                      />
                    </React.Fragment>
                  )
                  return sessionSortProjectId == null ? (
                    renderSession()
                  ) : (
                    <SortableSessionContainer
                      key={session.id}
                      id={sessionSortableId(sessionSortProjectId, session.id)}
                      pinned={session.pinnedAt != null}
                    >
                      {(dragActivatorProps) => renderSession(dragActivatorProps)}
                    </SortableSessionContainer>
                  )
                })}
              </SortableContext>
              {(hasMoreSessions || canCollapseSessions) && (
                <button
                  className="proj-show-more-btn"
                  aria-expanded={canCollapseSessions}
                  onClick={() => {
                    setVisibleSessionCount((current) =>
                      hasMoreSessions
                        ? Math.min(current + PROJECT_SESSION_PAGE_SIZE, unpinnedSessions.length)
                        : PROJECT_SESSION_INITIAL_VISIBLE,
                    )
                  }}
                >
                  {hasMoreSessions ? (
                    <>
                      <span className="proj-show-more-label">{t('sidebar.showMore')}</span>
                      <span className="proj-show-more-count">
                        {unpinnedSessions.length - visibleSessionCount}
                      </span>
                    </>
                  ) : (
                    <span className="proj-show-more-label">{t('sidebar.showLess')}</span>
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
  onCommitSessionTitle: (session: SessionSummary, title: string) => Promise<void>
  onToggleSessionPinned: (session: SessionSummary) => Promise<void>
  onArchiveSession: (session: SessionSummary) => Promise<void>
  onDeleteSession: (session: SessionSummary) => Promise<void>
  onCollaborate?: (session: SessionSummary) => void
  onAddToConversation?: (session: SessionSummary) => void
}

export function FlatGroup({
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
  pinned,
  onTogglePinned,
  menuItems = [],
  open,
  onOpenChange,
  actions,
  projectDragActivatorProps,
  sessionSortProjectId,
  revealSessionId,
  onSessionRevealed,
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
  /** 分组置顶态（当前仅临时会话分组使用）；提供 onTogglePinned 时展示置顶按钮。 */
  pinned?: boolean | undefined
  onTogglePinned?: (() => void) | undefined
  open: boolean
  onOpenChange: (next: boolean) => void
  menuItems?: Array<{
    icon: ReactNode
    label: string
    danger?: boolean
    onClick: () => void
  }>
  actions: FlatGroupActions
  projectDragActivatorProps?: React.HTMLAttributes<HTMLDivElement> | undefined
  sessionSortProjectId?: string
  revealSessionId?: SessionId | null | undefined
  onSessionRevealed?: (() => void) | undefined
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [visibleSessionCount, setVisibleSessionCount] = useState(PROJECT_SESSION_INITIAL_VISIBLE)
  const smallTitle = groupId === 'project:no-project' || groupId === 'project:ungrouped'
  const isActiveProject = groupWorkspaceId != null && activeWorkspaceId === groupWorkspaceId
  const paginateSessions = groupId === 'project:no-project'
  // 置顶会话始终展示、不占用折叠阈值名额；阈值只作用于非置顶会话。
  // 仅分页分组（no-project）需要拆分；非分页分组直接用原 sessions，避免无谓计算。
  const pinnedSessions = paginateSessions ? sessions.filter((s) => s.pinnedAt != null) : []
  const unpinnedSessions = paginateSessions ? sessions.filter((s) => s.pinnedAt == null) : sessions
  const visibleSessions = paginateSessions
    ? [...pinnedSessions, ...unpinnedSessions.slice(0, visibleSessionCount)]
    : sessions
  const hasMoreSessions = paginateSessions && unpinnedSessions.length > visibleSessionCount
  const canCollapseSessions =
    paginateSessions && visibleSessionCount > PROJECT_SESSION_INITIAL_VISIBLE
  // Reveal: only the paginated "no-project" group can hide a session beyond the
  // window; expand the window so the target renders before scrolling to it.
  // 置顶段始终全展示，故只需在非置顶段里定位目标；命中置顶则无需展开。
  useEffect(() => {
    if (!paginateSessions || revealSessionId == null) return
    const idx = unpinnedSessions.findIndex((s) => s.id === revealSessionId)
    if (idx >= visibleSessionCount) setVisibleSessionCount(idx + 1)
  }, [paginateSessions, revealSessionId, unpinnedSessions, visibleSessionCount])

  if (sessions.length === 0 && onNewSession == null) return null
  return (
    <div className={`proj-group flat-group${isActiveProject ? ' active-project' : ''}`}>
      <div
        className="proj-head flat-group-head"
        {...projectDragActivatorProps}
        onClick={() => {
          onOpenChange(!open)
          onSelectGroup?.()
        }}
      >
        <Tooltip
          title={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
          mouseEnterDelay={0.05}
        >
          <span
            className="proj-toggle"
            onClick={(e) => {
              e.stopPropagation()
              onOpenChange(!open)
            }}
            role="button"
            aria-label={open ? t('sidebar.project.collapse') : t('sidebar.project.expand')}
          >
            {open ? (
              <Icons.FolderOpen className="chev" size={15} />
            ) : (
              <Icons.FolderClosed className="chev" size={15} />
            )}
          </span>
        </Tooltip>
        <span className="proj-name">{t(label)}</span>
        {onTogglePinned != null && (
          <Tooltip
            title={pinned ? t('sidebar.group.unpin') : t('sidebar.group.pin')}
            mouseEnterDelay={0.05}
          >
            <button
              className={`proj-pin-btn${pinned ? ' is-pinned' : ''}`}
              aria-label={pinned ? t('sidebar.group.unpin') : t('sidebar.group.pin')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePinned()
              }}
            >
              {pinned ? <Pin size={11} fill="currentColor" /> : <PinOff size={11} />}
            </button>
          </Tooltip>
        )}
        <span className="proj-count">{sessions.length}</span>
        {onNewSession != null && (
          <Tooltip
            title={
              groupId === 'project:no-project' ? '新建临时会话' : t('sidebar.project.newSession')
            }
            mouseEnterDelay={0.05}
          >
            <button
              className="icon-btn proj-add-session-btn"
              aria-label={
                groupId === 'project:no-project' ? '新建临时会话' : t('sidebar.project.newSession')
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void onNewSession()
              }}
            >
              <Icons.Plus size={15} />
            </button>
          </Tooltip>
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
              <Tooltip
                title={
                  groupId === 'project:no-project' ? '临时会话操作' : t('sidebar.project.actions')
                }
                mouseEnterDelay={0.05}
              >
                <button
                  className="icon-btn item-menu-btn"
                  aria-label={
                    groupId === 'project:no-project' ? '临时会话操作' : t('sidebar.project.actions')
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icons.More size={15} />
                </button>
              </Tooltip>
            </Dropdown>
          </div>
        )}
      </div>
      {open && (
        <div className="proj-sessions">
          <SortableContext
            items={
              sessionSortProjectId == null
                ? []
                : visibleSessions.map((session) =>
                    sessionSortableId(sessionSortProjectId, session.id),
                  )
            }
            strategy={verticalListSortingStrategy}
          >
            {visibleSessions.map((session) => {
              const renderSession = (dragActivatorProps?: React.HTMLAttributes<HTMLDivElement>) => (
                <ChatListItem
                  key={session.id}
                  session={session}
                  active={activeSessionId}
                  agentStatus={sessionAgentStatuses[session.id]}
                  terminalActivity={sessionTerminalActivity[session.id]}
                  unreviewed={unreviewedCompletedSessions.has(session.id)}
                  smallTitle={smallTitle}
                  revealSessionId={revealSessionId}
                  onRevealed={onSessionRevealed}
                  onClick={() => actions.onSelectSession(session)}
                  onRename={actions.onRenameSession}
                  onCommitTitle={actions.onCommitSessionTitle}
                  onTogglePinned={actions.onToggleSessionPinned}
                  onArchive={actions.onArchiveSession}
                  onDelete={actions.onDeleteSession}
                  {...(actions.onCollaborate != null
                    ? { onCollaborate: actions.onCollaborate }
                    : {})}
                  {...(actions.onAddToConversation != null
                    ? { onAddToConversation: actions.onAddToConversation }
                    : {})}
                  sessionReferenceDragEnabled={sessionSortProjectId == null}
                  dragActivatorProps={dragActivatorProps}
                />
              )
              return sessionSortProjectId == null ? (
                renderSession()
              ) : (
                <SortableSessionContainer
                  key={session.id}
                  id={sessionSortableId(sessionSortProjectId, session.id)}
                  pinned={session.pinnedAt != null}
                >
                  {(dragActivatorProps) => renderSession(dragActivatorProps)}
                </SortableSessionContainer>
              )
            })}
          </SortableContext>
          {(hasMoreSessions || canCollapseSessions) && (
            <button
              className="proj-show-more-btn"
              aria-expanded={canCollapseSessions}
              onClick={() => {
                setVisibleSessionCount((current) =>
                  hasMoreSessions
                    ? Math.min(current + PROJECT_SESSION_PAGE_SIZE, unpinnedSessions.length)
                    : PROJECT_SESSION_INITIAL_VISIBLE,
                )
              }}
            >
              {hasMoreSessions ? (
                <>
                  <span className="proj-show-more-label">{t('sidebar.showMore')}</span>
                  <span className="proj-show-more-count">
                    {unpinnedSessions.length - visibleSessionCount}
                  </span>
                </>
              ) : (
                <span className="proj-show-more-label">{t('sidebar.showLess')}</span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── CreateProjectModal ─── */
export function CreateProjectModal({
  name,
  path,
  notice,
  setName,
  onPickPath,
  onDropPath,
  onCancel,
  onCreate,
}: {
  name: string
  path: string
  notice: string
  setName: (v: string) => void
  onPickPath: () => void
  onDropPath: (path: string) => Promise<void>
  onCancel: () => void
  onCreate: (useTempDir?: boolean) => void
}) {
  const { t } = useI18n()
  const optionalToast = useOptionalToast()
  const [dropActive, setDropActive] = useState(false)
  const dragDepthRef = useRef(0)

  const resetDropState = useCallback(() => {
    dragDepthRef.current = 0
    setDropActive(false)
  }, [])

  useEffect(() => {
    window.addEventListener('blur', resetDropState)
    return () => window.removeEventListener('blur', resetDropState)
  }, [resetDropState])

  const canHandleDirectoryDrop = (dataTransfer: DataTransfer | null) =>
    getDirectoryDropIntent(dataTransfer) !== 'reject'

  const showDropWarning = (text: string) => {
    if (optionalToast) optionalToast.toast.warning(text)
    else message.warning(text)
  }

  const showDropError = (text: string) => {
    if (optionalToast) optionalToast.toast.error(text)
    else message.error(text)
  }

  return (
    <Modal
      centered
      open
      width={600}
      title={
        <div className="project-create-modal-title">
          <span className="project-create-modal-title-icon" aria-hidden="true">
            <Icons.FolderPlus size={22} />
          </span>
          <span className="project-create-modal-title-copy">
            <strong>{t('sidebar.project.createTitle')}</strong>
            <small>{t('sidebar.project.createSubtitle')}</small>
          </span>
        </div>
      }
      onCancel={onCancel}
      className="project-create-modal"
      footer={
        <div className="project-create-modal-footer">
          <span className="project-create-modal-footer-spacer" />
          <Button size="middle" type="default" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="middle" type="primary" onClick={() => onCreate(false)}>
            {t('sidebar.project.create')}
          </Button>
        </div>
      }
    >
      <div className="project-create-modal-body">
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
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t('sidebar.project.folderLabel')}</span>
          <div
            className={`project-create-dropzone${dropActive ? ' is-drag-active' : ''}${path ? ' has-path' : ''}`}
            onDragEnter={(event) => {
              if (!canHandleDirectoryDrop(event.dataTransfer)) return
              event.preventDefault()
              event.stopPropagation()
              dragDepthRef.current += 1
              setDropActive(true)
            }}
            onDragOver={(event) => {
              if (!canHandleDirectoryDrop(event.dataTransfer)) return
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'copy'
              setDropActive(true)
            }}
            onDragLeave={(event) => {
              if (!canHandleDirectoryDrop(event.dataTransfer)) return
              event.preventDefault()
              event.stopPropagation()
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
              if (dragDepthRef.current === 0) setDropActive(false)
            }}
            onDrop={(event) => {
              const dropIntent = getDirectoryDropIntent(event.dataTransfer)
              if (dropIntent === 'reject') {
                if (hasFileDataTransfer(event.dataTransfer)) {
                  event.preventDefault()
                  event.stopPropagation()
                  showDropWarning(t('sidebar.project.dropFile'))
                }
                resetDropState()
                return
              }
              event.preventDefault()
              event.stopPropagation()
              const paths = getDataTransferFilePaths(event.dataTransfer)
              const unresolvable = isUnresolvableFileDrop(event.dataTransfer, paths)
              resetDropState()
              if (unresolvable) {
                showDropError(t('sidebar.project.dropUnresolvable'))
                return
              }
              if (paths[0]) void onDropPath(paths[0])
            }}
          >
            <div className="project-create-dropzone-copy">
              <span className="project-create-dropzone-icon" aria-hidden="true">
                <Icons.FolderOpen size={30} />
              </span>
              {path ? (
                <>
                  <strong title={path}>{getFileNameFromPath(path)}</strong>
                  <span className="project-create-dropzone-path" title={path}>
                    {path}
                  </span>
                </>
              ) : (
                <>
                  <strong>{t('sidebar.project.dropFolder')}</strong>
                  <span>{t('sidebar.project.dropFolderHint')}</span>
                </>
              )}
            </div>
            <Button
              size="middle"
              type="primary"
              icon={<Icons.FolderOpen size={16} />}
              onClick={onPickPath}
            >
              {path ? t('common.change') : t('sidebar.project.chooseFolder')}
            </Button>
          </div>
        </label>
      </div>
    </Modal>
  )
}

export function SidebarProjectToolbar({
  allCollapsed,
  filterSlot,
  onImportHistory,
  onToggleAll,
  onAddProject,
}: {
  allCollapsed: boolean
  filterSlot: ReactNode
  onImportHistory: () => void
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
        <Tooltip title={t('sidebar.importHistory')} mouseEnterDelay={0.05}>
          <button
            type="button"
            className="icon-btn sidebar-project-toolbar-btn"
            aria-label={t('sidebar.importHistory')}
            onClick={onImportHistory}
          >
            <Icons.Upload />
          </button>
        </Tooltip>
        <Tooltip title={toggleTitle} mouseEnterDelay={0.05}>
          <ActionIcon
            className="sidebar-project-toolbar-btn sidebar-project-toolbar-collapse-btn"
            icon={allCollapsed ? Maximize2 : Minimize2}
            size="small"
            variant="borderless"
            aria-label={toggleTitle}
            onClick={onToggleAll}
          />
        </Tooltip>
        {filterSlot}
        <Tooltip title={t('sidebar.addProject')} mouseEnterDelay={0.05}>
          <button
            type="button"
            className="icon-btn sidebar-project-toolbar-btn"
            aria-label={t('sidebar.addProject')}
            onClick={onAddProject}
          >
            <Icons.FolderPlus />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/* ============================================================
   Main exported component
   ============================================================ */
export function SidebarProjectsEmptyState({
  isStartingSession,
  onCreateProject,
  onStartSession,
}: {
  isStartingSession: boolean
  onCreateProject: () => void
  onStartSession: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="empty-compact sidebar-empty-state sidebar-empty-state--projects">
      <div className="empty-state-mark" aria-hidden="true">
        <span className="empty-state-mark__glow" />
        <span className="empty-state-mark__icon">
          <Icons.FolderOpen size={20} />
        </span>
      </div>
      <div className="empty-title">{t('sidebar.empty.welcomeTitle')}</div>
      <div className="empty-desc">{t('sidebar.empty.welcomeDesc')}</div>

      <div className="empty-state-actions">
        <button
          type="button"
          className="empty-action-card empty-action-card--primary"
          onClick={onCreateProject}
        >
          <span className="empty-action-card__icon" aria-hidden="true">
            <Icons.FolderPlus size={18} />
          </span>
          <span className="empty-action-card__copy">
            <strong>{t('sidebar.empty.createProject')}</strong>
            <small>{t('sidebar.empty.createProjectDesc')}</small>
          </span>
          <Icons.ArrowRight className="empty-action-card__arrow" size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="empty-action-card"
          disabled={isStartingSession}
          aria-busy={isStartingSession}
          onClick={onStartSession}
        >
          <span className="empty-action-card__icon" aria-hidden="true">
            {isStartingSession ? (
              <Icons.Spinner size={18} className="animate-spin" />
            ) : (
              <Icons.MessageSquarePlus size={18} />
            )}
          </span>
          <span className="empty-action-card__copy">
            <strong>
              {isStartingSession
                ? t('sidebar.empty.startingSession')
                : t('sidebar.empty.startSession')}
            </strong>
            <small>{t('sidebar.empty.startSessionDesc')}</small>
          </span>
          <Icons.ArrowRight className="empty-action-card__arrow" size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="empty-drop-hint" role="note">
        <span className="empty-drop-hint__icon" aria-hidden="true">
          <Icons.Upload size={15} />
        </span>
        <span>
          <strong>{t('sidebar.empty.dropFolder')}</strong>
          <small>{t('sidebar.empty.dropFolderDesc')}</small>
        </span>
      </div>
    </div>
  )
}

export function SidebarSessionList() {
  const { t } = useI18n()
  const ctx = useSessionSidebar()
  const { searchSessions } = ctx
  const { handleNewSession } = ctx
  const { t: appState, setTweak, hasDialogOpen } = useApp()
  const [isStartingEmptySession, setIsStartingEmptySession] = useState(false)

  const handleStartEmptySession = useCallback(async () => {
    if (isStartingEmptySession) return
    setIsStartingEmptySession(true)
    try {
      const id = await handleNewSession(null)
      if (id != null) setTweak('view', 'chat')
    } finally {
      setIsStartingEmptySession(false)
    }
  }, [handleNewSession, isStartingEmptySession, setTweak])

  const handleCollaborateSession = useCallback(
    async (session: SessionSummary) => {
      const id = await ctx.handleForkSession(session.id)
      if (id != null) setTweak('view', 'chat')
    },
    [ctx.handleForkSession, setTweak],
  )

  const handleAddSessionToConversation = useCallback(
    async (sourceSession: SessionSummary) => {
      if (appState.view !== 'chat') {
        message.info('请先打开一个对话')
        return
      }
      const applied = await requestSessionReferenceAdd(
        {
          sessionId: sourceSession.id,
          title: sourceSession.title || t('sidebar.newSession'),
          projectId: sourceSession.projectId,
          updatedAt: sourceSession.updatedAt,
          turnCount: sourceSession.turnCount ?? sourceSession.messageCount,
        },
        ctx.activeSessionId,
      )
      if (!applied) message.info('当前对话输入区不可用')
    },
    [appState.view, ctx.activeSessionId, t],
  )

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

  // 升级前可能已把某个画布 workspace 存成项目筛选条件；标记加载后自动回到全部项目，
  // 避免普通会话栏因一个已隐藏的筛选项而呈现空白。
  useEffect(() => {
    if (filter.projectId === 'all') return
    const selected = ctx.workspaces.find((workspace) => workspace.id === filter.projectId)
    if (selected == null || !isCanvasWorkspace(selected)) return
    handleFilterChange({ ...filter, projectId: 'all' })
  }, [ctx.workspaces, filter, handleFilterChange])

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
    if (appState.showPalette || appState.showPerm || appState.showProviderEdit) {
      return true
    }
    return isModalOverlayVisible()
  }, [
    appState.showPalette,
    appState.showPerm,
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
    const visibleSource = filterCanvasSessions(source, ctx.workspaces)
    // 与后端 SQL 对齐：置顶在前、未置顶按 updatedAt 倒序。
    // 乐观更新 pinnedAt 后由这里即时重排，覆盖 date/state/none 分组及 noProject/ungrouped。
    return sortSessionsByPinned(
      applySessionFilters(visibleSource, filter, ctx.sessionScheduleSummaries),
    )
  }, [
    ctx.sessionScheduleSummaries,
    ctx.sessions,
    ctx.workspaces,
    filter,
    searchQuery,
    searchResultSessions,
    searchVisible,
  ])

  // 状态 / 最近活动 / 计划任务 / 项目 这些筛选项只用于「筛选会话」，
  // 项目分组头必须始终保留 —— 否则一旦某项目下没有命中筛选的会话，
  // 整个项目就会从侧栏消失，用户无法再点选切换项目。
  // 仅在「搜索会话」时隐藏没有匹配会话的空项目分组（搜索是针对会话的模糊匹配）。
  const hideEmptyProjectGroups = searchVisible && searchQuery.trim().length > 0

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
      selectedBaseWorkspaceId != null &&
      ctx.workspaces.some((w) => w.id === selectedBaseWorkspaceId)
        ? selectedBaseWorkspaceId
        : filter.projectId
    const projectGroups = buildProjectGroups(ctx.workspaces, filteredSessions).filter(
      (group) =>
        (!hideEmptyProjectGroups || group.sessions.length > 0) &&
        (filter.projectId === 'all' || group.workspace.id === selectedProjectGroupId),
    )
    const noProjectWorkspace = ctx.noProjectWorkspace
    const noProject = noProjectWorkspace
      ? filteredSessions.filter((s) => s.workspaceIds.includes(noProjectWorkspace.id))
      : []
    const ungrouped = filteredSessions.filter((s) => s.workspaceIds.length === 0)
    const list: DisplayGroup[] = projectGroups.map((g) => ({
      id: `project:${g.workspace.id}`,
      label: g.workspace.name,
      sessions: composeProjectGroupSessions(
        g.sessions,
        ctx.sidebarOrder.sessionIdsByProject[g.workspace.id],
        ctx.sidebarOrder.pinnedSessionIdsByProject[g.workspace.id],
      ),
      workspace: g.workspace,
    }))
    const noProjectGroup: DisplayGroup | null =
      noProjectWorkspace != null && (!hideEmptyProjectGroups || noProject.length > 0)
        ? {
            id: 'project:no-project',
            label: 'sidebar.noProjectChats',
            sessions: composeProjectGroupSessions(
              noProject,
              ctx.sidebarOrder.sessionIdsByProject[noProjectWorkspace.id],
              ctx.sidebarOrder.pinnedSessionIdsByProject[noProjectWorkspace.id],
            ),
          }
        : null
    // 临时会话分组与真实项目同一口径参与 fallback 排序（置顶在前、最新活动倒序），
    // 有新临时会话时分组会像真实项目一样上浮；拖拽手动序在其上覆盖。
    const reorderableProjects =
      noProjectGroup == null
        ? list
        : [...list, noProjectGroup].sort((a, b) =>
            compareProjectDisplayGroups(a, b, noProjectWorkspace),
          )
    const orderedProjects = sortByManualOrderWithinPinnedSections(
      reorderableProjects,
      ctx.sidebarOrder.projectIds,
      (group) => group.workspace?.id ?? noProjectWorkspace?.id ?? group.id,
      (group) => getProjectGroupPinnedAt(group, noProjectWorkspace) != null,
    )
    const ungroupedGroup: DisplayGroup[] =
      ungrouped.length > 0
        ? [{ id: 'project:ungrouped', label: 'sidebar.ungroupedChats', sessions: ungrouped }]
        : []
    return [...orderedProjects, ...ungroupedGroup]
  }, [
    filter.groupBy,
    filter.projectId,
    filteredSessions,
    ctx.workspaces,
    ctx.noProjectWorkspace,
    ctx.sidebarOrder,
    ctx.sessionAgentStatuses,
    hideEmptyProjectGroups,
  ])

  const noProjectWorkspace = ctx.noProjectWorkspace
  const canReorderSessions =
    filter.groupBy === 'project' &&
    filter.status === DEFAULT_SIDEBAR_FILTER.status &&
    filter.projectId === DEFAULT_SIDEBAR_FILTER.projectId &&
    filter.lastActivity === DEFAULT_SIDEBAR_FILTER.lastActivity &&
    filter.scheduledTasks === DEFAULT_SIDEBAR_FILTER.scheduledTasks &&
    !(searchVisible && searchQuery.trim().length > 0)
  const canReorderProjects = canReorderSessions
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const sortableProjectIds = useMemo(
    () =>
      canReorderProjects
        ? displayGroups.flatMap((group) => {
            const projectId = getDisplayGroupProjectId(group, noProjectWorkspace?.id ?? null)
            return projectId == null ? [] : [projectSortableId(projectId)]
          })
        : [],
    [canReorderProjects, displayGroups, noProjectWorkspace?.id],
  )
  const pinnedSessionIdSet = useMemo(
    () =>
      new Set<string>(
        ctx.sessions.filter((session) => session.pinnedAt != null).map((session) => session.id),
      ),
    [ctx.sessions],
  )
  // session 拖拽时只允许落在同区（pinned 状态一致）的 session 上，跨区根本拖不动。
  const sidebarCollisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const activeItem = parseSortableId(args.active.id)
      if (activeItem == null) return []
      if (activeItem.type === 'project') {
        return closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => parseSortableId(container.id)?.type === 'project',
          ),
        })
      }
      const activePinned = pinnedSessionIdSet.has(activeItem.sessionId)
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) => {
          const item = parseSortableId(container.id)
          if (item?.type !== 'session') return false
          return pinnedSessionIdSet.has(item.sessionId) === activePinned
        }),
      })
    },
    [pinnedSessionIdSet],
  )
  const [dragActivePinned, setDragActivePinned] = useState<boolean | null>(null)
  // 拖拽项目分组期间的临时折叠态：被拖分组强制收起，避免带着一长串会话拖动。
  // 纯内存态，不写 localStorage；拖拽结束清空即恢复用户持久的折叠偏好（原本展开的恢复展开、原本折叠的仍折叠）。
  // key 用 sortableId 维度（project:${projectId}），统一覆盖真实项目与临时会话组。
  const [autoCollapsedProjectIds, setAutoCollapsedProjectIds] = useState<Set<string>>(new Set())
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const item = parseSortableId(event.active.id)
      setDragActivePinned(item?.type === 'session' ? pinnedSessionIdSet.has(item.sessionId) : null)
      if (item?.type === 'project') {
        setAutoCollapsedProjectIds(new Set([projectSortableId(item.projectId)]))
      }
    },
    [pinnedSessionIdSet],
  )
  const handleDragCancel = useCallback(() => {
    setDragActivePinned(null)
    setAutoCollapsedProjectIds(new Set())
  }, [])
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActivePinned(null)
      setAutoCollapsedProjectIds(new Set())
      if (event.over == null || event.active.id === event.over.id) return
      const activeItem = parseSortableId(event.active.id)
      const overItem = parseSortableId(event.over.id)
      if (activeItem == null || overItem == null || activeItem.type !== overItem.type) return

      if (activeItem.type === 'project' && overItem.type === 'project' && canReorderProjects) {
        const projectIds = displayGroups.flatMap((group) => {
          const projectId = getDisplayGroupProjectId(group, noProjectWorkspace?.id ?? null)
          return projectId == null ? [] : [projectId]
        })
        const next = moveItem(
          projectIds,
          projectIds.indexOf(activeItem.projectId),
          projectIds.indexOf(overItem.projectId),
        )
        void ctx.handleReorderProjects(next)
        return
      }

      if (activeItem.type !== 'session' || overItem.type !== 'session' || !canReorderSessions) {
        return
      }
      if (activeItem.projectId !== overItem.projectId) {
        setNotice(t('sidebar.drag.sameProjectOnly'))
        return
      }
      const group = displayGroups.find(
        (item) =>
          getDisplayGroupProjectId(item, noProjectWorkspace?.id ?? null) === activeItem.projectId,
      )
      if (group == null) return
      const activePinned = pinnedSessionIdSet.has(activeItem.sessionId)
      // 跨区理论上已被 collisionDetection 拦截；这里做防御性兜底。
      if (pinnedSessionIdSet.has(overItem.sessionId) !== activePinned) {
        setNotice(t('sidebar.drag.pinnedZoneOnly'))
        return
      }
      const zoneIds: string[] = group.sessions
        .filter((session) => (session.pinnedAt != null) === activePinned)
        .map((session) => session.id)
      const next = moveItem(
        zoneIds,
        zoneIds.indexOf(activeItem.sessionId),
        zoneIds.indexOf(overItem.sessionId),
      )
      if (activePinned) {
        void ctx.handleReorderPinnedSessions(activeItem.projectId, next)
      } else {
        void ctx.handleReorderSessions(activeItem.projectId, next)
      }
    },
    [
      canReorderProjects,
      canReorderSessions,
      ctx,
      displayGroups,
      noProjectWorkspace?.id,
      pinnedSessionIdSet,
      t,
    ],
  )
  const filterSlot = (
    <SidebarFilterMenu
      state={filter}
      workspaces={ctx.workspaces}
      onChange={handleFilterChange}
      onClear={handleFilterClear}
    />
  )
  const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => getCollapsedProjects())
  const [collapsedFlatGroupIds, setCollapsedFlatGroupIds] = useState(() => getCollapsedFlatGroups())
  // Reveal-driven forced open: transiently expand a group that the command
  // palette navigated into, without touching the user's persisted collapse
  // preference. Removed for a group the moment the user manually collapses it.
  const [forcedOpenProjectIds, setForcedOpenProjectIds] = useState<Set<string>>(new Set())
  const [forcedOpenFlatGroupIds, setForcedOpenFlatGroupIds] = useState<Set<string>>(new Set())
  const handleProjectOpenChange = useCallback((workspaceId: string, nextOpen: boolean) => {
    setProjectCollapsed(workspaceId, !nextOpen)
    setCollapsedProjectIds(getCollapsedProjects())
    if (!nextOpen) {
      setForcedOpenProjectIds((prev) =>
        prev.has(workspaceId) ? new Set([...prev].filter((x) => x !== workspaceId)) : prev,
      )
    }
  }, [])
  const handleFlatGroupOpenChange = useCallback((groupId: string, nextOpen: boolean) => {
    setFlatGroupCollapsed(groupId, !nextOpen)
    setCollapsedFlatGroupIds(getCollapsedFlatGroups())
    if (!nextOpen) {
      setForcedOpenFlatGroupIds((prev) =>
        prev.has(groupId) ? new Set([...prev].filter((x) => x !== groupId)) : prev,
      )
    }
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
  // When the command palette reveals a session, force-open the group containing
  // it so the highlight is visible. The reveal id is cleared by ChatListItem
  // after it scrolls; the forced-open state persists until the user manually
  // collapses the group (see handleProjectOpenChange / handleFlatGroupOpenChange).
  useEffect(() => {
    const id = ctx.revealSessionId
    if (id == null) return
    const matched = displayGroups.find((g) => g.sessions.some((s) => s.id === id))
    if (!matched) return
    if (matched.workspace) {
      setForcedOpenProjectIds(new Set([matched.workspace.id]))
      setForcedOpenFlatGroupIds(new Set())
    } else {
      setForcedOpenFlatGroupIds(new Set([matched.id]))
      setForcedOpenProjectIds(new Set())
    }
  }, [ctx.revealSessionId, displayGroups])
  const showProjectToolbar = ctx.workspaces.length > 0 || ctx.sessions.length > 0

  return (
    <SidebarProjectDropZone onDropPaths={ctx.handleAddDroppedProjects}>
      <div className="sidebar-session-list-inner">
        {/* Current session params panel 已移除 — 权限/推理控制在 ChatView Composer param bar 中 */}

        {showProjectToolbar && (
          <SidebarProjectToolbar
            allCollapsed={allVisibleGroupsCollapsed}
            filterSlot={filterSlot}
            onImportHistory={() => ctx.setHistoryImportOpen(true)}
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
              <Tooltip title={t('common.cancel')} mouseEnterDelay={0.05}>
                <button
                  className="icon-btn"
                  aria-label={t('common.cancel')}
                  onClick={() => setNotice('')}
                >
                  <Icons.X size={10} />
                </button>
              </Tooltip>
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
                <Tooltip title={t('common.cancel')} mouseEnterDelay={0.05}>
                  <button
                    type="button"
                    className="icon-btn sidebar-search-close"
                    aria-label={t('common.cancel')}
                    onClick={closeSearch}
                  >
                    <Icons.X size={11} />
                  </button>
                </Tooltip>
              </div>
              {searchQuery.trim() && (
                <div className="sidebar-search-count">
                  {t('sidebar.search.resultCount', { count: searchResultSessions.length })}
                </div>
              )}
            </div>
          )}

          {ctx.workspaces.length === 0 && ctx.sessions.length === 0 ? (
            <SidebarProjectsEmptyState
              isStartingSession={isStartingEmptySession}
              onCreateProject={() => ctx.setProjectDialog('create')}
              onStartSession={() => void handleStartEmptySession()}
            />
          ) : displayGroups.length === 0 ? (
            <div className="empty-compact sidebar-empty-state sidebar-empty-state--filtered">
              <div className="empty-icon">
                <Icons.Filter size={18} />
              </div>
              <div className="empty-title">{t('sidebar.empty.noMatches')}</div>
              <div className="empty-desc">{t('sidebar.empty.noMatchesDesc')}</div>
            </div>
          ) : (
            <SidebarDragContext.Provider value={dragActivePinned}>
              <DndContext
                sensors={sensors}
                collisionDetection={sidebarCollisionDetection}
                modifiers={[restrictToVerticalAxis]}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <SortableContext items={sortableProjectIds} strategy={verticalListSortingStrategy}>
                  {displayGroups.map((group) => {
                    if (group.workspace) {
                      const workspace = group.workspace
                      return (
                        <SortableProjectContainer
                          key={group.id}
                          id={projectSortableId(workspace.id)}
                          disabled={!canReorderProjects}
                        >
                          {(projectDragActivatorProps) => (
                            <ProjectSessionGroup
                              group={{ workspace, sessions: group.sessions }}
                              activeSessionId={effectiveActiveSessionId}
                              activeWorkspaceId={effectiveActiveWorkspaceId}
                              sessionAgentStatuses={ctx.sessionAgentStatuses}
                              sessionTerminalActivity={ctx.sessionTerminalActivity}
                              unreviewedCompletedSessions={ctx.unreviewedCompletedSessions}
                              open={
                                (!collapsedProjectIds.has(workspace.id) &&
                                  !autoCollapsedProjectIds.has(projectSortableId(workspace.id))) ||
                                forcedOpenProjectIds.has(workspace.id)
                              }
                              revealSessionId={ctx.revealSessionId}
                              onSessionRevealed={ctx.clearRevealSession}
                              onOpenChange={(nextOpen) =>
                                handleProjectOpenChange(workspace.id, nextOpen)
                              }
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
                              onCommitSessionTitle={ctx.commitSessionTitle}
                              onToggleSessionPinned={ctx.handleToggleSessionPinned}
                              onArchiveSession={ctx.handleArchiveSession}
                              onDeleteSession={ctx.handleDeleteSession}
                              onCollaborate={handleCollaborateSession}
                              onAddToConversation={handleAddSessionToConversation}
                              projectDragActivatorProps={projectDragActivatorProps}
                              {...(canReorderSessions
                                ? { sessionSortProjectId: workspace.id }
                                : {})}
                            />
                          )}
                        </SortableProjectContainer>
                      )
                    }
                    const flatProjectId = getDisplayGroupProjectId(
                      group,
                      noProjectWorkspace?.id ?? null,
                    )
                    const flatDragSortableId =
                      flatProjectId == null ? null : projectSortableId(flatProjectId)
                    const flatGroup = (
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
                        open={
                          (!collapsedFlatGroupIds.has(group.id) &&
                            (flatDragSortableId == null ||
                              !autoCollapsedProjectIds.has(flatDragSortableId))) ||
                          forcedOpenFlatGroupIds.has(group.id)
                        }
                        revealSessionId={ctx.revealSessionId}
                        onSessionRevealed={ctx.clearRevealSession}
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
                        pinned={
                          group.id === 'project:no-project'
                            ? (noProjectWorkspace?.pinnedAt ?? null) != null
                            : undefined
                        }
                        onTogglePinned={
                          group.id === 'project:no-project' && noProjectWorkspace != null
                            ? () => {
                                void ctx.handleToggleProjectPinned(noProjectWorkspace)
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
                                {
                                  icon:
                                    noProjectWorkspace.pinnedAt != null ? (
                                      <PinOff size={14} />
                                    ) : (
                                      <Pin size={14} />
                                    ),
                                  label:
                                    noProjectWorkspace.pinnedAt != null
                                      ? t('sidebar.group.unpin')
                                      : t('sidebar.group.pin'),
                                  onClick: () => {
                                    void ctx.handleToggleProjectPinned(noProjectWorkspace)
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
                          // 删除分组：与其他项目一致，把分组本身也从项目列表移除。
                          // 临时会话删除背后的 no-project workspace（连会话一起删）；
                          // 未归属会话删除组内全部会话后分组自然消失。
                          ...(group.id === 'project:no-project' && noProjectWorkspace != null
                            ? [
                                {
                                  icon: <Icons.Trash size={14} />,
                                  label: t('sidebar.noProject.delete'),
                                  danger: true,
                                  onClick: () => {
                                    void ctx.handleDeleteProject(noProjectWorkspace, {
                                      title: t('sidebar.noProject.delete'),
                                      description: t('sidebar.noProject.deleteDesc', {
                                        count: ctx.sessions.filter((session) =>
                                          session.workspaceIds.includes(noProjectWorkspace.id),
                                        ).length,
                                      }),
                                      confirmText: t('common.delete'),
                                    })
                                  },
                                },
                              ]
                            : []),
                          ...(group.id === 'project:ungrouped' && group.sessions.length > 0
                            ? [
                                {
                                  icon: <Icons.Trash size={14} />,
                                  label: t('sidebar.ungrouped.delete'),
                                  danger: true,
                                  onClick: () => {
                                    void ctx.handleClearSessions(group.sessions, {
                                      title: t('sidebar.ungrouped.delete'),
                                      description: t('sidebar.ungrouped.deleteDesc', {
                                        count: group.sessions.length,
                                      }),
                                      confirmText: t('common.delete'),
                                    })
                                  },
                                },
                              ]
                            : []),
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
                          onCommitSessionTitle: ctx.commitSessionTitle,
                          onToggleSessionPinned: ctx.handleToggleSessionPinned,
                          onArchiveSession: ctx.handleArchiveSession,
                          onDeleteSession: ctx.handleDeleteSession,
                          onCollaborate: handleCollaborateSession,
                          onAddToConversation: handleAddSessionToConversation,
                        }}
                        {...(canReorderSessions &&
                        group.id === 'project:no-project' &&
                        noProjectWorkspace != null
                          ? { sessionSortProjectId: noProjectWorkspace.id }
                          : {})}
                      />
                    )
                    if (flatProjectId == null) return flatGroup
                    return (
                      <SortableProjectContainer
                        key={group.id}
                        id={projectSortableId(flatProjectId)}
                        disabled={!canReorderProjects}
                      >
                        {(projectDragActivatorProps) =>
                          React.cloneElement(flatGroup, { projectDragActivatorProps })
                        }
                      </SortableProjectContainer>
                    )
                  })}
                </SortableContext>
              </DndContext>
            </SidebarDragContext.Provider>
          )}
        </div>

        {/* Create Project Modal */}
        {ctx.projectDialog === 'create' && (
          <CreateProjectModal
            name={ctx.projectName}
            path={ctx.projectPath}
            notice={ctx.projectNotice}
            setName={ctx.setProjectName}
            onPickPath={() => {
              void ctx.handlePickProjectPath()
            }}
            onDropPath={ctx.handleDropProjectPath}
            onCancel={() => {
              ctx.setProjectDialog(null)
            }}
            onCreate={(useTempDir?: boolean) => {
              void ctx.handleCreateProject(useTempDir)
            }}
          />
        )}
      </div>
    </SidebarProjectDropZone>
  )
}
