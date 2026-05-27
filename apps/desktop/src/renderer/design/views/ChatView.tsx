/**
 * ChatView — 真实 IPC 驱动的会话视图
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { Icons } from '../Icons'
import { ErrorCard } from '../ChatInteractions'
import { SparkInput } from '../components/FormControls'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { MessageBuilder } from '../services/event-mapper'
import { useToast } from '../components/Toast'
import type { UIMessage, UIBlock } from '../services/event-mapper'
import type {
  AgentEvent,
  ProviderProfile,
  SessionAgentAdapter,
  SessionChatMode,
  SessionListResponse,
  SessionPermissionMode,
  SessionId,
  SessionReasoningEffort,
  SessionSearchResult,
  WorkspaceInfo,
} from '@spark/protocol'

type SessionSummary = SessionListResponse['sessions'][number]

type ProjectGroup = {
  workspace: WorkspaceInfo
  sessions: SessionSummary[]
}

type TimeFilter = 'all' | '1d' | '3d' | '7d' | '10d'
type BranchState = { currentBranch: string | null; branches: string[] }
type AgentAdapter = SessionAgentAdapter
type PermissionModeChoice = SessionPermissionMode
type ComposerPrefs = {
  adapter?: AgentAdapter
  providerProfileId?: string
  modelId?: string
  permissionMode?: PermissionModeChoice
  reasoningEffort?: SessionReasoningEffort
}

const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'

export function ChatView() {
  const [active, setActive] = useState<SessionId | null>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(360)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<string>('')
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([])
  const [contextInputTokens, setContextInputTokens] = useState(0)
  const [branchState, setBranchState] = useState<BranchState>({ currentBranch: null, branches: [] })
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
  const { invoke: listBranches } = useIpcInvoke('workspace:list-branches')
  const { invoke: switchBranch } = useIpcInvoke('workspace:switch-branch')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

  const refreshProjectsAndSessions = useCallback(async () => {
    const [workspaceRes, sessionRes, currentRes, providerRes] = await Promise.all([
      listWorkspaces({ limit: 100 }),
      listSessions({ limit: 200 }),
      getCurrentWorkspace({}),
      listProviders({}),
    ])
    setWorkspaces(workspaceRes.workspaces)
    setSessions(sessionRes.sessions)
    setProviders(providerRes.profiles)
    setSelectedProviderId((prev) => prev || getPreferredProvider(providerRes.profiles, readComposerPrefs(), 'claude')?.id || '')
    setActiveWorkspaceId((prev) => currentRes.workspace?.id ?? prev ?? workspaceRes.workspaces[0]?.id ?? null)
  }, [getCurrentWorkspace, listProviders, listSessions, listWorkspaces])

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

  const handleNewSession = async (
    workspaceId = activeWorkspaceId,
    options: {
      providerProfileId?: string
      modelId?: string
      agentAdapter?: AgentAdapter
      permissionMode?: PermissionModeChoice
      chatMode?: SessionChatMode
      reasoningEffort?: SessionReasoningEffort
      activate?: boolean
    } = {},
  ): Promise<SessionId | null> => {
    try {
      setNotice('')
      if (workspaceId == null) {
        setProjectDialog('create')
        toast.warning('请先创建或打开一个项目，然后再在项目下新建会话。')
        return null
      }
      const knownProviders = providers.length > 0 ? providers : (await listProviders({})).profiles
      if (providers.length === 0) setProviders(knownProviders)
      const prefs = readComposerPrefs()
      const preferredAdapter = options.agentAdapter ?? prefs.adapter ?? 'claude'
      const profile = knownProviders.find((item) => item.id === options.providerProfileId)
        ?? knownProviders.find((item) => item.id === selectedProviderId && getProviderAdapterKind(item) === preferredAdapter)
        ?? getPreferredProvider(knownProviders, prefs, preferredAdapter)
      if (!profile) {
        alert('请先在设置中配置 Provider')
        return null
      }
      const agentAdapter = options.agentAdapter ?? getProviderAdapterKind(profile)
      const permissionMode = options.permissionMode ?? getValidPermissionMode(prefs.permissionMode, agentAdapter)
      const modelId = options.modelId ?? (prefs.providerProfileId === profile.id && prefs.modelId ? prefs.modelId : undefined)
      const res = await createSession({
        providerProfileId: profile.id,
        ...(modelId !== undefined ? { modelId } : {}),
        agentAdapter,
        permissionMode,
        ...(options.chatMode !== undefined ? { chatMode: options.chatMode } : {}),
        reasoningEffort: options.reasoningEffort ?? prefs.reasoningEffort ?? 'medium',
        workspaceId,
      })
      refreshSessions()
      if (options.activate !== false) setActive(res.sessionId)
      setSelectedProviderId(profile.id)
      setActiveWorkspaceId(workspaceId)
      writeComposerPrefs({ adapter: agentAdapter, providerProfileId: profile.id, ...(modelId !== undefined ? { modelId } : {}), permissionMode })
      return res.sessionId
    } catch (err) {
      console.error('创建会话失败', err)
      toast.error(err instanceof Error ? err.message : '创建会话失败')
    }
    return null
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

  useEffect(() => {
    if (activeSession?.providerProfileId) {
      setSelectedProviderId(activeSession.providerProfileId)
    }
  }, [activeSession?.providerProfileId])

  useEffect(() => {
    if (activeWorkspace == null) {
      setBranchState({ currentBranch: null, branches: [] })
      return
    }

    let cancelled = false
    listBranches({ workspaceId: activeWorkspace.id })
      .then((res) => {
        if (!cancelled) setBranchState(res)
      })
      .catch(() => {
        if (!cancelled) setBranchState({ currentBranch: null, branches: [] })
      })
    return () => {
      cancelled = true
    }
  }, [activeWorkspace, listBranches])

  const handleUpdateActiveSession = async (patch: {
    providerProfileId?: string
    modelId?: string | null
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
  }) => {
    if (active == null) return
    const res = await updateSession({ sessionId: active, ...patch })
    setSessions((prev) => prev.map((item) => item.id === active ? res.session : item))
  }

  const handleSwitchBranch = async (branch: string) => {
    if (activeWorkspace == null || !branch || branch === branchState.currentBranch) return
    try {
      const res = await switchBranch({ workspaceId: activeWorkspace.id, branch })
      setBranchState(res)
      toast.success(`已切换到 ${res.currentBranch}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换分支失败，请检查是否存在未提交改动')
    }
  }

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <div className="chat-sidebar-head">
          <div className="search-input">
            <Icons.Search />
            <SparkInput
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
          <button className="icon-btn" title="新建项目" onClick={() => setProjectDialog('create')}><Icons.Plus /></button>
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
            onUsageChange={setContextInputTokens}
            onMessagesChange={setActiveMessages}
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
        <ComposerV2
          session={activeSession}
          workspace={activeWorkspace}
          providers={providers}
          selectedProviderId={selectedProviderId}
          setSelectedProviderId={setSelectedProviderId}
          branchState={branchState}
          contextInputTokens={contextInputTokens}
          isWorking={agentStatus.length > 0 || activeSession?.status === 'running'}
          onCreateSession={(options) => handleNewSession(activeWorkspaceId, options)}
          onUpdateSession={handleUpdateActiveSession}
          onSwitchBranch={handleSwitchBranch}
          onSent={() => {}}
        />
      </div>

      {showInspector && (
        <ChatInspector
          session={activeSession}
          workspace={activeWorkspace}
          messages={active == null ? [] : activeMessages}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
        />
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
        <button
          className="icon-btn proj-add-session-btn"
          title="新建此项目的会话"
          onClick={(event) => {
            event.stopPropagation()
            onNewSession(group.workspace.id)
          }}
        >
          <Icons.Plus size={12} />
        </button>
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
  return (
    <div className={`chat-item proj-session chat-item-compact ${active === s.id ? 'active' : ''}`} onClick={() => onClick(s.id)}>
      <div className="chat-item-row">
        {/* 左侧：置顶图标 + 状态指示点 + 标题 */}
        <div className="chat-item-title-compact">
          {s.pinnedAt != null && <Icons.Pin size={10} className="pinned-icon" />}
          {s.status === 'running' && <span className="pulse-dot" />}
          <span className="truncate">{s.title || '新会话'}</span>
        </div>
        {/* 右侧：时间 + 更多菜单 */}
        <span className="chat-item-time-compact">{formatRelativeTime(s.updatedAt)}</span>
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div ref={ref} className="action-menu" onClick={(event) => event.stopPropagation()}>
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
            <SparkInput
              value={name}
              placeholder="例如 Spark-Agent"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>项目文件夹地址</span>
            <div className="path-picker">
              <SparkInput
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

