import type { CanvasEdge, CanvasNode } from './canvas.types'

/**
 * 画布节点可作为媒体素材输入的类型。
 *
 * 纯素材节点直接是其中之一；任务节点（text_to_video / image_to_video 等）自身不是媒体节点，
 * 它的产物落在独立的 output 节点上——通过 {@link resolveCanvasNodeMediaKind} 按产物解析。
 */
export type CanvasNodeMediaKind = 'image' | 'video' | 'audio'

function isMediaKind(type: CanvasNode['type'] | undefined): type is CanvasNodeMediaKind {
  return type === 'image' || type === 'video' || type === 'audio'
}

/**
 * 构建「任务节点 id → 产物媒体类型」映射。
 *
 * 任务节点的产物 output 节点由 `generated` 边连接（source = 任务节点）。
 * 一个任务节点可能有多个产物（多次运行 / 多张产物），取数组中**最后一条** generated 边对应的媒体产物，
 * 通常即最近一次运行的结果。纯素材节点不会出现在映射 key 中——它们自身 type 即媒体类型。
 */
export function buildOutputMediaKindMap(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): Map<string, CanvasNodeMediaKind> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const map = new Map<string, CanvasNodeMediaKind>()
  for (const edge of edges) {
    if (edge.type !== 'generated') continue
    const target = nodeById.get(edge.targetNodeId)
    if (!target || !isMediaKind(target.type)) continue
    map.set(edge.sourceNodeId, target.type) // 后写覆盖先写 → 取最后一条 generated 边
  }
  return map
}

/**
 * 构建「任务节点 id → 产物媒体节点」映射，用于提交链路需要真实产物节点（url/asset）的场景。
 * 规则与 {@link buildOutputMediaKindMap} 一致：取最后一条 generated 边对应的媒体产物。
 */
export function buildOutputMediaNodeMap(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): Map<string, CanvasNode> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const map = new Map<string, CanvasNode>()
  for (const edge of edges) {
    if (edge.type !== 'generated') continue
    const target = nodeById.get(edge.targetNodeId)
    if (!target || !isMediaKind(target.type)) continue
    map.set(edge.sourceNodeId, target)
  }
  return map
}

/**
 * 解析一个画布节点贡献的媒体类型。
 * - 纯素材节点：返回其 type
 * - 任务节点：返回其产物 output 的媒体类型（来自 outputMediaKindByNodeId 映射）
 * - 非媒体（文本/prompt 等）或无产物的任务节点：返回 undefined
 */
export function resolveCanvasNodeMediaKind(
  node: CanvasNode,
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>,
): CanvasNodeMediaKind | undefined {
  if (isMediaKind(node.type)) return node.type
  return outputMediaKindByNodeId?.get(node.id)
}

/**
 * 解析一个画布节点作为媒体输入时的**有效源节点**。
 * - 纯素材节点：返回自身
 * - 任务节点：返回其产物 output 媒体节点（来自 outputMediaNodeByNodeId 映射）；
 *   若尚无产物则返回任务节点自身（上游校验会先行拒绝无产物的任务节点）
 *
 * 把任务节点解析成它的产物节点后，后续 binding.kind / url / asset / 提交全部走真实媒体节点路径，
 * 无需为任务节点在各消费点单独特化。
 */
export function resolveEffectiveMediaSourceNode(
  node: CanvasNode,
  outputMediaNodeByNodeId?: ReadonlyMap<string, CanvasNode>,
): CanvasNode {
  if (isMediaKind(node.type)) return node
  return outputMediaNodeByNodeId?.get(node.id) ?? node
}
