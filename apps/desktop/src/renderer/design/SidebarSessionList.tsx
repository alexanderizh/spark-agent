/**
 * SidebarSessionList — Complete conversation list extracted from ChatView.
 * Renders search, time filter, project groups, session items, and all context menus.
 */
import React, { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@spark/ui-kit'
import { Icons } from './Icons'
import { SparkInput } from './components/FormControls'
import {
  useSessionSidebar,
  filterSessionsByTime,
  buildProjectGroups,
  type SessionSummary,
  type ProjectGroup,
  type TimeFilter,
} from './SessionSidebarContext'
import type { SessionId, WorkspaceInfo } from '@spark/protocol'
import { useApp } from './AppContext'

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

/* ─── ActionMenu ─── */
function ActionMenu({
  items,
}: {
  items: Array<{ icon: ReactNode; label: string; danger?: boolean; onClick: () => void }>
}) {
  return (
    <DropdownMenuContent align="end" side="bottom" className="action-menu">
      {items.map(item => (
        <DropdownMenuItem
          key={item.label}
          danger={item.danger}
          onSelect={() => {
            item.onClick()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  )
}

/* ─── TimeFilterDropdown ─── */
function TimeFilterDropdown({ value, onChange }: { value: TimeFilter; onChange: (v: TimeFilter) => void }) {
  const [open, setOpen] = useState(false)
  const options: Array<{ value: TimeFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: '1d', label: '最近 1 天' },
    { value: '3d', label: '最近 3 天' },
    { value: '7d', label: '最近 7 天' },
    { value: '10d', label: '最近 10 天' },
  ]
  const currentLabel = options.find(o => o.value === value)?.label ?? '全部会话'
  return (
    <div className="session-filter-bar">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button className={`filter-trigger${value !== 'all' ? ' has-filter' : ''}`} aria-label="筛选会话">
            <span>{currentLabel}</span>
            <Icons.ChevronDown size={12} className={`filter-chevron${open ? ' open' : ''}`} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          className="filter-dropdown"
          style={{ minWidth: 'var(--radix-dropdown-menu-trigger-width)' }}
        >
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as TimeFilter)}>
            {options.map(option => (
              <DropdownMenuRadioItem
              key={option.value}
                value={option.value}
                className={`filter-option${value === option.value ? ' active' : ''}`}
                onSelect={() => setOpen(false)}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/* ─── ChatListItem ─── */
function ChatListItem({
  session: s,
  active,
  onClick,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  session: SessionSummary
  active: SessionId | null
  onClick: (id: SessionId) => void
  onRename?: (session: SessionSummary) => void
  onTogglePinned?: (session: SessionSummary) => void
  onArchive?: (session: SessionSummary) => void
  onDelete?: (session: SessionSummary) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isRunning = s.status === 'running'
  return (
    <div
      className={`chat-item proj-session chat-item-compact ${active === s.id ? 'active' : ''} ${isRunning ? 'is-running' : ''}`}
      onClick={() => onClick(s.id)}
    >
      <div className="chat-item-row">
        <div className="chat-item-title-compact">
          {s.pinnedAt != null && <Icons.Pin size={11} className="pinned-icon" />}
          <span className="truncate">{s.title || '新会话'}</span>
        </div>
        {isRunning ? (
          <span className="session-running-badge" title="运行中"><Icons.Spinner size={11} /><span>运行中</span></span>
        ) : (
          <span className="chat-item-time-compact">{formatRelativeTime(s.updatedAt)}</span>
        )}
        <div className="item-menu-wrap">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button className="icon-btn item-menu-btn" title="会话操作" onClick={e => e.stopPropagation()}>
                <Icons.More size={13} />
              </button>
            </DropdownMenuTrigger>
            <ActionMenu
              items={[
                { icon: <Icons.Pin size={14} />, label: s.pinnedAt == null ? '置顶会话' : '取消置顶', onClick: () => onTogglePinned?.(s) },
                { icon: <Icons.Edit size={14} />, label: '重命名会话', onClick: () => onRename?.(s) },
                { icon: <Icons.Box size={14} />, label: '归档会话', onClick: () => onArchive?.(s) },
                { icon: <Icons.Trash size={14} />, label: '删除会话', danger: true, onClick: () => onDelete?.(s) },
              ]}
            />
          </DropdownMenu>
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
        <span className="proj-toggle">
          {open ? <Icons.ChevronDown className="chev" size={12} /> : <Icons.ChevronRight className="chev" size={12} />}
        </span>
        {open ? <Icons.FolderOpen size={17} className="proj-folder-icon" /> : <Icons.ProjectFolder size={17} className="proj-folder-icon" />}
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
        <div className="item-menu-wrap">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button className="icon-btn item-menu-btn" title="项目操作" onClick={e => e.stopPropagation()}>
                <Icons.More size={13} />
              </button>
            </DropdownMenuTrigger>
            <ActionMenu
              items={[
                { icon: <Icons.Pin size={14} />, label: group.workspace.pinnedAt == null ? '置顶项目' : '取消置顶', onClick: () => onToggleProjectPinned(group.workspace) },
                { icon: <Icons.Folder size={14} />, label: '在文件夹中打开', onClick: () => onOpenProjectFolder(group.workspace) },
                { icon: <Icons.Edit size={14} />, label: '重命名项目', onClick: () => onRenameProject(group.workspace) },
                { icon: <Icons.Box size={14} />, label: '归档项目', onClick: () => onArchiveProject(group.workspace) },
                { icon: <Icons.Trash size={14} />, label: '删除项目', danger: true, onClick: () => onDeleteProject(group.workspace) },
              ]}
            />
          </DropdownMenu>
        </div>
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
                  onClick={() => onSelectSession(session)}
                  onRename={onRenameSession}
                  onTogglePinned={onToggleSessionPinned}
                  onArchive={onArchiveSession}
                  onDelete={onDeleteSession}
                  onOpenFolder={onOpenSessionFolder}
                />
              ))}
              {hasMore && !showAllSessions && (
                <button
                  className="proj-show-more-btn"
                  onClick={() => setShowAllSessions(true)}
                >
                  ...更多 {sessions.length - MAX_VISIBLE}
                </button>
              )}
            </>
          )}
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
            <SparkInput value={name} placeholder="例如 Spark-Agent" onChange={e => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>项目文件夹地址（可选）</span>
            <div className="path-picker">
              <SparkInput value={path} placeholder="/Users/you/projects/my-agent" onChange={e => setPath(e.target.value)} />
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
  const { setTweak } = useApp()

  // Time filter
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  // Notice
  const [notice, setNotice] = useState('')

  // "New blank session" — clears active, enters no-project empty state
  const handleNewBlankSession = useCallback(() => {
    ctx.setActiveSession(null)
    ctx.setActiveWorkspace(null)
    setTweak('view', 'chat')
  }, [ctx, setTweak])

  // Time-filtered sessions
  const visibleSessions = filterSessionsByTime(ctx.sessions, timeFilter)
  const projectGroups = buildProjectGroups(ctx.workspaces, visibleSessions)
  const noProjectWorkspace = ctx.noProjectWorkspace
  const noProjectSessions = noProjectWorkspace
    ? visibleSessions.filter(s => s.workspaceIds.includes(noProjectWorkspace.id))
    : []
  const ungroupedSessions = visibleSessions.filter(s => s.workspaceIds.length === 0)

  return (
    <div className="sidebar-session-list-inner">
      {/* Header: filter + action buttons — hidden */}

      {/* Session list */}
      <div className="chat-list scroll">
        {notice && (
          <div className="session-notice">
            <Icons.AlertTriangle size={12} />
            <span>{notice}</span>
            <button className="icon-btn" onClick={() => setNotice('')}><Icons.X size={10} /></button>
          </div>
        )}
        {ctx.workspaces.length === 0 && ctx.sessions.length === 0 ? (
          <div className="empty-compact">
            <div className="empty-icon"><Icons.Folder size={18} /></div>
            <div className="empty-title">还没有项目</div>
            <div className="empty-desc">先打开已有文件夹，或新建一个项目文件夹</div>
          </div>
        ) : (
          <>
                {projectGroups.map(group => (
                  <ProjectSessionGroup
                    key={group.workspace.id}
                    group={group}
                    activeSessionId={ctx.activeSessionId}
                    activeWorkspaceId={ctx.activeWorkspaceId}
                    onSelectWorkspace={async (workspace) => {
                      ctx.setActiveWorkspace(workspace.id)
                      await ctx.handleOpenWorkspace(workspace)
                      setTweak('view', 'chat')
                    }}
                    onSelectSession={(session) => {
                      ctx.setActiveSession(session.id)
                      ctx.setActiveWorkspace(group.workspace.id)
                      setTweak('view', 'chat')
                    }}
                    onNewSession={(workspaceId) => { void ctx.handleNewSession(workspaceId) }}
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
                ))}
                {noProjectSessions.length > 0 && (
                  <div className="proj-group">
                    <div className="chat-list-section-h">无项目对话</div>
                    {noProjectSessions.map(session => (
                      <ChatListItem
                        key={session.id}
                        session={session}
                        active={ctx.activeSessionId}
                        onClick={(id) => {
                          ctx.setActiveSession(id)
                          if (noProjectWorkspace) ctx.setActiveWorkspace(noProjectWorkspace.id)
                          setTweak('view', 'chat')
                        }}
                        onRename={ctx.handleRenameSession}
                        onTogglePinned={ctx.handleToggleSessionPinned}
                        onArchive={ctx.handleArchiveSession}
                        onDelete={ctx.handleDeleteSession}
                      />
                    ))}
                  </div>
                )}
                {ungroupedSessions.length > 0 && (
                  <div className="proj-group">
                    <div className="chat-list-section-h">未归属会话</div>
                    {ungroupedSessions.map(session => (
                      <ChatListItem
                        key={session.id}
                        session={session}
                        active={ctx.activeSessionId}
                        onClick={(id) => { ctx.setActiveSession(id); setTweak('view', 'chat') }}
                        onRename={ctx.handleRenameSession}
                        onTogglePinned={ctx.handleToggleSessionPinned}
                        onArchive={ctx.handleArchiveSession}
                        onDelete={ctx.handleDeleteSession}
                      />
                    ))}
                  </div>
                )}
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
    </div>
  )
}
