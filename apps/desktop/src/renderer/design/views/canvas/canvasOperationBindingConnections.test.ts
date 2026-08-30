import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { selectCanvasOperationBindingConnectionNodes } from './canvasOperationBindingConnections'

describe('selectCanvasOperationBindingConnectionNodes', () => {
  it('keeps upstream text outputs while filtering unsupported media inputs', () => {
    const textOutput = canvasNode('operation-output:text', 'text')
    const image = canvasNode('image', 'image')
    const video = canvasNode('video', 'video')

    expect(
      selectCanvasOperationBindingConnectionNodes({
        expandedSourceNodes: [textOutput, image, video],
        supportedInputTypes: ['image'],
      }).map((node) => node.id),
    ).toEqual(['operation-output:text', 'image'])
  })

  it('preserves the existing unfiltered behavior when no media input editor is available', () => {
    const image = canvasNode('image', 'image')
    const text = canvasNode('text', 'text')

    expect(
      selectCanvasOperationBindingConnectionNodes({
        expandedSourceNodes: [image, text],
        supportedInputTypes: ['text'],
      }),
    ).toEqual([image, text])
  })
})

function canvasNode(id: string, type: CanvasNode['type']): CanvasNode {
  return {
    id,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type,
    title: id,
    assetId: null,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: type === 'text' ? { text: id } : {},
    createdAt: '',
    updatedAt: '',
  }
}
