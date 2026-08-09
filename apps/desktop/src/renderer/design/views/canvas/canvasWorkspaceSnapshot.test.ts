import { describe, expect, it } from 'vitest'
import { collectSelectableGroupChildNodeIds } from './canvasWorkspaceSnapshot'
import type { CanvasNode } from './canvas.types'

function node(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text',
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('collectSelectableGroupChildNodeIds', () => {
  it('只返回组的直接可选子节点，不穿透嵌套组', () => {
    const nodes = [
      node('group', { type: 'group' }),
      node('child-a', { parentNodeId: 'group' }),
      node('child-b', { parentNodeId: 'group' }),
      node('nested-group', { type: 'group', parentNodeId: 'group' }),
      node('nested-child', { parentNodeId: 'nested-group' }),
      node('outside'),
    ]

    expect(collectSelectableGroupChildNodeIds(nodes, 'group')).toEqual([
      'child-a',
      'child-b',
      'nested-group',
    ])
  })

  it('跳过隐藏和锁定子节点', () => {
    const nodes = [
      node('group', { type: 'group' }),
      node('visible', { parentNodeId: 'group' }),
      node('locked', { parentNodeId: 'group', locked: true }),
      node('hidden', { parentNodeId: 'group', hidden: true }),
    ]

    expect(collectSelectableGroupChildNodeIds(nodes, 'group')).toEqual(['visible'])
  })
})
