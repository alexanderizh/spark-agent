/**
 * ChatView — 真实 IPC 驱动的会话视图
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { ErrorCard } from '../ChatInteractions'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { MessageBuilder } from '../services/event-mapper'
import { useToast } from '../components/Toast'
import type { UIMessage, UIBlock } from '../services/event-mapper'
import type { SessionListResponse, SessionId, SessionSearchResult, WorkspaceInfo } from '@spark/protocol'

type SessionSummary = SessionListResponse['sessions'][number]

type ProjectGroup = {
  workspace: WorkspaceInfo
  sessions: SessionSummary[]
}

type TimeFilter = 'all' | '1d' | '3d' | '7d' | '10d'

export function ChatView() {
  const [active, setActive] = useState<SessionId | null>(null)
  const [showInspector, setShowInspector] = useState(true)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<string>('')
  const [projectDialog, setProjectDialog] = useState<'create' | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [notice, setNotice] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const { toast } = useToast()

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SessionSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: searchSessions } = useIpcInvoke('session:search')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: deleteSession } = useIpcInvoke('session:delete')
  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: updateWorkspace } = useIpcInvoke('workspace:update')
  const { invoke: deleteWorkspace } = useIpcInvoke('workspace:delete')
  const { invoke: openWorkspaceFolder } = useIpcInvoke('workspace:open-folder')
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

  const refreshProjectsAndSessions = useCallback(async () => {
    const [workspaceRes, sessionRes, currentRes] = await Promise.all([
      listWorkspaces({ limit: 100 }),
      listSessions({ limit: 200 }),
      getCurrentWorkspace({}),
    ])
    setWorkspaces(workspaceRes.workspaces)
    setSessions(sessionRes.sessions)
    setActiveWorkspaceId((prev) => currentRes.workspace?.id ?? prev ?? workspaceRes.workspaces[0]?.id ?? null)
  }, [getCurrentWorkspace, listSessions, listWorkspaces])

  const refreshSessions = () => {
    refreshProjectsAndSessions().catch(console.error)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshProjectsAndSessions().catch(console.error)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshProjectsAndSessions])

  // Debounced search handler
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    if (!value.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchSessions({ query: value.trim(), limit: 20 })
        setSearchResults(res.results)
      } catch (err) {
        console.error('搜索失败', err)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
  }, [searchSessions])

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  const handleNewSession = async (workspaceId = activeWorkspaceId) => {
    try {
      setNotice('')
      if (workspaceId == null) {
        setProjectDialog('create')
        toast.warning('请先创建或打开一个项目，然后再在项目下新建会话。')
        return
      }
      const provRes = await listProviders({})
      const profile = provRes.profiles[0]
      if (!profile) {
        alert('请先在设置中配置 Provider')
        return
      }
      const workspace = workspaces.find((item) => item.id === workspaceId)
      const res = await createSession({
        providerProfileId: profile.id,
        workspaceId,
        title: workspace == null ? '新会话' : `${workspace.name} 会话`,
      })
      refreshSessions()
      setActive(res.sessionId)
      setActiveWorkspaceId(workspaceId)
    } catch (err) {
      console.error('创建会话失败', err)
      toast.error(err instanceof Error ? err.message : '创建会话失败')
    }
  }

  const handleOpenExistingProject = async () => {
    try {
      setNotice('')
      const selected = await openDirectoryDialog({ title: '选择已有项目文件夹' })
      if (selected.canceled || selected.filePath == null) return
      const res = await openWorkspace({ rootPath: selected.filePath })
      setActiveWorkspaceId(res.workspace.id)
      await refreshProjectsAndSessions()
    } catch (err) {
      console.error('打开项目失败', err)
      toast.error(err instanceof Error ? err.message : '打开项目失败')
    }
  }

  const handlePickProjectPath = async () => {
    try {
      const selected = await openDirectoryDialog({ title: '选择或创建项目文件夹' })
      if (selected.canceled || selected.filePath == null) return
      setProjectPath(selected.filePath)
      if (!projectName.trim()) setProjectName(getBasename(selected.filePath))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '选择项目路径失败')
    }
  }

  const handleCreateProject = async () => {
    const rootPath = projectPath.trim()
    const name = projectName.trim() || getBasename(rootPath)
    if (!rootPath) {
      toast.warning('请输入或选择项目文件夹地址。')
      return
    }

    try {
      setNotice('')
      const res = await openWorkspace({ create: { name, rootPath } })
      setProjectDialog(null)
      setProjectName('')
      setProjectPath('')
      setActiveWorkspaceId(res.workspace.id)
      await refreshProjectsAndSessions()
    } catch (err) {
      console.error('创建项目失败', err)
      toast.error(err instanceof Error ? err.message : '创建项目失败')
    }
  }

  const handleSelectSearchResult = (sessionId: SessionId) => {
    setActive(sessionId)
    setSearchQuery('')
    setSearchResults([])
  }

  const handleRenameProject = async (workspace: WorkspaceInfo) => {
    const name = window.prompt('重命名项目', workspace.name)?.trim()
    if (!name || name === workspace.name) return
    try {
      await updateWorkspace({ workspaceId: workspace.id, name })
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名项目失败')
    }
  }

  const handleToggleProjectPinned = async (workspace: WorkspaceInfo) => {
    try {
      await updateWorkspace({ workspaceId: workspace.id, pinned: workspace.pinnedAt == null })
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新项目置顶失败')
    }
  }

  const handleArchiveProject = async (workspace: WorkspaceInfo) => {
    if (!window.confirm(`归档项目「${workspace.name}」？归档后会从当前列表隐藏。`)) return
    try {
      await updateWorkspace({ workspaceId: workspace.id, archived: true })
      if (activeWorkspaceId === workspace.id) {
        setActiveWorkspaceId(null)
        setActive(null)
      }
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '归档项目失败')
    }
  }

  const handleDeleteProject = async (workspace: WorkspaceInfo) => {
    if (!window.confirm(`删除项目「${workspace.name}」及其会话记录？本地文件夹不会被删除。`)) return
    try {
      const res = await deleteWorkspace({ workspaceId: workspace.id })
      if (activeWorkspaceId === workspace.id || (active != null && res.deletedSessionIds.includes(active))) {
        setActiveWorkspaceId(null)
        setActive(null)
      }
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除项目失败')
    }
  }

  const handleOpenProjectFolder = async (workspace: WorkspaceInfo) => {
    try {
      await openWorkspaceFolder({ workspaceId: workspace.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件夹失败')
    }
  }

  const handleRenameSession = async (session: SessionSummary) => {
    const title = window.prompt('重命名会话', session.title || '新会话')?.trim()
    if (!title || title === session.title) return
    try {
      await updateSession({ sessionId: session.id, title })
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重命名会话失败')
    }
  }

  const handleToggleSessionPinned = async (session: SessionSummary) => {
    try {
      await updateSession({ sessionId: session.id, pinned: session.pinnedAt == null })
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新会话置顶失败')
    }
  }

  const handleArchiveSession = async (session: SessionSummary) => {
    if (!window.confirm(`归档会话「${session.title || '新会话'}」？归档后会从当前列表隐藏。`)) return
    try {
      await updateSession({ sessionId: session.id, archived: true })
      if (active === session.id) setActive(null)
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '归档会话失败')
    }
  }

  const handleDeleteSession = async (session: SessionSummary) => {
    if (!window.confirm(`删除会话「${session.title || '新会话'}」？`)) return
    try {
      await deleteSession({ sessionId: session.id })
      if (active === session.id) setActive(null)
      await refreshProjectsAndSessions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除会话失败')
    }
  }

  const handleOpenSessionFolder = async (session: SessionSummary) => {
    const workspaceId = session.workspaceIds[0]
    if (workspaceId == null) {
      toast.warning('该会话未关联项目文件夹。')
      return
    }

    try {
      await openWorkspaceFolder({ workspaceId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开文件夹失败')
    }
  }

  const showSearchResults = searchQuery.trim().length > 0
  const visibleSessions = filterSessionsByTime(sessions, timeFilter)
  const projectGroups = buildProjectGroups(workspaces, visibleSessions)
  const ungroupedSessions = visibleSessions.filter((session) => session.workspaceIds.length === 0)
  const activeSession = sessions.find(s => s.id === active) ?? null
  const activeWorkspace = activeWorkspaceId == null ? null : workspaces.find((item) => item.id === activeWorkspaceId) ?? null

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <div className="chat-sidebar-head">
          <div className="search-input">
            <Icons.Search />
            <input
              placeholder="搜索会话..."
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
            />
            {isSearching && <Icons.Spinner size={12} className="search-spinner" />}
            {searchQuery && !isSearching && (
              <button
                className="icon-btn search-clear-btn"
                onClick={() => handleSearchChange('')}
              >
                <Icons.X size={10} />
              </button>
            )}
          </div>
          <button className="icon-btn" title="打开已有项目" onClick={handleOpenExistingProject}><Icons.Folder /></button>
          <button className="icon-btn" title="新建会话" onClick={() => void handleNewSession()}><Icons.Plus /></button>
        </div>

        {showSearchResults ? (
          <div className="chat-list scroll">
            {searchResults.length === 0 && !isSearching ? (
              <div className="empty-compact">
                <div className="empty-icon"><Icons.Search size={18} /></div>
                <div className="empty-title">未找到匹配的会话</div>
                <div className="empty-desc">尝试其他关键词</div>
              </div>
            ) : (
              searchResults.map(r => (
                <SearchResultItem
                  key={r.sessionId}
                  result={r}
                  query={searchQuery.trim()}
                  active={active}
                  onClick={handleSelectSearchResult}
                />
              ))
            )}
          </div>
        ) : (
          <>
            <TimeFilterBar value={timeFilter} onChange={setTimeFilter} />

            <div className="chat-list scroll">
              {notice && (
                <div className="session-notice">
                  <Icons.AlertTriangle size={12} />
                  <span>{notice}</span>
                  <button className="icon-btn" onClick={() => setNotice('')}><Icons.X size={10} /></button>
                </div>
              )}
              {workspaces.length === 0 && sessions.length === 0 ? (
                <div className="empty-compact">
                  <div className="empty-icon"><Icons.Folder size={18} /></div>
                  <div className="empty-title">还没有项目</div>
                  <div className="empty-desc">先打开已有文件夹，或新建一个项目文件夹</div>
                </div>
              ) : (
                <>
                  {projectGroups.map((group) => (
                    <ProjectSessionGroup
                      key={group.workspace.id}
                      group={group}
                      activeSessionId={active}
                      activeWorkspaceId={activeWorkspaceId}
                      onSelectWorkspace={async (workspace) => {
                        setActiveWorkspaceId(workspace.id)
                        await openWorkspace({ rootPath: workspace.rootPath })
                      }}
                      onSelectSession={(session) => {
                        setActive(session.id)
                        setActiveWorkspaceId(group.workspace.id)
                      }}
                      onNewSession={(workspaceId) => void handleNewSession(workspaceId)}
                      onRenameProject={handleRenameProject}
                      onToggleProjectPinned={handleToggleProjectPinned}
                      onArchiveProject={handleArchiveProject}
                      onDeleteProject={handleDeleteProject}
                      onOpenProjectFolder={handleOpenProjectFolder}
                      onRenameSession={handleRenameSession}
                      onToggleSessionPinned={handleToggleSessionPinned}
                      onArchiveSession={handleArchiveSession}
                      onDeleteSession={handleDeleteSession}
                      onOpenSessionFolder={handleOpenSessionFolder}
                    />
                  ))}
                  {ungroupedSessions.length > 0 && (
                    <div className="proj-group">
                      <div className="chat-list-section-h">未归属会话</div>
                      {ungroupedSessions.map((session) => (
                        <ChatListItem
                          key={session.id}
                          session={session}
                          active={active}
                          onClick={setActive}
                          onRename={handleRenameSession}
                          onTogglePinned={handleToggleSessionPinned}
                          onArchive={handleArchiveSession}
                          onDelete={handleDeleteSession}
                          onOpenFolder={handleOpenSessionFolder}
                        />
                      ))}
                    </div>
                  )}
                  <button className="proj-add" onClick={() => setProjectDialog('create')}>
                    <Icons.Plus size={13} />
                    新建项目
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="chat-main">
        <ChatTabbar
          session={activeSession}
          workspace={activeWorkspace}
          agentStatus={agentStatus}
          showInspector={showInspector}
          setShowInspector={setShowInspector}
        />
        {active ? (
          <ChatStream
            sessionId={active}
            onStatusChange={setAgentStatus}
          />
        ) : (
          <div className="chat-stream chat-stream-empty">
            <div className="empty-state">
              <div className="empty-icon"><Icons.Sparkles size={24} /></div>
              <div className="empty-title">先选择项目</div>
              <div className="empty-desc">再选择或新建一个会话开始对话</div>
            </div>
          </div>
        )}
        <Composer sessionId={active} onSent={() => {}} />
      </div>

      {showInspector && (
        <ChatInspector session={activeSession} workspace={activeWorkspace} />
      )}

      {projectDialog === 'create' && (
        <CreateProjectModal
          name={projectName}
          path={projectPath}
          notice={notice}
          setName={setProjectName}
          setPath={setProjectPath}
          onPickPath={handlePickProjectPath}
          onCancel={() => {
            setProjectDialog(null)
            setNotice('')
          }}
          onCreate={() => void handleCreateProject()}
        />
      )}
    </div>
  )
}

function SearchResultItem({ result, query, active, onClick }: {
  result: SessionSearchResult
  query: string
  active: SessionId | null
  onClick: (id: SessionId) => void
}) {
  return (
    <div
      className={`chat-item proj-session ${active === result.sessionId ? 'active' : ''}`}
      onClick={() => onClick(result.sessionId)}
    >
      <div className="chat-item-title">
        <Icons.Search size={11} className="search-result-icon" />
        <span className="truncate flex1 search-result-title">
          <HighlightText text={result.title} query={query} />
        </span>
      </div>
      {result.snippet && (
        <div className="chat-item-snippet search-result-snippet">
          <HighlightText text={result.snippet.slice(0, 120)} query={query} />
        </div>
      )}
      <div className="chat-item-meta">
        <span className="badge search-match-badge">
          {result.matchType === 'title' ? '标题匹配' : '内容匹配'}
        </span>
        <span className="chat-item-time">{new Date(result.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts: ReactNode[] = []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let lastIndex = 0
  let searchFrom = 0

  while (searchFrom < lowerText.length) {
    const idx = lowerText.indexOf(lowerQuery, searchFrom)
    if (idx === -1) break
    if (idx > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, idx)}</span>)
    }
    parts.push(
      <mark key={`h-${idx}`} className="highlight-mark">
        {text.slice(idx, idx + query.length)}
      </mark>,
    )
    lastIndex = idx + query.length
    searchFrom = lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }
  return <>{parts}</>
}

function TimeFilterBar({ value, onChange }: { value: TimeFilter; onChange: (value: TimeFilter) => void }) {
  const options: Array<{ value: TimeFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: '1d', label: '1d' },
    { value: '3d', label: '3d' },
    { value: '7d', label: '7d' },
    { value: '10d', label: '10d' },
  ]

  return (
    <div className="session-filter-bar" aria-label="按最近时间过滤会话">
      <span>最近</span>
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

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
  onOpenSessionFolder,
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
  onOpenSessionFolder: (session: SessionSummary) => void
}) {
  const [open, setOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const isActiveProject = activeWorkspaceId === group.workspace.id

  return (
    <div className={`proj-group ${isActiveProject ? 'active-project' : ''}`}>
      <div
        className="proj-head"
        onClick={() => {
          setOpen((prev) => !prev)
          void onSelectWorkspace(group.workspace)
        }}
      >
        <span className="proj-toggle">
          {open ? <Icons.ChevronDown className="chev" size={12} /> : <Icons.ChevronRight className="chev" size={12} />}
        </span>
        <Icons.Folder size={15} className="proj-folder-icon" />
        {group.workspace.pinnedAt != null && <Icons.Pin size={11} className="pinned-icon" />}
        <span className="proj-name">{group.workspace.name}</span>
        <span className="proj-count">{group.sessions.length}</span>
        <div className="item-menu-wrap">
          <button
            className="icon-btn item-menu-btn"
            title="项目操作"
            onClick={(event) => {
              event.stopPropagation()
              setMenuOpen((prev) => !prev)
            }}
          >
            <Icons.More size={12} />
          </button>
          {menuOpen && (
            <ActionMenu
              items={[
                {
                  icon: <Icons.Pin size={14} />,
                  label: group.workspace.pinnedAt == null ? '置顶项目' : '取消置顶',
                  onClick: () => onToggleProjectPinned(group.workspace),
                },
                { icon: <Icons.Folder size={14} />, label: '在文件夹中打开', onClick: () => onOpenProjectFolder(group.workspace) },
                { icon: <Icons.Edit size={14} />, label: '重命名项目', onClick: () => onRenameProject(group.workspace) },
                { icon: <Icons.Box size={14} />, label: '归档项目', onClick: () => onArchiveProject(group.workspace) },
                { icon: <Icons.Trash size={14} />, label: '删除项目', danger: true, onClick: () => onDeleteProject(group.workspace) },
              ]}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
      {open && (
        <div className="proj-sessions">
          {group.sessions.length === 0 ? (
            <button className="proj-session-empty" onClick={() => onNewSession(group.workspace.id)}>
              <Icons.Plus size={12} />
              新建此项目的会话
            </button>
          ) : (
            group.sessions.map((session) => (
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
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ChatListItem({
  session: s,
  active,
  onClick,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
  onOpenFolder,
}: {
  session: SessionSummary
  active: SessionId | null
  onClick: (id: SessionId) => void
  onRename?: (session: SessionSummary) => void
  onTogglePinned?: (session: SessionSummary) => void
  onArchive?: (session: SessionSummary) => void
  onDelete?: (session: SessionSummary) => void
  onOpenFolder?: (session: SessionSummary) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const statusLabel: Record<SessionSummary['status'], ReactNode> = {
    running: <span className="pulse-dot" />,
    error: <span className="badge danger dot">错误</span>,
    idle: null,
  }
  return (
    <div className={`chat-item proj-session ${active === s.id ? 'active' : ''}`} onClick={() => onClick(s.id)}>
      <div className="chat-item-title">
        {s.pinnedAt != null && <Icons.Pin size={11} className="pinned-icon" />}
        <span className="truncate flex1">{s.title || '新会话'}</span>
        <div className="item-menu-wrap">
          <button
            className="icon-btn item-menu-btn"
            title="会话操作"
            onClick={(event) => {
              event.stopPropagation()
              setMenuOpen((prev) => !prev)
            }}
          >
            <Icons.More size={12} />
          </button>
          {menuOpen && (
            <ActionMenu
              items={[
                {
                  icon: <Icons.Pin size={14} />,
                  label: s.pinnedAt == null ? '置顶会话' : '取消置顶',
                  onClick: () => onTogglePinned?.(s),
                },
                { icon: <Icons.Folder size={14} />, label: '在文件夹中打开', onClick: () => onOpenFolder?.(s) },
                { icon: <Icons.Edit size={14} />, label: '重命名会话', onClick: () => onRename?.(s) },
                { icon: <Icons.Box size={14} />, label: '归档会话', onClick: () => onArchive?.(s) },
                { icon: <Icons.Trash size={14} />, label: '删除会话', danger: true, onClick: () => onDelete?.(s) },
              ]}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
      <div className="chat-item-snippet">{s.messageCount} 条消息</div>
      <div className="chat-item-meta">
        <span className="badge primary">{s.status === 'running' ? 'running' : 'idle'}</span>
        {statusLabel[s.status]}
        <span className="chat-item-time">{formatRelativeTime(s.updatedAt)}</span>
      </div>
    </div>
  )
}

function ActionMenu({
  items,
  onClose,
}: {
  items: Array<{ icon: ReactNode; label: string; danger?: boolean; onClick: () => void }>
  onClose: () => void
}) {
  return (
    <div className="action-menu" onClick={(event) => event.stopPropagation()}>
      {items.map((item) => (
        <button
          key={item.label}
          className={item.danger ? 'danger' : ''}
          onClick={() => {
            onClose()
            item.onClick()
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function ChatTabbar({
  session,
  workspace,
  agentStatus,
  showInspector,
  setShowInspector,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  agentStatus: string
  showInspector: boolean
  setShowInspector: (v: boolean) => void
}) {
  return (
    <div className="chat-tabbar">
      <div className="chat-title-block">
        {session ? (
          <>
            <span className="badge primary dot">会话</span>
            <span className="chat-title truncate">{session.title || '新会话'}</span>
            {workspace && <span className="badge"><Icons.Folder size={10} /> {workspace.name}</span>}
            {agentStatus && (
              <span className="msg-running">
                <Icons.Spinner size={11} /> {agentStatus}
              </span>
            )}
          </>
        ) : (
          <span className="chat-title truncate muted">未选择会话</span>
        )}
      </div>
      <div className="row tabbar-actions">
        <button className={`icon-btn ${showInspector ? 'active' : ''}`} onClick={() => setShowInspector(!showInspector)}><Icons.PanelRight /></button>
        <button className="icon-btn"><Icons.More /></button>
      </div>
    </div>
  )
}

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
  setName: (value: string) => void
  setPath: (value: string) => void
  onPickPath: () => void
  onCancel: () => void
  onCreate: () => void
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal project-modal">
        <div className="modal-h">
          <div className="modal-h-icon"><Icons.Folder size={17} /></div>
          <div>
            <div className="modal-title">新建项目</div>
            <div className="modal-subtitle">选择一个本地文件夹作为项目地址，会话会归属到该项目下。</div>
          </div>
        </div>
        <div className="modal-body">
          {notice && (
            <div className="session-notice in-modal">
              <Icons.AlertTriangle size={12} />
              <span>{notice}</span>
            </div>
          )}
          <label className="field">
            <span>项目名称</span>
            <input
              value={name}
              placeholder="例如 Spark-Agent"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>项目文件夹地址</span>
            <div className="path-picker">
              <input
                value={path}
                placeholder="/Users/you/projects/my-agent"
                onChange={(event) => setPath(event.target.value)}
              />
              <button className="btn ghost sm" onClick={onPickPath}>选择</button>
            </div>
          </label>
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onCancel}>取消</button>
          <button className="btn primary sm" onClick={onCreate}>创建项目</button>
        </div>
      </div>
    </div>
  )
}

function ChatStream({ sessionId, onStatusChange }: { sessionId: SessionId; onStatusChange: (s: string) => void }) {
  const streamRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const builderRef = useRef(new MessageBuilder())
  const { invoke: getHistory } = useIpcInvoke('session:get-history')

  // 切换会话时加载历史
  useEffect(() => {
    const builder = new MessageBuilder()
    const timer = window.setTimeout(() => {
      builderRef.current = builder
      setMessages([])
      onStatusChange('')

      getHistory({ sessionId, limit: 200 })
        .then(res => {
          for (const event of res.events) builder.processEvent(event)
          setMessages(builder.getAllMessages())
        })
        .catch(console.error)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [getHistory, onStatusChange, sessionId])

  // 实时监听新事件
  useIpcStream('stream:session:agent-event', (event) => {
    if (event.sessionId !== sessionId) return
    builderRef.current.processEvent(event)
    setMessages([...builderRef.current.getAllMessages()])

    if (event.type === 'agent_status') {
      const labels: Record<string, string> = {
        thinking: '思考中',
        calling_tool: '调用工具',
        completed: '',
        error: '',
        cancelled: '',
      }
      onStatusChange(labels[event.status] ?? '')
    }
  }, [sessionId])

  // 自动滚动到底部
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="chat-stream" ref={streamRef}>
      <div className="chat-stream-inner">
        {messages.map(msg =>
          msg.role === 'user' ? (
            <UserMsg key={msg.id}>{renderBlocks(msg.blocks)}</UserMsg>
          ) : msg.status === 'streaming' ? (
            <AgentMsg key={msg.id} status="running">{renderBlocks(msg.blocks)}</AgentMsg>
          ) : (
            <AgentMsg key={msg.id}>{renderBlocks(msg.blocks)}</AgentMsg>
          )
        )}
      </div>
    </div>
  )
}

function renderBlocks(blocks: UIBlock[]): ReactNode {
  return blocks.map((block, i) => {
    switch (block.kind) {
      case 'text':
        return (
          <p key={i}>
            {block.content}
            {block.isStreaming && <span className="cursor-blink">▋</span>}
          </p>
        )
      case 'thinking':
        return (
          <details key={i} className="block-thinking">
            <summary>思考过程{block.isStreaming && ' …'}</summary>
            <pre>{block.content}</pre>
          </details>
        )
      case 'tool_call': {
        const toolStatus = block.status === 'success' ? 'ok' as const : block.status === 'error' ? 'error' as const : null
        return toolStatus ? (
          <ToolCall key={i} name={block.toolName} arg={JSON.stringify(block.toolInput).slice(0, 80)} status={toolStatus}>
            {block.output && <pre className="tool-output-pre">{block.output}</pre>}
            {block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        ) : (
          <ToolCall key={i} name={block.toolName} arg={JSON.stringify(block.toolInput).slice(0, 80)}>
            {block.output && <pre className="tool-output-pre">{block.output}</pre>}
            {block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        )
      }
      case 'error':
        return (
          <ErrorCard
            key={i}
            message={block.message}
            detail={block.code}
            suggestions={block.retryable ? ['点击重试'] : []}
          />
        )
      case 'terminal':
        return (
          <TerminalBlock key={i}>
            {block.stdout && <span>{block.stdout}</span>}
            {block.stderr && <span className="block-stderr">{block.stderr}</span>}
            {block.isStreaming && <span className="dim"> …</span>}
          </TerminalBlock>
        )
      case 'file_change':
        return (
          <div key={i} className="block-file-change">
            <Icons.File size={11} /> {block.changeType}: <code className="mono-sm">{block.path}</code>
          </div>
        )
      default:
        return null
    }
  })
}

function UserMsg({ children }: { children: ReactNode }) {
  return (
    <div className="msg user">
      <div className="msg-avatar">U</div>
      <div className="msg-body">
        <div className="msg-name">你</div>
        <div className="msg-content">{children}</div>
      </div>
    </div>
  )
}

function AgentMsg({ status, children }: { status?: 'running'; children: ReactNode }) {
  return (
    <div className="msg agent">
      <div className="msg-avatar"><Icons.Sparkles size={14} /></div>
      <div className="msg-body">
        <div className="msg-name">
          Agent
          {status === 'running' && (
            <span className="msg-running">
              <Icons.Spinner size={11} /> 生成中
            </span>
          )}
        </div>
        <div className="msg-content">{children}</div>
      </div>
    </div>
  )
}

function ToolCall({ name, arg, status, children }: { name: string; arg: string; status?: 'ok' | 'error'; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const iconMap: Record<string, ReactNode> = {
    Read: <Icons.File className="tool-icon" />,
    Grep: <Icons.Search className="tool-icon" />,
    Bash: <Icons.Terminal className="tool-icon" />,
    Edit: <Icons.Edit className="tool-icon" />,
    Write: <Icons.File className="tool-icon" />,
  }
  return (
    <div className={`tool-call ${open ? 'open' : ''}`}>
      <div className="tool-call-head" onClick={() => setOpen(!open)}>
        {iconMap[name] || <Icons.Wrench className="tool-icon" />}
        <span className="tool-name">{name}</span>
        <span className="tool-arg">{arg}</span>
        {status === 'ok' && <Icons.Check size={12} className="tool-status ok" />}
        {status === 'error' && <Icons.X size={12} className="tool-status err" />}
        <Icons.ChevronRight size={12} className="chev" />
      </div>
      {open && children && <div className="tool-call-body">{children}</div>}
    </div>
  )
}

function TerminalBlock({ children }: { children: ReactNode }) {
  return <div className="terminal mono-sm">{children}</div>
}

function Composer({ sessionId, onSent }: { sessionId: SessionId | null; onSent: () => void }) {
  const { toast } = useToast()
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')

  const handleSend = async () => {
    if (!value.trim() || !sessionId || sending) return
    const text = value.trim()
    setValue('')
    setSending(true)
    try {
      await sendTurn({ sessionId, message: text })
      onSent()
    } catch (err) {
      console.error('发送失败', err)
      toast.error(err instanceof Error ? err.message : '发送消息失败')
      setValue(text)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend()
  }

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className="composer">
          <textarea
            rows={2}
            placeholder={sessionId ? '询问、修改、运行任务…  ⌘↵ 发送' : '请先选择或新建一个会话'}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!sessionId || sending}
          />
          <div className="composer-actions">
            <button className="icon-btn" title="添加文件"><Icons.Plus /></button>
            <button className="icon-btn" title="工具"><Icons.Wrench /></button>
            <div className="model-pill">
              <Icons.Sparkles size={11} />
              <span>Agent</span>
              <Icons.ChevronRight size={10} className="chev chev-down" />
            </div>
            <div className="spacer" />
            <span className="composer-hint">
              <span className="kbd">⌘</span> <span className="kbd">↵</span> 发送
            </span>
            <button
              className="btn primary sm composer-send-btn"
              onClick={handleSend}
              disabled={!sessionId || !value.trim() || sending}
            >
              {sending ? <Icons.Spinner size={12} /> : <Icons.Send size={12} />}
              {sending ? '发送中' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatInspector({ session, workspace }: { session: SessionSummary | null; workspace: WorkspaceInfo | null }) {
  return (
    <div className="inspector scroll">
      <div className="inspector-section">
        <h4>会话信息</h4>
        {session ? (
          <>
            <div className="kv-row"><span className="k">ID</span><span className="v mono-sm inspector-v-id">{(session.id as string).slice(0, 16)}…</span></div>
            <div className="kv-row"><span className="k">状态</span><span className="v">{session.status}</span></div>
            <div className="kv-row"><span className="k">消息数</span><span className="v">{session.messageCount}</span></div>
            <div className="kv-row"><span className="k">项目</span><span className="v truncate">{workspace?.name ?? '未归属'}</span></div>
            <div className="kv-row"><span className="k">创建时间</span><span className="v">{new Date(session.createdAt).toLocaleString()}</span></div>
            <div className="kv-row"><span className="k">更新时间</span><span className="v">{new Date(session.updatedAt).toLocaleString()}</span></div>
          </>
        ) : (
          <div className="inspector-muted">未选择会话</div>
        )}
      </div>
      <div className="inspector-section">
        <h4>可用工具</h4>
        <div className="tool-chip-list">
          {['read_file', 'write_file', 'list_directory', 'search_files'].map(t => (
            <span key={t} className="tool-chip">
              <Icons.Wrench />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function buildProjectGroups(workspaces: WorkspaceInfo[], sessions: SessionSummary[]): ProjectGroup[] {
  return workspaces.map((workspace) => ({
    workspace,
    sessions: sessions.filter((session) => session.workspaceIds.includes(workspace.id)),
  }))
}

function filterSessionsByTime(sessions: SessionSummary[], filter: TimeFilter): SessionSummary[] {
  if (filter === 'all') return sessions
  const days = Number.parseInt(filter, 10)
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sessions.filter((session) => {
    const updatedAt = new Date(session.updatedAt).getTime()
    return Number.isFinite(updatedAt) && updatedAt >= cutoff
  })
}

function getBasename(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return '新项目'
  return trimmed.split('/').filter(Boolean).at(-1) ?? '新项目'
}

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
