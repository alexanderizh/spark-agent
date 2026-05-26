/**
 * ChatView — Vibe 模式会话视图（按项目分组的会话列表 + 流式消息 + 右侧 Inspector）
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import {
  Checkpoint,
  ContextWarn,
  ErrorCard,
  FilePermCard,
  HunkDiff,
  MCPPermCard,
  NetPermCard,
  PlanCard,
  QuickActions,
  SandboxNote,
  SubagentCard,
  ToolChooser,
} from '../ChatInteractions'

type Project = { id: string; name: string; path: string; branch?: string; icon: string; color: string; expanded: boolean }
type Session = {
  id: string
  projectId: string
  title: string
  snippet: string
  badge: 'claude' | 'codex' | 'multi'
  time: string
  pinned?: boolean
  status?: 'running' | 'approval'
}

const CHAT_PROJECTS: Project[] = [
  { id: 'spark-agent', name: 'spark-agent', path: '~/work/spark-agent', branch: 'feat/oauth-2.1', icon: 'A', color: '#6366f1', expanded: true },
  { id: 'mcp-gateway', name: 'mcp-gateway', path: '~/work/mcp-gateway', branch: 'main', icon: 'M', color: '#f97316', expanded: true },
  { id: 'spark-storage', name: 'spark-storage', path: '~/work/spark-storage', branch: 'main', icon: 'S', color: '#10b981', expanded: false },
  { id: 'general', name: '通用', path: '无关联项目', icon: '•', color: '#64748b', expanded: true },
]

const CHAT_SESSIONS: Session[] = [
  { id: 's1', projectId: 'spark-agent', title: '重构 auth 模块为 OAuth 2.1', snippet: '正在修改 src/auth/oauth.ts — 实现 PKCE flow…', badge: 'codex', time: '刚刚', pinned: true, status: 'running' },
  { id: 's3', projectId: 'spark-agent', title: '代码功能开发：搜索优化', snippet: 'Planner Agent 已完成，等待审批…', badge: 'multi', time: '1 小时前', status: 'approval' },
  { id: 's7', projectId: 'spark-agent', title: '为团队规则添加 SSO 支持', snippet: '先设计 schema，再做迁移脚本…', badge: 'claude', time: '昨天 16:48' },
  { id: 's8', projectId: 'spark-agent', title: 'README 重写 + 中英双版', snippet: '英文版按 OSS 习惯写，中文版加入快速开始…', badge: 'claude', time: '2 天前' },
  { id: 's5', projectId: 'mcp-gateway', title: 'MCP gateway 性能调优', snippet: '瓶颈在 schema 拉取阶段，加缓存后…', badge: 'claude', time: '5 小时前' },
  { id: 's9', projectId: 'mcp-gateway', title: 'stdio server 进程泄漏排查', snippet: '通过 lsof 发现 socket FD 没释放…', badge: 'codex', time: '昨天' },
  { id: 's6', projectId: 'spark-storage', title: 'SQLite WAL 写入竞态', snippet: '使用 immediate transaction 后解决', badge: 'codex', time: '昨天 21:14' },
  { id: 's2', projectId: 'general', title: '对比 ACP 与 LSP 的事件模型', snippet: 'LSP 强绑定编辑器视角，ACP 更关注 agent…', badge: 'claude', time: '12 分钟前' },
  { id: 's4', projectId: 'general', title: '撰写 v0.2 发布说明', snippet: '已生成中英两个版本，中文版稍偏正式…', badge: 'claude', time: '3 小时前' },
  { id: 's10', projectId: 'general', title: '阅读 OAuth 2.1 draft', snippet: '草案没强制 grace，但社区推荐 7 天…', badge: 'claude', time: '昨天' },
]

export function ChatView() {
  const [active, setActive] = useState('s1')
  const [showInspector, setShowInspector] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    CHAT_PROJECTS.forEach((p) => { m[p.id] = p.expanded })
    return m
  })
  const toggle = (pid: string) => setExpanded((prev) => ({ ...prev, [pid]: !prev[pid] }))

  return (
    <div className="chat-layout">
      <div className="chat-sidebar">
        <div className="chat-sidebar-head">
          <div className="search-input">
            <Icons.Search />
            <input placeholder="搜索会话或项目..." />
          </div>
          <button className="icon-btn" title="新建会话"><Icons.Plus /></button>
        </div>

        <div className="chat-sidebar-projbar">
          <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>工作区</span>
          <span className="flex1" />
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="打开文件夹"><Icons.Folder size={11} /></button>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="新建会话"><Icons.Plus size={11} /></button>
        </div>

        <div className="chat-list scroll">
          {CHAT_PROJECTS.map((proj) => {
            const sessions = CHAT_SESSIONS.filter((s) => s.projectId === proj.id)
            if (sessions.length === 0) return null
            const open = expanded[proj.id]
            return (
              <div key={proj.id} className="proj-group">
                <button className="proj-head" onClick={() => toggle(proj.id)}>
                  <Icons.ChevronDown size={11} className="chev" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                  <span className="proj-avatar" style={{ background: proj.color + '22', color: proj.color, borderColor: proj.color + '40' }}>
                    {proj.id === 'general' ? <Icons.Sparkles size={9} /> : proj.icon}
                  </span>
                  <span className="proj-name">{proj.name}</span>
                  {proj.id !== 'general' && proj.branch && (
                    <span className="proj-branch mono-sm"><Icons.GitBranch size={9} /> {proj.branch}</span>
                  )}
                  <span className="proj-count">{sessions.length}</span>
                </button>
                {proj.id !== 'general' && open && (
                  <div className="proj-path mono-sm truncate" title={proj.path}>{proj.path}</div>
                )}
                {open && sessions.map((s) => (
                  <ChatListItem key={s.id} session={s} active={active} onClick={setActive} />
                ))}
              </div>
            )
          })}

          <button className="proj-add">
            <Icons.Plus size={11} />
            <span>添加项目文件夹…</span>
          </button>
        </div>
      </div>

      <div className="chat-main">
        <ChatTabbar showInspector={showInspector} setShowInspector={setShowInspector} />
        <ChatStream />
        <Composer />
      </div>

      {showInspector && <ChatInspector />}
    </div>
  )
}

function ChatListItem({ session: s, active, onClick }: { session: Session; active: string; onClick: (id: string) => void }) {
  const badges: Record<Session['badge'], ReactNode> = {
    claude: <span className="badge primary">Claude</span>,
    codex: <span className="badge" style={{ color: 'var(--success)', background: 'var(--success-bg)', borderColor: 'transparent' }}>Codex</span>,
    multi: <span className="badge" style={{ color: 'var(--info)', background: 'var(--info-bg)', borderColor: 'transparent' }}>Multi-Agent</span>,
  }
  return (
    <div className={`chat-item proj-session ${active === s.id ? 'active' : ''}`} onClick={() => onClick(s.id)}>
      <div className="chat-item-title">
        {s.pinned && <Icons.Pin size={11} className="faint" />}
        <span className="truncate flex1">{s.title}</span>
      </div>
      <div className="chat-item-snippet">{s.snippet}</div>
      <div className="chat-item-meta">
        {badges[s.badge]}
        {s.status === 'running' && <span className="pulse-dot" />}
        {s.status === 'approval' && <span className="badge warning dot">待审批</span>}
        <span className="chat-item-time">{s.time}</span>
      </div>
    </div>
  )
}

function ChatTabbar({ showInspector, setShowInspector }: { showInspector: boolean; setShowInspector: (v: boolean) => void }) {
  return (
    <div className="chat-tabbar">
      <div className="chat-title-block">
        <span className="badge primary dot">Project · spark-agent</span>
        <span className="chat-title truncate">重构 auth 模块为 OAuth 2.1</span>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn ghost sm"><Icons.Branch size={12} /> 分支</button>
        <button className="btn ghost sm"><Icons.Clock size={12} /> 检查点</button>
        <button className="btn ghost sm"><Icons.Download size={12} /> 导出</button>
        <span className="divider v" style={{ height: 18, margin: '0 2px' }} />
        <button className={`icon-btn ${showInspector ? 'active' : ''}`} onClick={() => setShowInspector(!showInspector)}><Icons.PanelRight /></button>
        <button className="icon-btn"><Icons.More /></button>
      </div>
    </div>
  )
}

function ChatStream() {
  const streamRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
  }, [])
  return (
    <div className="chat-stream" ref={streamRef}>
      <div className="chat-stream-inner">
        <UserMsg>
          帮我把 <code>src/auth</code> 改造为 OAuth 2.1 + PKCE。先读现有实现，给出迁移计划，再做改造。
          注意：保留旧 endpoint 的兼容层至少到 v0.3。
        </UserMsg>

        <AgentMsg name="Codex" model="GPT-5">
          <p>我会按 <strong>读 → 计划 → 改造 → 测试 → 提交</strong> 的顺序处理。先扫描目录并制定 todo。</p>

          <ToolCall name="Read" arg="src/auth/" status="ok">
{`auth/
├── index.ts
├── token.ts          (412 lines)
├── session.ts        (287 lines)
├── providers/
│   ├── google.ts
│   ├── github.ts
│   └── oidc.ts
└── tests/`}
          </ToolCall>

          <PlanCard
            title="实施计划 · 5 步"
            items={[
              { status: 'done', text: '扫描 src/auth/ 现有结构', meta: '✓ 完成' },
              { status: 'done', text: '识别 OAuth 2.0 → 2.1 的破坏性改动', meta: '✓ 完成' },
              { status: 'running', text: '新增 PKCE 工具与改造 token.ts', meta: '进行中' },
              { status: 'pending', text: 'rotating refresh + compat 层' },
              { status: 'pending', text: '更新测试套件与迁移文档' },
            ]}
          />
        </AgentMsg>

        <UserMsg>开始吧。</UserMsg>

        <AgentMsg name="Codex" model="GPT-5">
          <p>先添加 PKCE 工具函数。我需要写入新文件：</p>
          <FilePermCard path="src/auth/pkce.ts" scope="新文件" lines={{ add: 18, del: 0 }} />
        </AgentMsg>

        <Checkpoint num={7} time="14:32:08" label="文件已写入" />

        <AgentMsg name="Codex" model="GPT-5">
          <p>已写入。下面修改 <code>token.ts</code> — 我把改动拆成了 3 个 hunk，你可以逐段审查：</p>
          <HunkDiff
            path="src/auth/token.ts"
            hunks={[
              {
                range: '-1,3 +1,4',
                note: '导入 PKCE 工具',
                adds: 1, dels: 0,
                lines: [
                  { t: 'ctx', n: 1, s: 'import { fetch } from "undici";' },
                  { t: 'ctx', n: 2, s: 'import { AuthError } from "./errors";' },
                  { t: 'add', n: 3, s: 'import { generateVerifier, challengeFor } from "./pkce";' },
                  { t: 'ctx', n: 4, s: '' },
                ],
              },
              {
                range: '-42,7 +43,11',
                note: 'exchange() 强制 PKCE',
                adds: 4, dels: 2,
                lines: [
                  { t: 'ctx', n: 42, s: '  async exchange(opts: ExchangeOpts) {' },
                  { t: 'del', n: 43, s: "    const body = {" },
                  { t: 'del', n: 44, s: "      grant_type: 'authorization_code'," },
                  { t: 'add', n: 43, s: "    if (!opts.verifier)" },
                  { t: 'add', n: 44, s: "      throw new AuthError('PKCE verifier required');" },
                  { t: 'add', n: 45, s: "    const body = {" },
                  { t: 'add', n: 46, s: "      grant_type: 'authorization_code'," },
                  { t: 'add', n: 47, s: "      code_verifier: opts.verifier," },
                  { t: 'ctx', n: 48, s: '      code: opts.code,' },
                ],
              },
              {
                range: '-112,3 +119,5',
                note: 'rotating refresh token + 7 天 grace',
                adds: 3, dels: 1,
                lines: [
                  { t: 'ctx', n: 112, s: '  async refresh(token: string) {' },
                  { t: 'del', n: 113, s: "    // OAuth 2.0: reusable" },
                  { t: 'add', n: 120, s: "    // OAuth 2.1: rotating — old token invalidated on use" },
                  { t: 'add', n: 121, s: "    const res = await this.exchangeRefresh(token);" },
                  { t: 'add', n: 122, s: "    await this.revokePrevious(token, { grace: '7d' });" },
                  { t: 'ctx', n: 123, s: '    return res;' },
                ],
              },
            ]}
          />
        </AgentMsg>

        <UserMsg>第一个和第二个可以，第三个的 7 天写到注释里，让审计能看到。</UserMsg>

        <AgentMsg name="Codex" model="GPT-5">
          <p>好。我需要查一下当前 RFC 草案里推荐的 grace 期限，看是否还是 7 天。</p>
          <NetPermCard
            url="https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/"
            method="GET"
            reason="查询 OAuth 2.1 草案关于 refresh token grace period 的建议"
          />
        </AgentMsg>

        <AgentMsg name="Codex" model="GPT-5">
          <p>草案没强制 grace 期限，团队 SOP 是 7 天。下一步我需要决定如何运行测试套件 — 项目里同时存在 vitest 和 jest 配置：</p>
          <ToolChooser
            title="选择测试运行器"
            options={[
              { id: 'vitest', icon: <Icons.Beaker />, name: 'pnpm test (vitest)', hint: '推荐 · 已在项目规则中标为默认' },
              { id: 'jest', icon: <Icons.Beaker />, name: 'pnpm jest', hint: '保留以兼容 legacy 测试目录' },
              { id: 'both', icon: <Icons.Layers />, name: '两者都跑', hint: '约 +2 分钟，覆盖更全' },
            ]}
          />
        </AgentMsg>

        <AgentMsg name="Codex" model="GPT-5">
          <SubagentCard
            name="researcher-1"
            role="Claude Haiku 4.5"
            task="收集 OAuth 2.1 兼容性测试用例"
            status="running"
            tokens="3,247"
          />
          <p>同时我开始运行测试：</p>
          <MCPPermCard
            server="filesystem"
            tool="execute_bash"
            params={{
              command: 'pnpm test src/auth/ --run',
              cwd: '/Users/hayden/work/spark-agent',
              timeout_ms: 60000,
            }}
          />
        </AgentMsg>

        <AgentMsg name="Codex" model="GPT-5" status="running">
          <TerminalBlock>
            <span style={{ color: '#22c55e' }}>$</span> pnpm test src/auth/ --run{'\n'}
            <span className="dim">{'  '}vitest 1.4.0  fast mode</span>{'\n'}
            {'\n'}
            <span style={{ color: '#60a5fa' }}>✓</span> auth/token.test.ts (12){'\n'}
            <span style={{ color: '#60a5fa' }}>✓</span> auth/session.test.ts (8){'\n'}
            <span style={{ color: '#60a5fa' }}>✓</span> auth/pkce.test.ts (6){'\n'}
            <span style={{ color: '#ef4444' }}>✗</span> auth/providers/oidc.test.ts (1 failed){'\n'}
          </TerminalBlock>

          <ErrorCard
            message="测试失败 · auth/providers/oidc.test.ts"
            detail={`FAIL  src/auth/providers/oidc.test.ts > "uses PKCE on authorization URL"
  AuthError: PKCE verifier required (RFC 9700)
      at TokenService.exchange (src/auth/token.ts:44:13)
      at oidc.test.ts:48:24`}
            suggestions={[
              '在 OIDC provider 的测试 fixture 里补一个 verifier',
              '或者把 token.exchange 改成在缺失时自动生成 ephemeral verifier（不推荐）',
            ]}
          />

          <SandboxNote>
            该测试需要写入 <code className="mono-sm">tests/fixtures/</code> — 在工作区边界内，已自动批准。
          </SandboxNote>
        </AgentMsg>

        <AgentMsg name="Codex" model="GPT-5">
          <p>已修复 fixture，所有测试通过。下面是你可以做的：</p>
          <QuickActions
            actions={[
              { icon: <Icons.GitBranch />, label: '生成 commit' },
              { icon: <Icons.Upload />, label: 'push & 开 PR' },
              { icon: <Icons.Eye />, label: '差异回顾' },
              { icon: <Icons.File />, label: '生成迁移文档' },
              { icon: <Icons.Beaker />, label: '再跑一次完整测试' },
            ]}
          />
          <ContextWarn used={186420} total={200000} />
        </AgentMsg>
      </div>
    </div>
  )
}

function UserMsg({ children }: { children: ReactNode }) {
  return (
    <div className="msg user">
      <div className="msg-avatar">H</div>
      <div className="msg-body">
        <div className="msg-name">你</div>
        <div className="msg-content"><p>{children}</p></div>
      </div>
    </div>
  )
}

function AgentMsg({ name, model, status, children }: { name: string; model: string; status?: 'running'; children: ReactNode }) {
  return (
    <div className="msg agent">
      <div className="msg-avatar"><Icons.Sparkles size={14} /></div>
      <div className="msg-body">
        <div className="msg-name">
          {name}
          <span className="badge">{model}</span>
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

function ToolCall({ name, arg, status, children }: { name: string; arg: string; status?: 'ok'; children: ReactNode }) {
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
        <Icons.ChevronRight size={12} className="chev" />
      </div>
      {open && <div className="tool-call-body">{children}</div>}
    </div>
  )
}

function TerminalBlock({ children }: { children: ReactNode }) {
  return <div className="terminal mono-sm">{children}</div>
}

function Composer() {
  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className="composer">
          <div className="composer-context">
            <span className="context-chip"><Icons.File /> src/auth/token.ts <span className="x">×</span></span>
            <span className="context-chip"><Icons.File /> src/auth/session.ts <span className="x">×</span></span>
            <span className="context-chip"><Icons.Folder /> docs/oauth.md <span className="x">×</span></span>
            <span className="context-chip add"><Icons.Plus size={11} /> 添加文件</span>
          </div>
          <textarea rows={2} placeholder="询问、修改、运行任务…  / 输入命令  · @ 引用文件" defaultValue="" />
          <div className="composer-actions">
            <button className="icon-btn" title="添加文件"><Icons.Plus /></button>
            <button className="icon-btn" title="工具"><Icons.Wrench /></button>
            <button className="icon-btn" title="Skill"><Icons.Skills /></button>
            <span className="model-pill">
              <Icons.Sparkles size={12} style={{ color: 'var(--primary)' }} />
              Codex · GPT-5
              <Icons.ChevronDown size={11} className="chev" />
            </span>
            <span className="model-pill" title="沙箱等级">
              <Icons.Shield size={12} />
              L2
              <Icons.ChevronDown size={11} className="chev" />
            </span>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="faint" style={{ fontSize: 11 }}>
              <span className="kbd">⌘</span> <span className="kbd">↵</span> 发送
            </span>
            <button className="btn primary sm" style={{ height: 28, paddingInline: 14 }}>
              <Icons.Send size={12} /> 发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatInspector() {
  return (
    <div className="inspector scroll">
      <div className="inspector-section">
        <h4>会话 <span className="link">编辑</span></h4>
        <div className="kv-row"><span className="k">模型</span><span className="v">Codex · GPT-5</span></div>
        <div className="kv-row"><span className="k">角色</span><span className="v">Coder</span></div>
        <div className="kv-row"><span className="k">沙箱</span><span className="v">L2 · 写入需审批</span></div>
        <div className="kv-row"><span className="k">检查点</span><span className="v">7</span></div>
      </div>

      <div className="inspector-section">
        <h4>用量</h4>
        <div className="kv-row"><span className="k">输入 token</span><span className="v">38.4K</span></div>
        <div className="kv-row"><span className="k">输出 token</span><span className="v">12.7K</span></div>
        <div className="kv-row"><span className="k">工具调用</span><span className="v">14</span></div>
        <div className="kv-row"><span className="k">成本</span><span className="v">$0.86</span></div>
        <div className="kv-row"><span className="k">耗时</span><span className="v">4分 22秒</span></div>
      </div>

      <div className="inspector-section">
        <h4>启用工具 <span className="link">配置</span></h4>
        <div style={{ marginTop: -4 }}>
          <span className="tool-chip"><Icons.File /> Read</span>
          <span className="tool-chip"><Icons.Edit /> Edit</span>
          <span className="tool-chip"><Icons.Terminal /> Bash</span>
          <span className="tool-chip"><Icons.Search /> Grep</span>
          <span className="tool-chip"><Icons.Search /> Glob</span>
          <span className="tool-chip"><Icons.GitBranch /> Git</span>
          <span className="tool-chip"><Icons.MCP /> github</span>
          <span className="tool-chip"><Icons.MCP /> filesystem</span>
        </div>
      </div>

      <div className="inspector-section">
        <h4>生效规则 <span className="link">预览</span></h4>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="rule-pill"><span className="rule-scope">SYS</span><span>安全策略：禁止 rm -rf /</span></div>
          <div className="rule-pill"><span className="rule-scope">USER</span><span>偏好简洁回答与中文注释</span></div>
          <div className="rule-pill"><span className="rule-scope">PROJ</span><span>spark-agent · 风格指南</span></div>
          <div className="rule-pill"><span className="rule-scope">PROJ</span><span>测试用 vitest，禁用 jest</span></div>
          <div className="rule-pill"><span className="rule-scope">SESS</span><span>OAuth 2.1 兼容旧 endpoint 到 v0.3</span></div>
        </div>
      </div>

      <div className="inspector-section">
        <h4>上下文 <span className="link">管理</span></h4>
        <div className="kv-row"><span className="k">已加载文件</span><span className="v">3</span></div>
        <div className="kv-row"><span className="k">上下文窗口</span><span className="v">38.4K / 200K</span></div>
        <div style={{ height: 4, background: 'var(--bg-soft)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
          <div style={{ width: '19%', height: '100%', background: 'var(--primary)' }} />
        </div>
      </div>
    </div>
  )
}
