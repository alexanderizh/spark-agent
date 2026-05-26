/**
 * HomeView — 工作台首页
 */
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

export function HomeView() {
  return (
    <div className="home">
      <div className="home-hero">
        <div>
          <h1>下午好，Hayden</h1>
          <p>3 个任务正在运行 · 2 个等待审批 · Claude Sonnet 4.5 · Codex GPT-5 已就绪</p>
        </div>
        <div className="home-status-card">
          <Stat label="今日 Token" value="142.8" unit="K" />
          <Stat label="成本" value="$3.47" />
          <Stat label="运行任务" value="3" color="var(--info)" />
          <Stat label="沙箱" value="L2 受控" size={13} />
        </div>
      </div>

      <div className="home-quickstart">
        <QSCard icon={<Icons.Chat />} title="新建聊天" desc="开始一次通用研究、写作或问答会话" />
        <QSCard icon={<Icons.Folder />} title="打开项目" desc="加载工作区，启用文件与终端工具" />
        <QSCard icon={<Icons.Workflow />} title="运行工作流" desc="启动 DAG 编排的多 Agent 任务" />
        <QSCard icon={<Icons.MCP />} title="连接 MCP" desc="接入新的工具服务或数据源" />
        <QSCard icon={<Icons.Skills />} title="创建 Skill" desc="封装可复用的 Agent 能力包" />
      </div>

      <div className="home-grid">
        <div>
          <div className="section-h">
            最近会话 <span className="count">12</span>
            <span className="link">全部</span>
          </div>
          <div className="card">
            <div className="list">
              <SessionItem kind="project" title="重构 auth 模块为 OAuth 2.1" project="spark-agent" agent="Codex · GPT-5" time="刚刚" status="running" />
              <SessionItem kind="chat" title="对比 ACP 与 LSP 的事件模型" agent="Claude · Sonnet 4.5" time="12 分钟前" />
              <SessionItem kind="workflow" title="代码功能开发流程：搜索优化" agent="Multi-agent · 5 节点" time="1 小时前" status="approval" />
              <SessionItem kind="project" title="修复 SQLite WAL 写入竞态" project="spark-storage" agent="Codex · GPT-5" time="2 小时前" status="completed" />
              <SessionItem kind="chat" title="撰写 v0.2 发布说明" agent="Claude · Sonnet 4.5" time="昨天" />
              <SessionItem kind="project" title="MCP gateway 性能调优" project="mcp-gateway" agent="Claude · Opus 4" time="2 天前" status="failed" />
            </div>
          </div>
        </div>

        <div>
          <div className="section-h">
            Provider 状态
            <span className="link">设置</span>
          </div>
          <div className="card">
            <div className="card-body" style={{ padding: '4px 16px 12px' }}>
              <div className="health-list">
                <HealthRow logo="A" name="Anthropic · Claude Agent SDK" status="ok" detail="3 个 profile · 延迟 312ms" />
                <HealthRow logo="O" name="OpenAI · Codex SDK" status="ok" detail="CLI v0.4.1 · 已登录" />
                <HealthRow logo="O" name="OpenAI · Responses API" status="ok" detail="GPT-5, GPT-5-mini" />
                <HealthRow logo="L" name="Ollama Local" status="warning" detail="未启动" />
                <HealthRow logo="B" name="AWS Bedrock" status="off" detail="未配置" />
              </div>
            </div>
          </div>

          <div className="section-h" style={{ marginTop: 20 }}>
            正在运行
            <span className="count">3</span>
          </div>
          <div className="card">
            <div className="card-body" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <RunningItem name="重构 auth 模块为 OAuth 2.1" step="Coder Agent → 编辑 src/auth/oauth.ts" elapsed="2:34" progress={62} />
              <RunningItem name="索引大型 monorepo" step="Indexer · 扫描中…" elapsed="0:58" progress={28} />
              <RunningItem name="API 回归测试套件" step="Test Agent · pytest -q" elapsed="4:11" progress={84} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, unit, color, size }: { label: string; value: string; unit?: string; color?: string; size?: number }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color, fontSize: size }}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  )
}

function QSCard({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="qs-card">
      <div className="qs-icon">{icon}</div>
      <div className="qs-title">{title}</div>
      <div className="qs-desc">{desc}</div>
    </div>
  )
}

function SessionItem({
  kind,
  title,
  project,
  agent,
  time,
  status,
}: {
  kind: 'chat' | 'project' | 'workflow'
  title: string
  project?: string
  agent: string
  time: string
  status?: 'running' | 'completed' | 'failed' | 'approval'
}) {
  const icons: Record<typeof kind, ReactNode> = {
    chat: <Icons.Chat />,
    project: <Icons.Folder />,
    workflow: <Icons.Workflow />,
  }
  const statusBadge: Record<NonNullable<typeof status>, ReactNode> = {
    running: <span className="badge info dot">运行中</span>,
    completed: <span className="badge success dot">已完成</span>,
    failed: <span className="badge danger dot">失败</span>,
    approval: <span className="badge warning dot">待审批</span>,
  }
  return (
    <div className="list-item session-item">
      <div className="session-icon">{icons[kind]}</div>
      <div className="session-body">
        <div className="session-title truncate">{title}</div>
        <div className="session-meta">
          {project && <><span>{project}</span><span className="faint">·</span></>}
          <span>{agent}</span>
        </div>
      </div>
      {status && statusBadge[status]}
      <div className="session-time">{time}</div>
    </div>
  )
}

function HealthRow({ logo, name, status, detail }: { logo: string; name: string; status: 'ok' | 'warning' | 'off'; detail: string }) {
  return (
    <div className="health-row">
      <div className="provider-logo" style={{ width: 24, height: 24, fontSize: 11 }}>{logo}</div>
      <div>
        <div className="health-name">{name}</div>
      </div>
      <div className="health-meta">
        <span className="muted">{detail}</span>
        {status === 'ok' && <span className="badge success dot">在线</span>}
        {status === 'warning' && <span className="badge warning dot">需注意</span>}
        {status === 'off' && <span className="badge dot">未启用</span>}
      </div>
    </div>
  )
}

function RunningItem({ name, step, elapsed, progress }: { name: string; step: string; elapsed: string; progress: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="pulse-dot" />
        <div className="flex1 truncate" style={{ fontSize: 'var(--font-sm)', fontWeight: 600 }}>{name}</div>
        <span className="mono-sm faint">{elapsed}</span>
      </div>
      <div className="muted" style={{ fontSize: 'var(--font-xs)', paddingLeft: 14 }}>{step}</div>
      <div style={{ height: 3, background: 'var(--bg-soft)', borderRadius: 2, overflow: 'hidden', marginLeft: 14 }}>
        <div style={{ width: `${progress}%`, height: '100%', background: 'var(--info)', borderRadius: 2 }} />
      </div>
    </div>
  )
}
