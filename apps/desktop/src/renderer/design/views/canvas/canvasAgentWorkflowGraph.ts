import { getCanvasCapability, isOperationNode, nodeOperation } from './canvas.capabilities'
import {
  AUDIO_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  OPERATION_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  VIDEO_NODE_DEFAULT_SIZE,
} from './canvasNodeSize'
import type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  CanvasOperationType,
} from './canvas.types'
import type { EdgeBlueprint, NodeBlueprint } from './canvasTemplates'

export type CanvasAgentWorkflowInputType = 'text' | 'prompt' | 'image' | 'video' | 'audio'
export type CanvasAgentWorkflowOutputType = CanvasAgentWorkflowInputType

export type CanvasAgentWorkflowInputNodeSpec = {
  ref: string
  role: 'input'
  type: CanvasAgentWorkflowInputType
  title: string
  content?: string
  optional?: boolean
}

export type CanvasAgentWorkflowOperationNodeSpec = {
  ref: string
  role: 'operation'
  operation: CanvasOperationType
  title: string
  dependsOn?: string[]
  prompt?: string
  negativePrompt?: string
  systemPrompt?: string
  modelParams?: Record<string, unknown>
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  agentId?: string
  isOutput?: boolean
  expectedOutputTypes?: CanvasAgentWorkflowOutputType[]
}

export type CanvasAgentWorkflowNoteNodeSpec = {
  ref: string
  role: 'note'
  type?: 'text' | 'prompt'
  title: string
  content?: string
}

export type CanvasAgentWorkflowNodeSpec =
  | CanvasAgentWorkflowInputNodeSpec
  | CanvasAgentWorkflowOperationNodeSpec
  | CanvasAgentWorkflowNoteNodeSpec

export type CanvasAgentWorkflowGraphSpec = {
  name: string
  description?: string
  nodes: CanvasAgentWorkflowNodeSpec[]
}

export type CanvasWorkflowGraphDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  nodeRef?: string
  relatedRefs?: string[]
  suggestion?: string
}

export type CanvasAgentWorkflowValidation = {
  valid: boolean
  inputRefs: string[]
  outputRefs: string[]
  diagnostics: CanvasWorkflowGraphDiagnostic[]
}

export type CanvasAgentWorkflowObstacle = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type CanvasAgentWorkflowBlueprint = CanvasAgentWorkflowValidation & {
  originX: number
  originY: number
  nodes: NodeBlueprint[]
  edges: EdgeBlueprint[]
}

export type CanvasWorkflowSubgraphValidation = {
  valid: boolean
  checkedNodeIds: string[]
  inputNodeIds: string[]
  outputNodeIds: string[]
  diagnostics: CanvasWorkflowGraphDiagnostic[]
}

const HORIZONTAL_GAP = 96
const VERTICAL_GAP = 64
const CANVAS_MARGIN = 80

function operationDependencies(node: CanvasAgentWorkflowNodeSpec): string[] {
  return node.role === 'operation' ? Array.from(new Set(node.dependsOn ?? [])) : []
}

function operationOutputs(node: CanvasAgentWorkflowOperationNodeSpec): CanvasAgentWorkflowOutputType[] {
  return (getCanvasCapability(node.operation)?.outputTypes ?? []) as CanvasAgentWorkflowOutputType[]
}

function sourceOutputTypes(node: CanvasAgentWorkflowNodeSpec): CanvasAgentWorkflowOutputType[] {
  if (node.role === 'input') return [node.type]
  if (node.role === 'operation') return operationOutputs(node)
  return []
}

function pushDiagnostic(
  diagnostics: CanvasWorkflowGraphDiagnostic[],
  diagnostic: CanvasWorkflowGraphDiagnostic,
): void {
  const key = `${diagnostic.code}:${diagnostic.nodeRef ?? ''}:${(diagnostic.relatedRefs ?? []).join(',')}`
  if (
    diagnostics.some(
      (item) => `${item.code}:${item.nodeRef ?? ''}:${(item.relatedRefs ?? []).join(',')}` === key,
    )
  ) {
    return
  }
  diagnostics.push(diagnostic)
}

function reachable(start: string, adjacency: ReadonlyMap<string, readonly string[]>): Set<string> {
  const visited = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) queue.push(next)
  }
  return visited
}

