import { describe, expect, it, vi } from 'vitest'
import { fitCanvasImageNodeSize } from './canvasNodeSize'
import {
  insertCharacterSubviewToCanvas,
  resolveCharacterSubviewCanvasSourceNode,
} from './canvasCharacterSubviewInsertion'
import type { FilmCharacterSubview } from './canvasCharacterLibrary'
import type { CanvasAsset, CanvasNode } from './canvas.types'

describe('insertCharacterSubviewToCanvas', () => {
  it('creates the cropped node to the right of its persisted source and connects it', async () => {
    const sourceNode = makeNode({
      id: 'source-node',
      parentNodeId: 'source-group',
      x: 120,
      y: 80,
      width: 520,
      data: { pipelineRole: 'character' },
    })
    const sourceGroup = makeNode({ id: 'source-group', type: 'group', x: 900, y: 200 })
    const createdNode = makeNode({ id: 'subview-node', assetId: 'subview-asset' })
    const createImageNode = vi.fn().mockResolvedValue(createdNode)
    const patchNodes = vi.fn().mockResolvedValue(undefined)
    const updateNodeData = vi.fn().mockResolvedValue(undefined)
    const connectNodes = vi.fn().mockResolvedValue(undefined)
    const selectNode = vi.fn()
    const subview = makeSubview()

    const result = await insertCharacterSubviewToCanvas(
      {
        sourceNode,
        canvasNodes: [sourceGroup, sourceNode],
        ownerAsset: makeAsset('character-asset', '角色 A'),
        sourceImageAsset: makeAsset('source-asset', '角色设定图'),
        sourceImageUrl: 'safe-file://source',
        subview,
      },
      {
        cropToDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
        dataUrlToFile: vi
          .fn()
          .mockReturnValue(new File(['crop'], 'crop.png', { type: 'image/png' })),
        saveImage: vi.fn().mockResolvedValue({ filePath: '/project/media/crop.png' }),
        createImageNode,
        patchNodes,
        updateNodeData,
        connectNodes,
        selectNode,
      },
    )

    expect(result).toBe(createdNode)
    expect(createImageNode).toHaveBeenCalledWith({
      file: expect.any(File),
      filePath: '/project/media/crop.png',
      x: 1600,
      y: 280,
      ...fitCanvasImageNodeSize(240, 120),
      imageWidth: 240,
      imageHeight: 120,
    })
    expect(patchNodes).toHaveBeenCalledWith(['subview-node'], { title: '脸部特写' })
    expect(updateNodeData).toHaveBeenCalledWith(
      'subview-node',
      expect.objectContaining({
        pipelineRole: 'character',
        modelParams: expect.objectContaining({
          characterSubview: expect.objectContaining({
            sourceNodeId: 'source-node',
            sourceAssetId: 'source-asset',
            subviewId: 'subview-1',
          }),
        }),
      }),
    )
    expect(connectNodes).toHaveBeenCalledWith({
      sourceNodeId: 'source-node',
      targetNodeId: 'subview-node',
    })
    expect(selectNode).toHaveBeenCalledWith('subview-node')
  })

  it('resolves only persisted canvas nodes and falls back to a matching asset node', () => {
    const operationNode = makeNode({ id: 'operation-node', type: 'text_to_image' })
    const assetNode = makeNode({ id: 'asset-node', assetId: 'source-asset' })
    const canvasNodes = [operationNode, assetNode]

    expect(
      resolveCharacterSubviewCanvasSourceNode({
        preferredSourceNodeId: 'operation-node',
        sourceAssetId: 'source-asset',
        canvasNodes,
      }),
    ).toBe(operationNode)
    expect(
      resolveCharacterSubviewCanvasSourceNode({
        preferredSourceNodeId: 'operation-output:synthetic-preview',
        sourceAssetId: 'source-asset',
        canvasNodes,
      }),
    ).toBe(assetNode)
    expect(
      resolveCharacterSubviewCanvasSourceNode({
        sourceAssetId: 'missing-asset',
        canvasNodes,
      }),
    ).toBeNull()
  })
})

function makeNode(patch: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
    x: 0,
    y: 0,
    width: 360,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...patch,
  }
}

function makeAsset(id: string, title: string): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 1,
    type: 'image',
    source: 'ai_generated',
    title,
    metadata: {},
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  }
}

function makeSubview(): FilmCharacterSubview {
  return {
    id: 'subview-1',
    label: '脸部特写',
    kind: 'portrait',
    sourceAssetId: 'source-asset',
    cropPx: { x: 30, y: 20, width: 240, height: 120 },
    order: 0,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  }
}
