import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasAssetType, CanvasNode, CanvasSnapshot } from './canvas.types'
import {
  collectNodeImageCoverAssets,
  isPromptCoverAsset,
  resolveNodeOutputAsset,
} from './canvasPromptLibraryCover'

const at = '2026-01-01T00:00:00.000Z'

function asset(type: CanvasAssetType, id = `asset-${type}`): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 1,
    type,
    source: 'manual',
    title: type,
    url: 'safe-file://project/media/asset.bin',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function operationNode(): CanvasNode {
  return {
    id: 'operation-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_to_image',
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { operation: 'text_to_image' },
    createdAt: at,
    updatedAt: at,
  }
}

function outputNode(id: string, nodeType: CanvasNode['type'], assetId: string): CanvasNode {
  return {
    ...operationNode(),
    id,
    type: nodeType,
    assetId,
    title: `产物 ${id}`,
    x: 400,
    data: { url: 'safe-file://project/cover.png', origin: 'task_output' as const },
  }
}

function snapshotWithAssets(
  outputs: Array<{ id: string; nodeType: CanvasNode['type']; assetId: string }>,
  assets: CanvasAsset[],
): CanvasSnapshot {
  const operation = operationNode()
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: outputs.length + 1,
      assetCount: assets.length,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [operation, ...outputs.map((item) => outputNode(item.id, item.nodeType, item.assetId))],
    edges: outputs.map((item) => ({
      id: `edge-${item.id}`,
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      sourceNodeId: operation.id,
      targetNodeId: item.id,
      type: 'generated' as const,
      taskId: 'historical-task',
      metadata: {},
      createdAt: at,
    })),
    assets,
    tasks: [],
  }
}

describe('canvas prompt library cover assets', () => {
  it('accepts image assets only', () => {
    expect(isPromptCoverAsset(asset('image'))).toBe(true)
    expect(isPromptCoverAsset(asset('video'))).toBe(false)
    expect(isPromptCoverAsset(asset('audio'))).toBe(false)
    expect(isPromptCoverAsset(asset('file'))).toBe(false)
    expect(isPromptCoverAsset(asset('text'))).toBe(false)
    expect(isPromptCoverAsset(asset('prompt'))).toBe(false)
  })

  it('does not infer image eligibility from a non-image URL', () => {
    expect(isPromptCoverAsset(asset('video'))).toBe(false)
  })

  it('resolves an operation cover from generated output history', () => {
    const snapshot = snapshotWithAssets(
      [{ id: 'output-1', nodeType: 'image', assetId: 'asset-image' }],
      [asset('image')],
    )
    const operation = snapshot.nodes[0]
    if (!operation) throw new Error('missing operation fixture node')

    expect(resolveNodeOutputAsset(operation, snapshot)).toMatchObject({
      id: 'asset-image',
      type: 'image',
    })
  })
})

describe('collectNodeImageCoverAssets', () => {
  it('returns the own image asset of an image node', () => {
    const snapshot = snapshotWithAssets(
      [{ id: 'output-1', nodeType: 'image', assetId: 'asset-image' }],
      [asset('image')],
    )
    const output = snapshot.nodes.find((node) => node.id === 'output-1')
    if (!output) throw new Error('missing output fixture node')

    expect(collectNodeImageCoverAssets(output, snapshot).map((item) => item.id)).toEqual([
      'asset-image',
    ])
  })

  it('lists every image output of an operation node, not only the primary one', () => {
    const snapshot = snapshotWithAssets(
      [
        { id: 'output-a', nodeType: 'image', assetId: 'asset-image-a' },
        { id: 'output-b', nodeType: 'image', assetId: 'asset-image-b' },
        { id: 'output-video', nodeType: 'video', assetId: 'asset-video' },
      ],
      [asset('image', 'asset-image-a'), asset('image', 'asset-image-b'), asset('video')],
    )
    const operation = snapshot.nodes[0]
    if (!operation) throw new Error('missing operation fixture node')

    expect(collectNodeImageCoverAssets(operation, snapshot).map((item) => item.id)).toEqual([
      'asset-image-a',
      'asset-image-b',
    ])
  })

  it('deduplicates outputs that reference the same asset', () => {
    const snapshot = snapshotWithAssets(
      [
        { id: 'output-a', nodeType: 'image', assetId: 'asset-image-a' },
        { id: 'output-a-copy', nodeType: 'image', assetId: 'asset-image-a' },
      ],
      [asset('image', 'asset-image-a')],
    )
    const operation = snapshot.nodes[0]
    if (!operation) throw new Error('missing operation fixture node')

    expect(collectNodeImageCoverAssets(operation, snapshot).map((item) => item.id)).toEqual([
      'asset-image-a',
    ])
  })

  it('falls back to the task projection for legacy image nodes without a direct asset', () => {
    const snapshot = snapshotWithAssets([], [asset('image')])
    const legacyImage: CanvasNode = {
      ...outputNode('legacy-image', 'image', ''),
      assetId: null,
      taskId: 'legacy-task',
    }
    snapshot.nodes = [legacyImage]
    snapshot.tasks = [
      {
        id: 'legacy-task',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        operation: 'text_to_image',
        status: 'completed',
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: ['asset-image'],
        modelParams: {},
        createdAt: at,
        updatedAt: at,
      },
    ]

    expect(collectNodeImageCoverAssets(legacyImage, snapshot).map((item) => item.id)).toEqual([
      'asset-image',
    ])
  })

  it('returns nothing for non-image nodes and image-less operation nodes', () => {
    const snapshot = snapshotWithAssets(
      [{ id: 'output-1', nodeType: 'text', assetId: 'asset-text' }],
      [asset('text')],
    )
    const textNode = snapshot.nodes.find((node) => node.id === 'output-1')
    if (!textNode) throw new Error('missing text fixture node')

    expect(collectNodeImageCoverAssets(textNode, snapshot)).toEqual([])
    expect(collectNodeImageCoverAssets(operationNode(), snapshotWithAssets([], []))).toEqual([])
  })
})
