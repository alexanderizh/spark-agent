/**
 * ChatView — 真实 IPC 驱动的会话视图
 *
 * NOTE: Session sidebar has been moved to the primary FloatingSidebar.
 * This component only renders the main chat area (hero/composer/stream).
 * Session/workspace/provider data is read from SessionSidebarContext.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import {
  useSessionSidebar,
  type SessionSummary,
  NO_PROJECT_WORKSPACE_NAME,
} from '../SessionSidebarContext'
import {
  ErrorCard,
  FilePermCard,
  NetPermCard,
  MCPPermCard,
  HunkDiff,
  PlanCard,
  SubagentCard,
  Checkpoint,
  SandboxNote,
  QuickActions,
  ToolChooser,
  TurnFileSummaryCard,
} from '../ChatInteractions'
import { SparkInput, SparkTextarea } from '../components/FormControls'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { MarkdownImage } from '../components/MarkdownImage'
import { TeamDispatchCard } from '../components/TeamDispatchCard'
import { TeamMemberBubble } from '../components/TeamMemberBubble'
import { TeamInspectorSection } from '../components/TeamInspectorSection'
import { TeamMemberDrawer } from '../components/TeamMemberDrawer'
import { MentionPopover, type MentionCandidate } from '../components/MentionPopover'
import { AvatarImage } from '../components/AvatarImage'
import { SkillsPickerModal } from '../components/SkillsPickerModal'
import { SidebarExpandButton } from '../SidebarExpandButton'
import { CODING_AGENT_TOOLS } from '../data/available-tools'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useAppearanceSettings, readAppearance } from '../hooks/useAppearance'
import { MessageBuilder } from '../services/event-mapper'
import { useToast } from '../components/Toast'
import { parseSkillManifest } from '../utils/skills-data'
import { getAgentAvatarConfig, getUserAvatarConfig, resolveAvatarSrc } from '../avatar'
import type { UIMessage, UIBlock, FileChangeSummary } from '../services/event-mapper'
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
  SessionGetQueueResponse,
  SkillConfigGetResponse,
  WorkspaceInfo,
  CommandListItem,
  TurnPromptSnapshotEvent,
  ManagedAgent,
  ManagedTeam,
  SessionAttachment,
  UserQuestionPrompt,
  UserQuestionOption,
  TeamModeConfig,
  TeamMemberEventContext,
} from '@spark/protocol'
import { resolveProviderContextWindow } from '@spark/shared'

const SETTINGS_GENERAL_KEY = 'spark-settings-general'

type BranchState = { currentBranch: string | null; branches: string[] }
type AgentAdapter = SessionAgentAdapter
type PermissionModeChoice = SessionPermissionMode
type ComposerOptionTone = 'default' | 'auto' | 'danger'
type ComposerMenuOption = {
  value: string
  label: string
  description?: string
  tone?: ComposerOptionTone
}
type ComposerPrefs = {
  adapter?: AgentAdapter
  providerProfileId?: string
  modelId?: string
  permissionMode?: PermissionModeChoice
  reasoningEffort?: SessionReasoningEffort
  agentId?: string
  /** Team Mode：是否启用团队模式（设计文档 §5.1 持久化到 composer-prefs） */
  teamMode?: boolean
  /** Team Mode：上次使用的 Host Agent */
  teamHostAgentId?: string
  /** Team Mode：上次勾选的成员 Agent */
  teamMemberAgentIds?: string[]
}

type SessionRuntimePatch = {
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  agentAdapter?: AgentAdapter
  permissionMode?: PermissionModeChoice
  chatMode?: SessionChatMode
  reasoningEffort?: SessionReasoningEffort
}
type QueuedMessage = { id: string; turnId: string; content: string; enqueuedAt: string }
type ComposerAttachment = SessionAttachment & {
  id: string
  name: string
  previewPath?: string
  previewUrl?: string
}
type ComposerDraftSnapshot = {
  value: string
  attachments: ComposerAttachment[]
  manualExpanded: boolean
}
const EMPTY_COMPOSER_DRAFT: ComposerDraftSnapshot = {
  value: '',
  attachments: [],
  manualExpanded: false,
}
type MessageAttachment = {
  type: 'image' | 'file'
  path: string
  name?: string
}
type UserQuestionData = {
  questionId: string
  sessionId: string
  questions: UserQuestionPrompt[]
}
type UserQuestionDraft = {
  skipped?: boolean
  selectedLabel?: string
  selectedValue?: string
  otherText?: string
  text?: string
}
type ContextMenuItem = {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}
type TextEditMenuState = {
  x: number
  y: number
  target: HTMLTextAreaElement | HTMLInputElement
  hasSelection: boolean
  isEditable: boolean
}
type ChatViewProps = {
  approvalRequest?: PermissionApprovalRequest | null
  onApprovalClose?: (sessionId: string, requestId?: string) => void
  userQuestion?: UserQuestionData | null
  onUserQuestionClose?: (sessionId: string, questionId?: string) => void
}

const SAFE_FILE_SCHEME = 'safe-file'

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

/** Snapshot from SDK context_usage event */
type ContextUsageState = {
  estimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  compactedThisTurn: boolean
}
type ProjectContextState = Extract<AgentEvent, { type: 'project_context_loaded' }>

const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'
const COMPOSER_DRAFTS_KEY = 'spark-agent:composer-drafts'
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'
const SESSION_HISTORY_PAGE_SIZE = 500
const EMPTY_PROMPT_LAYER: PromptConfigGetResponse['system'] = { enabled: false, content: '' }

/**
 * Cache for AskUserQuestion answers submitted by the user.
 * Keyed by all question texts joined with NUL.
 * Populated when the user clicks Submit in the dock, consumed by
 * InlineQuestionCard as a fallback when the CLI tool_result output
 * can't be parsed into structured answer summaries.
 */
const questionAnswerCache = new Map<string, Array<{ question: string; answer: string; skipped?: boolean }>>()

export function ChatView({
  approvalRequest = null,
  onApprovalClose,
  userQuestion = null,
  onUserQuestionClose,
}: ChatViewProps = {}) {
  const { t } = useApp()
  const appearance = useAppearanceSettings()
  // ── Shared state from SessionSidebarContext ──
  const sessionCtx = useSessionSidebar()
  const active = sessionCtx.activeSessionId
  const activeWorkspaceId = sessionCtx.activeWorkspaceId
  const setActiveWorkspaceId = sessionCtx.setActiveWorkspace
  // Read data lists from context (single source of truth)
  const sessions = sessionCtx.sessions
  const workspaces = sessionCtx.workspaces
  const providers = sessionCtx.providers
  const agents = sessionCtx.agents
  const selectedProviderId = sessionCtx.selectedProviderId
  const setSelectedProviderId = sessionCtx.setSelectedProviderId

  // ── Local UI/runtime state ──
  const [showInspector, setShowInspector] = useState(false)
  const [showConfigPanel, setShowConfigPanel] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(360)
  // Team Mode 配置。
  // 双层持久化（设计文档 §5.1）：
  //   - composer-prefs(localStorage)：全局「上次使用」默认，新会话/无会话时回落。
  //   - sessions.metadata.team(IPC team:update)：会话级权威来源，Phase 3 运行时读取。
  const { invoke: persistTeamConfig } = useIpcInvoke('team:update')
  const { invoke: listTeamMembers } = useIpcInvoke('team:list-members')
  const defaultTeamConfig = useCallback((): TeamModeConfig => {
    const prefs = readComposerPrefs()
    return {
      enabled: prefs.teamMode ?? false,
      hostAgentId: prefs.teamHostAgentId ?? prefs.agentId ?? 'code-agent',
      memberAgentIds: prefs.teamMemberAgentIds ?? [],
      maxDepth: 1,
      allowNesting: false,
    }
  }, [])
  const [teamConfig, setTeamConfig] = useState<TeamModeConfig>(defaultTeamConfig)
  const updateTeamConfig = useCallback(
    (patch: Partial<TeamModeConfig>) => {
      setTeamConfig((prev) => {
        const next = { ...prev, ...patch }
        writeComposerPrefs({
          teamMode: next.enabled,
          teamHostAgentId: next.hostAgentId,
          teamMemberAgentIds: next.memberAgentIds,
        })
        // 有活跃会话时，把配置写入该会话 metadata（供运行时与重开会话恢复）
        if (active != null) {
          void persistTeamConfig({ sessionId: active as SessionId, config: next }).catch(() => {})
        }
        return next
      })
    },
    [active, persistTeamConfig],
  )
  // 切换 active session 时从 metadata 拉取会话级 team config 回显；
  // 历史团队会话能正常恢复底部参数与右侧 Inspector 的团队信息。
  useEffect(() => {
    if (active == null) {
      setTeamConfig(defaultTeamConfig())
      return
    }
    let cancelled = false
    void listTeamMembers({ sessionId: active as SessionId })
      .then((res) => {
        if (cancelled) return
        if (res.config != null) setTeamConfig(res.config)
        else setTeamConfig(defaultTeamConfig())
      })
      .catch(() => {
        if (!cancelled) setTeamConfig(defaultTeamConfig())
      })
    return () => {
      cancelled = true
    }
  }, [active, listTeamMembers, defaultTeamConfig])
  const [agentStatus, setAgentStatus] = useState('')
  const [composerFocusTrigger, setComposerFocusTrigger] = useState(0)
  const chatAreaRef = useRef<HTMLDivElement | null>(null)
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
  const [projectContext, setProjectContext] = useState<ProjectContextState | null>(null)
  const [proposedPlan, setProposedPlan] = useState<string | null>(null)
  const [turnPromptSnapshots, setTurnPromptSnapshots] = useState<TurnPromptSnapshotEvent[]>([])
  const [branchState, setBranchState] = useState<BranchState>({ currentBranch: null, branches: [] })
  const [clearTrigger, setClearTrigger] = useState(0)
  const { toast } = useToast()

  // ── IPC hooks (only those NOT duplicated in context) ──
  const { invoke: clearEvents } = useIpcInvoke('session:clear-events')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: cancelSessionTurn } = useIpcInvoke('session:cancel')
  const { invoke: listBranches } = useIpcInvoke('workspace:list-branches')
  const { invoke: switchBranch } = useIpcInvoke('workspace:switch-branch')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

  const { invoke: answerQuestion } = useIpcInvoke('session:answer-question')

  const handleAnswerQuestion = useCallback(
    async (answers: Record<string, unknown>) => {
      if (userQuestion == null) return
      // Build answer summaries from the submitted answers so the
      // InlineQuestionCard can display them immediately, before the
      // tool_result event arrives from the CLI.
      const rawList = Array.isArray(answers.answers) ? answers.answers : []
      const summaries = userQuestion.questions
        .map((q, i) => {
          const raw = rawList[i] as Record<string, unknown> | undefined
          if (raw == null || typeof raw !== 'object') return null
          const text =
            typeof raw.answer === 'string'
              ? raw.answer
              : typeof raw.text === 'string'
                ? raw.text
                : ''
          if (!text && raw.skipped !== true) return null
          return {
            question: q.question,
            answer: text,
            ...(raw.skipped === true ? { skipped: true } : {}),
          }
        })
        .filter(
          (item): item is { question: string; answer: string; skipped?: boolean } =>
            item != null,
        )
      if (summaries.length > 0) {
        questionAnswerCache.set(
          userQuestion.questions.map((q) => q.question).join('\0'),
          summaries,
        )
      }
      await answerQuestion({ questionId: userQuestion.questionId, answers })
      onUserQuestionClose?.(userQuestion.sessionId, userQuestion.questionId)
    },
    [answerQuestion, onUserQuestionClose, userQuestion],
  )

  const handleCancelQuestion = useCallback(() => {
    if (userQuestion == null) return
    answerQuestion({
      questionId: userQuestion.questionId,
      answers: buildQuestionCancelAnswer(userQuestion.questions),
    }).catch(console.error)
    onUserQuestionClose?.(userQuestion.sessionId, userQuestion.questionId)
  }, [answerQuestion, onUserQuestionClose, userQuestion])

  // ── Session status updates via context ──
  const setSessionStatus = useCallback((sessionId: SessionId, status: SessionSummary['status']) => {
    sessionCtx.updateSessionInList(sessionId, { status })
  }, [sessionCtx])

  // ── Handlers ──
  const handleClearMessages = useCallback(() => {
    if (!active) return
    clearEvents({ sessionId: active })
      .then(() => {
        setClearTrigger((prev) => prev + 1)
        sessionCtx.refreshData().catch(console.error)
      })
      .catch(console.error)
  }, [active, clearEvents, sessionCtx])

  const pickProjectFolder = useCallback(async () => {
    try {
      const selected = await openDirectoryDialog({ title: '选择项目文件夹' })
      if (selected.canceled || selected.filePath == null) return
      const res = await openWorkspace({ rootPath: selected.filePath })
      setActiveWorkspaceId(res.workspace.id)
      await sessionCtx.refreshData()
    } catch (err) {
      console.error('选择项目文件夹失败', err)
      toast.error(err instanceof Error ? err.message : '选择项目文件夹失败')
    }
  }, [openDirectoryDialog, openWorkspace, sessionCtx, setActiveWorkspaceId, toast])

  const switchToWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
  }, [setActiveWorkspaceId])

  const handleCancelSession = useCallback(
    async (sessionId: SessionId) => {
      try {
        const res = await cancelSessionTurn({ sessionId })
        setAgentStatus('')
        setSessionStatus(sessionId, 'idle')
        await sessionCtx.refreshData()
        if (res.cancelled) toast.success('已停止会话')
        else toast.info('该会话当前没有运行中的任务')
      } catch (err) {
        console.error('停止会话失败', err)
        toast.error(err instanceof Error ? err.message : '停止会话失败')
      }
    },
    [cancelSessionTurn, sessionCtx, setSessionStatus, toast],
  )

  // ── Computed values ──
  const activeSession = sessions.find((s) => s.id === active) ?? null
  const activeWorkspace =
    activeWorkspaceId == null
      ? null
      : (workspaces.find((item) => item.id === activeWorkspaceId) ?? null)
  const activeProvider = providers.find((item) => item.id === activeSession?.providerProfileId)
  const activeProviderContextWindow = resolveProviderContextWindow(
    activeProvider?.supportsMillionContext === true,
  )
  const showEmptyHero = active == null || activeMessages.length === 0

  useEffect(() => {
    if (activeSession?.providerProfileId) {
      setSelectedProviderId(activeSession.providerProfileId)
    }
  }, [activeSession?.providerProfileId, setSelectedProviderId])

  useEffect(() => {
    if (activeWorkspaceId == null) {
      setBranchState({ currentBranch: null, branches: [] })
      return
    }
    let cancelled = false
    listBranches({ workspaceId: activeWorkspaceId })
      .then((res) => { if (!cancelled) setBranchState(res) })
      .catch(() => { if (!cancelled) setBranchState({ currentBranch: null, branches: [] }) })
    return () => { cancelled = true }
  }, [activeWorkspaceId, listBranches])

  // Listen for Ctrl/Cmd+L focus-composer event from global shortcut handler
  useEffect(() => {
    const handler = () => {
      // Scroll chat area to bottom
      const scrollEl = chatAreaRef.current?.querySelector('.chat-stream')
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
      // Trigger composer focus (increment counter → ComposerV2 reacts)
      setComposerFocusTrigger((n) => n + 1)
    }
    window.addEventListener('spark:focus-composer', handler)
    return () => window.removeEventListener('spark:focus-composer', handler)
  }, [])

  const handleUpdateActiveSession = async (patch: SessionRuntimePatch) => {
    if (active == null) return
    const res = await updateSession({ sessionId: active, ...patch })
    sessionCtx.updateSessionInList(active, res.session)
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
    <div className={`chat-layout chat-layout-no-sidebar${teamConfig.enabled ? ' team-mode-active' : ''}`}>

      <div className={`chat-main ${showEmptyHero ? 'chat-main-empty' : 'chat-main-active'}`} ref={chatAreaRef}>
        {showEmptyHero && (
          <div
            className="chat-sidebar-topbar"
            onDoubleClick={() => { window.spark.invoke('window:maximize', {}).catch(() => {}) }}
          >
            {t.sidebarHidden && <SidebarExpandButton />}
          </div>
        )}
        {showEmptyHero && <div className="chat-hero-grid" aria-hidden="true" />}
        {showEmptyHero && (
          <h1 className="chat-hero-title">Spark Agent，ready to do something！</h1>
        )}

        {active == null ? (
          <div className="chat-hero-composer">
            <ComposerV2
              session={activeSession}
              workspace={activeWorkspace}
              providers={providers}
              agents={agents}
              selectedProviderId={selectedProviderId}
              setSelectedProviderId={setSelectedProviderId}
              branchState={branchState}
              contextInputTokens={contextInputTokens}
              contextUsage={contextUsage}
              isWorking={activeSession?.status === 'running'}
              approvalRequest={approvalRequest}
              {...(onApprovalClose !== undefined ? { onApprovalClose } : {})}
              onCreateSession={(options) => sessionCtx.handleNewSession(activeWorkspaceId, options as Record<string, unknown>)}
              onUpdateSession={handleUpdateActiveSession}
              onCommandComplete={(summary) => { sessionCtx.updateSessionInList(summary.id, summary) }}
              onSwitchBranch={handleSwitchBranch}
              onCancelSession={handleCancelSession}
              onSent={(sessionId) => { setSessionStatus(sessionId, 'running') }}
              showProjectPicker
              focusTrigger={composerFocusTrigger}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onPickProject={pickProjectFolder}
              onUseNoProject={() => void sessionCtx.ensureNoProjectWorkspace().then(id => { if (id) setActiveWorkspaceId(id) })}
              onSwitchWorkspace={switchToWorkspace}
              teamConfig={teamConfig}
              onChangeTeamConfig={updateTeamConfig}
              onOpenTeamInspector={() => setShowInspector(true)}
            />
          </div>
        ) : (
          <>
            {!showEmptyHero && (
              <ChatTabbar
                session={activeSession}
                workspace={activeWorkspace}
                agentStatus={agentStatus}
                showInspector={showInspector}
                setShowInspector={(v: boolean) => { setShowInspector(v); if (v) setShowConfigPanel(false) }}
                showConfigPanel={showConfigPanel}
                setShowConfigPanel={(v: boolean) => { setShowConfigPanel(v); if (v) setShowInspector(false) }}
                {...(active ? { onClearMessages: handleClearMessages } : {})}
              />
            )}
            <ChatStream
              sessionId={active}
              onStatusChange={setAgentStatus}
              onUsageChange={setContextInputTokens}
              onUsageDataChange={setSessionUsageData}
              onMessagesChange={setActiveMessages}
              onSessionStatusChange={(status) => { setSessionStatus(active, status) }}
              onContextUsageChange={setContextUsage}
              onProjectContextChange={setProjectContext}
              onPlanProposed={setProposedPlan}
              onTurnPromptSnapshotsChange={setTurnPromptSnapshots}
              clearTrigger={clearTrigger}
              teamConfig={teamConfig}
            />
            {userQuestion != null && (
              <UserQuestionDock
                data={userQuestion}
                onAnswer={handleAnswerQuestion}
                onCancel={handleCancelQuestion}
              />
            )}
            <ComposerV2
              session={activeSession}
              workspace={activeWorkspace}
              providers={providers}
              agents={agents}
              selectedProviderId={selectedProviderId}
              setSelectedProviderId={setSelectedProviderId}
              branchState={branchState}
              contextInputTokens={contextInputTokens}
              contextUsage={contextUsage}
              isWorking={activeSession?.status === 'running'}
              approvalRequest={approvalRequest}
              {...(onApprovalClose !== undefined ? { onApprovalClose } : {})}
              onCreateSession={(options) => sessionCtx.handleNewSession(activeWorkspaceId, options as Record<string, unknown>)}
              onUpdateSession={handleUpdateActiveSession}
              onCommandComplete={(summary) => { sessionCtx.updateSessionInList(summary.id, summary) }}
              onSwitchBranch={handleSwitchBranch}
              onCancelSession={handleCancelSession}
              onSent={(sessionId) => { setSessionStatus(sessionId, 'running') }}
              showProjectPicker={showEmptyHero}
              focusTrigger={composerFocusTrigger}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onPickProject={pickProjectFolder}
              onUseNoProject={() => void sessionCtx.ensureNoProjectWorkspace().then(id => { if (id) setActiveWorkspaceId(id) })}
              onSwitchWorkspace={switchToWorkspace}
              teamConfig={teamConfig}
              onChangeTeamConfig={updateTeamConfig}
              onOpenTeamInspector={() => setShowInspector(true)}
            />
          </>
        )}
      </div>

      {showConfigPanel && (
        <ChatConfigPanel
          session={activeSession}
          workspace={activeWorkspace}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          {...(() => {
            const aid = teamConfig.enabled ? teamConfig.hostAgentId : (activeSession?.agentId ?? undefined)
            return aid != null ? { agentId: aid } : {}
          })()}
        />
      )}

      {showInspector && (
        <ChatInspector
          session={activeSession}
          workspace={activeWorkspace}
          messages={active == null ? [] : activeMessages}
          usageData={sessionUsageData}
          projectContext={projectContext}
          contextUsage={contextUsage}
          contextInputTokens={contextInputTokens}
          providerContextWindow={activeProviderContextWindow}
          turnPromptSnapshots={turnPromptSnapshots}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          teamConfig={teamConfig}
          agents={agents}
          onChangeTeamConfig={updateTeamConfig}
          onOpenProjectFolder={() => {
            if (activeWorkspace) void sessionCtx.handleOpenProjectFolder(activeWorkspace)
          }}
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

// ─── Tool Dropdown (IDE / Terminal open) ─────────────────────────────────

/** Map iconHint to the corresponding Icons component */
function getToolIcon(iconHint?: string, kind?: 'ide' | 'terminal'): JSX.Element {
  const size = 13
  const fallback = kind === 'ide' ? <Icons.Code size={size} /> : <Icons.Terminal size={size} />
  if (!iconHint) return fallback

  // Map iconHint to Icons component
  const iconMap: Record<string, (() => JSX.Element) | undefined> = {
    VSCode: () => <Icons.VSCode size={size} />,
    Cursor: () => <Icons.Cursor size={size} />,
    Zed: () => <Icons.Zed size={size} />,
    WebStorm: () => <Icons.WebStorm size={size} />,
    Sublime: () => <Icons.Sublime size={size} />,
    Vim: () => <Icons.Vim size={size} />,
    Neovim: () => <Icons.Neovim size={size} />,
    Windsurf: () => <Icons.Windsurf size={size} />,
    Trae: () => <Icons.Trae size={size} />,
    CodeBuddy: () => <Icons.CodeBuddy size={size} />,
    Kiro: () => <Icons.Kiro size={size} />,
    Qoder: () => <Icons.Qoder size={size} />,
    IntelliJ: () => <Icons.IntelliJ size={size} />,
    PyCharm: () => <Icons.PyCharm size={size} />,
    ITerm2: () => <Icons.ITerm2 size={size} />,
    TerminalApp: () => <Icons.TerminalApp size={size} />,
    Warp: () => <Icons.Warp size={size} />,
    Alacritty: () => <Icons.Alacritty size={size} />,
    Kitty: () => <Icons.Kitty size={size} />,
    Hyper: () => <Icons.Hyper size={size} />,
    Tabby: () => <Icons.Tabby size={size} />,
    PowerShell: () => <Icons.PowerShell size={size} />,
    WindowsTerminal: () => <Icons.WindowsTerminal size={size} />,
    GitBash: () => <Icons.GitBash size={size} />,
    CMD: () => <Icons.CMD size={size} />,
  }

  const iconFn = iconMap[iconHint]
  return iconFn ? iconFn() : fallback
}

function ToolDropdown({ kind, rootPath }: { kind: 'ide' | 'terminal'; rootPath: string }) {
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
    window.spark
      .invoke('tool:detect', { kind })
      .then((res) => {
        if (!cancelled) setTools(Array.isArray(res.tools) ? res.tools : [])
      })
      .catch(() => {
        if (!cancelled) setTools([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, kind, tools.length])

  const handleSelect = async (tool: ExternalToolInfo) => {
    setOpen(false)
    try {
      await window.spark.invoke('tool:open-project', { toolId: tool.id, rootPath })
    } catch (err) {
      console.error(`Failed to open in ${tool.name}:`, err)
    }
  }

  const availableTools = tools.filter((t) => t.available)

  return (
    <div className="tool-dropdown-wrap" ref={ref}>
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        title={tooltip}
        onClick={() => setOpen((prev) => !prev)}
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
          {!loading &&
            availableTools.map((tool) => (
              <button
                key={tool.id}
                className="tool-dropdown-item"
                onClick={() => handleSelect(tool)}
              >
                <span className="tool-dropdown-item-icon">
                  {getToolIcon(tool.iconHint, tool.kind)}
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

function ChatTabbar({
  session,
  workspace,
  agentStatus,
  showInspector,
  setShowInspector,
  showConfigPanel,
  setShowConfigPanel,
  onClearMessages,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  agentStatus: string
  showInspector: boolean
  setShowInspector: (v: boolean) => void
  showConfigPanel: boolean
  setShowConfigPanel: (v: boolean) => void
  onClearMessages?: () => void
}) {
  const { t, setTweak } = useApp()
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearClick = () => {
    setShowClearConfirm(true)
  }

  const handleClearConfirm = () => {
    setShowClearConfirm(false)
    onClearMessages?.()
  }

  return (
    <div
      className="chat-tabbar"
      onDoubleClick={() => { window.spark.invoke('window:maximize', {}).catch(() => {}) }}
    >
      {t.sidebarHidden && <SidebarExpandButton />}
      <div className="chat-title-block">
        {session ? (
          <>
            <span className="badge primary dot">会话</span>
            <span className="chat-title truncate">{session.title || '新会话'}</span>
            {workspace && (
              <span className="badge">
                <Icons.Folder size={10} /> {workspace.name}
              </span>
            )}
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
        <button
          className={`btn ghost sm${t.browserPanelOpen ? ' active' : ''}`}
          onClick={() => setTweak('browserPanelOpen', !t.browserPanelOpen)}
          title={t.browserPanelOpen ? '隐藏浏览器面板' : '显示浏览器面板'}
        >
          <Icons.Globe size={12} />
        </button>
        {workspace && (
          <>
            <ToolDropdown kind="ide" rootPath={workspace.rootPath} />
            <ToolDropdown kind="terminal" rootPath={workspace.rootPath} />
          </>
        )}
        {showClearConfirm && onClearMessages && (
          <div className="clear-confirm-bar">
            <span className="clear-confirm-text">确认清空？</span>
            <button
              className="btn ghost sm clear-confirm-cancel"
              onClick={() => setShowClearConfirm(false)}
            >
              取消
            </button>
            <button className="btn sm danger-btn" onClick={handleClearConfirm}>
              清空
            </button>
          </div>
        )}
        {!showClearConfirm && onClearMessages && (
          <button className="icon-btn" title="清空会话消息" onClick={handleClearClick}>
            <Icons.Trash size={14} />
          </button>
        )}
        <button
          className={`icon-btn ${showInspector ? 'active' : ''}`}
          title="会话检查器"
          aria-label="会话检查器"
          onClick={() => setShowInspector(!showInspector)}
        >
          <Icons.PanelRight />
        </button>
        <button
          className={`icon-btn ${showConfigPanel ? 'active' : ''}`}
          title="配置面板"
          aria-label="配置面板"
          onClick={() => setShowConfigPanel(!showConfigPanel)}
        >
          <Icons.More />
        </button>
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
  onProjectContextChange,
  onPlanProposed,
  onTurnPromptSnapshotsChange,
  clearTrigger,
  teamConfig,
}: {
  sessionId: SessionId
  onStatusChange: (s: string) => void
  onUsageChange: (tokens: number) => void
  onUsageDataChange: (data: SessionUsageData) => void
  onMessagesChange: (messages: UIMessage[]) => void
  onSessionStatusChange: (status: SessionSummary['status']) => void
  onContextUsageChange: (snapshot: ContextUsageState | null) => void
  onProjectContextChange: (snapshot: ProjectContextState | null) => void
  onPlanProposed: (plan: string) => void
  onTurnPromptSnapshotsChange: (snapshots: TurnPromptSnapshotEvent[]) => void
  /** 递增时清空 ChatStream 内部消息状态 */
  clearTrigger?: number
  teamConfig: TeamModeConfig
}) {
  const streamRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [agentIsRunning, setAgentIsRunning] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const builderRef = useRef(new MessageBuilder())
  const rafRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  const userScrolledRef = useRef(false)
  const hydratingRef = useRef(false)
  const bufferedEventsRef = useRef<AgentEvent[]>([])
  const historyLoadIdRef = useRef(0)
  const usageRef = useRef<SessionUsageData>({
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  })
  const { invoke: getHistory } = useIpcInvoke('session:get-history')
  const { invoke: deleteMessageEvents } = useIpcInvoke('session:delete-message')
  const userAvatarSrc = useUserAvatarSrc()
  const { sessions, agents } = useSessionSidebar()
  const session = sessions.find((item) => item.id === sessionId)
  const assistantAgentId = teamConfig.enabled ? teamConfig.hostAgentId : (session?.agentId ?? 'code-agent')
  const assistantAgent = agents.find((item) => item.id === assistantAgentId)
  const assistantName = assistantAgent?.name ?? 'Spark Agent'
  const assistantAvatar = getAgentAvatarConfig(assistantAgent?.metadata, assistantAgentId, assistantName)
  const assistantAvatarSrc = resolveAvatarSrc(assistantAvatar)

  // ── 会话消息缓存：避免切换时从空白开始 ──
  // 缓存每个会话最后渲染的消息列表，切回时立即显示缓存内容，再异步更新
  const sessionCacheRef = useRef<
    Map<SessionId, { messages: UIMessage[]; usage: SessionUsageData; status: string }>
  >(new Map())

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
      setMessages(cached.messages)
      onMessagesChange(cached.messages)
      onStatusChange(cached.status)
      setAgentIsRunning(cached.status === 'running')
      usageRef.current = cached.usage
      onUsageDataChange(cached.usage)
      setIsLoadingHistory(false)
    } else {
      // 无缓存时立即清空旧消息并显示加载状态，避免 header 已变但内容仍为旧会话
      setMessages([])
      onMessagesChange([])
      setIsLoadingHistory(true)
    }

    isStreamingRef.current = false
    userScrolledRef.current = false
    onContextUsageChange(null)
    onProjectContextChange(null)
    onTurnPromptSnapshotsChange([])

    // 2) 立即开始异步加载（不再用 setTimeout(0) 延迟）
    loadCompleteSessionHistory(getHistory, sessionId)
      .then((historyEvents) => {
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
        const statusStr =
          latestStatus != null
            ? isRunningAgentStatus(latestStatus)
              ? 'running'
              : latestStatus === 'error'
                ? 'error'
                : ''
            : ''
        setAgentIsRunning(isRunningAgentStatus(latestStatus))
        sessionCacheRef.current.set(sessionId, {
          messages: nextMessages,
          usage: historyUsage,
          status: statusStr,
        })
        if (latestStatus != null)
          applyAgentStatus(
            latestStatus,
            onStatusChange,
            onSessionStatusChange,
            isStreamingRef,
            userScrolledRef,
          )
        const latestContext = getLatestContextUsageEvent(events)
        if (latestContext != null) {
          onContextUsageChange({
            estimatedTokens: latestContext.estimatedTokens,
            softLimitTokens: latestContext.softLimitTokens,
            contextWindowTokens: latestContext.contextWindowTokens,
            compactedThisTurn: latestContext.compacted,
          })
        }
        onProjectContextChange(getLatestProjectContextEvent(events))
        onTurnPromptSnapshotsChange(hydratedBuilder.getTurnPromptSnapshots())
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
          setIsLoadingHistory(false)
        }
      })

    return () => {
      cancelled = true
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
  }, [
    getHistory,
    onMessagesChange,
    onStatusChange,
    onUsageChange,
    onUsageDataChange,
    onContextUsageChange,
    onProjectContextChange,
    sessionId,
  ])

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
    onUsageDataChange({
      inputTokens: 0,
      outputTokens: 0,
      cacheHitTokens: 0,
      estimatedCostUsd: 0,
      contextWindow: 0,
      turns: [],
    })
    onContextUsageChange(null)
    onProjectContextChange(null)
    setAgentIsRunning(false)
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
  useIpcStream(
    'stream:session:agent-event',
    (event) => {
      if (event.sessionId !== sessionId) return
      if (hydratingRef.current) {
        bufferedEventsRef.current.push(event)
        return
      }
      builderRef.current.processEvent(event)

      // 对状态/用量事件立即处理（不走 RAF 延迟）
      if (event.type === 'agent_status') {
        setAgentIsRunning(isRunningAgentStatus(event.status))
        applyAgentStatus(
          event.status,
          onStatusChange,
          onSessionStatusChange,
          isStreamingRef,
          userScrolledRef,
        )
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
          estimatedCostUsd: prev.estimatedCostUsd + (event.estimatedCostUsd ?? 0),
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
        setAgentIsRunning(true)
      }

      if (event.type === 'context_usage') {
        onContextUsageChange({
          estimatedTokens: event.estimatedTokens,
          softLimitTokens: event.softLimitTokens,
          contextWindowTokens: event.contextWindowTokens,
          compactedThisTurn: event.compacted,
        })
      }

      if (event.type === 'project_context_loaded') {
        onProjectContextChange(event)
      }

      if (event.type === 'plan_proposed') {
        onPlanProposed(event.plan)
      }

      if (event.type === 'turn_prompt_snapshot') {
        // Builder stores it; notify parent for inspector display
        onTurnPromptSnapshotsChange(builderRef.current.getTurnPromptSnapshots())
      }

      // 对文本/思考增量事件立即 flush，确保无延迟感知
      if (
        (event.type === 'assistant_message' && event.mode === 'delta') ||
        (event.type === 'agent_thinking' && event.mode === 'delta')
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
    },
    [
      onMessagesChange,
      onStatusChange,
      onUsageChange,
      onUsageDataChange,
      onSessionStatusChange,
      onContextUsageChange,
      onProjectContextChange,
      onPlanProposed,
      onTurnPromptSnapshotsChange,
      flushMessages,
      scheduleFlush,
    ],
  )

  // 智能自动滚动：只在用户未主动上滚时自动跟随
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    if (!userScrolledRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, agentIsRunning])

  // 是否有正在流式传输的消息
  const hasStreamingMsg = messages.some((m) => m.status === 'streaming')
  const showWaitingAgent = agentIsRunning && !hasStreamingMsg

  const handleDeleteMessage = useCallback(
    (msgId: string, eventIds: string[]) => {
      deleteMessageEvents({ sessionId, eventIds })
        .then(() => {
          builderRef.current.removeMessage(msgId)
          sessionCacheRef.current.delete(sessionId)
          const nextMessages = builderRef.current.getAllMessages()
          setMessages(nextMessages)
          onMessagesChange(nextMessages)
        })
        .catch(console.error)
    },
    [deleteMessageEvents, sessionId, onMessagesChange],
  )

  return (
    <div className="chat-stream" ref={streamRef}>
      <div className="chat-stream-inner">
        {messages.map((msg, index) =>
          msg.role === 'user' ? (
            <UserMsg
              key={msg.id}
              timestamp={msg.timestamp}
              blocks={msg.blocks}
              avatarSrc={userAvatarSrc}
              {...(msg.attachments != null ? { attachments: msg.attachments } : {})}
              {...(msg.mentionAgentId != null && msg.mentionAgentId !== assistantAgentId
                ? {
                    mentionAgentName:
                      agents.find((a) => a.id === msg.mentionAgentId)?.name ?? msg.mentionAgentId,
                  }
                : {})}
              onDelete={() => handleDeleteMessage(msg.id, msg.eventIds)}
            >
              {renderBlocks(msg.blocks)}
            </UserMsg>
          ) : (
            <AssistantMessageRows
              key={msg.id}
              sessionId={sessionId}
              blocks={msg.blocks}
              messageStatus={msg.status}
              isLatest={index === messages.length - 1}
              assistantId={assistantAgentId}
              assistantName={assistantName}
              assistantAvatarSrc={assistantAvatarSrc}
              usage={msg.usage}
              {...(msg.status === 'streaming' ? { status: 'running' as const } : {})}
              {...(msg.timestamp != null ? { timestamp: msg.timestamp } : {})}
              {...(msg.status !== 'streaming'
                ? { onDelete: () => handleDeleteMessage(msg.id, msg.eventIds) }
                : {})}
            />
          ),
        )}
        {showWaitingAgent && (
          <AgentMsg
            key="agent-running-placeholder"
            sessionId={sessionId}
            status="running"
            blocks={[]}
            messageStatus="streaming"
            isLatest
            assistantId={assistantAgentId}
            assistantName={assistantName}
            assistantAvatarSrc={assistantAvatarSrc}
          />
        )}
        {messages.length === 0 && !showWaitingAgent && (
          <div className="chat-stream-empty-state">
            <div className="empty-state">
              {isLoadingHistory ? (
                <>
                  <div className="empty-icon loading-icon">
                    <Icons.Spinner size={24} />
                  </div>
                  <div className="empty-title">加载中…</div>
                </>
              ) : (
                <>
                  <div className="empty-icon">
                    <Icons.Chat size={24} />
                  </div>
                  <div className="empty-title">开始对话</div>
                  <div className="empty-desc">发送消息开始与 AI 交互</div>
                </>
              )}
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

async function loadCompleteSessionHistory(
  getHistory: GetSessionHistory,
  sessionId: SessionId,
): Promise<AgentEvent[]> {
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

function getLatestContextUsageEvent(
  events: AgentEvent[],
): Extract<AgentEvent, { type: 'context_usage' }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'context_usage') return event
  }
  return null
}

function getLatestProjectContextEvent(events: AgentEvent[]): ProjectContextState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'project_context_loaded') return event
  }
  return null
}

function isRunningAgentStatus(status: AgentStatusValue | null): boolean {
  return (
    status === 'thinking' ||
    status === 'calling_tool' ||
    status === 'waiting_permission' ||
    status === 'waiting_user'
  )
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
  if (
    status === 'thinking' ||
    status === 'calling_tool' ||
    status === 'waiting_permission' ||
    status === 'waiting_user'
  ) {
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

function renderBlocks(
  blocks: UIBlock[],
  options: { surface?: 'main' | 'inspector'; sessionId?: SessionId } = {},
): ReactNode {
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
        if (isHiddenTimelineBlock(block)) {
          return null
        }
        const toolStatus =
          block.status === 'success'
            ? ('ok' as const)
            : block.status === 'error'
              ? ('error' as const)
              : null
        // 对于 Bash 相关工具，优先显示 command 字段作为完整内容
        const isBashLike = block.toolName === 'Bash' || block.toolName === 'bash' || block.toolName === 'run_command'
        const commandValue = isBashLike && typeof block.toolInput.command === 'string' ? block.toolInput.command : null
        const toolArg = commandValue ? commandValue.slice(0, surface === 'main' ? 48 : 80) : JSON.stringify(block.toolInput).slice(0, surface === 'main' ? 48 : 80)
        const fullToolArg = commandValue || JSON.stringify(block.toolInput)
        const isPending = block.status === 'pending' || block.status === 'running'
        const isTodoWrite = block.toolName === 'todo_write'
        // 把 todo_write 的输入直接作为预览，避免折叠后还要展开看（todos 数组本身就是状态）
        const todoListBody = isTodoWrite ? (
          <TodoListInline input={block.toolInput} output={block.output} />
        ) : null
        return toolStatus ? (
          <ToolCall
            key={i}
            name={block.toolName}
            arg={isTodoWrite ? '' : toolArg}
            fullArg={isTodoWrite ? '' : fullToolArg}
            status={toolStatus}
            durationMs={block.durationMs}
          >
            {todoListBody}
            {!isTodoWrite && block.output && <GitDiffContent content={block.output} />}
            {block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        ) : (
          <ToolCall
            key={i}
            name={block.toolName}
            arg={isTodoWrite ? '' : toolArg}
            fullArg={isTodoWrite ? '' : fullToolArg}
            pending={isPending}
            durationMs={block.durationMs}
          >
            {todoListBody}
            {!isTodoWrite && block.output && <GitDiffContent content={block.output} />}
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
                <HunkDiff path={block.path} hunks={hunks} />
              </div>
            )
          }
        }
        return (
          <div key={i} className="block-file-change">
            <Icons.File size={11} /> {block.changeType}:{' '}
            <code className="mono-sm">{block.path}</code>
          </div>
        )
      }
      case 'checkpoint': {
        const suffix = block.checkpointId.slice(-6)
        const fileCount = block.filePaths?.length ?? 0
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <Checkpoint
              num={Number.parseInt(suffix, 16) || i + 1}
              time={fileCount > 0 ? `${fileCount} files` : (block.path ?? 'SDK')}
              label={block.label ?? 'Checkpoint'}
              {...(options.sessionId != null
                ? {
                    onRestore: () =>
                      void executeCheckpointRestore(
                        options.sessionId as SessionId,
                        block.checkpointId,
                      ),
                  }
                : {})}
              {...(block.filePaths != null ? { files: block.filePaths } : {})}
            />
          </div>
        )
      }
      case 'validation_suggestion':
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <ValidationSuggestionCard
              block={block}
              {...(options.sessionId != null ? { sessionId: options.sessionId } : {})}
            />
          </div>
        )
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
            <SubagentCard
              name={block.name}
              role={block.role}
              task={block.task}
              status={block.status}
              tokens={block.tokens}
              output={block.output}
            />
          </div>
        )
      }
      case 'turn_file_summary': {
        const sid = options.sessionId
        const cpId = block.latestCheckpointId
        const canUndo = sid != null && cpId != null
        const filesWithDiff = block.files.filter(
          (f): f is FileChangeSummary & { diff: string } =>
            typeof f.diff === 'string' && f.diff.length > 0,
        )
        const canReapply = filesWithDiff.length > 0
        return (
          <div key={i} style={{ marginTop: 8, marginBottom: 8 }}>
            <TurnFileSummaryCard
              files={block.files}
              totalAdds={block.totalAdds}
              totalDels={block.totalDels}
              {...(canUndo
                ? {
                    onUndo: () =>
                      executeCheckpointRestore(sid as SessionId, cpId as string),
                  }
                : {})}
              {...(canReapply ? { onReapply: () => reapplyTurnFiles(filesWithDiff) } : {})}
            />
          </div>
        )
      }
      case 'user_question': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <InlineQuestionCard block={block} />
          </div>
        )
      }
      case 'context_ledger': {
        // Context Ledger 不在消息流中渲染 — 上下文信息已在底部 ComposerV2 的 ContextMeterWithPopup 中显示
        return null
      }
      case 'context_summarized': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <ContextSummarizedCard block={block} />
          </div>
        )
      }
      case 'retry_trail': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <RetryTrailCard block={block} />
          </div>
        )
      }
      case 'team_dispatch': {
        return <TeamDispatchBlockView key={i} block={block} />
      }
      case 'team_member_message': {
        return <TeamMemberMessageBlockView key={i} block={block} />
      }
      default:
        return null
    }
  })
}

