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
import type { JSX, ReactNode, RefObject } from 'react'
import { Button, Dropdown, Popover, Tag as LobeTag } from '@lobehub/ui'
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
  renderPlanInline,
  SubagentCard,
  Checkpoint,
  SandboxNote,
  QuickActions,
  ToolChooser,
  TurnFileSummaryCard,
} from '../ChatInteractions'
import { Input as LobeInput, TextArea as LobeTextArea } from '@lobehub/ui'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { MarkdownImage } from '../components/MarkdownImage'
import { MarkdownCodeBlock } from '../components/MarkdownCodeBlock'
import {
  ClickableFilePath,
  ClickableUrl,
  extractFilePaths,
  extractUrlsAndEmails,
  type PreviewFileType,
} from '../components/ClickableFilePath'
import { FilePreviewPanel } from '../components/FilePreviewPanel'
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
import { ToolIcon } from '../components/ToolIcon'
import { SidebarExpandButton } from '../SidebarExpandButton'
import { CODING_AGENT_TOOLS } from '../data/available-tools'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useAppearanceSettings, readAppearance } from '../hooks/useAppearance'
import { MessageBuilder } from '../services/event-mapper'
import {
  isComposerSessionWorking,
  resolveComposerRunningAgentIds,
} from '../services/composer-working-state'
import { shouldShowScrollToBottom } from './chat-scroll'
import { getLastAssistantMessageMarkdown, isLocalCopySlashCommand } from './chat-copy'
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
  getUserAvatarConfig,
  hasCustomAvatar,
  resolveAvatarSrc,
} from '../avatar'
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
  SessionGoal,
} from '@spark/protocol'
import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  isBuiltInLocalCliProvider,
  VENDOR_CATALOG,
  type VendorMeta,
} from '@spark/protocol'
import { normalizeEduAssetUrl, resolveProviderContextWindow } from '@spark/shared'
import { ProviderLogo } from '../components/ProviderLogo'

const SETTINGS_GENERAL_KEY = 'spark-settings-general'
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

