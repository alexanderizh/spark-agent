import type { CanvasAsset } from './canvas.types'
import type { CanvasPromptMentionItem } from './canvasPromptMentions'
import {
  canvasPromptNodeTypeLabel,
  previewCanvasPromptNodeContent,
} from './CanvasPromptLexicalNode'

export type CanvasPromptInsertFilter = 'all' | 'image' | 'video'
export type CanvasPromptInsertSort = 'updated' | 'created'

export function filterCanvasPromptInsertItems(
  items: CanvasPromptMentionItem[],
  query: string,
  filter: CanvasPromptInsertFilter,
  assetById: Map<string, CanvasAsset>,
  sort: CanvasPromptInsertSort = 'updated',
  pinnedIds: ReadonlySet<string> = new Set(),
): CanvasPromptMentionItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items
    .filter((item) => {
      if (filter !== 'all' && item.node.type !== filter) return false
      if (!normalizedQuery) return true
      const asset = item.node.assetId ? assetById.get(item.node.assetId) : undefined
      const searchable = [
        item.id,
        item.label,
        canvasPromptNodeTypeLabel(item.node),
        previewCanvasPromptNodeContent(item.node, assetById),
        ...canvasPromptFileNames(item, asset),
      ]
        .join('\n')
        .toLocaleLowerCase()
      return searchable.includes(normalizedQuery)
    })
    .sort((left, right) => {
      const pinOrder = Number(pinnedIds.has(right.id)) - Number(pinnedIds.has(left.id))
      if (pinOrder !== 0) return pinOrder
      const leftTime = sort === 'created' ? left.node.createdAt : left.node.updatedAt
      const rightTime = sort === 'created' ? right.node.createdAt : right.node.updatedAt
      return (rightTime || right.node.createdAt || '').localeCompare(
        leftTime || left.node.createdAt || '',
      )
    })
}

function canvasPromptFileNames(
  item: CanvasPromptMentionItem,
  asset: CanvasAsset | undefined,
): string[] {
  const metadata = asset?.metadata ?? {}
  const metadataNames = [
    metadata.fileName,
    metadata.filename,
    metadata.originalName,
    metadata.originalFilename,
  ].filter((value): value is string => typeof value === 'string')
  const fileNames = [
    item.node.data.url,
    item.node.data.thumbnailUrl,
    asset?.storageKey,
    asset?.url,
    asset?.thumbnailKey,
    asset?.thumbnailUrl,
  ]
    .map((value) => (value ? fileNameFromPath(value) : ''))
    .filter(Boolean)
  return [asset?.title, ...metadataNames, ...fileNames].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
}

function fileNameFromPath(value: string): string {
  if (/^(?:data|blob):/i.test(value)) return ''
  const pathWithoutQuery = value.split(/[?#]/, 1)[0] ?? value
  const fileName = pathWithoutQuery.split(/[\\/]/).pop() ?? pathWithoutQuery
  try {
    return decodeURIComponent(fileName)
  } catch {
    return fileName
  }
}