/** 解析 agentId → 显示名（取自 SessionSidebarContext 的 agents） */
function TeamDispatchBlockView({ block }: { block: Extract<UIBlock, { kind: 'team_dispatch' }> }) {
  const { agents } = useSessionSidebar()
  const memberName = agents.find((a) => a.id === block.memberAgentId)?.name ?? block.memberAgentId
  return (
    <TeamDispatchCard
      task={block.task}
      memberName={memberName}
      state={block.state}
      {...(block.reply != null ? { reply: block.reply } : {})}
    />
  )
}

function TeamMemberMessageBlockView({
  block,
}: {
  block: Extract<UIBlock, { kind: 'team_member_message' }>
}) {
  const { agents } = useSessionSidebar()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const member = agents.find((a) => a.id === block.memberAgentId)
  const memberName = member?.name ?? block.memberAgentId
  const avatar = getAgentAvatarConfig(member?.metadata, block.memberAgentId, memberName)
  const running = block.isStreaming
  return (
    <>
      <TeamMemberBubble
        memberAgentId={block.memberAgentId}
        memberName={memberName}
        avatarSrc={resolveAvatarSrc(avatar)}
        running={running}
        onOpenDetail={() => setDrawerOpen(true)}
      >
        <MarkdownText content={block.content} isStreaming={block.isStreaming} />
      </TeamMemberBubble>
      {drawerOpen && (
        <TeamMemberDrawer
          member={{
            agentId: block.memberAgentId,
            name: memberName,
            description: member?.description ?? '',
            providerProfileId: member?.providerProfileId ?? null,
            modelId: member?.modelId ?? null,
            skillCount: member?.skillIds.length ?? 0,
            mcpCount: member?.mcpServerIds.length ?? 0,
            avatarSrc: resolveAvatarSrc(avatar),
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  )
}

function TeamMemberActivityBlockView({
  memberAgentId,
  blocks,
  running,
  sessionId,
}: {
  memberAgentId: string
  blocks: UIBlock[]
  running: boolean
  sessionId: SessionId
}) {
  const { agents } = useSessionSidebar()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const member = agents.find((a) => a.id === memberAgentId)
  const memberName = member?.name ?? memberAgentId
  const avatar = getAgentAvatarConfig(member?.metadata, memberAgentId, memberName)

  return (
    <>
      <TeamMemberBubble
        memberAgentId={memberAgentId}
        memberName={memberName}
        avatarSrc={resolveAvatarSrc(avatar)}
        running={running}
        onOpenDetail={() => setDrawerOpen(true)}
      >
        {renderTeamMemberActivityBlocks(blocks, { sessionId })}
      </TeamMemberBubble>
      {drawerOpen && (
        <TeamMemberDrawer
          member={{
            agentId: memberAgentId,
            name: memberName,
            description: member?.description ?? '',
            providerProfileId: member?.providerProfileId ?? null,
            modelId: member?.modelId ?? null,
            skillCount: member?.skillIds.length ?? 0,
            mcpCount: member?.mcpServerIds.length ?? 0,
            avatarSrc: resolveAvatarSrc(avatar),
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  )
}

function renderTeamMemberActivityBlocks(
  blocks: UIBlock[],
  options: { sessionId: SessionId },
): ReactNode {
  const logBlocks = blocks.filter(isTeamMemberLogBlock)
  const resultBlocks = blocks.filter((block) => !isTeamMemberLogBlock(block))

  return (
    <>
      {logBlocks.length > 0 && (
        <details className="team-member-log-panel">
          <summary>
            <Icons.Wrench size={12} />
            <span>执行日志</span>
            <span className="team-member-log-count">{logBlocks.length}</span>
          </summary>
          <div className="team-member-log-body">
            {renderBlocks(logBlocks, { ...options, surface: 'inspector' })}
          </div>
        </details>
      )}
      {resultBlocks.map((block, index) => {
        if (block.kind === 'team_member_message') {
          if (block.content.trim().length === 0) return null
          return (
            <div key={index} className="md-surface">
              <MarkdownText content={block.content} isStreaming={block.isStreaming} />
            </div>
          )
        }
        return renderBlocks([block], options)
      })}
    </>
  )
}

function isTeamMemberLogBlock(block: UIBlock): boolean {
  return block.kind === 'tool_call' || block.kind === 'terminal' || block.kind === 'file_change'
}

function isTeamMemberActivityRunning(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'team_member_message') return block.isStreaming
    if (block.kind === 'tool_call') return block.status === 'pending' || block.status === 'running'
    if (block.kind === 'terminal') return block.isStreaming
    return false
  })
}

function ValidationSuggestionCard({
  block,
  sessionId,
}: {
  block: Extract<UIBlock, { kind: 'validation_suggestion' }>
  sessionId?: SessionId
}) {
  const { toast } = useToast()
  const [runningCommand, setRunningCommand] = useState<string | null>(null)

  const runValidationCommand = async (command: string, repair: boolean) => {
    if (sessionId == null) {
      toast.warning('请先选中会话再运行验证命令。')
      return
    }
    const runKey = repair ? `${command}:repair` : command
    setRunningCommand(runKey)
    try {
      const quotedCommand = quoteSlashCommandArg(command)
      await window.spark.invoke('command:execute', {
        sessionId,
        message: repair ? `/validate ${quotedCommand} --repair` : `/validate ${quotedCommand}`,
      })
      toast.info(repair ? '验证命令已执行；失败时会交给 Agent 继续修复。' : '验证命令已开始执行。')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '验证命令执行失败')
    } finally {
      setRunningCommand(null)
    }
  }

  return (
    <div className="chat-card validation-card">
      <div className="chat-card-h info">
        <span className="ico">
          <Icons.CheckCircle />
        </span>
        <span>建议验证</span>
      </div>
      <div className="chat-card-body">
        <div className="validation-summary">{block.summary}</div>
        <div className="validation-files">
          {block.changedFiles.slice(0, 6).map((file) => (
            <code key={file} className="validation-file">
              {file}
            </code>
          ))}
          {block.changedFiles.length > 6 && (
            <span className="validation-more">+{block.changedFiles.length - 6}</span>
          )}
        </div>
        <div className="validation-command-list">
          {block.commands.map((item) => (
            <div className="validation-command-row" key={item.id}>
              <div className="validation-command-main min-w-0">
                <div className="validation-command-title">
                  <span>{item.label}</span>
                  <code>{item.command}</code>
                </div>
                <div className="validation-command-reason">{item.reason}</div>
              </div>
              <button
                className="btn ghost sm"
                disabled={runningCommand != null}
                onClick={() => void runValidationCommand(item.command, false)}
                title="运行验证命令"
              >
                {runningCommand === item.command ? (
                  <Icons.Spinner size={12} />
                ) : (
                  <Icons.Play size={12} />
                )}
                运行
              </button>
              <button
                className="btn ghost sm"
                disabled={runningCommand != null}
                onClick={() => void runValidationCommand(item.command, true)}
                title="验证失败后交给 Agent 继续修复"
              >
                {runningCommand === `${item.command}:repair` ? (
                  <Icons.Spinner size={12} />
                ) : (
                  <Icons.Refresh size={12} />
                )}
                修复
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function quoteSlashCommandArg(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// ─── Diff / Plan / Permission helper utilities ──────────────────────────────────

async function executeCheckpointRestore(sessionId: SessionId, checkpointId: string): Promise<void> {
  await window.spark.invoke('command:execute', {
    sessionId,
    message: `/checkpoint restore ${quoteSlashCommandArg(checkpointId)}`,
  })
}

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
function parsePlanToItems(
  plan: string,
): { status: 'done' | 'running' | 'pending'; text: string; meta?: string }[] {
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
    if (
      bulletMatch &&
      (bulletMatch[1] ?? '').length > 0 &&
      !(bulletMatch[1] ?? '').startsWith('[')
    ) {
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
function InlinePermissionCard({
  block,
}: {
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
        <span className="ico">
          <Icons.Shield size={14} />
        </span>
        <span>权限请求 · {action}</span>
        <span className="badge" style={{ marginLeft: 'auto', fontSize: 10 }}>
          {riskLevel}
        </span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">描述</span>
          <span className="v">{description}</span>
          {command && (
            <>
              <span className="k">命令</span>
              <span className="v">
                <code>{command}</code>
              </span>
            </>
          )}
          {paths && paths.length > 0 && (
            <>
              <span className="k">路径</span>
              <span className="v">
                <code>{paths.join(', ')}</code>
              </span>
            </>
          )}
          {domains && domains.length > 0 && (
            <>
              <span className="k">域名</span>
              <span className="v">
                <code>{domains.join(', ')}</code>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="chat-card-foot">
        <span className="spacer" />
        <button className="btn sm" onClick={handleDeny}>
          拒绝
        </button>
        <button className="btn sm primary" onClick={handleAllow}>
          <Icons.Check size={11} /> 允许
        </button>
      </div>
    </div>
  )
}

/** Inline card for AskUserQuestion tool calls in the timeline */
function InlineQuestionCard({
  block,
}: {
  block: Extract<UIBlock, { kind: 'user_question' }>
}) {
  if (block.questions.length === 0) return null

  const total = block.questions.length
  const answerByQuestion = new Map<string, { answer: string; skipped?: boolean }>()
  if (block.answerSummary != null && block.answerSummary.length > 0) {
    for (const item of block.answerSummary) {
      answerByQuestion.set(item.question, {
        answer: item.answer,
        ...(item.skipped != null ? { skipped: item.skipped } : {}),
      })
    }
  } else if (block.answered) {
    // Fallback: try the module-level cache populated when the user
    // submitted answers via the dock.  The CLI tool_result output may
    // not be in a parseable format, so the builder's answerSummary
    // can be empty even though the user did answer.
    const cacheKey = block.questions.map((q) => q.question).join('\0')
    const cached = questionAnswerCache.get(cacheKey)
    if (cached != null) {
      for (const item of cached) {
        answerByQuestion.set(item.question, {
          answer: item.answer,
          ...(item.skipped != null ? { skipped: item.skipped } : {}),
        })
      }
      questionAnswerCache.delete(cacheKey)
    }
  }

  return (
    <div className="chat-card">
      <div className="chat-card-h info">
        <span className="ico"><Icons.HelpCircle size={14} /></span>
        <span>Agent 提问</span>
        {block.answered && (
          <span className="badge" style={{ marginLeft: 8, fontSize: 10, color: 'var(--c-ok)' }}>
            已回答
          </span>
        )}
      </div>
      <div className="chat-card-body" style={{ gap: 10 }}>
        <div className="inline-question-answers">
          {block.questions.map((question, index) => {
            const summary =
              answerByQuestion.get(question.question) ??
              (block.answerSummary != null ? block.answerSummary[index] : undefined)
            return (
              <div className="inline-question-answer" key={`${question.question}-${index}`}>
                {question.header && (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--c-dim)',
                      marginBottom: 2,
                    }}
                  >
                    {question.header}
                  </div>
                )}
                <div className="inline-question-answer-q">
                  {index + 1}. {question.question}
                </div>
                {block.answered && (
                  <div className="inline-question-answer-a">
                    {summary?.skipped
                      ? '已跳过'
                      : summary?.answer && summary.answer.length > 0
                        ? summary.answer
                        : '未填写'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12,
              color: 'var(--c-dim)',
              padding: '4px 8px',
              borderRadius: 999,
              background: 'var(--c-bg-soft)',
            }}
          >
            共 {total} 题
          </span>
          {!block.answered && (
            <span style={{ fontSize: 12, color: 'var(--c-dim)' }}>
              请在底部问答面板中逐题作答
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Inline card showing Context Ledger token breakdown */
function ContextLedgerCard({
  block,
}: {
  block: Extract<UIBlock, { kind: 'context_ledger' }>
}) {
  const barMaxWidth = 180
  const usageColor =
    block.usagePercent > 90
      ? 'var(--c-err, #ef4444)'
      : block.usagePercent > 70
        ? 'var(--c-warn, #f59e0b)'
        : 'var(--c-ok, #22c55e)'

  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--c-border)',
        fontSize: 12,
        background: 'var(--c-surface, #fff)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icons.Activity size={13} style={{ opacity: 0.6 }} />
        <span style={{ fontWeight: 600 }}>Context Ledger</span>
        <span style={{ marginLeft: 'auto', color: usageColor, fontWeight: 600 }}>
          {block.usagePercent}%
        </span>
      </div>
      {/* Usage bar */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: 'var(--c-border)',
          marginBottom: 8,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, block.usagePercent)}%`,
            background: usageColor,
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      {/* Per-section breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {block.sections.map((section, si) => {
          const maxTokens = block.softLimitTokens || 1
          const sectionPercent = Math.round((section.estimatedTokens / maxTokens) * 100)
          return (
            <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 130, flexShrink: 0, color: 'var(--c-dim)' }}>
                {section.label}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 1.5,
                  background: 'var(--c-border)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, sectionPercent * (barMaxWidth / 100))}%`,
                    background: 'var(--c-text, #888)',
                    borderRadius: 1.5,
                  }}
                />
              </div>
              <span style={{ width: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {section.estimatedTokens.toLocaleString()} t
              </span>
              {section.truncated && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--c-warn, #f59e0b)',
                    border: '1px solid var(--c-warn)',
                    borderRadius: 3,
                    padding: '0 3px',
                  }}
                >
                  truncated
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          paddingTop: 4,
          borderTop: '1px solid var(--c-border)',
          color: 'var(--c-dim)',
        }}
      >
        <span>Total: {block.totalEstimatedTokens.toLocaleString()} tokens</span>
        <span>Window: {block.contextWindowTokens.toLocaleString()}</span>
      </div>
    </div>
  )
}

/** Inline card showing context summarization stats */
function ContextSummarizedCard({
  block,
}: {
  block: Extract<UIBlock, { kind: 'context_summarized' }>
}) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: 'var(--c-surface, #1e1e2e)',
        border: '1px solid var(--c-border, #333)',
        fontSize: 12,
        color: 'var(--c-text, #ccc)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icons.File size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
      <span style={{ opacity: 0.7 }}>
        Context Governor summarized {block.summarizedEntryCount} older exchanges
        (saved ~{block.tokensSaved.toLocaleString()} tokens)
      </span>
    </div>
  )
}

/** Inline card showing a self-correction retry trail */
function RetryTrailCard({
  block,
}: {
  block: Extract<UIBlock, { kind: 'retry_trail' }>
}) {
  const outcomeColor =
    block.finalOutcome === 'success'
      ? 'var(--c-ok, #22c55e)'
      : block.finalOutcome === 'failure'
        ? 'var(--c-err, #ef4444)'
        : 'var(--c-warn, #f59e0b)'

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--c-surface, #1e1e2e)',
        border: '1px solid var(--c-border, #333)',
        fontSize: 12,
        color: 'var(--c-text, #ccc)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icons.Refresh size={14} style={{ opacity: 0.6 }} />
        <span style={{ fontWeight: 600 }}>Self-correction: {block.target}</span>
        <span
          style={{
            marginLeft: 'auto',
            padding: '2px 8px',
            borderRadius: 4,
            background: outcomeColor,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {block.finalOutcome.toUpperCase()}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {block.attempts.map((attempt, idx) => {
          const icon =
            attempt.result === 'success' ? (
              <Icons.Check size={11} style={{ color: 'var(--c-ok, #22c55e)' }} />
            ) : attempt.result === 'failure' ? (
              <Icons.X size={11} style={{ color: 'var(--c-err, #ef4444)' }} />
            ) : (
              <Icons.AlertTriangle size={11} style={{ color: 'var(--c-warn, #f59e0b)' }} />
            )

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {attempt.attempt}
              </span>
              {icon}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {attempt.action}
              </span>
              {attempt.durationMs != null && (
                <span style={{ opacity: 0.5, fontSize: 10 }}>{attempt.durationMs}ms</span>
              )}
            </div>
          )
        })}
      </div>
      {block.attempts.some((a) => a.failureSummary) && (
        <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.08)', fontSize: 11 }}>
          {block.attempts
            .filter((a) => a.failureSummary)
            .map((a, idx) => (
              <div key={idx} style={{ opacity: 0.7 }}>
                Attempt {a.attempt}: {a.failureSummary}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

/**
 * 重新正向应用一组文件的 unified diff（每个文件可包含多个 hunk）。
 * 用于 TurnFileSummaryCard 在「撤销」后的「重新应用」。
 */
async function reapplyTurnFiles(
  files: Array<FileChangeSummary & { diff: string }>,
): Promise<void> {
  const wsRes = await window.spark.invoke('workspace:get-current', {})
  const workspaceRootPath = wsRes?.workspace?.rootPath
  if (workspaceRootPath == null) throw new Error('无法确定工作区路径')

  for (const file of files) {
    const hunks = parseUnifiedDiff(file.diff)
    for (const hunk of hunks) {
      const hunkDiff = reconstructHunkDiff(hunk)
      const result = await window.spark.invoke('file:apply-hunk-patch', {
        workspaceRootPath,
        filePath: file.path,
        hunkDiff,
        direction: 'forward',
      })
      if (!result?.applied) {
        throw new Error(`${file.path}: ${result?.error ?? '未知错误'}`)
      }
    }
  }
}

/** Reconstruct unified diff text from a parsed DiffHunk object */
function reconstructHunkDiff(hunk: DiffHunk): string {
  const header = `@@ ${hunk.range} @@${hunk.note ? ` ${hunk.note}` : ''}`
  const lines = hunk.lines.map((line) => {
    if (line.t === 'add') return `+${line.s}`
    if (line.t === 'del') return `-${line.s}`
    if (line.t === 'ctx') return ` ${line.s}`
    return line.s
  })
  return [header, ...lines].join('\n')
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

function MarkdownText({
  content,
  isStreaming = false,
}: {
  content: string
  isStreaming?: boolean
}) {
  const blocks = parseMarkdown(content)
  const syntaxHighlight = readAppearance().syntaxHighlight

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
            return <p key={index}>{renderInlineMarkdown(block.text)}</p>
          case 'code':
            return (
              <div key={index} className={`md-code-block${syntaxHighlight ? '' : ' no-syntax'}`}>
                {block.lang && (
                  <div className="md-code-header">
                    <span className="md-code-lang">{block.lang}</span>
                    <button
                      className="md-code-copy"
                      title="复制"
                      onClick={() => {
                        navigator.clipboard.writeText(block.code).catch(() => {})
                      }}
                    >
                      <Icons.Copy size={12} />
                    </button>
                  </div>
                )}
                {!block.lang && (
                  <button
                    className="md-code-copy-float"
                    title="复制"
                    onClick={() => {
                      navigator.clipboard.writeText(block.code).catch(() => {})
                    }}
                  >
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
                  <li
                    key={itemIndex}
                    className={item.checked !== undefined ? 'md-task' : undefined}
                  >
                    {item.checked !== undefined && (
                      <SparkInput
                        type="checkbox"
                        className="spark-checkbox"
                        checked={item.checked}
                        readOnly
                      />
                    )}
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
                      {block.headers.map((header, headerIndex) => (
                        <th key={headerIndex}>{renderInlineMarkdown(header)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.headers.map((_, cellIndex) => (
                          <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] ?? '')}</td>
                        ))}
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
        items.push(
          task
            ? { text: task[2] ?? '', checked: (task[1] ?? '').toLowerCase() === 'x' }
            : { text: itemText },
        )
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '')
    ) {
      const headers = splitTableRow(line)
      const rows: string[][] = []
      index += 2
      while (
        index < lines.length &&
        (lines[index] ?? '').includes('|') &&
        (lines[index] ?? '').trim()
      ) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^```/.test(lines[index] ?? '') &&
      !/^(#{1,6})\s+/.test(lines[index] ?? '') &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[index] ?? '') &&
      !/^>\s?/.test(lines[index] ?? '') &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern =
    /(!?\[[^\]]+]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) != null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${match.index}-${token}`
    const link = token.match(/^(!?)\[([^\]]+)]\(([^)]+)\)$/)
    if (link) {
      // 图片走 MarkdownImage 组件：自动把本地路径转 safe-file:// 协议，
      // 并支持点击预览 / 复制 / 下载 / 失败占位
      if (link[1] === '!') {
        nodes.push(<MarkdownImage key={key} src={link[3] ?? ''} alt={link[2] ?? ''} />)
      } else {
        nodes.push(
          <a key={key} href={link[3] ?? '#'} target="_blank" rel="noreferrer">
            {link[2] ?? ''}
          </a>,
        )
      }
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

/** 格式化时间戳 — 根据 timestampFormat 设置输出相对或绝对时间 */
function formatMsgTime(timestamp?: string): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const abs = `${hh}:${mm}`
  const fmt = readAppearance().timestampFormat
  if (fmt === 'abs') return abs
  // relative time
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  return abs
}

/** 消息悬浮操作栏：时间 + 复制按钮 + 删除按钮，放在气泡内部。position: left=agent消息(左下角), right=用户消息(右下角) */
function MessageHoverBar({
  timestamp,
  textContent,
  position,
  usage,
  onDelete,
}: {
  timestamp?: string | undefined
  textContent: string
  position: 'left' | 'right'
  usage?: UIMessage['usage'] | undefined
  onDelete?: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(textContent)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }, [textContent])

  const time = formatMsgTime(timestamp)
  const showTokenCount = readAppearance().inlineTokenCount && usage != null

  return (
    <div className={`msg-hover-bar msg-hover-${position}`}>
      {time && <span className="msg-hover-time">{time}</span>}
      {showTokenCount && (
        <span className="msg-hover-tokens">
          {usage.inputTokens + usage.outputTokens} tokens
        </span>
      )}
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

function InlineContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current != null && !ref.current.contains(event.target as Node)) onClose()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="action-menu context-action-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`action-menu-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            onClose()
            item.onClick?.()
          }}
        >
          {item.icon ?? <span className="action-menu-item-spacer" />}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function TextEditContextMenu({
  menu,
  onClose,
}: {
  menu: TextEditMenuState
  onClose: () => void
}) {
  const { target, hasSelection, isEditable } = menu
  const items = useMemo<ContextMenuItem[]>(() => {
    const result: ContextMenuItem[] = []
    if (isEditable) {
      result.push(
        {
          key: 'cut',
          label: '剪切',
          icon: <Icons.Edit size={14} />,
          disabled: !hasSelection,
          onClick: () => editTextSelection(target, 'cut'),
        },
        {
          key: 'copy',
          label: '复制',
          icon: <Icons.Copy size={14} />,
          disabled: !hasSelection,
          onClick: () => editTextSelection(target, 'copy'),
        },
        {
          key: 'paste',
          label: '粘贴',
          icon: <Icons.FilePlus size={14} />,
          onClick: () => {
            void editTextSelection(target, 'paste')
          },
        },
      )
    } else if (hasSelection) {
      result.push({
        key: 'copy',
        label: '复制',
        icon: <Icons.Copy size={14} />,
        onClick: () => editTextSelection(target, 'copy'),
      })
    }
    result.push({
      key: 'select-all',
      label: '全选',
      icon: <Icons.CheckSquare size={14} />,
      onClick: () => {
        target.focus()
        target.select()
      },
    })
    return result
  }, [hasSelection, isEditable, target])

  return <InlineContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />
}

async function editTextSelection(
  target: HTMLTextAreaElement | HTMLInputElement,
  action: 'cut' | 'copy' | 'paste',
): Promise<void> {
  target.focus()
  if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText()
      insertTextIntoControl(target, text)
    } catch {
      document.execCommand('paste')
    }
    return
  }
  document.execCommand(action)
}

function insertTextIntoControl(
  target: HTMLTextAreaElement | HTMLInputElement,
  text: string,
): void {
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  target.setRangeText(text, start, end, 'end')
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
}

/** 从 blocks 中提取纯文本内容（用于复制） */
function extractTextFromBlocks(blocks: UIBlock[]): string {
  return blocks
    .filter((b) => b.kind === 'text')
    .map((b) => (b as Extract<UIBlock, { kind: 'text' }>).content)
    .join('\n')
    .trim()
}

function UserMsg({
  children,
  timestamp,
  blocks,
  avatarSrc,
  attachments = [],
  onDelete,
  mentionAgentName,
}: {
  children: ReactNode
  timestamp?: string | undefined
  blocks: UIBlock[]
  avatarSrc: string
  attachments?: MessageAttachment[]
  onDelete?: () => void
  /** 团队模式：用户 @ 指定的 Agent 名称（已解析）；用于显示"→ 已直接由 @X 处理"提示 */
  mentionAgentName?: string | undefined
}) {
  const textContent = extractTextFromBlocks(blocks)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    imageSrc?: string
  } | null>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.target as HTMLElement | null
    const image = target?.closest('img') as HTMLImageElement | null
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...(image != null ? { imageSrc: image.currentSrc || image.src } : {}),
    })
  }, [])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (contextMenu == null) return []
    const items: ContextMenuItem[] = []
    if (contextMenu.imageSrc != null) {
      items.push({
        key: 'copy-image',
        label: '复制图片',
        icon: <Icons.Image size={14} />,
        onClick: () => {
          if (contextMenu.imageSrc != null) void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
        },
      })
    } else if (textContent.length > 0) {
      items.push({
        key: 'copy-text',
        label: '复制内容',
        icon: <Icons.Copy size={14} />,
        onClick: () => {
          void navigator.clipboard.writeText(textContent)
        },
      })
    }
    if (onDelete != null) {
      items.push({
        key: 'delete',
        label: '删除',
        icon: <Icons.Trash size={14} />,
        danger: true,
        onClick: onDelete,
      })
    }
    return items
  }, [contextMenu, onDelete, textContent])

  return (
    <div className="msg msg-user">
      {attachments.length > 0 && <UserMessageAttachments attachments={attachments} />}
      <div className="msg-user-line">
        <div className="msg-bubble msg-bubble-user" onContextMenu={handleContextMenu}>
          <div className="msg-content">{children}</div>
        </div>
        <div className="msg-user-avatar">
          <AvatarImage src={avatarSrc} seed="spark-user" name="User" alt="用户头像" />
        </div>
      </div>
      {mentionAgentName != null && mentionAgentName.length > 0 && (
        <div className="msg-user-mention-hint">
          → 已直接由 <strong>@{mentionAgentName}</strong> 处理
        </div>
      )}
      <MessageHoverBar
        timestamp={timestamp}
        textContent={textContent}
        position="right"
        {...(onDelete ? { onDelete } : {})}
      />
      {contextMenu != null && contextMenuItems.length > 0 && (
        <InlineContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      )}
    </div>
  )
}

function useUserAvatarSrc(): string {
  const readLocal = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
      if (raw == null) return resolveAvatarSrc(getUserAvatarConfig(null))
      return resolveAvatarSrc(getUserAvatarConfig((JSON.parse(raw) as Record<string, unknown>).userAvatar))
    } catch {
      return resolveAvatarSrc(getUserAvatarConfig(null))
    }
  }, [])
  const [src, setSrc] = useState(readLocal)

  useEffect(() => {
    let cancelled = false
    setSrc(readLocal())
    window.spark
      ?.invoke('settings:get', { category: 'general', key: 'data' })
      .then((res) => {
        if (cancelled) return
        const value = res.value != null && typeof res.value === 'object'
          ? (res.value as Record<string, unknown>).userAvatar
          : null
        setSrc(resolveAvatarSrc(getUserAvatarConfig(value)))
      })
      .catch(() => {})
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_GENERAL_KEY) setSrc(readLocal())
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      cancelled = true
      window.removeEventListener('storage', handleStorage)
    }
  }, [readLocal])

  return src
}

function UserMessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image')
  const fileAttachments = attachments.filter((attachment) => attachment.type === 'file')

  return (
    <div className="msg-user-attachments">
      {imageAttachments.length > 0 && (
        <div className="msg-user-image-row">
          {imageAttachments.map((attachment) => (
            <UserMessageImageAttachment
              key={`${attachment.path}:${attachment.name ?? ''}`}
              attachment={attachment}
            />
          ))}
        </div>
      )}
      {fileAttachments.length > 0 && (
        <div className="msg-user-file-row">
          {fileAttachments.map((attachment) => (
            <div
              key={`${attachment.path}:${attachment.name ?? ''}`}
              className="composer-file-chip msg-user-file-chip"
              title={attachment.name ?? getFileNameFromPath(attachment.path)}
            >
              <Icons.File size={14} />
              <span>{attachment.name ?? getFileNameFromPath(attachment.path)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserMessageImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const { invoke: prepareImagePreview } = useIpcInvoke('file:prepare-image-preview')
  const [resolvedSrc, setResolvedSrc] = useState(() => resolveComposerImageSrc(attachment.path))
  const [imgError, setImgError] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const initialSrc = resolveComposerImageSrc(attachment.path)
    setResolvedSrc(initialSrc)
    setImgError(false)

    const trimmedPath = attachment.path.trim()
    const lower = trimmedPath.toLowerCase()
    const needsPreparedPreview =
      trimmedPath.length > 0 &&
      !lower.startsWith('http://') &&
      !lower.startsWith('https://') &&
      !lower.startsWith('data:') &&
      !lower.startsWith('blob:') &&
      !lower.startsWith(`${SAFE_FILE_SCHEME}:`)

    if (!needsPreparedPreview) return () => { cancelled = true }

    void prepareImagePreview({ sourcePath: attachment.path })
      .then((preview) => {
        if (!cancelled) setResolvedSrc(preview.fileUrl)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [attachment.path, prepareImagePreview])

  const fileName = attachment.name ?? getFileNameFromPath(attachment.path)

  return (
    <>
      <div
        className="msg-user-image-card"
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <button
          type="button"
          className="msg-user-image-button"
          onClick={() => {
            if (!imgError) setPreviewOpen(true)
          }}
          title={fileName}
        >
          {imgError ? (
            <div className="msg-user-image-fallback" aria-hidden="true">
              <Icons.Image size={18} />
            </div>
          ) : (
            <img
              src={resolvedSrc}
              alt={fileName}
              className="msg-user-image-thumb"
              onError={() => setImgError(true)}
              draggable={false}
            />
          )}
        </button>
      </div>
      {previewOpen && !imgError && (
        <ImagePreviewModal
          src={resolvedSrc}
          alt={fileName}
          fileName={fileName}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      {menu != null && !imgError && (
        <InlineContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'preview',
              label: '预览图片',
              icon: <Icons.Maximize size={14} />,
              onClick: () => setPreviewOpen(true),
            },
            {
              key: 'copy',
              label: '复制图片',
              icon: <Icons.Copy size={14} />,
              onClick: () => {
                void copyImageFromSrc(resolvedSrc).catch(() => {})
              },
            },
          ]}
        />
      )}
    </>
  )
}

function AssistantMessageRows({
  sessionId,
  status,
  blocks,
  messageStatus,
  isLatest,
  timestamp,
  assistantId,
  assistantName,
  assistantAvatarSrc,
  usage,
  onDelete,
}: {
  sessionId: SessionId
  status?: 'running'
  blocks: UIBlock[]
  messageStatus?: UIMessage['status']
  isLatest?: boolean
  timestamp?: string | undefined
  assistantId: string
  assistantName: string
  assistantAvatarSrc: string
  usage?: UIMessage['usage'] | undefined
  onDelete?: () => void
}) {
  const segments = splitAssistantMessageBlocks(blocks)
  if (segments.length === 0) return null

  return (
    <>
      {segments.map((segment, index) => {
        const segmentIsLatest = isLatest === true && index === segments.length - 1
        if (segment.kind === 'team') {
          return (
            <div key={`team-${index}`} className="team-timeline-segment">
              {renderBlocks(segment.blocks, { sessionId })}
            </div>
          )
        }
        if (segment.kind === 'team_member_activity') {
          return (
            <div key={`team-member-activity-${index}`} className="team-timeline-segment">
              <TeamMemberActivityBlockView
                memberAgentId={segment.memberContext.memberAgentId}
                blocks={segment.blocks}
                running={segment.running}
                sessionId={sessionId}
              />
            </div>
          )
        }
        return (
          <AgentMsg
            key={`agent-${index}`}
            sessionId={sessionId}
            blocks={segment.blocks}
            isLatest={segmentIsLatest}
            assistantId={assistantId}
            assistantName={assistantName}
            assistantAvatarSrc={assistantAvatarSrc}
            usage={usage}
            {...(status != null ? { status } : {})}
            {...(messageStatus != null ? { messageStatus } : {})}
            {...(timestamp != null ? { timestamp } : {})}
            {...(onDelete != null ? { onDelete } : {})}
          />
        )
      })}
    </>
  )
}

type AssistantMessageSegment =
  | { kind: 'agent'; blocks: UIBlock[] }
  | { kind: 'team'; blocks: UIBlock[] }
  | {
      kind: 'team_member_activity'
      memberContext: TeamMemberEventContext
      blocks: UIBlock[]
      running: boolean
    }

function splitAssistantMessageBlocks(blocks: UIBlock[]): AssistantMessageSegment[] {
  const segments: AssistantMessageSegment[] = []
  const teamMemberSegments = new Map<
    string,
    Extract<AssistantMessageSegment, { kind: 'team_member_activity' }>
  >()
  const runningDispatches = new Set<string>()
  let currentAgentSegment: Extract<AssistantMessageSegment, { kind: 'agent' }> | null = null

  for (const block of blocks) {
    if (isHiddenTimelineBlock(block)) continue
    if (block.kind === 'team_dispatch') {
      const key = teamMemberContextKey({
        dispatchId: block.dispatchId,
        memberAgentId: block.memberAgentId,
      })
      const isRunning = block.state === 'pending' || block.state === 'working'
      if (isRunning) runningDispatches.add(key)
      else runningDispatches.delete(key)
      const segment = teamMemberSegments.get(key)
      if (segment != null) segment.running = isRunning || isTeamMemberActivityRunning(segment.blocks)
      segments.push({ kind: 'team', blocks: [block] })
      currentAgentSegment = null
      continue
    }
    const memberContext = getBlockTeamMemberContext(block)
    if (memberContext != null) {
      const key = teamMemberContextKey(memberContext)
      let segment = teamMemberSegments.get(key)
      if (segment == null) {
        segment = {
          kind: 'team_member_activity',
          memberContext,
          blocks: [],
          running: runningDispatches.has(key),
        }
        teamMemberSegments.set(key, segment)
        segments.push(segment)
      }
      segment.blocks.push(block)
      segment.running = runningDispatches.has(key) || isTeamMemberActivityRunning(segment.blocks)
      currentAgentSegment = null
      continue
    }
    if (currentAgentSegment == null) {
      currentAgentSegment = { kind: 'agent', blocks: [] }
      segments.push(currentAgentSegment)
    }
    currentAgentSegment.blocks.push(block)
  }
  return segments
}

function teamMemberContextKey(context: TeamMemberEventContext): string {
  return `${context.dispatchId}:${context.memberAgentId}`
}

function isHiddenTimelineBlock(block: UIBlock): boolean {
  return block.kind === 'tool_call' && block.toolName === 'mcp__spark_team__agent_dispatch'
}

function getBlockTeamMemberContext(block: UIBlock): TeamMemberEventContext | undefined {
  if (block.kind === 'team_member_message') {
    return { dispatchId: block.dispatchId, memberAgentId: block.memberAgentId }
  }
  if (block.kind === 'tool_call' || block.kind === 'terminal' || block.kind === 'file_change') {
    return block.teamMemberContext
  }
  return undefined
}

function AgentMsg({
  sessionId,
  status,
  blocks,
  messageStatus,
  isLatest,
  timestamp,
  assistantId,
  assistantName,
  assistantAvatarSrc,
  usage,
  onDelete,
}: {
  sessionId: SessionId
  status?: 'running'
  blocks: UIBlock[]
  messageStatus?: UIMessage['status']
  isLatest?: boolean
  timestamp?: string | undefined
  assistantId: string
  assistantName: string
  assistantAvatarSrc: string
  usage?: UIMessage['usage'] | undefined
  onDelete?: () => void
}) {
  const thinkingBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'thinking' }> => b.kind === 'thinking',
  )
  const contentBlocks = blocks.filter((b) => b.kind !== 'thinking' && b.kind !== 'error' && b.kind !== 'terminal' && !isHiddenTimelineBlock(b))
  const toolCallBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'tool_call' }> =>
      b.kind === 'tool_call' && !isHiddenTimelineBlock(b),
  )
  const errorBlocks = blocks.filter((b) => b.kind === 'error')
  const isStreaming = status === 'running'
  const hasContent = thinkingBlocks.length > 0 || contentBlocks.length > 0
  // Count active (pending/running) tool calls for parallel indicator
  const activeToolCount = toolCallBlocks.filter(
    (b) => b.status === 'pending' || b.status === 'running',
  ).length
  // Cancelled: streaming ended with error status but has rendered content
  const isCancelled = messageStatus === 'error' && !isStreaming && hasContent
  // Pure error: no content, only error blocks
  const isPureError =
    messageStatus === 'error' && !isStreaming && !hasContent && errorBlocks.length > 0
  // 是否已完成（非流式中）— 只有完成的消息才显示 hover bar
  const isFinished = !isStreaming

  // 提取纯文本用于复制
  const textContent = extractTextFromBlocks(blocks)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    imageSrc?: string
  } | null>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.target as HTMLElement | null
    const image = target?.closest('img') as HTMLImageElement | null
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...(image != null ? { imageSrc: image.currentSrc || image.src } : {}),
    })
  }, [])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (contextMenu == null) return []
    const items: ContextMenuItem[] = []
    if (contextMenu.imageSrc != null) {
      items.push({
        key: 'copy-image',
        label: '复制图片',
        icon: <Icons.Image size={14} />,
        onClick: () => {
          if (contextMenu.imageSrc != null) void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
        },
      })
    } else if (textContent.length > 0) {
      items.push({
        key: 'copy-text',
        label: '复制内容',
        icon: <Icons.Copy size={14} />,
        onClick: () => {
          void navigator.clipboard.writeText(textContent)
        },
      })
    }
    if (onDelete != null) {
      items.push({
        key: 'delete',
        label: '删除',
        icon: <Icons.Trash size={14} />,
        danger: true,
        onClick: onDelete,
      })
    }
    return items
  }, [contextMenu, onDelete, textContent])

  return (
    <div
      className={`msg msg-agent ${isCancelled ? 'is-cancelled' : ''} ${isPureError ? 'is-error' : ''}`}
    >
      <div className="msg-agent-avatar">
        <AvatarImage src={assistantAvatarSrc} seed={assistantId} name={assistantName} />
      </div>
      <div className="msg-agent-main">
        <div className="msg-agent-head">
          <span className="msg-agent-name">{assistantName}</span>
        </div>
        <div className="msg-bubble msg-bubble-agent" onContextMenu={handleContextMenu}>
        {isStreaming && !hasContent && (
          <div className="agent-running-tail agent-running-tail-empty" aria-label="正在运行">
            <span>正在运行</span>
            <span className="agent-running-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
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
          <div className="msg-content">{renderBlocks(contentBlocks, { sessionId })}</div>
        )}
        {contentBlocks.length > 0 && !isLatest && (
          <CollapsibleContent maxHeight={500} streaming={isStreaming}>
            <div className="msg-content">{renderBlocks(contentBlocks, { sessionId })}</div>
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
        {isStreaming && hasContent && (
          <div className="agent-running-tail" aria-label="正在运行">
            <span>正在运行</span>
            <span className="agent-running-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        {isCancelled && <StoppedMarker />}
        {isFinished && textContent && (
          <MessageHoverBar
            timestamp={timestamp}
            textContent={textContent}
            position="left"
            usage={usage}
            {...(onDelete ? { onDelete } : {})}
          />
        )}
      </div>
      </div>
      {contextMenu != null && contextMenuItems.length > 0 && (
        <InlineContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      )}
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

  const isThinkingActive = streaming && blocks.some((b) => b.isStreaming)

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
    <div
      className={`thinking-section ${open ? 'open' : ''} ${isThinkingActive ? 'is-active' : ''}`}
    >
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <Icons.ChevronRight size={12} className={`chev ${open ? 'chev-open' : ''}`} />
        <span className="thinking-label">思考过程</span>
        {isThinkingActive && <Icons.Spinner size={10} className="thinking-spinner" />}
        {!isThinkingActive && blocks.length > 0 && blocks.every((b) => !b.isStreaming) && (
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

function ToolCall({
  name,
  arg,
  fullArg,
  status,
  pending,
  durationMs,
  children,
}: {
  name: string
  arg: string
  fullArg?: string
  status?: 'ok' | 'error'
  pending?: boolean
  durationMs?: number | undefined
  children?: ReactNode
}) {
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

  // Auto-collapse on completion — controlled by autoCollapseTools setting
  useEffect(() => {
    if ((status === 'ok' || status === 'error') && readAppearance().autoCollapseTools) {
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
    <div
      className={`tool-call ${open ? 'open' : ''} ${pending ? 'is-pending' : ''} ${status === 'ok' ? 'is-success' : ''} ${status === 'error' ? 'is-error' : ''}`}
    >
      <div className="tool-call-head" onClick={() => setOpen(!open)}>
        {iconMap[name] || <Icons.Wrench className="tool-icon" />}
        <span className="tool-name">{name}</span>
        <span className="tool-arg" title={fullArg || arg}>{arg}</span>
        <span className="tool-call-actions">
          {pending && <Icons.Spinner size={12} className="tool-status spinner" />}
          {status === 'ok' && <Icons.Check size={12} className="tool-status ok" />}
          {status === 'error' && <Icons.X size={12} className="tool-status err" />}
          {displayDuration != null && (
            <span className="tool-duration">{formatDuration(displayDuration)}</span>
          )}
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

function StreamingErrorCard({
  sessionId,
  message,
  code,
  retryable,
}: {
  sessionId: SessionId
  message: string
  code: string
  retryable: boolean
}) {
  const { toast } = useToast()
  const isNetworkError =
    code === 'NETWORK_ERROR' || code === 'ECONNRESET' || code === 'ECONNREFUSED'
  const isTimeout = code === 'TIMEOUT' || code === 'ETIMEDOUT'
  const isAborted = code === 'ABORTED'
  const isMaxIter = code === 'MAX_ITERATIONS' || code === 'ERROR_MAX_TURNS'

  let hint = ''
  if (isNetworkError) {
    hint = '网络连接中断，请检查网络后重试'
  } else if (isTimeout) {
    hint = '请求超时，可能是服务器繁忙'
  } else if (isAborted) {
    hint = '请求已取消'
  } else if (isMaxIter) {
    hint = '自动扩展已达到阈值，请检查进展后决定是否继续调高上限'
  } else if (retryable) {
    hint = '可重试 — 该错误是临时性的'
  }

  // 从 message 中解析当前上限（agent_error.message 形如 "Reached maximum number of turns (80)"）
  const currentLimit = (() => {
    const m = /\((\d+)\)/.exec(message)
    return m ? Number(m[1]) : null
  })()
  const proposedLimit = Math.min(Math.max((currentLimit ?? 200) * 2, 400), 2000)

  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)
  const raiseLimit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.spark.invoke('session:set-max-iterations', {
        sessionId,
        maxIterations: proposedLimit,
      })
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
    <div
      className={`streaming-error-card ${isNetworkError ? 'is-network' : ''} ${isTimeout ? 'is-timeout' : ''} ${isMaxIter ? 'is-max-iter' : ''}`}
    >
      <div className="streaming-error-head">
        {isNetworkError && <Icons.Wifi size={13} className="streaming-error-icon" />}
        {isTimeout && <Icons.Clock size={13} className="streaming-error-icon" />}
        {!isNetworkError && !isTimeout && (
          <Icons.XCircle size={13} className="streaming-error-icon" />
        )}
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
            <span className="streaming-error-hint">
              已生效：本会话上限 = {applied}。重新发送消息继续。
            </span>
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
function TodoListInline({
  input,
  output,
}: {
  input: Record<string, unknown>
  output: string | undefined
}) {
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

type ParsedTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

function parseTodosFromInputOrOutput(
  input: Record<string, unknown>,
  output: string | undefined,
): ParsedTodo[] {
  // Output (JSON-stringified by event-mapper) has the canonical post-execution list
  if (output != null) {
    try {
      // formatToolOutput wraps as markdown ```json blocks; strip if present.
      const cleaned = output
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim()
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
  return (
    typeof obj['content'] === 'string' &&
    (obj['status'] === 'pending' ||
      obj['status'] === 'in_progress' ||
      obj['status'] === 'completed')
  )
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
function PlanApprovalModal({
  sessionId,
  plan,
  onClose,
}: {
  sessionId: SessionId
  plan: string
  onClose: () => void
}) {
  const { toast } = useToast()
  // editing: 是否处于编辑态（textarea）
  // draft: 当前已暂存的计划草稿（初始 = 原计划；保存编辑后 = 修改后的版本）
  // editBuffer: 编辑过程中的临时缓冲（独立于 draft，避免一边编辑一边脏读 draft）
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan)
  const [editBuffer, setEditBuffer] = useState(plan)
  const [busy, setBusy] = useState(false)

  const isEdited = draft !== plan

  const startEditing = () => {
    setEditBuffer(draft)
    setEditing(true)
  }

  const saveEdit = () => {
    setDraft(editBuffer)
    setEditing(false)
  }

  const discardEdit = () => {
    setEditBuffer(draft)
    setEditing(false)
  }

  const resetDraft = () => {
    setDraft(plan)
    setEditBuffer(plan)
  }

  const approve = async () => {
    if (busy) return
    const planText = draft
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
    <div className="modal-backdrop" onClick={() => !busy && !editing && onClose()}>
      <div className="modal plan-approval-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon">
            <Icons.Check size={16} />
          </div>
          <div>
            <div className="modal-title">
              计划已就绪，等待你审批
              {isEdited && !editing && (
                <span className="plan-approval-edited-badge">已编辑</span>
              )}
            </div>
            <div className="modal-subtitle">
              {editing
                ? '编辑模式 · 修改后点"保存编辑"暂存，可反复编辑后再批准'
                : 'Plan 模式 · 批准后会切换为 auto-edits 模式继续'}
            </div>
          </div>
        </div>
        <div className="modal-body">
          {editing ? (
            <textarea
              className="plan-approval-textarea"
              value={editBuffer}
              onChange={(e) => setEditBuffer(e.target.value)}
              rows={Math.min(20, Math.max(8, editBuffer.split('\n').length + 1))}
              autoFocus
            />
          ) : (
            <div className="plan-approval-preview md-surface">
              <MarkdownText content={draft} />
            </div>
          )}
        </div>
        <div className="modal-foot">
          {!editing && (
            <button className="btn ghost sm" disabled={busy} onClick={onClose}>
              拒绝
            </button>
          )}
          <div className="flex1" />
          {!editing && isEdited && (
            <button className="btn ghost sm" disabled={busy} onClick={resetDraft}>
              恢复原计划
            </button>
          )}
          {!editing && (
            <button className="btn sm" disabled={busy} onClick={startEditing}>
              <Icons.Edit size={11} /> {isEdited ? '继续编辑' : '编辑计划'}
            </button>
          )}
          {editing && (
            <button className="btn ghost sm" onClick={discardEdit}>
              放弃修改
            </button>
          )}
          {editing && (
            <button
              className="btn sm"
              disabled={editBuffer === draft}
              onClick={saveEdit}
            >
              <Icons.Check size={11} /> 保存编辑
            </button>
          )}
          {!editing && (
            <button className="btn primary sm" disabled={busy} onClick={approve}>
              {isEdited ? '批准（用编辑后）' : '批准并执行'}
            </button>
          )}
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

/**
 * Format git diff content with syntax highlighting
 * Detects git diff patterns and wraps them with appropriate CSS classes
 */
function formatGitDiffContent(content: string): string {
  const lines = content.split('\n')
  let isDiffMode = false
  let formattedLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // Detect diff start (diff --git or --- a/ or +++ b/)
    if (line.startsWith('diff --git') || line.match(/^---\s+a\//) || line.match(/^\+\+\+\s+b\//)) {
      isDiffMode = true
      formattedLines.push(`<span class="diff-file-header">${escapeHtml(line)}</span>`)
      continue
    }

    // Exit diff mode when we see non-diff content after diff
    if (isDiffMode && line.trim() && !line.startsWith('diff') && !line.startsWith('index') &&
        !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('@@') &&
        !line.startsWith('+') && !line.startsWith('-') && !line.startsWith(' ')) {
      isDiffMode = false
    }

    if (!isDiffMode) {
      formattedLines.push(escapeHtml(line))
      continue
    }

    // Git diff hunk header (@@ -x,y +a,b @@)
    if (line.startsWith('@@')) {
      formattedLines.push(`<span class="diff-hunk">${escapeHtml(line)}</span>`)
      continue
    }

    // Added line
    if (line.startsWith('+')) {
      formattedLines.push(`<span class="diff-add">${escapeHtml(line)}</span>`)
      continue
    }

    // Removed line
    if (line.startsWith('-')) {
      formattedLines.push(`<span class="diff-remove">${escapeHtml(line)}</span>`)
      continue
    }

    // Context line
    if (line.startsWith(' ')) {
      formattedLines.push(`<span class="diff-context">${escapeHtml(line)}</span>`)
      continue
    }

    // Other diff metadata (index, etc.)
    formattedLines.push(escapeHtml(line))
  }

  return formattedLines.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * GitDiffContent - renders git diff content with syntax highlighting
 * Detects if the content contains git diff patterns and formats accordingly
 */
function GitDiffContent({ content }: { content: string }) {
  // Check if content looks like git diff
  const isGitDiff = content.includes('diff --git') || content.includes('@@') || content.match(/^[\+\-]/m)

  if (!isGitDiff) {
    // Not a git diff, render as regular markdown
    return <MarkdownText content={content} />
  }

  // Format as git diff
  const formattedContent = formatGitDiffContent(content)

  return (
    <pre
      className="tool-output-pre md-surface"
      dangerouslySetInnerHTML={{ __html: formattedContent }}
    />
  )
}

function InlineApprovalRequest({
  request,
  onClose,
}: {
  request: PermissionApprovalRequest
  onClose?: () => void
}) {
  const [busyDecision, setBusyDecision] = useState<PermissionApprovalDecision | null>(null)
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]
  const riskTone =
    request.riskLevel === 'high' ? 'high' : request.riskLevel === 'medium' ? 'medium' : 'low'
  const inputPreview = JSON.stringify(request.toolInput, null, 2)
  const canRememberProject = request.persistentScopes.includes('project')

  const respond = useCallback(
    async (decision: PermissionApprovalDecision) => {
      setBusyDecision(decision)
      try {
        await window.spark.invoke('permission:approval-respond', {
          requestId: request.requestId,
          decision,
        })
      } catch {
        // best-effort
      } finally {
        setBusyDecision(null)
        onClose?.()
      }
    },
    [onClose, request.requestId],
  )

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
        {request.riskLevel === 'high' ? (
          <Icons.AlertTriangle size={17} />
        ) : (
          <Icons.Shield size={17} />
        )}
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
            {canRememberProject && (
              <button
                type="button"
                className="composer-approval-btn"
                disabled={busyDecision != null}
                onClick={() => void respond('deny-project')}
              >
                本项目拒绝
              </button>
            )}
            <button
              type="button"
              className="composer-approval-btn ghost"
              disabled={busyDecision != null}
              onClick={() => void respond('deny-global')}
            >
              全局拒绝
            </button>
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-session')}
            >
              本会话允许
            </button>
            {canRememberProject && (
              <button
                type="button"
                className="composer-approval-btn"
                disabled={busyDecision != null}
                onClick={() => void respond('allow-project')}
              >
                本项目记住
              </button>
            )}
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-global')}
            >
              全局记住
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

/** 上下文进度悬浮弹窗 */
function ContextMeterWithPopup({
  contextRatio,
  contextUsedTokens,
  contextWindow,
  compactedThisTurn,
  isBusy,
  sessionId,
  onCreateSession,
  selectedProvider,
  effectiveModelId,
  adapter,
  effectivePermissionMode,
  onSent,
  toast,
}: {
  contextRatio: number
  contextUsedTokens: number
  contextWindow: number
  compactedThisTurn: boolean
  isBusy: boolean
  sessionId: SessionId | null
  onCreateSession: (options: {
    providerProfileId?: string
    modelId?: string
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
    activate?: boolean
  }) => Promise<SessionId | null>
  selectedProvider: ProviderProfile | undefined
  effectiveModelId: string
  adapter: AgentAdapter
  effectivePermissionMode: PermissionModeChoice
  onSent: (sessionId: SessionId) => void
  toast: ReturnType<typeof useToast>['toast']
}) {
  const [popupVisible, setPopupVisible] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useCloseOnOutside(containerRef, () => setPopupVisible(false), popupVisible)

  const togglePopup = useCallback(() => {
    setPopupVisible((prev) => !prev)
  }, [])

  const handleCompact = useCallback(async () => {
    if (compressing) return
    setCompressing(true)
    try {
      let sid = sessionId
      if (sid == null) {
        if (selectedProvider == null) {
          toast.warning('请先选择 Provider 再执行压缩。')
          return
        }
        sid = await onCreateSession({
          ...(selectedProvider.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
          modelId: effectiveModelId,
          agentAdapter: adapter,
          permissionMode: effectivePermissionMode,
        })
        if (sid == null) {
          toast.error('创建会话失败。')
          return
        }
      }
      const res = await window.spark.invoke('command:execute', {
        sessionId: sid,
        message: '/compact',
      })
      if (res.success) {
        toast.success('上下文已压缩。')
        onSent(sid)
      }
    } catch (err) {
      toast.error('压缩上下文失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCompressing(false)
      setPopupVisible(false)
    }
  }, [
    compressing,
    sessionId,
    selectedProvider,
    effectiveModelId,
    adapter,
    effectivePermissionMode,
    onCreateSession,
    onSent,
    toast,
  ])

  const isWarning = contextRatio >= 80
  const isCritical = contextRatio >= 95

  return (
    <div ref={containerRef} className="context-meter-wrap">
      <div
        className={`context-meter${compactedThisTurn ? ' context-compacted' : ''}${popupVisible ? ' context-meter-active' : ''}`}
        onClick={togglePopup}
      >
        <span>{contextRatio}%</span>
        <span
          className={`context-ring${isCritical ? ' ring-danger' : isWarning ? ' ring-warn' : ''}`}
          style={{ '--context-pct': `${contextRatio}%` } as React.CSSProperties}
        />
        {compactedThisTurn && (
          <span
            className="context-compacted-badge"
            title="已自动裁剪较早的 tool_result 内容以释放上下文"
          >
            <Icons.Layers size={10} />
          </span>
        )}
      </div>
      {popupVisible && (
        <div className="context-popup">
          <div className="context-popup-header">
            <div className="context-popup-title">
              <Icons.Database size={13} />
              <span>上下文窗口</span>
            </div>
            <span
              className={`context-popup-pct ${isCritical ? 'pct-critical' : isWarning ? 'pct-warn' : ''}`}
            >
              {contextRatio}%
            </span>
          </div>

          {isCritical && (
            <div className="context-popup-alert alert-critical">
              <Icons.AlertTriangle size={11} />
              <span>上下文窗口即将满，建议压缩或开启新会话</span>
            </div>
          )}
          {!isCritical && isWarning && (
            <div className="context-popup-alert alert-warn">
              <Icons.AlertTriangle size={11} />
              <span>上下文使用率较高，请注意</span>
            </div>
          )}

          <div className="context-popup-bar">
            <div
              className={`context-popup-bar-fill${isCritical ? ' critical' : isWarning ? ' warn' : ''}`}
              style={{ width: `${Math.min(100, contextRatio)}%` }}
            >
              <div className="context-popup-bar-used" />
            </div>
          </div>

          <div className="context-popup-details">
            <div className="context-popup-row">
              <span className="row-label">已使用</span>
              <span className="row-value">{formatTokenCount(contextUsedTokens)}</span>
            </div>
            <div className="context-popup-row">
              <span className="row-label">总容量</span>
              <span className="row-value">{formatTokenCount(contextWindow)}</span>
            </div>
            <div className="context-popup-row">
              <span className="row-label">剩余</span>
              <span className="row-value">
                {formatTokenCount(Math.max(0, contextWindow - contextUsedTokens))}
              </span>
            </div>
          </div>

          <button
            type="button"
            className={`context-popup-compact-btn${isBusy ? ' disabled' : ''}`}
            onClick={handleCompact}
            disabled={compressing || isBusy}
          >
            {compressing ? <Icons.Spinner size={13} /> : <Icons.Minimize size={13} />}
            <span>{compressing ? '压缩中...' : '手动压缩上下文'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * EmptyChatHero — 空对话欢迎页（仅在还没有 active session 时显示）
 * 设计：渐变消失的网格背景 + 居中标题 + 居中输入区
 */
function ComposerV2({
  session,
  workspace,
  providers,
  agents,
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
  onCommandComplete,
  onSwitchBranch,
  onCancelSession,
  onSent,
  showProjectPicker,
  workspaces,
  activeWorkspaceId,
  onPickProject,
  onUseNoProject,
  onSwitchWorkspace,
  teamConfig,
  onChangeTeamConfig,
  onOpenTeamInspector,
  focusTrigger = 0,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  providers: ProviderProfile[]
  agents: ManagedAgent[]
  selectedProviderId: string
  setSelectedProviderId: (providerId: string) => void
  teamConfig: TeamModeConfig
  onChangeTeamConfig: (patch: Partial<TeamModeConfig>) => void
  onOpenTeamInspector: () => void
  branchState: BranchState
  contextInputTokens: number
  contextUsage: ContextUsageState | null
  isWorking: boolean
  approvalRequest?: PermissionApprovalRequest | null
  onApprovalClose?: (sessionId: string, requestId?: string) => void
  onCreateSession: (options: {
    providerProfileId?: string
    modelId?: string
    agentId?: string
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
    activate?: boolean
  }) => Promise<SessionId | null>
  onUpdateSession: (patch: {
    providerProfileId?: string
    modelId?: string | null
    agentId?: string
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
  }) => Promise<void>
  onCommandComplete: (session: SessionSummary) => void
  onSwitchBranch: (branch: string) => Promise<void>
  onCancelSession: (sessionId: SessionId) => void | Promise<void>
  onSent: (sessionId: SessionId) => void
  // 项目选择器相关（仅在空会话下使用）
  showProjectPicker?: boolean
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
  onPickProject?: () => void
  onUseNoProject?: () => void
  onSwitchWorkspace?: (workspaceId: string) => void
  // Focus trigger from Ctrl/Cmd+L global shortcut (incremented counter)
  focusTrigger?: number
}) {
  const { toast } = useToast()
  const initialPrefsRef = useRef<ComposerPrefs | null>(null)
  if (initialPrefsRef.current == null) initialPrefsRef.current = readComposerPrefs()
  const initialPrefs = initialPrefsRef.current
  const [drafts, setDrafts] = useState<Record<string, ComposerDraftSnapshot>>(() => readComposerDrafts())
  const [sending, setSending] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [queueVisible, setQueueVisible] = useState(true)
  const [slashCmds, setSlashCmds] = useState<CommandListItem[]>([])
  const [slashFilter, setSlashFilter] = useState('')
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashListRef = useRef<HTMLDivElement | null>(null)
  const [draftAdapter, setDraftAdapter] = useState<AgentAdapter>(
    initialPrefs.adapter ?? DEFAULT_AGENT_ADAPTER,
  )
  const [draftAgentId, setDraftAgentId] = useState(initialPrefs.agentId ?? 'code-agent')
  const [draftModelId, setDraftModelId] = useState(initialPrefs.modelId ?? '')
  const [draftMode] = useState<SessionChatMode>('agent')
  const [draftPermissionMode, setDraftPermissionMode] = useState<PermissionModeChoice>(
    getValidPermissionMode(
      initialPrefs.permissionMode,
      initialPrefs.adapter ?? DEFAULT_AGENT_ADAPTER,
    ),
  )
  const [draftReasoning, setDraftReasoning] = useState<SessionReasoningEffort>(
    initialPrefs.reasoningEffort ?? 'medium',
  )
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachment | null>(null)
  const [textEditMenu, setTextEditMenu] = useState<TextEditMenuState | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const lastFocusedDraftBucketRef = useRef<string | null>(null)
  // ── Mention (@) 状态：仅团队模式启用时生效 ──
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionAnchor, setMentionAnchor] = useState<{ left: number; top: number } | null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  /** `@` 字符在 textarea value 中的索引（含 @ 本身）。-1 表示未激活 */
  const mentionStartRef = useRef<number>(-1)
  /** 已选择的 mention：name 用于校验文本是否仍含该片段；agentId 用于 sendTurn 时携带 */
  const [pendingMention, setPendingMention] = useState<{ agentId: string; name: string } | null>(null)
  const runtimeSettingsHydratedRef = useRef(false)
  // ── Input history (↑↓) ──
  const sentHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('') // preserves the in-progress draft when user starts browsing history
  // ── Escape double-press interrupt ──
  const escapeTimestampRef = useRef(0)
  const [escapeConfirm, setEscapeConfirm] = useState(false)
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: savePastedImage } = useIpcInvoke('file:save-pasted-image')
  const { invoke: prepareImagePreview } = useIpcInvoke('file:prepare-image-preview')
  const { invoke: getQueue } = useIpcInvoke('session:get-queue')
  const { invoke: cancelQueuedTurn } = useIpcInvoke('session:cancel-queued-turn')
  const { invoke: sendQueuedTurnNow } = useIpcInvoke('session:send-queued-turn-now')
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const pendingRuntimePatchRef = useRef<SessionRuntimePatch>({})

  const effectiveAgentId = session?.agentId ?? draftAgentId
  const activeAgent =
    agents.find((agent) => agent.id === effectiveAgentId) ??
    agents.find((agent) => agent.id === 'code-agent') ??
    null
  const adapter = session?.agentAdapter ?? activeAgent?.agentAdapter ?? draftAdapter
  const compatibleProviders = providers.filter((provider) =>
    isProviderCompatibleWithAdapter(provider, adapter),
  )
  const selectedProvider =
    compatibleProviders.find(
      (item) => item.id === (session?.providerProfileId || selectedProviderId),
    ) ??
    compatibleProviders.find((item) => item.isDefault) ??
    compatibleProviders[0]
  const modelOptions = selectedProvider?.modelIds.length
    ? selectedProvider.modelIds
    : selectedProvider?.defaultModel
      ? [selectedProvider.defaultModel]
      : []
  const providerDefaultModel = selectedProvider?.defaultModel || modelOptions[0] || ''
  const sessionModelId = normalizeModelForProvider(session?.modelId, selectedProvider)
  const draftModelForProvider = normalizeModelForProvider(draftModelId, selectedProvider)
  const effectiveModelId =
    session != null
      ? sessionModelId || providerDefaultModel
      : draftModelForProvider || providerDefaultModel
  const effectiveMode = session?.chatMode ?? draftMode
  const effectiveReasoning = session?.reasoningEffort ?? draftReasoning
  const permissionOptions = getPermissionModeOptions(adapter)
  const sessionPermissionMode = session?.permissionMode
  const draftEffectivePermissionMode = sessionPermissionMode ?? draftPermissionMode
  const defaultPermissionMode = permissionOptions[0]?.value ?? 'claude-ask'
  const effectivePermissionMode = permissionOptions.some(
    (option) => option.value === draftEffectivePermissionMode,
  )
    ? draftEffectivePermissionMode
    : defaultPermissionMode
  const activePermissionOption = permissionOptions.find(
    (option) => option.value === effectivePermissionMode,
  )
  const contextWindow = resolveProviderContextWindow(
    selectedProvider?.supportsMillionContext === true,
  )
  const draftBucketKey = session?.id ?? `draft:new:${activeWorkspaceId ?? 'none'}`
  const draftState = drafts[draftBucketKey] ?? EMPTY_COMPOSER_DRAFT
  const value = draftState.value
  const attachments = draftState.attachments
  const manualExpanded = draftState.manualExpanded
  const contextUsedTokens = contextUsage?.estimatedTokens ?? contextInputTokens
  const contextRatio =
    contextWindow > 0
      ? Math.min(100, Math.round((contextUsedTokens / contextWindow) * 1000) / 10)
      : 0
  const isBusy = sending || isWorking
  // 发送前置条件：用户输入了内容、供应商 + 模型已选好。
  // session / workspace 不在这里卡—— handleNewSession 内部对 null 做了 no-project fallback，
  // 真正发送时再做详细校验（toast 提示）
  const canSubmit =
    (value.trim().length > 0 || attachments.length > 0) &&
    selectedProvider != null &&
    effectiveModelId.length > 0
  const showTaskQueue = queuedMessages.length > 0

  const updateDraft = useCallback(
    (updater: (draft: ComposerDraftSnapshot) => ComposerDraftSnapshot) => {
      setDrafts((current) => {
        const base = current[draftBucketKey] ?? EMPTY_COMPOSER_DRAFT
        const next = updater(base)
        if (
          next.value === base.value &&
          next.attachments === base.attachments &&
          next.manualExpanded === base.manualExpanded
        ) {
          return current
        }
        const nextDrafts = { ...current, [draftBucketKey]: next }
        writeComposerDrafts(nextDrafts)
        return nextDrafts
      })
    },
    [draftBucketKey],
  )

  const setValue = useCallback((next: React.SetStateAction<string>) => {
    updateDraft((draft) => ({
      ...draft,
      value: typeof next === 'function' ? next(draft.value) : next,
    }))
  }, [updateDraft])

  const setAttachments = useCallback((next: React.SetStateAction<ComposerAttachment[]>) => {
    updateDraft((draft) => ({
      ...draft,
      attachments: typeof next === 'function' ? next(draft.attachments) : next,
    }))
  }, [updateDraft])

  const setManualExpanded = useCallback((next: React.SetStateAction<boolean>) => {
    updateDraft((draft) => ({
      ...draft,
      manualExpanded: typeof next === 'function' ? next(draft.manualExpanded) : next,
    }))
  }, [updateDraft])

  const rememberRuntimePatch = useCallback((patch: SessionRuntimePatch) => {
    pendingRuntimePatchRef.current = { ...pendingRuntimePatchRef.current, ...patch }
  }, [])

  const persistRuntimePatch = useCallback(
    async (patch: SessionRuntimePatch) => {
      rememberRuntimePatch(patch)
      if (session == null) return
      await onUpdateSession(patch)
      const pending = { ...pendingRuntimePatchRef.current }
      for (const key of Object.keys(patch) as Array<keyof SessionRuntimePatch>) {
        if (pending[key] === patch[key]) delete pending[key]
      }
      pendingRuntimePatchRef.current = pending
    },
    [onUpdateSession, rememberRuntimePatch, session],
  )

  const flushPendingRuntimePatch = useCallback(async () => {
    if (session == null) return
    const patch = pendingRuntimePatchRef.current
    if (Object.keys(patch).length === 0) return
    await onUpdateSession(patch)
    pendingRuntimePatchRef.current = {}
  }, [onUpdateSession, session])

  const getCurrentRuntimePatch = useCallback(
    (): SessionRuntimePatch => ({
      ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
      modelId: effectiveModelId || null,
      agentId: effectiveAgentId,
      agentAdapter: adapter,
      permissionMode: effectivePermissionMode,
      chatMode: effectiveMode,
      reasoningEffort: effectiveReasoning,
    }),
    [
      adapter,
      effectiveAgentId,
      effectiveMode,
      effectiveModelId,
      effectivePermissionMode,
      effectiveReasoning,
      effectiveAgentId,
      selectedProvider?.id,
    ],
  )

  const applyQueueState = useCallback(
    (snapshot: SessionGetQueueResponse | null | undefined) => {
      if (snapshot == null || snapshot.sessionId !== session?.id) return
      setQueuedMessages(
        snapshot.queuedTurns.map((turn) => ({
          id: turn.turnId,
          turnId: turn.turnId,
          content: turn.message,
          enqueuedAt: turn.enqueuedAt,
        })),
      )
    },
    [session?.id],
  )

  const refreshQueueState = useCallback(
    async (sessionId: SessionId | null | undefined) => {
      if (sessionId == null) {
        setQueuedMessages([])
        return
      }
      try {
        applyQueueState(await getQueue({ sessionId }))
      } catch {
        setQueuedMessages([])
      }
    },
    [applyQueueState, getQueue],
  )

  useEffect(() => {
    if (runtimeSettingsHydratedRef.current || providers.length === 0) return
    runtimeSettingsHydratedRef.current = true
    getSetting({
      category: RUNTIME_PERMISSION_SETTINGS_CATEGORY,
      key: RUNTIME_PERMISSION_SETTINGS_KEY,
    })
      .then((res) => {
        if (res.value == null) return
        const runtimePrefs = normalizeRuntimePermissionPrefs(res.value)
        setDraftAdapter(runtimePrefs.adapter)
        setDraftPermissionMode(runtimePrefs.permissionMode)
        if (session == null) {
          const fallbackProvider = getPreferredProvider(
            providers,
            { ...readComposerPrefs(), ...runtimePrefs },
            runtimePrefs.adapter,
          )
          if (fallbackProvider != null) {
            const nextModel = fallbackProvider.defaultModel || fallbackProvider.modelIds[0] || ''
            setSelectedProviderId(fallbackProvider.id)
            setDraftModelId(nextModel)
            writeComposerPrefs({
              adapter: runtimePrefs.adapter,
              providerProfileId: fallbackProvider.id,
              modelId: nextModel,
              permissionMode: runtimePrefs.permissionMode,
            })
            return
          }
        }
        writeComposerPrefs(runtimePrefs)
      })
      .catch(() => {
        /* local composer preferences remain the fallback */
      })
  }, [getSetting, providers, session, setSelectedProviderId])

  useEffect(() => {
    if (session != null || providers.length === 0 || compatibleProviders.length > 0) return
    const fallbackProvider = getPreferredProvider(providers, initialPrefs, draftAdapter)
    if (fallbackProvider == null) return
    const nextAdapter = getProviderAdapterKind(fallbackProvider)
    const nextPermissionMode = getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask'
    const nextModel = fallbackProvider.defaultModel || fallbackProvider.modelIds[0] || ''
    setDraftAdapter(nextAdapter)
    setDraftPermissionMode(nextPermissionMode)
    setSelectedProviderId(fallbackProvider.id)
    setDraftModelId(nextModel)
    writeComposerPrefs({
      adapter: nextAdapter,
      providerProfileId: fallbackProvider.id,
      modelId: nextModel,
      permissionMode: nextPermissionMode,
    })
  }, [
    compatibleProviders.length,
    draftAdapter,
    initialPrefs,
    providers,
    session,
    setSelectedProviderId,
  ])

  useEffect(() => {
    void refreshQueueState(session?.id)
  }, [refreshQueueState, session?.id])

  useEffect(() => {
    return window.spark.on('stream:session:queue-changed', (snapshot) => {
      applyQueueState(snapshot)
    })
  }, [applyQueueState])

  useEffect(() => {
    if (selectedProvider != null && !draftModelId) {
      setDraftModelId(selectedProvider.defaultModel || selectedProvider.modelIds[0] || '')
    }
  }, [draftModelId, selectedProvider])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // 高度范围：折叠态 92-280px（hero 状态下 padding 上下会撑出更大的视觉高度），
    // 展开态 220-400px
    // 关键点：minHeight 留一个能容纳一行文字 + 一点 padding 的值，
    // 避免空 textarea 看起来永远是一坨；maxHeight 给得宽一些，常规长 prompt 都能直接展示完，
    // 不需要靠滚动条来回看。
    const minHeight = manualExpanded ? 220 : 126
    const maxHeight = manualExpanded ? 400 : 280

    // 用 'auto' 临时高度测量内容真实高度，再 clamp 到区间内
    // 之前用 '0px' 临时归零在某些渲染时机下会触发 textarea 高度抖动，体感是"打不出字"
    const prevHeight = el.style.height
    const prevTransition = el.style.transition
    el.style.transition = 'none'
    el.style.height = 'auto'
    // 强制回流以让浏览器按 auto 重新计算 scrollHeight
    void el.offsetHeight
    const scrollH = el.scrollHeight

    const nextHeight = Math.max(minHeight, Math.min(scrollH, maxHeight))
    el.style.height = `${nextHeight}px`

    // 滚动条统一交给 CSS（scrollbar-width: none + ::-webkit-scrollbar { display: none }），
    // 这里不要再去切换 overflowY，避免 inline style 跟 CSS 互相覆盖
    requestAnimationFrame(() => {
      el.style.transition = prevTransition || ''
      // 防御性：保证 height 永远不是空 / auto
      if (el.style.height === 'auto' || el.style.height === '') {
        el.style.height = prevHeight || `${minHeight}px`
      }
    })
  }, [manualExpanded, value])

  useEffect(() => {
    const el = textareaRef.current
    if (el == null) return

    const bucketChanged = lastFocusedDraftBucketRef.current !== draftBucketKey
    lastFocusedDraftBucketRef.current = draftBucketKey
    if (!bucketChanged) return

    requestAnimationFrame(() => {
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }, [draftBucketKey])

  const dispatchMessage = useCallback(
    async (text: string, turnAttachments: ComposerAttachment[]) => {
      const requestAttachments = toSessionAttachments(turnAttachments)
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
              ...(selectedProvider?.id !== undefined
                ? { providerProfileId: selectedProvider.id }
                : {}),
              modelId: effectiveModelId,
              agentId: effectiveAgentId,
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
            await flushPendingRuntimePatch()
            const sendRes = await sendTurn({
              sessionId,
              message: text,
              ...(requestAttachments.length > 0 ? { attachments: requestAttachments } : {}),
              ...getCurrentRuntimePatch(),
              ...(teamConfig.enabled ? { teamConfig, agentId: teamConfig.hostAgentId } : {}),
          ...(teamConfig.enabled &&
          pendingMention != null &&
          text.includes(`@${pendingMention.name}`) &&
          pendingMention.agentId !== teamConfig.hostAgentId
            ? { mentionAgentId: pendingMention.agentId }
            : {}),
            })
            if (!sendRes.started) {
              setQueueVisible(true)
              toast.info('上一条任务仍在执行，消息已加入队列。')
            } else if (queuedMessages.length === 0) {
              setQueueVisible(false)
            }
            await refreshQueueState(sessionId)
            onSent(sessionId)
            return
          }
          // 命令结果已通过事件流注入到聊天中，无需 Toast
          if (res.session != null) onCommandComplete(res.session)
          await refreshQueueState(sessionId)
          if (res.started === true) onSent(sessionId)
        } catch (err) {
          console.error('命令执行失败', err)
          toast.error(err instanceof Error ? err.message : '命令执行失败')
          setValue(text)
          setAttachments(turnAttachments)
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
            ...(selectedProvider?.id !== undefined
              ? { providerProfileId: selectedProvider.id }
              : {}),
            modelId: effectiveModelId,
            agentId: effectiveAgentId,
            agentAdapter: adapter,
            permissionMode: effectivePermissionMode,
            chatMode: effectiveMode,
            reasoningEffort: effectiveReasoning,
          })
        }
        if (targetSessionId == null) throw new Error('请先选择项目并配置供应商')
        await flushPendingRuntimePatch()
        const res = await sendTurn({
          sessionId: targetSessionId,
          message: text,
          ...(requestAttachments.length > 0 ? { attachments: requestAttachments } : {}),
          ...getCurrentRuntimePatch(),
          ...(teamConfig.enabled ? { teamConfig, agentId: teamConfig.hostAgentId } : {}),
          ...(teamConfig.enabled &&
          pendingMention != null &&
          text.includes(`@${pendingMention.name}`) &&
          pendingMention.agentId !== teamConfig.hostAgentId
            ? { mentionAgentId: pendingMention.agentId }
            : {}),
        })
        if (!res.started) {
          setQueueVisible(true)
          toast.info('上一条任务仍在执行，消息已加入队列。')
        } else if (queuedMessages.length === 0) {
          setQueueVisible(false)
        }
        await refreshQueueState(targetSessionId)
        onSent(targetSessionId)
      } catch (err) {
        console.error('发送失败', err)
        toast.error(err instanceof Error ? err.message : '发送消息失败')
        setValue(text)
        setAttachments(turnAttachments)
      } finally {
        setSending(false)
      }
    },
    [
      adapter,
      effectiveMode,
      effectiveModelId,
      effectivePermissionMode,
      effectiveReasoning,
      flushPendingRuntimePatch,
      getCurrentRuntimePatch,
      onCreateSession,
      onCommandComplete,
      onSent,
      refreshQueueState,
      selectedProvider,
      sendTurn,
      session?.id,
      setAttachments,
      setValue,
      teamConfig,
      toast,
      pendingMention,
    ],
  )

  const appendAttachments = useCallback((nextAttachments: ComposerAttachment[]) => {
    let truncated = false
    let added = 0
    setAttachments((current) => {
      const byPath = new Map(current.map((attachment) => [attachment.path, attachment]))
      for (const attachment of nextAttachments) {
        if (byPath.size >= 20) {
          truncated = true
          break
        }
        if (byPath.has(attachment.path)) continue
        byPath.set(attachment.path, attachment)
        added += 1
      }
      return Array.from(byPath.values())
    })
    if (truncated) toast.info('单轮最多添加 20 个附件。')
    return added
  }, [setAttachments, toast])

  const handleAddAttachments = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        title: '添加文件或图片',
        multiple: true,
      })
      const filePaths = selected.filePaths ?? (selected.filePath != null ? [selected.filePath] : [])
      if (selected.canceled || filePaths.length === 0) return
      const newAttachments = await Promise.all(
        filePaths.map(async (filePath, index) => {
          const type = isImageAttachmentPath(filePath) ? 'image' : 'file'
          const base: ComposerAttachment = {
            id: `${Date.now()}-${index}-${filePath}`,
            type,
            path: filePath,
            name: getFileNameFromPath(filePath),
          }
          if (type !== 'image') return base
          try {
            const preview = await prepareImagePreview({ sourcePath: filePath })
            return { ...base, previewPath: preview.filePath, previewUrl: preview.fileUrl }
          } catch {
            return base
          }
        }),
      )
      appendAttachments(newAttachments)
    } catch (err) {
      console.error('添加附件失败', err)
      toast.error(err instanceof Error ? err.message : '添加附件失败')
    }
  }, [appendAttachments, openFileDialog, prepareImagePreview, toast])

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? [])
      const imageItems = items.filter((item) => item.type.startsWith('image/'))
      if (imageItems.length === 0) return

      event.preventDefault()
      try {
        const pastedAttachmentsRaw = await Promise.all(
          imageItems.map(async (item, index) => {
            const file = item.getAsFile()
            if (file == null) return null
            const dataUrl = await readBlobAsDataUrl(file)
            const result = await savePastedImage({
              dataUrl,
              suggestedBaseName: `pasted-image-${index + 1}`,
              ...(file.type ? { mimeType: file.type } : {}),
            })
            return {
              id: `${Date.now()}-${index}-${result.filePath}`,
              type: 'image' as const,
              path: result.filePath,
              name: result.fileName,
              previewPath: result.filePath,
              previewUrl: resolveComposerImageSrc(result.filePath),
            }
          }),
        )
        const pastedAttachments: ComposerAttachment[] = pastedAttachmentsRaw.filter(
          (attachment): attachment is NonNullable<(typeof pastedAttachmentsRaw)[number]> =>
            attachment != null,
        )

        const added = appendAttachments(pastedAttachments)
        if (added > 0) toast.success(`已粘贴 ${added} 张图片`)
      } catch (err) {
        console.error('粘贴图片失败', err)
        toast.error(err instanceof Error ? err.message : '粘贴图片失败')
      }
    },
    [appendAttachments, savePastedImage, toast],
  )

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      setAttachments((current) => current.filter((attachment) => attachment.id !== id))
    },
    [setAttachments],
  )

  const handleSend = async () => {
    if (!canSubmit) return
    setTextEditMenu(null)
    const text = value.trim() || '请查看附件。'
    const turnAttachments = attachments
    // Record to input history (deduplicate consecutive identical entries)
    const history = sentHistoryRef.current
    if (text !== history[history.length - 1]) {
      history.push(text)
    }
    historyIndexRef.current = -1
    historyDraftRef.current = ''
    setValue('')
    setAttachments([])
    // 发送后清除 pending mention（避免下一条消息误带）；dispatchMessage 内已通过 text 计算用过
    setPendingMention(null)
    await dispatchMessage(text, turnAttachments)
  }

  const handlePrimaryAction = async () => {
    if (isWorking) {
      await handleCancelActiveSession()
      return
    }
    await handleSend()
  }

  const handleRemoveQueuedMessage = async (message: QueuedMessage) => {
    if (session?.id == null) return
    const res = await cancelQueuedTurn({ sessionId: session.id, turnId: message.turnId })
    setQueuedMessages(
      res.queuedTurns.map((turn) => ({
        id: turn.turnId,
        turnId: turn.turnId,
        content: turn.message,
        enqueuedAt: turn.enqueuedAt,
      })),
    )
  }

  const handleSendQueuedNow = async (message: QueuedMessage) => {
    if (session?.id == null) return
    const res = await sendQueuedTurnNow({ sessionId: session.id, turnId: message.turnId })
    setQueuedMessages(
      res.queuedTurns.map((turn) => ({
        id: turn.turnId,
        turnId: turn.turnId,
        content: turn.message,
        enqueuedAt: turn.enqueuedAt,
      })),
    )
    if (res.started) {
      onSent(session.id)
    }
  }

  const handleCancelActiveSession = async () => {
    if (session?.id == null) return
    await onCancelSession(session.id)
  }

  const filteredSlashCmds = slashCmds.filter((cmd) => {
    if (!slashFilter) return true
    const q = slashFilter.toLowerCase()
    return (
      cmd.name.includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.aliases.some((a) => a.includes(q))
    )
  })

  const SLASH_GROUP_LABELS: Record<string, string> = {
    session: '会话',
    model: '模型',
    context: '上下文',
    permission: '权限',
    git: 'Git',
    workflow: '工作流',
    agent: 'Agent',
    mcp: 'MCP',
    skill: '技能',
    resource: '资源',
    team: '团队',
    utility: '工具',
    system: '系统',
  }
  const SLASH_GROUP_ORDER = [
    'session',
    'model',
    'context',
    'permission',
    'git',
    'workflow',
    'agent',
    'mcp',
    'skill',
    'resource',
    'team',
    'utility',
    'system',
  ]

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
  const selectSlashCmd = useCallback(
    (cmd: CommandListItem) => {
      closeSlashPopup()
      setValue(`/${cmd.name} `)
    },
    [closeSlashPopup, setValue],
  )

  // ── Mention 候选构造：Host 优先，其次启用的 Members ──
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!teamConfig.enabled) return []
    const list: MentionCandidate[] = []
    const hostAgent = agents.find((a) => a.id === teamConfig.hostAgentId)
    if (hostAgent != null) {
      list.push({
        agentId: hostAgent.id,
        name: hostAgent.name,
        description: hostAgent.description ?? '',
        isHost: true,
        avatarSrc: resolveAvatarSrc(
          getAgentAvatarConfig(hostAgent.metadata, hostAgent.id, hostAgent.name),
        ),
        builtIn: hostAgent.builtIn,
      })
    }
    for (const memberId of teamConfig.memberAgentIds) {
      if (memberId === teamConfig.hostAgentId) continue
      const m = agents.find((a) => a.id === memberId)
      if (m == null) continue
      list.push({
        agentId: m.id,
        name: m.name,
        description: m.description ?? '',
        isHost: false,
        avatarSrc: resolveAvatarSrc(getAgentAvatarConfig(m.metadata, m.id, m.name)),
        builtIn: m.builtIn,
      })
    }
    return list
  }, [teamConfig.enabled, teamConfig.hostAgentId, teamConfig.memberAgentIds, agents])

  // 过滤后的候选列表（用于键盘导航边界）
  const filteredMentionCandidates = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    if (q.length === 0) return mentionCandidates
    return mentionCandidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.agentId.toLowerCase().includes(q),
    )
  }, [mentionCandidates, mentionQuery])

  const closeMentionPopup = useCallback(() => {
    setMentionOpen(false)
    setMentionQuery('')
    setMentionIndex(0)
    mentionStartRef.current = -1
  }, [])

  /**
   * 计算 textarea 中指定字符索引的视口坐标（用于 mention popover 定位）。
   * 用一个不可见的镜像 div 复刻 textarea 的字体/边距/换行，把字符放进 <span>，取其 rect。
   */
  const computeCaretViewportPosition = useCallback(
    (textarea: HTMLTextAreaElement, charIndex: number): { left: number; top: number } => {
      const taRect = textarea.getBoundingClientRect()
      const style = window.getComputedStyle(textarea)
      const mirror = document.createElement('div')
      const props = [
        'boxSizing',
        'width',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'lineHeight',
        'letterSpacing',
        'textTransform',
        'whiteSpace',
        'wordBreak',
        'wordSpacing',
      ] as const
      for (const p of props) {
        const v = style[p as never] as unknown as string | undefined
        mirror.style[p as never] = (v ?? '') as never
      }
      mirror.style.position = 'absolute'
      mirror.style.top = '-9999px'
      mirror.style.left = '-9999px'
      mirror.style.visibility = 'hidden'
      mirror.style.whiteSpace = 'pre-wrap'
      mirror.style.wordWrap = 'break-word'
      mirror.style.overflowWrap = 'break-word'
      mirror.style.overflow = 'hidden'
      mirror.style.height = 'auto'

      const before = textarea.value.slice(0, charIndex)
      const marker = document.createElement('span')
      marker.textContent = '​'
      mirror.appendChild(document.createTextNode(before))
      mirror.appendChild(marker)
      mirror.appendChild(document.createTextNode(textarea.value.slice(charIndex) || ' '))
      document.body.appendChild(mirror)

      const markerRect = marker.getBoundingClientRect()
      const mirrorRect = mirror.getBoundingClientRect()
      // 把 mirror 内的相对偏移映射回 textarea 视口位置（减去 mirror 偏移再加上 textarea 偏移，
      // 并对 textarea 滚动量做修正）
      const left = taRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft
      const top = taRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop + markerRect.height + 4
      document.body.removeChild(mirror)
      return { left, top }
    },
    [],
  )

  const handleValueChange = useCallback(
    (next: string) => {
      setTextEditMenu(null)
      setValue(next)
      // Reset history browsing when user types manually
      historyIndexRef.current = -1
      if (next.startsWith('/')) {
        setSlashFilter(next.slice(1))
        void openSlashPopup()
      } else {
        if (slashOpen) closeSlashPopup()
      }

      // ── Mention 检测：仅团队模式启用时生效 ──
      if (!teamConfig.enabled) {
        if (mentionOpen) closeMentionPopup()
        return
      }
      const el = textareaRef.current
      if (el == null) return
      const caret = el.selectionStart ?? next.length
      // 从光标向前找最近的 `@`，要求其前面是行首/空白；中间不能含空白
      const upto = next.slice(0, caret)
      const match = upto.match(/(?:^|\s)@([^\s@]*)$/)
      if (match == null) {
        if (mentionOpen) closeMentionPopup()
        return
      }
      const queryPart = match[1] ?? ''
      // `@` 索引：upto 末端往前数 1 + queryPart.length
      const atIndex = upto.length - 1 - queryPart.length
      mentionStartRef.current = atIndex
      setMentionQuery(queryPart)
      setMentionIndex(0)
      // 计算 caret 坐标并打开浮层
      try {
        const pos = computeCaretViewportPosition(el, atIndex)
        setMentionAnchor(pos)
      } catch {
        // 镜像 div 偶发失败时退化为 textarea 左下角
        const r = el.getBoundingClientRect()
        setMentionAnchor({ left: r.left, top: r.bottom + 4 })
      }
      setMentionOpen(true)
    },
    [
      setValue,
      slashOpen,
      openSlashPopup,
      closeSlashPopup,
      teamConfig.enabled,
      mentionOpen,
      closeMentionPopup,
      computeCaretViewportPosition,
    ],
  )

  /** 用户选中候选 Agent：用 `@<name> ` 替换 `@<query>` 段，并记录 pendingMention */
  const handleMentionSelect = useCallback(
    (candidate: MentionCandidate) => {
      const el = textareaRef.current
      const atIndex = mentionStartRef.current
      if (el == null || atIndex < 0) {
        closeMentionPopup()
        return
      }
      const before = value.slice(0, atIndex)
      const afterStart = atIndex + 1 + mentionQuery.length
      const after = value.slice(afterStart)
      const insertText = `@${candidate.name} `
      const nextValue = `${before}${insertText}${after}`
      setValue(nextValue)
      setPendingMention({ agentId: candidate.agentId, name: candidate.name })
      closeMentionPopup()
      // 把光标移到 mention 后
      requestAnimationFrame(() => {
        const el2 = textareaRef.current
        if (el2 == null) return
        const caretPos = before.length + insertText.length
        el2.focus()
        el2.setSelectionRange(caretPos, caretPos)
      })
    },
    [value, mentionQuery, setValue, closeMentionPopup],
  )

  const handleTextContextMenu = useCallback((event: React.MouseEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    setTextEditMenu({
      x: event.clientX,
      y: event.clientY,
      target,
      hasSelection: end > start,
      isEditable: !target.disabled && !target.readOnly,
    })
  }, [])

  // scroll selected item into view
  useEffect(() => {
    if (!slashOpen) return
    const el = slashListRef.current?.querySelector<HTMLElement>('.slash-cmd-item.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [slashIndex, slashOpen])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
    if (nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return

    // ── Mention popup navigation（优先级高于 Slash，因 @ 弹窗只在团队模式生效） ──
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, Math.max(0, filteredMentionCandidates.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMentionPopup()
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        if (filteredMentionCandidates.length > 0) {
          event.preventDefault()
          const candidate = filteredMentionCandidates[mentionIndex] ?? filteredMentionCandidates[0]
          if (candidate != null) handleMentionSelect(candidate)
          return
        }
        closeMentionPopup()
      }
    }

    // ── Slash command popup navigation ──
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

    // ── Shift+Tab: cycle permission mode ──
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      const idx = permissionOptions.findIndex((o) => o.value === effectivePermissionMode)
      if (idx !== -1) {
        const nextOption = permissionOptions[(idx + 1) % permissionOptions.length]!
        const nextMode = nextOption.value
        setDraftPermissionMode(nextMode)
        writeComposerPrefs({ permissionMode: nextMode })
        if (session != null) void persistRuntimePatch({ permissionMode: nextMode })
        toast.info(`权限模式: ${nextOption.label}`)
      }
      return
    }

    // ── ↑↓ input history navigation (only when input is empty or matches a history entry) ──
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const history = sentHistoryRef.current
      if (history.length === 0) return // let native cursor movement work

      const el = textareaRef.current
      const atStart = el != null && el.selectionStart === 0 && el.selectionEnd === 0
      const atEnd = el != null && el.selectionStart === el.value.length && el.selectionEnd === el.value.length

      if (event.key === 'ArrowUp' && atStart) {
        event.preventDefault()
        const currentIdx = historyIndexRef.current
        // Save draft on first entry into history
        if (currentIdx === -1) {
          historyDraftRef.current = value
        }
        const nextIdx = currentIdx + 1
        if (nextIdx < history.length) {
          historyIndexRef.current = nextIdx
          setValue(history[history.length - 1 - nextIdx] ?? '')
        }
        return
      }

      if (event.key === 'ArrowDown' && atEnd) {
        const currentIdx = historyIndexRef.current
        if (currentIdx === -1) return // not browsing history, let native work
        event.preventDefault()
        const prevIdx = currentIdx - 1
        if (prevIdx >= 0) {
          historyIndexRef.current = prevIdx
          setValue(history[history.length - 1 - prevIdx] ?? '')
        } else {
          // Restored to bottom — show the saved draft (or empty)
          historyIndexRef.current = -1
          setValue(historyDraftRef.current)
        }
        return
      }
    }

    // ── Escape: double-press to interrupt generation ──
    if (event.key === 'Escape') {
      const isBusy = sending || isWorking
      if (isBusy && session?.id != null) {
        const now = Date.now()
        const elapsed = now - escapeTimestampRef.current
        if (escapeConfirm && elapsed < 3000) {
          // Second press — actually cancel
          setEscapeConfirm(false)
          escapeTimestampRef.current = 0
          void handleCancelActiveSession()
        } else {
          // First press — show confirmation hint
          setEscapeConfirm(true)
          escapeTimestampRef.current = now
          toast.info('再按一次 Escape 中断生成')
        }
        event.preventDefault()
        return
      }
      // Not busy — dismiss escape confirm if shown
      if (escapeConfirm) setEscapeConfirm(false)
    }

    // ── Enter: send message ──
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  // Auto-dismiss Escape confirmation after 3 seconds
  useEffect(() => {
    if (!escapeConfirm) return
    const timer = setTimeout(() => setEscapeConfirm(false), 3000)
    return () => clearTimeout(timer)
  }, [escapeConfirm])

  // React to Ctrl/Cmd+L focus trigger from global shortcut
  useEffect(() => {
    if (focusTrigger === 0) return
    textareaRef.current?.focus()
  }, [focusTrigger])

  const handleProviderChange = async (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId)
    if (provider == null) return
    const nextAdapter = getProviderAdapterKind(provider)
    const nextPermissionMode = getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask'
    setDraftAdapter(nextAdapter)
    setDraftPermissionMode(nextPermissionMode)
    setSelectedProviderId(providerId)
    const nextModel = provider.defaultModel || provider.modelIds[0] || ''
    setDraftModelId(nextModel)
    writeComposerPrefs({
      adapter: nextAdapter,
      providerProfileId: providerId,
      modelId: nextModel,
      permissionMode: nextPermissionMode,
    })
    if (session != null) {
      await persistRuntimePatch({
        providerProfileId: providerId,
        modelId: nextModel || null,
        agentAdapter: nextAdapter,
        permissionMode: nextPermissionMode,
      })
    }
  }

  const handleProviderModelChange = async (providerId: string, modelId: string) => {
    const provider = providers.find((item) => item.id === providerId)
    if (provider == null) return
    const nextAdapter = getProviderAdapterKind(provider)
    const nextPermissionMode =
      adapter === nextAdapter
        ? effectivePermissionMode
        : (getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask')
    const nextModel =
      normalizeModelForProvider(modelId, provider) ||
      provider.defaultModel ||
      provider.modelIds[0] ||
      modelId

    setDraftAdapter(nextAdapter)
    setDraftPermissionMode(nextPermissionMode)
    setSelectedProviderId(providerId)
    setDraftModelId(nextModel)
    writeComposerPrefs({
      adapter: nextAdapter,
      providerProfileId: providerId,
      modelId: nextModel,
      permissionMode: nextPermissionMode,
    })
    if (session != null) {
      await persistRuntimePatch({
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
    const nextPermissionMode = getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask'
    setDraftPermissionMode(nextPermissionMode)
    const nextProvider = providers.find(
      (provider) => getProviderAdapterKind(provider) === nextAdapter,
    )
    if (nextProvider != null) {
      const nextModel = nextProvider.defaultModel || nextProvider.modelIds[0] || ''
      setSelectedProviderId(nextProvider.id)
      setDraftModelId(nextModel)
      writeComposerPrefs({
        adapter: nextAdapter,
        providerProfileId: nextProvider.id,
        modelId: nextModel,
        permissionMode: nextPermissionMode,
      })
      if (session != null) {
        await persistRuntimePatch({
          providerProfileId: nextProvider.id,
          modelId: nextModel || null,
          agentAdapter: nextAdapter,
          permissionMode: nextPermissionMode,
        })
      }
      return
    }
    writeComposerPrefs({ adapter: nextAdapter, permissionMode: nextPermissionMode })
    if (session != null)
      await persistRuntimePatch({ agentAdapter: nextAdapter, permissionMode: nextPermissionMode })
  }

  const handleAgentChange = async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId)
    if (agent == null) return
    setDraftAgentId(agent.id)
    setDraftAdapter(agent.agentAdapter)
    setDraftPermissionMode(agent.permissionMode)
    setDraftReasoning(agent.reasoningEffort)

    const provider =
      providers.find((item) => item.id === agent.providerProfileId) ??
      getPreferredProvider(providers, { ...readComposerPrefs(), agentId: agent.id }, agent.agentAdapter)
    const model = agent.modelId ?? provider?.defaultModel ?? provider?.modelIds[0] ?? ''
    if (provider != null) setSelectedProviderId(provider.id)
    setDraftModelId(model)
    writeComposerPrefs({
      agentId: agent.id,
      adapter: agent.agentAdapter,
      ...(provider?.id !== undefined ? { providerProfileId: provider.id } : {}),
      modelId: model,
      permissionMode: agent.permissionMode,
      reasoningEffort: agent.reasoningEffort,
    })
    if (session != null) {
      await persistRuntimePatch({
        agentId: agent.id,
        ...(provider != null ? { providerProfileId: provider.id } : {}),
        modelId: model || null,
        agentAdapter: agent.agentAdapter,
        permissionMode: agent.permissionMode,
        reasoningEffort: agent.reasoningEffort,
      })
    }
  }

  const handleModelChange = async (modelId: string) => {
    setDraftModelId(modelId)
    writeComposerPrefs({
      ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
      modelId,
    })
    if (session != null) await persistRuntimePatch({ modelId })
  }

  const handleReasoningChange = async (reasoningEffort: SessionReasoningEffort) => {
    setDraftReasoning(reasoningEffort)
    writeComposerPrefs({ reasoningEffort })
    if (session != null) await persistRuntimePatch({ reasoningEffort })
  }

  const branchOptions = (
    branchState.branches.length > 0 ? branchState.branches : [branchState.currentBranch ?? '']
  )
    .filter((branch): branch is string => branch.length > 0)
    .map((branch) => ({ value: branch, label: branch }))
  const showBranchSelect = branchOptions.length > 0 && branchState.currentBranch != null
  const visibleApprovalRequest =
    approvalRequest != null && !isControlApprovalRequest(approvalRequest) ? approvalRequest : null
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image')
  const fileAttachments = attachments.filter((attachment) => attachment.type === 'file')

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        {visibleApprovalRequest && (
          <InlineApprovalRequest
            request={visibleApprovalRequest}
            {...(
              onApprovalClose !== undefined
                ? {
                    onClose: () =>
                      onApprovalClose(
                        visibleApprovalRequest.sessionId,
                        visibleApprovalRequest.requestId,
                      ),
                  }
                : {}
            )}
          />
        )}
        {showTaskQueue && queueVisible && (
          <div className="composer-queue-panel">
            {queuedMessages.map((message) => (
              <div key={message.id} className="composer-queue-item">
                <Icons.Clock size={15} className="composer-queue-icon" />
                <span className="composer-queue-text">{message.content}</span>
                <button
                  type="button"
                  className="composer-queue-icon-btn composer-queue-send-btn"
                  title="立即执行"
                  onClick={() => void handleSendQueuedNow(message)}
                >
                  <Icons.Send size={14} />
                </button>
                <button
                  type="button"
                  className="composer-queue-icon-btn"
                  title="移除"
                  onClick={() => void handleRemoveQueuedMessage(message)}
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
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectSlashCmd(cmd)
                        }}
                      >
                        <span className={`slash-cmd-layer layer-${cmd.layer}`}>
                          {cmd.layer === 'sdk' ? 'SDK' : cmd.layer === 'skill' ? '技能' : '内置'}
                        </span>
                        <span className="slash-cmd-name">/{cmd.name}</span>
                        {cmd.aliases.length > 0 && (
                          <span className="slash-cmd-aliases">
                            {cmd.aliases.map((a) => `/${a}`).join(' ')}
                          </span>
                        )}
                        <span className="slash-cmd-desc">{cmd.description}</span>
                        {cmd.risk === 'high' && <span className="slash-cmd-risk high">危险</span>}
                        {cmd.risk === 'medium' && (
                          <span className="slash-cmd-risk medium">注意</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            })()}
          </div>
        )}
        {previewAttachment != null && (
          <ImagePreviewModal
            src={resolveComposerImageSrc(previewAttachment.previewPath ?? previewAttachment.path)}
            alt={previewAttachment.name}
            fileName={previewAttachment.name}
            onClose={() => setPreviewAttachment(null)}
          />
        )}
        <div
          className={`composer composer-v2 has-workspace-picks ${manualExpanded ? 'expanded' : ''}`}
        >
          {(imageAttachments.length > 0 || fileAttachments.length > 0) && (
            <div className="composer-attachments-inside">
              {imageAttachments.length > 0 && (
                <div className="composer-attachment-gallery">
                  {imageAttachments.map((attachment) => (
                    <ComposerImageCard
                      key={attachment.id}
                      attachment={attachment}
                      onPreview={() => setPreviewAttachment(attachment)}
                      onRemove={() => handleRemoveAttachment(attachment.id)}
                    />
                  ))}
                </div>
              )}
              {fileAttachments.length > 0 && (
                <div className="composer-attachment-strip">
                  {fileAttachments.map((attachment) => (
                    <div key={attachment.id} className="composer-attachment-chip">
                      <Icons.File size={13} />
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        title="移除附件"
                        onClick={() => handleRemoveAttachment(attachment.id)}
                      >
                        <Icons.X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <textarea
            className="composer-input"
            ref={textareaRef}
            rows={1}
            placeholder="询问、修改、运行任务…  ↵ 发送"
            value={value}
            onChange={(event) => handleValueChange(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
            onPaste={(event) => {
              void handlePaste(event)
            }}
            onKeyDown={handleKeyDown}
            onContextMenu={handleTextContextMenu}
            onBlur={() => {
              // 失焦时延迟关闭 mention 弹窗，让 onClick 先执行
              setTimeout(() => closeMentionPopup(), 150)
            }}
          />
          {textEditMenu != null && (
            <TextEditContextMenu
              menu={textEditMenu}
              onClose={() => setTextEditMenu(null)}
            />
          )}
          <MentionPopover
            open={mentionOpen && filteredMentionCandidates.length > 0 && teamConfig.enabled}
            anchor={mentionAnchor}
            query={mentionQuery}
            candidates={mentionCandidates}
            activeIndex={mentionIndex}
            onHover={setMentionIndex}
            onSelect={handleMentionSelect}
          />
          <button
            className="composer-expand-btn"
            title={manualExpanded ? '折叠输入框' : '展开输入框'}
            onClick={() => setManualExpanded((prev) => !prev)}
          >
            {manualExpanded ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
          </button>
          <div className="composer-submit-row">
            <div className="composer-submit-picks">
              <ProviderModelPicker
                icon={<ModelIcon />}
                providers={compatibleProviders}
                selectedProviderId={selectedProvider?.id ?? ''}
                selectedModelId={effectiveModelId}
                disabled={isBusy || compatibleProviders.length === 0}
                onChange={handleProviderModelChange}
              />
              {showProjectPicker && (
                <ProjectPicker
                  workspaces={workspaces}
                  activeWorkspaceId={activeWorkspaceId}
                  {...(onPickProject !== undefined ? { onPickProject } : {})}
                  {...(onUseNoProject !== undefined ? { onUseNoProject } : {})}
                  {...(onSwitchWorkspace !== undefined ? { onSwitchWorkspace } : {})}
                />
              )}
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
            </div>
            <button
              className={`composer-send-round ${sending ? 'is-sending' : ''} ${isWorking ? 'is-stopping' : ''}`}
              title={isWorking ? '停止会话' : '发送'}
              onClick={() => void handlePrimaryAction()}
              disabled={isWorking ? session?.id == null : !canSubmit}
            >
              {sending ? (
                <Icons.Spinner size={14} />
              ) : isWorking ? (
                <Icons.Stop size={11} />
              ) : (
                <Icons.ArrowUp size={16} />
              )}
            </button>
          </div>
        </div>
        <div className="composer-param-bar composer-controls">
          <button
            type="button"
            className="icon-btn"
            title="添加文件或图片"
            onClick={() => void handleAddAttachments()}
          >
            <Icons.Upload />
          </button>
          <AgentPicker
            agents={agents}
            selectedAgentId={effectiveAgentId}
            onChange={(agentId) => void handleAgentChange(agentId)}
            teamConfig={teamConfig}
            onEnableTeamMode={() =>
              onChangeTeamConfig({ enabled: true, hostAgentId: effectiveAgentId, teamId: undefined })
            }
            onDisableTeamMode={() =>
              onChangeTeamConfig({ enabled: false, teamId: undefined })
            }
            onChangeHost={(agentId) =>
              onChangeTeamConfig({ hostAgentId: agentId, teamId: undefined })
            }
            onOpenMembers={onOpenTeamInspector}
            onApplyTeam={(team) =>
              onChangeTeamConfig({
                enabled: true,
                hostAgentId: team.hostAgentId,
                memberAgentIds: team.memberAgentIds,
                maxDepth: team.maxDepth,
                allowNesting: team.allowNesting,
                teamId: team.id,
              })
            }
            disabled={isBusy}
          />
          <ComposerMenuSelect
            icon={
              activePermissionOption?.tone === 'danger' ? (
                <Icons.AlertTriangle size={13} />
              ) : activePermissionOption?.tone === 'auto' ? (
                <Icons.Zap size={13} />
              ) : (
                <Icons.Shield size={13} />
              )
            }
            value={effectivePermissionMode}
            label={activePermissionOption?.label ?? '默认权限'}
            title="权限模式"
            tone={activePermissionOption?.tone ?? 'default'}
            disabled={isBusy}
            onChange={(mode) => {
              const permissionMode = mode as PermissionModeChoice
              setDraftPermissionMode(permissionMode)
              writeComposerPrefs({ permissionMode })
              if (session != null) void persistRuntimePatch({ permissionMode })
            }}
            options={permissionOptions}
          />
          <ComposerMenuSelect
            icon={<Icons.Brain size={13} />}
            value={effectiveReasoning}
            label={
              getReasoningOptions(adapter).find((option) => option.value === effectiveReasoning)
                ?.label ?? effectiveReasoning
            }
            title="推理强度"
            disabled={isBusy}
            onChange={(reasoning) => handleReasoningChange(reasoning as SessionReasoningEffort)}
            options={getReasoningOptions(adapter)}
          />
          {contextWindow > 0 && (
            <ContextMeterWithPopup
              contextRatio={contextRatio}
              contextUsedTokens={contextUsedTokens}
              contextWindow={contextWindow}
              compactedThisTurn={contextUsage?.compactedThisTurn ?? false}
              isBusy={isBusy}
              sessionId={session?.id ?? null}
              onCreateSession={onCreateSession}
              selectedProvider={selectedProvider}
              effectiveModelId={effectiveModelId}
              adapter={adapter}
              effectivePermissionMode={effectivePermissionMode}
              onSent={onSent}
              toast={toast}
            />
          )}
          {showTaskQueue && (
            <button
              type="button"
              className="queued-chip"
              title={queueVisible ? '隐藏队列' : '显示队列'}
              onClick={() => setQueueVisible((prev) => !prev)}
            >
              {queueVisible ? '隐藏队列' : '显示队列'} ·{' '}
              {queuedMessages.length}
            </button>
          )}
          <div className="spacer" />
          <span className="composer-hint">
            <span className="kbd">↵</span> 发送 &nbsp;<span className="kbd">⇧↵</span> 换行 &nbsp;<span className="kbd">⇧Tab</span> 权限 &nbsp;<span className="kbd">↑↓</span> 历史
          </span>
          <button
            className="btn primary sm composer-send-btn"
            onClick={() => void handleSend()}
            disabled={!canSubmit}
          >
            {sending ? (
              <Icons.Spinner size={12} />
            ) : isBusy ? (
              <Icons.Clock size={12} />
            ) : (
              <Icons.Send size={12} />
            )}
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
  tone = 'default',
  onChange,
}: {
  icon: ReactNode
  value: string
  label: string
  options: ComposerMenuOption[]
  title: string
  disabled?: boolean
  align?: 'left' | 'right'
  tone?: ComposerOptionTone
  onChange: (value: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-menu-select tone-${tone} ${align === 'right' ? 'right' : ''}${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : title}
    >
      <span className="composer-select-icon">{icon}</span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || options.length === 0}
        title={disabled ? '会话运行中不可切换' : undefined}
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
              className={`composer-menu-item tone-${option.tone ?? 'default'} ${option.value === value ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                void onChange(option.value)
              }}
            >
              <span className="composer-menu-item-copy">
                <span className="composer-menu-item-label">
                  {option.tone === 'danger' && <Icons.AlertTriangle size={13} />}
                  {option.tone === 'auto' && <Icons.Zap size={13} />}
                  <span>{option.label}</span>
                </span>
                {option.description != null && (
                  <span className="composer-menu-item-desc">{option.description}</span>
                )}
              </span>
              {option.value === value && <Icons.Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * ProjectPicker — 项目选择器（下拉）
 * 位置：输入框内部右下角，靠近发送按钮
 * 下拉内容：
 *   - "最近" 分组：用户最近的项目（最多 5 个），当前选中的打勾
 *   - "选择新项目"：从文件夹选择
 *   - "不需要项目"：使用临时会话目录（"不使用项目" workspace）
 * 显示：
 *   - 选中某项目：显示该项目名（带文件夹图标）
 *   - 选中"不需要项目"：显示"不需要项目"（带叉号图标）
 *   - 没选：显示"选择项目"（带加号图标）
 */
function ProjectPicker({
  workspaces,
  activeWorkspaceId,
  onPickProject,
  onUseNoProject,
  onSwitchWorkspace,
}: {
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
  onPickProject?: () => void
  onUseNoProject?: () => void
  onSwitchWorkspace?: (workspaceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  // 最近项目：按更新时间倒序，最多 5 个，且不包括 "不使用项目"
  const recent = useMemo(() => {
    return workspaces
      .filter((w) => w.name !== NO_PROJECT_WORKSPACE_NAME)
      .sort((a, b) => {
        const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
        const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime()
        return tb - ta
      })
      .slice(0, 5)
  }, [workspaces])

  const noProjectWorkspace = workspaces.find((w) => w.name === NO_PROJECT_WORKSPACE_NAME) ?? null
  const isNoProject = activeWorkspaceId != null && noProjectWorkspace?.id === activeWorkspaceId
  const selectedProject = isNoProject
    ? null
    : workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  const triggerLabel = selectedProject?.name ?? (isNoProject ? NO_PROJECT_WORKSPACE_NAME : '选择项目')
  const triggerIcon = selectedProject ? (
    <Icons.Folder size={13} />
  ) : isNoProject ? (
    <Icons.FolderX size={13} />
  ) : (
    <Icons.Plus size={13} />
  )
  const triggerTitle = selectedProject
    ? `项目：${selectedProject.name}\n${selectedProject.rootPath}`
    : isNoProject
      ? '当前不使用项目，session 数据走临时目录'
      : '选择项目'

  return (
    <div
      ref={rootRef}
      className="composer-select composer-project-picker"
      title={triggerTitle}
    >
      <span className="composer-select-icon">{triggerIcon}</span>
      <button
        type="button"
        className="composer-select-trigger"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{triggerLabel}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-project-menu right">
          {recent.length > 0 && (
            <>
              <div className="composer-project-group-header">最近</div>
              {recent.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`composer-menu-item${selectedProject?.id === w.id ? ' active' : ''}`}
                  onClick={() => {
                    setOpen(false)
                    onSwitchWorkspace?.(w.id)
                  }}
                >
                  <span className="composer-menu-item-copy">
                    <span className="composer-menu-item-label">
                      <Icons.Folder size={13} />
                      <span>{w.name}</span>
                    </span>
                  </span>
                  {selectedProject?.id === w.id && <Icons.Check size={14} />}
                </button>
              ))}
              <div className="composer-project-divider" />
            </>
          )}
          <button
            type="button"
            className="composer-menu-item"
            onClick={() => {
              setOpen(false)
              onPickProject?.()
            }}
          >
            <span className="composer-menu-item-copy">
              <span className="composer-menu-item-label">
                <Icons.FolderPlus size={13} />
                <span>选择新项目</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`composer-menu-item${isNoProject ? ' active' : ''}`}
            onClick={() => {
              setOpen(false)
              onUseNoProject?.()
            }}
          >
            <span className="composer-menu-item-copy">
              <span className="composer-menu-item-label">
                <Icons.FolderX size={13} />
                <span>不需要项目</span>
              </span>
            </span>
            {isNoProject && <Icons.Check size={14} />}
          </button>
        </div>
      )}
    </div>
  )
}

function AgentPicker({
  agents,
  selectedAgentId,
  onChange,
  teamConfig,
  onEnableTeamMode,
  onDisableTeamMode,
  onChangeHost,
  onOpenMembers,
  onApplyTeam,
  disabled,
}: {
  agents: ManagedAgent[]
  selectedAgentId: string
  onChange: (agentId: string) => void | Promise<void>
  teamConfig: TeamModeConfig
  onEnableTeamMode: () => void
  onDisableTeamMode: () => void
  onChangeHost: (agentId: string) => void
  onOpenMembers: () => void
  onApplyTeam: (team: ManagedTeam) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  // 长期团队列表（用于「选择团队」分组）。打开下拉时按需加载，避免每次会话切换都拉。
  const { invoke: listTeamDefs } = useIpcInvoke('team:list-defs')
  const [teams, setTeams] = useState<ManagedTeam[]>([])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listTeamDefs({})
      .then((res) => {
        if (!cancelled) setTeams(res.teams)
      })
      .catch(() => {
        // 列表加载失败时静默：用户仍可走「团队模式」走临时团队路径
      })
    return () => {
      cancelled = true
    }
  }, [open, listTeamDefs])

  const teamMode = teamConfig.enabled
  // 团队模式下，选择器代表 Host；否则代表当前对话 Agent。
  const activeId = teamMode ? teamConfig.hostAgentId : selectedAgentId
  const selected =
    agents.find((agent) => agent.id === activeId) ??
    agents.find((agent) => agent.id === 'code-agent') ??
    agents[0]
  const memberCount = teamConfig.memberAgentIds.length
  const activeTeam =
    teamMode && teamConfig.teamId != null
      ? teams.find((t) => t.id === teamConfig.teamId)
      : undefined

  return (
    <div ref={rootRef} className={`composer-select composer-agent-picker${disabled ? ' is-disabled' : ''}`} title={disabled ? '会话运行中不可切换' : teamMode ? '团队模式' : 'Agent'}>
      <span className="composer-select-icon">
        {teamMode ? (
          <Icons.Team size={13} />
        ) : selected?.builtIn ? (
          <Icons.Code size={13} />
        ) : (
          <Icons.Bot size={13} />
        )}
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || agents.length === 0}
        title={
          disabled
            ? '会话运行中不可切换'
            : teamMode
              ? activeTeam != null
                ? `团队：${activeTeam.name}（主持：${selected?.name ?? '编码 Agent'}）`
                : `团队模式（当前对话：${selected?.name ?? '编码 Agent'}）`
              : selected?.name ?? '编码 Agent'
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{activeTeam != null ? activeTeam.name : selected?.name ?? '编码 Agent'}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {teamMode && (
        <button
          type="button"
          className="composer-team-chip"
          disabled={disabled}
          onClick={onOpenMembers}
          title={disabled ? '会话运行中不可操作' : '管理团队成员'}
        >
          <Icons.Team size={11} />
          <span className="composer-team-chip-count">{memberCount}</span>
        </button>
      )}
      {open && (
        <div className="composer-menu composer-agent-menu">
          {teamMode ? (
            <button
              type="button"
              className="composer-menu-item team-mode-entry"
              onClick={() => {
                setOpen(false)
                onDisableTeamMode()
              }}
            >
              <span className="composer-menu-item-copy">
                <span className="composer-menu-item-label">
                  <Icons.X size={13} />
                  <span>退出团队模式</span>
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="composer-menu-item team-mode-entry"
              onClick={() => {
                setOpen(false)
                onEnableTeamMode()
              }}
            >
              <span className="composer-menu-item-copy">
                <span className="composer-menu-item-label">
                  <Icons.Team size={13} />
                  <span>团队模式（多 Agent 协作）</span>
                </span>
                <span className="composer-menu-item-desc">让当前对话 Agent 调用其他成员协作</span>
              </span>
            </button>
          )}
          {teams.length > 0 && (
            <>
              <div className="composer-menu-divider" />
              <div className="composer-menu-group-title">已保存团队</div>
              {teams.map((team) => {
                const host = agents.find((a) => a.id === team.hostAgentId)
                const active = teamMode && teamConfig.teamId === team.id
                return (
                  <button
                    key={team.id}
                    type="button"
                    className={`composer-menu-item ${active ? 'active' : ''}`}
                    onClick={() => {
                      setOpen(false)
                      onApplyTeam(team)
                    }}
                  >
                    <span className="composer-menu-item-copy">
                      <span className="composer-menu-item-label">
                        <Icons.Team size={13} />
                        <span>{team.name}</span>
                        {team.builtIn && <span className="composer-menu-item-tag">内置</span>}
                      </span>
                      <span className="composer-menu-item-desc">
                        {host ? `主持：${host.name}` : ''}
                        {host && team.memberAgentIds.length > 0 ? ' · ' : ''}
                        {team.memberAgentIds.length > 0
                          ? `${team.memberAgentIds.length} 成员`
                          : ''}
                      </span>
                    </span>
                    {active && <Icons.Check size={14} />}
                  </button>
                )
              })}
            </>
          )}
          <div className="composer-menu-divider" />
          <div className="composer-menu-group-title">{teamMode ? '当前对话 Agent' : '选择 Agent'}</div>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`composer-menu-item ${agent.id === selected?.id ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                if (teamMode) onChangeHost(agent.id)
                else void onChange(agent.id)
              }}
            >
              <span className="composer-menu-item-copy">
                <span className="composer-menu-item-label">
                  {agent.builtIn ? <Icons.Code size={13} /> : <Icons.Bot size={13} />}
                  <span>{agent.name}</span>
                </span>
                {agent.description && (
                  <span className="composer-menu-item-desc">{agent.description}</span>
                )}
              </span>
              {agent.workflowId && <Icons.Workflow size={13} />}
              {agent.id === selected?.id && <Icons.Check size={14} />}
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
  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const label =
    selectedModelId || selectedProvider?.defaultModel || selectedProvider?.name || '未配置'

  return (
    <div ref={rootRef} className={`composer-select composer-model-picker${disabled ? ' is-disabled' : ''}`} title={disabled ? '会话运行中不可切换' : '供应商模型'}>
      <span className="composer-select-icon">{icon}</span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || providers.length === 0}
        title={disabled ? '会话运行中不可切换' : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{label}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-model-menu">
          {providers.length === 0 && <div className="composer-menu-empty">未配置</div>}
          {providers.map((provider) => {
            const models = provider.modelIds.length
              ? provider.modelIds
              : provider.defaultModel
                ? [provider.defaultModel]
                : []
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

function useCloseOnOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
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
      <svg
        className="adapter-brand-icon adapter-brand-claude"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M12 5.4v13.2M7.3 7.3l9.4 9.4M5.4 12h13.2M7.3 16.7l9.4-9.4" />
        <path d="M9.1 5.9l5.8 12.2M5.9 14.9l12.2-5.8M5.9 9.1l12.2 5.8M9.1 18.1l5.8-12.2" />
      </svg>
    )
  }
  return (
    <svg className="adapter-brand-icon adapter-brand-codex" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <path
        className="codex-cloud"
        d="M8.5 8.4c.9-2.1 4.2-2.7 5.7-.9 2.5-.2 4.1 1.4 4.1 3.5 0 2.4-1.8 4.1-4.4 4.1H8.8c-2 0-3.4-1.2-3.4-3 0-1.6 1.1-2.8 3.1-3.7Z"
      />
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
]

const DEFAULT_AGENT_ADAPTER: AgentAdapter = 'claude-sdk'

const ADAPTER_LABELS: Record<AgentAdapter, string> = {
  'claude-sdk': 'Claude SDK',
  claude: 'Claude API',
  codex: 'Codex',
}

const CLAUDE_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption & { value: PermissionModeChoice }> =
  [
    { value: 'claude-ask', label: 'Ask permissions', description: '每次工具执行前确认' },
    {
      value: 'claude-auto-edits',
      label: 'Auto accept edits',
      description: '自动接受编辑，命令仍确认',
      tone: 'auto',
    },
    { value: 'claude-plan', label: 'Plan mode', description: '先产出计划，再批准执行' },
    {
      value: 'claude-auto',
      label: 'Auto',
      description: '使用 Claude SDK 自动权限策略',
      tone: 'auto',
    },
    {
      value: 'claude-bypass',
      label: 'Bypass permissions',
      description: '危险：完全听从 agent 执行',
      tone: 'danger',
    },
  ]

// Codex 权限选项已移除，项目仅支持 Claude SDK

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
])

function isImageAttachmentPath(filePath: string): boolean {
  const extension = getFileNameFromPath(filePath).split('.').pop()?.toLowerCase()
  return extension != null && IMAGE_ATTACHMENT_EXTENSIONS.has(extension)
}

function encodeToSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${SAFE_FILE_SCHEME}://x/${encoded}`
}

function resolveComposerImageSrc(filePath: string): string {
  if (!filePath) return filePath
  const trimmed = filePath.trim()
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith(`${SAFE_FILE_SCHEME}:`)
  ) {
    return trimmed
  }
  if (lower.startsWith('file://')) {
    try {
      const decoded = decodeURI(trimmed.replace(/^file:\/\//, ''))
      return encodeToSafeFileUrl(decoded.startsWith('/') ? decoded : `/${decoded}`)
    } catch {
      return trimmed
    }
  }
  return trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)
    ? encodeToSafeFileUrl(trimmed)
    : trimmed
}

function ComposerImageCard({
  attachment,
  onPreview,
  onRemove,
}: {
  attachment: ComposerAttachment
  onPreview: () => void
  onRemove: () => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [imgError, setImgError] = useState(false)
  const resolvedSrc = attachment.previewUrl ?? resolveComposerImageSrc(attachment.previewPath ?? attachment.path)

  useEffect(() => {
    setImgError(false)
  }, [resolvedSrc])

  return (
    <div
      className="composer-image-card"
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <button type="button" className="composer-image-card-button" onClick={onPreview}>
        {imgError ? (
          <div className="composer-image-card-fallback" aria-hidden="true">
            <Icons.Image size={18} />
          </div>
        ) : (
          <img
            src={resolvedSrc}
            alt={attachment.name}
            className="composer-image-card-thumb"
            onError={() => setImgError(true)}
            draggable={false}
          />
        )}
      </button>
      <button
        type="button"
        className="composer-image-card-remove"
        title="移除图片"
        onClick={onRemove}
      >
        <Icons.X size={12} />
      </button>
      {menu != null && (
        <InlineContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'preview',
              label: '预览图片',
              icon: <Icons.Maximize size={14} />,
              onClick: onPreview,
            },
            {
              key: 'copy',
              label: '复制图片',
              icon: <Icons.Copy size={14} />,
              onClick: () => {
                void copyImageFromSrc(resolvedSrc).catch(() => {})
              },
            },
            {
              key: 'remove',
              label: '移除图片',
              icon: <Icons.Trash size={14} />,
              danger: true,
              onClick: onRemove,
            },
          ]}
        />
      )}
    </div>
  )
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read pasted image'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read pasted image'))
    }
    reader.readAsDataURL(blob)
  })
}

async function copyImageFromSrc(src: string): Promise<void> {
  const response = await fetch(src)
  if (!response.ok) throw new Error('无法读取图片数据')
  const blob = await response.blob()
  const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem })
    .ClipboardItem
  if (typeof ClipboardItemCtor !== 'function') {
    throw new Error('当前环境不支持复制图片')
  }
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })])
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

function toSessionAttachments(attachments: ComposerAttachment[]): SessionAttachment[] {
  return attachments.map((attachment) => ({
    type: attachment.type,
    path: attachment.path,
  }))
}

function getPermissionModeOptions(
  adapter: AgentAdapter,
): Array<ComposerMenuOption & { value: PermissionModeChoice }> {
  return CLAUDE_PERMISSION_MODE_OPTIONS
}

function getValidPermissionMode(
  value: PermissionModeChoice | undefined,
  adapter: AgentAdapter,
): PermissionModeChoice {
  const options = getPermissionModeOptions(adapter)
  return options.some((option) => option.value === value)
    ? (value as PermissionModeChoice)
    : (options[0]?.value ?? 'claude-ask')
}

function normalizeRuntimePermissionPrefs(value: unknown): {
  adapter: AgentAdapter
  permissionMode: PermissionModeChoice
} {
  const source = value != null && typeof value === 'object' ? (value as ComposerPrefs) : {}
  const adapter =
    source.adapter === 'claude' || source.adapter === 'claude-sdk'
      ? source.adapter
      : DEFAULT_AGENT_ADAPTER
  return {
    adapter,
    permissionMode: getValidPermissionMode(source.permissionMode, adapter),
  }
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
  const prev = readComposerPrefs()
  const next: ComposerPrefs = { ...prev, ...patch }
  for (const key of Object.keys(next) as Array<keyof ComposerPrefs>) {
    if (next[key] === undefined) delete next[key]
  }
  const keys = new Set<keyof ComposerPrefs>([
    ...(Object.keys(prev) as Array<keyof ComposerPrefs>),
    ...(Object.keys(next) as Array<keyof ComposerPrefs>),
  ])
  const changed = Array.from(keys).some((key) => prev[key] !== next[key])
  if (!changed) return
  window.localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(next))
  if (patch.adapter !== undefined || patch.permissionMode !== undefined) {
    const previousRuntimePrefs = normalizeRuntimePermissionPrefs(prev)
    const runtimePrefs = normalizeRuntimePermissionPrefs(next)
    if (
      previousRuntimePrefs.adapter === runtimePrefs.adapter &&
      previousRuntimePrefs.permissionMode === runtimePrefs.permissionMode
    ) {
      return
    }
    void window.spark
      ?.invoke('settings:set', {
        category: RUNTIME_PERMISSION_SETTINGS_CATEGORY,
        key: RUNTIME_PERMISSION_SETTINGS_KEY,
        value: runtimePrefs,
      })
      .catch(() => {
        /* settings persistence is best-effort from the renderer */
      })
  }
}

