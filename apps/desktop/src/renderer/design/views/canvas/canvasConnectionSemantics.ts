import { isOperationNode } from './canvas.capabilities'
import type { CanvasEdge, CanvasNode } from './canvas.types'

/** 手工连线只表达引用/输入；generated 仅允许任务完成回写时显式创建。 */
export function inferCanvasConnectionType(
  source: CanvasNode,
  target: CanvasNode,
): CanvasEdge['type'] {
  if (target.type === 'task' || isOperationNode(target)) return 'used_as_input'
  return 'references'
}
