import type {
  CanvasWorkflowNodeKind,
  CanvasWorkflowPackage,
  CanvasWorkflowValueType,
} from '@spark/protocol'
import { isOperationNode } from './canvas.capabilities'
import type { CanvasEdge, CanvasNode } from './canvas.types'

export interface CanvasWorkflowDraft {
  name: string
  description: string
  tags: string[]
  package: CanvasWorkflowPackage
}

export interface ExtractCanvasWorkflowDraftInput {
  projectId: string
  boardId: string
  selectedNodes: CanvasNode[]
  allNodes: CanvasNode[]
  allEdges: CanvasEdge[]
}

function nodeValueType(node: CanvasNode | undefined): CanvasWorkflowValueType {
  if (!node) return 'node'
  if (node.type === 'text' || node.type === 'prompt') return 'text'
  if (node.type === 'image') return 'image'
  if (node.type === 'video') return 'video'
  if (node.type === 'audio') return 'audio'
  if (node.type === 'group') return 'structured'
  return 'node'
}

function nodeLabel(node: CanvasNode | undefined, fallback: string): string {
  return node?.title?.trim() || node?.data.outputTitle?.trim() || fallback
}

function extractedNodeConfig(node: CanvasNode): Record<string, unknown> {
  const data = node.data
  return {
    ...(node.assetId ? { assetId: node.assetId } : {}),
    ...(data.text ? { text: data.text } : {}),
    ...(data.url ? { url: data.url } : {}),
    ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}),
    ...(data.mimeType ? { mimeType: data.mimeType } : {}),
    ...(data.operation ? { operation: data.operation } : {}),
    ...(data.prompt ? { prompt: data.prompt } : {}),
    ...(data.promptDocument ? { promptDocument: data.promptDocument } : {}),
    ...(data.systemPrompt ? { systemPrompt: data.systemPrompt } : {}),
    ...(data.negativePrompt ? { negativePrompt: data.negativePrompt } : {}),
    ...(data.modelParams ? { modelParams: data.modelParams } : {}),
    ...(data.providerProfileId ? { providerProfileId: data.providerProfileId } : {}),
    ...(data.manifestId ? { manifestId: data.manifestId } : {}),
    ...(data.modelId ? { modelId: data.modelId } : {}),
    ...(data.pipelineRole ? { pipelineRole: data.pipelineRole } : {}),
    ...(data.inputBindings ? { inputBindings: data.inputBindings } : {}),
    ...(data.outputMode ? { outputMode: data.outputMode } : {}),
    ...(data.primaryOutputId ? { primaryOutputId: data.primaryOutputId } : {}),
    ...(data.primaryOutputSelection
      ? { primaryOutputSelection: data.primaryOutputSelection }
      : {}),
    ...(data.outputTitle ? { outputTitle: data.outputTitle } : {}),
    ...(data.outputPipelineRole ? { outputPipelineRole: data.outputPipelineRole } : {}),
    ...(data.agentId ? { agentId: data.agentId } : {}),
    ...(data.skillIds ? { skillIds: data.skillIds } : {}),
    ...(data.reasoningEffort ? { reasoningEffort: data.reasoningEffort } : {}),
    ...(data.subtype ? { subtype: data.subtype } : {}),
    ...(data.displayCategory ? { displayCategory: data.displayCategory } : {}),
    ...(data.presetId ? { presetId: data.presetId } : {}),
    ...(data.shotScriptConfig ? { shotScriptConfig: data.shotScriptConfig } : {}),
  }
}

