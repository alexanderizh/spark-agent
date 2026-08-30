import { describe, expect, it } from 'vitest'
import {
  isCanvasTaskActive,
  isCanvasTaskRunning,
  selectRunningCanvasTasks,
} from './canvasTaskActivity'
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

describe('canvas task activity', () => {
  it.each([
    ['pending', true, false],
    ['running', true, true],
    ['completed', false, false],
    ['failed', false, false],
    ['cancelled', false, false],
  ] as const)('classifies %s consistently', (status, active, running) => {
    expect(isCanvasTaskActive(task(status, status))).toBe(active)
    expect(isCanvasTaskRunning(task(status, status))).toBe(running)
  })

  it('selects only running tasks for the leave guard', () => {
    const tasks = [
      task('pending', 'pending'),
      task('running', 'running'),
      task('completed', 'completed'),
      task('failed', 'failed'),
      task('cancelled', 'cancelled'),
    ]

    expect(selectRunningCanvasTasks(tasks).map((item) => item.id)).toEqual(['running'])
  })
})