function ChatStream({
  sessionId,
  onStatusChange,
  onUsageChange,
  onMessagesChange,
}: {
  sessionId: SessionId
  onStatusChange: (s: string) => void
  onUsageChange: (tokens: number) => void
  onMessagesChange: (messages: UIMessage[]) => void
}) {
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
      onMessagesChange([])
      onStatusChange('')

      getHistory({ sessionId, limit: 200 })
        .then(res => {
          for (const event of res.events) builder.processEvent(event)
          const nextMessages = builder.getAllMessages()
          setMessages(nextMessages)
          onMessagesChange(nextMessages)
          onUsageChange(getLatestInputTokens(res.events))
        })
        .catch(console.error)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [getHistory, onMessagesChange, onStatusChange, onUsageChange, sessionId])

  // 实时监听新事件
  useIpcStream('stream:session:agent-event', (event) => {
    if (event.sessionId !== sessionId) return
    builderRef.current.processEvent(event)
    const nextMessages = [...builderRef.current.getAllMessages()]
    setMessages(nextMessages)
    onMessagesChange(nextMessages)

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
    if (event.type === 'usage_update') {
      if (event.inputTokens > 0) onUsageChange(event.inputTokens)
    }
  }, [onMessagesChange, onStatusChange, onUsageChange, sessionId])

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
            <AgentMsg key={msg.id} status="running" blocks={msg.blocks} />
          ) : (
            <AgentMsg key={msg.id} blocks={msg.blocks} />
          )
        )}
      </div>
    </div>
  )
}