function readComposerDrafts(): Record<string, ComposerDraftSnapshot> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COMPOSER_DRAFTS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as Record<string, ComposerDraftSnapshot>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeComposerDrafts(drafts: Record<string, ComposerDraftSnapshot>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMPOSER_DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // Ignore local persistence failures and keep in-memory drafts usable.
  }
}

function getPreferredProvider(
  providers: ProviderProfile[],
  prefs: ComposerPrefs,
  adapter: AgentAdapter,
): ProviderProfile | undefined {
  return (
    providers.find(
      (provider) =>
        provider.id === prefs.providerProfileId &&
        isProviderCompatibleWithAdapter(provider, adapter),
    ) ??
    providers.find(
      (provider) => provider.isDefault && isProviderCompatibleWithAdapter(provider, adapter),
    ) ??
    providers.find((provider) => isProviderCompatibleWithAdapter(provider, adapter)) ??
    providers.find((provider) => provider.provider === 'anthropic') ??
    providers[0]
  )
}

function getProviderAdapterKind(provider: ProviderProfile): AgentAdapter {
  // 仅支持 Claude SDK
  return DEFAULT_AGENT_ADAPTER
}

function isControlApprovalRequest(request: PermissionApprovalRequest): boolean {
  const rawName = `${request.toolName ?? ''}`.trim()
  const normalized = rawName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
  return (
    normalized === 'exit_plan_mode' ||
    normalized === 'enter_plan_mode' ||
    normalized === 'ask_user_question'
  )
}