function edgeHandle(edge: CanvasEdge, key: 'sourceHandle' | 'targetHandle'): string | undefined {
  const value = edge.metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function extractCanvasWorkflowDraft(
  input: ExtractCanvasWorkflowDraftInput,
): CanvasWorkflowDraft {
  if (input.selectedNodes.length < 2) {
    throw new Error('至少选择 2 个节点才能提取画布工作流')
  }
  if (
    input.selectedNodes.some(
      (node) => node.projectId !== input.projectId || node.boardId !== input.boardId,
    )
  ) {
    throw new Error('画布工作流只能从同一项目、同一画板的节点提取')
  }

  const selectedIds = new Set(input.selectedNodes.map((node) => node.id))
  const nodesById = new Map(input.allNodes.map((node) => [node.id, node]))
  const relevantEdges = input.allEdges.filter(
    (edge) => edge.projectId === input.projectId && edge.boardId === input.boardId,
  )
  const internalEdges = relevantEdges.filter(
    (edge) => selectedIds.has(edge.sourceNodeId) && selectedIds.has(edge.targetNodeId),
  )
  const incomingEdges = relevantEdges.filter(
    (edge) => !selectedIds.has(edge.sourceNodeId) && selectedIds.has(edge.targetNodeId),
  )
  const outgoingEdges = relevantEdges.filter(
    (edge) => selectedIds.has(edge.sourceNodeId) && !selectedIds.has(edge.targetNodeId),
  )
  const internalIncomingIds = new Set(internalEdges.map((edge) => edge.targetNodeId))
  const internalOutgoingIds = new Set(internalEdges.map((edge) => edge.sourceNodeId))

  const implicitInputNodes =
    incomingEdges.length === 0
      ? input.selectedNodes.filter(
          (node) => !internalIncomingIds.has(node.id) && !isOperationNode(node),
        )
      : []
  const implicitOutputNodes =
    outgoingEdges.length === 0
      ? input.selectedNodes.filter(
          (node) => !internalOutgoingIds.has(node.id) && !isOperationNode(node),
        )
      : []
  const inputNodeIds = new Set(implicitInputNodes.map((node) => node.id))
  const outputNodeIds = new Set([
    ...implicitOutputNodes.map((node) => node.id),
    ...outgoingEdges.map((edge) => edge.sourceNodeId),
  ])

  const minX = Math.min(...input.selectedNodes.map((node) => node.x))
  const minY = Math.min(...input.selectedNodes.map((node) => node.y))
  const graphNodes = input.selectedNodes.map((node) => {
    let kind: CanvasWorkflowNodeKind = 'canvas_transform'
    if (isOperationNode(node)) kind = 'canvas_operation'
    else if (inputNodeIds.has(node.id)) kind = 'canvas_input'
    else if (outputNodeIds.has(node.id)) kind = 'canvas_output'
    else if (node.assetId) kind = 'canvas_asset_ref'
    return {
      id: node.id,
      kind,
      label: nodeLabel(node, node.type),
      sourceNodeType: node.type,
      position: { x: node.x - minX, y: node.y - minY },
      config: extractedNodeConfig(node),
    }
  })

  const contractInputs =
    incomingEdges.length > 0
      ? incomingEdges.map((edge) => {
          const source = nodesById.get(edge.sourceNodeId)
          return {
            id: `input-${edge.id}`,
            name: nodeLabel(source, '画布输入'),
            valueType: nodeValueType(source),
            required: true,
            targetNodeId: edge.targetNodeId,
            ...(edgeHandle(edge, 'targetHandle')
              ? { targetHandle: edgeHandle(edge, 'targetHandle') }
              : {}),
          }
        })
      : implicitInputNodes.map((node) => ({
          id: `input-${node.id}`,
          name: nodeLabel(node, '画布输入'),
          valueType: nodeValueType(node),
          required: true,
          targetNodeId: node.id,
        }))

  const contractOutputs =
    outgoingEdges.length > 0
      ? outgoingEdges.map((edge) => {
          const source = nodesById.get(edge.sourceNodeId)
          return {
            id: `output-${edge.id}`,
            name: nodeLabel(source, '画布输出'),
            valueType: nodeValueType(source),
            sourceNodeId: edge.sourceNodeId,
            ...(edgeHandle(edge, 'sourceHandle')
              ? { sourceHandle: edgeHandle(edge, 'sourceHandle') }
              : {}),
          }
        })
      : implicitOutputNodes.map((node) => ({
          id: `output-${node.id}`,
          name: nodeLabel(node, '画布输出'),
          valueType: nodeValueType(node),
          sourceNodeId: node.id,
        }))

  const primaryOperation = input.selectedNodes.find((node) => isOperationNode(node))
  const packageJson: CanvasWorkflowPackage = {
    schemaVersion: 1,
    graph: {
      nodes: graphNodes,
      edges: internalEdges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        type: edge.type,
        ...(edgeHandle(edge, 'sourceHandle')
          ? { sourceHandle: edgeHandle(edge, 'sourceHandle') }
          : {}),
        ...(edgeHandle(edge, 'targetHandle')
          ? { targetHandle: edgeHandle(edge, 'targetHandle') }
          : {}),
      })),
    },
    contract: {
      inputs: contractInputs,
      outputs: contractOutputs,
      exposedParams: [],
    },
    dependencies: {
      modelCapabilities: unique(
        input.selectedNodes
          .filter((node) => isOperationNode(node))
          .map((node) => node.data.operation ?? node.type),
      ),
      canvasNodeKinds: unique(input.selectedNodes.map((node) => node.type)),
    },
    provenance: {
      extractedFromProjectId: input.projectId,
      extractedFromCanvasId: input.boardId,
      sourceNodeIds: input.selectedNodes.map((node) => node.id),
      sourceAssetIds: input.selectedNodes.flatMap((node) => (node.assetId ? [node.assetId] : [])),
    },
  }

  return {
    name: primaryOperation ? nodeLabel(primaryOperation, '未命名画布工作流') : '未命名画布工作流',
    description: `由当前画布选区的 ${input.selectedNodes.length} 个节点提取`,
    tags: unique(input.selectedNodes.map((node) => node.data.pipelineRole ?? node.type)).slice(
      0,
      8,
    ),
    package: packageJson,
  }
}
