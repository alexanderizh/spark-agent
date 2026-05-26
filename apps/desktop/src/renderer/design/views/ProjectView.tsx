/**
 * ProjectView — Workspace 模式（IDE 风格：文件树 + Tab + Diff + 右侧 Agent 对话）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { AgentStatusValue, SessionId, WorkspaceInfo, WorkspaceTreeEntry } from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { MessageBuilder, type UIBlock, type UIMessage } from '../services/event-mapper'

export function ProjectView() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')

  useEffect(() => {
    getCurrentWorkspace({})
      .then((res) => setWorkspace(res.workspace))
      .catch(console.error)
  }, [getCurrentWorkspace])

  return (
    <div className="project-layout">
      <ProjectExplorer workspace={workspace} />
      <div className="project-center">
        <ProjectTabs />
        <div className="flex1" style={{ display: 'flex', minHeight: 0 }}>
          <div className="flex1" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border)' }}>
            <ProjectDiffPane />
          </div>
          <div style={{ width: 380, display: 'flex', flexDirection: 'column' }}>
            <ProjectAgentPane workspaceId={workspace?.id} />
          </div>
        </div>
        <ProjectBottomBar workspace={workspace} />
      </div>
    </div>
  )
}

function ProjectExplorer({ workspace }: { workspace: WorkspaceInfo | null }) {
  const [entries, setEntries] = useState<WorkspaceTreeEntry[]>([])
  const [error, setError] = useState('')
  const { invoke: listDirectory, loading } = useIpcInvoke('workspace:list-directory')

  const refreshTree = useCallback(() => {
    if (workspace == null) {
      setEntries([])
      setError('')
      return
    }

    setError('')
    listDirectory({ workspaceId: workspace.id, maxDepth: 3 })
      .then((res) => setEntries(res.entries))
      .catch((err) => {
        console.error(err)
        setEntries([])
        setError(err instanceof Error ? err.message : '加载文件树失败')
      })
  }, [workspace, listDirectory])

  useEffect(() => {
    refreshTree()
  }, [refreshTree])

  return (
    <div className="project-explorer">
      <div className="explorer-head">
        <Icons.Folder size={14} />
        <span>{workspace?.name ?? '未打开工作区'}</span>
        <span className="badge dot" style={{ color: 'var(--info)' }}>main</span>
      </div>
      <div className="row" style={{ padding: '6px 10px', gap: 4, borderBottom: '1px solid var(--divider)' }}>
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Plus size={12} /></button>
        <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={refreshTree} disabled={workspace == null || loading} title="刷新文件树"><Icons.Refresh size={12} /></button>
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.ChevronDown size={12} /></button>
        <div className="flex1" />
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Search size={12} /></button>
      </div>
      <div className="tree scroll">
        {workspace == null && (
          <div className="faint" style={{ padding: '12px 8px', lineHeight: 1.5 }}>请先在 Home 或设置中打开一个项目。</div>
        )}
        {workspace != null && loading && entries.length === 0 && (
          <div className="faint" style={{ padding: '12px 8px' }}>加载文件树...</div>
        )}
        {workspace != null && error !== '' && (
          <div className="faint" style={{ padding: '12px 8px', lineHeight: 1.5 }}>{error}</div>
        )}
        {workspace != null && !loading && error === '' && entries.length === 0 && (
          <div className="faint" style={{ padding: '12px 8px' }}>该目录为空。</div>
        )}
        {workspace != null && error === '' && entries.map((entry) => (
          <TreeRow
            key={entry.path}
            depth={entry.depth}
            folder={entry.type === 'directory'}
            expanded={entry.type === 'directory' && entry.depth < 3 && (entry.childrenCount ?? 0) > 0}
            name={entry.name}
            {...(entry.extension !== undefined && { ext: entry.extension })}
          />
        ))}
      </div>
    </div>
  )
}

function TreeRow({
  depth,
  name,
  folder,
  expanded,
  ext,
  status,
  active,
}: {
  depth: number
  name: string
  folder?: boolean
  expanded?: boolean
  ext?: string
  status?: 'M' | 'A' | 'D'
  active?: boolean
}) {
  const fileIco = (ext?: string) => {
    if (ext === 'ts' || ext === 'tsx') return <span className="ico mono-sm" style={{ color: '#3178c6', fontSize: 9, fontWeight: 700 }}>TS</span>
    if (ext === 'md') return <span className="ico mono-sm" style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>MD</span>
    if (ext === 'json') return <span className="ico mono-sm" style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b' }}>{'{ }'}</span>
    return <Icons.File className="ico" size={12} />
  }
  return (
    <div className={`tree-row ${active ? 'active' : ''}`} style={{ paddingLeft: 6 + depth * 12 }}>
      {folder
        ? (expanded ? <Icons.ChevronDown className="chev" size={12} /> : <Icons.ChevronRight className="chev" size={12} />)
        : <span style={{ width: 12, display: 'inline-block' }} />}
      {folder ? <Icons.Folder className="ico" size={13} style={{ color: expanded ? 'var(--warning)' : 'var(--text-muted)' }} /> : fileIco(ext)}
      <span className="nm">{name}</span>
      {status && <span className={`git-status git-${status.toLowerCase()}`}>{status}</span>}
    </div>
  )
}

function ProjectTabs() {
  return (
    <div className="project-tabs">
      <div className="project-tab"><Icons.Chat className="ico" /> 会话 <span className="x"><Icons.X size={10} /></span></div>
      <div className="project-tab active"><Icons.File className="ico" /> token.ts <span className="dirty" /> <span className="x"><Icons.X size={10} /></span></div>
      <div className="project-tab"><Icons.File className="ico" /> pkce.ts <span className="x"><Icons.X size={10} /></span></div>
      <div className="project-tab"><Icons.Terminal className="ico" /> terminal <span className="x"><Icons.X size={10} /></span></div>
      <div className="project-tab"><Icons.GitBranch className="ico" /> 更改 (5) <span className="x"><Icons.X size={10} /></span></div>
      <div style={{ flex: 1 }} />
      <button className="icon-btn" title="分屏"><Icons.PanelRight /></button>
    </div>
  )
}

function ProjectDiffPane() {
  return (
    <>
      <div className="row" style={{ padding: '8px var(--pad-lg)', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)' }}>
        <span className="mono-sm strong">src/auth/token.ts</span>
        <span className="faint mono-sm" style={{ fontSize: 11 }}>· 412 行</span>
        <span className="badge warning dot" style={{ marginLeft: 8 }}>未保存</span>
        <div className="flex1" />
        <span className="badge"><Icons.GitBranch size={10} /> feat/oauth-2.1</span>
        <button className="btn ghost sm"><Icons.Refresh size={11} /> 撤销修改</button>
        <button className="btn sm primary"><Icons.Check size={11} /> 接受全部</button>
      </div>
      <div className="diff" style={{ border: 'none', borderRadius: 0, margin: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="diff-body scroll" style={{ maxHeight: 'none', flex: 1 }}>
          <DiffLine type="hunk" text="@@ -1,6 +1,9 @@ src/auth/token.ts" />
          <DiffLine type="ctx" ln="1" text='import { fetch } from "undici";' />
          <DiffLine type="ctx" ln="2" text='import { AuthError } from "./errors";' />
          <DiffLine type="add" ln="3" text='import { generateVerifier, challengeFor } from "./pkce";' />
          <DiffLine type="ctx" ln="4" text="" />
          <DiffLine type="ctx" ln="5" text="export interface ExchangeOpts {" />
          <DiffLine type="ctx" ln="6" text="  code: string;" />
          <DiffLine type="add" ln="7" text="  /** PKCE code verifier — required in OAuth 2.1 */" />
          <DiffLine type="add" ln="8" text="  verifier: string;" />
          <DiffLine type="ctx" ln="9" text="  client_id: string;" />
          <DiffLine type="ctx" ln="10" text="}" />
          <DiffLine type="hunk" text="@@ -42,18 +45,22 @@ class TokenService {" />
          <DiffLine type="ctx" ln="42" text="  async exchange(opts: ExchangeOpts): Promise<TokenSet> {" />
          <DiffLine type="del" ln="43" text="    const body = {" />
          <DiffLine type="del" ln="44" text="      grant_type: 'authorization_code'," />
          <DiffLine type="del" ln="45" text="      code: opts.code," />
          <DiffLine type="add" ln="46" text="    if (!opts.verifier) {" />
          <DiffLine type="add" ln="47" text="      throw new AuthError('PKCE verifier required (RFC 9700)');" />
          <DiffLine type="add" ln="48" text="    }" />
          <DiffLine type="add" ln="49" text="    const body = {" />
          <DiffLine type="add" ln="50" text="      grant_type: 'authorization_code'," />
          <DiffLine type="add" ln="51" text="      code: opts.code," />
          <DiffLine type="add" ln="52" text="      code_verifier: opts.verifier," />
          <DiffLine type="ctx" ln="53" text="      client_id: opts.client_id," />
          <DiffLine type="ctx" ln="54" text="    };" />
          <DiffLine type="ctx" ln="55" text="" />
          <DiffLine type="ctx" ln="56" text="    const res = await fetch(this.endpoint, {" />
          <DiffLine type="ctx" ln="57" text="      method: 'POST'," />
          <DiffLine type="ctx" ln="58" text="      body: new URLSearchParams(body)," />
          <DiffLine type="ctx" ln="59" text="    });" />
          <DiffLine type="hunk" text="@@ -112,9 +119,14 @@ class TokenService {" />
          <DiffLine type="ctx" ln="112" text="  async refresh(refreshToken: string): Promise<TokenSet> {" />
          <DiffLine type="del" ln="113" text="    // OAuth 2.0: refresh token is reusable" />
          <DiffLine type="add" ln="120" text="    // OAuth 2.1: rotating refresh tokens — old one invalidated on use" />
          <DiffLine type="add" ln="121" text="    // Compat window: previous token remains valid for 7d (see compat/oauth2-legacy)" />
          <DiffLine type="ctx" ln="122" text="    const res = await this.exchangeRefresh(refreshToken);" />
          <DiffLine type="add" ln="123" text="    await this.revokePrevious(refreshToken, { grace: '7d' });" />
          <DiffLine type="ctx" ln="124" text="    return res;" />
        </div>
      </div>
    </>
  )
}

