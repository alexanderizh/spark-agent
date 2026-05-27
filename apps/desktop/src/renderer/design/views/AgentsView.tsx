/**
 * AgentsView — Multi-Agent 协作视图（真实 IPC 数据驱动）
 *
 * 数据来源：
 *   - session:list → 每个 session 就是一个 agent 实例
 *   - session:get-history → 聚合事件时间线
 *   - provider:list → Provider 信息
 *   - usage:get-session → Token 用量
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import type {
  AgentEvent,
  ProviderProfile,
  SessionListResponse,
  WorkspaceInfo,
} from '@spark/protocol'
import { useApp } from '../AppContext'

type AgentStatus = 'running' | 'done' | 'idle' | 'failed'

type SessionSummary = SessionListResponse['sessions'][number]

/** Agent 卡片需要的数据（从 session 衍生） */
interface AgentCardData {
  sessionId: string
  icon: ReactNode
  name: string
  role: string
  status: AgentStatus
  stats: [string, string][]
  current: string
  createdAt: string
  messageCount: number
}

/** 时间线条目（从 session event 衍生） */
interface TimelineEntry {
  time: string
  marker: string
  icon: ReactNode
  title: ReactNode
  meta?: string | undefined
  sortKey: number
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/** 从 ISO 时间戳提取 HH:MM:SS */
function toHHMMSS(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '--:--:--'
  }
}

/** 根据 agentAdapter 返回对应图标 */
function adapterIcon(adapter: string): ReactNode {
  switch (adapter) {
    case 'claude':
      return <Icons.Brain />
    case 'codex':
      return <Icons.Code />
    default:
      return <Icons.Zap size={16} />
  }
}

/** 根据 agentAdapter 返回可读名称 */
function adapterLabel(adapter: string): string {
  switch (adapter) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    default:
      return adapter
  }
}

/** 将 session status 映射为 AgentStatus */
function mapSessionStatus(status: string): AgentStatus {
  switch (status) {
    case 'running':
      return 'running'
    case 'idle':
      return 'idle'
    case 'error':
      return 'failed'
    default:
      return 'done'
  }
}

/** 根据 chatMode 返回角色标签 */
function chatModeLabel(chatMode: string): string {
  switch (chatMode) {
    case 'agent':
      return 'Agent'
    case 'ask':
      return 'Ask'
    case 'edit':
      return 'Edit'
    case 'review':
      return 'Review'
    default:
      return chatMode
  }
}

/** 根据 event 类型生成时间线条目 */
function eventToTimeline(event: AgentEvent, idx: number): TimelineEntry | null {
  const time = toHHMMSS(event.timestamp)
  switch (event.type) {
    case 'user_message':
      return {
        time, marker: 'primary', icon: <Icons.User size={11} />,
        title: <><strong>用户</strong> 发送消息</>,
        meta: event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content,
        sortKey: idx,
      }
    case 'assistant_message':
      if (event.mode === 'delta') return null // skip streaming deltas
      return {
        time, marker: '', icon: <Icons.Chat size={11} />,
        title: <><strong>助手</strong> 回复</>,
        meta: event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content,
        sortKey: idx,
      }
    case 'tool_call':
      return {
        time, marker: '', icon: <Icons.Terminal size={11} />,
        title: <>调用 <span className="mono-sm">{event.toolName}</span></>,
        meta: event.source === 'mcp' ? `MCP: ${event.mcpServerId ?? 'unknown'}` : '内置工具',
        sortKey: idx,
      }
    case 'tool_result': {
      const success = event.status === 'success'
      return {
        time, marker: success ? 'success' : 'warning', icon: success ? <Icons.Check size={11} /> : <Icons.AlertTriangle size={11} />,
        title: <><strong>{event.toolName}</strong> {success ? '执行完成' : `失败: ${event.error ?? ''}`}</>,
        meta: event.durationMs != null ? `耗时 ${event.durationMs}ms` : undefined,
        sortKey: idx,
      }
    }
    case 'permission_request':
      return {
        time, marker: 'warning', icon: <Icons.Shield size={11} />,
        title: <>请求权限 · <span className="mono-sm">{event.action}</span></>,
        meta: event.description,
        sortKey: idx,
      }
    case 'permission_response':
      return {
        time, marker: 'primary', icon: <Icons.Shield size={11} />,
        title: <>权限审批 · {event.decision}</>,
        sortKey: idx,
      }
    case 'file_change':
      return {
        time, marker: '', icon: <Icons.Edit size={11} />,
        title: <><strong>文件{event.changeType === 'create' ? '创建' : event.changeType === 'delete' ? '删除' : '修改'}</strong> <span className="mono-sm">{event.path}</span></>,
        meta: event.diff != null ? `${event.diff.split('\n').length} 行变更` : undefined,
        sortKey: idx,
      }
    case 'agent_status':
      return {
        time, marker: event.status === 'completed' ? 'success' : event.status === 'error' ? 'warning' : 'primary',
        icon: <Icons.Activity size={11} />,
        title: <>状态: <strong>{event.status}</strong></>,
        meta: event.message,
        sortKey: idx,
      }
    case 'agent_thinking':
      return null // skip thinking events (too many)
    case 'usage_update':
      return null // skip usage events (shown in card stats)
    case 'agent_error':
      return {
        time, marker: 'warning', icon: <Icons.XCircle size={11} />,
        title: <><strong>错误</strong> {event.code}</>,
        meta: event.message,
        sortKey: idx,
      }
    case 'terminal_output':
      return null // skip terminal output (too verbose)
    case 'plan_proposed':
      return {
        time, marker: 'primary', icon: <Icons.Map size={11} />,
        title: <><strong>计划提交</strong> 等待审批</>,
        meta: event.plan.length > 80 ? event.plan.slice(0, 80) + '...' : event.plan,
        sortKey: idx,
      }
    case 'context_usage':
      return null // skip context usage
    default:
      return null
  }
}

