import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './ComposerInlineMenus.less'
import './ComposerAttachments.less'
import { useVoiceIntegrity } from '../../voice/useVoiceIntegrity'
import { useVoiceInput } from '../../voice/useVoiceInput'
import { VoiceMicButton } from '../../voice/VoiceMicButton'
import { VoiceInstallToast } from '../../voice/VoiceInstallToast'
import { useVoiceDownloadConfirmation } from '../../voice/useVoiceDownloadConfirmation'
import { useVoiceInputShortcut } from '../../voice/useVoiceInputShortcut'
import type { ReactNode, RefObject } from 'react'
import { Button, Dropdown, Popover, Tag as LobeTag, Tooltip } from '@lobehub/ui'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'
import { MentionPopover, type MentionCandidate } from '../../components/MentionPopover'
import { ComposerActionsMenu } from '../../components/ComposerActionsMenu'
import { COMPOSER_APPEND_EXTERNAL_TEXT_EVENT } from '../../components/browser/browserChromeShared'
import { AvatarImage } from '../../components/AvatarImage'
import { FileTypeIcon, getFileTypeBadge } from '../../components/FileDisplay'
import { InlinePermissionApproval } from '../../components/InlinePermissionApproval'
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
  isUnresolvableFileDrop,
} from '../../services/composer-attachments'
import { shouldHandleComposerFileDrop } from '../../services/project-folder-drop'
import {
  formatSessionImageOptimizationNotice,
  prepareSessionImageAttachments,
} from '../../services/session-image-attachments'
import { canReuseComposerSession, canShowComposerWorktreeToggle } from '../chat-session-routing'
import { resolveComposerRunningAgentIds } from '../../services/composer-working-state'
import {
  getPreferredProviderForAdapter,
  getPreferredProviderWithAdapterFallback,
  getProviderAdapterKind,
  getCliSparkOverrideProviders,
  isCliSparkConversationProvider,
  isClaudeAdapter,
  isProviderCompatibleWithAdapter,
} from '../../utils/provider-adapter'
import { getAgentAvatarConfig, hasCustomAvatar, resolveAvatarSrc } from '../../avatar'
import { filterProvidersForVisibleUi } from '../../utils/auto-router-ui'
import { countExistingMembers } from '../../teamMembership'
import { normalizeEduAssetUrl, resolveModelContextWindowForProvider } from '@spark/shared'
import { getLastAssistantMessageMarkdown, isLocalCopySlashCommand } from '../chat-copy'
import { projectQueuedTurnsForDisplay } from './internal-turn-message-visibility'
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
  type CliSparkOverride,
  isAutoRouterProvider,
  isBuiltInLocalCliProvider,
  isClaudeAutoRouterProvider,
  isRoutingModelConfig,
  type CommandListItem,
  type ManagedAgent,
  type ManagedTeam,
  type ModelProfile,
  type PermissionApprovalRequest,
  type ProviderProfile,
  type SessionChatMode,
  type SessionId,
  type SessionReasoningEffort,
  type SessionGetQueueResponse,
  type SessionQueuedTurn,
  type SessionAttachment,
  type SessionReferenceCandidate,
  type TeamModeConfig,
  type WorkspaceInfo,
  type WorkspaceGitStatusResponse,
  type VendorMeta,
} from '@spark/protocol'
import { EMPTY_COMPOSER_DRAFT } from './ChatComposerTypes'
import { writeAgentRuntimePrefs } from './composerAgentRuntimePrefs'
import {
  COMPOSER_DRAFT_RESTORE_EVENT,
  clearComposerDraftBuckets,
  clearComposerDraftMapBuckets,
  createComposerDraftWriter,
  gcComposerDraftBuckets,
  readComposerDrafts,
  NEW_SESSION_DRAFT_BUCKET,
  restoreComposerDraftBucket,
  type ComposerDraftMap,
  type ComposerDraftRestoreDetail,
} from './composer-drafts'
import { ComposerBranchSelect } from './BranchPicker'
import { CliProviderModelMenu, type CliSparkProviderGroup } from './CliProviderModelMenu'
import { ComposerReasoningControl } from './ComposerReasoningControl'
import { ComposerSelectLabelTicker } from './ComposerSelectLabelTicker'
import {
  resolveComposerFastMode,
  resolveOpenAIFastModeProvider,
  supportsOpenAIFastModeProvider,
} from './openai-fast-mode'
import { ModelPickerMenuItem } from './ModelPickerMenuItem'
import { resolvePinnedModelEntries, usePinnedModels } from './pinned-models'
import {
  getProviderPickerLogoSize,
  prioritizeManagedProviderGroups,
  resolveAvailableProviderModel,
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
  ComposerSessionReference,
  ContextMenuItem,
  MessageAttachment,
  PermissionModeChoice,
  QueuedMessage,
  ReplyToState,
  SessionRuntimePatch,
  TextEditMenuState,
} from './ChatComposerTypes'
import { COMPOSER_ATTACHMENT_LIMIT } from './ChatComposerTypes'
import { useComposerCodeReferences } from './composer-code-references'
import { useComposerBrowserReferences } from './composer-browser-references'
import type { BrowserElementReference } from '../../components/browser/elementPickerScript'
import { formatBrowserReferenceLine } from './composer-browser-references'
import {
  buildPastedTextAttachment,
  pasteClipboardTextAsPlainText,
  shouldConvertPastedTextToResource,
} from './composer-pasted-text'
import {
  NO_PROJECT_WORKSPACE_NAME,
  useSessionSidebar,
  type SessionSummary,
} from '../../SessionSidebarContext'
import type { UIMessage } from '../../services/event-mapper'
import { formatTokenCount, resolveContextUsedTokens } from './ChatViewUtils'
import { scrollTextareaCaretIntoView } from './composer-caret-scroll'
import {
  buildQuickReplyMessage,
  resolvePendingQuickReplies,
} from '../../services/quick-reply-suggestions'
import { useAppControlComposerPrefill } from './composerAppControl'
import { useSessionReferenceAddControl } from './session-reference-control'
import {
  useInsertToComposer,
  formatCodeReferenceLine,
  type CodeReference,
} from '../../components/code-viewer/composerInsert'
import { QuickReplySuggestions } from './QuickReplySuggestions'
import { CODEX_PERMISSION_MODE_OPTIONS as SHARED_CODEX_PERMISSION_MODE_OPTIONS } from '../../utils/permission-options'
import { isCanvasWorkspace, listSelectableWorkspaces } from '../../workspace-visibility'
import { sortByManualOrderWithinPinnedSections } from '../../sidebar-manual-order'
import {
  settleOptimisticUserSend,
  startOptimisticUserSend,
  type OptimisticUserSendCallbacks,
  type OptimisticUserSendLifecycle,
} from './optimistic-user-messages'
import { createSubmitGate } from './submit-gate'
import {
  resolveComposerPrimaryAction,
  resolveComposerPrimaryActionTitle,
} from './composer-primary-action'
import { RuntimePatchCoordinator } from './runtime-patch-coordinator'
import {
  readCliSparkOverrideCache,
  rememberCliSparkOverride,
} from '../../utils/cli-spark-override-cache'
import { SessionReferencePicker } from './SessionReferencePicker'
import { QueuedTaskList } from './QueuedTaskList'
import { ComposerLexicalInput, type ComposerLexicalInputHandle } from './ComposerLexicalInput'
import { useComposerInputAutoSize } from './useComposerInputAutoSize'
import { useComposerDispatchState } from './useComposerDispatchState'
import {
  getSlashCommandContext,
  isComposerCommandSelectionKey,
  shouldMoveComposerCaretToEndOnArrowDown,
} from './composer-input-keyboard'
import {
  hasSessionReferenceDrag,
  isSessionReferenceDropTarget,
  readSessionReferenceDragPayload,
  type SessionReferenceDragPayload,
} from './session-reference-dnd'
import {
  hasFileExplorerNodeDrag,
  readFileExplorerNodeDragPayload,
} from '../../components/code-viewer/file-explorer/fileExplorerDnd'
import { ComposerDropOverlay } from './ComposerDropOverlay'

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
  target: ComposerLexicalInputHandle,
  action: 'cut' | 'copy',
): Promise<void> {
  target.focus()
  document.execCommand(action)
}

function TextEditContextMenu({
  menu,
  onClose,
  onPasteAsText,
  onPasteAsResource,
}: {
  menu: TextEditMenuState
  onClose: () => void
  /** 右键「粘贴为文本」：无条件按普通文本插入（跳过长度阈值）。 */
  onPasteAsText: (target: ComposerLexicalInputHandle) => void
  /** 右键「粘贴为资源」：无条件把剪贴板文本落盘为 .txt 引用附件（跳过长度阈值）。 */
  onPasteAsResource: () => void
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
          key: 'paste-as-text',
          label: '粘贴为文本',
          icon: <Icons.FilePlus size={14} />,
          onClick: () => onPasteAsText(target),
        },
        {
          key: 'paste-as-resource',
          label: '粘贴为资源',
          icon: <Icons.FileText size={14} />,
          onClick: onPasteAsResource,
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
  }, [hasSelection, isEditable, onPasteAsResource, onPasteAsText, target])
  return <InlineContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />
}

