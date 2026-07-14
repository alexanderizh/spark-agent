/**
 * ChatView — 真实 IPC 驱动的会话视图
 *
 * NOTE: Session sidebar has been moved to the primary FloatingSidebar.
 * This component only renders the main chat area (hero/composer/stream).
 * Session/workspace/provider data is read from SessionSidebarContext.
 */
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  Fragment,
} from 'react'
import './ChatView.less'
import './ToolDropdown.less'
import type { ReactNode, RefObject } from 'react'
import { Button } from '@lobehub/ui'
import {
  CheckCircle,
  Copy,
  FilePenLine,
  FileSearch,
  FolderOpen,
  History,
  Lightbulb,
  MoreHorizontal,
  PanelRight,
  Server,
  SquareTerminal,
  Trash,
  Save,
  Wrench,
} from 'lucide-react'
import {
  ActivityLogSummaryIcon,
  ProjectOpenDropdown,
  TabbarIcon,
  TabbarTooltipButton,
} from './chat/ChatToolbar'
import { ChatTitlebarEnd, ChatTitlebarStart } from './chat/ChatTitlebar'
import { UserQuestionDock } from './chat/UserQuestionDock'
import { buildQuestionCancelAnswer, type UserQuestionData } from './chat/UserQuestionUtils'
import {
  buildQuestionAnswerSummaries,
  getQuestionAnswerCacheKey,
  persistQuestionAnswerSummaries,
  readPersistedQuestionAnswerSummaries,
} from './chat/QuestionAnswerCache'
import { buildAgentCommitMessage, buildDefaultCommitMessage } from './chat/ChatGitUtils'
import { GitBranchDialog, GitCommitDialog, GitCreateBranchDialog } from './chat/ChatGitDialogs'
import { GitEnvPanel } from './chat/ChatGitEnv'
import { FileChipIcon } from './chat/ChatFileIcon'
import { GitReviewPanel } from './chat/ChatGitReview'
import { useLiveWorkspaceGitStatus } from './chat/useLiveWorkspaceGitStatus'
import { HeroTipsTicker, SingleAgentEmptyHero, TeamModeEmptyHero } from './chat/ChatHero'
import { ChatTabbar } from './chat/ChatTabbar'
import {
  DocumentOutputCard,
  filterDocumentOutputFiles,
  getDocumentOutputKey,
} from './chat/ChatDocumentOutput'
import { MarkdownText } from './chat/ChatMarkdown'
import { VirtualMessageList, type VirtualMessageListHandle } from './chat/VirtualMessageList'
import {
  ModelSwitchNotice,
} from './chat/ModelSwitchNotice'
import {
  readModelSwitchMarkers,
  saveModelSwitchMarker,
  type ModelSwitchMarker,
} from './chat/ModelSwitchMarkers'
import { StreamingErrorCard } from './chat/StreamingErrorCard'
import { RuntimeSignalCard } from './chat/RuntimeSignalCard'
import { CancellationNotice } from './chat/CancellationNotice'
import { groupChatMessageTimeline } from './chat/chat-message-timeline'
import { ActivitySegment } from './chat/ActivitySegment'
import {
  getToolLogGroupKind,
  isChatActivitySegmentRunning,
  splitChatActivitySegments,
  summarizeChatActivitySegment,
  type ChatActivityBlock,
  type ToolLogGroupKind,
} from './chat/ChatActivitySegments'
import { buildErrorRetryPayload } from './chat/ChatErrorRetry'
import { EmptySessionModeLauncher } from './chat/EmptySessionModeLauncher'
import {
  persistThenSyncTeamSelection,
  preserveExplicitEmptySessionTeamConfig,
  shouldResetEmptySessionTeamTouched,
} from './chat/emptySessionTeamMode'

export { MarkdownText } from './chat/ChatMarkdown'
import {
  defaultUnifiedSidePanelWidth,
  maxSideChatWidthForViewport,
  SideChatPanel,
  UnifiedSessionSidePanel,
  UnifiedSidePanelPicker,
  type UnifiedSidePanelKind,
} from './chat/ChatSidePanels'
import {
  clamp,
  formatRelativeTime,
  formatTokenCount,
  getBasename,
  getLatestInputTokens,
} from './chat/ChatViewUtils'
import {
  extractInspectorFileChanges,
  extractInspectorSubagents,
  extractPlans,
  extractSessionProgressTasks,
  isRecord,
  parsePlanToItems,
  parseTodosFromInputOrOutput,
  type InspectorTask,
  type SidebarPlan,
} from './chat/ChatInspectorUtils'
import type {
  AgentAdapter,
  BranchState,
  ComposerPrefillPayload,
  ContextMenuItem,
  MessageAttachment,
  PermissionModeChoice,
  ReplyToState,
  SessionRuntimePatch,
} from './chat/ChatComposerTypes'
import type {
  ContextLedgerSection,
  ContextLedgerState,
  ContextUsageState,
  ProjectContextState,
  SessionUsageData,
  UsageSnapshot,
} from './chat/ChatUsageTypes'
import {
  compactQuotePreview,
  ComposerV2,
  copyImageFromSrc,
  getFileNameFromPath,
  getPreferredProvider,
  getProviderDefaultModel,
  isLocalCliProvider,
  normalizeComposerReasoningEffort,
  readComposerPrefs,
  readSelectedTextWithin,
  resolveComposerImageSrc,
  useCloseOnOutside,
  writeComposerPrefs,
} from './chat/ComposerV2'
import {
  buildUsageDataFromEvents,
  ChatConfigPanel,
  ChatInspector,
  PlanSummary,
} from './chat/ChatInspectorPanel'
import {
  extractRunningTeamAgentIds,
  extractRunningTeamMemberIds,
} from './chat/ChatTeamActivityUtils'
import { GitDiffContent, parseUnifiedDiff, type DiffHunk } from './chat/ChatDiffUtils'
import { useApp } from '../AppContext'
import { Icons } from '../Icons'
import { useSessionSidebar, type SessionSummary } from '../SessionSidebarContext'
import {
  ErrorCard,
  FilePermCard,
  NetPermCard,
  MCPPermCard,
  HunkDiff,
  PlanCard,
  renderPlanInline,
  SubagentCard,
  Checkpoint,
  SandboxNote,
  QuickActions,
  ToolChooser,
  TurnFileSummaryCard,
} from '../ChatInteractions'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { ClickableFilePath, type PreviewFileType } from '../components/ClickableFilePath'
import { FilePreviewPanel } from '../components/FilePreviewPanel'
import { FileTypeIcon, getFileTypeBadge, getPreviewFileType } from '../components/FileDisplay'
import { TeamDispatchCard } from '../components/TeamDispatchCard'
import { TeamMemberBubble } from '../components/TeamMemberBubble'
import { TeamInspectorSection } from '../components/TeamInspectorSection'
import { TeamMemberDrawer } from '../components/TeamMemberDrawer'
import { WorktreePanel } from '../components/WorktreePanel'
import { CheckpointTimelinePanel } from '../components/CheckpointTimelinePanel'
import { BuiltInTerminalPanel } from '../components/BuiltInTerminalPanel'
import { MentionPopover, type MentionCandidate } from '../components/MentionPopover'
import { AvatarImage } from '../components/AvatarImage'
import { SkillsPickerModal } from '../components/SkillsPickerModal'
import { ComposerActionsMenu } from '../components/ComposerActionsMenu'
import { SKILL_STORE_TARGET_TAB_EVENT, SKILL_STORE_TARGET_TAB_STORAGE_KEY } from './SkillStoreView'
import { requestAgentsTargetTab } from '../teamNavigation'
import { CODING_AGENT_TOOLS } from '../data/available-tools'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useAppearanceSettings, readAppearance } from '../hooks/useAppearance'
import { MessageBuilder } from '../services/event-mapper'
import {
  LiveAgentEventBuffer,
  createAgentEventIdSet,
  mergeAgentEvents,
} from '../services/live-agent-event-buffer'
import { filterTurnSummaryIgnoredPaths } from '../services/turn-summary-filter'
import {
  isComposerSessionWorking,
  resolveComposerRunningAgentIds,
} from '../services/composer-working-state'
import {
  buildComposerAttachmentsFromPaths,
  getDataTransferFilePaths,
  hasFileDataTransfer,
} from '../services/composer-attachments'
import { shouldShowScrollToBottom } from './chat-scroll'
import {
  getLastAssistantMessageMarkdown,
  isLocalCopySlashCommand,
  serializeMessagesToMarkdown,
} from './chat-copy'
import { hasVisibleTeamMemberActivityBlocks } from './chat-team-visibility'
import { shouldShowAssistantIdentity } from './chat/chat-message-avatar'
import { getLatestAgentStatus, isRunningAgentStatus } from './chat-session-status'
import {
  canReuseComposerSession,
  canShowComposerWorktreeToggle,
  resolveComposerGitWorkspace,
  resolveDisplayedGitBranch,
} from './chat-session-routing'
import { useToast } from '../components/Toast'
import { parseSkillManifest } from '../utils/skills-data'
import {
  getPreferredProviderForAdapter,
  getProviderAdapterKind,
  isClaudeAdapter,
  isProviderCompatibleWithAdapter,
} from '../utils/provider-adapter'
import {
  getAgentAvatarConfig,
  hasCustomAvatar,
  resolveAvatarSrc,
} from '../avatar'
import type {
  UIMessage,
  UIBlock,
  FileChangeSummary,
  GoalSnapshot,
  OrchestrationSnapshot,
} from '../services/event-mapper'
import type {
  AgentEvent,
  AgentStatusValue,
  ProviderProfile,
  ModelProfile,
  SessionAgentAdapter,
  SessionChatMode,
  SessionListResponse,
  SessionPermissionMode,
  PermissionApprovalDecision,
  PermissionApprovalRequest,
  PromptConfigGetResponse,
  EnvConfigGetResponse,
  EnvVarItem,
  SessionId,
  SessionReasoningEffort,
  SessionGetQueueResponse,
  SessionQueuedTurn,
  SkillConfigGetResponse,
  WorkflowProgressNode,
  WorkspaceInfo,
  CommandListItem,
  TurnPromptSnapshotEvent,
  ManagedAgent,
  ManagedTeam,
  SessionAttachment,
  TeamModeConfig,
  TeamMemberEventContext,
} from '@spark/protocol'
import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  CLAUDE_AUTO_ROUTER_PROVIDER_NAME,
  CODEX_AUTO_ROUTER_PROVIDER_ID,
  CODEX_AUTO_ROUTER_PROVIDER_NAME,
  isBuiltInLocalCliProvider,
  isAutoRouterProvider,
  isClaudeAutoRouterProvider,
  isRoutingModelConfig,
  VENDOR_CATALOG,
  type VendorMeta,
} from '@spark/protocol'
import { normalizeEduAssetUrl, resolveProviderContextWindow } from '@spark/shared'
import { ProviderLogo } from '../components/ProviderLogo'

const LOCAL_CLI_MODEL_DISPLAY = 'claude cli'
const LOCAL_CODEX_CLI_MODEL_DISPLAY = 'codex cli'

/**
 * resolveTeamHostAgentId — 解析团队模式下要使用的主持 Agent。
 *
 * 团队模式启用但主持人未显式选择时（如新会话/首次开启/旧 host 已被删除），
 * 后端会收到一个无效的 hostAgentId，导致 LLM 因缺少调度工具而报
 * "无法直接调度其他 Agent 并行开发代码" 的错。这里给出明确的回退链：
 *   1. teamConfig.hostAgentId 已在 agents 列表里 → 直接用
 *   2. 团队 memberAgentIds 中第一个在 agents 列表里的 → 用它
 *   3. agents 列表第一个 → 用它
 *   4. 保留 teamConfig.hostAgentId（即使不在列表，给后端兜底）
 *   5. 最终兜底 'platform-manager-agent'
 */
function resolveTeamHostAgentId(teamConfig: TeamModeConfig, agents: ManagedAgent[]): string {
  const isValid = (id: string | undefined): id is string =>
    typeof id === 'string' && id.length > 0 && agents.some((agent) => agent.id === id)
  if (isValid(teamConfig.hostAgentId)) return teamConfig.hostAgentId
  for (const memberId of teamConfig.memberAgentIds) {
    if (isValid(memberId)) return memberId
  }
  const firstAgent = agents[0]
  if (firstAgent != null) return firstAgent.id
  return teamConfig.hostAgentId || 'platform-manager-agent'
}

type ChatViewProps = {
  approvalRequest?: PermissionApprovalRequest | null
  onApprovalClose?: (sessionId: string, requestId?: string) => void
  userQuestion?: UserQuestionData | null
  onUserQuestionClose?: (sessionId: string, questionId?: string) => void
  onExpandSidebar?: () => void
  paletteCommandRequest?: { id: number; commandText: string } | null
}

const SAFE_FILE_SCHEME = 'safe-file'

const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'
const COMPOSER_DRAFTS_KEY = 'spark-agent:composer-drafts'
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'
const CHAT_MESSAGE_ESTIMATED_HEIGHT = 180
const CHAT_MESSAGE_OVERSCAN = 8
const EMPTY_PROMPT_LAYER: PromptConfigGetResponse['system'] = { enabled: false, content: '' }
const EMPTY_ENV_LAYER: EnvConfigGetResponse['project'] = { enabled: true, vars: [] }

/**
 * 空会话（无活跃 session）下挂载内置终端面板时使用的伪 sessionId。
 *
 * 内置终端面板需要一个 string 形态的 sessionId 作为 PTY 生命周期键 + localStorage
 * 命名空间。空会话没有真实 session，但用户可能希望在选好项目文件夹后直接开终端，
 * 因此用这个稳定的 app 级占位 id。它的 PTY 仅在 activeWorkspace 存在时创建，
 * 且会在面板关闭 / 真实会话创建 / 应用关闭时被清理。
 */
const EMPTY_HERO_TERMINAL_SESSION_ID = '__empty_hero__'

/**
 * 单条环境变量编辑行。
 * 定义在模块作用域（而非组件内），保证每次父级重渲染不会更换组件类型导致 input 重挂载丢焦点。
 * 明文切换状态 showValue 只属于这一行，独立于父级 vars 数组，无需扰动持久化逻辑。
 */

