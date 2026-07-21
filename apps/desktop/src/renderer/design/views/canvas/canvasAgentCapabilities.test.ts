import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { getCanvasAgentAvailableActions } from './canvasAgentCapabilities'

function node(input: Partial<CanvasNode> & Pick<CanvasNode, 'type'>): CanvasNode {
  return {
    id: input.id ?? 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: input.type,
    title: input.title ?? '节点',
    assetId: input.assetId ?? null,
    taskId: input.taskId ?? null,
    parentNodeId: input.parentNodeId ?? null,
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: input.data ?? {},
    createdAt: '',
    updatedAt: '',
  }
}

describe('getCanvasAgentAvailableActions', () => {
  it('为剧本节点返回节点流水线与短剧推荐动作', () => {
    const actions = getCanvasAgentAvailableActions(
      node({ type: 'text', data: { pipelineRole: 'screenplay', productionState: 'confirmed' } }),
    )
    const ids = actions.map((action) => action.id)

    expect(ids).toContain('screenplay.to_shot_script')
    expect(ids).toContain('screenplay.extract_characters')
    expect(ids).toContain('screenplay.extract_scenes')
    expect(ids).toContain('screenplay.extract_props')
    expect(ids).toContain('screenplay.extract_effects')
    expect(ids).toContain('screenplay.split_episodes')
    expect(actions.find((action) => action.id === 'screenplay.to_shot_script')).toMatchObject({
      source: 'pipeline',
    })
    expect(actions.find((action) => action.id === 'screenplay.split_episodes')).toMatchObject({
      source: 'recommended_flow',
      execution: 'create_operation_node',
      operation: 'text_generate',
      toolRecipe: {
        toolName: 'canvas_create_operation_node',
        arguments: {
          operation: 'text_generate',
          inputNodeIds: ['node-1'],
          outputPipelineRole: 'screenplay',
        },
      },
    })
  })

  it('为场景节点推荐普通场景图和重点场景全景图', () => {
    const actions = getCanvasAgentAvailableActions(
      node({ type: 'text', data: { pipelineRole: 'scene' } }),
      { assetKinds: ['scene'] },
    )

    expect(actions.find((action) => action.id === 'scene.scene_image')).toMatchObject({
      execution: 'create_operation_node',
      outputPipelineRole: 'design_card',
    })
    expect(actions.find((action) => action.id === 'scene.panorama_360')).toMatchObject({
      source: 'recommended_flow',
      operation: 'panorama_360',
    })
  })

  it('为图片节点公开图片右键能力并标记交互方式', () => {
    const actions = getCanvasAgentAvailableActions(node({ type: 'image', data: { url: 'x.png' } }))

    expect(actions.find((action) => action.id === 'image.annotate')).toMatchObject({
      execution: 'requires_user_interaction',
    })
    expect(actions.find((action) => action.id === 'image.split_grid')).toMatchObject({
      execution: 'requires_user_interaction',
    })
    expect(actions.find((action) => action.id === 'node.duplicate')).toMatchObject({
      execution: 'tool',
      toolName: 'canvas_duplicate_nodes',
    })
  })

  it('只为全景产物提供全景预览', () => {
    const normalIds = getCanvasAgentAvailableActions(node({ type: 'image' })).map(
      (action) => action.id,
    )
    const panoramaIds = getCanvasAgentAvailableActions(
      node({ type: 'image', data: { panorama360: { projection: 'equirectangular' } } }),
    ).map((action) => action.id)

    expect(normalIds).not.toContain('image.preview_panorama')
    expect(panoramaIds).toContain('image.preview_panorama')
  })

  it('公开通用右键整理能力和分组专属能力', () => {
    const groupedChild = getCanvasAgentAvailableActions(
      node({ type: 'text', parentNodeId: 'group-1' }),
    )
    const group = getCanvasAgentAvailableActions(node({ type: 'group' }))

    expect(groupedChild.find((action) => action.id === 'node.lock')).toMatchObject({
      execution: 'tool',
      toolName: 'canvas_patch_nodes',
    })
    expect(groupedChild.find((action) => action.id === 'node.bring_to_front')).toMatchObject({
      toolName: 'canvas_bring_to_front',
    })
    expect(groupedChild.find((action) => action.id === 'node.update')).toMatchObject({
      execution: 'tool',
      toolName: 'canvas_update_node',
    })
    expect(groupedChild.find((action) => action.id === 'node.save_to_library')).toMatchObject({
      execution: 'requires_user_interaction',
    })
    expect(groupedChild.find((action) => action.id === 'group.remove_node')).toMatchObject({
      execution: 'tool',
      toolName: 'canvas_remove_from_group',
    })
    expect(group.find((action) => action.id === 'group.dissolve')).toMatchObject({
      toolName: 'canvas_dissolve_group',
      destructive: true,
    })
    expect(group.find((action) => action.id === 'group.merge_to_image')).toMatchObject({
      execution: 'requires_user_interaction',
    })
  })
})
