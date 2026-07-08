import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useSaveShortcut } from '../hooks/useSaveShortcut'
import { useToast } from '../components/Toast'
import { WORKFLOW_RESTRICTABLE_TOOLS } from '@spark/protocol'
import type {
  ManagedAgent,
  McpServerItem,
  ProviderProfile,
  RuleItem,
  SkillItem,
  WorkflowEdgeCondition,
  WorkflowGraph,
  WorkflowItem,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowOrientation,
  WorkflowStatus,
} from '@spark/protocol'
import {
  buildEdgeConditionProps,
  graphToReactFlow,
  reactFlowToGraph,
  type SparkEdgeData,
  type SparkFlowNode,
} from './workflow/graph-adapter'
import { SparkNode } from './workflow/SparkNode'
import { WorkflowContextMenu, type WfContextMenuState } from './workflow/WorkflowContextMenu'
import { NODE_KIND_META, NODE_KIND_ORDER, getNodeKindMeta } from './workflow/node-kinds'
import { WorkflowTemplatePicker } from './workflow/WorkflowTemplatePicker'
import type { WorkflowTemplate } from './workflow/workflow-templates'
import { Button, Dropdown, Input as LobeInput, Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import { Modal as AntdModal, Switch } from 'antd'

const NODE_TYPES: NodeTypes = { spark: SparkNode }
type WorkflowScreen = 'list' | 'detail'
type WorkflowExportPayload = {
  version: 1
  exportedAt: string
  workflows: Array<
    Pick<
      WorkflowItem,
      'name' | 'description' | 'status' | 'tags' | 'enabled' | 'graph' | 'scope' | 'version'
    >
  >
}
let workflowNodeSequence = 0

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

function createWorkflowNodeId(kind: WorkflowNodeKind): string {
  workflowNodeSequence = (workflowNodeSequence + 1) % Number.MAX_SAFE_INTEGER
  return `${kind}-${workflowNodeSequence.toString(36)}`
}

function defaultLoopBodyGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'loop-draft',
        kind: 'review',
        title: '迭代产出',
        x: 80,
        y: 120,
        config: {
          prompt: '基于上游输入和上一轮结果，产出本轮改进版本。',
          outputKey: 'draft',
        },
      },
      {
        id: 'loop-check',
        kind: 'review',
        title: '退出判断',
        x: 360,
        y: 120,
        config: {
          prompt: "评估本轮结果是否达标。严格只输出 'pass' 或 'retry'。",
          outputKey: 'verdict',
        },
      },
    ],
    edges: [{ id: 'loop-draft-check', from: 'loop-draft', to: 'loop-check' }],
  }
}

function defaultWorkflowNodeConfig(kind: WorkflowNodeKind): WorkflowNode['config'] {
  const meta = getNodeKindMeta(kind)
  if (kind !== 'loop') return { prompt: meta.defaultPrompt, retryCount: 1 }
  return {
    prompt: meta.defaultPrompt,
    outputKey: 'loop_result',
    maxIterations: 5,
    loopVar: '__loop_index',
    resultKey: 'draft',
    collectAll: false,
    breakCondition: { op: 'equals', key: 'verdict', value: 'pass' },
    body: defaultLoopBodyGraph(),
  }
}

function isWorkflowGraphLike(value: unknown): value is WorkflowGraph {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.nodes) && Array.isArray(record.edges)
}

function serializeWorkflowDraft(
  workflow: Pick<WorkflowItem, 'name' | 'description' | 'status' | 'tags'> | null,
  nodes: SparkFlowNode[],
  edges: Edge[],
  orientation: WorkflowOrientation,
): string {
  if (workflow == null) return ''
  return JSON.stringify({
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    tags: workflow.tags,
    graph: reactFlowToGraph(nodes, edges, orientation),
  })
}

function serializeSavedWorkflow(workflow: WorkflowItem | null): string {
  if (workflow == null) return ''
  return JSON.stringify({
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    tags: workflow.tags,
    graph: workflow.graph,
  })
}

/** 工作流删除二次确认弹窗 —— 列表页与详情页共用。 */
function confirmDeleteWorkflow(name: string, onOk: () => void) {
  AntdModal.confirm({
    title: '删除工作流？',
    content: `确认删除工作流「${name}」？该操作无法撤销，其下的节点编排将一并移除。`,
    okText: '删除',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk,
  })
}

export function WorkflowView() {
  return (
    <ReactFlowProvider>
      <WorkflowViewInner />
    </ReactFlowProvider>
  )
}

