/**
 * ChatInteractions — 富会话内交互卡片集合
 *
 * 包含权限请求（文件/网络/MCP）、计划卡、Hunk 级 diff 审查、检查点、错误卡、
 * 子 Agent、工具选择器、上下文警告、沙箱提示等。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from './Icons'

export function FilePermCard({ path, scope, lines, onAllow, onDeny }: {
  path: string; scope: string; lines: { add: number; del: number }
  onAllow?: () => void; onDeny?: () => void
}) {
  return (
    <div className="chat-card">
      <div className="chat-card-h warn">
        <span className="ico"><Icons.Edit /></span>
        <span>请求写入文件</span>
        <span className="badge" style={{ marginLeft: 'auto', fontSize: 10 }}>{scope}</span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">路径</span>
          <span className="v"><code>{path}</code></span>
          <span className="k">变更</span>
          <span className="v">新增 {lines.add} 行 · 删除 {lines.del} 行</span>
          <span className="k">在工作区内</span>
          <span className="v" style={{ color: 'var(--success)' }}>✓ spark-agent 项目内</span>
          <span className="k">备份策略</span>
          <span className="v">写入前快照到 .spark/checkpoints/</span>
        </div>
      </div>
      <div className="chat-card-foot">
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>下次此类请求</span>
        <span className="seg-control" style={{ height: 22 }}>
          <button className="active" style={{ height: 18, fontSize: 10.5 }}>询问</button>
          <button style={{ height: 18, fontSize: 10.5 }}>会话内</button>
          <button style={{ height: 18, fontSize: 10.5 }}>项目内</button>
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={onDeny}>拒绝</button>
        <button className="btn sm primary" onClick={onAllow}><Icons.Check size={11} /> 允许写入</button>
      </div>
    </div>
  )
}

export function NetPermCard({ url, method, reason, onAllow, onDeny }: {
  url: string; method: string; reason: string
  onAllow?: () => void; onDeny?: () => void
}) {
  return (
    <div className="chat-card">
      <div className="chat-card-h info">
        <span className="ico"><Icons.Globe /></span>
        <span>请求网络访问</span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">URL</span>
          <span className="v"><code>{method} {url}</code></span>
          <span className="k">目的</span>
          <span className="v">{reason}</span>
          <span className="k">域名</span>
          <span className="v"><span className="badge success dot" style={{ fontSize: 10 }}>已知 · npmjs.com</span></span>
          <span className="k">凭据</span>
          <span className="v" style={{ color: 'var(--text-muted)' }}>无 · 公开端点</span>
        </div>
      </div>
      <div className="chat-card-foot">
        <span className="spacer" />
        <button className="btn sm" onClick={onDeny}>拒绝</button>
        <button className="btn sm primary" onClick={onAllow}><Icons.Check size={11} /> 本会话内允许 npmjs.com</button>
      </div>
    </div>
  )
}

export function MCPPermCard({ server, tool, params, onAllow, onDeny }: {
  server: string; tool: string; params: unknown
  onAllow?: () => void; onDeny?: () => void
}) {
  return (
    <div className="chat-card">
      <div className="chat-card-h">
        <span className="ico"><Icons.MCP /></span>
        <span>调用 MCP 工具</span>
        <span className="mono-sm" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {server} · {tool}
        </span>
      </div>
      <div className="chat-card-body">
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>参数</div>
        <pre className="mono-sm" style={{ margin: 0, padding: '10px 12px', background: 'var(--code-bg)', borderRadius: 6, fontSize: 11.5, lineHeight: 1.5, overflow: 'auto', color: 'var(--code-fg)' }}>
{JSON.stringify(params, null, 2)}
        </pre>
      </div>
      <div className="chat-card-foot">
        <span className="row" style={{ fontSize: 11, color: 'var(--text-muted)', gap: 6 }}>
          <Icons.Shield size={11} /> 来源: User 范围 · 已签名
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={onDeny}>拒绝</button>
        <button className="btn sm" onClick={onAllow}>仅本次</button>
        <button className="btn sm primary" onClick={onAllow}>允许并记住</button>
      </div>
    </div>
  )
}

type Hunk = {
  range: string
  note: string
  adds: number
  dels: number
  lines: { t: 'add' | 'del' | 'ctx' | 'hunk'; n: number | string; s: string }[]
}

export function HunkDiff({ path, hunks, onAcceptAll, onHunkAction }: {
  path: string; hunks: Hunk[]
  onAcceptAll?: () => void; onHunkAction?: (index: number, action: 'accepted' | 'rejected') => void
}) {
  const [states, setStates] = useState<('pending' | 'accepted' | 'rejected')[]>(hunks.map(() => 'pending'))
  const acceptedCount = states.filter((s) => s === 'accepted').length

  const setOne = (i: number, v: 'pending' | 'accepted' | 'rejected') => {
    const ns = [...states]
    ns[i] = v
    setStates(ns)
    if (v === 'accepted' || v === 'rejected') {
      onHunkAction?.(i, v)
    }
  }

  const acceptRemaining = () => {
    const ns = states.map((s) => s === 'pending' ? 'accepted' as const : s)
    setStates(ns)
    onAcceptAll?.()
  }

  return (
    <div className="diff hunk-mode">
      <div className="diff-head">
        <Icons.File size={12} className="faint" />
        <span className="diff-path">{path}</span>
        <span className="badge" style={{ fontSize: 10, marginLeft: 8 }}>逐 hunk 审查</span>
        <span className="diff-stats">
          <span className="add">+{hunks.reduce((s, h) => s + h.adds, 0)}</span>
          <span className="del">−{hunks.reduce((s, h) => s + h.dels, 0)}</span>
        </span>
        <button className="btn ghost sm" style={{ height: 22, padding: '0 8px', fontSize: 11 }}>
          {acceptedCount}/{hunks.length} 已采纳
        </button>
        <button className="btn sm primary" style={{ height: 24, padding: '0 10px', fontSize: 11 }} onClick={acceptRemaining}>
          <Icons.Check size={11} /> 接受剩余
        </button>
      </div>
      {hunks.map((h, i) => (
        <div key={i} className={`hunk-wrap ${states[i]}`}>
          <div className="hunk-bar">
            <span className="label">@@ {h.range} @@</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.note}</span>
            <div className="hunk-actions">
              {states[i] === 'pending' && (
                <>
                  <button className="btn ghost" onClick={() => setOne(i, 'rejected')}><Icons.X size={11} /> 拒绝</button>
                  <button className="btn primary" onClick={() => setOne(i, 'accepted')}><Icons.Check size={11} /> 采纳</button>
                </>
              )}
              {states[i] === 'accepted' && <span className="badge success" style={{ fontSize: 10 }}>已采纳</span>}
              {states[i] === 'rejected' && <span className="badge danger" style={{ fontSize: 10 }}>已拒绝</span>}
            </div>
          </div>
          <div className="diff-body" style={{ maxHeight: 200, padding: '4px 0' }}>
            {h.lines.map((l, j) => (
              <div key={j} className={`diff-line ${l.t}`}>
                <span className="ln">{l.n || ''}</span>
                <span className="code">{l.s}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

type PlanItem = { status: 'done' | 'running' | 'pending'; text: string; meta?: string }
export function PlanCard({ title, items }: { title: string; items: PlanItem[] }) {
  const done = items.filter((it) => it.status === 'done').length
  return (
    <div className="plan-card">
      <div className="plan-h">
        <Icons.Beaker size={13} />
        <span>{title}</span>
        <span className="progress">{done}/{items.length} 已完成</span>
      </div>
      <div className="plan-list">
        {items.map((it, i) => (
          <div key={i} className={`plan-item ${it.status}`}>
            <span className="check">{it.status === 'done' && <Icons.Check />}</span>
            <span className="text">{it.text}</span>
            {it.meta && <span className="meta">{it.meta}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Checkpoint({ num, time, label, files }: { num: number; time: string; label?: string; files?: string[] }) {
  const visibleFiles = files?.slice(0, 4) ?? []
  const remaining = Math.max(0, (files?.length ?? 0) - visibleFiles.length)
  return (
    <div className="checkpoint">
      <span className="line" />
      <span className="pill">
        <Icons.Branch size={11} />
        <span>{label || '检查点'}</span>
        <span className="num">#{num} · {time}</span>
        {visibleFiles.length > 0 && (
          <span className="checkpoint-files" title={files?.join('\n')}>
            {visibleFiles.map((file) => (
              <span className="checkpoint-file" key={file}>{file}</span>
            ))}
            {remaining > 0 && <span className="checkpoint-file">+{remaining}</span>}
          </span>
        )}
        <span className="actions">
          <span className="icon-btn" title="回滚到此处"><Icons.Refresh /></span>
          <span className="icon-btn" title="从此处分叉"><Icons.Branch /></span>
        </span>
      </span>
      <span className="line" />
    </div>
  )
}

export function QuickActions({ actions }: { actions: { icon: ReactNode; label: string }[] }) {
  return (
    <div className="quick-actions">
      {actions.map((a, i) => (
        <button key={i} className="chip">{a.icon}{a.label}</button>
      ))}
    </div>
  )
}

export function ErrorCard({ message, detail, suggestions }: { message: string; detail?: string; suggestions?: string[] }) {
  return (
    <div className="error-card">
      <div className="e-h"><Icons.XCircle size={14} /> {message}</div>
      {detail && <pre>{detail}</pre>}
      {suggestions && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>建议操作</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text)' }}>
            {suggestions.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
          </ul>
        </div>
      )}
      <div className="e-actions">
        <button className="btn sm"><Icons.Refresh size={11} /> 重试</button>
        <button className="btn sm"><Icons.Edit size={11} /> 修改提示</button>
        <button className="btn sm">跳过此步</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost sm"><Icons.Copy size={11} /> 复制日志</button>
      </div>
    </div>
  )
}

export function SubagentCard({ name, role, task, status, tokens }: { name: string; role: string; task: string; status: 'running' | 'done'; tokens: string }) {
  return (
    <div className="subagent-card">
      <span className="ico"><Icons.Bot size={14} /></span>
      <div className="body">
        <div className="title">派生子 Agent · {name}</div>
        <div className="meta">{role} · {task}</div>
      </div>
      {status === 'running' && (
        <span className="live">
          <Icons.Spinner size={11} />
          运行中 · {tokens} tokens
        </span>
      )}
      {status === 'done' && (
        <span className="live" style={{ color: 'var(--success)' }}>
          <Icons.Check size={11} />
          完成 · {tokens} tokens
        </span>
      )}
    </div>
  )
}

type ChoiceOption = { id: string; icon: ReactNode; name: string; hint: string }
export function ToolChooser({ title, options }: { title: string; options: ChoiceOption[] }) {
  const [sel, setSel] = useState(options[0]?.id)
  return (
    <div className="chat-card">
      <div className="chat-card-h">
        <span className="ico"><Icons.Wrench /></span>
        <span>{title}</span>
      </div>
      <div className="chat-card-body" style={{ padding: 0 }}>
        <div className="tool-choose">
          {options.map((o) => (
            <div key={o.id} className={`choice ${sel === o.id ? 'selected' : ''}`} onClick={() => setSel(o.id)}>
              <span className="ico">{o.icon}</span>
              <div className="body">
                <div className="name">{o.name}</div>
                <div className="hint">{o.hint}</div>
              </div>
              <span className="radio" />
            </div>
          ))}
        </div>
      </div>
      <div className="chat-card-foot">
        <span className="muted" style={{ fontSize: 11 }}>
          Agent 选择: <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{options.find((o) => o.id === sel)?.name}</strong>
        </span>
        <span className="spacer" />
        <button className="btn sm">取消</button>
        <button className="btn sm primary">使用此工具</button>
      </div>
    </div>
  )
}

export function ContextWarn({ used, total }: { used: number; total: number }) {
  const pct = Math.round((used / total) * 100)
  return (
    <div className="context-warn">
      <span className="ico"><Icons.AlertTriangle size={16} /></span>
      <div className="body">
        <div className="title">上下文窗口接近上限 · {pct}%</div>
        <div className="meta">已使用 {used.toLocaleString()} / {total.toLocaleString()} tokens · 建议压缩或开启自动总结</div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm">压缩</button>
        <button className="btn sm primary">自动总结</button>
      </div>
    </div>
  )
}

export function SandboxNote({ children }: { children: ReactNode }) {
  return (
    <div className="sys-note">
      <Icons.Shield />
      <span>{children}</span>
    </div>
  )
}
