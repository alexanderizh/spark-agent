/**
 * 通用 ChatPanel：消息流 + 工具调用卡片 + 输入区
 *
 * 复用 MessageBuilder（services/event-mapper）做事件→UIMessage 转换；
 * 渲染 text / thinking / tool_call / error / cancelled 等会话 block（其他类型对
 * 弹窗/模态场景不重要，跳过）。
 *
 * 给画布 Agent 弹窗 / Board 内嵌等场景使用；ChatView 仍是主聊天页，
 * 这里只承担"嵌入式会话面板"职责。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Spin } from 'antd'
import type { AgentEvent, ManagedAgent, SessionAttachment } from '@spark/protocol'
import type { UserQuestionOption, UserQuestionPrompt } from '@spark/protocol'
import { Icons } from '../Icons'
import {
  MessageBuilder,
  type UIMessage,
  type UIBlock,
  type UserQuestionAnswerSummary,
} from '../services/event-mapper'
import { StreamingErrorCard } from '../views/chat/StreamingErrorCard'
import { RuntimeSignalCard } from '../views/chat/RuntimeSignalCard'
import { CancellationNotice } from '../views/chat/CancellationNotice'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../avatar'
import { AvatarImage } from './AvatarImage'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { MarkdownText } from '../views/ChatView'
import { getLatestAgentStatus, isRunningAgentStatus } from '../views/chat-session-status'
import './ChatPanel.less'

export interface ChatPanelProps {
  /** 已创建的 session id；null 表示尚未就绪（显示 spinner） */
  sessionId: string | null
  /** 会话持久化摘要状态；重放历史时用于抑制「瞬态状态 + 空会话」被误判为执行中
   *  （见 chat-session-status.getLatestAgentStatus）。画布场景暂无现成数据源，
   *  可不传——退化为旧行为。 */
  persistedSessionStatus?: 'idle' | 'running' | 'error' | null
  /** 初始化中（覆盖在面板上） */
  loading?: boolean
  /** 致命错误（无法发送）；置空则正常显示输入区 */
  error?: string | null
  /** 顶部上下文徽章（如「已接入画布：xxx」） */
  contextBadge?: React.ReactNode
  /** 空消息列表时的占位 */
  emptyState?: React.ReactNode
  /** 输入框 placeholder */
  placeholder?: string
  /** 用户消息发送后回调（用于业务统计） */
  onAfterSend?: (text: string) => void
  /** 可选：限制工具卡片的标签前缀（如只显示 mcp__spark_canvas__） */
  toolNamePrefixFilter?: string
  /** 可选：隐藏整块工具调用日志 */
  hideToolCalls?: boolean
  /** 可选：隐藏工具调用中的参数/结果块，仅保留标题与错误信息 */
  hideToolInputOutput?: boolean
  /**
   * 可选：接管发送逻辑。传入后 ChatPanel 不再自行调 session:submit-turn，
   * 而是把待发送文本交给父组件（父组件负责建会/发消息）；发送失败请抛异常，
   * ChatPanel 会捕获并显示 sendError。未传则走默认的 session:submit-turn。
   */
  onSend?: (text: string, attachments: SessionAttachment[]) => Promise<void>
  /** 可选：输入草稿初始值（父组件持久化未发送的输入，关闭重开可恢复） */
  initialInput?: string
  /** 可选：输入文本变化通知（父组件据此持久化草稿） */
  onDraftChange?: (text: string) => void
  /** 可选：输入区上方的配置条（agent/provider/model/权限选择器等） */
  composer?: React.ReactNode
  /** 可选：输入框下方的参数行（会话/Agent/模型/技能选择器 + 附件按钮） */
  composerBelow?: React.ReactNode
  /** 可选：输入框上方展示的「已引用节点」chip 列表（如画布右键"添加到 Agent 对话"） */
  nodeReferences?: ChatPanelNodeReference[]
  /** 可选：移除某个引用节点 */
  onRemoveNodeReference?: (id: string) => void
  /** 可选：清空全部引用节点 */
  onClearNodeReferences?: () => void
  /** 可选：当前可用 agent 列表，用于解析 assistant 头像 */
  agents?: ManagedAgent[]
  /** 可选：assistant 回退身份（用于首条 loading / 无 agent snapshot 的气泡） */
  fallbackAssistant?: { agentId: string; agentName: string }
}

type AssistantStatus = 'idle' | 'sending' | 'streaming'
type ChatPanelDisplayAttachment = SessionAttachment & { name?: string }
type ChatPanelAttachment = SessionAttachment & { id: string; name: string }
/** 输入框上方引用的画布节点 chip */
export type ChatPanelNodeReference = {
  id: string
  type: string
  title?: string
}
type UserQuestionDraft = {
  skipped?: boolean
  selectedLabel?: string
  selectedValue?: string
  selectedLabels?: string[]
  selectedValues?: string[]
  otherText?: string
  text?: string
}

const CHAT_PANEL_HISTORY_TURN_PAGE = 12
const CHAT_PANEL_HISTORY_EVENT_PAGE = 2_000
const CHAT_PANEL_ATTACHMENT_COLLAPSE_LIMIT = 3

