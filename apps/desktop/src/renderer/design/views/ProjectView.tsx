/**
 * ProjectView — Workspace 模式（IDE 风格：文件树 + Tab + Diff + 右侧 Agent 对话）
 */
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

export function ProjectView() {
  return (
    <div className="project-layout">
      <ProjectExplorer />
      <div className="project-center">
        <ProjectTabs />
        <div className="flex1" style={{ display: 'flex', minHeight: 0 }}>
          <div className="flex1" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border)' }}>
            <ProjectDiffPane />
          </div>
          <div style={{ width: 380, display: 'flex', flexDirection: 'column' }}>
            <ProjectAgentPane />
          </div>
        </div>
        <ProjectBottomBar />
      </div>
    </div>
  )
}

function ProjectExplorer() {
  return (
    <div className="project-explorer">
      <div className="explorer-head">
        <Icons.Folder size={14} />
        <span>spark-agent</span>
        <span className="badge dot" style={{ color: 'var(--info)' }}>main</span>
      </div>
      <div className="row" style={{ padding: '6px 10px', gap: 4, borderBottom: '1px solid var(--divider)' }}>
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Plus size={12} /></button>
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Refresh size={12} /></button>
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.ChevronDown size={12} /></button>
        <div className="flex1" />
        <button className="icon-btn" style={{ width: 24, height: 24 }}><Icons.Search size={12} /></button>
      </div>
      <div className="tree scroll">
        <TreeRow depth={0} expanded folder name="apps" />
        <TreeRow depth={1} expanded folder name="desktop" />
        <TreeRow depth={2} folder name="src" />
        <TreeRow depth={0} expanded folder name="packages" />
        <TreeRow depth={1} expanded folder name="agent-runtime" />
        <TreeRow depth={2} expanded folder name="src" />
        <TreeRow depth={3} expanded folder name="adapters" />
        <TreeRow depth={4} ext="ts" name="claude.ts" status="M" />
        <TreeRow depth={4} ext="ts" name="codex.ts" />
        <TreeRow depth={3} ext="ts" name="index.ts" />
        <TreeRow depth={1} folder expanded name="auth" />
        <TreeRow depth={2} ext="ts" name="index.ts" />
        <TreeRow depth={2} ext="ts" name="token.ts" status="M" active />
        <TreeRow depth={2} ext="ts" name="session.ts" status="M" />
        <TreeRow depth={2} ext="ts" name="pkce.ts" status="A" />
        <TreeRow depth={2} folder name="providers" />
        <TreeRow depth={2} folder name="tests" />
        <TreeRow depth={1} folder name="protocol" />
        <TreeRow depth={1} folder name="rule-engine" />
        <TreeRow depth={1} folder name="storage" />
        <TreeRow depth={0} expanded folder name="docs" />
        <TreeRow depth={1} ext="md" name="desktop-agent-development-guide.md" />
        <TreeRow depth={1} ext="md" name="oauth.md" status="M" />
        <TreeRow depth={0} ext="md" name="README.md" />
        <TreeRow depth={0} ext="json" name="package.json" />
        <TreeRow depth={0} ext="md" name="AGENTS.md" />
        <TreeRow depth={0} folder name=".spark" />
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

function ProjectAgentPane() {
  return (
    <>
      <div className="row" style={{ padding: '8px var(--pad-md)', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', gap: 8 }}>
        <Icons.Bot size={14} style={{ color: 'var(--primary)' }} />
        <span className="strong" style={{ fontSize: 'var(--font-sm)' }}>Codex Agent</span>
        <span className="badge info dot">运行中</span>
        <div className="flex1" />
        <button className="icon-btn"><Icons.Pause size={12} /></button>
        <button className="icon-btn"><Icons.Stop size={12} /></button>
      </div>
      <div className="chat-stream" style={{ flex: 1, padding: '14px 0', background: 'var(--bg)' }}>
        <div className="chat-stream-inner" style={{ padding: '0 var(--pad-md)', gap: 14 }}>
          <MiniMsg user>
            把 <code>token.ts</code> 的 refresh 改成 rotating，并加 7 天 grace。
          </MiniMsg>
          <MiniMsg>
            好的。先看 <code>token.ts</code> 的 refresh 实现…
            <MiniTool name="Read" arg="src/auth/token.ts L100-150" />
            找到 <code>refresh()</code>。OAuth 2.0 的 refresh token 是长期复用，我会引入轮换：旧 token 在新 token 签发时失效，但保留 7 天 grace 写入到 <code>compat/legacy.ts</code>。
            <MiniTool name="Edit" arg="src/auth/token.ts" />
            <MiniTool name="Write" arg="src/auth/compat/oauth2-legacy.ts (new)" />
            完成。等待你审查 diff。
          </MiniMsg>
          <MiniMsg user>
            还要加测试。
          </MiniMsg>
          <MiniMsg status="running">
            正在添加 <code>token.refresh.test.ts</code>…
          </MiniMsg>
        </div>
      </div>
      <div className="composer-wrap" style={{ padding: '10px 12px 12px' }}>
        <div className="composer">
          <textarea rows={2} placeholder="给 Agent 发消息…" />
          <div className="composer-actions">
            <button className="icon-btn"><Icons.Plus /></button>
            <button className="icon-btn"><Icons.Wrench /></button>
            <div className="flex1" />
            <button className="btn primary sm"><Icons.Send size={11} /></button>
          </div>
        </div>
      </div>
    </>
  )
}

function MiniMsg({ user, status, children }: { user?: boolean; status?: 'running'; children: ReactNode }) {
  return (
    <div className="msg" style={{ gap: 8 }}>
      <div className="msg-avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
        {user ? 'H' : <Icons.Sparkles size={11} />}
      </div>
      <div className="msg-body">
        <div className="msg-name" style={{ fontSize: 11, marginBottom: 4 }}>
          {user ? '你' : 'Codex'}
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

function MiniTool({ name, arg }: { name: string; arg: string }) {
  const icon: Record<string, ReactNode> = {
    Read: <Icons.File />,
    Edit: <Icons.Edit />,
    Write: <Icons.File />,
    Bash: <Icons.Terminal />,
    Grep: <Icons.Search />,
  }
  return (
    <div style={{ margin: '6px 0', padding: '5px 8px', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{icon[name]}</span>
      <span className="mono-sm strong" style={{ fontSize: 11 }}>{name}</span>
      <span className="mono-sm muted truncate" style={{ fontSize: 11 }}>{arg}</span>
      <Icons.Check size={11} style={{ color: 'var(--success)', marginLeft: 'auto' }} />
    </div>
  )
}

function ProjectBottomBar() {
  return (
    <div className="project-bottombar">
      <div className="seg"><Icons.GitBranch size={11} /> feat/oauth-2.1</div>
      <div className="seg"><Icons.Edit size={11} /> 5 个文件已修改</div>
      <div className="seg"><span className="dot-indicator green" /> Claude · Codex 就绪</div>
      <div className="seg right"><Icons.Cpu size={11} /> 沙箱 L2</div>
      <div className="seg"><Icons.Database size={11} /> 索引 100%</div>
      <div className="seg mono-sm">UTF-8</div>
      <div className="seg mono-sm">TypeScript</div>
      <div className="seg mono-sm">Ln 47, Col 18</div>
    </div>
  )
}
