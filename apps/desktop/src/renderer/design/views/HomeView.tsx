/**
 * HomeView — 工作台首页（真实 IPC 驱动）
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import type { ProviderProfile, SessionListResponse, WorkspaceInfo } from '@spark/protocol'
import { useApp } from '../AppContext'

type SessionSummary = SessionListResponse['sessions'][number]

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

export function HomeView() {
  const { setTweak } = useApp()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: createSession } = useIpcInvoke('session:create')
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [sessionRes, providerRes, workspaceRes] = await Promise.all([
        listSessions({ limit: 6 }),
        listProviders({}),
        getCurrentWorkspace({}),
      ])
      setSessions(sessionRes.sessions)
      setProviders(providerRes.profiles)
      setWorkspace(workspaceRes.workspace)
      setNotice(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [getCurrentWorkspace, listProviders, listSessions])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const handleOpenProject = useCallback(async () => {
    try {
      const selected = await openDirectory({ title: '选择工作区目录' })
      if (selected.canceled || selected.filePath === undefined) {
        return
      }
      const result = await openWorkspace({ rootPath: selected.filePath })
      setWorkspace(result.workspace)
      setNotice(null)
      setTweak('view', 'chat')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [openDirectory, openWorkspace, setTweak])

  const handleNewChat = useCallback(async () => {
    const provider = providers.find((item) => item.isDefault) ?? providers[0]
    if (provider === undefined) {
      setNotice('请先在设置中配置 Provider')
      setTweak('view', 'providers')
      return
    }

    try {
      await createSession({
        providerProfileId: provider.id,
        ...(workspace == null ? {} : { workspaceId: workspace.id }),
      })
      await refresh()
      setTweak('view', 'chat')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }, [createSession, providers, refresh, setTweak, workspace])

  const runningCount = sessions.filter((session) => session.status === 'running').length

  return (
    <div className="home">
      <div className="home-hero">
        <div>
          <h1>你好，欢迎使用 SparkWork</h1>
          <p>
            {loading
              ? '正在同步本地工作台状态…'
              : `${sessions.length} 个会话 · ${providers.length} 个 Provider · ${workspace == null ? '未打开工作区' : workspace.name}`}
          </p>
        </div>
        <div className="home-status-card">
          <Stat label="会话数" value={String(sessions.length)} />
          <Stat label="Provider" value={String(providers.length)} color="var(--info)" />
          <Stat label="运行中" value={String(runningCount)} color="var(--info)" />
          <Stat label="工作区" value={workspace == null ? '未打开' : '已打开'} size={11} />
        </div>
      </div>

      {notice !== null && (
        <div className="card home-warning-card">
          {notice}
        </div>
      )}

      <div className="home-quickstart">
        <QSCard icon={<Icons.Chat />} title="新建聊天" desc="开始一次通用研究、写作或问答会话" onClick={handleNewChat} />
        <QSCard icon={<Icons.Folder />} title="打开项目" desc="加载工作区，启用文件与终端工具" onClick={handleOpenProject} />
        <QSCard icon={<Icons.Workflow />} title="运行工作流" desc="启动 DAG 编排的多 Agent 任务" onClick={() => setTweak('view', 'workflows')} />
        <QSCard icon={<Icons.MCP />} title="连接器与 MCP" desc="连接第三方平台或接入工具服务" onClick={() => setTweak('view', 'mcp')} />
        <QSCard icon={<Icons.Skills />} title="创建 Skill" desc="封装可复用的 Agent 能力包" onClick={() => setTweak('view', 'skill-store')} />
      </div>

      <div className="home-grid">
        <div>
          <div className="section-h">
            最近会话 <span className="count">{sessions.length}</span>
            <span className="link" onClick={() => setTweak('view', 'chat')}>全部</span>
          </div>
          <div className="card">
            {loading ? (
              <EmptyCompact icon={<Icons.Chat />} title="正在加载会话…" />
            ) : sessions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><Icons.Chat /></div>
                <div className="empty-title">暂无会话</div>
                <div className="empty-desc">开始一次新的 AI 对话，探索研究、写作或问答</div>
                <div className="empty-actions">
                  <button className="empty-action-btn" onClick={handleNewChat}>
                    <Icons.Chat /> 新建聊天
                  </button>
                </div>
              </div>
            ) : (
              <div className="list">
                {sessions.map(s => (
                  <SessionItem
                    key={s.id}
                    title={s.title ?? '未命名会话'}
                    time={formatRelTime(s.updatedAt)}
                    messageCount={s.messageCount}
                    status={s.status}
                    onClick={() => setTweak('view', 'chat')}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-h">
            Provider 状态
            <span className="link" onClick={() => { setTweak('view', 'providers') }}>设置</span>
          </div>
          <div className="card">
            <div className="card-body home-card-body-sm">
              {providers.length === 0 ? (
                <EmptyCompact
                  icon={<Icons.Settings />}
                  title="未配置 Provider"
                  desc="配置至少一个 AI Provider 才能开始使用"
                  actionLabel="前往设置"
                  onAction={() => { setTweak('view', 'providers') }}
                />
              ) : (
                <div className="health-list">
                  {providers.map(p => (
                    <HealthRow key={p.id} name={p.name} provider={p.provider} defaultModel={p.defaultModel} isDefault={p.isDefault} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

function Stat({ label, value, color, size }: { label: string; value: string; color?: string; size?: number }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color, fontSize: size }}>{value} {/* dynamic */}</div>
    </div>
  )
}

function QSCard({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick?: () => void }) {
  return (
    <div className={`qs-card ${onClick ? 'qs-card-default' : ''}`} onClick={onClick}>
      <div className="qs-icon">{icon}</div>
      <div className="qs-title">{title}</div>
      <div className="qs-desc">{desc}</div>
    </div>
  )
}

function SessionItem({
  title,
  time,
  messageCount,
  status,
  onClick,
}: {
  title: string
  time: string
  messageCount: number
  status: 'idle' | 'running' | 'error'
  onClick: () => void
}) {
  return (
    <div className="list-item session-item session-item-default" onClick={onClick}>
      <div className="session-icon"><Icons.Chat /></div>
      <div className="session-body">
        <div className="session-title truncate">{title}</div>
        <div className="session-meta"><span>{messageCount} 条消息</span></div>
      </div>
      {status === 'running' && <span className="badge info dot">运行中</span>}
      {status === 'error' && <span className="badge danger dot">错误</span>}
      <div className="session-time">{time}</div>
    </div>
  )
}

function HealthRow({ name, provider, defaultModel, isDefault }: { name: string; provider: string; defaultModel: string; isDefault: boolean }) {
  const initial = (name[0] ?? provider[0] ?? '?').toUpperCase()
  return (
    <div className="health-row">
      <div className="provider-logo provider-logo-sm">{initial}</div>
      <div>
        <div className="health-name">{name}</div>
        <div className="muted default-model">{defaultModel}</div>
      </div>
      <div className="health-meta">
        {isDefault && <span className="badge primary dot">默认</span>}
        <span className="badge success dot">已配置</span>
      </div>
    </div>
  )
}

function EmptyCompact({
  icon,
  title,
  desc,
  actionLabel,
  onAction,
}: {
  icon: ReactNode
  title: string
  desc?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-compact">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {desc !== undefined && <div className="empty-desc">{desc}</div>}
      {actionLabel !== undefined && onAction !== undefined && (
        <span className="link" onClick={onAction}>{actionLabel}</span>
      )}
    </div>
  )
}
