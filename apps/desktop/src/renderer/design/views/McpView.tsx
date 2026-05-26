/**
 * McpView — MCP 服务器列表
 */
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

type ServerStatus = 'ok' | 'warn' | 'err' | 'off'

type Server = {
  logo: string
  name: string
  scope: string
  desc: string
  tools: number
  transport: string
  status: ServerStatus
  latency?: string
  detail?: string
}

const SERVERS: Server[] = [
  { logo: 'GH', name: 'github', scope: 'User', desc: '官方 GitHub MCP — 仓库、PR、Issue、Actions 操作', tools: 24, transport: 'stdio', status: 'ok', latency: '128ms' },
  { logo: 'F', name: 'filesystem', scope: 'System', desc: '本地文件系统访问，受 workspace 边界约束', tools: 8, transport: 'stdio', status: 'ok', latency: '12ms' },
  { logo: 'N', name: 'notion', scope: 'User', desc: '读写 Notion 页面、数据库、评论', tools: 12, transport: 'http', status: 'ok', latency: '241ms' },
  { logo: 'L', name: 'linear', scope: 'Team', desc: '团队任务管理：issue、cycle、project', tools: 9, transport: 'http', status: 'ok', latency: '184ms' },
  { logo: 'S', name: 'slack', scope: 'User', desc: '频道、消息、文件、提醒', tools: 7, transport: 'http', status: 'warn', detail: '认证已过期' },
  { logo: 'P', name: 'postgres-prod', scope: 'Project', desc: '生产数据库只读连接（受权限策略限制）', tools: 4, transport: 'stdio', status: 'off', detail: '未启用' },
  { logo: 'B', name: 'browser', scope: 'System', desc: '受控浏览器 — 截图、表单、抓取', tools: 6, transport: 'stdio', status: 'ok', latency: '85ms' },
  { logo: 'D', name: 'docker', scope: 'User', desc: '容器、镜像、compose 操作', tools: 14, transport: 'stdio', status: 'ok', latency: '23ms' },
  { logo: 'AW', name: 'aws-tools', scope: 'Team', desc: 'S3 / Lambda / CloudWatch 查询与调用', tools: 32, transport: 'http', status: 'err', detail: '连接超时 (3次)' },
]

export function McpView() {
  return (
    <div className="page">
      <div className="row" style={{ gap: 12, marginBottom: 18 }}>
        <div className="flex1">
          <div className="strong" style={{ fontSize: 18 }}>MCP 服务器</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>9 个服务器 · 116 个工具 · 全部启用时上下文 ~24K tokens</div>
        </div>
        <div className="search-input"><Icons.Search /><input placeholder="搜索服务器或工具..." /></div>
        <button className="btn"><Icons.Refresh size={12} /> 全部重连</button>
        <button className="btn primary"><Icons.Plus size={12} /> 添加 MCP</button>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <span className="badge primary dot">全部 9</span>
        <span className="badge success dot">在线 6</span>
        <span className="badge warning dot">需注意 1</span>
        <span className="badge danger dot">错误 1</span>
        <span className="badge">未启用 1</span>
        <div className="flex1" />
        <div className="seg-control">
          <button className="active">所有作用域</button>
          <button>System</button>
          <button>User</button>
          <button>Project</button>
          <button>Team</button>
        </div>
      </div>

      <div className="mcp-grid">
        {SERVERS.map((s) => <MCPCard key={s.name} server={s} />)}
      </div>
    </div>
  )
}

function MCPCard({ server }: { server: Server }) {
  const statMap: Record<ServerStatus, { dot: ReactNode; label?: string }> = {
    ok: { dot: <span className="dot-indicator green" />, ...(server.latency !== undefined && { label: server.latency }) },
    warn: { dot: <span className="dot-indicator yellow" />, ...(server.detail !== undefined && { label: server.detail }) },
    err: { dot: <span className="dot-indicator red" />, ...(server.detail !== undefined && { label: server.detail }) },
    off: { dot: <span className="dot-indicator" />, ...(server.detail !== undefined && { label: server.detail }) },
  }
  const stat = statMap[server.status]
  return (
    <div className="mcp-card">
      <div className="mcp-card-h">
        <div className="mcp-card-icon">{server.logo}</div>
        <div className="mcp-card-meta">
          <div className="row" style={{ gap: 6 }}>
            <span className="name">{server.name}</span>
            <span className="badge" style={{ fontSize: 10 }}>{server.scope}</span>
          </div>
          <div className="scope">{server.transport} · {server.tools} tools</div>
        </div>
        <div className={`switch ${server.status !== 'off' ? 'on' : ''}`} />
      </div>
      <div className="mcp-card-desc">{server.desc}</div>
      <div className="mcp-card-foot">
        {stat.dot}
        <span className="muted truncate" style={{ fontSize: 11 }}>{stat.label}</span>
        <span className="badge" style={{ marginLeft: 'auto' }}><Icons.Wrench size={10} /> {server.tools}</span>
      </div>
    </div>
  )
}
