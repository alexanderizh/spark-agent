import { describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot, CanvasTask } from './canvas.types'
import { waitForCanvasWorkflowTask } from './canvasWorkflowTaskAdapter'

function snapshot(task: Partial<CanvasTask>): CanvasSnapshot {
  return {
    project: {} as CanvasSnapshot['project'],
    board: {} as CanvasSnapshot['board'],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        operation: 'text_to_image',
        status: 'running',
        progress: 50,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: [],
        modelParams: {},
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
        ...task,
      },
    ],
  }
}

describe('waitForCanvasWorkflowTask', () => {
  it('waits for a terminal task and returns its materialized outputs', async () => {
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ status: 'running' }))
      .mockResolvedValueOnce(
        snapshot({
          status: 'completed',
          outputNodeIds: ['node-output'],
          outputAssetIds: ['asset-output'],
        }),
      )

    const result = await waitForCanvasWorkflowTask({
      projectId: 'project-1',
      taskId: 'task-1',
      readSnapshot,
      pollIntervalMs: 0,
      timeoutMs: 100,
    })

    expect(result.outputNodeIds).toEqual(['node-output'])
    expect(result.outputAssetIds).toEqual(['asset-output'])
  })

  it('surfaces persisted task failures and honors cancellation', async () => {
    await expect(
      waitForCanvasWorkflowTask({
        projectId: 'project-1',
        taskId: 'task-1',
        readSnapshot: async () => snapshot({ status: 'failed', errorMsg: '额度不足' }),
        pollIntervalMs: 0,
        timeoutMs: 100,
      }),
    ).rejects.toThrow(/额度不足/)

    const controller = new AbortController()
    controller.abort()
    await expect(
      waitForCanvasWorkflowTask({
        projectId: 'project-1',
        taskId: 'task-1',
        readSnapshot: async () => snapshot({ status: 'running' }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
