import type { CanvasEdge, CanvasGroupColorPreset, CanvasNode } from './canvas.types'
import { resolveCanvasNodeMediaKind, type CanvasNodeMediaKind } from './canvasNodeMediaKind'

export const COLLAPSED_GROUP_SIZE = { width: 420, height: 360 } as const

export const CANVAS_GROUP_COLOR_PRESETS = [
  'blue',
  'indigo',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'gray',
] as const satisfies readonly CanvasGroupColorPreset[]

const canvasGroupColorSet = new Set<string>(CANVAS_GROUP_COLOR_PRESETS)

export function normalizeCanvasGroupColor(value: unknown): CanvasGroupColorPreset {
  return typeof value === 'string' && canvasGroupColorSet.has(value)
    ? (value as CanvasGroupColorPreset)
    : 'blue'
}

export type CanvasGroupPreview =
  | { kind: 'image'; nodeId: string; url: string; title: string }
  | { kind: 'fallback'; slot: 0 | 1 }

export type CanvasCollapsedGroupPresentation = {
  childCount: number
  previews: [CanvasGroupPreview, CanvasGroupPreview]
  size: typeof COLLAPSED_GROUP_SIZE
  color: CanvasGroupColorPreset
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
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>,
): [CanvasGroupPreview, CanvasGroupPreview] {
  // 同一张产物图可能同时挂在任务节点 data.url 与它的 output 节点上（output 已物化进编组时），
  // 用 url 去重避免同一张图在两个预览槽位重复出现。
  const seenUrls = new Set<string>()
  const images = descendants
    .flatMap((node) => {
      // 纯图片节点直接纳入；任务节点（文生图等）按其产物媒体类型解析为 image 才纳入，
      // 这样折叠预览也能展示文生图节点的产物图——展开态同样读 node.data.thumbnailUrl ?? node.data.url，取值口径一致。
      // 视频产物任务节点的 url 是视频，mediaKind !== 'image' 不会误入导致 <img> 加载失败。
      const mediaKind = resolveCanvasNodeMediaKind(node, outputMediaKindByNodeId)
      if (mediaKind !== 'image') return []
      const url = node.data.thumbnailUrl ?? node.data.url
      if (!url || seenUrls.has(url)) return []
      seenUrls.add(url)
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
  options?: { outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind> },
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
      previews: buildPreviews(descendants, options?.outputMediaKindByNodeId),
      size: COLLAPSED_GROUP_SIZE,
      color: normalizeCanvasGroupColor(node.data.groupColor),
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
