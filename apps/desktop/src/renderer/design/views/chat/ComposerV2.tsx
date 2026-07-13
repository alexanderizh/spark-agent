import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './ComposerInlineMenus.less'
import type { ReactNode, RefObject } from 'react'
import { Button, Dropdown, Popover, Tag as LobeTag, Tooltip } from '@lobehub/ui'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'
import { MentionPopover, type MentionCandidate } from '../../components/MentionPopover'
import { ComposerActionsMenu } from '../../components/ComposerActionsMenu'
import { AvatarImage } from '../../components/AvatarImage'
import { FileTypeIcon, getFileTypeBadge } from '../../components/FileDisplay'
import { PermissionRequestDetails } from '../../components/PermissionRequestDetails'
import { ProviderLogo } from '../../components/ProviderLogo'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useAppearanceSettings, readAppearance } from '../../hooks/useAppearance'
import { formatShortcut } from '../../hooks/useKeyboard'
import { useToast } from '../../components/Toast'
import {
  buildComposerAttachmentsFromPaths,
  getDataTransferFilePaths,
  hasFileDataTransfer,
} from '../../services/composer-attachments'
import { canReuseComposerSession, canShowComposerWorktreeToggle } from '../chat-session-routing'
import { resolveComposerRunningAgentIds } from '../../services/composer-working-state'
import {
  getPreferredProviderForAdapter,
  getProviderAdapterKind,
  isClaudeAdapter,
  isProviderCompatibleWithAdapter,
} from '../../utils/provider-adapter'
import { getAgentAvatarConfig, hasCustomAvatar, resolveAvatarSrc } from '../../avatar'
import { countExistingMembers } from '../../teamMembership'
import { normalizeEduAssetUrl, resolveProviderContextWindow } from '@spark/shared'
import { getLastAssistantMessageMarkdown, isLocalCopySlashCommand } from '../chat-copy'
import {
  CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  CLAUDE_AUTO_ROUTER_PROVIDER_NAME,
  CODEX_AUTO_ROUTER_PROVIDER_ID,
  CODEX_AUTO_ROUTER_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  VENDOR_CATALOG,
  isAutoRouterProvider,
  isBuiltInLocalCliProvider,
  isClaudeAutoRouterProvider,
  isRoutingModelConfig,
  type CommandListItem,
  type ManagedAgent,
  type ManagedTeam,
  type ModelProfile,
  type PermissionApprovalDecision,
  type PermissionApprovalRequest,
  type ProviderProfile,
  type SessionChatMode,
  type SessionId,
  type SessionReasoningEffort,
  type SessionGetQueueResponse,
  type SessionQueuedTurn,
  type SessionAttachment,
  type TeamModeConfig,
  type WorkspaceInfo,
  type WorkspaceGitStatusResponse,
  type VendorMeta,
} from '@spark/protocol'
import { EMPTY_COMPOSER_DRAFT } from './ChatComposerTypes'
import { ReasoningMaxParticles } from './ReasoningMaxParticles'
import {
  getProviderPickerLogoSize,
  prioritizeManagedProviderGroups,
  resolveManagedPlatformVendor,
} from './provider-model-picker-utils'
import type {
  AgentAdapter,
  BranchState,
  ComposerAttachment,
  ComposerMenuOption,
  ComposerOptionTone,
  ComposerPrefillPayload,
  ComposerPrefs,
  ComposerDraftSnapshot,
  ContextMenuItem,
  MessageAttachment,
  PermissionModeChoice,
  QueuedMessage,
  ReplyToState,
  SessionRuntimePatch,
  TextEditMenuState,
} from './ChatComposerTypes'
import {
  NO_PROJECT_WORKSPACE_NAME,
  useSessionSidebar,
  type SessionSummary,
} from '../../SessionSidebarContext'
import type { UIMessage } from '../../services/event-mapper'
import { formatTokenCount } from './ChatViewUtils'

type ContextUsageState = {
  estimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  compactedThisTurn: boolean
}

type ContextLedgerSection = {
  label: string
  estimatedTokens: number
  charCount: number
  truncated: boolean
}

type ContextLedgerState = {
  sections: ContextLedgerSection[]
  totalEstimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  usagePercent: number
}

const SAFE_FILE_SCHEME = 'safe-file'
const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'
const COMPOSER_DRAFTS_KEY = 'spark-agent:composer-drafts'
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'
// 用户置顶的斜杠命令：复用通用 settings IPC 持久化（与 custom-commands 同一套机制）
const PINNED_COMMANDS_CATEGORY = 'slash-commands'
const PINNED_COMMANDS_KEY = 'pinned'
// 常用命令名单：在「/ 弹窗」中默认靠前展示（自定义命令 layer==='custom' 也归入此区）
const COMMON_COMMAND_NAMES = new Set(['goal', 'review', 'clear'])
const LOCAL_CLI_MODEL_DISPLAY = 'claude cli'
const LOCAL_CODEX_CLI_MODEL_DISPLAY = 'codex cli'

