/**
 * SidebarSessionList — Complete conversation list extracted from ChatView.
 * Renders search, time filter, project groups, session items, and all context menus.
 */
import React, { useRef, useState, useCallback, useMemo } from 'react'
import './SidebarSessionList.less'
import type { ReactNode } from 'react'
import { Dropdown, Input } from '@lobehub/ui'
import { Icons } from './Icons'
import {
  useSessionSidebar,
  buildProjectGroups,
  type SessionSummary,
  type ProjectGroup,
} from './SessionSidebarContext'
import type {
  SessionId,
  WorkspaceInfo,
  AgentStatusValue,
} from '@spark/protocol'
import { useApp } from './AppContext'
import { HistoryImportModal } from './components/HistoryImportModal'
import {
  SidebarFilterMenu,
  DEFAULT_SIDEBAR_FILTER,
  type SidebarFilterState,
  type SidebarStatusFilter,
  type SidebarLastActivityFilter,
} from './SidebarFilterMenu'

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
  try { window.localStorage.setItem(PROJECT_COLLAPSED_KEY, JSON.stringify([...set])) } catch { /* */ }
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
  try { window.localStorage.setItem(SIDEBAR_FILTER_KEY, JSON.stringify(state)) }
  catch { /* */ }
}

/* ─── Filter helpers ─── */
function filterByStatus(sessions: SessionSummary[], status: SidebarStatusFilter): SessionSummary[] {
  if (status === 'all') return sessions
  if (status === 'archived') return sessions.filter(s => s.archivedAt != null)
  return sessions.filter(s => s.archivedAt == null)
}

