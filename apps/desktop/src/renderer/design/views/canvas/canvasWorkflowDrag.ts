export const CANVAS_WORKFLOW_DRAG_TYPE = 'application/x-spark-canvas-workflow'

type CanvasDropPoint = { x: number; y: number }
type CanvasDropTransfer = {
  files: ArrayLike<File>
  getData(type: string): string
}

export function readCanvasWorkflowDragId(
  dataTransfer: Pick<CanvasDropTransfer, 'getData'>,
): string | null {
  const workflowId = dataTransfer.getData(CANVAS_WORKFLOW_DRAG_TYPE).trim()
  return workflowId || null
}

/**
 * 画布 drop 只接受外部文件与工作流两类拖拽。产物等其他 HTML5 拖拽
 * （如节点内产物、资源管理面板素材）经过画布时既不高亮也不允许放置。
 */
export function hasCanvasStageDroppableDrag(
  dataTransfer: Pick<DataTransfer, 'types'> | null | undefined,
): boolean {
  const types = Array.from(dataTransfer?.types ?? [])
  return types.includes('Files') || types.includes(CANVAS_WORKFLOW_DRAG_TYPE)
}

export function dispatchCanvasStageDrop(input: {
  dataTransfer: CanvasDropTransfer
  clientPoint: CanvasDropPoint
  toFlowPosition: (point: CanvasDropPoint) => CanvasDropPoint
  onDropWorkflow?: (position: CanvasDropPoint, workflowId: string) => void
  onDropFiles?: (position: CanvasDropPoint, files: File[]) => void
}): boolean {
  const position = input.toFlowPosition(input.clientPoint)
  const workflowId = readCanvasWorkflowDragId(input.dataTransfer)
  if (workflowId && input.onDropWorkflow) {
    input.onDropWorkflow(position, workflowId)
    return true
  }

  const files = Array.from(input.dataTransfer.files)
  if (files.length > 0 && input.onDropFiles) {
    input.onDropFiles(position, files)
    return true
  }
  return false
}