function normalizeModelForProvider(
  modelId: string | null | undefined,
  provider: ProviderProfile | null | undefined,
): string {
  const model = modelId?.trim() ?? ''
  if (!model || provider == null) return ''
  const configuredModels = provider.modelIds.length
    ? provider.modelIds
    : provider.defaultModel
      ? [provider.defaultModel]
      : []
  if (configuredModels.length === 0) return model
  return configuredModels.includes(model) ? model : ''
}

function isClaudeAdapter(adapter: AgentAdapter): boolean {
  return adapter === 'claude' || adapter === 'claude-sdk'
}

function isProviderCompatibleWithAdapter(
  provider: ProviderProfile,
  adapter: AgentAdapter,
): boolean {
  return isClaudeAdapter(adapter)
    ? provider.provider === 'anthropic'
    : provider.provider !== 'anthropic'
}

function getReasoningOptions(
  adapter: AgentAdapter,
): Array<{ value: SessionReasoningEffort; label: string }> {
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
            className="composer-input"
            rows={2}
            placeholder={sessionId ? '询问、修改、运行任务…  ↵ 发送' : '请先选择或新建一个会话'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!sessionId || sending}
          />
          <div className="composer-actions">
            <button className="icon-btn" title="添加文件">
              <Icons.Plus />
            </button>
            <button className="icon-btn" title="工具">
              <Icons.Wrench />
            </button>
            <div className="model-pill">
              <Icons.Sparkles size={11} />
              <span>Agent</span>
              <Icons.ChevronRight size={10} className="chev chev-down" />
            </div>
            <div className="spacer" />
            <span className="composer-hint">
              <span className="kbd">↵</span> 发送 &nbsp;<span className="kbd">⇧↵</span> 换行
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
  return Array.isArray(value) ? (value as T[]) : []
}

