/**
 * SessionSidebarContext — Shared session/workspace state for the sidebar
 * conversation list. Extracted from ChatView so that the FloatingSidebar can
 * render the conversation list at the top-level layout.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useIpcInvoke } from './hooks/useIpc'
import { createSingleFlightRefresh } from './services/single-flight-refresh'
import { useOptionalToast, type ToastFn } from './components/Toast'
import { useApp } from './AppContext'
import { useI18n } from './i18n'
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
  TeamModeConfig,
  TerminalSessionActivity,
  TerminalStreamEvent,
} from '@spark/protocol'
import { isAutoRouterProvider } from '@spark/protocol'
import {
  getPreferredProviderForAdapter,
  getProviderAdapterKind,
  isProviderCompatibleWithAdapter,
} from './utils/provider-adapter'
import { sortSessionsByPinned, toTime } from './sidebar-session-sort'

// 供 SidebarSessionList 等消费方在本地排序时复用（与后端 listSessions 排序对齐）。
export { sortSessionsByPinned }

export type SessionSummary = SessionListResponse['sessions'][number]

export type ProjectGroup = {
  workspace: WorkspaceInfo
  sessions: SessionSummary[]
}

export type TimeFilter = 'all' | '1d' | '3d' | '7d' | '10d'

// 与主进程 ipc/index.ts / TerminalService.ts 的 NO_PROJECT_WORKSPACE_NAME 保持一致：
// 主进程统一写入/查找 DB 时使用中文名 '不使用项目'。这里如果写成 'No project'，
// 会让 buildProjectGroups 过滤失败 → noProject workspace 没被剔除 → sidebar 直接用
// workspace.name 显示成 '不使用项目'，让 i18n 中的 'sidebar.noProjectChats' = '临时会话'
// 完全失效。
export const NO_PROJECT_WORKSPACE_NAME = '不使用项目'
const LAST_SESSION_KEY = 'spark-agent:last-active-session'

function getNoProjectRootPath(tempDir: string): string {
  const sep = tempDir.includes('\\') ? '\\' : '/'
  return `${tempDir.replace(/[\\/]$/, '')}${sep}no-project`
}

const DEFAULT_AGENT_ADAPTER: SessionAgentAdapter = 'claude-sdk'

function getValidPermissionMode(
  mode: SessionPermissionMode | undefined,
  adapter: SessionAgentAdapter,
): SessionPermissionMode {
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
  try {
    window.localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* */
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getPreferredProvider(
  providers: ProviderProfile[],
  prefs: ComposerPrefs,
  adapter: SessionAgentAdapter,
): ProviderProfile | undefined {
  return getPreferredProviderForAdapter(providers, prefs.providerProfileId, adapter)
}

function getProviderDefaultModel(provider: ProviderProfile): string | undefined {
  return nonEmptyString(provider.defaultModel) ?? nonEmptyString(provider.modelIds[0])
}

function providerSupportsModel(provider: ProviderProfile, modelId: string | undefined): boolean {
  if (modelId == null) return false
  const configuredModels = provider.modelIds.length
    ? provider.modelIds
    : provider.defaultModel
      ? [provider.defaultModel]
      : []
  return configuredModels.length === 0 || configuredModels.includes(modelId)
}

function resolveModelForProvider(
  provider: ProviderProfile,
  candidates: Array<string | undefined>,
): string | undefined {
  return (
    candidates.find((modelId) => providerSupportsModel(provider, modelId)) ??
    getProviderDefaultModel(provider)
  )
}

function resolveNewSessionTeamConfig(
  teamConfig: unknown,
  hostAgentId: string,
): TeamModeConfig {
  if (teamConfig != null) return teamConfig as TeamModeConfig
  return {
    enabled: false,
    hostAgentId,
    memberAgentIds: [],
    maxDepth: 1,
    allowNesting: false,
    maxDiscussionRounds: 6,
    enablePeerMessaging: false,
  }
}

function getBasename(path: string): string {
  return path.split(/[/\\]/).pop() ?? ''
}

export function filterSessionsByTime(
  sessions: SessionSummary[],
  filter: TimeFilter,
): SessionSummary[] {
  if (filter === 'all') return sessions
  const days = Number.parseInt(filter, 10)
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sessions.filter((session) => {
    const updatedAt = new Date(session.updatedAt).getTime()
    return Number.isFinite(updatedAt) && updatedAt >= cutoff
  })
}

/** Agent 占用中、不可被一键清空的状态：思考 / 调用工具 / 等待权限 / 等待输入。 */
const ACTIVE_AGENT_STATUSES = new Set<AgentStatusValue>([
  'thinking',
  'calling_tool',
  'waiting_permission',
  'waiting_user',
])

/** 判断会话是否处于运行中状态，一键清空时需跳过。 */
function isSessionActive(
  sessionId: string,
  agentStatuses: Record<string, AgentStatusValue>,
): boolean {
  const status = agentStatuses[sessionId]
  return status != null && ACTIVE_AGENT_STATUSES.has(status)
}

/** 取项目分组下最新一条会话的更新时间；无会话时回落到 workspace 自身的 updatedAt。 */
function latestSessionAt(group: ProjectGroup): number {
  let latest = 0
  for (const session of group.sessions) {
    const t = toTime(session.updatedAt)
    if (t > latest) latest = t
  }
  return latest || toTime(group.workspace.updatedAt)
}