function findCycle(
  refs: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[] | null {
  const visited = new Set<string>()
  const active = new Set<string>()
  const stack: string[] = []

  const visit = (ref: string): string[] | null => {
    if (active.has(ref)) {
      const index = stack.indexOf(ref)
      return [...stack.slice(Math.max(0, index)), ref]
    }
    if (visited.has(ref)) return null
    visited.add(ref)
    active.add(ref)
    stack.push(ref)
    for (const next of adjacency.get(ref) ?? []) {
      const cycle = visit(next)
      if (cycle) return cycle
    }
    stack.pop()
    active.delete(ref)
    return null
  }

  for (const ref of refs) {
    const cycle = visit(ref)
    if (cycle) return cycle
  }
  return null
}

export function validateCanvasAgentWorkflowGraph(
  spec: CanvasAgentWorkflowGraphSpec,
): CanvasAgentWorkflowValidation {
  const diagnostics: CanvasWorkflowGraphDiagnostic[] = []
  const nodeByRef = new Map<string, CanvasAgentWorkflowNodeSpec>()
  const duplicateRefs = new Set<string>()

  for (const node of spec.nodes) {
    const ref = node.ref.trim()
    if (!ref) {
      pushDiagnostic(diagnostics, {
        severity: 'error',
        code: 'empty_ref',
        message: '工作流节点 ref 不能为空',
        suggestion: '为每个节点提供稳定且唯一的 ref。',
      })
      continue
    }
    if (nodeByRef.has(ref)) duplicateRefs.add(ref)
    else nodeByRef.set(ref, node)
  }

  for (const ref of duplicateRefs) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'duplicate_ref',
      nodeRef: ref,
      message: `工作流节点 ref 重复：${ref}`,
      suggestion: '修改 ref，确保每个节点可被依赖关系唯一引用。',
    })
  }

  const flowNodes = [...nodeByRef.values()].filter((node) => node.role !== 'note')
  const inputRefs = flowNodes.filter((node) => node.role === 'input').map((node) => node.ref)
  const operationNodes = flowNodes.filter(
    (node): node is CanvasAgentWorkflowOperationNodeSpec => node.role === 'operation',
  )

  if (inputRefs.length === 0) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'missing_input_boundary',
      message: '可复用工作流至少需要一个输入边界',
      suggestion: '增加文本、Prompt 或空媒体输入节点。',
    })
  }
  if (operationNodes.length === 0) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'missing_operation',
      message: '可复用工作流至少需要一个操作节点',
      suggestion: '增加一个可执行的画布 AI 操作。',
    })
  }

  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  for (const ref of nodeByRef.keys()) {
    adjacency.set(ref, [])
    reverse.set(ref, [])
    incomingCount.set(ref, 0)
  }

  for (const operation of operationNodes) {
    const capability = getCanvasCapability(operation.operation)
    if (!capability?.enabled) {
      pushDiagnostic(diagnostics, {
        severity: 'error',
        code: 'unsupported_operation',
        nodeRef: operation.ref,
        message: `操作 ${operation.operation} 当前不可用`,
        suggestion: '调用 canvas_list_capabilities 后选择已启用的操作。',
      })
    }

    for (const dependencyRef of operationDependencies(operation)) {
      if (dependencyRef === operation.ref) {
        pushDiagnostic(diagnostics, {
          severity: 'error',
          code: 'self_dependency',
          nodeRef: operation.ref,
          relatedRefs: [dependencyRef],
          message: `节点 ${operation.ref} 不能依赖自身`,
          suggestion: '删除自连接并指定真实上游节点。',
        })
        continue
      }
      const dependency = nodeByRef.get(dependencyRef)
      if (!dependency) {
        pushDiagnostic(diagnostics, {
          severity: 'error',
          code: 'missing_dependency',
          nodeRef: operation.ref,
          relatedRefs: [dependencyRef],
          message: `节点 ${operation.ref} 引用了不存在的上游 ${dependencyRef}`,
          suggestion: '修正 dependsOn，或补充对应输入/操作节点。',
        })
        continue
      }
      if (dependency.role === 'note') {
        pushDiagnostic(diagnostics, {
          severity: 'error',
          code: 'note_used_as_flow_input',
          nodeRef: operation.ref,
          relatedRefs: [dependencyRef],
          message: `说明节点 ${dependencyRef} 不能作为流程输入`,
          suggestion: '将其改为 input 节点，或从 dependsOn 中移除。',
        })
        continue
      }
      adjacency.get(dependencyRef)?.push(operation.ref)
      reverse.get(operation.ref)?.push(dependencyRef)
      incomingCount.set(operation.ref, (incomingCount.get(operation.ref) ?? 0) + 1)

      if (capability) {
        const providedTypes = sourceOutputTypes(dependency)
        if (!providedTypes.some((type) => capability.inputTypes.includes(type))) {
          pushDiagnostic(diagnostics, {
            severity: 'error',
            code: 'incompatible_input_type',
            nodeRef: operation.ref,
            relatedRefs: [dependencyRef],
            message: `${dependencyRef} 的输出类型 ${providedTypes.join('/')} 不能作为 ${operation.operation} 的输入`,
            suggestion: `改用以下输入类型之一：${capability.inputTypes.join('、')}。`,
          })
        }
      }
    }

    if ((incomingCount.get(operation.ref) ?? 0) === 0) {
      pushDiagnostic(diagnostics, {
        severity: 'error',
        code: 'operation_missing_input',
        nodeRef: operation.ref,
        message: `操作节点 ${operation.ref} 没有有效上游输入`,
        suggestion: '通过 dependsOn 连接输入节点或上游操作节点。',
      })
    }
    if (!operation.prompt?.trim() && operation.operation !== 'audio_transcribe') {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'operation_prompt_empty',
        nodeRef: operation.ref,
        message: `操作节点 ${operation.ref} 尚未填写提示词`,
        suggestion: '补充可复用的默认提示词，或明确由用户运行前输入。',
      })
    }
    if (!operation.modelId && !operation.manifestId && !operation.agentId) {
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'operation_model_unbound',
        nodeRef: operation.ref,
        message: `操作节点 ${operation.ref} 尚未绑定模型`,
        suggestion: '可保留为空并在运行前选择，也可写入默认模型配置。',
      })
    }
  }

  const cycle = findCycle(
    flowNodes.map((node) => node.ref),
    adjacency,
  )
  if (cycle) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'cycle',
      relatedRefs: cycle,
      message: `工作流存在环路：${cycle.join(' -> ')}`,
      suggestion: '移除环路中的一条依赖，当前画布工作流仅支持 DAG。',
    })
  }

  const explicitOutputs = operationNodes.filter((node) => node.isOutput).map((node) => node.ref)
  const inferredOutputs = operationNodes
    .filter((node) => (adjacency.get(node.ref) ?? []).length === 0)
    .map((node) => node.ref)
  const outputRefs = explicitOutputs.length > 0 ? explicitOutputs : inferredOutputs

  if (outputRefs.length === 0 && operationNodes.length > 0) {
    pushDiagnostic(diagnostics, {
      severity: 'error',
      code: 'missing_output_boundary',
      message: '工作流没有可识别的输出操作节点',
      suggestion: '将至少一个终点操作标记为 isOutput。',
    })
  }

  for (const outputRef of outputRefs) {
    const output = nodeByRef.get(outputRef)
    if (output?.role !== 'operation') continue
    const supported = operationOutputs(output)
    for (const expected of output.expectedOutputTypes ?? []) {
      if (!supported.includes(expected)) {
        pushDiagnostic(diagnostics, {
          severity: 'error',
          code: 'incompatible_output_type',
          nodeRef: output.ref,
          message: `${output.operation} 不能生成声明的 ${expected} 输出`,
          suggestion: `该操作支持的输出类型为：${supported.join('、')}。`,
        })
      }
    }
  }

  const reachableFromInputs = new Set<string>()
  for (const inputRef of inputRefs) {
    for (const ref of reachable(inputRef, adjacency)) reachableFromInputs.add(ref)
  }
  const canReachOutput = new Set<string>()
  for (const outputRef of outputRefs) {
    for (const ref of reachable(outputRef, reverse)) canReachOutput.add(ref)
  }

  for (const operation of operationNodes) {
    if (!reachableFromInputs.has(operation.ref)) {
      pushDiagnostic(diagnostics, {
        severity: 'error',
        code: 'operation_not_reachable_from_input',
        nodeRef: operation.ref,
        message: `操作节点 ${operation.ref} 不在任何输入路径上`,
        suggestion: '连接一个输入边界或可达的上游操作。',
      })
    }
    if (!canReachOutput.has(operation.ref)) {
      pushDiagnostic(diagnostics, {
        severity: 'error',
        code: 'operation_cannot_reach_output',
        nodeRef: operation.ref,
        message: `操作节点 ${operation.ref} 无法到达任何输出边界`,
        suggestion: '连接到下游操作，或将合法终点标记为 isOutput。',
      })
    }
  }

  for (const inputRef of inputRefs) {
    if (!canReachOutput.has(inputRef)) {
      pushDiagnostic(diagnostics, {
        severity: 'error',
        code: 'input_cannot_reach_output',
        nodeRef: inputRef,
        message: `输入节点 ${inputRef} 未接入可执行输出路径`,
        suggestion: '把该输入连接到需要它的操作节点，或将其改为 note。',
      })
    }
  }

  return {
    valid: !diagnostics.some((item) => item.severity === 'error'),
    inputRefs,
    outputRefs,
    diagnostics,
  }
}