function ChatConfigPanel({
  session,
  workspace,
  width,
  onWidthChange,
  agentId,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  width: number
  onWidthChange: (width: number) => void
  /** 当前会话实际使用的 agent ID（team mode 下为 host agent ID） */
  agentId?: string
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [skillsCollapsed, setSkillsCollapsed] = useState(false)
  const [promptsCollapsed, setPromptsCollapsed] = useState(false)
  const [toolsCollapsed, setToolsCollapsed] = useState(false)
  const [skillConfig, setSkillConfig] = useState<SkillConfigGetResponse | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfigGetResponse | null>(null)
  const [projectPromptDraft, setProjectPromptDraft] = useState('')
  const [sessionPromptDraft, setSessionPromptDraft] = useState('')
  const [savingRuntime, setSavingRuntime] = useState(false)
  // 全量 skills 列表（供 picker 弹窗选择）& picker 可见状态
  const [allSkills, setAllSkills] = useState<SkillConfigGetResponse['skills']>([])
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const { invoke: getSkillConfig } = useIpcInvoke('skill-config:get')
  const { invoke: updateSkillConfig } = useIpcInvoke('skill-config:update')
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')
  const { invoke: listAllSkills } = useIpcInvoke('skill:list')
  const sessionId = session?.id as string | undefined
  const workspaceId = workspace?.id

  const loadRuntimeConfig = useCallback(async () => {
    const req = {
      ...(workspaceId != null ? { workspaceId } : {}),
      ...(sessionId != null ? { sessionId } : {}),
      ...(agentId != null ? { agentId } : {}),
    }
    const [skillsRes, promptsRes] = await Promise.all([getSkillConfig(req), getPromptConfig(req)])
    const normalizedSkills = normalizeSkillConfig(skillsRes)
    const normalizedPrompts = normalizePromptConfig(promptsRes)
    setSkillConfig(normalizedSkills)
    setPromptConfig(normalizedPrompts)
    setProjectPromptDraft(normalizedPrompts.project.content)
    setSessionPromptDraft(normalizedPrompts.session.content)
  }, [getPromptConfig, getSkillConfig, sessionId, workspaceId, agentId])

  // 加载全量 skills 列表（供 picker 使用）
  const loadAllSkills = useCallback(async () => {
    try {
      const res = await listAllSkills({})
      setAllSkills(res.skills ?? [])
    } catch { /* non-critical */ }
  }, [listAllSkills])

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

  // 首次渲染时加载全量 skills
  useEffect(() => { void loadAllSkills() }, [loadAllSkills])

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

  const toggleRuntimeSkill = useCallback(
    async (scope: 'project' | 'session', scopeRef: string, skillId: string, active: boolean) => {
      if (skillConfig == null) return
      const currentDisabled =
        scope === 'project'
          ? skillConfig.projectDisabledSkillIds
          : skillConfig.sessionDisabledSkillIds
      const currentSelected =
        scope === 'project' ? skillConfig.projectSkillIds : skillConfig.sessionSkillIds
      const nextDisabled = active
        ? currentDisabled.filter((id) => id !== skillId)
        : Array.from(new Set([...currentDisabled, skillId]))
      // When activating, also add to the selected list if not already present
      const nextSelected = active
        ? Array.from(new Set([...currentSelected, skillId]))
        : currentSelected
      setSavingRuntime(true)
      try {
        await updateSkillConfig({
          scope,
          scopeRef,
          skillIds: nextSelected,
          disabledSkillIds: nextDisabled,
        })
        await loadRuntimeConfig()
      } finally {
        setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, skillConfig, updateSkillConfig],
  )

  /** 通过 Picker 添加 skills 到会话级别 */
  const handleAddSessionSkills = useCallback(
    async (newIds: string[]) => {
      if (skillConfig == null || sessionId == null) return
      const nextSelected = Array.from(new Set([...skillConfig.sessionSkillIds, ...newIds]))
      // 从 disabled 中移除新增的 skill
      const nextDisabled = skillConfig.sessionDisabledSkillIds.filter((id) => !newIds.includes(id))
      setSavingRuntime(true)
      try {
        await updateSkillConfig({
          scope: 'session',
          scopeRef: sessionId,
          skillIds: nextSelected,
          disabledSkillIds: nextDisabled,
        })
        await loadRuntimeConfig()
      } finally {
        setSavingRuntime(false)
      }
    },
    [loadRuntimeConfig, skillConfig, sessionId, updateSkillConfig],
  )

  const savePromptLayer = useCallback(
    async (scope: 'project' | 'session', scopeRef: string, content: string) => {
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
    },
    [loadRuntimeConfig, updatePromptConfig],
  )

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
    <div
      className="inspector scroll"
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="inspector-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />

      {/* Skills — 显示本次会话可用的所有 skills（agent 配置 + 会话额外添加） */}
      {session != null && skillConfig != null && (() => {
        const agentSkillSet = new Set(skillConfig.agentSkillIds)
        const effectiveSet = new Set(skillConfig.effectiveSkillIds)
        const visibleSkills = skillConfig.skills.filter((s) => effectiveSet.has(s.id))
        // Picker 中可选的 skills = 全量 skills 中尚未在 effective 中的
        const pickerSkills = allSkills.filter((s) => !effectiveSet.has(s.id))
        return (
          <div className="inspector-section">
            <h4 className="config-panel-header" onClick={() => setSkillsCollapsed(!skillsCollapsed)}>
              <Icons.Skills size={11} />
              Skills
              <span className="inspector-count">{visibleSkills.length}</span>
              <span className="spacer" />
              {!skillsCollapsed && (
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ fontSize: 10, padding: '2px 8px', marginRight: 4 }}
                  onClick={(e) => { e.stopPropagation(); setShowSkillPicker(true) }}
                  title="为本次会话添加额外 Skill"
                >
                  <Icons.Plus size={10} /> 添加
                </button>
              )}
              <Icons.ChevronRight
                size={10}
                className={`chev ${skillsCollapsed ? '' : 'chev-open'}`}
              />
            </h4>
            {!skillsCollapsed && (
              <>
                <div className="runtime-skill-list">
                  {visibleSkills.map((skill) => {
                    const isAgentSkill = agentSkillSet.has(skill.id)
                    const meta = parseSkillManifest(skill.manifestJson)
                    return (
                      <div className="runtime-skill-row" key={skill.id}>
                        <div className="runtime-skill-main min-w-0">
                          <div className="runtime-skill-name truncate">
                            {skill.name}
                            {isAgentSkill && (
                              <span style={{ display:'inline-block', marginLeft:4, padding:'0 4px', borderRadius:4, fontSize:9, fontWeight:700, lineHeight:'16px', background:'var(--primary-soft)', color:'var(--primary)' }} title="来自 Agent 配置">A</span>
                            )}
                          </div>
                          <div className="runtime-skill-desc truncate">
                            {meta.source}{meta.desc ? ` · ${meta.desc}` : ''}
                          </div>
                        </div>
                        {/* 会话级额外添加的 skill 可移除（× 按钮） */}
                        {!isAgentSkill && sessionId != null && (
                          <button
                            type="button"
                            className="btn ghost sm"
                            style={{ padding: '0 4px', minWidth: 20, fontSize: 11, lineHeight: '18px', color: 'var(--text-muted)' }}
                            title="从本次会话移除此 Skill"
                            disabled={savingRuntime}
                            onClick={() => void toggleRuntimeSkill('session', sessionId, skill.id, false)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {visibleSkills.length === 0 && (
                    <div className="runtime-skill-empty" style={{ color: 'var(--text-muted)', fontSize: 11, padding: '8px 0' }}>
                      当前 Agent 尚未配置 Skill，点击「添加」为会话补充
                    </div>
                  )}
                </div>
                <div className="inspector-muted runtime-hint">
                  {visibleSkills.length > 0
                    ? 'A = Agent 配置；点击「添加」为本会话补充额外 Skill'
                    : '在 Agent 管理中配置 Skills，或点击「添加」为本会话补充'}
                </div>
              </>
            )}
            <SkillsPickerModal
              visible={showSkillPicker}
              skills={pickerSkills.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))}
              selectedIds={[]}
              onChange={(ids) => {
                setShowSkillPicker(false)
                if (ids.length > 0) void handleAddSessionSkills(ids)
              }}
              onClose={() => setShowSkillPicker(false)}
            />
          </div>
        )
      })()}

      {/* 提示词 */}
      {session != null && promptConfig != null && (
        <div className="inspector-section">
          <h4
            className="config-panel-header"
            onClick={() => setPromptsCollapsed(!promptsCollapsed)}
          >
            <Icons.Edit size={11} />
            提示词
            <span className="spacer" />
            <Icons.ChevronRight
              size={10}
              className={`chev ${promptsCollapsed ? '' : 'chev-open'}`}
            />
          </h4>
          {!promptsCollapsed && (
            <>
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
            </>
          )}
        </div>
      )}

      {/* 可用工具 */}
      <div className="inspector-section">
        <h4 className="config-panel-header" onClick={() => setToolsCollapsed(!toolsCollapsed)}>
          <Icons.Wrench size={11} />
          可用工具
          <span className="inspector-count">{CODING_AGENT_TOOLS.length}</span>
          <Icons.ChevronRight size={10} className={`chev ${toolsCollapsed ? '' : 'chev-open'}`} />
        </h4>
        {!toolsCollapsed && (
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
        )}
      </div>
    </div>
  )
}

function ChatInspector({
  session,
  workspace,
  messages,
  usageData,
  projectContext,
  contextUsage,
  contextInputTokens,
  providerContextWindow,
  turnPromptSnapshots,
  width,
  onWidthChange,
  teamConfig,
  agents,
  onChangeTeamConfig,
  onOpenProjectFolder,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  messages: UIMessage[]
  usageData: SessionUsageData
  projectContext: ProjectContextState | null
  contextUsage: ContextUsageState | null
  contextInputTokens: number
  providerContextWindow: number
  turnPromptSnapshots: TurnPromptSnapshotEvent[]
  width: number
  onWidthChange: (width: number) => void
  teamConfig: TeamModeConfig
  agents: ManagedAgent[]
  onChangeTeamConfig: (patch: Partial<TeamModeConfig>) => void
  onOpenProjectFolder: () => void
}) {
  const plans = extractPlans(messages)
  const subagents = extractInspectorSubagents(messages)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const projectContextSources = projectContext?.sources ?? []
  const fileChangeSummaries = extractInspectorFileChanges(messages)
  const runningTeamAgentIds = extractRunningTeamMemberIds(messages)

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

  const currentContextTokens = contextUsage?.estimatedTokens ?? contextInputTokens
  // 窗口大小由 Provider 显式配置决定；历史 context_usage 里可能还带旧的模型名推断值。
  const contextWindow = providerContextWindow
  const contextRatio =
    contextWindow > 0
      ? Math.min(100, Math.round((currentContextTokens / contextWindow) * 1000) / 10)
      : 0
  const isContextWarning = contextRatio >= 80
  const isContextCritical = contextRatio >= 95

  return (
    <div
      className="inspector scroll"
      style={{ '--inspector-width': `${width}px` } as React.CSSProperties}
    >
      <div
        className="inspector-resize-handle"
        title="拖拽调整侧边栏宽度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      {teamConfig.enabled && (
        <TeamInspectorSection
          config={teamConfig}
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            builtIn: a.builtIn,
            providerProfileId: a.providerProfileId ?? null,
            modelId: a.modelId ?? null,
            skillCount: a.skillIds.length,
            mcpCount: a.mcpServerIds.length,
            metadata: a.metadata,
          }))}
          runningAgentIds={runningTeamAgentIds}
          onToggleMember={(agentId, enabled) =>
            onChangeTeamConfig({
              memberAgentIds: enabled
                ? [...teamConfig.memberAgentIds, agentId]
                : teamConfig.memberAgentIds.filter((id) => id !== agentId),
            })
          }
          onChangeConfig={onChangeTeamConfig}
        />
      )}
      <div className="inspector-section">
        <h4>会话信息</h4>
        {session ? (
          <>
            <div className="kv-row">
              <span className="k">ID</span>
              <span className="v mono-sm inspector-v-id">
                {(session.id as string).slice(0, 16)}…
              </span>
            </div>
            <div className="kv-row">
              <span className="k">状态</span>
              <span className="v">{session.status}</span>
            </div>
            <div className="kv-row">
              <span className="k">消息数</span>
              <span className="v">{session.messageCount}</span>
            </div>
            <div className="kv-row">
              <span className="k">项目</span>
              <span className="v truncate">{workspace?.name ?? '未归属'}</span>
            </div>
            {workspace && (
              <div className="kv-row">
                <span className="k">路径</span>
                <span className="v mono-sm truncate inspector-path" title={workspace.rootPath}>
                  {workspace.rootPath}
                </span>
              </div>
            )}
            {workspace && (
              <button
                className="btn ghost sm inspector-open-folder-btn"
                onClick={onOpenProjectFolder}
              >
                <Icons.Folder size={12} />
                <span>打开文件夹</span>
              </button>
            )}
            <div className="kv-row">
              <span className="k">创建时间</span>
              <span className="v">{new Date(session.createdAt).toLocaleString()}</span>
            </div>
            <div className="kv-row">
              <span className="k">更新时间</span>
              <span className="v">{new Date(session.updatedAt).toLocaleString()}</span>
            </div>
          </>
        ) : (
          <div className="inspector-muted">未选择会话</div>
        )}
      </div>

      {session != null && projectContext != null && (
        <div className="inspector-section">
          <h4>
            项目上下文
            <span className="inspector-count">{projectContextSources.length}</span>
          </h4>
          <div className="kv-row">
            <span className="k">规则</span>
            <span className="v">{projectContext.counts.rules}</span>
          </div>
          <div className="kv-row">
            <span className="k">Skills</span>
            <span className="v">{projectContext.counts.skills}</span>
          </div>
          <div className="kv-row">
            <span className="k">Agents</span>
            <span className="v">{projectContext.counts.agents}</span>
          </div>
          {projectContext.budget != null && (
            <>
              <div className="kv-row">
                <span className="k">模式</span>
                <span className="v">{projectContext.budget.mode}</span>
              </div>
              <div className="kv-row">
                <span className="k">预算</span>
                <span className="v">
                  {formatTokenCount(projectContext.budget.usedTokens)} /{' '}
                  {formatTokenCount(projectContext.budget.budgetTokens)}
                </span>
              </div>
            </>
          )}
          {projectContextSources.length > 0 ? (
            <div className="runtime-skill-list">
              {projectContextSources.map((source) => (
                <div
                  className={`runtime-skill-row ${source.included === false ? 'disabled' : ''}`}
                  key={`${source.kind}:${source.path}`}
                >
                  <div className="runtime-skill-main min-w-0">
                    <div className="runtime-skill-name truncate">{source.name}</div>
                    <div className="runtime-skill-desc truncate">
                      {source.kind} · {source.path}
                      {source.estimatedTokens != null
                        ? ` · ${formatTokenCount(source.estimatedTokens)}`
                        : ''}
                      {source.included === false ? ' · excluded' : ''}
                      {source.truncated ? ' · truncated' : ''}
                      {source.reason != null ? ` · ${source.reason}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="inspector-muted">本轮未发现项目级规则、skills 或 agents。</div>
          )}
        </div>
      )}

      {plans.length > 0 && (
        <div className="inspector-section">
          <h4>计划</h4>
          {plans.map((plan) => (
            <PlanSummary key={plan.id} plan={plan} />
          ))}
        </div>
      )}

      {fileChangeSummaries.length > 0 && (
        <div className="inspector-section">
          <h4>
            Change Review
            <span className="inspector-count">{fileChangeSummaries.length}</span>
          </h4>
          <div className="runtime-skill-list">
            {fileChangeSummaries.map((change) => (
              <div className="runtime-skill-row" key={change.id}>
                <div className="runtime-skill-main min-w-0">
                  <div className="runtime-skill-name truncate">{change.path}</div>
                  <div className="runtime-skill-desc truncate">
                    {change.changeType} · +{change.adds} -{change.dels}
                    {!change.hasDiff ? ' · no diff' : ''}
                    {change.checkpointIds.length > 0
                      ? ` · checkpoint ${change.checkpointIds.join(', ')}`
                      : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subagents.length > 0 && (
        <div className="inspector-section">
          <h4>
            <Icons.Bot size={11} /> 子 Agent
            <span className="inspector-count">{subagents.length}</span>
          </h4>
          <div className="runtime-skill-list">
            {subagents.map((sa, idx) => (
              <div
                className={`runtime-skill-row${sa.status === 'running' ? ' running' : ''}`}
                key={`${sa.toolCallId}-${idx}`}
                title={sa.output ? '点击查看输出' : undefined}
                style={sa.output ? { cursor: 'pointer' } : undefined}
              >
                <div className="runtime-skill-main min-w-0">
                  <div className="runtime-skill-name truncate">
                    {sa.status === 'running' ? <Icons.Spinner size={10} className="thinking-spinner" /> : <Icons.Check size={10} style={{ color: 'var(--c-ok, #22c55e)' }} />}
                    {' '}{sa.name}
                  </div>
                  <div className="runtime-skill-desc truncate">
                    {sa.task || sa.role || '-'}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
            {isContextCritical && (
              <span className="badge danger dot usage-warning-badge">即将满</span>
            )}
            {!isContextCritical && isContextWarning && (
              <span className="badge warning dot usage-warning-badge">接近满</span>
            )}
          </h4>
          <ContextWindowVisualization
            usedTokens={currentContextTokens}
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

      {/* 白盒提示词面板 — 展示每轮 SDK 调用的全量提示词快照 */}
      {turnPromptSnapshots.length > 0 && <PromptInspectorSection snapshots={turnPromptSnapshots} />}
    </div>
  )
}

// ─── 白盒提示词检查器组件 ──────────────────────────────────────────────────────

/** 相对时间格式化 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return `${Math.floor(diff / 86_400_000)}天前`
}

/** 截断文本 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

/** PromptInspectorSection — 白盒提示词、运行时日志检查器 */
function PromptInspectorSection({ snapshots }: { snapshots: TurnPromptSnapshotEvent[] }) {
  return (
    <div className="inspector-section">
      <h4>
        <Icons.Eye size={11} /> 运行时日志
        <span className="inspector-count">{snapshots.length} 轮</span>
      </h4>
      <div className="prompt-snapshot-list">
        {[...snapshots].reverse().map((snapshot, idx) => (
          <TurnPromptRow
            key={snapshot.turnId}
            snapshot={snapshot}
            turnNumber={snapshots.length - idx}
          />
        ))}
      </div>
    </div>
  )
}

/** 单个 Turn 的提示词快照行，支持展开/折叠 */
const TurnPromptRow = React.memo(function TurnPromptRow({
  snapshot,
  turnNumber,
}: {
  snapshot: TurnPromptSnapshotEvent
  turnNumber: number
}) {
  const [expanded, setExpanded] = useState(false)
  const userPreview = useMemo(() => truncateText(snapshot.userMessage, 80), [snapshot.userMessage])
  const totalPromptChars = useMemo(
    () => snapshot.systemPromptSections.reduce((sum, s) => sum + s.charCount, 0),
    [snapshot.systemPromptSections],
  )
  const formatCharCount = (n: number): string => {
    if (n >= 10_000) return `${Math.round(n / 1000)}K`
    return `${n}`
  }

  return (
    <div className={`prompt-turn-row ${expanded ? 'expanded' : ''}`}>
      <div
        className="prompt-turn-header"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((prev) => !prev)
          }
        }}
      >
        <span className={`prompt-turn-chevron ${expanded ? 'open' : ''}`}>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="prompt-turn-title">
          Turn {turnNumber} · {snapshot.model}
        </span>
        <span className="prompt-turn-time">{relativeTime(snapshot.timestamp)}</span>
      </div>
      <div className="prompt-turn-summary">
        <span className="prompt-turn-user" title={snapshot.userMessage}>
          {userPreview}
        </span>
        <span className="prompt-turn-meta">
          {snapshot.systemPromptSections.length} 段 · {formatCharCount(totalPromptChars)} 字符
        </span>
      </div>
      {expanded && (
        <div className="prompt-turn-detail">
          {/* Adapter 信息 */}
          <div className="prompt-turn-config">
            <span className="prompt-config-tag">{snapshot.adapterKind}</span>
            <span className="prompt-config-tag">{snapshot.permissionMode}</span>
            {snapshot.sdkPreset && (
              <span className="prompt-config-tag sdk">SDK: {snapshot.sdkPreset}</span>
            )}
            <span className="prompt-config-tag">Tools: {snapshot.toolCount}</span>
          </div>

          {/* 用户消息 */}
          <div className="prompt-section-block">
            <div className="prompt-section-label">用户消息</div>
            <pre className="prompt-section-content">{snapshot.userMessage}</pre>
          </div>

          {/* 系统提示词各段落 */}
          {snapshot.systemPromptSections.map((section, sIdx) => (
            <PromptSectionBlock key={sIdx} section={section} />
          ))}
        </div>
      )}
    </div>
  )
})

/** 单个提示词段落的展示，支持独立折叠 */
const PromptSectionBlock = React.memo(function PromptSectionBlock({
  section,
}: {
  section: { label: string; content: string; charCount: number }
}) {
  const [sectionExpanded, setSectionExpanded] = useState(false)
  const isPlaceholder = section.charCount === 0

  return (
    <div className={`prompt-section-block ${isPlaceholder ? 'placeholder' : ''}`}>
      <div
        className="prompt-section-label clickable"
        onClick={() => {
          if (!isPlaceholder) setSectionExpanded((prev) => !prev)
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!isPlaceholder) setSectionExpanded((prev) => !prev)
          }
        }}
      >
        <span className={`prompt-section-chevron ${sectionExpanded ? 'open' : ''}`}>
          {!isPlaceholder ? (sectionExpanded ? '▾' : '▸') : '○'}
        </span>
        <span>{section.label}</span>
        {section.charCount > 0 && (
          <span className="prompt-section-chars">{section.charCount} 字符</span>
        )}
      </div>
      {sectionExpanded && !isPlaceholder && (
        <pre className="prompt-section-content">{section.content}</pre>
      )}
      {isPlaceholder && <div className="prompt-section-placeholder">{section.content}</div>}
    </div>
  )
})

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
        <span className="mono-sm">
          {completed}/{total}
        </span>
      </div>
      <div className="inspector-progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      {plan.explanation && (
        <div className="inspector-plan-note md-surface">
          <MarkdownText content={plan.explanation} />
        </div>
      )}
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
          <span className="token-row-value token-cost">
            $
            {estimatedCostUsd < 0.01 && estimatedCostUsd > 0
              ? '<0.01'
              : estimatedCostUsd.toFixed(4)}
          </span>
        </div>
      )}
      {!hasUsage && <div className="inspector-muted">暂无用量数据</div>}
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

  const barClass = isCritical
    ? 'context-bar-critical'
    : isWarning
      ? 'context-bar-warning'
      : 'context-bar-ok'

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
          <span
            className={`v ${isCritical ? 'token-cost-critical' : isWarning ? 'token-cost-warn' : ''}`}
          >
            {ratio}%
          </span>
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
          <div
            key={`${turn.turnId}-${index}`}
            className="turn-usage-bar-group"
            title={`第 ${index + 1} 轮: 输入 ${formatTokenCount(turn.inputTokens)}, 输出 ${formatTokenCount(turn.outputTokens)}`}
          >
            <span className="turn-usage-index">{index + 1}</span>
            <div className="turn-usage-bar-track">
              <div
                className="turn-usage-bar-input"
                style={{ width: `${inputPct}%` }} /* dynamic */
              />
              <div
                className="turn-usage-bar-output"
                style={{ width: `${outputPct}%` }} /* dynamic */
              />
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

type InspectorFileChange = {
  id: string
  path: string
  changeType: string
  adds: number
  dels: number
  hasDiff: boolean
  checkpointIds: string[]
}

function extractInspectorFileChanges(messages: UIMessage[]): InspectorFileChange[] {
  const checkpointsByPath = new Map<string, string[]>()

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'checkpoint') continue
      for (const filePath of block.filePaths ?? []) {
        const checkpointIds = checkpointsByPath.get(filePath) ?? []
        const shortId = formatCheckpointReference(block.checkpointId)
        if (!checkpointIds.includes(shortId)) checkpointIds.push(shortId)
        checkpointsByPath.set(filePath, checkpointIds)
      }
    }
  }

  const changes = new Map<string, InspectorFileChange>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'file_change') continue
      const counts = countDiffLines(block.diff)
      changes.set(block.path, {
        id: `${message.id}:${block.path}`,
        path: block.path,
        changeType: block.changeType,
        adds: counts.adds,
        dels: counts.dels,
        hasDiff: block.diff != null && block.diff.trim().length > 0,
        checkpointIds: checkpointsByPath.get(block.path) ?? [],
      })
    }
  }

  return Array.from(changes.values()).slice(-12).reverse()
}

function countDiffLines(diff: string | undefined): { adds: number; dels: number } {
  if (diff == null || diff.trim().length === 0) return { adds: 0, dels: 0 }
  let adds = 0
  let dels = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) adds += 1
    if (line.startsWith('-')) dels += 1
  }
  return { adds, dels }
}

function extractRunningTeamMemberIds(messages: UIMessage[]): string[] {
  const running = new Set<string>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'team_dispatch') {
        if (block.state === 'pending' || block.state === 'working') running.add(block.memberAgentId)
        continue
      }
      if (block.kind === 'team_member_message') {
        if (block.isStreaming) running.add(block.memberAgentId)
        continue
      }
      const memberContext = getBlockTeamMemberContext(block)
      if (memberContext == null) continue
      if (block.kind === 'tool_call' && (block.status === 'pending' || block.status === 'running')) {
        running.add(memberContext.memberAgentId)
      }
      if (block.kind === 'terminal' && block.isStreaming) {
        running.add(memberContext.memberAgentId)
      }
    }
  }
  return Array.from(running)
}

interface InspectorSubagent {
  toolCallId: string
  name: string
  role: string
  task: string
  status: 'running' | 'done'
  output?: string | undefined
}

function extractInspectorSubagents(messages: UIMessage[]): InspectorSubagent[] {
  const seen = new Map<string, InspectorSubagent>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'subagent') continue
      seen.set(block.toolCallId, {
        toolCallId: block.toolCallId,
        name: block.name,
        role: block.role,
        task: block.task,
        status: block.status,
        output: block.output,
      })
    }
  }
  return Array.from(seen.values())
}

function formatCheckpointReference(checkpointId: string): string {
  return checkpointId.length > 8 ? checkpointId.slice(-6) : checkpointId
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

      const todos =
        block.toolName === 'todo_write'
          ? parseTodosFromInputOrOutput(block.toolInput, block.output)
          : []
      const rawPlan = Array.isArray(block.toolInput.plan) ? block.toolInput.plan : undefined
      if (todos.length === 0 && rawPlan == null && !isPlanToolName(block.toolName)) continue

      const items =
        todos.length > 0
          ? todos.map((todo) => ({
              text:
                todo.status === 'in_progress' ? (todo.activeForm ?? todo.content) : todo.content,
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
        explanation:
          typeof block.toolInput.explanation === 'string' ? block.toolInput.explanation : undefined,
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

function getLatestInputTokens(events: AgentEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'usage_update' && event.inputTokens > 0) return event.inputTokens
  }
  return 0
}

function getBasename(value: string): string {
  // 兼容 POSIX (/Users/foo/bar) 与 Windows (C:\foo\bar、\\server\share\bar、混合写法) 两种路径
  const trimmed = value.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return '新项目'
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? '新项目'
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

function UserQuestionWizard({
  data,
  onAnswer,
  onCancel,
  currentIndex,
  onCurrentIndexChange,
}: {
  data: UserQuestionData
  onAnswer: (answers: Record<string, unknown>) => void
  onCancel: () => void
  currentIndex: number
  onCurrentIndexChange: React.Dispatch<React.SetStateAction<number>>
}) {
  const [drafts, setDrafts] = useState<Record<number, UserQuestionDraft>>({})
  const [submitted, setSubmitted] = useState(false)
  const currentQuestion = data.questions[currentIndex]
  const currentDraft = drafts[currentIndex] ?? {}

  useEffect(() => {
    onCurrentIndexChange(0)
    setDrafts({})
    setSubmitted(false)
  }, [data.questions, onCurrentIndexChange])

  if (currentQuestion == null) return null

  const total = data.questions.length
  const answeredCount = data.questions.filter((_, index) => isQuestionAnswered(data.questions[index]!, drafts[index])).length
  const canGoBack = currentIndex > 0
  const canGoNext = currentIndex < total - 1
  const canSubmit = data.questions.every((question, index) => isQuestionReadyForSubmit(question, drafts[index]))
  const choiceOptions = getChoiceOptions(currentQuestion)
  const otherLabel = getOtherOptionLabel(currentQuestion)
  const otherInputPlaceholder = getOtherPlaceholder(currentQuestion)

  const updateDraft = (patch: Partial<UserQuestionDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [currentIndex]: {
        ...prev[currentIndex],
        ...patch,
      },
    }))
  }

  const handleSelectOption = (option: UserQuestionOption) => {
    updateDraft({
      skipped: false,
      selectedLabel: option.label,
      selectedValue: option.value ?? option.label,
      ...(option.allowsFreeText ? {} : { otherText: '' }),
      text: '',
    })
    if (!option.allowsFreeText && canGoNext) {
      onCurrentIndexChange((prev) => Math.min(prev + 1, total - 1))
    }
  }

  const handleTextChange = (value: string) => {
    updateDraft({ skipped: false, text: value })
  }

  const handleOtherTextChange = (value: string) => {
    updateDraft({
      skipped: false,
      selectedLabel: otherLabel,
      selectedValue: otherLabel,
      otherText: value,
      text: '',
    })
  }

  const handleSkip = () => {
    updateDraft({
      skipped: true,
      selectedLabel: '',
      selectedValue: '',
      otherText: '',
      text: '',
    })
    if (canGoNext) {
      onCurrentIndexChange((prev) => Math.min(prev + 1, total - 1))
    }
  }

  const handleSubmit = () => {
    if (submitted || !canSubmit) return
    setSubmitted(true)
    const answers: Record<string, unknown> = {
      answers: data.questions.map((question, index) =>
        buildQuestionAnswer(question, drafts[index], index),
      ),
      questionCount: total,
      answeredCount,
    }
    onAnswer(answers)
  }

  const handleCancel = () => {
    if (submitted) return
    onCancel()
  }

  return (
    <>
      <div className="user-question-body">
        <div className="question-item">
          <div className="question-text">{currentQuestion.question}</div>

          {isChoiceQuestion(currentQuestion) ? (
            <>
              <div className="question-options">
                {choiceOptions.map((opt, optIndex) => {
                  const selected = currentDraft.selectedLabel === opt.label
                  const tooltipText = opt.description ? `${opt.label}\n${opt.description}` : opt.label
                  return (
                    <button
                      key={`${opt.label}-${optIndex}`}
                      className={`question-option ${selected ? 'selected' : ''}`}
                      onClick={() => handleSelectOption(opt)}
                      disabled={submitted}
                      title={tooltipText}
                    >
                      <div className="option-label">{opt.label}</div>
                      {opt.description && <div className="option-desc">{opt.description}</div>}
                      {selected && (
                        <span className="question-option-check" aria-hidden="true">
                          <Icons.Check size={11} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="user-question-other">
                <div className="user-question-other-label">{otherLabel}</div>
                <div className="user-question-input-wrap">
                  <SparkInput
                    value={currentDraft.otherText ?? ''}
                    onChange={(event) => handleOtherTextChange(event.target.value)}
                    placeholder={otherInputPlaceholder}
                    disabled={submitted}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="user-question-input-wrap">
              {currentQuestion.multiline ? (
                <SparkTextarea
                  value={currentDraft.text ?? ''}
                  onChange={(event) => handleTextChange(event.target.value)}
                  placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                  disabled={submitted}
                  rows={5}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  autoFocus
                />
              ) : (
                <SparkInput
                  value={currentDraft.text ?? ''}
                  onChange={(event) => handleTextChange(event.target.value)}
                  placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                  disabled={submitted}
                  autoFocus
                />
              )}
            </div>
          )}

          {currentDraft.skipped && (
            <div className="question-skip-note">这一题已标记为跳过，您仍可返回修改。</div>
          )}
        </div>
      </div>

      <div className="user-question-footer">
        <div className="user-question-pagination">
          {data.questions.map((question, index) => (
            <button
              key={question.id ?? `${question.question}-${index}`}
              className={`user-question-dot ${index === currentIndex ? 'active' : ''} ${isQuestionAnswered(question, drafts[index]) ? 'done' : ''}`}
              onClick={() => onCurrentIndexChange(index)}
              disabled={submitted}
              title={`第 ${index + 1} 题`}
            >
              {index + 1}
            </button>
          ))}
        </div>

        <div className="user-question-actions">
          <button
            className="user-question-btn secondary"
            onClick={handleSkip}
            disabled={submitted || currentQuestion.allowSkip === false}
          >
            跳过
          </button>
          <button className="user-question-btn secondary" onClick={handleCancel} disabled={submitted}>
            取消
          </button>
          <button
            className="user-question-btn secondary"
            onClick={() => onCurrentIndexChange((prev) => Math.max(prev - 1, 0))}
            disabled={submitted || !canGoBack}
          >
            上一题
          </button>
          {canGoNext ? (
            <button
              className="user-question-btn primary"
              onClick={() => onCurrentIndexChange((prev) => Math.min(prev + 1, total - 1))}
              disabled={submitted}
            >
              下一题
            </button>
          ) : (
            <button className="user-question-btn primary" onClick={handleSubmit} disabled={submitted || !canSubmit}>
              {submitted ? <Icons.Spinner size={12} /> : null}
              提交答案
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function isChoiceQuestion(question: UserQuestionPrompt): boolean {
  return (question.type ?? 'single_choice') === 'single_choice'
}

function getQuestionTypeLabel(question: UserQuestionPrompt): string {
  return isChoiceQuestion(question) ? '选择题' : question.multiline ? '长文本输入' : '输入题'
}

function getOtherOptionLabel(question: UserQuestionPrompt): string {
  return question.otherOptionLabel?.trim() || '其他'
}

function getOtherPlaceholder(question: UserQuestionPrompt): string {
  return question.otherPlaceholder?.trim() || '请输入其他内容'
}

function getChoiceOptions(question: UserQuestionPrompt): UserQuestionOption[] {
  return question.options ?? []
}

function isQuestionAnswered(question: UserQuestionPrompt, draft: UserQuestionDraft | undefined): boolean {
  if (draft?.skipped) return true
  if (draft == null) return false
  if (isChoiceQuestion(question)) {
    if (draft.selectedLabel === getOtherOptionLabel(question)) {
      return (draft.otherText?.trim().length ?? 0) > 0
    }
    return !!draft.selectedLabel || (draft.otherText?.trim().length ?? 0) > 0
  }
  return (draft.text?.trim().length ?? 0) > 0
}

function isQuestionReadyForSubmit(question: UserQuestionPrompt, draft: UserQuestionDraft | undefined): boolean {
  if (draft?.skipped) return true
  return isQuestionAnswered(question, draft)
}

function buildQuestionAnswer(
  question: UserQuestionPrompt,
  draft: UserQuestionDraft | undefined,
  index: number,
) {
  const isSkipped = draft?.skipped === true
  const otherText = draft?.otherText?.trim() ?? ''
  const text = draft?.text?.trim() ?? ''
  const answerValue = isChoiceQuestion(question)
    ? (() => {
        const selected = draft?.selectedValue ?? draft?.selectedLabel ?? ''
        if (selected === getOtherOptionLabel(question)) return otherText
        if (otherText && selected) return `${selected} | ${otherText}`
        return otherText || selected
      })()
    : text

  return {
    index,
    id: question.id ?? `question-${index + 1}`,
    header: question.header,
    question: question.question,
    type: question.type ?? (isChoiceQuestion(question) ? 'single_choice' : 'text'),
    skipped: isSkipped,
    answer: isSkipped ? '' : answerValue,
    ...(draft?.selectedLabel ? { optionLabel: draft.selectedLabel } : {}),
    ...(draft?.selectedValue ? { optionValue: draft.selectedValue } : {}),
    ...(otherText ? { otherText } : {}),
    ...(text ? { text } : {}),
  }
}

function buildQuestionCancelAnswer(questions: UserQuestionPrompt[]): Record<string, unknown> {
  return {
    cancelled: true,
    declined: true,
    reason: '用户取消了问答弹窗，拒绝回答这些问题。',
    questionCount: questions.length,
    answeredCount: 0,
    answers: questions.map((question, index) => ({
      index,
      id: question.id ?? `question-${index + 1}`,
      header: question.header,
      question: question.question,
      type: question.type ?? (isChoiceQuestion(question) ? 'single_choice' : 'text'),
      skipped: true,
      declined: true,
      answer: '用户拒绝回答',
    })),
  }
}

/** Sticky reply panel for AskUserQuestion so users always have an in-context reply path */
function UserQuestionDock(props: Omit<Parameters<typeof UserQuestionWizard>[0], 'currentIndex' | 'onCurrentIndexChange'>) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const total = props.data.questions.length

  return (
    <div className="user-question-dock">
      <div className="user-question-dock-head">
        <div className="user-question-dock-icon">
          <Icons.HelpCircle size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="user-question-dock-title">Agent 正在等您回复</div>
          <div className="user-question-dock-subtitle">
            逐题作答，支持回退、跳过，以及输入自定义答案
          </div>
        </div>
        <div className="user-question-dock-badge">
          {Math.min(currentIndex + 1, total)} / {total}
        </div>
      </div>
      <div className="user-question-dock-panel">
        <UserQuestionWizard
          {...props}
          currentIndex={currentIndex}
          onCurrentIndexChange={setCurrentIndex}
        />
      </div>
    </div>
  )
}