function FileChipIcon({ path, size }: { path: string; size: number }) {
  if (!getFileTypeBadge(path).icon) return <Icons.File size={size} />
  return <FileTypeIcon filePath={path} size={size} />
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
  // W1.1b 联动：SDK resume 路径下 history 是 fallback（recent entries），实际 SDK 内部
  // 维持完整 history。用橙色提示用户 token 显示远低于实际占用。
  'Conversation History (SDK resume fallback)': { label: '对话历史 (SDK 兜底)', color: '#e07b39' },
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
  effectiveDebugMode,
  getRuntimePatchSnapshot,
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
    fastMode?: boolean
    debugMode?: boolean
    cliSparkOverride?: CliSparkOverride | null
    activate?: boolean
  }) => Promise<SessionId | null>
  effectiveDebugMode: boolean
  getRuntimePatchSnapshot: () => SessionRuntimePatch
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
      const runtimePatchSnapshot = getRuntimePatchSnapshot()
      let sid = sessionId
      if (sid == null) {
        if (runtimePatchSnapshot.providerProfileId == null) {
          toast.warning('请先选择 Provider 再执行压缩。')
          return
        }
        sid = await onCreateSession({
          ...(runtimePatchSnapshot.providerProfileId !== undefined
            ? { providerProfileId: runtimePatchSnapshot.providerProfileId }
            : {}),
          ...(typeof runtimePatchSnapshot.modelId === 'string'
            ? { modelId: runtimePatchSnapshot.modelId }
            : {}),
          ...(runtimePatchSnapshot.agentAdapter !== undefined
            ? { agentAdapter: runtimePatchSnapshot.agentAdapter }
            : {}),
          ...(runtimePatchSnapshot.permissionMode !== undefined
            ? { permissionMode: runtimePatchSnapshot.permissionMode }
            : {}),
          ...(runtimePatchSnapshot.chatMode !== undefined
            ? { chatMode: runtimePatchSnapshot.chatMode }
            : {}),
          ...(runtimePatchSnapshot.reasoningEffort !== undefined
            ? { reasoningEffort: runtimePatchSnapshot.reasoningEffort }
            : {}),
          ...(runtimePatchSnapshot.fastMode !== undefined
            ? { fastMode: runtimePatchSnapshot.fastMode }
            : {}),
          debugMode: effectiveDebugMode,
          ...(runtimePatchSnapshot.cliSparkOverride !== undefined
            ? { cliSparkOverride: runtimePatchSnapshot.cliSparkOverride }
            : {}),
        })
        if (sid == null) {
          toast.error('创建会话失败。')
          return
        }
      }
      const res = await window.spark.invoke('command:execute', {
        sessionId: sid,
        message: '/compact',
        ...runtimePatchSnapshot,
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
    effectiveDebugMode,
    getRuntimePatchSnapshot,
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
  onFetchBranches,
  onCreateBranch,
  onCheckoutBranchTag,
  onCreateBranchFromTag,
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
  onResendConsumed,
  dispatching,
  onDispatchStateChange,
  optimisticUserSendCallbacks,
  onOptimisticQueueStateChange,
  onOptimisticQueueTurnCancelled,
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
    fastMode?: boolean
    debugMode?: boolean
    cliSparkOverride?: CliSparkOverride | null
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
    fastMode?: boolean
    debugMode?: boolean
    cliSparkOverride?: CliSparkOverride | null
  }) => Promise<void>
  onCommandComplete: (session: SessionSummary) => void
  onSwitchBranch: (branch: string) => Promise<void>
  // 分支选择器每次展开时调用，触发一次分支列表刷新（避免终端手动切分支后界面不同步）
  onRefreshBranches?: () => void
  onFetchBranches?: () => Promise<void>
  onCreateBranch?: (branch: string) => Promise<void>
  // 检出标签（detached）与从标签创建分支；两者都提供时分支弹窗才显示标签分组
  onCheckoutBranchTag?: (tag: string) => Promise<boolean>
  onCreateBranchFromTag?: (tag: string, branch: string) => Promise<boolean>
  onCancelSession: (sessionId: SessionId) => void | Promise<void>
  onSent: (sessionId: SessionId, started?: boolean) => void
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
  // resend effect 消费完 resendRequest 后回调父组件，让父组件立即清空 resendRequest。
  // 必要性：ComposerV2 在 showEmptyHero 翻转时会卸载重建（ChatView 两分支根元素类型不同），
  // 重建后 consumedResendIdRef 回到 null，若 resendRequest 仍残留，旧 payload 会被重新
  // 应用到切进来的会话草稿（文本+图片），表现为"重发内容像狗皮膏药跨会话残留"。
  // 父组件在此回调里 setResendRequest(null) 即可彻底切断残留链。
  onResendConsumed?: () => void
  // 主会话由 ChatView 持有该状态，确保 hero/会话布局切换导致 Composer 重挂载时
  // 发送按钮仍保持 loading；侧边会话不传时继续使用 Composer 本地状态。
  dispatching?: boolean
  // 暴露发送中状态给父组件。父组件用它在发送期间抑制 hero，
  // 覆盖 createSession→sendTurn→status=running 之间 hero 闪现的窗口。
  onDispatchStateChange?: (dispatching: boolean) => void
  /** Renderer-only user bubble lifecycle; actual SDK attachments are prepared separately. */
  optimisticUserSendCallbacks?: OptimisticUserSendCallbacks
  /** Synchronize optimistic bubbles with the authoritative queue snapshot. */
  onOptimisticQueueStateChange?: (sessionId: SessionId, queuedTurnIds: readonly string[]) => void
  onOptimisticQueueTurnCancelled?: (sessionId: SessionId, turnId: string) => void
  onModelSwitch?: (change: { fromModel: string; toModel: string; afterMessageId: string }) => void
  paletteCommandRequest?: { id: number; commandText: string } | null
}) {
  const { toast } = useToast()
  const initialPrefsRef = useRef<ComposerPrefs | null>(null)
  if (initialPrefsRef.current == null) initialPrefsRef.current = readComposerPrefs()
  const initialPrefs = initialPrefsRef.current
  const [drafts, setDrafts] = useState<ComposerDraftMap>(() => readComposerDrafts())
  const draftWriterRef = useRef<ReturnType<typeof createComposerDraftWriter> | null>(null)
  // 仅用于草稿 GC：按当前存活会话回收孤儿草稿条目
  const { sessions } = useSessionSidebar()
  const [sending, setSending] = useComposerDispatchState(dispatching, onDispatchStateChange)
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [queueVisible, setQueueVisible] = useState(true)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [reorderingQueue, setReorderingQueue] = useState(false)
  // 「为本会话创建隔离 worktree」开关（新会话或尚无消息的空会话、且 git 项目可用）
  const [createWorktree, setCreateWorktree] = useState(false)
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const isGitWorkspace =
    branchState.currentBranch != null &&
    (branchState.gitState == null ||
      (branchState.gitState.kind === 'ready' && branchState.gitState.repositoryKind === 'worktree'))
  const worktreeUnavailableHint =
    branchState.gitState?.kind === 'runtime_unavailable'
      ? 'Git 运行环境不可用，请在“设置 → 完整性”中重新检测'
      : branchState.gitState?.kind === 'failed'
        ? branchState.gitState.message
        : '当前项目不是 Git 仓库'
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
  const slashContextRef = useRef<ReturnType<typeof getSlashCommandContext>>(null)
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
  // Fast mode is per-session and defaults off for every fresh composer.
  const [draftFastMode, setDraftFastMode] = useState(false)
  useEffect(() => {
    if (session == null) setDraftFastMode(false)
  }, [session?.id])
  const [cliSparkOverride, setCliSparkOverride] = useState<CliSparkOverride | null>(
    () => session?.cliSparkOverride ?? null,
  )
  const cliSparkCacheHydratedSessionRef = useRef<string | null>(null)
  // 调试模式开关（per-session）。刻意不从全局 composer-prefs 继承——它是逐会话 opt-in 的
  // 能力开关，不该被「上次用过」粘到每个新会话上。
  const [draftDebugMode, setDraftDebugMode] = useState<boolean>(false)
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachment | null>(null)
  const [textEditMenu, setTextEditMenu] = useState<TextEditMenuState | null>(null)
  const textareaRef = useRef<ComposerLexicalInputHandle | null>(null)
  const pasteAsTextThresholdBypassRef = useRef(false)
  const [knownSkillNames, setKnownSkillNames] = useState<string[]>([])
  const composerParamBarRef = useRef<HTMLDivElement | null>(null)
  useResponsiveComposerParamVisibility(composerParamBarRef)
  const composingRef = useRef(false)
  // 最近一次 compositionend 的时刻：用于区分「组合确认键的余波」与「IME 对普通按键的误报」
  const compositionEndedAtRef = useRef(0)
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
  const sessionDragDepthRef = useRef(0)
  const [fileDropActive, setFileDropActive] = useState(false)
  // ── Escape double-press interrupt ──
  const escapeTimestampRef = useRef(0)
  const voiceInputActiveRef = useRef(false)
  const submitGateRef = useRef(createSubmitGate())
  const [escapeConfirm, setEscapeConfirm] = useState(false)
  const { invoke: sendTurn } = useIpcInvoke('session:submit-turn')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: savePastedImage } = useIpcInvoke('file:save-pasted-image')
  const { invoke: savePastedText } = useIpcInvoke('file:save-pasted-text')
  const { invoke: prepareImagePreview } = useIpcInvoke('file:prepare-image-preview')
  const { invoke: prepareSessionImages } = useIpcInvoke('file:prepare-session-images')
  const { invoke: statFileKind } = useIpcInvoke('file:stat-kind')
  const { invoke: getQueue } = useIpcInvoke('session:get-queue')
  const { invoke: cancelQueuedTurn } = useIpcInvoke('session:cancel-queued-turn')
  const { invoke: clearQueuedTurns } = useIpcInvoke('session:clear-queued-turns')
  const { invoke: reorderQueuedTurns } = useIpcInvoke('session:reorder-queued-turns')
  const { invoke: sendQueuedTurnNow } = useIpcInvoke('session:send-queued-turn-now')
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: writeClipboardText } = useIpcInvoke('clipboard:write-text')
  const [runtimePatchCoordinator] = useState(
    () => new RuntimePatchCoordinator<SessionRuntimePatch>(),
  )
  const runtimePatchScopeKey = session?.id ?? NEW_SESSION_DRAFT_BUCKET

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
  const sessionModelId = resolveAvailableProviderModel(session?.modelId, selectedProvider)
  const draftModelForProvider = resolveAvailableProviderModel(draftModelId, selectedProvider)
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
  const effectiveFastMode = resolveComposerFastMode(session, draftFastMode)
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
  const cliSparkProvidersByPrimaryId = useMemo(() => {
    const result = new Map<string, ProviderProfile[]>()
    for (const cliProvider of providers) {
      if (!isBuiltInLocalCliProvider(cliProvider)) continue
      result.set(
        cliProvider.id,
        getCliSparkOverrideProviders(providers, cliProvider).filter(isCliSparkConversationProvider),
      )
    }
    return result
  }, [providers])
  const cliSparkProviders =
    selectedProvider != null ? (cliSparkProvidersByPrimaryId.get(selectedProvider.id) ?? []) : []
  const cliSparkProvider =
    cliSparkOverride != null
      ? cliSparkProviders.find((provider) => provider.id === cliSparkOverride.providerProfileId)
      : undefined
  const fastModeProvider = resolveOpenAIFastModeProvider(selectedProvider, cliSparkProvider)
  const showFastMode = supportsOpenAIFastModeProvider(fastModeProvider)
  useEffect(() => {
    const hydrationKey = `${session?.id ?? '__new-composer-session__'}:${selectedProvider?.id ?? ''}`
    if (session?.cliSparkOverride != null) {
      setCliSparkOverride(session.cliSparkOverride)
      if (selectedProvider != null && isBuiltInLocalCliProvider(selectedProvider)) {
        rememberCliSparkOverride(selectedProvider.id, session.cliSparkOverride)
      }
      cliSparkCacheHydratedSessionRef.current = hydrationKey
      return
    }
    if (cliSparkCacheHydratedSessionRef.current === hydrationKey || selectedProvider == null) return

    if (isBuiltInLocalCliProvider(selectedProvider)) {
      const cached = readCliSparkOverrideCache()[selectedProvider.id]
      const cachedProvider =
        cached != null
          ? cliSparkProviders.find((provider) => provider.id === cached.providerProfileId)
          : undefined
      const cachedModelId =
        cached != null && cachedProvider != null
          ? resolveAvailableProviderModel(cached.modelId, cachedProvider)
          : ''
      setCliSparkOverride(
        cachedProvider != null && cachedModelId.length > 0
          ? { providerProfileId: cachedProvider.id, modelId: cachedModelId }
          : null,
      )
    } else {
      setCliSparkOverride(null)
    }
    cliSparkCacheHydratedSessionRef.current = hydrationKey
  }, [cliSparkProviders, selectedProvider, session?.cliSparkOverride, session?.id])
  const contextWindow = resolveModelContextWindowForProvider(
    sessionModelId || draftModelId || selectedProvider?.defaultModel,
    selectedProvider?.supportsMillionContext === true,
    selectedProvider?.contextWindow,
    selectedProvider?.modelContextWindows,
  )
  const draftBucketKey = session?.id ?? NEW_SESSION_DRAFT_BUCKET
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
  const sessionReferences = draftState.sessionReferences
  const manualExpanded = draftState.manualExpanded
  // 代码位置引用（编辑器右键「添加选中代码」产生）：纯渲染层 state，不进 draft / protocol，
  // 但必须按草稿桶隔离。ComposerV2 在切换会话时通常不会卸载，单一数组会把上个会话的
  // 引用直接带到下个会话。发送时转为「路径:行号」文本交给模型。
  const { codeReferences, setCodeReferences, clearCodeReferenceBuckets } =
    useComposerCodeReferences(draftBucketKey)
  // 浏览器元素引用（浏览器面板/独立窗口「选择元素加入会话」产生）：与代码位置
  // 引用同构——纯渲染层 state、按草稿桶隔离，发送时序列化为定位文本块。
  const { browserReferences, setBrowserReferences } = useComposerBrowserReferences(draftBucketKey)
  const appendCodeReferences = useCallback(
    (incoming: CodeReference[]) => {
      let added = 0
      setCodeReferences((current) => {
        const byKey = new Map(current.map((ref) => [codeRefKey(ref), ref]))
        for (const ref of incoming) {
          const key = codeRefKey(ref)
          if (byKey.has(key)) continue
          byKey.set(key, ref)
          added += 1
        }
        return Array.from(byKey.values())
      })
      return added
    },
    [setCodeReferences],
  )
  const handleRemoveCodeReference = useCallback(
    (key: string) => {
      setCodeReferences((current) => current.filter((ref) => codeRefKey(ref) !== key))
    },
    [setCodeReferences],
  )
  const pendingQuickReplies = useMemo(() => resolvePendingQuickReplies(messages), [messages])
  const [dismissedQuickReplyKey, setDismissedQuickReplyKey] = useState<string | null>(null)
  useEffect(() => setDismissedQuickReplyKey(null), [session?.id])
  const activeQuickReplies =
    pendingQuickReplies != null && pendingQuickReplies.key !== dismissedQuickReplyKey
      ? pendingQuickReplies
      : null
  const contextUsedTokens = resolveContextUsedTokens({
    provider: selectedProvider?.provider,
    ledgerEstimatedTokens: contextLedger?.totalEstimatedTokens,
    turnEstimatedTokens: contextUsage?.estimatedTokens,
    providerInputTokens: contextInputTokens,
  })
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
    (value.trim().length > 0 ||
      attachments.length > 0 ||
      codeReferences.length > 0 ||
      browserReferences.length > 0 ||
      sessionReferences.length > 0) &&
    selectedProvider != null &&
    effectiveModelId.length > 0 &&
    !needsTeamSelection
  const primaryAction = resolveComposerPrimaryAction(isWorking, canSubmit)
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
          next.sessionReferences === base.sessionReferences &&
          next.manualExpanded === base.manualExpanded
        ) {
          return current
        }
        const nextDrafts = { ...current, [draftBucketKey]: next }
        // per-bucket 写：只序列化当前 bucket 这一条草稿，不碰其他 bucket
        draftWriterRef.current?.writeBucket(draftBucketKey, next)
        return nextDrafts
      })
    },
    [draftBucketKey],
  )

  // 草稿写入器：节流落盘 + 配额失败上报（静默失败会让用户在不知情的情况下丢草稿）
  useEffect(() => {
    const writer = createComposerDraftWriter({
      onPersistError: () => {
        toast.warning('本地存储空间不足，输入草稿暂时无法保存，请先发送或清理已有草稿')
      },
    })
    draftWriterRef.current = writer
    // 页面隐藏/卸载是「再不写就来不及」的时机，必须同步 flush 掉待写内容
    const flush = () => writer.flush()
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flush)
      writer.dispose()
      if (draftWriterRef.current === writer) draftWriterRef.current = null
    }
  }, [toast])

  // 切换会话时立即把上一个会话的待写草稿落盘，避免 debounce 窗口内切走导致丢失
  useEffect(() => {
    return () => draftWriterRef.current?.flush()
  }, [draftBucketKey])

  // 回收孤儿草稿：会话被删除/清空后，其草稿 bucket 会永远留在 localStorage 里。
  // 会话列表就绪后按存活会话做一次 GC——per-bucket 方案下 GC 直接 removeItem，O(1)。
  const sessionIdsKey = sessions.map((item) => item.id).join(',')
  useEffect(() => {
    if (sessions.length === 0) return // 列表未加载完时不做删除，否则会误删全部草稿
    const liveIds = new Set(sessions.map((item) => item.id))
    setDrafts((current) => {
      const { kept, removed } = gcComposerDraftBuckets(liveIds)
      if (removed.length > 0) clearCodeReferenceBuckets(removed)
      if (Object.keys(kept).length === Object.keys(current).length) return current
      return kept
    })
    // sessionIdsKey 而非 sessions：后者每次 refresh 都是新引用，会让 GC 空转
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearCodeReferenceBuckets, sessionIdsKey])

  const setValue = useCallback(
    (next: React.SetStateAction<string>) => {
      updateDraft((draft) => ({
        ...draft,
        value: typeof next === 'function' ? next(draft.value) : next,
      }))
    },
    [updateDraft],
  )
  useAppControlComposerPrefill({ sessionId: session?.id ?? null, value, setValue })

  const setAttachments = useCallback(
    (next: React.SetStateAction<ComposerAttachment[]>) => {
      updateDraft((draft) => ({
        ...draft,
        attachments: typeof next === 'function' ? next(draft.attachments) : next,
      }))
    },
    [updateDraft],
  )

  const setSessionReferences = useCallback(
    (next: React.SetStateAction<ComposerSessionReference[]>) => {
      updateDraft((draft) => ({
        ...draft,
        sessionReferences: typeof next === 'function' ? next(draft.sessionReferences) : next,
      }))
    },
    [updateDraft],
  )

  const [sessionReferencePickerOpen, setSessionReferencePickerOpen] = useState(false)
  const [sessionReferenceDropActive, setSessionReferenceDropActive] = useState(false)
  const [attachedSessionReferences, setAttachedSessionReferences] = useState<
    ComposerSessionReference[]
  >([])
  const knownReferenceItems = useMemo(() => {
    const bySource = new Map<string, ComposerSessionReference>()
    for (const reference of sessionReferences) bySource.set(reference.sourceSessionId, reference)
    // Persisted references remain part of the session authorization catalog,
    // but are not rendered back into the composer after a successful send.
    for (const reference of attachedSessionReferences)
      bySource.set(reference.sourceSessionId, reference)
    return [...bySource.values()]
  }, [attachedSessionReferences, sessionReferences])
  const fallbackReferenceCandidates = useMemo<SessionReferenceCandidate[]>(
    () =>
      sessions
        .filter((item) => item.id !== session?.id)
        .map((item) => ({
          sessionId: item.id,
          title: item.title,
          projectId: item.projectId,
          workspaceIds: item.workspaceIds,
          status: item.status,
          archived: item.archivedAt != null,
          updatedAt: item.updatedAt,
          // The target session does not exist yet, so the renderer cannot ask
          // the candidate IPC for an exact boundary. -1 is an internal
          // sentinel meaning "let storage resolve the latest completed turn".
          latestCompletedSeq: -1,
          latestCompletedTurnId: null,
          turnCount: item.turnCount ?? item.messageCount,
        })),
    [session?.id, sessions],
  )
  const addSessionReference = useCallback(
    (candidate: {
      sessionId: string
      title: string
      projectId?: string | null
      latestCompletedSeq: number
      turnCount?: number
      status?: string
    }) => {
      if (candidate.sessionId === session?.id) {
        toast.warning('不能把当前会话添加为自身参考')
        return
      }
      if (knownReferenceItems.some((item) => item.sourceSessionId === candidate.sessionId)) {
        toast.info('这个会话已经添加为参考')
        return
      }
      if (knownReferenceItems.length >= 10) {
        toast.warning('每个会话最多添加 10 个参考会话')
        return
      }
      setSessionReferences((current) => [
        ...current,
        {
          sourceSessionId: candidate.sessionId,
          title: candidate.title,
          ...(candidate.latestCompletedSeq > 0
            ? { snapshotSeq: candidate.latestCompletedSeq }
            : {}),
          ...(candidate.projectId != null ? { projectId: candidate.projectId } : {}),
          ...(candidate.turnCount != null ? { turnCount: candidate.turnCount } : {}),
          status: 'active',
        },
      ])
      toast.success(`已添加参考：${candidate.title || '未命名会话'}`)
    },
    [knownReferenceItems, session?.id, setSessionReferences, toast],
  )

  const addSessionReferenceFromPayload = useCallback(
    (payload: SessionReferenceDragPayload) => {
      addSessionReference({
        sessionId: payload.sessionId,
        title: payload.title,
        ...(payload.projectId != null ? { projectId: payload.projectId } : {}),
        ...(payload.turnCount != null ? { turnCount: payload.turnCount } : {}),
        latestCompletedSeq: 0,
      })
    },
    [addSessionReference],
  )
  useSessionReferenceAddControl({
    sessionId: session?.id ?? null,
    onAdd: addSessionReferenceFromPayload,
  })

  const removeSessionReference = useCallback(
    (sourceSessionId: string) => {
      setSessionReferences((current) =>
        current.filter((item) => item.sourceSessionId !== sourceSessionId),
      )
    },
    [setSessionReferences],
  )

  const refreshAttachedReferences = useCallback(async () => {
    if (session?.id == null) return
    try {
      const result = await window.spark.invoke('session:list-references', {
        targetSessionId: session.id,
      })
      setAttachedSessionReferences(
        result.references
          .filter((item) => item.status !== 'revoked')
          .map((item) => ({
            referenceId: item.id,
            sourceSessionId: item.sourceSessionId,
            title: item.title,
            snapshotSeq: item.snapshotSeq,
            projectId: item.projectId,
            turnCount: item.turnCount,
            status: item.status,
          })),
      )
    } catch {
      // The send already succeeded. The next session refresh will reconcile
      // the persisted reference catalog used by the picker.
    }
  }, [session?.id])

  useEffect(() => {
    if (session?.id == null) {
      setAttachedSessionReferences([])
      return
    }
    let cancelled = false
    void window.spark
      .invoke('session:list-references', { targetSessionId: session.id })
      .then((result) => {
        if (cancelled) return
        setAttachedSessionReferences(
          result.references
            .filter((item) => item.status !== 'revoked')
            .map((item) => ({
              referenceId: item.id,
              sourceSessionId: item.sourceSessionId,
              title: item.title,
              snapshotSeq: item.snapshotSeq,
              projectId: item.projectId,
              turnCount: item.turnCount,
              status: item.status,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) setAttachedSessionReferences([])
      })
    return () => {
      cancelled = true
    }
  }, [session?.id])

  const setManualExpanded = useCallback(
    (next: React.SetStateAction<boolean>) => {
      updateDraft((draft) => ({
        ...draft,
        manualExpanded: typeof next === 'function' ? next(draft.manualExpanded) : next,
      }))
    },
    [updateDraft],
  )

  const clearDraftBuckets = useCallback(
    (keys: Array<string | null | undefined>) => {
      // 持久化删除必须先于 React state 更新：新会话首发会立即卸载 Composer，
      // 若把 removeBucket 放进 updater，旧草稿可能在重挂载时被重新读回。
      const uniqueKeys = clearComposerDraftBuckets(keys, draftWriterRef.current)
      if (uniqueKeys.length === 0) return
      clearCodeReferenceBuckets(uniqueKeys)
      setDrafts((current) => clearComposerDraftMapBuckets(current, uniqueKeys))
    },
    [clearCodeReferenceBuckets],
  )

  const persistRuntimePatch = useCallback(
    (patch: SessionRuntimePatch) =>
      runtimePatchCoordinator.persist(
        runtimePatchScopeKey,
        patch,
        session == null ? undefined : onUpdateSession,
      ),
    [onUpdateSession, runtimePatchCoordinator, runtimePatchScopeKey, session],
  )

  const flushPendingRuntimePatch = useCallback(
    () =>
      runtimePatchCoordinator.flush(
        runtimePatchScopeKey,
        session == null ? undefined : onUpdateSession,
      ),
    [onUpdateSession, runtimePatchCoordinator, runtimePatchScopeKey, session],
  )

  useEffect(() => {
    if (cliSparkOverride == null) return
    const localCliSelected = selectedProvider != null && isBuiltInLocalCliProvider(selectedProvider)
    const staleOverride = localCliSelected
      ? cliSparkProviders.length > 0 && cliSparkProvider == null
      : true
    if (!staleOverride) return
    setCliSparkOverride(null)
    void persistRuntimePatch({ cliSparkOverride: null }).catch((err) => {
      console.warn('[ComposerV2] failed to clear stale CLI Spark override', err)
    })
  }, [
    cliSparkOverride,
    cliSparkProvider,
    cliSparkProviders.length,
    persistRuntimePatch,
    selectedProvider,
  ])

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
    (): SessionRuntimePatch =>
      runtimePatchCoordinator.snapshot(runtimePatchScopeKey, {
        ...(selectedProvider?.id !== undefined ? { providerProfileId: selectedProvider.id } : {}),
        modelId: effectiveModelId || null,
        agentId: effectiveAgentId,
        agentAdapter: selectedProviderAdapter,
        permissionMode: effectivePermissionMode,
        chatMode: effectiveMode,
        reasoningEffort: effectiveReasoning,
        fastMode: effectiveFastMode,
        cliSparkOverride,
      }),
    [
      effectiveAgentId,
      effectiveMode,
      effectiveModelId,
      effectivePermissionMode,
      effectiveReasoning,
      effectiveFastMode,
      runtimePatchCoordinator,
      runtimePatchScopeKey,
      selectedProviderAdapter,
      selectedProvider?.id,
      cliSparkOverride,
    ],
  )

  const mapQueuedTurns = useCallback(
    (turns: SessionQueuedTurn[]): QueuedMessage[] =>
      projectQueuedTurnsForDisplay(turns).map((turn) => ({
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
        sessionReferences: (turn.sessionReferences ?? []).map((reference) => ({
          sourceSessionId: reference.sourceSessionId,
          title:
            sessions.find((item) => item.id === reference.sourceSessionId)?.title ??
            reference.sourceSessionId,
          ...(reference.snapshotSeq !== undefined ? { snapshotSeq: reference.snapshotSeq } : {}),
        })),
        editable: turn.userMessageVisibility !== 'hidden',
      })),
    [sessions],
  )

  const applyQueueState = useCallback(
    (snapshot: SessionGetQueueResponse | null | undefined) => {
      if (snapshot == null || snapshot.sessionId !== session?.id) return
      setQueuedMessages(mapQueuedTurns(snapshot.queuedTurns))
      onOptimisticQueueStateChange?.(
        snapshot.sessionId,
        snapshot.queuedTurns.map((turn) => turn.turnId),
      )
    },
    [mapQueuedTurns, onOptimisticQueueStateChange, session?.id],
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
    const fallbackProvider = getPreferredProviderWithAdapterFallback(
      providers,
      initialPrefs.providerProfileId,
      draftAdapter,
    )
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
      clearDraftBuckets([detail.sessionId, NEW_SESSION_DRAFT_BUCKET])
    }
    window.addEventListener('spark:composer:reset-draft', handler)
    return () => window.removeEventListener('spark:composer:reset-draft', handler)
  }, [clearDraftBuckets])

  // 新会话首发会因 hero → 会话布局切换卸载旧 Composer。发送失败时由旧实例
  // 同步写回草稿并派发此事件，让已经挂载的新实例无需再次重挂载即可恢复输入。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ComposerDraftRestoreDetail>).detail
      if (detail?.bucket !== draftBucketKey || detail.draft == null) return
      draftWriterRef.current?.writeBucket(detail.bucket, detail.draft)
      setDrafts((current) => ({ ...current, [detail.bucket]: detail.draft }))
    }
    window.addEventListener(COMPOSER_DRAFT_RESTORE_EVENT, handler)
    return () => window.removeEventListener(COMPOSER_DRAFT_RESTORE_EVENT, handler)
  }, [draftBucketKey])

  // 浏览器面板 / 独立浏览器窗口「选择元素加入会话」：把拾取到的元素以引用
  // tag（chip）加入输入框——引用按 draft bucket 隔离，发送时才序列化为
  // 「选择器 + 页面 URL」的定位文本块，agent 可用 spark_browser 直接回查。
  // detail 支持 reference 对象（面板内）或 referenceJson 字符串（跨窗口 IPC
  // 经 App.tsx 转发），解析失败静默丢弃，不往输入框塞脏文本。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ reference?: unknown; referenceJson?: string }>).detail
      let reference: BrowserElementReference | null = null
      if (detail?.reference != null && typeof detail.reference === 'object') {
        reference = detail.reference as BrowserElementReference
      } else if (detail?.referenceJson != null && detail.referenceJson.length > 0) {
        try {
          const parsed: unknown = JSON.parse(detail.referenceJson)
          if (parsed != null && typeof parsed === 'object') {
            reference = parsed as BrowserElementReference
          }
        } catch {
          return
        }
      }
      if (
        reference == null ||
        typeof reference.selector !== 'string' ||
        reference.selector.length === 0 ||
        typeof reference.pageUrl !== 'string'
      ) {
        return
      }
      setBrowserReferences((current) => {
        // 同页面同选择器视为同一元素，仅更新标签，避免重复拾取堆出一排相同 chip
        const existingIndex = current.findIndex(
          (item) => item.selector === reference.selector && item.pageUrl === reference.pageUrl,
        )
        if (existingIndex >= 0) {
          const next = [...current]
          next[existingIndex] = { ...reference, id: current[existingIndex]!.id }
          return next
        }
        return [...current, reference]
      })
    }
    window.addEventListener(COMPOSER_APPEND_EXTERNAL_TEXT_EVENT, handler)
    return () => window.removeEventListener(COMPOSER_APPEND_EXTERNAL_TEXT_EVENT, handler)
  }, [setBrowserReferences])

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

  useComposerInputAutoSize({
    inputRef: textareaRef,
    draftBucketKey,
    manualExpanded,
    value,
  })

  useEffect(() => {
    const el = textareaRef.current
    if (el == null) return

    const bucketChanged = lastFocusedDraftBucketRef.current !== draftBucketKey
    lastFocusedDraftBucketRef.current = draftBucketKey
    if (!bucketChanged) return

    requestAnimationFrame(() => {
      el.focus()
      const end = el.getValue().length
      el.setSelectionRange(end, end)
    })
  }, [draftBucketKey])

  const dispatchMessage = useCallback(
    async (
      text: string,
      turnAttachments: ComposerAttachment[],
      replySnapshot?: ReplyToState | null,
      sentDraft: ComposerDraftSnapshot = {
        value: text,
        attachments: turnAttachments,
        sessionReferences,
        manualExpanded,
      },
    ) => {
      // 用户选择快捷回复或自行发送后立即隐藏建议，不等待事件流回写 user_message。
      if (activeQuickReplies != null) setDismissedQuickReplyKey(activeQuickReplies.key)
      const runtimePatchSnapshot = getCurrentRuntimePatch()
      const prepareRequestAttachments = async (): Promise<SessionAttachment[]> => {
        const prepared = await prepareSessionImageAttachments(turnAttachments, prepareSessionImages)
        const notice = formatSessionImageOptimizationNotice(prepared.summary)
        if (notice?.level === 'warning') toast.warning(notice.message)
        else if (notice != null) toast.success(notice.message)
        return toSessionAttachments(prepared.attachments)
      }
      // 斜杠命令拦截：以 / 开头的消息走 command:execute
      if (text.startsWith('/')) {
        if (isLocalCopySlashCommand(text)) {
          const markdown = getLastAssistantMessageMarkdown(messages)
          if (markdown == null) {
            toast.error('没有可复制的上一条 Assistant 消息。')
            restoreComposerDraftBucket(draftBucketKey, sentDraft)
            return
          }
          setSending(true)
          try {
            await writeClipboardText({ text: markdown })
            toast.success('已复制上一条 Assistant 消息。')
            clearDraftBuckets([draftBucketKey, session?.id, NEW_SESSION_DRAFT_BUCKET])
          } catch (err) {
            console.error('复制上一条 Assistant 消息失败', err)
            toast.error(err instanceof Error ? err.message : '复制失败')
            restoreComposerDraftBucket(draftBucketKey, sentDraft)
          } finally {
            setSending(false)
          }
          return
        }
        setSending(true)
        let optimisticSend: OptimisticUserSendLifecycle | null = null
        let commandSessionId =
          createWorktree || !canReuseCurrentSession ? null : (session?.id ?? null)
        try {
          const requestAttachments = await prepareRequestAttachments()
          // 如果没有活跃 session，先创建一个（命令需要 session 上下文）。
          // 勾选 worktree 时不复用现有空会话——需新建一个绑定 worktree 的会话。
          if (commandSessionId == null) {
            if (selectedProvider == null) {
              toast.warning('请先选择 Provider 再执行命令。')
              restoreComposerDraftBucket(draftBucketKey, sentDraft)
              return
            }
            commandSessionId = await onCreateSession({
              ...(selectedProvider?.id !== undefined
                ? { providerProfileId: selectedProvider.id }
                : {}),
              modelId: effectiveModelId,
              agentId: effectiveAgentId,
              agentAdapter: selectedProviderAdapter,
              permissionMode: effectivePermissionMode,
              debugMode: effectiveDebugMode,
              ...(cliSparkOverride != null ? { cliSparkOverride } : {}),
              ...(teamConfig.enabled ? { teamConfig } : {}),
              ...(createWorktree
                ? {
                    createWorktree: true,
                    worktreeTaskText: text,
                    ...(worktreeBranch.trim() ? { worktreeBranch: worktreeBranch.trim() } : {}),
                  }
                : {}),
            })
            if (commandSessionId == null) {
              toast.error('创建会话失败，无法执行命令。')
              restoreComposerDraftBucket(draftBucketKey, sentDraft)
              return
            }
          }
          const res = await window.spark.invoke('command:execute', {
            sessionId: commandSessionId,
            message: text,
            ...runtimePatchSnapshot,
            ...(requestAttachments.length > 0 ? { attachments: requestAttachments } : {}),
            ...(sessionReferences.length > 0
              ? {
                  sessionReferences: sessionReferences.map((reference) => ({
                    sourceSessionId: reference.sourceSessionId as SessionId,
                    ...(reference.snapshotSeq !== undefined
                      ? { snapshotSeq: reference.snapshotSeq }
                      : {}),
                  })),
                }
              : {}),
          })
          if (res.forwardToAgent) {
            // 转发给 Agent：作为普通消息发送
            optimisticSend = startOptimisticUserSend(
              {
                sessionId: commandSessionId,
                content: text,
                attachments: turnAttachments,
                sessionReferences,
                ...(replySnapshot?.agentId != null
                  ? { mentionAgentId: replySnapshot.agentId }
                  : teamConfig.enabled &&
                      pendingMention != null &&
                      text.includes(`@${pendingMention.name}`) &&
                      pendingMention.agentId !== effectiveHostAgentId
                    ? { mentionAgentId: pendingMention.agentId }
                    : {}),
              },
              optimisticUserSendCallbacks,
            )
            setSending(false)
            await optimisticSend?.waitUntilVisible()
            await flushPendingRuntimePatch()
            const sendRes = await sendTurn({
              sessionId: commandSessionId,
              message: text,
              ...(optimisticSend != null ? { clientMessageId: optimisticSend.clientId } : {}),
              ...(requestAttachments.length > 0 ? { attachments: requestAttachments } : {}),
              ...(sessionReferences.length > 0
                ? {
                    sessionReferences: sessionReferences.map((reference) => ({
                      sourceSessionId: reference.sourceSessionId as SessionId,
                      ...(reference.snapshotSeq !== undefined
                        ? { snapshotSeq: reference.snapshotSeq }
                        : {}),
                    })),
                  }
                : {}),
              ...runtimePatchSnapshot,
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
            settleOptimisticUserSend(optimisticSend, sendRes)
            if (!sendRes.started) {
              setQueueVisible(true)
            } else if (queuedMessages.length === 0) {
              setQueueVisible(false)
            }
            onSent(commandSessionId, sendRes.started)
            await refreshQueueState(commandSessionId)
            await refreshAttachedReferences()
            clearDraftBuckets([draftBucketKey, commandSessionId, NEW_SESSION_DRAFT_BUCKET])
            return
          }
          // 命令结果已通过事件流注入到聊天中，无需 Toast
          if (res.session != null) onCommandComplete(res.session)
          if (res.queued === true) {
            // 会话运行中：命令已进入会话队列，等当前 turn 结束后出队执行。
            // 队列面板立即给出可见反馈，草稿也在此刻清掉（消息已被接受）。
            setQueueVisible(true)
            onSent(commandSessionId, false)
            clearDraftBuckets([draftBucketKey, commandSessionId, NEW_SESSION_DRAFT_BUCKET])
          } else if (res.started === true) {
            onSent(commandSessionId, true)
            clearDraftBuckets([draftBucketKey, commandSessionId, NEW_SESSION_DRAFT_BUCKET])
          }
          await refreshQueueState(commandSessionId)
        } catch (err) {
          optimisticSend?.fail(err instanceof Error ? err.message : String(err))
          console.error('命令执行失败', err)
          toast.error(err instanceof Error ? err.message : '命令执行失败')
          restoreComposerDraftBucket(commandSessionId ?? draftBucketKey, sentDraft)
        } finally {
          setSending(false)
        }
        return
      }

      if (selectedProvider == null) return
      setSending(true)
      let optimisticSend: OptimisticUserSendLifecycle | null = null
      let targetSessionId = createWorktree || !canReuseCurrentSession ? null : (session?.id ?? null)
      try {
        // 勾选 worktree 时不复用现有空会话——需新建一个绑定 worktree 的会话。
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
            fastMode: effectiveFastMode,
            debugMode: effectiveDebugMode,
            ...(cliSparkOverride != null ? { cliSparkOverride } : {}),
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
        optimisticSend = startOptimisticUserSend(
          {
            sessionId: targetSessionId,
            content: text,
            attachments: turnAttachments,
            sessionReferences,
            ...(replySnapshot?.agentId != null
              ? { mentionAgentId: replySnapshot.agentId }
              : teamConfig.enabled &&
                  pendingMention != null &&
                  text.includes(`@${pendingMention.name}`) &&
                  pendingMention.agentId !== effectiveHostAgentId
                ? { mentionAgentId: pendingMention.agentId }
                : {}),
          },
          optimisticUserSendCallbacks,
        )
        await optimisticSend?.waitUntilVisible()
        await flushPendingRuntimePatch()
        const requestAttachments = await prepareRequestAttachments()
        const res = await sendTurn({
          sessionId: targetSessionId,
          message: text,
          ...(optimisticSend != null ? { clientMessageId: optimisticSend.clientId } : {}),
          ...(requestAttachments.length > 0 ? { attachments: requestAttachments } : {}),
          ...(sessionReferences.length > 0
            ? {
                sessionReferences: sessionReferences.map((reference) => ({
                  sourceSessionId: reference.sourceSessionId as SessionId,
                  ...(reference.snapshotSeq !== undefined
                    ? { snapshotSeq: reference.snapshotSeq }
                    : {}),
                })),
              }
            : {}),
          ...runtimePatchSnapshot,
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
        settleOptimisticUserSend(optimisticSend, res)
        if (!res.started) {
          setQueueVisible(true)
        } else if (queuedMessages.length === 0) {
          setQueueVisible(false)
        }
        onSent(targetSessionId, res.started)
        await refreshQueueState(targetSessionId)
        await refreshAttachedReferences()
        clearDraftBuckets([draftBucketKey, targetSessionId, NEW_SESSION_DRAFT_BUCKET])
      } catch (err) {
        optimisticSend?.fail(err instanceof Error ? err.message : String(err))
        console.error('发送失败', err)
        toast.error(err instanceof Error ? err.message : '发送消息失败')
        restoreComposerDraftBucket(targetSessionId ?? draftBucketKey, sentDraft)
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
      effectiveFastMode,
      effectiveHostAgentId,
      clearDraftBuckets,
      draftBucketKey,
      flushPendingRuntimePatch,
      getCurrentRuntimePatch,
      onCreateSession,
      onCommandComplete,
      onSent,
      refreshQueueState,
      refreshAttachedReferences,
      sessionReferences,
      manualExpanded,
      selectedProvider,
      selectedProviderAdapter,
      messages,
      writeClipboardText,
      sendTurn,
      session?.id,
      canReuseCurrentSession,
      createWorktree,
      worktreeBranch,
      teamConfig,
      toast,
      pendingMention,
      prepareSessionImages,
      activeQuickReplies,
      isWorking,
      optimisticUserSendCallbacks,
      onOptimisticQueueStateChange,
    ],
  )

  const appendAttachments = useCallback(
    (nextAttachments: ComposerAttachment[]) => {
      let truncated = false
      let added = 0
      setAttachments((current) => {
        const byPath = new Map(current.map((attachment) => [attachment.path, attachment]))
        for (const attachment of nextAttachments) {
          if (byPath.size >= COMPOSER_ATTACHMENT_LIMIT) {
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

  const focusComposer = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  // 代码查看器右键「添加到会话」：追加文本 / 累加附件（复用 appendAttachments 的去重与 20 上限）
  useInsertToComposer({
    sessionId: session?.id ?? null,
    setValue,
    appendAttachments,
    appendCodeReferences,
    focus: focusComposer,
  })

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

  const handleDropSessionReference = useCallback(
    (payload: ReturnType<typeof readSessionReferenceDragPayload>) => {
      if (payload == null) return
      addSessionReferenceFromPayload(payload)
    },
    [addSessionReferenceFromPayload],
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
      sessionDragDepthRef.current = 0
      setFileDropActive(false)
      setSessionReferenceDropActive(false)
    }
    const shouldHandle = (event: DragEvent) =>
      shouldHandleComposerFileDrop(event.dataTransfer, event.target, sending)

    const handleDragEnter = (event: DragEvent) => {
      if (
        !sending &&
        hasSessionReferenceDrag(event.dataTransfer) &&
        isSessionReferenceDropTarget(event.target)
      ) {
        event.preventDefault()
        // move：保持普通箭头光标，不显示「复制 +」形态
        if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'move'
        sessionDragDepthRef.current += 1
        setSessionReferenceDropActive(true)
        return
      }
      // 文件树节点拖入会话区 → 参考资源（自定义 MIME 不含 Files 类型，
      // 与 OS 文件拖入 / 会话引用拖拽互不冲突；树内 drop 已被 React 层拦截不会到这里）
      if (
        !sending &&
        hasFileExplorerNodeDrag(event.dataTransfer) &&
        isSessionReferenceDropTarget(event.target)
      ) {
        event.preventDefault()
        if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'copy'
        dragDepthRef.current += 1
        setFileDropActive(true)
        return
      }
      if (!shouldHandle(event)) {
        resetDragState()
        return
      }
      event.preventDefault()
      dragDepthRef.current += 1
      setFileDropActive(true)
    }
    const handleDragOver = (event: DragEvent) => {
      if (
        !sending &&
        hasSessionReferenceDrag(event.dataTransfer) &&
        isSessionReferenceDropTarget(event.target)
      ) {
        event.preventDefault()
        // move：保持普通箭头光标，不显示「复制 +」形态
        if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'move'
        setSessionReferenceDropActive(true)
        return
      }
      if (
        !sending &&
        hasFileExplorerNodeDrag(event.dataTransfer) &&
        isSessionReferenceDropTarget(event.target)
      ) {
        event.preventDefault()
        if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'copy'
        setFileDropActive(true)
        return
      }
      if (!shouldHandle(event)) {
        resetDragState()
        return
      }
      event.preventDefault()
      if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'copy'
      setFileDropActive(true)
    }
    const handleDragLeave = (event: DragEvent) => {
      if (hasSessionReferenceDrag(event.dataTransfer)) {
        sessionDragDepthRef.current = Math.max(0, sessionDragDepthRef.current - 1)
        if (sessionDragDepthRef.current === 0) setSessionReferenceDropActive(false)
        return
      }
      if (hasFileExplorerNodeDrag(event.dataTransfer)) {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setFileDropActive(false)
        return
      }
      if (!hasFileDataTransfer(event.dataTransfer)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setFileDropActive(false)
    }
    const handleDrop = (event: DragEvent) => {
      if (
        !sending &&
        hasSessionReferenceDrag(event.dataTransfer) &&
        isSessionReferenceDropTarget(event.target)
      ) {
        event.preventDefault()
        const payload = readSessionReferenceDragPayload(event.dataTransfer)
        resetDragState()
        handleDropSessionReference(payload)
        return
      }
      if (
        !sending &&
        hasFileExplorerNodeDrag(event.dataTransfer) &&
        isSessionReferenceDropTarget(event.target)
      ) {
        event.preventDefault()
        const payload = readFileExplorerNodeDragPayload(event.dataTransfer)
        resetDragState()
        // 走 OS 文件拖入同链路（目录作为路径引用传给 Agent）
        if (payload != null) void handleDropFilePaths([payload.absPath])
        return
      }
      if (!shouldHandle(event)) {
        resetDragState()
        return
      }
      event.preventDefault()
      const filePaths = getDataTransferFilePaths(event.dataTransfer)
      const unresolvable = isUnresolvableFileDrop(event.dataTransfer, filePaths)
      resetDragState()
      if (unresolvable) {
        // 拖进来了文件却一个路径都解析不出来：几乎只可能是 webUtils 通道失效。
        // 绝不能静默——用户会以为附件已加上。
        toast.error('无法读取拖入文件的路径，请改用「添加文件或图片」按钮')
        return
      }
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
  }, [handleDropFilePaths, handleDropSessionReference, sending, toast])

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLElement>) => {
      if (pasteAsTextThresholdBypassRef.current) return
      const items = Array.from(event.clipboardData?.items ?? [])
      const imageItems = items.filter((item) => item.type.startsWith('image/'))
      if (imageItems.length === 0) {
        // 超长纯文本：不铺平进输入框，落盘为 .txt 引用附件（阈值见 composer-pasted-text）。
        // 右键菜单的「粘贴为文本」不走这里，主动选择优先于阈值。
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (!shouldConvertPastedTextToResource(text)) return
        event.preventDefault()
        if (attachments.length >= COMPOSER_ATTACHMENT_LIMIT) {
          toast.info(`单轮最多添加 ${COMPOSER_ATTACHMENT_LIMIT} 个附件。`)
          return
        }
        try {
          const attachment = await buildPastedTextAttachment(text, { savePastedText })
          const added = appendAttachments([attachment])
          if (added > 0) toast.info('长文本已转为引用资源')
        } catch (err) {
          console.error('粘贴长文本失败', err)
          toast.error(err instanceof Error ? err.message : '粘贴长文本失败')
        }
        return
      }

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
    [appendAttachments, attachments.length, savePastedImage, savePastedText, toast],
  )

  const handlePasteAsText = useCallback(
    async (target: ComposerLexicalInputHandle) => {
      try {
        await pasteClipboardTextAsPlainText(target, {
          readClipboardText: () => navigator.clipboard.readText(),
          pasteNativelyWithThresholdBypass: () => {
            pasteAsTextThresholdBypassRef.current = true
            try {
              if (!document.execCommand('paste')) throw new Error('无法读取剪贴板文本')
            } finally {
              pasteAsTextThresholdBypassRef.current = false
            }
          },
        })
      } catch (err) {
        console.error('粘贴为文本失败', err)
        toast.error(err instanceof Error ? err.message : '粘贴为文本失败')
      }
    },
    [toast],
  )

  /** 输入框右键「粘贴为资源」：主动选择，跳过长度阈值，短文本也转为引用附件。 */
  const handlePasteAsResource = useCallback(async () => {
    if (attachments.length >= COMPOSER_ATTACHMENT_LIMIT) {
      toast.info(`单轮最多添加 ${COMPOSER_ATTACHMENT_LIMIT} 个附件。`)
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim().length === 0) {
        toast.info('剪贴板中没有可粘贴的文本')
        return
      }
      const attachment = await buildPastedTextAttachment(text, { savePastedText })
      const added = appendAttachments([attachment])
      if (added > 0) toast.success('已粘贴为引用资源')
    } catch (err) {
      console.error('粘贴为资源失败', err)
      toast.error(err instanceof Error ? err.message : '粘贴为资源失败')
    }
  }, [appendAttachments, attachments.length, savePastedText, toast])

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      setAttachments((current) => current.filter((attachment) => attachment.id !== id))
    },
    [setAttachments],
  )

  const handleSend = async () => {
    if (!canSubmit || voiceInputActiveRef.current) return
    if (!submitGateRef.current.tryEnter()) return
    setTextEditMenu(null)
    const rawText =
      value.trim() ||
      (attachments.length > 0
        ? '请查看附件。'
        : browserReferences.length > 0
          ? '请操作引用的浏览器元素。'
          : sessionReferences.length > 0
            ? '请结合已添加的会话参考。'
            : '请查看附件。')
    const turnAttachments = attachments
    // Prepend reply context if quoting a message
    let text = rawText
    const replySnapshot = replyTo
    if (replySnapshot != null) {
      const quotedLine = replySnapshot.contentPreview.replace(/\n/g, ' ')
      const who = replySnapshot.role === 'assistant' ? (replySnapshot.agentName ?? 'Agent') : 'You'
      text = `[回复 ${who}: ${quotedLine}]\n${rawText}`
    }
    // 代码位置引用：拼到正文末尾（每行一个 路径:行号）。用户未输入正文时用引用替换
    // fallback 占位「请查看附件。」（含 reply 包裹的场景也一并替换）。
    if (codeReferences.length > 0) {
      const refText = codeReferences.map(formatCodeReferenceLine).join('\n')
      if (value.trim().length === 0) {
        text = text.replace('请查看附件。', refText)
      } else {
        text = `${text}\n${refText}`
      }
    }
    // 浏览器元素引用：同一机制——序列化为「元素摘要 + 选择器 + 页面 URL」的
    // 定位文本块交给模型，配合 spark_browser 工具可直接回查页面元素。
    if (browserReferences.length > 0) {
      const refText = browserReferences.map(formatBrowserReferenceLine).join('\n')
      if (value.trim().length === 0) {
        text = text.replace('请查看附件。', refText)
      } else {
        text = `${text}\n${refText}`
      }
    }
    // Record to input history (deduplicate consecutive identical entries)
    const history = sentHistoryRef.current
    if (rawText !== history[history.length - 1]) {
      history.push(rawText)
    }
    historyIndexRef.current = -1
    historyDraftRef.current = ''
    clearDraftBuckets([draftBucketKey])
    setBrowserReferences([])
    // 发送后清除 pending mention（避免下一条消息误带）；dispatchMessage 内已通过 text 计算用过
    setPendingMention(null)
    if (replySnapshot != null) onClearReply?.()
    try {
      await dispatchMessage(text, turnAttachments, replySnapshot, draftState)
    } finally {
      submitGateRef.current.leave()
    }
  }

  const handlePrimaryAction = async () => {
    await (primaryAction === 'stop' ? handleCancelActiveSession() : handleSend())
  }

  /**
   * 把 `@<技能名> ` 插入到输入框当前光标位置（来自 ComposerActionsMenu 弹窗中的技能选择）。
   * 不走团队模式的 @agent mention 状态机——技能没有 agentId，只是纯文本提示。
   */
  const handleInsertSkillMention = useCallback(
    (skill: { name: string }) => {
      const el = textareaRef.current
      const current = value
      const selection = el?.getSelection()
      const caret = selection?.start ?? current.length
      const end = selection?.end ?? caret
      const insertText = `@${skill.name} `
      const before = current.slice(0, caret)
      const after = current.slice(end)
      const nextValue = `${before}${insertText}${after}`
      setKnownSkillNames((currentNames) =>
        currentNames.includes(skill.name) ? currentNames : [...currentNames, skill.name],
      )
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
    if (res.cancelled) onOptimisticQueueTurnCancelled?.(session.id, message.turnId)
    onOptimisticQueueStateChange?.(
      session.id,
      res.queuedTurns.map((turn) => turn.turnId),
    )
  }

  const handleClearQueuedMessages = async () => {
    if (session?.id == null || queuedMessages.length === 0 || clearingQueue) return
    setClearingQueue(true)
    try {
      const queuedTurnIds = queuedMessages.map((message) => message.turnId)
      const res = await clearQueuedTurns({ sessionId: session.id })
      setQueuedMessages(mapQueuedTurns(res.queuedTurns))
      for (const turnId of queuedTurnIds) {
        onOptimisticQueueTurnCancelled?.(session.id, turnId)
      }
      onOptimisticQueueStateChange?.(
        session.id,
        res.queuedTurns.map((turn) => turn.turnId),
      )
    } catch (err) {
      toast.error(`清空队列失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setClearingQueue(false)
    }
  }

  const handleReorderQueuedMessages = async (orderedTurnIds: readonly string[]) => {
    if (session?.id == null || reorderingQueue || orderedTurnIds.length !== queuedMessages.length) {
      return
    }
    const currentById = new Map(queuedMessages.map((message) => [message.turnId, message]))
    const reorderedMessages = orderedTurnIds
      .map((turnId) => currentById.get(turnId))
      .filter((message): message is QueuedMessage => message != null)
    if (reorderedMessages.length !== queuedMessages.length) return

    const previousMessages = queuedMessages
    setQueuedMessages(reorderedMessages)
    setReorderingQueue(true)
    try {
      const res = await reorderQueuedTurns({ sessionId: session.id, turnIds: [...orderedTurnIds] })
      applyQueueState({
        sessionId: session.id,
        running: res.running,
        queuedTurns: res.queuedTurns,
      })
    } catch (err) {
      setQueuedMessages(previousMessages)
      toast.error(`调整队列顺序失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReorderingQueue(false)
    }
  }

  const handleEditQueuedMessage = async (message: QueuedMessage) => {
    if (session?.id == null || !message.editable) return
    setValue(message.content)
    setAttachments(message.attachments)
    setSessionReferences(message.sessionReferences)
    setCodeReferences([])
    const res = await cancelQueuedTurn({ sessionId: session.id, turnId: message.turnId })
    setQueuedMessages(mapQueuedTurns(res.queuedTurns))
    if (res.cancelled) onOptimisticQueueTurnCancelled?.(session.id, message.turnId)
    onOptimisticQueueStateChange?.(
      session.id,
      res.queuedTurns.map((turn) => turn.turnId),
    )
    queueMicrotask(() => {
      const el = textareaRef.current
      if (el == null) return
      el.focus()
      const end = el.getValue().length
      el.setSelectionRange(end, end)
    })
  }

  const handleSendQueuedNow = async (message: QueuedMessage) => {
    if (session?.id == null) return
    const res = await sendQueuedTurnNow({ sessionId: session.id, turnId: message.turnId })
    setQueuedMessages(mapQueuedTurns(res.queuedTurns))
    onOptimisticQueueStateChange?.(
      session.id,
      res.queuedTurns.map((turn) => turn.turnId),
    )
    if (res.started) {
      onSent(session.id, true)
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
    app: '子应用',
    session: '会话',
    model: '模型',
    context: '上下文',
    permission: '权限',
    git: 'Git',
    workflow: '工作流',
    agent: 'Agent',
    mcp: 'MCP',
    skill: '技能',
    'project-skill': '项目技能',
    resource: '资源',
    team: '团队',
    utility: '工具',
    system: '系统',
  }
  const SLASH_GROUP_ORDER = [
    'app',
    'session',
    'model',
    'context',
    'permission',
    'git',
    'workflow',
    'agent',
    'mcp',
    'skill',
    'project-skill',
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
    const restCmds = remaining.filter(
      (c) => !COMMON_COMMAND_NAMES.has(c.name) && c.layer !== 'custom',
    )

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

  // 稳定 commandNames 引用：ComposerLexicalInput 的外部同步 effect 依赖此数组，
  // 若每次渲染都生成新引用，运行中会话的流式高频重渲染会让 effect 反复重跑，
  // 放大「Lexical commit 与 React 回流之间」的 IME 竞态窗口。
  const slashCommandNames = useMemo(() => slashCmds.map((command) => command.name), [slashCmds])

  const refreshSlashCommands = useCallback(async () => {
    try {
      const sid = session?.id
      const res = await window.spark.invoke('command:list', sid != null ? { sessionId: sid } : {})
      setSlashCmds(res.commands ?? [])
    } catch {
      // keep the previous command cache if refresh fails
    }
  }, [session?.id])

  // 弹窗开关状态必须与击键同拍置位：若先 await 命令列表 IPC 再 setSlashOpen(true)，
  // 输入 `/` 后立刻回车的 keydown 会落在 slashOpen 仍为 false 的窗口里，
  // 弹窗分支被跳过、Enter 直接走发送逻辑（表现为“弹窗开着回车仍发送”）。
  const openSlashPopup = useCallback(() => {
    setSlashOpen(true)
    setSlashIndex(0)
    void refreshSlashCommands()
  }, [refreshSlashCommands])

  const closeSlashPopup = useCallback(() => {
    setSlashOpen(false)
    setSlashFilter('')
    setSlashIndex(0)
    slashContextRef.current = null
  }, [])

  /** 选中命令：替换当前 /<filter> 片段；无法匹配时在当前选区插入。 */
  const selectSlashCmd = useCallback(
    (cmd: CommandListItem) => {
      const currentValue = value
      const el = textareaRef.current
      const selection = el?.getSelection()
      const selectionStart = selection?.start ?? currentValue.length
      const selectionEnd = selection?.end ?? selectionStart
      const inserted = `/${cmd.name} `
      const slashContext = slashContextRef.current
      const canReplaceFilter =
        slashContext != null &&
        slashContext.end === selectionStart &&
        currentValue.slice(slashContext.start, selectionStart) === `/${slashContext.query}`
      const replaceStart =
        canReplaceFilter && slashContext != null ? slashContext.start : selectionStart
      const nextValue =
        currentValue.slice(0, replaceStart) + inserted + currentValue.slice(selectionEnd)
      const newCaret = replaceStart + inserted.length

      closeSlashPopup()
      setValue(nextValue)
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (textarea == null) return
        textarea.focus()
        textarea.setSelectionRange(newCaret, newCaret)
      })
    },
    [closeSlashPopup, setValue, value],
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
    (textarea: HTMLElement, charIndex: number): { left: number; top: number } => {
      const taRect = textarea.getBoundingClientRect()
      const style = window.getComputedStyle(textarea)
      const currentValue = textareaRef.current?.getValue() ?? textarea.textContent ?? ''
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

      const before = currentValue.slice(0, charIndex)
      const marker = document.createElement('span')
      marker.textContent = '​'
      mirror.appendChild(document.createTextNode(before))
      mirror.appendChild(marker)
      mirror.appendChild(document.createTextNode(currentValue.slice(charIndex) || ' '))
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

  // 高度调整完成后再校正滚动位置，确保换行后的新光标行立即可见。
  useEffect(() => {
    const el = textareaRef.current?.getElement()
    if (el == null) return
    const frame = requestAnimationFrame(() =>
      scrollTextareaCaretIntoView(
        el,
        computeCaretViewportPosition,
        () => textareaRef.current?.getSelection() ?? { start: 0, end: 0 },
      ),
    )
    return () => cancelAnimationFrame(frame)
  }, [manualExpanded, value, computeCaretViewportPosition])

  const handleValueChange = useCallback(
    (next: string) => {
      setTextEditMenu(null)
      setValue(next)
      // Reset history browsing when user types manually
      historyIndexRef.current = -1
      // 团队模式：`@` 留给 Agent mention；斜杠命令则按光标前最近的片段触发。
      const caret = textareaRef.current?.getSelection().start ?? next.length
      const slashContext = getSlashCommandContext(next, caret)
      const hasAtLead = next.startsWith('@')
      if (slashContext != null) {
        slashContextRef.current = slashContext
        setSlashFilter(slashContext.query)
        void openSlashPopup()
      } else if (hasAtLead && !teamConfig.enabled) {
        slashContextRef.current = null
        setSlashFilter(next.slice(1))
        void openSlashPopup()
      } else {
        slashContextRef.current = null
        if (slashOpen) closeSlashPopup()
      }

      // ── Mention 检测：仅团队模式启用时生效 ──
      if (!teamConfig.enabled) {
        if (mentionOpen) closeMentionPopup()
        return
      }
      // 从光标向前找最近的 `@`：输入 `@` 即触发，不再要求前面是行首/空白；中间不能含空白
      const el = textareaRef.current
      if (el == null) return
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
        const element = el.getElement()
        if (element == null) return
        const pos = computeCaretViewportPosition(element, atIndex)
        setMentionAnchor(pos)
      } catch {
        // 镜像 div 偶发失败时退化为 textarea 左下角
        const r = el.getElement()?.getBoundingClientRect()
        if (r == null) return
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

  // ── 语音输入（离线 ASR：sherpa-onnx + Paraformer 流式）──
  const voiceIntegrity = useVoiceIntegrity()
  const requestVoicePackInstall = useVoiceDownloadConfirmation(voiceIntegrity.install)
  const voice = useVoiceInput({
    onFinal: (text) => {
      setValue((prev) => {
        if (!text) return prev
        const needSpace = prev.length > 0 && !/\s$/.test(prev)
        return prev + (needSpace ? ' ' : '') + text
      })
    },
    onError: (message) => toast.error(message),
  })
  const handleVoiceToggle = useCallback(async () => {
    if (voice.status === 'recording' || voice.status === 'starting') {
      await voice.stop()
      return
    }
    if (voice.status === 'stopping') return
    const st = voiceIntegrity.status
    if (!st.supported) {
      toast.warning(st.unsupportedReason ?? '当前平台不支持语音输入')
      return
    }
    if (!st.ready) {
      await requestVoicePackInstall()
      return
    }
    await voice.start()
  }, [voice, voiceIntegrity, requestVoicePackInstall, toast])

  const voiceInputActive =
    voice.status === 'starting' || voice.status === 'recording' || voice.status === 'stopping'
  useLayoutEffect(() => {
    voiceInputActiveRef.current = voiceInputActive
  }, [voiceInputActive])
  useVoiceInputShortcut({
    disabled:
      sending ||
      voice.status === 'stopping' ||
      voiceIntegrity.checking ||
      voiceIntegrity.status.downloading ||
      !voiceIntegrity.status.supported,
    onToggle: () => void handleVoiceToggle(),
  })

  // 录音时把实时 partial 叠加到输入框末尾（整体替换式展示）；停止后回落到正式草稿值
  const voiceDisplayValue = voice.status === 'recording' ? value + voice.partialText : value

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

  const handleTextContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    const target = textareaRef.current
    if (target == null) return
    const selection = target.getSelection()
    const start = selection.start
    const end = selection.end
    setTextEditMenu({
      x: event.clientX,
      y: event.clientY,
      target,
      hasSelection: end > start,
      isEditable: true,
    })
  }, [])

  // 弹窗打开期间在 window 捕获阶段统一处理 Escape / Enter / Tab：焦点不在输入框时（如点过
  // 消息区、或从 + 菜单打开弹窗），textarea 上的 handleKeyDown 收不到事件；焦点在输入框内时
  // 也不能放行 Enter/Tab —— Lexical 挂在 contentEditable 上的原生监听器先于 React 合成事件
  // handleKeyDown 执行，放行后 Enter 会被 Lexical 先插成换行符，onChange 检测不到 / 上下文
  // 随即关掉弹窗，Enter 随后落到发送分支（把 / 当消息发出）。window 捕获阶段先于一切目标阶段
  // 监听器，在这里选择命令并掐断传播，事件不会到达 Lexical，弹窗状态不被破坏。
  // Escape 同理只关弹窗、不触发中断生成等其他全局 Escape 行为。
  useEffect(() => {
    if (!slashOpen && !mentionOpen) return
    const handlePopupKeydown = (event: KeyboardEvent) => {
      // IME 组合确认的 Enter / 取消组合的 Escape 交给输入法，不作用于弹窗
      if (composingRef.current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (slashOpen) closeSlashPopup()
        if (mentionOpen) closeMentionPopup()
        return
      }
      if (
        (event.key !== 'Enter' && event.key !== 'Tab') ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      if (slashOpen && flatSlashList.length > 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const cmd = flatSlashList[slashIndex] ?? flatSlashList[0]
        if (cmd != null) selectSlashCmd(cmd)
        return
      }
      if (slashOpen && flatSlashList.length === 0) {
        // 与输入框内语义一致：无匹配命令时 Enter 收起弹窗，不落到其他全局 Enter 行为
        event.preventDefault()
        event.stopImmediatePropagation()
        closeSlashPopup()
        return
      }
      if (mentionOpen && filteredMentionCandidates.length > 0) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const candidate = filteredMentionCandidates[mentionIndex] ?? filteredMentionCandidates[0]
        if (candidate != null) handleMentionSelect(candidate)
      }
    }
    window.addEventListener('keydown', handlePopupKeydown, { capture: true })
    return () => window.removeEventListener('keydown', handlePopupKeydown, { capture: true })
  }, [
    slashOpen,
    mentionOpen,
    flatSlashList,
    slashIndex,
    filteredMentionCandidates,
    mentionIndex,
    closeSlashPopup,
    closeMentionPopup,
    selectSlashCmd,
    handleMentionSelect,
  ])

  // scroll selected item into view
  useEffect(() => {
    if (!slashOpen) return
    const el = slashListRef.current?.querySelector<HTMLElement>('.slash-cmd-item.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [slashIndex, slashOpen])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
    // IME 组合期以 compositionstart/end 维护的 composingRef 为准（真实组合会话的可靠信号）。
    // macOS 中文输入法会把 Enter 的 keydown 误标为 keyCode 229 / isComposing（无真实组合时也是），
    // 曾把命令弹窗的 Enter 选择静默吞掉；Tab/Escape 不被 IME 标记，表现为「只有 Tab 能插入」。
    // 裸 isComposing / 229 仅在紧跟 compositionend 的 100ms 内视为「组合确认键的余波」继续拦截。
    if (composingRef.current) {
      return
    }
    if (
      (nativeEvent.isComposing === true || event.keyCode === 229) &&
      performance.now() - compositionEndedAtRef.current < 100
    ) {
      return
    }

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
      if (isComposerCommandSelectionKey(event.key, event.shiftKey)) {
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
      if (isComposerCommandSelectionKey(event.key, event.shiftKey)) {
        event.preventDefault()
        if (flatSlashList.length > 0) {
          // 过滤条件变化期间索引可能越界，回落到第一项，避免回车看似无响应
          const cmd = flatSlashList[slashIndex] ?? flatSlashList[0]
          if (cmd != null) selectSlashCmd(cmd)
          return
        }
        // 无匹配命令时只关闭弹窗并吞掉本次 Enter：此时回车的语义是「收起弹窗」，
        // 不应落入下方的正常发送逻辑（用户感知为「弹窗开着回车直接发送」）。
        closeSlashPopup()
        return
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
        writeAgentRuntimePrefs(effectiveAgentId, { permissionMode: nextMode })
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
      const el = textareaRef.current
      const selection = el?.getSelection()
      const atStart = selection?.start === 0 && selection.end === 0
      const atEnd =
        el != null &&
        selection?.start === el.getValue().length &&
        selection.end === el.getValue().length

      if (event.key === 'ArrowDown') {
        const currentIdx = historyIndexRef.current
        if (atEnd && currentIdx !== -1) {
          const history = sentHistoryRef.current
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

        if (
          el != null &&
          shouldMoveComposerCaretToEndOnArrowDown(selection, el.getValue().length)
        ) {
          event.preventDefault()
          const end = el.getValue().length
          el.setSelectionRange(end, end)
        }
        return
      }

      const history = sentHistoryRef.current
      if (history.length === 0) return // let native cursor movement work

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
  // a session command should insert at the cursor instead of clearing the existing input.
  const lastPaletteCommandRequestIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (paletteCommandRequest == null) return
    if (paletteCommandRequest.id === lastPaletteCommandRequestIdRef.current) return
    lastPaletteCommandRequestIdRef.current = paletteCommandRequest.id

    const { commandText } = paletteCommandRequest
    const el = textareaRef.current
    // 读取当前选区；如果 textarea 不在 DOM 中，则退化为追加到末尾
    const selection = el?.getSelection()
    const selectionStart = selection?.start ?? value.length
    const selectionEnd = selection?.end ?? selectionStart
    const currentValue = value
    const next =
      currentValue.slice(0, selectionStart) + commandText + currentValue.slice(selectionEnd)
    setValue(next)
    setSlashOpen(false)
    setSlashFilter('')
    setSlashIndex(0)
    setTextEditMenu(null)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta == null) return
      ta.focus()
      const newCaret = selectionStart + commandText.length
      ta.setSelectionRange(newCaret, newCaret)
    })
  }, [paletteCommandRequest, setValue, value])

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
    const keepCliSparkOverride =
      selectedProvider?.id === provider.id && isBuiltInLocalCliProvider(provider)
    const clearCliSparkOverride = cliSparkOverride != null && !keepCliSparkOverride
    if (clearCliSparkOverride) setCliSparkOverride(null)
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
        ...(clearCliSparkOverride ? { cliSparkOverride: null } : {}),
      })
      const afterMessageId = messages.at(-1)?.id
      if (afterMessageId != null && previousModel.length > 0 && previousModel !== nextModel) {
        onModelSwitch?.({ fromModel: previousModel, toModel: nextModel, afterMessageId })
      }
    } else if (clearCliSparkOverride) {
      await persistRuntimePatch({ cliSparkOverride: null })
    }
  }

  const handleProviderModelChange = async (providerId: string, modelId: string) => {
    const provider = providers.find((item) => item.id === providerId)
    if (provider == null) return
    const keepCliSparkOverride =
      selectedProvider?.id === provider.id && isBuiltInLocalCliProvider(provider)
    const isHostCliModel =
      isBuiltInLocalCliProvider(provider) &&
      modelId === getProviderDefaultModel(provider, provider.modelIds[0])
    const clearCliSparkOverride =
      cliSparkOverride != null && (!keepCliSparkOverride || isHostCliModel)
    if (clearCliSparkOverride) setCliSparkOverride(null)
    const nextAdapter = getProviderAdapterKind(provider)
    const nextPermissionMode =
      adapter === nextAdapter
        ? effectivePermissionMode
        : (getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask')
    const nextModel =
      resolveAvailableProviderModel(modelId, provider) ||
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
        ...(clearCliSparkOverride ? { cliSparkOverride: null } : {}),
      })
      const afterMessageId = messages.at(-1)?.id
      if (afterMessageId != null && previousModel.length > 0 && previousModel !== nextModel) {
        onModelSwitch?.({ fromModel: previousModel, toModel: nextModel, afterMessageId })
      }
    } else if (clearCliSparkOverride) {
      await persistRuntimePatch({ cliSparkOverride: null })
    }
  }

  const handleCliSparkModelChange = async (
    cliProviderId: string,
    providerId: string,
    modelId: string,
  ) => {
    const cliProvider = providers.find((item) => item.id === cliProviderId)
    const provider = cliSparkProvidersByPrimaryId
      .get(cliProviderId)
      ?.find((item) => item.id === providerId)
    if (cliProvider == null || !isBuiltInLocalCliProvider(cliProvider) || provider == null) return
    const hostModelId = getProviderDefaultModel(cliProvider, cliProvider.modelIds[0])
    const nextModel =
      resolveAvailableProviderModel(modelId, provider) ||
      getProviderDefaultModel(provider, provider.modelIds[0]) ||
      modelId
    const nextOverride: CliSparkOverride = { providerProfileId: provider.id, modelId: nextModel }
    const nextAdapter = getProviderAdapterKind(cliProvider)
    const nextPermissionMode =
      adapter === nextAdapter
        ? effectivePermissionMode
        : (getPermissionModeOptions(nextAdapter)[0]?.value ?? 'claude-ask')
    const primaryProviderChanged = selectedProvider?.id !== cliProvider.id
    const previousModel = effectiveModelId.trim()

    setDraftAdapter(nextAdapter)
    setDraftPermissionMode(nextPermissionMode)
    setSelectedProviderId(cliProvider.id)
    setDraftModelId(hostModelId)
    rememberCliSparkOverride(cliProvider.id, nextOverride)
    setCliSparkOverride(nextOverride)
    writeComposerPrefs({
      adapter: nextAdapter,
      providerProfileId: cliProvider.id,
      modelId: hostModelId,
      permissionMode: nextPermissionMode,
    })
    await persistRuntimePatch({
      providerProfileId: cliProvider.id,
      modelId: hostModelId || null,
      agentAdapter: nextAdapter,
      permissionMode: nextPermissionMode,
      cliSparkOverride: nextOverride,
    })
    const afterMessageId = messages.at(-1)?.id
    if (
      primaryProviderChanged &&
      afterMessageId != null &&
      previousModel.length > 0 &&
      previousModel !== hostModelId
    ) {
      onModelSwitch?.({ fromModel: previousModel, toModel: hostModelId, afterMessageId })
    }
  }

  const handleCliSparkClear = async () => {
    if (cliSparkOverride == null) return
    setCliSparkOverride(null)
    await persistRuntimePatch({ cliSparkOverride: null })
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
      const clearCliSparkOverride =
        cliSparkOverride != null &&
        (selectedProvider?.id !== nextProvider.id || !isBuiltInLocalCliProvider(nextProvider))
      if (clearCliSparkOverride) setCliSparkOverride(null)
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
          ...(clearCliSparkOverride ? { cliSparkOverride: null } : {}),
        })
      }
      return
    }
    if (cliSparkOverride != null) setCliSparkOverride(null)
    writeComposerPrefs({ adapter: nextAdapter, permissionMode: nextPermissionMode })
    if (session != null)
      await persistRuntimePatch({
        agentAdapter: nextAdapter,
        permissionMode: nextPermissionMode,
        ...(cliSparkOverride != null ? { cliSparkOverride: null } : {}),
      })
    else if (cliSparkOverride != null) await persistRuntimePatch({ cliSparkOverride: null })
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
      providers.find((item) => item.id === session?.providerProfileId) ??
      getPreferredProvider(
        providers,
        { ...readComposerPrefs(), agentId: agent.id },
        agent.agentAdapter,
      )
    const configuredModel = agent.modelId?.trim() ?? ''
    const previousSessionModel = session?.modelId?.trim() || draftModelId.trim()
    const inheritedModel =
      provider != null &&
      previousSessionModel.length > 0 &&
      providerSupportsModel(provider, previousSessionModel)
        ? previousSessionModel
        : ''
    const model =
      provider != null && isLocalCliProvider(provider)
        ? getProviderDefaultModel(provider)
        : configuredModel || inheritedModel || provider?.defaultModel || provider?.modelIds[0] || ''
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
   * - historical "resend" writes text, attachments, and session references back into the draft;
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
    // 已标记本次 requestId 为已消费，立即通知父组件清空 resendRequest。
    // 这样即使后续 ComposerV2 因 showEmptyHero 翻转而卸载重建（consumedResendIdRef 重置），
    // resendRequest 也已是 null，effect 会在 current == null 时直接 return，不会把旧
    // payload 重新写进切进来的会话草稿。setValue/setAttachments 在下方同步调用，
    // setState 会被批处理到下一次渲染，不受此回调触发的父组件重渲染抢占。
    onResendConsumed?.()
    const { payload } = current

    if (payload.agentId != null) {
      void applyAgentRuntime(payload.agentId)
    }

    // 文本立即写入（用户能马上看到效果）

    setValue(payload.text)
    setSessionReferences(payload.sessionReferences ?? [])
    setCodeReferences([])

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
  }, [
    resendRequest,
    setValue,
    setAttachments,
    setSessionReferences,
    prepareImagePreview,
    onResendConsumed,
  ])

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
    writeAgentRuntimePrefs(effectiveAgentId, { reasoningEffort })
    if (session != null) await persistRuntimePatch({ reasoningEffort })
  }

  const handleFastModeChange = async (fastMode: boolean) => {
    setDraftFastMode(fastMode)
    await persistRuntimePatch({ fastMode })
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
      <VoiceInstallToast
        progress={voiceIntegrity.progress}
        status={voiceIntegrity.status}
        onRetry={() => void voiceIntegrity.install()}
      />
      <div className="composer-inner">
        {visibleApprovalRequest && (
          <InlinePermissionApproval
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
          <QueuedTaskList
            messages={queuedMessages}
            clearing={clearingQueue}
            reordering={reorderingQueue}
            onClear={() => void handleClearQueuedMessages()}
            onEdit={(message) => void handleEditQueuedMessage(message)}
            onSendNow={(message) => void handleSendQueuedNow(message)}
            onRemove={(message) => void handleRemoveQueuedMessage(message)}
            onReorder={handleReorderQueuedMessages}
          />
        )}
        {previewAttachment != null && (
          <ImagePreviewModal
            src={resolveComposerImageSrc(previewAttachment.previewPath ?? previewAttachment.path)}
            alt={previewAttachment.name}
            fileName={previewAttachment.name}
            onClose={() => setPreviewAttachment(null)}
          />
        )}
        <ComposerDropOverlay active={fileDropActive} className="composer-file-drop-overlay">
          <div className="composer-file-drop-target">
            <span className="composer-file-drop-icon" aria-hidden="true">
              <Icons.FilePlus size={42} strokeWidth={1.6} />
            </span>
            <strong>松开即可添加到会话</strong>
            <span>支持文件和文件夹</span>
          </div>
        </ComposerDropOverlay>
        {sessionReferenceDropActive && (
          <div className="composer-session-ref-drop-overlay" aria-live="polite">
            <div className="composer-session-ref-drop-target">
              <Icons.MessageSquarePlus size={32} />
              <strong>松开即可添加会话参考</strong>
              <span>模型将按需只读访问该会话</span>
            </div>
          </div>
        )}
        {activeQuickReplies != null &&
          !isBusy &&
          attachments.length === 0 &&
          sessionReferences.length === 0 && (
            <QuickReplySuggestions
              replies={activeQuickReplies.replies}
              onSelect={(reply) => {
                if (selectedProvider == null || !submitGateRef.current.tryEnter()) return
                const message = buildQuickReplyMessage(reply, value)
                setValue('')
                void dispatchMessage(message, [], null).finally(() => submitGateRef.current.leave())
              }}
              onDismiss={() => setDismissedQuickReplyKey(activeQuickReplies.key)}
            />
          )}
        <div
          data-session-reference-drop-target
          className={`composer composer-v2 has-workspace-picks ${teamConfig.enabled ? 'composer-team-mode' : ''} ${manualExpanded ? 'expanded' : ''}${sessionReferenceDropActive ? ' is-session-reference-drop-active' : ''}`}
        >
          {slashOpen && flatSlashList.length > 0 && (
            <div className="slash-cmd-popup" ref={slashListRef}>
              <div className="slash-cmd-toolbar">
                <span className="slash-cmd-toolbar-hint">↑↓ 选择 · Enter 插入 · Esc 关闭</span>
                <button
                  type="button"
                  className="slash-cmd-close"
                  title="关闭命令面板"
                  aria-label="关闭命令面板"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    closeSlashPopup()
                  }}
                >
                  <Icons.X size={12} />
                </button>
              </div>
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
                                ? cmd.group === 'project-skill'
                                  ? '项目'
                                  : '技能'
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
          {teamConfig.enabled && (
            <div className="composer-team-banner">
              <span className="composer-team-banner-badge">
                <Icons.Team size={12} /> 团队模式
              </span>
              <span className="composer-team-banner-text">
                Host：{activeAgent?.name ?? 'Spark助手'} · 成员{' '}
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

          {(codeReferences.length > 0 ||
            imageAttachments.length > 0 ||
            fileAttachments.length > 0 ||
            directoryAttachments.length > 0 ||
            browserReferences.length > 0 ||
            sessionReferences.length > 0) && (
            <div className="composer-attachments-inside">
              {browserReferences.length > 0 && (
                <div
                  className="composer-attachment-strip composer-browser-ref-strip"
                  aria-label="浏览器元素引用"
                >
                  {browserReferences.map((reference) => (
                    <Tooltip
                      key={reference.id}
                      title={`${formatBrowserReferenceLine(reference)}`}
                      placement="top"
                      mouseEnterDelay={0.05}
                    >
                      <div className="composer-attachment-chip composer-browser-ref-chip">
                        <Icons.Globe size={13} />
                        <div className="composer-session-ref-copy">
                          <span>{reference.label}</span>
                        </div>
                        <button
                          type="button"
                          title="移除浏览器元素引用"
                          aria-label={`移除 ${reference.label} 引用`}
                          onClick={() =>
                            setBrowserReferences((current) =>
                              current.filter((item) => item.id !== reference.id),
                            )
                          }
                        >
                          <Icons.X size={12} />
                        </button>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              )}
              {sessionReferences.length > 0 && (
                <div
                  className="composer-attachment-strip composer-session-ref-strip"
                  aria-label="会话参考"
                >
                  {sessionReferences.map((reference) => {
                    const referenceTitle = reference.title || '未命名会话'
                    return (
                      <Tooltip
                        key={reference.sourceSessionId}
                        title={referenceTitle}
                        placement="top"
                        mouseEnterDelay={0.05}
                      >
                        <div
                          className={`composer-attachment-chip composer-session-ref-chip${reference.status === 'unavailable' ? ' is-unavailable' : ''}`}
                        >
                          <Icons.MessageSquare size={13} />
                          <div className="composer-session-ref-copy">
                            <span>{referenceTitle}</span>
                          </div>
                          <button
                            type="button"
                            title="移除会话参考"
                            aria-label={`移除 ${referenceTitle} 参考`}
                            onClick={() => removeSessionReference(reference.sourceSessionId)}
                          >
                            <Icons.X size={12} />
                          </button>
                        </div>
                      </Tooltip>
                    )
                  })}
                </div>
              )}
              {codeReferences.length > 0 && (
                <div className="composer-attachment-strip composer-code-ref-strip">
                  {codeReferences.map((ref) => {
                    const refKey = codeRefKey(ref)
                    return (
                      <div
                        key={refKey}
                        className="composer-attachment-chip composer-code-ref-chip"
                        title={formatCodeReferenceLine(ref)}
                      >
                        <FileChipIcon path={ref.path} size={13} />
                        <div className="composer-code-ref-text">
                          <span className="composer-code-ref-name">{ref.name}</span>
                          <span className="composer-code-ref-loc">
                            {formatCodeReferenceLine(ref)}
                          </span>
                        </div>
                        <button
                          type="button"
                          title="移除引用"
                          aria-label={`移除 ${ref.name} 引用`}
                          onClick={() => handleRemoveCodeReference(refKey)}
                        >
                          <Icons.X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
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
                    <div
                      key={attachment.id}
                      className="composer-attachment-chip"
                      title={attachment.path}
                    >
                      <FileChipIcon path={attachment.path} size={13} />
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        title="移除附件"
                        aria-label={`移除 ${attachment.name}`}
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
                        aria-label={`移除 ${attachment.name}`}
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
          <div className="composer-input-shell">
            <ComposerLexicalInput
              ref={textareaRef}
              value={voiceDisplayValue}
              commandNames={slashCommandNames}
              skillNames={knownSkillNames}
              placeholder={composerPlaceholder}
              readOnly={voiceInputActive}
              onChange={handleValueChange}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
                compositionEndedAtRef.current = performance.now()
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
            <TextEditContextMenu
              menu={textEditMenu}
              onClose={() => setTextEditMenu(null)}
              onPasteAsText={(target) => void handlePasteAsText(target)}
              onPasteAsResource={() => void handlePasteAsResource()}
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
                  disabled={sending || providers.length === 0}
                  cliSparkProvidersByPrimaryId={cliSparkProvidersByPrimaryId}
                  cliSparkOverride={cliSparkOverride}
                  onCliSparkModelChange={handleCliSparkModelChange}
                  onCliSparkClear={handleCliSparkClear}
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
                  {...(onFetchBranches !== undefined ? { onFetch: onFetchBranches } : {})}
                  {...(onCheckoutBranchTag !== undefined
                    ? { onCheckoutTag: onCheckoutBranchTag }
                    : {})}
                  {...(onCreateBranchFromTag !== undefined ? { onCreateBranchFromTag } : {})}
                />
              )}
            </div>
            <VoiceMicButton
              status={voice.status}
              audioLevelStore={voice.audioLevelStore}
              ready={voiceIntegrity.status.ready}
              checking={voiceIntegrity.checking}
              downloading={voiceIntegrity.status.downloading}
              unsupported={!voiceIntegrity.status.supported}
              disabled={sending}
              onClick={() => void handleVoiceToggle()}
            />
            <button
              className={`composer-send-round ${sending ? 'is-sending' : ''} ${primaryAction === 'stop' ? 'is-stopping' : ''}`}
              title={resolveComposerPrimaryActionTitle(
                primaryAction,
                isWorking,
                voiceInputActive,
                needsTeamSelection,
              )}
              onClick={() => void handlePrimaryAction()}
              disabled={
                primaryAction === 'stop' ? session?.id == null : voiceInputActive || !canSubmit
              }
            >
              {sending ? (
                <Icons.Spinner size={14} />
              ) : primaryAction === 'stop' ? (
                <Icons.Stop size={11} />
              ) : (
                <Icons.ArrowUp size={16} />
              )}
            </button>
          </div>
        </div>
        <div ref={composerParamBarRef} className="composer-param-bar composer-controls">
          <ComposerActionsMenu
            onAddAttachments={() => void handleAddAttachments()}
            onInsertSkillMention={handleInsertSkillMention}
            onOpenSkillStore={onOpenSkillStore}
            onAddContextFiles={() => void handleAddContextFiles()}
            onAddSessionReference={() => setSessionReferencePickerOpen(true)}
            sessionId={session?.id ?? null}
            onInsertSlashCommand={() => {
              // 打开斜杠命令面板：保留已有输入，不覆盖 value。
              // 弹窗以全量列表呈现；选中命令后由 selectSlashCmd 在当前光标处增量插入。
              // 需按字符筛选时，直接在输入框键入 `/xxx`（走 inline 触发路径）。
              setSlashFilter('')
              slashContextRef.current = null
              void openSlashPopup()
              requestAnimationFrame(() => {
                const el = textareaRef.current
                if (el == null) return
                el.focus()
                // 无选区时光标移到末尾，便于随后增量插入命令；有选区时保持，选中命令时替换选区。
                const selection = el.getSelection()
                if (selection.start === selection.end) {
                  const end = el.getValue().length
                  el.setSelectionRange(end, end)
                }
              })
            }}
            // 仅在发送瞬间禁用（防重复提交）；任务执行中允许继续挂附件/插技能（只改下一轮草稿，不影响运行中的会话）
            disabled={sending}
          />
          <SessionReferencePicker
            open={sessionReferencePickerOpen}
            targetSessionId={session?.id ?? null}
            selected={knownReferenceItems}
            workspaceId={activeWorkspaceId}
            fallbackCandidates={fallbackReferenceCandidates}
            onClose={() => setSessionReferencePickerOpen(false)}
            onSelect={(candidate) => {
              addSessionReference(candidate)
              setSessionReferencePickerOpen(false)
            }}
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
              writeAgentRuntimePrefs(effectiveAgentId, { permissionMode })
              if (session != null) void persistRuntimePatch({ permissionMode })
            }}
            options={permissionOptions}
          />
          <ComposerReasoningControl
            value={effectiveReasoning}
            options={getReasoningOptions(adapter)}
            fastMode={effectiveFastMode}
            showFastMode={showFastMode}
            disabled={false}
            onChange={handleReasoningChange}
            onFastModeChange={handleFastModeChange}
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
              effectiveDebugMode={effectiveDebugMode}
              getRuntimePatchSnapshot={getCurrentRuntimePatch}
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
                  title={isGitWorkspace ? '在隔离 worktree 中运行本会话' : worktreeUnavailableHint}
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
              disabled={voiceInputActive || !canSubmit}
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
 * ComposerMenuSelect 复用已拆出的 ComposerSelectLabelTicker 标签动画。
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

/**
 * ProjectPicker — 项目选择器（下拉）
 * 位置：输入框内部右下角，靠近发送按钮
 * 下拉内容：
 *   - "项目"分组：用户的全部普通项目，当前选中的打勾
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

  // 与会话栏（SidebarSessionList）保持一致的项目排序：
  //   1. listSelectableWorkspaces 先过滤临时/画布/worktree 项目，按 updatedAt 倒序作为 fallback；
  //   2. 再套 sidebarOrder.projectIds（用户在侧栏手动拖出的顺序）+ 置顶段（pinnedAt 非空）前置。
  // 这样置顶项目恒定居首，手动顺序也与侧栏一致。
  const { sidebarOrder } = useSessionSidebar()
  const projects = useMemo(
    () =>
      sortByManualOrderWithinPinnedSections(
        listSelectableWorkspaces(workspaces, NO_PROJECT_WORKSPACE_NAME),
        sidebarOrder.projectIds,
        (workspace) => workspace.id,
        (workspace) => workspace.pinnedAt != null,
      ),
    [workspaces, sidebarOrder.projectIds],
  )

  const noProjectWorkspace = workspaces.find((w) => w.name === NO_PROJECT_WORKSPACE_NAME) ?? null
  const isNoProject = activeWorkspaceId != null && noProjectWorkspace?.id === activeWorkspaceId
  // 若当前活动 workspace 恰是 worktree（理论上不应发生），显示其 base 项目，避免误导
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const rawSelected =
    isNoProject || activeWorkspace == null || isCanvasWorkspace(activeWorkspace)
      ? null
      : activeWorkspace
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
          <div className="composer-project-list">
            {projects.length > 0 && (
              <>
                <div className="composer-project-group-header">项目</div>
                {projects.map((w) => (
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
              </>
            )}
          </div>
          <div className="composer-project-actions">
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
                ? `团队：${activeTeamName ?? '团队'}（主持：${selected?.name ?? 'Spark助手'}）`
                : `团队模式（当前对话：${selected?.name ?? 'Spark助手'}）`
              : (selected?.name ?? 'Spark助手')
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>
          {teamMode && teamConfig.teamId != null && activeTeamName
            ? activeTeamName
            : (selected?.name ?? 'Spark助手')}
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
  cliSparkProvidersByPrimaryId,
  cliSparkOverride,
  onCliSparkModelChange,
  onCliSparkClear,
  onChange,
}: {
  icon: ReactNode
  providers: ProviderProfile[]
  selectedProviderId: string
  selectedModelId: string
  disabled?: boolean
  cliSparkProvidersByPrimaryId?: ReadonlyMap<string, ProviderProfile[]>
  cliSparkOverride?: CliSparkOverride | null
  onCliSparkModelChange?: (
    cliProviderId: string,
    providerId: string,
    modelId: string,
  ) => void | Promise<void>
  onCliSparkClear?: () => void | Promise<void>
  onChange: (providerId: string, modelId: string) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<'topLeft' | 'topRight'>('topLeft')
  const { pinned, isPinned, togglePinned } = usePinnedModels()
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
      filterProvidersForVisibleUi(providers).filter(
        (provider) =>
          provider.modelType !== 'image' &&
          provider.modelType !== 'voice' &&
          provider.modelType !== 'video',
      ),
    [providers],
  )
  // 模糊搜索：命中供应商名/厂商名则保留其全部模型，否则只保留模型名命中的
  const normalizedSearch = search.trim().toLowerCase()
  const cliSparkProviderGroupsByPrimaryId = useMemo(() => {
    const result = new Map<string, CliSparkProviderGroup[]>()
    for (const [primaryId, sparkProviders] of cliSparkProvidersByPrimaryId ?? []) {
      const groups = prioritizeManagedProviderGroups(
        sparkProviders
          .filter(isCliSparkConversationProvider)
          .map((provider) => {
            const configuredModels = provider.modelIds.length
              ? provider.modelIds
              : provider.defaultModel
                ? [provider.defaultModel]
                : []
            if (normalizedSearch === '') return { provider, models: configuredModels }
            const vendorName = resolveProviderVendor(provider)?.name ?? ''
            const providerMatches =
              provider.name.toLowerCase().includes(normalizedSearch) ||
              vendorName.toLowerCase().includes(normalizedSearch)
            const models = providerMatches
              ? configuredModels
              : configuredModels.filter(
                  (modelId) =>
                    modelId.toLowerCase().includes(normalizedSearch) ||
                    getPickerModelDisplayLabel(provider, modelId, modelNameById)
                      .toLowerCase()
                      .includes(normalizedSearch),
                )
            return { provider, models }
          })
          .filter((group) => group.models.length > 0),
      )
      result.set(primaryId, groups)
    }
    return result
  }, [cliSparkProvidersByPrimaryId, modelNameById, normalizedSearch])
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
        const hasSparkMatch =
          isBuiltInLocalCliProvider(provider) &&
          (cliSparkProviderGroupsByPrimaryId.get(provider.id)?.length ?? 0) > 0
        return {
          provider,
          models:
            matchedModels.length > 0 || !hasSparkMatch
              ? matchedModels
              : [configuredModels[0] ?? getProviderDefaultModel(provider)],
        }
      })
      .filter((group) => group.models.length > 0),
  )
  // 置顶模型汇总到顶部「常用」组；解析基于过滤后的分组，搜索时「常用」组同步收窄
  const pinnedEntries = resolvePinnedModelEntries(pinned, filteredProviderGroups)
  const selectedProviderById = conversationalProviders.find(
    (provider) => provider.id === selectedProviderId,
  )
  const selectedProviderByModel = findProviderForModel(conversationalProviders, selectedModelId)
  const selectedProvider =
    (selectedModelId.trim().length === 0 ||
    providerSupportsModel(selectedProviderById, selectedModelId)
      ? selectedProviderById
      : undefined) ??
    selectedProviderByModel ??
    selectedProviderById ??
    conversationalProviders[0]
  const resolvedSelectedProviderId = selectedProvider?.id ?? selectedProviderId
  const selectedCliSparkProvider =
    selectedProvider != null &&
    isBuiltInLocalCliProvider(selectedProvider) &&
    cliSparkOverride != null
      ? cliSparkProvidersByPrimaryId
          ?.get(selectedProvider.id)
          ?.find((provider) => provider.id === cliSparkOverride.providerProfileId)
      : undefined
  const selectedCliSparkModelLabel =
    selectedCliSparkProvider != null && cliSparkOverride != null
      ? getPickerModelDisplayLabel(
          selectedCliSparkProvider,
          cliSparkOverride.modelId,
          modelNameById,
        )
      : undefined
  const primaryLabel = getPickerModelDisplayLabel(selectedProvider, selectedModelId, modelNameById)
  const label =
    selectedCliSparkModelLabel != null
      ? `${primaryLabel} · ${selectedCliSparkModelLabel}`
      : primaryLabel
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
      getPopupContainer={(triggerNode) =>
        triggerNode.closest<HTMLElement>('.chat-main-empty[data-empty-theme]') ?? document.body
      }
      onOpenChange={(nextOpen) => {
        if (disabled || conversationalProviders.length === 0) {
          setOpen(false)
          return
        }
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      popupRender={() => (
        <div
          className={`composer-dropdown-menu composer-model-menu${
            placement === 'topRight' ? ' is-right' : ''
          }`}
        >
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
            {pinnedEntries.length > 0 && (
              <div className="composer-model-group pinned-composer-model-group">
                <div className="composer-model-group-title">
                  <span className="composer-model-group-icon">
                    <Icons.PinFill size={12} />
                  </span>
                  <span>常用</span>
                </div>
                {pinnedEntries.map(({ provider, modelId }) => {
                  const vendor = resolveProviderVendor(provider)
                  return (
                    <ModelPickerMenuItem
                      key={`pinned:${provider.id}:${modelId}`}
                      label={getPickerModelDisplayLabel(provider, modelId, modelNameById)}
                      active={
                        provider.id === resolvedSelectedProviderId && modelId === selectedModelId
                      }
                      pinned
                      // 「常用」组混合了多个供应商，同名模型要靠 logo 区分来源
                      leading={
                        vendor ? (
                          <ProviderLogo
                            style={{ minWidth: 14 }}
                            vendor={vendor}
                            size={getProviderPickerLogoSize(provider)}
                            shape="rounded"
                          />
                        ) : undefined
                      }
                      onSelect={() => {
                        setOpen(false)
                        setSearch('')
                        void onChange(provider.id, modelId)
                      }}
                      onTogglePin={() => togglePinned(provider.id, modelId)}
                    />
                  )
                })}
              </div>
            )}
            {filteredProviderGroups.map(({ provider, models }) => {
              const cliSparkGroups = cliSparkProviderGroupsByPrimaryId.get(provider.id)
              if (
                isBuiltInLocalCliProvider(provider) &&
                cliSparkGroups != null &&
                cliSparkGroups.length > 0
              ) {
                const primaryModelId = models[0] ?? getProviderDefaultModel(provider)
                const sparkProvider =
                  provider.id === resolvedSelectedProviderId && cliSparkOverride != null
                    ? cliSparkProvidersByPrimaryId
                        ?.get(provider.id)
                        ?.find((item) => item.id === cliSparkOverride.providerProfileId)
                    : undefined
                const sparkModelLabel =
                  sparkProvider != null && cliSparkOverride != null
                    ? getPickerModelDisplayLabel(
                        sparkProvider,
                        cliSparkOverride.modelId,
                        modelNameById,
                      )
                    : undefined
                return (
                  <CliProviderModelMenu
                    key={provider.id}
                    primaryProvider={provider}
                    primaryModelId={primaryModelId}
                    primaryModelLabel={
                      sparkModelLabel != null
                        ? `${getPickerModelDisplayLabel(provider, primaryModelId, modelNameById)} · ${sparkModelLabel}`
                        : getPickerModelDisplayLabel(provider, primaryModelId, modelNameById)
                    }
                    primarySelected={provider.id === resolvedSelectedProviderId}
                    sparkOverride={cliSparkOverride ?? null}
                    providerGroups={cliSparkGroups}
                    disabled={disabled === true}
                    isPinned={isPinned}
                    togglePinned={togglePinned}
                    resolveVendor={resolveProviderVendor}
                    getModelLabel={(sparkProvider, modelId) =>
                      getPickerModelDisplayLabel(sparkProvider, modelId, modelNameById)
                    }
                    onSelectPrimaryModel={() => {
                      setOpen(false)
                      setSearch('')
                      void onChange(provider.id, primaryModelId)
                    }}
                    onSelectSparkModel={(sparkProviderId, modelId) => {
                      setOpen(false)
                      setSearch('')
                      void onCliSparkModelChange?.(provider.id, sparkProviderId, modelId)
                    }}
                    onClearSparkOverride={() => {
                      setOpen(false)
                      setSearch('')
                      void onCliSparkClear?.()
                    }}
                  />
                )
              }
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
                      <ModelPickerMenuItem
                        key={`${provider.id}:${modelId}`}
                        label={getPickerModelDisplayLabel(provider, modelId, modelNameById)}
                        active={active}
                        pinned={isPinned(provider.id, modelId)}
                        onSelect={() => {
                          setOpen(false)
                          setSearch('')
                          void onChange(provider.id, modelId)
                        }}
                        onTogglePin={() => togglePinned(provider.id, modelId)}
                      />
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
        title={disabled ? '会话运行中不可切换' : label}
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

// 参数选择栏响应式隐藏：只折叠右侧的低优先级控件，让 spacer 重新吃满剩余空间。
// 不能用 overflow:hidden —— 会把 .composer-select 的下拉弹窗一起裁掉。
function useResponsiveComposerParamVisibility(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const previousDisplay = new Map<HTMLElement, string>()

    const restore = () => {
      previousDisplay.forEach((display, item) => {
        item.style.display = display
      })
      previousDisplay.clear()
    }

    const getHideable = () =>
      [
        el.querySelector<HTMLElement>(
          ':scope > .composer-param-tail > .composer-worktree-controls',
        ),
        el.querySelector<HTMLElement>(':scope > .composer-debug-toggle'),
      ].filter((item): item is HTMLElement => item != null)

    const requiredWidth = () => {
      const visibleChildren = Array.from(el.children).filter(
        (child) => (child as HTMLElement).style.display !== 'none',
      ) as HTMLElement[]
      const gap = Number.parseFloat(getComputedStyle(el).columnGap || '0') || 0
      return (
        visibleChildren
          .filter((child) => !child.classList.contains('spacer'))
          .reduce((width, child) => width + child.getBoundingClientRect().width, 0) +
        Math.max(0, visibleChildren.length - 1) * gap
      )
    }

    const update = () => {
      restore()
      const availableWidth = el.getBoundingClientRect().width
      if (availableWidth <= 0) return

      // worktree 位于参数栏最右侧，优先隐藏；仍放不下时再隐藏调试开关。
      getHideable().forEach((item) => {
        if (requiredWidth() <= availableWidth) return
        previousDisplay.set(item, item.style.display)
        item.style.display = 'none'
      })
    }
    update()

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    // worktree / queued-chip 是条件渲染，子树变化时重新计算。
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    mo?.observe(el, { childList: true })
    return () => {
      restore()
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [ref])
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

const CODEX_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption & { value: PermissionModeChoice }> =
  SHARED_CODEX_PERMISSION_MODE_OPTIONS.map((option) => ({
    ...option,
    icon:
      option.value === 'codex-default' ? (
        <Icons.Hand size={18} />
      ) : option.value === 'codex-auto-review' ? (
        <Icons.Shield size={18} />
      ) : (
        <Icons.AlertTriangle size={18} />
      ),
  }))

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

/** 代码位置引用的去重 key：同文件同行号区间视为重复。 */
function codeRefKey(ref: CodeReference): string {
  return `${ref.path}:${ref.startLine}-${ref.endLine}`
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
): Array<{ value: SessionReasoningEffort; label: string; description: string }> {
  if (isClaudeAdapter(adapter)) {
    return [
      { value: 'minimal', label: '极低', description: '最低推理强度，优先缩短响应时间' },
      { value: 'low', label: '低', description: '减少推理开销，适合明确而简单的任务' },
      {
        value: 'medium',
        label: '平衡',
        description: '速度与质量均衡，适合大多数日常任务',
      },
      { value: 'high', label: '高', description: '加强分析，适合有一定复杂度的任务' },
      { value: 'xhigh', label: '超高', description: '进行更深入的推理，响应时间会更长' },
      { value: 'max', label: 'Max', description: '使用最高推理强度处理最复杂的任务' },
    ]
  }
  return [
    { value: 'minimal', label: '极低', description: '最低推理强度，优先缩短响应时间' },
    { value: 'low', label: '低', description: '减少推理开销，适合明确而简单的任务' },
    {
      value: 'medium',
      label: '平衡',
      description: '速度与质量均衡，适合大多数日常任务',
    },
    { value: 'high', label: '高', description: '加强分析，适合有一定复杂度的任务' },
    { value: 'xhigh', label: '超高', description: '进行更深入的推理，响应时间会更长' },
    { value: 'max', label: 'Max', description: '使用最高推理强度处理最复杂的任务' },
  ]
}
