import type { CanvasNode } from './canvas.types'

/** 显式引用代表用户点名的节点，优先级高于当前临时选区。 */
export function resolveCanvasAgentContextNodes(
  explicitReferences: CanvasNode[],
  selectedNodes: CanvasNode[],
): CanvasNode[] {
  return explicitReferences.length > 0 ? explicitReferences : selectedNodes
}
