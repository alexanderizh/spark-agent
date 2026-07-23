import type { CanvasWorkflowNode, CanvasWorkflowPackage } from '@spark/protocol'
import { OPERATION_NODE_TYPES } from './canvas.capabilities'
import type { CanvasNodeData, CanvasNodeType } from './canvas.types'
import type { EdgeBlueprint, NodeBlueprint } from './canvasTemplates'

const CANVAS_NODE_TYPES = new Set<CanvasNodeType>([
  'image',
  'audio',
  'video',
  'text',
  'prompt',
  'group',
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
  'text_to_audio',
  'audio_transcribe',
  'task',
])

type WorkflowEdgeBlueprint = EdgeBlueprint & {
  sourceHandle?: string
  targetHandle?: string
}

export type CanvasWorkflowTemplateBlueprint = {
  nodes: NodeBlueprint[]
  edges: WorkflowEdgeBlueprint[]
}

function isCanvasNodeType(value: unknown): value is CanvasNodeType {
  return typeof value === 'string' && CANVAS_NODE_TYPES.has(value as CanvasNodeType)
}

function inferNodeType(node: CanvasWorkflowNode): CanvasNodeType {
  let sourceNodeType: CanvasNodeType | null = null
  if (node.sourceNodeType) {
    if (!isCanvasNodeType(node.sourceNodeType)) {
      throw new Error(`工作流节点“${node.label}”使用了不支持的画布节点类型：${node.sourceNodeType}`)
    }
    sourceNodeType = node.sourceNodeType
  }

  const operation = node.config.operation
  if (node.kind === 'canvas_operation') {
    if (typeof operation !== 'string' || !OPERATION_NODE_TYPES.has(operation)) {
      throw new Error(`工作流操作节点“${node.label}”缺少可用的 operation 配置`)
    }
    if (
      sourceNodeType &&
      sourceNodeType !== 'task' &&
      (!OPERATION_NODE_TYPES.has(sourceNodeType) || sourceNodeType !== operation)
    ) {
      throw new Error(`工作流操作节点“${node.label}”的节点类型与 operation 不一致`)
    }
    return sourceNodeType ?? (operation as CanvasNodeType)
  }
  if (node.kind === 'canvas_subworkflow') {
    throw new Error(`工作流节点“${node.label}”包含尚未展开的子工作流`)
  }
  if (sourceNodeType) return sourceNodeType
  if (node.kind === 'canvas_asset_ref') {
    const mimeType = node.config.mimeType
    if (typeof mimeType === 'string') {
      if (mimeType.startsWith('image/')) return 'image'
      if (mimeType.startsWith('audio/')) return 'audio'
      if (mimeType.startsWith('video/')) return 'video'
    }
  }
  return 'text'
}

function editableNodeData(config: Record<string, unknown>): Partial<CanvasNodeData> {
  const {
    assetId: _assetId,
    workflowProvenance: _workflowProvenance,
    workflowId: _workflowId,
    workflowVersion: _workflowVersion,
    sourceWorkflowId: _sourceWorkflowId,
    sourceWorkflowVersion: _sourceWorkflowVersion,
    ...data
  } = structuredClone(config)
  return data as Partial<CanvasNodeData>
}

export function buildCanvasWorkflowTemplateBlueprint(
  workflowPackage: CanvasWorkflowPackage,
): CanvasWorkflowTemplateBlueprint {
  const nodeIds = new Set<string>()
  const nodes = workflowPackage.graph.nodes.map((node) => {
    if (nodeIds.has(node.id)) throw new Error(`工作流节点 ID 重复：${node.id}`)
    nodeIds.add(node.id)
    return {
      ref: node.id,
      type: inferNodeType(node),
      title: node.label,
      x: node.position.x,
      y: node.position.y,
      data: editableNodeData(node.config),
    }
  })

  const edges = workflowPackage.graph.edges.map((edge) => {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      throw new Error(`工作流连线“${edge.id}”引用了不存在的节点`)
    }
    return {
      from: edge.sourceNodeId,
      to: edge.targetNodeId,
      type: edge.type ?? 'used_as_input',
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    }
  })

  return { nodes, edges }
}
