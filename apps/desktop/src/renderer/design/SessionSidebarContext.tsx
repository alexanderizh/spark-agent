/**
 * SessionSidebarContext — Shared session/workspace state for the sidebar
 * conversation list. Extracted from ChatView so that the FloatingSidebar can
 * render the conversation list at the top-level layout.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useIpcInvoke } from './hooks/useIpc'
import { useToast } from './components/Toast'
import { useApp } from './AppContext'
import type {
  SessionId,
  SessionListResponse,
  SessionSearchResult,
  SessionGetQueueResponse,
  WorkspaceInfo,
  ProviderProfile,
  ManagedAgent,
  SessionAgentAdapter,
  SessionChatMode,
  SessionPermissionMode,
  SessionReasoningEffort,
  AgentEvent,
  AgentStatusValue,
} from '@spark/protocol'

export type SessionSummary = SessionListResponse['sessions'][number]

export type ProjectGroup = {
  workspace: WorkspaceInfo
  sessions: SessionSummary[]
}

export type TimeFilter = 'all' | '1d' | '3d' | '7d' | '10d'

export const NO_PROJECT_WORKSPACE_NAME = '不使用项目'
const LAST_SESSION_KEY = 'spark-agent:last-active-session'

function getNoProjectRootPath(tempDir: string): string {
  const sep = tempDir.includes('\\') ? '\\' : '/'
  return `${tempDir.replace(/[\\/]$/, '')}${sep}no-project`
}

const DEFAULT_AGENT_ADAPTER: SessionAgentAdapter = 'claude'

function isProviderCompatibleWithAdapter(_provider: ProviderProfile, _adapter: SessionAgentAdapter): boolean {
  return true
}

function getProviderAdapterKind(_provider: ProviderProfile): SessionAgentAdapter {
  return DEFAULT_AGENT_ADAPTER
}

function getValidPermissionMode(mode: SessionPermissionMode | undefined, adapter: SessionAgentAdapter): SessionPermissionMode {
  if (!mode) {
    if (adapter === 'codex') return 'codex-default'
    return 'claude-auto-edits'
  }
  return mode
}

type ComposerPrefs = {
  adapter?: SessionAgentAdapter
  providerProfileId?: string
  modelId?: string
  permissionMode?: SessionPermissionMode
  reasoningEffort?: SessionReasoningEffort
  agentId?: string
}

const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'

function readComposerPrefs(): ComposerPrefs {
  try {
    const raw = window.localStorage.getItem(COMPOSER_PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeComposerPrefs(prefs: ComposerPrefs): void {
  try { window.localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs)) } catch { /* */ }
}

function getPreferredProvider(
  providers: ProviderProfile[],
  prefs: ComposerPrefs,
  adapter: SessionAgentAdapter,
): ProviderProfile | undefined {
  if (prefs.providerProfileId) {
    const found = providers.find(p => p.id === prefs.providerProfileId)
    if (found && isProviderCompatibleWithAdapter(found, adapter)) return found
  }
  const def = providers.find(p => p.isDefault)
  if (def && isProviderCompatibleWithAdapter(def, adapter)) return def
  return providers[0]
}

function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() ?? ''
}

export function filterSessionsByTime(sessions: SessionSummary[], filter: TimeFilter): SessionSummary[] {
  if (filter === 'all') return sessions
  const days = Number.parseInt(filter, 10)
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sessions.filter((session) => {
    const updatedAt = new Date(session.updatedAt).getTime()
    return Number.isFinite(updatedAt) && updatedAt >= cutoff
  })
}

export function buildProjectGroups(
  workspaces: WorkspaceInfo[],
  sessions: SessionSummary[],
): ProjectGroup[] {
  const userWorkspaces = workspaces.filter(w => w.name !== NO_PROJECT_WORKSPACE_NAME && !w.archivedAt)
  return userWorkspaces.map(workspace => ({
    workspace,
    sessions: sessions.filter(session => session.workspaceIds.includes(workspace.id)),
  }))
}

