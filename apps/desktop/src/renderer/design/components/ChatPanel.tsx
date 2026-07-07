/**
 * 通用 ChatPanel：消息流 + 工具调用卡片 + 输入区
 *
 * 复用 MessageBuilder（services/event-mapper）做事件→UIMessage 转换；
 * 渲染 text / thinking / tool_call / error 四类 block（其他类型对
 * 弹窗/模态场景不重要，跳过）。
 *
 * 给画布 Agent 弹窗 / Board 内嵌等场景使用；ChatView 仍是主聊天页，
 * 这里只承担"嵌入式会话面板"职责。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Spin } from 'antd'
import type { AgentEvent, ManagedAgent, SessionAttachment } from '@spark/protocol'
import { Icons } from '../Icons'
import { MessageBuilder, type UIMessage, type UIBlock } from '../services/event-mapper'
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
  /**
   * 可选：接管发送逻辑。传入后 ChatPanel 不再自行调 session:send-turn，
   * 而是把待发送文本交给父组件（父组件负责建会/发消息）；发送失败请抛异常，
   * ChatPanel 会捕获并显示 sendError。未传则走默认的 session:send-turn。
   */
  onSend?: (text: string, attachments: SessionAttachment[]) => Promise<void>
  /** 可选：输入区上方的配置条（agent/provider/model/权限选择器等） */
  composer?: React.ReactNode
  /** 可选：当前可用 agent 列表，用于解析 assistant 头像 */
  agents?: ManagedAgent[]
  /** 可选：assistant 回退身份（用于首条 loading / 无 agent snapshot 的气泡） */
  fallbackAssistant?: { agentId: string; agentName: string }
}

type AssistantStatus = 'idle' | 'sending' | 'streaming'
type ChatPanelDisplayAttachment = SessionAttachment & { name?: string }
type ChatPanelAttachment = SessionAttachment & { id: string; name: string }

const CHAT_PANEL_HISTORY_TURN_PAGE = 12
const CHAT_PANEL_HISTORY_EVENT_PAGE = 2_000

