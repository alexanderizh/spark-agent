import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { CODING_AGENT_TOOLS } from '../data/available-tools'
import type {
  McpServerItem,
  ProviderProfile,
  RuleItem,
  SessionPermissionMode,
  SkillItem,
  WorkflowGraph,
  WorkflowItem,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowStatus,
} from '@spark/protocol'

type DragState = { nodeId: string; dx: number; dy: number } | null

const NODE_KINDS: Array<{ kind: WorkflowNodeKind; label: string; icon: ReactNode }> = [
  { kind: 'input', label: '输入', icon: <Icons.Hash size={13} /> },
  { kind: 'agent', label: 'Agent', icon: <Icons.Bot size={13} /> },
  { kind: 'skill', label: 'Skill', icon: <Icons.Skills size={13} /> },
  { kind: 'tool', label: '工具', icon: <Icons.Wrench size={13} /> },
  { kind: 'mcp', label: 'MCP', icon: <Icons.MCP size={13} /> },
  { kind: 'approval', label: '审批', icon: <Icons.Shield size={13} /> },
  { kind: 'review', label: '复核', icon: <Icons.Eye size={13} /> },
  { kind: 'artifact', label: '产物', icon: <Icons.File size={13} /> },
]

export function WorkflowView() {
  const { toast } = useToast()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [rules, setRules] = useState<RuleItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorkflowItem | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [loading, setLoading] = useState(true)

  const { invoke: listWorkflows } = useIpcInvoke('workflow:list')
  const { invoke: createWorkflow } = useIpcInvoke('workflow:create')
  const { invoke: updateWorkflow } = useIpcInvoke('workflow:update')
  const { invoke: deleteWorkflow } = useIpcInvoke('workflow:delete')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { invoke: listMcp } = useIpcInvoke('mcp:list')
  const { invoke: listRules } = useIpcInvoke('rules:list')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [workflowRes, providerRes, skillRes, mcpRes, ruleRes] = await Promise.all([
        listWorkflows({ includeArchived: true }),
        listProviders({}),
        listSkills({}),
        listMcp({}),
        listRules({}),
      ])
      setWorkflows(workflowRes.workflows)
      setProviders(providerRes.profiles)
      setSkills(skillRes.skills)
      setMcpServers(mcpRes.servers)
      setRules(ruleRes.rules)
      const active = workflowRes.workflows.find((item) => item.id === activeId) ?? workflowRes.workflows[0]
      if (active != null) {
        setActiveId(active.id)
        setDraft(active)
        setSelectedNodeId(active.graph.nodes[0]?.id ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [activeId, listMcp, listProviders, listRules, listSkills, listWorkflows])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectedNode = draft?.graph.nodes.find((node) => node.id === selectedNodeId) ?? null
  const modelOptions = useMemo(
    () => Array.from(new Set(providers.flatMap((provider) => provider.modelIds.length ? provider.modelIds : [provider.defaultModel]).filter(Boolean))),
    [providers],
  )

  const patchDraft = (patch: Partial<WorkflowItem>) => {
    setDraft((prev) => (prev == null ? prev : { ...prev, ...patch }))
  }

  const patchGraph = (updater: (graph: WorkflowGraph) => WorkflowGraph) => {
    setDraft((prev) => (prev == null ? prev : { ...prev, graph: updater(prev.graph) }))
  }

  const selectWorkflow = (workflow: WorkflowItem) => {
    setActiveId(workflow.id)
    setDraft(workflow)
    setSelectedNodeId(workflow.graph.nodes[0]?.id ?? null)
    setConnectFrom(null)
  }

  const createNewWorkflow = async () => {
    const workflow = (await createWorkflow({
      name: `工作流 ${workflows.length + 1}`,
      description: '自定义 Agent 执行流程',
      status: 'draft',
    })).workflow
    toast.success('工作流已创建')
    setActiveId(workflow.id)
    setDraft(workflow)
    setSelectedNodeId(workflow.graph.nodes[0]?.id ?? null)
    await refresh()
  }

  const saveWorkflow = async () => {
    if (draft == null) return
    const saved = (await updateWorkflow({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      status: draft.status,
      tags: draft.tags,
      graph: draft.graph,
    })).workflow
    toast.success('工作流已保存')
    setDraft(saved)
    setActiveId(saved.id)
    await refresh()
  }

  const removeWorkflow = async () => {
    if (draft == null) return
    const res = await deleteWorkflow({ id: draft.id })
    if (res.deleted) {
      toast.success('工作流已删除')
      setActiveId(null)
      setDraft(null)
      await refresh()
    }
  }

  const addNode = (kind: WorkflowNodeKind) => {
    const id = `${kind}-${Date.now().toString(36)}`
    const node: WorkflowNode = {
      id,
      kind,
      title: NODE_KINDS.find((item) => item.kind === kind)?.label ?? '节点',
      x: 120 + (draft?.graph.nodes.length ?? 0) * 28,
      y: 120 + (draft?.graph.nodes.length ?? 0) * 18,
      config: { prompt: defaultPromptForKind(kind), retryCount: 1 },
    }
    patchGraph((graph) => ({ ...graph, nodes: [...graph.nodes, node] }))
    setSelectedNodeId(id)
  }

  const removeNode = (nodeId: string) => {
    patchGraph((graph) => ({
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    }))
    setSelectedNodeId(null)
  }

  const handleNodeClick = (nodeId: string) => {
    if (connectFrom != null && connectFrom !== nodeId) {
      const edgeId = `${connectFrom}-${nodeId}`
      patchGraph((graph) => {
        if (graph.edges.some((edge) => edge.from === connectFrom && edge.to === nodeId)) return graph
        return { ...graph, edges: [...graph.edges, { id: edgeId, from: connectFrom, to: nodeId }] }
      })
      setConnectFrom(null)
      return
    }
    setSelectedNodeId(nodeId)
  }

  const startDrag = (event: ReactPointerEvent, node: WorkflowNode) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect == null) return
    setDrag({ nodeId: node.id, dx: event.clientX - rect.left - node.x, dy: event.clientY - rect.top - node.y })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: ReactPointerEvent) => {
    if (drag == null) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect == null) return
    const x = Math.max(24, Math.min(1320, event.clientX - rect.left - drag.dx))
    const y = Math.max(24, Math.min(760, event.clientY - rect.top - drag.dy))
    patchGraph((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === drag.nodeId ? { ...node, x, y } : node),
    }))
  }

  const endDrag = (event: ReactPointerEvent) => {
    if (drag != null) event.currentTarget.releasePointerCapture(event.pointerId)
    setDrag(null)
  }

  return (
    <div className="workflow-layout workflow-builder">
      <aside className="workflow-list-panel">
        <div className="workflow-list-head">
          <div>
            <div className="agents-title-lg">Workflows</div>
            <div className="agents-desc">拖动节点并连接，定义 Agent 的优先执行流程。</div>
          </div>
          <button className="icon-btn" title="新建工作流" onClick={() => void createNewWorkflow()}>
            <Icons.Plus size={14} />
          </button>
        </div>
        <div className="wf-list">
          {workflows.map((workflow) => (
            <button
              key={workflow.id}
              className={`wf-list-item wf-list-button ${workflow.id === activeId ? 'active' : ''}`}
              onClick={() => selectWorkflow(workflow)}
            >
              <span className="wf-list-icon"><Icons.Workflow size={14} /></span>
              <span className="wf-list-body">
                <span className="wf-list-name">{workflow.name}</span>
                <span className="wf-list-meta">
                  {workflow.graph.nodes.length} 节点 · {workflow.status}
                </span>
              </span>
            </button>
          ))}
          {!loading && workflows.length === 0 && <div className="agents-empty-mini">暂无工作流</div>}
        </div>
      </aside>

      {draft == null ? (
        <div className="wf-empty-state">
          <div className="empty-state">
            <div className="empty-icon"><Icons.Workflow size={24} /></div>
            <div className="empty-title">创建第一个工作流</div>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => void createNewWorkflow()}>
                <Icons.Plus size={12} /> 创建工作流
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="wf-canvas" ref={canvasRef} onPointerMove={moveDrag} onPointerUp={endDrag}>
            <div className="wf-canvas-controls">
              <input className="wf-title-input" value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} />
              <select value={draft.status} onChange={(event) => patchDraft({ status: event.target.value as WorkflowStatus })}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
              <button className="btn ghost sm" onClick={() => setConnectFrom(selectedNodeId)}>
                <Icons.Branch size={12} /> {connectFrom ? '选择目标节点' : '连接'}
              </button>
              <button className="btn ghost sm danger" onClick={() => void removeWorkflow()}>
                <Icons.Trash size={12} /> 删除
              </button>
              <button className="btn primary sm" onClick={() => void saveWorkflow()}>
                <Icons.Check size={12} /> 保存
              </button>
            </div>

            <div className="wf-node-palette">
              {NODE_KINDS.map((item) => (
                <button key={item.kind} className="tool-chip" onClick={() => addNode(item.kind)}>
                  {item.icon} {item.label}
                </button>
              ))}
            </div>

            <svg className="wf-edges">
              {draft.graph.edges.map((edge) => {
                const from = draft.graph.nodes.find((node) => node.id === edge.from)
                const to = draft.graph.nodes.find((node) => node.id === edge.to)
                if (from == null || to == null) return null
                const x1 = from.x + 220
                const y1 = from.y + 42
                const x2 = to.x
                const y2 = to.y + 42
                const mx = (x1 + x2) / 2
                return (
                  <path
                    key={edge.id}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    className={connectFrom === edge.from ? 'active' : ''}
                  />
                )
              })}
            </svg>

            {draft.graph.nodes.map((node) => (
              <WorkflowNodeCard
                key={node.id}
                node={node}
                selected={node.id === selectedNodeId}
                connecting={node.id === connectFrom}
                onClick={() => handleNodeClick(node.id)}
                onPointerDown={(event) => startDrag(event, node)}
              />
            ))}
          </div>

          <WorkflowInspector
            node={selectedNode}
            providers={providers}
            modelOptions={modelOptions}
            skills={skills}
            rules={rules}
            mcpServers={mcpServers}
            onDelete={() => selectedNodeId != null && removeNode(selectedNodeId)}
            onPatch={(patch) => {
              if (selectedNodeId == null) return
              patchGraph((graph) => ({
                ...graph,
                nodes: graph.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } : node),
              }))
            }}
            onPatchConfig={(patch) => {
              if (selectedNodeId == null) return
              patchGraph((graph) => ({
                ...graph,
                nodes: graph.nodes.map((node) =>
                  node.id === selectedNodeId ? { ...node, config: { ...node.config, ...patch } } : node,
                ),
              }))
            }}
          />
        </>
      )}
    </div>
  )
}

