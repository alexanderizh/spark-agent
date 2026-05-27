/**
 * ChatView — 真实 IPC 驱动的会话视图
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { Icons } from '../Icons'
import { ErrorCard, FilePermCard, NetPermCard, MCPPermCard, HunkDiff, PlanCard, SubagentCard, Checkpoint, SandboxNote, QuickActions, ToolChooser } from '../ChatInteractions'
import { SparkInput } from '../components/FormControls'
import { CODING_AGENT_TOOLS } from '../data/available-tools'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { MessageBuilder } from '../services/event-mapper'
import { useToast } from '../components/Toast'
import { parseSkillManifest } from '../utils/skills-data'
import type { UIMessage, UIBlock } from '../services/event-mapper'
import type {
  AgentEvent,
  AgentStatusValue,
  ExternalToolInfo,
  ProviderProfile,
  SessionAgentAdapter,
  SessionChatMode,
  SessionListResponse,
  SessionPermissionMode,
  PermissionApprovalDecision,
  PermissionApprovalRequest,
  PromptConfigGetResponse,
  SessionId,
  SessionReasoningEffort,
  SessionSearchResult,
  SkillConfigGetResponse,
  WorkspaceInfo,
  CommandListItem,
} from '@spark/protocol'
import { ModelCapabilityRegistry } from '@spark/shared'

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
type QueuedMessage = { id: string; content: string }
type ChatViewProps = {
  approvalRequest?: PermissionApprovalRequest | null
  onApprovalClose?: () => void
}

/** Per-turn token usage snapshot */
type UsageSnapshot = {
  turnId: string
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  estimatedCostUsd: number
  timestamp: string
}

/** Aggregated token usage data for a session */
type SessionUsageData = {
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  estimatedCostUsd: number
  contextWindow: number
  turns: UsageSnapshot[]
}

/** Snapshot from agent-loop context_usage event */
type ContextUsageState = {
  estimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  compactedThisTurn: boolean
}

const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'
const SESSION_HISTORY_PAGE_SIZE = 500
const LAST_SESSION_KEY = 'spark-agent:last-active-session'
const SIDEBAR_WIDTH_KEY = 'spark-agent:sidebar-width'
const SIDEBAR_DEFAULT_WIDTH = 254
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 480
const EMPTY_PROMPT_LAYER: PromptConfigGetResponse['system'] = { enabled: false, content: '' }