function renderBlocks(blocks: UIBlock[], options: { surface?: 'main' | 'inspector' } = {}): ReactNode {
  const surface = options.surface ?? 'main'
  return blocks.map((block, i) => {
    switch (block.kind) {
      case 'text':
        return (
          <div key={i} className="md-surface">
            <MarkdownText content={block.content} />
          </div>
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
        const toolArg = JSON.stringify(block.toolInput).slice(0, surface === 'main' ? 48 : 80)
        return toolStatus ? (
          <ToolCall key={i} name={block.toolName} arg={toolArg} status={toolStatus}>
            {surface !== 'main' && block.output && <div className="tool-output-pre md-surface"><MarkdownText content={block.output} /></div>}
            {surface !== 'main' && block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        ) : (
          <ToolCall key={i} name={block.toolName} arg={toolArg}>
            {surface !== 'main' && block.output && <div className="tool-output-pre md-surface"><MarkdownText content={block.output} /></div>}
            {surface !== 'main' && block.error && <span className="tool-error-span">{block.error}</span>}
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
        if (surface === 'main') return null
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

type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }

function MarkdownText({ content }: { content: string }) {
  const blocks = parseMarkdown(content)

  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements
            return <Tag key={index}>{renderInlineMarkdown(block.text)}</Tag>
          }
          case 'paragraph':
            return <p key={index}>{renderInlineMarkdown(block.text)}</p>
          case 'code':
            return (
              <pre key={index} className="md-code">
                <code>{block.code}</code>
              </pre>
            )
          case 'quote':
            return <blockquote key={index}>{renderInlineMarkdown(block.text)}</blockquote>
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul'
            return (
              <ListTag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className={item.checked !== undefined ? 'md-task' : undefined}>
                    {item.checked !== undefined && <SparkInput type="checkbox" className="spark-checkbox" checked={item.checked} readOnly />}
                    <span>{renderInlineMarkdown(item.text)}</span>
                  </li>
                ))}
              </ListTag>
            )
          }
          case 'table':
            return (
              <div key={index} className="md-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => <th key={headerIndex}>{renderInlineMarkdown(header)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.headers.map((_, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'hr':
            return <hr key={index} />
          default:
            return null
        }
      })}
    </>
  )
}

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', lang: fence[1] ?? '', code: codeLines.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '').length, text: heading[2] ?? '' })
      index += 1
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      index += 1
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(/^>\s?(.*)$/)
        if (!match) break
        quoteLines.push(match[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'quote', text: quoteLines.join('\n') })
      continue
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
    if (listMatch) {
      const ordered = /\d+[.)]/.test(listMatch[2] ?? '')
      const items: Array<{ text: string; checked?: boolean }> = []
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
        if (!match || /\d+[.)]/.test(match[2] ?? '') !== ordered) break
        const itemText = match[3] ?? ''
        const task = itemText.match(/^\[([ xX])]\s+(.*)$/)
        items.push(task ? { text: task[2] ?? '', checked: (task[1] ?? '').toLowerCase() === 'x' } : { text: itemText })
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '')) {
      const headers = splitTableRow(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (
      index < lines.length
      && (lines[index] ?? '').trim()
      && !/^```/.test(lines[index] ?? '')
      && !/^(#{1,6})\s+/.test(lines[index] ?? '')
      && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[index] ?? '')
      && !/^>\s?/.test(lines[index] ?? '')
      && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(!?\[[^\]]+]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) != null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${match.index}-${token}`
    const link = token.match(/^(!?)\[([^\]]+)]\(([^)]+)\)$/)
    if (link) {
      nodes.push(link[1] === '!'
        ? <img key={key} src={link[3]} alt={link[2]} />
        : <a key={key} href={link[3]} target="_blank" rel="noreferrer">{link[2]}</a>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    cursor = match.index + token.length
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  const rendered: ReactNode[] = []
  nodes.forEach((node, index) => {
    if (typeof node !== 'string') {
      rendered.push(node)
      return
    }
    const parts = node.split('\n')
    parts.forEach((part, partIndex) => {
      rendered.push(part)
      if (partIndex < parts.length - 1) rendered.push(<br key={`br-${index}-${partIndex}`} />)
    })
  })
  return rendered
}

function UserMsg({ children }: { children: ReactNode }) {
  return (
    <div className="msg msg-user">
      <div className="msg-bubble msg-bubble-user">
        <div className="msg-content">{children}</div>
      </div>
    </div>
  )
}

function AgentMsg({ status, blocks }: { status?: 'running'; blocks: UIBlock[] }) {
  const thinkingBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'thinking' }> => b.kind === 'thinking',
  )
  const contentBlocks = blocks.filter(b => b.kind !== 'thinking')
  const isStreaming = status === 'running'
  const hasContent = thinkingBlocks.length > 0 || contentBlocks.length > 0

  return (
    <div className="msg msg-agent">
      <div className="msg-bubble msg-bubble-agent">
        {isStreaming && !hasContent && (
          <div className="msg-streaming-indicator">
            <Icons.Spinner size={12} />
            <span>思考中...</span>
          </div>
        )}
        {thinkingBlocks.length > 0 && (
          <ThinkingSection blocks={thinkingBlocks} streaming={isStreaming} />
        )}
        {contentBlocks.length > 0 && (
          <CollapsibleContent maxHeight={500} streaming={isStreaming}>
            <div className="msg-content">{renderBlocks(contentBlocks)}</div>
          </CollapsibleContent>
        )}
      </div>
    </div>
  )
}

