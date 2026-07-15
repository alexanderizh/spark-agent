import type { CanvasEdge, CanvasNode } from './canvas.types'
import { fitTextNodeSize } from './canvas.api'
import { isOperationNode } from './canvas.capabilities'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import { isShotScriptText, parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { formatStoryboardRowsAsMarkdown } from './canvasTextInputPresentation'

export function resolveStoryboardSplitSourceNode(
  node: CanvasNode,
  primaryOutput?: CanvasOperationOutputView | null,
): CanvasNode | null {
  if (node.type === 'text' && isShotScriptText(node.data.text ?? '')) return node
  if (
    !isOperationNode(node) ||
    primaryOutput?.type !== 'text' ||
    !isShotScriptText(primaryOutput.text ?? '')
  ) {
    return null
  }

  return {
    ...node,
    type: 'text',
    data: {
      ...node.data,
      text: primaryOutput.text ?? '',
      format: 'markdown',
    },
  }
}

export function buildStoryboardShotNodeText(row: ParsedShotRow, index: number): string {
  const shotNumber = row.index ?? index + 1
  const title = row.title?.trim() || `镜 ${shotNumber}`
  return [
    `# 镜 ${String(shotNumber).padStart(2, '0')} · ${title}`,
    '',
    formatStoryboardRowsAsMarkdown([row]),
  ].join('\n')
}

function absoluteNodePosition(
  source: CanvasNode,
  allNodes: CanvasNode[],
): { x: number; y: number } {
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  let x = source.x
  let y = source.y
  let parentId = source.parentNodeId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.x
    y += parent.y
    parentId = parent.parentNodeId
  }
  return { x, y }
}

export function buildStoryboardShotNodeDrafts(
  source: CanvasNode,
  allNodes: CanvasNode[] = [],
): Array<{
  text: string
  x: number
  y: number
  width: number
  height: number
}> {
  const text = source.data.text?.trim() ?? ''
  if (!isShotScriptText(text)) return []
  const rows = parseShotTable(text)
  const columnCount = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(rows.length))))
  const gapX = 36
  const gapY = 32
  const sourcePosition = absoluteNodePosition(source, allNodes)
  const startX = sourcePosition.x + source.width + 72
  return rows.map((row, index) => {
    const shotText = buildStoryboardShotNodeText(row, index)
    const size = fitTextNodeSize(shotText)
    const column = index % columnCount
    const rowIndex = Math.floor(index / columnCount)
    return {
      text: shotText,
      x: Math.round(startX + column * (size.width + gapX)),
      y: Math.round(sourcePosition.y + rowIndex * (size.height + gapY)),
      width: size.width,
      height: size.height,
    }
  })
}

export async function splitStoryboardNode(input: {
  source: CanvasNode
  allNodes?: CanvasNode[]
  createTextNode: (draft: {
    text: string
    x: number
    y: number
    format?: 'plain' | 'markdown'
  }) => Promise<CanvasNode | undefined>
  patchNodes: (nodeIds: string[], patch: { width?: number; height?: number }) => Promise<unknown>
  connectNodes: (edge: {
    sourceNodeId: string
    targetNodeId: string
    type?: CanvasEdge['type']
  }) => Promise<unknown>
}): Promise<CanvasNode[]> {
  const drafts = buildStoryboardShotNodeDrafts(input.source, input.allNodes)
  const created: CanvasNode[] = []
  for (const draft of drafts) {
    const node = await input.createTextNode({
      text: draft.text,
      x: draft.x,
      y: draft.y,
      format: 'markdown',
    })
    if (!node) continue
    await input.patchNodes([node.id], { width: draft.width, height: draft.height })
    await input.connectNodes({
      sourceNodeId: input.source.id,
      targetNodeId: node.id,
      type: 'references',
    })
    created.push(node)
  }
  return created
}