function nodeSize(node: CanvasAgentWorkflowNodeSpec): { width: number; height: number } {
  if (node.role === 'operation') return OPERATION_NODE_DEFAULT_SIZE
  const type = node.type ?? 'text'
  if (type === 'image') return IMAGE_NODE_DEFAULT_SIZE
  if (type === 'video') return VIDEO_NODE_DEFAULT_SIZE
  if (type === 'audio') return AUDIO_NODE_DEFAULT_SIZE
  return TEXT_NODE_DEFAULT_SIZE
}

function blueprintData(node: CanvasAgentWorkflowNodeSpec): Partial<CanvasNodeData> {
  if (node.role === 'input') {
    const textData =
      node.type === 'text' || node.type === 'prompt'
        ? { text: node.content ?? '', ...(node.type === 'prompt' ? { prompt: node.content ?? '', format: 'prompt' as const } : { format: 'markdown' as const }) }
        : {}
    return {
      ...textData,
      subtype: 'workflow_input',
      displayCategory: node.type === 'text' || node.type === 'prompt' ? 'content' : 'resource',
      productionState: 'empty',
      message: node.optional ? '可选工作流输入' : '请在运行前提供工作流输入',
    }
  }
  if (node.role === 'note') {
    return {
      text: node.content ?? '',
      ...(node.type === 'prompt' ? { prompt: node.content ?? '', format: 'prompt' as const } : { format: 'markdown' as const }),
      subtype: 'workflow_note',
      displayCategory: 'content',
    }
  }
  return {
    operation: node.operation,
    prompt: node.prompt ?? '',
    ...(node.negativePrompt ? { negativePrompt: node.negativePrompt } : {}),
    ...(node.systemPrompt ? { systemPrompt: node.systemPrompt } : {}),
    ...(node.modelParams ? { modelParams: node.modelParams } : {}),
    ...(node.providerProfileId ? { providerProfileId: node.providerProfileId } : {}),
    ...(node.manifestId ? { manifestId: node.manifestId } : {}),
    ...(node.modelId ? { modelId: node.modelId } : {}),
    ...(node.agentId ? { agentId: node.agentId } : {}),
    subtype: node.isOutput ? 'workflow_output' : 'workflow_operation',
    displayCategory: 'task',
    productionState: 'empty',
    message: node.isOutput ? '工作流输出步骤，配置后可运行' : '工作流步骤，配置后可运行',
  }
}