function ThinkingSection({
  blocks,
  streaming,
}: {
  blocks: Array<Extract<UIBlock, { kind: 'thinking' }>>
  streaming: boolean
}) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [needsCollapse, setNeedsCollapse] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const isThinkingActive = blocks.some(b => b.isStreaming)

  useEffect(() => {
    if (isThinkingActive) {
      setNeedsCollapse(false)
      return
    }
    const el = contentRef.current
    if (el) setNeedsCollapse(el.scrollHeight > 200)
  }, [blocks, isThinkingActive])

  const isCollapsed = needsCollapse && !expanded

  return (
    <div className={`thinking-section ${open ? 'open' : ''}`}>
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <Icons.ChevronRight size={12} className={`chev ${open ? 'chev-open' : ''}`} />
        <span className="thinking-label">思考过程</span>
        {isThinkingActive && <Icons.Spinner size={10} className="thinking-spinner" />}
      </button>
      {open && (
        <div className="thinking-body">
          <div
            ref={contentRef}
            className={`thinking-content ${isCollapsed ? 'is-collapsed' : ''}`}
            style={isCollapsed ? { maxHeight: '200px' } : undefined}
          >
            {blocks.map((block, i) => (
              <pre key={i}>{block.content}</pre>
            ))}
          </div>
          {isCollapsed && (
            <button className="collapse-toggle" onClick={() => setExpanded(true)}>
              展开全部
            </button>
          )}
          {needsCollapse && expanded && (
            <button className="collapse-toggle" onClick={() => setExpanded(false)}>
              收起
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CollapsibleContent({
  maxHeight = 500,
  streaming = false,
  children,
}: {
  maxHeight?: number
  streaming?: boolean
  children: ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [needsCollapse, setNeedsCollapse] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    if (streaming) {
      setNeedsCollapse(false)
      setExpanded(false)
      return
    }
    setNeedsCollapse(el.scrollHeight > maxHeight)
  }, [children, maxHeight, streaming])

  const isCollapsed = needsCollapse && !expanded

  return (
    <div className="collapsible-wrap">
      <div
        ref={contentRef}
        className={`collapsible-content ${isCollapsed ? 'is-collapsed' : ''}`}
        style={isCollapsed ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {children}
      </div>
      {isCollapsed && (
        <div className="collapse-overlay">
          <button className="collapse-toggle" onClick={() => setExpanded(true)}>
            展开全部
          </button>
        </div>
      )}
      {needsCollapse && expanded && !streaming && (
        <button className="collapse-toggle collapse-less" onClick={() => setExpanded(false)}>
          收起
        </button>
      )}
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

function ComposerV2({
  session,
  workspace,
  providers,
  selectedProviderId,
  setSelectedProviderId,
  branchState,
  contextInputTokens,
  isWorking,
  onCreateSession,
  onUpdateSession,
  onSwitchBranch,
  onSent,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  providers: ProviderProfile[]
  selectedProviderId: string
  setSelectedProviderId: (providerId: string) => void
  branchState: BranchState
  contextInputTokens: number
  isWorking: boolean
  onCreateSession: (options: {
    providerProfileId?: string
    modelId?: string
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
    activate?: boolean
  }) => Promise<SessionId | null>
  onUpdateSession: (patch: {
    providerProfileId?: string
    modelId?: string | null
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
  }) => Promise<void>
  onSwitchBranch: (branch: string) => Promise<void>
  onSent: () => void
}) {
  const { toast } = useToast()
  const initialPrefsRef = useRef<ComposerPrefs | null>(null)
  if (initialPrefsRef.current == null) initialPrefsRef.current = readComposerPrefs()
  const initialPrefs = initialPrefsRef.current
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [manualExpanded, setManualExpanded] = useState(false)
  const [draftAdapter, setDraftAdapter] = useState<AgentAdapter>(initialPrefs.adapter ?? 'claude')
  const [draftModelId, setDraftModelId] = useState(initialPrefs.modelId ?? '')
  const [draftMode] = useState<SessionChatMode>('agent')
  const [draftPermissionMode, setDraftPermissionMode] = useState<PermissionModeChoice>(
    getValidPermissionMode(initialPrefs.permissionMode, initialPrefs.adapter ?? 'claude'),
  )
  const [draftReasoning, setDraftReasoning] = useState<SessionReasoningEffort>(initialPrefs.reasoningEffort ?? 'medium')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')

  const adapter = session?.agentAdapter ?? draftAdapter
  const compatibleProviders = providers.filter((provider) => getProviderAdapterKind(provider) === adapter)
  const selectedProvider = compatibleProviders.find((item) => item.id === (session?.providerProfileId || selectedProviderId))
    ?? compatibleProviders.find((item) => item.isDefault)
    ?? compatibleProviders[0]
  const modelOptions = selectedProvider?.modelIds.length ? selectedProvider.modelIds : selectedProvider?.defaultModel ? [selectedProvider.defaultModel] : []
  const effectiveModelId = session?.modelId ?? (draftModelId || selectedProvider?.defaultModel || modelOptions[0] || '')
  const effectiveMode = session?.chatMode ?? draftMode
  const effectiveReasoning = session?.reasoningEffort ?? draftReasoning
  const permissionOptions = getPermissionModeOptions(adapter)
  const sessionPermissionMode = session?.permissionMode
  const draftEffectivePermissionMode = sessionPermissionMode ?? draftPermissionMode
  const defaultPermissionMode = permissionOptions[0]?.value ?? 'codex-default'
  const effectivePermissionMode = permissionOptions.some((option) => option.value === draftEffectivePermissionMode)
    ? draftEffectivePermissionMode
    : defaultPermissionMode
  const contextWindow = estimateContextWindow(effectiveModelId)
  const contextRatio = Math.min(100, Math.round((contextInputTokens / contextWindow) * 1000) / 10)
  const isBusy = sending || isWorking
  const canSubmit = value.trim().length > 0 && selectedProvider != null && effectiveModelId.length > 0 && (session != null || workspace != null)

  useEffect(() => {
    if (session != null || providers.length === 0 || compatibleProviders.length > 0) return
    const fallbackProvider = getPreferredProvider(providers, initialPrefs, draftAdapter)
    if (fallbackProvider == null) return
    const nextAdapter = getProviderAdapterKind(fallbackProvider)
    const nextPermissionMode = getPermissionModeOptions(nextAdapter)[0]?.value ?? 'codex-default'
    const nextModel = fallbackProvider.defaultModel || fallbackProvider.modelIds[0] || ''
    setDraftAdapter(nextAdapter)
    setDraftPermissionMode(nextPermissionMode)
    setSelectedProviderId(fallbackProvider.id)
    setDraftModelId(nextModel)
    writeComposerPrefs({ adapter: nextAdapter, providerProfileId: fallbackProvider.id, modelId: nextModel, permissionMode: nextPermissionMode })
  }, [compatibleProviders.length, draftAdapter, initialPrefs, providers, session, setSelectedProviderId])

  useEffect(() => {
    if (selectedProvider != null && !draftModelId) {
      setDraftModelId(selectedProvider.defaultModel || selectedProvider.modelIds[0] || '')
    }
  }, [draftModelId, selectedProvider])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // 高度范围：collapsed=102-168px, expanded=270-320px
    const minHeight = manualExpanded ? 270 : 102
    const maxHeight = manualExpanded ? 320 : 168

    // 临时禁用 transition 以准确测量 scrollHeight
    const transition = el.style.transition
    el.style.transition = 'none'
    el.style.height = '0px'
    // 强制回流以应用 height: 0
    void el.offsetHeight

    const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight))
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'

    // 恢复 transition（下一帧生效）
    requestAnimationFrame(() => {
      el.style.transition = transition
    })
  }, [manualExpanded, value])

  const dispatchMessage = useCallback(async (text: string) => {
    // 斜杠命令拦截：以 / 开头的消息走 command:execute
    if (text.startsWith('/')) {
      setSending(true)
      try {
        const sessionId = session?.id ?? '__chat__'
        const res = await window.spark.invoke('command:execute', { sessionId, message: text })
        if (res.success) {
          toast.success(res.message || '命令执行成功')
        } else {
          toast.warning(res.message || '命令执行失败')
        }
        onSent()
      } catch (err) {
        console.error('命令执行失败', err)
        toast.error(err instanceof Error ? err.message : '命令执行失败')
        setValue(text)
      } finally {
        setSending(false)
      }
      return
    }

    if (selectedProvider == null) return
    setSending(true)
    try {
      let targetSessionId = session?.id ?? null
      if (targetSessionId == null) {
        targetSessionId = await onCreateSession({
          ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
          modelId: effectiveModelId,
          agentAdapter: adapter,
          permissionMode: effectivePermissionMode,
          chatMode: effectiveMode,
          reasoningEffort: effectiveReasoning,
        })
      }
      if (targetSessionId == null) throw new Error('请先选择项目并配置供应商')
      const res = await sendTurn({ sessionId: targetSessionId, message: text })
      if (!res.started) toast.info('上一条任务仍在执行，消息已加入队列。')
      onSent()
    } catch (err) {
      console.error('发送失败', err)
      toast.error(err instanceof Error ? err.message : '发送消息失败')
      setValue(text)
    } finally {
      setSending(false)
    }
  }, [adapter, effectiveMode, effectiveModelId, effectivePermissionMode, effectiveReasoning, onCreateSession, onSent, selectedProvider, sendTurn, session?.id, toast])

  useEffect(() => {
    if (isBusy || queuedMessages.length === 0) return
    const [next, ...rest] = queuedMessages
    if (next == null) return
    setQueuedMessages(rest)
    void dispatchMessage(next)
  }, [dispatchMessage, isBusy, queuedMessages])

  const handleSend = async () => {
    if (!canSubmit) return
    const text = value.trim()
    setValue('')
    if (isBusy) {
      setQueuedMessages((prev) => {
        toast.info(`任务执行中，已加入临时队列（${prev.length + 1}）。`)
        return [...prev, text]
      })
      return
    }
    await dispatchMessage(text)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
    if (nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const handleProviderChange = async (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId)
    if (provider == null) return
    const nextAdapter = getProviderAdapterKind(provider)
    const nextPermissionMode = getPermissionModeOptions(nextAdapter)[0]?.value ?? 'codex-default'
    setDraftAdapter(nextAdapter)
    setDraftPermissionMode(nextPermissionMode)
    setSelectedProviderId(providerId)
    const nextModel = provider.defaultModel || provider.modelIds[0] || ''
    setDraftModelId(nextModel)
    writeComposerPrefs({ adapter: nextAdapter, providerProfileId: providerId, modelId: nextModel, permissionMode: nextPermissionMode })
    if (session != null) {
      await onUpdateSession({
        providerProfileId: providerId,
        modelId: nextModel || null,
        agentAdapter: nextAdapter,
        permissionMode: nextPermissionMode,
      })
    }
  }

  const handleAdapterChange = async (nextAdapter: AgentAdapter) => {
    if (nextAdapter === adapter) return
    setDraftAdapter(nextAdapter)
    const nextPermissionMode = getPermissionModeOptions(nextAdapter)[0]?.value ?? 'codex-default'
    setDraftPermissionMode(nextPermissionMode)
    const nextProvider = providers.find((provider) => getProviderAdapterKind(provider) === nextAdapter)
    if (nextProvider != null) {
      const nextModel = nextProvider.defaultModel || nextProvider.modelIds[0] || ''
      setSelectedProviderId(nextProvider.id)
      setDraftModelId(nextModel)
      writeComposerPrefs({ adapter: nextAdapter, providerProfileId: nextProvider.id, modelId: nextModel, permissionMode: nextPermissionMode })
      if (session != null) {
        await onUpdateSession({
          providerProfileId: nextProvider.id,
          modelId: nextModel || null,
          agentAdapter: nextAdapter,
          permissionMode: nextPermissionMode,
        })
      }
      return
    }
    writeComposerPrefs({ adapter: nextAdapter, permissionMode: nextPermissionMode })
    if (session != null) await onUpdateSession({ agentAdapter: nextAdapter, permissionMode: nextPermissionMode })
  }

  const handleModelChange = async (modelId: string) => {
    setDraftModelId(modelId)
    writeComposerPrefs({
      ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
      modelId,
    })
    if (session != null) await onUpdateSession({ modelId })
  }

  const handleReasoningChange = async (reasoningEffort: SessionReasoningEffort) => {
    setDraftReasoning(reasoningEffort)
    writeComposerPrefs({ reasoningEffort })
    if (session != null) await onUpdateSession({ reasoningEffort })
  }

  const branchOptions = (branchState.branches.length > 0 ? branchState.branches : [branchState.currentBranch ?? ''])
    .filter((branch): branch is string => branch.length > 0)
    .map((branch) => ({ value: branch, label: branch }))
  const showBranchSelect = branchOptions.length > 0 && branchState.currentBranch != null

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className={`composer composer-v2 ${manualExpanded ? 'expanded' : ''}`}>
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={workspace ? '询问、修改、运行任务…  ↵ 发送' : '请先选择或新建一个项目'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onKeyDown={handleKeyDown}
            disabled={!workspace}
          />
          <div className="composer-submit-row">
            <button
              className="composer-expand-btn"
              title={manualExpanded ? '折叠输入框' : '展开输入框'}
              onClick={() => setManualExpanded((prev) => !prev)}
            >
              {manualExpanded ? <Icons.Minimize size={15} /> : <Icons.Maximize size={15} />}
            </button>
            <button
              className={`composer-send-round ${sending ? 'is-sending' : ''}`}
              title={isBusy ? '加入队列' : '发送'}
              onClick={() => void handleSend()}
              disabled={!canSubmit}
            >
              {sending ? <Icons.Spinner size={15} /> : isBusy ? <Icons.Clock size={17} /> : <Icons.ArrowUp size={18} />}
            </button>
          </div>
        </div>
        <div className="composer-param-bar composer-controls">
            <button className="icon-btn" title="添加文件"><Icons.Plus /></button>
            <button className="icon-btn" title="工具"><Icons.Wrench /></button>
            <ComposerMenuSelect
              icon={<AdapterIcon adapter={adapter} />}
              value={adapter}
              label={adapter === 'claude' ? 'Claude' : 'Codex'}
              disabled={providers.length === 0}
              title="适配器"
              onChange={(value) => handleAdapterChange(value as AgentAdapter)}
              options={ADAPTER_OPTIONS}
            />
            <ProviderModelPicker
              icon={<AdapterIcon adapter={selectedProvider != null ? getProviderAdapterKind(selectedProvider) : adapter} />}
              providers={compatibleProviders}
              selectedProviderId={selectedProvider?.id ?? ''}
              selectedModelId={effectiveModelId}
              disabled={compatibleProviders.length === 0}
              onChange={async (providerId, modelId) => {
                if (providerId !== selectedProvider?.id) await handleProviderChange(providerId)
                if (modelId !== effectiveModelId) await handleModelChange(modelId)
              }}
            />
            <ComposerMenuSelect
              icon={<Icons.Shield size={13} />}
              value={effectivePermissionMode}
              label={permissionOptions.find((option) => option.value === effectivePermissionMode)?.label ?? '默认权限'}
              title="权限模式"
              onChange={(mode) => {
                const permissionMode = mode as PermissionModeChoice
                setDraftPermissionMode(permissionMode)
                writeComposerPrefs({ permissionMode })
                if (session != null) void onUpdateSession({ permissionMode })
              }}
              options={permissionOptions}
            />
            <ComposerMenuSelect
              icon={<Icons.Brain size={13} />}
              value={effectiveReasoning}
              label={getReasoningOptions(adapter).find((option) => option.value === effectiveReasoning)?.label ?? effectiveReasoning}
              title="推理强度"
              onChange={(reasoning) => handleReasoningChange(reasoning as SessionReasoningEffort)}
              options={getReasoningOptions(adapter)}
            />
            <div className="context-meter" title={`上下文使用 ${contextRatio}% · ${formatTokenCount(contextInputTokens)} / ${formatTokenCount(contextWindow)}`}>
              <span>{contextRatio}%</span>
              <span className="context-ring" style={{ '--context-pct': `${contextRatio}%` } as React.CSSProperties} />
            </div>
            {queuedMessages.length > 0 && <span className="queued-chip">{queuedMessages.length} 条排队中</span>}
            <div className="spacer" />
            {showBranchSelect && (
              <ComposerMenuSelect
                icon={<Icons.GitBranch size={13} />}
                value={branchState.currentBranch ?? ''}
                label={branchState.currentBranch ?? ''}
                title="分支"
                align="right"
                onChange={onSwitchBranch}
                options={branchOptions}
              />
            )}
            <span className="composer-hint">
              <span className="kbd">↵</span> 发送 &nbsp;<span className="kbd">⇧</span><span className="kbd">↵</span> 换行
            </span>
            <button
              className="btn primary sm composer-send-btn"
              onClick={() => void handleSend()}
              disabled={!canSubmit}
            >
              {sending ? <Icons.Spinner size={12} /> : isBusy ? <Icons.Clock size={12} /> : <Icons.Send size={12} />}
              {isBusy ? '排队' : '发送'}
            </button>
          </div>
        </div>
      </div>
  )
}

function ComposerMenuSelect({
  icon,
  value,
  label,
  options,
  title,
  disabled = false,
  align = 'left',
  onChange,
}: {
  icon: ReactNode
  value: string
  label: string
  options: Array<{ value: string; label: string }>
  title: string
  disabled?: boolean
  align?: 'left' | 'right'
  onChange: (value: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  return (
    <div ref={rootRef} className={`composer-select composer-menu-select ${align === 'right' ? 'right' : ''}`} title={title}>
      <span className="composer-select-icon">{icon}</span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{label || '未配置'}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className={`composer-menu ${align === 'right' ? 'right' : ''}`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`composer-menu-item ${option.value === value ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                void onChange(option.value)
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Icons.Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderModelPicker({
  icon,
  providers,
  selectedProviderId,
  selectedModelId,
  disabled,
  onChange,
}: {
  icon: ReactNode
  providers: ProviderProfile[]
  selectedProviderId: string
  selectedModelId: string
  disabled?: boolean
  onChange: (providerId: string, modelId: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const label = selectedModelId || selectedProvider?.defaultModel || selectedProvider?.name || '未配置'

  return (
    <div ref={rootRef} className="composer-select composer-model-picker" title="供应商模型">
      <span className="composer-select-icon">{icon}</span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || providers.length === 0}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{label}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-model-menu">
          {providers.length === 0 && <div className="composer-menu-empty">未配置</div>}
          {providers.map((provider) => {
            const models = provider.modelIds.length ? provider.modelIds : provider.defaultModel ? [provider.defaultModel] : []
            return (
              <div key={provider.id} className="composer-model-group">
                <div className="composer-model-group-title">{provider.name}</div>
                {models.map((modelId) => {
                  const active = provider.id === selectedProviderId && modelId === selectedModelId
                  return (
                    <button
                      key={`${provider.id}:${modelId}`}
                      type="button"
                      className={`composer-menu-item ${active ? 'active' : ''}`}
                      onClick={() => {
                        setOpen(false)
                        void onChange(provider.id, modelId)
                      }}
                    >
                      <span>{modelId}</span>
                      {active && <Icons.Check size={14} />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function useCloseOnOutside(ref: RefObject<HTMLElement | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [active, onClose, ref])
}

function AdapterIcon({ adapter }: { adapter: 'claude' | 'codex' }) {
  if (adapter === 'claude') {
    return (
      <svg className="adapter-brand-icon adapter-brand-claude" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 15.2 9l6.3.1-3.1 5.5 3 5.4-6.2.1L12 20.5 8.8 15l-6.3-.1 3.1-5.5-3-5.4 6.2-.1L12 3.5Z" />
      </svg>
    )
  }
  return (
    <svg className="adapter-brand-icon adapter-brand-codex" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4l8-4.6Z" />
      <path d="M8.2 9.2 12 7l3.8 2.2v5.6L12 17l-3.8-2.2V9.2Z" />
    </svg>
  )
}

const ADAPTER_OPTIONS: Array<{ value: AgentAdapter; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
]

const CLAUDE_PERMISSION_MODE_OPTIONS: Array<{ value: PermissionModeChoice; label: string }> = [
  { value: 'claude-ask', label: 'Ask permissions' },
  { value: 'claude-auto-edits', label: 'Auto accept edits' },
  { value: 'claude-plan', label: 'Plan mode' },
  { value: 'claude-auto', label: 'Auto' },
  { value: 'claude-bypass', label: 'Bypass permissions' },
]

const CODEX_PERMISSION_MODE_OPTIONS: Array<{ value: PermissionModeChoice; label: string }> = [
  { value: 'codex-default', label: '默认权限' },
  { value: 'codex-auto-review', label: '自动审查' },
  { value: 'codex-full-access', label: '完全访问' },
]

function getPermissionModeOptions(adapter: AgentAdapter): Array<{ value: PermissionModeChoice; label: string }> {
  return adapter === 'claude' ? CLAUDE_PERMISSION_MODE_OPTIONS : CODEX_PERMISSION_MODE_OPTIONS
}

function getValidPermissionMode(value: PermissionModeChoice | undefined, adapter: AgentAdapter): PermissionModeChoice {
  const options = getPermissionModeOptions(adapter)
  return options.some((option) => option.value === value)
    ? value as PermissionModeChoice
    : options[0]?.value ?? (adapter === 'claude' ? 'claude-ask' : 'codex-default')
}

function readComposerPrefs(): ComposerPrefs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COMPOSER_PREFS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as ComposerPrefs
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeComposerPrefs(patch: ComposerPrefs): void {
  if (typeof window === 'undefined') return
  const next: ComposerPrefs = { ...readComposerPrefs(), ...patch }
  for (const key of Object.keys(next) as Array<keyof ComposerPrefs>) {
    if (next[key] === undefined) delete next[key]
  }
  window.localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(next))
}

function getPreferredProvider(
  providers: ProviderProfile[],
  prefs: ComposerPrefs,
  adapter: AgentAdapter,
): ProviderProfile | undefined {
  return providers.find((provider) => provider.id === prefs.providerProfileId && getProviderAdapterKind(provider) === adapter)
    ?? providers.find((provider) => provider.isDefault && getProviderAdapterKind(provider) === adapter)
    ?? providers.find((provider) => getProviderAdapterKind(provider) === adapter)
    ?? providers.find((provider) => provider.provider === 'anthropic')
    ?? providers[0]
}

function getProviderAdapterKind(provider: ProviderProfile): AgentAdapter {
  return provider.provider === 'anthropic' ? 'claude' : 'codex'
}

function getReasoningOptions(adapter: 'claude' | 'codex'): Array<{ value: SessionReasoningEffort; label: string }> {
  if (adapter === 'claude') {
    return [
      { value: 'low', label: 'low' },
      { value: 'medium', label: 'middle' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
    ]
  }
  return [
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
    { value: 'xhigh', label: '超高' },
  ]
}

function estimateContextWindow(modelId: string): number {
  const lower = modelId.toLowerCase()
  if (lower.includes('1m') || lower.includes('gemini-1.5-pro')) return 1_000_000
  if (lower.includes('200k') || lower.includes('claude')) return 200_000
  if (lower.includes('32k')) return 32_000
  if (lower.includes('16k')) return 16_000
  if (lower.includes('8k')) return 8_000
  return 128_000
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return `${value}`
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
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className="composer">
          <textarea
            rows={2}
            placeholder={sessionId ? '询问、修改、运行任务…  ↵ 发送' : '请先选择或新建一个会话'}
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
              <span className="kbd">↵</span> 发送 &nbsp;<span className="kbd">⇧</span><span className="kbd">↵</span> 换行
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

function ChatInspector({
  session,
  workspace,
  messages,
  width,
  onWidthChange,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  messages: UIMessage[]
  width: number
  onWidthChange: (width: number) => void
}) {
  const plans = extractPlans(messages)
  const toolLogs = extractToolLogs(messages)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('inspector-resizing')
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return
    const delta = dragRef.current.startX - event.clientX
    onWidthChange(clamp(dragRef.current.startWidth + delta, 300, 620))
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('inspector-resizing')
  }

  return (
    <div className="inspector scroll" style={{ '--inspector-width': `${width}px` } as React.CSSProperties}>
      <div
        className="inspector-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
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
        <h4>计划</h4>
        {plans.length > 0 ? (
          plans.map((plan) => <PlanSummary key={plan.id} plan={plan} />)
        ) : (
          <div className="inspector-muted">暂无 Agent 计划</div>
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
      <div className="inspector-section inspector-section-fill">
        <h4>
          工具日志
          <span className="inspector-count">{toolLogs.length}</span>
        </h4>
        {toolLogs.length > 0 ? (
          <div className="inspector-log-list">
            {toolLogs.map((log) => <ToolLogItem key={log.id} log={log} />)}
          </div>
        ) : (
          <div className="inspector-muted">暂无工具调用</div>
        )}
      </div>
    </div>
  )
}

type SidebarPlan = {
  id: string
  title: string
  explanation?: string | undefined
  items: Array<{ text: string; status: 'done' | 'running' | 'pending' }>
}

type ToolLog = {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'pending' | 'running' | 'success' | 'error'
  output?: string | undefined
  error?: string | undefined
  durationMs?: number | undefined
}

function PlanSummary({ plan }: { plan: SidebarPlan }) {
  const completed = plan.items.filter((item) => item.status === 'done').length
  const total = plan.items.length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <div className="inspector-plan">
      <div className="inspector-plan-head">
        <span className="strong truncate">{plan.title}</span>
        <span className="mono-sm">{completed}/{total}</span>
      </div>
      <div className="inspector-progress"><span style={{ width: `${percent}%` }} /></div>
      {plan.explanation && <div className="inspector-plan-note md-surface"><MarkdownText content={plan.explanation} /></div>}
      <div className="inspector-plan-items">
        {plan.items.map((item, index) => (
          <div key={`${item.text}-${index}`} className={`inspector-plan-item ${item.status}`}>
            <span className="inspector-plan-dot">
              {item.status === 'done' && <Icons.Check size={10} />}
              {item.status === 'running' && <Icons.Spinner size={10} />}
            </span>
            <span className="text">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolLogItem({ log }: { log: ToolLog }) {
  const [open, setOpen] = useState(false)
  const statusLabel = log.status === 'success' ? 'ok' : log.status === 'error' ? 'error' : log.status

  return (
    <div className={`inspector-log ${open ? 'open' : ''}`}>
      <button className="inspector-log-head" onClick={() => setOpen((prev) => !prev)}>
        <Icons.Wrench size={13} />
        <span className="tool-name">{log.name}</span>
        <span className={`badge ${log.status === 'error' ? 'danger' : log.status === 'success' ? 'success' : 'info'}`}>{statusLabel}</span>
        <Icons.ChevronRight size={12} className="chev" />
      </button>
      {open && (
        <div className="inspector-log-body">
          <div className="inspector-log-label">参数</div>
          <pre>{JSON.stringify(log.input, null, 2)}</pre>
          {log.output && (
            <>
              <div className="inspector-log-label">输出</div>
              <div className="md-surface"><MarkdownText content={log.output} /></div>
            </>
          )}
          {log.error && (
            <>
              <div className="inspector-log-label danger">错误</div>
              <div className="tool-error-span">{log.error}</div>
            </>
          )}
          {log.durationMs != null && <div className="inspector-log-duration">{log.durationMs} ms</div>}
        </div>
      )}
    </div>
  )
}

function extractPlans(messages: UIMessage[]): SidebarPlan[] {
  const plans: SidebarPlan[] = []

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'tool_call') continue
      const rawPlan = Array.isArray(block.toolInput.plan) ? block.toolInput.plan : undefined
      if (rawPlan == null && !isPlanToolName(block.toolName)) continue
      const items = (rawPlan ?? []).flatMap((item, index) => {
        if (!isRecord(item)) return []
        const text = String(item.step ?? item.text ?? item.title ?? `Step ${index + 1}`)
        return [{ text, status: normalizePlanStatus(item.status) }]
      })
      if (items.length === 0) continue
      plans.push({
        id: block.toolCallId,
        title: String(block.toolInput.title ?? 'Agent 计划'),
        explanation: typeof block.toolInput.explanation === 'string' ? block.toolInput.explanation : undefined,
        items,
      })
    }
  }

  return plans.slice(-3).reverse()
}

function extractToolLogs(messages: UIMessage[]): ToolLog[] {
  return messages.flatMap((message) => message.blocks.flatMap((block) => (
    block.kind === 'tool_call'
      ? [{
        id: block.toolCallId,
        name: block.toolName,
        input: block.toolInput,
        status: block.status,
        output: block.output,
        error: block.error,
        durationMs: block.durationMs,
      }]
      : []
  ))).reverse()
}

function isPlanToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('update_plan') || lower.includes('todo') || lower.includes('plan')
}

function normalizePlanStatus(value: unknown): 'done' | 'running' | 'pending' {
  if (value === 'completed' || value === 'complete' || value === 'done') return 'done'
  if (value === 'in_progress' || value === 'running' || value === 'active') return 'running'
  return 'pending'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function getLatestInputTokens(events: AgentEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'usage_update' && event.inputTokens > 0) return event.inputTokens
  }
  return 0
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
