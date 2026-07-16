import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { buildSelectedNodesContext } from './canvasAgentContextBuilder'

function node(data: CanvasNode['data']): CanvasNode {
  return {
    id: 'screenplay-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text',
    title: '第一集剧本',
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data,
    createdAt: '',
    updatedAt: '',
  }
}

describe('buildSelectedNodesContext', () => {
  it('包含流水线角色、生产状态和动态动作查询指引', () => {
    const context = buildSelectedNodesContext([
      node({
        text: '场1 夜 内景',
        pipelineRole: 'screenplay',
        productionState: 'confirmed',
      }),
    ])

    expect(context).toContain('流水线角色 screenplay')
    expect(context).toContain('生产状态 confirmed')
    expect(context).toContain('canvas_get_available_actions')
    expect(context).toContain('不要绕过节点能力自行臆测下一步')
  })
})