function topologicalDepths(
  nodes: readonly CanvasAgentWorkflowNodeSpec[],
): Map<string, number> {
  const depth = new Map<string, number>()
  const nodeByRef = new Map(nodes.map((node) => [node.ref, node]))
  const calculate = (ref: string, active: Set<string>): number => {
    const existing = depth.get(ref)
    if (existing != null) return existing
    const node = nodeByRef.get(ref)
    if (!node || node.role !== 'operation') {
      depth.set(ref, 0)
      return 0
    }
    if (active.has(ref)) return 0
    const nextActive = new Set(active)
    nextActive.add(ref)
    const dependencies = operationDependencies(node).filter((dependency) => nodeByRef.has(dependency))
    const value = dependencies.length
      ? Math.max(...dependencies.map((dependency) => calculate(dependency, nextActive))) + 1
      : 1
    depth.set(ref, value)
    return value
  }
  for (const node of nodes) calculate(node.ref, new Set())
  return depth
}

function workflowOrigin(obstacles: readonly CanvasAgentWorkflowObstacle[]): { x: number; y: number } {
  if (obstacles.length === 0) return { x: CANVAS_MARGIN, y: CANVAS_MARGIN }
  return {
    x: Math.round(Math.max(...obstacles.map((obstacle) => obstacle.x + obstacle.width)) + VERTICAL_GAP),
    y: Math.round(Math.min(...obstacles.map((obstacle) => obstacle.y))),
  }
}

