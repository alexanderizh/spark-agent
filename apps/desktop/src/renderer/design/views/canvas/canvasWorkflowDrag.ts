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
