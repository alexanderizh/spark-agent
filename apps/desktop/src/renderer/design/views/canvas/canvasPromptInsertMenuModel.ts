import type { CanvasAsset } from './canvas.types'
import type { CanvasPromptMentionItem } from './canvasPromptMentions'
import {
  canvasPromptNodeTypeLabel,
  previewCanvasPromptNodeContent,
} from './CanvasPromptLexicalNode'

export type CanvasPromptInsertFilter = 'all' | 'character' | 'scene'

export function filterCanvasPromptInsertItems(
  items: CanvasPromptMentionItem[],
  query: string,
  filter: CanvasPromptInsertFilter,
  assetById: Map<string, CanvasAsset>,
): CanvasPromptMentionItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (filter !== 'all' && item.node.data.pipelineRole !== filter) return false
    if (!normalizedQuery) return true
    const searchable = [
      item.id,
      item.label,
      canvasPromptNodeTypeLabel(item.node),
      previewCanvasPromptNodeContent(item.node, assetById),
    ]
      .join('\n')
      .toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  })
}
