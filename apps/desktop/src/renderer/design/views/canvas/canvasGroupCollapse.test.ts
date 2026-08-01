import { describe, expect, it } from 'vitest'
import { buildCanvasGroupCollapseProjection, COLLAPSED_GROUP_SIZE } from './canvasGroupCollapse'
import type { CanvasEdge, CanvasNode } from './canvas.types'

function node(
  id: string,
  type: CanvasNode['type'],
  overrides: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type,
    x: 0,
    y: 0,
    width: 560,
    height: 360,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  }
}

function edge(id: string, sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    sourceNodeId,
    targetNodeId,
    type: 'used_as_input',
    metadata: {},
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

describe('canvas group collapse projection', () => {
  it('uses a collapsed size close to regular canvas nodes', () => {
    expect(COLLAPSED_GROUP_SIZE).toEqual({ width: 420, height: 360 })
  })

  it('hides every descendant and its connected edges while keeping the collapsed group', () => {
    const group = node('group', 'group', { data: { collapsed: true } })
    const child = node('child', 'text', { parentNodeId: group.id })
    const nestedGroup = node('nested-group', 'group', { parentNodeId: group.id })
    const nestedChild = node('nested-child', 'text', { parentNodeId: nestedGroup.id })
    const outside = node('outside', 'text')

    const projection = buildCanvasGroupCollapseProjection(
      [group, child, nestedGroup, nestedChild, outside],
      [edge('inside', child.id, nestedChild.id), edge('outside-link', nestedChild.id, outside.id)],
    )

    expect(projection.visibleNodes.map((item) => item.id)).toEqual(['group', 'outside'])
    expect(projection.visibleEdges).toEqual([])
    expect(projection.presentationByGroupId.get(group.id)).toMatchObject({
      childCount: 3,
      size: COLLAPSED_GROUP_SIZE,
    })
  })

  it('uses the two newest descendant images and prefers thumbnails', () => {
    const group = node('group', 'group', { data: { collapsed: true } })
    const oldest = node('oldest', 'image', {
      parentNodeId: group.id,
      title: '最早',
      data: { url: 'safe-file://oldest.png' },
      createdAt: '2026-07-10T00:00:00.000Z',
    })
    const oldImage = node('old-image', 'image', {
      parentNodeId: group.id,
      title: '较早',
      data: { url: 'safe-file://old.png' },
      createdAt: '2026-07-11T00:00:00.000Z',
    })
    const newImage = node('new-image', 'image', {
      parentNodeId: group.id,
      title: '最新',
      data: { url: 'safe-file://new.png', thumbnailUrl: 'safe-file://new-thumb.png' },
      createdAt: '2026-07-12T00:00:00.000Z',
    })

    const projection = buildCanvasGroupCollapseProjection([group, oldest, oldImage, newImage], [])

    expect(projection.presentationByGroupId.get(group.id)?.previews).toEqual([
      {
        kind: 'image',
        nodeId: 'new-image',
        title: '最新',
        url: 'safe-file://new-thumb.png',
      },
      {
        kind: 'image',
        nodeId: 'old-image',
        title: '较早',
        url: 'safe-file://old.png',
      },
    ])
  })

  it('fills missing preview slots with default cards', () => {
    const group = node('group', 'group', { data: { collapsed: true } })
    const image = node('image', 'image', {
      parentNodeId: group.id,
      data: { url: 'safe-file://image.png' },
    })

    const oneImage = buildCanvasGroupCollapseProjection([group, image], [])
    expect(oneImage.presentationByGroupId.get(group.id)?.previews).toEqual([
      expect.objectContaining({ kind: 'image', nodeId: 'image' }),
      { kind: 'fallback', slot: 1 },
    ])

    const noImage = buildCanvasGroupCollapseProjection([group], [])
    expect(noImage.presentationByGroupId.get(group.id)?.previews).toEqual([
      { kind: 'fallback', slot: 0 },
      { kind: 'fallback', slot: 1 },
    ])
  })

  it('normalizes persisted folder colors to the supported palette', () => {
    const defaultGroup = node('default-group', 'group', { data: { collapsed: true } })
    const purpleGroup = node('purple-group', 'group', { data: { collapsed: true } })
    const invalidGroup = node('invalid-group', 'group', { data: { collapsed: true } })
    ;(purpleGroup.data as Record<string, unknown>).groupColor = 'purple'
    ;(invalidGroup.data as Record<string, unknown>).groupColor = 'chartreuse'

    const projection = buildCanvasGroupCollapseProjection(
      [defaultGroup, purpleGroup, invalidGroup],
      [],
    )

    expect(projection.presentationByGroupId.get(defaultGroup.id)?.color).toBe('blue')
    expect(projection.presentationByGroupId.get(purpleGroup.id)?.color).toBe('purple')
    expect(projection.presentationByGroupId.get(invalidGroup.id)?.color).toBe('blue')
  })

  it('keeps legacy groups expanded and preserves nested collapsed state when the parent expands', () => {
    const parent = node('parent', 'group')
    const nested = node('nested', 'group', {
      parentNodeId: parent.id,
      data: { collapsed: true },
    })
    const child = node('child', 'text', { parentNodeId: nested.id })

    const projection = buildCanvasGroupCollapseProjection([parent, nested, child], [])

    expect(projection.visibleNodes.map((item) => item.id)).toEqual(['parent', 'nested'])
    expect(projection.presentationByGroupId.has(parent.id)).toBe(false)
    expect(projection.presentationByGroupId.get(nested.id)?.childCount).toBe(1)
  })

  it('restores the original group and child state after a collapsed parent expands', () => {
    const parent = node('parent', 'group', {
      x: 80,
      y: 120,
      width: 720,
      height: 480,
      data: { collapsed: true, groupColor: 'green' },
    })
    const child = node('child', 'image', {
      parentNodeId: parent.id,
      x: 36,
      y: 54,
      width: 320,
      height: 220,
      locked: true,
      hidden: true,
      data: { productionState: 'confirmed', url: 'safe-file://child.png' },
    })
    const nested = node('nested', 'group', {
      parentNodeId: parent.id,
      x: 388,
      y: 62,
      width: 260,
      height: 280,
      data: { collapsed: true, groupColor: 'purple' },
    })
    const originalChild = structuredClone(child)
    const originalNested = structuredClone(nested)

    const collapsed = buildCanvasGroupCollapseProjection([parent, child, nested], [])
    const expandedParent = { ...parent, data: { ...parent.data, collapsed: false } }
    const expanded = buildCanvasGroupCollapseProjection([expandedParent, child, nested], [])

    expect(collapsed.visibleNodes.map((item) => item.id)).toEqual(['parent'])
    expect(expanded.visibleNodes.map((item) => item.id)).toEqual(['parent', 'child', 'nested'])
    expect(expanded.visibleNodes.find((item) => item.id === child.id)).toEqual(originalChild)
    expect(expanded.visibleNodes.find((item) => item.id === nested.id)).toEqual(originalNested)
    expect(expanded.presentationByGroupId.get(nested.id)?.color).toBe('purple')
  })
})