export function ChatView({ approvalRequest = null, onApprovalClose }: ChatViewProps = {}) {
  const [active, setActive] = useState<SessionId | null>(() => {
    const stored = window.localStorage.getItem(LAST_SESSION_KEY)
    return stored == null ? null : stored as SessionId
  })
  const [showInspector, setShowInspector] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(360)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) {
        return parsed
      }
    }
    return SIDEBAR_DEFAULT_WIDTH
  })
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<string>('')
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([])
  const [contextInputTokens, setContextInputTokens] = useState(0)
  const [sessionUsageData, setSessionUsageData] = useState<SessionUsageData>({
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  })
  const [contextUsage, setContextUsage] = useState<ContextUsageState | null>(null)
  const [proposedPlan, setProposedPlan] = useState<string | null>(null)
  const [branchState, setBranchState] = useState<BranchState>({ currentBranch: null, branches: [] })
  const [projectDialog, setProjectDialog] = useState<'create' | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [notice, setNotice] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [clearTrigger, setClearTrigger] = useState(0)
  const { toast } = useToast()
  const { invoke: clearEvents } = useIpcInvoke('session:clear-events')

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SessionSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sidebar resize
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    sidebarDragRef.current = { startX: event.clientX, startWidth: sidebarWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('sidebar-resizing')
  }

  const handleSidebarResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarDragRef.current == null) return
    const delta = event.clientX - sidebarDragRef.current.startX
    const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, sidebarDragRef.current.startWidth + delta))
    setSidebarWidth(newWidth)
  }

  const handleSidebarResizeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarDragRef.current != null) {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    }
    sidebarDragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('sidebar-resizing')
  }

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: searchSessions } = useIpcInvoke('session:search')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: deleteSession } = useIpcInvoke('session:delete')
  const { invoke: cancelSessionTurn } = useIpcInvoke('session:cancel')
  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: updateWorkspace } = useIpcInvoke('workspace:update')
  const { invoke: deleteWorkspace } = useIpcInvoke('workspace:delete')
  const { invoke: openWorkspaceFolder } = useIpcInvoke('workspace:open-folder')
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: listBranches } = useIpcInvoke('workspace:list-branches')
  const { invoke: switchBranch } = useIpcInvoke('workspace:switch-branch')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: getTempProjectDir } = useIpcInvoke('app:get-temp-project-dir')

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
    setSelectedProviderId((prev) => prev || getPreferredProvider(providerRes.profiles, readComposerPrefs(), DEFAULT_AGENT_ADAPTER)?.id || '')
    setActiveWorkspaceId((prev) => currentRes.workspace?.id ?? prev ?? workspaceRes.workspaces[0]?.id ?? null)
  }, [getCurrentWorkspace, listProviders, listSessions, listWorkspaces])

  const refreshSessions = () => {
    refreshProjectsAndSessions().catch(console.error)
  }

  const handleClearMessages = useCallback(() => {
    if (!active) return
    clearEvents({ sessionId: active }).then(() => {
      setClearTrigger(prev => prev + 1)
      refreshSessions()
    }).catch(console.error)
  }, [active, clearEvents, refreshSessions])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshProjectsAndSessions().catch(console.error)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshProjectsAndSessions])

  // Persist active session to localStorage
  useEffect(() => {
    if (active) {
      window.localStorage.setItem(LAST_SESSION_KEY, active)
    } else {
      window.localStorage.removeItem(LAST_SESSION_KEY)
    }
  }, [active])

  // Validate restored session exists after sessions load; restore workspace if needed
  useEffect(() => {
    if (!active || sessions.length === 0) return
    const found = sessions.find((s) => s.id === active)
    if (!found) {
      setActive(null)
    } else if (activeWorkspaceId == null && found.workspaceIds.length > 0) {
      setActiveWorkspaceId(found.workspaceIds[0] ?? null)
    }
  }, [active, activeWorkspaceId, sessions])

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
      const preferredAdapter = options.agentAdapter ?? prefs.adapter ?? DEFAULT_AGENT_ADAPTER
      const profile = knownProviders.find((item) => item.id === options.providerProfileId)
        ?? knownProviders.find((item) => item.id === selectedProviderId && isProviderCompatibleWithAdapter(item, preferredAdapter))
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

  const handleCreateProject = async (useTempDir = false) => {
    let rootPath = projectPath.trim()
    let name = projectName.trim() || getBasename(rootPath) || '新项目'

    // 如果选择使用临时目录，则自动生成路径
    if (useTempDir || !rootPath) {
      try {
        const { tempDir } = await getTempProjectDir({})
        const timestamp = Date.now()
        const safeName = name.replace(/[^a-zA-Z0-9一-龥_-]/g, '_') || 'project'
        rootPath = `${tempDir}/${safeName}-${timestamp}`
      } catch (err) {
        console.error('获取临时目录失败', err)
        toast.error('获取临时目录失败')
        return
      }
    }

    try {
      setNotice('')
      const res = await openWorkspace({ create: { name, rootPath } })
      setProjectDialog(null)
      setProjectName('')
      setProjectPath('')
      setActiveWorkspaceId(res.workspace.id)
      await refreshProjectsAndSessions()
      toast.success(`项目已创建于：${rootPath}`)
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

  const setSessionStatus = useCallback((sessionId: SessionId, status: SessionSummary['status']) => {
    setSessions((prev) => prev.map((item) => item.id === sessionId ? { ...item, status } : item))
  }, [])

  const handleCancelSession = useCallback(async (sessionId: SessionId) => {
    try {
      const res = await cancelSessionTurn({ sessionId })
      setAgentStatus('')
      setSessionStatus(sessionId, 'idle')
      await refreshProjectsAndSessions()
      if (res.cancelled) {
        toast.success('已停止会话')
      } else {
        toast.info('该会话当前没有运行中的任务')
      }
    } catch (err) {
      console.error('停止会话失败', err)
      toast.error(err instanceof Error ? err.message : '停止会话失败')
    }
  }, [cancelSessionTurn, refreshProjectsAndSessions, setSessionStatus, toast])

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
      <div
        className="chat-sidebar"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div
          className="sidebar-resize-handle"
          title="拖拽调整侧边栏宽度"
          onPointerDown={handleSidebarResizeStart}
          onPointerMove={handleSidebarResizeMove}
          onPointerUp={handleSidebarResizeEnd}
          onPointerCancel={handleSidebarResizeEnd}
        />
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
            <TimeFilterDropdown value={timeFilter} onChange={setTimeFilter} />

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
          {...(active ? { onClearMessages: handleClearMessages } : {})}
        />
        {active ? (
          <>
            <ChatStream
              sessionId={active}
              onStatusChange={setAgentStatus}
              onUsageChange={setContextInputTokens}
              onUsageDataChange={setSessionUsageData}
              onMessagesChange={setActiveMessages}
              onSessionStatusChange={(status) => {
                setSessionStatus(active, status)
                if (status !== 'running') refreshSessions()
              }}
              onContextUsageChange={setContextUsage}
              onPlanProposed={setProposedPlan}
              clearTrigger={clearTrigger}
            />
          </>
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
          contextUsage={contextUsage}
          isWorking={agentStatus.length > 0 || activeSession?.status === 'running'}
          approvalRequest={approvalRequest}
          {...(onApprovalClose !== undefined ? { onApprovalClose } : {})}
          onCreateSession={(options) => handleNewSession(activeWorkspaceId, options)}
          onUpdateSession={handleUpdateActiveSession}
          onSwitchBranch={handleSwitchBranch}
          onCancelSession={handleCancelSession}
          onSent={(sessionId) => {
            setSessionStatus(sessionId, 'running')
            refreshSessions()
          }}
        />
      </div>

      {showInspector && (
        <ChatInspector
          session={activeSession}
          workspace={activeWorkspace}
          messages={active == null ? [] : activeMessages}
          usageData={sessionUsageData}
          contextInputTokens={contextInputTokens}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          onOpenProjectFolder={() => {
            if (activeWorkspace) void handleOpenProjectFolder(activeWorkspace)
          }}
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

      {proposedPlan != null && active != null && (
        <PlanApprovalModal
          sessionId={active}
          plan={proposedPlan}
          onClose={() => setProposedPlan(null)}
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

function TimeFilterDropdown({ value, onChange }: { value: TimeFilter; onChange: (value: TimeFilter) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const options: Array<{ value: TimeFilter; label: string }> = [
    { value: 'all', label: '全部会话' },
    { value: '1d', label: '最近 1 天' },
    { value: '3d', label: '最近 3 天' },
    { value: '7d', label: '最近 7 天' },
    { value: '10d', label: '最近 10 天' },
  ]

  const currentLabel = options.find(o => o.value === value)?.label ?? '全部会话'

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="session-filter-bar" ref={ref}>
      <button
        className={`filter-trigger${value !== 'all' ? ' has-filter' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        aria-label="筛选会话"
      >
        <span>{currentLabel}</span>
        <Icons.ChevronDown size={12} className={`filter-chevron${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="filter-dropdown">
          {options.map((option) => (
            <button
              key={option.value}
              className={`filter-option${value === option.value ? ' active' : ''}`}
              onClick={() => { onChange(option.value); setOpen(false) }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
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
        {open ? (
          <Icons.FolderOpen size={15} className="proj-folder-icon" />
        ) : (
          <Icons.ProjectFolder size={15} className="proj-folder-icon" />
        )}
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
  const isRunning = s.status === 'running'
  return (
    <div className={`chat-item proj-session chat-item-compact ${active === s.id ? 'active' : ''} ${isRunning ? 'is-running' : ''}`} onClick={() => onClick(s.id)}>
      <div className="chat-item-row">
        <div className="chat-item-title-compact">
          {s.pinnedAt != null && <Icons.Pin size={10} className="pinned-icon" />}
          <span className="truncate">{s.title || '新会话'}</span>
        </div>
        {isRunning ? (
          <span className="session-running-badge" title="运行中">
            <Icons.Spinner size={10} />
            <span>运行中</span>
          </span>
        ) : (
          <span className="chat-item-time-compact">{formatRelativeTime(s.updatedAt)}</span>
        )}
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

// ─── Tool Dropdown (IDE / Terminal open) ─────────────────────────────────

function ToolDropdown({
  kind,
  rootPath,
}: {
  kind: 'ide' | 'terminal'
  rootPath: string
}) {
  const [open, setOpen] = useState(false)
  const [tools, setTools] = useState<ExternalToolInfo[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isIde = kind === 'ide'
  const TriggerIcon = isIde ? Icons.Code : Icons.Terminal
  const tooltip = isIde ? '在编辑器中打开' : '在终端中打开'

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    if (!open || tools.length > 0) return
    let cancelled = false
    setLoading(true)
    window.spark.invoke('tool:detect', { kind })
      .then((res) => { if (!cancelled) setTools(Array.isArray(res.tools) ? res.tools : []) })
      .catch(() => { if (!cancelled) setTools([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, kind, tools.length])

  const handleSelect = async (tool: ExternalToolInfo) => {
    setOpen(false)
    try {
      await window.spark.invoke('tool:open-project', { toolId: tool.id, rootPath })
    } catch (err) {
      console.error(`Failed to open in ${tool.name}:`, err)
    }
  }

  const availableTools = tools.filter(t => t.available)

  return (
    <div className="tool-dropdown-wrap" ref={ref}>
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        title={tooltip}
        onClick={() => setOpen(prev => !prev)}
      >
        <TriggerIcon size={14} />
      </button>
      {open && (
        <div className="tool-dropdown">
          {loading && (
            <div className="tool-dropdown-loading">
              <Icons.Spinner size={12} /> 检测中...
            </div>
          )}
          {!loading && availableTools.length === 0 && (
            <div className="tool-dropdown-empty">
              未检测到已安装的{isIde ? '编辑器' : '终端'}工具
            </div>
          )}
          {!loading && availableTools.map(tool => (
            <button
              key={tool.id}
              className="tool-dropdown-item"
              onClick={() => handleSelect(tool)}
            >
              <span className="tool-dropdown-item-icon">
                {tool.kind === 'ide' ? <Icons.Code size={13} /> : <Icons.Terminal size={13} />}
              </span>
              <span className="tool-dropdown-item-name">{tool.name}</span>
            </button>
          ))}
          {!loading && availableTools.length > 0 && (
            <button
              className="tool-dropdown-item tool-dropdown-refresh"
              onClick={() => setTools([])}
            >
              <Icons.Refresh size={12} />
              <span>重新检测</span>
            </button>
          )}
        </div>
      )}
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
  onClearMessages,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  agentStatus: string
  showInspector: boolean
  setShowInspector: (v: boolean) => void
  onClearMessages?: () => void
}) {
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearClick = () => {
    setShowClearConfirm(true)
  }

  const handleClearConfirm = () => {
    setShowClearConfirm(false)
    onClearMessages?.()
  }

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
        {workspace && (
          <>
            <ToolDropdown kind="ide" rootPath={workspace.rootPath} />
            <ToolDropdown kind="terminal" rootPath={workspace.rootPath} />
          </>
        )}
        {showClearConfirm && onClearMessages && (
          <div className="clear-confirm-bar">
            <span className="clear-confirm-text">确认清空？</span>
            <button className="btn ghost sm clear-confirm-cancel" onClick={() => setShowClearConfirm(false)}>取消</button>
            <button className="btn sm danger-btn" onClick={handleClearConfirm}>清空</button>
          </div>
        )}
        {!showClearConfirm && onClearMessages && (
          <button className="icon-btn" title="清空会话消息" onClick={handleClearClick}><Icons.Trash size={14} /></button>
        )}
        <button
          className={`icon-btn ${showInspector ? 'active' : ''}`}
          title="会话检查器"
          aria-label="会话检查器"
          onClick={() => setShowInspector(!showInspector)}
        >
          <Icons.PanelRight />
        </button>
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
            <span>项目文件夹地址（可选）</span>
            <div className="path-picker">
              <SparkInput
                value={path}
                placeholder="/Users/you/projects/my-agent"
                onChange={(event) => setPath(event.target.value)}
              />
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

function ChatStream({
  sessionId,
  onStatusChange,
  onUsageChange,
  onUsageDataChange,
  onMessagesChange,
  onSessionStatusChange,
  onContextUsageChange,
  onPlanProposed,
  clearTrigger,
}: {
  sessionId: SessionId
  onStatusChange: (s: string) => void
  onUsageChange: (tokens: number) => void
  onUsageDataChange: (data: SessionUsageData) => void
  onMessagesChange: (messages: UIMessage[]) => void
  onSessionStatusChange: (status: SessionSummary['status']) => void
  onContextUsageChange: (snapshot: ContextUsageState | null) => void
  onPlanProposed: (plan: string) => void
  /** 递增时清空 ChatStream 内部消息状态 */
  clearTrigger?: number
}) {
  const streamRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const builderRef = useRef(new MessageBuilder())
  const rafRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  const userScrolledRef = useRef(false)
  const hydratingRef = useRef(false)
  const bufferedEventsRef = useRef<AgentEvent[]>([])
  const historyLoadIdRef = useRef(0)
  const usageRef = useRef<SessionUsageData>({ inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, estimatedCostUsd: 0, contextWindow: 0, turns: [] })
  const { invoke: getHistory } = useIpcInvoke('session:get-history')
  const { invoke: deleteMessageEvents } = useIpcInvoke('session:delete-message')

  // ── 会话消息缓存：避免切换时从空白开始 ──
  // 缓存每个会话最后渲染的消息列表，切回时立即显示缓存内容，再异步更新
  const sessionCacheRef = useRef<Map<SessionId, { messages: UIMessage[]; usage: SessionUsageData; status: string }>>(new Map())

  // 切换会话时加载历史（优先展示缓存，异步加载最新）
  useEffect(() => {
    const loadId = historyLoadIdRef.current + 1
    historyLoadIdRef.current = loadId
    hydratingRef.current = true
    bufferedEventsRef.current = []
    let cancelled = false

    // 1) 立即展示缓存，避免空白闪烁
    const cached = sessionCacheRef.current.get(sessionId)
    if (cached != null) {
      const cachedBuilder = new MessageBuilder()
      // 从缓存的 messages 无法精确重建 builder，但可以立即显示
      setMessages(cached.messages)
      onMessagesChange(cached.messages)
      onStatusChange(cached.status)
      usageRef.current = cached.usage
      onUsageDataChange(cached.usage)
    } else {
      // 首次进入的会话，短暂延迟后清空再加载
      setMessages([])
      onMessagesChange([])
      onStatusChange('')
    }

    isStreamingRef.current = false
    userScrolledRef.current = false
    onContextUsageChange(null)

    // 2) 异步从 SQLite 加载完整历史并更新
    const timer = window.setTimeout(() => {
      loadCompleteSessionHistory(getHistory, sessionId)
        .then(historyEvents => {
          if (cancelled || historyLoadIdRef.current !== loadId) return
          const events = mergeSessionEvents(historyEvents, bufferedEventsRef.current)
          const hydratedBuilder = new MessageBuilder()
          for (const event of events) hydratedBuilder.processEvent(event)
          builderRef.current = hydratedBuilder
          const nextMessages = hydratedBuilder.getAllMessages()
          setMessages(nextMessages)
          onMessagesChange(nextMessages)
          onUsageChange(getLatestInputTokens(events))
          const historyUsage = buildUsageDataFromEvents(events)
          usageRef.current = historyUsage
          onUsageDataChange(historyUsage)
          // 更新缓存
          const latestStatus = getLatestAgentStatus(events)
          const statusStr = latestStatus != null
            ? (latestStatus === 'thinking' || latestStatus === 'calling_tool' ? 'running' : latestStatus === 'error' ? 'error' : '')
            : ''
          sessionCacheRef.current.set(sessionId, { messages: nextMessages, usage: historyUsage, status: statusStr })
          if (latestStatus != null) applyAgentStatus(latestStatus, onStatusChange, onSessionStatusChange, isStreamingRef, userScrolledRef)
          const latestContext = getLatestContextUsageEvent(events)
          if (latestContext != null) {
            onContextUsageChange({
              estimatedTokens: latestContext.estimatedTokens,
              softLimitTokens: latestContext.softLimitTokens,
              contextWindowTokens: latestContext.contextWindowTokens,
              compactedThisTurn: latestContext.compacted,
            })
          }
        })
        .catch((err) => {
          console.error('Failed to load session history:', err)
          if (!cancelled && historyLoadIdRef.current === loadId) {
            // 历史加载失败，使用缓冲的 live 事件回退
            const bufferedEvents = bufferedEventsRef.current
            if (bufferedEvents.length > 0) {
              const fallbackBuilder = new MessageBuilder()
              for (const event of bufferedEvents) fallbackBuilder.processEvent(event)
              builderRef.current = fallbackBuilder
              const fallbackMessages = fallbackBuilder.getAllMessages()
              setMessages(fallbackMessages)
              onMessagesChange(fallbackMessages)
            }
          }
        })
        .finally(() => {
          if (!cancelled && historyLoadIdRef.current === loadId) {
            hydratingRef.current = false
            bufferedEventsRef.current = []
          }
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      // 离开当前会话时，保存消息到缓存
      const currentMessages = builderRef.current.getAllMessages()
      if (currentMessages.length > 0) {
        sessionCacheRef.current.set(sessionId, {
          messages: [...currentMessages],
          usage: usageRef.current,
          status: '',
        })
      }
      if (historyLoadIdRef.current === loadId) {
        hydratingRef.current = false
        bufferedEventsRef.current = []
      }
    }
  }, [getHistory, onMessagesChange, onStatusChange, onUsageChange, onUsageDataChange, onContextUsageChange, sessionId])

  // 使用 requestAnimationFrame 批量更新，确保 text_delta 立即渲染无延迟
  const flushMessages = useCallback(() => {
    rafRef.current = null
    const nextMessages = [...builderRef.current.getAllMessages()]
    setMessages(nextMessages)
    onMessagesChange(nextMessages)
  }, [onMessagesChange])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(flushMessages)
  }, [flushMessages])

  // 清理 RAF
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // 外部触发清空消息
  useEffect(() => {
    if (clearTrigger === undefined || clearTrigger === 0) return
    builderRef.current.clearAll()
    sessionCacheRef.current.delete(sessionId)
    setMessages([])
    onMessagesChange([])
    onStatusChange('')
    onUsageDataChange({ inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, estimatedCostUsd: 0, contextWindow: 0, turns: [] })
    onContextUsageChange(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTrigger])

  // Track user scroll position to avoid auto-scrolling when user scrolls up
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    const handleScroll = () => {
      const threshold = 80
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledRef.current = distanceFromBottom > threshold
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // 实时监听新事件 — useIpcStream 内部通过 ref 持有 callback，不会因 deps 变化重订阅
  // 这里直接用闭包中的 sessionId 过滤即可
  useIpcStream('stream:session:agent-event', (event) => {
    if (event.sessionId !== sessionId) return
    if (hydratingRef.current) {
      bufferedEventsRef.current.push(event)
      return
    }
    builderRef.current.processEvent(event)

    // 对状态/用量事件立即处理（不走 RAF 延迟）
    if (event.type === 'agent_status') {
      applyAgentStatus(event.status, onStatusChange, onSessionStatusChange, isStreamingRef, userScrolledRef)
    }
    if (event.type === 'usage_update') {
      if (event.inputTokens > 0) onUsageChange(event.inputTokens)
      // Update full usage data
      const snapshot: UsageSnapshot = {
        turnId: event.turnId,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheHitTokens: event.cacheHitTokens ?? 0,
        estimatedCostUsd: event.estimatedCostUsd ?? 0,
        timestamp: event.timestamp,
      }
      const prev = usageRef.current
      const next: SessionUsageData = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheHitTokens: event.cacheHitTokens ?? prev.cacheHitTokens,
        estimatedCostUsd: (prev.estimatedCostUsd + (event.estimatedCostUsd ?? 0)),
        contextWindow: prev.contextWindow,
        turns: [...prev.turns, snapshot],
      }
      usageRef.current = next
      onUsageDataChange(next)
    }
    // Track user_message to reset scroll tracking
    if (event.type === 'user_message') {
      userScrolledRef.current = false
      isStreamingRef.current = true
    }

    if (event.type === 'context_usage') {
      onContextUsageChange({
        estimatedTokens: event.estimatedTokens,
        softLimitTokens: event.softLimitTokens,
        contextWindowTokens: event.contextWindowTokens,
        compactedThisTurn: event.compacted,
      })
    }

    if (event.type === 'plan_proposed') {
      onPlanProposed(event.plan)
    }

    // 对文本/思考增量事件立即 flush，确保无延迟感知
    if (
      event.type === 'assistant_message' && event.mode === 'delta'
      || event.type === 'agent_thinking' && event.mode === 'delta'
    ) {
      // 取消已有的 RAF，立即同步渲染 delta
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const nextMessages = [...builderRef.current.getAllMessages()]
      setMessages(nextMessages)
      onMessagesChange(nextMessages)
      return
    }

    // 其他事件走 RAF 批量
    scheduleFlush()
  }, [onMessagesChange, onStatusChange, onUsageChange, onUsageDataChange, onSessionStatusChange, onContextUsageChange, onPlanProposed, flushMessages, scheduleFlush])

  // 智能自动滚动：只在用户未主动上滚时自动跟随
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    if (!userScrolledRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // 是否有正在流式传输的消息
  const hasStreamingMsg = messages.some(m => m.status === 'streaming')

  const handleDeleteMessage = useCallback((msgId: string, eventIds: string[]) => {
    deleteMessageEvents({ sessionId, eventIds }).then(() => {
      builderRef.current.removeMessage(msgId)
      sessionCacheRef.current.delete(sessionId)
      const nextMessages = builderRef.current.getAllMessages()
      setMessages(nextMessages)
      onMessagesChange(nextMessages)
    }).catch(console.error)
  }, [deleteMessageEvents, sessionId, onMessagesChange])

  return (
    <div className="chat-stream" ref={streamRef}>
      <div className="chat-stream-inner">
        {messages.map((msg, index) =>
          msg.role === 'user' ? (
            <UserMsg key={msg.id} timestamp={msg.timestamp} blocks={msg.blocks} onDelete={() => handleDeleteMessage(msg.id, msg.eventIds)}>{renderBlocks(msg.blocks)}</UserMsg>
          ) : msg.status === 'streaming' ? (
            <AgentMsg
              key={msg.id}
              sessionId={sessionId}
              status="running"
              blocks={msg.blocks}
              messageStatus={msg.status}
              isLatest={index === messages.length - 1}
              timestamp={msg.timestamp}
            />
          ) : (
            <AgentMsg
              key={msg.id}
              sessionId={sessionId}
              blocks={msg.blocks}
              messageStatus={msg.status}
              isLatest={index === messages.length - 1}
              timestamp={msg.timestamp}
              onDelete={() => handleDeleteMessage(msg.id, msg.eventIds)}
            />
          )
        )}
        {messages.length === 0 && (
          <div className="chat-stream-empty-state">
            <div className="empty-state">
              <div className="empty-icon"><Icons.Chat size={24} /></div>
              <div className="empty-title">开始对话</div>
              <div className="empty-desc">发送消息开始与 AI 交互</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type GetSessionHistory = (request: {
  sessionId: SessionId
  limit?: number
  beforeSeq?: number
}) => Promise<{ events: AgentEvent[]; hasMore: boolean }>

async function loadCompleteSessionHistory(getHistory: GetSessionHistory, sessionId: SessionId): Promise<AgentEvent[]> {
  const pages: AgentEvent[][] = []
  let beforeSeq: number | undefined

  for (let page = 0; page < 200; page++) {
    const res = await getHistory({
      sessionId,
      limit: SESSION_HISTORY_PAGE_SIZE,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    })
    pages.unshift(res.events)
    if (!res.hasMore || res.events.length === 0) break

    const nextBeforeSeq = getFirstEventSeq(res.events)
    if (nextBeforeSeq === undefined || nextBeforeSeq === beforeSeq) break
    beforeSeq = nextBeforeSeq
  }

  return pages.flat()
}

function getFirstEventSeq(events: AgentEvent[]): number | undefined {
  const first = events[0]
  return typeof first?.seq === 'number' ? first.seq : undefined
}

function mergeSessionEvents(historyEvents: AgentEvent[], liveEvents: AgentEvent[]): AgentEvent[] {
  const byIdentity = new Map<string, AgentEvent>()
  for (const event of [...historyEvents, ...liveEvents]) {
    byIdentity.set(event.id, event)
  }
  return [...byIdentity.values()].sort(compareAgentEvents)
}

function compareAgentEvents(a: AgentEvent, b: AgentEvent): number {
  if (a.seq !== b.seq) return a.seq - b.seq
  const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  if (timeDiff !== 0) return timeDiff
  return a.id.localeCompare(b.id)
}

function getLatestAgentStatus(events: AgentEvent[]): AgentStatusValue | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'agent_status') return event.status
  }
  return null
}

function getLatestContextUsageEvent(events: AgentEvent[]): Extract<AgentEvent, { type: 'context_usage' }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'context_usage') return event
  }
  return null
}

function applyAgentStatus(
  status: AgentStatusValue,
  onStatusChange: (s: string) => void,
  onSessionStatusChange: (status: SessionSummary['status']) => void,
  isStreamingRef: { current: boolean },
  userScrolledRef: { current: boolean },
): void {
  const labels: Record<AgentStatusValue, string> = {
    idle: '',
    thinking: '思考中',
    calling_tool: '调用工具',
    waiting_permission: '等待授权',
    waiting_user: '等待用户',
    completed: '',
    error: '',
    cancelled: '',
  }
  onStatusChange(labels[status] ?? '')
  if (status === 'thinking' || status === 'calling_tool' || status === 'waiting_permission' || status === 'waiting_user') {
    onSessionStatusChange('running')
    isStreamingRef.current = true
  }
  if (status === 'idle' || status === 'completed' || status === 'cancelled') {
    onSessionStatusChange('idle')
    isStreamingRef.current = false
    userScrolledRef.current = false
  }
  if (status === 'error') {
    onSessionStatusChange('error')
    isStreamingRef.current = false
  }
}

function renderBlocks(blocks: UIBlock[], options: { surface?: 'main' | 'inspector' } = {}): ReactNode {
  const surface = options.surface ?? 'main'
  return blocks.map((block, i) => {
    switch (block.kind) {
      case 'text':
        return (
          <div key={i} className="md-surface">
            <MarkdownText content={block.content} isStreaming={block.isStreaming} />
          </div>
        )
      case 'thinking':
        return (
          <details key={i} className="block-thinking">
            <summary>思考过程</summary>
            <pre>{block.content}</pre>
          </details>
        )
      case 'tool_call': {
        const toolStatus = block.status === 'success' ? 'ok' as const : block.status === 'error' ? 'error' as const : null
        const toolArg = JSON.stringify(block.toolInput).slice(0, surface === 'main' ? 48 : 80)
        const isPending = block.status === 'pending' || block.status === 'running'
        const isTodoWrite = block.toolName === 'todo_write'
        // 把 todo_write 的输入直接作为预览，避免折叠后还要展开看（todos 数组本身就是状态）
        const todoListBody = isTodoWrite ? <TodoListInline input={block.toolInput} output={block.output} /> : null
        return toolStatus ? (
          <ToolCall key={i} name={block.toolName} arg={isTodoWrite ? '' : toolArg} status={toolStatus} durationMs={block.durationMs}>
            {todoListBody}
            {!isTodoWrite && block.output && <div className="tool-output-pre md-surface"><MarkdownText content={block.output} /></div>}
            {block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        ) : (
          <ToolCall key={i} name={block.toolName} arg={isTodoWrite ? '' : toolArg} pending={isPending} durationMs={block.durationMs}>
            {todoListBody}
            {!isTodoWrite && block.output && <div className="tool-output-pre md-surface"><MarkdownText content={block.output} /></div>}
            {block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        )
      }
      case 'error':
        // 错误卡由 AgentMsg 单独渲染（可获得 sessionId 上下文以支持调高迭代上限按钮），
        // 这里跳过避免重复渲染。
        return null
      case 'terminal':
        if (surface === 'main') return null
        return (
          <TerminalBlock key={i}>
            {block.stdout && <span>{block.stdout}</span>}
            {block.stderr && <span className="block-stderr">{block.stderr}</span>}
            {block.isStreaming && <span className="dim"> …</span>}
          </TerminalBlock>
        )
      case 'file_change': {
        if (block.diff) {
          const hunks = parseUnifiedDiff(block.diff)
          if (hunks.length > 0) {
            return (
              <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
                <HunkDiffWithFeedback path={block.path} hunks={hunks} />
              </div>
            )
          }
        }
        return (
          <div key={i} className="block-file-change">
            <Icons.File size={11} /> {block.changeType}: <code className="mono-sm">{block.path}</code>
          </div>
        )
      }
      case 'plan_proposed': {
        const items = parsePlanToItems(block.plan)
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <PlanCard title="Agent 计划" items={items} />
          </div>
        )
      }
      case 'permission_request': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <InlinePermissionCard block={block} />
          </div>
        )
      }
      case 'subagent': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <SubagentCard name={block.name} role={block.role} task={block.task} status={block.status} tokens={block.tokens} />
          </div>
        )
      }
      default:
        return null
    }
  })
}

// ─── Diff / Plan / Permission helper utilities ──────────────────────────────────

type DiffHunk = {
  range: string
  note: string
  adds: number
  dels: number
  lines: { t: 'add' | 'del' | 'ctx' | 'hunk'; n: number | string; s: string }[]
}

/** Parse a unified diff string into structured hunks for HunkDiff */
function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const lines = diff.split('\n')
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const rawLine of lines) {
    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = rawLine.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1] ?? '0', 10)
      newLine = parseInt(hunkMatch[2] ?? '0', 10)
      currentHunk = {
        range: rawLine.replace(/^@@\s*/, '').replace(/\s*@@.*$/, ''),
        note: hunkMatch[3]?.trim() ?? '',
        adds: 0,
        dels: 0,
        lines: [],
      }
      hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) {
      // Skip diff header lines (--- a/file, +++ b/file, etc.)
      continue
    }
    if (rawLine.startsWith('+')) {
      currentHunk.adds++
      currentHunk.lines.push({ t: 'add', n: newLine++, s: rawLine.slice(1) })
    } else if (rawLine.startsWith('-')) {
      currentHunk.dels++
      currentHunk.lines.push({ t: 'del', n: oldLine++, s: rawLine.slice(1) })
    } else if (rawLine.startsWith(' ')) {
      currentHunk.lines.push({ t: 'ctx', n: oldLine++, s: rawLine.slice(1) })
      newLine++
    }
    // Skip empty lines (end of diff) and other special lines (\ No newline...)
  }

  return hunks
}

/** Parse a markdown plan text into PlanCard items */
function parsePlanToItems(plan: string): { status: 'done' | 'running' | 'pending'; text: string; meta?: string }[] {
  const items: { status: 'done' | 'running' | 'pending'; text: string; meta?: string }[] = []
  const lines = plan.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Match checkbox items: - [x] done task, - [ ] pending task, - [*] running task
    const checkboxMatch = trimmed.match(/^[-*]\s+\[([ x*])\]\s+(.*)$/)
    if (checkboxMatch) {
      const mark = checkboxMatch[1]
      const text = checkboxMatch[2] ?? ''
      if (mark === 'x' || mark === 'X') {
        items.push({ status: 'done', text })
      } else if (mark === '*') {
        items.push({ status: 'running', text })
      } else {
        items.push({ status: 'pending', text })
      }
      continue
    }
    // Match numbered items: 1. task text
    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (numberedMatch) {
      items.push({ status: 'pending', text: numberedMatch[1] ?? '' })
      continue
    }
    // Match bullet items: - task text (non-checkbox)
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (bulletMatch && (bulletMatch[1] ?? '').length > 0 && !(bulletMatch[1] ?? '').startsWith('[')) {
      items.push({ status: 'pending', text: bulletMatch[1] ?? '' })
    }
  }
  // If no structured items found, treat whole plan as a single pending item
  if (items.length === 0 && plan.trim().length > 0) {
    const fallbackItem: { status: 'done' | 'running' | 'pending'; text: string; meta?: string } = {
      status: 'pending',
      text: plan.trim().slice(0, 200),
    }
    if (plan.trim().length > 200) {
      fallbackItem.meta = '...'
    }
    items.push(fallbackItem)
  }
  return items
}

/** Inline permission card rendered within the message stream */
function InlinePermissionCard({ block }: {
  block: Extract<UIBlock, { kind: 'permission_request' }>
}) {
  const { toast } = useToast()
  const { action, riskLevel, description, paths, command, domains } = block

  const handleAllow = () => {
    console.log('[PermCard] allowed:', block.requestId)
    toast.success(`已允许: ${description}`)
  }

  const handleDeny = () => {
    console.log('[PermCard] denied:', block.requestId)
    toast.info(`已拒绝: ${description}`)
  }

  // Route to the appropriate card based on action type
  if (action === 'file_read' || action === 'file_write') {
    return (
      <FilePermCard
        path={paths?.[0] ?? description}
        scope={riskLevel}
        lines={{ add: 0, del: 0 }}
        onAllow={handleAllow}
        onDeny={handleDeny}
      />
    )
  }

  if (action === 'network') {
    return (
      <NetPermCard
        url={domains?.[0] ?? description}
        method="GET"
        reason={description}
        onAllow={handleAllow}
        onDeny={handleDeny}
      />
    )
  }

  if (action === 'mcp') {
    return (
      <MCPPermCard
        server="MCP Server"
        tool={description}
        params={{ paths, command, domains }}
        onAllow={handleAllow}
        onDeny={handleDeny}
      />
    )
  }

  // Generic fallback for command_exec, git, etc.
  return (
    <div className="chat-card">
      <div className="chat-card-h warn">
        <span className="ico"><Icons.Shield size={14} /></span>
        <span>权限请求 · {action}</span>
        <span className="badge" style={{ marginLeft: 'auto', fontSize: 10 }}>{riskLevel}</span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">描述</span>
          <span className="v">{description}</span>
          {command && <><span className="k">命令</span><span className="v"><code>{command}</code></span></>}
          {paths && paths.length > 0 && <><span className="k">路径</span><span className="v"><code>{paths.join(', ')}</code></span></>}
          {domains && domains.length > 0 && <><span className="k">域名</span><span className="v"><code>{domains.join(', ')}</code></span></>}
        </div>
      </div>
      <div className="chat-card-foot">
        <span className="spacer" />
        <button className="btn sm" onClick={handleDeny}>拒绝</button>
        <button className="btn sm primary" onClick={handleAllow}>
          <Icons.Check size={11} /> 允许
        </button>
      </div>
    </div>
  )
}

/** HunkDiff wrapper that provides toast feedback on accept/reject actions */
function HunkDiffWithFeedback({ path, hunks }: { path: string; hunks: Array<DiffHunk> }) {
  const { toast } = useToast()

  const handleAcceptAll = () => {
    toast.success(`已采纳全部变更: ${path}`)
  }

  const handleHunkAction = (index: number, action: 'accepted' | 'rejected') => {
    if (action === 'accepted') {
      toast.success(`Hunk #${index + 1} 已采纳`)
    } else {
      toast.info(`Hunk #${index + 1} 已拒绝`)
    }
  }

  return (
    <HunkDiff
      path={path}
      hunks={hunks}
      onAcceptAll={handleAcceptAll}
      onHunkAction={handleHunkAction}
    />
  )
}

type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'incomplete_code'; lang: string; code: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }

function MarkdownText({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  const blocks = parseMarkdown(content)

  return (
    <>
      {blocks.map((block, index) => {
        const isLastBlock = index === blocks.length - 1
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements
            return <Tag key={index}>{renderInlineMarkdown(block.text)}</Tag>
          }
          case 'paragraph':
            return (
              <p key={index}>
                {renderInlineMarkdown(block.text)}
              </p>
            )
          case 'code':
            return (
              <div key={index} className="md-code-block">
                {block.lang && (
                  <div className="md-code-header">
                    <span className="md-code-lang">{block.lang}</span>
                    <button className="md-code-copy" title="复制" onClick={() => { navigator.clipboard.writeText(block.code).catch(() => {}) }}>
                      <Icons.Copy size={12} />
                    </button>
                  </div>
                )}
                {!block.lang && (
                  <button className="md-code-copy-float" title="复制" onClick={() => { navigator.clipboard.writeText(block.code).catch(() => {}) }}>
                    <Icons.Copy size={12} />
                  </button>
                )}
                <pre className="md-code">
                  <code>{block.code}</code>
                </pre>
              </div>
            )
          case 'incomplete_code':
            return (
              <div key={index} className="md-code-block md-code-streaming-block">
                {block.lang && (
                  <div className="md-code-header">
                    <span className="md-code-lang">{block.lang}</span>
                    <Icons.Spinner size={10} className="md-code-streaming-badge" />
                  </div>
                )}
                <pre className="md-code md-code-incomplete">
                  <code>{block.code}</code>
                  <span className="md-code-cursor">▌</span>
                </pre>
              </div>
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

function StreamingCursor() {
  // 光标闪烁效果已移除 — 流式消息不再显示闪烁光标
  return null
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
      if (index < lines.length) {
        // Found closing ```
        index += 1
        blocks.push({ kind: 'code', lang: fence[1] ?? '', code: codeLines.join('\n') })
      } else {
        // No closing ``` found — incomplete code block (streaming)
        blocks.push({ kind: 'incomplete_code', lang: fence[1] ?? '', code: codeLines.join('\n') })
      }
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

/** 格式化时间戳为 HH:MM 格式 */
function formatMsgTime(timestamp?: string): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 消息悬浮操作栏：时间 + 复制按钮 + 删除按钮，放在气泡内部。position: left=agent消息(左下角), right=用户消息(右下角) */
function MessageHoverBar({ timestamp, textContent, position, onDelete }: { timestamp?: string | undefined; textContent: string; position: 'left' | 'right'; onDelete?: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(textContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [textContent])

  const time = formatMsgTime(timestamp)

  return (
    <div className={`msg-hover-bar msg-hover-${position}`}>
      {time && <span className="msg-hover-time">{time}</span>}
      <button className="msg-hover-copy" title="复制" onClick={handleCopy}>
        {copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
      </button>
      {onDelete && (
        <button className="msg-hover-delete" title="删除" onClick={onDelete}>
          <Icons.Trash size={12} />
        </button>
      )}
    </div>
  )
}

/** 从 blocks 中提取纯文本内容（用于复制） */
function extractTextFromBlocks(blocks: UIBlock[]): string {
  return blocks
    .filter(b => b.kind === 'text')
    .map(b => (b as Extract<UIBlock, { kind: 'text' }>).content)
    .join('\n')
    .trim()
}

function UserMsg({ children, timestamp, blocks, onDelete }: { children: ReactNode; timestamp?: string | undefined; blocks: UIBlock[]; onDelete?: () => void }) {
  const textContent = extractTextFromBlocks(blocks)
  return (
    <div className="msg msg-user">
      <div className="msg-bubble msg-bubble-user">
        <div className="msg-content">{children}</div>
      </div>
      <MessageHoverBar timestamp={timestamp} textContent={textContent} position="right" {...(onDelete ? { onDelete } : {})} />
    </div>
  )
}

function AgentMsg({
  sessionId,
  status,
  blocks,
  messageStatus,
  isLatest,
  timestamp,
  onDelete,
}: {
  sessionId: SessionId
  status?: 'running'
  blocks: UIBlock[]
  messageStatus?: UIMessage['status']
  isLatest?: boolean
  timestamp?: string | undefined
  onDelete?: () => void
}) {
  const thinkingBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'thinking' }> => b.kind === 'thinking',
  )
  const contentBlocks = blocks.filter(b => b.kind !== 'thinking')
  const toolCallBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'tool_call' }> => b.kind === 'tool_call',
  )
  const errorBlocks = blocks.filter(b => b.kind === 'error')
  const isStreaming = status === 'running'
  const hasContent = thinkingBlocks.length > 0 || contentBlocks.length > 0
  // Count active (pending/running) tool calls for parallel indicator
  const activeToolCount = toolCallBlocks.filter(b => b.status === 'pending' || b.status === 'running').length
  // Cancelled: streaming ended with error status but has rendered content
  const isCancelled = messageStatus === 'error' && !isStreaming && hasContent
  // Pure error: no content, only error blocks
  const isPureError = messageStatus === 'error' && !isStreaming && !hasContent && errorBlocks.length > 0
  // 是否已完成（非流式中）— 只有完成的消息才显示 hover bar
  const isFinished = !isStreaming

  // 提取纯文本用于复制
  const textContent = extractTextFromBlocks(blocks)

  return (
    <div className={`msg msg-agent ${isCancelled ? 'is-cancelled' : ''} ${isPureError ? 'is-error' : ''}`}>
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
        {activeToolCount > 1 && (
          <div className="parallel-tools-indicator">
            <Icons.Layers size={11} />
            <span>{activeToolCount} 个工具并行执行</span>
          </div>
        )}
        {contentBlocks.length > 0 && isLatest && (
          <div className="msg-content">{renderBlocks(contentBlocks)}</div>
        )}
        {contentBlocks.length > 0 && !isLatest && (
          <CollapsibleContent maxHeight={500} streaming={isStreaming}>
            <div className="msg-content">{renderBlocks(contentBlocks)}</div>
          </CollapsibleContent>
        )}
        {errorBlocks.map((block, i) => (
          <StreamingErrorCard
            key={`error-${i}`}
            sessionId={sessionId}
            message={(block as Extract<UIBlock, { kind: 'error' }>).message}
            code={(block as Extract<UIBlock, { kind: 'error' }>).code}
            retryable={(block as Extract<UIBlock, { kind: 'error' }>).retryable}
          />
        ))}
        {isCancelled && <StoppedMarker />}
        {isFinished && textContent && <MessageHoverBar timestamp={timestamp} textContent={textContent} position="left" {...(onDelete ? { onDelete } : {})} />}
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
  const wasThinkingRef = useRef(false)

  const isThinkingActive = streaming && blocks.some(b => b.isStreaming)

  // Auto-expand when thinking starts, collapse when thinking ends
  useEffect(() => {
    if (isThinkingActive && !wasThinkingRef.current) {
      setOpen(true)
      wasThinkingRef.current = true
    }
    if (!isThinkingActive && wasThinkingRef.current) {
      wasThinkingRef.current = false
      // Don't auto-collapse — let user see the result
    }
  }, [isThinkingActive])

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
    <div className={`thinking-section ${open ? 'open' : ''} ${isThinkingActive ? 'is-active' : ''}`}>
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <Icons.ChevronRight size={12} className={`chev ${open ? 'chev-open' : ''}`} />
        <span className="thinking-label">思考过程</span>
        {isThinkingActive && <Icons.Spinner size={10} className="thinking-spinner" />}
        {!isThinkingActive && blocks.length > 0 && blocks.every(b => !b.isStreaming) && (
          <span className="thinking-done-badge">
            <Icons.Check size={9} />
          </span>
        )}
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

function ToolCall({ name, arg, status, pending, durationMs, children }: { name: string; arg: string; status?: 'ok' | 'error'; pending?: boolean; durationMs?: number | undefined; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const iconMap: Record<string, ReactNode> = {
    Read: <Icons.File className="tool-icon" />,
    Grep: <Icons.Search className="tool-icon" />,
    Bash: <Icons.BashCommand className="tool-icon" />,
    bash: <Icons.BashCommand className="tool-icon" />,
    run_command: <Icons.BashCommand className="tool-icon" />,
    Edit: <Icons.Edit className="tool-icon" />,
    Write: <Icons.File className="tool-icon" />,
  }

  // Auto-collapse on completion — keep open only while pending/running
  useEffect(() => {
    if (status === 'ok' || status === 'error') {
      setOpen(false)
    }
  }, [status])

  // Live elapsed timer for pending tool calls
  useEffect(() => {
    if (!pending) return
    startTimeRef.current = Date.now()
    setElapsedMs(0)
    const timer = window.setInterval(() => {
      if (startTimeRef.current != null) {
        setElapsedMs(Date.now() - startTimeRef.current)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [pending])

  const displayDuration = pending ? elapsedMs : durationMs

  return (
    <div className={`tool-call ${open ? 'open' : ''} ${pending ? 'is-pending' : ''} ${status === 'ok' ? 'is-success' : ''} ${status === 'error' ? 'is-error' : ''}`}>
      <div className="tool-call-head" onClick={() => setOpen(!open)}>
        {iconMap[name] || <Icons.Wrench className="tool-icon" />}
        <span className="tool-name">{name}</span>
        <span className="tool-arg">{arg}</span>
        <span className="tool-call-actions">
          {pending && <Icons.Spinner size={12} className="tool-status spinner" />}
          {status === 'ok' && <Icons.Check size={12} className="tool-status ok" />}
          {status === 'error' && <Icons.X size={12} className="tool-status err" />}
          {displayDuration != null && <span className="tool-duration">{formatDuration(displayDuration)}</span>}
          <Icons.ChevronRight size={12} className="chev" />
        </span>
      </div>
      {pending && (
        <div className="tool-call-progress-bar">
          <div className="tool-call-progress-fill" />
        </div>
      )}
      {open && children && <div className="tool-call-body">{children}</div>}
    </div>
  )
}

function TerminalBlock({ children }: { children: ReactNode }) {
  return <div className="terminal mono-sm">{children}</div>
}

function StreamingErrorCard({ sessionId, message, code, retryable }: { sessionId: SessionId; message: string; code: string; retryable: boolean }) {
  const { toast } = useToast()
  const isNetworkError = code === 'NETWORK_ERROR' || code === 'ECONNRESET' || code === 'ECONNREFUSED'
  const isTimeout = code === 'TIMEOUT' || code === 'ETIMEDOUT'
  const isAborted = code === 'ABORTED'
  const isMaxIter = code === 'MAX_ITERATIONS'

  let hint = ''
  if (isNetworkError) {
    hint = '网络连接中断，请检查网络后重试'
  } else if (isTimeout) {
    hint = '请求超时，可能是服务器繁忙'
  } else if (isAborted) {
    hint = '请求已取消'
  } else if (isMaxIter) {
    hint = '当前 turn 达到最大迭代次数，可调高上限后重发消息继续'
  } else if (retryable) {
    hint = '可重试 — 该错误是临时性的'
  }

  // 从 message 中解析当前上限（agent_error.message 形如 "Exceeded max turn iterations (20)"）
  const currentLimit = (() => {
    const m = /\((\d+)\)/.exec(message)
    return m ? Number(m[1]) : null
  })()
  const proposedLimit = Math.min(Math.max((currentLimit ?? 100) * 2, 200), 500)

  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)
  const raiseLimit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.spark.invoke('session:set-max-iterations', { sessionId, maxIterations: proposedLimit })
      setApplied(proposedLimit)
      toast.success(`本会话迭代上限已调至 ${proposedLimit}，请重新发送消息以继续。`)
    } catch (err) {
      toast.error(`调整失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const showRetryButton = retryable && !isAborted && !isMaxIter

  return (
    <div className={`streaming-error-card ${isNetworkError ? 'is-network' : ''} ${isTimeout ? 'is-timeout' : ''} ${isMaxIter ? 'is-max-iter' : ''}`}>
      <div className="streaming-error-head">
        {isNetworkError && <Icons.Wifi size={13} className="streaming-error-icon" />}
        {isTimeout && <Icons.Clock size={13} className="streaming-error-icon" />}
        {!isNetworkError && !isTimeout && <Icons.XCircle size={13} className="streaming-error-icon" />}
        <span className="streaming-error-msg">{message}</span>
      </div>
      {code && <span className="streaming-error-code">{code}</span>}
      {hint && <span className="streaming-error-hint">{hint}</span>}
      {(isMaxIter || showRetryButton) && (
        <div className="streaming-error-actions">
          {isMaxIter && applied == null && (
            <button className="btn sm primary" disabled={busy} onClick={raiseLimit}>
              将本会话上限调至 {proposedLimit} 并重试下条消息
            </button>
          )}
          {isMaxIter && applied != null && (
            <span className="streaming-error-hint">已生效：本会话上限 = {applied}。重新发送消息继续。</span>
          )}
          {showRetryButton && (
            <span className="streaming-error-hint streaming-error-retry-hint">
              请重新发送消息以触发重试
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Inline todo list renderer for tool_call.toolName === 'todo_write'.
 * Source of truth: the tool's input (always the FULL list per todo_write contract).
 * If output is available (post-execution), prefer the parsed list from there.
 */
function TodoListInline({ input, output }: { input: Record<string, unknown>; output: string | undefined }) {
  const todos = parseTodosFromInputOrOutput(input, output)
  if (todos.length === 0) return null
  const done = todos.filter((t) => t.status === 'completed').length
  const inProg = todos.find((t) => t.status === 'in_progress')
  const inProgLabel = inProg?.activeForm ?? inProg?.content
  return (
    <div className="tool-todo-list">
      <div className="tool-todo-summary">
        {done}/{todos.length} 完成
        {inProgLabel ? ` · 进行中：${inProgLabel}` : ''}
      </div>
      {todos.map((t, idx) => (
        <div key={idx} className={`tool-todo-item is-${t.status.replace('_', '-')}`}>
          <span className={`tool-todo-marker is-${t.status.replace('_', '-')}`}>
            {t.status === 'completed' && <Icons.Check size={12} />}
            {t.status === 'in_progress' && <Icons.Spinner size={11} />}
            {/* pending: pure circle from CSS */}
          </span>
          <span>{t.status === 'in_progress' ? (t.activeForm ?? t.content) : t.content}</span>
        </div>
      ))}
    </div>
  )
}

type ParsedTodo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

function parseTodosFromInputOrOutput(input: Record<string, unknown>, output: string | undefined): ParsedTodo[] {
  // Output (JSON-stringified by event-mapper) has the canonical post-execution list
  if (output != null) {
    try {
      // formatToolOutput wraps as markdown ```json blocks; strip if present.
      const cleaned = output.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { todos?: unknown }
      if (Array.isArray(parsed.todos)) return parsed.todos.filter(isTodo) as ParsedTodo[]
    } catch {
      // fall through to input
    }
  }
  const todos = input['todos']
  if (Array.isArray(todos)) return todos.filter(isTodo) as ParsedTodo[]
  return []
}

function isTodo(t: unknown): t is ParsedTodo {
  if (t == null || typeof t !== 'object') return false
  const obj = t as Record<string, unknown>
  return typeof obj['content'] === 'string'
    && (obj['status'] === 'pending' || obj['status'] === 'in_progress' || obj['status'] === 'completed')
}

function StoppedMarker() {
  return (
    <div className="stopped-marker">
      <span className="stopped-marker-line" />
      <span className="stopped-marker-label">
        <Icons.Stop size={10} />
        已停止生成
      </span>
      <span className="stopped-marker-line" />
    </div>
  )
}

/**
 * agent 在 claude-plan 模式下递交计划后弹出。
 * 三个动作：
 *   - 批准：把 session permissionMode 切到 claude-auto-edits，发送"按上述计划继续执行"
 *   - 编辑后批准：用户编辑 plan，然后同上但用编辑后的内容
 *   - 拒绝：仅 dismiss，turn 已结束，用户可在 composer 中提反馈
 */
function PlanApprovalModal({ sessionId, plan, onClose }: { sessionId: SessionId; plan: string; onClose: () => void }) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan)
  const [busy, setBusy] = useState(false)

  const approve = async (planText: string) => {
    if (busy) return
    setBusy(true)
    try {
      await window.spark.invoke('session:update', {
        sessionId,
        permissionMode: 'claude-auto-edits',
      })
      const message = `批准上述计划。请按如下计划继续执行：\n\n${planText}`
      await window.spark.invoke('session:send-turn', { sessionId, message })
      toast.success('计划已批准，已切换为 auto-edits 模式继续执行')
      onClose()
    } catch (err) {
      toast.error(`批准失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal plan-approval-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon"><Icons.Check size={16} /></div>
          <div>
            <div className="modal-title">计划已就绪，等待你审批</div>
            <div className="modal-subtitle">Plan 模式 · 批准后会切换为 auto-edits 模式继续</div>
          </div>
        </div>
        <div className="modal-body">
          {editing ? (
            <textarea
              className="plan-approval-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(20, Math.max(8, draft.split('\n').length + 1))}
              autoFocus
            />
          ) : (
            <div className="plan-approval-preview md-surface">
              <MarkdownText content={plan} />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost sm" disabled={busy} onClick={onClose}>拒绝</button>
          <div className="flex1" />
          {!editing && (
            <button className="btn sm" disabled={busy} onClick={() => setEditing(true)}>
              <Icons.Edit size={11} /> 编辑后批准
            </button>
          )}
          {editing && (
            <button className="btn sm" disabled={busy} onClick={() => { setDraft(plan); setEditing(false) }}>
              取消编辑
            </button>
          )}
          <button className="btn primary sm" disabled={busy} onClick={() => approve(editing ? draft : plan)}>
            {editing ? '批准（用编辑后）' : '批准并执行'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${min}m ${sec}s`
}

function InlineApprovalRequest({ request, onClose }: { request: PermissionApprovalRequest; onClose?: () => void }) {
  const [busyDecision, setBusyDecision] = useState<PermissionApprovalDecision | null>(null)
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]
  const riskTone = request.riskLevel === 'high' ? 'high' : request.riskLevel === 'medium' ? 'medium' : 'low'
  const inputPreview = JSON.stringify(request.toolInput, null, 2)

  const respond = useCallback(async (decision: PermissionApprovalDecision) => {
    setBusyDecision(decision)
    try {
      await window.spark.invoke('permission:approval-respond', { requestId: request.requestId, decision })
    } catch {
      // best-effort
    } finally {
      setBusyDecision(null)
      onClose?.()
    }
  }, [onClose, request.requestId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busyDecision != null) return
      event.preventDefault()
      void respond('deny')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busyDecision, respond])

  return (
    <div className={`composer-approval-card ${riskTone}`}>
      <div className="composer-approval-icon">
        {request.riskLevel === 'high' ? <Icons.AlertTriangle size={17} /> : <Icons.Shield size={17} />}
      </div>
      <div className="composer-approval-main">
        <div className="composer-approval-top">
          <div>
            <div className="composer-approval-title">
              允许执行 <span>{request.toolName}</span>?
            </div>
            <div className="composer-approval-meta">
              Session {request.sessionId.slice(0, 8)} · 风险 {riskLabel}
            </div>
          </div>
          <div className="composer-approval-actions">
            <button
              type="button"
              className="composer-approval-btn ghost"
              disabled={busyDecision != null}
              onClick={() => void respond('deny')}
            >
              拒绝
            </button>
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-session')}
            >
              本会话允许
            </button>
            <button
              type="button"
              className="composer-approval-btn primary"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-once')}
            >
              {busyDecision === 'allow-once' ? <Icons.Spinner size={13} /> : null}
              允许一次
            </button>
          </div>
        </div>
        <pre className="composer-approval-preview">{inputPreview}</pre>
      </div>
    </div>
  )
}

function ComposerV2({
  session,
  workspace,
  providers,
  selectedProviderId,
  setSelectedProviderId,
  branchState,
  contextInputTokens,
  contextUsage,
  isWorking,
  approvalRequest,
  onApprovalClose,
  onCreateSession,
  onUpdateSession,
  onSwitchBranch,
  onCancelSession,
  onSent,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  providers: ProviderProfile[]
  selectedProviderId: string
  setSelectedProviderId: (providerId: string) => void
  branchState: BranchState
  contextInputTokens: number
  contextUsage: ContextUsageState | null
  isWorking: boolean
  approvalRequest?: PermissionApprovalRequest | null
  onApprovalClose?: () => void
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
  onCancelSession: (sessionId: SessionId) => void | Promise<void>
  onSent: (sessionId: SessionId) => void
}) {
  const { toast } = useToast()
  const initialPrefsRef = useRef<ComposerPrefs | null>(null)
  if (initialPrefsRef.current == null) initialPrefsRef.current = readComposerPrefs()
  const initialPrefs = initialPrefsRef.current
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [queueVisible, setQueueVisible] = useState(true)
  const [manualExpanded, setManualExpanded] = useState(false)
  const [slashCmds, setSlashCmds] = useState<CommandListItem[]>([])
  const [slashFilter, setSlashFilter] = useState('')
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashListRef = useRef<HTMLDivElement | null>(null)
  const [draftAdapter, setDraftAdapter] = useState<AgentAdapter>(initialPrefs.adapter ?? DEFAULT_AGENT_ADAPTER)
  const [draftModelId, setDraftModelId] = useState(initialPrefs.modelId ?? '')
  const [draftMode] = useState<SessionChatMode>('agent')
  const [draftPermissionMode, setDraftPermissionMode] = useState<PermissionModeChoice>(
    getValidPermissionMode(initialPrefs.permissionMode, initialPrefs.adapter ?? DEFAULT_AGENT_ADAPTER),
  )
  const [draftReasoning, setDraftReasoning] = useState<SessionReasoningEffort>(initialPrefs.reasoningEffort ?? 'medium')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const nextQueueIdRef = useRef(0)
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')

  const adapter = session?.agentAdapter ?? draftAdapter
  const compatibleProviders = providers.filter((provider) => isProviderCompatibleWithAdapter(provider, adapter))
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
  // 动态获取上下文窗口大小：优先级 context_usage 事件 > ModelCapabilityRegistry > 不展示
  const contextWindow = (() => {
    // 1. 从 agent-loop 的 context_usage 事件获取（最准确，来自实际 API 响应/provider 注册）
    if (contextUsage?.contextWindowTokens && contextUsage.contextWindowTokens > 0) {
      return contextUsage.contextWindowTokens
    }
    // 2. 从 ModelCapabilityRegistry 查询
    const caps = ModelCapabilityRegistry.getCapabilities(effectiveModelId)
    if (caps && caps.contextWindow > 0) return caps.contextWindow
    // 3. 都没有，返回 0 表示未知
    return 0
  })()
  const contextRatio = contextWindow > 0
    ? Math.min(100, Math.round((contextInputTokens / contextWindow) * 1000) / 10)
    : 0
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

  useEffect(() => {
    textareaRef.current?.focus()
  }, [session?.id])

  const dispatchMessage = useCallback(async (text: string) => {
    // 斜杠命令拦截：以 / 开头的消息走 command:execute
    if (text.startsWith('/')) {
      setSending(true)
      try {
        // 如果没有活跃 session，先创建一个（命令需要 session 上下文）
        let sessionId = session?.id ?? null
        if (sessionId == null) {
          if (selectedProvider == null) {
            toast.warning('请先选择 Provider 再执行命令。')
            setValue(text)
            return
          }
          sessionId = await onCreateSession({
            ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
            modelId: effectiveModelId,
            agentAdapter: adapter,
            permissionMode: effectivePermissionMode,
          })
          if (sessionId == null) {
            toast.error('创建会话失败，无法执行命令。')
            setValue(text)
            return
          }
        }
        const res = await window.spark.invoke('command:execute', { sessionId, message: text })
        if (res.forwardToAgent) {
          // 转发给 Agent：作为普通消息发送
          setSending(false)
          const sendRes = await sendTurn({ sessionId, message: text })
          if (!sendRes.started) toast.info('上一条任务仍在执行，消息已加入队列。')
          onSent(sessionId)
          return
        }
        // 命令结果已通过事件流注入到聊天中，无需 Toast
        onSent(sessionId)
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
      onSent(targetSessionId)
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
    void dispatchMessage(next.content)
  }, [dispatchMessage, isBusy, queuedMessages])

  const enqueueMessage = (content: string) => {
    setQueueVisible(true)
    setQueuedMessages((prev) => {
      toast.info(`任务执行中，已加入临时队列（${prev.length + 1}）。`)
      return [...prev, { id: `queued-${nextQueueIdRef.current++}`, content }]
    })
  }

  const handleSend = async () => {
    if (!canSubmit) return
    const text = value.trim()
    setValue('')
    if (isBusy) {
      enqueueMessage(text)
      return
    }
    await dispatchMessage(text)
  }

  const handlePrimaryAction = async () => {
    if (isWorking) {
      await handleCancelActiveSession()
      return
    }
    await handleSend()
  }

  const handleRemoveQueuedMessage = (id: string) => {
    setQueuedMessages((prev) => prev.filter((message) => message.id !== id))
  }

  const handleSendQueuedNow = async (message: QueuedMessage) => {
    setQueuedMessages((prev) => prev.filter((item) => item.id !== message.id))
    if (session?.id != null && isWorking) {
      await onCancelSession(session.id)
    }
    await dispatchMessage(message.content)
  }

  const handleCancelActiveSession = async () => {
    if (session?.id == null) return
    await onCancelSession(session.id)
  }

  const filteredSlashCmds = slashCmds.filter((cmd) => {
    if (!slashFilter) return true
    const q = slashFilter.toLowerCase()
    return cmd.name.includes(q) || cmd.description.toLowerCase().includes(q) || cmd.aliases.some((a) => a.includes(q))
  })

  const SLASH_GROUP_LABELS: Record<string, string> = {
    session: '会话', model: '模型', context: '上下文', permission: '权限',
    git: 'Git', workflow: '工作流', agent: 'Agent', mcp: 'MCP',
    skill: '技能', resource: '资源', team: '团队', utility: '工具', system: '系统',
  }
  const SLASH_GROUP_ORDER = ['session', 'model', 'context', 'permission', 'git', 'workflow', 'agent', 'mcp', 'skill', 'resource', 'team', 'utility', 'system']

  const groupedSlashCmds = (() => {
    const map = new Map<string, CommandListItem[]>()
    for (const cmd of filteredSlashCmds) {
      const arr = map.get(cmd.group) ?? []
      arr.push(cmd)
      map.set(cmd.group, arr)
    }
    return SLASH_GROUP_ORDER.flatMap((key) => {
      const cmds = map.get(key)
      return cmds && cmds.length > 0 ? [{ key, label: SLASH_GROUP_LABELS[key] ?? key, cmds }] : []
    })
  })()

  const flatSlashList = groupedSlashCmds.flatMap((g) => g.cmds)

  const openSlashPopup = useCallback(async () => {
    if (slashCmds.length === 0) {
      try {
        const res = await window.spark.invoke('command:list', {})
        setSlashCmds(res.commands ?? [])
      } catch {
        // ignore
      }
    }
    setSlashOpen(true)
    setSlashIndex(0)
  }, [slashCmds.length])

  const closeSlashPopup = useCallback(() => {
    setSlashOpen(false)
    setSlashFilter('')
    setSlashIndex(0)
  }, [])

  /** 选中命令：填充到输入框并关闭弹窗，不立即执行 */
  const selectSlashCmd = useCallback((cmd: CommandListItem) => {
    closeSlashPopup()
    setValue(`/${cmd.name} `)
  }, [closeSlashPopup])

  const handleValueChange = useCallback((next: string) => {
    setValue(next)
    if (next.startsWith('/')) {
      setSlashFilter(next.slice(1))
      void openSlashPopup()
    } else {
      if (slashOpen) closeSlashPopup()
    }
  }, [slashOpen, openSlashPopup, closeSlashPopup])

  // scroll selected item into view
  useEffect(() => {
    if (!slashOpen) return
    const el = slashListRef.current?.querySelector<HTMLElement>('.slash-cmd-item.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [slashIndex, slashOpen])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
    if (nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return

    if (slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashIndex((i) => Math.min(i + 1, flatSlashList.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashIndex((i) => Math.max(i - 1, 0))
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closeSlashPopup()
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        if (flatSlashList.length > 0) {
          const cmd = flatSlashList[slashIndex]
          if (cmd != null) selectSlashCmd(cmd)
          return
        }
        // 无匹配命令时关闭弹窗，让 Enter 落到下面的正常发送逻辑
        closeSlashPopup()
      }
    }

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
        {approvalRequest && (
          <InlineApprovalRequest
            request={approvalRequest}
            {...(onApprovalClose !== undefined ? { onClose: onApprovalClose } : {})}
          />
        )}
        {queuedMessages.length > 0 && queueVisible && (
          <div className="composer-queue-panel">
            {queuedMessages.map((message) => (
              <div key={message.id} className="composer-queue-item">
                <Icons.Clock size={15} className="composer-queue-icon" />
                <span className="composer-queue-text">{message.content}</span>
                <button
                  type="button"
                  className="composer-queue-action"
                  title="立即发送"
                  onClick={() => void handleSendQueuedNow(message)}
                >
                  <Icons.ArrowUp size={14} />
                  <span>立即发送</span>
                </button>
                <button
                  type="button"
                  className="composer-queue-icon-btn"
                  title="移除"
                  onClick={() => handleRemoveQueuedMessage(message.id)}
                >
                  <Icons.Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {slashOpen && flatSlashList.length > 0 && (
          <div className="slash-cmd-popup" ref={slashListRef}>
            {(() => {
              let flatIdx = -1
              return groupedSlashCmds.map((group) => (
                <div key={group.key}>
                  <div className="slash-cmd-group-header">{group.label}</div>
                  {group.cmds.map((cmd) => {
                    flatIdx++
                    const idx = flatIdx
                    return (
                      <div
                        key={cmd.id}
                        className={`slash-cmd-item${idx === slashIndex ? ' selected' : ''}`}
                        onMouseEnter={() => setSlashIndex(idx)}
                        onMouseDown={(e) => { e.preventDefault(); selectSlashCmd(cmd) }}
                      >
                        <span className={`slash-cmd-layer layer-${cmd.layer}`}>
                          {cmd.layer === 'sdk' ? 'SDK' : cmd.layer === 'skill' ? '技能' : '内置'}
                        </span>
                        <span className="slash-cmd-name">/{cmd.name}</span>
                        {cmd.aliases.length > 0 && (
                          <span className="slash-cmd-aliases">{cmd.aliases.map((a) => `/${a}`).join(' ')}</span>
                        )}
                        <span className="slash-cmd-desc">{cmd.description}</span>
                        {cmd.risk === 'high' && <span className="slash-cmd-risk high">危险</span>}
                        {cmd.risk === 'medium' && <span className="slash-cmd-risk medium">注意</span>}
                      </div>
                    )
                  })}
                </div>
              ))
            })()}
          </div>
        )}
        <div className={`composer composer-v2 ${manualExpanded ? 'expanded' : ''}`}>
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={workspace ? '询问、修改、运行任务…  ↵ 发送' : '请先选择或新建一个项目'}
            value={value}
            onChange={(event) => handleValueChange(event.target.value)}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onKeyDown={handleKeyDown}
            disabled={!workspace}
          />
          <button
            className="composer-expand-btn"
            title={manualExpanded ? '折叠输入框' : '展开输入框'}
            onClick={() => setManualExpanded((prev) => !prev)}
          >
            {manualExpanded ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
          </button>
          <div className="composer-submit-row">
            <button
              className={`composer-send-round ${sending ? 'is-sending' : ''} ${isWorking ? 'is-stopping' : ''}`}
              title={isWorking ? '停止会话' : '发送'}
              onClick={() => void handlePrimaryAction()}
              disabled={isWorking ? session?.id == null : !canSubmit}
            >
              {sending ? <Icons.Spinner size={14} /> : isWorking ? <Icons.Stop size={11} /> : <Icons.ArrowUp size={16} />}
            </button>
          </div>
        </div>
        <div className="composer-param-bar composer-controls">
            <button className="icon-btn" title="添加文件"><Icons.Plus /></button>
            <button className="icon-btn" title="工具"><Icons.Wrench /></button>
            <ComposerMenuSelect
              icon={<AdapterIcon adapter={adapter} />}
              value={adapter}
              label={ADAPTER_LABELS[adapter]}
              disabled={providers.length === 0}
              title="适配器"
              onChange={(value) => handleAdapterChange(value as AgentAdapter)}
              options={ADAPTER_OPTIONS}
            />
            <ProviderModelPicker
              icon={<ModelIcon />}
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
            {contextWindow > 0 && (
              <div
                className={`context-meter${contextUsage?.compactedThisTurn ? ' context-compacted' : ''}`}
                title={`上下文使用 ${contextRatio}% · ${formatTokenCount(contextInputTokens)} / ${formatTokenCount(contextWindow)}`}
              >
                <span>{contextRatio}%</span>
                <span
                  className={`context-ring${contextRatio >= 80 ? ' ring-warn' : contextRatio >= 95 ? ' ring-danger' : ''}`}
                  style={{ '--context-pct': `${contextRatio}%` } as React.CSSProperties}
                />
                {contextUsage?.compactedThisTurn && (
                  <span className="context-compacted-badge" title="已自动裁剪较早的 tool_result 内容以释放上下文">
                    <Icons.Layers size={10} />
                  </span>
                )}
              </div>
            )}
            {queuedMessages.length > 0 && (
              <button
                type="button"
                className="queued-chip"
                title={queueVisible ? '隐藏队列' : '显示队列'}
                onClick={() => setQueueVisible((prev) => !prev)}
              >
                {queueVisible ? '隐藏队列' : '显示队列'} · {queuedMessages.length}
              </button>
            )}
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

function AdapterIcon({ adapter }: { adapter: AgentAdapter }) {
  if (adapter === 'claude' || adapter === 'claude-sdk') {
    return (
      <svg className="adapter-brand-icon adapter-brand-claude" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M12 5.4v13.2M7.3 7.3l9.4 9.4M5.4 12h13.2M7.3 16.7l9.4-9.4" />
        <path d="M9.1 5.9l5.8 12.2M5.9 14.9l12.2-5.8M5.9 9.1l12.2 5.8M9.1 18.1l5.8-12.2" />
      </svg>
    )
  }
  return (
    <svg className="adapter-brand-icon adapter-brand-codex" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <path className="codex-cloud" d="M8.5 8.4c.9-2.1 4.2-2.7 5.7-.9 2.5-.2 4.1 1.4 4.1 3.5 0 2.4-1.8 4.1-4.4 4.1H8.8c-2 0-3.4-1.2-3.4-3 0-1.6 1.1-2.8 3.1-3.7Z" />
      <path className="codex-prompt" d="M9 10.2 10.8 12 9 13.8M12.5 14h3" />
    </svg>
  )
}

function ModelIcon() {
  return (
    <svg className="model-select-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
      <path d="M9 2.8v2.2M15 2.8v2.2M9 19v2.2M15 19v2.2M2.8 9h2.2M2.8 15h2.2M19 9h2.2M19 15h2.2" />
    </svg>
  )
}

const ADAPTER_OPTIONS: Array<{ value: AgentAdapter; label: string }> = [
  { value: 'claude-sdk', label: 'Claude SDK' },
  { value: 'codex', label: 'Codex' },
]

const DEFAULT_AGENT_ADAPTER: AgentAdapter = 'claude-sdk'

const ADAPTER_LABELS: Record<AgentAdapter, string> = {
  'claude-sdk': 'Claude SDK',
  claude: 'Claude API',
  codex: 'Codex',
}

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
  return isClaudeAdapter(adapter) ? CLAUDE_PERMISSION_MODE_OPTIONS : CODEX_PERMISSION_MODE_OPTIONS
}

function getValidPermissionMode(value: PermissionModeChoice | undefined, adapter: AgentAdapter): PermissionModeChoice {
  const options = getPermissionModeOptions(adapter)
  return options.some((option) => option.value === value)
    ? value as PermissionModeChoice
    : options[0]?.value ?? (isClaudeAdapter(adapter) ? 'claude-ask' : 'codex-default')
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
  return providers.find((provider) => provider.id === prefs.providerProfileId && isProviderCompatibleWithAdapter(provider, adapter))
    ?? providers.find((provider) => provider.isDefault && isProviderCompatibleWithAdapter(provider, adapter))
    ?? providers.find((provider) => isProviderCompatibleWithAdapter(provider, adapter))
    ?? providers.find((provider) => provider.provider === 'anthropic')
    ?? providers[0]
}

function getProviderAdapterKind(provider: ProviderProfile): AgentAdapter {
  return provider.provider === 'anthropic' ? DEFAULT_AGENT_ADAPTER : 'codex'
}

function isClaudeAdapter(adapter: AgentAdapter): boolean {
  return adapter === 'claude' || adapter === 'claude-sdk'
}

function isProviderCompatibleWithAdapter(provider: ProviderProfile, adapter: AgentAdapter): boolean {
  return isClaudeAdapter(adapter)
    ? provider.provider === 'anthropic'
    : provider.provider !== 'anthropic'
}

function getReasoningOptions(adapter: AgentAdapter): Array<{ value: SessionReasoningEffort; label: string }> {
  if (isClaudeAdapter(adapter)) {
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

function normalizeSkillConfig(value: unknown): SkillConfigGetResponse {
  const config = isRecord(value) ? value : {}
  return {
    skills: asArray<SkillConfigGetResponse['skills'][number]>(config.skills),
    systemSkillIds: asArray<string>(config.systemSkillIds),
    agentSkillIds: asArray<string>(config.agentSkillIds),
    projectSkillIds: asArray<string>(config.projectSkillIds),
    sessionSkillIds: asArray<string>(config.sessionSkillIds),
    agentDisabledSkillIds: asArray<string>(config.agentDisabledSkillIds),
    projectDisabledSkillIds: asArray<string>(config.projectDisabledSkillIds),
    sessionDisabledSkillIds: asArray<string>(config.sessionDisabledSkillIds),
    effectiveSkillIds: asArray<string>(config.effectiveSkillIds),
  }
}

function normalizePromptConfig(value: unknown): PromptConfigGetResponse {
  const config = isRecord(value) ? value : {}
  return {
    system: normalizePromptLayer(config.system),
    agent: normalizePromptLayer(config.agent),
    project: normalizePromptLayer(config.project),
    session: normalizePromptLayer(config.session),
    effectivePrompt: typeof config.effectivePrompt === 'string' ? config.effectivePrompt : '',
  }
}

function normalizePromptLayer(value: unknown): PromptConfigGetResponse['system'] {
  if (!isRecord(value)) return EMPTY_PROMPT_LAYER
  const content = typeof value.content === 'string' ? value.content : ''
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : content.trim().length > 0,
    content,
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function ChatInspector({
  session,
  workspace,
  messages,
  usageData,
  contextInputTokens,
  width,
  onWidthChange,
  onOpenProjectFolder,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  messages: UIMessage[]
  usageData: SessionUsageData
  contextInputTokens: number
  width: number
  onWidthChange: (width: number) => void
  onOpenProjectFolder: () => void
}) {
  const plans = extractPlans(messages)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [skillConfig, setSkillConfig] = useState<SkillConfigGetResponse | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfigGetResponse | null>(null)
  const [projectPromptDraft, setProjectPromptDraft] = useState('')
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [savingRuntime, setSavingRuntime] = useState(false)
  const { invoke: getSkillConfig } = useIpcInvoke('skill-config:get')
  const { invoke: updateSkillConfig } = useIpcInvoke('skill-config:update')
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')
  const sessionId = session?.id as string | undefined
  const workspaceId = workspace?.id

  const loadRuntimeConfig = useCallback(async () => {
    const req = {
      ...(workspaceId != null ? { workspaceId } : {}),
      ...(sessionId != null ? { sessionId } : {}),
    }
    const [skillsRes, promptsRes] = await Promise.all([
      getSkillConfig(req),
      getPromptConfig(req),
    ])
    const normalizedSkills = normalizeSkillConfig(skillsRes)
    const normalizedPrompts = normalizePromptConfig(promptsRes)
    setSkillConfig(normalizedSkills)
    setPromptConfig(normalizedPrompts)
    setProjectPromptDraft(normalizedPrompts.project.content)
    setSessionPromptDraft(normalizedPrompts.session.content)
  }, [getPromptConfig, getSkillConfig, sessionId, workspaceId])

  useEffect(() => {
    if (sessionId == null) {
      setSkillConfig(null)
      setPromptConfig(null)
      setProjectPromptDraft('')
      setSessionPromptDraft('')
      return
    }
    void loadRuntimeConfig()
  }, [loadRuntimeConfig, sessionId])

  const toggleRuntimeSkill = useCallback(async (
    scope: 'project' | 'session',
    scopeRef: string,
    skillId: string,
    active: boolean,
  ) => {
    if (skillConfig == null) return
    const currentDisabled = scope === 'project'
      ? skillConfig.projectDisabledSkillIds
      : skillConfig.sessionDisabledSkillIds
    const currentSelected = scope === 'project'
      ? skillConfig.projectSkillIds
      : skillConfig.sessionSkillIds
    const nextDisabled = active
      ? currentDisabled.filter((id) => id !== skillId)
      : Array.from(new Set([...currentDisabled, skillId]))
    setSavingRuntime(true)
    try {
      await updateSkillConfig({
        scope,
        scopeRef,
        skillIds: currentSelected,
        disabledSkillIds: nextDisabled,
      })
      await loadRuntimeConfig()
    } finally {
      setSavingRuntime(false)
    }
  }, [loadRuntimeConfig, skillConfig, updateSkillConfig])

  const savePromptLayer = useCallback(async (scope: 'project' | 'session', scopeRef: string, content: string) => {
    setSavingRuntime(true)
    try {
      await updatePromptConfig({
        scope,
        scopeRef,
        value: { enabled: content.trim().length > 0, content },
      })
      await loadRuntimeConfig()
    } finally {
      setSavingRuntime(false)
    }
  }, [loadRuntimeConfig, updatePromptConfig])

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

  // 动态获取上下文窗口：优先 usageData > ModelCapabilityRegistry > 0（不展示）
  const contextWindow = (() => {
    if (usageData.contextWindow && usageData.contextWindow > 0) return usageData.contextWindow
    const caps = ModelCapabilityRegistry.getCapabilities(session?.modelId ?? '')
    if (caps && caps.contextWindow > 0) return caps.contextWindow
    return 0
  })()
  const contextRatio = contextWindow > 0 ? Math.min(100, Math.round((contextInputTokens / contextWindow) * 1000) / 10) : 0
  const isContextWarning = contextRatio >= 80
  const isContextCritical = contextRatio >= 95

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
            <div className="kv-row">
              <span className="k">项目</span>
              <span className="v truncate">{workspace?.name ?? '未归属'}</span>
            </div>
            {workspace && (
              <div className="kv-row">
                <span className="k">路径</span>
                <span className="v mono-sm truncate inspector-path" title={workspace.rootPath}>{workspace.rootPath}</span>
              </div>
            )}
            {workspace && (
              <button className="btn ghost sm inspector-open-folder-btn" onClick={onOpenProjectFolder}>
                <Icons.Folder size={12} />
                <span>打开文件夹</span>
              </button>
            )}
            <div className="kv-row"><span className="k">创建时间</span><span className="v">{new Date(session.createdAt).toLocaleString()}</span></div>
            <div className="kv-row"><span className="k">更新时间</span><span className="v">{new Date(session.updatedAt).toLocaleString()}</span></div>
          </>
        ) : (
          <div className="inspector-muted">未选择会话</div>
        )}
      </div>

      {plans.length > 0 && (
        <div className="inspector-section">
          <h4>计划</h4>
          {plans.map((plan) => <PlanSummary key={plan.id} plan={plan} />)}
        </div>
      )}

      {session != null && skillConfig != null && (
        <div className="inspector-section">
          <h4>
            Skills
            <span className="inspector-count">{skillConfig.effectiveSkillIds.length}</span>
          </h4>
          <div className="runtime-skill-list">
            {skillConfig.skills.map((skill) => {
              const systemVisible = skillConfig.systemSkillIds.includes(skill.id)
              const projectActive = systemVisible && !skillConfig.projectDisabledSkillIds.includes(skill.id)
              const sessionActive = systemVisible && !skillConfig.sessionDisabledSkillIds.includes(skill.id)
              const meta = parseSkillManifest(skill.manifestJson)
              return (
                <div className="runtime-skill-row" key={skill.id}>
                  <div className="runtime-skill-main min-w-0">
                    <div className="runtime-skill-name truncate">{skill.name}</div>
                    <div className="runtime-skill-desc truncate">{meta.source} · {meta.desc}</div>
                  </div>
                  {workspaceId != null && (
                    <label className={`mini-check ${projectActive ? 'on' : ''} ${!systemVisible ? 'disabled' : ''}`} title="项目层可见">
                      <input
                        type="checkbox"
                        checked={projectActive}
                        disabled={!systemVisible || savingRuntime}
                        onChange={(event) => void toggleRuntimeSkill('project', workspaceId, skill.id, event.target.checked)}
                      />
                      P
                    </label>
                  )}
                  {sessionId != null && (
                    <label className={`mini-check ${sessionActive ? 'on' : ''} ${!systemVisible ? 'disabled' : ''}`} title="会话层可见">
                      <input
                        type="checkbox"
                        checked={sessionActive}
                        disabled={!systemVisible || savingRuntime}
                        onChange={(event) => void toggleRuntimeSkill('session', sessionId, skill.id, event.target.checked)}
                      />
                      S
                    </label>
                  )}
                </div>
              )
            })}
          </div>
          <div className="inspector-muted runtime-hint">P 为项目层，S 为会话层；系统隐藏的 Skill 在此不可启用。</div>
        </div>
      )}

      {session != null && promptConfig != null && (
        <div className="inspector-section">
          <h4>提示词</h4>
          {workspaceId != null && (
            <div className="runtime-prompt-block">
              <div className="runtime-prompt-title">项目提示词</div>
              <textarea
                className="spark-textarea inspector-textarea"
                value={projectPromptDraft}
                onChange={(event) => setProjectPromptDraft(event.target.value)}
                placeholder="当前项目会话通用提示词..."
              />
              <button
                className="btn ghost sm runtime-save-btn"
                disabled={savingRuntime}
                onClick={() => void savePromptLayer('project', workspaceId, projectPromptDraft)}
              >
                保存项目
              </button>
            </div>
          )}
          {sessionId != null && (
            <div className="runtime-prompt-block">
              <div className="runtime-prompt-title">会话提示词</div>
              <textarea
                className="spark-textarea inspector-textarea"
                value={sessionPromptDraft}
                onChange={(event) => setSessionPromptDraft(event.target.value)}
                placeholder="仅对当前会话生效..."
              />
              <button
                className="btn ghost sm runtime-save-btn"
                disabled={savingRuntime}
                onClick={() => void savePromptLayer('session', sessionId, sessionPromptDraft)}
              >
                保存会话
              </button>
            </div>
          )}
        </div>
      )}

      {/* Token Usage Section */}
      <div className="inspector-section">
        <h4>
          <Icons.Cpu size={11} /> Token 用量
        </h4>
        <TokenUsagePanel
          inputTokens={usageData.inputTokens}
          outputTokens={usageData.outputTokens}
          totalTokens={usageData.inputTokens + usageData.outputTokens}
          cacheHitTokens={usageData.cacheHitTokens}
          estimatedCostUsd={usageData.estimatedCostUsd}
        />
      </div>

      {/* Context Window Section — 仅在已知上下文窗口大小时展示 */}
      {contextWindow > 0 && (
        <div className="inspector-section">
          <h4>
            <Icons.Database size={11} /> 上下文窗口
            {isContextCritical && <span className="badge danger dot usage-warning-badge">即将满</span>}
            {!isContextCritical && isContextWarning && <span className="badge warning dot usage-warning-badge">接近满</span>}
          </h4>
          <ContextWindowVisualization
            usedTokens={contextInputTokens}
            totalTokens={contextWindow}
            ratio={contextRatio}
            isWarning={isContextWarning}
            isCritical={isContextCritical}
          />
        </div>
      )}

      {/* Per-Turn Token Chart */}
      {usageData.turns.length > 0 && (
        <div className="inspector-section">
          <h4>
            <Icons.Activity size={11} /> 轮次用量
            <span className="inspector-count">{usageData.turns.length} 轮</span>
          </h4>
          <TurnUsageChart turns={usageData.turns.slice(-20)} />
        </div>
      )}

      <div className="inspector-section">
        <h4>可用工具</h4>
        <div className="tool-chip-list">
          {CODING_AGENT_TOOLS.map((tool) => (
            <span
              key={tool.name}
              className="tool-chip"
              title={`${tool.group} · ${tool.status === 'built-in' ? '内置' : '扩展接入'}`}
            >
              <Icons.Wrench />
              {tool.name}
            </span>
          ))}
        </div>
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

/* ── Token Usage Visualization Components ── */

function TokenUsagePanel({
  inputTokens,
  outputTokens,
  totalTokens,
  cacheHitTokens,
  estimatedCostUsd,
}: {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheHitTokens: number
  estimatedCostUsd: number
}) {
  const hasUsage = totalTokens > 0
  return (
    <div className="token-usage-panel">
      <div className="token-usage-stats">
        <div className="token-stat">
          <span className="token-stat-label">输入</span>
          <span className="token-stat-value">{formatTokenCount(inputTokens)}</span>
        </div>
        <div className="token-stat">
          <span className="token-stat-label">输出</span>
          <span className="token-stat-value">{formatTokenCount(outputTokens)}</span>
        </div>
        <div className="token-stat token-stat-total">
          <span className="token-stat-label">总计</span>
          <span className="token-stat-value">{formatTokenCount(totalTokens)}</span>
        </div>
      </div>
      {cacheHitTokens > 0 && (
        <div className="token-usage-row">
          <span className="token-row-label">缓存命中</span>
          <span className="token-row-value">{formatTokenCount(cacheHitTokens)}</span>
        </div>
      )}
      {hasUsage && (
        <div className="token-usage-row">
          <span className="token-row-label">预估成本</span>
          <span className="token-row-value token-cost">${estimatedCostUsd < 0.01 && estimatedCostUsd > 0 ? '<0.01' : estimatedCostUsd.toFixed(4)}</span>
        </div>
      )}
      {!hasUsage && (
        <div className="inspector-muted">暂无用量数据</div>
      )}
    </div>
  )
}

function ContextWindowVisualization({
  usedTokens,
  totalTokens,
  ratio,
  isWarning,
  isCritical,
}: {
  usedTokens: number
  totalTokens: number
  ratio: number
  isWarning: boolean
  isCritical: boolean
}) {
  // Estimated breakdown percentages (approximate visual representation)
  // In a real implementation, these would come from actual API response data
  const systemPct = 5
  const toolsPct = 10
  const historyPct = Math.max(0, ratio - systemPct - toolsPct)

  const barClass = isCritical ? 'context-bar-critical' : isWarning ? 'context-bar-warning' : 'context-bar-ok'

  return (
    <div className="context-window-viz">
      {isCritical && (
        <div className="context-warning-msg context-warning-critical">
          <Icons.AlertTriangle size={11} />
          <span>上下文窗口即将满 ({ratio}%)，建议开启新会话</span>
        </div>
      )}
      {!isCritical && isWarning && (
        <div className="context-warning-msg context-warning-warn">
          <Icons.AlertTriangle size={11} />
          <span>上下文窗口使用超过 {ratio}%，请注意</span>
        </div>
      )}
      <div className="context-usage-bar">
        <div
          className={`context-usage-fill ${barClass}`}
          style={{ width: `${Math.min(100, ratio)}%` }} /* dynamic */
        >
          <div className="context-fill-system" style={{ width: `${systemPct}%` }} /* dynamic */ />
          <div className="context-fill-tools" style={{ width: `${toolsPct}%` }} /* dynamic */ />
          <div className="context-fill-history" />
        </div>
      </div>
      <div className="context-usage-labels">
        <span className="context-label context-label-system">系统提示</span>
        <span className="context-label context-label-tools">工具定义</span>
        <span className="context-label context-label-history">对话历史</span>
        <span className="context-label context-label-remaining">剩余</span>
      </div>
      <div className="context-usage-detail">
        <div className="kv-row">
          <span className="k">已用</span>
          <span className="v">{formatTokenCount(usedTokens)}</span>
        </div>
        <div className="kv-row">
          <span className="k">总量</span>
          <span className="v">{formatTokenCount(totalTokens)}</span>
        </div>
        <div className="kv-row">
          <span className="k">使用率</span>
          <span className={`v ${isCritical ? 'token-cost-critical' : isWarning ? 'token-cost-warn' : ''}`}>{ratio}%</span>
        </div>
      </div>
    </div>
  )
}

function TurnUsageChart({ turns }: { turns: UsageSnapshot[] }) {
  if (turns.length === 0) return null

  const maxTokens = Math.max(...turns.map((t) => t.inputTokens + t.outputTokens), 1)

  return (
    <div className="turn-usage-chart">
      {turns.map((turn, index) => {
        const total = turn.inputTokens + turn.outputTokens
        const inputPct = (turn.inputTokens / maxTokens) * 100
        const outputPct = (turn.outputTokens / maxTokens) * 100
        return (
          <div key={`${turn.turnId}-${index}`} className="turn-usage-bar-group" title={`第 ${index + 1} 轮: 输入 ${formatTokenCount(turn.inputTokens)}, 输出 ${formatTokenCount(turn.outputTokens)}`}>
            <span className="turn-usage-index">{index + 1}</span>
            <div className="turn-usage-bar-track">
              <div className="turn-usage-bar-input" style={{ width: `${inputPct}%` }} /* dynamic */ />
              <div className="turn-usage-bar-output" style={{ width: `${outputPct}%` }} /* dynamic */ />
            </div>
            <span className="turn-usage-total">{formatTokenCount(total)}</span>
          </div>
        )
      })}
    </div>
  )
}

function buildUsageDataFromEvents(events: AgentEvent[]): SessionUsageData {
  let inputTokens = 0
  let outputTokens = 0
  let cacheHitTokens = 0
  let estimatedCostUsd = 0
  const turns: UsageSnapshot[] = []

  for (const event of events) {
    if (event.type !== 'usage_update') continue
    inputTokens = event.inputTokens
    outputTokens = event.outputTokens
    if (event.cacheHitTokens != null) cacheHitTokens = event.cacheHitTokens
    if (event.estimatedCostUsd != null) estimatedCostUsd += event.estimatedCostUsd
    turns.push({
      turnId: event.turnId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheHitTokens: event.cacheHitTokens ?? 0,
      estimatedCostUsd: event.estimatedCostUsd ?? 0,
      timestamp: event.timestamp,
    })
  }

  return { inputTokens, outputTokens, cacheHitTokens, estimatedCostUsd, contextWindow: 0, turns }
}

function extractPlans(messages: UIMessage[]): SidebarPlan[] {
  const plans: SidebarPlan[] = []

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'plan_proposed') {
        const items = parsePlanToItems(block.plan)
        if (items.length === 0) continue
        plans.push({
          id: `${message.id}:plan_proposed`,
          title: 'Agent 计划',
          items,
        })
        continue
      }

      if (block.kind !== 'tool_call') continue

      const todos = block.toolName === 'todo_write' ? parseTodosFromInputOrOutput(block.toolInput, block.output) : []
      const rawPlan = Array.isArray(block.toolInput.plan) ? block.toolInput.plan : undefined
      if (todos.length === 0 && rawPlan == null && !isPlanToolName(block.toolName)) continue

      const items = todos.length > 0
        ? todos.map((todo) => ({
            text: todo.status === 'in_progress' ? (todo.activeForm ?? todo.content) : todo.content,
            status: normalizePlanStatus(todo.status),
          }))
        : (rawPlan ?? []).flatMap((item, index) => {
            if (!isRecord(item)) return []
            const text = String(item.step ?? item.text ?? item.title ?? `Step ${index + 1}`)
            return [{ text, status: normalizePlanStatus(item.status) }]
          })
      if (items.length === 0) continue
      plans.push({
        id: block.toolCallId,
        title: String(block.toolInput.title ?? (todos.length > 0 ? 'Todo 计划' : 'Agent 计划')),
        explanation: typeof block.toolInput.explanation === 'string' ? block.toolInput.explanation : undefined,
        items,
      })
    }
  }

  return plans.slice(-3).reverse()
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
