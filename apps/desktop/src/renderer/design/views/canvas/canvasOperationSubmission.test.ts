import { describe, expect, it, vi } from 'vitest'
import type { CanvasPromptSubmission } from './canvasPromptSubmission'
import {
  prepareSavedCanvasOperationSubmission,
  type CanvasOperationSubmissionDependencies,
} from './canvasOperationSubmission'
import { CanvasTaskValidationError } from './canvasTaskSubmissionValidation'
import type { CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

function operationNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'operation-1',
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type: 'image_to_video',
    title: '短视频',
    taskId: 'task-1',
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
      prompt: '让画面动起来',
      providerProfileId: 'provider-node',
      manifestId: 'manifest-node',
      modelId: 'model-node',
      modelParams: { duration: 6 },
      ...overrides.data,
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  }
}

function task(overrides: Partial<CanvasTask> = {}): CanvasTask {
  return {
    id: 'task-1',
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    operation: 'image_to_video',
    status: 'pending',
    progress: 0,
    title: '短视频',
    prompt: '旧任务提示词',
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: [],
    outputAssetIds: [],
    modelParams: {},
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  }
}

function snapshot(node = operationNode()): CanvasSnapshot {
  const input: CanvasNode = {
    ...operationNode({
      id: 'input-1',
      type: 'image',
      taskId: null,
      title: '首帧',
      assetId: 'asset-1',
      data: { url: 'https://cdn.example.com/first.png' },
    }),
  }
  return {
    project: {
      id: 'project',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: 2,
      assetCount: 1,
      taskCount: 1,
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
    nodes: [input, node],
    edges: [
      {
        id: 'edge-1',
        projectId: 'project',
        boardId: 'board',
        userId: 1,
        sourceNodeId: 'input-1',
        targetNodeId: node.id,
        type: 'used_as_input',
        metadata: {},
        createdAt: '2026-07-16T00:00:00.000Z',
      },
    ],
    assets: [
      {
        id: 'asset-1',
        projectId: 'project',
        userId: 1,
        type: 'image',
        source: 'upload',
        title: '首帧',
        url: 'https://cdn.example.com/first.png',
        metadata: {},
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
      },
    ],
    tasks: [task()],
  }
}

function dependencies(
  overrides: Partial<CanvasOperationSubmissionDependencies> = {},
): CanvasOperationSubmissionDependencies {
  return {
    compile: vi.fn(async (): Promise<CanvasPromptSubmission> => ({
      prompt: '编译后的提示词',
      compiledUserText: '编译后的提示词',
      inputFiles: [
        {
          type: 'image',
          role: 'first_frame',
          url: 'https://cdn.example.com/first.png',
        },
      ],
    })),
    validateMedia: vi.fn(async (request) => ({
      ...request,
      modelParams: { duration: 6 },
    })),
    validateText: vi.fn((request) => request),
    ...overrides,
  }
}

describe('canvasOperationSubmission', () => {
  it('uses saved node runtime and connected input nodes', async () => {
    const deps = dependencies()
    const current = snapshot()

    const prepared = await prepareSavedCanvasOperationSubmission(
      { snapshot: current, node: current.nodes[1]! },
      deps,
    )

    expect(deps.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: current,
        operation: 'image_to_video',
        inputNodeIds: ['input-1'],
      }),
    )
    expect(deps.validateMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'image_to_video',
        inputFiles: [expect.objectContaining({ type: 'image' })],
        providerProfileId: 'provider-node',
        modelId: 'model-node',
      }),
    )
    expect(prepared).toMatchObject({
      nodeId: 'operation-1',
      operation: 'image_to_video',
      title: '短视频',
      params: {
        prompt: '编译后的提示词',
        inputNodeIds: ['input-1'],
        inputAssetIds: ['asset-1'],
        providerProfileId: 'provider-node',
        manifestId: 'manifest-node',
        modelId: 'model-node',
        modelParams: { duration: 6 },
      },
    })
  })

  it('uses the bound task runtime when the node has no saved override', async () => {
    const current = snapshot(
      operationNode({
        data: {
          prompt: '节点提示词',
          modelParams: {},
        },
      }),
    )
    current.tasks = [
      task({
        providerProfileId: 'provider-task',
        manifestId: 'manifest-task',
        modelId: 'model-task',
        reasoningEffort: 'high',
        skillIds: ['skill-1'],
        modelParams: { duration: 8 },
      }),
    ]

    const prepared = await prepareSavedCanvasOperationSubmission(
      { snapshot: current, node: current.nodes[1]! },
      dependencies(),
    )

    expect(prepared.params).toMatchObject({
      providerProfileId: 'provider-task',
      manifestId: 'manifest-task',
      modelId: 'model-task',
      reasoningEffort: 'high',
      skillIds: ['skill-1'],
      modelParams: { duration: 6 },
    })
  })

  it('passes saved input bindings back into compilation when rerunning a node', async () => {
    const deps = dependencies()
    const current = snapshot(
      operationNode({
        data: {
          prompt: '节点提示词',
          inputBindings: [
            {
              id: 'connection:input-1:first_frame',
              sourceNodeId: 'input-1',
              origin: 'connection',
              kind: 'image',
              relation: 'first_frame',
              role: 'first_frame',
              enabled: true,
              order: 0,
            },
          ],
        },
      }),
    )

    await prepareSavedCanvasOperationSubmission(
      { snapshot: current, node: current.nodes[1]! },
      deps,
    )

    expect(deps.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        inputBindings: [expect.objectContaining({ sourceNodeId: 'input-1', role: 'first_frame' })],
      }),
    )
  })

  it('preserves structured validation issues', async () => {
    const validationError = new CanvasTaskValidationError([
      {
        severity: 'error',
        code: 'missing_required',
        message: '请选择输入图片',
        path: ['inputFiles'],
      },
    ])
    const deps = dependencies({
      validateMedia: vi.fn(async () => {
        throw validationError
      }),
    })
    const current = snapshot()

    await expect(
      prepareSavedCanvasOperationSubmission(
        { snapshot: current, node: current.nodes[1]! },
        deps,
      ),
    ).rejects.toBe(validationError)
  })

  it('blocks specialized extraction workflows from the generic batch runner', async () => {
    const current = snapshot(
      operationNode({
        type: 'text_generate',
        data: {
          operation: 'text_generate',
          prompt: '提取角色',
          modelParams: { workflow: 'extract_character' },
        },
      }),
    )

    await expect(
      prepareSavedCanvasOperationSubmission(
        { snapshot: current, node: current.nodes[1]! },
        dependencies(),
      ),
    ).rejects.toThrow('该流水线任务需单独运行')
  })

  it('blocks a running node before compiling submission inputs', async () => {
    const current = snapshot(
      operationNode({
        data: {
          prompt: '让画面动起来',
          status: 'running',
        },
      }),
    )
    const deps = dependencies()

    await expect(
      prepareSavedCanvasOperationSubmission(
        { snapshot: current, node: current.nodes[1]! },
        deps,
      ),
    ).rejects.toThrow('任务正在运行')
    expect(deps.compile).not.toHaveBeenCalled()
  })
})
