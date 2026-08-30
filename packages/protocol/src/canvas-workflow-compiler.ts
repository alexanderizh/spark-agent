import type {
  CanvasWorkflowEdge,
  CanvasWorkflowNodeKind,
  CanvasWorkflowPackage,
} from './canvas-workflow.js'
import { CanvasOperationTypeSchema } from './media-config.js'

export type CanvasWorkflowDiagnosticSeverity = 'error' | 'warning'

export interface CanvasWorkflowDiagnostic {
  code:
    | 'graph_empty'
    | 'duplicate_node_id'
    | 'duplicate_edge_id'
    | 'duplicate_contract_id'
    | 'edge_source_missing'
    | 'edge_target_missing'
    | 'input_target_missing'
    | 'output_source_missing'
    | 'param_node_missing'
    | 'operation_invalid'
    | 'graph_cycle'
    | 'subworkflow_id_missing'
    | 'subworkflow_version_missing'
    | 'subworkflow_resolver_required'
    | 'subworkflow_missing'
    | 'subworkflow_recursion'
  severity: CanvasWorkflowDiagnosticSeverity
  message: string
  path?: string
  nodeId?: string
  nodeIds?: string[]
  edgeId?: string
  contractId?: string
  workflowId?: string
  workflowIds?: string[]
}

export interface CanvasWorkflowExecutionStep {
  nodeId: string
  kind: CanvasWorkflowNodeKind
  label: string
  config: Readonly<Record<string, unknown>>
  dependsOnNodeIds: readonly string[]
  incomingEdges: readonly Readonly<CanvasWorkflowEdge>[]
  outgoingEdges: readonly Readonly<CanvasWorkflowEdge>[]
}

export interface CanvasWorkflowExecutionPlan {
  schemaVersion: 1
  nodeOrder: readonly string[]
  steps: readonly CanvasWorkflowExecutionStep[]
  contract: Readonly<CanvasWorkflowPackage['contract']>
  dependencies: Readonly<CanvasWorkflowPackage['dependencies']>
}

export interface CompileCanvasWorkflowOptions {
  workflowId?: string
  resolveSubworkflowPackage?: (
    workflowId: string,
    workflowVersion: number,
  ) => CanvasWorkflowPackage | null
}

export type CompileCanvasWorkflowResult =
  | {
      ok: true
      plan: Readonly<CanvasWorkflowExecutionPlan>
      diagnostics: readonly CanvasWorkflowDiagnostic[]
    }
  | {
      ok: false
      diagnostics: readonly CanvasWorkflowDiagnostic[]
    }

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    ) as T
  }
  return value
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const item of Object.values(value)) {
    deepFreeze(item)
  }
  return value
}

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

