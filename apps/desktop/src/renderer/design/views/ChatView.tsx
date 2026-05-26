/**
 * ChatView — 真实 IPC 驱动的会话视图
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { ErrorCard } from '../ChatInteractions'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { MessageBuilder } from '../services/event-mapper'
import type { UIMessage, UIBlock } from '../services/event-mapper'
import type { SessionListResponse, SessionId } from '@spark/protocol'

type SessionSummary = SessionListResponse['sessions'][number]

export function ChatView() {
  const [active, setActive] = useState<SessionId | null>(null)
  const [showInspector, setShowInspector] = useState(true)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [agentStatus, setAgentStatus] = useState<string>('')

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')

  const refreshSessions = () => {
    listSessions({ limit: 100 }).then(res => setSessions(res.sessions)).catch(console.error)
  }

  useEffect(() => { refreshSessions() }, [])

  const handleNewSession = async () => {
    try {
      const provRes = await listProviders({})
      const profile = provRes.profiles[0]
      if (!profile) {
        alert('请先在设置中配置 Provider')
        return
      }
      const res = await createSession({ providerProfileId: profile.id })
      refreshSessions()
      setActive(res.sessionId)
    } catch (err) {
      console.error('创建会话失败', err)
    }
  }

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <div className="chat-sidebar-head">
          <div className="search-input">
            <Icons.Search />
            <input placeholder="搜索会话..." />
          </div>
          <button className="icon-btn" title="新建会话" onClick={handleNewSession}><Icons.Plus /></button>
        </div>

        <div className="chat-sidebar-projbar">
          <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>会话列表</span>
          <span className="flex1" />
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="新建会话" onClick={handleNewSession}><Icons.Plus size={11} /></button>
        </div>

        <div className="chat-list scroll">
          {sessions.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12 }}>
              <Icons.Chat size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
              <div>暂无会话</div>
              <div style={{ marginTop: 4 }}>点击 + 新建会话</div>
            </div>
          ) : (
            sessions.map(s => (
              <ChatListItem key={s.id} session={s} active={active} onClick={setActive} />
            ))
          )}
        </div>
      </div>

      <div className="chat-main">
        <ChatTabbar
          session={sessions.find(s => s.id === active) ?? null}
          agentStatus={agentStatus}
          showInspector={showInspector}
          setShowInspector={setShowInspector}
        />
        {active ? (
          <ChatStream
            sessionId={active}
            onStatusChange={setAgentStatus}
          />
        ) : (
          <div className="chat-stream" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--fg-muted)' }}>
            <Icons.Sparkles size={32} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 14 }}>选择或新建一个会话开始对话</div>
          </div>
        )}
        <Composer sessionId={active} onSent={() => {}} />
      </div>

      {showInspector && (
        <ChatInspector session={sessions.find(s => s.id === active) ?? null} />
      )}
    </div>
  )
}

function ChatListItem({ session: s, active, onClick }: { session: SessionSummary; active: SessionId | null; onClick: (id: SessionId) => void }) {
  const statusLabel: Record<SessionSummary['status'], ReactNode> = {
    running: <span className="pulse-dot" />,
    error: <span className="badge danger dot">错误</span>,
    idle: null,
  }
  return (
    <div className={`chat-item proj-session ${active === s.id ? 'active' : ''}`} onClick={() => onClick(s.id)}>
      <div className="chat-item-title">
        <span className="truncate flex1">{s.title || '新会话'}</span>
      </div>
      <div className="chat-item-snippet">{s.messageCount} 条消息</div>
      <div className="chat-item-meta">
        <span className="badge primary">{s.providerProfileId.slice(0, 8)}</span>
        {statusLabel[s.status]}
        <span className="chat-item-time">{new Date(s.updatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function ChatTabbar({
  session,
  agentStatus,
  showInspector,
  setShowInspector,
}: {
  session: SessionSummary | null
  agentStatus: string
  showInspector: boolean
  setShowInspector: (v: boolean) => void
}) {
  return (
    <div className="chat-tabbar">
      <div className="chat-title-block">
        {session ? (
          <>
            <span className="badge primary dot">会话</span>
            <span className="chat-title truncate">{session.title || '新会话'}</span>
            {agentStatus && (
              <span className="row" style={{ gap: 5, color: 'var(--info)', fontSize: 11, fontWeight: 500 }}>
                <Icons.Spinner size={11} /> {agentStatus}
              </span>
            )}
          </>
        ) : (
          <span className="chat-title truncate muted">未选择会话</span>
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className={`icon-btn ${showInspector ? 'active' : ''}`} onClick={() => setShowInspector(!showInspector)}><Icons.PanelRight /></button>
        <button className="icon-btn"><Icons.More /></button>
      </div>
    </div>
  )
}

function ChatStream({ sessionId, onStatusChange }: { sessionId: SessionId; onStatusChange: (s: string) => void }) {
  const streamRef = useRef<HTMLDivElement | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const builderRef = useRef(new MessageBuilder())
  const { invoke: getHistory } = useIpcInvoke('session:get-history')

  // 切换会话时加载历史
  useEffect(() => {
    const builder = new MessageBuilder()
    builderRef.current = builder
    setMessages([])
    onStatusChange('')

    getHistory({ sessionId, limit: 200 })
      .then(res => {
        for (const event of res.events) builder.processEvent(event)
        setMessages(builder.getAllMessages())
      })
      .catch(console.error)
  }, [sessionId])

  // 实时监听新事件
  useIpcStream('stream:session:agent-event', (event) => {
    if (event.sessionId !== sessionId) return
    builderRef.current.processEvent(event)
    setMessages([...builderRef.current.getAllMessages()])

    if (event.type === 'agent_status') {
      const labels: Record<string, string> = {
        thinking: '思考中',
        calling_tool: '调用工具',
        completed: '',
        error: '',
        cancelled: '',
      }
      onStatusChange(labels[event.status] ?? '')
    }
  }, [sessionId])

  // 自动滚动到底部
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="chat-stream" ref={streamRef}>
      <div className="chat-stream-inner">
        {messages.map(msg =>
          msg.role === 'user' ? (
            <UserMsg key={msg.id}>{renderBlocks(msg.blocks)}</UserMsg>
          ) : msg.status === 'streaming' ? (
            <AgentMsg key={msg.id} status="running">{renderBlocks(msg.blocks)}</AgentMsg>
          ) : (
            <AgentMsg key={msg.id}>{renderBlocks(msg.blocks)}</AgentMsg>
          )
        )}
      </div>
    </div>
  )
}

function renderBlocks(blocks: UIBlock[]): ReactNode {
  return blocks.map((block, i) => {
    switch (block.kind) {
      case 'text':
        return (
          <p key={i}>
            {block.content}
            {block.isStreaming && <span className="cursor-blink">▋</span>}
          </p>
        )
      case 'thinking':
        return (
          <details key={i} style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 12 }}>
              思考过程{block.isStreaming && ' …'}
            </summary>
            <pre style={{ fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{block.content}</pre>
          </details>
        )
      case 'tool_call': {
        const toolStatus = block.status === 'success' ? 'ok' as const : block.status === 'error' ? 'error' as const : null
        return toolStatus ? (
          <ToolCall key={i} name={block.toolName} arg={JSON.stringify(block.toolInput).slice(0, 80)} status={toolStatus}>
            {block.output && <pre style={{ margin: 0, fontSize: 11 }}>{block.output}</pre>}
            {block.error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{block.error}</span>}
          </ToolCall>
        ) : (
          <ToolCall key={i} name={block.toolName} arg={JSON.stringify(block.toolInput).slice(0, 80)}>
            {block.output && <pre style={{ margin: 0, fontSize: 11 }}>{block.output}</pre>}
            {block.error && <span style={{ color: 'var(--danger)', fontSize: 11 }}>{block.error}</span>}
          </ToolCall>
        )
      }
      case 'error':
        return (
          <ErrorCard
            key={i}
            message={block.message}
            detail={block.code}
            suggestions={block.retryable ? ['点击重试'] : []}
          />
        )
      case 'terminal':
        return (
          <TerminalBlock key={i}>
            {block.stdout && <span>{block.stdout}</span>}
            {block.stderr && <span style={{ color: '#ef4444' }}>{block.stderr}</span>}
            {block.isStreaming && <span className="dim"> …</span>}
          </TerminalBlock>
        )
      case 'file_change':
        return (
          <div key={i} className="chat-card" style={{ fontSize: 12, padding: '6px 10px' }}>
            <Icons.File size={11} /> {block.changeType}: <code className="mono-sm">{block.path}</code>
          </div>
        )
      default:
        return null
    }
  })
}

function UserMsg({ children }: { children: ReactNode }) {
  return (
    <div className="msg user">
      <div className="msg-avatar">U</div>
      <div className="msg-body">
        <div className="msg-name">你</div>
        <div className="msg-content">{children}</div>
      </div>
    </div>
  )
}

function AgentMsg({ status, children }: { status?: 'running'; children: ReactNode }) {
  return (
    <div className="msg agent">
      <div className="msg-avatar"><Icons.Sparkles size={14} /></div>
      <div className="msg-body">
        <div className="msg-name">
          Agent
          {status === 'running' && (
            <span className="row" style={{ gap: 5, color: 'var(--info)', fontSize: 11, fontWeight: 500 }}>
              <Icons.Spinner size={11} /> 生成中
            </span>
          )}
        </div>
        <div className="msg-content">{children}</div>
      </div>
    </div>
  )
}

function ToolCall({ name, arg, status, children }: { name: string; arg: string; status?: 'ok' | 'error'; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const iconMap: Record<string, ReactNode> = {
    Read: <Icons.File className="tool-icon" />,
    Grep: <Icons.Search className="tool-icon" />,
    Bash: <Icons.Terminal className="tool-icon" />,
    Edit: <Icons.Edit className="tool-icon" />,
    Write: <Icons.File className="tool-icon" />,
  }
  return (
    <div className={`tool-call ${open ? 'open' : ''}`}>
      <div className="tool-call-head" onClick={() => setOpen(!open)}>
        {iconMap[name] || <Icons.Wrench className="tool-icon" />}
        <span className="tool-name">{name}</span>
        <span className="tool-arg">{arg}</span>
        {status === 'ok' && <Icons.Check size={12} style={{ color: 'var(--success)' }} />}
        {status === 'error' && <Icons.X size={12} style={{ color: 'var(--danger)' }} />}
        <Icons.ChevronRight size={12} className="chev" />
      </div>
      {open && children && <div className="tool-call-body">{children}</div>}
    </div>
  )
}

function TerminalBlock({ children }: { children: ReactNode }) {
  return <div className="terminal mono-sm">{children}</div>
}

function Composer({ sessionId, onSent }: { sessionId: SessionId | null; onSent: () => void }) {
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
      setValue(text)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend()
  }

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className="composer">
          <textarea
            rows={2}
            placeholder={sessionId ? '询问、修改、运行任务…  ⌘↵ 发送' : '请先选择或新建一个会话'}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!sessionId || sending}
          />
          <div className="composer-actions">
            <button className="icon-btn" title="添加文件"><Icons.Plus /></button>
            <button className="icon-btn" title="工具"><Icons.Wrench /></button>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="faint" style={{ fontSize: 11 }}>
              <span className="kbd">⌘</span> <span className="kbd">↵</span> 发送
            </span>
            <button
              className="btn primary sm"
              style={{ height: 28, paddingInline: 14 }}
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

function ChatInspector({ session }: { session: SessionSummary | null }) {
  return (
    <div className="inspector scroll">
      <div className="inspector-section">
        <h4>会话信息</h4>
        {session ? (
          <>
            <div className="kv-row"><span className="k">ID</span><span className="v mono-sm" style={{ fontSize: 10 }}>{(session.id as string).slice(0, 16)}…</span></div>
            <div className="kv-row"><span className="k">状态</span><span className="v">{session.status}</span></div>
            <div className="kv-row"><span className="k">消息数</span><span className="v">{session.messageCount}</span></div>
            <div className="kv-row"><span className="k">创建时间</span><span className="v">{new Date(session.createdAt).toLocaleString()}</span></div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>未选择会话</div>
        )}
      </div>
    </div>
  )
}