export function buildProjectGroups(
  workspaces: WorkspaceInfo[],
  sessions: SessionSummary[],
): ProjectGroup[] {
  const visible = workspaces.filter((w) => w.name !== NO_PROJECT_WORKSPACE_NAME && !w.archivedAt)
  const byId = new Map(visible.map((w) => [w.id, w] as const))
  // 普通（基）项目构成分组；worktree workspace 不单独成组，其会话归并到 base 项目。
  const baseWorkspaces = visible.filter((w) => w.worktreeMeta == null)
  const baseIds = new Set(baseWorkspaces.map((w) => w.id))
  // base 已不存在的 worktree（孤儿）作为兜底，仍保留自己的分组，避免会话丢失。
  const orphanWorktrees = visible.filter(
    (w) =>
      w.worktreeMeta != null &&
      !(w.worktreeMeta.baseWorkspaceId != null && baseIds.has(w.worktreeMeta.baseWorkspaceId)),
  )
  const groupWorkspaces = [...baseWorkspaces, ...orphanWorktrees]

  // 把某 workspace id 解析为其展示分组 id：worktree → base（若 base 存在）。
  const effectiveWorkspaceId = (wsId: string): string => {
    const base = byId.get(wsId)?.worktreeMeta?.baseWorkspaceId
    return base != null && baseIds.has(base) ? base : wsId
  }

  const sessionsByGroup = new Map<string, SessionSummary[]>()
  for (const workspace of groupWorkspaces) {
    sessionsByGroup.set(workspace.id, [])
  }
  for (const session of sessions) {
    const seen = new Set<string>()
    for (const workspaceId of session.workspaceIds) {
      const groupId = effectiveWorkspaceId(workspaceId)
      if (seen.has(groupId)) continue
      seen.add(groupId)
      sessionsByGroup.get(groupId)?.push(session)
    }
  }

  const groups = groupWorkspaces.map((workspace) => ({
    workspace,
    sessions: sortSessionsByPinned(sessionsByGroup.get(workspace.id) ?? []),
  }))

  // 排序：置顶项目始终在前（内部按 pinnedAt 倒序，与后端 listAll 一致）；
  // 未置顶项目之间按「最新一条会话的更新时间」倒序排列，
  // 无会话时回落到 workspace 自身的 updatedAt。这样刚对话过的项目会浮到顶部。
  return groups.sort((a, b) => {
    const aPinnedAt = a.workspace.pinnedAt
    const bPinnedAt = b.workspace.pinnedAt
    if (aPinnedAt != null && bPinnedAt == null) return -1
    if (aPinnedAt == null && bPinnedAt != null) return 1
    if (aPinnedAt != null && bPinnedAt != null) {
      return toTime(bPinnedAt) - toTime(aPinnedAt)
    }
    return latestSessionAt(b) - latestSessionAt(a)
  })
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
  // Built-in terminal activity per session. Used by the sidebar to show long-running PTYs.
  sessionTerminalActivity: Record<string, TerminalSessionActivity>
  // Session IDs that just completed but the user hasn't viewed since — drives the blue unread dot
  unreviewedCompletedSessions: Set<string>

  // Computed
  projectGroups: ProjectGroup[]
  noProjectWorkspace: WorkspaceInfo | null
  noProjectSessions: SessionSummary[]
  ungroupedSessions: SessionSummary[]

  // Actions
  refreshData: () => Promise<void>
  updateSessionInList: (sessionId: SessionId, patch: Partial<SessionSummary>) => void
  bumpSessionMessageCount: (sessionId: SessionId) => void

  // Session actions
  handleNewSession: (
    workspaceId?: string | null,
    options?: Record<string, unknown>,
  ) => Promise<SessionId | null>
  handleToggleSessionPinned: (session: SessionSummary) => Promise<void>
  handleRenameSession: (session: SessionSummary) => Promise<void>
  handleDeleteSession: (session: SessionSummary) => Promise<void>
  handleClearSessions: (sessions: SessionSummary[]) => Promise<void>
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

  // History import (检测/导入宿主机 Claude Code / Codex 对话历史)
  historyImportOpen: boolean
  setHistoryImportOpen: (open: boolean) => void
}

const Ctx = createContext<SessionSidebarCtx | null>(null)

