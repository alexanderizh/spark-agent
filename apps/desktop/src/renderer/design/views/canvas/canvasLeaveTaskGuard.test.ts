import { describe, expect, it, vi } from 'vitest'
import { confirmCanvasLeaveWithRunningTasks } from './canvasLeaveTaskGuard'
import type { CanvasTask, CanvasTaskStatus } from './canvas.types'

function task(id: string, status: CanvasTaskStatus): CanvasTask {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    operation: 'text_to_image',
    status,
    progress: status === 'completed' ? 100 : 0,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: [],
    outputAssetIds: [],
    modelParams: {},
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

describe('canvas leave task guard', () => {
  it('does not show a stale running warning when the latest task list is terminal', async () => {
    const confirmLeave = vi.fn(async () => true)
    const cancelTask = vi.fn(async () => undefined)

    await expect(
      confirmCanvasLeaveWithRunningTasks({
        readLatestTasks: async () => [
          task('completed', 'completed'),
          task('failed', 'failed'),
          task('cancelled', 'cancelled'),
        ],
        confirmLeave,
        cancelTask,
      }),
    ).resolves.toBe(true)

    expect(confirmLeave).not.toHaveBeenCalled()
    expect(cancelTask).not.toHaveBeenCalled()
  })

  it('rechecks after confirmation and skips tasks that finished while the modal was open', async () => {
    const readLatestTasks = vi
      .fn<() => Promise<CanvasTask[]>>()
      .mockResolvedValueOnce([task('task-1', 'running')])
      .mockResolvedValueOnce([task('task-1', 'completed')])
    const cancelTask = vi.fn(async () => undefined)

    await expect(
      confirmCanvasLeaveWithRunningTasks({
        readLatestTasks,
        confirmLeave: async () => true,
        cancelTask,
      }),
    ).resolves.toBe(true)

    expect(readLatestTasks).toHaveBeenCalledTimes(2)
    expect(cancelTask).not.toHaveBeenCalled()
  })

  it('cancels only tasks that are still running after confirmation', async () => {
    const readLatestTasks = vi
      .fn<() => Promise<CanvasTask[]>>()
      .mockResolvedValueOnce([task('task-a', 'running'), task('task-b', 'running')])
      .mockResolvedValueOnce([task('task-a', 'completed'), task('task-b', 'running')])
    const cancelTask = vi.fn(async () => undefined)

    await expect(
      confirmCanvasLeaveWithRunningTasks({
        readLatestTasks,
        confirmLeave: async (count) => count === 2,
        cancelTask,
      }),
    ).resolves.toBe(true)

    expect(cancelTask).toHaveBeenCalledTimes(1)
    expect(cancelTask).toHaveBeenCalledWith('task-b')
  })

  it('keeps the user on the canvas when leave is declined', async () => {
    const cancelTask = vi.fn(async () => undefined)

    await expect(
      confirmCanvasLeaveWithRunningTasks({
        readLatestTasks: async () => [task('task-1', 'running')],
        confirmLeave: async () => false,
        cancelTask,
      }),
    ).resolves.toBe(false)

    expect(cancelTask).not.toHaveBeenCalled()
  })
})
