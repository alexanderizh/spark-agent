import type { CanvasEdge, CanvasNode } from './canvas.types'

export const COLLAPSED_GROUP_SIZE = { width: 246, height: 218 } as const

export type CanvasGroupPreview =
  | { kind: 'image'; nodeId: string; url: string; title: string }
  | { kind: 'fallback'; slot: 0 | 1 }

export type CanvasCollapsedGroupPresentation = {
  childCount: number
  previews: [CanvasGroupPreview, CanvasGroupPreview]
  size: typeof COLLAPSED_GROUP_SIZE
}

export type CanvasGroupCollapseProjection = {
  visibleNodes: CanvasNode[]
  visibleEdges: CanvasEdge[]
  presentationByGroupId: Map<string, CanvasCollapsedGroupPresentation>
}

function collectDescendants(
  groupId: string,
  childrenByParentId: ReadonlyMap<string, readonly CanvasNode[]>,
): CanvasNode[] {
  const descendants: CanvasNode[] = []
  const pending = [...(childrenByParentId.get(groupId) ?? [])]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const child = pending.shift()
    if (!child || visited.has(child.id)) continue
    visited.add(child.id)
    descendants.push(child)
    pending.push(...(childrenByParentId.get(child.id) ?? []))
  }

  return descendants
}

function buildPreviews(
  descendants: readonly CanvasNode[],
): [CanvasGroupPreview, CanvasGroupPreview] {
  const images = descendants
    .flatMap((node) => {
      if (node.type !== 'image') return []
      const url = node.data.thumbnailUrl ?? node.data.url
      if (!url) return []
      return [
        {
          kind: 'image' as const,
          nodeId: node.id,
          url,
          title: node.title?.trim() || '图片',
          createdAt: node.createdAt,
        },
      ]
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 2)
    .map(({ createdAt: _createdAt, ...preview }) => preview)

  return [images[0] ?? { kind: 'fallback', slot: 0 }, images[1] ?? { kind: 'fallback', slot: 1 }]
}

export function buildCanvasGroupCollapseProjection(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): CanvasGroupCollapseProjection {
  const childrenByParentId = new Map<string, CanvasNode[]>()
  for (const node of nodes) {
    if (!node.parentNodeId) continue
    const siblings = childrenByParentId.get(node.parentNodeId) ?? []
    siblings.push(node)
    childrenByParentId.set(node.parentNodeId, siblings)
  }

  const hiddenNodeIds = new Set<string>()
  const presentationByGroupId = new Map<string, CanvasCollapsedGroupPresentation>()

  for (const node of nodes) {
    if (node.type !== 'group' || node.data.collapsed !== true) continue
    const descendants = collectDescendants(node.id, childrenByParentId)
    descendants.forEach((descendant) => hiddenNodeIds.add(descendant.id))
    presentationByGroupId.set(node.id, {
      childCount: descendants.length,
      previews: buildPreviews(descendants),
      size: COLLAPSED_GROUP_SIZE,
    })
  }

  return {
    visibleNodes: nodes.filter((node) => !hiddenNodeIds.has(node.id)),
    visibleEdges: edges.filter(
      (edge) => !hiddenNodeIds.has(edge.sourceNodeId) && !hiddenNodeIds.has(edge.targetNodeId),
    ),
    presentationByGroupId,
  }
}