export function ChatPanel({
  sessionId,
  loading,
  error,
  contextBadge,
  emptyState,
  placeholder,
  onAfterSend,
  toolNamePrefixFilter,
  hideToolCalls,
  hideToolInputOutput,
  onSend,
  initialInput,
  onDraftChange,
  composer,
  composerBelow,
  nodeReferences,
  onRemoveNodeReference,
  onClearNodeReferences,
  agents = [],
  fallbackAssistant,
  persistedSessionStatus,
}: ChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState(initialInput ?? '')
  const applyInput = useCallback(
    (next: string) => {
      setInput(next)
      onDraftChange?.(next)
    },
    [onDraftChange],
  )
  // 父组件草稿变化时同步回输入框；用户主动输入时 prev===initialInput，不会被覆盖
  useEffect(() => {
    if (initialInput == null) return
    setInput((prev) => (prev === initialInput ? prev : initialInput))
  }, [initialInput])
  const [attachments, setAttachments] = useState<ChatPanelAttachment[]>([])
  const [status, setStatus] = useState<AssistantStatus>('idle')
  const [cancelling, setCancelling] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [pendingUserText, setPendingUserText] = useState<string | null>(null)
  const [pendingUserAttachments, setPendingUserAttachments] = useState<
    ChatPanelDisplayAttachment[]
  >([])
  const [showAssistantPending, setShowAssistantPending] = useState(false)

  const builderRef = useRef<MessageBuilder>(new MessageBuilder())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // textarea 自适应高度：输入时自动撑高，上限 160px 后滚动
  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  // 输入值变化、初始值同步时都触发自适应
  useEffect(() => {
    autoResizeTextarea()
  }, [input, autoResizeTextarea])
  const isAtBottomRef = useRef(true)
  const preservePendingOnSessionBindRef = useRef(false)
  const preservePendingHistoryLoadRef = useRef(false)
  const liveEventsRef = useRef<AgentEvent[]>([])
  const historyLoadedRef = useRef(false)
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: statFileKind } = useIpcInvoke('file:stat-kind')
  const { invoke: getHistory } = useIpcInvoke('session:get-history')
  const { invoke: cancelTurn } = useIpcInvoke('session:cancel')
  const { toast } = useToast()

  // 切换 session 时重置 builder
  useEffect(() => {
    builderRef.current = new MessageBuilder()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([])
    setAttachments([])
    liveEventsRef.current = []
    historyLoadedRef.current = false
    setCancelling(false)
    if (!preservePendingOnSessionBindRef.current) {
      setStatus('idle')
      setPendingUserText(null)
      setPendingUserAttachments([])
      setShowAssistantPending(false)
      preservePendingHistoryLoadRef.current = false
    } else {
      preservePendingHistoryLoadRef.current = true
    }
    setSendError(null)
    preservePendingOnSessionBindRef.current = false
  }, [sessionId])

  useEffect(() => {
    if (sessionId == null) return
    let cancelled = false
    void getHistory({
      sessionId: sessionId as never,
      turnLimit: CHAT_PANEL_HISTORY_TURN_PAGE,
      eventLimit: CHAT_PANEL_HISTORY_EVENT_PAGE,
    })
      .then((historyRes) => {
        if (cancelled) return
        const builder = new MessageBuilder()
        const mergedEvents = mergeAgentEvents(historyRes.events, liveEventsRef.current)
        for (const event of mergedEvents) {
          builder.processEvent(event)
        }
        builderRef.current = builder
        historyLoadedRef.current = true
        setMessages(builder.getAllMessages())
        const latestStatus = getLatestAgentStatus(mergedEvents, persistedSessionStatus ?? undefined)
        if (isRunningAgentStatus(latestStatus)) {
          setStatus('streaming')
          preservePendingHistoryLoadRef.current = false
        } else if (
          latestStatus === 'completed' ||
          latestStatus === 'cancelled' ||
          latestStatus === 'error'
        ) {
          setStatus('idle')
          preservePendingHistoryLoadRef.current = false
        } else if (!preservePendingHistoryLoadRef.current) {
          setStatus('idle')
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('加载会话历史失败', err)
      })
    return () => {
      cancelled = true
    }
  }, [getHistory, persistedSessionStatus, sessionId])

  // 订阅 agent 事件流
  useEffect(() => {
    if (sessionId == null) return
    const unsubscribe = window.spark.on('stream:session:agent-event', (event: AgentEvent) => {
      const evt = event as { sessionId?: string; type?: string }
      if (evt.sessionId !== sessionId) return
      liveEventsRef.current = mergeAgentEvents(liveEventsRef.current, [event])
      builderRef.current.processEvent(event)
      if (historyLoadedRef.current) {
        setMessages([...builderRef.current.getAllMessages()])
      }
      if (evt.type === 'user_message') {
        setPendingUserText(null)
        setPendingUserAttachments([])
        preservePendingHistoryLoadRef.current = false
      }
      if (
        evt.type === 'assistant_message' ||
        evt.type === 'agent_thinking' ||
        evt.type === 'tool_call' ||
        evt.type === 'tool_result' ||
        evt.type === 'tool_call_update'
      ) {
        setShowAssistantPending(false)
      }
      if (evt.type === 'agent_status') {
        const s = (event as { status?: string }).status
        if (s === 'completed' || s === 'cancelled' || s === 'error') {
          setStatus('idle')
          setCancelling(false)
          setShowAssistantPending(false)
          preservePendingHistoryLoadRef.current = false
        } else if (s === 'running') {
          setStatus('streaming')
          setShowAssistantPending(false)
          preservePendingHistoryLoadRef.current = false
        }
      }
    })
    return unsubscribe
  }, [sessionId])

  // 智能滚动：仅在用户已处于底部附近时自动跟随，上滑查看历史时不强制拉回
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, pendingUserAttachments, pendingUserText, showAssistantPending])

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  const appendAttachments = useCallback(
    (nextAttachments: ChatPanelAttachment[]) => {
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
      if (truncated) toast.info('单轮最多添加 20 个文件或目录引用。')
      return added
    },
    [toast],
  )

  const buildContextAttachment = useCallback(
    async (filePath: string, idPrefix: string, index: number): Promise<ChatPanelAttachment> => {
      let type: ChatPanelAttachment['type'] = isImageAttachmentPath(filePath) ? 'image' : 'file'
      try {
        const { kind } = await statFileKind({ path: filePath })
        if (kind === 'directory') type = 'directory'
      } catch {
        // 探测失败时按文件/图片处理即可
      }
      return {
        id: `${Date.now()}-${idPrefix}-${index}-${filePath}`,
        type,
        path: filePath,
        name: getFileNameFromPath(filePath),
      }
    },
    [statFileKind],
  )

  const handleAddContextFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        title: '添加相关文件',
        multiple: true,
      })
      const filePaths = selected.filePaths ?? (selected.filePath != null ? [selected.filePath] : [])
      if (selected.canceled || filePaths.length === 0) return
      const nextAttachments = await Promise.all(
        filePaths.map((filePath, index) => buildContextAttachment(filePath, 'ctx-file', index)),
      )
      appendAttachments(nextAttachments)
    } catch (err) {
      console.error('添加文件失败', err)
      toast.error(err instanceof Error ? err.message : '添加文件失败')
    }
  }, [appendAttachments, buildContextAttachment, openFileDialog, toast])

  const handleAddContextDirectory = useCallback(async () => {
    try {
      const selected = await openDirectoryDialog({
        title: '添加相关目录',
      })
      if (selected.canceled || selected.filePath == null) return
      const attachment = await buildContextAttachment(selected.filePath, 'ctx-dir', 0)
      appendAttachments([attachment])
    } catch (err) {
      console.error('添加目录失败', err)
      toast.error(err instanceof Error ? err.message : '添加目录失败')
    }
  }, [appendAttachments, buildContextAttachment, openDirectoryDialog, toast])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    const turnAttachments = toSessionAttachments(attachments)
    // onSend 模式下允许 sessionId 为空（父组件负责建会）；默认模式必须有 sessionId
    if ((text.length === 0 && turnAttachments.length === 0) || status !== 'idle') return
    if (onSend == null && sessionId == null) return
    const rawText = text || '请查看附件。'
    applyInput('')
    setAttachments([])
    setStatus('sending')
    setSendError(null)
    setPendingUserText(rawText)
    setPendingUserAttachments(turnAttachments)
    setShowAssistantPending(true)
    preservePendingOnSessionBindRef.current = onSend != null && sessionId == null
    try {
      if (onSend != null) {
        // 父组件接管发送（如画布弹窗需要先建会、注入上下文等）
        await onSend(rawText, turnAttachments)
      } else {
        await window.spark.invoke('session:submit-turn', {
          sessionId: sessionId as never,
          message: rawText,
          ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        })
      }
      onAfterSend?.(rawText)
    } catch (err) {
      applyInput(rawText === '请查看附件。' && text.length === 0 ? '' : rawText)
      setAttachments(
        pendingAttachmentsToComposer(turnAttachments).concat(
          attachments.filter(
            (attachment) =>
              !turnAttachments.some(
                (pendingAttachment) => pendingAttachment.path === attachment.path,
              ),
          ),
        ),
      )
      setStatus('idle')
      setCancelling(false)
      setSendError(err instanceof Error ? err.message : '发送失败')
      setPendingUserText(null)
      setPendingUserAttachments([])
      setShowAssistantPending(false)
    }
  }, [applyInput, attachments, input, onAfterSend, onSend, sessionId, status])

  const handleCancel = useCallback(async () => {
    if (sessionId == null || status === 'idle' || cancelling) return
    setCancelling(true)
    setSendError(null)
    try {
      await cancelTurn({ sessionId: sessionId as never })
    } catch (err) {
      setCancelling(false)
      setSendError(err instanceof Error ? err.message : '终止失败')
    }
  }, [cancelTurn, cancelling, sessionId, status])

  // onSend 模式下允许 sessionId 为空（父组件建会）；默认模式必须已有 sessionId
  const disabled = (onSend == null && sessionId == null) || status !== 'idle' || !!error
  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !disabled
  const isWorking = status === 'sending' || status === 'streaming'
  const canCancel = sessionId != null && isWorking

  const handleQuestionAnswered = useCallback(
    (questions: UserQuestionPrompt[], summaries: UserQuestionAnswerSummary[]) => {
      const updated = builderRef.current.setQuestionAnswerSummary(questions, summaries)
      if (updated) {
        setMessages([...builderRef.current.getAllMessages()])
      }
    },
    [],
  )

  const inputPlaceholder = useMemo(() => {
    if (error) return error
    if (loading) return '正在初始化...'
    if (cancelling) return '正在终止...'
    if (status === 'sending') return '发送中...'
    if (status === 'streaming') return 'agent 正在回复...'
    return placeholder ?? '输入消息（Enter 发送，Shift+Enter 换行）'
  }, [cancelling, error, loading, status, placeholder])

  return (
    <div className="chat-panel">
      {loading && (
        <div className="chat-panel-loading">
          <Spin tip="正在准备会话..." />
        </div>
      )}

      {error && !loading && (
        <div className="chat-panel-error">
          <Icons.X size={14} />
          <span>{error}</span>
        </div>
      )}

      {!loading && contextBadge && <div className="chat-panel-context">{contextBadge}</div>}
      <div className="chat-panel-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
        {messages.length === 0 &&
          pendingUserText == null &&
          !showAssistantPending &&
          emptyState && <div className="chat-panel-empty">{emptyState}</div>}
        {messages.map((msg) => (
          <MessageView
            key={msg.id}
            message={msg}
            sessionId={sessionId}
            agents={agents}
            onQuestionAnswered={handleQuestionAnswered}
            {...(fallbackAssistant != null ? { fallbackAssistant } : {})}
            {...(toolNamePrefixFilter !== undefined ? { toolNamePrefixFilter } : {})}
            {...(hideToolCalls ? { hideToolCalls } : {})}
            {...(hideToolInputOutput ? { hideToolInputOutput } : {})}
          />
        ))}
        {pendingUserText != null && (
          <PendingUserMessageView text={pendingUserText} attachments={pendingUserAttachments} />
        )}
        {showAssistantPending && (
          <PendingAssistantMessageView
            agents={agents}
            {...(fallbackAssistant != null ? { fallbackAssistant } : {})}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-panel-input-area">
        {composer && <div className="chat-panel-composer-bar">{composer}</div>}
        {sendError && (
          <div className="chat-panel-send-error">
            <Icons.X size={12} />
            <span>{sendError}</span>
          </div>
        )}
        {/* 圆角浮岛输入框：chip 区 + textarea + 内嵌发送按钮 */}
        <div className="chat-panel-input-box">
          {nodeReferences && nodeReferences.length > 0 && (
            <ComposerNodeRefsStrip
              refs={nodeReferences}
              {...(onRemoveNodeReference ? { onRemove: onRemoveNodeReference } : {})}
              {...(onClearNodeReferences ? { onClear: onClearNodeReferences } : {})}
            />
          )}
          {attachments.length > 0 && (
            <ComposerAttachmentsStrip attachments={attachments} onRemove={handleRemoveAttachment} />
          )}
          <div className="chat-panel-input-row">
            <textarea
              ref={textareaRef}
              className="chat-panel-input"
              value={input}
              placeholder={inputPlaceholder}
              disabled={disabled}
              onChange={(e) => applyInput(e.target.value)}
              onKeyDown={(e) => {
                const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean }
                if (nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              rows={1}
            />
            <button
              type="button"
              className={`chat-panel-send-btn${isWorking ? ' is-stop' : ''}`}
              disabled={isWorking ? !canCancel || cancelling : !canSubmit}
              aria-label={isWorking ? '终止' : '发送'}
              title={isWorking ? '终止' : '发送 (Enter)'}
              onClick={() => {
                if (isWorking) {
                  void handleCancel()
                  return
                }
                void handleSend()
              }}
            >
              {isWorking ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <Icons.Send size={15} />
              )}
            </button>
          </div>
        </div>
        {/* 底部附件按钮行（始终渲染，composerBelow 可选追加更多参数项） */}
        <div className="chat-panel-composer-below">
          <button
            type="button"
            className="chat-panel-attach-icon"
            disabled={disabled}
            title="添加文件"
            onClick={() => void handleAddContextFiles()}
          >
            <Icons.FilePlus size={13} />
          </button>
          <button
            type="button"
            className="chat-panel-attach-icon"
            disabled={disabled}
            title="添加目录"
            onClick={() => void handleAddContextDirectory()}
          >
            <Icons.FolderPlus size={13} />
          </button>
          {composerBelow}
        </div>
      </div>
    </div>
  )
}

function MessageView({
  message,
  sessionId,
  agents,
  fallbackAssistant,
  toolNamePrefixFilter,
  hideToolCalls,
  hideToolInputOutput,
  onQuestionAnswered,
}: {
  message: UIMessage
  sessionId: string | null
  agents: ManagedAgent[]
  fallbackAssistant?: { agentId: string; agentName: string }
  toolNamePrefixFilter?: string
  hideToolCalls?: boolean
  hideToolInputOutput?: boolean
  onQuestionAnswered: (
    questions: UserQuestionPrompt[],
    summaries: UserQuestionAnswerSummary[],
  ) => void
}): React.ReactElement {
  const assistantIdentity = resolveAssistantIdentity(message, agents, fallbackAssistant)
  const attachments = message.role === 'user' ? (message.attachments ?? []) : []
  return (
    <div className={`chat-panel-message chat-panel-message-${message.role}`}>
      <div className="chat-panel-message-avatar">
        {message.role === 'user' ? (
          <Icons.MousePointer size={14} />
        ) : (
          <AssistantAvatar
            agentId={assistantIdentity.id}
            agentName={assistantIdentity.name}
            avatarSrc={assistantIdentity.avatarSrc}
          />
        )}
      </div>
      <div className="chat-panel-message-body">
        {attachments.length > 0 && <MessageAttachmentsView attachments={attachments} />}
        {message.blocks.map((block, idx) => (
          <BlockView
            key={idx}
            block={block}
            role={message.role}
            sessionId={sessionId}
            onQuestionAnswered={onQuestionAnswered}
            {...(toolNamePrefixFilter !== undefined ? { toolNamePrefixFilter } : {})}
            {...(hideToolCalls ? { hideToolCalls } : {})}
            {...(hideToolInputOutput ? { hideToolInputOutput } : {})}
          />
        ))}
      </div>
    </div>
  )
}

function BlockView({
  block,
  role,
  sessionId,
  toolNamePrefixFilter,
  hideToolCalls,
  hideToolInputOutput,
  onQuestionAnswered,
}: {
  block: UIBlock
  role: 'user' | 'assistant'
  sessionId: string | null
  toolNamePrefixFilter?: string
  hideToolCalls?: boolean
  hideToolInputOutput?: boolean
  onQuestionAnswered: (
    questions: UserQuestionPrompt[],
    summaries: UserQuestionAnswerSummary[],
  ) => void
}): React.ReactElement | null {
  switch (block.kind) {
    case 'text':
      return (
        <div className="chat-panel-text md-surface">
          <MarkdownText
            content={role === 'user' ? sanitizeUserDisplayText(block.content) : block.content}
          />
          {block.isStreaming && <span className="chat-panel-cursor">▋</span>}
        </div>
      )
    case 'thinking':
      return (
        <details className="chat-panel-thinking">
          <summary>思考中…</summary>
          <pre>{block.content}</pre>
        </details>
      )
    case 'tool_call': {
      if (hideToolCalls) return null
      const displayName = block.toolName.replace(/^mcp__[^_]+__/, '')
      const isCanvas = block.toolName.startsWith('mcp__spark_canvas__')
      // 设了前缀过滤时，匹配的工具(画布操作)优先展示；
      // 若 hideToolInputOutput 开启，则仅保留工具标题与错误信息。
      // 其他工具(内部读取/思考等)折叠为"详情"，默认收起、可展开
      const matchesFilter = !toolNamePrefixFilter || block.toolName.startsWith(toolNamePrefixFilter)
      const statusClass = `chat-panel-tool-${block.status}`
      const inputDetails =
        !hideToolInputOutput && Object.keys(block.toolInput).length > 0 ? (
          <details className="chat-panel-tool-input">
            <summary>参数</summary>
            <pre>{JSON.stringify(block.toolInput, null, 2)}</pre>
          </details>
        ) : null
      const errorBlock = block.error ? (
        <div className="chat-panel-tool-error">{block.error}</div>
      ) : null
      const outputDetails =
        !hideToolInputOutput && block.output && block.status === 'success' ? (
          <details className="chat-panel-tool-output">
            <summary>结果</summary>
            <pre>
              {block.output.length > 4000
                ? block.output.slice(0, 4000) + '\n…(已截断)'
                : block.output}
            </pre>
          </details>
        ) : null
      const hasDetail = inputDetails != null || errorBlock != null || outputDetails != null
      return (
        <div
          className={`chat-panel-tool ${statusClass} ${isCanvas ? 'chat-panel-tool-canvas' : ''}`}
        >
          <div className="chat-panel-tool-head">
            <span className="chat-panel-tool-icon">
              {block.status === 'running' || block.status === 'pending' ? (
                <Spin size="middle" />
              ) : block.status === 'error' ? (
                <Icons.X size={12} />
              ) : (
                <Icons.Sparkles size={12} />
              )}
            </span>
            <span className="chat-panel-tool-name">
              {isCanvas ? '画布操作' : '工具调用'} · {displayName}
            </span>
            {block.durationMs != null && (
              <span className="chat-panel-tool-duration">{block.durationMs}ms</span>
            )}
          </div>
          {matchesFilter ? (
            <>
              {inputDetails}
              {errorBlock}
              {outputDetails}
            </>
          ) : hasDetail ? (
            <details className="chat-panel-tool-secondary">
              <summary>详情</summary>
              {inputDetails}
              {errorBlock}
              {outputDetails}
            </details>
          ) : null}
        </div>
      )
    }
    case 'user_question':
      return (
        <InlineUserQuestionCard
          key={block.toolCallId}
          block={block}
          sessionId={sessionId}
          onAnswered={onQuestionAnswered}
        />
      )
    case 'error':
      return (
        <StreamingErrorCard
          code={block.code}
          title={block.title ?? 'Agent 执行失败'}
          message={block.message}
          level="error"
          retryable={block.retryable}
          {...(block.actionHint != null ? { actionHint: block.actionHint } : {})}
          {...(block.details != null ? { details: block.details } : {})}
          {...(block.origin != null ? { origin: block.origin } : {})}
          {...(block.occurrenceCount != null ? { occurrenceCount: block.occurrenceCount } : {})}
        />
      )
    case 'runtime_signal':
      return <RuntimeSignalCard block={block} />
    case 'cancelled':
      return <CancellationNotice message={block.message} />
    default:
      // 其他 block（file_change/plan_proposed/checkpoint 等）在 modal 场景不展开
      return null
  }
}

function InlineUserQuestionCard({
  block,
  sessionId,
  onAnswered,
}: {
  block: Extract<UIBlock, { kind: 'user_question' }>
  sessionId: string | null
  onAnswered: (questions: UserQuestionPrompt[], summaries: UserQuestionAnswerSummary[]) => void
}): React.ReactElement | null {
  const { invoke: answerQuestion } = useIpcInvoke('session:answer-question')
  const [drafts, setDrafts] = useState<Record<number, UserQuestionDraft>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (block.questions.length === 0) return null

  const total = block.questions.length
  const currentQuestion = block.questions[Math.min(currentIndex, total - 1)]
  const currentDraft = drafts[currentIndex] ?? {}
  const answeredCount = block.questions.filter((question, index) =>
    isQuestionAnswered(question, drafts[index]),
  ).length
  const canGoBack = currentIndex > 0
  const canGoNext = currentIndex < total - 1
  const canSubmit =
    !block.answered &&
    block.error == null &&
    block.questions.every((question, index) => isQuestionReadyForSubmit(question, drafts[index]))
  const answerByQuestion = new Map<string, UserQuestionAnswerSummary>()
  for (const summary of block.answerSummary ?? []) {
    answerByQuestion.set(summary.question, summary)
  }

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
    if (currentQuestion == null || block.answered || block.error != null || submitting) return
    if (isMultiChoiceQuestion(currentQuestion)) {
      const prevLabels = currentDraft.selectedLabels ?? []
      const prevValues = currentDraft.selectedValues ?? []
      const alreadySelected = prevLabels.includes(option.label)
      updateDraft({
        skipped: false,
        selectedLabels: alreadySelected
          ? prevLabels.filter((label) => label !== option.label)
          : [...prevLabels, option.label],
        selectedValues: alreadySelected
          ? prevValues.filter((value) => value !== (option.value ?? option.label))
          : [...prevValues, option.value ?? option.label],
        text: '',
      })
      return
    }

    updateDraft({
      skipped: false,
      selectedLabel: option.label,
      selectedValue: option.value ?? option.label,
      ...(option.allowsFreeText ? {} : { otherText: '' }),
      text: '',
    })
    if (!option.allowsFreeText && canGoNext) {
      setCurrentIndex((prev) => Math.min(prev + 1, total - 1))
    }
  }

  const handleOtherTextChange = (value: string) => {
    if (currentQuestion == null) return
    if (isMultiChoiceQuestion(currentQuestion)) {
      updateDraft({ skipped: false, otherText: value, text: '' })
      return
    }
    const otherLabel = getOtherOptionLabel(currentQuestion)
    updateDraft({
      skipped: false,
      selectedLabel: otherLabel,
      selectedValue: otherLabel,
      otherText: value,
      text: '',
    })
  }

  const submitAnswers = async (answers: Record<string, unknown>) => {
    if (submitting || block.answered || block.error != null) return
    if (sessionId == null) {
      setError('会话尚未就绪，暂时无法提交答案')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await answerQuestion({ sessionId, questionId: block.toolCallId, answers })
      const summaries = buildQuestionAnswerSummaries(block.questions, answers)
      if (summaries.length > 0) {
        onAnswered(block.questions, summaries)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交答案失败')
      setSubmitting(false)
    }
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    void submitAnswers({
      answers: block.questions.map((question, index) =>
        buildQuestionAnswer(question, drafts[index], index),
      ),
      questionCount: total,
      answeredCount,
    })
  }

  const handleCancel = () => {
    void submitAnswers(buildQuestionCancelAnswer(block.questions))
  }

  return (
    <div className="chat-panel-question-card">
      <div className="chat-panel-question-head">
        <span className="chat-panel-question-icon">
          <Icons.HelpCircle size={14} />
        </span>
        <div>
          <div className="chat-panel-question-title">Agent 正在等您回复</div>
          <div className="chat-panel-question-subtitle">
            {block.error != null
              ? '提问工具未能完成'
              : block.answered
                ? '已提交答案'
                : '可在画布对话框内直接作答'}
          </div>
        </div>
        <span className={`chat-panel-question-badge${block.answered ? ' is-done' : ''}`}>
          {block.error != null
            ? '失败'
            : block.answered
              ? '已回答'
              : `${Math.min(currentIndex + 1, total)} / ${total}`}
        </span>
      </div>

      {block.error != null ? (
        <div className="chat-panel-question-error">
          <Icons.X size={12} />
          <span>{block.error}</span>
        </div>
      ) : block.answered ? (
        <div className="chat-panel-question-summary-list">
          {block.questions.map((question, index) => {
            const summary =
              answerByQuestion.get(question.question) ??
              (block.answerSummary != null ? block.answerSummary[index] : undefined)
            return (
              <div className="chat-panel-question-summary" key={`${question.question}-${index}`}>
                {question.header && (
                  <div className="chat-panel-question-summary-header">{question.header}</div>
                )}
                <div className="chat-panel-question-summary-q">
                  {index + 1}. {question.question}
                </div>
                <div className="chat-panel-question-summary-a">
                  {summary?.skipped
                    ? '已跳过'
                    : summary?.answer && summary.answer.length > 0
                      ? summary.answer
                      : '未填写'}
                </div>
              </div>
            )
          })}
        </div>
      ) : currentQuestion != null ? (
        <>
          <div className="chat-panel-question-body">
            {currentQuestion.header && (
              <div className="chat-panel-question-section">{currentQuestion.header}</div>
            )}
            <div className="chat-panel-question-text">{currentQuestion.question}</div>
            <div className="chat-panel-question-meta">
              <span>{getQuestionTypeLabel(currentQuestion)}</span>
              <span>
                已答 {answeredCount} / {total}
              </span>
            </div>

            {isChoiceQuestion(currentQuestion) ? (
              <>
                <div className="chat-panel-question-options">
                  {getChoiceOptions(currentQuestion).map((option, optionIndex) => {
                    const selected = isMultiChoiceQuestion(currentQuestion)
                      ? (currentDraft.selectedLabels ?? []).includes(option.label)
                      : currentDraft.selectedLabel === option.label
                    return (
                      <button
                        key={`${option.label}-${optionIndex}`}
                        type="button"
                        className={`chat-panel-question-option${selected ? ' is-selected' : ''}`}
                        disabled={submitting}
                        onClick={() => handleSelectOption(option)}
                        title={option.description ?? option.label}
                      >
                        <span>{option.label}</span>
                        {option.description && <small>{option.description}</small>}
                        {selected && <Icons.Check size={12} />}
                      </button>
                    )
                  })}
                </div>
                <label className="chat-panel-question-other">
                  <span>{getOtherOptionLabel(currentQuestion)}</span>
                  <input
                    value={currentDraft.otherText ?? ''}
                    placeholder={getOtherPlaceholder(currentQuestion)}
                    disabled={submitting}
                    onChange={(event) => handleOtherTextChange(event.target.value)}
                  />
                </label>
              </>
            ) : currentQuestion.multiline ? (
              <textarea
                className="chat-panel-question-answer"
                value={currentDraft.text ?? ''}
                placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                disabled={submitting}
                rows={4}
                onChange={(event) => updateDraft({ skipped: false, text: event.target.value })}
              />
            ) : (
              <input
                className="chat-panel-question-answer"
                value={currentDraft.text ?? ''}
                placeholder={currentQuestion.placeholder ?? '请输入您的回答'}
                disabled={submitting}
                onChange={(event) => updateDraft({ skipped: false, text: event.target.value })}
              />
            )}

            {currentDraft.skipped && (
              <div className="chat-panel-question-skip-note">
                这一题已标记为跳过，您仍可返回修改。
              </div>
            )}
          </div>

          {error && (
            <div className="chat-panel-question-error">
              <Icons.X size={12} />
              <span>{error}</span>
            </div>
          )}

          <div className="chat-panel-question-footer">
            <div className="chat-panel-question-dots">
              {block.questions.map((question, index) => (
                <button
                  key={question.id ?? `${question.question}-${index}`}
                  type="button"
                  className={`chat-panel-question-dot${index === currentIndex ? ' is-active' : ''}${isQuestionAnswered(question, drafts[index]) ? ' is-done' : ''}`}
                  disabled={submitting}
                  onClick={() => setCurrentIndex(index)}
                  title={`第 ${index + 1} 题`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="chat-panel-question-actions">
              <button
                type="button"
                className="chat-panel-question-btn"
                disabled={submitting || currentQuestion.allowSkip === false}
                onClick={() => {
                  updateDraft({
                    skipped: true,
                    selectedLabel: '',
                    selectedValue: '',
                    selectedLabels: [],
                    selectedValues: [],
                    otherText: '',
                    text: '',
                  })
                  if (canGoNext) setCurrentIndex((prev) => Math.min(prev + 1, total - 1))
                }}
              >
                跳过
              </button>
              <button
                type="button"
                className="chat-panel-question-btn"
                disabled={submitting}
                onClick={handleCancel}
              >
                取消
              </button>
              <button
                type="button"
                className="chat-panel-question-btn"
                disabled={submitting || !canGoBack}
                onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
              >
                上一题
              </button>
              {canGoNext ? (
                <button
                  type="button"
                  className="chat-panel-question-btn is-primary"
                  disabled={submitting}
                  onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, total - 1))}
                >
                  下一题
                </button>
              ) : (
                <button
                  type="button"
                  className="chat-panel-question-btn is-primary"
                  disabled={submitting || !canSubmit}
                  onClick={handleSubmit}
                >
                  {submitting ? '提交中...' : '提交答案'}
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function PendingUserMessageView({
  text,
  attachments,
}: {
  text: string
  attachments: ChatPanelDisplayAttachment[]
}) {
  return (
    <div className="chat-panel-message chat-panel-message-user chat-panel-message-pending">
      <div className="chat-panel-message-avatar">
        <Icons.MousePointer size={14} />
      </div>
      <div className="chat-panel-message-body">
        {attachments.length > 0 && <MessageAttachmentsView attachments={attachments} />}
        <div className="chat-panel-text md-surface">
          <MarkdownText content={text} />
        </div>
      </div>
    </div>
  )
}

function PendingAssistantMessageView({
  agents,
  fallbackAssistant,
}: {
  agents: ManagedAgent[]
  fallbackAssistant?: { agentId: string; agentName: string }
}) {
  const identity = resolveAssistantIdentity(null, agents, fallbackAssistant)
  return (
    <div className="chat-panel-message chat-panel-message-assistant chat-panel-message-pending">
      <div className="chat-panel-message-avatar">
        <AssistantAvatar
          agentId={identity.id}
          agentName={identity.name}
          avatarSrc={identity.avatarSrc}
          pending
        />
      </div>
      <div className="chat-panel-message-body">
        <div className="chat-panel-assistant-loading">
          <Spin size="small" />
          <span>{identity.name} 正在执行...</span>
        </div>
      </div>
    </div>
  )
}

function AssistantAvatar({
  agentId,
  agentName,
  avatarSrc,
  pending = false,
}: {
  agentId: string
  agentName: string
  avatarSrc: string
  pending?: boolean
}) {
  return (
    <span className={`chat-panel-avatar-image-wrap${pending ? ' is-pending' : ''}`}>
      <AvatarImage src={avatarSrc} seed={agentId} name={agentName} alt={`${agentName} 头像`} />
      {pending && <span className="chat-panel-avatar-pulse" aria-hidden="true" />}
    </span>
  )
}

function resolveAssistantIdentity(
  message: UIMessage | null,
  agents: ManagedAgent[],
  fallbackAssistant?: { agentId: string; agentName: string },
): { id: string; name: string; avatarSrc: string } {
  const fallbackId = fallbackAssistant?.agentId ?? 'platform-manager-agent'
  const fallbackName = fallbackAssistant?.agentName ?? 'Agent'
  const fallbackAvatar = getAgentAvatarConfig(undefined, fallbackId, fallbackName)
  const fallbackAvatarSrc = resolveAvatarSrc(fallbackAvatar)
  if (message == null) {
    return { id: fallbackId, name: fallbackName, avatarSrc: fallbackAvatarSrc }
  }
  const id = message.agentId ?? fallbackId
  const agent = agents.find((item) => item.id === id)
  const name = message.agentName ?? agent?.name ?? fallbackName
  if (message.agentId == null) {
    return { id: fallbackId, name, avatarSrc: fallbackAvatarSrc }
  }
  const avatar = getAgentAvatarConfig(agent?.metadata, id, name)
  return { id, name, avatarSrc: resolveAvatarSrc(avatar) }
}

function sanitizeUserDisplayText(content: string): string {
  if (!content.startsWith('[画布绑定]\n')) return content
  const marker = '\n\n---\n\n'
  const index = content.indexOf(marker)
  if (index < 0) return content
  return content.slice(index + marker.length).trim()
}

function ComposerAttachmentsStrip({
  attachments,
  onRemove,
}: {
  attachments: ChatPanelAttachment[]
  onRemove: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hiddenCount = Math.max(0, attachments.length - CHAT_PANEL_ATTACHMENT_COLLAPSE_LIMIT)
  const visibleAttachments =
    expanded || hiddenCount === 0
      ? attachments
      : attachments.slice(0, CHAT_PANEL_ATTACHMENT_COLLAPSE_LIMIT)
  return (
    <div className="chat-panel-composer-attachments">
      {visibleAttachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`chat-panel-attachment-chip${attachment.type === 'directory' ? ' is-directory' : ''}`}
          title={attachment.path}
        >
          {attachment.type === 'directory' ? (
            <Icons.Folder size={13} />
          ) : attachment.type === 'image' ? (
            <Icons.Image size={13} />
          ) : (
            <Icons.File size={13} />
          )}
          <span>{attachment.name}</span>
          <button
            type="button"
            className="chat-panel-attachment-remove"
            aria-label={`移除 ${attachment.name}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onRemove(attachment.id)
            }}
          >
            <Icons.X size={12} />
          </button>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="chat-panel-attachment-chip chat-panel-attachment-more"
          title={
            expanded
              ? '折叠附件'
              : attachments
                  .slice(CHAT_PANEL_ATTACHMENT_COLLAPSE_LIMIT)
                  .map((item) => item.path)
                  .join('\n')
          }
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起' : `还有 ${hiddenCount} 个`}
        </button>
      )}
    </div>
  )
}

function nodeRefIcon(type: string) {
  switch (type) {
    case 'image':
      return <Icons.Image size={13} />
    case 'prompt':
      return <Icons.Edit size={13} />
    case 'task':
      return <Icons.Workflow size={13} />
    case 'group':
      return <Icons.Layers size={13} />
    case 'text':
    default:
      return <Icons.FileText size={13} />
  }
}

function nodeRefLabel(ref: ChatPanelNodeReference) {
  const label = ref.title?.trim()
  if (label) return label
  const fallback: Record<string, string> = {
    text: '文本节点',
    image: '图片节点',
    prompt: 'Prompt 节点',
    task: '任务节点',
    group: '组节点',
  }
  return fallback[ref.type] ?? '节点'
}

function ComposerNodeRefsStrip({
  refs,
  onRemove,
  onClear,
}: {
  refs: ChatPanelNodeReference[]
  onRemove?: (id: string) => void
  onClear?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hiddenCount = Math.max(0, refs.length - CHAT_PANEL_ATTACHMENT_COLLAPSE_LIMIT)
  const visibleRefs = expanded || hiddenCount === 0 ? refs : refs.slice(0, CHAT_PANEL_ATTACHMENT_COLLAPSE_LIMIT)
  return (
    <div className="chat-panel-node-refs">
      <div className="chat-panel-node-refs-chips">
        {visibleRefs.map((ref) => (
          <div key={ref.id} className="chat-panel-node-ref-chip" title={nodeRefLabel(ref)}>
            {nodeRefIcon(ref.type)}
            <span>{nodeRefLabel(ref)}</span>
            {onRemove && (
              <button
                type="button"
                className="chat-panel-attachment-remove"
                aria-label={`移除 ${nodeRefLabel(ref)}`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRemove(ref.id)
                }}
              >
                <Icons.X size={12} />
              </button>
            )}
          </div>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="chat-panel-node-ref-chip chat-panel-attachment-more"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起' : `还有 ${hiddenCount} 个`}
          </button>
        )}
      </div>
      {onClear && refs.length > 1 && (
        <button
          type="button"
          className="chat-panel-node-refs-clear"
          onClick={() => {
            setExpanded(false)
            onClear()
          }}
        >
          清空
        </button>
      )}
    </div>
  )
}

function MessageAttachmentsView({ attachments }: { attachments: ChatPanelDisplayAttachment[] }) {
  return (
    <div className="chat-panel-message-attachments">
      {attachments.map((attachment) => {
        const name = attachment.name ?? getFileNameFromPath(attachment.path)
        return (
          <div
            key={`${attachment.type}:${attachment.path}`}
            className={`chat-panel-attachment-chip is-readonly${attachment.type === 'directory' ? ' is-directory' : ''}`}
            title={attachment.path}
          >
            {attachment.type === 'directory' ? (
              <Icons.Folder size={13} />
            ) : attachment.type === 'image' ? (
              <Icons.Image size={13} />
            ) : (
              <Icons.File size={13} />
            )}
            <span>{name}</span>
          </div>
        )
      })}
    </div>
  )
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

function isImageAttachmentPath(filePath: string): boolean {
  const extension = getFileNameFromPath(filePath).split('.').pop()?.toLowerCase()
  return extension != null && IMAGE_ATTACHMENT_EXTENSIONS.has(extension)
}

function toSessionAttachments(attachments: ChatPanelAttachment[]): SessionAttachment[] {
  return attachments.map((attachment) => ({
    type: attachment.type,
    path: attachment.path,
  }))
}

function pendingAttachmentsToComposer(attachments: SessionAttachment[]): ChatPanelAttachment[] {
  return attachments.map((attachment, index) => ({
    id: `restore-${index}-${attachment.path}`,
    type: attachment.type,
    path: attachment.path,
    name: getFileNameFromPath(attachment.path),
  }))
}

function isChoiceQuestion(question: UserQuestionPrompt): boolean {
  const type = question.type ?? 'single_choice'
  return type === 'single_choice' || type === 'multi_choice'
}

function isMultiChoiceQuestion(question: UserQuestionPrompt): boolean {
  const type = question.type ?? (question.multiSelect === true ? 'multi_choice' : 'single_choice')
  return type === 'multi_choice'
}

function getQuestionTypeLabel(question: UserQuestionPrompt): string {
  if (isMultiChoiceQuestion(question)) return '多选题'
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
    if (isMultiChoiceQuestion(question)) {
      return (draft.selectedLabels?.length ?? 0) > 0 || (draft.otherText?.trim().length ?? 0) > 0
    }
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
    ? isMultiChoiceQuestion(question)
      ? (() => {
          const labels = draft?.selectedLabels ?? []
          const parts = [...labels]
          if (otherText) parts.push(otherText)
          return parts.filter(Boolean).join(' | ')
        })()
      : (() => {
          const selected = draft?.selectedValue ?? draft?.selectedLabel ?? ''
          if (selected === getOtherOptionLabel(question)) return otherText
          if (otherText && selected) return `${selected} | ${otherText}`
          return otherText || selected
        })()
    : text

  const resolvedType =
    question.type ??
    (isMultiChoiceQuestion(question)
      ? 'multi_choice'
      : isChoiceQuestion(question)
        ? 'single_choice'
        : 'text')

  return {
    index,
    id: question.id ?? `question-${index + 1}`,
    header: question.header,
    question: question.question,
    type: resolvedType,
    skipped: isSkipped,
    answer: isSkipped ? '' : answerValue,
    ...(isMultiChoiceQuestion(question)
      ? {
          ...(draft?.selectedLabels && draft.selectedLabels.length > 0
            ? { optionLabel: draft.selectedLabels.join(' | ') }
            : {}),
          ...(draft?.selectedValues && draft.selectedValues.length > 0
            ? { optionValue: draft.selectedValues.join(' | ') }
            : {}),
        }
      : {
          ...(draft?.selectedLabel ? { optionLabel: draft.selectedLabel } : {}),
          ...(draft?.selectedValue ? { optionValue: draft.selectedValue } : {}),
        }),
    ...(otherText ? { otherText } : {}),
    ...(text ? { text } : {}),
  }
}

function buildQuestionAnswerSummaries(
  questions: UserQuestionPrompt[],
  answers: Record<string, unknown>,
): UserQuestionAnswerSummary[] {
  const rawList = Array.isArray(answers.answers) ? answers.answers : []
  return questions
    .map((question, index) => {
      const raw = rawList[index] as Record<string, unknown> | undefined
      if (raw == null || typeof raw !== 'object') return null
      const answer =
        typeof raw.answer === 'string' ? raw.answer : typeof raw.text === 'string' ? raw.text : ''
      if (!answer && raw.skipped !== true) return null
      return {
        question: question.question,
        answer,
        ...(raw.skipped === true ? { skipped: true } : {}),
      }
    })
    .filter((item): item is UserQuestionAnswerSummary => item != null)
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

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'ico',
  'tif',
  'tiff',
  'heic',
  'heif',
])

function mergeAgentEvents(historyEvents: AgentEvent[], liveEvents: AgentEvent[]): AgentEvent[] {
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
