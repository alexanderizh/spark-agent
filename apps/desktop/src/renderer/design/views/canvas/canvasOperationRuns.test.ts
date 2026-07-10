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

function operationFixtureNode(snapshot: CanvasSnapshot) {
  const node = snapshot.nodes[0]
  if (!node) throw new Error('missing operation fixture node')
  return node
}

describe('canvas operation run views', () => {
  it('groups historical generated outputs under the stable operation node', () => {
    const snapshot = snapshotFixture()
    const runs = buildCanvasOperationRunViews(operationFixtureNode(snapshot), snapshot)

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

  it('keeps asset-only workflow outputs available to the operation workbench', () => {
    const snapshot = snapshotFixture()
    snapshot.nodes[0]!.taskId = 'task-assets'
    snapshot.assets.push({
      id: 'asset-character',
      projectId: 'project-1',
      userId: 1,
      type: 'text',
      source: 'ai_generated',
      title: '角色 · 魏德',
      contentText: '六十出头的清瘦老人。',
      metadata: { filmKind: 'character' },
      createdAt: '2026-07-10T00:03:00.000Z',
      updatedAt: '2026-07-10T00:03:00.000Z',
    })
    snapshot.tasks.push({
      id: 'task-assets',
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      operation: 'text_generate',
      status: 'completed',
      progress: 100,
      inputNodeIds: [],
      inputAssetIds: [],
      outputNodeIds: [],
      outputAssetIds: ['asset-character'],
      modelParams: { workflow: 'script_breakdown' },
      createdAt: '2026-07-10T00:03:00.000Z',
      updatedAt: '2026-07-10T00:03:00.000Z',
    })

    const operationNode = snapshot.nodes[0]
    if (!operationNode) throw new Error('missing operation fixture node')
    const runs = buildCanvasOperationRunViews(operationNode, snapshot)

    expect(runs[0]?.outputs[0]).toMatchObject({
      assetId: 'asset-character',
      type: 'text',
      title: '角色 · 魏德',
      text: '六十出头的清瘦老人。',
      pipelineRole: 'character',
    })
    expect(runs[0]?.outputs[0]?.nodeId).toBeUndefined()
  })

  it('keeps prompt-type film scene assets readable in operation previews', () => {
    const snapshot = snapshotFixture()
    snapshot.nodes[0]!.taskId = 'task-scenes'
    snapshot.assets.push({
      id: 'asset-scene',
      projectId: 'project-1',
      userId: 1,
      type: 'prompt',
      source: 'manual',
      title: '精神病院开放阳台',
      contentText: '二层外挑式长条开放阳台，灰色水泥栏杆，阳光从侧面打来。',
      metadata: { kind: 'scene', prompt: 'wide scene reference' },
      createdAt: '2026-07-10T00:03:00.000Z',
      updatedAt: '2026-07-10T00:03:00.000Z',
    })
    snapshot.tasks.push({
      id: 'task-scenes',
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      operation: 'text_generate',
      status: 'completed',
      progress: 100,
      inputNodeIds: [],
      inputAssetIds: [],
      outputNodeIds: [],
      outputAssetIds: ['asset-scene'],
      modelParams: { workflow: 'extract_scene' },
      createdAt: '2026-07-10T00:03:00.000Z',
      updatedAt: '2026-07-10T00:03:00.000Z',
    })

    const runs = buildCanvasOperationRunViews(operationFixtureNode(snapshot), snapshot)

    expect(runs[0]?.outputs[0]).toMatchObject({
      assetId: 'asset-scene',
      type: 'prompt',
      title: '精神病院开放阳台',
      text: '二层外挑式长条开放阳台，灰色水泥栏杆，阳光从侧面打来。',
      pipelineRole: 'scene',
    })
  })
})
