import { isOperationNode } from './canvas.capabilities'
import type { CanvasEdge, CanvasNode } from './canvas.types'

export type CanvasOperationProjection = {
  visibleNodes: CanvasNode[]
  visibleEdges: CanvasEdge[]
  embeddedOutputNodeIds: Set<string>
  producerByOutputNodeId: Map<string, string>
}

/**
 * 将「操作节点 → generated → 产物节点」投影为一个可见操作节点。
 *
 * 产物节点仍保留在快照中供任务历史、资产、编辑和导出使用；这里只影响画布显示。
 * 如果隐藏产物已连接下游，连线端点会折叠到生产它的操作节点。
 */
export function buildCanvasOperationProjection(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasOperationProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const producerByOutputNodeId = new Map<string, string>()

  for (const edge of edges) {
    if (edge.type !== 'generated' || edge.sourceNodeId === edge.targetNodeId) continue
    const producer = nodeById.get(edge.sourceNodeId)
    const output = nodeById.get(edge.targetNodeId)
    if (!producer || !output || !isOperationNode(producer)) continue
    if (!producerByOutputNodeId.has(output.id)) {
      producerByOutputNodeId.set(output.id, producer.id)
    }
  }

  const embeddedOutputNodeIds = new Set(producerByOutputNodeId.keys())
  const visibleNodes = nodes.filter((node) => !embeddedOutputNodeIds.has(node.id))
  const visibleEdges: CanvasEdge[] = []
  const seenEdgeKeys = new Set<string>()

  for (const edge of edges) {
    const targetProducerId = producerByOutputNodeId.get(edge.targetNodeId)
    // 产物已嵌入其生产者操作节点，画布上看不到该产物；所有指向它的 generated 边都消失，
    // 包括同一产物被多个操作生成时非首选生产者的那条（否则会折叠成操作节点之间的怪异连线）。
    if (edge.type === 'generated' && targetProducerId) continue

    const sourceNodeId = producerByOutputNodeId.get(edge.sourceNodeId) ?? edge.sourceNodeId
    const targetNodeId = targetProducerId ?? edge.targetNodeId
    if (sourceNodeId === targetNodeId) continue
    // 一个操作产出多个产物（如「提取角色」一次产出多个角色节点）且都被同一下游引用时，
    // 多条 used_as_input 边折叠后会得到端点完全相同的连线。ReactFlow 按 edge.id 区分连线，
    // 不去重就会画出多条重叠曲线；这里按 (source, target, type) 去重，仅保留首条作为可见连线。
    const edgeKey = `${sourceNodeId}|${targetNodeId}|${edge.type}`
    if (seenEdgeKeys.has(edgeKey)) continue
    seenEdgeKeys.add(edgeKey)
    visibleEdges.push(
      sourceNodeId === edge.sourceNodeId && targetNodeId === edge.targetNodeId
        ? edge
        : { ...edge, sourceNodeId, targetNodeId },
    )
  }

  return {
    visibleNodes,
    visibleEdges,
    embeddedOutputNodeIds,
    producerByOutputNodeId,
  }
}
