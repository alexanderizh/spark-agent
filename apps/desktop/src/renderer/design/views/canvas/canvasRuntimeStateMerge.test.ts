import { describe, expect, it } from 'vitest'
import { mergeCanvasRuntimeStateIntoSnapshot } from './canvasRuntimeStateMerge'
import type { CanvasSnapshot, CanvasTask } from './canvas.types'

const at = '2026-08-24T00:00:00.000Z'

function task(id: string, status: CanvasTask['status']): CanvasTask {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    operation: 'text_to_image',
    status,
    progress: status === 'running' ? 40 : 100,
    operationNodeId: 'operation-1',
    prompt: 'saved prompt',
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: [],
    outputAssetIds: [],
    modelParams: { size: 'saved-size' },
    createdAt: at,
    updatedAt: at,
  }
}

function snapshotFixture(): CanvasSnapshot {
  const savedTask = task('task-1', 'running')
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: 'Project',
      status: 'active',
      settings: {},
      nodeCount: 1,
      assetCount: 0,
      taskCount: 1,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [
      {
        id: 'operation-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text_to_image',
        taskId: savedTask.id,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: {
          operation: 'text_to_image',
          status: 'running',
          progress: 40,
          message: 'saved message',
          prompt: 'saved prompt',
        },
        createdAt: at,
        updatedAt: at,
      },
    ],
    edges: [],
    assets: [],
    tasks: [savedTask],
  }
}

describe('canvas runtime state merge', () => {
  it('persists terminal runtime fields without leaking dirty node or prompt edits', () => {
    const persisted = snapshotFixture()
    const failedTask: CanvasTask = {
      ...task('task-1', 'failed'),
      prompt: 'dirty prompt',
      modelParams: { size: 'dirty-size' },
      errorMsg: 'provider_failed',
      errorDetail: 'Provider failed',
      completedAt: '2026-08-24T00:01:00.000Z',
      updatedAt: '2026-08-24T00:01:00.000Z',
    }
    const merged = mergeCanvasRuntimeStateIntoSnapshot(persisted, {
      tasks: [failedTask],
      edges: [],
      assets: [],
      nodes: [
        {
          ...persisted.nodes[0]!,
          x: 240,
          data: {
            ...persisted.nodes[0]!.data,
            status: 'failed',
            progress: 100,
            message: '失败：Provider failed',
            prompt: 'dirty prompt',
          },
          updatedAt: failedTask.updatedAt,
        },
      ],
    })

    expect(merged.tasks[0]).toMatchObject({
      status: 'failed',
      progress: 100,
      prompt: 'saved prompt',
      modelParams: { size: 'saved-size' },
      errorMsg: 'provider_failed',
      errorDetail: 'Provider failed',
    })
    expect(merged.nodes[0]).toMatchObject({
      x: 0,
      data: {
        status: 'failed',
        progress: 100,
        message: '失败：Provider failed',
        prompt: 'saved prompt',
      },
    })
  })

  it('does not persist a task or node binding created only in the dirty hot state', () => {
    const persisted = snapshotFixture()
    const newTask = task('task-new', 'cancelled')
    const merged = mergeCanvasRuntimeStateIntoSnapshot(persisted, {
      tasks: [persisted.tasks[0]!, newTask],
      edges: [],
      assets: [],
      nodes: [
        {
          ...persisted.nodes[0]!,
          taskId: newTask.id,
          data: { ...persisted.nodes[0]!.data, status: 'cancelled', progress: 100 },
        },
      ],
    })

    expect(merged.tasks.map((item) => item.id)).toEqual(['task-1'])
    expect(merged.tasks[0]?.status).toBe('running')
    expect(merged.nodes[0]?.taskId).toBe('task-1')
    expect(merged.nodes[0]?.data.status).toBe('running')
  })

  it('does not persist unrelated pending task configuration drafts', () => {
    const persisted = snapshotFixture()
    const savedPending = {
      ...task('task-pending', 'pending'),
      operationNodeId: 'operation-pending',
      providerProfileId: 'saved-provider',
      modelId: 'saved-model',
    }
    persisted.tasks.push(savedPending)
    const dirtyPending = {
      ...savedPending,
      providerProfileId: 'draft-provider',
      modelId: 'draft-model',
      updatedAt: '2026-08-24T00:02:00.000Z',
    }

    const merged = mergeCanvasRuntimeStateIntoSnapshot(persisted, {
      tasks: [persisted.tasks[0]!, dirtyPending],
      edges: [],
      assets: [],
      nodes: persisted.nodes,
    })

    expect(merged.tasks.find((item) => item.id === savedPending.id)).toMatchObject({
      status: 'pending',
      providerProfileId: 'saved-provider',
      modelId: 'saved-model',
      updatedAt: at,
    })
  })

  it('persists outputs generated by an existing task without leaking unrelated dirty edits', () => {
    const persisted = snapshotFixture()
    const completedTask: CanvasTask = {
      ...task('task-1', 'completed'),
      prompt: 'dirty prompt',
      outputNodeIds: ['output-1'],
      outputAssetIds: ['asset-1'],
      completedAt: '2026-08-24T00:03:00.000Z',
      updatedAt: '2026-08-24T00:03:00.000Z',
    }
    const outputNode = {
      ...persisted.nodes[0]!,
      id: 'output-1',
      type: 'image' as const,
      taskId: null,
      assetId: 'asset-1',
      x: 500,
      data: { url: 'https://example.com/output.png', origin: 'task_output' as const },
    }
    const merged = mergeCanvasRuntimeStateIntoSnapshot(persisted, {
      tasks: [completedTask],
      nodes: [
        {
          ...persisted.nodes[0]!,
          x: 240,
          data: { ...persisted.nodes[0]!.data, status: 'completed', progress: 100 },
        },
        outputNode,
      ],
      assets: [
        {
          id: 'asset-1',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          url: 'https://example.com/output.png',
          metadata: { taskId: 'task-1' },
          createdAt: at,
          updatedAt: completedTask.updatedAt,
        },
      ],
      edges: [
        {
          id: 'edge-output-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          sourceNodeId: 'operation-1',
          targetNodeId: 'output-1',
          type: 'generated',
          taskId: 'task-1',
          metadata: {},
          createdAt: completedTask.updatedAt,
        },
      ],
    })

    expect(merged.tasks[0]).toMatchObject({
      status: 'completed',
      prompt: 'saved prompt',
      outputNodeIds: ['output-1'],
      outputAssetIds: ['asset-1'],
    })
    expect(merged.nodes.find((node) => node.id === 'operation-1')?.x).toBe(0)
    expect(merged.nodes.find((node) => node.id === 'output-1')).toEqual(outputNode)
    expect(merged.assets.map((asset) => asset.id)).toEqual(['asset-1'])
    expect(merged.edges.map((edge) => edge.id)).toEqual(['edge-output-1'])
  })
})
