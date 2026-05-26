/**
 * WorkflowView — DAG 编辑器（React Flow 风格）
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'

type NodeKind = 'input' | 'agent' | 'approval' | 'review' | 'artifact' | 'tool'
type NodeStatus = 'done' | 'running' | 'pending' | 'failed'

type WFNodeData = {
  id: string
  x: number
  y: number
  kind: NodeKind
  title: string
  status: NodeStatus
  model?: string
  tokens?: string
  time?: string
  desc?: string
  meta?: string
}

type WorkflowMeta = {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  nodes: number
  createdAt: string
}

const WORKFLOWS_KEY = 'spark-workflows'

const NODES: WFNodeData[] = [
  { id: 'n1', x: 40, y: 80, kind: 'input', title: '需求输入', status: 'done', desc: '解析用户需求文档' },
  { id: 'n2', x: 280, y: 80, kind: 'agent', title: 'Planner Agent', status: 'done', model: 'Claude Sonnet 4.5', tokens: '12.4K', time: '32s' },
  { id: 'n3', x: 520, y: 20, kind: 'agent', title: 'Reviewer · 计划', status: 'done', model: 'Claude Opus 4', tokens: '5.1K', time: '14s' },
  { id: 'n4', x: 520, y: 180, kind: 'approval', title: '人工审批', status: 'done', meta: 'Hayden · 已批准' },
  { id: 'n5', x: 760, y: 80, kind: 'agent', title: 'Coder Agent', status: 'running', model: 'Codex GPT-5', tokens: '48.2K', time: '2m 12s' },
  { id: 'n6', x: 760, y: 280, kind: 'agent', title: 'Test Agent', status: 'pending', model: 'Codex GPT-5-mini' },
  { id: 'n7', x: 1000, y: 80, kind: 'review', title: 'Review · 代码', status: 'pending', model: 'Claude Opus 4' },
  { id: 'n8', x: 1000, y: 280, kind: 'artifact', title: '交付报告', status: 'pending' },
]

const EDGES = [
  { from: 'n1', to: 'n2' },
  { from: 'n2', to: 'n3' },
  { from: 'n2', to: 'n4' },
  { from: 'n3', to: 'n5' },
  { from: 'n4', to: 'n5', active: true },
  { from: 'n5', to: 'n6' },
  { from: 'n5', to: 'n7', active: true },
  { from: 'n6', to: 'n8' },
  { from: 'n7', to: 'n8' },
]

export function WorkflowView() {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([])
  const [activeWf, setActiveWf] = useState<string | null>(null)

  useEffect(() => {
    const raw = window.localStorage.getItem(WORKFLOWS_KEY)
    if (raw === null) return
    try {
      const saved = JSON.parse(raw) as WorkflowMeta[]
      setWorkflows(saved)
    } catch {
      setWorkflows([])
    }
  }, [])

  const persistWorkflows = (next: WorkflowMeta[]) => {
    setWorkflows(next)
    window.localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(next))
  }

  const handleCreateWorkflow = () => {
    const workflow: WorkflowMeta = {
      id: `workflow:${Date.now()}`,
      name: `工作流 ${workflows.length + 1}`,
      status: 'draft',
      nodes: NODES.length,
      createdAt: new Date().toISOString(),
    }
    persistWorkflows([workflow, ...workflows])
    setActiveWf(workflow.id)
  }

  if (activeWf === null) {
    return (
      <div className="workflow-layout">
        <WorkflowToolbar />

        <div className="wf-empty-state">
          <div className="empty-state">
            <div className="empty-icon">
              <Icons.Layers size={24} />
            </div>
            <div className="empty-title">工作流编排</div>
            <div className="empty-desc">创建多 Agent 协作流程，定义任务依赖和审批节点。</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={handleCreateWorkflow}>
                <Icons.Plus size={12} /> 创建工作流
              </button>
            </div>
          </div>

          {workflows.length > 0 && (
            <div className="wf-list">
              {workflows.map((workflow) => (
                <div key={workflow.id} className="wf-list-item">
                  <div className="wf-list-icon">
                    <Icons.Layers size={14} />
                  </div>
                  <div className="wf-list-body">
                    <div className="wf-list-name">{workflow.name}</div>
                    <div className="wf-list-meta">
                      <span>{workflow.nodes} 个节点</span>
                      <span className="wf-list-dot" />
                      <span className={`wf-list-status status-${workflow.status}`}>{workflow.status}</span>
                      <span className="wf-list-dot" />
                      <span>{new Date(workflow.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button className="btn ghost sm" onClick={() => setActiveWf(workflow.id)}>打开</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return <WorkflowEditor workflow={workflows.find((workflow) => workflow.id === activeWf) ?? null} onBack={() => setActiveWf(null)} />
}

function WorkflowToolbar() {
  return (
    <div className="wf-toolbar-side">
      <button className="icon-btn active"><Icons.Command /></button>
      <button className="icon-btn"><Icons.Bot /></button>
      <button className="icon-btn"><Icons.Wrench /></button>
      <button className="icon-btn"><Icons.Shield /></button>
      <button className="icon-btn"><Icons.Branch /></button>
      <button className="icon-btn"><Icons.Layers /></button>
      <button className="icon-btn"><Icons.Terminal /></button>
      <div style={{ flex: 1 }} />
      <button className="icon-btn"><Icons.Beaker /></button>
    </div>
  )
}

function WorkflowEditor({ workflow, onBack }: { workflow: WorkflowMeta | null; onBack: () => void }) {
  const [selected, setSelected] = useState('n4')

  return (
    <div className="workflow-layout">
      <WorkflowToolbar />

      <div className="wf-canvas">
        <div style={{ position: 'absolute', left: 18, top: 14, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn ghost sm" onClick={onBack}><Icons.ChevronLeft size={11} /> 返回</button>
          <span className="badge primary dot">{workflow?.name ?? '未命名工作流'}</span>
        </div>

        <svg className="wf-edges">
          {EDGES.map((e, i) => {
            const a = NODES.find((n) => n.id === e.from)!
            const b = NODES.find((n) => n.id === e.to)!
            const x1 = a.x + 220
            const y1 = a.y + 36
            const x2 = b.x
            const y2 = b.y + 36
            const mx = (x1 + x2) / 2
            return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} className={e.active ? 'active' : ''} />
          })}
        </svg>

        {NODES.map((n) => (
          <WFNode key={n.id} node={n} selected={selected === n.id} onClick={() => setSelected(n.id)} />
        ))}

        <div className="wf-zoom">
          <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.Plus size={12} /></button>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 6px', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>72%</span>
          <button className="icon-btn" style={{ width: 22, height: 22 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
          </button>
          <button className="icon-btn" style={{ width: 22, height: 22 }}><Icons.Map size={12} /></button>
        </div>
        <div className="wf-mini">
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--text-faint)' }}>缩略图</div>
          <div style={{ position: 'absolute', inset: '18px 8px 8px 8px', background: 'var(--bg-soft)', borderRadius: 4, border: '1px solid var(--border)' }}>
            <svg viewBox="0 0 800 400" style={{ width: '100%', height: '100%' }}>
              {NODES.map((n) => (
                <rect key={n.id} x={n.x * 0.5} y={(n.y - 30) * 0.55 + 20} width={120} height={36} rx={4}
                  fill={n.status === 'done' ? '#10b981' : n.status === 'running' ? '#3b82f6' : '#94a3b8'} opacity={0.7} />
              ))}
              <rect x={50} y={120} width={500} height={140} rx={4} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="4" />
            </svg>
          </div>
        </div>
      </div>

      <WFInspector node={(NODES.find((n) => n.id === selected) ?? NODES[0])!} />
    </div>
  )
}

function WFNode({ node, selected, onClick }: { node: WFNodeData; selected: boolean; onClick: () => void }) {
  const kindMeta: Record<NodeKind, { icon: ReactNode; color: string }> = {
    input: { icon: <Icons.Hash />, color: 'var(--text-muted)' },
    agent: { icon: <Icons.Bot />, color: 'var(--primary)' },
    approval: { icon: <Icons.Shield />, color: 'var(--warning)' },
    review: { icon: <Icons.Eye />, color: 'var(--info)' },
    artifact: { icon: <Icons.File />, color: 'var(--success)' },
    tool: { icon: <Icons.Wrench />, color: 'var(--text-muted)' },
  }
  const m = kindMeta[node.kind]
  const stat: Record<NodeStatus, { label: string; cls: string }> = {
    done: { label: '完成', cls: 'success' },
    running: { label: '运行中', cls: 'info' },
    pending: { label: '等待', cls: '' },
    failed: { label: '失败', cls: 'danger' },
  }
  const s = stat[node.status]

  return (
    <div
      className={`wf-node ${selected ? 'selected' : ''} ${node.status === 'running' ? 'running' : ''}`}
      style={{ left: node.x, top: node.y }}
      onClick={onClick}
    >
      <span className="wf-port in" />
      <span className="wf-port out" />
      <div className="wf-node-head">
        <div className="wf-node-icon" style={{ background: `${m.color}1f`, color: m.color }}>{m.icon}</div>
        <div className="wf-node-title">{node.title}</div>
        <span className={`badge ${s.cls} dot`} style={{ fontSize: 9.5, height: 16, padding: '0 5px' }}>{s.label}</span>
      </div>
      <div className="wf-node-meta">
        {node.model && <span>{node.model}</span>}
        {node.desc && <span>{node.desc}</span>}
        {node.meta && <span>{node.meta}</span>}
      </div>
      {(node.tokens || node.time) && (
        <div className="wf-node-foot">
          {node.tokens && <span>{node.tokens} tokens</span>}
          {node.time && <span>· {node.time}</span>}
          {node.status === 'running' && <Icons.Spinner size={11} style={{ marginLeft: 'auto', color: 'var(--info)' }} />}
        </div>
      )}
    </div>
  )
}

function WFInspector({ node }: { node: WFNodeData }) {
  return (
    <div className="wf-inspector">
      <div className="wf-insp-head">
        <div className="wf-insp-icon"><Icons.Bot /></div>
        <div className="flex1">
          <div className="strong" style={{ fontSize: 'var(--font-base)' }}>{node?.title || '节点'}</div>
          <div className="muted" style={{ fontSize: 11 }}>Agent 节点 · 角色 Coder</div>
        </div>
        <button className="icon-btn"><Icons.More /></button>
      </div>

      <div className="wf-insp-body scroll">
        <div className="field">
          <label>名称</label>
          <input defaultValue="Coder Agent" />
        </div>

        <div className="field">
          <label>角色</label>
          <div className="seg-control">
            <button>Planner</button>
            <button className="active">Coder</button>
            <button>Reviewer</button>
            <button>Tester</button>
          </div>
        </div>

        <div className="field">
          <label>模型 Profile</label>
          <div className="control">
            <span className="control grow" style={{ padding: '0 10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', height: 32, alignItems: 'center', display: 'flex', gap: 8 }}>
              <Icons.Sparkles size={12} style={{ color: 'var(--primary)' }} />
              <span className="strong" style={{ fontSize: 'var(--font-sm)' }}>Codex · GPT-5</span>
              <span className="faint mono-sm">200K · $5/1M</span>
              <Icons.ChevronDown size={12} style={{ marginLeft: 'auto', color: 'var(--text-faint)' }} />
            </span>
          </div>
        </div>

        <div className="field">
          <label>Fallback</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="tool-chip">Claude Opus 4</span>
            <span className="tool-chip">GPT-5-mini</span>
            <span className="tool-chip" style={{ borderStyle: 'dashed' }}>+ 添加</span>
          </div>
        </div>

        <div className="field">
          <label>规则附加</label>
          <textarea rows={3} defaultValue={'Always:\n- 修改前先读相关测试\n- 优先小步提交，必要时拆 PR'} />
        </div>

        <div className="field">
          <label>启用工具</label>
          <div style={{ margin: '-2px 0' }}>
            <span className="tool-chip"><Icons.File /> Read</span>
            <span className="tool-chip"><Icons.Edit /> Edit</span>
            <span className="tool-chip"><Icons.Terminal /> Bash</span>
            <span className="tool-chip"><Icons.Search /> Grep</span>
            <span className="tool-chip"><Icons.GitBranch /> Git</span>
            <span className="tool-chip"><Icons.MCP /> filesystem</span>
          </div>
        </div>

        <div className="field">
          <label>权限策略</label>
          <div className="seg-control" style={{ width: '100%' }}>
            <button>询问</button>
            <button>允许</button>
            <button className="active">会话内</button>
            <button>项目内</button>
          </div>
        </div>

        <div className="field">
          <label>失败策略</label>
          <div className="row" style={{ gap: 8 }}>
            <span className="seg-control">
              <button>停止</button>
              <button className="active">重试 ×3</button>
              <button>转人工</button>
            </span>
          </div>
        </div>

        <div className="field">
          <label>当前运行</label>
          <div style={{ padding: '10px 12px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="kv-row" style={{ padding: 0 }}><span className="k">Token</span><span className="v mono-sm">48,247 / 200K</span></div>
            <div className="kv-row" style={{ padding: 0 }}><span className="k">耗时</span><span className="v mono-sm">2m 12s</span></div>
            <div className="kv-row" style={{ padding: 0 }}><span className="k">工具调用</span><span className="v mono-sm">7</span></div>
            <div className="kv-row" style={{ padding: 0 }}><span className="k">当前动作</span><span className="v truncate mono-sm" style={{ fontSize: 11, maxWidth: 140 }}>Edit src/auth/token.ts</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
