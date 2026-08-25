import { describe, expect, it, vi } from 'vitest'
import { CANVAS_AGENT_ARTIFACT_DRAG_TYPE } from './canvasAgentArtifactDrag'
import {
  CANVAS_WORKFLOW_DRAG_TYPE,
  dispatchCanvasStageDrop,
  hasCanvasStageDroppableDrag,
  readCanvasWorkflowDragId,
} from './canvasWorkflowDrag'

function transfer(workflowId: string, files: File[] = []) {
  return {
    files,
    getData: vi.fn((type: string) => (type === CANVAS_WORKFLOW_DRAG_TYPE ? workflowId : '')),
  }
}

function dragTypes(types: string[]) {
  return { types }
}

describe('canvas workflow drag and drop', () => {
  it('reads and trims the private workflow id payload', () => {
    expect(readCanvasWorkflowDragId(transfer('  workflow-1  '))).toBe('workflow-1')
    expect(readCanvasWorkflowDragId(transfer('   '))).toBeNull()
  })

  it('dispatches a workflow drop at converted flow coordinates before file handling', () => {
    const onDropWorkflow = vi.fn()
    const onDropFiles = vi.fn()
    const dropped = dispatchCanvasStageDrop({
      dataTransfer: transfer('workflow-1', [{} as File]),
      clientPoint: { x: 500, y: 320 },
      toFlowPosition: ({ x, y }) => ({ x: x - 100, y: y - 20 }),
      onDropWorkflow,
      onDropFiles,
    })

    expect(dropped).toBe(true)
    expect(onDropWorkflow).toHaveBeenCalledWith({ x: 400, y: 300 }, 'workflow-1')
    expect(onDropFiles).not.toHaveBeenCalled()
  })

  it('keeps external file dropping as a fallback', () => {
    const file = {} as File
    const onDropFiles = vi.fn()
    const dropped = dispatchCanvasStageDrop({
      dataTransfer: transfer('', [file]),
      clientPoint: { x: 80, y: 120 },
      toFlowPosition: (point) => point,
      onDropFiles,
    })

    expect(dropped).toBe(true)
    expect(onDropFiles).toHaveBeenCalledWith({ x: 80, y: 120 }, [file])
  })
})

describe('hasCanvasStageDroppableDrag', () => {
  it('接受外部文件拖拽', () => {
    expect(hasCanvasStageDroppableDrag(dragTypes(['Files']))).toBe(true)
  })

  it('接受工作流拖拽', () => {
    expect(hasCanvasStageDroppableDrag(dragTypes([CANVAS_WORKFLOW_DRAG_TYPE]))).toBe(true)
  })

  it('拒绝产物等其他 HTML5 拖拽，画布不高亮也不允许放置', () => {
    expect(
      hasCanvasStageDroppableDrag(dragTypes([CANVAS_AGENT_ARTIFACT_DRAG_TYPE, 'text/plain'])),
    ).toBe(false)
    expect(hasCanvasStageDroppableDrag(dragTypes(['text/plain']))).toBe(false)
    expect(hasCanvasStageDroppableDrag(null)).toBe(false)
  })
})
