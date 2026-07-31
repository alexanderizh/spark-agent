/**
 * 画布 flow 节点相对/绝对坐标转换（供跨组对齐等需要统一坐标系的操作使用）。
 *
 * React Flow 中设了 parentId 的节点（`extent: 'parent'`）其 position 是相对 parent
 * 的；本模块沿 parentId 链把相对坐标解析为绝对坐标，或把绝对坐标转回某节点应写入
 * 的相对坐标。用最小结构类型 `FlowNodeCoordinateRef` 解耦 React Flow 的 Node 类型，
 * 保持纯函数、易单测。
 */

export type FlowNodeCoordinateRef = {
  id: string
  position: { x: number; y: number }
  parentId?: string | null
}

export type FlowPoint = { x: number; y: number }

/**
 * 沿 parentId 链累加 position 得到节点的绝对原点。
 * visited 集合防止链成环时死循环；链上父节点缺失时停止累加。
 */
export function resolveFlowNodeAbsoluteOrigin<T extends FlowNodeCoordinateRef>(
  node: T,
  nodeById: Map<string, T>,
): FlowPoint {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentId ?? null
  const visited = new Set<string>()
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodeById.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId ?? null
  }
  return { x, y }
}

/**
 * 把绝对坐标转回某节点应写入的（相对其 parent 链的）坐标。
 * 无 parentId 或 parent 缺失时直接返回绝对值。
 */
export function absoluteToRelativeFor<T extends FlowNodeCoordinateRef>(
  absolute: FlowPoint,
  node: T,
  nodeById: Map<string, T>,
): FlowPoint {
  const parentId = node.parentId
  if (!parentId) return { x: absolute.x, y: absolute.y }
  const parent = nodeById.get(parentId)
  if (!parent) return { x: absolute.x, y: absolute.y }
  const parentOrigin = resolveFlowNodeAbsoluteOrigin(parent, nodeById)
  return { x: absolute.x - parentOrigin.x, y: absolute.y - parentOrigin.y }
}
