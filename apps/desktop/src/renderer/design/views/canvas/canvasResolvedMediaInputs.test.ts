import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'
import { resolveCanvasMediaInputs } from './canvasResolvedMediaInputs'

describe('resolveCanvasMediaInputs', () => {
  it.each(['image', 'video', 'audio'] as const)(
    'resolves an asset-only %s output that has not been expanded into a canvas node',
    (kind) => {
      const snapshot = taskOutputSnapshot(kind)
      const resolved = resolveCanvasMediaInputs(snapshot)
      const output = resolved.outputMediaNodeByNodeId.get(`operation-${kind}`)

      expect(output).toMatchObject({
        id: `operation-output:asset-${kind}`,
        assetId: `asset-${kind}`,
        type: kind,
      })
      expect(resolved.outputMediaKindByNodeId.get(`operation-${kind}`)).toBe(kind)
      expect(resolved.bindingNodes).toContainEqual(output)
    },
  )
})

function taskOutputSnapshot(kind: 'image' | 'video' | 'audio'): CanvasSnapshot {
  const operationByKind = {
    image: 'text_to_image',
    video: 'text_to_video',
    audio: 'extract_audio',
  } as const
  const operation = operationByKind[kind]
  const node = {
    id: `operation-${kind}`,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type: operation,
    taskId: `task-${kind}`,
    assetId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { operation, status: 'completed' as const },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  } satisfies CanvasNode
  const asset = {
    id: `asset-${kind}`,
    projectId: 'project',
    userId: 1,
    type: kind,
    source: 'ai_generated',
    title: `${kind} output`,
    url: `https://cdn.example.com/${kind}`,
    metadata: {},
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  } satisfies CanvasAsset
  const task = {
    id: `task-${kind}`,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    operation,
    status: 'completed',
    progress: 100,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: [],
    outputAssetIds: [asset.id],
    modelParams: {},
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  } satisfies CanvasTask
  return {
    project: {} as CanvasSnapshot['project'],
    board: {} as CanvasSnapshot['board'],
    nodes: [node],
    edges: [],
    assets: [asset],
    tasks: [task],
  }
}
