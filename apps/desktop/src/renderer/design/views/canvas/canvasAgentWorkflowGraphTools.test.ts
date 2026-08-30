import { describe, expect, it, vi } from 'vitest'
import type { CanvasToolContext, CanvasWorkspaceActions } from './canvas.tools'
import type { CanvasEdge, CanvasNode, CanvasSnapshot } from './canvas.types'
import {
  CANVAS_AGENT_WORKFLOW_GRAPH_TOOLS,
  executeCanvasAgentWorkflowGraphTool,
} from './canvasAgentWorkflowGraphTools'

const at = '2026-07-25T00:00:00.000Z'

function baseSnapshot(): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '测试项目',
      status: 'active',
      settings: {},
      nodeCount: 0,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: '主画布',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    activeBoardId: 'board-1',
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
}

function graphInput() {
  return {
    name: '参考图转视频',
    nodes: [
      { ref: 'image-input', role: 'input', type: 'image', title: '上传参考图' },
      {
        ref: 'animate',
        role: 'operation',
        operation: 'image_to_video',
        title: '生成视频',
        prompt: '自然运镜',
        dependsOn: ['image-input'],
        isOutput: true,
        expectedOutputTypes: ['video'],
      },
    ],
  }
}

function node(input: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode {
  return {
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    title: input.id,
    x: 0,
    y: 0,
    width: 460,
    height: 300,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
    ...input,
  }
}

function edge(sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return {
    id: `edge-${sourceNodeId}-${targetNodeId}`,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    sourceNodeId,
    targetNodeId,
    type: 'used_as_input',
    taskId: null,
    metadata: {},
    createdAt: at,
  }
}

function context(
  snapshot: CanvasSnapshot,
  workspace: Partial<CanvasWorkspaceActions>,
  selectedIds: string[] = [],
  overrides: Partial<CanvasToolContext> = {},
): CanvasToolContext {
  return {
    projectId: 'project-1',
    getSnapshot: () => snapshot,
    getSelectedNodeIds: () => selectedIds,
    workspace: workspace as CanvasWorkspaceActions,
    ...overrides,
  }
}

function materializeGraph(before: CanvasSnapshot) {
  return vi.fn(async (input: Parameters<CanvasWorkspaceActions['applyTemplate']>[0]) => {
    const createdNodes = input.nodes.map((item, index) =>
      node({
        id: `created-${index + 1}`,
        type: item.type,
        title: item.title ?? null,
        x: input.originX + item.x,
        y: input.originY + item.y,
        width: item.width ?? 320,
        height: item.height ?? 220,
        data: item.data ?? {},
        ...(index > 0 ? { taskId: `task-${index}` } : {}),
      }),
    )
    const source = createdNodes[0]
    const target = createdNodes[1]
    if (!source || !target) throw new Error('test graph must create two nodes')
    return {
      ...before,
      nodes: [...before.nodes, ...createdNodes],
      edges: [...before.edges, edge(source.id, target.id)],
    }
  })
}

describe('canvas agent workflow graph tools', () => {
  it('registers atomic creation and read-only validation tools', () => {
    const schemas = Object.fromEntries(
      CANVAS_AGENT_WORKFLOW_GRAPH_TOOLS.map((tool) => [tool.name, tool]),
    )

    expect(schemas.canvas_create_reusable_workflow_graph?.paramsSchema).toHaveProperty('required', [
      'name',
      'nodes',
    ])
    expect(schemas.canvas_validate_workflow_graph?.paramsSchema).toBeDefined()
  })

  it('does not mutate the canvas when preflight validation fails', async () => {
    const applyTemplate = vi.fn()
    const snapshot = baseSnapshot()

    const result = await executeCanvasAgentWorkflowGraphTool(
      context(snapshot, { applyTemplate }),
      'canvas_create_reusable_workflow_graph',
      { name: '无输入流程', nodes: [{ ref: 'note', role: 'note', title: '说明' }] },
    )

    expect(applyTemplate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ created: false, valid: false })
  })

  it('plans and applies a connected graph in one workspace mutation', async () => {
    const before = baseSnapshot()
    before.nodes.push(node({ id: 'existing', type: 'text', x: 0, y: 0, width: 800, height: 500 }))
    const applyTemplate = vi.fn(
      async (input: Parameters<CanvasWorkspaceActions['applyTemplate']>[0]) => {
        const image = node({
          id: 'created-image',
          type: 'image',
          title: '上传参考图',
          x: input.originX + input.nodes[0]!.x,
          y: input.originY + input.nodes[0]!.y,
          data: input.nodes[0]!.data ?? {},
        })
        const operation = node({
          id: 'created-operation',
          type: 'image_to_video',
          title: '生成视频',
          x: input.originX + input.nodes[1]!.x,
          y: input.originY + input.nodes[1]!.y,
          data: input.nodes[1]!.data ?? {},
          taskId: 'task-1',
        })
        return {
          ...before,
          nodes: [...before.nodes, image, operation],
          edges: [...before.edges, edge(image.id, operation.id)],
        }
      },
    )

    const result = await executeCanvasAgentWorkflowGraphTool(
      context(before, { applyTemplate }),
      'canvas_create_reusable_workflow_graph',
      graphInput(),
    )

    expect(applyTemplate).toHaveBeenCalledTimes(1)
    expect(applyTemplate.mock.calls[0]?.[0]).toMatchObject({
      boardId: 'board-1',
      originX: expect.any(Number),
      nodes: [
        expect.objectContaining({ type: 'image' }),
        expect.objectContaining({ type: 'image_to_video' }),
      ],
      edges: [expect.objectContaining({ from: 'image-input', to: 'animate' })],
    })
    expect(result).toMatchObject({
      created: true,
      valid: true,
      createdNodeIds: ['created-image', 'created-operation'],
      inputNodeIds: ['created-image'],
      outputNodeIds: ['created-operation'],
      edgeCount: 1,
    })
  })

  it('prefers free space in the live viewport without moving the camera', async () => {
    const before = baseSnapshot()
    const applyTemplate = materializeGraph(before)
    const revealNodes = vi.fn()

    const result = await executeCanvasAgentWorkflowGraphTool(
      context(before, { applyTemplate }, [], {
        getViewport: () => ({ x: 0, y: 0, zoom: 1, width: 1400, height: 800 }),
        revealNodes,
      }),
      'canvas_create_reusable_workflow_graph',
      graphInput(),
    )

    expect(applyTemplate.mock.calls[0]?.[0]).toMatchObject({
      originX: expect.any(Number),
      originY: expect.any(Number),
    })
    expect(result).toMatchObject({ placement: 'viewport', focusedAfterCreate: false })
    expect(revealNodes).not.toHaveBeenCalled()
  })

  it('focuses all created nodes when the workflow must be placed outside the viewport', async () => {
    const before = baseSnapshot()
    const applyTemplate = materializeGraph(before)
    const revealNodes = vi.fn()

    const result = await executeCanvasAgentWorkflowGraphTool(
      context(before, { applyTemplate }, [], {
        getViewport: () => ({ x: 0, y: 0, zoom: 1, width: 640, height: 480 }),
        revealNodes,
      }),
      'canvas_create_reusable_workflow_graph',
      graphInput(),
    )

    expect(result).toMatchObject({
      placement: 'canvas_outside',
      focusedAfterCreate: true,
      createdNodeIds: ['created-1', 'created-2'],
    })
    expect(revealNodes).toHaveBeenCalledWith(['created-1', 'created-2'])
  })

  it('validates the current selection without requiring all canvas nodes to be connected', async () => {
    const snapshot = baseSnapshot()
    snapshot.nodes = [
      node({ id: 'input', type: 'image', data: { subtype: 'workflow_input' } }),
      node({
        id: 'operation',
        type: 'image_to_video',
        taskId: 'task-1',
        x: 600,
        data: { operation: 'image_to_video', prompt: '自然运镜', subtype: 'workflow_output' },
      }),
      node({ id: 'unrelated', type: 'text', x: -600, data: { text: '画布其他内容' } }),
    ]
    snapshot.edges = [edge('input', 'operation')]

    const result = await executeCanvasAgentWorkflowGraphTool(
      context(snapshot, {}, ['input', 'operation']),
      'canvas_validate_workflow_graph',
      {},
    )

    expect(result).toMatchObject({
      valid: true,
      checkedNodeIds: ['input', 'operation'],
      inputNodeIds: ['input'],
      outputNodeIds: ['operation'],
    })
  })
})