function subworkflowId(config: Record<string, unknown>): string | null {
  const value = config.workflowId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function subworkflowVersion(config: Record<string, unknown>): number | null {
  const value = config.workflowVersion
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function validateSubworkflowReferences(
  workflowPackage: CanvasWorkflowPackage,
  options: CompileCanvasWorkflowOptions,
  diagnostics: CanvasWorkflowDiagnostic[],
): void {
  const rootId = options.workflowId ?? '$root'
  const expanded = new Set<string>()
  const emitted = new Set<string>()

  const pushOnce = (key: string, diagnostic: CanvasWorkflowDiagnostic): void => {
    if (emitted.has(key)) return
    emitted.add(key)
    diagnostics.push(diagnostic)
  }

  const visit = (
    currentPackage: CanvasWorkflowPackage,
    currentWorkflowId: string,
    currentWorkflowVersion: number | '$root',
    stack: string[],
  ): void => {
    const expansionKey = `${currentWorkflowId}@${currentWorkflowVersion}`
    if (expanded.has(expansionKey)) return
    expanded.add(expansionKey)

    for (const node of currentPackage.graph.nodes) {
      if (node.kind !== 'canvas_subworkflow') continue
      const referencedWorkflowId = subworkflowId(node.config)
      if (!referencedWorkflowId) {
        pushOnce(`${currentWorkflowId}:${node.id}:id`, {
          code: 'subworkflow_id_missing',
          severity: 'error',
          message: `子工作流节点“${node.label}”缺少 workflowId`,
          nodeId: node.id,
          path: `graph.nodes.${node.id}.config.workflowId`,
        })
        continue
      }
      const referencedWorkflowVersion = subworkflowVersion(node.config)
      if (!referencedWorkflowVersion) {
        pushOnce(`${currentWorkflowId}:${node.id}:version`, {
          code: 'subworkflow_version_missing',
          severity: 'error',
          message: `子工作流节点“${node.label}”缺少有效的 workflowVersion`,
          nodeId: node.id,
          workflowId: referencedWorkflowId,
          path: `graph.nodes.${node.id}.config.workflowVersion`,
        })
        continue
      }

      const recursionIndex = stack.indexOf(referencedWorkflowId)
      if (recursionIndex >= 0) {
        const workflowIds = [...stack.slice(recursionIndex), referencedWorkflowId]
        pushOnce(`recursion:${workflowIds.join('>')}`, {
          code: 'subworkflow_recursion',
          severity: 'error',
          message: `子工作流存在递归引用：${workflowIds.join(' -> ')}`,
          nodeId: node.id,
          workflowId: referencedWorkflowId,
          workflowIds,
        })
        continue
      }

      if (!options.resolveSubworkflowPackage) {
        pushOnce(`${currentWorkflowId}:${node.id}:resolver`, {
          code: 'subworkflow_resolver_required',
          severity: 'error',
          message: `无法在缺少定义解析器时验证子工作流“${referencedWorkflowId}”`,
          nodeId: node.id,
          workflowId: referencedWorkflowId,
        })
        continue
      }

      const referencedPackage = options.resolveSubworkflowPackage(
        referencedWorkflowId,
        referencedWorkflowVersion,
      )
      if (!referencedPackage) {
        pushOnce(`${currentWorkflowId}:${node.id}:missing:${referencedWorkflowId}`, {
          code: 'subworkflow_missing',
          severity: 'error',
          message: `找不到子工作流“${referencedWorkflowId}”`,
          nodeId: node.id,
          workflowId: referencedWorkflowId,
        })
        continue
      }
      visit(referencedPackage, referencedWorkflowId, referencedWorkflowVersion, [
        ...stack,
        referencedWorkflowId,
      ])
    }
  }

  visit(workflowPackage, rootId, '$root', [rootId])
}

export function compileCanvasWorkflowPackage(
  workflowPackage: CanvasWorkflowPackage,
  options: CompileCanvasWorkflowOptions = {},
): CompileCanvasWorkflowResult {
  const diagnostics: CanvasWorkflowDiagnostic[] = []
  const { nodes, edges } = workflowPackage.graph

  if (nodes.length === 0) {
    diagnostics.push({
      code: 'graph_empty',
      severity: 'error',
      message: '画布工作流至少需要一个节点',
      path: 'graph.nodes',
    })
  }

  for (const id of duplicateIds(nodes.map((node) => node.id))) {
    diagnostics.push({
      code: 'duplicate_node_id',
      severity: 'error',
      message: `节点 ID 重复：${id}`,
      nodeId: id,
      path: 'graph.nodes',
    })
  }
  for (const id of duplicateIds(edges.map((edge) => edge.id))) {
    diagnostics.push({
      code: 'duplicate_edge_id',
      severity: 'error',
      message: `连线 ID 重复：${id}`,
      edgeId: id,
      path: 'graph.edges',
    })
  }

  const contractIds = [
    ...workflowPackage.contract.inputs.map((item) => item.id),
    ...workflowPackage.contract.outputs.map((item) => item.id),
    ...workflowPackage.contract.exposedParams.map((item) => item.id),
  ]
  for (const id of duplicateIds(contractIds)) {
    diagnostics.push({
      code: 'duplicate_contract_id',
      severity: 'error',
      message: `输入、输出或暴露参数 ID 重复：${id}`,
      contractId: id,
      path: 'contract',
    })
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const validEdges: CanvasWorkflowEdge[] = []
  for (const edge of edges) {
    const sourceExists = nodeIds.has(edge.sourceNodeId)
    const targetExists = nodeIds.has(edge.targetNodeId)
    if (!sourceExists) {
      diagnostics.push({
        code: 'edge_source_missing',
        severity: 'error',
        message: `连线“${edge.id}”的起点节点不存在`,
        edgeId: edge.id,
        nodeId: edge.sourceNodeId,
        path: `graph.edges.${edge.id}.sourceNodeId`,
      })
    }
    if (!targetExists) {
      diagnostics.push({
        code: 'edge_target_missing',
        severity: 'error',
        message: `连线“${edge.id}”的终点节点不存在`,
        edgeId: edge.id,
        nodeId: edge.targetNodeId,
        path: `graph.edges.${edge.id}.targetNodeId`,
      })
    }
    if (sourceExists && targetExists) validEdges.push(edge)
  }

  for (const input of workflowPackage.contract.inputs) {
    if (input.targetNodeId && !nodeIds.has(input.targetNodeId)) {
      diagnostics.push({
        code: 'input_target_missing',
        severity: 'error',
        message: `输入“${input.name}”引用的目标节点不存在`,
        contractId: input.id,
        nodeId: input.targetNodeId,
        path: `contract.inputs.${input.id}.targetNodeId`,
      })
    }
  }
  for (const output of workflowPackage.contract.outputs) {
    if (output.sourceNodeId && !nodeIds.has(output.sourceNodeId)) {
      diagnostics.push({
        code: 'output_source_missing',
        severity: 'error',
        message: `输出“${output.name}”引用的来源节点不存在`,
        contractId: output.id,
        nodeId: output.sourceNodeId,
        path: `contract.outputs.${output.id}.sourceNodeId`,
      })
    }
  }
  for (const param of workflowPackage.contract.exposedParams) {
    if (!nodeIds.has(param.nodeId)) {
      diagnostics.push({
        code: 'param_node_missing',
        severity: 'error',
        message: `参数“${param.name}”引用的节点不存在`,
        contractId: param.id,
        nodeId: param.nodeId,
        path: `contract.exposedParams.${param.id}.nodeId`,
      })
    }
  }
  for (const node of nodes) {
    if (node.kind !== 'canvas_operation') continue
    if (!CanvasOperationTypeSchema.safeParse(node.config.operation).success) {
      diagnostics.push({
        code: 'operation_invalid',
        severity: 'error',
        message: `操作节点“${node.label}”未映射到受支持的画布操作`,
        nodeId: node.id,
        path: `graph.nodes.${node.id}.config.operation`,
      })
    }
  }

  const outgoing = new Map<string, CanvasWorkflowEdge[]>()
  const incoming = new Map<string, CanvasWorkflowEdge[]>()
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of validEdges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
    incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) ?? []), edge])
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
  }

  const pending = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  const nodeOrder: string[] = []
  while (pending.length > 0) {
    const nodeId = pending.shift()!
    nodeOrder.push(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) {
      const nextIndegree = (indegree.get(edge.targetNodeId) ?? 0) - 1
      indegree.set(edge.targetNodeId, nextIndegree)
      if (nextIndegree === 0) pending.push(edge.targetNodeId)
    }
  }
  if (nodeOrder.length !== nodes.length && nodes.length > 0) {
    const cycleNodeIds = nodes
      .filter((node) => (indegree.get(node.id) ?? 0) > 0)
      .map((node) => node.id)
    diagnostics.push({
      code: 'graph_cycle',
      severity: 'error',
      message: `画布工作流不是可执行 DAG，环涉及节点：${cycleNodeIds.join('、')}`,
      nodeIds: cycleNodeIds,
      path: 'graph.edges',
    })
  }

  validateSubworkflowReferences(workflowPackage, options, diagnostics)

  if (diagnostics.some((item) => item.severity === 'error')) {
    return deepFreeze({ ok: false as const, diagnostics: cloneValue(diagnostics) })
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const steps = nodeOrder.map((nodeId): CanvasWorkflowExecutionStep => {
    const node = nodesById.get(nodeId)!
    const incomingEdges = incoming.get(nodeId) ?? []
    return {
      nodeId,
      kind: node.kind,
      label: node.label,
      config: cloneValue(node.config),
      dependsOnNodeIds: [...new Set(incomingEdges.map((edge) => edge.sourceNodeId))],
      incomingEdges: cloneValue(incomingEdges),
      outgoingEdges: cloneValue(outgoing.get(nodeId) ?? []),
    }
  })
  const plan: CanvasWorkflowExecutionPlan = {
    schemaVersion: 1,
    nodeOrder,
    steps,
    contract: cloneValue(workflowPackage.contract),
    dependencies: cloneValue(workflowPackage.dependencies),
  }

  return deepFreeze({
    ok: true as const,
    plan,
    diagnostics: cloneValue(diagnostics),
  })
}