function DiffLine({ type, ln, text }: { type: string; ln?: string; text: string }) {
  return (
    <div className={`diff-line ${type}`}>
      <span className="ln">{ln || ''}</span>
      <span className="code">{text}</span>
    </div>
  )
}

function ProjectAgentPane({ workspaceId }: { workspaceId: string | undefined }) {
  const [sessionId, setSessionId] = useState<SessionId | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatusValue>('idle')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const builderRef = useRef(new MessageBuilder())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: getHistory } = useIpcInvoke('session:get-history')
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')
  const { invoke: cancelTurn } = useIpcInvoke('session:cancel')
  const { invoke: listProviders } = useIpcInvoke('provider:list')

  useEffect(() => {
    const builder = new MessageBuilder()
    builderRef.current = builder
    setMessages([])
    setSessionId(null)
    setAgentStatus('idle')
    setNotice('')

    if (workspaceId == null) {
      setLoading(false)
      setNotice('未打开工作区。请先在 Home 或设置中打开一个项目。')
      return
    }

    let cancelled = false
    setLoading(true)

    listSessions({ workspaceId, limit: 50 })
      .then(async (sessionsRes) => {
        if (cancelled) return null
        const existing = sessionsRes.sessions.find((session) => session.status !== 'error')
        if (existing != null) {
          setSessionId(existing.id)
          return getHistory({ sessionId: existing.id, limit: 200 })
        }

        const providersRes = await listProviders({})
        if (cancelled) return null
        const provider = providersRes.profiles.find((profile) => profile.isDefault) ?? providersRes.profiles[0]
        if (provider == null) {
          setNotice('尚未配置 Provider。请先在设置中添加 Provider 后再使用项目 Agent。')
          return null
        }

        const created = await createSession({
          providerProfileId: provider.id,
          workspaceId,
          title: 'Workspace Session',
        })
        if (!cancelled) setSessionId(created.sessionId)
        return null
      })
      .then((historyRes) => {
        if (cancelled || historyRes == null) return
        const historyBuilder = new MessageBuilder()
        for (const event of historyRes.events) {
          historyBuilder.processEvent(event)
          if (event.type === 'agent_status') setAgentStatus(event.status)
        }
        builderRef.current = historyBuilder
        setMessages(historyBuilder.getAllMessages())
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setNotice(err instanceof Error ? err.message : '加载项目 Agent 失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, listSessions, getHistory, listProviders, createSession])

  useIpcStream('stream:session:agent-event', (event) => {
    if (event.sessionId !== sessionId) return
    builderRef.current.processEvent(event)
    setMessages([...builderRef.current.getAllMessages()])
    if (event.type === 'agent_status') setAgentStatus(event.status)
  }, [sessionId])

  useEffect(() => {
    if (scrollRef.current != null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sessionId == null) return
    setInput('')
    setNotice('')
    try {
      await sendTurn({ sessionId, message: text })
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '发送失败')
      setInput(text)
    }
  }, [input, sessionId, sendTurn])

  const handleCancel = useCallback(async () => {
    if (sessionId == null) return
    try {
      await cancelTurn({ sessionId })
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '取消失败')
    }
  }, [sessionId, cancelTurn])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <>
      <div className="row" style={{ padding: '8px var(--pad-md)', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', gap: 8 }}>
        <Icons.Bot size={14} style={{ color: 'var(--primary)' }} />
        <span className="strong" style={{ fontSize: 'var(--font-sm)' }}>Spark Agent</span>
        {agentStatus === 'thinking' && <span className="badge info dot">思考中</span>}
        {agentStatus === 'calling_tool' && <span className="badge warning dot">调用工具</span>}
        {agentStatus === 'waiting_permission' && <span className="badge warning dot">等待权限</span>}
        {agentStatus === 'waiting_user' && <span className="badge warning dot">等待用户</span>}
        {agentStatus === 'completed' && <span className="badge success dot">完成</span>}
        {agentStatus === 'error' && <span className="badge danger dot">错误</span>}
        {agentStatus === 'cancelled' && <span className="badge dot">已停止</span>}
        <div className="flex1" />
        <button className="icon-btn" onClick={handleCancel} disabled={sessionId == null} title="停止"><Icons.Stop size={12} /></button>
      </div>
      <div ref={scrollRef} className="chat-stream" style={{ flex: 1, padding: '14px 0', background: 'var(--bg)', overflowY: 'auto' }}>
        <div className="chat-stream-inner" style={{ padding: '0 var(--pad-md)', gap: 14 }}>
          {loading && <div className="faint" style={{ textAlign: 'center', padding: 20 }}>加载中...</div>}
          {!loading && notice && (
            <div className="faint" style={{ textAlign: 'center', padding: 20, lineHeight: 1.6 }}>
              {notice}
            </div>
          )}
          {!loading && !notice && messages.length === 0 && (
            <div className="faint" style={{ textAlign: 'center', padding: 20 }}>
              在此输入消息开始与 Agent 对话
            </div>
          )}
          {!loading && messages.map((message) => (
            <MiniMsg key={message.id} user={message.role === 'user'} status={message.status === 'streaming' ? 'running' : undefined}>
              {message.blocks.map((block, index) => renderBlock(block, index))}
            </MiniMsg>
          ))}
        </div>
      </div>
      <div className="composer-wrap" style={{ padding: '10px 12px 12px' }}>
        <div className="composer">
          <textarea
            rows={2}
            placeholder={sessionId != null ? '给 Agent 发消息…  ⌘↵ 发送' : '请先打开工作区并配置 Provider'}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sessionId == null}
          />
          <div className="composer-actions">
            <button className="icon-btn"><Icons.Plus /></button>
            <button className="icon-btn"><Icons.Wrench /></button>
            <div className="flex1" />
            <button className="btn primary sm" onClick={() => void handleSend()} disabled={!input.trim() || sessionId == null}>
              <Icons.Send size={11} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function renderBlock(block: UIBlock, index: number): ReactNode {
  switch (block.kind) {
    case 'text':
      return (
        <span key={index}>
          {block.content}
          {block.isStreaming && <span className="cursor-blink">▋</span>}
        </span>
      )
    case 'thinking':
      return (
        <details key={index} style={{ margin: '4px 0', fontSize: 11, color: 'var(--text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>思考过程{block.isStreaming && '...'}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', padding: '4px 8px', fontSize: 11 }}>{block.content}</pre>
        </details>
      )
    case 'tool_call':
      return (
        <MiniTool
          key={index}
          name={block.toolName}
          arg={JSON.stringify(block.toolInput).slice(0, 80)}
          status={block.status}
          output={block.output}
          error={block.error}
        />
      )
    case 'error':
      return (
        <div key={index} style={{ margin: '4px 0', padding: '6px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: 11, color: 'var(--danger)' }}>
          {block.message}
        </div>
      )
    case 'file_change':
      return (
        <div key={index} style={{ margin: '4px 0', padding: '4px 8px', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
          <span className="badge" style={{ fontSize: 9 }}>{block.changeType}</span>
          <span className="mono-sm" style={{ fontSize: 11, marginLeft: 6 }}>{block.path}</span>
        </div>
      )
    case 'terminal':
      return (
        <div key={index} style={{ margin: '4px 0', padding: '4px 8px', background: '#0d0d10', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
          {block.stdout && <pre className="mono-sm" style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--text)', margin: 0 }}>{block.stdout}</pre>}
          {block.stderr && <pre className="mono-sm" style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: 'var(--danger)', margin: 0 }}>{block.stderr}</pre>}
          {block.isStreaming && <span className="faint" style={{ fontSize: 10 }}>运行中...</span>}
          {block.exitCode !== undefined && <span className="faint" style={{ fontSize: 10 }}>退出码: {block.exitCode}</span>}
        </div>
      )
    default:
      return null
  }
}

function MiniMsg({ user, status, children }: { user?: boolean; status?: 'running' | undefined; children: ReactNode }) {
  return (
    <div className="msg" style={{ gap: 8 }}>
      <div className="msg-avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
        {user ? 'U' : <Icons.Sparkles size={11} />}
      </div>
      <div className="msg-body">
        <div className="msg-name" style={{ fontSize: 11, marginBottom: 4 }}>
          {user ? '你' : 'Agent'}
          {status === 'running' && (
            <span style={{ color: 'var(--info)', fontWeight: 500, fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icons.Spinner size={10} /> 生成中
            </span>
          )}
        </div>
        <div className="msg-content" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function MiniTool({
  name,
  arg,
  status,
  output,
  error,
}: {
  name: string
  arg: string
  status?: 'pending' | 'running' | 'success' | 'error'
  output?: string | undefined
  error?: string | undefined
}) {
  const icon: Record<string, ReactNode> = {
    Read: <Icons.File />,
    Edit: <Icons.Edit />,
    Write: <Icons.File />,
    Bash: <Icons.Terminal />,
    Grep: <Icons.Search />,
  }
  return (
    <div style={{ margin: '6px 0', padding: '5px 8px', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{icon[name] ?? <Icons.Wrench />}</span>
        <span className="mono-sm strong" style={{ fontSize: 11 }}>{name}</span>
        <span className="mono-sm muted truncate" style={{ fontSize: 11 }}>{arg}</span>
        {(status === 'pending' || status === 'running') && <Icons.Spinner size={11} style={{ color: 'var(--info)', marginLeft: 'auto' }} />}
        {status === 'success' && <Icons.Check size={11} style={{ color: 'var(--success)', marginLeft: 'auto' }} />}
        {status === 'error' && <Icons.X size={11} style={{ color: 'var(--danger)', marginLeft: 'auto' }} />}
      </div>
      {output && <pre className="mono-sm" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{output}</pre>}
      {error && <div style={{ marginTop: 6, color: 'var(--danger)', fontSize: 11 }}>{error}</div>}
    </div>
  )
}

function ProjectBottomBar({ workspace }: { workspace: WorkspaceInfo | null }) {
  return (
    <div className="project-bottombar">
      <div className="seg"><Icons.Folder size={11} /> {workspace?.name ?? '未打开工作区'}</div>
      <div className="seg"><Icons.Edit size={11} /> 5 个文件已修改</div>
      <div className="seg"><span className="dot-indicator green" /> Agent 就绪</div>
      <div className="seg right"><Icons.Cpu size={11} /> 沙箱 L2</div>
      <div className="seg"><Icons.Database size={11} /> 索引 100%</div>
      <div className="seg mono-sm">UTF-8</div>
      <div className="seg mono-sm">TypeScript</div>
      <div className="seg mono-sm">Ln 47, Col 18</div>
    </div>
  )
}