export function SessionSidebarProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [active, setActiveRaw] = useState<SessionId | null>(() => {
    const stored = window.localStorage.getItem(LAST_SESSION_KEY)
    return (stored as SessionId | null) ?? null
  })
  const setActive = useCallback((id: SessionId | null) => {
    setActiveRaw(id)
    if (id) {
      setUnreviewedCompleted((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [noProjectWorkspaceId, setNoProjectWorkspaceId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [projectDialog, setProjectDialog] = useState<'create' | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [projectNotice, setProjectNotice] = useState('')
  const [historyImportOpen, setHistoryImportOpen] = useState(false)
  const [sessionAgentStatuses, setSessionAgentStatuses] = useState<
    Record<string, AgentStatusValue>
  >({})
  const [sessionTerminalActivity, setSessionTerminalActivity] = useState<
    Record<string, TerminalSessionActivity>
  >({})
  // Sessions that just completed but the user hasn't viewed yet — used for the blue "unread" dot
  const [unreviewedCompleted, setUnreviewedCompleted] = useState<Set<string>>(() => new Set())
  const justCreatedSessionRef = useRef<SessionId | null>(null)
  const pendingCreatedWorkspaceIdsRef = useRef(new Map<SessionId, string | null>())
  const pinMutationsRef = useRef(new Map<SessionId, {
    desiredPinned: boolean
    confirmedPinnedAt: string | null
    running: boolean
  }>())
  const activeRef = useRef<SessionId | null>(active)
  const workspaceSyncedSessionRef = useRef<SessionId | null>(null)
  const manualWorkspaceSelectionRef = useRef<{
    sessionId: SessionId | null
    workspaceId: string | null
  } | null>(null)
  const upsertSessionInList = useCallback((session: SessionSummary) => {
    setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
  }, [])
  useEffect(() => {
    activeRef.current = active
  }, [active])
  const optionalToast = useOptionalToast()
  const fallbackToast = useMemo<ToastFn>(() => {
    const noop = () => ''
    return Object.assign(noop, {
      success: noop,
      error: noop,
      info: noop,
      warning: noop,
    })
  }, [])
  const toast = optionalToast?.toast ?? fallbackToast
  const { requestConfirm, requestPrompt } = useApp()
  const { t } = useI18n()

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: listActiveTerminals } = useIpcInvoke('terminal:list-active')
  const { invoke: searchSessionsRpc } = useIpcInvoke('session:search')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: deleteSession } = useIpcInvoke('session:delete')
  const { invoke: persistTeamConfig } = useIpcInvoke('team:update')
  const { invoke: createWorktree } = useIpcInvoke('workspace:create-worktree')
  const { invoke: removeWorktree } = useIpcInvoke('workspace:remove-worktree')
  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: updateWorkspace } = useIpcInvoke('workspace:update')
  const { invoke: deleteWorkspace } = useIpcInvoke('workspace:delete')
  const { invoke: openWorkspaceFolder } = useIpcInvoke('workspace:open-folder')
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: getTempProjectDir } = useIpcInvoke('app:get-temp-project-dir')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

  const refreshTerminalActivity = useCallback(async () => {
    try {
      const res = await listActiveTerminals({})
      const sessions = Array.isArray(res.sessions) ? res.sessions : []
      setSessionTerminalActivity(
        Object.fromEntries(sessions.map((item) => [item.sessionId, item] as const)),
      )
    } catch (err) {
      console.warn('[terminal] list-active failed:', err)
    }
  }, [listActiveTerminals])

  const performRefresh = useCallback(async () => {
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
      setSelectedProviderId(
        (prev) =>
          prev ||
          getPreferredProvider(providerRes.profiles, readComposerPrefs(), DEFAULT_AGENT_ADAPTER)
            ?.id ||
          '',
      )
      setActiveWorkspaceId((prev) => currentRes.workspace?.id ?? prev ?? null)
      void refreshTerminalActivity()
    } catch (err) {
      console.error('Failed to refresh session data', err)
    }
  }, [
    getCurrentWorkspace,
    listAgents,
    listProviders,
    listSessions,
    listWorkspaces,
    refreshTerminalActivity,
  ])
  const refreshCoordinator = useMemo(
    () => createSingleFlightRefresh(performRefresh),
    [performRefresh],
  )
  const refreshData = useCallback(() => refreshCoordinator.run(), [refreshCoordinator])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshData().catch(console.error)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshData])

  // Real-time session queue state updates
  useEffect(() => {
    return (
      window.spark?.on?.('stream:session:queue-changed', (snapshot: SessionGetQueueResponse) => {
        setSessions((prev) =>
          prev.map((item) => {
            if (item.id !== snapshot.sessionId) return item
            if (snapshot.running)
              return item.status === 'running' ? item : { ...item, status: 'running' }
            return item.status === 'running' ? { ...item, status: 'idle' } : item
          }),
        )
      }) ?? (() => {})
    )
  }, [])

  // Real-time agent status tracking (waiting_permission / waiting_user)
  useEffect(() => {
    return (
      window.spark?.on?.('stream:session:agent-event', (event: AgentEvent) => {
        if (event.type !== 'agent_status') return
        const status = (event as { status: AgentStatusValue }).status
        const sessionId = event.sessionId
        const terminal =
          status === 'idle' ||
          status === 'completed' ||
          status === 'cancelled' ||
          status === 'error'
        setSessions((prev) =>
          prev.map((item) => {
            if (item.id !== sessionId) return item
            if (terminal) {
              return item.status === 'running' ? { ...item, status: 'idle' } : item
            }
            return item.status === 'running' ? item : { ...item, status: 'running' }
          }),
        )
        setSessionAgentStatuses((prev) => {
          const current = prev[sessionId]
          // Clear on terminal states
          if (terminal) {
            if (!current) return prev
            const { [sessionId]: _, ...rest } = prev
            return rest
          }
          // Only update if changed
          if (current === status) return prev
          return { ...prev, [sessionId]: status }
        })
        // Mark as unreviewed on completion (for the blue dot) — unless the user is already viewing it
        if (status === 'completed' && activeRef.current !== sessionId) {
          setUnreviewedCompleted((prev) => {
            if (prev.has(sessionId)) return prev
            const next = new Set(prev)
            next.add(sessionId)
            return next
          })
        }
      }) ?? (() => {})
    )
  }, [])

  // Real-time session title updates (async LLM rename after first turn)
  useEffect(() => {
    return (
      window.spark?.on?.(
        'stream:session:renamed',
        (payload: { sessionId: string; title: string }) => {
          setSessions((prev) =>
            prev.map((item) =>
              item.id === payload.sessionId ? { ...item, title: payload.title } : item,
            ),
          )
        },
      ) ?? (() => {})
    )
  }, [])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:session:created', ({ sessionId, session }) => {
        const typedSessionId = sessionId as SessionId
        if (session != null) upsertSessionInList(session)
        else void refreshCoordinator.invalidate().catch(console.error)
        if (!pendingCreatedWorkspaceIdsRef.current.has(typedSessionId)) return
        const workspaceId = pendingCreatedWorkspaceIdsRef.current.get(typedSessionId) ?? null
        pendingCreatedWorkspaceIdsRef.current.delete(typedSessionId)
        setActiveWorkspaceId(workspaceId)
      }) ?? (() => {})
    )
  }, [refreshCoordinator, upsertSessionInList])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:terminal:event', (event: TerminalStreamEvent) => {
        if (
          event.type === 'created' ||
          event.type === 'exit' ||
          event.type === 'removed' ||
          event.type === 'updated'
        ) {
          void refreshTerminalActivity()
        }
      }) ?? (() => {})
    )
  }, [refreshTerminalActivity])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        // team 配置变化由 ChatView 单独回读会话 metadata；这里若也全量 refresh，
        // 会把 activeWorkspaceId 再次用 workspace:get-current 覆盖，导致新建团队会话
        // 后项目选择器偶发跳回旧项目。
        if (event.scope === 'provider') {
          void listProviders({})
            .then((res) => {
              setProviders(res.profiles)
              setSelectedProviderId((prev) =>
                res.profiles.some((profile) => profile.id === prev)
                  ? prev
                  : (getPreferredProvider(
                      res.profiles,
                      readComposerPrefs(),
                      DEFAULT_AGENT_ADAPTER,
                    )?.id ?? ''),
              )
            })
            .catch(console.error)
        } else if (event.scope === 'agent') {
          void listAgents({})
            .then((res) => setAgents(Array.isArray(res.agents) ? res.agents : []))
            .catch(console.error)
        }
      }) ?? (() => {})
    )
  }, [listAgents, listProviders])

  useEffect(() => {
    if (active) window.localStorage.setItem(LAST_SESSION_KEY, active)
    else window.localStorage.removeItem(LAST_SESSION_KEY)
  }, [active])

  useEffect(() => {
    if (!active) {
      workspaceSyncedSessionRef.current = null
      return
    }
    if (sessions.length === 0) return
    const found = sessions.find((s) => s.id === active)
    if (justCreatedSessionRef.current === active) {
      // session:create 可能与一轮更早发起的 session:list 并行。Windows 上旧列表
      // 较晚返回时仍不包含新会话，不能因此清空刚激活的 active；只有权威列表
      // 真正包含该会话后，才结束这段保护期。
      if (found == null) return
      justCreatedSessionRef.current = null
    }
    const id = window.setTimeout(() => {
      if (!found) {
        workspaceSyncedSessionRef.current = null
        setActive(null)
      } else if (found.workspaceIds.length > 0) {
        // 会话工作区可能是 worktree——UI 当前项目解析为其 base 项目
        const first = found.workspaceIds[0]
        const ws = first != null ? workspaces.find((w) => w.id === first) : undefined
        const nextWorkspaceId = ws?.worktreeMeta?.baseWorkspaceId ?? first ?? null
        const manualSelection = manualWorkspaceSelectionRef.current
        const hasManualWorkspaceForActiveSession =
          manualSelection?.sessionId === active && manualSelection.workspaceId === activeWorkspaceId
        const shouldSyncWorkspace =
          activeWorkspaceId == null ||
          workspaceSyncedSessionRef.current !== active ||
          !hasManualWorkspaceForActiveSession
        workspaceSyncedSessionRef.current = active
        if (shouldSyncWorkspace && nextWorkspaceId !== activeWorkspaceId) {
          setActiveWorkspaceId(nextWorkspaceId)
        }
      }
    }, 0)
    return () => window.clearTimeout(id)
  }, [active, activeWorkspaceId, sessions, workspaces])

  const setActiveWorkspace = useCallback((workspaceId: string | null) => {
    manualWorkspaceSelectionRef.current = {
      sessionId: activeRef.current,
      workspaceId,
    }
    setActiveWorkspaceId(workspaceId)
  }, [])

  const updateSessionInList = useCallback(
    (sessionId: SessionId, patch: Partial<SessionSummary>) => {
      setSessions((prev) =>
        prev.map((item) => (item.id === sessionId ? { ...item, ...patch } : item)),
      )
    },
    [],
  )

  const bumpSessionMessageCount = useCallback((sessionId: SessionId) => {
    setSessions((prev) =>
      prev.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              turnCount: (item.turnCount ?? item.messageCount) + 1,
              logicalMessageCount: (item.logicalMessageCount ?? item.messageCount) + 1,
              messageCount: item.messageCount + 1,
            }
          : item,
      ),
    )
  }, [])

  const ensureNoProjectWorkspace = useCallback(async (): Promise<string | null> => {
    if (noProjectWorkspaceId) return noProjectWorkspaceId
    const existing = workspaces.find((w) => w.name === NO_PROJECT_WORKSPACE_NAME)
    if (existing) {
      setNoProjectWorkspaceId(existing.id)
      return existing.id
    }
    try {
      const { tempDir } = await getTempProjectDir({})
      const rootPath = getNoProjectRootPath(tempDir)
      const res = await openWorkspace({ create: { name: NO_PROJECT_WORKSPACE_NAME, rootPath } })
      setNoProjectWorkspaceId(res.workspace.id)
      setWorkspaces((prev) =>
        prev.some((w) => w.id === res.workspace.id) ? prev : [...prev, res.workspace],
      )
      return res.workspace.id
    } catch (err) {
      console.error('Create no-project workspace failed', err)
      toast.error(err instanceof Error ? err.message : t('session.noProjectCreateFailed'))
      return null
    }
  }, [getTempProjectDir, noProjectWorkspaceId, openWorkspace, toast, workspaces])

  const handleNewSession = useCallback(
    async (
      workspaceId: string | null = activeWorkspaceId,
      options: Record<string, unknown> = {},
    ): Promise<SessionId | null> => {
      try {
        let wsId = workspaceId
        // UI「当前项目」始终指向真实（base）项目；worktree 仅作为会话的后台 cwd，
        // 不应成为可选项目，否则会污染项目选择器、默认项目、分支切换等。
        let uiWorkspaceId = workspaceId
        if (wsId == null) {
          const noProjectId = await ensureNoProjectWorkspace()
          if (noProjectId == null) return null
          wsId = noProjectId
          uiWorkspaceId = noProjectId
          setActiveWorkspaceId(noProjectId)
        }

        // 勾选了「为本会话创建隔离 worktree」：创建 worktree workspace 并把会话绑定到它，
        // 但 UI 当前项目仍保持 base（uiWorkspaceId 不变）。
        // 注意放在 unusedSession 查找之前——新 worktree workspace 下必无可复用会话。
        // 分支名：用户显式填写则用之；否则交给 main 进程调用 LLM 按任务文本生成。
        if (options.createWorktree === true && wsId != null) {
          const explicitBranch = nonEmptyString(options.worktreeBranch)
          const taskText = nonEmptyString(options.worktreeTaskText)
          const providerProfileId = nonEmptyString(options.providerProfileId)
          const model = nonEmptyString(options.modelId)
          try {
            const res = await createWorktree({
              baseWorkspaceId: wsId,
              ...(explicitBranch ? { branch: explicitBranch } : {}),
              ...(taskText ? { taskText } : {}),
              ...(providerProfileId ? { providerProfileId } : {}),
              ...(model ? { model } : {}),
            })
            // 会话绑定 worktree workspace；UI 当前项目保持 base（不切到 worktree）。
            wsId = res.workspace.id
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t('session.worktreeCreateFailed'))
            return null
          }
        }

        const knownProviders = providers.length > 0 ? providers : (await listProviders({})).profiles
        if (providers.length === 0) setProviders(knownProviders)
        const prefs = readComposerPrefs()
        const optionAgentId = nonEmptyString(options.agentId)
        const prefsAgentId = nonEmptyString(prefs.agentId)
        const optionProviderProfileId = nonEmptyString(options.providerProfileId)
        const selectedProvider = nonEmptyString(selectedProviderId)
        const optionModelId = nonEmptyString(options.modelId)
        const defaultAgent = agents.find((a) => a.isDefault && a.enabled)
        const selectedAgent =
          agents.find((a) => a.id === optionAgentId) ??
          agents.find((a) => a.id === prefsAgentId) ??
          defaultAgent ??
          agents[0]
        const preferredAdapter =
          (options.agentAdapter as SessionAgentAdapter) ??
          prefs.adapter ??
          selectedAgent?.agentAdapter ??
          DEFAULT_AGENT_ADAPTER
        const selectedProviderProfile = knownProviders.find(
          (p) => p.id === selectedProvider && isProviderCompatibleWithAdapter(p, preferredAdapter),
        )
        const hasConcreteCompatibleProvider = knownProviders.some(
          (p) => !isAutoRouterProvider(p) && isProviderCompatibleWithAdapter(p, preferredAdapter),
        )
        const profile =
          knownProviders.find((p) => p.id === optionProviderProfileId) ??
          knownProviders.find(
            (p) =>
              p.id === selectedAgent?.providerProfileId &&
              isProviderCompatibleWithAdapter(p, preferredAdapter),
          ) ??
          (selectedProviderProfile != null &&
          (!isAutoRouterProvider(selectedProviderProfile) || !hasConcreteCompatibleProvider)
            ? selectedProviderProfile
            : undefined) ??
          getPreferredProvider(knownProviders, prefs, preferredAdapter)
        if (!profile) {
          void requestConfirm({
            title: t('session.needProvider.title'),
            description: t('session.needProvider.desc'),
            confirmText: t('common.ok'),
          })
          return null
        }
        const agentAdapter =
          (options.agentAdapter as SessionAgentAdapter) ??
          (selectedAgent?.providerProfileId === profile.id
            ? selectedAgent?.agentAdapter
            : undefined) ??
          getProviderAdapterKind(profile)
        const permissionMode =
          (options.permissionMode as SessionPermissionMode) ??
          selectedAgent?.permissionMode ??
          getValidPermissionMode(prefs.permissionMode, agentAdapter)
        const modelId = resolveModelForProvider(profile, [
          optionModelId,
          selectedAgent?.providerProfileId === profile.id
            ? nonEmptyString(selectedAgent.modelId)
            : undefined,
          prefs.providerProfileId === profile.id ? nonEmptyString(prefs.modelId) : undefined,
        ])
        const agentId =
          optionAgentId ?? nonEmptyString(selectedAgent?.id) ?? 'platform-manager-agent'
        const reasoningEffort =
          (options.reasoningEffort as SessionReasoningEffort) ?? prefs.reasoningEffort ?? 'medium'

        // 如果该项目下有未使用的会话（没有消息、未归档），直接复用。
        // 复用前必须把 provider/model/agent 等运行时同步到该空会话，否则 UI label
        // 可能靠 draft/prefs 兜底显示为新模型，但实际 session 仍保留旧 provider/model。
        const shouldReuseUnusedSession = options.forceNew !== true
        const unusedSession = shouldReuseUnusedSession
          ? sessions.find(
              (s) =>
                s.workspaceIds.includes(wsId!) &&
                (s.turnCount ?? s.messageCount) === 0 &&
                s.archivedAt == null,
            )
          : undefined
        if (unusedSession) {
          const updated = await updateSession({
            sessionId: unusedSession.id,
            providerProfileId: profile.id,
            modelId: modelId ?? null,
            agentId,
            agentAdapter,
            permissionMode,
            ...(options.chatMode !== undefined
              ? { chatMode: options.chatMode as SessionChatMode }
              : {}),
            reasoningEffort,
          })
          await persistTeamConfig({
            sessionId: unusedSession.id,
            config: resolveNewSessionTeamConfig(options.teamConfig, agentId),
          })
          updateSessionInList(unusedSession.id, updated.session)
          if (options.activate !== false) setActive(unusedSession.id)
          setSelectedProviderId(profile.id)
          setActiveWorkspaceId(uiWorkspaceId)
          writeComposerPrefs({
            adapter: agentAdapter,
            agentId,
            providerProfileId: profile.id,
            ...(modelId !== undefined ? { modelId } : {}),
            permissionMode,
            reasoningEffort,
          })
          // 复用「未使用」会话时，将其视为新会话：清空此前残留的输入草稿，
          // 避免用户切换/新建会话时旧输入内容仍残留在输入框。
          window.dispatchEvent(
            new CustomEvent('spark:composer:reset-draft', {
              detail: { sessionId: unusedSession.id },
            }),
          )
          return unusedSession.id
        }

        const res = await createSession({
          providerProfileId: profile.id,
          ...(modelId !== undefined ? { modelId } : {}),
          agentId,
          agentAdapter,
          permissionMode,
          ...(options.chatMode !== undefined
            ? { chatMode: options.chatMode as SessionChatMode }
            : {}),
          reasoningEffort,
          workspaceId: wsId,
        })
        if (res.session != null) upsertSessionInList(res.session)
        else void refreshCoordinator.invalidate().catch(console.error)
        justCreatedSessionRef.current = res.sessionId
        pendingCreatedWorkspaceIdsRef.current.set(res.sessionId, uiWorkspaceId)
        // 团队模式下创建会话：在激活（setActive→ChatView 重新加载 team 配置）之前，
        // 先把 team 配置落库到新会话 metadata。否则新会话被激活时 team:list-members 还读不到配置，
        // 会按「无 team 配置 = 单 agent」回退，导致团队会话短暂显示成单 agent（worktree 等路径）。
        const newTeamConfig = options.teamConfig as TeamModeConfig | undefined
        if (newTeamConfig != null && newTeamConfig.enabled) {
          await persistTeamConfig({ sessionId: res.sessionId, config: newTeamConfig }).catch(
            () => {},
          )
        }
        if (options.activate !== false) setActive(res.sessionId)
        setSelectedProviderId(profile.id)
        setActiveWorkspaceId(uiWorkspaceId)
        // 新建会话时清空输入草稿（包括 'draft:new' 与该会话 id 的 bucket），
        // 确保用户进入新会话时输入框是空的。
        window.dispatchEvent(
          new CustomEvent('spark:composer:reset-draft', {
            detail: { sessionId: res.sessionId },
          }),
        )
        writeComposerPrefs({
          adapter: agentAdapter,
          agentId,
          providerProfileId: profile.id,
          ...(modelId !== undefined ? { modelId } : {}),
          permissionMode,
          reasoningEffort,
        })
        return res.sessionId
      } catch (err) {
        console.error('Create session failed', err)
        toast.error(err instanceof Error ? err.message : t('session.createFailed'))
        return null
      }
    },
    [
      activeWorkspaceId,
      agents,
      createSession,
      createWorktree,
      ensureNoProjectWorkspace,
      listProviders,
      persistTeamConfig,
      providers,
      requestConfirm,
      selectedProviderId,
      sessions,
      toast,
      updateSession,
      updateSessionInList,
      upsertSessionInList,
    ],
  )

  // 用户从系统托盘菜单触发「新建会话」：走 renderer 标准新建流程（含 worktree 复用 / 草稿清空等）。
  // 主进程在发送事件前已展示主窗口，这里只负责新建。
  useEffect(() => {
    return (
      window.spark?.on?.('stream:tray:new-session', () => {
        handleNewSession().catch((err) => console.error('Tray new-session failed', err))
      }) ?? (() => {})
    )
  }, [handleNewSession])

  // 用户从系统托盘菜单点击某条最近会话：刷新数据后切到该会话。
  // 主进程在发送事件前已展示主窗口，这里只负责切换 active。
  useEffect(() => {
    return (
      window.spark?.on?.('stream:tray:open-session', (payload: { sessionId: string }) => {
        refreshData()
          .then(() => setActive(payload.sessionId as SessionId))
          .catch((err) => console.error('Tray open-session failed', err))
      }) ?? (() => {})
    )
  }, [refreshData])

  // Search
  const searchSessions = useCallback(
    async (query: string): Promise<SessionSearchResult[]> => {
      try {
        const res = await searchSessionsRpc({ query, limit: 20 })
        return res.results
      } catch {
        return []
      }
    },
    [searchSessionsRpc],
  )

  // Project dialog
  const handlePickProjectPath = useCallback(async () => {
    try {
      const selected = await openDirectoryDialog({ title: t('project.chooseOrCreateFolder') })
      if (selected.canceled || selected.filePath == null) return
      setProjectPath(selected.filePath)
      if (!projectName.trim()) setProjectName(getBasename(selected.filePath))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('project.choosePathFailed'))
    }
  }, [openDirectoryDialog, projectName, toast])

  const handleCreateProject = useCallback(
    async (useTempDir = false) => {
      let rootPath = projectPath.trim()
      const name = projectName.trim() || getBasename(rootPath) || t('project.newProject')
      if (useTempDir || !rootPath) {
        try {
          const { tempDir } = await getTempProjectDir({})
          const timestamp = Date.now()
          const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_') || 'project'
          rootPath = `${tempDir}/${safeName}-${timestamp}`
        } catch (err) {
          console.error('Failed to get temp dir', err)
          toast.error(t('project.tempDirFailed'))
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
        toast.success(t('project.createdAt', { path: rootPath }))
        await handleNewSession(res.workspace.id)
        await refreshData()
      } catch (err) {
        console.error('Create project failed', err)
        toast.error(err instanceof Error ? err.message : t('project.createFailed'))
      }
    },
    [
      getTempProjectDir,
      handleNewSession,
      openWorkspace,
      projectName,
      projectPath,
      refreshData,
      toast,
    ],
  )

  // Project actions
  const handleRenameProject = useCallback(
    async (workspace: WorkspaceInfo) => {
      const name = (
        await requestPrompt({
          title: t('project.renameTitle'),
          value: workspace.name,
          placeholder: t('project.namePlaceholder'),
          confirmText: t('common.rename'),
        })
      )?.trim()
      if (!name || name === workspace.name) return
      try {
        await updateWorkspace({ workspaceId: workspace.id, name })
        await refreshData()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('project.renameFailed'))
      }
    },
    [refreshData, requestPrompt, toast, updateWorkspace],
  )

  const handleToggleProjectPinned = useCallback(
    async (workspace: WorkspaceInfo) => {
      try {
        await updateWorkspace({ workspaceId: workspace.id, pinned: workspace.pinnedAt == null })
        await refreshData()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('project.pinUpdateFailed'))
      }
    },
    [refreshData, toast, updateWorkspace],
  )

  const handleArchiveProject = useCallback(
    async (workspace: WorkspaceInfo) => {
      const confirmed = await requestConfirm({
        title: t('project.archiveTitle', { name: workspace.name }),
        description: t('project.archiveDesc'),
        confirmText: t('common.archive'),
      })
      if (!confirmed) return
      try {
        await updateWorkspace({ workspaceId: workspace.id, archived: true })
        if (activeWorkspaceId === workspace.id) {
          setActiveWorkspaceId(null)
          setActive(null)
        }
        await refreshData()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('project.archiveFailed'))
      }
    },
    [activeWorkspaceId, refreshData, requestConfirm, toast, updateWorkspace],
  )

  const handleDeleteProject = useCallback(
    async (workspace: WorkspaceInfo) => {
      const confirmed = await requestConfirm({
        title: t('common.confirm'),
        description: t('project.deleteDesc', { name: workspace.name }),
        confirmText: t('common.delete'),
        danger: true,
      })
      if (!confirmed) return
      const previousWorkspaces = workspaces
      const previousSessions = sessions
      const nextSessions = sessions.filter(
        (session) => !session.workspaceIds.includes(workspace.id),
      )
      const nextWorkspaces = workspaces.filter((item) => item.id !== workspace.id)
      const shouldClearActive =
        activeWorkspaceId === workspace.id ||
        (active != null &&
          previousSessions.some(
            (session) => session.id === active && session.workspaceIds.includes(workspace.id),
          ))
      try {
        setWorkspaces(nextWorkspaces)
        setSessions(nextSessions)
        if (shouldClearActive) {
          setActiveWorkspaceId(null)
          setActive(null)
        }
        const res = await deleteWorkspace({ workspaceId: workspace.id })
        if (!res.deleted) {
          throw new Error(t('project.deleteFailed'))
        }
        void refreshData()
      } catch (err) {
        setWorkspaces(previousWorkspaces)
        setSessions(previousSessions)
        if (shouldClearActive) {
          setActiveWorkspaceId(activeWorkspaceId)
          setActive(active)
        }
        toast.error(err instanceof Error ? err.message : t('project.deleteFailed'))
      }
    },
    [
      active,
      activeWorkspaceId,
      deleteWorkspace,
      refreshData,
      requestConfirm,
      sessions,
      t,
      toast,
      workspaces,
    ],
  )

  const handleOpenProjectFolder = useCallback(
    async (workspace: WorkspaceInfo) => {
      try {
        await openWorkspaceFolder({ workspaceId: workspace.id })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('project.openFolderFailed'))
      }
    },
    [openWorkspaceFolder, toast],
  )

  const handleOpenWorkspace = useCallback(
    async (workspace: WorkspaceInfo) => {
      try {
        await openWorkspace({ rootPath: workspace.rootPath })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('project.openFailed'))
      }
    },
    [openWorkspace, toast],
  )

  // Session actions
  const handleToggleSessionPinned = useCallback(
    async (session: SessionSummary) => {
      const existing = pinMutationsRef.current.get(session.id)
      if (existing) {
        existing.desiredPinned = !existing.desiredPinned
        updateSessionInList(session.id, {
          pinnedAt: existing.desiredPinned ? new Date().toISOString() : null,
        })
        return
      }

      const state = {
        desiredPinned: session.pinnedAt == null,
        confirmedPinnedAt: session.pinnedAt,
        running: true,
      }
      pinMutationsRef.current.set(session.id, state)
      updateSessionInList(session.id, {
        pinnedAt: state.desiredPinned ? new Date().toISOString() : null,
      })

      while (state.running) {
        const requestedPinned = state.desiredPinned
        try {
          const updated = await updateSession({ sessionId: session.id, pinned: requestedPinned })
          state.confirmedPinnedAt = updated.session.pinnedAt
          if (state.desiredPinned === requestedPinned) {
            state.running = false
            pinMutationsRef.current.delete(session.id)
            updateSessionInList(session.id, updated.session)
          }
        } catch (err) {
          const confirmedPinned = state.confirmedPinnedAt != null
          if (state.desiredPinned === requestedPinned || state.desiredPinned === confirmedPinned) {
            state.running = false
            pinMutationsRef.current.delete(session.id)
            updateSessionInList(session.id, { pinnedAt: state.confirmedPinnedAt })
          }
          toast.error(err instanceof Error ? err.message : t('session.pinUpdateFailed'))
        }
      }
    },
    [toast, updateSession, updateSessionInList],
  )

  const handleRenameSession = useCallback(
    async (session: SessionSummary) => {
      const title = (
        await requestPrompt({
          title: t('session.renameTitle'),
          value: session.title ?? '',
          placeholder: t('session.titlePlaceholder'),
          confirmText: t('common.rename'),
        })
      )?.trim()
      if (!title || title === (session.title ?? '')) return
      try {
        const updated = await updateSession({ sessionId: session.id, title })
        updateSessionInList(session.id, updated.session)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('session.renameFailed'))
      }
    },
    [requestPrompt, toast, updateSession, updateSessionInList],
  )

  const handleDeleteSession = useCallback(
    async (session: SessionSummary) => {
      const confirmed = await requestConfirm({
        title: t('common.confirm'),
        description: t('session.deleteDesc', { title: session.title ?? t('session.untitled') }),
        confirmText: t('common.delete'),
        danger: true,
      })
      if (!confirmed) return
      // 若该会话工作区是 worktree，额外询问是否清理 worktree 及其分支
      const wsId = session.workspaceIds[0]
      const ws = wsId != null ? workspaces.find((w) => w.id === wsId) : undefined
      let cleanupWorktree = false
      if (ws?.worktreeMeta != null) {
        cleanupWorktree = await requestConfirm({
          title: t('worktree.cleanupTitle'),
          description: t('worktree.cleanupDesc', { branch: ws.worktreeMeta.branch }),
          confirmText: t('worktree.deleteTogether'),
          danger: true,
        })
      }
      const previousSessions = sessions
      const previousWorkspaces = workspaces
      const nextSessions = sessions.filter((item) => item.id !== session.id)
      const shouldRemoveWorkspace =
        cleanupWorktree &&
        wsId != null &&
        sessions.filter((item) => item.workspaceIds.includes(wsId)).length <= 1
      const nextWorkspaces =
        shouldRemoveWorkspace && wsId != null
          ? workspaces.filter((item) => item.id !== wsId)
          : workspaces
      const shouldClearActiveWorkspace =
        wsId != null && activeWorkspaceId === wsId && shouldRemoveWorkspace
      try {
        setSessions(nextSessions)
        if (shouldRemoveWorkspace) setWorkspaces(nextWorkspaces)
        if (active === session.id) setActive(null)
        if (shouldClearActiveWorkspace) setActiveWorkspaceId(null)
        await deleteSession({ sessionId: session.id })
        if (cleanupWorktree && wsId != null) {
          await removeWorktree({ workspaceId: wsId, force: true }).catch((err) => {
            toast.error(err instanceof Error ? err.message : t('worktree.deleteFailed'))
          })
        }
      } catch (err) {
        setSessions(previousSessions)
        if (shouldRemoveWorkspace) setWorkspaces(previousWorkspaces)
        if (active === session.id) setActive(active)
        if (shouldClearActiveWorkspace) setActiveWorkspaceId(activeWorkspaceId)
        toast.error(err instanceof Error ? err.message : t('session.deleteFailed'))
      }
    },
    [
      active,
      activeWorkspaceId,
      deleteSession,
      removeWorktree,
      requestConfirm,
      sessions,
      t,
      toast,
      workspaces,
    ],
  )

  const handleClearSessions = useCallback(
    async (sessions: SessionSummary[]) => {
      const total = sessions.length
      const targets = sessions.filter((s) => !isSessionActive(s.id, sessionAgentStatuses))
      const skipped = total - targets.length
      if (targets.length === 0) {
        toast.info(t('session.clearAllNone'))
        return
      }
      const confirmed = await requestConfirm({
        title: t('common.confirm'),
        description: t('session.clearAllDesc', { count: targets.length }),
        confirmText: t('session.clearAllConfirm'),
        danger: true,
      })
      if (!confirmed) return
      const results = await Promise.allSettled(
        targets.map((s) => deleteSession({ sessionId: s.id })),
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      const deletedIds = new Set<string>()
      targets.forEach((target, i) => {
        if (results[i]?.status === 'fulfilled') deletedIds.add(target.id)
      })
      if (active != null && deletedIds.has(active)) setActive(null)
      setSessions((current) => current.filter((session) => !deletedIds.has(session.id)))
      if (failed === 0) {
        toast.success(t('session.clearAllDone', { count: targets.length }))
      } else if (failed === targets.length) {
        toast.error(t('session.clearAllFailed'))
      } else {
        toast.warning(t('session.clearAllPartial', { failed }))
      }
      if (skipped > 0) {
        toast.info(t('session.clearAllSkipped', { count: skipped }))
      }
    },
    [active, deleteSession, requestConfirm, sessionAgentStatuses, toast],
  )

  const handleArchiveSession = useCallback(
    async (session: SessionSummary) => {
      try {
        await updateSession({ sessionId: session.id, archived: true })
        setSessions((current) => current.filter((item) => item.id !== session.id))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('session.archiveFailed'))
      }
    },
    [toast, updateSession],
  )

  const handleOpenSessionFolder = useCallback(
    async (session: SessionSummary) => {
      const workspaceId = session.workspaceIds[0]
      if (workspaceId == null) {
        return // no workspace associated
      }
      try {
        await openWorkspaceFolder({ workspaceId })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('project.openFolderFailed'))
      }
    },
    [openWorkspaceFolder, toast],
  )

  // Computed
  const projectGroups = useMemo(
    () => buildProjectGroups(workspaces, sessions),
    [sessions, workspaces],
  )

  const noProjectWorkspace = useMemo(
    () => workspaces.find((w) => w.name === NO_PROJECT_WORKSPACE_NAME) ?? null,
    [workspaces],
  )

  const noProjectSessions = useMemo(
    () =>
      noProjectWorkspace
        ? sessions.filter((s) => s.workspaceIds.includes(noProjectWorkspace.id))
        : [],
    [noProjectWorkspace, sessions],
  )

  const ungroupedSessions = useMemo(
    () => sessions.filter((s) => s.workspaceIds.length === 0),
    [sessions],
  )

  const value = useMemo<SessionSidebarCtx>(
    () => ({
      sessions,
      workspaces,
      providers,
      agents,
      activeSessionId: active,
      activeWorkspaceId,
      setActiveSession: setActive,
      setActiveWorkspace,
      sessionAgentStatuses,
      sessionTerminalActivity,
      unreviewedCompletedSessions: unreviewedCompleted,
      projectGroups,
      noProjectWorkspace,
      noProjectSessions,
      ungroupedSessions,
      refreshData,
      updateSessionInList,
      bumpSessionMessageCount,
      handleNewSession,
      handleToggleSessionPinned,
      handleRenameSession,
      handleDeleteSession,
      handleClearSessions,
      handleArchiveSession,
      handleOpenSessionFolder,
      handleToggleProjectPinned,
      handleRenameProject,
      handleArchiveProject,
      handleDeleteProject,
      handleOpenProjectFolder,
      handleOpenWorkspace,
      handleCreateProject,
      handlePickProjectPath,
      projectDialog,
      setProjectDialog,
      projectName,
      setProjectName,
      projectPath,
      setProjectPath,
      projectNotice,
      searchSessions,
      ensureNoProjectWorkspace,
      justCreatedSessionRef,
      selectedProviderId,
      setSelectedProviderId,
      historyImportOpen,
      setHistoryImportOpen,
    }),
    [
      sessions,
      workspaces,
      providers,
      agents,
      active,
      activeWorkspaceId,
      setActiveWorkspace,
      sessionAgentStatuses,
      sessionTerminalActivity,
      unreviewedCompleted,
      projectGroups,
      noProjectWorkspace,
      noProjectSessions,
      ungroupedSessions,
      refreshData,
      updateSessionInList,
      bumpSessionMessageCount,
      handleNewSession,
      handleToggleSessionPinned,
      handleRenameSession,
      handleDeleteSession,
      handleClearSessions,
      handleArchiveSession,
      handleOpenSessionFolder,
      handleToggleProjectPinned,
      handleRenameProject,
      handleArchiveProject,
      handleDeleteProject,
      handleOpenProjectFolder,
      handleOpenWorkspace,
      handleCreateProject,
      handlePickProjectPath,
      projectDialog,
      projectName,
      projectPath,
      projectNotice,
      searchSessions,
      ensureNoProjectWorkspace,
      selectedProviderId,
      historyImportOpen,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSessionSidebar(): SessionSidebarCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSessionSidebar must be inside <SessionSidebarProvider>')
  return v
}
