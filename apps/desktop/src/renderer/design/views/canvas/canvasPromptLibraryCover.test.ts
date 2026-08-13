import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasAssetType, CanvasNode, CanvasSnapshot } from './canvas.types'
import {
  isPromptCoverAsset,
  isPromptCoverNode,
  resolveNodeOutputAsset,
} from './canvasPromptLibraryCover'

const at = '2026-01-01T00:00:00.000Z'

function asset(type: CanvasAssetType): CanvasAsset {
  return {
    id: `asset-${type}`,
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

function operationSnapshot(): CanvasSnapshot {
  const operation = operationNode()
  const output = {
    ...operation,
    id: 'output-1',
    type: 'image' as const,
    assetId: 'asset-image',
    title: '生成封面',
    x: 400,
    data: { url: 'safe-file://project/cover.png', origin: 'task_output' as const },
  }
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: 2,
      assetCount: 1,
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
    nodes: [operation, output],
    edges: [
      {
        id: 'edge-generated',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        sourceNodeId: operation.id,
        targetNodeId: output.id,
        type: 'generated',
        taskId: 'historical-task',
        metadata: {},
        createdAt: at,
      },
    ],
    assets: [asset('image')],
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

  it('accepts image nodes and image-producing operation nodes as cover sources', () => {
    expect(isPromptCoverNode({ type: 'image' }, asset('image'))).toBe(true)
    expect(isPromptCoverNode({ type: 'text_to_image' }, asset('image'))).toBe(true)
    expect(isPromptCoverNode({ type: 'panorama_360' }, asset('image'))).toBe(true)
    expect(isPromptCoverNode({ type: 'task' }, asset('image'))).toBe(true)
    expect(isPromptCoverNode({ type: 'text' }, asset('image'))).toBe(false)
    expect(isPromptCoverNode({ type: 'image' }, asset('video'))).toBe(false)
  })

  it('resolves an operation cover from generated output history', () => {
    const snapshot = operationSnapshot()
    const operation = snapshot.nodes[0]
    if (!operation) throw new Error('missing operation fixture node')

    expect(resolveNodeOutputAsset(operation, snapshot)).toMatchObject({
      id: 'asset-image',
      type: 'image',
    })
  })
})