export function ChatView({
  approvalRequest = null,
  onApprovalClose,
  userQuestion = null,
  onUserQuestionClose,
  onExpandSidebar,
  paletteCommandRequest = null,
}: ChatViewProps = {}) {
  const { t, setTweak } = useApp()
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
  // 侧边聊天面板宽度：可拖拽伸缩，默认值按窗口宽度分档（见 defaultUnifiedSidePanelWidth）
  const [sideChatWidth, setSideChatWidth] = useState(defaultUnifiedSidePanelWidth)
  // 内置终端面板：会话级 dock，按钮在 ChatTabbar 右上。
  // 仅在有活跃会话且绑定 workspace 时启用；切会话会保留各自的 terminals（后端负责）。
  const [showTerminalPanel, setShowTerminalPanel] = useState(false)
  const [showGitReviewPanel, setShowGitReviewPanel] = useState(false)
  const [unifiedSideTabs, setUnifiedSideTabs] = useState<UnifiedSidePanelKind[]>([])
  const [activeUnifiedSideTab, setActiveUnifiedSideTab] = useState<UnifiedSidePanelKind | null>(
    null,
  )
  // 统一面板是否展开（独立于 tabs 数组：tabs 记录"已打开过哪些 tab"，unifiedPanelOpen 只控制容器显隐）
  // 入口按钮只 toggle 此状态；首次打开 tabs 为空 → 显示空状态，用户在 tabbar 内再选要打开哪个 tab
  const [unifiedPanelOpen, setUnifiedPanelOpen] = useState(false)
  const [showGitEnvPanel, setShowGitEnvPanel] = useState(false)
  // 自动展开 git+任务悬浮面板用：用户手动 toggle/关闭过后，本会话不再自动展开。
  const gitPanelUserInteractedRef = useRef(false)
  const showGitEnvPanelRef = useRef(false)
  const gitEnvPanelCompactRef = useRef(false)
  // 自动展开触发检测的上一轮基线；切会话/切仓库时一并重置（见对应 effect）。
  // 首次采样只记录基线、不触发，避免切到已有变更的老会话时误弹出面板。
  const autoOpenSampledRef = useRef(false)
  const prevAutoOpenSessionStatusRef = useRef<SessionSummary['status'] | null>(null)
  const prevAutoOpenTasksLenRef = useRef(0)
  const prevAutoOpenGitChangedFilesRef = useRef(0)
  const prevAutoOpenGoalPresentRef = useRef(false)
  const [gitCommitModalOpen, setGitCommitModalOpen] = useState(false)
  const [gitBranchModalOpen, setGitBranchModalOpen] = useState(false)
  const [gitCreateBranchOpen, setGitCreateBranchOpen] = useState(false)
  // Codex-like side chat: a second in-project session docked beside the current chat.
  const [showSideChatPanel, setShowSideChatPanel] = useState(false)
  const [sideChatSessionId, setSideChatSessionId] = useState<SessionId | null>(null)
  const [sideChatCreating, setSideChatCreating] = useState(false)
  const [sideChatAgentStatus, setSideChatAgentStatus] = useState('')
  const [sideChatMessages, setSideChatMessages] = useState<UIMessage[]>([])
  const [sideChatContextInputTokens, setSideChatContextInputTokens] = useState(0)
  const [sideChatContextUsage, setSideChatContextUsage] = useState<ContextUsageState | null>(null)
  const [sideChatContextLedger, setSideChatContextLedger] = useState<ContextLedgerState | null>(
    null,
  )
  const [sideChatScrollToBottomTrigger, setSideChatScrollToBottomTrigger] = useState(0)

  // ── 按会话隔离的侧面板 UI 状态 ──
  // 切换会话时把当前面板状态存到 prevId 槽位，加载 active 对应快照；
  // 后端长驻任务（终端 PTY / side-chat session）不受影响，切回自动恢复展开状态。
  type PanelSnapshot = {
    unifiedSideTabs: UnifiedSidePanelKind[]
    activeUnifiedSideTab: UnifiedSidePanelKind | null
    unifiedPanelOpen: boolean
    showConfigPanel: boolean
    showTerminalPanel: boolean
    showGitReviewPanel: boolean
    showSideChatPanel: boolean
    showInspector: boolean
    filePreview: { filePath: string; fileType: PreviewFileType } | null
    sideChatSessionId: SessionId | null
  }
  const emptyPanelSnapshot: PanelSnapshot = {
    unifiedSideTabs: [],
    activeUnifiedSideTab: null,
    unifiedPanelOpen: false,
    showConfigPanel: false,
    showTerminalPanel: false,
    showGitReviewPanel: false,
    showSideChatPanel: false,
    showInspector: false,
    filePreview: null,
    sideChatSessionId: null,
  }
  // 各 session 的面板快照（仅内存）
  const panelStateBySessionRef = useRef<Map<string, PanelSnapshot>>(new Map())
  // 上一个 active id，用于切换时把旧会话状态存盘
  const prevActiveRef = useRef<string | null>(active)
  // 始终镜像当前面板状态；render 写、effect 读，保证 effect 拿到切换前的真实值
  const latestPanelStateRef = useRef<PanelSnapshot>(emptyPanelSnapshot)

  const openUnifiedSidePanel = useCallback((kind: UnifiedSidePanelKind) => {
    // 互斥：会话检查器 / 统一面板 / 文件预览三者同一时刻只显示一个
    setShowInspector(false)
    setFilePreview(null)
    setUnifiedPanelOpen(true)
    setUnifiedSideTabs((tabs) => (tabs.includes(kind) ? tabs : [...tabs, kind]))
    setActiveUnifiedSideTab(kind)
    if (kind === 'config') setShowConfigPanel(true)
    if (kind === 'terminal') setShowTerminalPanel(true)
    if (kind === 'review') setShowGitReviewPanel(true)
    if (kind === 'side-chat') {
      setShowSideChatPanel(true)
      void ensureSideChatSessionRef.current()
    }
  }, [])

  const closeUnifiedSidePanel = useCallback((kind: UnifiedSidePanelKind) => {
    setUnifiedSideTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== kind)
      setActiveUnifiedSideTab((activeTab) =>
        activeTab !== kind ? activeTab : (next.at(-1) ?? null),
      )
      return next
    })
    if (kind === 'config') setShowConfigPanel(false)
    if (kind === 'terminal') setShowTerminalPanel(false)
    if (kind === 'review') setShowGitReviewPanel(false)
    if (kind === 'side-chat') setShowSideChatPanel(false)
  }, [])

  // 代码还原点时间线抽屉：把「按会话撤回代码」做成集中可还原视图，按钮在 ChatTabbar 右上。
  const [showCheckpointTimeline, setShowCheckpointTimeline] = useState(false)
  // 代码还原点：会话开关（开/关样式）+ 可用性（仅 git 仓库可用，否则隐藏入口）。
  const [checkpointEnabled, setCheckpointEnabled] = useState(false)
  const [checkpointAvailable, setCheckpointAvailable] = useState(false)
  const { invoke: getCheckpointConfigForButton } = useIpcInvoke('session:get-checkpoint-config')
  useEffect(() => {
    if (active == null) {
      setCheckpointEnabled(false)
      setCheckpointAvailable(false)
      return
    }
    let cancelled = false
    getCheckpointConfigForButton({ sessionId: active })
      .then((r) => {
        if (!cancelled) {
          setCheckpointEnabled(r.enabled)
          setCheckpointAvailable(r.available)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCheckpointEnabled(false)
          setCheckpointAvailable(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [active, getCheckpointConfigForButton])
  // Team Mode 配置。
  // 双层持久化（设计文档 §5.1）：
  //   - composer-prefs(localStorage)：全局「上次使用」默认，新会话/无会话时回落。
  //   - sessions.metadata.team(IPC team:update)：会话级权威来源，Phase 3 运行时读取。
  const { invoke: persistTeamConfig } = useIpcInvoke('team:update')
  const { invoke: listTeamMembers } = useIpcInvoke('team:list-members')
  const { invoke: getTeamDef } = useIpcInvoke('team:get-def')
  // 构建「无会话级 team 配置」时兜底的 TeamModeConfig。
  // 关键原则（修复跨会话串台）：team 是否启用一律以「会话级 metadata」为唯一真相，
  // 绝不从全局 composer-prefs 继承 enabled —— 否则在别的会话开过 team 后，回到
  // 一个从未配置过 team 的单 agent 会话，会被全局 prefs 误判成 team（参数串台 bug）。
  // 因此 enabled 恒为 false：新会话 / 空白 composer / 无 team 配置的老会话都单 agent 起步，
  // 需要团队时由用户在该会话内显式开启（onEnableTeamMode 会把 host 设为当前会话 agent）。
  // host/members 仍保留「上次使用」prefs，仅作为用户显式开启团队时的便捷预填，团队关闭时不影响显示。
  const defaultTeamConfig = useCallback((): TeamModeConfig => {
    const prefs = readComposerPrefs()
    const memberIds = prefs.teamMemberAgentIds ?? []
    const candidateHost =
      prefs.teamHostAgentId ??
      memberIds.find((id) => agents.some((agent) => agent.id === id)) ??
      agents[0]?.id ??
      prefs.agentId ??
      'platform-manager-agent'
    return {
      enabled: false,
      hostAgentId: candidateHost,
      memberAgentIds: memberIds,
      maxDepth: 1,
      allowNesting: false,
      maxDiscussionRounds: 6,
      enablePeerMessaging: false,
    }
  }, [agents])
  const [teamConfig, setTeamConfig] = useState<TeamModeConfig>(defaultTeamConfig)
  const teamConfigRef = useRef(teamConfig)
  const teamConfigRevisionRef = useRef(0)
  const emptySessionTeamTouchedRef = useRef(false)
  const prevActiveForTeamRef = useRef<string | null>(active)
  useEffect(() => {
    teamConfigRef.current = teamConfig
  }, [teamConfig])
  useEffect(() => {
    if (shouldResetEmptySessionTeamTouched(prevActiveForTeamRef.current, active)) {
      teamConfigRevisionRef.current += 1
      emptySessionTeamTouchedRef.current = false
      prevActiveForTeamRef.current = active
    }
  }, [active])
  const updateTeamConfig = useCallback(
    async (patch: Partial<TeamModeConfig>): Promise<void> => {
      if (active == null && patch.enabled !== undefined) {
        emptySessionTeamTouchedRef.current = true
      }
      const previous = teamConfigRef.current
      const next = { ...previous, ...patch }
      const revision = teamConfigRevisionRef.current + 1
      teamConfigRevisionRef.current = revision
      teamConfigRef.current = next
      // 活跃会话先等待 metadata 落库再更新 UI，保证发送时的可见模式与执行态一致。
      if (active != null) {
        try {
          await persistTeamConfig({ sessionId: active as SessionId, config: next })
        } catch (error) {
          if (teamConfigRevisionRef.current === revision) {
            try {
              const res = await listTeamMembers({ sessionId: active as SessionId })
              if (teamConfigRevisionRef.current === revision) {
                const authoritative = res.config ?? defaultTeamConfig()
                teamConfigRef.current = authoritative
                setTeamConfig(authoritative)
              }
            } catch {
              if (teamConfigRevisionRef.current === revision) {
                teamConfigRef.current = previous
                setTeamConfig(previous)
              }
            }
          }
          console.error('Persist team config failed', error)
          return
        }
        if (teamConfigRevisionRef.current !== revision) return
      }
      setTeamConfig(next)
      // 仅缓存 host/members 作为「下次显式开启团队」时的便捷预填；
      // 不再缓存 enabled —— team 是否启用一律以会话级 metadata 为准（见 defaultTeamConfig）。
      writeComposerPrefs({
        teamHostAgentId: next.hostAgentId,
        teamMemberAgentIds: next.memberAgentIds,
      })
    },
    [active, defaultTeamConfig, listTeamMembers, persistTeamConfig],
  )
  // 团队模式下，最终用于指派的主持 Agent（hostAgentId 解析结果）；
  // hostAgentId 可能因为旧 host 被删除而失效，因此渲染/sendTurn 都用此值。
  const effectiveHostAgentId = teamConfig.enabled
    ? resolveTeamHostAgentId(teamConfig, agents)
    : null

  // 当前会话关联的已保存团队名（临时团队为 null），用于空会话标题「<团队名> 已就绪」。
  const [activeTeamName, setActiveTeamName] = useState<string | null>(null)
  useEffect(() => {
    if (!teamConfig.enabled || teamConfig.teamId == null) {
      setActiveTeamName(null)
      return
    }
    let cancelled = false
    void getTeamDef({ id: teamConfig.teamId })
      .then((res) => {
        if (!cancelled) setActiveTeamName(res.team?.name ?? null)
      })
      .catch(() => {
        if (!cancelled) setActiveTeamName(null)
      })
    return () => {
      cancelled = true
    }
  }, [teamConfig.enabled, teamConfig.teamId, getTeamDef])
  // 切换 active session 时从 metadata 拉取会话级 team config 回显；
  // 历史团队会话能正常恢复底部参数与右侧 Inspector 的团队信息。
  const reloadActiveTeamConfig = useCallback(async () => {
    if (active == null) {
      setTeamConfig((current) =>
        preserveExplicitEmptySessionTeamConfig(
          current,
          defaultTeamConfig(),
          emptySessionTeamTouchedRef.current,
        ),
      )
      return
    }
    const requestRevision = teamConfigRevisionRef.current
    const res = await listTeamMembers({ sessionId: active as SessionId })
    if (teamConfigRevisionRef.current !== requestRevision) return
    if (res.config != null) setTeamConfig(res.config)
    else setTeamConfig(defaultTeamConfig())
  }, [active, defaultTeamConfig, listTeamMembers])

  useEffect(() => {
    let cancelled = false
    if (active == null) {
      setTeamConfig((current) =>
        preserveExplicitEmptySessionTeamConfig(
          current,
          defaultTeamConfig(),
          emptySessionTeamTouchedRef.current,
        ),
      )
      return () => {
        cancelled = true
      }
    }
    const requestRevision = teamConfigRevisionRef.current
    void listTeamMembers({ sessionId: active as SessionId })
      .then((res) => {
        if (cancelled) return
        if (teamConfigRevisionRef.current !== requestRevision) return
        if (res.config != null) setTeamConfig(res.config)
        else setTeamConfig(defaultTeamConfig())
      })
      .catch(() => {
        if (!cancelled) setTeamConfig(defaultTeamConfig())
      })
    return () => {
      cancelled = true
    }
  }, [active, defaultTeamConfig, listTeamMembers])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope !== 'team') return
        if (active == null) {
          setTeamConfig((current) =>
            preserveExplicitEmptySessionTeamConfig(
              current,
              defaultTeamConfig(),
              emptySessionTeamTouchedRef.current,
            ),
          )
          return
        }
        if (
          teamConfig.teamId != null &&
          event.id === teamConfig.teamId &&
          (event.action === 'update' || event.action === 'delete')
        ) {
          if (event.action === 'delete') {
            updateTeamConfig({ enabled: false, teamId: undefined })
            return
          }
          void getTeamDef({ id: teamConfig.teamId })
            .then((res) => {
              if (res.team == null) return
              updateTeamConfig({
                enabled: true,
                hostAgentId: res.team.hostAgentId,
                memberAgentIds: res.team.memberAgentIds,
                maxDepth: res.team.maxDepth,
                allowNesting: res.team.allowNesting,
                teamId: res.team.id,
                maxDiscussionRounds: res.team.maxDiscussionRounds ?? 6,
                enablePeerMessaging: res.team.enablePeerMessaging === true,
              })
            })
            .catch(() => {
              void reloadActiveTeamConfig().catch(() => {})
            })
          return
        }
        void reloadActiveTeamConfig().catch(() => {})
      }) ?? (() => {})
    )
  }, [
    active,
    defaultTeamConfig,
    getTeamDef,
    reloadActiveTeamConfig,
    teamConfig.teamId,
    updateTeamConfig,
  ])

  // 进入空白新会话（新建任务 / active 被清空）时，关闭 Inspector / 统一面板，
  // 否则它们会沿用上一个会话的展开态继续遮挡空白聊天区。
  // 切换会话：把当前面板状态存给上一个会话，加载目标会话的快照（无则收起全部）。
  // 后端长驻任务（终端 PTY / side-chat session）不在此处理 —— 切回时各组件重新挂载/订阅
  // 即可接回原本在跑的任务（PTY 不杀、side-chat session 在后端继续运行）。
  useEffect(() => {
    const prevId = prevActiveRef.current
    prevActiveRef.current = active
    if (prevId === active) return
    // 存盘上一个会话的面板状态
    if (prevId != null) {
      panelStateBySessionRef.current.set(prevId, latestPanelStateRef.current)
    }
    if (active == null) {
      // 退到无会话：收起所有参与记忆的面板
      setShowInspector(false)
      setShowConfigPanel(false)
      setShowTerminalPanel(false)
      setShowGitReviewPanel(false)
      setShowSideChatPanel(false)
      setUnifiedPanelOpen(false)
      setUnifiedSideTabs([])
      setActiveUnifiedSideTab(null)
      setFilePreview(null)
      setSideChatSessionId(null)
      return
    }
    const snap = panelStateBySessionRef.current.get(active)
    if (!snap) {
      // 首次进入该会话：默认收起所有面板（避免看到上个会话残留的面板）
      setShowInspector(false)
      setShowConfigPanel(false)
      setShowTerminalPanel(false)
      setShowGitReviewPanel(false)
      setShowSideChatPanel(false)
      setUnifiedPanelOpen(false)
      setUnifiedSideTabs([])
      setActiveUnifiedSideTab(null)
      setFilePreview(null)
      setSideChatSessionId(null)
      return
    }
    // 恢复该会话上次的展开状态
    setShowInspector(snap.showInspector)
    setShowConfigPanel(snap.showConfigPanel)
    setShowTerminalPanel(snap.showTerminalPanel)
    setShowGitReviewPanel(snap.showGitReviewPanel)
    setShowSideChatPanel(snap.showSideChatPanel)
    setUnifiedPanelOpen(snap.unifiedPanelOpen)
    setUnifiedSideTabs(snap.unifiedSideTabs)
    setActiveUnifiedSideTab(snap.activeUnifiedSideTab)
    setFilePreview(snap.filePreview)
    setSideChatSessionId(snap.sideChatSessionId)
    // side-chat 运行时 state 清空，交给 SessionStream（key 随 sideChatSessionId 变化）重新订阅填充
    setSideChatMessages([])
    setSideChatContextInputTokens(0)
    setSideChatContextUsage(null)
    setSideChatContextLedger(null)
    setSideChatAgentStatus('')
  }, [active])
  const [agentStatus, setAgentStatus] = useState('')
  const [composerFocusTrigger, setComposerFocusTrigger] = useState(0)
  /**
   * 重发请求：从用户消息上的"重发"按钮触发，把该消息的文本+附件重新塞回输入区。
   * requestId 单调递增，ComposerV2 内部通过 useEffect 监听其变化执行写入。
   */
  const [resendRequest, setResendRequest] = useState<{
    requestId: number
    payload: ComposerPrefillPayload
  } | null>(null)
  const chatLayoutRef = useRef<HTMLDivElement | null>(null)
  const chatAreaRef = useRef<HTMLDivElement | null>(null)
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([])
  const storedModelSwitchMarkers = useMemo(() => readModelSwitchMarkers(active), [active])
  const [modelSwitchState, setModelSwitchState] = useState<{
    sessionId: SessionId | null
    markers: ModelSwitchMarker[]
  }>({ sessionId: active, markers: storedModelSwitchMarkers })
  const modelSwitchMarkers =
    modelSwitchState.sessionId === active ? modelSwitchState.markers : storedModelSwitchMarkers

  const handleModelSwitch = useCallback(
    (change: Omit<ModelSwitchMarker, 'createdAt'>) => {
      if (active == null) return
      setModelSwitchState({
        sessionId: active,
        markers: saveModelSwitchMarker(active, {
          ...change,
          createdAt: new Date().toISOString(),
        }),
      })
    },
    [active],
  )
  const [activeSessionGoal, setActiveSessionGoal] = useState<GoalSnapshot | null>(null)
  const [activeSessionOrchestration, setActiveSessionOrchestration] =
    useState<OrchestrationSnapshot | null>(null)
  // 活跃会话历史是否正在加载。用于区分「真正的空会话」与「老会话历史还没加载完」：
  // 从非聊天页（如 Agents）点进一个老会话时，ChatView 重新挂载、activeMessages 还是空，
  // 若仅凭空数组判定就会误闪「新建会话 hero」，加载完才跳到目标会话。
  // 初值取 active != null，保证首帧（挂载即带 sessionId）就抑制 hero，无需等副作用。
  const [activeSessionLoading, setActiveSessionLoading] = useState(active != null)
  // active 变化（含挂载后切换）时，在历史加载完成前先抑制 hero。
  // 用 layout effect 在浏览器绘制前同步置位，避免 active 已切到老会话却闪一帧 hero。
  useLayoutEffect(() => {
    if (active != null) setActiveSessionLoading(true)
  }, [active])
  // ComposerV2 发送中（含 createSession + sendTurn + 命令路径）。
  // 用于：抑制首条消息发送瞬间的 hero 闪现（覆盖 status 还没切到 running 的窗口）。
  const [composerDispatching, setComposerDispatching] = useState(false)
  const [contextInputTokens, setContextInputTokens] = useState(0)
  const [sessionUsageData, setSessionUsageData] = useState<SessionUsageData>({
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cacheHitTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  })
  const [contextUsage, setContextUsage] = useState<ContextUsageState | null>(null)
  const [contextLedger, setContextLedger] = useState<ContextLedgerState | null>(null)
  const [projectContext, setProjectContext] = useState<ProjectContextState | null>(null)
  // 待审批计划绑定到其所属会话，避免单一全局状态在切换会话时残留 / 把批准发到错误会话。
  const [proposedPlan, setProposedPlan] = useState<{ sessionId: SessionId; plan: string } | null>(
    null,
  )
  const [turnPromptSnapshots, setTurnPromptSnapshots] = useState<TurnPromptSnapshotEvent[]>([])
  const [branchState, setBranchState] = useState<BranchState>({ currentBranch: null, branches: [] })
  // 分支刷新触发器：窗口重新聚焦（用户可能在终端/IDE 里切了分支）或会话从 running 回到
  // idle（agent 自己切了分支）时 bump，让下方 listBranches effect 重新拉取最新分支。
  const [branchRefreshTick, setBranchRefreshTick] = useState(0)
  const [clearTrigger, setClearTrigger] = useState(0)
  // 用户发送消息时立即贴底（不等 user_message 事件从后端回来）：bump 这个计数器，
  // ChatStream 内部 effect 监听到变化即 scrollTop = scrollHeight。
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0)
  const [replyTo, setReplyTo] = useState<ReplyToState | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    return (
      window.spark?.on?.('stream:system-notification:navigate', (target) => {
        if (target.target === 'session') {
          sessionCtx.setActiveSession(target.sessionId as SessionId)
          setTweak('view', 'chat')
          return
        }
        if (target.target === 'view') {
          setTweak('view', target.view as never)
        }
      }) ?? (() => {})
    )
  }, [sessionCtx, setTweak])

  const handleCopyAllMessages = useCallback(() => {
    const markdown = serializeMessagesToMarkdown(activeMessages)
    if (!markdown) {
      toast.info('当前会话暂无可复制的聊天记录')
      return
    }
    navigator.clipboard
      .writeText(markdown)
      .then(() => toast.success('已复制全部聊天记录'))
      .catch((err) => toast.error(err instanceof Error ? err.message : '复制失败'))
  }, [activeMessages, toast])

  // ── 文件预览状态 ──
  const [filePreview, setFilePreview] = useState<{
    filePath: string
    fileType: PreviewFileType
  } | null>(null)

  // 镜像当前面板状态供 active 切换 effect 读取（render 阶段写入，先于 effect 执行）
  latestPanelStateRef.current = {
    unifiedSideTabs,
    activeUnifiedSideTab,
    unifiedPanelOpen,
    showConfigPanel,
    showTerminalPanel,
    showGitReviewPanel,
    showSideChatPanel,
    showInspector,
    filePreview,
    sideChatSessionId,
  }

  // ── IPC hooks (only those NOT duplicated in context) ──
  const { invoke: clearEvents } = useIpcInvoke('session:clear-events')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: cancelSessionTurn } = useIpcInvoke('session:cancel')
  const { invoke: listBranches } = useIpcInvoke('workspace:list-branches')
  const { invoke: switchBranch } = useIpcInvoke('workspace:switch-branch')
  const { invoke: commitGitChanges } = useIpcInvoke('workspace:git-commit')
  const { invoke: pushGitChanges } = useIpcInvoke('workspace:git-push')
  // 留空提交信息时，把提交请求作为消息发给当前会话的 agent，由 agent 分析 diff 并提交。
  const { invoke: sendTurnToAgent } = useIpcInvoke('session:submit-turn')
  const { invoke: createBranch } = useIpcInvoke('workspace:create-branch')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: ensureWindowWidth } = useIpcInvoke('window:ensure-width')

  const { invoke: answerQuestion } = useIpcInvoke('session:answer-question')
  const { invoke: controlGoal } = useIpcInvoke('session:goal-control')

  const handleAnswerQuestion = useCallback(
    async (answers: Record<string, unknown>) => {
      if (userQuestion == null) return
      // Build answer summaries from the submitted answers so the
      // InlineQuestionCard can display them immediately, before the
      // tool_result event arrives from the CLI.
      const summaries = buildQuestionAnswerSummaries(userQuestion.questions, answers)
      if (summaries.length > 0) {
        const cacheKey = getQuestionAnswerCacheKey(userQuestion.questions, userQuestion.sessionId)
        persistQuestionAnswerSummaries(cacheKey, summaries)
      }
      await answerQuestion({
        sessionId: userQuestion.sessionId,
        questionId: userQuestion.questionId,
        answers,
      })
      onUserQuestionClose?.(userQuestion.sessionId, userQuestion.questionId)
    },
    [answerQuestion, onUserQuestionClose, userQuestion],
  )

  const handleCancelQuestion = useCallback(() => {
    if (userQuestion == null) return
    const answers = buildQuestionCancelAnswer(userQuestion.questions)
    const summaries = buildQuestionAnswerSummaries(userQuestion.questions, answers)
    if (summaries.length > 0) {
      persistQuestionAnswerSummaries(
        getQuestionAnswerCacheKey(userQuestion.questions, userQuestion.sessionId),
        summaries,
      )
    }
    answerQuestion({
      sessionId: userQuestion.sessionId,
      questionId: userQuestion.questionId,
      answers,
    }).catch(console.error)
    onUserQuestionClose?.(userQuestion.sessionId, userQuestion.questionId)
  }, [answerQuestion, onUserQuestionClose, userQuestion])

  // ── Session status updates via context ──
  const setSessionStatus = useCallback(
    (sessionId: SessionId, status: SessionSummary['status']) => {
      sessionCtx.updateSessionInList(sessionId, { status })
    },
    [sessionCtx.updateSessionInList],
  )
  const handleActiveSessionStatusChange = useCallback(
    (status: SessionSummary['status']) => {
      if (active != null) setSessionStatus(active, status)
    },
    [active, setSessionStatus],
  )

  // 用户点了「发送」：立刻贴底 + 维护 session running 状态 + 会话列表计数。
  // 单独抽出回调，给两个 ComposerV2 分支共用，保证 scrollToBottomTrigger 一定 bump。
  const handleUserSent = useCallback(
    (sessionId: SessionId) => {
      setSessionStatus(sessionId, 'running')
      sessionCtx.bumpSessionMessageCount(sessionId)
      setScrollToBottomTrigger((n) => n + 1)
    },
    [setSessionStatus, sessionCtx],
  )

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

  // Goal 控制：UI 触发后只调 IPC，goal_* 事件回流时由 onGoalChange 同步更新状态。
  const handleGoalControl = useCallback(
    (action: 'pause' | 'resume' | 'clear' | 'complete') => {
      if (!active) return
      controlGoal({ sessionId: active, action }).catch(console.error)
    },
    [active, controlGoal],
  )

  const handleFilePreview = useCallback((filePath: string, fileType: PreviewFileType) => {
    setShowInspector(false)
    setShowConfigPanel(false)
    setShowGitReviewPanel(false)
    setShowSideChatPanel(false)
    setShowTerminalPanel(false)
    setUnifiedPanelOpen(false)
    setShowCheckpointTimeline(false)
    setFilePreview({ filePath, fileType })
  }, [])

  // 打开会话检查器：与统一面板、文件预览互斥（三者同一时刻只显示一个）
  const openInspector = useCallback(() => {
    setShowInspector(true)
    setUnifiedPanelOpen(false)
    setFilePreview(null)
  }, [])

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

  const switchToWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId)
    },
    [setActiveWorkspaceId],
  )

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
  const activeSessionWorkspace = (() => {
    const sessionWorkspaceId = activeSession?.workspaceIds[0]
    if (sessionWorkspaceId == null) return activeWorkspace
    return workspaces.find((item) => item.id === sessionWorkspaceId) ?? activeWorkspace
  })()
  const activeSessionWorkspaceId = activeSessionWorkspace?.id ?? null
  const activeProvider = providers.find((item) => item.id === activeSession?.providerProfileId)
  const activeProviderContextWindow = resolveProviderContextWindow(
    activeProvider?.supportsMillionContext === true,
    activeProvider?.contextWindow,
  )
  // 仅在「无活跃会话」或「活跃会话历史已加载完且确实为空」时显示新建会话 hero；
  // 历史加载中不显示，避免老会话进入时先闪一下空会话。
  // 三层排除：
  //  - activeSessionLoading：历史未加载完不显示
  //  - activeSession?.status === 'running'：sendTurn 已成功但首条流式消息还没到的窗口不显示
  //  - composerDispatching：发送瞬间到 onSent/status 切换之间的兜底，避免任何时序错位闪现 hero
  const showEmptyHero =
    active == null ||
    (activeMessages.length === 0 &&
      !activeSessionLoading &&
      activeSession?.status !== 'running' &&
      !composerDispatching)
  const gitWorkspace = resolveComposerGitWorkspace({
    showEmptyHero,
    activeWorkspace,
    activeSessionWorkspace,
  })
  const gitWorkspaceId = gitWorkspace?.id ?? null
  const { gitStatus, applyGitStatus, refreshGitStatus } = useLiveWorkspaceGitStatus({
    workspaceId: gitWorkspaceId,
    sessionId: active,
    refreshSignal: branchRefreshTick,
    live: showGitEnvPanel || showGitReviewPanel,
    onBranchStateChange: setBranchState,
  })
  const activeSessionTasks = useMemo(
    () => (active == null ? [] : extractSessionProgressTasks(activeMessages)),
    [active, activeMessages],
  )

  useEffect(() => {
    if (activeSession?.providerProfileId) {
      setSelectedProviderId(activeSession.providerProfileId)
    }
  }, [activeSession?.providerProfileId, setSelectedProviderId])

  // 拉取当前 workspace 的 git 分支信息。
  // 重新拉取的时机：
  //   1. activeSessionWorkspace.id 变化（切换会话/项目）
  //   2. branchRefreshTick 变化 —— 窗口重新聚焦 / 会话结束（见下方监听），覆盖
  //      用户在终端或 IDE 内手动 git switch、或 agent 自己切了分支后界面不同步的场景。
  useEffect(() => {
    if (gitWorkspaceId == null) {
      setBranchState({ currentBranch: null, branches: [] })
      return
    }
    let cancelled = false
    listBranches({ workspaceId: gitWorkspaceId })
      .then((res) => {
        if (!cancelled) setBranchState(res)
      })
      .catch(() => {
        if (!cancelled) setBranchState({ currentBranch: null, branches: [] })
      })
    return () => {
      cancelled = true
    }
  }, [gitWorkspaceId, branchRefreshTick, listBranches])

  const isGitRepo = gitStatus?.isGitRepo === true
  // 右上角环境面板（git / 进程 / 目标）只要三者其一有内容即可展示，不再强依赖 git 仓库。
  const hasEnvPanelContent = isGitRepo || activeSessionTasks.length > 0 || activeSessionGoal != null

  useEffect(() => {
    showGitEnvPanelRef.current = showGitEnvPanel
  }, [showGitEnvPanel])

  useEffect(() => {
    const syncGitEnvPanelForViewport = (): void => {
      const compact = window.innerWidth <= 1080
      if (compact && !gitEnvPanelCompactRef.current && showGitEnvPanelRef.current) {
        gitPanelUserInteractedRef.current = true
        showGitEnvPanelRef.current = false
        setShowGitEnvPanel(false)
      }
      gitEnvPanelCompactRef.current = compact
    }
    syncGitEnvPanelForViewport()
    window.addEventListener('resize', syncGitEnvPanelForViewport)
    return () => window.removeEventListener('resize', syncGitEnvPanelForViewport)
  }, [])

  useEffect(() => {
    // 新会话默认收起右上角 git 悬浮面板，需要时由用户手动展开。
    setShowGitEnvPanel(false)
    // 重置自动展开跟踪：新会话/新仓库内，用户尚未手动操作，采样基线也一并清空。
    gitPanelUserInteractedRef.current = false
    autoOpenSampledRef.current = false
    prevAutoOpenTasksLenRef.current = 0
    prevAutoOpenGitChangedFilesRef.current = 0
    prevAutoOpenGoalPresentRef.current = false
    prevAutoOpenSessionStatusRef.current = activeSession?.status ?? null
    // 在仓库/会话切换时重置；不放 activeSession.status，避免 status 变化反复重置基线。
    // 依赖里同时放 `active`，让「同仓库内从有内容的会话切到空会话」也能命中重置，
    // 否则仅 workspace 不变时面板状态会一直保留在旧会话上。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitWorkspaceId, active])

  useEffect(() => {
    if (isGitRepo) return
    setGitCommitModalOpen(false)
    setGitBranchModalOpen(false)
    setGitCreateBranchOpen(false)
  }, [isGitRepo])

  // 自动展开右上角环境悬浮面板（git / 进程 / 目标）。
  // 触发条件（须同时满足）：
  //   1. 三者其一有内容（git 仓库 / 有任务 / 有目标），否则面板不会渲染
  //   2. 用户未手动 toggle/关闭过面板
  //   3. 面板当前是收起状态
  //   4. 任一信号出现上升沿：会话开始(非 running→running)、任务列表出现/更新、
  //      git 变更文件出现/更新、目标从无到有
  useEffect(() => {
    if (!hasEnvPanelContent) return
    if (gitPanelUserInteractedRef.current) return
    if (showGitEnvPanel) return

    const currStatus = activeSession?.status ?? null
    const currTasksLen = activeSessionTasks.length
    const currChangedFiles = gitStatus?.changedFiles ?? 0
    const currGoalPresent = activeSessionGoal != null

    if (!autoOpenSampledRef.current) {
      // 首次只采样基线，避免切到已有变更的老会话时立刻弹出面板。
      autoOpenSampledRef.current = true
      prevAutoOpenSessionStatusRef.current = currStatus
      prevAutoOpenTasksLenRef.current = currTasksLen
      prevAutoOpenGitChangedFilesRef.current = currChangedFiles
      prevAutoOpenGoalPresentRef.current = currGoalPresent
      return
    }

    let shouldOpen = false
    if (prevAutoOpenSessionStatusRef.current !== 'running' && currStatus === 'running') {
      shouldOpen = true
    }
    if (currTasksLen > 0 && currTasksLen !== prevAutoOpenTasksLenRef.current) {
      shouldOpen = true
    }
    if (currChangedFiles > 0 && currChangedFiles !== prevAutoOpenGitChangedFilesRef.current) {
      shouldOpen = true
    }
    if (currGoalPresent && !prevAutoOpenGoalPresentRef.current) {
      shouldOpen = true
    }

    prevAutoOpenSessionStatusRef.current = currStatus
    prevAutoOpenTasksLenRef.current = currTasksLen
    prevAutoOpenGitChangedFilesRef.current = currChangedFiles
    prevAutoOpenGoalPresentRef.current = currGoalPresent

    if (shouldOpen && window.innerWidth <= 1080) {
      gitPanelUserInteractedRef.current = true
      return
    }

    if (shouldOpen) {
      setShowGitEnvPanel(true)
    }
  }, [
    hasEnvPanelContent,
    activeSession?.status,
    activeSessionTasks.length,
    gitStatus,
    activeSessionGoal,
    showGitEnvPanel,
  ])

  const handleOpenGitReview = useCallback(() => {
    openUnifiedSidePanel('review')
    // review 内容较宽，保底 520；但极窄窗下要受视口上限约束，避免 state 与渲染不一致
    setSideChatWidth((width) => Math.max(width, Math.min(520, maxSideChatWidthForViewport())))
    setShowInspector(false)
  }, [openUnifiedSidePanel])

  // 窗口重新聚焦时刷新分支：用户切到外部终端/IDE 改了分支后回到应用，会话内分支显示
  // 需要同步。用 document.visibilityState 兜住最小化后还原的情况。
  useEffect(() => {
    const onFocus = (): void => {
      setBranchRefreshTick((n) => n + 1)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  // 会话从 running 回到 idle 时刷新分支：agent 可能在执行过程中 git switch 了分支，
  // 任务结束后界面需要同步最新分支状态。仅捕获 running→非 running 的下降沿。
  const prevSessionStatusRef = useRef<SessionSummary['status'] | null>(null)
  useEffect(() => {
    const prev = prevSessionStatusRef.current
    const curr = activeSession?.status ?? null
    prevSessionStatusRef.current = curr
    if (
      prev === 'running' &&
      curr != null &&
      curr !== 'running' &&
      activeSessionWorkspace != null
    ) {
      setBranchRefreshTick((n) => n + 1)
    }
  }, [activeSession?.status, activeSessionWorkspace])

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

  const ensureChatLayoutFitsWindow = useCallback(
    (allowShrink = false, allowGrow = true) => {
      const layout = chatLayoutRef.current
      if (layout == null) return
      const layoutStyle = window.getComputedStyle(layout)
      const mainMinWidth = Number.parseFloat(layoutStyle.getPropertyValue('--chat-main-min-width'))
      const chatMainMinWidth = Number.isFinite(mainMinWidth) ? mainMinWidth : 520
      const sidePanelsWidth = Array.from(layout.children).reduce((sum, child) => {
        return child === chatAreaRef.current ? sum : sum + child.getBoundingClientRect().width
      }, 0)
      const desiredLayoutWidth = chatMainMinWidth + sidePanelsWidth
      const minWidth = Math.max(
        800,
        Math.ceil(window.innerWidth + desiredLayoutWidth - layout.clientWidth + 8),
      )
      void ensureWindowWidth({ minWidth, allowShrink, allowGrow }).catch(() => {})
    },
    [ensureWindowWidth],
  )

  useLayoutEffect(() => {
    const layout = chatLayoutRef.current
    if (layout == null) return
    let rafId = 0
    const isManualPanelResizeActive = () =>
      document.body.classList.contains('inspector-resizing') ||
      document.body.classList.contains('side-chat-resizing') ||
      document.body.classList.contains('browser-panel-resizing') ||
      document.body.classList.contains('file-preview-resizing')
    // Width auto-fit 决策：
    //   - 仅在布局内部状态变化（侧栏开关 / tabs 切换 / sidebarHidden 联动导致主区宽度变化）
    //     时才允许把窗口拉宽（allowGrow=true）。用户主动拖窗口缩小时不应被拉回去，
    //     这是修复"调整窗口宽度会缩小一点又弹回来"的关键。
    //   - 拖动 panel 自身的 resize handle 时彻底跳过（避免和用户拖拽意图冲突）。
    type EnsureTrigger = 'mount' | 'layout' | 'window' | 'mutation'
    const scheduleEnsure = (trigger: EnsureTrigger = 'layout') => {
      window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        if (isManualPanelResizeActive()) return
        const allowGrow = trigger !== 'window'
        ensureChatLayoutFitsWindow(true, allowGrow)
      })
    }

    scheduleEnsure('mount')

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => scheduleEnsure('layout'))
    if (resizeObserver != null) {
      resizeObserver.observe(layout)
      Array.from(layout.children).forEach((child) => resizeObserver.observe(child))
    }

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            if (resizeObserver != null) {
              Array.from(layout.children).forEach((child) => resizeObserver.observe(child))
            }
            scheduleEnsure('mutation')
          })
    mutationObserver?.observe(layout, { childList: true })

    const handleWindowResize = () => scheduleEnsure('window')
    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [
    ensureChatLayoutFitsWindow,
    inspectorWidth,
    showConfigPanel,
    showInspector,
    showTerminalPanel,
    filePreview,
  ])

  const handleUpdateActiveSession = async (patch: SessionRuntimePatch) => {
    if (active == null) return
    const res = await updateSession({ sessionId: active, ...patch })
    sessionCtx.updateSessionInList(active, res.session)
  }

  // 把活跃会话的适配器/供应商/模型/权限/推理强度同步到指定 agent 的配置。
  // 用于「右侧 Inspector 切换主持人」——与底部输入框切换 agent / 切换主持人保持一致：
  // 会话用哪个适配器和模型，始终跟随当前活跃 agent（团队模式即主持人）。
  const syncSessionRuntimeToAgent = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      if (agent == null || active == null) return
      const provider =
        providers.find((p) => p.id === agent.providerProfileId) ??
        getPreferredProvider(
          providers,
          { ...readComposerPrefs(), agentId: agent.id },
          agent.agentAdapter,
        )
      const model =
        provider != null && isLocalCliProvider(provider)
          ? getProviderDefaultModel(provider)
          : (agent.modelId ?? provider?.defaultModel ?? provider?.modelIds[0] ?? '')
      const reasoning = normalizeComposerReasoningEffort(agent.reasoningEffort) ?? 'max'
      if (provider != null) setSelectedProviderId(provider.id)
      writeComposerPrefs({
        agentId: agent.id,
        adapter: agent.agentAdapter,
        ...(provider?.id !== undefined ? { providerProfileId: provider.id } : {}),
        modelId: model,
        permissionMode: agent.permissionMode,
        reasoningEffort: reasoning,
      })
      await handleUpdateActiveSession({
        agentId: agent.id,
        ...(provider != null ? { providerProfileId: provider.id } : {}),
        modelId: model || null,
        agentAdapter: agent.agentAdapter,
        permissionMode: agent.permissionMode,
        reasoningEffort: reasoning,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, providers, active, setSelectedProviderId],
  )

  // Inspector 改团队配置：主持人变化时一并同步会话运行时（其余 patch 仅更新团队配置）。
  const handleInspectorChangeConfig = useCallback(
    (patch: Partial<TeamModeConfig>) => {
      updateTeamConfig(patch)
      if (patch.hostAgentId != null && patch.hostAgentId !== teamConfig.hostAgentId) {
        void syncSessionRuntimeToAgent(patch.hostAgentId)
      }
    },
    [updateTeamConfig, teamConfig.hostAgentId, syncSessionRuntimeToAgent],
  )

  const handleSwitchBranch = async (branch: string): Promise<boolean> => {
    if (gitWorkspace == null || !branch || branch === branchState.currentBranch) return false
    try {
      const res = await switchBranch({ workspaceId: gitWorkspace.id, branch })
      setBranchState(res)
      await refreshGitStatus()
      toast.success(`已切换到 ${res.currentBranch}`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换分支失败，请检查是否存在未提交改动')
      return false
    }
  }

  const handleComposerSwitchBranch = async (branch: string): Promise<void> => {
    await handleSwitchBranch(branch)
  }

  const handleCreateBranch = async (branch: string) => {
    if (gitWorkspace == null) return
    try {
      const res = await createBranch({ workspaceId: gitWorkspace.id, branch })
      setBranchState({ currentBranch: res.currentBranch, branches: res.branches })
      applyGitStatus(res.status)
      toast.success(`已创建并切换到 ${res.currentBranch}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建并检出分支失败')
      throw err
    }
  }

  // 分支选择器每次展开时调用：主动重新拉取一次最新分支列表，避免用户在终端手动切分支
  // 后界面缓存不同步（常规刷新只在切换项目/窗口聚焦/会话结束时触发，见上方 effect）。
  const refreshBranches = async () => {
    if (gitWorkspaceId == null) return
    try {
      const res = await listBranches({ workspaceId: gitWorkspaceId })
      setBranchState(res)
    } catch {
      // 静默失败，保留上一次已知分支列表
    }
  }

  const handleCommitGitChanges = async (options: {
    message: string
    includeUnstaged: boolean
    push: boolean
  }) => {
    if (gitWorkspace == null) return
    let commitOptions = options
    // 留空提交信息：交给当前会话的 agent 分析 diff 并提交（携带暂存/推送开关）。
    // 没有活跃会话时回退到模板生成，保证提交按钮始终可用。
    if (options.message.trim() === '') {
      const sessionId = activeSession?.id
      if (sessionId != null) {
        try {
          await sendTurnToAgent({
            sessionId,
            message: buildAgentCommitMessage(options.includeUnstaged, options.push),
          })
          toast.success('已交给助手处理，请在对话中查看进度')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '提交失败')
          throw err
        }
        return
      }
      commitOptions = { ...options, message: buildDefaultCommitMessage(gitStatus) }
    }
    try {
      const res = await commitGitChanges({
        workspaceId: gitWorkspace.id,
        message: commitOptions.message,
        includeUnstaged: commitOptions.includeUnstaged,
        push: commitOptions.push,
      })
      applyGitStatus(res.status)
      toast.success(commitOptions.push ? '已提交并推送' : '已提交变更')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败')
      throw err
    }
  }

  const handlePushGitChanges = async () => {
    if (gitWorkspace == null) return
    try {
      const res = await pushGitChanges({ workspaceId: gitWorkspace.id })
      applyGitStatus(res.status)
      toast.success('已推送到远端')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '推送失败')
      throw err
    }
  }

  const handleReplyTo = useCallback(
    (msg: UIMessage, agentId?: string, agentName?: string, selectedText?: string) => {
      const source = selectedText?.trim() || extractTextFromBlocks(msg.blocks)
      const preview = compactQuotePreview(source)
      setReplyTo({
        messageId: msg.id,
        role: msg.role,
        ...(agentId != null ? { agentId } : {}),
        ...(agentName != null ? { agentName } : {}),
        contentPreview: preview || '(附件/图片)',
      })
      setComposerFocusTrigger((n) => n + 1)
    },
    [],
  )

  // 团队模式：引用成员消息气泡。messageId 取 host message（成员输出是其内部 block），
  // agentId/agentName 取成员，contentPreview 用所选文本或成员气泡内容。
  const handleReplyToMember = useCallback(
    (args: {
      messageId: string
      memberAgentId: string
      memberName: string
      content: string
      selectedText?: string
    }) => {
      const source = args.selectedText?.trim() || args.content
      const preview = compactQuotePreview(source)
      setReplyTo({
        messageId: args.messageId,
        role: 'assistant',
        agentId: args.memberAgentId,
        agentName: args.memberName,
        contentPreview: preview || '(附件/图片)',
      })
      setComposerFocusTrigger((n) => n + 1)
    },
    [],
  )

  const handleQuoteSelection = useCallback((text: string, label = '引用') => {
    const preview = compactQuotePreview(text)
    if (preview.length === 0) return
    setReplyTo({
      messageId: `selection-${Date.now()}`,
      role: 'selection',
      agentName: label,
      contentPreview: preview,
    })
    setComposerFocusTrigger((n) => n + 1)
  }, [])

  /**
   * 处理用户消息"重发"动作：把文本和附件打包成 resendRequest，
   * ComposerV2 通过 useEffect 监听 requestId 变化把内容写入当前会话草稿并自动 focus。
   */
  const handleResendMessage = useCallback((payload: ComposerPrefillPayload) => {
    setResendRequest((prev) => ({
      requestId: (prev?.requestId ?? 0) + 1,
      payload,
    }))
    // 顺手让输入区获得焦点
    setComposerFocusTrigger((n) => n + 1)
  }, [])

  const handleHeroPromptSelect = useCallback((text: string) => {
    setResendRequest((prev) => ({
      requestId: (prev?.requestId ?? 0) + 1,
      payload: {
        text,
        attachments: [],
        agentId: 'platform-manager-agent',
      },
    }))
    setComposerFocusTrigger((n) => n + 1)
  }, [])

  const runningTeamAgentIds = useMemo(
    () =>
      teamConfig.enabled
        ? extractRunningTeamAgentIds(
            activeMessages,
            effectiveHostAgentId ?? teamConfig.hostAgentId,
            activeSession?.status === 'running',
            getBlockTeamMemberContext,
            splitAssistantMessageBlocks,
            isHostActivityRunning,
          )
        : [],
    [
      activeMessages,
      activeSession?.status,
      effectiveHostAgentId,
      teamConfig.enabled,
      teamConfig.hostAgentId,
    ],
  )
  const composerIsWorking = isComposerSessionWorking(activeSession?.status)
  const sideChatSession = useMemo(
    () => sessions.find((session) => session.id === sideChatSessionId) ?? null,
    [sessions, sideChatSessionId],
  )
  const activeSideChatWorkspaceId =
    activeSessionWorkspace?.id ?? activeWorkspace?.id ?? activeWorkspaceId ?? null
  const sideChatSessionWorkspaceId = sideChatSession?.workspaceIds[0] ?? null
  const sideChatMatchesActiveWorkspace =
    sideChatSession != null && sideChatSessionWorkspaceId === activeSideChatWorkspaceId
  const sideChatWorkspace = useMemo(() => {
    const workspaceId = sideChatSessionWorkspaceId ?? activeSideChatWorkspaceId
    if (workspaceId == null) return activeSessionWorkspace ?? activeWorkspace
    return (
      workspaces.find((workspace) => workspace.id === workspaceId) ??
      activeSessionWorkspace ??
      activeWorkspace
    )
  }, [
    activeSessionWorkspace,
    activeSideChatWorkspaceId,
    activeWorkspace,
    sideChatSessionWorkspaceId,
    workspaces,
  ])

  const createSideChatSession = useCallback(
    async (overrides: Record<string, unknown> = {}) => {
      const workspaceId = activeSessionWorkspace?.id ?? activeWorkspace?.id ?? activeWorkspaceId
      const createdId = await sessionCtx.handleNewSession(workspaceId, {
        activate: false,
        forceNew: true,
        ...(activeSession != null
          ? {
              providerProfileId: activeSession.providerProfileId,
              ...(activeSession.modelId != null ? { modelId: activeSession.modelId } : {}),
              agentId: activeSession.agentId,
              agentAdapter: activeSession.agentAdapter,
              permissionMode: activeSession.permissionMode,
              chatMode: activeSession.chatMode,
              reasoningEffort: activeSession.reasoningEffort,
              ...(teamConfig.enabled ? { teamConfig } : {}),
            }
          : {}),
        ...overrides,
      })
      if (createdId != null) setSideChatSessionId(createdId)
      return createdId
    },
    [
      activeSession,
      activeSessionWorkspace?.id,
      activeWorkspace?.id,
      activeWorkspaceId,
      sessionCtx,
      teamConfig,
    ],
  )

  // 抽出"创建/替换侧边会话"的核心逻辑，供两条入口共享：
  //   1) openUnifiedSidePanel('side-chat') —— 快捷卡片 / Picker / Plus 菜单
  //   2) openSideChatPanel —— 顶栏按钮 / 面板内"新建侧边会话"
  // 任一入口都能保证面板打开后自动有一条可用的侧边会话，避免落到空状态文案。
  const ensureSideChatSession = useCallback(
    async (options: { replace?: boolean } = {}) => {
      if (sideChatSessionId != null && options.replace !== true && sideChatMatchesActiveWorkspace) {
        return
      }
      setSideChatCreating(true)
      if (options.replace === true || !sideChatMatchesActiveWorkspace) {
        setSideChatSessionId(null)
        setSideChatMessages([])
        setSideChatContextInputTokens(0)
        setSideChatContextUsage(null)
        setSideChatAgentStatus('')
      }
      try {
        await createSideChatSession()
      } finally {
        setSideChatCreating(false)
      }
    },
    [createSideChatSession, sideChatMatchesActiveWorkspace, sideChatSessionId],
  )
  // 通过 ref 暴露最新的 ensureSideChatSession，避免 openUnifiedSidePanel（声明在前）
  // 与 ensureSideChatSession（声明在后）之间产生 const TDZ。
  const ensureSideChatSessionRef = useRef(ensureSideChatSession)
  ensureSideChatSessionRef.current = ensureSideChatSession
  const openSideChatPanel = useCallback(
    async (options: { replace?: boolean } = {}) => {
      setShowInspector(false)
      setFilePreview(null)
      setUnifiedPanelOpen(true)
      setUnifiedSideTabs((tabs) => (tabs.includes('side-chat') ? tabs : [...tabs, 'side-chat']))
      setActiveUnifiedSideTab('side-chat')
      setShowSideChatPanel(true)
      await ensureSideChatSession(options)
    },
    [ensureSideChatSession],
  )
  const handleSideChatSent = useCallback(
    (sessionId: SessionId) => {
      setSessionStatus(sessionId, 'running')
      sessionCtx.bumpSessionMessageCount(sessionId)
      setSideChatScrollToBottomTrigger((n) => n + 1)
    },
    [sessionCtx, setSessionStatus],
  )
  const openSkillStore = useCallback(
    (tab: 'installed' | 'create') => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SKILL_STORE_TARGET_TAB_STORAGE_KEY, tab)
        window.dispatchEvent(new CustomEvent(SKILL_STORE_TARGET_TAB_EVENT, { detail: { tab } }))
      }
      setTweak('view', 'skill-store')
    },
    [setTweak],
  )
  const openTeamManager = useCallback(() => {
    requestAgentsTargetTab('teams')
    setTweak('view', 'agents')
  }, [setTweak])

  const useSoloModeForEmptySession = useCallback(() => {
    const soloAgentId =
      agents.find((agent) => agent.id === effectiveHostAgentId)?.id ??
      agents.find((agent) => agent.id === teamConfig.hostAgentId)?.id ??
      agents[0]?.id ??
      teamConfig.hostAgentId
    updateTeamConfig({ enabled: false, teamId: undefined, hostAgentId: soloAgentId })
    if (active != null) void syncSessionRuntimeToAgent(soloAgentId)
  }, [
    active,
    agents,
    effectiveHostAgentId,
    syncSessionRuntimeToAgent,
    teamConfig.hostAgentId,
    updateTeamConfig,
  ])

  const useEmptyTeamModeForEmptySession = useCallback(() => {
    const hostAgentId =
      agents.find((agent) => agent.id === teamConfig.hostAgentId)?.id ??
      agents[0]?.id ??
      teamConfig.hostAgentId
    updateTeamConfig({ enabled: true, teamId: undefined, hostAgentId })
  }, [agents, teamConfig.hostAgentId, updateTeamConfig])

  const applyTeamForEmptySession = useCallback(
    (team: ManagedTeam) => {
      void persistThenSyncTeamSelection(
        () =>
          updateTeamConfig({
            enabled: true,
            hostAgentId: team.hostAgentId,
            memberAgentIds: team.memberAgentIds,
            maxDepth: team.maxDepth,
            allowNesting: team.allowNesting,
            maxDiscussionRounds: team.maxDiscussionRounds ?? 6,
            enablePeerMessaging: team.enablePeerMessaging === true,
            teamId: team.id,
          }),
        async () => {
          if (active != null) await syncSessionRuntimeToAgent(team.hostAgentId)
        },
      )
    },
    [active, syncSessionRuntimeToAgent, updateTeamConfig],
  )

  const hideComposerBranchSelect = active != null && !showEmptyHero && isGitRepo
  const composerNode =
    active == null ? (
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
        contextLedger={contextLedger}
        isWorking={composerIsWorking}
        messages={activeMessages}
        approvalRequest={approvalRequest}
        {...(onApprovalClose !== undefined ? { onApprovalClose } : {})}
        onCreateSession={(options) =>
          sessionCtx.handleNewSession(activeWorkspaceId, options as Record<string, unknown>)
        }
        onUpdateSession={handleUpdateActiveSession}
        onCommandComplete={(summary) => {
          sessionCtx.updateSessionInList(summary.id, summary)
        }}
        onSwitchBranch={handleComposerSwitchBranch}
        onRefreshBranches={refreshBranches}
        onCreateBranch={handleCreateBranch}
        onCancelSession={handleCancelSession}
        onSent={handleUserSent}
        showProjectPicker
        preferSelectedWorkspace
        focusTrigger={composerFocusTrigger}
        resendRequest={resendRequest}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onPickProject={pickProjectFolder}
        onUseNoProject={() =>
          void sessionCtx.ensureNoProjectWorkspace().then((id) => {
            if (id) setActiveWorkspaceId(id)
          })
        }
        onSwitchWorkspace={switchToWorkspace}
        teamConfig={teamConfig}
        activeTeamName={activeTeamName}
        effectiveHostAgentId={effectiveHostAgentId}
        onChangeTeamConfig={updateTeamConfig}
        onOpenTeamInspector={openInspector}
        runningTeamAgentIds={runningTeamAgentIds}
        onOpenSkillStore={openSkillStore}
        replyTo={null}
        onDispatchStateChange={setComposerDispatching}
        onModelSwitch={handleModelSwitch}
        paletteCommandRequest={paletteCommandRequest}
      />
    ) : (
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
        contextLedger={contextLedger}
        isWorking={composerIsWorking}
        messages={activeMessages}
        approvalRequest={approvalRequest}
        {...(onApprovalClose !== undefined ? { onApprovalClose } : {})}
        onCreateSession={(options) =>
          sessionCtx.handleNewSession(activeWorkspaceId, options as Record<string, unknown>)
        }
        onUpdateSession={handleUpdateActiveSession}
        onCommandComplete={(summary) => {
          sessionCtx.updateSessionInList(summary.id, summary)
        }}
        onSwitchBranch={handleComposerSwitchBranch}
        onRefreshBranches={refreshBranches}
        onCreateBranch={handleCreateBranch}
        onCancelSession={handleCancelSession}
        onSent={handleUserSent}
        showProjectPicker={showEmptyHero}
        preferSelectedWorkspace={showEmptyHero}
        focusTrigger={composerFocusTrigger}
        resendRequest={resendRequest}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onPickProject={pickProjectFolder}
        onUseNoProject={() =>
          void sessionCtx.ensureNoProjectWorkspace().then((id) => {
            if (id) setActiveWorkspaceId(id)
          })
        }
        onSwitchWorkspace={switchToWorkspace}
        teamConfig={teamConfig}
        activeTeamName={activeTeamName}
        effectiveHostAgentId={effectiveHostAgentId}
        onChangeTeamConfig={updateTeamConfig}
        onOpenTeamInspector={openInspector}
        runningTeamAgentIds={runningTeamAgentIds}
        onOpenSkillStore={openSkillStore}
        hideBranchSelect={hideComposerBranchSelect}
        replyTo={showEmptyHero ? null : replyTo}
        onClearReply={() => setReplyTo(null)}
        onDispatchStateChange={setComposerDispatching}
        onModelSwitch={handleModelSwitch}
        paletteCommandRequest={paletteCommandRequest}
      />
    )

  return (
    <div
      className={`chat-layout chat-layout-no-sidebar${teamConfig.enabled ? ' team-mode-active' : ''}`}
      ref={chatLayoutRef}
    >
      <SelectionQuoteContextMenu onQuote={handleQuoteSelection} />
      <div
        className={`chat-main ${showEmptyHero ? 'chat-main-empty' : 'chat-main-active'}${
          !showEmptyHero && showGitEnvPanel ? ' git-env-panel-open' : ''
        }`}
        ref={chatAreaRef}
      >
        {showEmptyHero && (
          <div
            className="chat-sidebar-topbar"
            onDoubleClick={() => {
              window.spark.invoke('window:maximize', {}).catch(() => {})
            }}
          >
            <ChatTitlebarStart {...(onExpandSidebar ? { onExpandSidebar } : {})} />
            <div className="chat-sidebar-topbar-actions">
              <TabbarTooltipButton
                title="环境信息"
                ariaLabel="环境信息"
                className={`icon-btn ${showGitEnvPanel ? 'active' : ''}`}
                onClick={() => {
                  // 用户手动 toggle 后标记一次，本会话内自动展开机制让位于用户意图。
                  gitPanelUserInteractedRef.current = true
                  setShowGitEnvPanel((prev) => {
                    const next = !prev
                    if (next) void refreshGitStatus()
                    return next
                  })
                }}
              >
                <TabbarIcon icon={Server} />
              </TabbarTooltipButton>
              {activeWorkspace ? (
                <ProjectOpenDropdown rootPath={activeWorkspace.rootPath} />
              ) : (
                <button
                  className="icon-btn"
                  title="请先选择项目文件夹"
                  aria-label="请先选择项目文件夹"
                  disabled
                >
                  <TabbarIcon icon={FolderOpen} />
                </button>
              )}
              {checkpointAvailable && (
                <button
                  type="button"
                  className={`icon-btn checkpoint-entry ${showCheckpointTimeline ? 'active' : ''} ${checkpointEnabled ? 'checkpoint-on' : ''}`}
                  title={
                    checkpointEnabled
                      ? '代码还原点（已开启：按轮记录已跟踪文件状态）'
                      : '代码还原点（未开启）'
                  }
                  aria-label="代码还原点"
                  onClick={() => setShowCheckpointTimeline(!showCheckpointTimeline)}
                >
                  <TabbarIcon icon={History} />
                </button>
              )}
              <button
                className={`icon-btn ${showInspector ? 'active' : ''}`}
                title="会话检查器"
                aria-label="会话检查器"
                onClick={() => {
                  setShowInspector(!showInspector)
                  if (!showInspector) {
                    setUnifiedPanelOpen(false)
                    setFilePreview(null)
                  }
                }}
              >
                <TabbarIcon icon={PanelRight} />
              </button>
              <button
                className={`icon-btn ${unifiedPanelOpen ? 'active' : ''}`}
                title={activeWorkspace ? '配置面板' : '请先选择项目文件夹'}
                aria-label="配置面板"
                disabled={!activeWorkspace}
                onClick={() => {
                  setUnifiedPanelOpen((v) => !v)
                  if (!unifiedPanelOpen) {
                    setShowInspector(false)
                    setFilePreview(null)
                  }
                }}
              >
                <TabbarIcon icon={MoreHorizontal} />
              </button>
            </div>
            <ChatTitlebarEnd />
          </div>
        )}
        {showEmptyHero && <div className="chat-hero-grid" aria-hidden="true" />}
        {showEmptyHero && (
          <EmptySessionModeLauncher
            agents={agents}
            config={teamConfig}
            activeTeamName={activeTeamName}
            onUseSolo={useSoloModeForEmptySession}
            onUseEmptyTeamMode={useEmptyTeamModeForEmptySession}
            onApplyTeam={applyTeamForEmptySession}
            onManageTeams={openTeamManager}
          />
        )}
        {showEmptyHero && teamConfig.enabled ? (
          <TeamModeEmptyHero
            agents={agents}
            hostAgentId={effectiveHostAgentId ?? teamConfig.hostAgentId}
            memberAgentIds={teamConfig.memberAgentIds}
            runningAgentIds={runningTeamAgentIds}
            teamName={activeTeamName}
            onOpenTeamInspector={openInspector}
          />
        ) : (
          showEmptyHero && <SingleAgentEmptyHero onSelectPrompt={handleHeroPromptSelect} />
        )}
        {active != null && (
          <Fragment key="active-session-content">
            {!showEmptyHero && (
              <ChatTabbar
                key="chat-tabbar"
                session={activeSession}
                workspace={activeWorkspace}
                agentStatus={agentStatus}
                branchState={branchState}
                gitStatus={gitStatus}
                isGitRepo={isGitRepo}
                taskCount={activeSessionTasks.length}
                taskCompletedCount={
                  activeSessionTasks.filter((task) => task.status === 'completed').length
                }
                hasGoal={activeSessionGoal != null}
                showGitEnvPanel={showGitEnvPanel}
                onToggleGitEnvPanel={() => {
                  // 用户手动 toggle 后标记一次，本会话内自动展开机制让位于用户意图。
                  gitPanelUserInteractedRef.current = true
                  setShowGitEnvPanel((prev) => {
                    const next = !prev
                    if (next) void refreshGitStatus()
                    return next
                  })
                }}
                showInspector={showInspector}
                setShowInspector={(v: boolean) => {
                  setShowInspector(v)
                  if (v) {
                    setUnifiedPanelOpen(false)
                    setFilePreview(null)
                  }
                  if (v) setShowGitReviewPanel(false)
                }}
                showConfigPanel={unifiedPanelOpen}
                setShowConfigPanel={(v: boolean) => {
                  setUnifiedPanelOpen(v)
                  if (v) {
                    setShowInspector(false)
                    setFilePreview(null)
                  }
                }}
                showTerminalPanel={showTerminalPanel}
                setShowTerminalPanel={(v) =>
                  v ? openUnifiedSidePanel('terminal') : closeUnifiedSidePanel('terminal')
                }
                showSideChatPanel={showSideChatPanel}
                onToggleSideChat={() => {
                  if (showSideChatPanel) closeUnifiedSidePanel('side-chat')
                  else void openSideChatPanel()
                }}
                showCheckpointTimeline={showCheckpointTimeline}
                setShowCheckpointTimeline={setShowCheckpointTimeline}
                checkpointEnabled={checkpointEnabled}
                checkpointAvailable={checkpointAvailable}
                teamConfig={teamConfig}
                orchestration={activeSessionOrchestration}
                effectiveHostAgentId={effectiveHostAgentId}
                agents={agents}
                {...(active ? { onClearMessages: handleClearMessages } : {})}
                {...(onExpandSidebar ? { onExpandSidebar } : {})}
              />
            )}
            <ChatStream
              key="chat-stream"
              sessionId={active}
              workspaceId={activeSessionWorkspaceId}
              onStatusChange={setAgentStatus}
              onUsageChange={setContextInputTokens}
              onUsageDataChange={setSessionUsageData}
              onMessagesChange={setActiveMessages}
              onSessionStatusChange={handleActiveSessionStatusChange}
              persistedSessionStatus={activeSession?.status ?? null}
              onContextUsageChange={setContextUsage}
              onContextLedgerChange={setContextLedger}
              onProjectContextChange={setProjectContext}
              onPlanProposed={(plan) => {
                setProposedPlan(plan == null || active == null ? null : { sessionId: active, plan })
                if (plan != null) openUnifiedSidePanel('plan')
              }}
              onGoalChange={setActiveSessionGoal}
              onOrchestrationChange={setActiveSessionOrchestration}
              onTurnPromptSnapshotsChange={setTurnPromptSnapshots}
              clearTrigger={clearTrigger}
              scrollToBottomTrigger={scrollToBottomTrigger}
              teamConfig={teamConfig}
              onFilePreview={handleFilePreview}
              onReplyTo={handleReplyTo}
              onReplyToMember={handleReplyToMember}
              onResendMessage={handleResendMessage}
              onLoadingChange={setActiveSessionLoading}
              emptyStateVariant="loading"
              modelSwitchMarkers={modelSwitchMarkers}
            />
            {userQuestion != null && (
              <UserQuestionDock
                key={`${userQuestion.sessionId}:${userQuestion.questionId}`}
                data={userQuestion}
                onAnswer={handleAnswerQuestion}
                onCancel={handleCancelQuestion}
              />
            )}
          </Fragment>
        )}

        {showGitEnvPanel && (
          <GitEnvPanel
            status={gitStatus}
            branchState={branchState}
            onClose={() => {
              // 用户手动关闭面板，本会话内不再自动展开。
              gitPanelUserInteractedRef.current = true
              setShowGitEnvPanel(false)
            }}
            onOpenCreateBranch={() => setGitCreateBranchOpen(true)}
            onOpenCommit={() => setGitCommitModalOpen(true)}
            onOpenBranches={() => setGitBranchModalOpen(true)}
            onOpenReview={handleOpenGitReview}
            onOpenTerminal={() => openUnifiedSidePanel('terminal')}
            tasks={activeSessionTasks}
            goal={activeSessionGoal}
            onGoalControl={handleGoalControl}
          />
        )}

        {composerNode}

        {showEmptyHero && <HeroTipsTicker />}
      </div>

      {showInspector && (
        <ChatInspector
          session={activeSession}
          workspace={activeSessionWorkspace ?? activeWorkspace}
          messages={active == null ? [] : activeMessages}
          usageData={sessionUsageData}
          projectContext={projectContext}
          contextUsage={contextUsage}
          contextLedger={contextLedger}
          contextInputTokens={contextInputTokens}
          providerContextWindow={activeProviderContextWindow}
          turnPromptSnapshots={turnPromptSnapshots}
          runningTeamAgentIds={extractRunningTeamMemberIds(
            activeMessages,
            getBlockTeamMemberContext,
          )}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          teamConfig={teamConfig}
          agents={agents}
          onChangeTeamConfig={handleInspectorChangeConfig}
          onOpenProjectFolder={() => {
            const workspaceToOpen = activeSessionWorkspace ?? activeWorkspace
            if (workspaceToOpen) void sessionCtx.handleOpenProjectFolder(workspaceToOpen)
          }}
        />
      )}

      {gitCommitModalOpen && isGitRepo && (
        <GitCommitDialog
          status={gitStatus}
          branchState={branchState}
          onClose={() => setGitCommitModalOpen(false)}
          onCommit={handleCommitGitChanges}
          onPush={handlePushGitChanges}
          onRefresh={refreshGitStatus}
        />
      )}

      {gitBranchModalOpen && isGitRepo && (
        <GitBranchDialog
          status={gitStatus}
          branchState={branchState}
          onClose={() => setGitBranchModalOpen(false)}
          onSwitchBranch={handleSwitchBranch}
          onOpenCreateBranch={() => {
            setGitBranchModalOpen(false)
            setGitCreateBranchOpen(true)
          }}
        />
      )}

      {gitCreateBranchOpen && isGitRepo && (
        <GitCreateBranchDialog
          onClose={() => setGitCreateBranchOpen(false)}
          onCreateBranch={async (branch) => {
            await handleCreateBranch(branch)
            setGitCreateBranchOpen(false)
            await refreshGitStatus()
          }}
        />
      )}

      {unifiedPanelOpen && (active != null || activeWorkspace != null) && (
        <UnifiedSessionSidePanel
          tabs={unifiedSideTabs}
          activeTab={
            activeUnifiedSideTab != null ? activeUnifiedSideTab : (unifiedSideTabs[0] ?? null)
          }
          width={sideChatWidth}
          onWidthChange={setSideChatWidth}
          onSelect={setActiveUnifiedSideTab}
          onOpen={openUnifiedSidePanel}
          onCloseTab={closeUnifiedSidePanel}
        >
          {activeUnifiedSideTab === 'config' && showConfigPanel ? (
            <ChatConfigPanel
              session={activeSession}
              workspace={activeWorkspace}
              width={sideChatWidth}
              onWidthChange={setSideChatWidth}
              embedded
              {...(() => {
                const aid = teamConfig.enabled
                  ? (effectiveHostAgentId ?? teamConfig.hostAgentId)
                  : (activeSession?.agentId ?? undefined)
                return aid != null ? { agentId: aid } : {}
              })()}
            />
          ) : activeUnifiedSideTab === 'review' && showGitReviewPanel ? (
            <GitReviewPanel
              workspaceId={gitWorkspaceId}
              workspaceRootPath={gitWorkspace?.rootPath ?? null}
              status={gitStatus}
              width={sideChatWidth}
              onWidthChange={setSideChatWidth}
              onRefresh={refreshGitStatus}
              onClose={() => closeUnifiedSidePanel('review')}
            />
          ) : activeUnifiedSideTab === 'plan' ? (
            <PlanSidePanel
              session={activeSession}
              messages={activeMessages}
              proposedPlan={
                proposedPlan != null && active != null && proposedPlan.sessionId === active
                  ? proposedPlan
                  : null
              }
              onClose={() => closeUnifiedSidePanel('plan')}
              onClearProposedPlan={() => setProposedPlan(null)}
              onPlanApproved={(sessionId) => {
                sessionCtx.updateSessionInList(sessionId, { permissionMode: 'claude-auto-edits' })
              }}
            />
          ) : activeUnifiedSideTab === 'terminal' && showTerminalPanel ? (
            (() => {
              const terminalSessionId = active != null ? active : EMPTY_HERO_TERMINAL_SESSION_ID
              return (
                <BuiltInTerminalPanel
                  sessionId={terminalSessionId}
                  workspace={activeSessionWorkspace ?? activeWorkspace}
                  onClose={() => closeUnifiedSidePanel('terminal')}
                />
              )
            })()
          ) : activeUnifiedSideTab === 'side-chat' && showSideChatPanel ? (
            <SideChatPanel
              workspaceName={sideChatWorkspace?.name ?? activeWorkspace?.name ?? '当前项目'}
              agentStatus={sideChatAgentStatus}
              creating={sideChatCreating}
              width={sideChatWidth}
              onWidthChange={setSideChatWidth}
              onClose={() => closeUnifiedSidePanel('side-chat')}
              onNew={() => {
                void openSideChatPanel({ replace: true })
              }}
              embedded
            >
              {sideChatSessionId != null &&
              sideChatSession != null &&
              sideChatMatchesActiveWorkspace ? (
                <>
                  <ChatStream
                    key={`side-chat-stream-${sideChatSessionId}`}
                    sessionId={sideChatSessionId}
                    workspaceId={sideChatWorkspace?.id ?? null}
                    onStatusChange={setSideChatAgentStatus}
                    onUsageChange={setSideChatContextInputTokens}
                    onUsageDataChange={() => {}}
                    onMessagesChange={setSideChatMessages}
                    onSessionStatusChange={(status) => setSessionStatus(sideChatSessionId, status)}
                    persistedSessionStatus={sideChatSession?.status ?? null}
                    onContextUsageChange={setSideChatContextUsage}
                    onContextLedgerChange={setSideChatContextLedger}
                    onProjectContextChange={() => {}}
                    onPlanProposed={() => {}}
                    onTurnPromptSnapshotsChange={() => {}}
                    scrollToBottomTrigger={sideChatScrollToBottomTrigger}
                    teamConfig={teamConfig}
                    onFilePreview={handleFilePreview}
                    onLoadingChange={() => {}}
                    onReplyTo={handleReplyTo}
                    onReplyToMember={handleReplyToMember}
                  />
                  <ComposerV2
                    session={sideChatSession}
                    workspace={sideChatWorkspace}
                    providers={providers}
                    agents={agents}
                    selectedProviderId={selectedProviderId}
                    setSelectedProviderId={setSelectedProviderId}
                    branchState={branchState}
                    contextInputTokens={sideChatContextInputTokens}
                    contextUsage={sideChatContextUsage}
                    contextLedger={sideChatContextLedger}
                    isWorking={isComposerSessionWorking(sideChatSession.status)}
                    messages={sideChatMessages}
                    approvalRequest={null}
                    onCreateSession={(options) =>
                      createSideChatSession(options as Record<string, unknown>)
                    }
                    onUpdateSession={async (patch) => {
                      await updateSession({ sessionId: sideChatSessionId, ...patch })
                      await sessionCtx.refreshData()
                    }}
                    onCommandComplete={(summary) => {
                      sessionCtx.updateSessionInList(summary.id, summary)
                    }}
                    onSwitchBranch={handleComposerSwitchBranch}
                    onRefreshBranches={refreshBranches}
                    onCreateBranch={handleCreateBranch}
                    onCancelSession={handleCancelSession}
                    onSent={handleSideChatSent}
                    showProjectPicker={false}
                    workspaces={workspaces}
                    activeWorkspaceId={sideChatWorkspace?.id ?? activeWorkspaceId}
                    onPickProject={pickProjectFolder}
                    onUseNoProject={() => {}}
                    onSwitchWorkspace={switchToWorkspace}
                    teamConfig={teamConfig}
                    activeTeamName={activeTeamName}
                    effectiveHostAgentId={effectiveHostAgentId}
                    onChangeTeamConfig={updateTeamConfig}
                    onOpenTeamInspector={openInspector}
                    runningTeamAgentIds={[]}
                    onOpenSkillStore={openSkillStore}
                    hideBranchSelect={hideComposerBranchSelect}
                    replyTo={null}
                  />
                </>
              ) : (
                <div className="side-chat-panel-loading">
                  <Icons.Spinner size={22} className="side-chat-panel-loading-spin" />
                </div>
              )}
            </SideChatPanel>
          ) : (
            <UnifiedSidePanelPicker onOpen={openUnifiedSidePanel} />
          )}
        </UnifiedSessionSidePanel>
      )}

      {filePreview != null && (
        <FilePreviewPanel
          filePath={filePreview.filePath}
          fileType={filePreview.fileType}
          {...((activeSessionWorkspace ?? activeWorkspace)?.rootPath != null
            ? { workspaceRootPath: (activeSessionWorkspace ?? activeWorkspace)!.rootPath }
            : {})}
          onClose={() => setFilePreview(null)}
        />
      )}

      <CheckpointTimelinePanel
        sessionId={active}
        open={showCheckpointTimeline}
        onClose={() => setShowCheckpointTimeline(false)}
        onRestore={(checkpointId) =>
          active != null ? executeCheckpointRestore(active, checkpointId) : Promise.resolve()
        }
        onEnabledChange={setCheckpointEnabled}
      />
    </div>
  )
}

function ChatStream({
  sessionId,
  workspaceId,
  onStatusChange,
  onUsageChange,
  onUsageDataChange,
  onMessagesChange,
  onSessionStatusChange,
  persistedSessionStatus,
  onContextUsageChange,
  onContextLedgerChange,
  onProjectContextChange,
  onPlanProposed,
  onGoalChange,
  onOrchestrationChange,
  onTurnPromptSnapshotsChange,
  clearTrigger,
  scrollToBottomTrigger,
  teamConfig,
  onReplyTo,
  onReplyToMember,
  onFilePreview,
  onResendMessage,
  onLoadingChange,
  emptyStateVariant = 'hint',
  modelSwitchMarkers = [],
}: {
  sessionId: SessionId
  /** 当前会话工作区 ID。非 null 时用于过滤 turn_file_summary 中被 .gitignore 忽略的路径 */
  workspaceId: string | null
  onStatusChange: (s: string) => void
  onUsageChange: (tokens: number) => void
  onUsageDataChange: (data: SessionUsageData) => void
  onMessagesChange: (messages: UIMessage[]) => void
  onSessionStatusChange: (status: SessionSummary['status']) => void
  /** 会话持久化摘要状态（来自 sessionCtx.sessions）。重放历史事件时用于抑制
   *  「瞬态状态 + 空会话」被误判为执行中（见 chat-session-status.getLatestAgentStatus）。 */
  persistedSessionStatus?: SessionSummary['status'] | null
  onContextUsageChange: (snapshot: ContextUsageState | null) => void
  onContextLedgerChange: (snapshot: ContextLedgerState | null) => void
  onProjectContextChange: (snapshot: ProjectContextState | null) => void
  /** 上报当前会话「待审批计划」状态：有则传 plan 文本，无则传 null（清空，避免切换会话后残留） */
  onPlanProposed: (plan: string | null) => void
  /** 上报当前会话「活跃 Goal」状态：有则传 GoalSnapshot，无则传 null。 */
  onGoalChange?: (goal: GoalSnapshot | null) => void
  /** 上报当前会话「宿主是否处于编排模式」：一旦某轮触发过就一直是非 null，直到会话被清空/切换。 */
  onOrchestrationChange?: (status: OrchestrationSnapshot | null) => void
  onTurnPromptSnapshotsChange: (snapshots: TurnPromptSnapshotEvent[]) => void
  /** 递增时清空 ChatStream 内部消息状态 */
  clearTrigger?: number
  /** 递增时立即把会话内容区滚到底部（用户发送消息瞬间触发，无需等 user_message 事件回流） */
  scrollToBottomTrigger?: number
  /** 当前会话历史的加载状态变化（用于父级抑制「空会话 hero」误闪） */
  onLoadingChange?: (loading: boolean) => void
  teamConfig: TeamModeConfig
  onReplyTo?: (msg: UIMessage, agentId?: string, agentName?: string, selectedText?: string) => void
  onReplyToMember?: (args: {
    messageId: string
    memberAgentId: string
    memberName: string
    content: string
    selectedText?: string
  }) => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  /** 重发：用户消息上"重发"按钮触发，把 blocks+attachments 重新塞回输入区 */
  onResendMessage?: (payload: ComposerPrefillPayload) => void
  /**
   * 消息为空且非历史加载时的占位形态：
   *  - 'hint'（默认）：静态「开始对话」提示，用于侧边 ChatStream 这类真正可能长期为空的场景；
   *  - 'loading'：圆环 loading 动画，用于主会话流——发送后到首条消息/Agent 运行之间的过渡窗口，
   *    此时 hero 已隐藏、stream 已显形但 messages 仍为空，用 loading 取代静态空态避免「空会话」闪现。
   */
  emptyStateVariant?: 'hint' | 'loading'
  modelSwitchMarkers?: ModelSwitchMarker[]
}) {
  const streamRef = useRef<HTMLDivElement | null>(null)
  const virtualMessageListRef = useRef<VirtualMessageListHandle | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const messagesRef = useRef<UIMessage[]>([])
  const [agentIsRunning, setAgentIsRunning] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set())
  // 窗口化加载：是否还有更早历史 + 是否正在加载更早一页（顶部 loading 指示）
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const builderRef = useRef(new MessageBuilder())
  const isStreamingRef = useRef(false)
  const persistedSessionStatusRef = useRef(persistedSessionStatus)
  persistedSessionStatusRef.current = persistedSessionStatus
  const userScrolledRef = useRef(false)
  const hydratingRef = useRef(false)
  const bufferedEventsRef = useRef<AgentEvent[]>([])
  const liveEventBufferRef = useRef<LiveAgentEventBuffer | null>(null)
  const processLiveEventBatchRef = useRef<(events: AgentEvent[]) => void>(() => {})
  const historyLoadIdRef = useRef(0)
  // 死循环护栏/探针：切换会话时历史加载 effect 正常只应跑 1 次。若同一会话 1s 内高频
  // 重跑，说明该 effect 的依赖数组又混入了不稳定引用（历史回归见 commit 870de386b：
  // drainBufferedLiveEvents→processLiveEvent→内联 onPlanProposed 导致 session:get-history
  // 无限重发）。DEV 下越过阈值立即报警，便于第一时间定位。
  const historyReloadProbeRef = useRef({ windowStart: 0, count: 0 })
  // 过滤 .gitignore 忽略路径用：workspaceId 用 ref 跟踪最新值，
  // 避免 commitEventsToView / useIpcStream 的 callback 因 deps 变化而重建。
  const workspaceIdRef = useRef<string | null>(workspaceId)
  workspaceIdRef.current = workspaceId
  // 切换/初始加载后需要把视图强制贴到底部（展示最新消息）；置位后由自动滚动 effect 处理。
  const scrollToBottomPendingRef = useRef(false)
  // 初始贴底完成前，禁止「滚动到顶懒加载更早」触发——否则初次加载 scrollTop≈0 会立刻
  // 触发翻页 + 锚定，把视图一路拉到最早的消息（用户报告的「从最早开始 / 卡住」根因）。
  const initialScrollDoneRef = useRef(false)
  const usageRef = useRef<SessionUsageData>({
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cacheHitTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  })
  const { invoke: getHistory } = useIpcInvoke('session:get-history')
  const { invoke: deleteMessageEvents } = useIpcInvoke('session:delete-message')
  const { sessions, agents } = useSessionSidebar()
  const session = sessions.find((item) => item.id === sessionId)
  const assistantAgentId = teamConfig.enabled
    ? teamConfig.hostAgentId
    : (session?.agentId ?? 'platform-manager-agent')
  const assistantAgent = agents.find((item) => item.id === assistantAgentId)
  const assistantName = assistantAgent?.name ?? 'SparkWork'
  const assistantAvatar = getAgentAvatarConfig(
    assistantAgent?.metadata,
    assistantAgentId,
    assistantName,
  )
  const assistantAvatarSrc = resolveAvatarSrc(assistantAvatar)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // ── 历史加载状态 ──
  // loadedEventsRef：当前已加载到内存的历史 + 实时 event；既用于删除消息时同步剔除，
  // 也作为「加载更早」时增量重建消息的唯一数据源。
  const loadedEventsRef = useRef<AgentEvent[]>([])
  const loadedEventIdsRef = useRef<Set<string>>(new Set())
  // 窗口化：当前已加载最旧 event 的 seq（向上翻页 beforeSeq）、是否还有更早、是否正在翻页
  const oldestSeqRef = useRef<number | undefined>(undefined)
  const hasMoreHistoryRef = useRef(false)
  const loadingOlderRef = useRef(false)
  const loadOlderRef = useRef<() => void>(() => {})
  const viewCallbacksRef = useRef({
    onMessagesChange,
    onUsageChange,
    onUsageDataChange,
    onStatusChange,
    onSessionStatusChange,
    onContextUsageChange,
    onContextLedgerChange,
    onProjectContextChange,
    onTurnPromptSnapshotsChange,
    onPlanProposed,
    onGoalChange,
    onOrchestrationChange,
    onLoadingChange,
  })
  viewCallbacksRef.current = {
    onMessagesChange,
    onUsageChange,
    onUsageDataChange,
    onStatusChange,
    onSessionStatusChange,
    onContextUsageChange,
    onContextLedgerChange,
    onProjectContextChange,
    onTurnPromptSnapshotsChange,
    onPlanProposed,
    onGoalChange,
    onOrchestrationChange,
    onLoadingChange,
  }

  const flushMessages = useCallback(() => {
    const nextMessages = [...builderRef.current.getAllMessages()]
    setMessages(nextMessages)
    viewCallbacksRef.current.onMessagesChange(nextMessages)
  }, [])

  const processLiveEvent = useCallback(
    (event: AgentEvent): boolean => {
      if (event.sessionId !== sessionId) return false
      if (loadedEventIdsRef.current.has(event.id)) return false
      const callbacks = viewCallbacksRef.current
      // /clear 等清空历史的命令在写入新事件前会先发这条「分隔符」事件，
      // renderer 收到后把本地缓存（消息/usage/context/状态）全部丢弃，
      // 让随后的 user/assistant/completed 在干净的画布上重新渲染。
      if (event.type === 'session_history_reset') {
        builderRef.current.processEvent(event) // 内部已调用 clearAll
        loadedEventsRef.current = [event]
        loadedEventIdsRef.current = new Set([event.id])
        usageRef.current = {
          inputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          cacheHitTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
          contextWindow: 0,
          turns: [],
        }
        setMessages([])
        callbacks.onMessagesChange([])
        callbacks.onUsageDataChange(usageRef.current)
        callbacks.onContextUsageChange(null)
        callbacks.onContextLedgerChange(null)
        callbacks.onProjectContextChange(null)
        callbacks.onTurnPromptSnapshotsChange([])
        callbacks.onStatusChange('')
        setAgentIsRunning(false)
        isStreamingRef.current = false
        return false
      }
      builderRef.current.processEvent(event)
      loadedEventsRef.current.push(event)
      loadedEventIdsRef.current.add(event.id)

      if (event.type === 'agent_status') {
        setAgentIsRunning(isRunningAgentStatus(event.status))
        applyAgentStatus(
          event.status,
          callbacks.onStatusChange,
          callbacks.onSessionStatusChange,
          isStreamingRef,
          userScrolledRef,
        )
        if (
          event.status === 'completed' ||
          event.status === 'error' ||
          event.status === 'cancelled' ||
          event.status === 'idle'
        ) {
          const wsId = workspaceIdRef.current
          const snapshot = builderRef.current.getAllMessages()
          if (
            wsId != null &&
            snapshot.some((m) => m.blocks.some((b) => b.kind === 'turn_file_summary'))
          ) {
            void filterTurnSummaryIgnoredPaths(snapshot, wsId).then((filtered) => {
              if (filtered === snapshot) return
              setMessages(filtered)
              callbacks.onMessagesChange(filtered)
            })
          }
        }
      }
      if (event.type === 'usage_update') {
        if (event.inputTokens > 0) callbacks.onUsageChange(event.inputTokens)
        const snapshot: UsageSnapshot = {
          turnId: event.turnId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          reasoningOutputTokens: event.reasoningOutputTokens ?? 0,
          cacheHitTokens: event.cacheHitTokens ?? 0,
          cacheWriteTokens: event.cacheWriteTokens ?? 0,
          estimatedCostUsd: event.estimatedCostUsd ?? 0,
          timestamp: event.timestamp,
        }
        const prev = usageRef.current
        const next: SessionUsageData = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          reasoningOutputTokens: event.reasoningOutputTokens ?? prev.reasoningOutputTokens,
          cacheHitTokens: event.cacheHitTokens ?? prev.cacheHitTokens,
          cacheWriteTokens: event.cacheWriteTokens ?? prev.cacheWriteTokens,
          estimatedCostUsd: prev.estimatedCostUsd + (event.estimatedCostUsd ?? 0),
          contextWindow: prev.contextWindow,
          turns: [...prev.turns, snapshot],
        }
        usageRef.current = next
        callbacks.onUsageDataChange(next)
      }
      if (event.type === 'user_message') {
        userScrolledRef.current = false
        setShowScrollToBottom(false)
        isStreamingRef.current = true
        setAgentIsRunning(true)
      }

      if (event.type === 'context_usage') {
        callbacks.onContextUsageChange({
          estimatedTokens: event.estimatedTokens,
          softLimitTokens: event.softLimitTokens,
          contextWindowTokens: event.contextWindowTokens,
          compactedThisTurn: event.compacted,
        })
      }

      if (event.type === 'context_ledger') {
        callbacks.onContextLedgerChange(toContextLedgerState(event))
      }

      if (event.type === 'project_context_loaded') {
        callbacks.onProjectContextChange(event)
      }

      if (event.type === 'plan_proposed') {
        callbacks.onPlanProposed(event.plan)
      }

      if (event.type === 'plan_rejected') {
        callbacks.onPlanProposed(null)
      }

      if (
        event.type === 'goal_started' ||
        event.type === 'goal_progress' ||
        event.type === 'goal_resumed' ||
        event.type === 'goal_paused' ||
        event.type === 'goal_completed' ||
        event.type === 'goal_failed' ||
        event.type === 'goal_cleared' ||
        event.type === 'goal_budget_stopped'
      ) {
        callbacks.onGoalChange?.(builderRef.current.getActiveGoal())
      }

      if (event.type === 'orchestration_status') {
        callbacks.onOrchestrationChange?.(builderRef.current.getOrchestrationStatus())
      }

      if (event.type === 'user_message') {
        callbacks.onPlanProposed(null)
      }

      if (event.type === 'turn_prompt_snapshot') {
        callbacks.onTurnPromptSnapshotsChange(builderRef.current.getTurnPromptSnapshots())
      }

      return true
    },
    [sessionId],
  )

  const processLiveEventBatch = useCallback(
    (events: AgentEvent[]) => {
      let shouldFlushMessages = false
      for (const event of events) {
        if (processLiveEvent(event)) shouldFlushMessages = true
      }
      if (shouldFlushMessages) flushMessages()
    },
    [flushMessages, processLiveEvent],
  )
  useLayoutEffect(() => {
    processLiveEventBatchRef.current = processLiveEventBatch
  }, [processLiveEventBatch])

  useEffect(() => {
    const buffer = new LiveAgentEventBuffer({
      onFlush: (events) => processLiveEventBatchRef.current(events),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
    })
    liveEventBufferRef.current = buffer
    return () => {
      buffer.dispose()
      if (liveEventBufferRef.current === buffer) liveEventBufferRef.current = null
    }
  }, [])

  const enqueueLiveEvent = useCallback((event: AgentEvent) => {
    const buffer = liveEventBufferRef.current
    if (buffer == null) {
      processLiveEventBatchRef.current([event])
      return
    }
    buffer.enqueue(event)
  }, [])

  const drainBufferedLiveEvents = useCallback(
    (loadId: number) => {
      if (historyLoadIdRef.current !== loadId) return
      const buffered = bufferedEventsRef.current
      bufferedEventsRef.current = []
      for (const event of buffered) enqueueLiveEvent(event)
    },
    [enqueueLiveEvent],
  )

  /**
   * commitEventsToView — 把一段已加载的 event 窗口构建成消息并渲染。
   * 初始加载 / 加载更早 共用。
   * deriveMeta=true 时同时从 events 派生 usage/status/context/plan（初始加载）；
   * deriveMeta=false 时只重建消息列表，保留实时事件维护的 usage/status（加载更早，
   * 避免把 live 累积的用量/状态覆盖回历史快照）。
   */
  const commitEventsToView = useCallback(
    async (
      events: AgentEvent[],
      deriveMeta: boolean,
      opts: { shouldContinue?: () => boolean } = {},
    ) => {
      const callbacks = viewCallbacksRef.current
      const builder = new MessageBuilder()
      for (let i = 0; i < events.length; i++) {
        if (opts.shouldContinue?.() === false) return []
        const event = events[i]
        if (event != null) builder.processEvent(event)
        if (events.length > 200 && (i + 1) % 200 === 0) {
          await yieldToBrowser()
        }
      }
      if (opts.shouldContinue?.() === false) return []
      builderRef.current = builder
      const nextMessages = builder.getAllMessages()
      setMessages(nextMessages)
      callbacks.onMessagesChange(nextMessages)
      // 历史加载后批量过滤 turn_file_summary 中被 .gitignore 忽略的路径（编译产物等噪音）。
      // fire-and-forget：无变化时 filter 函数返回原引用，setMessages 不会被触发。
      const wsId = workspaceIdRef.current
      if (
        wsId != null &&
        nextMessages.some((m) => m.blocks.some((b) => b.kind === 'turn_file_summary'))
      ) {
        void filterTurnSummaryIgnoredPaths(nextMessages, wsId).then((filtered) => {
          if (filtered === nextMessages) return
          setMessages(filtered)
          callbacks.onMessagesChange(filtered)
        })
      }
      if (!deriveMeta) return nextMessages

      callbacks.onUsageChange(getLatestInputTokens(events))
      const historyUsage = buildUsageDataFromEvents(events)
      usageRef.current = historyUsage
      callbacks.onUsageDataChange(historyUsage)
      const latestStatus = getLatestAgentStatus(
        events,
        persistedSessionStatusRef.current ?? undefined,
      )
      setAgentIsRunning(isRunningAgentStatus(latestStatus))
      if (latestStatus != null) {
        applyAgentStatus(
          latestStatus,
          callbacks.onStatusChange,
          callbacks.onSessionStatusChange,
          isStreamingRef,
          userScrolledRef,
        )
      }
      const latestContext = getLatestContextUsageEvent(events)
      callbacks.onContextUsageChange(
        latestContext != null
          ? {
              estimatedTokens: latestContext.estimatedTokens,
              softLimitTokens: latestContext.softLimitTokens,
              contextWindowTokens: latestContext.contextWindowTokens,
              compactedThisTurn: latestContext.compacted,
            }
          : null,
      )
      const latestLedger = getLatestContextLedgerEvent(events)
      callbacks.onContextLedgerChange(
        latestLedger != null ? toContextLedgerState(latestLedger) : null,
      )
      callbacks.onProjectContextChange(getLatestProjectContextEvent(events))
      callbacks.onTurnPromptSnapshotsChange(builder.getTurnPromptSnapshots())
      // 历史里若存在未被后续 user_message / agent_status 解决的 plan_proposed
      // （例如 APP_RESTARTED 期间用户没有审批），重新弹出审批弹窗。
      // 始终上报（无 pending 时传 null）：这样切换到「无待审批计划」的会话时能清空
      // 上一个会话残留的审批弹窗，避免弹窗跨会话泄漏。
      callbacks.onPlanProposed(builder.getPendingPlan())
      // 历史回放后同步当前活跃 Goal（无则传 null，避免切换会话残留）。
      callbacks.onGoalChange?.(builder.getActiveGoal())
      // 历史回放后同步「宿主是否处于编排模式」，避免切换到未触发过编排的会话时残留上一个会话的状态。
      callbacks.onOrchestrationChange?.(builder.getOrchestrationStatus())
      return nextMessages
    },
    [],
  )

  // 切换会话时加载历史：窗口化——只取最新一页，立即展示最近消息并滚到底部（IM 体感），
  // 更早历史在用户向上滚动时按需懒加载。
  useEffect(() => {
    const loadId = historyLoadIdRef.current + 1
    historyLoadIdRef.current = loadId
    // —— 死循环探针 ——（详见 historyReloadProbeRef 声明处）
    if (import.meta.env.DEV) {
      const probe = historyReloadProbeRef.current
      const now = performance.now()
      if (now - probe.windowStart > 1000) {
        probe.windowStart = now
        probe.count = 0
      }
      probe.count += 1
      if (probe.count === 30) {
        console.error(
          `[chatview-probe] 历史加载 effect 在 1s 内重跑 ${probe.count}+ 次（sessionId=${sessionId}）——` +
            '疑似 effect 依赖回归导致 session:get-history 死循环，请检查该 effect 依赖数组是否混入不稳定引用',
        )
      }
    }
    hydratingRef.current = true
    liveEventBufferRef.current?.clear()
    bufferedEventsRef.current = []
    loadedEventsRef.current = []
    loadedEventIdsRef.current.clear()
    oldestSeqRef.current = undefined
    hasMoreHistoryRef.current = false
    loadingOlderRef.current = false
    initialScrollDoneRef.current = false
    setHasMoreHistory(false)
    setIsLoadingOlder(false)
    let cancelled = false

    // 不清空旧消息（保留当前内容 + 遮罩 loading，避免空白闪屏）；交由 onLoadingChange 抑制 hero。
    setIsLoadingHistory(true)
    viewCallbacksRef.current.onLoadingChange?.(true)

    isStreamingRef.current = false
    userScrolledRef.current = false
    viewCallbacksRef.current.onContextUsageChange(null)
    viewCallbacksRef.current.onContextLedgerChange(null)
    viewCallbacksRef.current.onProjectContextChange(null)
    viewCallbacksRef.current.onTurnPromptSnapshotsChange([])

    loadSessionHistoryPage(getHistory, sessionId)
      .then(async ({ events: pageEvents, hasMore }) => {
        if (cancelled || historyLoadIdRef.current !== loadId) return
        const bufferedAtStart = bufferedEventsRef.current
        bufferedEventsRef.current = []
        const events = mergeAgentEvents(pageEvents, bufferedAtStart)
        loadedEventsRef.current = events
        loadedEventIdsRef.current = createAgentEventIdSet(events)
        oldestSeqRef.current = events[0]?.seq
        hasMoreHistoryRef.current = hasMore
        setHasMoreHistory(hasMore)
        // 进入会话先展示最新消息：提交后强制贴底（IM 体感）
        scrollToBottomPendingRef.current = true
        await commitEventsToView(events, true, {
          shouldContinue: () => !cancelled && historyLoadIdRef.current === loadId,
        })
        if (!cancelled && historyLoadIdRef.current === loadId) {
          hydratingRef.current = false
          drainBufferedLiveEvents(loadId)
        }
      })
      .catch((err) => {
        console.error('Failed to load session history:', err)
        if (!cancelled && historyLoadIdRef.current === loadId) {
          // 历史加载失败，使用缓冲的 live 事件回退
          const bufferedEvents = bufferedEventsRef.current
          bufferedEventsRef.current = []
          if (bufferedEvents.length > 0) {
            const fallbackEvents = mergeAgentEvents([], bufferedEvents)
            loadedEventsRef.current = fallbackEvents
            loadedEventIdsRef.current = createAgentEventIdSet(fallbackEvents)
            scrollToBottomPendingRef.current = true
            return commitEventsToView(fallbackEvents, true, {
              shouldContinue: () => !cancelled && historyLoadIdRef.current === loadId,
            }).then(() => {
              if (!cancelled && historyLoadIdRef.current === loadId) {
                hydratingRef.current = false
                drainBufferedLiveEvents(loadId)
              }
            })
          }
        }
        return undefined
      })
      .finally(() => {
        if (!cancelled && historyLoadIdRef.current === loadId) {
          hydratingRef.current = false
          drainBufferedLiveEvents(loadId)
          setIsLoadingHistory(false)
          viewCallbacksRef.current.onLoadingChange?.(false)
        }
      })

    return () => {
      cancelled = true
      if (historyLoadIdRef.current === loadId) {
        hydratingRef.current = false
        bufferedEventsRef.current = []
        liveEventBufferRef.current?.clear()
      }
    }
  }, [getHistory, commitEventsToView, drainBufferedLiveEvents, sessionId])

  // 加载更早一页历史（用户滚动到顶部时触发）。prepend 后锚定 scrollTop，避免内容跳动。
  const loadOlderHistory = useCallback(() => {
    if (loadingOlderRef.current || !hasMoreHistoryRef.current) return
    const beforeSeq = oldestSeqRef.current
    if (beforeSeq === undefined) return
    const loadIdAtRequest = historyLoadIdRef.current
    loadingOlderRef.current = true
    setIsLoadingOlder(true)
    const el = streamRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0
    const prevScrollTop = el?.scrollTop ?? 0
    loadSessionHistoryPage(getHistory, sessionId, beforeSeq)
      .then(({ events: olderEvents, hasMore }) => {
        // 会话已切走（historyLoadIdRef 被切换 effect 递增）则丢弃
        if (historyLoadIdRef.current !== loadIdAtRequest) return
        let commitPromise: Promise<unknown> = Promise.resolve()
        if (olderEvents.length > 0) {
          const merged = mergeAgentEvents(olderEvents, loadedEventsRef.current)
          loadedEventsRef.current = merged
          loadedEventIdsRef.current = createAgentEventIdSet(merged)
          oldestSeqRef.current = merged[0]?.seq ?? oldestSeqRef.current
          // 只重建消息，保留 live 维护的 usage/status
          const pendingLiveEvents = liveEventBufferRef.current?.drainNow() ?? []
          hydratingRef.current = true
          bufferedEventsRef.current = pendingLiveEvents
          commitPromise = commitEventsToView(merged, false, {
            shouldContinue: () => historyLoadIdRef.current === loadIdAtRequest,
          }).then(() => {
            if (historyLoadIdRef.current !== loadIdAtRequest) return
            hydratingRef.current = false
            drainBufferedLiveEvents(loadIdAtRequest)
            // 下一帧（DOM 已更新）按高度增量恢复 scrollTop，保持视觉锚点不动
            requestAnimationFrame(() => {
              const el2 = streamRef.current
              if (el2 != null) {
                el2.scrollTop = prevScrollTop + (el2.scrollHeight - prevScrollHeight)
              }
            })
          })
        }
        hasMoreHistoryRef.current = hasMore
        setHasMoreHistory(hasMore)
        return commitPromise
      })
      .catch((err) => console.error('Failed to load older history:', err))
      .finally(() => {
        if (historyLoadIdRef.current !== loadIdAtRequest) return
        hydratingRef.current = false
        drainBufferedLiveEvents(loadIdAtRequest)
        loadingOlderRef.current = false
        setIsLoadingOlder(false)
      })
  }, [getHistory, commitEventsToView, drainBufferedLiveEvents, sessionId])
  // 让滚动处理（[] deps、闭包固定）始终调用到最新的 loadOlderHistory
  useEffect(() => {
    loadOlderRef.current = loadOlderHistory
  }, [loadOlderHistory])

  // 外部触发清空消息
  useEffect(() => {
    if (clearTrigger === undefined || clearTrigger === 0) return
    liveEventBufferRef.current?.clear()
    builderRef.current.clearAll()
    loadedEventsRef.current = []
    loadedEventIdsRef.current.clear()
    setMessages([])
    onMessagesChange([])
    onStatusChange('')
    onUsageDataChange({
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheHitTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      contextWindow: 0,
      turns: [],
    })
    onContextUsageChange(null)
    onContextLedgerChange(null)
    onProjectContextChange(null)
    setAgentIsRunning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTrigger])

  // 用户点了「发送」时立即贴底（IM 即时反馈）。
  // 不等 user_message 事件从后端回来——bump 后立刻 scrollTop = scrollHeight，并清掉
  // 用户上滚状态/「回到最新」按钮，保证发送瞬间体感「自己的消息立刻出现在底部」。
  // 跨多帧 + 短延后兜底，兼容随后异步内容（user_message + 即将到来的 agent_thinking）撑高。
  useEffect(() => {
    if (scrollToBottomTrigger === undefined || scrollToBottomTrigger === 0) return
    const el = streamRef.current
    if (!el) return
    userScrolledRef.current = false
    setShowScrollToBottom(false)
    const pin = () => {
      el.scrollTop = el.scrollHeight
    }
    pin()
    requestAnimationFrame(() => {
      pin()
      requestAnimationFrame(pin)
    })
    const t = window.setTimeout(pin, 120)
    return () => window.clearTimeout(t)
  }, [scrollToBottomTrigger])

  // Track user scroll position to avoid auto-scrolling when user scrolls up
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const shouldShowButton = shouldShowScrollToBottom(distanceFromBottom)
      userScrolledRef.current = shouldShowButton
      setShowScrollToBottom(shouldShowButton)
      // 接近顶部时懒加载更早一页（窗口化）。
      // 必须等初始贴底完成（initialScrollDoneRef），且当前确实有可向下滚动的内容
      // （distanceFromBottom>0，排除内容不溢出时的误触发），否则会从最早开始狂翻页。
      if (
        initialScrollDoneRef.current &&
        el.scrollTop < 200 &&
        distanceFromBottom > 0 &&
        hasMoreHistoryRef.current &&
        !loadingOlderRef.current
      ) {
        loadOlderRef.current()
      }
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
      enqueueLiveEvent(event)
    },
    [enqueueLiveEvent, sessionId],
  )

  // 智能自动滚动：
  //  - 初始/切换加载：强制贴底展示最新消息，跨多帧重试以兼容异步内容（markdown/代码块/图片）
  //    撑高后才到真正底部；贴底完成后才解锁「滚动到顶懒加载」。
  //  - 新用户消息：强制贴底。
  //  - Agent 流式：仅在用户未主动上滚时跟随。
  useEffect(() => {
    const el = streamRef.current
    if (!el) return

    if (scrollToBottomPendingRef.current) {
      scrollToBottomPendingRef.current = false
      userScrolledRef.current = false
      const pin = () => {
        el.scrollTop = el.scrollHeight
      }
      pin()
      // 连续多帧 + 一次延后兜底，确保异步内容撑高后仍贴底
      requestAnimationFrame(() => {
        pin()
        requestAnimationFrame(() => {
          pin()
          window.setTimeout(() => {
            pin()
            // 解锁懒加载（略延后，避免贴底过程中的 scroll 事件误触发翻页）
            initialScrollDoneRef.current = true
          }, 120)
        })
      })
      return
    }

    // 检测最新消息是否为用户消息（表示用户刚发送了新消息）
    const latestMsg = messages[messages.length - 1]
    const isNewUserMessage = latestMsg?.role === 'user'

    if (isNewUserMessage) {
      userScrolledRef.current = false
      setShowScrollToBottom(false)
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    } else if (!userScrolledRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    } else {
      setShowScrollToBottom(true)
    }
  }, [messages, agentIsRunning])

  // 「贴底跟随」兜底（IM 标准行为）：
  // 流式文本、思考区展开/折叠、代码块/图片撑高等很多高度变化并不会触发 ChatStream 重渲染，
  // 仅靠 messages 变化的 effect 跟不住。这里用 MutationObserver 监听内容区任意 DOM 变化，
  // 每帧节流地在「跟随中」时贴底；用户上滚（userScrolledRef=true）即暂停，滚回底部即恢复
  // （滚动处理按 distanceFromBottom 维护 userScrolledRef）。
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    let rafId: number | null = null
    const observer = new MutationObserver(() => {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        // 初始贴底进行中、或用户已上滚，则不跟随
        if (scrollToBottomPendingRef.current || userScrolledRef.current) return
        el.scrollTop = el.scrollHeight
      })
    })
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    return () => {
      observer.disconnect()
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [])

  // 是否有正在流式传输的消息
  const hasStreamingMsg = messages.some((m) => m.status === 'streaming')
  const showWaitingAgent =
    (agentIsRunning || persistedSessionStatus === 'running') && !hasStreamingMsg

  // 团队模式 @ 指定成员时，该 turn 由被 @ 的成员直接执行（见后端 mention 路由）。
  // 「等待中」占位用最近一条用户消息的 @ 指定成员，避免「先显示主持人、流式开始后又切回成员」的视差。
  const placeholderIdentity = useMemo(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    const mentionId = lastUserMsg?.mentionAgentId
    if (mentionId != null && mentionId !== assistantAgentId) {
      const mentionAgent = agents.find((a) => a.id === mentionId)
      if (mentionAgent != null) {
        const avatar = getAgentAvatarConfig(mentionAgent.metadata, mentionId, mentionAgent.name)
        return { id: mentionId, name: mentionAgent.name, avatarSrc: resolveAvatarSrc(avatar) }
      }
    }
    return { id: assistantAgentId, name: assistantName, avatarSrc: assistantAvatarSrc }
  }, [messages, agents, assistantAgentId, assistantName, assistantAvatarSrc])

  const selectedMessages = useMemo(
    () => messages.filter((msg) => selectedMessageIds.has(msg.id)),
    [messages, selectedMessageIds],
  )

  const toggleMessageSelected = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const enterMultiSelectMode = useCallback((messageId?: string) => {
    setMultiSelectMode(true)
    if (messageId != null) setSelectedMessageIds(new Set([messageId]))
  }, [])

  const exitMultiSelectMode = useCallback(() => {
    setMultiSelectMode(false)
    setSelectedMessageIds(new Set())
    setCopied(false)
  }, [])

  const selectAllMessages = useCallback(() => {
    // streaming 消息不渲染勾选框、无法取消，不纳入选中集
    setSelectedMessageIds(
      new Set(messages.filter((msg) => msg.status !== 'streaming').map((msg) => msg.id)),
    )
  }, [messages])

  const clearSelection = useCallback(() => {
    setSelectedMessageIds(new Set())
  }, [])

  // 切换会话或离开视图时自动退出多选，避免残留选择态导致样式错乱
  useEffect(() => {
    return () => {
      setMultiSelectMode(false)
      setSelectedMessageIds(new Set())
      setCopied(false)
    }
  }, [sessionId])

  // 复制成功反馈：点亮「已复制」勾，2s 后自动复位
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copySelectedMessages = useCallback(() => {
    if (selectedMessages.length === 0) return
    // 只复制正文（text block），格式：`发言对象：内容`，条目间空行分隔。
    const lines: string[] = []
    for (const msg of selectedMessages) {
      const body = extractTextFromBlocks(msg.blocks)
      if (body.length === 0) continue
      const name =
        msg.role === 'user'
          ? '用户'
          : resolveAssistantIdentity(
              msg,
              agents,
              assistantAgentId,
              assistantName,
              assistantAvatarSrc,
            ).name
      lines.push(`${name}：${body}`)
    }
    if (lines.length === 0) return
    void navigator.clipboard
      .writeText(lines.join('\n\n'))
      .then(() => setCopied(true))
      .catch(() => {})
  }, [selectedMessages, agents, assistantAgentId, assistantName, assistantAvatarSrc])

  const deleteSelectedMessages = useCallback(() => {
    const eventIds = selectedMessages.flatMap((msg) => msg.eventIds)
    if (eventIds.length === 0) return
    deleteMessageEvents({ sessionId, eventIds })
      .then(() => {
        const selected = new Set(selectedMessages.map((msg) => msg.id))
        const removed = new Set(eventIds)
        for (const msg of selectedMessages) builderRef.current.removeMessage(msg.id)
        loadedEventsRef.current = loadedEventsRef.current.filter((e) => !removed.has(e.id))
        for (const eventId of removed) loadedEventIdsRef.current.delete(eventId)
        const nextMessages = builderRef.current
          .getAllMessages()
          .filter((msg) => !selected.has(msg.id))
        setMessages(nextMessages)
        onMessagesChange(nextMessages)
        exitMultiSelectMode()
      })
      .catch(console.error)
  }, [deleteMessageEvents, exitMultiSelectMode, onMessagesChange, selectedMessages, sessionId])

  const handleDeleteMessage = useCallback(
    (msgId: string, eventIds: string[]) => {
      deleteMessageEvents({ sessionId, eventIds })
        .then(() => {
          builderRef.current.removeMessage(msgId)
          // 同步从窗口事件源剔除被删除的 event，避免向上翻页时被重建回来
          if (eventIds.length > 0) {
            const removed = new Set(eventIds)
            loadedEventsRef.current = loadedEventsRef.current.filter((e) => !removed.has(e.id))
            for (const eventId of removed) loadedEventIdsRef.current.delete(eventId)
          }
          const nextMessages = builderRef.current.getAllMessages()
          setMessages(nextMessages)
          onMessagesChange(nextMessages)
        })
        .catch(console.error)
    },
    [deleteMessageEvents, sessionId, onMessagesChange],
  )

  // 团队模式：只删这条成员消息气泡对应的 event（保留 host message 与其他成员）。
  const handleDeleteMemberMessage = useCallback(
    (msgId: string, eventIds: string[]) => {
      if (eventIds.length === 0) return
      deleteMessageEvents({ sessionId, eventIds })
        .then(() => {
          builderRef.current.removeEventsFromMessage(msgId, eventIds)
          const removed = new Set(eventIds)
          loadedEventsRef.current = loadedEventsRef.current.filter((e) => !removed.has(e.id))
          for (const eventId of removed) loadedEventIdsRef.current.delete(eventId)
          const nextMessages = builderRef.current.getAllMessages()
          setMessages(nextMessages)
          onMessagesChange(nextMessages)
        })
        .catch(console.error)
    },
    [deleteMessageEvents, sessionId, onMessagesChange],
  )

  const handleScrollToBottom = useCallback(() => {
    const el = streamRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    userScrolledRef.current = false
    setShowScrollToBottom(false)
  }, [])

  useEffect(() => {
    const handleScrollToRunningAgent = (event: Event) => {
      const agentId = (event as CustomEvent<{ agentId?: string }>).detail?.agentId
      const root = streamRef.current
      if (!root || !agentId) return
      const escapedAgentId =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(agentId)
          : agentId.replace(/["\\]/g, '\\$&')
      const runningMatches = Array.from(
        root.querySelectorAll<HTMLElement>(
          `[data-running-agent-id="${escapedAgentId}"][data-running="true"]`,
        ),
      )
      const allMatches = Array.from(
        root.querySelectorAll<HTMLElement>(`[data-running-agent-id="${escapedAgentId}"]`),
      )
      const target = runningMatches.at(-1) ?? allMatches.at(-1)
      userScrolledRef.current = true
      setShowScrollToBottom(true)
      if (target != null) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      const messageIndex = findLastAgentMessageIndex(messagesRef.current, agentId)
      if (messageIndex < 0) return
      virtualMessageListRef.current?.scrollToIndex(messageIndex, 'center')
      requestAnimationFrame(() => {
        const match = root.querySelector<HTMLElement>(`[data-running-agent-id="${escapedAgentId}"]`)
        match?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
    window.addEventListener('spark:team-running-agent:scroll', handleScrollToRunningAgent)
    return () => {
      window.removeEventListener('spark:team-running-agent:scroll', handleScrollToRunningAgent)
    }
  }, [])

  return (
    <div className="chat-stream-viewport">
      <div className="chat-stream" ref={streamRef}>
        <div className={`chat-stream-inner${multiSelectMode ? ' has-multiselect' : ''}`}>
          {multiSelectMode && (
            <div className="chat-message-selectbar">
              <span className="selectbar-count">已选 {selectedMessageIds.size} 条</span>
              <span className="selectbar-divider" />
              <button type="button" onClick={selectAllMessages}>
                全选
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedMessageIds.size === 0}
              >
                全不选
              </button>
              <span className="selectbar-divider" />
              <button
                type="button"
                className={`primary${copied ? ' is-done' : ''}`}
                onClick={copySelectedMessages}
                disabled={selectedMessageIds.size === 0}
              >
                {copied ? <Icons.Check size={12} /> : null}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                className="danger"
                onClick={deleteSelectedMessages}
                disabled={selectedMessageIds.size === 0}
              >
                删除
              </button>
              <span className="selectbar-divider" />
              <button type="button" className="cancel" onClick={exitMultiSelectMode}>
                取消
              </button>
            </div>
          )}
          {isLoadingOlder && (
            <div className="chat-load-older" aria-hidden="true">
              <span className="chat-loading-spinner" />
            </div>
          )}
          <VirtualMessageList
            ref={virtualMessageListRef}
            items={messages}
            scrollElementRef={streamRef}
            getItemKey={(msg) => msg.id}
            estimateSize={(msg) => (msg.role === 'user' ? 120 : 220)}
            renderAfterItem={(msg) => {
              const marker = modelSwitchMarkers.find((item) => item.afterMessageId === msg.id)
              return marker == null ? null : <ModelSwitchNotice marker={marker} />
            }}
            renderItem={(msg, index) =>
              msg.role === 'user' ? (
                <UserMsg
                  key={msg.id}
                  timestamp={msg.timestamp}
                  blocks={msg.blocks}
                  {...(msg.attachments != null ? { attachments: msg.attachments } : {})}
                  {...(msg.mentionAgentId != null && msg.mentionAgentId !== assistantAgentId
                    ? {
                        mentionAgentName:
                          agents.find((a) => a.id === msg.mentionAgentId)?.name ??
                          msg.mentionAgentId,
                      }
                    : {})}
                  onDelete={() => handleDeleteMessage(msg.id, msg.eventIds)}
                  selectionMode={multiSelectMode}
                  selected={selectedMessageIds.has(msg.id)}
                  onToggleSelected={() => toggleMessageSelected(msg.id)}
                  onStartMultiSelect={() => enterMultiSelectMode(msg.id)}
                  {...(onReplyTo != null
                    ? {
                        onReply: (selectedText?: string) =>
                          onReplyTo(msg, undefined, undefined, selectedText),
                      }
                    : {})}
                  {...(onResendMessage != null
                    ? {
                        onResend: () =>
                          onResendMessage({
                            text: extractTextFromBlocks(msg.blocks),
                            attachments: msg.attachments ?? [],
                          }),
                      }
                    : {})}
                >
                  {renderBlocks(msg.blocks, onFilePreview != null ? { onFilePreview } : {})}
                </UserMsg>
              ) : (
                (() => {
                  const identity = resolveAssistantIdentity(
                    msg,
                    agents,
                    assistantAgentId,
                    assistantName,
                    assistantAvatarSrc,
                  )
                  const retryPayload = buildErrorRetryPayload(messages, index)
                  return (
                    <AssistantMessageRows
                      key={msg.id}
                      sessionId={sessionId}
                      messageId={msg.id}
                      blocks={msg.blocks}
                      messageStatus={msg.status}
                      isLatest={index === messages.length - 1}
                      assistantId={identity.id}
                      assistantName={identity.name}
                      assistantAvatarSrc={identity.avatarSrc}
                      showIdentity={shouldShowAssistantIdentity(
                        teamConfig.enabled,
                        identity.id,
                        assistantAgentId,
                      )}
                      {...(onFilePreview != null ? { onFilePreview } : {})}
                      {...(msg.status === 'streaming' ? { status: 'running' as const } : {})}
                      {...(msg.timestamp != null ? { timestamp: msg.timestamp } : {})}
                      {...(msg.status !== 'streaming'
                        ? {
                            onDelete: () => handleDeleteMessage(msg.id, msg.eventIds),
                            selectionMode: multiSelectMode,
                            selected: selectedMessageIds.has(msg.id),
                            onToggleSelected: () => toggleMessageSelected(msg.id),
                            onStartMultiSelect: () => enterMultiSelectMode(msg.id),
                          }
                        : {})}
                      {...(onReplyTo != null && msg.status !== 'streaming'
                        ? {
                            onReply: (selectedText?: string) =>
                              onReplyTo(msg, identity.id, identity.name, selectedText),
                          }
                        : {})}
                      {...(retryPayload != null && onResendMessage != null
                        ? { onRetry: () => onResendMessage(retryPayload) }
                        : {})}
                      {...(msg.status !== 'streaming' && onReplyToMember != null
                        ? {
                            onReplyToMember,
                            onDeleteMemberMessage: handleDeleteMemberMessage,
                          }
                        : {})}
                    />
                  )
                })()
              )
            }
          />
          {showWaitingAgent && (
            <AgentMsg
              key="agent-running-placeholder"
              sessionId={sessionId}
              status="running"
              blocks={[]}
              messageStatus="streaming"
              isLatest
              assistantId={placeholderIdentity.id}
              assistantName={placeholderIdentity.name}
              assistantAvatarSrc={placeholderIdentity.avatarSrc}
              showIdentity={shouldShowAssistantIdentity(
                teamConfig.enabled,
                placeholderIdentity.id,
                assistantAgentId,
              )}
              {...(onFilePreview != null ? { onFilePreview } : {})}
            />
          )}
          {messages.length === 0 && !showWaitingAgent && (
            <div className="chat-stream-empty-state">
              <div className="empty-state">
                {isLoadingHistory ? (
                  <div className="chat-loading">
                    <span className="chat-loading-spinner" aria-hidden="true" />
                    <div className="chat-loading-text">加载中…</div>
                  </div>
                ) : emptyStateVariant === 'loading' ? (
                  // 发送后过渡窗口：hero 已隐藏、首条消息/Agent 运行尚未到达，用 loading 占位
                  <div className="chat-loading">
                    <span className="chat-loading-spinner" aria-hidden="true" />
                    <div className="chat-loading-text">正在创建会话…</div>
                  </div>
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
      {isLoadingHistory && messages.length > 0 && (
        <div className="chat-switching-overlay" aria-hidden="true">
          <Icons.Spinner size={22} />
        </div>
      )}
      {showScrollToBottom && (
        <button
          className="scroll-to-bottom-btn"
          onClick={handleScrollToBottom}
          title="滚动到底部"
          aria-label="滚动到底部"
        >
          <Icons.ArrowDown size={16} />
        </button>
      )}
    </div>
  )
}

type GetSessionHistory = (request: {
  sessionId: SessionId
  full?: boolean
  limit?: number
  turnLimit?: number
  eventLimit?: number
  beforeSeq?: number
}) => Promise<{ events: AgentEvent[]; hasMore: boolean }>

/**
 * 窗口化加载的单页大小：按「轮次」分页（而非事件数）。
 * Agentic 会话里一个轮次可能有上千条事件，按事件数会把单个轮次切碎成「一条消息」；
 * 按轮次分页则每页都是完整对话。后端已排除流式 delta 行，单页载荷大幅缩小。
 */
const SESSION_HISTORY_TURN_PAGE = 6
const SESSION_HISTORY_EVENT_PAGE = 1200

/**
 * loadSessionHistoryPage — 加载会话历史的「一页」（最近 N 个完整轮次）。
 * 不带 beforeSeq → 最新一页（进会话先看到的最近轮次）；带 beforeSeq → 更早的轮次（向上翻页）。
 */
async function loadSessionHistoryPage(
  getHistory: GetSessionHistory,
  sessionId: SessionId,
  beforeSeq?: number,
): Promise<{ events: AgentEvent[]; hasMore: boolean }> {
  const res = await getHistory({
    sessionId,
    turnLimit: SESSION_HISTORY_TURN_PAGE,
    eventLimit: SESSION_HISTORY_EVENT_PAGE,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  })
  return { events: res.events, hasMore: res.hasMore }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        channel.port2.close()
        resolve()
      }
      channel.port2.postMessage(undefined)
      return
    }
    window.setTimeout(resolve, 0)
  })
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

function getLatestContextLedgerEvent(
  events: AgentEvent[],
): Extract<AgentEvent, { type: 'context_ledger' }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'context_ledger') return event
  }
  return null
}

function toContextLedgerState(
  event: Extract<AgentEvent, { type: 'context_ledger' }>,
): ContextLedgerState {
  return {
    sections: event.sections,
    totalEstimatedTokens: event.totalEstimatedTokens,
    softLimitTokens: event.softLimitTokens,
    contextWindowTokens: event.contextWindowTokens,
    usagePercent: event.usagePercent,
  }
}

function getLatestProjectContextEvent(events: AgentEvent[]): ProjectContextState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'project_context_loaded') return event
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

function findLastAgentMessageIndex(messages: UIMessage[], agentId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.agentId === agentId) return index
    if (
      message?.blocks.some((block) => 'memberAgentId' in block && block.memberAgentId === agentId)
    ) {
      return index
    }
  }
  return -1
}

function joinPath(root: string, rel: string): string {
  if (/^[\\/]/.test(rel) || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const trimRoot = root.replace(/[\\/]+$/, '')
  const trimRel = rel.replace(/^[\\/]+/, '')
  return `${trimRoot}${sep}${trimRel}`
}

function renderBlocks(
  blocks: UIBlock[],
  options: {
    surface?: 'main' | 'inspector'
    sessionId?: SessionId
    autoCollapseTools?: boolean
    onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  } = {},
): ReactNode {
  const surface = options.surface ?? 'main'
  return blocks.map((block, i) => {
    switch (block.kind) {
      case 'text':
        return (
          <div key={i} className="md-surface">
            <MarkdownText
              content={block.content}
              isStreaming={block.isStreaming}
              {...(options.onFilePreview != null ? { onFilePreview: options.onFilePreview } : {})}
            />
          </div>
        )
      case 'thinking':
        // 穿插在工具调用之间的阶段性思考，复用顶部思考模块样式，作为会话内的「思考过程」日志。
        // 非首段思考，不重复显示绿色对勾。
        return (
          <ThinkingSection
            key={i}
            blocks={[block]}
            streaming={block.isStreaming}
            showDoneBadge={false}
          />
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
        const isBashLike =
          block.toolName === 'Bash' || block.toolName === 'bash' || block.toolName === 'run_command'
        const commandValue =
          isBashLike && typeof block.toolInput.command === 'string' ? block.toolInput.command : null
        const toolArg = commandValue
          ? commandValue.slice(0, surface === 'main' ? 48 : 80)
          : JSON.stringify(block.toolInput).slice(0, surface === 'main' ? 48 : 80)
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
            autoCollapseReady={options.autoCollapseTools !== false}
          >
            {todoListBody}
            {!isTodoWrite && block.output && (
              <GitDiffContent content={block.output} renderMarkdown={MarkdownText} />
            )}
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
            autoCollapseReady={options.autoCollapseTools !== false}
          >
            {todoListBody}
            {!isTodoWrite && block.output && (
              <GitDiffContent content={block.output} renderMarkdown={MarkdownText} />
            )}
            {block.error && <span className="tool-error-span">{block.error}</span>}
          </ToolCall>
        )
      }
      case 'error':
        // 错误卡由 AgentMsg 单独渲染（可获得 sessionId 上下文以支持调高迭代上限按钮），
        // 这里跳过避免重复渲染。
        return null
      case 'cancelled':
        return <CancellationNotice key={i} message={block.message} />
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
        return null
      }
      case 'checkpoint': {
        return (
          <div key={i} className="tool-logs-collapsible" style={{ marginTop: 4, marginBottom: 4 }}>
            <Checkpoint
              checkpointId={block.checkpointId}
              {...(options.sessionId != null
                ? {
                    onRestore: () =>
                      void executeCheckpointRestore(
                        options.sessionId as SessionId,
                        block.checkpointId,
                      ),
                  }
                : {})}
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
          <div key={i} className="tool-logs-collapsible" style={{ marginTop: 4, marginBottom: 4 }}>
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
            <SubagentCard {...block} />
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
              {...(options.onFilePreview != null ? { onFilePreview: options.onFilePreview } : {})}
              {...(canUndo
                ? {
                    onUndo: () => executeCheckpointRestore(sid as SessionId, cpId as string),
                  }
                : {})}
              {...(canReapply ? { onReapply: () => reapplyTurnFiles(filesWithDiff) } : {})}
            />
          </div>
        )
      }
      case 'presented_files': {
        const documentFiles = filterDocumentOutputFiles(block.files)
        if (documentFiles.length === 0) return null
        return (
          <div
            key={i}
            className="document-output-card-list"
            style={{ marginTop: 8, marginBottom: 8 }}
          >
            {documentFiles.map((file) => (
              <DocumentOutputCard
                key={getDocumentOutputKey(file.path)}
                filePath={file.path}
                {...(file.title != null ? { label: file.title } : {})}
                {...(options.onFilePreview != null ? { onFilePreview: options.onFilePreview } : {})}
              />
            ))}
          </div>
        )
      }
      case 'user_question': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <InlineQuestionCard
              block={block}
              {...(options.sessionId != null ? { sessionId: options.sessionId } : {})}
            />
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
      case 'context_compaction': {
        return (
          <div key={i} style={{ marginTop: 4, marginBottom: 4 }}>
            <ContextCompactionCard block={block} />
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
        return (
          <div key={i} className="tool-logs-collapsible">
            <TeamDispatchBlockView block={block} />
          </div>
        )
      }
      case 'team_member_message': {
        return (
          <TeamMemberMessageBlockView
            key={i}
            block={block}
            {...(options.onFilePreview != null ? { onFilePreview: options.onFilePreview } : {})}
          />
        )
      }
      case 'team_peer_message': {
        return <TeamPeerMessageBlockView key={i} block={block} />
      }
      case 'team_round_divider': {
        return <TeamRoundDividerBlockView key={i} block={block} />
      }
      case 'team_discussion_status': {
        return (
          <div key={i} className="tool-logs-collapsible">
            <TeamDiscussionStatusBlockView block={block} />
          </div>
        )
      }
      case 'workflow_progress': {
        return <WorkflowProgressBlockView key={i} block={block} />
      }
      default:
        return null
    }
  })
}

function renderBlocksGrouped(
  blocks: UIBlock[],
  options: {
    surface?: 'main' | 'inspector'
    sessionId?: SessionId
    autoCollapseTools?: boolean
    onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  } = {},
): ReactNode {
  const autoCollapseEnabled = readAppearance().autoCollapseTools
  return splitChatActivitySegments(blocks).map((item) => {
    if (item.kind === 'content') {
      return <Fragment key={item.key}>{renderBlocks([item.block], options)}</Fragment>
    }

    return (
      <ActivitySegment
        key={item.key}
        summary={summarizeChatActivitySegment(item.blocks)}
        running={isChatActivitySegmentRunning(item.blocks)}
        sealed={item.sealed}
        autoCollapseEnabled={autoCollapseEnabled}
      >
        {renderActivityBlocks(item.blocks, options)}
      </ActivitySegment>
    )
  })
}

function renderActivityBlocks(
  blocks: ChatActivityBlock[],
  options: {
    surface?: 'main' | 'inspector'
    sessionId?: SessionId
    autoCollapseTools?: boolean
    onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  },
): ReactNode {
  const surface = options.surface ?? 'main'
  const nodes: ReactNode[] = []
  let batch: Array<
    Extract<UIBlock, { kind: 'tool_call' }> | Extract<UIBlock, { kind: 'terminal' }>
  > = []
  let batchKind: ToolLogGroupKind | null = null

  const flush = (key: string) => {
    if (batch.length === 0) return
    nodes.push(
      <ToolLogGroup
        key={key}
        blocks={batch}
        surface={surface}
        autoCollapseReady={options.autoCollapseTools !== false}
      />,
    )
    batch = []
    batchKind = null
  }

  blocks.forEach((block, index) => {
    const kind = getToolLogGroupKind(block, surface)
    if (kind != null && (block.kind === 'tool_call' || block.kind === 'terminal')) {
      if (batchKind != null && batchKind !== kind) flush(`tool-log-${index}`)
      batchKind = kind
      batch.push(block)
      return
    }

    flush(`tool-log-${index}`)
    nodes.push(<Fragment key={`block-${index}`}>{renderBlocks([block], options)}</Fragment>)
  })

  flush('tool-log-end')
  return nodes
}

/**
 * 把会话结束时的汇总尾块按固定优先级稳定重排，让顺序不依赖事件到达先后：
 *   普通内容(0) → 本次修改完成(1) → 显式交付文件(2) → 建议验证(3，最后)。
 * 普通内容（正文、带 diff 的 HunkDiff、工具日志组）保持原相对顺序，分组逻辑不受影响。
 */
function reorderTurnSummaryBlocks(blocks: UIBlock[]): UIBlock[] {
  const rank = (b: UIBlock): number => {
    if (b.kind === 'validation_suggestion') return 3
    if (b.kind === 'turn_file_summary') return 1
    if (b.kind === 'presented_files') return 2
    return 0
  }
  return blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i)
    .map((entry) => entry.b)
}

function normalizeToolName(name: string): string {
  return name
    .replace(/^functions__/, '')
    .replace(/^mcp__[^_]+__/, '')
    .toLowerCase()
}

/** 解析 agentId → 显示名（取自 SessionSidebarContext 的 agents） */
function TeamDispatchBlockView({ block }: { block: Extract<UIBlock, { kind: 'team_dispatch' }> }) {
  const { agents } = useSessionSidebar()
  const member = agents.find((a) => a.id === block.memberAgentId)
  const memberName = member?.name ?? block.memberAgentId
  const avatar = getAgentAvatarConfig(member?.metadata, block.memberAgentId, memberName)
  return (
    <TeamDispatchCard
      task={block.task}
      memberName={memberName}
      avatarSrc={resolveAvatarSrc(avatar)}
      state={block.state}
      {...(block.reply != null ? { reply: block.reply } : {})}
    />
  )
}

function WorkflowProgressBlockView({
  block,
}: {
  block: Extract<UIBlock, { kind: 'workflow_progress' }>
}) {
  const completed = block.nodes.filter((node) => node.status === 'completed').length
  const total = block.nodes.length
  const failed = block.nodes.some((node) => node.status === 'failed')
  return (
    <div className="workflow-progress-card">
      <div className="workflow-progress-head">
        <Icons.Workflow size={13} />
        <span>工作流进度</span>
        <span className={`workflow-progress-count ${failed ? 'has-failure' : ''}`}>
          {completed}/{total}
        </span>
      </div>
      <div className="workflow-progress-list">
        {block.nodes.map((node) => (
          <WorkflowProgressItem key={node.nodeId} node={node} />
        ))}
      </div>
    </div>
  )
}

function WorkflowProgressItem({ node }: { node: WorkflowProgressNode }) {
  const icon =
    node.status === 'completed' ? (
      <Icons.Check size={13} style={{ color: 'var(--c-ok, #22c55e)' }} />
    ) : node.status === 'running' ? (
      <Icons.Spinner size={13} />
    ) : node.status === 'failed' ? (
      <Icons.X size={13} style={{ color: 'var(--c-err, #ef4444)' }} />
    ) : (
      <span className="workflow-progress-dot" />
    )
  return (
    <div className={`workflow-progress-item ${node.status}`}>
      <span className="workflow-progress-icon">{icon}</span>
      <span className="workflow-progress-text">{node.title}</span>
      {(node.agentName != null || node.modelId != null) && (
        <span className="workflow-progress-agent">
          {node.agentName}
          {node.modelId != null ? ` · ${node.modelId}` : ''}
        </span>
      )}
    </div>
  )
}

function TeamMemberMessageBlockView({
  block,
  onFilePreview,
}: {
  block: Extract<UIBlock, { kind: 'team_member_message' }>
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
}) {
  const { agents } = useSessionSidebar()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null)
  const member = agents.find((a) => a.id === block.memberAgentId)
  const memberName = member?.name ?? block.memberAgentId
  const avatar = getAgentAvatarConfig(member?.metadata, block.memberAgentId, memberName)
  const running = block.isStreaming
  const empty = block.content.trim().length === 0

  // 空内容且不再流式（被终止/未产出文本）：整条气泡（含外壳与 drawer）一律不渲染，
  // 避免 A1 修复之前残留的「永久空气泡」。
  if (empty && !block.isStreaming) {
    return null
  }

  return (
    <>
      <TeamMemberBubble
        memberAgentId={block.memberAgentId}
        memberName={memberName}
        avatarSrc={resolveAvatarSrc(avatar)}
        running={running}
        textContent={block.content}
        onOpenDetail={() => setDrawerOpen(true)}
      >
        {empty && block.isStreaming ? (
          <div className="team-member-typing-dots" aria-label="成员思考中">
            <span className="team-member-typing-dot" />
            <span className="team-member-typing-dot" />
            <span className="team-member-typing-dot" />
          </div>
        ) : (
          <MarkdownText
            content={block.content}
            isStreaming={block.isStreaming}
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            onMentionClick={(agentId) => {
              setDrawerAgentId(agentId)
              setDrawerOpen(true)
            }}
            {...(onFilePreview != null ? { onFilePreview } : {})}
          />
        )}
      </TeamMemberBubble>
      {drawerOpen &&
        drawerAgentId &&
        (() => {
          const mentionedAgent = agents.find((a) => a.id === drawerAgentId)
          const mentionedName = mentionedAgent?.name ?? drawerAgentId
          const mentionedAvatar = getAgentAvatarConfig(
            mentionedAgent?.metadata,
            drawerAgentId,
            mentionedName,
          )
          return (
            <TeamMemberDrawer
              member={{
                agentId: drawerAgentId,
                name: mentionedName,
                description: mentionedAgent?.description ?? '',
                providerProfileId: mentionedAgent?.providerProfileId ?? null,
                modelId: mentionedAgent?.modelId ?? null,
                skillCount: mentionedAgent?.skillIds.length ?? 0,
                mcpCount: mentionedAgent?.mcpServerIds.length ?? 0,
                avatarSrc: resolveAvatarSrc(mentionedAvatar),
              }}
              onClose={() => {
                setDrawerOpen(false)
                setDrawerAgentId(null)
              }}
            />
          )
        })()}
    </>
  )
}

function TeamPeerMessageBlockView({
  block,
}: {
  block: Extract<UIBlock, { kind: 'team_peer_message' }>
}) {
  const { agents } = useSessionSidebar()
  const sender = agents.find((a) => a.id === block.memberAgentId)
  const senderName = sender?.name ?? block.memberAgentId
  const senderAvatar = getAgentAvatarConfig(sender?.metadata, block.memberAgentId, senderName)
  const targetName =
    block.targetAgentId != null
      ? (agents.find((a) => a.id === block.targetAgentId)?.name ?? block.targetAgentId)
      : null
  const metaLabel =
    block.delivery === 'note'
      ? targetName != null
        ? `留言 → ${targetName}`
        : '留言 → 全员'
      : targetName != null
        ? `${senderName} → ${targetName}`
        : `${senderName} → 全员`

  // 正文 @ 自动转发：content 是发送者刚说完的回复原文副本，正文气泡已完整渲染过，
  // 这里降级为一条轻量转发提示，避免同一段内容出现两遍。
  if (block.autoForwarded === true) {
    return (
      <div className="team-peer-forward-hint">
        <Icons.ArrowRight size={12} />
        <span>
          {targetName != null
            ? `${senderName} 的回复已自动转发给 @${targetName}`
            : `${senderName} 的回复已自动转发`}
        </span>
      </div>
    )
  }

  return (
    <TeamMemberBubble
      memberAgentId={block.memberAgentId}
      memberName={senderName}
      avatarSrc={resolveAvatarSrc(senderAvatar)}
      origin="peer"
      metaLabel={metaLabel}
      textContent={block.content}
    >
      <div className="md-surface">
        <MarkdownText
          content={block.content}
          isStreaming={false}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        />
      </div>
    </TeamMemberBubble>
  )
}

function TeamRoundDividerBlockView({
  block,
}: {
  block: Extract<UIBlock, { kind: 'team_round_divider' }>
}) {
  return (
    <div className="team-round-divider" role="separator" aria-label={`第 ${block.round + 1} 轮`}>
      <span className="team-round-divider-line" />
      <span className="team-round-divider-label">{`第 ${block.round + 1} 轮 / 共 ${block.maxRounds} 轮`}</span>
      <span className="team-round-divider-line" />
    </div>
  )
}

function TeamDiscussionStatusBlockView({
  block,
}: {
  block: Extract<UIBlock, { kind: 'team_discussion_status' }>
}) {
  const label =
    block.reason === 'concluded'
      ? '讨论已结束'
      : block.reason === 'max_rounds'
        ? '达到轮次上限，讨论已结束'
        : '讨论已取消'
  return (
    <div className={`team-discussion-status ${block.reason}`}>
      <Icons.Activity size={12} />
      <span>{label}</span>
    </div>
  )
}

function TeamMemberActivityBlockView({
  memberAgentId,
  blocks,
  running,
  sessionId,
  onFilePreview,
  onReplyToMember,
  onDeleteMemberMessage,
}: {
  memberAgentId: string
  blocks: UIBlock[]
  running: boolean
  sessionId: SessionId
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  onReplyToMember?: (args: {
    memberAgentId: string
    memberName: string
    content: string
    selectedText?: string
  }) => void
  onDeleteMemberMessage?: (eventIds: string[]) => void
}) {
  const { agents } = useSessionSidebar()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const member = agents.find((a) => a.id === memberAgentId)
  const memberName = member?.name ?? memberAgentId
  const avatar = getAgentAvatarConfig(member?.metadata, memberAgentId, memberName)

  // 该成员气泡的纯文本（复制内容）+ 源 event id（删除）。只取 team_member_message block。
  const memberTextBlocks = useMemo(
    () =>
      blocks.filter(
        (b): b is Extract<UIBlock, { kind: 'team_member_message' }> =>
          b.kind === 'team_member_message',
      ),
    [blocks],
  )
  const textContent = useMemo(
    () =>
      memberTextBlocks
        .map((b) => b.content)
        .join('\n')
        .trim(),
    [memberTextBlocks],
  )
  const memberEventIds = useMemo(
    () => memberTextBlocks.flatMap((b) => b.eventIds ?? []),
    [memberTextBlocks],
  )

  if (!hasVisibleTeamMemberActivityBlocks(blocks)) return null

  return (
    <>
      <TeamMemberBubble
        memberAgentId={memberAgentId}
        memberName={memberName}
        avatarSrc={resolveAvatarSrc(avatar)}
        running={running}
        textContent={textContent}
        {...(onReplyToMember != null
          ? {
              onReply: (selectedText?: string) =>
                onReplyToMember({
                  memberAgentId,
                  memberName,
                  content: textContent,
                  ...(selectedText != null ? { selectedText } : {}),
                }),
            }
          : {})}
        {...(onDeleteMemberMessage != null && memberEventIds.length > 0
          ? { onDelete: () => onDeleteMemberMessage(memberEventIds) }
          : {})}
        onOpenDetail={() => setDrawerOpen(true)}
      >
        {renderTeamMemberActivityBlocks(
          blocks,
          onFilePreview != null ? { sessionId, onFilePreview } : { sessionId },
        )}
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
  options: {
    sessionId: SessionId
    onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  },
): ReactNode {
  // 团队模式下不展示成员的执行日志（tool_call/terminal/file_change），避免每个成员都挂一个
  // “执行日志”折叠块导致会话分块、视觉割裂；只保留成员的最终回复正文。
  const resultBlocks = blocks.filter((block) => !isTeamMemberLogBlock(block))

  return (
    <>
      {resultBlocks.map((block, index) => {
        if (block.kind === 'team_member_message') {
          if (block.content.trim().length === 0) return null
          return (
            <div key={index} className="md-surface">
              <MarkdownText
                content={block.content}
                isStreaming={block.isStreaming}
                {...(options.onFilePreview != null ? { onFilePreview: options.onFilePreview } : {})}
              />
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
  sessionId,
}: {
  block: Extract<UIBlock, { kind: 'user_question' }>
  sessionId?: SessionId
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
    const cacheKey = getQuestionAnswerCacheKey(block.questions, sessionId)
    const cached = readPersistedQuestionAnswerSummaries(cacheKey)
    if (cached != null) {
      for (const item of cached) {
        answerByQuestion.set(item.question, {
          answer: item.answer,
          ...(item.skipped != null ? { skipped: item.skipped } : {}),
        })
      }
    }
  }

  return (
    <div className="chat-card">
      <div className="chat-card-h info">
        <span className="ico">
          <Icons.HelpCircle size={14} />
        </span>
        <span>Agent 提问</span>
        {block.answered && (
          <span className="badge" style={{ marginLeft: 8, fontSize: 10, color: 'var(--c-ok)' }}>
            已回答
          </span>
        )}
        {block.error != null && (
          <span className="badge" style={{ marginLeft: 8, fontSize: 10, color: 'var(--c-err)' }}>
            提问失败
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
            <span
              style={{ fontSize: 12, color: block.error != null ? 'var(--c-err)' : 'var(--c-dim)' }}
            >
              {block.error ?? '请在底部问答面板中逐题作答'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Inline card showing Context Ledger token breakdown */
function ContextLedgerCard({ block }: { block: Extract<UIBlock, { kind: 'context_ledger' }> }) {
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
        Context Governor summarized {block.summarizedEntryCount} older exchanges (saved ~
        {block.tokensSaved.toLocaleString()} tokens)
      </span>
    </div>
  )
}

/** Inline card showing provider-reported context compaction output */
function ContextCompactionCard({
  block,
}: {
  block: Extract<UIBlock, { kind: 'context_compaction' }>
}) {
  const sourceLabel =
    block.source === 'claude_code'
      ? 'Claude Code'
      : block.source === 'codex_cli'
        ? 'Codex CLI'
        : 'Codex SDK'
  const phaseLabel =
    block.phase === 'started'
      ? 'started compacting'
      : block.phase === 'completed'
        ? 'completed compaction'
        : block.phase === 'failed'
          ? 'failed compaction'
          : 'reported compact boundary'
  const tokenText =
    block.preTokens != null || block.postTokens != null
      ? [
          block.preTokens != null ? `${block.preTokens.toLocaleString()} t` : null,
          block.postTokens != null ? `${block.postTokens.toLocaleString()} t` : null,
        ]
          .filter(Boolean)
          .join(' -> ')
      : null
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: 'var(--c-surface, #1e1e2e)',
        border: '1px solid var(--c-border, #333)',
        fontSize: 12,
        color: 'var(--c-text, #ccc)',
        display: 'grid',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icons.Layers size={14} style={{ opacity: 0.65, flexShrink: 0 }} />
        <span style={{ opacity: 0.78 }}>
          {sourceLabel} {phaseLabel}
          {block.trigger != null ? ` (${block.trigger})` : ''}
          {tokenText != null ? ` · ${tokenText}` : ''}
          {block.durationMs != null ? ` · ${block.durationMs}ms` : ''}
        </span>
      </div>
      {block.summary != null && (
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{block.summary}</div>
      )}
      {block.message != null && (
        <div style={{ color: 'var(--c-warn, #f59e0b)', whiteSpace: 'pre-wrap' }}>
          {block.message}
        </div>
      )}
      {block.rawType != null && (
        <div style={{ color: 'var(--c-dim, #8a8f98)', fontSize: 11 }}>raw: {block.rawType}</div>
      )}
    </div>
  )
}

/** Inline card showing a self-correction retry trail */
function RetryTrailCard({ block }: { block: Extract<UIBlock, { kind: 'retry_trail' }> }) {
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
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
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
        <div
          style={{
            marginTop: 6,
            padding: '6px 8px',
            borderRadius: 4,
            background: 'rgba(239,68,68,0.08)',
            fontSize: 11,
          }}
        >
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
async function reapplyTurnFiles(files: Array<FileChangeSummary & { diff: string }>): Promise<void> {
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
  onDelete,
  onResend,
}: {
  timestamp?: string | undefined
  textContent: string
  position: 'left' | 'right'
  onDelete?: () => void
  /** 仅用户消息：把这条消息的文本+附件重新塞回输入区 */
  onResend?: () => void
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

  return (
    <div className={`msg-hover-bar msg-hover-${position}`}>
      {time && <span className="msg-hover-time">{time}</span>}
      {onResend && (
        <button className="msg-hover-resend" title="重发" onClick={onResend}>
          <Icons.RotateCw size={12} />
        </button>
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

function SelectionQuoteContextMenu({
  onQuote,
}: {
  onQuote: (text: string, label?: string) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null)

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.composer, .context-action-menu, .action-menu, .msg-bubble') != null)
        return
      const selection = window.getSelection?.()
      const text = selection?.toString().trim() ?? ''
      if (text.length === 0 || selection?.isCollapsed) return
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, text })
    }
    window.addEventListener('contextmenu', handleContextMenu)
    return () => window.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  if (menu == null) return null
  return (
    <InlineContextMenu
      x={menu.x}
      y={menu.y}
      onClose={() => setMenu(null)}
      items={[
        {
          key: 'quote-selection',
          label: '引用对话',
          icon: <Icons.CornerUpLeft size={14} />,
          onClick: () => onQuote(menu.text, '选中内容'),
        },
      ]}
    />
  )
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

function insertTextIntoControl(target: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  target.setRangeText(text, start, end, 'end')
  target.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
  )
}

/** 从 blocks 中提取纯文本内容（用于复制） */
function extractTextFromBlocks(blocks: UIBlock[]): string {
  return blocks
    .filter((b) => b.kind === 'text')
    .map((b) => (b as Extract<UIBlock, { kind: 'text' }>).content)
    .join('\n')
    .trim()
}

const UserMsg = React.memo(
  function UserMsg({
    children,
    timestamp,
    blocks,
    attachments = [],
    onDelete,
    mentionAgentName,
    onReply,
    onResend,
    selectionMode = false,
    selected = false,
    onToggleSelected,
    onStartMultiSelect,
  }: {
    children: ReactNode
    timestamp?: string | undefined
    blocks: UIBlock[]
    attachments?: MessageAttachment[]
    onDelete?: () => void
    /** 团队模式：用户 @ 指定的 Agent 名称（已解析）；用于显示"→ 已直接由 @X 处理"提示 */
    mentionAgentName?: string | undefined
    onReply?: (selectedText?: string) => void
    /** 重发：把这条消息的文本+附件重新塞回输入区 */
    onResend?: () => void
    selectionMode?: boolean
    selected?: boolean
    onToggleSelected?: () => void
    onStartMultiSelect?: () => void
  }) {
    const textContent = extractTextFromBlocks(blocks)
    const [contextMenu, setContextMenu] = useState<{
      x: number
      y: number
      imageSrc?: string
      selectedText?: string
    } | null>(null)

    const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const target = event.target as HTMLElement | null
      const image = target?.closest('img') as HTMLImageElement | null
      const selectedText = readSelectedTextWithin(event.currentTarget)
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        ...(image != null ? { imageSrc: image.currentSrc || image.src } : {}),
        ...(selectedText.length > 0 ? { selectedText } : {}),
      })
    }, [])

    const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
      if (contextMenu == null) return []
      const items: ContextMenuItem[] = []
      if (contextMenu.selectedText != null && onReply != null) {
        items.push({
          key: 'quote-selection',
          label: '引用对话',
          icon: <Icons.CornerUpLeft size={14} />,
          onClick: () => onReply(contextMenu.selectedText),
        })
      }
      if (contextMenu.imageSrc != null) {
        items.push({
          key: 'copy-image',
          label: '复制图片',
          icon: <Icons.Image size={14} />,
          onClick: () => {
            if (contextMenu.imageSrc != null)
              void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
          },
        })
      } else if (textContent.length > 0 || contextMenu.selectedText != null) {
        const selectedText = contextMenu.selectedText
        items.push({
          key: 'copy-text',
          label: selectedText != null ? '复制选中' : '复制内容',
          icon: <Icons.Copy size={14} />,
          onClick: () => {
            void navigator.clipboard.writeText(selectedText ?? textContent)
          },
        })
      }
      if (onReply != null) {
        items.push({
          key: 'reply',
          label: '回复',
          icon: <Icons.CornerUpLeft size={14} />,
          onClick: () => onReply(),
        })
      }
      if (onStartMultiSelect != null) {
        items.push({
          key: 'multi-select',
          label: '多选',
          icon: <Icons.CheckSquare size={14} />,
          onClick: onStartMultiSelect,
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
    }, [contextMenu, onDelete, onReply, onStartMultiSelect, textContent])

    const handleRowClick = selectionMode
      ? (event: React.MouseEvent<HTMLDivElement>) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('a,button,input,textarea,select,[contenteditable="true"]')) return
          onToggleSelected?.()
        }
      : undefined

    return (
      <div
        className={`msg msg-user${selectionMode ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}
        onClick={handleRowClick}
        role={selectionMode ? 'button' : undefined}
        tabIndex={selectionMode ? 0 : undefined}
      >
        {selectionMode && (
          <label className="msg-select-check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              aria-label="选择该消息"
            />
            <Icons.Check className="msg-select-checkmark" size={14} />
          </label>
        )}
        {attachments.length > 0 && <UserMessageAttachments attachments={attachments} />}
        <div className="msg-user-line">
          <div className="msg-bubble msg-bubble-user" onContextMenu={handleContextMenu}>
            <div className="msg-content">
              <CollapsibleContent>{children}</CollapsibleContent>
            </div>
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
          {...(onResend ? { onResend } : {})}
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
  },
  (prev, next) => {
    // 用户消息创建后不再变化：blocks 引用稳定即可跳过重渲染（忽略 children/回调标识）。
    // 但 selectionMode/selected 必须比较，否则进入多选时 memo 判定 props 未变 → 勾选框不挂载。
    return (
      prev.blocks === next.blocks &&
      prev.attachments === next.attachments &&
      prev.mentionAgentName === next.mentionAgentName &&
      prev.timestamp === next.timestamp &&
      prev.selectionMode === next.selectionMode &&
      prev.selected === next.selected
    )
  },
)

function resolveAssistantIdentity(
  msg: UIMessage,
  agents: ManagedAgent[],
  fallbackId: string,
  fallbackName: string,
  fallbackAvatarSrc: string,
): { id: string; name: string; avatarSrc: string } {
  const id = msg.agentId ?? fallbackId
  const agent = agents.find((item) => item.id === id)
  const name = msg.agentName ?? agent?.name ?? fallbackName
  if (msg.agentId == null) {
    return { id: fallbackId, name: fallbackName, avatarSrc: fallbackAvatarSrc }
  }
  const avatar = getAgentAvatarConfig(agent?.metadata, id, name)
  return { id, name, avatarSrc: resolveAvatarSrc(avatar) }
}

function UserMessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image')
  const fileAttachments = attachments.filter((attachment) => attachment.type === 'file')
  const directoryAttachments = attachments.filter((attachment) => attachment.type === 'directory')

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
      {directoryAttachments.length > 0 && (
        <div className="msg-user-file-row">
          {directoryAttachments.map((attachment) => (
            <div
              key={`${attachment.path}:${attachment.name ?? ''}`}
              className="composer-file-chip msg-user-file-chip msg-user-directory-chip"
              title={attachment.name ?? getFileNameFromPath(attachment.path)}
            >
              <Icons.Folder size={14} />
              <span>{attachment.name ?? getFileNameFromPath(attachment.path)}</span>
            </div>
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
              <FileChipIcon path={attachment.path} size={14} />
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

    if (!needsPreparedPreview)
      return () => {
        cancelled = true
      }

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

/**
 * assistantRowsPropsAreEqual — AssistantMessageRows / AgentMsg 的 memo 比较器。
 *
 * MessageBuilder 对消息对象/blocks 数组是「就地 mutate」的：流式中 blocks 引用不变、
 * 内容在变，因此对正在流式（isLatest 或 status==='running'）的行必须始终重渲染。
 * 已完成且非最新的行不会再被 mutate（blocks 引用永久稳定），可安全跳过——这正是
 * 长会话流式时大量历史行被无谓重渲染（重跑 markdown 解析）的根因。
 * 故意忽略 onDelete/onReply/onFilePreview 等回调标识：它们每次 render 都是新函数，
 * 但其「是否存在」对给定消息是稳定的，不应触发重渲染。
 */
type AssistantRowCompareProps = {
  sessionId: SessionId
  status?: 'running'
  blocks: UIBlock[]
  messageStatus?: UIMessage['status']
  isLatest?: boolean
  timestamp?: string | undefined
  assistantId: string
  assistantName: string
  assistantAvatarSrc: string
  showIdentity?: boolean
  running?: boolean
  selectionMode?: boolean
  selected?: boolean
  onRetry?: () => void
}

function assistantRowsPropsAreEqual(
  prev: Readonly<AssistantRowCompareProps>,
  next: Readonly<AssistantRowCompareProps>,
): boolean {
  if (prev.isLatest || next.isLatest || prev.status === 'running' || next.status === 'running') {
    return false
  }
  return (
    prev.blocks === next.blocks &&
    prev.messageStatus === next.messageStatus &&
    prev.sessionId === next.sessionId &&
    prev.assistantId === next.assistantId &&
    prev.assistantName === next.assistantName &&
    prev.assistantAvatarSrc === next.assistantAvatarSrc &&
    prev.showIdentity === next.showIdentity &&
    prev.timestamp === next.timestamp &&
    prev.selectionMode === next.selectionMode &&
    prev.selected === next.selected &&
    (prev.onRetry != null) === (next.onRetry != null)
  )
}

const AssistantMessageRows = React.memo(function AssistantMessageRows({
  sessionId,
  status,
  blocks,
  messageStatus,
  isLatest,
  timestamp,
  assistantId,
  assistantName,
  assistantAvatarSrc,
  showIdentity,
  onDelete,
  onReply,
  onFilePreview,
  messageId,
  onReplyToMember,
  onDeleteMemberMessage,
  selectionMode,
  selected,
  onToggleSelected,
  onStartMultiSelect,
  onRetry,
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
  showIdentity: boolean
  onDelete?: () => void
  onReply?: (selectedText?: string) => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  messageId: string
  onReplyToMember?: (args: {
    messageId: string
    memberAgentId: string
    memberName: string
    content: string
    selectedText?: string
  }) => void
  onDeleteMemberMessage?: (msgId: string, eventIds: string[]) => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelected?: () => void
  onStartMultiSelect?: () => void
  onRetry?: () => void
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
              {renderBlocks(
                segment.blocks,
                onFilePreview != null ? { sessionId, onFilePreview } : { sessionId },
              )}
            </div>
          )
        }
        if (segment.kind === 'team_member_activity') {
          if (!hasVisibleTeamMemberActivityBlocks(segment.blocks)) return null
          return (
            <div
              key={`team-member-activity-${index}`}
              className="team-timeline-segment"
              data-running-agent-id={segment.memberContext.memberAgentId}
              data-running={segment.running ? 'true' : 'false'}
            >
              <TeamMemberActivityBlockView
                memberAgentId={segment.memberContext.memberAgentId}
                blocks={segment.blocks}
                running={segment.running}
                sessionId={sessionId}
                {...(onFilePreview != null ? { onFilePreview } : {})}
                {...(onReplyToMember != null
                  ? {
                      onReplyToMember: (memberArgs: {
                        memberAgentId: string
                        memberName: string
                        content: string
                        selectedText?: string
                      }) => onReplyToMember({ ...memberArgs, messageId }),
                    }
                  : {})}
                {...(onDeleteMemberMessage != null
                  ? {
                      onDeleteMemberMessage: (eventIds: string[]) =>
                        onDeleteMemberMessage(messageId, eventIds),
                    }
                  : {})}
              />
            </div>
          )
        }
        if (segment.kind === 'team_peer') {
          return (
            <div key={`team-peer-${index}`} className="team-timeline-segment">
              <TeamPeerMessageBlockView block={segment.block} />
            </div>
          )
        }
        if (segment.kind === 'team_round_divider') {
          return <TeamRoundDividerBlockView key={`team-round-${index}`} block={segment.block} />
        }
        if (segment.kind === 'team_discussion_status') {
          return (
            <TeamDiscussionStatusBlockView key={`team-status-${index}`} block={segment.block} />
          )
        }
        const segmentStreaming = segmentIsLatest && status === 'running'
        return (
          <AgentMsg
            key={`agent-${index}`}
            sessionId={sessionId}
            blocks={segment.blocks}
            isLatest={segmentIsLatest}
            assistantId={assistantId}
            assistantName={assistantName}
            assistantAvatarSrc={assistantAvatarSrc}
            showIdentity={showIdentity}
            running={segmentStreaming}
            {...(onFilePreview != null ? { onFilePreview } : {})}
            {...(segmentStreaming ? { status: 'running' as const } : {})}
            {...(messageStatus != null ? { messageStatus } : {})}
            {...(timestamp != null ? { timestamp } : {})}
            {...(onDelete != null ? { onDelete } : {})}
            {...(onReply != null ? { onReply } : {})}
            {...(selectionMode !== undefined ? { selectionMode } : {})}
            {...(selected !== undefined ? { selected } : {})}
            {...(onToggleSelected != null ? { onToggleSelected } : {})}
            {...(onStartMultiSelect != null ? { onStartMultiSelect } : {})}
            {...(onRetry != null ? { onRetry } : {})}
          />
        )
      })}
    </>
  )
}, assistantRowsPropsAreEqual)

type AssistantMessageSegment =
  | { kind: 'agent'; blocks: UIBlock[] }
  | { kind: 'team'; blocks: UIBlock[] }
  | { kind: 'team_peer'; block: Extract<UIBlock, { kind: 'team_peer_message' }> }
  | { kind: 'team_round_divider'; block: Extract<UIBlock, { kind: 'team_round_divider' }> }
  | { kind: 'team_discussion_status'; block: Extract<UIBlock, { kind: 'team_discussion_status' }> }
  | {
      kind: 'team_member_activity'
      memberContext: TeamMemberEventContext
      blocks: UIBlock[]
      running: boolean
    }

function splitAssistantMessageBlocks(blocks: UIBlock[]): AssistantMessageSegment[] {
  const segments: AssistantMessageSegment[] = []
  const latestTeamMemberSegments = new Map<
    string,
    Extract<AssistantMessageSegment, { kind: 'team_member_activity' }>
  >()
  const runningDispatches = new Set<string>()
  // Preserve timeline order: host/member blocks only merge while they remain contiguous.
  // This keeps host follow-up after member output visible as a new bubble at the bottom.
  const ensureAgentSegment = () => {
    const previous = segments.at(-1)
    if (previous?.kind === 'agent') {
      return previous
    }
    const segment: Extract<AssistantMessageSegment, { kind: 'agent' }> = {
      kind: 'agent',
      blocks: [],
    }
    segments.push(segment)
    return segment
  }

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
      const segment = latestTeamMemberSegments.get(key)
      if (segment != null)
        segment.running = isRunning || isTeamMemberActivityRunning(segment.blocks)
      segments.push({ kind: 'team', blocks: [block] })
      continue
    }
    if (block.kind === 'team_peer_message') {
      segments.push({ kind: 'team_peer', block })
      continue
    }
    if (block.kind === 'team_round_divider') {
      segments.push({ kind: 'team_round_divider', block })
      continue
    }
    if (block.kind === 'team_discussion_status') {
      segments.push({ kind: 'team_discussion_status', block })
      continue
    }
    const memberContext = getBlockTeamMemberContext(block)
    if (memberContext != null) {
      const key = teamMemberContextKey(memberContext)
      const previous = segments.at(-1)
      let segment =
        previous?.kind === 'team_member_activity' &&
        teamMemberContextKey(previous.memberContext) === key
          ? previous
          : null
      if (segment == null) {
        segment = {
          kind: 'team_member_activity',
          memberContext,
          blocks: [],
          running: runningDispatches.has(key),
        }
        segments.push(segment)
      }
      latestTeamMemberSegments.set(key, segment)
      segment.blocks.push(block)
      segment.running = runningDispatches.has(key) || isTeamMemberActivityRunning(segment.blocks)
      continue
    }
    ensureAgentSegment().blocks.push(block)
  }
  return segments
}

function teamMemberContextKey(context: TeamMemberEventContext): string {
  return `${context.dispatchId}:${context.memberAgentId}`
}

function isHiddenTimelineBlock(block: UIBlock): boolean {
  return (
    block.kind === 'tool_call' &&
    (block.toolName === 'mcp__spark_team__agent_dispatch' ||
      block.toolName.toLowerCase().endsWith('present_files'))
  )
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

function isHostActivityRunning(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    if (getBlockTeamMemberContext(block) != null) return false
    if (block.kind === 'text' || block.kind === 'thinking') return block.isStreaming
    if (block.kind === 'tool_call') return block.status === 'pending' || block.status === 'running'
    if (block.kind === 'terminal') return block.isStreaming
    if (block.kind === 'subagent') return block.status === 'running'
    return false
  })
}

