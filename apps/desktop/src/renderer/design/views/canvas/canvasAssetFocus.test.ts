import { describe, expect, it } from 'vitest'
import { resolveCanvasAssetFocusNodeIds } from './canvasAssetFocus'
import type { CanvasSnapshot } from './canvas.types'

function snapshot(input: {
  nodes?: unknown[]
  edges?: unknown[]
  assets?: unknown[]
  tasks?: unknown[]
}): CanvasSnapshot {
  return {
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
    ...input,
  } as CanvasSnapshot
}

describe('resolveCanvasAssetFocusNodeIds', () => {
  it('focuses the top-level group when the asset node is inside a group', () => {
    expect(
      resolveCanvasAssetFocusNodeIds(
        snapshot({
          nodes: [
            { id: 'group', type: 'group', parentNodeId: null },
            { id: 'asset-node', type: 'image', assetId: 'asset-1', parentNodeId: 'group' },
          ],
        }),
        'asset-1',
      ),
    ).toEqual(['group'])
  })

  it('focuses a task node when the asset is only recorded as a task input', () => {
    expect(
      resolveCanvasAssetFocusNodeIds(
        snapshot({
          nodes: [{ id: 'task-node', type: 'text_to_image', taskId: 'task-1' }],
          tasks: [
            {
              id: 'task-1',
              inputAssetIds: ['asset-1'],
              outputAssetIds: [],
              inputNodeIds: [],
              outputNodeIds: [],
            },
          ],
        }),
        'asset-1',
      ),
    ).toEqual(['task-node'])
  })

  it('prioritizes the producer task over an embedded output node', () => {
    expect(
      resolveCanvasAssetFocusNodeIds(
        snapshot({
          nodes: [
            { id: 'task-node', type: 'text_to_image' },
            { id: 'output-node', type: 'image', assetId: 'asset-1' },
          ],
          edges: [
            { sourceNodeId: 'task-node', targetNodeId: 'output-node', type: 'generated' },
          ],
        }),
        'asset-1',
      )[0],
    ).toBe('task-node')
  })
})
