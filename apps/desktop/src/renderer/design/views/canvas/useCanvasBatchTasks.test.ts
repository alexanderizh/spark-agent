import { describe, expect, it, vi } from 'vitest'
import { createCanvasBatchTaskController } from './useCanvasBatchTasks'
import { CanvasTaskValidationError } from './canvasTaskSubmissionValidation'
import type { PreparedCanvasOperationSubmission } from './canvasOperationSubmission'
import type { CanvasNode, CanvasNodeData, CanvasSnapshot } from './canvas.types'

function operationNode(id: string, type: 'text_to_image' | 'text_to_video'): CanvasNode {
  return {
    id,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type,
    title: id,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {
      prompt: `${id} prompt`,
      modelId: `${id}-model`,
      modelParams: { size: '1K' },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
}

function snapshot(nodes = [
  operationNode('node-1', 'text_to_image'),
  operationNode('node-2', 'text_to_video'),
]): CanvasSnapshot {
  return {
    project: {
      id: 'project',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: nodes.length,
      assetCount: 0,
      taskCount: 0,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    },
    board: {
      id: 'board',
      projectId: 'project',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    },
    nodes,
    edges: [],
    assets: [],
    tasks: [],
  }
}

function prepared(nodeId: string): PreparedCanvasOperationSubmission {
  return {
    nodeId,
    operation: nodeId === 'node-1' ? 'text_to_image' : 'text_to_video',
    title: nodeId,
    params: { prompt: `${nodeId} prompt`, modelId: `${nodeId}-model` },
  }
}

function setup(input?: {
  skipConfirmation?: boolean
  skipParameterValidation?: boolean
  nodes?: CanvasNode[]
  prepare?: (
    nodeId: string,
    options?: { skipParameterValidation?: boolean },
  ) => Promise<PreparedCanvasOperationSubmission>
  run?: (nodeId: string) => Promise<void>
  onSingleValidationError?: (nodeId: string, error: unknown) => void
  confirmParameterValidation?: () => Promise<{
    confirmed: boolean
    skipFutureValidation: boolean
  }>
}) {
  let current = snapshot(input?.nodes)
  const updateManyNodeData = vi.fn(
    async (updates: Array<{ nodeId: string; data: Partial<CanvasNodeData> }>) => {
    current = {
      ...current,
      nodes: current.nodes.map((node) => {
        const update = updates.find((item) => item.nodeId === node.id)
        return update
          ? {
              ...node,
              data: { ...node.data, ...update.data },
              updatedAt: '2026-07-16T00:01:00.000Z',
            }
          : node
      }),
    }
    return current
    },
  )
  const runOperationNode = vi.fn(async (nodeId: string) => {
    await input?.run?.(nodeId)
  })
  const prepareSubmission = vi.fn(
    async ({ node }: { node: CanvasNode }, options?: { skipParameterValidation?: boolean }) =>
      input?.prepare ? input.prepare(node.id, options) : prepared(node.id),
  )
  const writeSkipConfirmation = vi.fn()
  const writeSkipParameterValidation = vi.fn()
  const controller = createCanvasBatchTaskController({
    getSnapshot: () => current,
    updateManyNodeData,
    runOperationNode,
    prepareSubmission,
    readSkipConfirmation: () => input?.skipConfirmation ?? false,
    writeSkipConfirmation,
    readSkipParameterValidation: () => input?.skipParameterValidation ?? false,
    writeSkipParameterValidation,
    ...(input?.confirmParameterValidation
      ? { confirmParameterValidation: input.confirmParameterValidation }
      : {}),
    createBatchId: () => 'batch-1',
    ...(input?.onSingleValidationError
      ? { onSingleValidationError: input.onSingleValidationError }
      : {}),
  })
  return {
    controller,
    updateManyNodeData,
    runOperationNode,
    prepareSubmission,
    writeSkipConfirmation,
    writeSkipParameterValidation,
    replaceNode: (nodeId: string, replace: (node: CanvasNode) => CanvasNode) => {
      current = {
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? replace(node) : node)),
      }
    },
  }
}

