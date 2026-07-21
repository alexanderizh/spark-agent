import { describe, expect, it } from 'vitest'
import {
  inferCanvasConnectionType,
  isVideoWorkbenchUpstreamEdge,
} from './canvasConnectionSemantics'
import type { CanvasEdge, CanvasNode } from './canvas.types'

function node(id: string, type: CanvasNode['type']): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type,
    x: 0,
    y: 0,
    width: 320,
    height: 220,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

describe('canvas connection semantics', () => {
  it('uses used_as_input when connecting into an operation step', () => {
    expect(inferCanvasConnectionType(node('source', 'image'), node('target', 'image_to_video'))).toBe(
      'used_as_input',
    )
  })

  it('uses references for a manual edge leaving an operation step', () => {
    expect(inferCanvasConnectionType(node('source', 'text_to_image'), node('target', 'image'))).toBe(
      'references',
    )
  })

  it('treats an incoming video workbench edge as an upstream input', () => {
    const workbench = node('workbench', 'text')
    workbench.data.subtype = 'video_workbench'

    expect(inferCanvasConnectionType(node('source', 'video'), workbench)).toBe('used_as_input')
    expect(inferCanvasConnectionType(node('source-operation', 'text_to_video'), workbench)).toBe(
      'used_as_input',
    )
  })

  it('never infers generated because generated lineage must be created explicitly by the task system', () => {
    expect(inferCanvasConnectionType(node('source', 'text_to_image'), node('target', 'text'))).not.toBe(
      'generated',
    )
  })

  it('recognizes legacy manual generated edges as workbench upstream inputs', () => {
    const legacyEdge: CanvasEdge = {
      id: 'edge-1',
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      sourceNodeId: 'source-operation',
      targetNodeId: 'workbench',
      type: 'generated',
      metadata: { manual: true },
      createdAt: '2026-07-10T00:00:00.000Z',
    }

    expect(isVideoWorkbenchUpstreamEdge(legacyEdge, 'workbench')).toBe(true)
    expect(isVideoWorkbenchUpstreamEdge({ ...legacyEdge, metadata: {} }, 'workbench')).toBe(false)
  })
})