type SessionSidebarCtx = {
  // Data
  sessions: SessionSummary[]
  workspaces: WorkspaceInfo[]
  providers: ProviderProfile[]
  agents: ManagedAgent[]

  // Active state
  activeSessionId: SessionId | null
  activeWorkspaceId: string | null
  setActiveSession: (id: SessionId | null) => void
  setActiveWorkspace: (id: string | null) => void

  // Agent status per session (fine-grained: waiting_permission, waiting_user, etc.)
  sessionAgentStatuses: Record<string, AgentStatusValue>

  // Computed
  projectGroups: ProjectGroup[]
  noProjectWorkspace: WorkspaceInfo | null
  noProjectSessions: SessionSummary[]
  ungroupedSessions: SessionSummary[]

  // Actions
  refreshData: () => Promise<void>
  updateSessionInList: (sessionId: SessionId, patch: Partial<SessionSummary>) => void

  // Session actions
  handleNewSession: (workspaceId?: string | null, options?: Record<string, unknown>) => Promise<SessionId | null>
  handleToggleSessionPinned: (session: SessionSummary) => Promise<void>
  handleRenameSession: (session: SessionSummary) => Promise<void>
  handleDeleteSession: (session: SessionSummary) => Promise<void>
  handleArchiveSession: (session: SessionSummary) => Promise<void>
  handleOpenSessionFolder: (session: SessionSummary) => Promise<void>

  // Project actions
  handleToggleProjectPinned: (workspace: WorkspaceInfo) => Promise<void>
  handleRenameProject: (workspace: WorkspaceInfo) => Promise<void>
  handleArchiveProject: (workspace: WorkspaceInfo) => Promise<void>
  handleDeleteProject: (workspace: WorkspaceInfo) => Promise<void>
  handleOpenProjectFolder: (workspace: WorkspaceInfo) => Promise<void>
  handleOpenWorkspace: (workspace: WorkspaceInfo) => Promise<void>

  // Create project dialog
  handleCreateProject: (useTempDir?: boolean) => Promise<void>
  handlePickProjectPath: () => Promise<void>
  projectDialog: 'create' | null
  setProjectDialog: (d: 'create' | null) => void
  projectName: string
  setProjectName: (n: string) => void
  projectPath: string
  setProjectPath: (p: string) => void
  projectNotice: string

  // Search
  searchSessions: (query: string) => Promise<SessionSearchResult[]>

  // Ensure no-project workspace
  ensureNoProjectWorkspace: () => Promise<string | null>

  // Refs
  justCreatedSessionRef: React.MutableRefObject<SessionId | null>
  selectedProviderId: string
  setSelectedProviderId: (id: string) => void
}

const Ctx = createContext<SessionSidebarCtx | null>(null)

