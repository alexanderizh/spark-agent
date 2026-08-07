import { describe, expect, it } from 'vitest'
import {
  operationNodeAspectRatioSizePatch,
  operationNodePresentationSize,
} from './canvasOperationNodePresentation'
import type { CanvasOperationRunView } from './canvasOperationRuns'
import type { CanvasNode } from './canvas.types'

const at = '2026-08-01T00:00:00.000Z'

function operationNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'operation-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image_to_video',
    x: 0,
    y: 0,
    width: 460,
    height: 420,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { operation: 'image_to_video' },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function run(id: string, outputs: CanvasOperationRunView['outputs']): CanvasOperationRunView {
  return {
    taskId: id,
    status: 'completed',
    progress: 100,
    createdAt: at,
    outputs,
  }
}

function videoOutput(id: string, width: number, height: number) {
  return {
    id,
    nodeId: `node-${id}`,
    assetId: `asset-${id}`,
    type: 'video' as const,
    title: id,
    width,
    height,
    createdAt: at,
    updatedAt: at,
  }
}

function audioOutput(id: string) {
  return {
    id,
    nodeId: `node-${id}`,
    type: 'audio' as const,
    title: id,
    createdAt: at,
    updatedAt: at,
  }
}

describe('operation video presentation size', () => {
  it('uses the horizontal audio resource size for extract-audio tasks', () => {
    const node = operationNode({
      type: 'extract_audio',
      data: { operation: 'extract_audio' },
    })
    expect(operationNodePresentationSize(node, [])).toEqual({ width: 520, height: 220 })
    expect(operationNodePresentationSize(node, [run('run-1', [audioOutput('audio')])])).toEqual({
      width: 520,
      height: 220,
    })
  })
  it('shrinks a completed landscape task instead of retaining its default height', () => {
    expect(
      operationNodePresentationSize(operationNode(), [
        run('run-1', [videoOutput('landscape', 1920, 1080)]),
      ]),
    ).toEqual({ width: 460, height: 297 })
  })

  it('switches between landscape and portrait outputs without inheriting the previous height', () => {
    const outputs = [videoOutput('landscape', 1920, 1080), videoOutput('portrait', 1080, 1920)]
    const node = operationNode({
      data: { operation: 'image_to_video', primaryOutputId: 'portrait' },
    })
    expect(operationNodePresentationSize(node, [run('run-1', outputs)])).toEqual({
      width: 460,
      height: 856,
    })

    node.data.primaryOutputId = 'landscape'
    expect(operationNodePresentationSize(node, [run('run-1', outputs)])).toEqual({
      width: 460,
      height: 297,
    })
  })

  it('creates a one-time size patch when the requested video ratio changes', () => {
    expect(
      operationNodeAspectRatioSizePatch(
        operationNode({ data: { operation: 'image_to_video', modelParams: { ratio: '16:9' } } }),
        { ratio: '9:16' },
      ),
    ).toEqual({ width: 460, height: 856 })
  })

  it('creates a one-time size patch when the requested image ratio changes', () => {
    expect(
      operationNodeAspectRatioSizePatch(
        operationNode({
          type: 'text_to_image',
          data: { operation: 'text_to_image', modelParams: { aspect_ratio: '1:1' } },
        }),
        { aspect_ratio: '9:16' },
      ),
    ).toEqual({ width: 460, height: 856 })
  })

  it('does not resize for unchanged, adaptive, or unsupported ratios', () => {
    const node = operationNode({
      type: 'text_to_image',
      data: { operation: 'text_to_image', modelParams: { aspect_ratio: '1:1' } },
    })

    expect(operationNodeAspectRatioSizePatch(node, { aspect_ratio: '1:1' })).toBeNull()
    expect(operationNodeAspectRatioSizePatch(node, { aspect_ratio: 'Auto' })).toBeNull()
    expect(operationNodeAspectRatioSizePatch(node, { aspect_ratio: 'custom' })).toBeNull()
    expect(
      operationNodeAspectRatioSizePatch(
        operationNode({
          type: 'text_generate',
          data: { operation: 'text_generate', modelParams: { aspect_ratio: '1:1' } },
        }),
        { aspect_ratio: '9:16' },
      ),
    ).toBeNull()
  })

  it('keeps a manual task size until the ratio changes again', () => {
    expect(
      operationNodePresentationSize(
        operationNode({
          type: 'text_to_image',
          width: 520,
          height: 500,
          data: { operation: 'text_to_image', modelParams: { aspect_ratio: '9:16' } },
        }),
        [],
      ),
    ).toEqual({ width: 520, height: 500 })
  })

  it('only reserves run navigation height when multiple runs are rendered', () => {
    const output = videoOutput('portrait', 1080, 1920)
    expect(
      operationNodePresentationSize(operationNode(), [run('run-2', [output]), run('run-1', [])]),
    ).toEqual({ width: 460, height: 887 })
  })
})
