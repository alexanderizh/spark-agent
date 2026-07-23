import type { CanvasNode } from './canvas.types'

export type CanvasNodeLayoutUpdate = Pick<
  CanvasNode,
  'id' | 'projectId' | 'x' | 'y' | 'width' | 'height'
>

const sameLayout = (current: CanvasNode, next: CanvasNodeLayoutUpdate): boolean =>
  current.x === next.x &&
  current.y === next.y &&
  current.width === next.width &&
  current.height === next.height

/**
 * Apply React Flow layout updates without allowing a stale UI snapshot to
 * overwrite deletion state or any non-layout node fields.
 */
export function applyCanvasNodeLayoutUpdates(input: {
  nodes: CanvasNode[]
  projectId: string
  updates: CanvasNodeLayoutUpdate[]
  updatedAt: string
}): { nodes: CanvasNode[]; changed: boolean } {
  const updatesById = new Map(
    input.updates
      .filter((node) => node.projectId === input.projectId)
      .map((node) => [node.id, node] as const),
  )
  let changed = false
  const nodes = input.nodes.map((node) => {
    if (node.projectId !== input.projectId || node.hidden) return node
    const next = updatesById.get(node.id)
    if (!next || sameLayout(node, next)) return node
    changed = true
    return {
      ...node,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
      updatedAt: input.updatedAt,
    }
  })
  return { nodes: changed ? nodes : input.nodes, changed }
}