function filterByLastActivity(sessions: SessionSummary[], range: SidebarLastActivityFilter): SessionSummary[] {
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
  return sessions.filter(s => s.workspaceIds.includes(projectId))
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

const DATE_GROUP_ORDER = ['今天', '昨天', '本周', '本月', '更早'] as const

function getDateGroupLabel(updatedAt: string): string {
  const then = new Date(updatedAt).getTime()
  if (!Number.isFinite(then)) return '更早'
  const now = Date.now()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  if (then >= todayMs) return '今天'
  if (then >= todayMs - dayMs) return '昨天'
  if (then >= now - 7 * dayMs) return '本周'
  if (then >= now - 30 * dayMs) return '本月'
  return '更早'
}

const STATE_GROUP_ORDER = ['运行中', '等待权限', '等待输入', '出错', '已完成', '已取消', '空闲'] as const

function getStateGroupLabel(sessionStatus: string, agentStatus?: AgentStatusValue): string {
  const display = getSessionDisplayStatus(sessionStatus, agentStatus)
  switch (display) {
    case 'running': return '运行中'
    case 'waiting_permission': return '等待权限'
    case 'waiting_user': return '等待输入'
    case 'completed': return '已完成'
    case 'error': return '出错'
    case 'cancelled': return '已取消'
    default: return '空闲'
  }
}

function buildGroupsByDate(sessions: SessionSummary[]): DisplayGroup[] {
  const buckets = new Map<string, SessionSummary[]>()
  for (const label of DATE_GROUP_ORDER) buckets.set(label, [])
  for (const s of sessions) {
    const label = getDateGroupLabel(s.updatedAt)
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(s)
  }
  return DATE_GROUP_ORDER
    .filter(label => buckets.get(label)!.length > 0)
    .map(label => ({ id: `date:${label}`, label, sessions: buckets.get(label)! }))
}

function buildGroupsByState(
  sessions: SessionSummary[],
  agentStatuses: Record<string, AgentStatusValue>,
): DisplayGroup[] {
  const buckets = new Map<string, SessionSummary[]>()
  for (const label of STATE_GROUP_ORDER) buckets.set(label, [])
  for (const s of sessions) {
    const label = getStateGroupLabel(s.status, agentStatuses[s.id])
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(s)
  }
  return STATE_GROUP_ORDER
    .filter(label => buckets.get(label)!.length > 0)
    .map(label => ({ id: `state:${label}`, label, sessions: buckets.get(label)! }))
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
  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时`
  if (diffMs < week) return `${Math.floor(diffMs / day)} 天`
  return `${Math.floor(diffMs / week)} 周`
}

function getSessionDisplayStatus(
  sessionStatus: string,
  agentStatus?: AgentStatusValue
): 'running' | 'waiting_permission' | 'waiting_user' | 'completed' | 'error' | 'cancelled' | 'idle' {
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

function getStatusBadgeInfo(status: 'running' | 'waiting_permission' | 'waiting_user' | 'completed' | 'error' | 'cancelled' | 'idle'): {
  className: string
  icon: React.ReactNode
  title: string
  animate?: boolean
} {
  switch (status) {
    case 'running':
      return {
        className: 'session-badge-running',
        icon: <Icons.Spinner size={11} className="animate-spin" />,
        title: '运行中',
        animate: true,
      }
    case 'waiting_permission':
      return {
        className: 'session-badge-waiting-permission',
        icon: <Icons.Shield size={10} />,
        title: '等待权限审批',
        animate: true,
      }
    case 'waiting_user':
      return {
        className: 'session-badge-waiting-user',
        icon: <Icons.Cursor size={10} />,
        title: '等待输入',
        animate: true,
      }
    case 'completed':
      return {
        className: 'session-badge-completed',
        icon: <Icons.Check size={10} />,
        title: '已完成',
      }
    case 'error':
      return {
        className: 'session-badge-error',
        icon: <Icons.X size={10} />,
        title: '运行失败',
      }
    case 'cancelled':
      return {
        className: 'session-badge-cancelled',
        icon: <Icons.Stop size={10} />,
        title: '已取消',
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
      {items.map(item => (
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
  unreviewed,
  onClick,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  session: SessionSummary
  active: SessionId | null
  agentStatus?: AgentStatusValue | undefined
  unreviewed?: boolean
  onClick: (id: SessionId) => void
  onRename?: (session: SessionSummary) => void
  onTogglePinned?: (session: SessionSummary) => void
  onArchive?: (session: SessionSummary) => void
  onDelete?: (session: SessionSummary) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const { workspaces } = useSessionSidebar()
  // 该会话若运行在隔离 worktree 中，取其分支名用于显示分支图标指示符
  const worktreeBranch = useMemo(() => {
    const wsId = s.workspaceIds[0]
    if (wsId == null) return undefined
    return workspaces.find(w => w.id === wsId)?.worktreeMeta?.branch
  }, [s.workspaceIds, workspaces])
  const displayStatus = useMemo(
    () => getSessionDisplayStatus(s.status, agentStatus),
    [s.status, agentStatus]
  )
  const badgeInfo = useMemo(() => getStatusBadgeInfo(displayStatus), [displayStatus])

  const statusClass = displayStatus !== 'idle' ? `is-${displayStatus}` : ''

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
        <div className="chat-item-title-compact">
          {(() => {
            const dotStatus =
              displayStatus === 'waiting_permission' || displayStatus === 'waiting_user'
                ? displayStatus
                : displayStatus === 'error'
                  ? 'error'
                : displayStatus === 'completed' && unreviewed
                  ? 'completed'
                  : null
            return dotStatus ? (
              <span
                className={`session-status-dot session-status-dot-${dotStatus}`}
                title={dotStatus === 'completed' ? '新完成，未查看' : badgeInfo.title}
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
              title={`worktree 分支：${worktreeBranch}`}
              aria-label="worktree 分支"
            >
              <Icons.GitBranch size={11} />
            </span>
          )}
          <span className="truncate">{s.title || '新会话'}</span>
        </div>
        {displayStatus !== 'idle' && badgeInfo.icon ? (
          <span
            className={`session-status-badge ${badgeInfo.className}`}
            title={badgeInfo.title}
          >
            {badgeInfo.icon}
            <span>{badgeInfo.title}</span>
          </span>
        ) : (
          <span className="chat-item-time-compact">{formatRelativeTime(s.updatedAt)}</span>
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
            popupRender={() => (
              <ActionMenu
                onAction={() => setMenuOpen(false)}
                items={[
                  { icon: <Icons.Pin size={14} />, label: s.pinnedAt == null ? '置顶会话' : '取消置顶', onClick: () => onTogglePinned?.(s) },
                  { icon: <Icons.Edit size={14} />, label: '重命名会话', onClick: () => onRename?.(s) },
                  { icon: <Icons.Box size={14} />, label: '归档会话', onClick: () => onArchive?.(s) },
                  { icon: <Icons.Trash size={14} />, label: '删除会话', danger: true, onClick: () => onDelete?.(s) },
                ]}
              />
            )}
          >
            <button
              className="icon-btn item-menu-btn"
              title="会话操作"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <Icons.More size={13} />
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
  unreviewedCompletedSessions,
  filterSlot,
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
  unreviewedCompletedSessions: Set<string>
  filterSlot?: ReactNode
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
  const [open, setOpen] = useState(() => !getCollapsedProjects().has(group.workspace.id))
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
          setOpen(prev => {
            const next = !prev
            setProjectCollapsed(group.workspace.id, !next)
            return next
          })
          void onSelectWorkspace(group.workspace)
        }}
      >
        <span
          className="proj-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(prev => {
              const next = !prev
              setProjectCollapsed(group.workspace.id, !next)
              return next
            })
          }}
          role="button"
          aria-label={open ? '折叠项目' : '展开项目'}
          title={open ? '折叠项目' : '展开项目'}
        >
          {open ? <Icons.ChevronDown className="chev" size={12} /> : <Icons.ChevronRight className="chev" size={12} />}
        </span>
        {group.workspace.pinnedAt != null && <Icons.Pin size={12} className="pinned-icon" />}
        <span className="proj-name">{group.workspace.name}</span>
        <span className="proj-count">{group.sessions.length}</span>
        <button
          className="icon-btn proj-add-session-btn"
          title="新建此项目的会话"
          onClick={e => { e.stopPropagation(); onNewSession(group.workspace.id) }}
        >
          <Icons.Plus size={12} />
        </button>
        <div className={`item-menu-wrap${menuOpen ? ' menu-open' : ''}`}>
          <Dropdown
            menu={{ items: [] }}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={['click']}
            placement="topRight"
            popupRender={() => (
              <ActionMenu
                onAction={() => setMenuOpen(false)}
                items={[
                  { icon: <Icons.Pin size={14} />, label: group.workspace.pinnedAt == null ? '置顶项目' : '取消置顶', onClick: () => onToggleProjectPinned(group.workspace) },
                  { icon: <Icons.Folder size={14} />, label: '在文件夹中打开', onClick: () => onOpenProjectFolder(group.workspace) },
                  { icon: <Icons.Edit size={14} />, label: '重命名项目', onClick: () => onRenameProject(group.workspace) },
                  { icon: <Icons.Box size={14} />, label: '归档项目', onClick: () => onArchiveProject(group.workspace) },
                  { icon: <Icons.Trash size={14} />, label: '删除项目', danger: true, onClick: () => onDeleteProject(group.workspace) },
                ]}
              />
            )}
          >
            <button
              className="icon-btn item-menu-btn"
              title="项目操作"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <Icons.More size={13} />
            </button>
          </Dropdown>
        </div>
        {filterSlot}

      </div>
      {open && (
        <div className="proj-sessions">
          {sessions.length === 0 ? (
            <button className="proj-session-empty" onClick={() => onNewSession(group.workspace.id)}>
              <Icons.Plus size={12} />
              新建此项目的会话
            </button>
          ) : (
            <>
              {visibleSessions.map(session => (
                <ChatListItem
                  key={session.id}
                  session={session}
                  active={activeSessionId}
                  agentStatus={sessionAgentStatuses[session.id]}
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
                  onClick={() => setShowAllSessions(prev => !prev)}
                >
                  {showAllSessions ? (
                    <span className="proj-show-more-label">收起</span>
                  ) : (
                    <>
                      <span className="proj-show-more-label">显示更多</span>
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
  label,
  sessions,
  activeSessionId,
  sessionAgentStatuses,
  unreviewedCompletedSessions,
  actions,
}: {
  label: string
  sessions: SessionSummary[]
  activeSessionId: SessionId | null
  sessionAgentStatuses: Record<string, AgentStatusValue>
  unreviewedCompletedSessions: Set<string>
  actions: FlatGroupActions
}) {
  if (sessions.length === 0) return null
  return (
    <div className="proj-group flat-group">
      <div className="proj-head flat-group-head">
        <span className="proj-name">{label}</span>
        <span className="proj-count">{sessions.length}</span>
      </div>
      <div className="proj-sessions">
        {sessions.map(session => (
          <ChatListItem
            key={session.id}
            session={session}
            active={activeSessionId}
            agentStatus={sessionAgentStatuses[session.id]}
            unreviewed={unreviewedCompletedSessions.has(session.id)}
            onClick={() => actions.onSelectSession(session)}
            onRename={actions.onRenameSession}
            onTogglePinned={actions.onToggleSessionPinned}
            onArchive={actions.onArchiveSession}
            onDelete={actions.onDeleteSession}
          />
        ))}
      </div>
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
  return (
    <div className="modal-backdrop">
      <div className="modal project-modal">
        <div className="modal-h">
          <div className="modal-h-icon"><Icons.Folder size={17} /></div>
          <div>
            <div className="modal-title">新建项目</div>
            <div className="modal-subtitle">选择一个本地文件夹作为项目地址，或直接创建一个空项目。</div>
          </div>
        </div>
        <div className="modal-body">
          {notice && (
            <div className="session-notice in-modal"><Icons.AlertTriangle size={12} /><span>{notice}</span></div>
          )}
          <label className="field">
            <span>项目名称</span>
            <Input value={name} placeholder="例如 Spark-Agent" onChange={e => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>项目文件夹地址（可选）</span>
            <div className="path-picker">
              <Input value={path} placeholder="/Users/you/projects/my-agent" onChange={e => setPath(e.target.value)} />
              <button className="btn ghost sm" onClick={onPickPath}>选择</button>
            </div>
            <div className="field-hint">留空则自动在临时目录创建项目文件夹</div>
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn ghost sm" onClick={() => onCreate(true)}>新建空项目</button>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onCancel}>取消</button>
          <button className="btn primary sm" onClick={() => onCreate(false)}>创建项目</button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   Main exported component
   ============================================================ */
export function SidebarSessionList() {
  const ctx = useSessionSidebar()
  const { t, setTweak } = useApp()

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

  // Active session/workspace highlighting only applies while the chat view is
  // mounted. When the user navigates to Board/Agents/Settings/etc., the sidebar
  // should not show any session as "selected" because none is being edited.
  const isChatView = t.view === 'chat'
  const effectiveActiveSessionId = isChatView ? ctx.activeSessionId : null
  const effectiveActiveWorkspaceId = isChatView ? ctx.activeWorkspaceId : null

  // Apply status / project / lastActivity filters
  const filteredSessions = useMemo(
    () => applySessionFilters(ctx.sessions, filter),
    [ctx.sessions, filter],
  )

  // Build display groups based on groupBy mode
  const displayGroups = useMemo<DisplayGroup[]>(() => {
    if (filter.groupBy === 'date') return buildGroupsByDate(filteredSessions)
    if (filter.groupBy === 'state') {
      return buildGroupsByState(filteredSessions, ctx.sessionAgentStatuses)
    }
    if (filter.groupBy === 'none') {
      return [{ id: 'none:all', label: '所有会话', sessions: filteredSessions }]
    }
    // 'project' mode: each workspace is its own group
    const projectGroups = buildProjectGroups(ctx.workspaces, filteredSessions)
    const noProjectWorkspace = ctx.noProjectWorkspace
    const noProject = noProjectWorkspace
      ? filteredSessions.filter(s => s.workspaceIds.includes(noProjectWorkspace.id))
      : []
    const ungrouped = filteredSessions.filter(s => s.workspaceIds.length === 0)
    const list: DisplayGroup[] = projectGroups.map(g => ({
      id: `project:${g.workspace.id}`,
      label: g.workspace.name,
      sessions: g.sessions,
      workspace: g.workspace,
    }))
    if (noProject.length > 0) {
      list.push({ id: 'project:no-project', label: '无项目对话', sessions: noProject })
    }
    if (ungrouped.length > 0) {
      list.push({ id: 'project:ungrouped', label: '未归属会话', sessions: ungrouped })
    }
    return list
  }, [filter.groupBy, filteredSessions, ctx.workspaces, ctx.noProjectWorkspace, ctx.sessionAgentStatuses])

  const showGlobalFilterBar = filter.groupBy !== 'project'
  const filterSlot = (
    <SidebarFilterMenu
      state={filter}
      workspaces={ctx.workspaces}
      onChange={handleFilterChange}
      onClear={handleFilterClear}
    />
  )

  return (
    <div className="sidebar-session-list-inner">
      {/* Current session params panel 已移除 — 权限/推理控制在 ChatView Composer param bar 中 */}

      {/* Session list */}
      <div className="chat-list scroll">
        {notice && (
          <div className="session-notice">
            <Icons.AlertTriangle size={12} />
            <span>{notice}</span>
            <button className="icon-btn" onClick={() => setNotice('')}><Icons.X size={10} /></button>
          </div>
        )}

        {/* Global filter bar — when not in project-grouping mode */}
        {showGlobalFilterBar && ctx.sessions.length > 0 && (
          <div className="sidebar-global-filter-bar">
            {filterSlot}
          </div>
        )}

        {ctx.workspaces.length === 0 && ctx.sessions.length === 0 ? (
          <div className="empty-compact">
            <div className="empty-icon"><Icons.Folder size={18} /></div>
            <div className="empty-title">还没有项目</div>
            <div className="empty-desc">先打开已有文件夹，或新建一个项目文件夹</div>
            <button
              className="empty-import-btn"
              onClick={() => ctx.setHistoryImportOpen(true)}
            >
              <Icons.Download size={12} />
              导入已有对话历史
            </button>
          </div>
        ) : displayGroups.length === 0 ? (
          <div className="empty-compact">
            <div className="empty-icon"><Icons.Sliders size={18} /></div>
            <div className="empty-title">没有匹配的会话</div>
            <div className="empty-desc">试试调整筛选条件或清空过滤器</div>
          </div>
        ) : (
          <>
            {displayGroups.map((group, idx) => {
              if (group.workspace) {
                return (
                  <ProjectSessionGroup
                    key={group.id}
                    group={{ workspace: group.workspace, sessions: group.sessions }}
                    activeSessionId={effectiveActiveSessionId}
                    activeWorkspaceId={effectiveActiveWorkspaceId}
                    sessionAgentStatuses={ctx.sessionAgentStatuses}
                    unreviewedCompletedSessions={ctx.unreviewedCompletedSessions}
                    filterSlot={idx === 0 ? filterSlot : undefined}
                    onSelectWorkspace={async (workspace) => {
                      ctx.setActiveWorkspace(workspace.id)
                      await ctx.handleOpenWorkspace(workspace)
                      setTweak('view', 'chat')
                    }}
                    onSelectSession={(session) => {
                      ctx.setActiveSession(session.id)
                      ctx.setActiveWorkspace(group.workspace!.id)
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
                  label={group.label}
                  sessions={group.sessions}
                  activeSessionId={effectiveActiveSessionId}
                  sessionAgentStatuses={ctx.sessionAgentStatuses}
                  unreviewedCompletedSessions={ctx.unreviewedCompletedSessions}
                  actions={{
                    onSelectSession: (session) => {
                      ctx.setActiveSession(session.id)
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
          onPickPath={() => { void ctx.handlePickProjectPath() }}
          onCancel={() => { ctx.setProjectDialog(null) }}
          onCreate={(useTempDir?: boolean) => { void ctx.handleCreateProject(useTempDir) }}
        />
      )}

      {/* 导入宿主机对话历史 */}
      <HistoryImportModal />
    </div>
  )
}