describe('useCanvasBatchTasks controller', () => {
  it('saves all drafts once and never runs for save-only', async () => {
    const { controller, updateManyNodeData, runOperationNode } = setup()
    controller.openConfigure(['node-1', 'node-2'])
    controller.patchGroup('text_to_image', {
      touched: ['modelParams.size'],
      values: { modelParams: { size: '4K' } },
    })

    await controller.saveDrafts()

    expect(updateManyNodeData).toHaveBeenCalledTimes(1)
    expect(updateManyNodeData).toHaveBeenCalledWith([
      { nodeId: 'node-1', data: { modelParams: { size: '4K' } } },
    ])
    expect(runOperationNode).not.toHaveBeenCalled()
    expect(controller.getState().mode).toBe('configure')
  })

  it('shows validation issues as warnings and submits after confirmation', async () => {
    const validationError = new CanvasTaskValidationError([
      {
        severity: 'error',
        code: 'missing_required',
        message: '请选择模型',
        path: ['modelId'],
      },
    ])
    const { controller, runOperationNode, writeSkipParameterValidation, prepareSubmission } = setup({
      skipConfirmation: true,
      prepare: async (nodeId, options) => {
        if (nodeId === 'node-2' && !options?.skipParameterValidation) throw validationError
        return prepared(nodeId)
      },
    })

    await controller.openSubmit(['node-1', 'node-2'])

    expect(runOperationNode).not.toHaveBeenCalled()
    expect(prepareSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ node: expect.objectContaining({ id: 'node-2' }) }),
      { skipParameterValidation: true },
    )
    expect(controller.getState()).toMatchObject({
      mode: 'confirm',
      validationWarnings: [
        {
          nodeId: 'node-2',
          fieldPath: ['modelId'],
          message: '请选择模型',
        },
      ],
    })

    controller.setSkipParameterValidation(true)
    await controller.confirmSubmit()

    expect(writeSkipParameterValidation).toHaveBeenCalledWith(true)
    expect(runOperationNode).toHaveBeenCalledTimes(2)
  })

  it('opens confirmation and persists skip only after explicit confirmation', async () => {
    const { controller, runOperationNode, writeSkipConfirmation } = setup()

    await controller.openSubmit(['node-1', 'node-2'])
    expect(controller.getState().mode).toBe('confirm')
    controller.setSkipNextConfirmation(true)
    controller.backToConfigure()
    expect(writeSkipConfirmation).not.toHaveBeenCalled()

    await controller.submit()
    controller.setSkipNextConfirmation(true)
    await controller.confirmSubmit()

    expect(writeSkipConfirmation).toHaveBeenCalledWith(true)
    expect(runOperationNode).toHaveBeenCalledTimes(2)
    expect(controller.getState().mode).toBe('result')
  })

  it('keeps successful results and retries only failed nodes', async () => {
    let nodeTwoAttempts = 0
    const { controller, runOperationNode } = setup({
      skipConfirmation: true,
      run: async (nodeId) => {
        if (nodeId === 'node-2' && nodeTwoAttempts++ === 0) {
          throw new Error('network error')
        }
      },
    })

    await controller.openSubmit(['node-1', 'node-2'])

    expect(controller.getState().results).toEqual([
      { nodeId: 'node-1', batchId: 'batch-1', status: 'succeeded' },
      {
        nodeId: 'node-2',
        batchId: 'batch-1',
        status: 'failed',
        error: 'network error',
      },
    ])

    await controller.retryFailed()

    expect(runOperationNode.mock.calls.map(([nodeId]) => nodeId)).toEqual([
      'node-1',
      'node-2',
      'node-2',
    ])
    expect(controller.getState().results).toEqual([
      { nodeId: 'node-1', batchId: 'batch-1', status: 'succeeded' },
      { nodeId: 'node-2', batchId: 'batch-1', status: 'succeeded' },
    ])
  })

  it('ignores duplicate confirmation while the batch is submitting', async () => {
    let releaseRun: (() => void) | undefined
    const runPending = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    const { controller, runOperationNode } = setup({
      run: async () => runPending,
    })

    await controller.openSubmit(['node-1', 'node-2'])
    const first = controller.confirmSubmit()
    const second = controller.confirmSubmit()

    expect(controller.getState().mode).toBe('submitting')
    expect(runOperationNode).toHaveBeenCalledTimes(2)
    releaseRun?.()
    await Promise.all([first, second])
    expect(runOperationNode).toHaveBeenCalledTimes(2)
  })

  it('does not reopen a closed panel when an in-flight submission settles', async () => {
    let releaseRun: (() => void) | undefined
    const runPending = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    const { controller } = setup({
      skipConfirmation: true,
      run: async () => runPending,
    })

    const submitting = controller.openSubmit(['node-1', 'node-2'])
    await vi.waitFor(() => expect(controller.getState().mode).toBe('submitting'))
    controller.close()
    releaseRun?.()
    await submitting

    expect(controller.getState().mode).toBe('closed')
  })

  it('blocks stale draft writes and refreshes untouched values from the latest node', async () => {
    const { controller, replaceNode, updateManyNodeData } = setup()
    controller.openConfigure(['node-1', 'node-2'])
    controller.patchGroup('text_to_image', {
      touched: ['modelParams.size'],
      values: { modelParams: { size: '4K' } },
    })
    replaceNode('node-1', (node) => ({
      ...node,
      data: {
        ...node.data,
        modelId: 'external-model',
        modelParams: { size: '2K', seed: 9 },
      },
      updatedAt: '2026-07-16T00:00:30.000Z',
    }))

    await expect(controller.saveDrafts()).rejects.toThrow(
      '节点配置已变化，已合并最新值，请检查后重试',
    )

    expect(updateManyNodeData).not.toHaveBeenCalled()
    expect(controller.getState().issues).toEqual([
      {
        nodeId: 'node-1',
        fieldPath: [],
        message: '节点配置已变化，已合并最新值，请检查后重试',
      },
    ])
    expect(controller.getState().session?.entries[0]?.draft).toMatchObject({
      modelId: 'external-model',
      modelParams: { size: '4K', seed: 9 },
    })

    await controller.saveDrafts()

    expect(updateManyNodeData).toHaveBeenCalledWith([
      {
        nodeId: 'node-1',
        data: { modelParams: { size: '4K', seed: 9 } },
      },
    ])
    expect(controller.getState().issues).toEqual([])
  })

  it('does not classify operation execution failures as validation failures', async () => {
    const onSingleValidationError = vi.fn()
    const { controller } = setup({
      run: async () => {
        throw new Error('network error')
      },
      onSingleValidationError,
    })

    await expect(controller.runSingle('node-1')).rejects.toThrow('network error')

    expect(onSingleValidationError).not.toHaveBeenCalled()
  })

  it('warns and continues a single run after explicit confirmation', async () => {
    const validationError = new CanvasTaskValidationError([
      {
        severity: 'error',
        code: 'missing_required',
        message: '请选择模型',
        path: ['modelId'],
      },
    ])
    const onSingleValidationError = vi.fn()
    const confirmParameterValidation = vi.fn(async () => ({
      confirmed: true,
      skipFutureValidation: false,
    }))
    const { controller, runOperationNode, prepareSubmission } = setup({
      prepare: async (nodeId, options) => {
        if (!options?.skipParameterValidation) throw validationError
        return prepared(nodeId)
      },
      onSingleValidationError,
      confirmParameterValidation,
    })

    await controller.runSingle('node-1')

    expect(confirmParameterValidation).toHaveBeenCalledWith(validationError.issues)
    expect(onSingleValidationError).not.toHaveBeenCalled()
    expect(prepareSubmission).toHaveBeenLastCalledWith(
      expect.objectContaining({ node: expect.objectContaining({ id: 'node-1' }) }),
      { skipParameterValidation: true },
    )
    expect(runOperationNode).toHaveBeenCalledTimes(1)
  })

  it('bounds preflight preparation concurrency', async () => {
    const nodes = Array.from({ length: 8 }, (_, index) =>
      operationNode(`node-${index + 1}`, 'text_to_image'),
    )
    let active = 0
    let maxActive = 0
    const { controller } = setup({
      nodes,
      prepare: async (nodeId) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return prepared(nodeId)
      },
    })

    await controller.openSubmit(nodes.map((node) => node.id))

    expect(maxActive).toBeLessThanOrEqual(3)
    expect(controller.getState().mode).toBe('confirm')
  })
})