function WorkflowNodeCard({
  node,
  selected,
  connecting,
  onClick,
  onPointerDown,
}: {
  node: WorkflowNode
  selected: boolean
  connecting: boolean
  onClick: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const meta = NODE_KINDS.find((item) => item.kind === node.kind) ?? NODE_KINDS[1]
  return (
    <div
      className={`wf-node ${selected ? 'selected' : ''} ${connecting ? 'running' : ''}`}
      style={{ left: node.x, top: node.y }}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      <span className="wf-port in" />
      <span className="wf-port out" />
      <div className="wf-node-head">
        <div className="wf-node-icon">{meta?.icon}</div>
        <div className="wf-node-title">{node.title}</div>
        <span className="badge wf-badge-sm">{meta?.label}</span>
      </div>
      <div className="wf-node-meta">
        <span>{node.config.modelId ? String(node.config.modelId) : node.config.role ? String(node.config.role) : '默认配置'}</span>
      </div>
      {typeof node.config.prompt === 'string' && node.config.prompt.trim().length > 0 && (
        <div className="wf-node-foot">{node.config.prompt.slice(0, 42)}</div>
      )}
    </div>
  )
}

function WorkflowInspector({
  node,
  providers,
  modelOptions,
  skills,
  rules,
  mcpServers,
  onPatch,
  onPatchConfig,
  onDelete,
}: {
  node: WorkflowNode | null
  providers: ProviderProfile[]
  modelOptions: string[]
  skills: SkillItem[]
  rules: RuleItem[]
  mcpServers: McpServerItem[]
  onPatch: (patch: Partial<WorkflowNode>) => void
  onPatchConfig: (patch: WorkflowNode['config']) => void
  onDelete: () => void
}) {
  if (node == null) {
    return (
      <div className="wf-inspector">
        <div className="wf-insp-body"><div className="agents-empty-mini">选择一个节点进行配置</div></div>
      </div>
    )
  }
  return (
    <div className="wf-inspector">
      <div className="wf-insp-head">
        <div className="wf-insp-icon"><Icons.Workflow size={15} /></div>
        <div className="flex1">
          <div className="strong">{node.title}</div>
          <div className="muted wf-insp-role">{node.kind} 节点</div>
        </div>
        <button className="icon-btn" title="删除节点" onClick={onDelete}><Icons.Trash size={13} /></button>
      </div>
      <div className="wf-insp-body scroll">
        <InspectorField label="标题">
          <input value={node.title} onChange={(event) => onPatch({ title: event.target.value })} />
        </InspectorField>
        <InspectorField label="节点类型">
          <select value={node.kind} onChange={(event) => onPatch({ kind: event.target.value as WorkflowNodeKind })}>
            {NODE_KINDS.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
          </select>
        </InspectorField>
        <InspectorField label="Provider">
          <select value={String(node.config.providerProfileId ?? '')} onChange={(event) => onPatchConfig({ providerProfileId: event.target.value || null })}>
            <option value="">继承 Agent</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </InspectorField>
        <InspectorField label="模型">
          <select value={String(node.config.modelId ?? '')} onChange={(event) => onPatchConfig({ modelId: event.target.value || null })}>
            <option value="">继承 Agent</option>
            {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </InspectorField>
        <InspectorField label="权限">
          <select
            value={String(node.config.permissionMode ?? '')}
            onChange={(event) =>
              onPatchConfig(
                event.target.value
                  ? { permissionMode: event.target.value as SessionPermissionMode }
                  : {},
              )
            }
          >
            <option value="">继承 Agent</option>
            <option value="claude-ask">询问</option>
            <option value="claude-auto-edits">自动编辑</option>
            <option value="claude-plan">计划模式</option>
            <option value="claude-bypass">绕过权限</option>
          </select>
        </InspectorField>
        <InspectorField label="节点提示词">
          <textarea rows={6} value={String(node.config.prompt ?? '')} onChange={(event) => onPatchConfig({ prompt: event.target.value })} />
        </InspectorField>
        <InspectorField label="Skills">
          <TagPicker
            items={skills.map((skill) => ({ id: skill.id, label: skill.name }))}
            selected={asStringArray(node.config.skillIds)}
            onChange={(skillIds) => onPatchConfig({ skillIds })}
          />
        </InspectorField>
        <InspectorField label="规则">
          <TagPicker
            items={rules.map((rule) => ({ id: rule.id, label: rule.name }))}
            selected={asStringArray(node.config.ruleIds)}
            onChange={(ruleIds) => onPatchConfig({ ruleIds })}
          />
        </InspectorField>
        <InspectorField label="工具">
          <TagPicker
            items={CODING_AGENT_TOOLS.map((tool) => ({ id: tool.name, label: tool.name }))}
            selected={asStringArray(node.config.toolIds)}
            onChange={(toolIds) => onPatchConfig({ toolIds })}
          />
        </InspectorField>
        <InspectorField label="MCP">
          <TagPicker
            items={mcpServers.map((server) => ({ id: server.id, label: server.name }))}
            selected={asStringArray(node.config.mcpServerIds)}
            onChange={(mcpServerIds) => onPatchConfig({ mcpServerIds })}
          />
        </InspectorField>
        <InspectorField label="重试次数">
          <input
            type="number"
            min={0}
            max={10}
            value={Number(node.config.retryCount ?? 1)}
            onChange={(event) => onPatchConfig({ retryCount: Number(event.target.value) })}
          />
        </InspectorField>
      </div>
    </div>
  )
}

function InspectorField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

function TagPicker({
  items,
  selected,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const selectedSet = new Set(selected)
  if (items.length === 0) return <div className="agents-empty-mini">暂无可选项</div>
  return (
    <div className="wf-tools-row">
      {items.map((item) => {
        const active = selectedSet.has(item.id)
        return (
          <button
            key={item.id}
            className={`tool-chip ${active ? 'active' : ''}`}
            onClick={() => onChange(active ? selected.filter((id) => id !== item.id) : [...selected, item.id])}
          >
            {active && <Icons.Check size={11} />} {item.label}
          </button>
        )
      })}
    </div>
  )
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function defaultPromptForKind(kind: WorkflowNodeKind): string {
  switch (kind) {
    case 'input':
      return '解析用户输入，确认目标、约束、上下文和完成标准。'
    case 'agent':
      return '执行该阶段任务，必要时调用工具，并输出阶段结果。'
    case 'skill':
      return '加载并应用所选 Skill 的方法与约束。'
    case 'tool':
      return '调用所需工具，记录输入、输出和异常。'
    case 'mcp':
      return '使用所选 MCP 服务完成外部能力调用。'
    case 'approval':
      return '在继续前等待用户确认关键计划或高风险动作。'
    case 'review':
      return '复核上一阶段结果，运行验证并指出风险。'
    case 'artifact':
      return '整理最终交付物、变更摘要和后续建议。'
  }
}