function WorkflowViewInner() {
  const { toast } = useToast()
  const { registerNavGuard, requestConfirm, setHasUnsavedChanges } = useApp()
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const [rules, setRules] = useState<RuleItem[]>([])
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorkflowItem | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  // 与 selectedNodeId 互斥：选中边时检查器切到边条件编辑面板。
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 编排方向：横向（左右 handle）/纵向（上下 handle）；smoothstep 边自动跟随 handle 朝向画折线。
  const [orientation, setOrientation] = useState<WorkflowOrientation>('vertical')
  const [screen, setScreen] = useState<WorkflowScreen>('list')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const activeIdRef = useRef<string | null>(null)
  const screenRef = useRef<WorkflowScreen>('list')
  const dirtyRef = useRef(false)
  const draftIdRef = useRef<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<SparkFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  // handle 朝向变化（横↔纵切换）时强制重测 handle 边界，否则 smoothstep 边仍按旧锚点画线。
  const updateNodeInternals = useUpdateNodeInternals()
  const [contextMenu, setContextMenu] = useState<WfContextMenuState | null>(null)
  const flowWrapRef = useRef<HTMLDivElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<SparkFlowNode, Edge> | null>(null)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)

  const { invoke: listWorkflows } = useIpcInvoke('workflow:list')
  const { invoke: createWorkflow } = useIpcInvoke('workflow:create')
  const { invoke: updateWorkflow } = useIpcInvoke('workflow:update')
  const { invoke: deleteWorkflow } = useIpcInvoke('workflow:delete')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listSkills } = useIpcInvoke('skill:list')
  const { invoke: listMcp } = useIpcInvoke('mcp:list')
  const { invoke: listRules } = useIpcInvoke('rules:list')
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: saveFileDialog } = useIpcInvoke('dialog:save-file')
  const { invoke: writeTextFile } = useIpcInvoke('file:write-text')
  const { invoke: readTextFile } = useIpcInvoke('file:read-text')

  const loadWorkflowIntoCanvas = useCallback(
    (workflow: WorkflowItem | null) => {
      setDraft(workflow)
      draftIdRef.current = workflow?.id ?? null
      setSavedSnapshot(serializeSavedWorkflow(workflow))
      if (workflow == null) {
        setNodes([])
        setEdges([])
        setSelectedNodeId(null)
        setSelectedEdgeId(null)
        setOrientation('vertical')
        return
      }
      // 旧数据没有 orientation 字段：其坐标按横向排布存储，故回退到横向以正确显示布局；
      // 新建工作流由 defaultStarterGraph 显式带 orientation: 'vertical'，走下面这条分支。
      setOrientation(workflow.graph.orientation ?? 'horizontal')
      const { nodes: flowNodes, edges: flowEdges } = graphToReactFlow(workflow.graph)
      setNodes(flowNodes)
      setEdges(flowEdges)
      setSelectedNodeId(flowNodes[0]?.id ?? null)
      setSelectedEdgeId(null)
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
      const active = workflowRes.workflows.find((item) => item.id === activeIdRef.current) ?? null
      if (screenRef.current === 'detail') {
        if (active != null) {
          activeIdRef.current = active.id
          setActiveId(active.id)
          if (!(dirtyRef.current && draftIdRef.current === active.id)) {
            loadWorkflowIntoCanvas(active)
          }
        } else {
          activeIdRef.current = null
          screenRef.current = 'list'
          setActiveId(null)
          setScreen('list')
          loadWorkflowIntoCanvas(null)
        }
      } else if (active == null) {
        activeIdRef.current = null
        setActiveId(null)
        loadWorkflowIntoCanvas(null)
      } else {
        setActiveId(active.id)
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRefreshable(refresh)

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const dirty = useMemo(
    () => serializeWorkflowDraft(draft, nodes, edges, orientation) !== savedSnapshot,
    [draft, edges, nodes, orientation, savedSnapshot],
  )

  useEffect(() => {
    dirtyRef.current = dirty
    setHasUnsavedChanges(dirty)
    return () => {
      setHasUnsavedChanges(false)
    }
  }, [dirty, setHasUnsavedChanges])

  useEffect(() => {
    registerNavGuard(async () => {
      if (!dirtyRef.current) return true
      return requestConfirm({
        title: '放弃未保存的工作流修改？',
        description: '离开后，当前工作流的未保存更改会恢复到上次保存的状态。',
        confirmText: '离开',
      })
    })
    return () => registerNavGuard(null)
  }, [registerNavGuard, requestConfirm])

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedEdge = selectedEdgeId != null ? edges.find((edge) => edge.id === selectedEdgeId) ?? null : null

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

  const discardCurrentDraft = useCallback(() => {
    if (draft == null) return
    const persisted = workflows.find((item) => item.id === draft.id) ?? null
    loadWorkflowIntoCanvas(persisted)
  }, [draft, loadWorkflowIntoCanvas, workflows])

  const runWithLeaveGuard = useCallback(
    async (action: () => void | Promise<void>) => {
      if (dirtyRef.current) {
        const confirmed = await requestConfirm({
          title: '放弃未保存的工作流修改？',
          description: '继续后会丢失当前尚未保存的节点与配置更改。',
          confirmText: '继续',
        })
        if (!confirmed) return
        discardCurrentDraft()
      }
      await action()
    },
    [discardCurrentDraft, requestConfirm],
  )

  const openWorkflow = useCallback(
    (workflow: WorkflowItem) => {
      void runWithLeaveGuard(async () => {
        screenRef.current = 'detail'
        activeIdRef.current = workflow.id
        setScreen('detail')
        setActiveId(workflow.id)
        loadWorkflowIntoCanvas(workflow)
      })
    },
    [loadWorkflowIntoCanvas, runWithLeaveGuard],
  )

  const showWorkflowList = useCallback(() => {
    void runWithLeaveGuard(async () => {
      screenRef.current = 'list'
      setScreen('list')
    })
  }, [runWithLeaveGuard])

  const createWorkflowFromGraph = useCallback(
    async (graph: WorkflowGraph, name: string, description: string) => {
      await runWithLeaveGuard(async () => {
        const workflow = (
          await createWorkflow({
            name,
            description,
            status: 'draft',
            graph,
          })
        ).workflow
        toast.success('工作流已创建')
        setWorkflows((prev) => [workflow, ...prev.filter((item) => item.id !== workflow.id)])
        screenRef.current = 'detail'
        activeIdRef.current = workflow.id
        setScreen('detail')
        setActiveId(workflow.id)
        loadWorkflowIntoCanvas(workflow)
        void refresh()
      })
    },
    [createWorkflow, loadWorkflowIntoCanvas, refresh, runWithLeaveGuard, toast],
  )

  const createNewWorkflow = useCallback(async () => {
    await createWorkflowFromGraph(
      defaultStarterGraph(),
      `工作流 ${workflows.length + 1}`,
      '自定义 Agent 执行流程',
    )
  }, [createWorkflowFromGraph, workflows.length])

  const createWorkflowFromTemplate = useCallback(
    async (template: WorkflowTemplate) => {
      await createWorkflowFromGraph(template.graph, template.name, template.description)
    },
    [createWorkflowFromGraph],
  )

  const saveWorkflow = async () => {
    if (draft == null) return
    const graph: WorkflowGraph = reactFlowToGraph(nodes, edges, orientation)
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
    activeIdRef.current = saved.id
    setWorkflows((prev) => prev.map((item) => (item.id === saved.id ? saved : item)))
    loadWorkflowIntoCanvas(saved)
    void refresh()
  }

  useSaveShortcut(saveWorkflow, draft != null)

  const performDelete = useCallback(
    async (id: string) => {
      const res = await deleteWorkflow({ id })
      if (res.deleted) {
        toast.success('工作流已删除')
        if (activeIdRef.current === id) {
          activeIdRef.current = null
          screenRef.current = 'list'
          setScreen('list')
          setActiveId(null)
          loadWorkflowIntoCanvas(null)
        }
        setWorkflows((prev) => prev.filter((item) => item.id !== id))
        await refresh()
      }
    },
    [deleteWorkflow, loadWorkflowIntoCanvas, refresh],
  )

  const removeWorkflow = async () => {
    if (draft == null) return
    confirmDeleteWorkflow(draft.name, () => void performDelete(draft.id))
  }

  const visibleSelectedIds = useMemo(
    () => new Set(workflows.map((workflow) => workflow.id).filter((id) => selectedIds.has(id))),
    [selectedIds, workflows],
  )

  const toggleSelect = useCallback((workflowId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(workflowId)) next.delete(workflowId)
      else next.add(workflowId)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exportWorkflowIds = useCallback(
    async (ids: string[]) => {
      const targets = ids.length > 0 ? workflows.filter((workflow) => ids.includes(workflow.id)) : workflows
      if (targets.length === 0) {
        toast.warning('没有可导出的工作流')
        return
      }
      const payload: WorkflowExportPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        workflows: targets.map((workflow) => ({
          scope: workflow.scope,
          version: workflow.version,
          name: workflow.name,
          description: workflow.description,
          status: workflow.status,
          tags: workflow.tags,
          enabled: workflow.enabled,
          graph: workflow.graph,
        })),
      }
      const result = await saveFileDialog({
        title: '导出工作流',
        defaultPath: `workflows-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return
      await writeTextFile({
        path: result.filePath,
        content: JSON.stringify(payload, null, 2),
      })
      toast.success(`已导出 ${targets.length} 个工作流`)
    },
    [saveFileDialog, toast, workflows, writeTextFile],
  )

  const handleImport = useCallback(async () => {
    try {
      const result = await openFileDialog({
        title: '导入工作流',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      const filePath = result.filePaths?.[0] ?? result.filePath
      if (result.canceled || !filePath) return
      const file = await readTextFile({ path: filePath })
      const parsed = JSON.parse(file.content) as Partial<WorkflowExportPayload>
      const records = Array.isArray(parsed.workflows) ? parsed.workflows : []
      if (records.length === 0) {
        toast.warning('未找到可导入的工作流')
        return
      }
      for (const workflow of records) {
        await createWorkflow({
          ...(typeof workflow.scope === 'string' && workflow.scope.trim().length > 0
            ? { scope: workflow.scope }
            : {}),
          ...(typeof workflow.version === 'string' && workflow.version.trim().length > 0
            ? { version: workflow.version }
            : {}),
          name: typeof workflow.name === 'string' && workflow.name.trim().length > 0 ? workflow.name : '导入的工作流',
          description: typeof workflow.description === 'string' ? workflow.description : '',
          status:
            workflow.status === 'active' || workflow.status === 'archived' ? workflow.status : 'draft',
          tags: Array.isArray(workflow.tags) ? workflow.tags.filter((tag): tag is string => typeof tag === 'string') : [],
          enabled: typeof workflow.enabled === 'boolean' ? workflow.enabled : true,
          graph: workflow.graph,
        })
      }
      toast.success(`已导入 ${records.length} 个工作流`)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入工作流失败')
    }
  }, [createWorkflow, openFileDialog, readTextFile, refresh, toast])

  const handleExportSelected = useCallback(async () => {
    const ids = Array.from(visibleSelectedIds)
    if (ids.length === 0) {
      toast.warning('请先选择要导出的工作流')
      return
    }
    await exportWorkflowIds(ids)
    setSelectionMode(false)
    clearSelection()
  }, [clearSelection, exportWorkflowIds, toast, visibleSelectedIds])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (contextMenu == null) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', closeContextMenu)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', closeContextMenu)
    }
  }, [closeContextMenu, contextMenu])

  const addNodeAt = useCallback(
    (kind: WorkflowNodeKind, position?: { x: number; y: number }) => {
      const meta = getNodeKindMeta(kind)
      const id = createWorkflowNodeId(kind)
      setNodes((prev) => {
        const baseX = position?.x ?? 160 + (prev.length % 4) * 240
        const baseY = position?.y ?? 120 + Math.floor(prev.length / 4) * 180
        const node: SparkFlowNode = {
          id,
          type: 'spark',
          position: { x: baseX, y: baseY },
          data: {
            kind,
            title: meta.label,
            config: defaultWorkflowNodeConfig(kind),
            orientation,
          },
        }
        return [...prev, node]
      })
      setSelectedNodeId(id)
    },
    [setNodes, orientation],
  )

  const addNode = (kind: WorkflowNodeKind) => {
    addNodeAt(kind)
  }

  const duplicateNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => {
        const source = prev.find((node) => node.id === nodeId)
        if (source == null) return prev
        const id = createWorkflowNodeId(source.data.kind)
        const newNode: SparkFlowNode = {
          id,
          type: 'spark',
          position: { x: source.position.x + 48, y: source.position.y + 48 },
          data: {
            kind: source.data.kind,
            title: `${source.data.title} 副本`,
            config: structuredClone(source.data.config),
            orientation: source.data.orientation,
          },
        }
        setSelectedNodeId(id)
        return [...prev, newNode]
      })
    },
    [setNodes],
  )

  /**
   * 切换编排方向：横向↔纵向。
   * 一次性把每个节点坐标 x/y 互换（视觉上旋转布局）、同步翻转 handle 朝向。
   * 坐标始终存储在「当前方向空间」内，不做加载时变换，故旧横向数据天然兼容。
   *
   * 注意：仅改 <Handle position> prop 不会触发 React Flow 重测 handle 边界
   * （useNodeObserver 只监听 node.sourcePosition/targetPosition），smoothstep 边会继续
   * 按旧锚点位置画线（表现为「handle 在底部、线却从右侧出」）。故在 DOM 提交后用
   * useUpdateNodeInternals 强制重测，让边路径跟随新锚点。
   */
  const toggleOrientation = useCallback(() => {
    const next: WorkflowOrientation = orientation === 'vertical' ? 'horizontal' : 'vertical'
    setNodes((prev) =>
      prev.map((node) => ({
        ...node,
        position: { x: node.position.y, y: node.position.x },
        data: { ...node.data, orientation: next },
      })),
    )
    setOrientation(next)
    // 等 handle 的新 position 渲染到 DOM 后，再强制重测所有节点的 handle 边界。
    requestAnimationFrame(() => {
      for (const node of nodes) updateNodeInternals(node.id)
    })
  }, [nodes, orientation, setNodes, updateNodeInternals])

  const removeNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId))
    setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev))
  }

  const removeEdge = useCallback(
    (edgeId: string) => {
      setEdges((prev) => prev.filter((edge) => edge.id !== edgeId))
      setSelectedEdgeId((prev) => (prev === edgeId ? null : prev))
    },
    [setEdges],
  )

  /** 更新选中边的条件；condition 传 undefined 即清除，同时同步标签/动画/类名等展示属性。 */
  const patchSelectedEdgeCondition = useCallback(
    (condition: WorkflowEdgeCondition | undefined) => {
      if (selectedEdgeId == null) return
      setEdges((prev) =>
        prev.map((edge) => {
          if (edge.id !== selectedEdgeId) return edge
          // 先剥掉旧的展示键再合并：清除条件时 label/className 必须整体消失，
          // 而 exactOptionalPropertyTypes 下不允许用显式 undefined 覆盖。
          const { label: _label, className: _className, data: _data, ...rest } = edge
          return { ...rest, ...buildEdgeConditionProps(condition) }
        }),
      )
    },
    [selectedEdgeId, setEdges],
  )

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
    const edgeId = params.edges[0]?.id ?? null
    // 节点优先；边与节点互斥，点空白处保留上一次的节点选中（沿用原行为）。
    if (nodeId != null) {
      setSelectedNodeId(nodeId)
      setSelectedEdgeId(null)
      return
    }
    if (edgeId != null) {
      setSelectedEdgeId(edgeId)
      setSelectedNodeId(null)
      return
    }
    setSelectedEdgeId(null)
  }, [])

  const onNodesDelete = useCallback((deleted: Node[]) => {
    const deletedIds = new Set(deleted.map((node) => node.id))
    setSelectedNodeId((prev) => (prev != null && deletedIds.has(prev) ? null : prev))
  }, [])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const deletedIds = new Set(deleted.map((edge) => edge.id))
    setSelectedEdgeId((prev) => (prev != null && deletedIds.has(prev) ? null : prev))
  }, [])

  const contextMenuPosition = useCallback((event: MouseEvent | ReactMouseEvent) => {
    const rect = flowWrapRef.current?.getBoundingClientRect()
    if (rect == null) return null
    return {
      left: event.clientX - rect.left,
      top: event.clientY - rect.top,
    }
  }, [])

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: SparkFlowNode) => {
      const position = contextMenuPosition(event)
      if (position == null) return
      event.preventDefault()
      event.stopPropagation()
      setSelectedNodeId(node.id)
      setContextMenu({ kind: 'node', nodeId: node.id, ...position })
    },
    [contextMenuPosition],
  )

  const handleEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      const position = contextMenuPosition(event)
      if (position == null) return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({ kind: 'edge', edgeId: edge.id, ...position })
    },
    [contextMenuPosition],
  )

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      const rect = flowWrapRef.current?.getBoundingClientRect()
      const instance = flowInstanceRef.current
      if (rect == null || instance == null) return
      event.preventDefault()
      const flowPosition = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      setContextMenu({
        kind: 'pane',
        flowX: flowPosition.x,
        flowY: flowPosition.y,
        left: event.clientX - rect.left,
        top: event.clientY - rect.top,
      })
    },
    [],
  )

  const handleFlowInit = useCallback((instance: ReactFlowInstance<SparkFlowNode, Edge>) => {
    flowInstanceRef.current = instance
  }, [])

  if (screen === 'list' || draft == null) {
    return (
      <div className="workflow-layout workflow-home">
        <div className="workflow-home-head">
          <div>
            <div className="agents-title-lg">Workflows</div>
            <div className="agents-desc">管理可复用的 Agent 执行流程。</div>
          </div>
          <div className="agents-actions">
            <Button size="middle" type="text" loading={loading} disabled={loading} icon={loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />} onClick={() => void refresh()}>
              刷新
            </Button>
            {workflows.length > 0 && (
              <Button
                size="middle" 
                type={selectionMode ? 'primary' : 'text'}
                icon={<Icons.CheckSquare size={12} />}
                onClick={() => {
                  if (selectionMode) {
                    setSelectionMode(false)
                    clearSelection()
                    return
                  }
                  setSelectionMode(true)
                }}
              >
                {selectionMode ? '退出选择' : '选择'}
              </Button>
            )}
            <Button size="middle" type="text" icon={<Icons.Upload size={12} />} onClick={() => void handleImport()}>
              导入
            </Button>
            <Button size="middle" type="text" icon={<Icons.Download size={12} />} onClick={() => void exportWorkflowIds([])}>
              导出全部
            </Button>
            <Button size="middle" type="text" icon={<Icons.Layers size={12} />} onClick={() => setTemplatePickerOpen(true)}>
              模板库
            </Button>
            <Button size="middle" type="primary" icon={<Icons.Plus size={12} />} onClick={() => void createNewWorkflow()}>
              新建工作流
            </Button>
          </div>
        </div>
        {workflows.length > 0 ? (
          <>
            {selectionMode && visibleSelectedIds.size > 0 && (
              <div className="agents-selectbar" role="region" aria-label="工作流批量操作">
                <span className="agents-selectbar-count">已选 {visibleSelectedIds.size} 个</span>
                <span className="agents-selectbar-spacer" />
                <Button
                  size="middle"
                  type="text"
                  onClick={() => {
                    if (visibleSelectedIds.size === workflows.length) {
                      clearSelection()
                      return
                    }
                    setSelectedIds(new Set(workflows.map((workflow) => workflow.id)))
                  }}
                >
                  {visibleSelectedIds.size === workflows.length ? '取消全选' : '全选当前'}
                </Button>
                <Button size="middle" type="text" onClick={clearSelection}>
                  清空选择
                </Button>
                <Button
                  size="middle"
                  type="primary"
                  icon={<Icons.Download size={12} />}
                  onClick={() => void handleExportSelected()}
                >
                  导出选中
                </Button>
              </div>
            )}
            <div className="workflow-card-grid">
              {workflows.map((workflow) => (
                <WorkflowListCard
                  key={workflow.id}
                  workflow={workflow}
                  active={workflow.id === activeId}
                  selected={visibleSelectedIds.has(workflow.id)}
                  selectionMode={selectionMode}
                  onToggleSelect={() => toggleSelect(workflow.id)}
                  onOpen={() => openWorkflow(workflow)}
                  onExport={() => void exportWorkflowIds([workflow.id])}
                  onDelete={() => confirmDeleteWorkflow(workflow.name, () => void performDelete(workflow.id))}
                />
              ))}
            </div>
          </>
        ) : (
          !loading && (
            <div className="wf-empty-state">
              <div className="empty-state">
                <div className="empty-icon">
                  <Icons.Workflow size={24} />
                </div>
                <div className="empty-title">创建第一个工作流</div>
                <div className="empty-actions">
                  <Button type="primary" icon={<Icons.Plus size={12} />} onClick={() => void createNewWorkflow()}>
                    创建工作流
                  </Button>
                  <Button icon={<Icons.Layers size={12} />} onClick={() => setTemplatePickerOpen(true)}>
                    从模板开始
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
        <WorkflowTemplatePicker
          open={templatePickerOpen}
          onClose={() => setTemplatePickerOpen(false)}
          onPick={(template) => {
            setTemplatePickerOpen(false)
            void createWorkflowFromTemplate(template)
          }}
        />
      </div>
    )
  }

  return (
    <div className="workflow-layout workflow-builder workflow-builder-v2">
      <div className="wf-stage">
        <div className="wf-toolbar">
          <Button
            size="middle"
            type="text"
            onClick={showWorkflowList}
            title="返回列表"
            icon={<Icons.ArrowLeft size={12} />}
          >
            列表
          </Button>
          <LobeInput
            className="wf-title-input"
            size="middle"
            value={draft.name}
            onChange={(event) => patchDraftMeta({ name: event.target.value })}
            placeholder="工作流名称"
          />
          <LobeSelect
            className="wf-status-select"
            size="middle"
            value={draft.status}
            onChange={(value) => patchDraftMeta({ status: value as WorkflowStatus })}
            options={[
              { label: 'draft', value: 'draft' },
              { label: 'active', value: 'active' },
              { label: 'archived', value: 'archived' },
            ]}
          />
          <div className="wf-toolbar-spacer" />
          <Button
            size="middle"
            type="text"
            onClick={() => setPaletteOpen((open) => !open)}
            title="节点面板"
            icon={<Icons.Plus size={12} />}
          >
            节点
          </Button>
          <Button
            size="middle"
            type="text"
            onClick={toggleOrientation}
            title={orientation === 'vertical' ? '当前纵向编排，点击切换为横向' : '当前横向编排，点击切换为纵向'}
          >
            {orientation === 'vertical' ? '↕ 纵向' : '↔ 横向'}
          </Button>
          <Button size="middle" type="text" danger icon={<Icons.Trash size={12} />} onClick={() => void removeWorkflow()}>
            删除
          </Button>
          <Button size="middle" type="primary" icon={<Icons.Check size={12} />} onClick={() => void saveWorkflow()}>
            保存
          </Button>
        </div>

        <div className="wf-canvas-wrap">
          {paletteOpen && (
            <div className="wf-palette">
              <div className="wf-palette-title">节点类型</div>
              <div className="agents-empty-mini wf-palette-note">
                真实派发节点会执行 Agent；说明节点只产出结构化说明。
              </div>
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
                      <span className="wf-palette-label">
                        {meta.label}
                        <span className="wf-runtime-badge">{meta.runtimeLabel}</span>
                      </span>
                      <span className="wf-palette-hint">{meta.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="wf-flow" ref={flowWrapRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              onNodesDelete={onNodesDelete}
              onEdgesDelete={onEdgesDelete}
              onNodeContextMenu={handleNodeContextMenu}
              onEdgeContextMenu={handleEdgeContextMenu}
              onPaneContextMenu={handlePaneContextMenu}
              onPaneClick={closeContextMenu}
              onInit={handleFlowInit}
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
            <WorkflowContextMenu
              menu={contextMenu}
              onClose={closeContextMenu}
              onDuplicateNode={duplicateNode}
              onDeleteNode={removeNode}
              onDeleteEdge={removeEdge}
              onAddNode={addNodeAt}
            />
          </div>
        </div>
      </div>

      {selectedEdge != null ? (
        <WorkflowEdgeInspector
          edge={selectedEdge}
          nodes={nodes}
          onPatchCondition={patchSelectedEdgeCondition}
          onDelete={() => removeEdge(selectedEdge.id)}
        />
      ) : (
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
      )}
    </div>
  )
}

function WorkflowListCard({
  workflow,
  active,
  selected,
  selectionMode,
  onToggleSelect,
  onOpen,
  onExport,
  onDelete,
}: {
  workflow: WorkflowItem
  active: boolean
  selected: boolean
  selectionMode: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const visibleNodes = workflow.graph.nodes.slice(0, 4)
  const menuItems = {
    items: [
      {
        key: 'open',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Edit size={14} /> 打开编辑
          </span>
        ),
        onClick: onOpen,
      },
      {
        key: 'export',
        label: (
          <span className="agent-context-menu-item">
            <Icons.Download size={14} /> 导出
          </span>
        ),
        onClick: onExport,
      },
      {
        key: 'delete',
        label: (
          <span className="agent-context-menu-item danger">
            <Icons.Trash size={14} /> 删除
          </span>
        ),
        onClick: onDelete,
      },
    ],
  }

  const card = (
    <div
      className={`workflow-card ${active ? 'active' : ''}${selected ? ' is-selected' : ''}${selectionMode ? ' is-selecting' : ''}`}
      role="button"
      tabIndex={0}
      onClick={selectionMode ? onToggleSelect : onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (selectionMode) onToggleSelect()
          else onOpen()
        }
      }}
    >
      {selectionMode && (
        <label
          className="workflow-card-check"
          onClick={(event) => event.stopPropagation()}
          title={selected ? '取消选择' : '选择'}
        >
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </label>
      )}
      <span className="workflow-card-head">
        <span className="workflow-card-icon">
          <Icons.Workflow size={18} />
        </span>
        <span className={`wf-list-status status-${workflow.status}`}>{workflow.status}</span>
      </span>
      <span className="workflow-card-name">{workflow.name}</span>
      <span className="workflow-card-desc">{workflow.description || '自定义 Agent 执行流程'}</span>
      <span className="workflow-card-meta">
        <span>{workflow.graph.nodes.length} 节点</span>
        <span className="wf-list-dot" />
        <span>{workflow.graph.edges.length} 连线</span>
      </span>
      <span className="workflow-card-route">
        {visibleNodes.length > 0 ? (
          visibleNodes.map((node) => {
            const meta = getNodeKindMeta(node.kind)
            return (
              <span
                key={node.id}
                className="workflow-card-node"
                style={{ ['--node-accent' as string]: `var(${meta.accent})` }}
                title={`${node.title} · ${meta.runtimeLabel}`}
              >
                {meta.icon}
              </span>
            )
          })
        ) : (
          <span className="agents-empty-mini">暂无节点</span>
        )}
      </span>
      <button
        type="button"
        className="workflow-card-delete"
        title="删除工作流"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
      >
        <Icons.Trash size={13} />
      </button>
    </div>
  )

  return (
    <Dropdown trigger={['contextMenu']} menu={menuItems} placement="bottomLeft">
      {card}
    </Dropdown>
  )
}

function defaultStarterGraph(): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    {
      id: 'input-1',
      kind: 'input',
      title: '需求输入',
      x: 80,
      y: 80,
      config: { prompt: NODE_KIND_META.input.defaultPrompt, retryCount: 1 },
    },
  ]
  return {
    nodes,
    edges: [],
    orientation: 'vertical',
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
  const [loopBodyDraft, setLoopBodyDraft] = useState('')
  const [loopBodyError, setLoopBodyError] = useState('')

  useEffect(() => {
    if (node?.data.kind !== 'loop') {
      setLoopBodyDraft('')
      setLoopBodyError('')
      return
    }
    const body = isWorkflowGraphLike(node.data.config.body)
      ? node.data.config.body
      : defaultLoopBodyGraph()
    setLoopBodyDraft(JSON.stringify(body, null, 2))
    setLoopBodyError('')
  }, [node?.id, node?.data.kind, node?.data.config.body])

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
  const isAgent = node.data.kind === 'agent'
  const isSubagent = node.data.kind === 'subagent'
  const isVerify = node.data.kind === 'verify'
  const isLoop = node.data.kind === 'loop'
  const selectableAgents = agents.filter((agent) => agent.workflowId !== currentWorkflowId)
  const handleKindChange = (value: unknown) => {
    const kind = value as WorkflowNodeKind
    props.onPatch({ kind })
    if (kind === 'loop' && !isWorkflowGraphLike(config.body)) {
      props.onPatchConfig(defaultWorkflowNodeConfig('loop'))
    }
  }
  const patchLoopBodyDraft = (value: string) => {
    setLoopBodyDraft(value)
    try {
      const parsed = JSON.parse(value) as unknown
      if (!isWorkflowGraphLike(parsed)) {
        setLoopBodyError('循环体必须包含 nodes 和 edges 数组。')
        return
      }
      props.onPatchConfig({ body: parsed })
      setLoopBodyError('')
    } catch (error) {
      setLoopBodyError(error instanceof Error ? error.message : 'JSON 解析失败')
    }
  }
  const loopBreakCondition = isLoop ? config.breakCondition : undefined
  const loopBreakOp: EdgeConditionOpChoice = loopBreakCondition?.op ?? 'none'
  const loopBreakKey = loopBreakCondition?.key ?? ''
  const loopBreakNeedsValue = loopBreakOp === 'equals' || loopBreakOp === 'not_equals'
  const loopBreakValueText =
    loopBreakCondition != null &&
    (loopBreakCondition.op === 'equals' || loopBreakCondition.op === 'not_equals')
      ? formatEdgeConditionValue(loopBreakCondition.value)
      : ''
  const rebuildLoopBreakCondition = (
    nextOp: EdgeConditionOpChoice,
    nextKey: string,
    nextValueText: string,
  ): WorkflowEdgeCondition | undefined => {
    if (nextOp === 'none') return undefined
    if (nextOp === 'equals' || nextOp === 'not_equals') {
      return { op: nextOp, key: nextKey, value: parseEdgeConditionValue(nextValueText) }
    }
    return { op: nextOp, key: nextKey }
  }
  return (
    <div className="wf-inspector">
      <div className="wf-insp-head">
        <div className="wf-insp-icon" style={{ ['--node-accent' as string]: `var(${meta.accent})` }}>
          {meta.icon}
        </div>
        <div className="flex1">
          <div className="strong">{node.data.title}</div>
          <div className="muted wf-insp-role">
            {meta.label} 节点 · {meta.runtimeLabel}
          </div>
        </div>
        <button className="icon-btn" title="删除节点" onClick={props.onDelete}>
          <Icons.Trash size={13} />
        </button>
      </div>
      <div className="wf-insp-body scroll">
        <div className="wf-runtime-note">{meta.runtimeHint}</div>
        <InspectorField label="标题">
          <LobeInput value={node.data.title} onChange={(event) => props.onPatch({ title: event.target.value })} />
        </InspectorField>
        <InspectorField label="节点类型">
          <LobeSelect
            value={node.data.kind}
            onChange={handleKindChange}
            options={NODE_KIND_ORDER.map((kind) => ({ label: NODE_KIND_META[kind].label, value: kind }))}
          />
        </InspectorField>
        <InspectorField label="Provider">
          <LobeSelect
            value={String(config.providerProfileId ?? '')}
            onChange={(value) =>
              props.onPatchConfig({ providerProfileId: String(value) || null })
            }
            options={[
              { label: '继承 Agent', value: '' },
              ...providers.map((provider) => ({ label: provider.name, value: provider.id })),
            ]}
          />
        </InspectorField>
        <InspectorField label="模型">
          <LobeSelect
            value={String(config.modelId ?? '')}
            onChange={(value) => props.onPatchConfig({ modelId: String(value) || null })}
            options={[
              { label: '继承 Agent', value: '' },
              ...modelOptions.map((model) => ({ label: model, value: model })),
            ]}
          />
        </InspectorField>
        <InspectorField label="节点提示词">
          <LobeTextArea
            rows={6}
            value={String(config.prompt ?? '')}
            onChange={(event) => props.onPatchConfig({ prompt: event.target.value })}
          />
        </InspectorField>
        <InspectorField label="输出键 outputKey">
          <LobeInput
            placeholder="如 plan_result"
            value={String(config.outputKey ?? '')}
            onChange={(event) => {
              // 空串即"未配置"：运行时对空 outputKey 按无输出处理。
              props.onPatchConfig({ outputKey: event.target.value })
            }}
          />
          <div className="wf-field-help">下游节点的输入与连线条件都按此键读取本节点的输出。</div>
        </InspectorField>
        {isLoop && (
          <>
            <InspectorField label="最大迭代次数">
              <LobeInput
                type="number"
                min={1}
                max={50}
                value={Number(config.maxIterations ?? 5)}
                onChange={(event) => props.onPatchConfig({ maxIterations: Number(event.target.value) })}
              />
              <div className="wf-field-help">运行时硬上限为 50；中断后 v1 会从第 0 轮重新执行该 loop。</div>
            </InspectorField>
            <InspectorField label="循环变量 loopVar">
              <LobeInput
                placeholder="__loop_index"
                value={String(config.loopVar ?? '__loop_index')}
                onChange={(event) => props.onPatchConfig({ loopVar: event.target.value })}
              />
            </InspectorField>
            <InspectorField label="本轮产出 resultKey">
              <LobeInput
                placeholder="如 draft"
                value={String(config.resultKey ?? '')}
                onChange={(event) => props.onPatchConfig({ resultKey: event.target.value })}
              />
              <div className="wf-field-help">为空时运行时取循环体最后一个带 outputKey 的节点。</div>
            </InspectorField>
            <InspectorField label="收集所有轮次">
              <Switch
                size="small"
                checked={config.collectAll === true}
                onChange={(collectAll) => props.onPatchConfig({ collectAll })}
              />
              <div className="wf-field-help">开启后 outputKey 写入每轮 resultKey 的聚合文本；关闭则只写最后一轮。</div>
            </InspectorField>
            <InspectorField label="退出条件">
              <LobeSelect
                value={loopBreakOp}
                onChange={(value) =>
                  props.onPatchConfig({
                    breakCondition: rebuildLoopBreakCondition(
                      value as EdgeConditionOpChoice,
                      loopBreakKey,
                      loopBreakValueText,
                    ),
                  })
                }
                options={EDGE_CONDITION_OP_OPTIONS}
              />
            </InspectorField>
            {loopBreakOp !== 'none' && (
              <InspectorField label="退出状态键">
                <LobeInput
                  placeholder="如 verdict"
                  value={loopBreakKey}
                  onChange={(event) =>
                    props.onPatchConfig({
                      breakCondition: rebuildLoopBreakCondition(
                        loopBreakOp,
                        event.target.value,
                        loopBreakValueText,
                      ),
                    })
                  }
                />
              </InspectorField>
            )}
            {loopBreakNeedsValue && (
              <InspectorField label="退出比较值">
                <LobeInput
                  placeholder="如 pass / true / 42"
                  value={loopBreakValueText}
                  onChange={(event) =>
                    props.onPatchConfig({
                      breakCondition: rebuildLoopBreakCondition(
                        loopBreakOp,
                        loopBreakKey,
                        event.target.value,
                      ),
                    })
                  }
                />
                <div className="wf-field-help">true/false 按布尔、null 按空值、纯数字按数值比较，其余按字符串。</div>
              </InspectorField>
            )}
            <InspectorField label="循环体 JSON">
              <LobeTextArea
                rows={8}
                value={loopBodyDraft}
                onChange={(event) => patchLoopBodyDraft(event.target.value)}
              />
              {loopBodyError.length > 0 ? (
                <div className="wf-field-help wf-field-warn">{loopBodyError}</div>
              ) : (
                <div className="wf-field-help">循环体是独立 WorkflowGraph；v1 不支持在 body 内再放 loop。</div>
              )}
            </InspectorField>
          </>
        )}
        {isAgent && (
          <InspectorField label="执行 Agent">
            <LobeSelect
              value={String(config.agentId ?? '')}
              onChange={(value) => props.onPatchConfig({ agentId: String(value) || null })}
              options={[
                { label: '宿主 Agent（当前会话）', value: '' },
                ...selectableAgents.map((agent) => ({ label: agent.name, value: agent.id })),
              ]}
            />
          </InspectorField>
        )}
        {isSubagent && (
          <>
            <InspectorField label="子代理">
              <LobeSelect
                value={String(config.agentId ?? '')}
                onChange={(value) => props.onPatchConfig({ agentId: String(value) || null })}
                options={[
                  { label: '生成临时子代理', value: '' },
                  ...selectableAgents.map((agent) => ({ label: agent.name, value: agent.id })),
                ]}
              />
            </InspectorField>
            <InspectorField label="并发数">
              <LobeInput
                type="number"
                min={1}
                max={8}
                value={Number(config.parallelism ?? 1)}
                onChange={(event) => props.onPatchConfig({ parallelism: Number(event.target.value) })}
              />
              <div className="agent-field-hint">parallelism≥2 时该子代理节点并发执行 N 次，结果按分支拼接。</div>
            </InspectorField>
            <InspectorField label="工具">
              <TagPicker
                items={WORKFLOW_RESTRICTABLE_TOOLS.map((tool) => ({ id: tool.name, label: tool.label }))}
                selected={asStringArray(config.toolIds)}
                onChange={(toolIds) => props.onPatchConfig({ toolIds })}
              />
            </InspectorField>
          </>
        )}
        {isVerify && (
          <InspectorField label="验证命令">
            <LobeTextArea
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
        <InspectorField label="MCP">
          <TagPicker
            items={mcpServers.map((server) => ({ id: server.id, label: server.name }))}
            selected={asStringArray(config.mcpServerIds)}
            onChange={(mcpServerIds) => props.onPatchConfig({ mcpServerIds })}
          />
        </InspectorField>
        <InspectorField label="重试次数">
          <LobeInput
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

type EdgeConditionOpChoice = WorkflowEdgeCondition['op'] | 'none'

const EDGE_CONDITION_OP_OPTIONS: Array<{ label: string; value: EdgeConditionOpChoice }> = [
  { label: '无条件（总是执行）', value: 'none' },
  { label: '键存在 exists', value: 'exists' },
  { label: '为真 truthy', value: 'truthy' },
  { label: '为假 falsy', value: 'falsy' },
  { label: '等于 equals', value: 'equals' },
  { label: '不等于 not_equals', value: 'not_equals' },
]

/**
 * 比较值解析启发式：true/false → 布尔，null → null，纯数字 → number，其余按原字符串。
 * 运行时按严格等值（===）比较工作流状态，所以类型必须还原，不能一律存字符串。
 */
function parseEdgeConditionValue(raw: string): string | number | boolean | null {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (trimmed.length > 0 && !Number.isNaN(Number(trimmed))) return Number(trimmed)
  return raw
}

function formatEdgeConditionValue(value: string | number | boolean | null | undefined): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  return String(value)
}

/** 选中连线时的右侧检查器：编辑边条件（条件分支）或删除连线。 */
function WorkflowEdgeInspector({
  edge,
  nodes,
  onPatchCondition,
  onDelete,
}: {
  edge: Edge
  nodes: SparkFlowNode[]
  onPatchCondition: (condition: WorkflowEdgeCondition | undefined) => void
  onDelete: () => void
}) {
  const condition = (edge.data as SparkEdgeData | undefined)?.condition
  const sourceNode = nodes.find((node) => node.id === edge.source) ?? null
  const targetNode = nodes.find((node) => node.id === edge.target) ?? null
  const sourceOutputKey =
    typeof sourceNode?.data.config.outputKey === 'string' ? sourceNode.data.config.outputKey.trim() : ''
  const op: EdgeConditionOpChoice = condition?.op ?? 'none'
  const key = condition?.key ?? ''
  const needsValue = op === 'equals' || op === 'not_equals'
  const valueText =
    condition != null && (condition.op === 'equals' || condition.op === 'not_equals')
      ? formatEdgeConditionValue(condition.value)
      : ''

  const rebuild = (
    nextOp: EdgeConditionOpChoice,
    nextKey: string,
    nextValueText: string,
  ): WorkflowEdgeCondition | undefined => {
    if (nextOp === 'none') return undefined
    if (nextOp === 'equals' || nextOp === 'not_equals') {
      return { op: nextOp, key: nextKey, value: parseEdgeConditionValue(nextValueText) }
    }
    return { op: nextOp, key: nextKey }
  }

  return (
    <div className="wf-inspector">
      <div className="wf-insp-head">
        <div className="wf-insp-icon" style={{ ['--node-accent' as string]: 'var(--warning)' }}>
          <Icons.Branch size={14} />
        </div>
        <div className="flex1">
          <div className="strong">连线</div>
          <div className="muted wf-insp-role">
            {sourceNode?.data.title ?? edge.source} → {targetNode?.data.title ?? edge.target}
          </div>
        </div>
        <button className="icon-btn" title="删除连线" onClick={onDelete}>
          <Icons.Trash size={13} />
        </button>
      </div>
      <div className="wf-insp-body scroll">
        <div className="wf-runtime-note">
          条件按工作流状态求值：不满足时本连线不通，目标节点因此不可达则整段下游被跳过。状态键来自上游节点的「输出键 outputKey」。
        </div>
        <InspectorField label="触发条件">
          <LobeSelect
            value={op}
            onChange={(value) => onPatchCondition(rebuild(value as EdgeConditionOpChoice, key, valueText))}
            options={EDGE_CONDITION_OP_OPTIONS}
          />
        </InspectorField>
        {op !== 'none' && (
          <InspectorField label="状态键">
            <LobeInput
              placeholder={sourceOutputKey.length > 0 ? `如上游输出键：${sourceOutputKey}` : '上游节点的输出键'}
              value={key}
              onChange={(event) => onPatchCondition(rebuild(op, event.target.value, valueText))}
            />
            {key.trim().length === 0 && (
              <div className="wf-field-help wf-field-warn">状态键为空时条件不生效（保存后会被忽略）。</div>
            )}
          </InspectorField>
        )}
        {needsValue && (
          <InspectorField label="比较值">
            <LobeInput
              placeholder="如 true / 42 / done"
              value={valueText}
              onChange={(event) => onPatchCondition(rebuild(op, key, event.target.value))}
            />
            <div className="wf-field-help">true/false 按布尔、null 按空值、纯数字按数值比较，其余按字符串。</div>
          </InspectorField>
        )}
      </div>
    </div>
  )
}

function InspectorField({ label, children }: { label: string; children: ReactNode }) {
  // 不用 <label> 包 children：label 元素会拦截内部 click，
  // 在 select / popover 等控件里会导致下拉"点不出来"。
  // 复用 AgentsView 的 .agent-field 写法 —— lobe-ui (antd-based) 控件
  // 自带 variant 样式，宽度由 .agent-field .ant-* 规则兜底为 100%。
  return (
    <div className="agent-field">
      <span className="agent-field-label">{label}</span>
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