// 菜单距视口边缘的安全留白，防止紧贴/贴边显示
const CONTEXT_MENU_VIEWPORT_MARGIN = 8

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
  // 钳制后的最终坐标；首次渲染用原始 x/y，layout effect 同步修正避免闪烁
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
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
  useLayoutEffect(() => {
    const el = ref.current
    if (el == null) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.max(
      CONTEXT_MENU_VIEWPORT_MARGIN,
      Math.min(x, window.innerWidth - width - CONTEXT_MENU_VIEWPORT_MARGIN),
    )
    const top = Math.max(
      CONTEXT_MENU_VIEWPORT_MARGIN,
      Math.min(y, window.innerHeight - height - CONTEXT_MENU_VIEWPORT_MARGIN),
    )
    setPos({ left, top })
  }, [x, y])
  return (
    <div
      ref={ref}
      className="action-menu context-action-menu"
      style={{ position: 'fixed', left: pos?.left ?? x, top: pos?.top ?? y, zIndex: 10000 }}
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
          onClick: () => void editTextSelection(target, 'cut'),
        },
        {
          key: 'copy',
          label: '复制',
          icon: <Icons.Copy size={14} />,
          disabled: !hasSelection,
          onClick: () => void editTextSelection(target, 'copy'),
        },
        {
          key: 'paste',
          label: '粘贴',
          icon: <Icons.FilePlus size={14} />,
          onClick: () => void editTextSelection(target, 'paste'),
        },
      )
    } else if (hasSelection) {
      result.push({
        key: 'copy',
        label: '复制',
        icon: <Icons.Copy size={14} />,
        onClick: () => void editTextSelection(target, 'copy'),
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

function FileChipIcon({ path, size }: { path: string; size: number }) {
  if (!getFileTypeBadge(path).icon) return <Icons.File size={size} />
  return <FileTypeIcon filePath={path} size={size} />
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
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('deny-session')}
            >
              会话拒绝
            </button>
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-session')}
            >
              会话允许
            </button>
            <button
              type="button"
              className="composer-approval-btn primary"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-once')}
            >
              {busyDecision === 'allow-once' ? <Icons.Spinner size={13} /> : null}
              允许
            </button>
          </div>
        </div>
        <PermissionRequestDetails request={request} />
      </div>
    </div>
  )
}

/** 上下文进度悬浮弹窗 */
/**
 * context_ledger 分段标签 → 中文展示名 + 配色。
 * 后端 label 见 session.service.ts 的 ledgerSections（英文）。
 */
const CONTEXT_LEDGER_SECTION_META: Record<string, { label: string; color: string }> = {
  'System Prompt': { label: '系统提示', color: '#8a8f98' },
  'Skill Prompt': { label: '技能', color: '#d99a2b' },
  'Project Context': { label: '项目上下文', color: '#2f9e6b' },
  'Conversation History': { label: '对话历史', color: '#3f7d8c' },
  'User Message': { label: '用户消息', color: '#7c5cd6' },
  Attachments: { label: '附件', color: '#c2569b' },
}

function describeLedgerSection(label: string): { label: string; color: string } {
  return CONTEXT_LEDGER_SECTION_META[label] ?? { label, color: '#9aa0a6' }
}

function ContextMeterWithPopup({
  contextRatio,
  contextUsedTokens,
  contextWindow,
  ledger,
  softLimitTokens,
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
  ledger: ContextLedgerState | null
  softLimitTokens: number
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

  // 预警阈值以「软上限」（自动压缩触发线，约窗口的 70%）为基准，而非硬窗口，
  // 这样 80% / 100% 的提示能对应「即将 / 已达压缩线」，而非显示给用户的「X% 已用」。
  const softLimit = softLimitTokens > 0 ? softLimitTokens : Math.floor(contextWindow * 0.7)
  const softUsedRatio = softLimit > 0 ? contextUsedTokens / softLimit : 0
  const isWarning = softUsedRatio >= 0.8
  const isCritical = softUsedRatio >= 1

  // 分段明细：按 token 倒序，过滤空段，附带中文标签 + 配色。
  const ledgerSections = (ledger?.sections ?? [])
    .map((section) => {
      const meta = describeLedgerSection(section.label)
      return { ...section, displayLabel: meta.label, color: meta.color }
    })
    .filter((section) => section.estimatedTokens > 0)
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
  // 彩条分母：以上下文窗口为基准，保证「已用部分 + 剩余灰条」拼成完整窗口。
  const barDenominator = Math.max(contextWindow, contextUsedTokens, 1)

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
              <span>上下文用量</span>
            </div>
            <span
              className={`context-popup-pct ${isCritical ? 'pct-critical' : isWarning ? 'pct-warn' : ''}`}
            >
              {contextRatio}% 已用
            </span>
          </div>

          <div className="context-popup-summary">
            <span className="context-popup-summary-main">
              {formatTokenCount(contextUsedTokens)}
            </span>
            <span className="context-popup-summary-sub">
              / {formatTokenCount(contextWindow)} Tokens
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

          {/* 分段彩条：每段宽度按其 token 占整个上下文窗口的比例 */}
          <div className="context-popup-bar segmented">
            {ledgerSections.map((section) => (
              <div
                key={section.label}
                className="context-popup-bar-seg"
                style={{
                  width: `${(section.estimatedTokens / barDenominator) * 100}%`,
                  background: section.color,
                }}
                title={`${section.displayLabel} · ${formatTokenCount(section.estimatedTokens)}`}
              />
            ))}
          </div>

          {ledgerSections.length > 0 ? (
            <div className="context-popup-breakdown">
              {ledgerSections.map((section) => (
                <div key={section.label} className="context-popup-seg-row">
                  <span className="context-popup-seg-dot" style={{ background: section.color }} />
                  <span className="context-popup-seg-label">{section.displayLabel}</span>
                  <span className="context-popup-seg-value">
                    {formatTokenCount(section.estimatedTokens)}
                  </span>
                </div>
              ))}
              <div className="context-popup-seg-row context-popup-seg-total">
                <span className="context-popup-seg-dot is-transparent" />
                <span className="context-popup-seg-label">剩余</span>
                <span className="context-popup-seg-value">
                  {formatTokenCount(Math.max(0, contextWindow - contextUsedTokens))}
                </span>
              </div>
            </div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  )
}

/**
 * EmptyChatHero — 空对话欢迎页（仅在还没有 active session 时显示）
 * 设计：渐变消失的网格背景 + 居中标题 + 居中输入区
 */

export function ComposerV2({
  session,
  workspace,
  providers,
  agents,
  selectedProviderId,
  setSelectedProviderId,
  branchState,
  contextInputTokens,
  contextUsage,
  contextLedger,
  isWorking,
  messages,
  approvalRequest,
  onApprovalClose,
  onCreateSession,
  onUpdateSession,
  onCommandComplete,
  onSwitchBranch,
  onRefreshBranches,
  onCreateBranch,
  onCancelSession,
  onSent,
  showProjectPicker,
  preferSelectedWorkspace,
  workspaces,
  activeWorkspaceId,
  onPickProject,
  onUseNoProject,
  onSwitchWorkspace,
  teamConfig,
  activeTeamName,
  effectiveHostAgentId,
  onChangeTeamConfig,
  onOpenTeamInspector,
  runningTeamAgentIds = [],
  onOpenSkillStore,
  hideBranchSelect = false,
  replyTo,
  onClearReply,
  focusTrigger = 0,
  resendRequest = null,
  onDispatchStateChange,
  onModelSwitch,
  paletteCommandRequest = null,
}: {
  session: SessionSummary | null
  workspace: WorkspaceInfo | null
  providers: ProviderProfile[]
  agents: ManagedAgent[]
  selectedProviderId: string
  setSelectedProviderId: (providerId: string) => void
  teamConfig: TeamModeConfig
  /** 当前会话关联的已保存团队名（临时团队为 null）；透传给 AgentPicker 的 trigger/标题，
   *  避免依赖弹窗 open 时才加载 teams 列表导致的闪烁/误判。 */
  activeTeamName?: string | null
  /** 团队模式下解析后的 host agent id（用于 sendTurn 指派） */
  effectiveHostAgentId: string | null
  onChangeTeamConfig: (patch: Partial<TeamModeConfig>) => void
  onOpenTeamInspector: () => void
  onOpenSkillStore: (tab: 'installed' | 'create') => void
  runningTeamAgentIds?: string[]
  hideBranchSelect?: boolean
  branchState: BranchState
  contextInputTokens: number
  contextUsage: ContextUsageState | null
  contextLedger: ContextLedgerState | null
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
  // 分支选择器每次展开时调用，触发一次分支列表刷新（避免终端手动切分支后界面不同步）
  onRefreshBranches?: () => void
  onCreateBranch?: (branch: string) => Promise<void>
  onCancelSession: (sessionId: SessionId) => void | Promise<void>
  onSent: (sessionId: SessionId) => void
  // 项目选择器相关（仅在空会话下使用）
  showProjectPicker?: boolean
  preferSelectedWorkspace?: boolean
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
  onModelSwitch?: (change: { fromModel: string; toModel: string; afterMessageId: string }) => void
  paletteCommandRequest?: { id: number; commandText: string } | null
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
  const isNewSessionComposer = canShowComposerWorktreeToggle({
    sessionId: session?.id,
    sessionMessageCount: session == null ? undefined : (session.turnCount ?? session.messageCount),
    sessionStatus: session?.status,
    loadedMessageCount: messages.length,
  })
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
  // 用户置顶的命令 id 列表（持久化到 settings；顺序即展示顺序）
  const [pinnedCmdIds, setPinnedCmdIds] = useState<string[]>([])
  const pinnedLoadedRef = useRef(false)
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
    initialPrefs.reasoningEffort ?? 'max',
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
  // 已消费的 resend requestId。resend effect 的依赖里有 setValue/setAttachments，
  // 它们随 session 切换（draftBucketKey 变化）而重建，会导致已应用过的 resend 在
  // 切到别的会话时被再次触发，把旧 payload 写进新会话草稿。用 ref 记录已处理的 id，
  // 同一个 requestId 只应用一次。
  const consumedResendIdRef = useRef<number | null>(null)
  // ── Input history (↑↓) ──
  const sentHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef('') // preserves the in-progress draft when user starts browsing history
  const dragDepthRef = useRef(0)
  const [fileDropActive, setFileDropActive] = useState(false)
  // ── Escape double-press interrupt ──
  const escapeTimestampRef = useRef(0)
  const [escapeConfirm, setEscapeConfirm] = useState(false)
  const { invoke: sendTurn } = useIpcInvoke('session:submit-turn')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: savePastedImage } = useIpcInvoke('file:save-pasted-image')
  const { invoke: prepareImagePreview } = useIpcInvoke('file:prepare-image-preview')
  const { invoke: statFileKind } = useIpcInvoke('file:stat-kind')
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
  const sessionProvider =
    session?.providerProfileId != null
      ? compatibleProviders.find((item) => item.id === session.providerProfileId)
      : undefined
  const sessionModelProvider = findProviderForModel(compatibleProviders, session?.modelId)
  const concreteSessionModelProvider = findConcreteProviderForModel(providers, session?.modelId)
  const sessionProviderMatchesModel =
    session?.modelId == null ||
    session.modelId.trim().length === 0 ||
    providerSupportsModel(sessionProvider, session.modelId)
  const shouldPreferConcreteModelProvider =
    concreteSessionModelProvider != null &&
    session?.modelId != null &&
    session.modelId.trim().length > 0 &&
    (sessionProvider == null || sessionProvider.id !== concreteSessionModelProvider.id) &&
    (!sessionProviderMatchesModel || isAutoRouterProvider(sessionProvider))
  const draftProvider =
    session == null ? compatibleProviders.find((item) => item.id === selectedProviderId) : undefined
  const selectedProvider =
    (shouldPreferConcreteModelProvider ? concreteSessionModelProvider : undefined) ??
    (sessionProviderMatchesModel ? sessionProvider : undefined) ??
    sessionModelProvider ??
    sessionProvider ??
    draftProvider ??
    compatibleProviders.find((item) => item.isDefault) ??
    compatibleProviders[0]
  const modelOptions = useMemo(() => {
    if (selectedProvider == null) return []
    const configured = selectedProvider.modelIds.length
      ? selectedProvider.modelIds
      : selectedProvider.defaultModel
        ? [selectedProvider.defaultModel]
        : []
    const extras = [session?.modelId ?? '', draftModelId].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
    return Array.from(new Set([...configured, ...extras]))
  }, [draftModelId, selectedProvider, session?.modelId])
  const providerDefaultModel = getProviderDefaultModel(
    selectedProvider,
    selectedProvider?.modelIds[0],
  )
  const sessionModelId =
    normalizeModelForProvider(session?.modelId, selectedProvider) ||
    (session?.modelId?.trim() ?? '')
  const draftModelForProvider =
    normalizeModelForProvider(draftModelId, selectedProvider) || draftModelId.trim()
  const effectiveModelId =
    selectedProvider != null && isLocalCliProvider(selectedProvider)
      ? session != null
        ? sessionModelId || providerDefaultModel
        : draftModelForProvider || providerDefaultModel
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
  const selectedProviderAdapter =
    selectedProvider != null ? getProviderAdapterKind(selectedProvider) : adapter
  const contextWindow = resolveProviderContextWindow(
    selectedProvider?.supportsMillionContext === true,
    selectedProvider?.contextWindow,
  )
  const draftBucketKey = session?.id ?? 'draft:new'
  const sessionWorkspaceId = session?.workspaceIds[0] ?? null
  const canReuseCurrentSession = canReuseComposerSession({
    sessionId: session?.id,
    sessionWorkspaceId,
    activeWorkspaceId,
    preferSelectedWorkspace,
  })
  const draftState = drafts[draftBucketKey] ?? EMPTY_COMPOSER_DRAFT
  const value = draftState.value
  const attachments = draftState.attachments
  const manualExpanded = draftState.manualExpanded
  // 已使用 token 优先采用 context_ledger 的完整分段总和（含对话历史 / 项目上下文 / 附件），
  // 它比 context_usage.estimatedTokens（仅统计本轮系统提示 + 用户消息）更准确。
  const contextUsedTokens =
    contextLedger?.totalEstimatedTokens ?? contextUsage?.estimatedTokens ?? contextInputTokens
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
  const needsTeamSelection = isNewSessionComposer && teamConfig.enabled && teamConfig.teamId == null
  const canSubmit =
    (value.trim().length > 0 || attachments.length > 0) &&
    selectedProvider != null &&
    effectiveModelId.length > 0 &&
    !needsTeamSelection
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

  useEffect(() => {
    if (session == null || session.status === 'running' || selectedProvider == null) return

    const nextAdapter = getProviderAdapterKind(selectedProvider)
    const nextModel =
      effectiveModelId || getProviderDefaultModel(selectedProvider, selectedProvider.modelIds[0])
    const nextPermissionMode =
      session.agentAdapter === nextAdapter
        ? effectivePermissionMode
        : (getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask')
    const sessionModel = session.modelId?.trim() ?? ''
    const needsProvider = session.providerProfileId !== selectedProvider.id
    const needsModel = nextModel.trim().length > 0 && sessionModel !== nextModel
    const needsAdapter = session.agentAdapter !== nextAdapter
    const nextPermissionOptions = getPermissionModeOptions(nextAdapter)
    const needsPermission =
      needsAdapter &&
      !nextPermissionOptions.some((option) => option.value === session.permissionMode)

    if (!needsProvider && !needsModel && !needsAdapter && !needsPermission) return

    setDraftAdapter(nextAdapter)
    setSelectedProviderId(selectedProvider.id)
    setDraftModelId(nextModel)
    if (needsAdapter || needsPermission) setDraftPermissionMode(nextPermissionMode)
    writeComposerPrefs({
      adapter: nextAdapter,
      providerProfileId: selectedProvider.id,
      modelId: nextModel,
      permissionMode:
        needsAdapter || needsPermission ? nextPermissionMode : effectivePermissionMode,
    })
    void persistRuntimePatch({
      providerProfileId: selectedProvider.id,
      modelId: nextModel || null,
      agentAdapter: nextAdapter,
      ...(needsAdapter || needsPermission ? { permissionMode: nextPermissionMode } : {}),
    }).catch((err) => {
      console.warn('[ComposerV2] failed to reconcile session runtime provider/model', err)
    })
  }, [
    effectiveModelId,
    effectivePermissionMode,
    persistRuntimePatch,
    selectedProvider,
    session,
    setSelectedProviderId,
  ])

  const getCurrentRuntimePatch = useCallback(
    (): SessionRuntimePatch => ({
      ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
      modelId: effectiveModelId || null,
      agentId: effectiveAgentId,
      agentAdapter: selectedProviderAdapter,
      permissionMode: effectivePermissionMode,
      chatMode: effectiveMode,
      reasoningEffort: effectiveReasoning,
    }),
    [
      effectiveAgentId,
      effectiveMode,
      effectiveModelId,
      effectivePermissionMode,
      effectiveReasoning,
      selectedProviderAdapter,
      selectedProvider?.id,
    ],
  )

  const mapQueuedTurns = (turns: SessionQueuedTurn[]): QueuedMessage[] =>
    turns.map((turn) => ({
      id: turn.turnId,
      turnId: turn.turnId,
      content: turn.message,
      enqueuedAt: turn.enqueuedAt,
      attachments: (turn.attachments ?? []).map((a, i) => ({
        id: `${turn.turnId}-${i}`,
        type: a.type,
        path: a.path,
        name: getFileNameFromPath(a.path),
      })),
    }))

  const applyQueueState = useCallback(
    (snapshot: SessionGetQueueResponse | null | undefined) => {
      if (snapshot == null || snapshot.sessionId !== session?.id) return
      setQueuedMessages(mapQueuedTurns(snapshot.queuedTurns))
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
      } catch (err) {
        // IPC 失败时不主动清空 UI 队列：保留 useState 旧值，等
        // stream:session:queue-changed 事件自然恢复。否则用户会在
        // 网络抖动 / main 进程短暂重启时看到队列凭空消失。
        console.warn('[ChatView] refreshQueueState failed, keeping previous queue snapshot', err)
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
    // 高度范围：折叠态 76-280px（hero 状态下 padding 上下会撑出更大的视觉高度），
    // 展开态 240-520px —— 展开后给足空间，长 prompt 能直接看完，不必依赖滚动。
    // 关键点：minHeight 留一个能容纳一行文字 + 一点 padding 的值，
    // 避免空 textarea 看起来永远是一坨；maxHeight 给得宽一些，常规长 prompt 都能直接展示完，
    // 不需要靠滚动条来回看。
    const minHeight = manualExpanded ? 240 : 100
    const maxHeight = manualExpanded ? 520 : 280

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
          let sessionId = createWorktree || !canReuseCurrentSession ? null : (session?.id ?? null)
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
              agentAdapter: selectedProviderAdapter,
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
        let targetSessionId =
          createWorktree || !canReuseCurrentSession ? null : (session?.id ?? null)
        if (targetSessionId == null) {
          targetSessionId = await onCreateSession({
            ...(selectedProvider?.id !== undefined
              ? { providerProfileId: selectedProvider.id }
              : {}),
            modelId: effectiveModelId,
            agentId: effectiveAgentId,
            agentAdapter: selectedProviderAdapter,
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
      selectedProviderAdapter,
      messages,
      writeClipboardText,
      sendTurn,
      session?.id,
      canReuseCurrentSession,
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
      const newAttachments = await buildComposerAttachmentsFromPaths(filePaths, {
        idPrefix: 'file',
        prepareImagePreview,
      })
      appendAttachments(newAttachments)
    } catch (err) {
      console.error('添加附件失败', err)
      toast.error(err instanceof Error ? err.message : '添加附件失败')
    }
  }, [appendAttachments, openFileDialog, prepareImagePreview, toast])

  const handleDropFilePaths = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return
      try {
        const newAttachments = await buildComposerAttachmentsFromPaths(filePaths, {
          idPrefix: 'drop',
          prepareImagePreview,
          statFileKind,
        })
        appendAttachments(newAttachments)
      } catch (err) {
        console.error('拖拽添加附件失败', err)
        toast.error(err instanceof Error ? err.message : '拖拽添加附件失败')
      }
    },
    [appendAttachments, prepareImagePreview, statFileKind, toast],
  )

  /**
   * 「添加相关文件或目录」：选中文件或文件夹后挂到输入框，发送时仅作为上下文路径引用传给 Agent
   * （后端不会读取内容，只是把路径写进 prompt ledger；目录还会加入 agent 可访问目录表）。
   * 与「添加文件或图片」的区别：这里支持目录，且明确是"引用而非上传"的语义。
   */
  const handleAddContextFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        title: '添加相关文件或目录',
        multiple: true,
        allowDirectories: true,
      })
      const filePaths = selected.filePaths ?? (selected.filePath != null ? [selected.filePath] : [])
      if (selected.canceled || filePaths.length === 0) return
      const newAttachments = await buildComposerAttachmentsFromPaths(filePaths, {
        idPrefix: 'ctx',
        prepareImagePreview,
        statFileKind,
      })
      appendAttachments(newAttachments)
    } catch (err) {
      console.error('添加相关文件或目录失败', err)
      toast.error(err instanceof Error ? err.message : '添加相关文件或目录失败')
    }
  }, [appendAttachments, openFileDialog, prepareImagePreview, statFileKind, toast])

  useEffect(() => {
    const resetDragState = () => {
      dragDepthRef.current = 0
      setFileDropActive(false)
    }
    const shouldHandle = (event: DragEvent) => !sending && hasFileDataTransfer(event.dataTransfer)

    const handleDragEnter = (event: DragEvent) => {
      if (!shouldHandle(event)) return
      event.preventDefault()
      dragDepthRef.current += 1
      setFileDropActive(true)
    }
    const handleDragOver = (event: DragEvent) => {
      if (!shouldHandle(event)) return
      event.preventDefault()
      if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'copy'
      setFileDropActive(true)
    }
    const handleDragLeave = (event: DragEvent) => {
      if (!hasFileDataTransfer(event.dataTransfer)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setFileDropActive(false)
    }
    const handleDrop = (event: DragEvent) => {
      if (!shouldHandle(event)) {
        resetDragState()
        return
      }
      event.preventDefault()
      const filePaths = getDataTransferFilePaths(event.dataTransfer)
      resetDragState()
      void handleDropFilePaths(filePaths)
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('blur', resetDragState)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('blur', resetDragState)
    }
  }, [handleDropFilePaths, sending])

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
    setQueuedMessages(mapQueuedTurns(res.queuedTurns))
  }

  const handleEditQueuedMessage = async (message: QueuedMessage) => {
    if (session?.id == null) return
    setValue(message.content)
    if (message.attachments.length > 0) setAttachments(message.attachments)
    const res = await cancelQueuedTurn({ sessionId: session.id, turnId: message.turnId })
    setQueuedMessages(mapQueuedTurns(res.queuedTurns))
    queueMicrotask(() => {
      const el = textareaRef.current
      if (el == null) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }

  const handleSendQueuedNow = async (message: QueuedMessage) => {
    if (session?.id == null) return
    const res = await sendQueuedTurnNow({ sessionId: session.id, turnId: message.turnId })
    setQueuedMessages(mapQueuedTurns(res.queuedTurns))
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

  // 排序：置顶区 → 常用区 → 其余（按原分组顺序）
  const groupedSlashCmds = (() => {
    // 1) 置顶区：按 pinnedCmdIds 顺序，保留过滤后仍存在的命令
    const pinnedSet = new Set(pinnedCmdIds)
    const pinnedCmds = pinnedCmdIds
      .map((id) => filteredSlashCmds.find((c) => c.id === id))
      .filter((c): c is CommandListItem => c != null)
    // 已展示在置顶区的，不再重复出现在常用/其余区
    const remaining = filteredSlashCmds.filter((c) => !pinnedSet.has(c.id))

    // 2) 常用区：名单内 + 自定义命令（layer==='custom'）
    const commonCmds = remaining.filter(
      (c) => COMMON_COMMAND_NAMES.has(c.name) || c.layer === 'custom',
    )
    const restCmds = remaining.filter((c) => !COMMON_COMMAND_NAMES.has(c.name) && c.layer !== 'custom')

    // 3) 其余：按原 SLASH_GROUP_ORDER 分组
    const restMap = new Map<string, CommandListItem[]>()
    for (const cmd of restCmds) {
      const arr = restMap.get(cmd.group) ?? []
      arr.push(cmd)
      restMap.set(cmd.group, arr)
    }
    const restGroups = SLASH_GROUP_ORDER.flatMap((key) => {
      const cmds = restMap.get(key)
      return cmds && cmds.length > 0 ? [{ key, label: SLASH_GROUP_LABELS[key] ?? key, cmds }] : []
    })

    const groups: Array<{ key: string; label: string; cmds: CommandListItem[] }> = []
    if (pinnedCmds.length > 0) groups.push({ key: 'pinned', label: '已置顶', cmds: pinnedCmds })
    if (commonCmds.length > 0) groups.push({ key: 'common', label: '常用', cmds: commonCmds })
    groups.push(...restGroups)
    return groups
  })()

  const flatSlashList = groupedSlashCmds.flatMap((g) => g.cmds)

  const openSlashPopup = useCallback(async () => {
    try {
      const res = await window.spark.invoke('command:list', {})
      setSlashCmds(res.commands ?? [])
    } catch {
      // keep the previous command cache if refresh fails
    }
    setSlashOpen(true)
    setSlashIndex(0)
  }, [])

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

  // 持久化置顶命令 id 列表（settings IPC → SQLite）
  const persistPinnedCmdIds = useCallback(async (ids: string[]) => {
    try {
      await window.spark.invoke('settings:set', {
        category: PINNED_COMMANDS_CATEGORY,
        key: PINNED_COMMANDS_KEY,
        value: JSON.stringify(ids),
      })
    } catch {
      // 持久化失败不影响当前会话内的置顶体验
    }
  }, [])

  // 首次打开斜杠弹窗时加载已置顶命令
  useEffect(() => {
    if (pinnedLoadedRef.current) return
    pinnedLoadedRef.current = true
    void (async () => {
      try {
        const res = await window.spark.invoke('settings:get', {
          category: PINNED_COMMANDS_CATEGORY,
          key: PINNED_COMMANDS_KEY,
        })
        const raw = res?.value
        if (typeof raw === 'string' && raw.length > 0) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            setPinnedCmdIds(parsed.filter((id): id is string => typeof id === 'string'))
          }
        }
      } catch {
        // 读取失败按空列表处理
      }
    })()
  }, [persistPinnedCmdIds])

  /** 切换某命令的置顶状态：已置顶则取消，否则置顶到列表头部 */
  const togglePinSlashCmd = useCallback(
    (cmdId: string) => {
      setPinnedCmdIds((prev) => {
        const next = prev.includes(cmdId) ? prev.filter((id) => id !== cmdId) : [cmdId, ...prev]
        void persistPinnedCmdIds(next)
        return next
      })
    },
    [persistPinnedCmdIds],
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

  const composerHighlightParts = useMemo(() => {
    const agentNames = teamConfig.enabled
      ? new Set(mentionCandidates.map((candidate) => candidate.name))
      : new Set<string>()
    const parts: Array<{ text: string; kind?: 'agent' | 'skill' }> = []
    const tokenPattern = /(^|\s)([@/])([^\s@/]+)/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = tokenPattern.exec(value)) != null) {
      const prefix = match[1] ?? ''
      const marker = match[2] ?? ''
      const name = match[3] ?? ''
      const tokenStart = match.index + prefix.length
      const tokenEnd = tokenStart + marker.length + name.length
      const kind = marker === '@' && agentNames.has(name) ? 'agent' : 'skill'

      if (tokenStart > lastIndex) parts.push({ text: value.slice(lastIndex, tokenStart) })
      parts.push({ text: value.slice(tokenStart, tokenEnd), kind })
      lastIndex = tokenEnd
    }

    if (lastIndex < value.length) parts.push({ text: value.slice(lastIndex) })
    if (parts.length === 0) parts.push({ text: value.length > 0 ? value : ' ' })
    return parts
  }, [mentionCandidates, teamConfig.enabled, value])

  /** 仅当存在 @agent / /skill 等待高亮 token 时才启用透明 textarea + 叠加层 */
  const hasComposerTokenHighlights = useMemo(
    () => composerHighlightParts.some((part) => part.kind != null),
    [composerHighlightParts],
  )

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
      // 团队模式：`@` 留给 Agent mention；非团队模式：`@` 与 `/` 等价，都触发命令菜单
      const hasSlashLead = next.startsWith('/')
      const hasAtLead = next.startsWith('@')
      if (hasSlashLead || (hasAtLead && !teamConfig.enabled)) {
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
      // 从光标向前找最近的 `@`：输入 `@` 即触发，不再要求前面是行首/空白；中间不能含空白
      const upto = next.slice(0, caret)
      const match = upto.match(/@([^\s@]*)$/)
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

  // Command palette can be opened from the chat composer with Cmd/Ctrl+F; selecting
  // a session command should fill the composer instead of executing immediately.
  const lastPaletteCommandRequestIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (paletteCommandRequest == null) return
    if (paletteCommandRequest.id === lastPaletteCommandRequestIdRef.current) return
    lastPaletteCommandRequestIdRef.current = paletteCommandRequest.id

    const { commandText } = paletteCommandRequest
    setValue(commandText)
    setSlashOpen(false)
    setSlashFilter('')
    setSlashIndex(0)
    setTextEditMenu(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el == null) return
      el.focus()
      const caret = commandText.length
      el.setSelectionRange(caret, caret)
    })
  }, [paletteCommandRequest, setValue])

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
    const previousModel = effectiveModelId.trim()
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
      const afterMessageId = messages.at(-1)?.id
      if (afterMessageId != null && previousModel.length > 0 && previousModel !== nextModel) {
        onModelSwitch?.({ fromModel: previousModel, toModel: nextModel, afterMessageId })
      }
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
    const previousModel = effectiveModelId.trim()

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
      const afterMessageId = messages.at(-1)?.id
      if (afterMessageId != null && previousModel.length > 0 && previousModel !== nextModel) {
        onModelSwitch?.({ fromModel: previousModel, toModel: nextModel, afterMessageId })
      }
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
    const agentReasoning = normalizeComposerReasoningEffort(agent.reasoningEffort) ?? 'max'
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

  useEffect(() => {
    if (!isNewSessionComposer || !teamConfig.enabled) return
    const hostAgentId =
      agents.find((agent) => agent.id === teamConfig.hostAgentId)?.id ??
      agents.find((agent) => teamConfig.memberAgentIds.includes(agent.id))?.id
    if (hostAgentId != null) void applyAgentRuntime(hostAgentId)
    // 团队启动栏位于 Composer 外部，这里把 Host 选择同步回新会话草稿运行时。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewSessionComposer, teamConfig.enabled, teamConfig.hostAgentId, teamConfig.teamId])

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
    // 同一 requestId 已应用过则跳过：避免切会话后 setValue/setAttachments 重建触发
    // effect 重跑，把已发送过的重发内容再次写进别的会话草稿。
    if (consumedResendIdRef.current === current.requestId) return
    consumedResendIdRef.current = current.requestId
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
    const previousModel = effectiveModelId.trim()
    setDraftModelId(modelId)
    writeComposerPrefs({
      ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
      modelId,
    })
    if (session != null) {
      await persistRuntimePatch({ modelId })
      const afterMessageId = messages.at(-1)?.id
      if (afterMessageId != null && previousModel.length > 0 && previousModel !== modelId) {
        onModelSwitch?.({ fromModel: previousModel, toModel: modelId, afterMessageId })
      }
    }
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
  const showBranchSelect =
    !hideBranchSelect && branchOptions.length > 0 && branchState.currentBranch != null
  const visibleApprovalRequest =
    approvalRequest != null && !isControlApprovalRequest(approvalRequest) ? approvalRequest : null
  const imageAttachments = attachments.filter((attachment) => attachment.type === 'image')
  const fileAttachments = attachments.filter((attachment) => attachment.type === 'file')
  const directoryAttachments = attachments.filter((attachment) => attachment.type === 'directory')

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
                  className="composer-queue-icon-btn composer-queue-edit-btn"
                  title="编辑"
                  onClick={() => void handleEditQueuedMessage(message)}
                >
                  <Icons.Edit size={14} />
                </button>
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
                    const isPinned = pinnedCmdIds.includes(cmd.id)
                    return (
                      <div
                        key={cmd.id}
                        className={`slash-cmd-item has-pin${idx === slashIndex ? ' selected' : ''}`}
                        onMouseEnter={() => setSlashIndex(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectSlashCmd(cmd)
                        }}
                      >
                        <span className={`slash-cmd-layer layer-${cmd.layer}`}>
                          {cmd.layer === 'sdk'
                            ? 'SDK'
                            : cmd.layer === 'skill'
                              ? '技能'
                              : cmd.layer === 'custom'
                                ? '自定义'
                                : '内置'}
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
                        <button
                          type="button"
                          className={`slash-cmd-pin${isPinned ? ' is-pinned' : ''}`}
                          title={isPinned ? '取消置顶' : '置顶'}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            togglePinSlashCmd(cmd.id)
                          }}
                        >
                          {isPinned ? <Icons.PinFill size={12} /> : <Icons.Pin size={12} />}
                        </button>
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
        {fileDropActive && (
          <div className="composer-file-drop-overlay" aria-live="polite">
            <div className="composer-file-drop-target">
              <Icons.FilePlus size={58} strokeWidth={1.5} />
              <span>拖放文件或文件夹路径到此处</span>
            </div>
          </div>
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
                Host：{activeAgent?.name ?? '平台管理'} · 成员{' '}
                {countExistingMembers(teamConfig.memberAgentIds, agents)}
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
            <div className="composer-reply-box">
              <div className="composer-reply-quote">
                <button
                  type="button"
                  className="composer-reply-quote-close"
                  title="取消回复"
                  onClick={onClearReply}
                >
                  <Icons.X size={12} />
                </button>
                <span className="composer-reply-quote-text">{replyTo.contentPreview}</span>
              </div>
            </div>
          )}

          {(imageAttachments.length > 0 ||
            fileAttachments.length > 0 ||
            directoryAttachments.length > 0) && (
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
                      <FileChipIcon path={attachment.path} size={13} />
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
              {directoryAttachments.length > 0 && (
                <div className="composer-attachment-strip composer-attachment-strip-directory">
                  {directoryAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="composer-attachment-chip composer-directory-chip"
                      title={attachment.path}
                    >
                      <Icons.Folder size={13} />
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        title="移除引用"
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
          <div
            className={`composer-input-shell${hasComposerTokenHighlights ? ' has-input-highlights' : ''}`}
          >
            {hasComposerTokenHighlights && value.length > 0 && (
              <div className="composer-input-highlights" aria-hidden="true">
                {composerHighlightParts.map((part, index) => (
                  <span
                    key={`${index}-${part.kind ?? 'text'}`}
                    className={
                      part.kind === 'agent'
                        ? 'composer-input-token composer-input-token-agent'
                        : part.kind === 'skill'
                          ? 'composer-input-token composer-input-token-skill'
                          : undefined
                    }
                  >
                    {part.text}
                  </span>
                ))}
              </div>
            )}
            <textarea
              className="composer-input"
              ref={textareaRef}
              rows={1}
              placeholder={composerPlaceholder}
              value={value}
              onChange={(event) => handleValueChange(event.target.value)}
              onScroll={(event) => {
                const layer = event.currentTarget.previousElementSibling as HTMLDivElement | null
                if (layer == null) return
                layer.scrollTop = event.currentTarget.scrollTop
                layer.scrollLeft = event.currentTarget.scrollLeft
              }}
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
          </div>
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
            {manualExpanded ? (
              <Icons.ComposerCollapse size={14} />
            ) : (
              <Icons.ComposerExpand size={14} />
            )}
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
                <ComposerBranchSelect
                  branchState={branchState}
                  onChange={onSwitchBranch}
                  {...(onCreateBranch !== undefined ? { onCreateBranch } : {})}
                  {...(onRefreshBranches !== undefined ? { onOpen: onRefreshBranches } : {})}
                />
              )}
            </div>
            <button
              className={`composer-send-round ${sending ? 'is-sending' : ''} ${isWorking ? 'is-stopping' : ''}`}
              title={isWorking ? '停止会话' : needsTeamSelection ? '请先创建并选择团队' : '发送'}
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
            onAddContextFiles={() => void handleAddContextFiles()}
            onInsertSlashCommand={() => {
              // 等同键入 `/`：经 handleValueChange 触发斜杠命令弹窗
              handleValueChange('/')
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            // 仅在发送瞬间禁用（防重复提交）；任务执行中允许继续挂附件/插技能（只改下一轮草稿，不影响运行中的会话）
            disabled={sending}
          />
          {!(isNewSessionComposer && teamConfig.enabled) && (
            <AgentPicker
              agents={agents}
              selectedAgentId={effectiveAgentId}
              onChange={(agentId) => void handleAgentChange(agentId)}
              teamConfig={teamConfig}
              activeTeamName={activeTeamName ?? null}
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
              onDisableTeamMode={() => {
                // 退出团队模式：当前主持人作为单 agent 接续会话（对话历史保留在该 host 的会话里）。
                // 显式把会话运行时同步为该 host，避免 session.agentId 漂移导致退出后落到非主持人。
                const soloAgent =
                  agents.find((a) => a.id === effectiveHostAgentId)?.id ??
                  agents.find((a) => a.id === teamConfig.hostAgentId)?.id ??
                  effectiveAgentId
                onChangeTeamConfig({ enabled: false, teamId: undefined })
                void applyAgentRuntime(soloAgent)
              }}
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
                  maxDiscussionRounds: team.maxDiscussionRounds ?? 6,
                  enablePeerMessaging: team.enablePeerMessaging === true,
                  teamId: team.id,
                })
                // 应用已保存团队：会话适配器/模型跟随该团队主持人配置
                void applyAgentRuntime(team.hostAgentId)
              }}
              disabled={isBusy}
            />
          )}
          <ComposerMenuSelect
            icon={activePermissionOption?.icon ?? <Icons.Shield size={14} />}
            value={effectivePermissionMode}
            label={activePermissionOption?.label ?? '默认权限'}
            title="权限模式"
            // menuHeading={`应如何批准 ${adapter === 'codex' ? 'Codex' : 'Claude'} 操作?`}
            variant="permission"
            animated
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
          <ComposerReasoningSlider
            value={effectiveReasoning}
            options={getReasoningOptions(adapter)}
            disabled={false}
            onChange={handleReasoningChange}
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
            <Icons.Bug size={14} style={{ marginTop: 2 }} />
            <span>调试{effectiveDebugMode ? '中' : ''}</span>
          </button>
          {contextWindow > 0 && (
            <ContextMeterWithPopup
              contextRatio={contextRatio}
              contextUsedTokens={contextUsedTokens}
              contextWindow={contextWindow}
              ledger={contextLedger}
              softLimitTokens={contextLedger?.softLimitTokens ?? contextUsage?.softLimitTokens ?? 0}
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
          <div className="composer-param-tail">
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
                    placeholder="留空自动生成"
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
    </div>
  )
}

/**
 * ComposerSelectLabelTicker — 选择器 trigger 内的"滚动切换"标签。
 *
 * 当 label 变化时，旧值向上滑出、新值从下滑入，形成类似 iOS picker / 老虎机
 * 的纵向滚动动画。仅在 permission variant 下启用（其它选择器的宽度/布局敏感，
 * 暂不动）。
 *
 * 防卡顿要点：
 * - 容器只渲染「当前帧」作为静态主体，撑开宽高
 * - leaving 帧用 position:absolute 脱离文档流，卸载时不触发 layout
 * - entering 用 key 强制重挂载，确保动画每次都重播
 * - 动画只用 transform + opacity，命中 GPU 合成层
 */
function ComposerSelectLabelTicker({ label }: { label: string }) {
  const currentRef = useRef(label)
  const [leaving, setLeaving] = useState<string | null>(null)

  useEffect(() => {
    if (label === currentRef.current) return
    setLeaving(currentRef.current)
    currentRef.current = label
    const timer = window.setTimeout(() => setLeaving(null), 260)
    return () => window.clearTimeout(timer)
  }, [label])

  return (
    <span className="composer-select-label-ticker">
      <span key={label} className="composer-select-label-ticker-item is-current">
        {label}
      </span>
      {leaving != null && (
        <span className="composer-select-label-ticker-item is-leaving">{leaving}</span>
      )}
    </span>
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
  animated = false,
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
  variant?: 'default' | 'permission' | 'enriched'
  animated?: boolean
  onChange: (value: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)
  const isPermissionVariant = variant === 'permission'
  // permission / enriched 两个 variant 共享「新弹窗外观」（内边距 + 圆角 item + hover 过渡）
  const isEnrichedVariant = variant === 'permission' || variant === 'enriched'
  const menuVariantClass = isPermissionVariant
    ? 'permission-menu'
    : variant === 'enriched'
      ? 'enriched-menu'
      : ''
  const itemVariantClass = isPermissionVariant
    ? 'permission-menu-item'
    : variant === 'enriched'
      ? 'enriched-menu-item'
      : ''
  const useTicker = animated && isEnrichedVariant

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-menu-select variant-${variant} tone-${tone} ${align === 'right' ? 'right' : ''}${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}`}
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
        {useTicker ? (
          <ComposerSelectLabelTicker label={label || '未配置'} />
        ) : (
          <span>{label || '未配置'}</span>
        )}
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className={`composer-menu ${menuVariantClass} ${align === 'right' ? 'right' : ''}`}>
          {isEnrichedVariant && menuHeading != null && (
            <div className="composer-menu-heading">{menuHeading}</div>
          )}
          {options.map((option, index) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`composer-menu-item ${itemVariantClass} tone-${option.tone ?? 'default'} ${active ? 'active' : ''}`}
                onClick={() => {
                  setOpen(false)
                  void onChange(option.value)
                }}
              >
                {isPermissionVariant ? (
                  <>
                    <span className="composer-menu-item-label">
                      <span>{option.label}</span>
                    </span>
                    <span className="composer-permission-menu-meta">
                      {active && <Icons.Check className="composer-menu-check" size={14} />}
                      <span>{index + 1}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className={`composer-menu-item-main${option.icon != null ? ' has-icon' : ''}`}
                    >
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
                    {active && <Icons.Check className="composer-menu-check" size={14} />}
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ComposerReasoningSlider({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value: SessionReasoningEffort
  options: Array<{ value: SessionReasoningEffort; label: string }>
  disabled?: boolean
  onChange: (value: SessionReasoningEffort) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const activeOption = options[activeIndex] ?? options[0]
  const maxIndex = Math.max(1, options.length - 1)
  const isMax = value === 'max'
  const edgeInset = 8
  const getInsetPosition = (index: number) => {
    const ratio = index / maxIndex
    return `calc(${ratio * 100}% + ${edgeInset - edgeInset * 2 * ratio}px)`
  }
  const activePosition = getInsetPosition(activeIndex)

  const commitValue = (nextValue: SessionReasoningEffort) => {
    setOpen(false)
    if (nextValue !== value) void onChange(nextValue)
  }

  const moveBy = (delta: number) => {
    const nextIndex = Math.min(maxIndex, Math.max(0, activeIndex + delta))
    const next = options[nextIndex]
    if (next != null) void onChange(next.value)
  }

  const selectByPointer = (clientX: number, rect: DOMRect) => {
    const rawRatio = (clientX - rect.left) / rect.width
    const nextIndex = Math.min(maxIndex, Math.max(0, Math.round(rawRatio * maxIndex)))
    const next = options[nextIndex]
    if (next != null) void onChange(next.value)
  }

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-menu-select composer-reasoning-select variant-enriched ${disabled ? ' is-disabled' : ''}${open ? ' is-open' : ''}${isMax ? ' is-max' : ''}`}
      title={disabled ? '会话运行中不可切换' : '推理强度'}
    >
      <span className="composer-select-icon">
        <Icons.Brain size={14} />
      </span>
      <button
        type="button"
        className="composer-select-trigger"
        disabled={disabled || options.length === 0}
        title={disabled ? '会话运行中不可切换' : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ComposerSelectLabelTicker label={activeOption?.label ?? value} />
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className={`composer-menu composer-reasoning-menu${isMax ? ' is-max' : ''}`}>
          <div className="composer-reasoning-head">
            <div className="composer-reasoning-title">
              <span>推理强度</span>
              <strong>{activeOption?.label ?? value}</strong>
            </div>
          </div>
          <div className="composer-reasoning-axis" aria-hidden="true">
            <span>更快</span>
            <span>更强</span>
          </div>
          <div
            className="composer-reasoning-slider"
            role="slider"
            tabIndex={0}
            aria-label="推理强度"
            aria-valuemin={0}
            aria-valuemax={maxIndex}
            aria-valuenow={activeIndex}
            aria-valuetext={activeOption?.label ?? value}
            style={{ '--reasoning-fill-width': activePosition } as React.CSSProperties}
            onPointerDown={(event) => {
              if (disabled) return
              event.currentTarget.setPointerCapture(event.pointerId)
              selectByPointer(event.clientX, event.currentTarget.getBoundingClientRect())
            }}
            onPointerMove={(event) => {
              if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
              selectByPointer(event.clientX, event.currentTarget.getBoundingClientRect())
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                event.preventDefault()
                moveBy(-1)
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                event.preventDefault()
                moveBy(1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                const first = options[0]
                if (first != null) void onChange(first.value)
              } else if (event.key === 'End') {
                event.preventDefault()
                const last = options[maxIndex]
                if (last != null) void onChange(last.value)
              }
            }}
          >
            <span className="composer-reasoning-slider-fill" />
            {isMax && <ReasoningMaxParticles />}
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                className={`composer-reasoning-step${index === activeIndex ? ' active' : ''}`}
                style={
                  {
                    '--reasoning-step-left': getInsetPosition(index),
                  } as React.CSSProperties
                }
                title={option.label}
                aria-label={option.label}
                onClick={() => commitValue(option.value)}
              >
                <span className="composer-reasoning-dot" />
              </button>
            ))}
            <span
              className="composer-reasoning-thumb"
              style={{ '--reasoning-step-left': activePosition } as React.CSSProperties}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ComposerBranchSelect — 分支选择器（输入框右下角）
 * 展开时：
 *   - 调用 onOpen（若提供）刷新一次最新分支列表，避免用户在终端手动切分支后界面不同步
 *   - 顶部搜索框可按名称过滤分支
 *   - 底部「创建并检出新分支...」点击后原地变为无边框输入框 + 取消/确定图标按钮
 */
function ComposerBranchSelect({
  branchState,
  onChange,
  onCreateBranch,
  onOpen,
}: {
  branchState: BranchState
  onChange: (branch: string) => void | Promise<void>
  onCreateBranch?: (branch: string) => Promise<void>
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useCloseOnOutside(rootRef, () => setOpen(false), open)

  const currentBranch = branchState.currentBranch ?? ''
  const branches = Array.from(
    new Set(branchState.branches.filter((branch): branch is string => branch.length > 0)),
  )
  const filteredBranches = branches.filter((branch) =>
    branch.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const resetPanel = () => {
    setSearch('')
    setCreating(false)
    setDraft('')
  }

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev
      if (next) {
        resetPanel()
        onOpen?.()
      }
      return next
    })
  }

  const runCreateBranch = async () => {
    const next = draft.trim()
    if (!next || busy || onCreateBranch == null) return
    setBusy(true)
    try {
      await onCreateBranch(next)
      setOpen(false)
      resetPanel()
    } catch {
      // 失败已由上层 toast 提示，保留输入框内容供用户重试
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`composer-select composer-branch-select${open ? ' is-open' : ''}`}
      title="分支"
    >
      <span className="composer-select-icon">
        <Icons.GitBranch size={13} />
      </span>
      <button type="button" className="composer-select-trigger" onClick={handleToggle}>
        <span>{currentBranch || '未配置'}</span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu branch-menu right">
          <div className="git-branch-search">
            <Icons.Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索分支"
              autoFocus
            />
          </div>
          <div className="git-branch-list">
            {filteredBranches.map((branch) => (
              <button
                type="button"
                key={branch}
                className={`git-branch-row ${branch === currentBranch ? 'active' : ''}`}
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  if (branch !== currentBranch) void onChange(branch)
                }}
              >
                <Icons.GitBranch size={14} />
                <span className="git-branch-copy">
                  <span className="git-branch-name truncate">{branch}</span>
                </span>
                {branch === currentBranch && <Icons.Check size={14} />}
              </button>
            ))}
            {filteredBranches.length === 0 && <div className="git-popover-muted">没有匹配分支</div>}
          </div>
          {onCreateBranch != null &&
            (creating ? (
              <div className="git-create-branch-inline">
                <input
                  className="git-create-branch-inline-input"
                  value={draft}
                  autoFocus
                  placeholder="新分支名称"
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runCreateBranch()
                    if (event.key === 'Escape') {
                      setCreating(false)
                      setDraft('')
                    }
                  }}
                />
                <button
                  type="button"
                  className="git-create-branch-inline-btn"
                  title="取消"
                  disabled={busy}
                  onClick={() => {
                    setCreating(false)
                    setDraft('')
                  }}
                >
                  <Icons.X size={13} />
                </button>
                <button
                  type="button"
                  className="git-create-branch-inline-btn confirm"
                  title="创建并检出"
                  disabled={busy || !draft.trim()}
                  onClick={() => void runCreateBranch()}
                >
                  <Icons.Check size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="git-create-branch-btn"
                onClick={() => setCreating(true)}
              >
                <Icons.Plus size={14} />
                <span>创建并检出新分支...</span>
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

  const triggerLabel = selectedProject?.name ?? (isNoProject ? '临时会话' : '选择项目')
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
      ? '当前使用「临时会话」，session 数据走临时目录'
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
  activeTeamName,
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
  /** 当前会话关联的已保存团队名（临时团队为 null）；由父组件异步解析，不依赖弹窗 open。
   *  用于 trigger 文字与弹窗标题，避免依赖弹窗 open 时才加载的 teams 列表导致闪烁/误判。 */
  activeTeamName?: string | null
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
      // 已保存团队的判断基于 teamConfig.teamId（稳定），头像 metadata 优先用 teams 里的 activeTeam（自定义头像所需），
      // 找不到时 metadata=undefined 走默认图标，名字用父组件解析的 activeTeamName 兜底。
      return teamConfig.teamId != null
        ? {
            id: activeTeam?.id ?? teamConfig.teamId,
            metadata: activeTeam?.metadata,
            name: activeTeamName ?? activeTeam?.name ?? '团队',
          }
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
              ? teamConfig.teamId != null
                ? `团队：${activeTeamName ?? '团队'}（主持：${selected?.name ?? '平台管理'}）`
                : `团队模式（当前对话：${selected?.name ?? '平台管理'}）`
              : (selected?.name ?? '平台管理')
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>
          {teamMode && teamConfig.teamId != null && activeTeamName
            ? activeTeamName
            : (selected?.name ?? '平台管理')}
        </span>
        <Icons.ChevronDown size={12} />
      </button>
      {open && (
        <div className="composer-menu composer-agent-menu">
          {lockedTeam ? (
            <div className="composer-roster-readonly">
              <div className="composer-menu-group-title">
                {teamConfig.teamId != null ? '当前团队' : '当前团队（临时）'}
              </div>
              <div className="composer-roster-team-row">
                {teamConfig.teamId != null &&
                activeTeam != null &&
                hasCustomAvatar(activeTeam.metadata) ? (
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
                  {teamConfig.teamId != null
                    ? (activeTeamName ?? activeTeam?.name ?? '团队')
                    : '临时团队'}
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
                <Icons.Lock size={11} /> 会话进行中，团队成员已锁定，仅可切换主持人或退出团队
              </div>
              <div className="composer-menu-divider" />
              <button
                type="button"
                className="composer-menu-item team-mode-entry team-mode-exit"
                title="退出团队模式：当前主持人将作为单 agent 接续本会话，历史不会丢失"
                onClick={() => {
                  setOpen(false)
                  onDisableTeamMode()
                }}
              >
                <span className="composer-menu-item-copy">
                  <span className="composer-menu-item-label">
                    <Icons.X size={14} />
                    <span>退出团队模式（切回单 Agent）</span>
                  </span>
                  <span className="composer-menu-item-desc">
                    保留对话历史，由主持人接续后续对话
                  </span>
                </span>
              </button>
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
                    const teamMemberCount = countExistingMembers(team.memberAgentIds, agents)
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
                            {host && teamMemberCount > 0 ? ' · ' : ''}
                            {teamMemberCount > 0 ? `${teamMemberCount} 成员` : ''}
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
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<'topLeft' | 'topRight'>('topLeft')
  const { invoke: listModels } = useIpcInvoke('model:list')
  const [modelCards, setModelCards] = useState<ModelProfile[]>([])
  const refreshModelCards = useCallback(async () => {
    try {
      const res = await listModels({})
      setModelCards((res as { models?: ModelProfile[] }).models ?? [])
    } catch {
      setModelCards([])
    }
  }, [listModels])
  useEffect(() => {
    let canceled = false
    refreshModelCards().catch(() => {
      if (!canceled) setModelCards([])
    })
    return () => {
      canceled = true
    }
  }, [refreshModelCards])
  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'model' || event.scope === 'provider') void refreshModelCards()
      }) ?? (() => {})
    )
  }, [refreshModelCards])
  const modelNameById = useMemo(() => {
    const entries: Array<[string, string]> = modelCards
      .filter(
        (model) =>
          model.enabled && isAutoRouterProvider(model.providerId) && isRoutingModelCard(model),
      )
      .map((model) => [model.id, model.name] as const)
    return new Map(entries)
  }, [modelCards])
  // 会话对话场景仅展示文本/多模态对话模型，过滤掉图片/语音/视频等多媒体生成模型
  // （它们由内置工具调用，不适合出现在对话模型选择弹窗里）
  const conversationalProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.modelType !== 'image' &&
          provider.modelType !== 'voice' &&
          provider.modelType !== 'video',
      ),
    [providers],
  )
  // 模糊搜索：命中供应商名/厂商名则保留其全部模型，否则只保留模型名命中的
  const normalizedSearch = search.trim().toLowerCase()
  const filteredProviderGroups = prioritizeManagedProviderGroups(
    conversationalProviders
      .map((provider) => {
        const configuredModels = provider.modelIds.length
          ? provider.modelIds
          : provider.defaultModel
            ? [provider.defaultModel]
            : []
        const routeModels = modelCards
          .filter(
            (model) =>
              isAutoRouterProvider(provider) &&
              model.enabled &&
              model.providerId === provider.id &&
              isRoutingModelCard(model),
          )
          .map((model) => model.id)
        const models = Array.from(new Set([...configuredModels, ...routeModels]))
        if (normalizedSearch === '') return { provider, models }
        const vendorName = resolveProviderVendor(provider)?.name ?? ''
        const providerMatches =
          provider.name.toLowerCase().includes(normalizedSearch) ||
          vendorName.toLowerCase().includes(normalizedSearch)
        const matchedModels = providerMatches
          ? models
          : models.filter(
              (modelId) =>
                modelId.toLowerCase().includes(normalizedSearch) ||
                getPickerModelDisplayLabel(provider, modelId, modelNameById)
                  .toLowerCase()
                  .includes(normalizedSearch),
            )
        return { provider, models: matchedModels }
      })
      .filter((group) => group.models.length > 0),
  )
  const selectedProviderById = providers.find((provider) => provider.id === selectedProviderId)
  const selectedProviderByModel = findProviderForModel(conversationalProviders, selectedModelId)
  const selectedProvider =
    (selectedModelId.trim().length === 0 ||
    providerSupportsModel(selectedProviderById, selectedModelId)
      ? selectedProviderById
      : undefined) ??
    selectedProviderByModel ??
    selectedProviderById ??
    conversationalProviders[0] ??
    providers[0]
  const resolvedSelectedProviderId = selectedProvider?.id ?? selectedProviderId
  const label = getPickerModelDisplayLabel(selectedProvider, selectedModelId, modelNameById)
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
        if (disabled || conversationalProviders.length === 0) {
          setOpen(false)
          return
        }
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      popupRender={() => (
        <div className="composer-dropdown-menu composer-model-menu">
          {conversationalProviders.length > 0 && (
            <div className="composer-model-search">
              <Icons.Search size={13} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索模型或供应商"
                autoFocus
              />
            </div>
          )}
          <div className="composer-model-list">
            {conversationalProviders.length === 0 && (
              <div className="composer-menu-empty">未配置</div>
            )}
            {conversationalProviders.length > 0 && filteredProviderGroups.length === 0 && (
              <div className="composer-menu-empty">没有匹配结果</div>
            )}
            {filteredProviderGroups.map(({ provider, models }) => {
              const vendor = resolveProviderVendor(provider)
              return (
                <div key={provider.id} className="composer-model-group">
                  <div className="composer-model-group-title">
                    {vendor && (
                      <span className="composer-model-group-icon">
                        <ProviderLogo
                          vendor={vendor}
                          size={getProviderPickerLogoSize(provider)}
                          shape="rounded"
                        />
                      </span>
                    )}
                    <span>{provider.name}</span>
                  </div>
                  {models.map((modelId) => {
                    const active =
                      provider.id === resolvedSelectedProviderId && modelId === selectedModelId
                    return (
                      <button
                        key={`${provider.id}:${modelId}`}
                        type="button"
                        className={`composer-menu-item ${active ? 'active' : ''}`}
                        onClick={() => {
                          setOpen(false)
                          setSearch('')
                          void onChange(provider.id, modelId)
                        }}
                      >
                        <span>{getPickerModelDisplayLabel(provider, modelId, modelNameById)}</span>
                        {active && <Icons.Check size={14} />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
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
          disabled={disabled || conversationalProviders.length === 0}
          title={disabled ? '会话运行中不可切换' : undefined}
        >
          <span>{label}</span>
          <Icons.ChevronDown size={12} />
        </button>
      </div>
    </Dropdown>
  )
}

export function useCloseOnOutside(
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

// 参数选择栏溢出隐藏：宽度不够时，从最右开始在原地 display:none 各个控件，
// 让 spacer（flex:1）能重新吃满剩余空间，避免视觉上换行/重叠。
// 不能用 overflow:hidden —— 会把 .composer-select 的下拉弹窗一起裁掉。
function useOverflowHide(ref: RefObject<HTMLElement | null>, skipClassNames: string[] = []) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const children = Array.from(el.children) as HTMLElement[]
      const hideable = children.filter((c) => {
        if (c.classList.contains('spacer')) return false
        for (const cn of skipClassNames) if (c.classList.contains(cn)) return false
        return true
      })
      // 先恢复全部，确保宽度变化时能重新计算
      hideable.forEach((c) => {
        if (c.dataset.overflowHidden === '1') {
          c.style.display = c.dataset.prevDisplay ?? ''
          delete c.dataset.overflowHidden
          delete c.dataset.prevDisplay
        }
      })
      // spacer 被 flex:1 撑起 ≥4px 时表示无溢出；否则从最右开始隐藏。
      for (let i = hideable.length - 1; i >= 0; i--) {
        const spacer = el.querySelector(':scope > .spacer') as HTMLElement | null
        if ((spacer?.getBoundingClientRect().width ?? 0) >= 4) break
        const c = hideable[i]
        if (c == null || c.dataset.overflowHidden === '1') continue
        c.dataset.prevDisplay = c.style.display
        c.dataset.overflowHidden = '1'
        c.style.display = 'none'
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // worktree / queued-chip 是条件渲染，子树变化时重新计算
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref, skipClassNames.join('|')])
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
      value: 'claude-auto-edits',
      label: '自动编辑',
      description: '自动批准文件编辑',
      icon: <Icons.Wand size={18} />,
    },
    {
      value: 'claude-auto',
      label: '自动审批',
      description: '使用自动权限策略',
      icon: <Icons.Shield size={18} />,
      tone: 'auto',
    },
    {
      value: 'claude-bypass',
      label: '完全访问',
      description: '完全由 agent 执行',
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
    label: '完全访问',
    description: '可不受限制地访问互联网和您电脑上的任何文件',
    icon: <Icons.AlertTriangle size={18} />,
    tone: 'danger',
  },
]

function encodeToSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${SAFE_FILE_SCHEME}://x/${encoded}`
}

export function resolveComposerImageSrc(filePath: string): string {
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

export async function copyImageFromSrc(src: string): Promise<void> {
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

export function compactQuotePreview(text: string, max = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

export function readSelectedTextWithin(root: HTMLElement): string {
  const selection = window.getSelection?.()
  if (selection == null || selection.isCollapsed) return ''
  const text = selection.toString().trim()
  if (text.length === 0) return ''
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  const contains = (node: Node | null) =>
    node != null && root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode)
  return contains(anchor) || contains(focus) ? text : ''
}

export function getFileNameFromPath(filePath: string): string {
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

export function normalizeComposerReasoningEffort(
  value: unknown,
): SessionReasoningEffort | undefined {
  if (value == null) return undefined
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
    ? value
    : 'max'
}

export function readComposerPrefs(): ComposerPrefs {
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

export function writeComposerPrefs(patch: ComposerPrefs): void {
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

export function getPreferredProvider(
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
  const model = modelId?.trim() ?? ''
  if (isLocalCliProvider(provider)) return model || getProviderDefaultModel(provider)
  if (!model || provider == null) return ''
  const configuredModels = provider.modelIds.length
    ? provider.modelIds
    : provider.defaultModel
      ? [provider.defaultModel]
      : []
  if (configuredModels.length === 0) return model
  return configuredModels.includes(model) ? model : ''
}

function providerSupportsModel(
  provider: ProviderProfile | null | undefined,
  modelId: string | null | undefined,
): boolean {
  const model = modelId?.trim() ?? ''
  if (!model || provider == null) return false
  if (isLocalCliProvider(provider)) return true
  const configuredModels = provider.modelIds.length
    ? provider.modelIds
    : provider.defaultModel
      ? [provider.defaultModel]
      : []
  return configuredModels.length === 0 || configuredModels.includes(model)
}

function findProviderForModel(
  providers: ProviderProfile[],
  modelId: string | null | undefined,
): ProviderProfile | undefined {
  return providers.find((provider) => providerSupportsModel(provider, modelId))
}

function findConcreteProviderForModel(
  providers: ProviderProfile[],
  modelId: string | null | undefined,
): ProviderProfile | undefined {
  return providers.find(
    (provider) => !isAutoRouterProvider(provider) && providerSupportsModel(provider, modelId),
  )
}

export function isLocalCliProvider(provider: ProviderProfile | null | undefined): boolean {
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

const CLAUDE_AUTO_ROUTER_VENDOR: VendorMeta = {
  id: CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  name: CLAUDE_AUTO_ROUTER_PROVIDER_NAME,
  emoji: 'AR',
  color: '#d97757',
  desc: '',
  logoPath: '',
}

const CODEX_AUTO_ROUTER_VENDOR: VendorMeta = {
  id: CODEX_AUTO_ROUTER_PROVIDER_ID,
  name: CODEX_AUTO_ROUTER_PROVIDER_NAME,
  emoji: 'AR',
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
  const managedVendor = resolveManagedPlatformVendor(provider)
  if (managedVendor) return managedVendor
  if (isAutoRouterProvider(provider)) {
    return isClaudeAutoRouterProvider(provider)
      ? CLAUDE_AUTO_ROUTER_VENDOR
      : CODEX_AUTO_ROUTER_VENDOR
  }
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

export function getProviderDefaultModel(
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
  if (provider?.id === LOCAL_CODEX_CLI_PROVIDER_ID) {
    return modelId && modelId !== LOCAL_CODEX_CLI_DEFAULT_MODEL
      ? modelId
      : LOCAL_CODEX_CLI_MODEL_DISPLAY
  }
  if (provider?.id === LOCAL_CLI_PROVIDER_ID) {
    return modelId && modelId !== LOCAL_CLI_DEFAULT_MODEL ? modelId : LOCAL_CLI_MODEL_DISPLAY
  }
  return modelId || provider?.defaultModel || provider?.name || '未配置'
}

function getPickerModelDisplayLabel(
  provider: ProviderProfile | null | undefined,
  modelId: string | null | undefined,
  routeModelNameById: Map<string, string>,
): string {
  const routeName = modelId != null ? routeModelNameById.get(modelId) : undefined
  return routeName ?? getModelDisplayLabel(provider, modelId)
}

function isRoutingModelCard(model: ModelProfile): boolean {
  try {
    const parsed = JSON.parse(model.configJson) as unknown
    return isRoutingModelConfig(parsed)
  } catch {
    return false
  }
}

function getReasoningOptions(
  adapter: AgentAdapter,
): Array<{ value: SessionReasoningEffort; label: string }> {
  if (isClaudeAdapter(adapter)) {
    return [
      { value: 'minimal', label: '极低' },
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
      { value: 'xhigh', label: '超高' },
      { value: 'max', label: 'Max' },
    ]
  }
  return [
    { value: 'minimal', label: '极低' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
    { value: 'xhigh', label: '超高' },
    { value: 'max', label: 'Max' },
  ]
}
