import { describe, expect, it } from 'vitest'
import {
  buildCanvasOperationRunViews,
  canvasOperationRunsFingerprint,
} from './canvasOperationRuns'
import type { CanvasSnapshot } from './canvas.types'

function snapshotFixture(): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: 3,
      assetCount: 2,
      taskCount: 2,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
    nodes: [
      {
        id: 'operation-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        type: 'text_to_image',
        taskId: 'task-2',
        x: 0,
        y: 0,
        width: 320,
        height: 260,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { operation: 'text_to_image', status: 'completed', progress: 100 },
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:02:00.000Z',
      },
      ...['one', 'two'].map((suffix, index) => ({
        id: `output-${suffix}`,
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        type: 'image' as const,
        assetId: `asset-${suffix}`,
        title: `Image ${index + 1}`,
        x: 360 + index * 220,
        y: 0,
        width: 200,
        height: 200,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { url: `https://example.com/${suffix}.png` },
        createdAt: `2026-07-10T00:0${index + 1}:00.000Z`,
        updatedAt: `2026-07-10T00:0${index + 1}:00.000Z`,
      })),
    ],
    edges: [
      {
        id: 'edge-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        sourceNodeId: 'operation-1',
        targetNodeId: 'output-one',
        type: 'generated',
        taskId: 'task-1',
        metadata: {},
        createdAt: '2026-07-10T00:01:00.000Z',
      },
      {
        id: 'edge-2',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        sourceNodeId: 'operation-1',
        targetNodeId: 'output-two',
        type: 'generated',
        taskId: 'task-2',
        metadata: {},
        createdAt: '2026-07-10T00:02:00.000Z',
      },
    ],
    assets: ['one', 'two'].map((suffix, index) => ({
      id: `asset-${suffix}`,
      projectId: 'project-1',
      userId: 1,
      type: 'image' as const,
      source: 'ai_generated' as const,
      title: `Image ${index + 1}`,
      url: `https://example.com/${suffix}.png`,
      metadata: {},
      createdAt: `2026-07-10T00:0${index + 1}:00.000Z`,
      updatedAt: `2026-07-10T00:0${index + 1}:00.000Z`,
    })),
    tasks: [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        operation: 'text_to_image',
        status: 'completed',
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: ['output-one'],
        outputAssetIds: ['asset-one'],
        modelParams: {},
        createdAt: '2026-07-10T00:01:00.000Z',
        updatedAt: '2026-07-10T00:01:00.000Z',
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        operation: 'text_to_image',
        status: 'completed',
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: ['output-two'],
        outputAssetIds: ['asset-two'],
        modelParams: {},
        createdAt: '2026-07-10T00:02:00.000Z',
        updatedAt: '2026-07-10T00:02:00.000Z',
      },
    ],
  }
}

describe('canvas operation run views', () => {
  it('groups historical generated outputs under the stable operation node', () => {
    const snapshot = snapshotFixture()
    const runs = buildCanvasOperationRunViews(snapshot.nodes[0]!, snapshot)

    expect(runs.map((run) => run.taskId)).toEqual(['task-2', 'task-1'])
    expect(runs[0]?.outputs[0]).toMatchObject({
      nodeId: 'output-two',
      assetId: 'asset-two',
      type: 'image',
      url: 'https://example.com/two.png',
    })
  })

  it('changes the fingerprint when an output is updated', () => {
    const snapshot = snapshotFixture()
    const before = canvasOperationRunsFingerprint(
      buildCanvasOperationRunViews(snapshot.nodes[0]!, snapshot),
    )
    snapshot.nodes[2]!.updatedAt = '2026-07-10T00:03:00.000Z'
    const after = canvasOperationRunsFingerprint(
      buildCanvasOperationRunViews(snapshot.nodes[0]!, snapshot),
    )

    expect(after).not.toBe(before)
  })
})
