import type { CanvasSnapshot } from './canvas.types'

/**
 * 解析资产在当前画布上应该聚焦的节点。
 *
 * 资产不一定直接挂在节点的 assetId 上：任务节点会把输入/输出资产记录在
 * CanvasTask，资产节点也可能是组内子节点。因此这里统一收敛到可见的顶层节点，
 * 让定位和卡片的可用状态使用同一套判断。
 */
export function resolveCanvasAssetFocusNodeIds(
  snapshot: CanvasSnapshot,
  assetId: string,
): string[] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node] as const))
  const candidateIds: string[] = []
  const candidateSet = new Set<string>()
  const addCandidate = (nodeId: string | null | undefined) => {
    if (!nodeId || !nodesById.has(nodeId) || candidateSet.has(nodeId)) return
    candidateSet.add(nodeId)
    candidateIds.push(nodeId)
  }

  const generatedProducerByOutputId = new Map(
    snapshot.edges
      .filter((edge) => edge.type === 'generated')
      .map((edge) => [edge.targetNodeId, edge.sourceNodeId] as const),
  )

  // 最精确的情况：资产直接挂在资源节点上。
  for (const node of snapshot.nodes) {
    if (node.assetId !== assetId) continue
    // 未物化的任务产物节点不会直接渲染在画布上，而是嵌在其生产者任务节点里。
    // 先定位生产者，避免 focusNodes 接收到一个不可见的产物节点 id。
    if (!node.parentNodeId) addCandidate(generatedProducerByOutputId.get(node.id))
    addCandidate(node.id)
  }

  const asset = snapshot.assets.find((item) => item.id === assetId)
  const metadataTaskIds = new Set<string>()
  for (const key of ['taskId', 'originTaskId']) {
    const taskId = asset?.metadata?.[key]
    if (typeof taskId === 'string' && taskId.length > 0) metadataTaskIds.add(taskId)
  }
  const relatedTasks = snapshot.tasks.filter(
    (task) =>
      metadataTaskIds.has(task.id) ||
      task.inputAssetIds.includes(assetId) ||
      task.outputAssetIds.includes(assetId),
  )
  const relatedTaskIds = new Set(relatedTasks.map((task) => task.id))

  // 任务节点通常通过 taskId 绑定；任务输入/输出节点作为旧数据结构的回退。
  for (const node of snapshot.nodes) {
    if (node.taskId && relatedTaskIds.has(node.taskId)) addCandidate(node.id)
  }
  for (const task of relatedTasks) {
    for (const nodeId of task.outputNodeIds) addCandidate(nodeId)
    for (const nodeId of task.inputNodeIds) addCandidate(nodeId)
  }

  // 某些历史任务只有带 taskId 的 generated / used_as_input 连线，没有完整的
  // outputNodeIds；优先取连线的目标节点作为任务所在位置。
  for (const edge of snapshot.edges) {
    if (!edge.taskId || !relatedTaskIds.has(edge.taskId)) continue
    if (edge.type === 'generated') {
      addCandidate(edge.sourceNodeId)
      addCandidate(edge.targetNodeId)
    } else if (edge.type === 'used_as_input') {
      addCandidate(edge.targetNodeId)
      addCandidate(edge.sourceNodeId)
    }
  }

  const topLevelIds: string[] = []
  const topLevelSet = new Set<string>()
  for (const candidateId of candidateIds) {
    let node = nodesById.get(candidateId)
    const visited = new Set<string>()
    while (node?.parentNodeId && !visited.has(node.id)) {
      visited.add(node.id)
      node = nodesById.get(node.parentNodeId)
    }
    if (!node || topLevelSet.has(node.id)) continue
    topLevelSet.add(node.id)
    topLevelIds.push(node.id)
  }
  return topLevelIds
}
