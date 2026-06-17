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
import type { AgentEvent } from '@spark/protocol'
import { Icons } from '../Icons'
import { MessageBuilder, type UIMessage, type UIBlock } from '../services/event-mapper'
import './ChatPanel.less'

export interface ChatPanelProps {
  /** 已创建的 session id；null 表示尚未就绪（显示 spinner） */
  sessionId: string | null
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
}

type AssistantStatus = 'idle' | 'sending' | 'streaming'

export function ChatPanel({
  sessionId,
  loading,
  error,
  contextBadge,
  emptyState,
  placeholder,
  onAfterSend,
  toolNamePrefixFilter,
}: ChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<AssistantStatus>('idle')
  const [sendError, setSendError] = useState<string | null>(null)

  const builderRef = useRef<MessageBuilder>(new MessageBuilder())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 切换 session 时重置 builder
  useEffect(() => {
    builderRef.current = new MessageBuilder()
    setMessages([])
    setStatus('idle')
    setSendError(null)
  }, [sessionId])

  // 订阅 agent 事件流
  useEffect(() => {
    if (sessionId == null) return
    const unsubscribe = window.spark.on(
      'stream:session:agent-event',
      (event: AgentEvent) => {
        const evt = event as { sessionId?: string; type?: string }
        if (evt.sessionId !== sessionId) return
        builderRef.current.processEvent(event)
        setMessages([...builderRef.current.getAllMessages()])
        if (evt.type === 'agent_status') {
          const s = (event as { status?: string }).status
          if (s === 'completed' || s === 'cancelled' || s === 'error') {
            setStatus('idle')
          } else if (s === 'running') {
            setStatus('streaming')
          }
        }
      },
    )
    return unsubscribe
  }, [sessionId])

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sessionId == null || status !== 'idle') return
    setInput('')
    setStatus('sending')
    setSendError(null)
    try {
      await window.spark.invoke('session:send-turn', {
        sessionId: sessionId as never,
        message: text,
      })
      onAfterSend?.(text)
    } catch (err) {
      setStatus('idle')
      setSendError(err instanceof Error ? err.message : '发送失败')
    }
  }, [input, sessionId, status, onAfterSend])

  const disabled = sessionId == null || status !== 'idle' || !!error

  const inputPlaceholder = useMemo(() => {
    if (error) return error
    if (loading) return '正在初始化...'
    if (status === 'sending') return '发送中...'
    if (status === 'streaming') return 'agent 正在回复...'
    return placeholder ?? '输入消息（Enter 发送，Shift+Enter 换行）'
  }, [error, loading, status, placeholder])

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
        {messages.length === 0 && emptyState && (
          <div className="chat-panel-empty">{emptyState}</div>
        )}
        {messages.map((msg) => (
          <MessageView
            key={msg.id}
            message={msg}
            {...(toolNamePrefixFilter !== undefined ? { toolNamePrefixFilter } : {})}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-panel-input-area">
        {sendError && (
          <div className="chat-panel-send-error">
            <Icons.X size={12} />
            <span>{sendError}</span>
          </div>
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
        <Button
          type="primary"
          icon={<Icons.Send size={14} />}
          disabled={!input.trim() || disabled}
          loading={status === 'sending'}
          onClick={() => void handleSend()}
        >
          发送
        </Button>
      </div>
    </div>
  )
}

function MessageView({
  message,
  toolNamePrefixFilter,
}: {
  message: UIMessage
  toolNamePrefixFilter?: string
}): React.ReactElement {
  return (
    <div className={`chat-panel-message chat-panel-message-${message.role}`}>
      <div className="chat-panel-message-avatar">
        {message.role === 'user' ? (
          <Icons.MousePointer size={14} />
        ) : (
          <Icons.Sparkles size={14} />
        )}
      </div>
      <div className="chat-panel-message-body">
        {message.blocks.map((block, idx) => (
          <BlockView
            key={idx}
            block={block}
            {...(toolNamePrefixFilter !== undefined ? { toolNamePrefixFilter } : {})}
          />
        ))}
      </div>
    </div>
  )
}

function BlockView({
  block,
  toolNamePrefixFilter,
}: {
  block: UIBlock
  toolNamePrefixFilter?: string
}): React.ReactElement | null {
  void toolNamePrefixFilter
  switch (block.kind) {
    case 'text':
      return (
        <div className="chat-panel-text">
          {block.content}
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
      const matchesFilter =
        !toolNamePrefixFilter || block.toolName.startsWith(toolNamePrefixFilter)
      const statusClass = `chat-panel-tool-${block.status}`
      return (
        <div className={`chat-panel-tool ${statusClass} ${isCanvas ? 'chat-panel-tool-canvas' : ''}`}>
          <div className="chat-panel-tool-head">
            <span className="chat-panel-tool-icon">
              {block.status === 'running' || block.status === 'pending' ? (
                <Spin size="small" />
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
              <pre>{block.output.length > 800 ? block.output.slice(0, 800) + '\n…(已截断)' : block.output}</pre>
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
