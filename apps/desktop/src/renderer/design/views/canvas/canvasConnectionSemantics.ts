import { isOperationNode } from './canvas.capabilities'
import type { CanvasEdge, CanvasNode } from './canvas.types'

/** 手工连线只表达引用/输入；generated 仅允许任务完成回写时显式创建。 */
export function inferCanvasConnectionType(
  _source: CanvasNode,
  target: CanvasNode,
): CanvasEdge['type'] {
  if (
    target.type === 'task' ||
    isOperationNode(target) ||
    target.data.subtype === 'video_workbench'
  ) {
    return 'used_as_input'
  }
  return 'references'
}

/** 兼容旧版本误写成 manual generated 的视频工作台上游连线。 */
export function isVideoWorkbenchUpstreamEdge(edge: CanvasEdge, workbenchNodeId: string): boolean {
  if (edge.targetNodeId !== workbenchNodeId) return false
  if (edge.type === 'used_as_input') return true
  return edge.type === 'generated' && edge.metadata.manual === true
}
