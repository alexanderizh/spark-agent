import { describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from './canvas.types'
import type { CanvasWorkspaceActions } from './canvas.tools'

import { executeCanvasTool, getCanvasToolSchemas } from './canvas.tools'

const at = '2026-07-18T00:00:00.000Z'

function screenplaySnapshot(): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '工具测试',
      status: 'active',
      settings: {},
      nodeCount: 1,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'Canvas',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    activeBoardId: 'board-1',
    nodes: [
      {
        id: 'screenplay-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text',
        title: '第一集',
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { text: '# 场1 内景 茶馆 日', pipelineRole: 'screenplay' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    edges: [],
    assets: [],
    tasks: [],
  }
}

describe('canvas agent tool schemas', () => {
  it('does not expose multi-board operations to canvas agents', () => {
    const names = getCanvasToolSchemas().map((tool) => tool.name)

    expect(names).not.toContain('canvas_list_boards')
    expect(names).not.toContain('canvas_create_board')
    expect(names).not.toContain('canvas_rename_board')
    expect(names).not.toContain('canvas_delete_board')
    expect(names).not.toContain('canvas_duplicate_board')
    expect(names).not.toContain('canvas_switch_board')
    expect(names).not.toContain('canvas_copy_nodes_to_board')
    expect(names).not.toContain('canvas_insert_asset_to_board')
    expect(names).toContain('canvas_insert_asset')
    expect(names).toContain('canvas_workflow_list')
    expect(names).toContain('canvas_workflow_apply')
    expect(names).toContain('canvas_workflow_run')
    expect(names).toContain('canvas_create_reusable_workflow_graph')
    expect(names).toContain('canvas_validate_workflow_graph')
    expect(names).toContain('canvas_describe_tool')
  })

  it('lets the agent inspect the exact input contract for a canvas tool', async () => {
    const snapshot = screenplaySnapshot()
    const workspace = {} as CanvasWorkspaceActions

    const result = await executeCanvasTool(
      { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
      'canvas_describe_tool',
      { toolName: 'canvas_create_reusable_workflow_graph' },
    )

    expect(result).toMatchObject({
      name: 'canvas_create_reusable_workflow_graph',
      inputSchema: {
        properties: {
          nodes: {
            items: { oneOf: expect.any(Array) },
          },
        },
      },
    })
  })

  it('returns a useful error when describing an unknown canvas tool', async () => {
    const snapshot = screenplaySnapshot()
    const workspace = {} as CanvasWorkspaceActions

    await expect(
      executeCanvasTool(
        { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
        'canvas_describe_tool',
        { toolName: 'canvas_missing_tool' },
      ),
    ).rejects.toThrow('未知画布工具: canvas_missing_tool')
  })

  it('keeps board ids out of public node and asset schemas', () => {
    const schemas = Object.fromEntries(getCanvasToolSchemas().map((tool) => [tool.name, tool]))

    expect(schemas.canvas_list_nodes?.inputSchema).not.toHaveProperty('properties.boardId')
    expect(schemas.canvas_find_nodes?.inputSchema).not.toHaveProperty('properties.boardId')
    expect(schemas.canvas_insert_asset?.inputSchema).not.toHaveProperty('properties.boardId')
  })

  it('exposes operation inspection and persistent configuration tools', () => {
    const schemas = Object.fromEntries(getCanvasToolSchemas().map((tool) => [tool.name, tool]))

    expect(schemas.canvas_update_node).toBeDefined()
    expect(schemas.canvas_update_node?.description).toContain('强制刷新')
    expect(schemas.canvas_get_operation_config).toBeDefined()
    expect(schemas.canvas_update_operation_config).toBeDefined()
    expect(schemas.canvas_run_operation?.inputSchema).toHaveProperty('required', ['nodeId'])
  })

  it('updates visible node content through one atomic workspace action', async () => {
    const snapshot = screenplaySnapshot()
    const calls: string[] = []
    let receivedPatch: { title?: string; data?: Record<string, unknown> } | undefined
    const updateNode = async (
      _nodeId: string,
      patch: { title?: string; data?: Record<string, unknown> },
    ) => {
      calls.push('update')
      receivedPatch = patch
    }
    const workspace = {
      updateNode,
    } as unknown as CanvasWorkspaceActions

    await executeCanvasTool(
      { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
      'canvas_update_node',
      { nodeId: 'screenplay-1', title: '第二集', content: '# 场2 外景 码头 夜' },
    )

    expect(calls).toEqual(['update'])
    expect(receivedPatch).toEqual({
      title: '第二集',
      data: { text: '# 场2 外景 码头 夜' },
    })
  })

  it('keeps prompt-card visible text in sync for legacy data-only updates', async () => {
    const snapshot = screenplaySnapshot()
    snapshot.nodes[0] = { ...snapshot.nodes[0]!, type: 'prompt', data: { text: '旧提示词' } }
    let received: { data?: Record<string, unknown> } | undefined
    const workspace = {
      updateNode: async (_nodeId: string, patch: { data?: Record<string, unknown> }) => {
        received = patch
      },
    } as unknown as CanvasWorkspaceActions

    await executeCanvasTool(
      { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
      'canvas_update_node_data',
      { nodeId: 'screenplay-1', data: { prompt: '新提示词' } },
    )

    expect(received).toEqual({ data: { prompt: '新提示词', text: '新提示词' } })
  })

  it('keeps prompt-card execution content in sync when legacy callers update text', async () => {
    const snapshot = screenplaySnapshot()
    snapshot.nodes[0] = {
      ...snapshot.nodes[0]!,
      type: 'prompt',
      data: { text: '旧提示词', prompt: '旧提示词' },
    }
    let received: { data?: Record<string, unknown> } | undefined
    const workspace = {
      updateNode: async (_nodeId: string, patch: { data?: Record<string, unknown> }) => {
        received = patch
      },
    } as unknown as CanvasWorkspaceActions

    await executeCanvasTool(
      { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
      'canvas_update_node_data',
      { nodeId: 'screenplay-1', data: { text: '新提示词' } },
    )

    expect(received).toEqual({ data: { text: '新提示词', prompt: '新提示词' } })
  })

  it('rejects conflicting prompt-card text before writing', async () => {
    const snapshot = screenplaySnapshot()
    snapshot.nodes[0] = {
      ...snapshot.nodes[0]!,
      type: 'prompt',
      data: { text: '旧提示词', prompt: '旧提示词' },
    }
    let updated = false
    const workspace = {
      updateNode: async () => {
        updated = true
      },
    } as unknown as CanvasWorkspaceActions

    await expect(
      executeCanvasTool(
        { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
        'canvas_update_node_data',
        { nodeId: 'screenplay-1', data: { text: '可见内容', prompt: '执行内容' } },
      ),
    ).rejects.toThrow('必须一致')
    expect(updated).toBe(false)
  })

  it('validates unsupported content before writing any part of the node update', async () => {
    const snapshot = screenplaySnapshot()
    snapshot.nodes[0] = { ...snapshot.nodes[0]!, type: 'image', data: { url: 'image.png' } }
    const updateNode = async () => {
      throw new Error('updateNode should not be called')
    }
    const workspace = {
      updateNode,
    } as unknown as CanvasWorkspaceActions

    await expect(
      executeCanvasTool(
        { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
        'canvas_update_node',
        { nodeId: 'screenplay-1', title: '新标题', content: '不适用的正文' },
      ),
    ).rejects.toThrow('不支持 content')
  })

  it('rejects invalid tool arguments with field paths before calling the workspace', async () => {
    const snapshot = screenplaySnapshot()
    const connectNodes = vi.fn()
    const workspace = { connectNodes } as unknown as CanvasWorkspaceActions

    await expect(
      executeCanvasTool(
        { projectId: snapshot.project.id, getSnapshot: () => snapshot, workspace },
        'canvas_connect_nodes',
        { sourceNodeId: 'screenplay-1' },
      ),
    ).rejects.toThrow('targetNodeId')
    expect(connectNodes).not.toHaveBeenCalled()
  })

  it('exposes dynamic node actions and recommended production planning tools', () => {
    const schemas = Object.fromEntries(getCanvasToolSchemas().map((tool) => [tool.name, tool]))

    expect(schemas.canvas_get_available_actions).toBeDefined()
    expect(schemas.canvas_get_available_actions?.inputSchema).toHaveProperty('required', ['nodeId'])
    expect(schemas.canvas_get_production_plan).toBeDefined()
    expect(schemas.canvas_get_production_plan?.inputSchema).not.toHaveProperty('required')
  })

  it('exposes specialized tools for semantic canvas nodes', () => {
    const schemas = Object.fromEntries(getCanvasToolSchemas().map((tool) => [tool.name, tool]))

    expect(schemas.canvas_create_screenplay_node).toBeDefined()
    expect(schemas.canvas_create_storyboard_node).toBeDefined()
    expect(schemas.canvas_create_storyboard_node?.inputSchema).toHaveProperty(
      'properties.shots.items.properties.actionBeats',
    )
    expect(schemas.canvas_create_storyboard_node?.inputSchema).toHaveProperty(
      'properties.shots.items.properties.firstFrame',
    )
    expect(schemas.canvas_create_shot_segment?.inputSchema).toHaveProperty('properties.composition')
    expect(schemas.canvas_create_shot_segment?.inputSchema).toHaveProperty('properties.continuity')
    expect(schemas.canvas_create_pipeline_operation_node).toBeDefined()
    expect(schemas.canvas_insert_keyframe_node).toBeDefined()
    expect(schemas.canvas_insert_clip_node).toBeDefined()
    expect(schemas.canvas_insert_panorama_node).toBeDefined()
    expect(schemas.canvas_create_text_node?.description).toContain('普通')
    expect(schemas.canvas_insert_generated_text?.description).toContain('不得用于剧本')
  })

  it('returns specialized recipes for pipeline and recommended flow actions', async () => {
    const snapshot = screenplaySnapshot()
    const result = (await executeCanvasTool(
      {
        projectId: snapshot.project.id,
        getSnapshot: () => snapshot,
        workspace: {} as never,
      },
      'canvas_get_available_actions',
      { nodeId: 'screenplay-1' },
    )) as { actions: Array<{ id: string; toolRecipe?: unknown }> }

    expect(
      result.actions.find((action) => action.id === 'screenplay.to_shot_script'),
    ).toMatchObject({
      toolRecipe: {
        toolName: 'canvas_create_pipeline_operation_node',
        arguments: { actionId: 'screenplay.to_shot_script', sourceNodeId: 'screenplay-1' },
      },
    })
    expect(result.actions.find((action) => action.id === 'screenplay.extract_props')).toMatchObject(
      {
        toolRecipe: {
          toolName: 'canvas_create_pipeline_operation_node',
          arguments: { actionId: 'screenplay.extract_props', sourceNodeId: 'screenplay-1' },
        },
      },
    )
  })
})
