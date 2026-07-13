/**
 * ProjectView — Workspace 模式（IDE 风格：文件树 + Tab + Diff + 右侧 Agent 对话）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { AgentEvent, AgentStatusValue, SessionId, WorkspaceFileChangePayload, WorkspaceInfo, WorkspaceTreeEntry } from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { MessageBuilder, type UIBlock, type UIMessage } from '../services/event-mapper'
import { StreamingErrorCard } from './chat/StreamingErrorCard'
import { RuntimeSignalCard } from './chat/RuntimeSignalCard'
import { CancellationNotice } from './chat/CancellationNotice'
import { useSessionSidebar } from '../SessionSidebarContext'

/** File change status tracked via file_change agent events */
type FileChangeStatus = 'create' | 'modify' | 'delete'

/** Map of file path to its change status */
type FileChangeMap = Record<string, FileChangeStatus>

/** Sort mode for file tree entries */
type FileSortMode = 'name' | 'modified'

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

export function ProjectView() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [fileChanges, setFileChanges] = useState<FileChangeMap>({})
  const { toast } = useToast()
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: startWatch } = useIpcInvoke('workspace:watch-start')
  const { invoke: stopWatch } = useIpcInvoke('workspace:watch-stop')

  // Track recent external change count for batched toast
  const externalChangeBufferRef = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({ count: 0, timer: null })
  const workspaceId = workspace?.id

  useEffect(() => {
    getCurrentWorkspace({})
      .then((res) => setWorkspace(res.workspace))
      .catch(console.error)
  }, [getCurrentWorkspace])

  // Start/stop file watcher when workspace changes
  useEffect(() => {
    if (workspaceId == null) return

    let cancelled = false
    startWatch({ workspaceId })
      .then(() => {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.log(`[FileWatcher] Started watching workspace ${workspaceId}`)
        }
      })
      .catch((err) => {
        console.error('[FileWatcher] Failed to start:', err)
      })

    return () => {
      cancelled = true
      stopWatch({ workspaceId }).catch(() => {})
    }
  }, [workspaceId, startWatch, stopWatch])

  // Reset file changes when workspace changes
  useEffect(() => {
    return deferEffect(() => setFileChanges({}))
  }, [workspaceId])

  // Listen for file_change agent events at the top level
  useIpcStream('stream:session:agent-event', (event: AgentEvent) => {
    if (event.type !== 'file_change') return
    if (workspace == null) return
    const changeType = event.changeType as FileChangeStatus
    const filePath = event.path
    if (!filePath) return

    setFileChanges((prev) => {
      if (prev[filePath] === changeType) return prev
      return { ...prev, [filePath]: changeType }
    })
  }, [workspace])

  // Listen for external file changes from FileWatcherService (fs.watch)
  useIpcStream('stream:workspace:file-change', (payload: WorkspaceFileChangePayload) => {
    if (workspace == null) return
    if (payload.workspaceId !== workspace.id) return

    const changeType = payload.changeType as FileChangeStatus
    const filePath = payload.path

    setFileChanges((prev) => {
      if (prev[filePath] === changeType) return prev
      return { ...prev, [filePath]: changeType }
    })

    // Batched toast: accumulate external changes and show a summary
    const buf = externalChangeBufferRef.current
    buf.count++

    if (buf.timer != null) {
      clearTimeout(buf.timer)
    }

    buf.timer = setTimeout(() => {
      if (buf.count > 0) {
        const label = changeType === 'create' ? '新建' : changeType === 'delete' ? '删除' : '修改'
        if (buf.count === 1) {
          toast.info(`文件${label}: ${filePath}`, { duration: 3000 })
        } else {
          toast.info(`${buf.count} 个文件发生外部变更`, { duration: 4000 })
        }
        buf.count = 0
      }
      buf.timer = null
    }, 500)
  }, [workspace, toast])

  const totalFileChanges = Object.keys(fileChanges).length

  return (
    <div className="project-layout">
      <ProjectExplorer workspace={workspace} fileChanges={fileChanges} onFileChangesChange={setFileChanges} />
      <div className="project-center">
        <ProjectTabs />
        <div className="project-split">
          <div className="project-explorer-main">
            <ProjectDiffPane />
          </div>
          <div className="project-agent-pane">
            <ProjectAgentPane workspaceId={workspace?.id} />
          </div>
        </div>
        <ProjectBottomBar workspace={workspace} fileChangeCount={totalFileChanges} />
      </div>
    </div>
  )
}