export function buildCanvasAgentWorkflowBlueprint(
  spec: CanvasAgentWorkflowGraphSpec,
  options: { obstacles?: readonly CanvasAgentWorkflowObstacle[] } = {},
): CanvasAgentWorkflowBlueprint {
  const validation = validateCanvasAgentWorkflowGraph(spec)
  if (!validation.valid) {
    const summary = validation.diagnostics
      .filter((item) => item.severity === 'error')
      .map((item) => item.message)
      .join('；')
    throw new Error(`工作流图校验失败：${summary}`)
  }

  const depths = topologicalDepths(spec.nodes)
  const layers = new Map<number, CanvasAgentWorkflowNodeSpec[]>()
  for (const node of spec.nodes) {
    const layer = depths.get(node.ref) ?? 0
    const entries = layers.get(layer) ?? []
    entries.push(node)
    layers.set(layer, entries)
  }
  for (const entries of layers.values()) entries.sort((left, right) => left.ref.localeCompare(right.ref))

  const layerWidths = new Map<number, number>()
  for (const [layer, entries] of layers) {
    layerWidths.set(layer, Math.max(...entries.map((node) => nodeSize(node).width)))
  }
  const sortedLayers = [...layers.keys()].sort((left, right) => left - right)
  const layerX = new Map<number, number>()
  let cursorX = 0
  for (const layer of sortedLayers) {
    layerX.set(layer, cursorX)
    cursorX += (layerWidths.get(layer) ?? 0) + HORIZONTAL_GAP
  }

  const nodes: NodeBlueprint[] = []
  const positionByRef = new Map<string, { y: number; height: number }>()
  for (const layer of sortedLayers) {
    const entries = layers.get(layer) ?? []
    let cursorY = 0
    for (const node of entries) {
      const size = nodeSize(node)
      const upstreamCenters = operationDependencies(node)
        .map((dependency) => positionByRef.get(dependency))
        .filter((position): position is { y: number; height: number } => Boolean(position))
        .map((position) => position.y + position.height / 2)
      const desiredY = upstreamCenters.length
        ? upstreamCenters.reduce((sum, center) => sum + center, 0) / upstreamCenters.length -
          size.height / 2
        : cursorY
      const y = Math.round(Math.max(cursorY, desiredY, 0))
      const type: CanvasNodeType =
        node.role === 'operation' ? node.operation : node.role === 'note' ? (node.type ?? 'text') : node.type
      nodes.push({
        ref: node.ref,
        type,
        title: node.title,
        x: layerX.get(layer) ?? 0,
        y,
        width: size.width,
        height: size.height,
        data: blueprintData(node),
      })
      positionByRef.set(node.ref, { y, height: size.height })
      cursorY = y + size.height + VERTICAL_GAP
    }
  }

  const edges: EdgeBlueprint[] = spec.nodes.flatMap((node) =>
    node.role === 'operation'
      ? operationDependencies(node).map((dependency) => ({
          from: dependency,
          to: node.ref,
          type: 'used_as_input' as const,
        }))
      : [],
  )
  const origin = workflowOrigin(options.obstacles ?? [])

  return {
    ...validation,
    originX: origin.x,
    originY: origin.y,
    nodes,
    edges,
  }
}

function rectanglesOverlap(left: CanvasNode, right: CanvasNode): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}

