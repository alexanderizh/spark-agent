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
    // 旧版手工连线曾误把「操作节点 → 视频工作台」写成 generated。
    // 工作台是用户创建的交互节点，不是可内嵌任务产物，必须始终保留在画布上。
    if (output.data.subtype === 'video_workbench') continue
    if (!producerByOutputNodeId.has(output.id)) {
      producerByOutputNodeId.set(output.id, producer.id)
    }
  }

  // 未物化的产物继续内嵌在操作节点中；一旦产物进入真实 group，就作为组内节点显示。
  // 这样任务节点仍保留多产物预览，同时自动展开的产物组不会成为空壳。
  const embeddedOutputNodeIds = new Set(
    [...producerByOutputNodeId.keys()].filter((nodeId) => !nodeById.get(nodeId)?.parentNodeId),
  )
  const visibleNodes = nodes.filter((node) => !embeddedOutputNodeIds.has(node.id))
  const visibleEdges: CanvasEdge[] = []

  for (const edge of edges) {
    const producerId = producerByOutputNodeId.get(edge.targetNodeId)
    if (edge.type === 'generated' && producerId === edge.sourceNodeId) continue

    const sourceNodeId = producerByOutputNodeId.get(edge.sourceNodeId) ?? edge.sourceNodeId
    const targetNodeId = producerId ?? edge.targetNodeId
    if (sourceNodeId === targetNodeId) continue
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