function ProjectExplorer({ workspace, fileChanges, onFileChangesChange }: { workspace: WorkspaceInfo | null; fileChanges: FileChangeMap; onFileChangesChange: (changes: FileChangeMap) => void }) {
  const [entries, setEntries] = useState<WorkspaceTreeEntry[]>([])
  const [error, setError] = useState('')
  const [sortMode, setSortMode] = useState<FileSortMode>('name')
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
    return deferEffect(refreshTree)
  }, [refreshTree])

  // Auto-refresh tree when file changes detected
  const prevChangeCountRef = useRef(0)
  useEffect(() => {
    const changeCount = Object.keys(fileChanges).length
    if (changeCount > prevChangeCountRef.current && prevChangeCountRef.current > 0) {
      refreshTree()
    }
    prevChangeCountRef.current = changeCount
  }, [fileChanges, refreshTree])

  // Sort entries: directories first, then by chosen sort mode; changed files float to top within their group
  const sortedEntries = useMemo(() => {
    if (sortMode === 'name' && Object.keys(fileChanges).length === 0) return entries
    const dirs = entries.filter((e) => e.type === 'directory')
    const files = entries.filter((e) => e.type !== 'directory')

    const sortFiles = (items: WorkspaceTreeEntry[]) => {
      return [...items].sort((a, b) => {
        // Changed files always come first
        const aChanged = fileChanges[a.path] != null ? 1 : 0
        const bChanged = fileChanges[b.path] != null ? 1 : 0
        if (aChanged !== bChanged) return bChanged - aChanged
        if (sortMode === 'modified') {
          // When sorting by modified, changed files are already at top; rest stays by name
          return a.name.localeCompare(b.name)
        }
        return a.name.localeCompare(b.name)
      })
    }

    return [...dirs, ...sortFiles(files)]
  }, [entries, fileChanges, sortMode])

  // Count file changes by type for summary
  const changeSummary = useMemo(() => {
    const counts = { create: 0, modify: 0, delete: 0 }
    for (const status of Object.values(fileChanges)) {
      counts[status] = (counts[status] ?? 0) + 1
    }
    return counts
  }, [fileChanges])

  const totalChanges = changeSummary.create + changeSummary.modify + changeSummary.delete

  return (
    <div className="project-explorer">
      <div className="explorer-head">
        <Icons.Folder size={14} />
        <span>{workspace?.name ?? '未打开工作区'}</span>
        <span className="badge dot branch-info">main</span>
      </div>
      <div className="explorer-toolbar">
        <button className="icon-btn explorer-btn-sm"><Icons.Plus size={12} /></button>
        <button className="icon-btn explorer-btn-sm" onClick={refreshTree} disabled={workspace == null || loading} title="刷新文件树"><Icons.Refresh size={12} /></button>
        <button
          className={`icon-btn explorer-btn-sm ${sortMode === 'modified' ? 'active' : ''}`}
          onClick={() => setSortMode((prev) => prev === 'name' ? 'modified' : 'name')}
          title={sortMode === 'name' ? '按修改时间排序' : '按名称排序'}
        >
          <Icons.Clock size={12} />
        </button>
        <div className="flex1"></div>
        {totalChanges > 0 && (
          <span className="explorer-change-badge" title={`${totalChanges} 个文件已变更`}>
            {totalChanges}
          </span>
        )}
        <button className="icon-btn explorer-btn-sm"><Icons.Search size={12} /></button>
      </div>
      <div className="tree scroll">
        {workspace == null && (
          <div className="empty-compact">
            <div className="empty-icon"><Icons.Folder size={18} /></div>
            <div className="empty-title">未打开工作区</div>
            <div className="empty-desc">请先在 Home 或设置中打开一个项目</div>
          </div>
        )}
        {workspace != null && loading && entries.length === 0 && (
          <div className="empty-compact">
            <div className="empty-icon"><Icons.Spinner size={18} /></div>
            <div className="empty-title">加载文件树...</div>
          </div>
        )}
        {workspace != null && error !== '' && (
          <div className="empty-compact">
            <div className="empty-icon error-icon"><Icons.X size={18} /></div>
            <div className="empty-desc error-desc">{error}</div>
          </div>
        )}
        {workspace != null && !loading && error === '' && entries.length === 0 && (
          <div className="empty-compact">
            <div className="empty-icon"><Icons.Folder size={18} /></div>
            <div className="empty-title">该目录为空</div>
          </div>
        )}
        {workspace != null && error === '' && sortedEntries.map((entry) => {
          const changeStatus = fileChanges[entry.path]
          const statusLetter = changeStatus === 'create' ? 'A' : changeStatus === 'modify' ? 'M' : changeStatus === 'delete' ? 'D' : undefined
          return (
            <TreeRow
              key={entry.path}
              depth={entry.depth}
              folder={entry.type === 'directory'}
              expanded={entry.type === 'directory' && entry.depth < 3 && (entry.childrenCount ?? 0) > 0}
              name={entry.name}
              {...(entry.extension !== undefined && { ext: entry.extension })}
              {...(statusLetter != null && { status: statusLetter })}
            />
          )
        })}
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
    if (ext === 'ts' || ext === 'tsx') return <span className="ico mono-sm file-ext-ts">TS</span>
    if (ext === 'md') return <span className="ico mono-sm file-ext-md">MD</span>
    if (ext === 'json') return <span className="ico mono-sm file-ext-json">{'{ }'}</span>
    return <Icons.File className="ico" size={12} />
  }
  const changeClass = status === 'A' ? 'is-created' : status === 'M' ? 'is-modified' : status === 'D' ? 'is-deleted' : ''
  return (
    <div className={`tree-row ${active ? 'active' : ''} ${changeClass}`} style={{ paddingLeft: 6 + depth * 12 }} /* dynamic */>
      {folder
        ? (expanded ? <Icons.ChevronDown className="chev" size={12} /> : <Icons.ChevronRight className="chev" size={12} />)
        : <span className="tree-indent" />}
      {folder ? <Icons.Folder className="ico" size={13} style={{ color: expanded ? 'var(--warning)' : 'var(--text-muted)' }} /* dynamic */ /> : fileIco(ext)}
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
      <div className="flex1"></div>
      <button className="icon-btn" title="分屏"><Icons.PanelRight /></button>
    </div>
  )
}