export function ChatPanel({
  sessionId,
  loading,
  error,
  contextBadge,
  emptyState,
  placeholder,
  onAfterSend,
  toolNamePrefixFilter,
  onSend,
  composer,
  agents = [],
  fallbackAssistant,
  persistedSessionStatus,
}: ChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
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
  const preservePendingOnSessionBindRef = useRef(false)
  const liveEventsRef = useRef<AgentEvent[]>([])
  const historyLoadedRef = useRef(false)
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
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
        } else if (
          latestStatus === 'completed' ||
          latestStatus === 'cancelled' ||
          latestStatus === 'error'
        ) {
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
  }, [getHistory, sessionId])

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
        } else if (s === 'running') {
          setStatus('streaming')
          setShowAssistantPending(false)
        }
      }
    })
    return unsubscribe
  }, [sessionId])

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingUserAttachments, pendingUserText, showAssistantPending])

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

  const handleAddContextFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        title: '添加相关文件或目录',
        multiple: true,
        allowDirectories: true,
      })
      const filePaths = selected.filePaths ?? (selected.filePath != null ? [selected.filePath] : [])
      if (selected.canceled || filePaths.length === 0) return
      const now = Date.now()
      const nextAttachments = await Promise.all(
        filePaths.map(async (filePath, index) => {
          let type: ChatPanelAttachment['type'] = isImageAttachmentPath(filePath) ? 'image' : 'file'
          try {
            const { kind } = await statFileKind({ path: filePath })
            if (kind === 'directory') type = 'directory'
          } catch {
            // 探测失败时按文件/图片处理即可
          }
          return {
            id: `${now}-ctx-${index}-${filePath}`,
            type,
            path: filePath,
            name: getFileNameFromPath(filePath),
          }
        }),
      )
      appendAttachments(nextAttachments)
    } catch (err) {
      console.error('添加文件或目录失败', err)
      toast.error(err instanceof Error ? err.message : '添加文件或目录失败')
    }
  }, [appendAttachments, openFileDialog, statFileKind, toast])

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
    setInput('')
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
        await window.spark.invoke('session:send-turn', {
          sessionId: sessionId as never,
          message: rawText,
          ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        })
      }
      onAfterSend?.(rawText)
    } catch (err) {
      setInput(rawText === '请查看附件。' && text.length === 0 ? '' : rawText)
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
  }, [attachments, input, onAfterSend, onSend, sessionId, status])

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
      <div className="chat-panel-messages">
        {messages.length === 0 &&
          pendingUserText == null &&
          !showAssistantPending &&
          emptyState && <div className="chat-panel-empty">{emptyState}</div>}
        {messages.map((msg) => (
          <MessageView
            key={msg.id}
            message={msg}
            agents={agents}
            {...(fallbackAssistant != null ? { fallbackAssistant } : {})}
            {...(toolNamePrefixFilter !== undefined ? { toolNamePrefixFilter } : {})}
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
        {attachments.length > 0 && (
          <ComposerAttachmentsStrip attachments={attachments} onRemove={handleRemoveAttachment} />
        )}
        <textarea
          className="chat-panel-input"
          value={input}
          placeholder={inputPlaceholder}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          rows={3}
        />
        <div className="chat-panel-input-actions">
          <Button
            icon={<Icons.FolderPlus size={14} />}
            disabled={disabled}
            onClick={() => void handleAddContextFiles()}
          >
            添加文件/目录
          </Button>
          <Button
            {...(isWorking ? { danger: true } : { type: 'primary' as const })}
            icon={isWorking ? <Icons.X size={14} /> : <Icons.Send size={14} />}
            disabled={isWorking ? !canCancel || cancelling : !canSubmit}
            loading={cancelling || status === 'sending'}
            onClick={() => {
              if (isWorking) {
                void handleCancel()
                return
              }
              void handleSend()
            }}
          >
            {isWorking ? '终止' : '发送'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageView({
  message,
  agents,
  fallbackAssistant,
  toolNamePrefixFilter,
}: {
  message: UIMessage
  agents: ManagedAgent[]
  fallbackAssistant?: { agentId: string; agentName: string }
  toolNamePrefixFilter?: string
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
            {...(toolNamePrefixFilter !== undefined ? { toolNamePrefixFilter } : {})}
          />
        ))}
      </div>
    </div>
  )
}

function BlockView({
  block,
  role,
  toolNamePrefixFilter,
}: {
  block: UIBlock
  role: 'user' | 'assistant'
  toolNamePrefixFilter?: string
}): React.ReactElement | null {
  void toolNamePrefixFilter
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
      const displayName = block.toolName.replace(/^mcp__[^_]+__/, '')
      const isCanvas = block.toolName.startsWith('mcp__spark_canvas__')
      // 如果设了前缀过滤，只显示该前缀；其他工具显示在折叠内
      const matchesFilter = !toolNamePrefixFilter || block.toolName.startsWith(toolNamePrefixFilter)
      const statusClass = `chat-panel-tool-${block.status}`
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
          {matchesFilter && Object.keys(block.toolInput).length > 0 && (
            <details className="chat-panel-tool-input">
              <summary>参数</summary>
              <pre>{JSON.stringify(block.toolInput, null, 2)}</pre>
            </details>
          )}
          {block.error && <div className="chat-panel-tool-error">{block.error}</div>}
          {block.output && block.status === 'success' && (
            <details className="chat-panel-tool-output">
              <summary>结果</summary>
              <pre>
                {block.output.length > 800
                  ? block.output.slice(0, 800) + '\n…(已截断)'
                  : block.output}
              </pre>
            </details>
          )}
        </div>
      )
    }
    case 'error':
      return (
        <div className="chat-panel-block-error">
          <Icons.X size={12} />
          <span>{block.message}</span>
        </div>
      )
    default:
      // 其他 block（file_change/plan_proposed/checkpoint 等）在 modal 场景不展开
      return null
  }
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
          <Spin size="middle" />
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
  return (
    <div className="chat-panel-composer-attachments">
      {attachments.map((attachment) => (
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
