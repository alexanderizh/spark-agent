import { describe, expect, it } from 'vitest'
import { createCanvasScaleCompressDerivationEdge } from './canvasScaleCompressDerivation'

describe('createCanvasScaleCompressDerivationEdge', () => {
  it.each([
    ['video', 'videoOp'],
    ['image', 'imageOp'],
  ] as const)('creates a visible %s derivation edge with operation metadata', (mediaKind, key) => {
    const edge = createCanvasScaleCompressDerivationEdge({
      id: `edge-${mediaKind}`,
      userId: 1,
      projectId: 'project-1',
      boardId: 'board-1',
      sourceNodeId: 'task-node',
      targetNodeId: `${mediaKind}-copy`,
      mediaKind,
      scalePercent: 75,
      compressPercent: 60,
      createdAt: '2026-08-30T00:00:00.000Z',
    })

    expect(edge).toMatchObject({
      sourceNodeId: 'task-node',
      targetNodeId: `${mediaKind}-copy`,
      type: 'derived_from',
      taskId: null,
      metadata: {
        [key]: 'scale-compress',
        scalePercent: 75,
        compressPercent: 60,
      },
    })
  })
})