export function SessionSidebarProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [active, setActive] = useState<SessionId | null>(() => {
    const stored = window.localStorage.getItem(LAST_SESSION_KEY)
    return stored as SessionId | null ?? null
  })
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [noProjectWorkspaceId, setNoProjectWorkspaceId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [projectDialog, setProjectDialog] = useState<'create' | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [projectNotice, setProjectNotice] = useState('')
  const [sessionAgentStatuses, setSessionAgentStatuses] = useState<Record<string, AgentStatusValue>>({})
  const justCreatedSessionRef = useRef<SessionId | null>(null)
  const { toast } = useToast()
  const { requestConfirm, requestPrompt } = useApp()

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: searchSessionsRpc } = useIpcInvoke('session:search')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: deleteSession } = useIpcInvoke('session:delete')
  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: updateWorkspace } = useIpcInvoke('workspace:update')
  const { invoke: deleteWorkspace } = useIpcInvoke('workspace:delete')
  const { invoke: openWorkspaceFolder } = useIpcInvoke('workspace:open-folder')
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: getTempProjectDir } = useIpcInvoke('app:get-temp-project-dir')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

  const refreshData = useCallback(async () => {
    try {
      const [workspaceRes, sessionRes, currentRes, providerRes, agentRes] = await Promise.all([
        listWorkspaces({ limit: 100 }),
        listSessions({ limit: 200 }),
        getCurrentWorkspace({}),
        listProviders({}),
        listAgents({}).catch(() => ({ agents: [] as ManagedAgent[] })),
      ])
      setWorkspaces(workspaceRes.workspaces)
      setSessions(sessionRes.sessions)
      setProviders(providerRes.profiles)
      setAgents(Array.isArray(agentRes.agents) ? agentRes.agents : [])
      setSelectedProviderId(prev =>
        prev || getPreferredProvider(providerRes.profiles, readComposerPrefs(), DEFAULT_AGENT_ADAPTER)?.id || ''
      )
      setActiveWorkspaceId(prev => currentRes.workspace?.id ?? prev ?? workspaceRes.workspaces[0]?.id ?? null)
    } catch (err) {
      console.error('Failed to refresh session data', err)
    }
  }, [getCurrentWorkspace, listAgents, listProviders, listSessions, listWorkspaces])

  useEffect(() => {
    const timer = window.setTimeout(() => { refreshData().catch(console.error) }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshData])

  // Real-time session queue state updates
  useEffect(() => {
    return window.spark?.on?.('stream:session:queue-changed', (snapshot: SessionGetQueueResponse) => {
      setSessions(prev => prev.map(item => {
        if (item.id !== snapshot.sessionId) return item
        if (snapshot.running)
          return item.status === 'running' ? item : { ...item, status: 'running' }
        return item.status === 'running' ? { ...item, status: 'idle' } : item
      }))
    }) ?? (() => {})
  }, [])

  // Real-time agent status tracking (waiting_permission / waiting_user)
  useEffect(() => {
    return window.spark?.on?.('stream:session:agent-event', (event: AgentEvent) => {
      if (event.type !== 'agent_status') return
      const status = (event as { status: AgentStatusValue }).status
      const sessionId = event.sessionId
      setSessionAgentStatuses(prev => {
        const current = prev[sessionId]
        // Clear on terminal states
        if (status === 'idle' || status === 'completed' || status === 'cancelled' || status === 'error') {
          if (!current) return prev
          const { [sessionId]: _, ...rest } = prev
          return rest
        }
        // Only update if changed
        if (current === status) return prev
        return { ...prev, [sessionId]: status }
      })
    }) ?? (() => {})
  }, [])

  // Real-time session title updates (async LLM rename after first turn)
  useEffect(() => {
    return window.spark?.on?.('stream:session:renamed', (payload: { sessionId: string; title: string }) => {
      setSessions(prev => prev.map(item =>
        item.id === payload.sessionId ? { ...item, title: payload.title } : item,
      ))
    }) ?? (() => {})
  }, [])

  useEffect(() => {
    return window.spark?.on?.('stream:session:created', () => {
      refreshData().catch(console.error)
    }) ?? (() => {})
  }, [refreshData])

  useEffect(() => {
    if (active) window.localStorage.setItem(LAST_SESSION_KEY, active)
    else window.localStorage.removeItem(LAST_SESSION_KEY)
  }, [active])

  useEffect(() => {
    if (!active || sessions.length === 0) return
    if (justCreatedSessionRef.current === active) {
      justCreatedSessionRef.current = null
      return
    }
    const found = sessions.find(s => s.id === active)
    const id = window.setTimeout(() => {
      if (!found) setActive(null)
      else if (activeWorkspaceId == null && found.workspaceIds.length > 0) setActiveWorkspaceId(found.workspaceIds[0] ?? null)
    }, 0)
    return () => window.clearTimeout(id)
  }, [active, activeWorkspaceId, sessions])

  const updateSessionInList = useCallback((sessionId: SessionId, patch: Partial<SessionSummary>) => {
    setSessions(prev => prev.map(item => item.id === sessionId ? { ...item, ...patch } : item))
  }, [])

  const ensureNoProjectWorkspace = useCallback(async (): Promise<string | null> => {
    if (noProjectWorkspaceId) return noProjectWorkspaceId
    const existing = workspaces.find(w => w.name === NO_PROJECT_WORKSPACE_NAME)
    if (existing) { setNoProjectWorkspaceId(existing.id); return existing.id }
    try {
      const { tempDir } = await getTempProjectDir({})
      const rootPath = getNoProjectRootPath(tempDir)
      const res = await openWorkspace({ create: { name: NO_PROJECT_WORKSPACE_NAME, rootPath } })
      setNoProjectWorkspaceId(res.workspace.id)
      setWorkspaces(prev => prev.some(w => w.id === res.workspace.id) ? prev : [...prev, res.workspace])
      return res.workspace.id
    } catch (err) {
      console.error('创建 "不使用项目" workspace 失败', err)
      toast.error(err instanceof Error ? err.message : '创建临时项目目录失败')
      return null
    }
  }, [getTempProjectDir, noProjectWorkspaceId, openWorkspace, toast, workspaces])

  const handleNewSession = useCallback(async (
    workspaceId: string | null = activeWorkspaceId,
    options: Record<string, unknown> = {},
  ): Promise<SessionId | null> => {
    try {
      let wsId = workspaceId
      if (wsId == null) {
        const noProjectId = await ensureNoProjectWorkspace()
        if (noProjectId == null) return null
        wsId = noProjectId
        setActiveWorkspaceId(noProjectId)
      }

      // 如果该项目下有未使用的会话（没有消息、未归档），直接复用
      const unusedSession = sessions.find(
        s => s.workspaceIds.includes(wsId!) && s.messageCount === 0 && s.archivedAt == null,
      )
      if (unusedSession) {
        if (options.activate !== false) setActive(unusedSession.id)
        setActiveWorkspaceId(wsId)
        return unusedSession.id
      }

      const knownProviders = providers.length > 0 ? providers : (await listProviders({})).profiles
      if (providers.length === 0) setProviders(knownProviders)
      const prefs = readComposerPrefs()
      const defaultAgent = agents.find(a => a.isDefault && a.enabled)
      const selectedAgent = agents.find(a => a.id === (options.agentId as string)) ??
        agents.find(a => a.id === prefs.agentId) ?? defaultAgent ?? agents[0]
      const preferredAdapter = (options.agentAdapter as SessionAgentAdapter) ?? selectedAgent?.agentAdapter ?? prefs.adapter ?? DEFAULT_AGENT_ADAPTER
      const profile = knownProviders.find(p => p.id === (options.providerProfileId as string)) ??
        knownProviders.find(p => p.id === selectedAgent?.providerProfileId) ??
        knownProviders.find(p => p.id === selectedProviderId && isProviderCompatibleWithAdapter(p, preferredAdapter)) ??
        getPreferredProvider(knownProviders, prefs, preferredAdapter)
      if (!profile) {
        void requestConfirm({
          title: '需要配置 Provider',
          description: '请先在设置中配置模型供应商，然后再新建会话。',
          confirmText: '知道了',
        })
        return null
      }
      const agentAdapter = (options.agentAdapter as SessionAgentAdapter) ?? selectedAgent?.agentAdapter ?? getProviderAdapterKind(profile)
      const permissionMode = (options.permissionMode as SessionPermissionMode) ?? selectedAgent?.permissionMode ?? getValidPermissionMode(prefs.permissionMode, agentAdapter)
      const modelId = (options.modelId as string) ?? selectedAgent?.modelId ?? (prefs.providerProfileId === profile.id && prefs.modelId ? prefs.modelId : undefined)
      const res = await createSession({
        providerProfileId: profile.id,
        ...(modelId !== undefined ? { modelId } : {}),
        agentId: (options.agentId as string) ?? selectedAgent?.id ?? 'code-agent',
        agentAdapter,
        permissionMode,
        ...(options.chatMode !== undefined ? { chatMode: options.chatMode as SessionChatMode } : {}),
        reasoningEffort: (options.reasoningEffort as SessionReasoningEffort) ?? prefs.reasoningEffort ?? 'medium',
        workspaceId: wsId,
      })
      justCreatedSessionRef.current = res.sessionId
      if (options.activate !== false) setActive(res.sessionId)
      setSelectedProviderId(profile.id)
      setActiveWorkspaceId(wsId)
      if (options.skipRefresh !== true) await refreshData()
      writeComposerPrefs({
        adapter: agentAdapter,
        agentId: (options.agentId as string) ?? selectedAgent?.id ?? 'code-agent',
        providerProfileId: profile.id,
        ...(modelId !== undefined ? { modelId } : {}),
        permissionMode,
      })
      return res.sessionId
    } catch (err) {
      console.error('创建会话失败', err)
      toast.error(err instanceof Error ? err.message : '创建会话失败')
      return null
    }
  }, [activeWorkspaceId, agents, createSession, ensureNoProjectWorkspace, listProviders, providers, refreshData, requestConfirm, selectedProviderId, sessions, toast])

  // Search
  const searchSessions = useCallback(async (query: string): Promise<SessionSearchResult[]> => {
    try {
      const res = await searchSessionsRpc({ query, limit: 20 })
      return res.results
    } catch {
      return []
    }
  }, [searchSessionsRpc])

  // Project dialog
  const handlePickProjectPath = useCallback(async () => {
    try {
      const selected = await openDirectoryDialog({ title: '选择或创建项目文件夹' })
      if (selected.canceled || selected.filePath == null) return
      setProjectPath(selected.filePath)
      if (!projectName.trim()) setProjectName(getBasename(selected.filePath))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '选择项目路径失败')
    }
  }, [openDirectoryDialog, projectName, toast])

  const handleCreateProject = useCallback(async (useTempDir = false) => {
    let rootPath = projectPath.trim()
    const name = projectName.trim() || getBasename(rootPath) || '新项目'
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
      setProjectNotice('')
      const res = await openWorkspace({ create: { name, rootPath } })
      setProjectDialog(null)
      setProjectName('')
      setProjectPath('')
      setActiveWorkspaceId(res.workspace.id)
      toast.success(`项目已创建于：${rootPath}`)
      await handleNewSession(res.workspace.id, { skipRefresh: true } as Record<string, unknown>)
      await refreshData()
    } catch (err) {
      console.error('创建项目失败', err)
      toast.error(err instanceof Error ? err.message : '创建项目失败')
    }
  }, [getTempProjectDir, handleNewSession, openWorkspace, projectName, projectPath, refreshData, toast])

  // Project actions
  const handleRenameProject = useCallback(async (workspace: WorkspaceInfo) => {
    const name = (await requestPrompt({
      title: '重命名项目',
      value: workspace.name,
      placeholder: '输入项目名称',
      confirmText: '重命名',
    }))?.trim()
    if (!name || name === workspace.name) return
    try { await updateWorkspace({ workspaceId: workspace.id, name }); await refreshData() }
    catch (err) { toast.error(err instanceof Error ? err.message : '重命名项目失败') }
  }, [refreshData, requestPrompt, toast, updateWorkspace])

  const handleToggleProjectPinned = useCallback(async (workspace: WorkspaceInfo) => {
    try { await updateWorkspace({ workspaceId: workspace.id, pinned: workspace.pinnedAt == null }); await refreshData() }
    catch (err) { toast.error(err instanceof Error ? err.message : '更新项目置顶失败') }
  }, [refreshData, toast, updateWorkspace])

  const handleArchiveProject = useCallback(async (workspace: WorkspaceInfo) => {
    const confirmed = await requestConfirm({
      title: `归档项目「${workspace.name}」？`,
      description: '归档后会从当前列表隐藏，可在设置中恢复。',
      confirmText: '归档',
    })
    if (!confirmed) return
    try {
      await updateWorkspace({ workspaceId: workspace.id, archived: true })
      if (activeWorkspaceId === workspace.id) { setActiveWorkspaceId(null); setActive(null) }
      await refreshData()
    } catch (err) { toast.error(err instanceof Error ? err.message : '归档项目失败') }
  }, [activeWorkspaceId, refreshData, requestConfirm, toast, updateWorkspace])

  const handleDeleteProject = useCallback(async (workspace: WorkspaceInfo) => {
    const confirmed = await requestConfirm({
      title: `删除项目「${workspace.name}」？`,
      description: '项目及其会话记录会被删除，本地文件夹不会被删除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      const res = await deleteWorkspace({ workspaceId: workspace.id })
      if (activeWorkspaceId === workspace.id || (active != null && res.deletedSessionIds.includes(active))) {
        setActiveWorkspaceId(null); setActive(null)
      }
      await refreshData()
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除项目失败') }
  }, [active, activeWorkspaceId, deleteWorkspace, refreshData, requestConfirm, toast])

  const handleOpenProjectFolder = useCallback(async (workspace: WorkspaceInfo) => {
    try { await openWorkspaceFolder({ workspaceId: workspace.id }) }
    catch (err) { toast.error(err instanceof Error ? err.message : '打开文件夹失败') }
  }, [openWorkspaceFolder, toast])

  const handleOpenWorkspace = useCallback(async (workspace: WorkspaceInfo) => {
    try { await openWorkspace({ rootPath: workspace.rootPath }) }
    catch (err) { toast.error(err instanceof Error ? err.message : '打开项目失败') }
  }, [openWorkspace, toast])

  // Session actions
  const handleToggleSessionPinned = useCallback(async (session: SessionSummary) => {
    try { await updateSession({ sessionId: session.id, pinned: session.pinnedAt == null }); await refreshData() }
    catch (err) { toast.error(err instanceof Error ? err.message : '更新会话置顶失败') }
  }, [refreshData, toast, updateSession])

  const handleRenameSession = useCallback(async (session: SessionSummary) => {
    const title = (await requestPrompt({
      title: '重命名会话',
      value: session.title ?? '',
      placeholder: '输入会话标题',
      confirmText: '重命名',
    }))?.trim()
    if (!title || title === (session.title ?? '')) return
    try { await updateSession({ sessionId: session.id, title }); await refreshData() }
    catch (err) { toast.error(err instanceof Error ? err.message : '重命名会话失败') }
  }, [refreshData, requestPrompt, toast, updateSession])

  const handleDeleteSession = useCallback(async (session: SessionSummary) => {
    const confirmed = await requestConfirm({
      title: `删除会话「${session.title ?? '未命名'}」？`,
      description: '该会话记录会从本地删除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try { await deleteSession({ sessionId: session.id }); if (active === session.id) setActive(null); await refreshData() }
    catch (err) { toast.error(err instanceof Error ? err.message : '删除会话失败') }
  }, [active, deleteSession, refreshData, requestConfirm, toast])

  const handleArchiveSession = useCallback(async (session: SessionSummary) => {
    try { await updateSession({ sessionId: session.id, archived: true }); await refreshData() }
    catch (err) { toast.error(err instanceof Error ? err.message : '归档会话失败') }
  }, [refreshData, toast, updateSession])

  const handleOpenSessionFolder = useCallback(async (session: SessionSummary) => {
    const workspaceId = session.workspaceIds[0]
    if (workspaceId == null) {
      return // no workspace associated
    }
    try { await openWorkspaceFolder({ workspaceId }) }
    catch (err) { toast.error(err instanceof Error ? err.message : '打开文件夹失败') }
  }, [openWorkspaceFolder, toast])

  // Computed
  const projectGroups = useMemo(() => buildProjectGroups(workspaces, sessions), [sessions, workspaces])

  const noProjectWorkspace = useMemo(() =>
    workspaces.find(w => w.name === NO_PROJECT_WORKSPACE_NAME) ?? null,
    [workspaces],
  )

  const noProjectSessions = useMemo(() =>
    noProjectWorkspace ? sessions.filter(s => s.workspaceIds.includes(noProjectWorkspace.id)) : [],
    [noProjectWorkspace, sessions],
  )

  const ungroupedSessions = useMemo(() =>
    sessions.filter(s => s.workspaceIds.length === 0),
    [sessions],
  )

  const value = useMemo<SessionSidebarCtx>(() => ({
    sessions, workspaces, providers, agents,
    activeSessionId: active, activeWorkspaceId,
    setActiveSession: setActive, setActiveWorkspace: setActiveWorkspaceId,
    sessionAgentStatuses,
    projectGroups, noProjectWorkspace, noProjectSessions, ungroupedSessions,
    refreshData, updateSessionInList, handleNewSession,
    handleToggleSessionPinned, handleRenameSession, handleDeleteSession,
    handleArchiveSession, handleOpenSessionFolder,
    handleToggleProjectPinned, handleRenameProject, handleArchiveProject,
    handleDeleteProject, handleOpenProjectFolder, handleOpenWorkspace,
    handleCreateProject, handlePickProjectPath,
    projectDialog, setProjectDialog, projectName, setProjectName,
    projectPath, setProjectPath, projectNotice,
    searchSessions, ensureNoProjectWorkspace,
    justCreatedSessionRef, selectedProviderId, setSelectedProviderId,
  }), [
    sessions, workspaces, providers, agents, active, activeWorkspaceId,
    sessionAgentStatuses,
    projectGroups, noProjectWorkspace, noProjectSessions, ungroupedSessions,
    refreshData, updateSessionInList, handleNewSession,
    handleToggleSessionPinned, handleRenameSession, handleDeleteSession,
    handleArchiveSession, handleOpenSessionFolder,
    handleToggleProjectPinned, handleRenameProject, handleArchiveProject,
    handleDeleteProject, handleOpenProjectFolder, handleOpenWorkspace,
    handleCreateProject, handlePickProjectPath,
    projectDialog, projectName, projectPath, projectNotice,
    searchSessions, ensureNoProjectWorkspace, selectedProviderId,
  ])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSessionSidebar(): SessionSidebarCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSessionSidebar must be inside <SessionSidebarProvider>')
  return v
}