type BranchState = { currentBranch: string | null; branches: string[] }
type AgentAdapter = SessionAgentAdapter
type PermissionModeChoice = SessionPermissionMode
type ComposerOptionTone = 'default' | 'auto' | 'danger'
type ComposerMenuOption = {
  value: string
  label: string
  description?: string
  icon?: ReactNode
  tone?: ComposerOptionTone
}
type ComposerPrefs = {
  adapter?: AgentAdapter
  providerProfileId?: string
  modelId?: string
  permissionMode?: PermissionModeChoice
  reasoningEffort?: SessionReasoningEffort
  agentId?: string
  /** Team Mode：上次使用的 Host Agent（仅作显式开启团队时的便捷预填，不决定是否启用） */
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
  debugMode?: boolean
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
type ComposerPrefillPayload = {
  text: string
  attachments: MessageAttachment[]
  agentId?: string
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
type ReplyToState = {
  messageId: string
  role: 'user' | 'assistant'
  agentId?: string
  agentName?: string
  contentPreview: string
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
const CHAT_MESSAGE_ESTIMATED_HEIGHT = 180
const CHAT_MESSAGE_OVERSCAN = 8
const EMPTY_PROMPT_LAYER: PromptConfigGetResponse['system'] = { enabled: false, content: '' }

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
 * Cache for AskUserQuestion answers submitted by the user.
 * Keyed by all question texts joined with NUL.
 * Populated when the user clicks Submit in the dock, consumed by
 * InlineQuestionCard as a fallback when the CLI tool_result output
 * can't be parsed into structured answer summaries.
 */
const questionAnswerCache = new Map<
  string,
  Array<{ question: string; answer: string; skipped?: boolean }>
>()

function getQuestionAnswerCacheKey(questions: UserQuestionPrompt[], sessionId?: string): string {
  return `${sessionId ?? 'global'}::${questions.map((q) => q.question).join('\0')}`
}

export function ChatView({
  approvalRequest = null,
  onApprovalClose,
  userQuestion = null,
  onUserQuestionClose,
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
  // 内置终端面板：会话级 dock，按钮在 ChatTabbar 右上。
  // 仅在有活跃会话且绑定 workspace 时启用；切会话会保留各自的 terminals（后端负责）。
  const [showTerminalPanel, setShowTerminalPanel] = useState(false)
  // Codex-like side chat: a second in-project session docked beside the current chat.
  const [showSideChatPanel, setShowSideChatPanel] = useState(false)
  const [sideChatSessionId, setSideChatSessionId] = useState<SessionId | null>(null)
  const [sideChatCreating, setSideChatCreating] = useState(false)
  const [sideChatAgentStatus, setSideChatAgentStatus] = useState('')
  const [sideChatMessages, setSideChatMessages] = useState<UIMessage[]>([])
  const [sideChatContextInputTokens, setSideChatContextInputTokens] = useState(0)
  const [sideChatContextUsage, setSideChatContextUsage] = useState<ContextUsageState | null>(null)
  const [sideChatScrollToBottomTrigger, setSideChatScrollToBottomTrigger] = useState(0)
  // 代码还原点时间线抽屉：把「按会话撤回代码」做成集中可还原视图，按钮在 ChatTabbar 右上。
  const [showCheckpointTimeline, setShowCheckpointTimeline] = useState(false)
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
    }
  }, [agents])
  const [teamConfig, setTeamConfig] = useState<TeamModeConfig>(defaultTeamConfig)
  const updateTeamConfig = useCallback(
    (patch: Partial<TeamModeConfig>) => {
      setTeamConfig((prev) => {
        const next = { ...prev, ...patch }
        // 仅缓存 host/members 作为「下次显式开启团队」时的便捷预填；
        // 不再缓存 enabled —— team 是否启用一律以会话级 metadata 为准（见 defaultTeamConfig）。
        writeComposerPrefs({
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
      setTeamConfig(defaultTeamConfig())
      return
    }
    const res = await listTeamMembers({ sessionId: active as SessionId })
    if (res.config != null) setTeamConfig(res.config)
    else setTeamConfig(defaultTeamConfig())
  }, [active, defaultTeamConfig, listTeamMembers])

  useEffect(() => {
    let cancelled = false
    if (active == null) {
      setTeamConfig(defaultTeamConfig())
      return () => {
        cancelled = true
      }
    }
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
  }, [active, defaultTeamConfig, listTeamMembers])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope !== 'team') return
        if (active == null) {
          setTeamConfig(defaultTeamConfig())
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

  // 进入空白新会话（新建任务 / active 被清空）时，关闭 Inspector / Config 面板，
  // 否则它们会沿用上一个会话的展开态继续遮挡空白聊天区。
  useEffect(() => {
    if (active == null) {
      setShowInspector(false)
      setShowConfigPanel(false)
    }
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
    cacheHitTokens: 0,
    estimatedCostUsd: 0,
    contextWindow: 0,
    turns: [],
  })
  const [contextUsage, setContextUsage] = useState<ContextUsageState | null>(null)
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

  // ── 文件预览状态 ──
  const [filePreview, setFilePreview] = useState<{
    filePath: string
    fileType: PreviewFileType
  } | null>(null)

  // ── IPC hooks (only those NOT duplicated in context) ──
  const { invoke: clearEvents } = useIpcInvoke('session:clear-events')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: cancelSessionTurn } = useIpcInvoke('session:cancel')
  const { invoke: listBranches } = useIpcInvoke('workspace:list-branches')
  const { invoke: switchBranch } = useIpcInvoke('workspace:switch-branch')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: ensureWindowWidth } = useIpcInvoke('window:ensure-width')

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
          (item): item is { question: string; answer: string; skipped?: boolean } => item != null,
        )
      if (summaries.length > 0) {
        questionAnswerCache.set(
          getQuestionAnswerCacheKey(userQuestion.questions, userQuestion.sessionId),
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

  const handleFilePreview = useCallback((filePath: string, fileType: PreviewFileType) => {
    setFilePreview({ filePath, fileType })
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
  const activeProvider = providers.find((item) => item.id === activeSession?.providerProfileId)
  const activeProviderContextWindow = resolveProviderContextWindow(
    activeProvider?.supportsMillionContext === true,
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
    if (activeSessionWorkspace == null) {
      setBranchState({ currentBranch: null, branches: [] })
      return
    }
    let cancelled = false
    listBranches({ workspaceId: activeSessionWorkspace.id })
      .then((res) => {
        if (!cancelled) setBranchState(res)
      })
      .catch(() => {
        if (!cancelled) setBranchState({ currentBranch: null, branches: [] })
      })
    return () => {
      cancelled = true
    }
  }, [activeSessionWorkspace?.id, branchRefreshTick, listBranches])

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

  const ensureChatLayoutFitsWindow = useCallback((allowShrink = false) => {
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
      900,
      Math.ceil(window.innerWidth + desiredLayoutWidth - layout.clientWidth + 8),
    )
    void ensureWindowWidth({ minWidth, allowShrink }).catch(() => {})
  }, [ensureWindowWidth])

  useLayoutEffect(() => {
    const layout = chatLayoutRef.current
    if (layout == null) return
    let rafId = 0
    const scheduleEnsure = () => {
      window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => ensureChatLayoutFitsWindow(true))
    }

    scheduleEnsure()

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleEnsure)
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
            scheduleEnsure()
          })
    mutationObserver?.observe(layout, { childList: true })

    window.addEventListener('resize', scheduleEnsure)
    return () => {
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', scheduleEnsure)
    }
  }, [
    ensureChatLayoutFitsWindow,
    inspectorWidth,
    showConfigPanel,
    showInspector,
    showTerminalPanel,
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
      const reasoning = normalizeComposerReasoningEffort(agent.reasoningEffort) ?? 'medium'
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

  const handleSwitchBranch = async (branch: string) => {
    if (activeSessionWorkspace == null || !branch || branch === branchState.currentBranch) return
    try {
      const res = await switchBranch({ workspaceId: activeSessionWorkspace.id, branch })
      setBranchState(res)
      toast.success(`已切换到 ${res.currentBranch}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换分支失败，请检查是否存在未提交改动')
    }
  }

  const handleReplyTo = useCallback((msg: UIMessage, agentId?: string, agentName?: string) => {
    const preview = extractTextFromBlocks(msg.blocks).slice(0, 80).replace(/\n/g, ' ')
    setReplyTo({
      messageId: msg.id,
      role: msg.role,
      ...(agentId != null ? { agentId } : {}),
      ...(agentName != null ? { agentName } : {}),
      contentPreview: preview || '(附件/图片)',
    })
    setComposerFocusTrigger((n) => n + 1)
  }, [])

  /**
   * 处理用户消息"重发"动作：把文本和附件打包成 resendRequest，
   * ComposerV2 通过 useEffect 监听 requestId 变化把内容写入当前会话草稿并自动 focus。
   */
  const handleResendMessage = useCallback(
    (payload: ComposerPrefillPayload) => {
      setResendRequest((prev) => ({
        requestId: (prev?.requestId ?? 0) + 1,
        payload,
      }))
      // 顺手让输入区获得焦点
      setComposerFocusTrigger((n) => n + 1)
    },
    [],
  )

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
  const sideChatWorkspace = useMemo(() => {
    const workspaceId =
      sideChatSession?.workspaceIds[0] ?? activeSessionWorkspace?.id ?? activeWorkspace?.id
    if (workspaceId == null) return activeSessionWorkspace ?? activeWorkspace
    return (
      workspaces.find((workspace) => workspace.id === workspaceId) ??
      activeSessionWorkspace ??
      activeWorkspace
    )
  }, [activeSessionWorkspace, activeWorkspace, sideChatSession?.workspaceIds, workspaces])
  const createSideChatSession = useCallback(
    async (overrides: Record<string, unknown> = {}) => {
      const workspaceId = activeSessionWorkspace?.id ?? activeWorkspace?.id ?? activeWorkspaceId
      const createdId = await sessionCtx.handleNewSession(workspaceId, {
        activate: false,
        forceNew: true,
        skipRefresh: false,
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
  const openSideChatPanel = useCallback(
    async (options: { replace?: boolean } = {}) => {
      setShowSideChatPanel(true)
      if (sideChatSessionId != null && options.replace !== true) return
      setSideChatCreating(true)
      if (options.replace === true) {
        setSideChatSessionId(null)
        setSideChatMessages([])
      }
      try {
        await createSideChatSession()
      } finally {
        setSideChatCreating(false)
      }
    },
    [createSideChatSession, sideChatSessionId],
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
        onSwitchBranch={handleSwitchBranch}
        onCancelSession={handleCancelSession}
        onSent={handleUserSent}
        showProjectPicker
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
        effectiveHostAgentId={effectiveHostAgentId}
        onChangeTeamConfig={updateTeamConfig}
        onOpenTeamInspector={() => setShowInspector(true)}
        runningTeamAgentIds={runningTeamAgentIds}
        onOpenSkillStore={openSkillStore}
        replyTo={null}
        onDispatchStateChange={setComposerDispatching}
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
        onSwitchBranch={handleSwitchBranch}
        onCancelSession={handleCancelSession}
        onSent={handleUserSent}
        showProjectPicker={showEmptyHero}
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
        effectiveHostAgentId={effectiveHostAgentId}
        onChangeTeamConfig={updateTeamConfig}
        onOpenTeamInspector={() => setShowInspector(true)}
        runningTeamAgentIds={runningTeamAgentIds}
        onOpenSkillStore={openSkillStore}
        replyTo={showEmptyHero ? null : replyTo}
        onClearReply={() => setReplyTo(null)}
        onDispatchStateChange={setComposerDispatching}
      />
    )

  return (
    <div
      className={`chat-layout chat-layout-no-sidebar${teamConfig.enabled ? ' team-mode-active' : ''}`}
      ref={chatLayoutRef}
    >
      <div
        className={`chat-main ${showEmptyHero ? 'chat-main-empty' : 'chat-main-active'}`}
        ref={chatAreaRef}
      >
        {showEmptyHero && (
          <div
            className="chat-sidebar-topbar"
            onDoubleClick={() => {
              window.spark.invoke('window:maximize', {}).catch(() => {})
            }}
          >
            {t.sidebarHidden && <SidebarExpandButton />}
            <div className="chat-sidebar-topbar-actions">
              <button
                className="icon-btn"
                title={activeWorkspace ? '在文件夹中打开' : '请先选择项目文件夹'}
                aria-label="在文件夹中打开"
                disabled={!activeWorkspace}
                onClick={() => {
                  const ws = activeWorkspace
                  if (!ws) return
                  void window.spark
                    .invoke('tool:open-folder', { rootPath: ws.rootPath })
                    .catch((err) => console.error('Failed to open folder:', err))
                }}
              >
                <Icons.FolderOpen size={14} />
              </button>
              <button
                className={`icon-btn ${showTerminalPanel ? 'active' : ''}`}
                title={activeWorkspace ? '内置终端' : '请先选择项目文件夹'}
                aria-label="内置终端"
                disabled={!activeWorkspace}
                onClick={() => setShowTerminalPanel(!showTerminalPanel)}
              >
                <Icons.Terminal size={14} />
              </button>
              <button
                className={`icon-btn ${showSideChatPanel ? 'active' : ''}`}
                title={activeWorkspace ? '侧边聊天' : '请先选择项目文件夹'}
                aria-label="侧边聊天"
                disabled={!activeWorkspace}
                onClick={() => {
                  if (showSideChatPanel) setShowSideChatPanel(false)
                  else void openSideChatPanel()
                }}
              >
                <Icons.Chat size={14} />
              </button>
              <button
                className={`icon-btn ${showInspector ? 'active' : ''}`}
                title="会话检查器"
                aria-label="会话检查器"
                onClick={() => {
                  setShowInspector(!showInspector)
                  if (!showInspector) setShowConfigPanel(false)
                }}
              >
                <Icons.PanelRight />
              </button>
              <button
                className={`icon-btn ${showConfigPanel ? 'active' : ''}`}
                title="配置面板"
                aria-label="配置面板"
                onClick={() => {
                  setShowConfigPanel(!showConfigPanel)
                  if (!showConfigPanel) setShowInspector(false)
                }}
              >
                <Icons.More />
              </button>
            </div>
          </div>
        )}
        {showEmptyHero && <div className="chat-hero-grid" aria-hidden="true" />}
        {showEmptyHero && teamConfig.enabled ? (
          <TeamModeEmptyHero
            agents={agents}
            hostAgentId={effectiveHostAgentId ?? teamConfig.hostAgentId}
            memberAgentIds={teamConfig.memberAgentIds}
            runningAgentIds={runningTeamAgentIds}
            teamName={activeTeamName}
            onOpenTeamInspector={() => {
              setShowInspector(true)
              setShowConfigPanel(false)
            }}
          />
        ) : (
          showEmptyHero && (
            <SingleAgentEmptyHero onSelectPrompt={handleHeroPromptSelect} />
          )
        )}

        {active != null && (
          <Fragment key="active-session-content">
            {!showEmptyHero && (
              <ChatTabbar
                key="chat-tabbar"
                session={activeSession}
                workspace={activeWorkspace}
                agentStatus={agentStatus}
                showInspector={showInspector}
                setShowInspector={(v: boolean) => {
                  setShowInspector(v)
                  if (v) setShowConfigPanel(false)
                }}
                showConfigPanel={showConfigPanel}
                setShowConfigPanel={(v: boolean) => {
                  setShowConfigPanel(v)
                  if (v) setShowInspector(false)
                }}
                showTerminalPanel={showTerminalPanel}
                setShowTerminalPanel={setShowTerminalPanel}
                showSideChatPanel={showSideChatPanel}
                onToggleSideChat={() => {
                  if (showSideChatPanel) setShowSideChatPanel(false)
                  else void openSideChatPanel()
                }}
                showCheckpointTimeline={showCheckpointTimeline}
                setShowCheckpointTimeline={setShowCheckpointTimeline}
                teamConfig={teamConfig}
                effectiveHostAgentId={effectiveHostAgentId}
                agents={agents}
                {...(active ? { onClearMessages: handleClearMessages } : {})}
              />
            )}
            <ChatStream
              key="chat-stream"
              sessionId={active}
              onStatusChange={setAgentStatus}
              onUsageChange={setContextInputTokens}
              onUsageDataChange={setSessionUsageData}
              onMessagesChange={setActiveMessages}
              onSessionStatusChange={handleActiveSessionStatusChange}
              onContextUsageChange={setContextUsage}
              onProjectContextChange={setProjectContext}
              onPlanProposed={(plan) =>
                setProposedPlan(plan == null || active == null ? null : { sessionId: active, plan })
              }
              onTurnPromptSnapshotsChange={setTurnPromptSnapshots}
              clearTrigger={clearTrigger}
              scrollToBottomTrigger={scrollToBottomTrigger}
              teamConfig={teamConfig}
              onFilePreview={handleFilePreview}
              onResendMessage={handleResendMessage}
              onLoadingChange={setActiveSessionLoading}
            />
            {userQuestion != null && (
              <UserQuestionDock
                data={userQuestion}
                onAnswer={handleAnswerQuestion}
                onCancel={handleCancelQuestion}
              />
            )}
          </Fragment>
        )}

        {composerNode}
      </div>

      {showConfigPanel && (
        <ChatConfigPanel
          session={activeSession}
          workspace={activeWorkspace}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          {...(() => {
            const aid = teamConfig.enabled
              ? (effectiveHostAgentId ?? teamConfig.hostAgentId)
              : (activeSession?.agentId ?? undefined)
            return aid != null ? { agentId: aid } : {}
          })()}
        />
      )}

      {showInspector && (
        <ChatInspector
          session={activeSession}
          workspace={activeSessionWorkspace ?? activeWorkspace}
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
          onChangeTeamConfig={handleInspectorChangeConfig}
          onOpenProjectFolder={() => {
            const workspaceToOpen = activeSessionWorkspace ?? activeWorkspace
            if (workspaceToOpen) void sessionCtx.handleOpenProjectFolder(workspaceToOpen)
          }}
        />
      )}

      {showSideChatPanel && (active != null || activeWorkspace != null) && (
        <SideChatPanel
          session={sideChatSession}
          workspaceName={sideChatWorkspace?.name ?? activeWorkspace?.name ?? '当前项目'}
          agentStatus={sideChatAgentStatus}
          creating={sideChatCreating}
          onClose={() => setShowSideChatPanel(false)}
          onNew={() => {
            void openSideChatPanel({ replace: true })
          }}
        >
          {sideChatSessionId != null && sideChatSession != null ? (
            <>
              <ChatStream
                key={`side-chat-stream-${sideChatSessionId}`}
                sessionId={sideChatSessionId}
                onStatusChange={setSideChatAgentStatus}
                onUsageChange={setSideChatContextInputTokens}
                onUsageDataChange={() => {}}
                onMessagesChange={setSideChatMessages}
                onSessionStatusChange={(status) => setSessionStatus(sideChatSessionId, status)}
                onContextUsageChange={setSideChatContextUsage}
                onProjectContextChange={() => {}}
                onPlanProposed={() => {}}
                onTurnPromptSnapshotsChange={() => {}}
                scrollToBottomTrigger={sideChatScrollToBottomTrigger}
                teamConfig={teamConfig}
                onFilePreview={handleFilePreview}
                onLoadingChange={() => {}}
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
                onSwitchBranch={handleSwitchBranch}
                onCancelSession={handleCancelSession}
                onSent={handleSideChatSent}
                showProjectPicker={false}
                workspaces={workspaces}
                activeWorkspaceId={sideChatWorkspace?.id ?? activeWorkspaceId}
                onPickProject={pickProjectFolder}
                onUseNoProject={() => {}}
                onSwitchWorkspace={switchToWorkspace}
                teamConfig={teamConfig}
                effectiveHostAgentId={effectiveHostAgentId}
                onChangeTeamConfig={updateTeamConfig}
                onOpenTeamInspector={() => setShowInspector(true)}
                runningTeamAgentIds={[]}
                onOpenSkillStore={openSkillStore}
                replyTo={null}
              />
            </>
          ) : (
            <div className="side-chat-panel-empty">
              <Icons.Chat size={32} />
              <h3>{sideChatCreating ? '正在创建侧边会话…' : '新的侧边会话'}</h3>
              <p>侧边会话会自动继承当前项目、模型、Agent、权限、推理强度与团队配置。</p>
            </div>
          )}
        </SideChatPanel>
      )}

      {showTerminalPanel &&
        (active != null || activeWorkspace != null) &&
        (() => {
          // 空会话（active == null）下用稳定的伪 sessionId 挂载终端面板，
          // 让 PTY 能正确创建/复用；真实会话存在时仍用真实 sessionId。
          const terminalSessionId = active != null ? active : EMPTY_HERO_TERMINAL_SESSION_ID
          return (
            <BuiltInTerminalPanel
              sessionId={terminalSessionId}
              workspace={activeSessionWorkspace ?? activeWorkspace}
              onClose={() => setShowTerminalPanel(false)}
            />
          )
        })()}

      {proposedPlan != null && active != null && proposedPlan.sessionId === active && (
        <PlanApprovalModal
          sessionId={proposedPlan.sessionId}
          plan={proposedPlan.plan}
          onClose={() => setProposedPlan(null)}
        />
      )}

      {filePreview != null && (
        <FilePreviewPanel
          filePath={filePreview.filePath}
          fileType={filePreview.fileType}
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
      />
    </div>
  )
}

// ─── Tool Dropdown (IDE / Terminal open) ─────────────────────────────────

function getToolIcon(iconHint?: string, kind?: 'ide' | 'terminal', size: number = 18): JSX.Element {
  return <ToolIcon iconHint={iconHint} kind={kind} size={size} />
}

function ToolDropdown({ kind, rootPath }: { kind: 'ide' | 'terminal'; rootPath: string }) {
  const [open, setOpen] = useState(false)
  const [tools, setTools] = useState<ExternalToolInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const isIde = kind === 'ide'
  const FallbackIcon = isIde ? Icons.Code : Icons.Terminal
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
    if (tools.length > 0) return
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
  }, [kind, tools.length])

  const handleSelect = async (tool: ExternalToolInfo) => {
    setOpen(false)
    setSelectedId(tool.id)
    try {
      await window.spark.invoke('tool:open-project', { toolId: tool.id, rootPath })
    } catch (err) {
      console.error(`Failed to open in ${tool.name}:`, err)
    }
  }

  const availableTools = tools.filter((t) => t.available)

  // 触发器图标优先级：用户上次选中的工具 > 当前检测到的第一个可用工具 > 通用兜底
  const triggerTool = availableTools.find((t) => t.id === selectedId) ?? availableTools[0]
  const triggerTitle = triggerTool
    ? `${tooltip}（当前：${triggerTool.name}）`
    : `${tooltip}（未检测到已安装的${isIde ? '编辑器' : '终端'}）`

  return (
    <div className="tool-dropdown-wrap" ref={ref}>
      <button
        className={`icon-btn${open ? ' active' : ''}`}
        title={triggerTitle}
        onClick={() => setOpen((prev) => !prev)}
      >
        {triggerTool ? (
          <span className="tool-dropdown-trigger-icon">
            {getToolIcon(triggerTool.iconHint, triggerTool.kind)}
          </span>
        ) : (
          <FallbackIcon size={14} />
        )}
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

function resolveAgentDisplay(agents: ManagedAgent[], agentId: string | null | undefined) {
  if (agentId == null || agentId.length === 0) return null
  return agents.find((agent) => agent.id === agentId) ?? null
}

type HeroGreetingCopy = {
  title: string
  body: string
}

const SINGLE_AGENT_HERO_ACTIONS = [
  {
    title: '创建 Agent',
    desc: '平台管理Agent · agent-identifier',
    Icon: Icons.Bot,
    prompt:
      '请使用平台管理 Agent 处理，并优先使用 agent-identifier 技能。\n\n我想创建一个新的 Agent。请先询问我这个 Agent 的职责、适用场景、可用工具/权限边界和期望输出风格，然后帮我生成一份可落地的 Agent 配置方案。先不要自动写入或安装，等我确认后再执行。',
  },
  {
    title: '安装 Skill',
    desc: '平台管理Agent · skill-installer',
    Icon: Icons.Skills,
    prompt:
      '请使用平台管理 Agent 处理，并优先使用 skill-installer 技能。\n\n我想安装或配置一个 Skill。请先确认我要增强的能力、目标来源（官方列表或 GitHub 仓库）、安全风险和安装位置，然后给出安装方案。先不要自动安装，等我确认后再执行。',
  },
  {
    title: '检查环境',
    desc: '平台管理Agent · verify',
    Icon: Icons.Shield,
    prompt:
      '请使用平台管理 Agent 处理，并优先使用 verify 技能。\n\n请检查当前工作环境是否可用：项目绑定状态、依赖安装情况、常用脚本、构建/类型检查命令、Git 工作区状态和可能影响执行任务的配置。请先只做检查并汇总结论，不要修改代码。',
  },
] as const

/** 单 Agent 空会话问候：按时段给出正式、稳定的开场语。 */
function getHeroGreeting(): HeroGreetingCopy {
  const h = new Date().getHours()
  if (h < 5) {
    return {
      title: '稳步推进当前任务',
      body: '把目标告诉我，我会先梳理上下文，再给出清晰的执行路径。',
    }
  }
  if (h < 11) {
    return {
      title: '早安，准备开始',
      body: '可以从一个问题、一段代码或一个项目目标开始，我会协助拆解并执行。',
    }
  }
  if (h < 18) {
    return {
      title: '下午好，继续推进',
      body: '我可以接手修改、运行验证，或先帮你把复杂需求整理成可执行步骤。',
    }
  }
  return {
    title: '晚上好，整理下一步',
    body: '适合做代码收尾、环境检查、文档更新，或把明天的任务先规划清楚。',
  }
}

function SingleAgentEmptyHero({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  const greeting = getHeroGreeting()

  return (
    <section className="single-empty-hero" aria-label="空会话欢迎提示">
      <div className="single-empty-copy">
        <h1 className="chat-hero-title single-empty-title">{greeting.title}</h1>
        <p className="single-empty-body">{greeting.body}</p>
      </div>
      <div className="single-empty-actions" aria-label="可尝试的任务类型">
        {SINGLE_AGENT_HERO_ACTIONS.map(({ title, desc, Icon, prompt }) => (
          <button
            key={title}
            type="button"
            className="single-empty-action"
            onClick={() => onSelectPrompt(prompt)}
          >
            <span className="single-empty-action-icon">
              <Icon size={15} />
            </span>
            <span className="single-empty-action-copy">
              <strong>{title}</strong>
              <span>{desc}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function AgentAvatarBadge({
  agent,
  fallbackId,
  className = '',
  running = false,
}: {
  agent: ManagedAgent | null
  fallbackId: string
  className?: string
  running?: boolean
}) {
  const name = agent?.name ?? fallbackId
  const config = getAgentAvatarConfig(agent?.metadata, agent?.id ?? fallbackId, name)
  return (
    <span className={`team-avatar-badge ${running ? 'is-running' : ''} ${className}`}>
      <AvatarImage
        src={resolveAvatarSrc(config)}
        seed={agent?.id ?? fallbackId}
        name={name}
        alt={`${name} 头像`}
      />
      {running && <span className="team-avatar-badge-pulse" aria-hidden="true" />}
    </span>
  )
}

function TeamModeEmptyHero({
  agents,
  hostAgentId,
  memberAgentIds,
  runningAgentIds,
  teamName,
  onOpenTeamInspector,
}: {
  agents: ManagedAgent[]
  hostAgentId: string
  memberAgentIds: string[]
  runningAgentIds: string[]
  /** 已保存团队名（临时团队为 null）；用于标题「<团队名> 已就绪」 */
  teamName?: string | null
  onOpenTeamInspector: () => void
}) {
  const hostAgent = resolveAgentDisplay(agents, hostAgentId)
  const readyTitle =
    teamName != null && teamName.trim().length > 0 ? `${teamName} 已就绪` : '团队已就绪'
  const uniqueMemberIds = memberAgentIds.filter(
    (id, index, list) => id !== hostAgentId && list.indexOf(id) === index,
  )
  const visibleMemberIds = uniqueMemberIds.slice(0, 6)
  const runningSet = new Set(runningAgentIds)
  const memberCount = uniqueMemberIds.length

  return (
    <section className="team-empty-hero" aria-label="团队模式空会话">
      <div className="team-empty-orbit" aria-hidden="true">
        <div className="team-empty-orbit-ring" />
        <div className="team-empty-host">
          <AgentAvatarBadge
            agent={hostAgent}
            fallbackId={hostAgentId || 'platform-manager-agent'}
            className="host"
            running={runningSet.has(hostAgentId)}
          />
          <span className="team-empty-host-label">Host</span>
        </div>
        {visibleMemberIds.map((memberId, index) => {
          const member = resolveAgentDisplay(agents, memberId)
          return (
            <span
              key={memberId}
              className={`team-empty-member member-${index + 1}`}
              style={{ ['--member-index' as string]: index }}
            >
              <AgentAvatarBadge
                agent={member}
                fallbackId={memberId}
                running={runningSet.has(memberId)}
              />
            </span>
          )
        })}
        {memberCount === 0 && (
          <div className="team-empty-member-placeholder">
            <Icons.Plus size={18} />
          </div>
        )}
      </div>
      <div className="team-empty-copy">
        <h1 className="chat-hero-title team-empty-title">{readyTitle}</h1>
        <span className="chat-hero-span team-empty-desc">
          {hostAgent?.name ?? '平台管理'} 将协调成员 Agent 分工、执行和汇总结果
        </span>
        <div className="team-empty-meta">
          <span>Host：{hostAgent?.name ?? '平台管理'}</span>
          <span>成员：{memberCount}</span>
          {runningAgentIds.length > 0 && <span>{runningAgentIds.length} 位成员执行中</span>}
        </div>
        {memberCount === 0 && (
          <button type="button" className="team-empty-action" onClick={onOpenTeamInspector}>
            <Icons.Team size={14} /> 添加团队成员
          </button>
        )}
      </div>
    </section>
  )
}

function SideChatPanel({
  session,
  workspaceName,
  agentStatus,
  creating,
  onClose,
  onNew,
  children,
}: {
  session: SessionSummary | null
  workspaceName: string
  agentStatus: string
  creating: boolean
  onClose: () => void
  onNew: () => void
  children: ReactNode
}) {
  return (
    <aside className="side-chat-panel" aria-label="侧边聊天">
      <div className="side-chat-panel-header">
        <div>
          <div className="side-chat-panel-title">侧边聊天</div>
          <div className="side-chat-panel-subtitle">同项目 · {workspaceName}</div>
        </div>
        <div className="side-chat-panel-header-actions">
          {creating && <span className="side-chat-panel-status">创建中…</span>}
          {!creating && agentStatus && (
            <span className="side-chat-panel-status">{agentStatus}</span>
          )}
          <button className="btn ghost sm" onClick={onNew} disabled={creating}>
            新建侧边会话
          </button>
          <button className="icon-btn" aria-label="关闭侧边聊天" title="关闭" onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
      </div>
      {session != null && (
        <div className="side-chat-panel-meta">
          <span>{session.agentAdapter}</span>
          <span>{session.modelId ?? '默认模型'}</span>
          <span>{session.reasoningEffort}</span>
        </div>
      )}
      <div className="side-chat-panel-content">{children}</div>
    </aside>
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
  showTerminalPanel,
  setShowTerminalPanel,
  showSideChatPanel,
  onToggleSideChat,
  showCheckpointTimeline,
  setShowCheckpointTimeline,
  teamConfig,
  effectiveHostAgentId,
  agents,
  onClearMessages,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  agentStatus: string
  showInspector: boolean
  setShowInspector: (v: boolean) => void
  showConfigPanel: boolean
  setShowConfigPanel: (v: boolean) => void
  showTerminalPanel: boolean
  setShowTerminalPanel: (v: boolean) => void
  showSideChatPanel: boolean
  onToggleSideChat: () => void
  showCheckpointTimeline: boolean
  setShowCheckpointTimeline: (v: boolean) => void
  teamConfig: TeamModeConfig
  effectiveHostAgentId: string | null
  agents: ManagedAgent[]
  onClearMessages?: () => void
}) {
  const { t } = useApp()
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearClick = () => {
    setShowClearConfirm(true)
  }

  const handleClearConfirm = () => {
    setShowClearConfirm(false)
    onClearMessages?.()
  }
  const hostAgent = resolveAgentDisplay(agents, effectiveHostAgentId ?? teamConfig.hostAgentId)
  const memberCount = teamConfig.memberAgentIds.length

  return (
    <div
      className="chat-tabbar"
      onDoubleClick={() => {
        window.spark.invoke('window:maximize', {}).catch(() => {})
      }}
    >
      {t.sidebarHidden && <SidebarExpandButton />}
      <div className="chat-title-block">
        {session ? (
          <>
            <span className="chat-title truncate">{session.title || '新会话'}</span>
            {/* {workspace && (
              <span className="badge">
                <Icons.Folder size={10} /> {workspace.name}
              </span>
            )} */}
            {agentStatus && (
              <span className="msg-running">
                <Icons.Spinner size={11} /> {agentStatus}
              </span>
            )}
            {teamConfig.enabled && (
              <button
                type="button"
                className="chat-team-status-chip"
                onClick={() => setShowInspector(true)}
                title="打开团队成员面板"
              >
                <Icons.Team size={12} />
                <span>团队模式</span>
                <span className="chat-team-status-divider" />
                <span>Host：{hostAgent?.name ?? '平台管理'}</span>
                <span>成员 {memberCount}</span>
              </button>
            )}
          </>
        ) : (
          <span className="chat-title truncate muted">未选择会话</span>
        )}
      </div>
      <div className="row tabbar-actions">
        <button
          className="icon-btn"
          onClick={() => {
            void window.spark.invoke('browser:open-external', {})
          }}
          title="打开默认浏览器"
          aria-label="打开默认浏览器"
        >
          <Icons.Globe size={14} />
        </button>
        {workspace && (
          <>
            <ToolDropdown kind="ide" rootPath={workspace.rootPath} />
            <ToolDropdown kind="terminal" rootPath={workspace.rootPath} />
            <button
              className="icon-btn"
              title="在文件夹中打开"
              onClick={() => {
                void window.spark
                  .invoke('tool:open-folder', { rootPath: workspace.rootPath })
                  .catch((err) => console.error('Failed to open folder:', err))
              }}
            >
              <Icons.FolderOpen size={14} />
            </button>
            <button
              className={`icon-btn ${showTerminalPanel ? 'active' : ''}`}
              title="内置终端"
              aria-label="内置终端"
              onClick={() => setShowTerminalPanel(!showTerminalPanel)}
            >
              <Icons.Terminal size={14} />
            </button>
            <button
              className={`icon-btn ${showSideChatPanel ? 'active' : ''}`}
              title="侧边聊天"
              aria-label="侧边聊天"
              onClick={onToggleSideChat}
            >
              <Icons.Chat size={14} />
            </button>
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
          className={`icon-btn ${showCheckpointTimeline ? 'active' : ''}`}
          title="代码还原点"
          aria-label="代码还原点"
          onClick={() => setShowCheckpointTimeline(!showCheckpointTimeline)}
        >
          <Icons.RotateCcw size={14} />
        </button>
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
  scrollToBottomTrigger,
  teamConfig,
  onReplyTo,
  onFilePreview,
  onResendMessage,
  onLoadingChange,
}: {
  sessionId: SessionId
  onStatusChange: (s: string) => void
  onUsageChange: (tokens: number) => void
  onUsageDataChange: (data: SessionUsageData) => void
  onMessagesChange: (messages: UIMessage[]) => void
  onSessionStatusChange: (status: SessionSummary['status']) => void
  onContextUsageChange: (snapshot: ContextUsageState | null) => void
  onProjectContextChange: (snapshot: ProjectContextState | null) => void
  /** 上报当前会话「待审批计划」状态：有则传 plan 文本，无则传 null（清空，避免切换会话后残留） */
  onPlanProposed: (plan: string | null) => void
  onTurnPromptSnapshotsChange: (snapshots: TurnPromptSnapshotEvent[]) => void
  /** 递增时清空 ChatStream 内部消息状态 */
  clearTrigger?: number
  /** 递增时立即把会话内容区滚到底部（用户发送消息瞬间触发，无需等 user_message 事件回流） */
  scrollToBottomTrigger?: number
  /** 当前会话历史的加载状态变化（用于父级抑制「空会话 hero」误闪） */
  onLoadingChange?: (loading: boolean) => void
  teamConfig: TeamModeConfig
  onReplyTo?: (msg: UIMessage, agentId?: string, agentName?: string) => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  /** 重发：用户消息上"重发"按钮触发，把 blocks+attachments 重新塞回输入区 */
  onResendMessage?: (payload: ComposerPrefillPayload) => void
}) {
  const streamRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [agentIsRunning, setAgentIsRunning] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  // 窗口化加载：是否还有更早历史 + 是否正在加载更早一页（顶部 loading 指示）
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const builderRef = useRef(new MessageBuilder())
  const rafRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  const userScrolledRef = useRef(false)
  const hydratingRef = useRef(false)
  const bufferedEventsRef = useRef<AgentEvent[]>([])
  const historyLoadIdRef = useRef(0)
  // 切换/初始加载后需要把视图强制贴到底部（展示最新消息）；置位后由自动滚动 effect 处理。
  const scrollToBottomPendingRef = useRef(false)
  // 初始贴底完成前，禁止「滚动到顶懒加载更早」触发——否则初次加载 scrollTop≈0 会立刻
  // 触发翻页 + 锚定，把视图一路拉到最早的消息（用户报告的「从最早开始 / 卡住」根因）。
  const initialScrollDoneRef = useRef(false)
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
  const assistantAgentId = teamConfig.enabled
    ? teamConfig.hostAgentId
    : (session?.agentId ?? 'platform-manager-agent')
  const assistantAgent = agents.find((item) => item.id === assistantAgentId)
  const assistantName = assistantAgent?.name ?? 'Spark Agent'
  const assistantAvatar = getAgentAvatarConfig(
    assistantAgent?.metadata,
    assistantAgentId,
    assistantName,
  )
  const assistantAvatarSrc = resolveAvatarSrc(assistantAvatar)

  // ── 历史加载状态 ──
  // loadedEventsRef：当前已加载到内存的历史 + 实时 event；既用于删除消息时同步剔除，
  // 也作为「加载更早」时增量重建消息的唯一数据源。
  const loadedEventsRef = useRef<AgentEvent[]>([])
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
    onProjectContextChange,
    onTurnPromptSnapshotsChange,
    onPlanProposed,
    onLoadingChange,
  })
  viewCallbacksRef.current = {
    onMessagesChange,
    onUsageChange,
    onUsageDataChange,
    onStatusChange,
    onSessionStatusChange,
    onContextUsageChange,
    onProjectContextChange,
    onTurnPromptSnapshotsChange,
    onPlanProposed,
    onLoadingChange,
  }

  /**
   * commitEventsToView — 把一段已加载的 event 窗口构建成消息并渲染。
   * 初始加载 / 加载更早 共用。
   * deriveMeta=true 时同时从 events 派生 usage/status/context/plan（初始加载）；
   * deriveMeta=false 时只重建消息列表，保留实时事件维护的 usage/status（加载更早，
   * 避免把 live 累积的用量/状态覆盖回历史快照）。
   */
  const commitEventsToView = useCallback((events: AgentEvent[], deriveMeta: boolean) => {
    const callbacks = viewCallbacksRef.current
    const builder = new MessageBuilder()
    for (const event of events) builder.processEvent(event)
    builderRef.current = builder
    const nextMessages = builder.getAllMessages()
    setMessages(nextMessages)
    callbacks.onMessagesChange(nextMessages)
    if (!deriveMeta) return nextMessages

    callbacks.onUsageChange(getLatestInputTokens(events))
    const historyUsage = buildUsageDataFromEvents(events)
    usageRef.current = historyUsage
    callbacks.onUsageDataChange(historyUsage)
    const latestStatus = getLatestAgentStatus(events)
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
    callbacks.onProjectContextChange(getLatestProjectContextEvent(events))
    callbacks.onTurnPromptSnapshotsChange(builder.getTurnPromptSnapshots())
    // 历史里若存在未被后续 user_message / agent_status 解决的 plan_proposed
    // （例如 APP_RESTARTED 期间用户没有审批），重新弹出审批弹窗。
    // 始终上报（无 pending 时传 null）：这样切换到「无待审批计划」的会话时能清空
    // 上一个会话残留的审批弹窗，避免弹窗跨会话泄漏。
    callbacks.onPlanProposed(builder.getPendingPlan())
    return nextMessages
  }, [])

  // 切换会话时加载历史：窗口化——只取最新一页，立即展示最近消息并滚到底部（IM 体感），
  // 更早历史在用户向上滚动时按需懒加载。
  useEffect(() => {
    const loadId = historyLoadIdRef.current + 1
    historyLoadIdRef.current = loadId
    hydratingRef.current = true
    bufferedEventsRef.current = []
    loadedEventsRef.current = []
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
    viewCallbacksRef.current.onProjectContextChange(null)
    viewCallbacksRef.current.onTurnPromptSnapshotsChange([])

    loadSessionHistoryPage(getHistory, sessionId)
      .then(({ events: pageEvents, hasMore }) => {
        if (cancelled || historyLoadIdRef.current !== loadId) return
        const events = mergeSessionEvents(pageEvents, bufferedEventsRef.current)
        loadedEventsRef.current = events
        oldestSeqRef.current = events[0]?.seq
        hasMoreHistoryRef.current = hasMore
        setHasMoreHistory(hasMore)
        // 进入会话先展示最新消息：提交后强制贴底（IM 体感）
        scrollToBottomPendingRef.current = true
        commitEventsToView(events, true)
      })
      .catch((err) => {
        console.error('Failed to load session history:', err)
        if (!cancelled && historyLoadIdRef.current === loadId) {
          // 历史加载失败，使用缓冲的 live 事件回退
          const bufferedEvents = bufferedEventsRef.current
          if (bufferedEvents.length > 0) {
            loadedEventsRef.current = [...bufferedEvents]
            scrollToBottomPendingRef.current = true
            commitEventsToView(bufferedEvents, true)
          }
        }
      })
      .finally(() => {
        if (!cancelled && historyLoadIdRef.current === loadId) {
          hydratingRef.current = false
          bufferedEventsRef.current = []
          setIsLoadingHistory(false)
          viewCallbacksRef.current.onLoadingChange?.(false)
        }
      })

    return () => {
      cancelled = true
      if (historyLoadIdRef.current === loadId) {
        hydratingRef.current = false
        bufferedEventsRef.current = []
      }
    }
  }, [getHistory, commitEventsToView, sessionId])

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
        if (olderEvents.length > 0) {
          const merged = mergeSessionEvents(olderEvents, loadedEventsRef.current)
          loadedEventsRef.current = merged
          oldestSeqRef.current = merged[0]?.seq ?? oldestSeqRef.current
          // 只重建消息，保留 live 维护的 usage/status
          commitEventsToView(merged, false)
          // 下一帧（DOM 已更新）按高度增量恢复 scrollTop，保持视觉锚点不动
          requestAnimationFrame(() => {
            const el2 = streamRef.current
            if (el2 != null) {
              el2.scrollTop = prevScrollTop + (el2.scrollHeight - prevScrollHeight)
            }
          })
        }
        hasMoreHistoryRef.current = hasMore
        setHasMoreHistory(hasMore)
      })
      .catch((err) => console.error('Failed to load older history:', err))
      .finally(() => {
        if (historyLoadIdRef.current !== loadIdAtRequest) return
        loadingOlderRef.current = false
        setIsLoadingOlder(false)
      })
  }, [getHistory, commitEventsToView, sessionId])
  // 让滚动处理（[] deps、闭包固定）始终调用到最新的 loadOlderHistory
  useEffect(() => {
    loadOlderRef.current = loadOlderHistory
  }, [loadOlderHistory])

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
    loadedEventsRef.current = []
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
      builderRef.current.processEvent(event)
      // 同步进窗口事件源，保证「加载更早」增量重建时包含实时事件
      loadedEventsRef.current.push(event)

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
        setShowScrollToBottom(false)
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

      // 新用户消息抵达 = 上一个待审批计划已被处理（批准/拒绝后再发言），清空审批弹窗状态。
      if (event.type === 'user_message') {
        onPlanProposed(null)
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
  const showWaitingAgent = agentIsRunning && !hasStreamingMsg

  const handleDeleteMessage = useCallback(
    (msgId: string, eventIds: string[]) => {
      deleteMessageEvents({ sessionId, eventIds })
        .then(() => {
          builderRef.current.removeMessage(msgId)
          // 同步从窗口事件源剔除被删除的 event，避免向上翻页时被重建回来
          if (eventIds.length > 0) {
            const removed = new Set(eventIds)
            loadedEventsRef.current = loadedEventsRef.current.filter((e) => !removed.has(e.id))
          }
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
      if (target == null) return
      userScrolledRef.current = true
      setShowScrollToBottom(true)
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('spark:team-running-agent:scroll', handleScrollToRunningAgent)
    return () => {
      window.removeEventListener('spark:team-running-agent:scroll', handleScrollToRunningAgent)
    }
  }, [])

  return (
    <div className="chat-stream-viewport">
      <div className="chat-stream" ref={streamRef}>
        <div className="chat-stream-inner">
          {isLoadingOlder && (
            <div className="chat-load-older" aria-hidden="true">
              <span className="chat-loading-spinner" />
            </div>
          )}
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
                {...(onReplyTo != null ? { onReply: () => onReplyTo(msg) } : {})}
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
                return (
                  <AssistantMessageRows
                    key={msg.id}
                    sessionId={sessionId}
                    blocks={msg.blocks}
                    messageStatus={msg.status}
                    isLatest={index === messages.length - 1}
                    assistantId={identity.id}
                    assistantName={identity.name}
                    assistantAvatarSrc={identity.avatarSrc}
                    usage={msg.usage}
                    {...(onFilePreview != null ? { onFilePreview } : {})}
                    {...(msg.status === 'streaming' ? { status: 'running' as const } : {})}
                    {...(msg.timestamp != null ? { timestamp: msg.timestamp } : {})}
                    {...(msg.status !== 'streaming'
                      ? { onDelete: () => handleDeleteMessage(msg.id, msg.eventIds) }
                      : {})}
                    {...(onReplyTo != null && msg.status !== 'streaming'
                      ? { onReply: () => onReplyTo(msg, identity.id, identity.name) }
                      : {})}
                  />
                )
              })()
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
  beforeSeq?: number
}) => Promise<{ events: AgentEvent[]; hasMore: boolean }>

/**
 * 窗口化加载的单页大小：按「轮次」分页（而非事件数）。
 * Agentic 会话里一个轮次可能有上千条事件，按事件数会把单个轮次切碎成「一条消息」；
 * 按轮次分页则每页都是完整对话。后端已排除流式 delta 行，单页载荷大幅缩小。
 */
const SESSION_HISTORY_TURN_PAGE = 6

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
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  })
  return { events: res.events, hasMore: res.hasMore }
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
  options: {
    surface?: 'main' | 'inspector'
    sessionId?: SessionId
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
                    onUndo: () => executeCheckpointRestore(sid as SessionId, cpId as string),
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
        return (
          <TeamMemberMessageBlockView
            key={i}
            block={block}
            {...(options.onFilePreview != null ? { onFilePreview: options.onFilePreview } : {})}
          />
        )
      }
      default:
        return null
    }
  })
}

type ToolLogGroupKind = 'read' | 'write' | 'command' | 'tool'

function renderBlocksGrouped(
  blocks: UIBlock[],
  options: {
    surface?: 'main' | 'inspector'
    sessionId?: SessionId
    onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
  } = {},
): ReactNode {
  const surface = options.surface ?? 'main'
  const nodes: ReactNode[] = []
  let batch: Array<
    Extract<UIBlock, { kind: 'tool_call' }> | Extract<UIBlock, { kind: 'terminal' }>
  > = []
  let batchKind: ToolLogGroupKind | null = null

  const flush = (key: string) => {
    if (batch.length === 0) return
    nodes.push(<ToolLogGroup key={key} blocks={batch} surface={surface} />)
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

function getToolLogGroupKind(
  block: UIBlock,
  surface: 'main' | 'inspector',
): ToolLogGroupKind | null {
  if (block.kind === 'terminal') return surface === 'inspector' ? 'command' : null
  if (block.kind !== 'tool_call' || isHiddenTimelineBlock(block)) return null
  const name = normalizeToolName(block.toolName)
  if (name === 'todo_write') return null
  if (
    name === 'bash' ||
    name === 'run_command' ||
    name.includes('shell') ||
    name.includes('terminal')
  ) {
    return 'command'
  }
  if (
    name === 'read' ||
    name === 'read_file' ||
    name === 'grep' ||
    name === 'grep_files' ||
    name === 'list' ||
    name === 'ls' ||
    name.includes('search')
  ) {
    return 'read'
  }
  if (
    name === 'edit' ||
    name === 'edit_file' ||
    name === 'write' ||
    name === 'write_file' ||
    name === 'apply_patch' ||
    name.includes('replace')
  ) {
    return 'write'
  }
  return 'tool'
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
  return (
    <>
      <TeamMemberBubble
        memberAgentId={block.memberAgentId}
        memberName={memberName}
        avatarSrc={resolveAvatarSrc(avatar)}
        running={running}
        onOpenDetail={() => setDrawerOpen(true)}
      >
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

function TeamMemberActivityBlockView({
  memberAgentId,
  blocks,
  running,
  sessionId,
  onFilePreview,
}: {
  memberAgentId: string
  blocks: UIBlock[]
  running: boolean
  sessionId: SessionId
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
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
    const cached = questionAnswerCache.get(cacheKey)
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
            <span style={{ fontSize: 12, color: 'var(--c-dim)' }}>请在底部问答面板中逐题作答</span>
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

type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'incomplete_code'; lang: string; code: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }

export function MarkdownText({
  content,
  isStreaming = false,
  agents,
  onMentionClick,
  onFilePreview,
}: {
  content: string
  isStreaming?: boolean
  agents?: { id: string; name: string }[]
  onMentionClick?: (agentId: string) => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
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
            return (
              <Tag key={index}>
                {renderInlineMarkdown(block.text, agents, onMentionClick, onFilePreview)}
              </Tag>
            )
          }
          case 'paragraph':
            return (
              <p key={index}>
                {renderInlineMarkdown(block.text, agents, onMentionClick, onFilePreview)}
              </p>
            )
          case 'code':
            return (
              <MarkdownCodeBlock
                key={index}
                code={block.code}
                lang={block.lang}
                syntaxHighlight={syntaxHighlight}
              />
            )
          case 'incomplete_code':
            return (
              <MarkdownCodeBlock
                key={index}
                code={block.code}
                lang={block.lang}
                syntaxHighlight={syntaxHighlight}
                incomplete
              />
            )
          case 'quote':
            return (
              <blockquote key={index}>
                {renderInlineMarkdown(block.text, agents, onMentionClick, onFilePreview)}
              </blockquote>
            )
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
                      <input type="checkbox" checked={item.checked} readOnly />
                    )}
                    <span>
                      {renderInlineMarkdown(item.text, agents, onMentionClick, onFilePreview)}
                    </span>
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
                        <th key={headerIndex}>
                          {renderInlineMarkdown(header, agents, onMentionClick, onFilePreview)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.headers.map((_, cellIndex) => (
                          <td key={cellIndex}>
                            {renderInlineMarkdown(
                              row[cellIndex] ?? '',
                              agents,
                              onMentionClick,
                              onFilePreview,
                            )}
                          </td>
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

/** 将纯文本中的 @mention 片段替换为主题色 span；可点击时额外附加 onClick */
function highlightMentions(
  text: string,
  agents?: { id: string; name: string }[],
  onMentionClick?: (agentId: string) => void,
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void,
): ReactNode[] {
  const mentionPattern = /(^|\s)(@[\p{L}\p{N}_\-.]+)/gu
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  const agentMap = agents ? new Map(agents.map((a) => [a.name.toLowerCase(), a.id])) : null
  while ((match = mentionPattern.exec(text)) != null) {
    const prefix = match[1] ?? ''
    const mention = match[2] ?? ''
    const mentionStart = match.index + prefix.length
    if (mentionStart > cursor)
      parts.push(
        ...highlightFilePaths(text.slice(cursor, mentionStart), onFilePreview, `fp-${cursor}`),
      )
    const agentId = agentMap?.get(mention.slice(1).toLowerCase())
    const clickable = onMentionClick != null && agentId != null
    parts.push(
      <span
        key={`mention-${mentionStart}`}
        className={`mention-highlight${clickable ? ' mention-highlight-clickable' : ''}`}
        {...(clickable
          ? {
              role: 'button',
              tabIndex: 0,
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation()
                onMentionClick!(agentId!)
              },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onMentionClick!(agentId!)
                }
              },
            }
          : {})}
      >
        {mention}
      </span>,
    )
    cursor = mentionStart + mention.length
  }
  if (cursor < text.length)
    parts.push(...highlightFilePaths(text.slice(cursor), onFilePreview, `fp-${cursor}`))
  return parts.length > 0 ? parts : [text]
}

/** 识别文本中的文件路径并渲染为可点击链接；非路径段交给 highlightUrls 处理裸 URL/mailto */
function highlightFilePaths(
  text: string,
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void,
  keyPrefix: string = 'fp',
): ReactNode[] {
  const pathParts = extractFilePaths(text)
  if (pathParts.length === 0) return [text]
  // 整段都不是路径 → 直接走 URL 高亮
  if (pathParts.length === 1 && !pathParts[0]!.isPath) {
    return highlightUrls(pathParts[0]!.text, `${keyPrefix}-u`)
  }

  const nodes: ReactNode[] = []
  pathParts.forEach((part, index) => {
    if (!part.isPath) {
      nodes.push(...highlightUrls(part.text, `${keyPrefix}-${index}-u`))
      return
    }
    nodes.push(
      <ClickableFilePath
        key={`${keyPrefix}-${index}`}
        path={part.text}
        {...(onFilePreview != null ? { onPreview: onFilePreview } : {})}
      />,
    )
  })
  return nodes
}

/** 识别裸 URL / www. / mailto，渲染为主题色 <a> */
function highlightUrls(text: string, keyPrefix: string = 'u'): ReactNode[] {
  const parts = extractUrlsAndEmails(text)
  if (parts.length === 0) return [text]
  if (parts.length === 1 && parts[0]!.kind === 'text') return [text]

  return parts.map((part, index) => {
    if (part.kind === 'text') {
      return <span key={`${keyPrefix}-${index}`}>{part.text}</span>
    }
    return <ClickableUrl key={`${keyPrefix}-${index}`} url={part.text} />
  })
}

function renderInlineMarkdown(
  text: string,
  agents?: { id: string; name: string }[],
  onMentionClick?: (agentId: string) => void,
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void,
): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern =
    /(!?\[[^\]]+]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) != null) {
    if (match.index > cursor)
      nodes.push(
        ...highlightMentions(
          text.slice(cursor, match.index),
          agents,
          onMentionClick,
          onFilePreview,
        ),
      )
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
          <a
            key={key}
            className="clickable-url"
            href={link[3] ?? '#'}
            target="_blank"
            rel="noreferrer"
          >
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

  if (cursor < text.length)
    nodes.push(...highlightMentions(text.slice(cursor), agents, onMentionClick, onFilePreview))
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
  onResend,
}: {
  timestamp?: string | undefined
  textContent: string
  position: 'left' | 'right'
  usage?: UIMessage['usage'] | undefined
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
  const showTokenCount = readAppearance().inlineTokenCount && usage != null

  return (
    <div className={`msg-hover-bar msg-hover-${position}`}>
      {time && <span className="msg-hover-time">{time}</span>}
      {showTokenCount && (
        <span className="msg-hover-tokens">{usage.inputTokens + usage.outputTokens} tokens</span>
      )}
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

function TextEditContextMenu({ menu, onClose }: { menu: TextEditMenuState; onClose: () => void }) {
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
    avatarSrc,
    attachments = [],
    onDelete,
    mentionAgentName,
    onReply,
    onResend,
  }: {
    children: ReactNode
    timestamp?: string | undefined
    blocks: UIBlock[]
    avatarSrc: string
    attachments?: MessageAttachment[]
    onDelete?: () => void
    /** 团队模式：用户 @ 指定的 Agent 名称（已解析）；用于显示"→ 已直接由 @X 处理"提示 */
    mentionAgentName?: string | undefined
    onReply?: () => void
    /** 重发：把这条消息的文本+附件重新塞回输入区 */
    onResend?: () => void
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
            if (contextMenu.imageSrc != null)
              void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
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
      if (onReply != null) {
        items.push({
          key: 'reply',
          label: '回复',
          icon: <Icons.CornerUpLeft size={14} />,
          onClick: onReply,
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
    }, [contextMenu, onDelete, onReply, textContent])

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
    return (
      prev.blocks === next.blocks &&
      prev.avatarSrc === next.avatarSrc &&
      prev.attachments === next.attachments &&
      prev.mentionAgentName === next.mentionAgentName &&
      prev.timestamp === next.timestamp
    )
  },
)

function useUserAvatarSrc(): string {
  const readLocal = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_GENERAL_KEY)
      if (raw == null) return resolveAvatarSrc(getUserAvatarConfig(null))
      return resolveAvatarSrc(
        getUserAvatarConfig((JSON.parse(raw) as Record<string, unknown>).userAvatar),
      )
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
        const value =
          res.value != null && typeof res.value === 'object'
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
  usage?: UIMessage['usage'] | undefined
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
    prev.timestamp === next.timestamp &&
    prev.usage === next.usage
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
  usage,
  onDelete,
  onReply,
  onFilePreview,
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
  onReply?: () => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
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
              />
            </div>
          )
        }
        const segmentRunning =
          segmentIsLatest && status === 'running' && isHostActivityRunning(segment.blocks)
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
            running={segmentRunning}
            {...(onFilePreview != null ? { onFilePreview } : {})}
            {...(segmentRunning ? { status: 'running' as const } : {})}
            {...(messageStatus != null ? { messageStatus } : {})}
            {...(timestamp != null ? { timestamp } : {})}
            {...(onDelete != null ? { onDelete } : {})}
            {...(onReply != null ? { onReply } : {})}
          />
        )
      })}
    </>
  )
}, assistantRowsPropsAreEqual)

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
  usage,
  running,
  onDelete,
  onReply,
  onFilePreview,
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
  running?: boolean
  onDelete?: () => void
  onReply?: () => void
  onFilePreview?: (filePath: string, fileType: PreviewFileType) => void
}) {
  const thinkingBlocks = blocks.filter(
    (b): b is Extract<UIBlock, { kind: 'thinking' }> => b.kind === 'thinking',
  )
  const contentBlocks = blocks.filter(
    (b) =>
      b.kind !== 'thinking' &&
      b.kind !== 'error' &&
      b.kind !== 'terminal' &&
      !isHiddenTimelineBlock(b),
  )
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
          if (contextMenu.imageSrc != null)
            void copyImageFromSrc(contextMenu.imageSrc).catch(() => {})
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
    if (onReply != null) {
      items.push({
        key: 'reply',
        label: '回复',
        icon: <Icons.CornerUpLeft size={14} />,
        onClick: onReply,
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
  }, [contextMenu, onDelete, onReply, textContent])

  return (
    <div
      className={`msg msg-agent ${isCancelled ? 'is-cancelled' : ''} ${isPureError ? 'is-error' : ''}`}
      data-running-agent-id={assistantId}
      data-running={running === true ? 'true' : 'false'}
    >
      <div className="msg-agent-avatar">
        <AvatarImage src={assistantAvatarSrc} seed={assistantId} name={assistantName} />
      </div>
      <div className="msg-agent-main">
        <div className="msg-agent-head">
          <span className="msg-agent-name">{assistantName}</span>
        </div>
        <div className="msg-bubble msg-bubble-agent" onContextMenu={handleContextMenu}>
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
            <div className="msg-content">
              {renderBlocksGrouped(
                contentBlocks,
                onFilePreview != null ? { sessionId, onFilePreview } : { sessionId },
              )}
            </div>
          )}
          {contentBlocks.length > 0 && !isLatest && (
            <CollapsibleContent maxHeight={500} streaming={isStreaming}>
              <div className="msg-content">
                {renderBlocksGrouped(
                  contentBlocks,
                  onFilePreview != null ? { sessionId, onFilePreview } : { sessionId },
                )}
              </div>
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
}: {
  blocks: Array<Extract<UIBlock, { kind: 'thinking' }>>
  streaming: boolean
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
            style={isCollapsed ? { maxHeight: '240px', overflowY: 'auto' } : undefined}
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
}: {
  blocks: Array<Extract<UIBlock, { kind: 'tool_call' }> | Extract<UIBlock, { kind: 'terminal' }>>
  surface: 'main' | 'inspector'
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
      if (!running && readAppearance().autoCollapseTools) setOpen(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [running])

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
  const Icon =
    kind === 'command'
      ? Icons.BashCommand
      : kind === 'read'
        ? Icons.File
        : kind === 'write'
          ? Icons.Edit
          : Icons.Wrench

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
        <Icon size={13} className="tool-log-summary-icon" />
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
          {block.stdout && <ToolLogSection label="输出" content={block.stdout} />}
          {block.stderr && <ToolLogSection label="错误" content={block.stderr} tone="error" />}
          {block.isStreaming && <span className="tool-log-streaming">运行中...</span>}
        </div>
      </div>
    )
  }

  const input = formatToolLogInput(block)
  const output = block.output
  const error = block.error
  const icon = getToolLogIcon(block.toolName)

  return (
    <div className={`tool-log-entry ${block.status === 'error' ? 'is-error' : ''}`}>
      <ToolLogEntryHead
        icon={icon}
        title={block.toolName}
        subtitle={block.durationMs != null ? formatDuration(block.durationMs) : `#${index + 1}`}
      />
      <div className="tool-log-card">
        {input && <ToolLogSection label="输入" content={input} />}
        {output && <ToolLogSection label="输出" content={output} />}
        {error && <ToolLogSection label="错误" content={error} tone="error" />}
      </div>
    </div>
  )
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
}: {
  label: string
  content: string
  tone?: 'error'
}) {
  return (
    <div className={`tool-log-section ${tone === 'error' ? 'is-error' : ''}`}>
      <div className="tool-log-section-label">{label}</div>
      <pre>{content}</pre>
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
      const message = `批准上述计划。请按如下计划继续执行：\n\n${planText}`
      // 「先终止挂起的 plan turn，再发送批准消息」两步式（取代以往单次 send-turn + interruptActive）：
      // plan turn 在 plan 模式下卡在 ExitPlanMode 权限闸门、仍占用 activeLoops；若在同一次 send-turn
      // 里中断+起跑，旧 SDK query 尚未拆卸完，新 turn 会被入队、表现为「卡住，需手动结束会话才发出」。
      // 这里先 await session:cancel 让循环/权限闸门彻底释放并置 idle，再普通 send-turn——
      // 目标会话已 idle，新 turn 立即起跑。await 保证两步有序，规避时序竞态。
      await window.spark.invoke('session:cancel', { sessionId })
      await window.spark.invoke('session:send-turn', {
        sessionId,
        message,
        permissionMode: 'claude-auto',
      })
      toast.success('计划已批准，已切换为 auto 模式继续执行')
      onClose()
    } catch (err) {
      toast.error(`批准失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // 拒绝/取消：清理 pendingPlanApprovals 闸门，让用户可以在 composer 继续补充对话。
  // session:cancel 会清理 pendingPlanApprovals 和 activeLoops，让后端状态恢复正常。
  // 用户可以继续输入新消息，可能会再次触发 plan 模式生成新计划。
  const reject = async () => {
    if (busy) return
    try {
      // 清理后端状态：删除 pendingPlanApprovals，让队列可以继续推进
      await window.spark.invoke('session:cancel', { sessionId })
    } catch {
      /* 非关键路径，忽略 */
    }
    onClose()
  }

  return (
    // 背景遮罩不响应点击：防止误触关闭丢失审批弹窗。
    // 关闭只能通过下方"拒绝"按钮。
    <div className="modal-backdrop">
      <div className="modal plan-approval-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon">
            <Icons.Check size={16} />
          </div>
          <div>
            <div className="modal-title">
              计划已就绪，等待你审批
              {isEdited && !editing && <span className="plan-approval-edited-badge">已编辑</span>}
            </div>
            <div className="modal-subtitle">
              {editing
                ? '编辑模式 · 修改后点"保存编辑"暂存，可反复编辑后再批准'
                : 'Plan 模式 · 批准后会自动切换为 auto-edits 模式继续执行'}
            </div>
          </div>
        </div>
        <div className="modal-body">
          {editing ? (
            <textarea
              className="plan-approval-textarea"
              value={editBuffer}
              onChange={(e) => setEditBuffer(e.target.value)}
              rows={Math.min(24, Math.max(12, editBuffer.split('\n').length + 1))}
              autoFocus
            />
          ) : (
            <div className="plan-approval-preview md-surface">
              <MarkdownText content={draft} />
            </div>
          )}
        </div>
        <div className="modal-foot plan-approval-foot">
          {!editing && (
            <button className="btn ghost" disabled={busy} onClick={reject}>
              拒绝
            </button>
          )}
          <div className="flex1" />
          {!editing && isEdited && (
            <button className="btn ghost" disabled={busy} onClick={resetDraft}>
              恢复原计划
            </button>
          )}
          {!editing && (
            <button className="btn" disabled={busy} onClick={startEditing}>
              <Icons.Edit size={12} /> {isEdited ? '继续编辑' : '编辑计划'}
            </button>
          )}
          {editing && (
            <button className="btn ghost" onClick={discardEdit}>
              放弃修改
            </button>
          )}
          {editing && (
            <button className="btn" disabled={editBuffer === draft} onClick={saveEdit}>
              <Icons.Check size={12} /> 保存编辑
            </button>
          )}
          {!editing && (
            <button className="btn primary" disabled={busy} onClick={approve}>
              {isEdited ? '批准（用编辑后）并自动执行' : '批准并自动执行'}
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
    if (
      isDiffMode &&
      line.trim() &&
      !line.startsWith('diff') &&
      !line.startsWith('index') &&
      !line.startsWith('---') &&
      !line.startsWith('+++') &&
      !line.startsWith('@@') &&
      !line.startsWith('+') &&
      !line.startsWith('-') &&
      !line.startsWith(' ')
    ) {
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
  const isGitDiff =
    content.includes('diff --git') || content.includes('@@') || content.match(/^[\+\-]/m)

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
  messages,
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
  effectiveHostAgentId,
  onChangeTeamConfig,
  onOpenTeamInspector,
  runningTeamAgentIds = [],
  onOpenSkillStore,
  replyTo,
  onClearReply,
  focusTrigger = 0,
  resendRequest = null,
  onDispatchStateChange,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  providers: ProviderProfile[]
  agents: ManagedAgent[]
  selectedProviderId: string
  setSelectedProviderId: (providerId: string) => void
  teamConfig: TeamModeConfig
  /** 团队模式下解析后的 host agent id（用于 sendTurn 指派） */
  effectiveHostAgentId: string | null
  onChangeTeamConfig: (patch: Partial<TeamModeConfig>) => void
  onOpenTeamInspector: () => void
  onOpenSkillStore: (tab: 'installed' | 'create') => void
  runningTeamAgentIds?: string[]
  branchState: BranchState
  contextInputTokens: number
  contextUsage: ContextUsageState | null
  isWorking: boolean
  messages: UIMessage[]
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
    createWorktree?: boolean
    worktreeBranch?: string
    worktreeTaskText?: string
    // 团队模式下创建会话：把 team 配置随创建一并落库（在 setActive→reload 之前），
    // 避免新建团队会话在「创建到首发持久化」之间被回退逻辑误判成单 agent。
    teamConfig?: TeamModeConfig
  }) => Promise<SessionId | null>
  onUpdateSession: (patch: {
    providerProfileId?: string
    modelId?: string | null
    agentId?: string
    agentAdapter?: AgentAdapter
    permissionMode?: PermissionModeChoice
    chatMode?: SessionChatMode
    reasoningEffort?: SessionReasoningEffort
    debugMode?: boolean
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
  // Reply-to quote bar
  replyTo?: ReplyToState | null
  onClearReply?: () => void
  // Resend request: when requestId changes, write text+attachments into current draft
  resendRequest?: {
    requestId: number
    payload: ComposerPrefillPayload
  } | null
  // 暴露发送中状态给父组件。父组件用它在发送期间抑制 hero，
  // 覆盖 createSession→sendTurn→status=running 之间 hero 闪现的窗口。
  onDispatchStateChange?: (dispatching: boolean) => void
}) {
  const { toast } = useToast()
  const initialPrefsRef = useRef<ComposerPrefs | null>(null)
  if (initialPrefsRef.current == null) initialPrefsRef.current = readComposerPrefs()
  const initialPrefs = initialPrefsRef.current
  const [drafts, setDrafts] = useState<Record<string, ComposerDraftSnapshot>>(() =>
    readComposerDrafts(),
  )
  const [sending, setSending] = useState(false)
  useEffect(() => {
    onDispatchStateChange?.(sending)
  }, [sending, onDispatchStateChange])
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [queueVisible, setQueueVisible] = useState(true)
  // 「为本会话创建隔离 worktree」开关（新会话或尚无消息的空会话、且 git 项目可用）
  const [createWorktree, setCreateWorktree] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const isGitWorkspace = branchState.currentBranch != null
  // 无活跃会话（hero）或活跃会话尚无消息（如从项目「+」新建的空会话）时，
  // 允许勾选 worktree——worktree 必须在会话产生消息前绑定。
  const isNewSessionComposer = session == null || session.messageCount === 0
  // worktree 开关不缓存：切换会话时重置，避免上一次勾选被带入下一个新会话
  useEffect(() => {
    setCreateWorktree(false)
    setWorktreeBranch('')
  }, [session?.id])
  const [slashCmds, setSlashCmds] = useState<CommandListItem[]>([])
  const [slashFilter, setSlashFilter] = useState('')
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashListRef = useRef<HTMLDivElement | null>(null)
  const [draftAdapter, setDraftAdapter] = useState<AgentAdapter>(
    initialPrefs.adapter ?? DEFAULT_AGENT_ADAPTER,
  )
  const [draftAgentId, setDraftAgentId] = useState(initialPrefs.agentId ?? 'platform-manager-agent')
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
  // 调试模式开关（per-session）。刻意不从全局 composer-prefs 继承——它是逐会话 opt-in 的
  // 能力开关，不该被「上次用过」粘到每个新会话上。
  const [draftDebugMode, setDraftDebugMode] = useState<boolean>(false)
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
  const [pendingMention, setPendingMention] = useState<{ agentId: string; name: string } | null>(
    null,
  )
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
  const { invoke: writeClipboardText } = useIpcInvoke('clipboard:write-text')
  const pendingRuntimePatchRef = useRef<SessionRuntimePatch>({})

  const effectiveAgentId = session?.agentId ?? draftAgentId
  const activeAgent =
    agents.find((agent) => agent.id === effectiveAgentId) ??
    agents.find((agent) => agent.id === 'platform-manager-agent') ??
    null
  const adapter = session?.agentAdapter ?? draftAdapter
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
  const providerDefaultModel = getProviderDefaultModel(selectedProvider, modelOptions[0])
  const sessionModelId = normalizeModelForProvider(session?.modelId, selectedProvider)
  const draftModelForProvider = normalizeModelForProvider(draftModelId, selectedProvider)
  const effectiveModelId =
    selectedProvider != null && isLocalCliProvider(selectedProvider)
      ? getProviderDefaultModel(selectedProvider)
      : session != null
        ? sessionModelId || providerDefaultModel
        : draftModelForProvider || providerDefaultModel
  const effectiveMode = session?.chatMode ?? draftMode
  const effectiveReasoning = session?.reasoningEffort ?? draftReasoning
  const effectiveDebugMode = session?.debugMode ?? draftDebugMode
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
  const draftBucketKey = session?.id ?? 'draft:new'
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
  const composerPlaceholder = teamConfig.enabled
    ? '描述任务，Host 会协调团队成员分工完成…  ↵ 发送'
    : '询问、修改、运行任务…  ↵ 发送'
  // 发送前置条件：用户输入了内容、供应商 + 模型已选好。
  // session / workspace 不在这里卡—— handleNewSession 内部对 null 做了 no-project fallback，
  // 真正发送时再做详细校验（toast 提示）
  const canSubmit =
    (value.trim().length > 0 || attachments.length > 0) &&
    selectedProvider != null &&
    effectiveModelId.length > 0
  const showTaskQueue = queuedMessages.length > 0
  const runningTeamAgents = useMemo(() => {
    const uniqueIds = resolveComposerRunningAgentIds({
      teamEnabled: teamConfig.enabled,
      runningAgentIds: runningTeamAgentIds,
      isWorking,
      fallbackAgentId: activeAgent?.id ?? null,
    })
    return uniqueIds.map((id) => {
      const agent = agents.find((item) => item.id === id)
      return { id, name: agent?.name ?? id }
    })
  }, [activeAgent, agents, isWorking, runningTeamAgentIds, teamConfig.enabled])
  const visibleRunningTeamAgents = runningTeamAgents.slice(0, 3)
  const hiddenRunningTeamAgentCount = Math.max(
    0,
    runningTeamAgents.length - visibleRunningTeamAgents.length,
  )
  const handleRunningAgentTagClick = useCallback((agentId: string) => {
    window.dispatchEvent(
      new CustomEvent('spark:team-running-agent:scroll', {
        detail: { agentId },
      }),
    )
  }, [])

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

  const setValue = useCallback(
    (next: React.SetStateAction<string>) => {
      updateDraft((draft) => ({
        ...draft,
        value: typeof next === 'function' ? next(draft.value) : next,
      }))
    },
    [updateDraft],
  )

  const setAttachments = useCallback(
    (next: React.SetStateAction<ComposerAttachment[]>) => {
      updateDraft((draft) => ({
        ...draft,
        attachments: typeof next === 'function' ? next(draft.attachments) : next,
      }))
    },
    [updateDraft],
  )

  const setManualExpanded = useCallback(
    (next: React.SetStateAction<boolean>) => {
      updateDraft((draft) => ({
        ...draft,
        manualExpanded: typeof next === 'function' ? next(draft.manualExpanded) : next,
      }))
    },
    [updateDraft],
  )

  const clearDraftBuckets = useCallback((keys: Array<string | null | undefined>) => {
    const uniqueKeys = Array.from(new Set(keys.filter((key): key is string => !!key)))
    if (uniqueKeys.length === 0) return
    setDrafts((current) => {
      let changed = false
      const next = { ...current }
      for (const key of uniqueKeys) {
        const existing = next[key]
        if (existing != null && (existing.value !== '' || existing.attachments.length > 0)) {
          next[key] = { ...existing, value: '', attachments: [] }
          changed = true
        }
      }
      if (!changed) return current
      writeComposerDrafts(next)
      return next
    })
  }, [])

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
            const nextModel = getProviderDefaultModel(
              fallbackProvider,
              fallbackProvider.modelIds[0],
            )
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
    const nextModel = getProviderDefaultModel(fallbackProvider, fallbackProvider.modelIds[0])
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

  // 监听 SessionSidebarContext.handleNewSession 派发的 'spark:composer:reset-draft' 事件：
  // 当用户「新建会话」（含复用未使用会话）时，清空目标会话与 'draft:new' 桶的输入草稿，
  // 防止此前未发送的输入内容残留在新会话的输入框中。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail ?? {}
      const targetId = detail.sessionId
      setDrafts((current) => {
        const next: Record<string, ComposerDraftSnapshot> = { ...current }
        let changed = false
        if (targetId != null && next[targetId] != null) {
          next[targetId] = { ...next[targetId], value: '', attachments: [] }
          changed = true
        }
        if (next['draft:new'] != null) {
          next['draft:new'] = { ...next['draft:new'], value: '', attachments: [] }
          changed = true
        }
        if (!changed) return current
        writeComposerDrafts(next)
        return next
      })
    }
    window.addEventListener('spark:composer:reset-draft', handler)
    return () => window.removeEventListener('spark:composer:reset-draft', handler)
  }, [])

  useEffect(() => {
    return window.spark.on('stream:session:queue-changed', (snapshot) => {
      applyQueueState(snapshot)
    })
  }, [applyQueueState])

  useEffect(() => {
    if (selectedProvider != null && !draftModelId) {
      setDraftModelId(getProviderDefaultModel(selectedProvider, selectedProvider.modelIds[0]))
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

    // 滚动条统一交给 CSS（views.css 中 .composer textarea 用 scrollbar-width:none 隐藏滚动条，
    // 但滚动能力保留），这里不要再去切换 overflowY，避免 inline style 跟 CSS 互相覆盖
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
    async (
      text: string,
      turnAttachments: ComposerAttachment[],
      replySnapshot?: ReplyToState | null,
    ) => {
      const requestAttachments = toSessionAttachments(turnAttachments)
      // 斜杠命令拦截：以 / 开头的消息走 command:execute
      if (text.startsWith('/')) {
        if (isLocalCopySlashCommand(text)) {
          const markdown = getLastAssistantMessageMarkdown(messages)
          if (markdown == null) {
            toast.error('没有可复制的上一条 Assistant 消息。')
            setValue(text)
            return
          }
          setSending(true)
          try {
            await writeClipboardText({ text: markdown })
            toast.success('已复制上一条 Assistant 消息。')
            clearDraftBuckets([draftBucketKey, session?.id, 'draft:new'])
          } catch (err) {
            console.error('复制上一条 Assistant 消息失败', err)
            toast.error(err instanceof Error ? err.message : '复制失败')
            setValue(text)
          } finally {
            setSending(false)
          }
          return
        }
        setSending(true)
        try {
          // 如果没有活跃 session，先创建一个（命令需要 session 上下文）。
          // 勾选 worktree 时不复用现有空会话——需新建一个绑定 worktree 的会话。
          let sessionId = createWorktree ? null : (session?.id ?? null)
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
              ...(teamConfig.enabled ? { teamConfig } : {}),
              ...(createWorktree
                ? {
                    createWorktree: true,
                    worktreeTaskText: text,
                    ...(worktreeBranch.trim() ? { worktreeBranch: worktreeBranch.trim() } : {}),
                  }
                : {}),
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
              ...(teamConfig.enabled && effectiveHostAgentId != null
                ? { teamConfig, agentId: effectiveHostAgentId }
                : {}),
              ...(teamConfig.enabled &&
              pendingMention != null &&
              text.includes(`@${pendingMention.name}`) &&
              pendingMention.agentId !== effectiveHostAgentId
                ? { mentionAgentId: pendingMention.agentId }
                : {}),
              ...(replySnapshot?.agentId != null ? { mentionAgentId: replySnapshot.agentId } : {}),
            })
            if (!sendRes.started) {
              setQueueVisible(true)
              toast.info('上一条任务仍在执行，消息已加入队列。')
            } else if (queuedMessages.length === 0) {
              setQueueVisible(false)
            }
            await refreshQueueState(sessionId)
            clearDraftBuckets([draftBucketKey, sessionId, 'draft:new'])
            onSent(sessionId)
            return
          }
          // 命令结果已通过事件流注入到聊天中，无需 Toast
          if (res.session != null) onCommandComplete(res.session)
          await refreshQueueState(sessionId)
          if (res.started === true) {
            clearDraftBuckets([draftBucketKey, sessionId, 'draft:new'])
            onSent(sessionId)
          }
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
        // 勾选 worktree 时不复用现有空会话——需新建一个绑定 worktree 的会话。
        let targetSessionId = createWorktree ? null : (session?.id ?? null)
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
            ...(teamConfig.enabled ? { teamConfig } : {}),
            ...(createWorktree
              ? {
                  createWorktree: true,
                  worktreeTaskText: text,
                  ...(worktreeBranch.trim() ? { worktreeBranch: worktreeBranch.trim() } : {}),
                }
              : {}),
          })
        }
        if (targetSessionId == null) throw new Error('请先选择项目并配置供应商')
        await flushPendingRuntimePatch()
        const res = await sendTurn({
          sessionId: targetSessionId,
          message: text,
          ...(requestAttachments.length > 0 ? { attachments: requestAttachments } : {}),
          ...getCurrentRuntimePatch(),
          ...(teamConfig.enabled && effectiveHostAgentId != null
            ? { teamConfig, agentId: effectiveHostAgentId }
            : {}),
          ...(teamConfig.enabled &&
          pendingMention != null &&
          text.includes(`@${pendingMention.name}`) &&
          pendingMention.agentId !== effectiveHostAgentId
            ? { mentionAgentId: pendingMention.agentId }
            : {}),
          ...(replySnapshot?.agentId != null ? { mentionAgentId: replySnapshot.agentId } : {}),
        })
        if (!res.started) {
          setQueueVisible(true)
          toast.info('上一条任务仍在执行，消息已加入队列。')
        } else if (queuedMessages.length === 0) {
          setQueueVisible(false)
        }
        await refreshQueueState(targetSessionId)
        clearDraftBuckets([draftBucketKey, targetSessionId, 'draft:new'])
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
      effectiveHostAgentId,
      clearDraftBuckets,
      draftBucketKey,
      flushPendingRuntimePatch,
      getCurrentRuntimePatch,
      onCreateSession,
      onCommandComplete,
      onSent,
      refreshQueueState,
      selectedProvider,
      messages,
      writeClipboardText,
      sendTurn,
      session?.id,
      createWorktree,
      worktreeBranch,
      setAttachments,
      setValue,
      teamConfig,
      toast,
      pendingMention,
    ],
  )

  const appendAttachments = useCallback(
    (nextAttachments: ComposerAttachment[]) => {
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
    },
    [setAttachments, toast],
  )

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
    const rawText = value.trim() || '请查看附件。'
    const turnAttachments = attachments
    // Prepend reply context if quoting a message
    let text = rawText
    const replySnapshot = replyTo
    if (replySnapshot != null) {
      const quotedLine = replySnapshot.contentPreview.replace(/\n/g, ' ')
      const who = replySnapshot.role === 'assistant' ? (replySnapshot.agentName ?? 'Agent') : 'You'
      text = `[回复 ${who}: ${quotedLine}]\n${rawText}`
    }
    // Record to input history (deduplicate consecutive identical entries)
    const history = sentHistoryRef.current
    if (rawText !== history[history.length - 1]) {
      history.push(rawText)
    }
    historyIndexRef.current = -1
    historyDraftRef.current = ''
    setValue('')
    setAttachments([])
    // 发送后清除 pending mention（避免下一条消息误带）；dispatchMessage 内已通过 text 计算用过
    setPendingMention(null)
    if (replySnapshot != null) onClearReply?.()
    await dispatchMessage(text, turnAttachments, replySnapshot)
  }

  const handlePrimaryAction = async () => {
    if (isWorking) {
      await handleCancelActiveSession()
      return
    }
    await handleSend()
  }

  /**
   * 把 `@<技能名> ` 插入到输入框当前光标位置（来自 ComposerActionsMenu 弹窗中的技能选择）。
   * 不走团队模式的 @agent mention 状态机——技能没有 agentId，只是纯文本提示。
   */
  const handleInsertSkillMention = useCallback(
    (skill: { name: string }) => {
      const el = textareaRef.current
      const current = value
      const caret = el?.selectionStart ?? current.length
      const end = el?.selectionEnd ?? caret
      const insertText = `@${skill.name} `
      const before = current.slice(0, caret)
      const after = current.slice(end)
      const nextValue = `${before}${insertText}${after}`
      setValue(nextValue)
      setTextEditMenu(null)
      // 把光标移到 mention 后
      requestAnimationFrame(() => {
        const el2 = textareaRef.current
        if (el2 == null) return
        const caretPos = before.length + insertText.length
        el2.focus()
        el2.setSelectionRange(caretPos, caretPos)
      })
    },
    [value, setValue, setTextEditMenu],
  )

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
      const top =
        taRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop + markerRect.height + 4
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
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const history = sentHistoryRef.current
      if (history.length === 0) return // let native cursor movement work

      const el = textareaRef.current
      const atStart = el != null && el.selectionStart === 0 && el.selectionEnd === 0
      const atEnd =
        el != null && el.selectionStart === el.value.length && el.selectionEnd === el.value.length

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
    const nextModel = getProviderDefaultModel(provider, provider.modelIds[0])
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
      getProviderDefaultModel(provider, provider.modelIds[0]) ||
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
      const nextModel = getProviderDefaultModel(nextProvider, nextProvider.modelIds[0])
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

  // 把会话运行时（适配器/供应商/模型/权限/推理强度）同步到指定 agent 的配置。
  // 单 agent 切换、以及团队模式下主持人变化（开启团队/切换主持人/应用已保存团队）都复用它，
  // 确保「会话用哪个适配器和模型」始终跟随当前活跃 agent（团队模式即主持人）。
  const applyAgentRuntime = async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId)
    if (agent == null) return
    const agentReasoning = normalizeComposerReasoningEffort(agent.reasoningEffort) ?? 'medium'
    setDraftAgentId(agent.id)
    setDraftAdapter(agent.agentAdapter)
    setDraftPermissionMode(agent.permissionMode)
    setDraftReasoning(agentReasoning)

    const provider =
      providers.find((item) => item.id === agent.providerProfileId) ??
      getPreferredProvider(
        providers,
        { ...readComposerPrefs(), agentId: agent.id },
        agent.agentAdapter,
      )
    const model =
      provider != null && isLocalCliProvider(provider)
        ? getProviderDefaultModel(provider)
        : (agent.modelId ?? provider?.defaultModel ?? provider?.modelIds[0] ?? '')
    if (provider != null) setSelectedProviderId(provider.id)
    setDraftModelId(model)
    writeComposerPrefs({
      agentId: agent.id,
      adapter: agent.agentAdapter,
      ...(provider?.id !== undefined ? { providerProfileId: provider.id } : {}),
      modelId: model,
      permissionMode: agent.permissionMode,
      reasoningEffort: agentReasoning,
    })
    if (session != null) {
      await persistRuntimePatch({
        agentId: agent.id,
        ...(provider != null ? { providerProfileId: provider.id } : {}),
        modelId: model || null,
        agentAdapter: agent.agentAdapter,
        permissionMode: agent.permissionMode,
        reasoningEffort: agentReasoning,
      })
    }
  }

  /**
   * React to external composer prefill requests:
   * - historical "resend" writes text and attachments back into the draft;
   * - empty-hero recommendation cards write only text, select the target agent, and never send.
   *
   * requestId 单调递增保证每次触发都会同步一次。
   */
  useEffect(() => {
    const current = resendRequest
    if (current == null) return
    const { payload } = current

    if (payload.agentId != null) {
      void applyAgentRuntime(payload.agentId)
    }

    // 文本立即写入（用户能马上看到效果）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(payload.text)

    const stamp = Date.now()
    const placeholders: ComposerAttachment[] = payload.attachments.map((att, index) => ({
      id: `prefill-${stamp}-${index}-${att.path}`,
      type: att.type,
      path: att.path,
      name: att.name ?? getFileNameFromPath(att.path),
    }))
    setAttachments(placeholders)

    const imageTasks = placeholders
      .map((placeholder, index) => ({ placeholder, index }))
      .filter(({ placeholder }) => placeholder.type === 'image')
    if (imageTasks.length === 0) {
      textareaRef.current?.focus()
      return
    }
    void Promise.all(
      imageTasks.map(async ({ placeholder, index }) => {
        try {
          const preview = await prepareImagePreview({ sourcePath: placeholder.path })
          return { index, previewPath: preview.filePath, previewUrl: preview.fileUrl }
        } catch {
          return null
        }
      }),
    ).then((results) => {
      const updates = results.filter(
        (r): r is { index: number; previewPath: string; previewUrl: string } => r != null,
      )
      if (updates.length === 0) return
      setAttachments((currentList) =>
        currentList.map((item) => {
          const match = updates.find((u) => item.path === placeholders[u.index]?.path)
          if (match == null) return item
          return {
            ...item,
            previewPath: match.previewPath,
            previewUrl: match.previewUrl,
          }
        }),
      )
    })

    textareaRef.current?.focus()
  }, [resendRequest, setValue, setAttachments, prepareImagePreview])

  const handleAgentChange = (agentId: string) => applyAgentRuntime(agentId)

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

  // 调试模式开关：与权限模式正交的能力开关。draft 兜底新会话；有会话则即时持久化
  // （persistRuntimePatch 会 remember，未建会时也会在首发后 flush 落库）。
  const handleToggleDebugMode = async () => {
    const next = !effectiveDebugMode
    setDraftDebugMode(next)
    await persistRuntimePatch({ debugMode: next })
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
            {...(onApprovalClose !== undefined
              ? {
                  onClose: () =>
                    onApprovalClose(
                      visibleApprovalRequest.sessionId,
                      visibleApprovalRequest.requestId,
                    ),
                }
              : {})}
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
          className={`composer composer-v2 has-workspace-picks ${teamConfig.enabled ? 'composer-team-mode' : ''} ${manualExpanded ? 'expanded' : ''}`}
        >
          {teamConfig.enabled && (
            <div className="composer-team-banner">
              <span className="composer-team-banner-badge">
                <Icons.Team size={12} /> 团队模式
              </span>
              <span className="composer-team-banner-text">
                Host：{activeAgent?.name ?? '平台管理'} · 成员 {teamConfig.memberAgentIds.length}
              </span>
              <button
                type="button"
                style={{ paddingRight: 20 }}
                onClick={onOpenTeamInspector}
                disabled={isBusy}
              >
                管理成员
              </button>
            </div>
          )}
          {replyTo != null && (
            <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs text-[var(--color-text-3)]">
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <span className="shrink-0 text-[var(--color-primary-6)]">
                  {replyTo.role === 'assistant' ? (replyTo.agentName ?? 'Agent') : 'You'}
                </span>
                <span className="truncate text-[var(--color-text-3)] opacity-80">
                  {replyTo.contentPreview}
                </span>
              </div>
              <button
                type="button"
                className="shrink-0 p-0.5 rounded hover:bg-[var(--color-fill-3)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors"
                title="取消回复"
                onClick={onClearReply}
              >
                <Icons.X size={12} />
              </button>
            </div>
          )}
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
          {visibleRunningTeamAgents.length > 0 && (
            <div className="composer-running-agents" aria-live="polite">
              {visibleRunningTeamAgents.map((agent) => (
                <LobeTag
                  key={agent.id}
                  className="composer-running-agent-tag"
                  color="blue"
                  size="small"
                  title={`${agent.name} 执行中...`}
                  onClick={() => handleRunningAgentTagClick(agent.id)}
                >
                  <span className="composer-running-agent-dot" aria-hidden="true" />
                  <span className="composer-running-agent-name">{agent.name}</span>
                  <span className="composer-running-agent-state">执行中...</span>
                </LobeTag>
              ))}
              {hiddenRunningTeamAgentCount > 0 && (
                <LobeTag
                  className="composer-running-agent-tag composer-running-agent-more"
                  color="default"
                  size="small"
                >
                  +{hiddenRunningTeamAgentCount}
                </LobeTag>
              )}
            </div>
          )}
          {effectiveDebugMode && session != null && (
            <div className="composer-debug-quickreplies" aria-label="调试快捷回复">
              <span className="composer-debug-quickreplies-label">
                <Icons.Bug size={12} /> 调试
              </span>
              <button
                type="button"
                className="composer-debug-chip"
                disabled={isBusy}
                onClick={() =>
                  void dispatchMessage('我已经复现了，请读取本轮调试日志并分析。', [], null)
                }
              >
                <Icons.Check size={13} />
                已复现
              </button>
              <button
                type="button"
                className="composer-debug-chip"
                disabled={isBusy}
                onClick={() => void dispatchMessage('还没解决，请继续排查。', [], null)}
              >
                <Icons.RotateCw size={13} />
                没解决
              </button>
              <button
                type="button"
                className="composer-debug-chip"
                disabled={isBusy}
                onClick={() =>
                  void dispatchMessage('问题已经解决了，请清除所有调试日志并交付成果。', [], null)
                }
              >
                <Icons.CheckCircle size={13} />
                已解决
              </button>
            </div>
          )}
          <textarea
            className="composer-input"
            ref={textareaRef}
            rows={1}
            placeholder={composerPlaceholder}
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
            <TextEditContextMenu menu={textEditMenu} onClose={() => setTextEditMenu(null)} />
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
              {/* 团队模式下隐藏模型切换：host/各成员一律使用各自 agent 配置的模型，不在会话框切换 */}
              {!teamConfig.enabled && (
                <ProviderModelPicker
                  icon={<ModelIcon />}
                  providers={providers}
                  selectedProviderId={selectedProvider?.id ?? ''}
                  selectedModelId={effectiveModelId}
                  disabled={isBusy || providers.length === 0}
                  onChange={handleProviderModelChange}
                />
              )}
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
          <ComposerActionsMenu
            onAddAttachments={() => void handleAddAttachments()}
            onInsertSkillMention={handleInsertSkillMention}
            onOpenSkillStore={onOpenSkillStore}
            disabled={isBusy}
          />
          <GoalControlBar sessionId={session?.id ?? null} disabled={isBusy} />
          <AgentPicker
            agents={agents}
            selectedAgentId={effectiveAgentId}
            onChange={(agentId) => void handleAgentChange(agentId)}
            teamConfig={teamConfig}
            onEnableTeamMode={() => {
              // 启用团队模式时，若当前 effectiveAgentId 在 agents 中存在则保留，
              // 否则回退到第一个可用 agent，避免后端拿到无效 host 而无法调度
              const fallbackHost =
                agents.find((a) => a.id === effectiveAgentId)?.id ??
                agents[0]?.id ??
                effectiveAgentId
              onChangeTeamConfig({ enabled: true, hostAgentId: fallbackHost, teamId: undefined })
              // 开启团队模式：把会话适配器/模型同步为主持人的配置（与单 agent 切换一致）
              void applyAgentRuntime(fallbackHost)
            }}
            onDisableTeamMode={() => onChangeTeamConfig({ enabled: false, teamId: undefined })}
            onChangeHost={(agentId) => {
              // 切换主持人：旧主持人转为成员，新主持人从成员中移除，保持花名册成员不丢失。
              if (agentId === teamConfig.hostAgentId) return
              const nextMembers = new Set(teamConfig.memberAgentIds)
              nextMembers.delete(agentId)
              if (teamConfig.hostAgentId) nextMembers.add(teamConfig.hostAgentId)
              onChangeTeamConfig({
                hostAgentId: agentId,
                memberAgentIds: Array.from(nextMembers),
                teamId: undefined,
              })
              // 主持人变更：会话适配器/模型跟随新主持人配置
              void applyAgentRuntime(agentId)
            }}
            locked={!isNewSessionComposer}
            onApplyTeam={(team) => {
              onChangeTeamConfig({
                enabled: true,
                hostAgentId: team.hostAgentId,
                memberAgentIds: team.memberAgentIds,
                maxDepth: team.maxDepth,
                allowNesting: team.allowNesting,
                teamId: team.id,
              })
              // 应用已保存团队：会话适配器/模型跟随该团队主持人配置
              void applyAgentRuntime(team.hostAgentId)
            }}
            disabled={isBusy}
          />
          <ComposerMenuSelect
            icon={activePermissionOption?.icon ?? <Icons.Shield size={18} />}
            value={effectivePermissionMode}
            label={activePermissionOption?.label ?? '默认权限'}
            title="权限模式"
            menuHeading={`应如何批准 ${adapter === 'codex' ? 'Codex' : 'Claude'} 操作?`}
            variant="permission"
            tone={activePermissionOption?.tone ?? 'default'}
            disabled={false}
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
            disabled={false}
            onChange={(reasoning) => handleReasoningChange(reasoning as SessionReasoningEffort)}
            options={getReasoningOptions(adapter)}
          />
          <button
            type="button"
            className={`composer-debug-toggle ${effectiveDebugMode ? 'is-active' : ''}`}
            title={
              effectiveDebugMode
                ? '调试模式已开启：agent 可插桩、收集复现日志并迭代修复。点击关闭'
                : '开启调试模式：假设驱动 + 人在回路的 bug 排查'
            }
            onClick={() => void handleToggleDebugMode()}
          >
            <Icons.Bug size={13} />
            <span>调试{effectiveDebugMode ? '中' : ''}</span>
          </button>
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
              {queueVisible ? '隐藏队列' : '显示队列'} · {queuedMessages.length}
            </button>
          )}
          <div className="spacer" />
          {isNewSessionComposer && (
            <div className="composer-worktree-controls">
              <label
                className={`composer-worktree-toggle ${createWorktree ? 'is-active' : ''}`}
                title={isGitWorkspace ? '在隔离 worktree 中运行本会话' : '当前项目不是 git 仓库'}
              >
                <input
                  type="checkbox"
                  checked={createWorktree}
                  disabled={!isGitWorkspace}
                  onChange={(e) => setCreateWorktree(e.target.checked)}
                />
                <Icons.GitBranch size={13} />
                <span>worktree</span>
              </label>
              {createWorktree && (
                <input
                  className="form-input composer-worktree-branch-input"
                  type="text"
                  placeholder="分支名（留空 AI 自动命名）"
                  value={worktreeBranch}
                  onChange={(e) => setWorktreeBranch(e.target.value)}
                />
              )}
            </div>
          )}
          <span className="composer-hint">
            <span className="kbd">↵</span> 发送 &nbsp;<span className="kbd">⇧↵</span> 换行 &nbsp;
            <span className="kbd">⇧Tab</span> 权限 &nbsp;<span className="kbd">↑↓</span> 历史
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
  menuHeading,
  disabled = false,
  align = 'left',
  tone = 'default',
  variant = 'default',
  onChange,
}: {
  icon: ReactNode
  value: string
  label: string
  options: ComposerMenuOption[]
  title: string
  menuHeading?: string
  disabled?: boolean
  align?: 'left' | 'right'
  tone?: ComposerOptionTone
  variant?: 'default' | 'permission'
  onChange: (value: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)
  const isPermissionVariant = variant === 'permission'

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-menu-select variant-${variant} tone-${tone} ${align === 'right' ? 'right' : ''}${disabled ? ' is-disabled' : ''}`}
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
        <div
          className={`composer-menu ${isPermissionVariant ? 'permission-menu' : ''} ${align === 'right' ? 'right' : ''}`}
        >
          {isPermissionVariant && menuHeading != null && (
            <div className="composer-menu-heading">{menuHeading}</div>
          )}
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`composer-menu-item ${isPermissionVariant ? 'permission-menu-item' : ''} tone-${option.tone ?? 'default'} ${option.value === value ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                void onChange(option.value)
              }}
            >
              <span className={`composer-menu-item-main${option.icon != null ? ' has-icon' : ''}`}>
                {option.icon != null && (
                  <span className="composer-menu-item-leading-icon">{option.icon}</span>
                )}
                <span className="composer-menu-item-copy">
                  <span className="composer-menu-item-label">
                    {option.icon == null && option.tone === 'danger' && (
                      <Icons.AlertTriangle size={13} />
                    )}
                    {option.icon == null && option.tone === 'auto' && <Icons.Zap size={13} />}
                    <span>{option.label}</span>
                  </span>
                  {option.description != null && (
                    <span className="composer-menu-item-desc">{option.description}</span>
                  )}
                </span>
              </span>
              {option.value === value && <Icons.Check className="composer-menu-check" size={14} />}
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

  // 最近项目：按更新时间倒序，最多 5 个，排除 "不使用项目" 与 worktree（worktree 不是可选项目）
  const recent = useMemo(() => {
    return workspaces
      .filter((w) => w.name !== NO_PROJECT_WORKSPACE_NAME && w.worktreeMeta == null)
      .sort((a, b) => {
        const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
        const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime()
        return tb - ta
      })
      .slice(0, 5)
  }, [workspaces])

  const noProjectWorkspace = workspaces.find((w) => w.name === NO_PROJECT_WORKSPACE_NAME) ?? null
  const isNoProject = activeWorkspaceId != null && noProjectWorkspace?.id === activeWorkspaceId
  // 若当前活动 workspace 恰是 worktree（理论上不应发生），显示其 base 项目，避免误导
  const rawSelected = isNoProject
    ? null
    : (workspaces.find((w) => w.id === activeWorkspaceId) ?? null)
  const selectedProject =
    rawSelected?.worktreeMeta?.baseWorkspaceId != null
      ? (workspaces.find((w) => w.id === rawSelected.worktreeMeta?.baseWorkspaceId) ?? rawSelected)
      : rawSelected

  const triggerLabel =
    selectedProject?.name ?? (isNoProject ? NO_PROJECT_WORKSPACE_NAME : '选择项目')
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
    <div ref={rootRef} className="composer-select composer-project-picker" title={triggerTitle}>
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
  onApplyTeam,
  disabled,
  locked,
}: {
  agents: ManagedAgent[]
  selectedAgentId: string
  onChange: (agentId: string) => void | Promise<void>
  teamConfig: TeamModeConfig
  onEnableTeamMode: () => void
  onDisableTeamMode: () => void
  onChangeHost: (agentId: string) => void
  onApplyTeam: (team: ManagedTeam) => void
  disabled?: boolean
  /** 会话已有内容（messageCount>0）：锁定团队切换/退出，弹窗只读展示当前团队与成员 */
  locked?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  // 长期团队列表（用于「选择团队」分组）。打开下拉时按需加载，避免每次会话切换都拉。
  const { invoke: listTeamDefs } = useIpcInvoke('team:list-defs')
  const [teams, setTeams] = useState<ManagedTeam[]>([])
  const refreshTeams = useCallback(async () => {
    const res = await listTeamDefs({})
    setTeams(res.teams)
  }, [listTeamDefs])
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
  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'team' && open) void refreshTeams().catch(() => {})
      }) ?? (() => {})
    )
  }, [open, refreshTeams])

  const teamMode = teamConfig.enabled
  // 团队模式下，选择器代表 Host；否则代表当前对话 Agent。
  const activeId = teamMode ? teamConfig.hostAgentId : selectedAgentId
  const selected =
    agents.find((agent) => agent.id === activeId) ??
    agents.find((agent) => agent.id === 'platform-manager-agent') ??
    agents[0]
  const activeTeam =
    teamMode && teamConfig.teamId != null
      ? teams.find((t) => t.id === teamConfig.teamId)
      : undefined

  // 会话已有内容时锁定团队：弹窗只读展示「当前团队 + 成员（主持人置顶）」，
  // 不再提供切换团队、切换主持人、退出团队模式等操作。
  const lockedTeam = locked === true && teamMode
  const hostAgent = teamMode
    ? (agents.find((a) => a.id === teamConfig.hostAgentId) ?? selected)
    : selected
  const rosterMembers = (() => {
    if (!teamMode) return []
    const memberSet = new Set(teamConfig.memberAgentIds)
    return agents.filter((a) => a.id !== hostAgent?.id && memberSet.has(a.id))
  })()

  // 选择器头部图标：优先显示当前选中项的自定义头像。
  // - 非团队模式：显示当前 agent 头像
  // - 团队模式 + 已应用某个已保存团队：显示该团队头像
  // - 团队模式 + 临时团队：不显示主持人头像，改用团队模式标识（见 showTeamBadge）
  // 没有自定义头像时保持原来的默认图标（Team / Code / Bot）。
  const triggerAvatarTarget: {
    id: string
    metadata: Record<string, unknown> | undefined
    name: string
  } | null = (() => {
    if (teamMode) {
      // 团队模式只认「已保存团队」的头像；临时团队不回落到主持人头像。
      return activeTeam != null
        ? { id: activeTeam.id, metadata: activeTeam.metadata, name: activeTeam.name }
        : null
    }
    if (selected) {
      return { id: selected.id, metadata: selected.metadata, name: selected.name }
    }
    return null
  })()
  const showTriggerAvatar =
    triggerAvatarTarget != null && hasCustomAvatar(triggerAvatarTarget.metadata)
  // 团队模式且没有团队自定义头像时，头部展示一个团队模式标识徽标（而非主持人头像）。
  const showTeamBadge = teamMode && !showTriggerAvatar

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-agent-picker${teamMode ? ' is-team' : ''}${disabled ? ' is-disabled' : ''}`}
      title={disabled ? '会话运行中不可切换' : teamMode ? '团队模式' : 'Agent'}
    >
      <span className={`composer-select-icon${showTeamBadge ? ' is-team-badge' : ''}`}>
        {showTriggerAvatar && triggerAvatarTarget ? (
          <AvatarImage
            className="composer-agent-picker-avatar"
            src={resolveAvatarSrc(
              getAgentAvatarConfig(
                triggerAvatarTarget.metadata,
                triggerAvatarTarget.id,
                triggerAvatarTarget.name,
              ),
            )}
            seed={triggerAvatarTarget.id}
            name={triggerAvatarTarget.name}
            alt={`${triggerAvatarTarget.name} 头像`}
          />
        ) : teamMode ? (
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
                ? `团队：${activeTeam.name}（主持：${selected?.name ?? '平台管理'}）`
                : `团队模式（当前对话：${selected?.name ?? '平台管理'}）`
              : (selected?.name ?? '平台管理')
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{activeTeam != null ? activeTeam.name : (selected?.name ?? '平台管理')}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-agent-menu">
          {lockedTeam ? (
            <div className="composer-roster-readonly">
              <div className="composer-menu-group-title">
                {activeTeam != null ? '当前团队' : '当前团队（临时）'}
              </div>
              <div className="composer-roster-team-row">
                {activeTeam != null && hasCustomAvatar(activeTeam.metadata) ? (
                  <AvatarImage
                    className="composer-menu-avatar"
                    src={resolveAvatarSrc(
                      getAgentAvatarConfig(activeTeam.metadata, activeTeam.id, activeTeam.name),
                    )}
                    seed={activeTeam.id}
                    name={activeTeam.name}
                    alt={`${activeTeam.name} 头像`}
                  />
                ) : (
                  <span className="composer-roster-team-icon">
                    <Icons.Team size={13} />
                  </span>
                )}
                <span className="composer-roster-team-name">
                  {activeTeam != null ? activeTeam.name : '临时团队'}
                </span>
                {activeTeam?.builtIn && <span className="composer-menu-item-tag">内置</span>}
              </div>
              <div className="composer-menu-divider" />
              <div className="composer-menu-group-title">
                成员 · {rosterMembers.length + (hostAgent ? 1 : 0)}
              </div>
              {[hostAgent, ...rosterMembers]
                .filter((a): a is ManagedAgent => a != null)
                .map((agent, idx) => {
                  const isHost = idx === 0
                  const agentHasAvatar = hasCustomAvatar(agent.metadata)
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={`composer-menu-item${isHost ? ' active' : ''}`}
                      title={isHost ? '当前主持人' : '设为主持人'}
                      onClick={() => {
                        setOpen(false)
                        if (!isHost) onChangeHost(agent.id)
                      }}
                    >
                      <span className="composer-menu-item-copy">
                        <span className="composer-menu-item-label">
                          {agentHasAvatar ? (
                            <AvatarImage
                              className="composer-menu-avatar"
                              src={resolveAvatarSrc(
                                getAgentAvatarConfig(agent.metadata, agent.id, agent.name),
                              )}
                              seed={agent.id}
                              name={agent.name}
                              alt={`${agent.name} 头像`}
                            />
                          ) : agent.builtIn ? (
                            <Icons.Code size={13} />
                          ) : (
                            <Icons.Bot size={13} />
                          )}
                          <span>{agent.name}</span>
                          {isHost && <span className="composer-roster-host-badge">主持人</span>}
                        </span>
                        <span className="composer-menu-item-desc">{agent.description || '-'}</span>
                      </span>
                      {isHost && <Icons.Check size={14} className="composer-menu-check" />}
                    </button>
                  )
                })}
              <div className="composer-roster-locked-hint">
                <Icons.Lock size={11} /> 会话进行中，团队成员已锁定，仅可切换主持人
              </div>
            </div>
          ) : (
            <>
              {teamMode ? (
                <button
                  type="button"
                  className="composer-menu-item team-mode-entry team-mode-exit"
                  onClick={() => {
                    setOpen(false)
                    onDisableTeamMode()
                  }}
                >
                  <span className="composer-menu-item-copy">
                    <span className="composer-menu-item-label">
                      <Icons.X size={14} />
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
                    <span className="composer-menu-item-desc">
                      让当前对话 Agent 调用其他成员协作
                    </span>
                  </span>
                </button>
              )}
              {teams.length > 0 && (
                <>
                  <div className="composer-menu-group-title">已保存团队</div>
                  {teams.map((team) => {
                    const host = agents.find((a) => a.id === team.hostAgentId)
                    const active = teamMode && teamConfig.teamId === team.id
                    const teamHasAvatar = hasCustomAvatar(team.metadata)
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
                            {teamHasAvatar ? (
                              <AvatarImage
                                className="composer-menu-avatar"
                                src={resolveAvatarSrc(
                                  getAgentAvatarConfig(team.metadata, team.id, team.name),
                                )}
                                seed={team.id}
                                name={team.name}
                                alt={`${team.name} 头像`}
                              />
                            ) : (
                              <Icons.Team size={13} />
                            )}
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
                        {active && <Icons.Check size={14} className="composer-menu-check" />}
                      </button>
                    )
                  })}
                </>
              )}
              <div className="composer-menu-divider" />
              <div className="composer-menu-group-title">
                {teamMode ? '主持人 Agent' : '选择 Agent'}
              </div>
              {agents.map((agent) => {
                const agentHasAvatar = hasCustomAvatar(agent.metadata)
                return (
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
                        {agentHasAvatar ? (
                          <AvatarImage
                            className="composer-menu-avatar"
                            src={resolveAvatarSrc(
                              getAgentAvatarConfig(agent.metadata, agent.id, agent.name),
                            )}
                            seed={agent.id}
                            name={agent.name}
                            alt={`${agent.name} 头像`}
                          />
                        ) : agent.builtIn ? (
                          <Icons.Code size={13} />
                        ) : (
                          <Icons.Bot size={13} />
                        )}
                        <span>{agent.name}</span>
                      </span>
                      <span className="composer-menu-item-desc">{agent.description || '-'}</span>
                    </span>
                    {agent.workflowId && <Icons.Workflow size={13} />}
                    {agent.id === selected?.id && (
                      <Icons.Check size={14} className="composer-menu-check" />
                    )}
                  </button>
                )
              })}
            </>
          )}
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
  const [placement, setPlacement] = useState<'topLeft' | 'topRight'>('topLeft')
  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]
  const label = getModelDisplayLabel(selectedProvider, selectedModelId)
  const selectedVendor = resolveProviderVendor(selectedProvider)

  useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (root == null || typeof window === 'undefined') return

    const updatePlacement = () => {
      const viewportWidth = window.innerWidth
      const gutter = 12
      const rootRect = root.getBoundingClientRect()
      const estimatedMenuWidth = Math.min(220, Math.max(158, viewportWidth - gutter * 2))
      const availableLeft = rootRect.right - gutter
      const availableRight = viewportWidth - rootRect.left - gutter
      setPlacement(
        availableRight >= estimatedMenuWidth || availableRight >= availableLeft
          ? 'topLeft'
          : 'topRight',
      )
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    return () => {
      window.removeEventListener('resize', updatePlacement)
    }
  }, [open])

  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      trigger={['click']}
      placement={placement}
      onOpenChange={(nextOpen) => {
        if (disabled || providers.length === 0) {
          setOpen(false)
          return
        }
        setOpen(nextOpen)
      }}
      popupRender={() => (
        <div className="composer-dropdown-menu composer-model-menu">
          {providers.length === 0 && <div className="composer-menu-empty">未配置</div>}
          {providers.map((provider) => {
            const models = provider.modelIds.length
              ? provider.modelIds
              : provider.defaultModel
                ? [provider.defaultModel]
                : []
            const vendor = resolveProviderVendor(provider)
            return (
              <div key={provider.id} className="composer-model-group">
                <div className="composer-model-group-title">
                  {vendor && (
                    <span className="composer-model-group-icon">
                      <ProviderLogo vendor={vendor} size={14} shape="rounded" />
                    </span>
                  )}
                  <span>{provider.name}</span>
                </div>
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
                      <span>{getModelDisplayLabel(provider, modelId)}</span>
                      {active && <Icons.Check size={14} />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    >
      <div
        ref={rootRef}
        className={`composer-select composer-model-picker${disabled ? ' is-disabled' : ''}`}
        title={disabled ? '会话运行中不可切换' : '供应商模型'}
      >
        <span className="composer-select-icon">
          {selectedVendor ? (
            <ProviderLogo vendor={selectedVendor} size={18} shape="rounded" />
          ) : (
            icon
          )}
        </span>
        <button
          type="button"
          className="composer-select-trigger"
          disabled={disabled || providers.length === 0}
          title={disabled ? '会话运行中不可切换' : undefined}
        >
          <span>{label}</span>
          <Icons.ChevronDown size={12} />
        </button>
      </div>
    </Dropdown>
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
  { value: 'codex', label: 'Codex' },
]

const DEFAULT_AGENT_ADAPTER: AgentAdapter = 'claude-sdk'

const ADAPTER_LABELS: Record<AgentAdapter, string> = {
  'claude-sdk': 'Claude SDK',
  claude: 'Claude API',
  codex: 'Codex',
}

const CLAUDE_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption & { value: PermissionModeChoice }> =
  [
    {
      value: 'claude-ask',
      label: '请求批准',
      description: '每次工具执行前确认',
      icon: <Icons.Hand size={18} />,
    },
    {
      value: 'claude-plan',
      label: '计划模式',
      description: '先产出计划，再批准执行',
      icon: <Icons.FileText size={18} />,
    },
    {
      value: 'claude-auto',
      label: '自动审批',
      description: '使用 Claude SDK 自动权限策略',
      icon: <Icons.Shield size={18} />,
      tone: 'auto',
    },
    {
      value: 'claude-bypass',
      label: '完全访问权限',
      description: '危险：完全听从 agent 执行',
      icon: <Icons.AlertTriangle size={18} />,
      tone: 'danger',
    },
  ]

const CODEX_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption & { value: PermissionModeChoice }> = [
  {
    value: 'codex-default',
    label: '请求批准',
    description: '编辑外部文件和使用互联网时始终询问',
    icon: <Icons.Hand size={18} />,
  },
  {
    value: 'codex-auto-review',
    label: '替我批准',
    description: '仅对检测到的风险操作请求批准',
    icon: <Icons.Shield size={18} />,
    tone: 'auto',
  },
  {
    value: 'codex-full-access',
    label: '完全访问权限',
    description: '可不受限制地访问互联网和您电脑上的任何文件',
    icon: <Icons.AlertTriangle size={18} />,
    tone: 'danger',
  },
]

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
    return lower.startsWith('http://') || lower.startsWith('https://')
      ? normalizeEduAssetUrl(trimmed)
      : trimmed
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
  const resolvedSrc =
    attachment.previewUrl ?? resolveComposerImageSrc(attachment.previewPath ?? attachment.path)

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
  return adapter === 'codex' ? CODEX_PERMISSION_MODE_OPTIONS : CLAUDE_PERMISSION_MODE_OPTIONS
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
    source.adapter === 'claude' || source.adapter === 'claude-sdk' || source.adapter === 'codex'
      ? source.adapter
      : DEFAULT_AGENT_ADAPTER
  return {
    adapter,
    permissionMode: getValidPermissionMode(source.permissionMode, adapter),
  }
}

function normalizeComposerReasoningEffort(value: unknown): SessionReasoningEffort | undefined {
  if (value == null) return undefined
  return value === 'high' || value === 'xhigh' || value === 'max' ? value : 'medium'
}

function readComposerPrefs(): ComposerPrefs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COMPOSER_PREFS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as ComposerPrefs
    if (parsed == null || typeof parsed !== 'object') return {}
    const reasoningEffort = normalizeComposerReasoningEffort(parsed.reasoningEffort)
    return {
      ...parsed,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    }
  } catch {
    return {}
  }
}

function writeComposerPrefs(patch: ComposerPrefs): void {
  if (typeof window === 'undefined') return
  const prev = readComposerPrefs()
  const normalizedPatch: ComposerPrefs = { ...patch }
  if (patch.reasoningEffort !== undefined) {
    const reasoningEffort = normalizeComposerReasoningEffort(patch.reasoningEffort)
    if (reasoningEffort !== undefined) normalizedPatch.reasoningEffort = reasoningEffort
    else delete normalizedPatch.reasoningEffort
  }
  const next: ComposerPrefs = { ...prev, ...normalizedPatch }
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
  return getPreferredProviderForAdapter(providers, prefs.providerProfileId, adapter)
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
  if (isLocalCliProvider(provider)) return getProviderDefaultModel(provider)
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

function isLocalCliProvider(provider: ProviderProfile | null | undefined): boolean {
  return isBuiltInLocalCliProvider(provider)
}

/**
 * ProviderProfile → VendorMeta 解析（用于输入框 / 下拉的供应商图标渲染）。
 *
 * 1) 内置本地 CLI（codex / claude）走合成 vendor（与 ProvidersView 一致）
 * 2) 否则用 provider.name 在 VENDOR_CATALOG 里匹配（同 ProvidersView 的 guessVendorByName）
 * 3) 仍没匹配 → 按 provider 协议格式（anthropic/openai）渲染对应官方图标
 * 4) 兜底：合成首字母 vendor
 */
const LOCAL_CLAUDE_CLI_VENDOR: VendorMeta = {
  id: 'local-claude-cli',
  name: '本地 Claude CLI',
  emoji: 'CC',
  color: '#d97757',
  desc: '',
  logoPath: '',
}

const LOCAL_CODEX_CLI_VENDOR: VendorMeta = {
  id: 'local-codex-cli',
  name: '本地 Codex CLI',
  emoji: 'CX',
  color: '#10a37f',
  desc: '',
  logoPath: '',
}

/**
 * 按协议格式（anthropic / openai）合成 vendor，让自定义供应商也能渲染出官方彩色图标。
 * id 对齐 ProviderLogo 的 VENDOR_AVATAR_MAP（anthropic → Anthropic.Avatar，openai → OpenAI.Avatar）。
 */
const PROTOCOL_VENDOR_MAP: Record<string, VendorMeta> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    emoji: 'A',
    color: '#d4a574',
    desc: '',
    logoPath: '',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    emoji: 'OA',
    color: '#10a37f',
    desc: '',
    logoPath: '',
  },
}

function resolveProviderVendor(provider: ProviderProfile | null | undefined): VendorMeta | null {
  if (!provider) return null
  if (provider.id === LOCAL_CODEX_CLI_PROVIDER_ID) return LOCAL_CODEX_CLI_VENDOR
  if (provider.id === LOCAL_CLI_PROVIDER_ID) return LOCAL_CLAUDE_CLI_VENDOR

  const name = provider.name ?? ''
  // 1) 精确匹配 vendor.name
  for (const v of VENDOR_CATALOG) {
    if (v.name === name) return v
  }
  // 2) 包含关系
  for (const v of VENDOR_CATALOG) {
    if (name && (name.includes(v.name) || v.name.includes(name))) return v
  }
  // 3) 按协议格式兜底（自定义供应商能渲染出官方彩色图标）
  const protocolVendor = PROTOCOL_VENDOR_MAP[provider.provider]
  if (protocolVendor) {
    return {
      ...protocolVendor,
      // 保留自定义名作为展示名，但 id 不变以命中 ProviderLogo 头像映射
      name: name || protocolVendor.name,
    }
  }
  // 4) 终极兜底：首字母合成 vendor
  return {
    id: `custom-${provider.id}`,
    name: name || provider.id,
    emoji: (name[0] ?? provider.id[0] ?? '?').toUpperCase(),
    color: 'var(--text-faint)',
    desc: '',
    logoPath: '',
  }
}

function getProviderDefaultModel(
  provider: ProviderProfile | null | undefined,
  fallback = '',
): string {
  if (provider?.id === LOCAL_CODEX_CLI_PROVIDER_ID) return LOCAL_CODEX_CLI_DEFAULT_MODEL
  if (provider?.id === LOCAL_CLI_PROVIDER_ID) return LOCAL_CLI_DEFAULT_MODEL
  return provider?.defaultModel || fallback || ''
}

function getModelDisplayLabel(
  provider: ProviderProfile | null | undefined,
  modelId: string | null | undefined,
): string {
  if (provider?.id === LOCAL_CODEX_CLI_PROVIDER_ID) return LOCAL_CODEX_CLI_MODEL_DISPLAY
  if (provider?.id === LOCAL_CLI_PROVIDER_ID) return LOCAL_CLI_MODEL_DISPLAY
  return modelId || provider?.defaultModel || provider?.name || '未配置'
}

function getReasoningOptions(
  adapter: AgentAdapter,
): Array<{ value: SessionReasoningEffort; label: string }> {
  if (isClaudeAdapter(adapter)) {
    return [
      { value: 'medium', label: 'middle' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
      { value: 'max', label: 'max' },
    ]
  }
  return [
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
    { value: 'xhigh', label: '超高' },
    { value: 'max', label: 'Max' },
  ]
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return `${value}`
}

function GoalControlBar({
  sessionId,
  disabled,
}: {
  sessionId: SessionId | null
  disabled: boolean
}) {
  const { toast } = useToast()
  const [goal, setGoal] = useState<SessionGoal | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    if (sessionId == null) {
      setGoal(null)
      return
    }
    try {
      const res = (await window.spark.invoke('session:get-goal', { sessionId })) as {
        goal: SessionGoal | null
      }
      setGoal(res.goal)
    } catch {
      setGoal(null)
    }
  }, [sessionId])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (sessionId == null) return
    return window.spark.on('stream:session:agent-event', (event) => {
      if (event.sessionId !== sessionId) return
      if (!event.type.startsWith('goal_')) return
      void refresh()
    })
  }, [refresh, sessionId])

  const control = async (action: 'pause' | 'resume' | 'clear' | 'complete') => {
    if (sessionId == null || busy) return
    setBusy(true)
    try {
      const res = (await window.spark.invoke('session:goal-control', { sessionId, action })) as {
        goal: SessionGoal | null
      }
      setGoal(res.goal)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Goal 操作失败')
    } finally {
      setBusy(false)
    }
  }

  if (sessionId == null) return null
  if (goal == null) return null
  const latest = goal.progressLog.at(-1)
  return (
    <div className={`goal-control-bar goal-${goal.status}`} title={goal.objective}>
      <span className="goal-dot" />
      <span className="goal-title">{goal.objective}</span>
      <span className="goal-status">
        {goal.status} · #{goal.progressLog.length}
      </span>
      {latest && <span className="goal-latest">{latest.summary}</span>}
      {goal.status === 'active' ? (
        <button
          className="btn ghost sm"
          disabled={disabled || busy}
          onClick={() => void control('pause')}
        >
          暂停
        </button>
      ) : (
        <button
          className="btn ghost sm"
          disabled={disabled || busy}
          onClick={() => void control('resume')}
        >
          恢复
        </button>
      )}
      <button
        className="btn ghost sm"
        disabled={disabled || busy}
        onClick={() => void control('complete')}
      >
        完成
      </button>
      <button
        className="btn ghost sm danger"
        disabled={disabled || busy}
        onClick={() => void control('clear')}
      >
        清除
      </button>
    </div>
  )
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
  // Picker 本地草稿：打开时初始化为空（会话级 picker 用于"新增"），关闭/完成时再提交。
  // 这样列表项的勾选只更新 draft，不会立刻触发 onChange 关闭弹窗。
  const [pickerDraft, setPickerDraft] = useState<string[]>([])
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
    } catch {
      /* non-critical */
    }
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
  useEffect(() => {
    void loadAllSkills()
  }, [loadAllSkills])

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
      className="inspector-frame"
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
      <div className="inspector scroll">
        {/* Skills — 显示本次会话可用的所有 skills（agent 配置 + 会话额外添加） */}
        {session != null &&
          skillConfig != null &&
          (() => {
            const agentSkillSet = new Set(skillConfig.agentSkillIds)
            const effectiveSet = new Set(skillConfig.effectiveSkillIds)
            const visibleSkills = skillConfig.skills.filter((s) => effectiveSet.has(s.id))
            // Picker 中可选的 skills = 全量 skills 中尚未在 effective 中的
            const pickerSkills = allSkills.filter((s) => !effectiveSet.has(s.id))
            return (
              <div className="inspector-section">
                <h4
                  className="config-panel-header"
                  onClick={() => setSkillsCollapsed(!skillsCollapsed)}
                >
                  <Icons.Skills size={11} />
                  Skills
                  <span className="inspector-count">{visibleSkills.length}</span>
                  <span className="spacer" />
                  {!skillsCollapsed && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{ fontSize: 10, padding: '2px 8px', marginRight: 4 }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setPickerDraft([])
                        setShowSkillPicker(true)
                      }}
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
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      marginLeft: 4,
                                      padding: '0 4px',
                                      borderRadius: 4,
                                      fontSize: 9,
                                      fontWeight: 700,
                                      lineHeight: '16px',
                                      background: 'var(--primary-soft)',
                                      color: 'var(--primary)',
                                    }}
                                    title="来自 Agent 配置"
                                  >
                                    A
                                  </span>
                                )}
                              </div>
                              <div className="runtime-skill-desc truncate">
                                {meta.source}
                                {meta.desc ? ` · ${meta.desc}` : ''}
                              </div>
                            </div>
                            {/* 会话级额外添加的 skill 可移除（× 按钮） */}
                            {!isAgentSkill && sessionId != null && (
                              <button
                                type="button"
                                className="btn ghost sm"
                                style={{
                                  padding: '0 4px',
                                  minWidth: 20,
                                  fontSize: 11,
                                  lineHeight: '18px',
                                  color: 'var(--text-muted)',
                                }}
                                title="从本次会话移除此 Skill"
                                disabled={savingRuntime}
                                onClick={() =>
                                  void toggleRuntimeSkill('session', sessionId, skill.id, false)
                                }
                              >
                                ×
                              </button>
                            )}
                          </div>
                        )
                      })}
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
                  selectedIds={pickerDraft}
                  onChange={(ids) => setPickerDraft(ids)}
                  onConfirm={() => {
                    const ids = pickerDraft
                    setShowSkillPicker(false)
                    setPickerDraft([])
                    if (ids.length > 0) void handleAddSessionSkills(ids)
                  }}
                  onClose={() => {
                    // 取消：仅关闭，不提交
                    setShowSkillPicker(false)
                    setPickerDraft([])
                  }}
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
                      onClick={() =>
                        void savePromptLayer('project', workspaceId, projectPromptDraft)
                      }
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
  const inspectorTasks = extractInspectorTasks(messages)

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
      className="inspector-frame"
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
      <div className="inspector scroll">
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

        {workspace && (
          <div className="inspector-section">
            <WorktreePanel workspaceId={workspace.id} sessionId={session?.id ?? null} />
          </div>
        )}

        {inspectorTasks.length > 0 && (
          <div className="inspector-section">
            <h4>
              <Icons.CheckSquare size={11} /> 任务
              <span className="inspector-count">{inspectorTasks.length}</span>
            </h4>
            <TaskListSection tasks={inspectorTasks} />
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
                      {sa.status === 'running' ? (
                        <Icons.Spinner size={10} className="thinking-spinner" />
                      ) : (
                        <Icons.Check size={10} style={{ color: 'var(--c-ok, #22c55e)' }} />
                      )}{' '}
                      {sa.name}
                    </div>
                    <div className="runtime-skill-desc truncate">{sa.task || sa.role || '-'}</div>
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
        {turnPromptSnapshots.length > 0 && (
          <PromptInspectorSection snapshots={turnPromptSnapshots} />
        )}
      </div>
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
  const modelLabel =
    snapshot.providerProfileId === LOCAL_CODEX_CLI_PROVIDER_ID
      ? LOCAL_CODEX_CLI_MODEL_DISPLAY
      : snapshot.providerProfileId === LOCAL_CLI_PROVIDER_ID
        ? LOCAL_CLI_MODEL_DISPLAY
        : snapshot.model
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
          Turn {turnNumber} · {modelLabel}
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
            <span className="inspector-plan-dot-wrap">
              <span className="inspector-plan-dot">
                {item.status === 'done' && <Icons.Check size={10} />}
                {item.status === 'running' && <Icons.Spinner size={10} />}
              </span>
            </span>
            <span className="text">{renderPlanInline(item.text)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * TaskListSection — 渲染 TaskCreate / TaskUpdate 维护的当前任务列表。
 * 复用 inspector-plan 样式以与 todo_write 的"计划"区块保持视觉一致。
 */
function TaskListSection({ tasks }: { tasks: InspectorTask[] }) {
  const completed = tasks.filter((t) => t.status === 'completed').length
  const running = tasks.filter((t) => t.status === 'in_progress').length
  const pending = tasks.filter((t) => t.status === 'pending').length
  const total = tasks.length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  const inProgress = tasks.find((t) => t.status === 'in_progress')

  return (
    <div className="inspector-plan">
      <div className="inspector-plan-head">
        <span className="strong truncate">
          {inProgress ? (inProgress.activeForm ?? inProgress.subject) : '任务进度'}
        </span>
        <span className="mono-sm">
          {completed}/{total}
        </span>
      </div>
      <div className="inspector-progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="inspector-task-counts">
        {running > 0 && (
          <span className="inspector-task-count running" title="进行中">
            <Icons.Spinner size={10} /> {running} 进行中
          </span>
        )}
        {pending > 0 && (
          <span className="inspector-task-count pending" title="待运行">
            <span className="inspector-task-dot" /> {pending} 待运行
          </span>
        )}
        {completed > 0 && (
          <span className="inspector-task-count done" title="已完成">
            <Icons.Check size={10} /> {completed} 完成
          </span>
        )}
      </div>
      <div className="inspector-plan-items">
        {tasks.map((task) => (
          <TaskListItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  )
}

/**
 * TaskListItem — 单个任务的渲染单元。
 * 文本超出 2 行时显示省略号;当内容被截断或带 description 时,
 * 鼠标悬浮展示 Popover,呈现 subject(标题)+ description(内容)。
 */
function TaskListItem({ task }: { task: InspectorTask }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const check = () => setIsTruncated(el.scrollHeight - el.clientHeight > 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [task.subject, task.activeForm, task.description])

  const statusClass =
    task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'running' : ''
  const primaryText =
    task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject
  const needsPopover = isTruncated || Boolean(task.description)

  const item = (
    <div className={`inspector-plan-item ${statusClass}`}>
      <span className="inspector-plan-dot-wrap">
        <span className="inspector-plan-dot">
          {task.status === 'completed' && <Icons.Check size={10} />}
          {task.status === 'in_progress' && <Icons.Spinner size={10} />}
        </span>
      </span>
      <span className="text" ref={textRef}>
        <span className="mono-sm" style={{ marginRight: 4, color: 'var(--text-muted)' }}>
          {task.id}
        </span>
        {primaryText}
      </span>
    </div>
  )

  if (!needsPopover) return item

  return (
    <Popover
      content={
        <div className="inspector-plan-item-popover">
          <div className="inspector-plan-item-popover-title">{task.subject}</div>
          {task.description && (
            <div className="inspector-plan-item-popover-desc">{task.description}</div>
          )}
        </div>
      }
    >
      {item}
    </Popover>
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
      if (
        block.kind === 'tool_call' &&
        (block.status === 'pending' || block.status === 'running')
      ) {
        running.add(memberContext.memberAgentId)
      }
      if (block.kind === 'terminal' && block.isStreaming) {
        running.add(memberContext.memberAgentId)
      }
    }
  }
  return Array.from(running)
}

function extractRunningTeamAgentIds(
  messages: UIMessage[],
  hostAgentId: string | null | undefined,
  hostSessionRunning: boolean,
): string[] {
  const running = new Set<string>(extractRunningTeamMemberIds(messages))
  if (hostAgentId != null && hostSessionRunning) {
    const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    if (latestAssistant != null) {
      const segments = splitAssistantMessageBlocks(latestAssistant.blocks)
      const latestSegment = [...segments].reverse().find((segment) => segment.kind !== 'team')
      if (latestSegment?.kind === 'agent' && isHostActivityRunning(latestSegment.blocks)) {
        running.add(hostAgentId)
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

type InspectorTaskStatus = 'pending' | 'in_progress' | 'completed'

interface InspectorTask {
  id: string
  subject: string
  description?: string | undefined
  activeForm?: string | undefined
  status: InspectorTaskStatus
  createdAt: number
}

function isTaskToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === 'task_create' ||
    lower === 'taskcreate' ||
    lower === 'task_update' ||
    lower === 'taskupdate'
  )
}

function parseTaskIdFromOutput(output: string | undefined): string | null {
  if (!output) return null
  // 兼容 Claude Agent SDK 实际格式 `{"task":{"id":"1","subject":"..."}}`
  const json = extractJsonObject(output)
  if (json?.task != null && typeof json.task === 'object') {
    const id = (json.task as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  // 兜底：旧版纯文本 `Task #N created`
  const match = output.match(/Task\s+([#A-Za-z0-9_-]+)\s+created/i)
  return match?.[1] ?? null
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  const candidate = fenced?.[1] ?? text.trim()
  if (!candidate.startsWith('{') && !candidate.startsWith('[')) return null
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return null
}

/** 去掉前导 `#`；用于 task_create 注册的 id 与 task_update 入参 id 的模糊匹配。 */
function normalizeTaskId(id: string): string {
  return id.replace(/^#+/, '')
}

function findTaskById(tasks: Map<string, InspectorTask>, rawId: string): InspectorTask | undefined {
  const direct = tasks.get(rawId)
  if (direct != null) return direct
  // 兼容 task_update 用 "1"、task_create 注册 "#1" 的常见 ID 格式差
  const target = normalizeTaskId(rawId)
  if (!target) return undefined
  for (const task of tasks.values()) {
    if (normalizeTaskId(task.id) === target) return task
  }
  return undefined
}

/**
 * 按时间顺序聚合会话中的 TaskCreate / TaskUpdate 工具调用，
 * 输出当前最新的任务视图。TaskCreate 的 id 优先从 tool result JSON
 * (`{"task":{"id":"1",...}}`) 提取，找不到时再退回纯文本正则；
 * 仍找不到时按出现顺序自增占位 id。
 * task_update 的 taskId 允许带或不带前导 `#`（自动归一化匹配）。
 * TaskUpdate 的 status=deleted 表示删除任务。
 */
function extractInspectorTasks(messages: UIMessage[]): InspectorTask[] {
  const tasks = new Map<string, InspectorTask>()
  let nextSeq = 0
  let fallbackCounter = 0

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'tool_call') continue
      if (!isTaskToolName(block.toolName)) continue

      const lower = block.toolName.toLowerCase()
      const input = block.toolInput ?? {}

      if (lower === 'task_create' || lower === 'taskcreate') {
        const subject = typeof input.subject === 'string' ? input.subject : ''
        if (!subject) continue
        const parsedId = parseTaskIdFromOutput(block.output)
        const id = parsedId ?? `#task-${++fallbackCounter}`
        // 同一 id 重复创建（如重放）：保留首次创建时的 createdAt
        if (!tasks.has(id)) {
          tasks.set(id, {
            id,
            subject,
            description: typeof input.description === 'string' ? input.description : undefined,
            activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined,
            status: 'pending',
            createdAt: nextSeq++,
          })
        }
        continue
      }

      // task_update
      const rawId = input.taskId ?? input.task_id ?? input.id
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) continue
      const existing = findTaskById(tasks, id)
      if (!existing) continue

      const status = input.status
      if (typeof status === 'string') {
        if (status === 'deleted') {
          const keyToDelete = Array.from(tasks.entries()).find(([, task]) => task === existing)?.[0]
          if (keyToDelete != null) tasks.delete(keyToDelete)
          continue
        }
        if (status === 'pending' || status === 'in_progress' || status === 'completed') {
          existing.status = status
        }
      }
      if (typeof input.subject === 'string') existing.subject = input.subject
      if (typeof input.description === 'string') existing.description = input.description
      if (typeof input.activeForm === 'string') existing.activeForm = input.activeForm
    }
  }

  return Array.from(tasks.values()).sort((a, b) => a.createdAt - b.createdAt)
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
  const answeredCount = data.questions.filter((_, index) =>
    isQuestionAnswered(data.questions[index]!, drafts[index]),
  ).length
  const canGoBack = currentIndex > 0
  const canGoNext = currentIndex < total - 1
  const canSubmit = data.questions.every((question, index) =>
    isQuestionReadyForSubmit(question, drafts[index]),
  )
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
                  const tooltipText = opt.description
                    ? `${opt.label}\n${opt.description}`
                    : opt.label
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
                  <LobeInput
                    value={currentDraft.otherText ?? ''}
                    onChange={(e) => handleOtherTextChange(e.target.value)}
                    placeholder={otherInputPlaceholder}
                    disabled={submitted}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="user-question-input-wrap">
              {currentQuestion.multiline ? (
                <LobeTextArea
                  value={currentDraft.text ?? ''}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                  disabled={submitted}
                  rows={5}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  autoFocus
                />
              ) : (
                <LobeInput
                  value={currentDraft.text ?? ''}
                  onChange={(e) => handleTextChange(e.target.value)}
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
          <button
            className="user-question-btn secondary"
            onClick={handleCancel}
            disabled={submitted}
          >
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
            <button
              className="user-question-btn primary"
              onClick={handleSubmit}
              disabled={submitted || !canSubmit}
            >
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

function isQuestionAnswered(
  question: UserQuestionPrompt,
  draft: UserQuestionDraft | undefined,
): boolean {
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

function isQuestionReadyForSubmit(
  question: UserQuestionPrompt,
  draft: UserQuestionDraft | undefined,
): boolean {
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
function UserQuestionDock(
  props: Omit<Parameters<typeof UserQuestionWizard>[0], 'currentIndex' | 'onCurrentIndexChange'>,
) {
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
