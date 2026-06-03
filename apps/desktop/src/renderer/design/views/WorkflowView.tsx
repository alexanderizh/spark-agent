import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { CODING_AGENT_TOOLS } from '../data/available-tools'
import type {
  ManagedAgent,
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
import { graphToReactFlow, reactFlowToGraph, type SparkFlowNode } from './workflow/graph-adapter'
import { SparkNode } from './workflow/SparkNode'
import { NODE_KIND_META, NODE_KIND_ORDER, getNodeKindMeta } from './workflow/node-kinds'

const NODE_TYPES: NodeTypes = { spark: SparkNode }

export function WorkflowView() {
  return (
    <ReactFlowProvider>
      <WorkflowViewInner />
    </ReactFlowProvider>
  )
}

function WorkflowViewInner() {
  const { toast } = useToast()
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [rules, setRules] = useState<RuleItem[]>([])
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorkflowItem | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(true)

  const [nodes, setNodes, onNodesChange] = useNodesState<SparkFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const { invoke: listWorkflows } = useIpcInvoke('workflow:list')
  const { invoke: createWorkflow } = useIpcInvoke('workflow:create')
  const { invoke: updateWorkflow } = useIpcInvoke('workflow:update')
  const { invoke: deleteWorkflow } = useIpcInvoke('workflow:delete')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { invoke: listMcp } = useIpcInvoke('mcp:list')
  const { invoke: listRules } = useIpcInvoke('rules:list')
  const { invoke: listAgents } = useIpcInvoke('agent:list')

  const loadWorkflowIntoCanvas = useCallback(
    (workflow: WorkflowItem | null) => {
      setDraft(workflow)
      if (workflow == null) {
        setNodes([])
        setEdges([])
        setSelectedNodeId(null)
        return
      }
      const { nodes: flowNodes, edges: flowEdges } = graphToReactFlow(workflow.graph)
      setNodes(flowNodes)
      setEdges(flowEdges)
      setSelectedNodeId(flowNodes[0]?.id ?? null)
    },
    [setNodes, setEdges],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [workflowRes, providerRes, skillRes, mcpRes, ruleRes, agentRes] = await Promise.all([
        listWorkflows({ includeArchived: true }),
        listProviders({}),
        listSkills({}),
        listMcp({}),
        listRules({}),
        listAgents({}),
      ])
      setWorkflows(workflowRes.workflows)
      setProviders(providerRes.profiles)
      setSkills(skillRes.skills)
      setMcpServers(mcpRes.servers)
      setRules(ruleRes.rules)
      setAgents(agentRes.agents ?? [])
      const active =
        workflowRes.workflows.find((item) => item.id === activeId) ?? workflowRes.workflows[0] ?? null
      if (active != null) {
        setActiveId(active.id)
        loadWorkflowIntoCanvas(active)
      } else {
        setActiveId(null)
        loadWorkflowIntoCanvas(null)
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  const modelOptions = useMemo(
    () =>
      Array.from(
        new Set(
          providers
            .flatMap((provider) => (provider.modelIds.length ? provider.modelIds : [provider.defaultModel]))
            .filter(Boolean),
        ),
      ),
    [providers],
  )

  const patchDraftMeta = (patch: Partial<WorkflowItem>) => {
    setDraft((prev) => (prev == null ? prev : { ...prev, ...patch }))
  }

  const patchSelectedNodeData = useCallback(
    (updater: (node: SparkFlowNode) => SparkFlowNode) => {
      if (selectedNodeId == null) return
      setNodes((prev) => prev.map((node) => (node.id === selectedNodeId ? updater(node) : node)))
    },
    [selectedNodeId, setNodes],
  )

  const selectWorkflow = (workflow: WorkflowItem) => {
    setActiveId(workflow.id)
    loadWorkflowIntoCanvas(workflow)
  }

  const createNewWorkflow = async () => {
    const workflow = (
      await createWorkflow({
        name: `工作流 ${workflows.length + 1}`,
        description: '自定义 Agent 执行流程',
        status: 'draft',
        graph: defaultStarterGraph(),
      })
    ).workflow
    toast.success('工作流已创建')
    setActiveId(workflow.id)
    loadWorkflowIntoCanvas(workflow)
    await refresh()
  }

  const saveWorkflow = async () => {
    if (draft == null) return
    const graph: WorkflowGraph = reactFlowToGraph(nodes, edges)
    const saved = (
      await updateWorkflow({
        id: draft.id,
        name: draft.name,
        description: draft.description,
        status: draft.status,
        tags: draft.tags,
        graph,
      })
    ).workflow
    toast.success('工作流已保存')
    setActiveId(saved.id)
    loadWorkflowIntoCanvas(saved)
    await refresh()
  }

  const removeWorkflow = async () => {
    if (draft == null) return
    const res = await deleteWorkflow({ id: draft.id })
    if (res.deleted) {
      toast.success('工作流已删除')
      setActiveId(null)
      loadWorkflowIntoCanvas(null)
      await refresh()
    }
  }

  const addNode = (kind: WorkflowNodeKind) => {
    const meta = getNodeKindMeta(kind)
    const id = `${kind}-${Date.now().toString(36)}`
    const baseX = 160 + (nodes.length % 4) * 240
    const baseY = 120 + Math.floor(nodes.length / 4) * 180
    const node: SparkFlowNode = {
      id,
      type: 'spark',
      position: { x: baseX, y: baseY },
      data: { kind, title: meta.label, config: { prompt: meta.defaultPrompt, retryCount: 1 } },
    }
    setNodes((prev) => [...prev, node])
    setSelectedNodeId(id)
  }

  const removeNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId))
    setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId(null)
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((prev) => {
        const exists = prev.some(
          (edge) => edge.source === connection.source && edge.target === connection.target,
        )
        if (exists) return prev
        const id = `${connection.source}-${connection.target}-${Date.now().toString(36)}`
        return addEdge({ ...connection, id, type: 'smoothstep', animated: true }, prev)
      })
    },
    [setEdges],
  )

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const nodeId = params.nodes[0]?.id ?? null
    if (nodeId != null) setSelectedNodeId(nodeId)
  }, [])

  return (
    <div className="workflow-layout workflow-builder workflow-builder-v2">
      <aside className="workflow-list-panel">
        <div className="workflow-list-head">
          <div>
            <div className="agents-title-lg">Workflows</div>
            <div className="agents-desc">拖动节点端点连线，定义 Agent 的优先执行流程。</div>
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
              <span className="wf-list-icon">
                <Icons.Workflow size={14} />
              </span>
              <span className="wf-list-body">
                <span className="wf-list-name">{workflow.name}</span>
                <span className="wf-list-meta">
                  {workflow.graph.nodes.length} 节点 · {workflow.status}
                </span>
              </span>
            </button>
          ))}
          {!loading && workflows.length === 0 && (
            <div className="agents-empty-mini">暂无工作流</div>
          )}
        </div>
      </aside>

      {draft == null ? (
        <div className="wf-empty-state">
          <div className="empty-state">
            <div className="empty-icon">
              <Icons.Workflow size={24} />
            </div>
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
          <div className="wf-stage">
            <div className="wf-toolbar">
              <input
                className="wf-title-input"
                value={draft.name}
                onChange={(event) => patchDraftMeta({ name: event.target.value })}
                placeholder="工作流名称"
              />
              <select
                className="wf-status-select"
                value={draft.status}
                onChange={(event) => patchDraftMeta({ status: event.target.value as WorkflowStatus })}
              >
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
              <div className="wf-toolbar-spacer" />
              <button
                className="btn ghost sm"
                onClick={() => setPaletteOpen((open) => !open)}
                title="节点面板"
              >
                <Icons.Plus size={12} /> 节点
              </button>
              <button className="btn ghost sm danger" onClick={() => void removeWorkflow()}>
                <Icons.Trash size={12} /> 删除
              </button>
              <button className="btn primary sm" onClick={() => void saveWorkflow()}>
                <Icons.Check size={12} /> 保存
              </button>
            </div>

            <div className="wf-canvas-wrap">
              {paletteOpen && (
                <div className="wf-palette">
                  <div className="wf-palette-title">节点类型</div>
                  {NODE_KIND_ORDER.map((kind) => {
                    const meta = NODE_KIND_META[kind]
                    return (
                      <button
                        key={kind}
                        className="wf-palette-item"
                        onClick={() => addNode(kind)}
                        style={{ ['--node-accent' as string]: `var(${meta.accent})` }}
                      >
                        <span className="wf-palette-icon">{meta.icon}</span>
                        <span className="wf-palette-body">
                          <span className="wf-palette-label">{meta.label}</span>
                          <span className="wf-palette-hint">{meta.hint}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="wf-flow">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={onSelectionChange}
                  nodeTypes={NODE_TYPES}
                  fitView
                  fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                  defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                  proOptions={{ hideAttribution: true }}
                  deleteKeyCode={['Delete', 'Backspace']}
                >
                  <Background gap={20} size={1} />
                  <MiniMap pannable zoomable className="wf-minimap" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
            </div>
          </div>

          <WorkflowInspector
            node={selectedNode}
            providers={providers}
            modelOptions={modelOptions}
            skills={skills}
            rules={rules}
            mcpServers={mcpServers}
            agents={agents}
            currentWorkflowId={draft.id}
            onDelete={() => selectedNodeId != null && removeNode(selectedNodeId)}
            onPatch={(patch) =>
              patchSelectedNodeData((node) => ({ ...node, data: { ...node.data, ...patch } }))
            }
            onPatchConfig={(patch) =>
              patchSelectedNodeData((node) => ({
                ...node,
                data: { ...node.data, config: { ...node.data.config, ...patch } },
              }))
            }
          />
        </>
      )}
    </div>
  )
}

function defaultStarterGraph(): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    {
      id: 'input-1',
      kind: 'input',
      title: '需求输入',
      x: 80,
      y: 120,
      config: { prompt: NODE_KIND_META.input.defaultPrompt, retryCount: 1 },
    },
    {
      id: 'plan-1',
      kind: 'plan',
      title: '计划节点',
      x: 360,
      y: 120,
      config: {
        prompt: NODE_KIND_META.plan.defaultPrompt,
        permissionMode: 'claude-plan' satisfies SessionPermissionMode,
      },
    },
    {
      id: 'agent-1',
      kind: 'agent',
      title: '执行节点',
      x: 640,
      y: 120,
      config: { prompt: NODE_KIND_META.agent.defaultPrompt, role: 'coder' },
    },
    {
      id: 'verify-1',
      kind: 'verify',
      title: '验证复核',
      x: 920,
      y: 120,
      config: { prompt: NODE_KIND_META.verify.defaultPrompt },
    },
  ]
  return {
    nodes,
    edges: [
      { id: 'e-input-plan', from: 'input-1', to: 'plan-1' },
      { id: 'e-plan-agent', from: 'plan-1', to: 'agent-1' },
      { id: 'e-agent-verify', from: 'agent-1', to: 'verify-1' },
    ],
  }
}

type InspectorProps = {
  node: SparkFlowNode | null
  providers: ProviderProfile[]
  modelOptions: string[]
  skills: SkillItem[]
  rules: RuleItem[]
  mcpServers: McpServerItem[]
  agents: ManagedAgent[]
  currentWorkflowId: string
  onPatch: (patch: Partial<SparkFlowNode['data']>) => void
  onPatchConfig: (patch: WorkflowNode['config']) => void
  onDelete: () => void
}

function WorkflowInspector(props: InspectorProps) {
  const { node, providers, modelOptions, skills, rules, mcpServers, agents, currentWorkflowId } = props
  if (node == null) {
    return (
      <div className="wf-inspector">
        <div className="wf-insp-body">
          <div className="agents-empty-mini">选择一个节点进行配置</div>
        </div>
      </div>
    )
  }
  const meta = getNodeKindMeta(node.data.kind)
  const config = node.data.config
  const isSubagent = node.data.kind === 'subagent'
  const isVerify = node.data.kind === 'verify'
  return (
    <div className="wf-inspector">
      <div className="wf-insp-head">
        <div className="wf-insp-icon" style={{ ['--node-accent' as string]: `var(${meta.accent})` }}>
          {meta.icon}
        </div>
        <div className="flex1">
          <div className="strong">{node.data.title}</div>
          <div className="muted wf-insp-role">{meta.label} 节点</div>
        </div>
        <button className="icon-btn" title="删除节点" onClick={props.onDelete}>
          <Icons.Trash size={13} />
        </button>
      </div>
      <div className="wf-insp-body scroll">
        <InspectorField label="标题">
          <input value={node.data.title} onChange={(event) => props.onPatch({ title: event.target.value })} />
        </InspectorField>
        <InspectorField label="节点类型">
          <select
            value={node.data.kind}
            onChange={(event) => props.onPatch({ kind: event.target.value as WorkflowNodeKind })}
          >
            {NODE_KIND_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {NODE_KIND_META[kind].label}
              </option>
            ))}
          </select>
        </InspectorField>
        <InspectorField label="Provider">
          <select
            value={String(config.providerProfileId ?? '')}
            onChange={(event) =>
              props.onPatchConfig({ providerProfileId: event.target.value || null })
            }
          >
            <option value="">继承 Agent</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </InspectorField>
        <InspectorField label="模型">
          <select
            value={String(config.modelId ?? '')}
            onChange={(event) => props.onPatchConfig({ modelId: event.target.value || null })}
          >
            <option value="">继承 Agent</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </InspectorField>
        <InspectorField label="权限">
          <select
            value={String(config.permissionMode ?? '')}
            onChange={(event) =>
              props.onPatchConfig(
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
          <textarea
            rows={6}
            value={String(config.prompt ?? '')}
            onChange={(event) => props.onPatchConfig({ prompt: event.target.value })}
          />
        </InspectorField>
        {isSubagent && (
          <>
            <InspectorField label="子代理">
              <select
                value={String(config.agentId ?? '')}
                onChange={(event) => props.onPatchConfig({ agentId: event.target.value || null })}
              >
                <option value="">选择子代理</option>
                {agents
                  .filter((agent) => agent.workflowId !== currentWorkflowId)
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
              </select>
            </InspectorField>
            <InspectorField label="并发数">
              <input
                type="number"
                min={1}
                max={8}
                value={Number(config.parallelism ?? 1)}
                onChange={(event) => props.onPatchConfig({ parallelism: Number(event.target.value) })}
              />
            </InspectorField>
          </>
        )}
        {isVerify && (
          <InspectorField label="验证命令">
            <textarea
              rows={3}
              placeholder="一行一条，例如：pnpm test"
              value={(config.verifyCommands ?? []).join('\n')}
              onChange={(event) =>
                props.onPatchConfig({
                  verifyCommands: event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean),
                })
              }
            />
          </InspectorField>
        )}
        <InspectorField label="Skills">
          <TagPicker
            items={skills.map((skill) => ({ id: skill.id, label: skill.name }))}
            selected={asStringArray(config.skillIds)}
            onChange={(skillIds) => props.onPatchConfig({ skillIds })}
          />
        </InspectorField>
        <InspectorField label="规则">
          <TagPicker
            items={rules.map((rule) => ({ id: rule.id, label: rule.name }))}
            selected={asStringArray(config.ruleIds)}
            onChange={(ruleIds) => props.onPatchConfig({ ruleIds })}
          />
        </InspectorField>
        <InspectorField label="工具">
          <TagPicker
            items={CODING_AGENT_TOOLS.map((tool) => ({ id: tool.name, label: tool.name }))}
            selected={asStringArray(config.toolIds)}
            onChange={(toolIds) => props.onPatchConfig({ toolIds })}
          />
        </InspectorField>
        <InspectorField label="MCP">
          <TagPicker
            items={mcpServers.map((server) => ({ id: server.id, label: server.name }))}
            selected={asStringArray(config.mcpServerIds)}
            onChange={(mcpServerIds) => props.onPatchConfig({ mcpServerIds })}
          />
        </InspectorField>
        <InspectorField label="重试次数">
          <input
            type="number"
            min={0}
            max={10}
            value={Number(config.retryCount ?? 1)}
            onChange={(event) => props.onPatchConfig({ retryCount: Number(event.target.value) })}
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
            onClick={() =>
              onChange(active ? selected.filter((id) => id !== item.id) : [...selected, item.id])
            }
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