const AgentMsg = React.memo(function AgentMsg({
  sessionId,
  status,
  blocks,
  messageStatus,
  isLatest,
  timestamp,
  assistantId,
  assistantName,
  assistantAvatarSrc,
  showIdentity = true,
  running,
  onDelete,
  onReply,
  onFilePreview,
  selectionMode = false,
  selected = false,
  onToggleSelected,
  onStartMultiSelect,
  onRetry,
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
  showIdentity?: boolean
  running?: boolean
  onDelete?: () => void
  onReply?: (selectedText?: string) => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelected?: () => void
  onStartMultiSelect?: () => void
  onRetry?: () => void
}) {
  // 首个"内容块"出现前的连续思考 → 顶部思考模块；其后穿插的阶段性思考保留在内容流里
  // 就地渲染（表现为类似工具日志的「思考过程」模块），避免把一个 turn 内多段思考全部堆到开头。
  const firstContentIdx = blocks.findIndex(
    (b) =>
      b.kind !== 'thinking' &&
      b.kind !== 'error' &&
      b.kind !== 'runtime_signal' &&
      b.kind !== 'terminal' &&
      !isHiddenTimelineBlock(b),
  )
  const isLeadingThinking = (b: UIBlock, i: number): boolean =>
    b.kind === 'thinking' && (firstContentIdx === -1 || i < firstContentIdx)
  const leadingThinkingBlocks = blocks.filter((b, i): b is Extract<UIBlock, { kind: 'thinking' }> =>
    isLeadingThinking(b, i),
  )
  const timelineBlocks = reorderTurnSummaryBlocks(
    blocks.filter(
      (b, i) => !isLeadingThinking(b, i) && b.kind !== 'terminal' && !isHiddenTimelineBlock(b),
    ),
  )
  const timelineGroups = groupChatMessageTimeline(timelineBlocks)
  const contentBlocks = timelineBlocks.filter(
    (block) => block.kind !== 'error' && block.kind !== 'runtime_signal',
  )
  const toolCallBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'tool_call' }> =>
      b.kind === 'tool_call' && !isHiddenTimelineBlock(b),
  )
  const errorBlocks = blocks.filter((b) => b.kind === 'error')
  const isStreaming = status === 'running'
  const hasContent = leadingThinkingBlocks.length > 0 || contentBlocks.length > 0
  // Count active (pending/running) tool calls for parallel indicator
  const activeToolCount = toolCallBlocks.filter(
    (b) => b.status === 'pending' || b.status === 'running',
  ).length
  const isCancelled = messageStatus === 'cancelled' && !isStreaming
  // Pure error: no content, only error blocks
  const isPureError =
    messageStatus === 'error' && !isStreaming && !hasContent && errorBlocks.length > 0
  // 是否已完成（非流式中）— 只有完成的消息才显示 hover bar
  const isFinished = !isStreaming

  // 思考与工具日志总开关：输出完毕后默认折叠本气泡内所有「思考过程」与工具日志组，
  // 由顶部「思考和工具日志」切换条统一控制（流式中不生效，保留思考进度反馈）。
  const [toolLogsOpen, setToolLogsOpen] = useState(false)
  const thinkingBlocksCount = blocks.filter(
    (b) => b.kind === 'thinking' && !isHiddenTimelineBlock(b),
  ).length
  // 同样纳入折叠的附属块：checkpoint / plan_proposed / team_dispatch / team_discussion_status。
  // terminal 在 main surface 不渲染（已由 tool-log-group 覆盖），不计入。
  const extraCollapsibleBlocksCount = blocks.filter(
    (b) =>
      b.kind === 'checkpoint' ||
      b.kind === 'plan_proposed' ||
      b.kind === 'team_dispatch' ||
      b.kind === 'team_discussion_status',
  ).length
  // 正文里独立的文件 diff 板块（file_change 带 diff）同样纳入折叠：输出完毕后默认隐藏，
  // 由顶部切换条统一展开。嵌在工具输出里的 GitDiffContent 已被 tool-log-group 覆盖，无需另计。
  const fileChangeDiffBlocksCount = blocks.filter(
    (b) => b.kind === 'file_change' && typeof b.diff === 'string' && b.diff.length > 0,
  ).length
  const showToolLogsToggle =
    isFinished &&
    (toolCallBlocks.length > 0 ||
      thinkingBlocksCount > 0 ||
      extraCollapsibleBlocksCount > 0 ||
      fileChangeDiffBlocksCount > 0)
  const hideToolLogs = showToolLogsToggle && !toolLogsOpen

  // 提取纯文本用于复制
  const textContent = extractTextFromBlocks(blocks)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    imageSrc?: string
    selectedText?: string
  } | null>(null)

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const target = event.target as HTMLElement | null
    const image = target?.closest('img') as HTMLImageElement | null
    const selectedText = readSelectedTextWithin(event.currentTarget)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      ...(image != null ? { imageSrc: image.currentSrc || image.src } : {}),
      ...(selectedText.length > 0 ? { selectedText } : {}),
    })
  }, [])

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (contextMenu == null) return []
    const items: ContextMenuItem[] = []
    if (contextMenu.selectedText != null && onReply != null) {
      items.push({
        key: 'quote-selection',
        label: '引用对话',
        icon: <Icons.CornerUpLeft size={14} />,
        onClick: () => onReply(contextMenu.selectedText),
      })
    }
    if (contextMenu.imageSrc != null) {
      items.push({
        key: 'copy-image',
        label: '复制图片',
        icon: <Icons.Image size={14} />,
        onClick: () => {
          if (contextMenu.imageSrc != null)
            void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
        },
      })
    } else if (textContent.length > 0 || contextMenu.selectedText != null) {
      const selectedText = contextMenu.selectedText
      items.push({
        key: 'copy-text',
        label: selectedText != null ? '复制选中' : '复制内容',
        icon: <Icons.Copy size={14} />,
        onClick: () => {
          void navigator.clipboard.writeText(selectedText ?? textContent)
        },
      })
    }
    if (onReply != null) {
      items.push({
        key: 'reply',
        label: '回复',
        icon: <Icons.CornerUpLeft size={14} />,
        onClick: () => onReply(),
      })
    }
    if (onStartMultiSelect != null) {
      items.push({
        key: 'multi-select',
        label: '多选',
        icon: <Icons.CheckSquare size={14} />,
        onClick: onStartMultiSelect,
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
  }, [contextMenu, onDelete, onReply, onStartMultiSelect, textContent])

  const handleRowClick = selectionMode
    ? (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('a,button,input,textarea,select,[contenteditable="true"]')) return
        onToggleSelected?.()
      }
    : undefined

  const timelineContent = timelineGroups.map((group) => {
    if (group.kind === 'content') {
      return (
        <div className="msg-content-run" key={group.key}>
          {renderBlocksGrouped(
            group.blocks,
            onFilePreview != null
              ? { sessionId, onFilePreview, autoCollapseTools: !isStreaming }
              : { sessionId, autoCollapseTools: !isStreaming },
          )}
        </div>
      )
    }
    if (group.kind === 'error') {
      const block = group.block
      return (
        <StreamingErrorCard
          key={group.key}
          message={block.message}
          code={block.code}
          title={block.title ?? 'Agent 执行失败'}
          level="error"
          retryable={block.retryable}
          {...(block.actionHint != null ? { actionHint: block.actionHint } : {})}
          {...(block.details != null ? { details: block.details } : {})}
          {...(block.origin != null ? { origin: block.origin } : {})}
          {...(block.occurrenceCount != null ? { occurrenceCount: block.occurrenceCount } : {})}
          {...(block.retryable && onRetry != null ? { onRetry } : {})}
        />
      )
    }
    return (
      <RuntimeSignalCard
        key={group.key}
        block={group.block}
        {...(group.block.retryable && onRetry != null ? { onRetry } : {})}
      />
    )
  })

  return (
    <div
      className={`msg msg-agent${showIdentity ? '' : ' without-avatar'} ${isCancelled ? 'is-cancelled' : ''} ${isPureError ? 'is-error' : ''}${selectionMode ? ' is-selecting' : ''}${selected ? ' is-selected' : ''}`}
      data-running-agent-id={assistantId}
      data-running={running === true ? 'true' : 'false'}
      onClick={handleRowClick}
      role={selectionMode ? 'button' : undefined}
      tabIndex={selectionMode ? 0 : undefined}
    >
      {selectionMode && (
        <label className="msg-select-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label="选择该消息"
          />
          <Icons.Check className="msg-select-checkmark" size={14} />
        </label>
      )}
      {showIdentity && (
        <div className="msg-agent-avatar">
          <AvatarImage src={assistantAvatarSrc} seed={assistantId} name={assistantName} />
        </div>
      )}
      <div className="msg-agent-main">
        {showIdentity && (
          <div className="msg-agent-head">
            <span className="msg-agent-name">{assistantName}</span>
          </div>
        )}
        <div
          className={`msg-bubble msg-bubble-agent${hideToolLogs ? ' tool-logs-hidden' : ''}`}
          onContextMenu={handleContextMenu}
        >
          {showToolLogsToggle && (
            <ToolLogsMasterToggle open={toolLogsOpen} onToggle={() => setToolLogsOpen((v) => !v)} />
          )}
          {leadingThinkingBlocks.length > 0 && (
            <ThinkingSection blocks={leadingThinkingBlocks} streaming={isStreaming} />
          )}
          {activeToolCount > 1 && (
            <div className="parallel-tools-indicator">
              <Icons.Layers size={11} />
              <span>{activeToolCount} 个工具并行执行</span>
            </div>
          )}
          {timelineGroups.length > 0 && (isLatest || contentBlocks.length === 0) && (
            <div className="msg-content">{timelineContent}</div>
          )}
          {timelineGroups.length > 0 && !isLatest && contentBlocks.length > 0 && (
            <CollapsibleContent maxHeight={500} streaming={isStreaming}>
              <div className="msg-content">{timelineContent}</div>
            </CollapsibleContent>
          )}
          {isCancelled && <StoppedMarker />}
          {isFinished && textContent && (
            <MessageHoverBar
              timestamp={timestamp}
              textContent={textContent}
              position="left"
              {...(onDelete ? { onDelete } : {})}
            />
          )}
        </div>
        {isStreaming && (
          <div className="agent-task-running-tag">
            <span>执行任务中</span>
            <span className="agent-task-running-dots">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
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
}, assistantRowsPropsAreEqual)

function ThinkingSection({
  blocks,
  streaming,
  showDoneBadge = true,
}: {
  blocks: Array<Extract<UIBlock, { kind: 'thinking' }>>
  streaming: boolean
  // 绿色对勾只在首个（顶部）思考模块上显示，后续穿插的阶段性思考不重复显示。
  showDoneBadge?: boolean
}) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [needsCollapse, setNeedsCollapse] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 每个 section 至多自动展开一次；用户手动折叠/展开后，后续思考不再自动展开（尊重用户）。
  const autoExpandedRef = useRef(false)
  const userToggledRef = useRef(false)

  const isThinkingActive = streaming && blocks.some((b) => b.isStreaming)

  // 仅首次开始思考时自动展开一次；之后（含多段思考）不再反复自动展开/折叠。
  useEffect(() => {
    if (isThinkingActive && !autoExpandedRef.current && !userToggledRef.current) {
      autoExpandedRef.current = true
      setOpen(true)
    }
  }, [isThinkingActive])

  // 稳定计算是否需要截断：恒按内容高度判断，不再随「思考活跃/结束」在 全高 ↔ 200px 间来回切换，
  // 避免一段一段思考时外层高度反复抖动、内容区跟着跳动。
  useEffect(() => {
    if (!open) return
    const el = contentRef.current
    if (el) setNeedsCollapse(el.scrollHeight > 240)
  }, [blocks, open])

  const isCollapsed = needsCollapse && !expanded

  // 截断态下，流式思考时把内层滚到底，露出最新思考（外层高度仍稳定，不抖动）。
  useEffect(() => {
    if (!isThinkingActive || !isCollapsed) return
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [blocks, isThinkingActive, isCollapsed])

  const handleToggleOpen = () => {
    userToggledRef.current = true
    setOpen((v) => !v)
  }

  return (
    <div
      className={`thinking-section ${open ? 'open' : ''} ${isThinkingActive ? 'is-active' : ''}`}
    >
      <button className="thinking-toggle" onClick={handleToggleOpen}>
        <ActivityLogSummaryIcon icon={Lightbulb} className="thinking-icon" />
        <span className="thinking-label">思考过程</span>
        {isThinkingActive && <Icons.Spinner size={11} className="thinking-spinner" />}
        {!isThinkingActive &&
          showDoneBadge &&
          blocks.length > 0 &&
          blocks.every((b) => !b.isStreaming) && (
            <span className="thinking-done-badge">
              <Icons.Check size={10} />
            </span>
          )}
        <Icons.ChevronRight size={13} className={`chev ${open ? 'chev-open' : ''}`} />
      </button>
      {open && (
        <div className="thinking-body">
          <div
            ref={contentRef}
            className={`thinking-content md-surface ${isCollapsed ? 'is-collapsed' : ''}`}
            style={isCollapsed ? { maxHeight: '240px', overflowY: 'auto' } : undefined}
          >
            {blocks.map((block, i) => (
              <MarkdownText key={i} content={block.content} />
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

function ToolLogsMasterToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // 复用「思考过程」切换条样式（thinking-section / thinking-toggle），文案为「思考和工具日志」，
  // 同时控制本气泡内所有思考过程与工具日志组的显隐；
  // 不带绿色对勾（thinking-done-badge）与 spinner，保留 chevron 箭头按展开状态旋转。
  // 自身也挂 thinking-section，故隐藏规则须用 :not(.tool-logs-master) 排除自身。
  return (
    <div className={`thinking-section tool-logs-master ${open ? 'open' : ''}`}>
      <button className="thinking-toggle" onClick={onToggle} aria-expanded={open}>
        <ActivityLogSummaryIcon icon={Wrench} className="thinking-icon" />
        <span className="thinking-label">思考和工具日志</span>
        <Icons.ChevronRight size={13} className={`chev ${open ? 'chev-open' : ''}`} />
      </button>
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
  autoCollapseReady = true,
  children,
}: {
  name: string
  arg: string
  fullArg?: string
  status?: 'ok' | 'error'
  pending?: boolean
  durationMs?: number | undefined
  autoCollapseReady?: boolean
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
    if (
      autoCollapseReady &&
      (status === 'ok' || status === 'error') &&
      readAppearance().autoCollapseTools
    ) {
      setOpen(false)
    }
  }, [autoCollapseReady, status])

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
        <span className="tool-arg" title={fullArg || arg}>
          {arg}
        </span>
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

function ToolLogGroup({
  blocks,
  surface,
  autoCollapseReady = true,
}: {
  blocks: Array<Extract<UIBlock, { kind: 'tool_call' }> | Extract<UIBlock, { kind: 'terminal' }>>
  surface: 'main' | 'inspector'
  autoCollapseReady?: boolean
}) {
  const running = blocks.some((block) => {
    if (block.kind === 'terminal') return block.isStreaming
    return block.status === 'pending' || block.status === 'running'
  })
  const hasError = blocks.some((block) => {
    if (block.kind === 'terminal')
      return (block.exitCode ?? 0) !== 0 || block.stderr.trim().length > 0
    return block.status === 'error' || Boolean(block.error)
  })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (autoCollapseReady && !running && readAppearance().autoCollapseTools) setOpen(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [autoCollapseReady, running])

  const kind = getToolLogGroupKind(blocks[0] as UIBlock, surface) ?? 'tool'
  const count = blocks.length
  const label =
    kind === 'command'
      ? `执行 ${count} 条命令`
      : kind === 'read'
        ? `查看 ${count} 个文件`
        : kind === 'write'
          ? `修改 ${count} 个文件`
          : `调用 ${count} 个工具`
  const summaryIcon =
    kind === 'command'
      ? SquareTerminal
      : kind === 'read'
        ? FileSearch
        : kind === 'write'
          ? FilePenLine
          : Wrench

  return (
    <div
      className={`tool-log-group ${open ? 'is-open' : ''} ${running ? 'is-running' : ''} ${hasError ? 'is-error' : 'is-success'}`}
    >
      <Button
        className="tool-log-summary"
        type="text"
        size="small"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ActivityLogSummaryIcon
          icon={summaryIcon}
          className={`tool-log-summary-icon tool-log-summary-icon--${kind}`}
        />
        <span>{label}</span>
        {running && <Icons.Spinner size={12} className="tool-status spinner" />}
        {!running && hasError && <Icons.X size={12} className="tool-status err" />}
        {!running && !hasError && <Icons.Check size={12} className="tool-status ok" />}
        <Icons.ChevronRight size={13} className="chev" />
      </Button>
      {open && (
        <div className="tool-log-body">
          {blocks.map((block, index) => (
            <ToolLogEntry key={`${block.kind}-${index}`} block={block} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolLogEntry({
  block,
  index,
}: {
  block: Extract<UIBlock, { kind: 'tool_call' }> | Extract<UIBlock, { kind: 'terminal' }>
  index: number
}) {
  if (block.kind === 'terminal') {
    return (
      <div className="tool-log-entry">
        <ToolLogEntryHead
          icon={<Icons.Terminal size={13} />}
          title="终端"
          subtitle={`#${index + 1}`}
        />
        <div className="tool-log-card">
          {block.stdout && (
            <ToolLogSection label="输出" content={block.stdout} kind="terminal" stream="stdout" />
          )}
          {block.stderr && (
            <ToolLogSection
              label="错误"
              content={block.stderr}
              tone="error"
              kind="terminal"
              stream="stderr"
            />
          )}
          {block.isStreaming && <span className="tool-log-streaming">运行中...</span>}
        </div>
      </div>
    )
  }

  const input = formatToolLogInput(block)
  const output = block.output
  const error = block.error
  const icon = getToolLogIcon(block.toolName)
  const isCommand = isCommandLikeTool(block.toolName)

  return (
    <div className={`tool-log-entry ${block.status === 'error' ? 'is-error' : ''}`}>
      <ToolLogEntryHead
        icon={icon}
        title={block.toolName}
        subtitle={block.durationMs != null ? formatDuration(block.durationMs) : `#${index + 1}`}
      />
      <div className="tool-log-card">
        {input && (
          <ToolLogSection label="输入" content={input} kind={isCommand ? 'terminal' : 'auto'} />
        )}
        {output && (
          <ToolLogSection label="输出" content={output} kind={isCommand ? 'terminal' : 'auto'} />
        )}
        {error && (
          <ToolLogSection
            label="错误"
            content={error}
            tone="error"
            kind={isCommand ? 'terminal' : 'auto'}
          />
        )}
      </div>
    </div>
  )
}

function isCommandLikeTool(name: string): boolean {
  const normalized = normalizeToolName(name)
  return normalized === 'bash' || normalized === 'run_command' || normalized === 'shell'
}

function ToolLogEntryHead({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="tool-log-entry-head">
      <span className="tool-log-entry-icon">{icon}</span>
      <span className="tool-log-entry-title">{title}</span>
      <span className="tool-log-entry-subtitle">{subtitle}</span>
    </div>
  )
}

function ToolLogSection({
  label,
  content,
  tone,
  kind = 'auto',
  stream,
}: {
  label: string
  content: string
  tone?: 'error'
  kind?: 'auto' | 'terminal'
  stream?: 'stdout' | 'stderr'
}) {
  // 命令类工具：终端形态 — 等宽字体、--term-bg/--term-fg 主题色、bash 输入加 $ prompt、
  // stdout 保留原文，stderr 上色。
  if (kind === 'terminal') {
    const isInput = label === '输入'
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    return (
      <div
        className={`tool-log-section tool-log-section--terminal ${tone === 'error' ? 'is-error' : ''}`}
      >
        <div className="tool-log-section-label">{label}</div>
        <div className="tool-log-terminal" data-stream={stream}>
          {lines.map((line, i) => (
            <div key={i} className="tool-log-terminal-line">
              {isInput ? <span className="tool-log-prompt">$</span> : null}
              <span className="tool-log-terminal-text">{line || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 其它工具：先按 markdown 渲染；非 markdown 文本（纯 JSON / 列表）会自然显示成段落。
  return (
    <div className={`tool-log-section ${tone === 'error' ? 'is-error' : ''}`}>
      <div className="tool-log-section-label">{label}</div>
      <div className="tool-log-section-md md-surface">
        <MarkdownText content={content} />
      </div>
    </div>
  )
}

function formatToolLogInput(block: Extract<UIBlock, { kind: 'tool_call' }>): string {
  const isBashLike =
    block.toolName === 'Bash' || block.toolName === 'bash' || block.toolName === 'run_command'
  if (isBashLike && typeof block.toolInput.command === 'string') return block.toolInput.command
  try {
    return JSON.stringify(block.toolInput, null, 2)
  } catch {
    return String(block.toolInput)
  }
}

function getToolLogIcon(name: string): ReactNode {
  const normalized = normalizeToolName(name)
  if (normalized === 'bash' || normalized === 'run_command') return <Icons.BashCommand size={13} />
  if (normalized === 'grep' || normalized === 'grep_files' || normalized.includes('search'))
    return <Icons.Search size={13} />
  if (normalized === 'edit' || normalized === 'edit_file' || normalized === 'apply_patch')
    return <Icons.Edit size={13} />
  if (
    normalized === 'read' ||
    normalized === 'read_file' ||
    normalized === 'write' ||
    normalized === 'write_file'
  )
    return <Icons.File size={13} />
  return <Icons.Wrench size={13} />
}

function TerminalBlock({ children }: { children: ReactNode }) {
  return <div className="terminal mono-sm">{children}</div>
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

function PlanSidePanel({
  session,
  messages,
  proposedPlan,
  onClose,
  onClearProposedPlan,
  onPlanApproved,
}: {
  session: SessionSummary | null
  messages: UIMessage[]
  proposedPlan: { sessionId: SessionId; plan: string } | null
  onClose: () => void
  onClearProposedPlan: () => void
  onPlanApproved: (sessionId: SessionId) => void
}) {
  // 当前待审批/最新计划已经在上方单独展示，历史区要把内容相同的那条剔除，
  // 否则同一份计划会同时出现在「待审批」和「历史计划」两个区块。
  const plans = extractPlans(messages).filter(
    (plan) => proposedPlan == null || plan.rawPlan !== proposedPlan.plan,
  )
  const hasPlan = proposedPlan != null || plans.length > 0
  const isPlanMode = session?.permissionMode === 'claude-plan'

  return (
    <div className="inspector-frame embedded">
      <div className="inspector scroll">
        {proposedPlan != null && isPlanMode && (
          <PlanApprovalPanel
            sessionId={proposedPlan.sessionId}
            plan={proposedPlan.plan}
            onClose={onClearProposedPlan}
            onPlanApproved={onPlanApproved}
          />
        )}

        {proposedPlan != null && !isPlanMode && (
          <div className="inspector-section">
            <h4>最新计划</h4>
            <div className="plan-approval-body md-surface">
              <MarkdownText content={proposedPlan.plan} />
            </div>
          </div>
        )}

        {!hasPlan && (
          <div className="inspector-section">
            <div className="inspector-muted">暂无计划。Agent 生成计划后会自动显示在这里。</div>
          </div>
        )}

        {plans.length > 0 && (
          <div className="inspector-section">
            <h4>历史计划</h4>
            {plans.map((plan) => (
              <PlanSummary key={plan.id} plan={plan} renderMarkdown={MarkdownText} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PlanApprovalPanel({
  sessionId,
  plan,
  onClose,
  onPlanApproved,
}: {
  sessionId: SessionId
  plan: string
  onClose: () => void
  onPlanApproved: (sessionId: SessionId) => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan)
  const [editBuffer, setEditBuffer] = useState(plan)
  const [busy, setBusy] = useState(false)
  const isEdited = draft !== plan

  const approve = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.spark.invoke('session:submit-turn', {
        sessionId,
        message: `批准上述计划。请按如下计划继续执行：\n\n${draft}`,
        permissionMode: 'claude-auto-edits',
        interruptActive: true,
      })
      writeComposerPrefs({ permissionMode: 'claude-auto-edits' })
      onPlanApproved(sessionId)
      toast.success('计划已批准，已切换为自动执行模式')
      onClose()
    } catch (err) {
      toast.error(`批准失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (busy) return
    setBusy(true)
    try {
      // 精准拒绝：后端解除该会话的 plan 审批闸门 + 写入持久化的 plan_rejected 标记
      // （使重开/切换会话后不再弹出已拒绝的计划）。不走 session:cancel，避免其
      // 内部全局 teamDispatchService.cancelAll() 误伤其他会话进行中的 team 协作。
      await window.spark.invoke('session:reject-plan', { sessionId })
    } catch {
      // 后端清理失败不应阻塞前端关闭审批面板
    } finally {
      setBusy(false)
    }
    toast.success('已拒绝计划，未执行')
    onClose()
  }

  return (
    <div className="plan-approval">
      {editing ? (
        <textarea
          className="plan-approval-textarea"
          value={editBuffer}
          onChange={(e) => setEditBuffer(e.target.value)}
          rows={Math.min(24, Math.max(12, editBuffer.split('\n').length + 1))}
          autoFocus
        />
      ) : (
        <div className="plan-approval-body md-surface">
          <MarkdownText content={draft} />
        </div>
      )}
      <div className="plan-approval-foot">
        {!editing && (
          <Button
            type="text"
            size="small"
            danger
            disabled={busy}
            onClick={reject}
            icon={<Icons.X size={14} />}
          >
            拒绝
          </Button>
        )}
        <div className="flex1" />
        {!editing && isEdited && (
          <Button
            type="text"
            size="small"
            disabled={busy}
            icon={<Icons.RotateCcw size={14} />}
            onClick={() => {
              setDraft(plan)
              setEditBuffer(plan)
            }}
          >
            恢复原计划
          </Button>
        )}
        {!editing && (
          <Button
            type="text"
            size="small"
            disabled={busy}
            icon={<Icons.Edit size={14} />}
            onClick={() => {
              setEditBuffer(draft)
              setEditing(true)
            }}
          >
            编辑
          </Button>
        )}
        {editing && (
          <Button type="text" size="small" onClick={() => setEditing(false)}>
            放弃修改
          </Button>
        )}
        {editing && (
          <Button
            type="primary"
            size="small"
            disabled={editBuffer === draft}
            icon={<Icons.Check size={14} />}
            onClick={() => {
              setDraft(editBuffer)
              setEditing(false)
            }}
          >
            保存编辑
          </Button>
        )}
        {!editing && (
          <Button
            type="primary"
            size="small"
            loading={busy}
            onClick={approve}
            icon={<Icons.Check size={14} />}
          >
            {isEdited ? '批准执行' : '批准执行'}
          </Button>
        )}
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

/** Extract a file path from one `diff --git` segment, preferring the new-file header. */
