// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-24T00:00:00.000Z'

function seedEmptyCanvas(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        rootPath: '/tmp/project-1',
        settings: {},
        nodeCount: 0,
        assetCount: 0,
        taskCount: 0,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [
      {
        id: 'board-1',
        projectId: 'project-1',
        userId: 0,
        name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('canvasApi.applyTemplate for canvas workflows', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }) },
    })
    seedEmptyCanvas()
  })

  it('atomically creates independent typed nodes, tasks, and handled edges', async () => {
    const snapshot = await canvasApi.applyTemplate({
      projectId: 'project-1',
      boardId: 'board-1',
      originX: 100,
      originY: 200,
      nodes: [
        {
          ref: 'workflow-prompt',
          type: 'prompt',
          title: '产品描述',
          x: 0,
          y: 20,
          data: { text: '玻璃香水瓶', format: 'prompt' },
        },
        {
          ref: 'workflow-operation',
          type: 'text_to_image',
          title: '产品图生成',
          x: 360,
          y: 0,
          data: {
            operation: 'text_to_image',
            prompt: '商业产品摄影',
            negativePrompt: '模糊',
            modelId: 'image-model',
            modelParams: { aspectRatio: '1:1' },
            inputBindings: [
              {
                id: 'prompt-binding',
                sourceNodeId: 'workflow-prompt',
                origin: 'connection',
                kind: 'text',
                relation: 'generic',
                role: 'input',
                enabled: true,
                order: 0,
              },
            ],
          },
        },
      ],
      edges: [
        {
          from: 'workflow-prompt',
          to: 'workflow-operation',
          type: 'used_as_input',
          sourceHandle: 'output-text',
          targetHandle: 'input-prompt',
        },
      ],
    })

    expect(snapshot.nodes).toHaveLength(2)
    expect(snapshot.nodes.map((node) => node.id)).not.toContain('workflow-prompt')
    expect(snapshot.nodes.map((node) => node.id)).not.toContain('workflow-operation')
    expect(snapshot.nodes[0]).toMatchObject({ x: 100, y: 220, type: 'prompt' })
    expect(snapshot.nodes[1]).toMatchObject({
      x: 460,
      y: 200,
      type: 'text_to_image',
      data: {
        operation: 'text_to_image',
        prompt: '商业产品摄影',
        modelId: 'image-model',
        modelParams: { aspectRatio: '1:1' },
        status: 'pending',
        progress: 0,
        inputBindings: [
          expect.objectContaining({ sourceNodeId: snapshot.nodes[0]!.id }),
        ],
      },
    })
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]).toMatchObject({
      operation: 'text_to_image',
      operationNodeId: snapshot.nodes[1]!.id,
      inputNodeIds: [snapshot.nodes[0]!.id],
      prompt: '商业产品摄影',
      negativePrompt: '模糊',
      modelId: 'image-model',
      modelParams: { aspectRatio: '1:1' },
      inputBindings: [expect.objectContaining({ sourceNodeId: snapshot.nodes[0]!.id })],
    })
    expect(snapshot.edges[0]).toMatchObject({
      sourceNodeId: snapshot.nodes[0]!.id,
      targetNodeId: snapshot.nodes[1]!.id,
      metadata: {
        sourceHandle: 'output-text',
        targetHandle: 'input-prompt',
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('workflow-prompt')
    expect(JSON.stringify(snapshot)).not.toContain('workflow-operation')
  })
})