/** Validate only the explicitly supplied workflow subgraph, never unrelated canvas nodes. */
export function validateCanvasWorkflowSubgraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): CanvasWorkflowSubgraphValidation {
  const selectedIds = new Set(nodes.map((node) => node.id))
  const internalEdges = edges.filter(
    (edge) =>
      edge.type !== 'group_contains' &&
      selectedIds.has(edge.sourceNodeId) &&
      selectedIds.has(edge.targetNodeId),
  )
  const incomingByTarget = new Map<string, string[]>()
  const outgoingBySource = new Map<string, string[]>()
  for (const edge of internalEdges) {
    const incoming = incomingByTarget.get(edge.targetNodeId) ?? []
    incoming.push(edge.sourceNodeId)
    incomingByTarget.set(edge.targetNodeId, incoming)
    const outgoing = outgoingBySource.get(edge.sourceNodeId) ?? []
    outgoing.push(edge.targetNodeId)
    outgoingBySource.set(edge.sourceNodeId, outgoing)
  }

  const graphNodes: CanvasAgentWorkflowNodeSpec[] = nodes.map((node) => {
    if (node.data.subtype === 'workflow_note') {
      return {
        ref: node.id,
        role: 'note',
        type: node.type === 'prompt' ? 'prompt' : 'text',
        title: node.title ?? node.id,
        ...(node.data.text != null ? { content: node.data.text } : {}),
      }
    }
    if (isOperationNode(node)) {
      const operation = nodeOperation(node)
      if (!operation) {
        return {
          ref: node.id,
          role: 'note',
          title: node.title ?? node.id,
          content: '无法识别 operation 的旧任务节点',
        }
      }
      const downstreamOperations = (outgoingBySource.get(node.id) ?? []).filter((targetId) => {
        const target = nodes.find((candidate) => candidate.id === targetId)
        return target ? isOperationNode(target) : false
      })
      return {
        ref: node.id,
        role: 'operation',
        operation,
        title: node.title ?? node.id,
        dependsOn: incomingByTarget.get(node.id) ?? [],
        ...(node.data.prompt != null ? { prompt: node.data.prompt } : {}),
        ...(node.data.negativePrompt ? { negativePrompt: node.data.negativePrompt } : {}),
        ...(node.data.systemPrompt ? { systemPrompt: node.data.systemPrompt } : {}),
        ...(node.data.modelParams ? { modelParams: node.data.modelParams } : {}),
        ...(node.data.providerProfileId ? { providerProfileId: node.data.providerProfileId } : {}),
        ...(node.data.manifestId ? { manifestId: node.data.manifestId } : {}),
        ...(node.data.modelId ? { modelId: node.data.modelId } : {}),
        ...(node.data.agentId ? { agentId: node.data.agentId } : {}),
        isOutput: node.data.subtype === 'workflow_output' || downstreamOperations.length === 0,
      }
    }
    const type: CanvasAgentWorkflowInputType =
      node.type === 'image' ||
      node.type === 'video' ||
      node.type === 'audio' ||
      node.type === 'prompt'
        ? node.type
        : 'text'
    return {
      ref: node.id,
      role: 'input',
      type,
      title: node.title ?? node.id,
      ...(node.data.text != null ? { content: node.data.text } : {}),
    }
  })

  const validation = validateCanvasAgentWorkflowGraph({ name: '画布工作流子图', nodes: graphNodes })
  const diagnostics = [...validation.diagnostics]
  for (let index = 0; index < nodes.length; index += 1) {
    const left = nodes[index]
    if (!left) continue
    for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
      const right = nodes[otherIndex]
      if (!right || !rectanglesOverlap(left, right)) continue
      pushDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'node_overlap',
        nodeRef: left.id,
        relatedRefs: [right.id],
        message: `节点 ${left.id} 与 ${right.id} 发生重叠`,
        suggestion: '使用从左到右的层级布局重新整理工作流子图。',
      })
    }
  }

  return {
    valid: !diagnostics.some((item) => item.severity === 'error'),
    checkedNodeIds: nodes.map((node) => node.id),
    inputNodeIds: validation.inputRefs,
    outputNodeIds: validation.outputRefs,
    diagnostics,
  }
}
