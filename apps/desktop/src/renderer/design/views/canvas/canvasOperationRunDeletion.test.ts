import { describe, expect, it, vi } from 'vitest'
import { deleteCanvasOperationRun } from './canvasOperationRunDeletion'
import type { CanvasOperationRunView } from './canvasOperationRuns'

function runFixture(
  status: CanvasOperationRunView['status'],
  outputCount = 0,
): CanvasOperationRunView {
  return {
    taskId: 'task-1',
    status,
    progress: status === 'running' ? 40 : 100,
    createdAt: '2026-08-23T12:00:00.000Z',
    outputs: Array.from({ length: outputCount }, (_, index) => ({
      id: `output-${index + 1}`,
      taskId: 'task-1',
      type: 'image',
      title: `产物 ${index + 1}`,
      createdAt: '2026-08-23T12:00:00.000Z',
      updatedAt: '2026-08-23T12:00:00.000Z',
    })),
  }
}

describe('canvas operation run deletion', () => {
  it.each(['pending', 'running'] as const)(
    'cancels an active %s runtime before deleting its task record',
    async (status) => {
      const calls: string[] = []
      await deleteCanvasOperationRun({
        operationNodeId: 'operation-1',
        run: runFixture(status),
        cancelTask: vi.fn(async () => {
          calls.push('cancel')
        }),
        flushTaskRuntimeWrites: vi.fn(async () => {
          calls.push('persist')
        }),
        deleteOperationOutputs: vi.fn(async () => {
          calls.push('outputs')
        }),
        deleteTasks: vi.fn(async () => {
          calls.push('task')
          return { tasks: [] }
        }),
      })

      expect(calls).toEqual(['cancel', 'persist', 'task'])
    },
  )

  it('removes partial outputs before deleting a failed run record', async () => {
    const calls: string[] = []
    await deleteCanvasOperationRun({
      operationNodeId: 'operation-1',
      run: runFixture('failed', 2),
      cancelTask: vi.fn(async () => {
        calls.push('cancel')
      }),
      flushTaskRuntimeWrites: vi.fn(async () => {
        calls.push('persist')
      }),
      deleteOperationOutputs: vi.fn(async () => {
        calls.push('outputs')
      }),
      deleteTasks: vi.fn(async () => {
        calls.push('task')
        return { tasks: [] }
      }),
    })

    expect(calls).toEqual(['persist', 'outputs', 'task'])
  })

  it('deletes a terminal empty run without sending another cancellation', async () => {
    const cancelTask = vi.fn(async () => undefined)
    const deleteTasks = vi.fn(async () => ({ tasks: [] }))

    await deleteCanvasOperationRun({
      operationNodeId: 'operation-1',
      run: runFixture('cancelled'),
      cancelTask,
      flushTaskRuntimeWrites: vi.fn(async () => undefined),
      deleteOperationOutputs: vi.fn(async () => undefined),
      deleteTasks,
    })

    expect(cancelTask).not.toHaveBeenCalled()
    expect(deleteTasks).toHaveBeenCalledWith(['task-1'])
  })

  it('reports when a concurrently completed run is preserved by the deletion safety guard', async () => {
    await expect(
      deleteCanvasOperationRun({
        operationNodeId: 'operation-1',
        run: runFixture('running'),
        cancelTask: vi.fn(async () => undefined),
        flushTaskRuntimeWrites: vi.fn(async () => undefined),
        deleteOperationOutputs: vi.fn(async () => undefined),
        deleteTasks: vi.fn(async () => ({ tasks: [{ id: 'task-1' }] })),
      }),
    ).resolves.toBe('preserved')
  })

  it('keeps the run record when its latest runtime state cannot be persisted', async () => {
    const deleteTasks = vi.fn(async () => ({ tasks: [] }))

    await expect(
      deleteCanvasOperationRun({
        operationNodeId: 'operation-1',
        run: runFixture('running'),
        cancelTask: vi.fn(async () => undefined),
        flushTaskRuntimeWrites: vi.fn(async () => {
          throw new Error('persist failed')
        }),
        deleteOperationOutputs: vi.fn(async () => undefined),
        deleteTasks,
      }),
    ).rejects.toThrow('persist failed')

    expect(deleteTasks).not.toHaveBeenCalled()
  })
})
