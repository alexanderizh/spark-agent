import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { CanvasFlowEdgeData } from './CanvasFlowEdge'
import type { CanvasFlowNodeData } from './CanvasNode'

const TOOLBAR_HEIGHT = 38
const TOOLBAR_GAP = 24
const STAGE_EDGE_INSET = 8

type ToolbarGeometry = {
  left: number
  top: number
  placeAbove: boolean
}

export function resolveCanvasMultiSelectToolbarGeometry({
  stage,
  instance,
  selectedNodeIds,
}: {
  stage: HTMLDivElement
  instance: ReactFlowInstance<Node<CanvasFlowNodeData>, Edge<CanvasFlowEdgeData>>
  selectedNodeIds: ReadonlySet<string>
}): ToolbarGeometry | null {
  const internalNodes = Array.from(selectedNodeIds)
    .map((nodeId) => instance.getInternalNode(nodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
  if (internalNodes.length < 2) return null

  const bounds = instance.getNodesBounds(internalNodes)
  if (!bounds || (bounds.width === 0 && bounds.height === 0)) return null

  const stageRect = stage.getBoundingClientRect()
  const centerX = bounds.x + bounds.width / 2
  const toStagePosition = (point: { x: number; y: number }) => {
    const screen = instance.flowToScreenPosition(point)
    return { x: screen.x - stageRect.left, y: screen.y - stageRect.top }
  }
  const topScreen = toStagePosition({ x: centerX, y: bounds.y })
  const bottomScreen = toStagePosition({ x: centerX, y: bounds.y + bounds.height })
  const placeAbove = topScreen.y >= TOOLBAR_HEIGHT + TOOLBAR_GAP + STAGE_EDGE_INSET
  const idealTop = placeAbove
    ? topScreen.y - TOOLBAR_GAP - TOOLBAR_HEIGHT
    : bottomScreen.y + TOOLBAR_GAP
  const top =
    stage.clientHeight > 0
      ? Math.max(
          STAGE_EDGE_INSET,
          Math.min(idealTop, stage.clientHeight - TOOLBAR_HEIGHT - STAGE_EDGE_INSET),
        )
      : idealTop

  return { left: topScreen.x, top, placeAbove }
}