// ─── 组件 ─────────────────────────────────────────────────────────────────────

export function AgentsView() {
  const { setTweak } = useApp()

  // State
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [timelineEvents, setTimelineEvents] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // IPC hooks
  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: getSessionHistory } = useIpcInvoke('session:get-history')

  // Refresh data
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sessionRes, providerRes, workspaceRes] = await Promise.all([
        listSessions({ limit: 50 }),
        listProviders({}),
        getCurrentWorkspace({}),
      ])
      setSessions(sessionRes.sessions)
      setProviders(providerRes.profiles)
      setWorkspace(workspaceRes.workspace)

      // Aggregate timeline from all sessions (take last 50 events across sessions)
      const allTimelineEntries: TimelineEntry[] = []
      const sortedSessions = [...sessionRes.sessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      // Only fetch events from recent sessions to avoid excessive IPC calls
      const recentSessions = sortedSessions.slice(0, 5)
      for (const session of recentSessions) {
        try {
          const historyRes = await getSessionHistory({
            sessionId: session.id,
            limit: 20,
          })
          for (const evt of historyRes.events) {
            const entry = eventToTimeline(evt, new Date(evt.timestamp).getTime())
            if (entry) {
              allTimelineEntries.push({
                ...entry,
                // Prefix title with session title for clarity
                title: <>{entry.title}</>,
              })
            }
          }
        } catch {
          // Skip sessions whose history fails to load
        }
      }
      // Sort by timestamp descending
      allTimelineEntries.sort((a, b) => b.sortKey - a.sortKey)
      setTimelineEvents(allTimelineEntries.slice(0, 50))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [listSessions, listProviders, getCurrentWorkspace, getSessionHistory])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Derive agent cards from sessions
  const agentCards: AgentCardData[] = useMemo(() => {
    return sessions.map((session) => {
      const adapter = session.agentAdapter
      const status = mapSessionStatus(session.status)
      const provider = providers.find((p) => p.id === session.providerProfileId)
      const modelName = session.modelId ?? provider?.defaultModel ?? adapterLabel(adapter)

      // Compute elapsed time for running sessions
      let elapsed = ''
      if (status === 'running') {
        const ms = Date.now() - new Date(session.updatedAt).getTime()
        const sec = Math.floor(ms / 1000)
        if (sec < 60) elapsed = `${sec}s`
        else if (sec < 3600) elapsed = `${Math.floor(sec / 60)}m ${sec % 60}s`
        else elapsed = `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
      }

      // Format message count
      const msgCount = session.messageCount
      const msgLabel = msgCount > 1000 ? `${(msgCount / 1000).toFixed(1)}K` : String(msgCount)

      return {
        sessionId: session.id,
        icon: adapterIcon(adapter),
        name: session.title || '未命名会话',
        role: `${modelName} · ${chatModeLabel(session.chatMode)}`,
        status,
        stats: [
          ['消息', msgLabel],
          ['模式', chatModeLabel(session.chatMode)],
          ['适配器', adapterLabel(adapter)],
          ...(elapsed ? [['耗时', elapsed] as [string, string]] : []),
        ],
        current: status === 'running'
          ? '处理中...'
          : status === 'idle'
            ? '等待输入'
            : status === 'failed'
              ? '发生错误'
              : '会话完成',
        createdAt: session.createdAt,
        messageCount: session.messageCount,
      }
    })
  }, [sessions, providers])

  // Computed stats
  const runningCount = sessions.filter((s) => s.status === 'running').length
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0)
  const workspaceName = workspace?.name ?? '未打开工作区'

  // Navigate to chat
  const handleOpenSession = useCallback((sessionId: string) => {
    // TODO: set active session ID via global state when session switching is implemented
    setTweak('view', 'chat')
  }, [setTweak])

  // ─── Loading State ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="agents-layout">
        <div className="agents-empty-state">
          <div className="agents-empty-icon"><Icons.Spinner size={24} className="tl-status-running" /></div>
          <div className="agents-empty-title">正在加载 Agent 数据…</div>
          <div className="agents-empty-desc">从本地数据库同步会话列表和事件</div>
        </div>
      </div>
    )
  }

  // ─── Error State ──────────────────────────────────────────────────────
  if (error != null) {
    return (
      <div className="agents-layout">
        <div className="agents-empty-state">
          <div className="agents-empty-icon"><Icons.XCircle size={24} /></div>
          <div className="agents-empty-title">加载失败</div>
          <div className="agents-empty-desc">{error}</div>
          <button className="btn sm" onClick={() => void refresh()}>重试</button>
        </div>
      </div>
    )
  }

  // ─── Empty State ──────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <div className="agents-layout">
        <div className="agents-empty-state">
          <div className="agents-empty-icon"><Icons.Zap size={24} /></div>
          <div className="agents-empty-title">暂无 Agent 会话</div>
          <div className="agents-empty-desc">创建一个新会话开始与 AI Agent 协作</div>
          <button className="btn sm" onClick={() => setTweak('view', 'chat')}>开始对话</button>
        </div>
      </div>
    )
  }

  // ─── Normal State ─────────────────────────────────────────────────────
  return (
    <div className="agents-layout">
      {/* Header */}
      <div className="row agents-run-header">
        <div className="flex1">
          <div className="strong agents-title-lg">Agent 会话总览</div>
          <div className="muted agents-desc">
            {sessions.length} 个会话 · {workspaceName} ·{' '}
            {runningCount > 0
              ? <span className="agents-info">● {runningCount} 个运行中</span>
              : <span>全部空闲</span>
            } · 共 {totalMessages} 条消息
          </div>
        </div>
        <div className="row agents-actions">
          <button className="btn ghost sm" onClick={() => setTweak('view', 'workflows')}>
            <Icons.Map size={12} /> 工作流视图
          </button>
          <button className="btn ghost sm" onClick={() => void refresh()}>
            <Icons.Refresh size={12} /> 刷新
          </button>
          <button className="btn sm" onClick={() => setTweak('view', 'chat')}>
            <Icons.Plus size={12} /> 新会话
          </button>
        </div>
      </div>

      {/* Agent Cards */}
      <div className="agents-row">
        {agentCards.map((agent) => (
          <AgentCard
            key={agent.sessionId}
            {...agent}
            onClick={() => handleOpenSession(agent.sessionId)}
          />
        ))}
      </div>

      {/* Timeline */}
      <div className="timeline">
        <div className="timeline-head">
          <span className="strong timeline-title">活动时间线</span>
          <span className="badge">{timelineEvents.length} 事件</span>
          <div className="flex1" />
        </div>
        <div className="timeline-body scroll">
          {timelineEvents.length === 0 ? (
            <div className="agents-timeline-empty">
              <span className="muted">暂无活动事件</span>
            </div>
          ) : (
            timelineEvents.map((entry, i) => (
              <TLRow key={i} {...entry} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 子组件 ───────────────────────────────────────────────────────────────────

function AgentCard({ icon, name, role, status, stats, current, onClick }: AgentCardData & { onClick: () => void }) {
  const statusMap: Record<AgentStatus, { label: string; cls: string }> = {
    running: { label: '运行中', cls: 'info' },
    done: { label: '已完成', cls: 'success' },
    idle: { label: '空闲', cls: '' },
    failed: { label: '失败', cls: 'danger' },
  }
  return (
    <div
      className={`agent-card ${status === 'running' ? 'running' : ''}`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="agent-head">
        <div className="agent-icon">{icon}</div>
        <div className="info">
          <div className="name">{name}</div>
          <div className="role">{role}</div>
        </div>
        <span className={`badge ${statusMap[status].cls} dot`}>{statusMap[status].label}</span>
      </div>
      <div className="agent-stats">
        {stats.map(([label, val], i) => (
          <div key={i}>
            <div className="label">{label}</div>
            <div className="val">{val}</div>
          </div>
        ))}
      </div>
      <div className={`agent-current ${status === 'idle' ? 'idle' : ''}`}>
        {status === 'running' && <Icons.Spinner size={11} className="tl-status-running" />}
        {status === 'done' && <Icons.Check size={11} className="tl-status-done" />}
        {status === 'idle' && <Icons.Clock size={11} />}
        {status === 'failed' && <Icons.XCircle size={11} />}
        <span className="truncate">{current}</span>
      </div>
    </div>
  )
}

function TLRow({ time, marker, icon, title, meta }: { time: string; marker: string; icon: ReactNode; title: ReactNode; meta?: string | undefined }) {
  return (
    <div className="tl-row">
      <div className="tl-time mono-sm">{time}</div>
      <div className={`tl-marker ${marker}`}>{icon}</div>
      <div className="tl-content">
        <div className="tl-title">{title}</div>
        {meta && <div className="tl-meta">{meta}</div>}
      </div>
    </div>
  )
}