function ProjectDiffPane() {
  return (
    <>
      <div className="diff-header">
        <span className="mono-sm strong">src/auth/token.ts</span>
        <span className="faint mono-sm diff-line-count">· 412 行</span>
        <span className="badge warning dot diff-unsaved-badge">未保存</span>
        <div className="flex1"></div>
        <span className="badge"><Icons.GitBranch size={10} /> feat/oauth-2.1</span>
        <button className="btn ghost sm"><Icons.Refresh size={11} /> 撤销修改</button>
        <button className="btn sm primary"><Icons.Check size={11} /> 接受全部</button>
      </div>
      <div className="diff diff-container">
        <div className="diff-body scroll diff-body-fill">
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
  const { invoke: sendTurn } = useIpcInvoke('session:submit-turn')
  const { invoke: cancelTurn } = useIpcInvoke('session:cancel')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { bumpSessionMessageCount } = useSessionSidebar()

  useEffect(() => {
    let cancelled = false
    const cancelStart = deferEffect(() => {
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
      })

    return () => {
      cancelled = true
      cancelStart()
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
      bumpSessionMessageCount(sessionId)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '发送失败')
      setInput(text)
    }
  }, [input, sessionId, sendTurn, bumpSessionMessageCount])

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
      <div className="agent-pane-head">
        <Icons.Bot size={14} className="agent-pane-icon" />
        <span className="strong">SparkWork</span>
        {agentStatus === 'thinking' && <span className="badge info dot">思考中</span>}
        {agentStatus === 'calling_tool' && <span className="badge warning dot">调用工具</span>}
        {agentStatus === 'waiting_permission' && <span className="badge warning dot">等待权限</span>}
        {agentStatus === 'waiting_user' && <span className="badge warning dot">等待用户</span>}
        {agentStatus === 'completed' && <span className="badge success dot">完成</span>}
        {agentStatus === 'error' && <span className="badge danger dot">错误</span>}
        {agentStatus === 'cancelled' && <span className="badge dot">已停止</span>}
        <div className="flex1"></div>
        <button className="icon-btn" onClick={handleCancel} disabled={sessionId == null} title="停止"><Icons.Stop size={12} /></button>
      </div>
      <div ref={scrollRef} className="agent-pane-stream">
        <div className="agent-pane-stream-inner">
          {loading && (
            <div className="empty-state">
              <div className="empty-icon"><Icons.Spinner size={24} /></div>
              <div className="empty-title">加载中...</div>
            </div>
          )}
          {!loading && notice && (
            <div className="empty-state">
              <div className="empty-icon"><Icons.AlertTriangle size={24} /></div>
              <div className="empty-title">无法启动 Agent</div>
              <div className="empty-desc">{notice}</div>
            </div>
          )}
          {!loading && !notice && messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon"><Icons.Sparkles size={24} /></div>
              <div className="empty-title">开始对话</div>
              <div className="empty-desc">在此输入消息开始与 Agent 对话</div>
            </div>
          )}
          {!loading && messages.map((message) => (
            <MiniMsg key={message.id} user={message.role === 'user'} status={message.status === 'streaming' ? 'running' : undefined}>
              {message.blocks.map((block, index) => renderBlock(block, index))}
            </MiniMsg>
          ))}
        </div>
      </div>
      <div className="agent-pane-composer">
        <div className="composer">
          <textarea
            className="composer-input"
            rows={2}
            placeholder={sessionId != null ? '给 Agent 发消息…  ⌘↵ 发送' : '请先打开工作区并配置 Provider'}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sessionId == null}
          />
          <div className="composer-actions">
            <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Plus /></button>
            <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Wrench /></button>
            <div className="flex1"></div>
            <button className="btn primary sm" onClick={() => void handleSend()} disabled={!input.trim() || sessionId == null}>
              <Icons.Send size={11} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function countBlockDiffLines(diff: string | undefined): { adds: number; dels: number } {
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

function renderBlock(block: UIBlock, index: number): ReactNode {
  switch (block.kind) {
    case 'text':
      return (
        <span key={index}>
          {block.content}
        </span>
      )
    case 'thinking':
      return (
        <details key={index} className="block-thinking">
          <summary>思考过程{block.isStreaming && '...'}</summary>
          <pre>{block.content}</pre>
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
        <StreamingErrorCard
          key={index}
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
      return <RuntimeSignalCard key={index} block={block} />
    case 'cancelled':
      return <CancellationNotice key={index} message={block.message} />
    case 'file_change': {
      const diffCounts = countBlockDiffLines(block.diff)
      return (
        <div key={index} className="block-file-change">
          <span className="badge block-change-type">{block.changeType}</span>
          <span className="mono-sm block-change-path">{block.path}</span>
          {block.diff != null && block.diff.trim().length > 0 && (
            <span className="faint mono-sm block-change-path">+{diffCounts.adds} -{diffCounts.dels}</span>
          )}
        </div>
      )
    }
    case 'terminal':
      return (
        <div key={index} className="block-terminal">
          {block.stdout && <pre className="mono-sm block-stdout">{block.stdout}</pre>}
          {block.stderr && <pre className="mono-sm block-stderr">{block.stderr}</pre>}
          {block.isStreaming && <span className="faint block-term-status">运行中...</span>}
          {block.exitCode !== undefined && <span className="faint block-term-status">退出码: {block.exitCode}</span>}
        </div>
      )
    case 'validation_suggestion':
      return (
        <div key={index} className="block-file-change">
          <span className="badge block-change-type">验证</span>
          <span className="mono-sm block-change-path">{block.commands.map((command) => command.command).join(' · ')}</span>
        </div>
      )
    default:
      return null
  }
}

function MiniMsg({ user, status, children }: { user?: boolean; status?: 'running' | undefined; children: ReactNode }) {
  return (
    <div className={`msg ${user ? 'user' : 'agent'} mini-msg`}>
      <div className="msg-avatar">
        {user ? 'U' : <Icons.Sparkles size={11} />}
      </div>
      <div className="msg-body">
        <div className="msg-name">
          {user ? '你' : 'Agent'}
          {status === 'running' && (
            <span className="msg-running">
              <Icons.Spinner size={10} /> 生成中
            </span>
          )}
        </div>
        <div className="msg-content">
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
    <div className="tool-call mini-tool">
      <div className="tool-call-head">
        <span className="tool-icon">{icon[name] ?? <Icons.Wrench />}</span>
        <span className="tool-name">{name}</span>
        <span className="tool-arg">{arg}</span>
        {(status === 'pending' || status === 'running') && <Icons.Spinner size={11} className="tool-status" />}
        {status === 'success' && <Icons.Check size={11} className="tool-status ok" />}
        {status === 'error' && <Icons.X size={11} className="tool-status err" />}
      </div>
      {output && <div className="tool-call-body mini-tool-output">{output}</div>}
      {error && <div className="tool-call-body mini-tool-error">{error}</div>}
    </div>
  )
}

function ProjectBottomBar({ workspace, fileChangeCount }: { workspace: WorkspaceInfo | null; fileChangeCount: number }) {
  return (
    <div className="project-bottombar">
      <div className="seg"><Icons.Folder size={11} /> {workspace?.name ?? '未打开工作区'}</div>
      {fileChangeCount > 0 ? (
        <div className="seg seg-changes"><Icons.Edit size={11} /> {fileChangeCount} 个文件已修改</div>
      ) : (
        <div className="seg"><Icons.Edit size={11} /> 无文件变更</div>
      )}
      <div className="seg"><span className="dot-indicator green" /> Agent 就绪</div>
      <div className="seg right"><Icons.Cpu size={11} /> 沙箱 L2</div>
      <div className="seg"><Icons.Database size={11} /> 索引 100%</div>
      <div className="seg mono-sm">UTF-8</div>
      <div className="seg mono-sm">TypeScript</div>
      <div className="seg mono-sm">Ln 47, Col 18</div>
    </div>
  )
}
