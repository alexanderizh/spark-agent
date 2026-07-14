import type { CanvasNode } from './canvas.types'

export type CanvasPromptMentionItem = {
  id: string
  label: string
  marker: string
  token: string
  node: CanvasNode
}

export type CanvasPromptMentionQuery = {
  active: boolean
  start: number
  end: number
  query: string
}

export function buildCanvasPromptMentionItems(nodes: CanvasNode[]): CanvasPromptMentionItem[] {
  return nodes.map((node, index) => ({
    id: node.id,
    label: node.title?.trim() || defaultCanvasMentionLabel(node, index + 1),
    marker: `参考图${index + 1}`,
    token: buildCanvasPromptMentionToken(node, index + 1),
    node,
  }))
}

export function findCanvasPromptMentionQuery(
  value: string,
  cursor: number,
): CanvasPromptMentionQuery {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  const beforeCursor = value.slice(0, safeCursor)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return inactiveMentionQuery(safeCursor)
  const query = beforeCursor.slice(atIndex + 1)
  if (/[\s\n\r\t,，。；;:：()[\]{}<>]/.test(query)) return inactiveMentionQuery(safeCursor)
  return {
    active: true,
    start: atIndex,
    end: safeCursor,
    query,
  }
}

export function insertCanvasPromptMention(
  value: string,
  mention: CanvasPromptMentionQuery,
  item: CanvasPromptMentionItem,
): { value: string; cursor: number } {
  const hasFollowingWhitespace = /\s/.test(value[mention.end] ?? '')
  const token = hasFollowingWhitespace ? item.token : `${item.token} `
  const nextValue = `${value.slice(0, mention.start)}${token}${value.slice(mention.end)}`
  return {
    value: nextValue,
    cursor: mention.start + token.length,
  }
}

export function filterCanvasPromptMentionItems(
  items: CanvasPromptMentionItem[],
  query: string,
): CanvasPromptMentionItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items
  return items.filter(
    (item) =>
      item.marker.toLowerCase().includes(normalized) ||
      item.label.toLowerCase().includes(normalized) ||
      item.id.toLowerCase().includes(normalized),
  )
}

export function extractCanvasPromptMentionTokens(value: string): Array<{
  label: string
  nodeId: string
}> {
  const result: Array<{ label: string; nodeId: string }> = []
  const pattern = /@\[([^\]]+)\]\(node:([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) != null) {
    result.push({ label: match[1] ?? '', nodeId: match[2] ?? '' })
  }
  return result
}

export type CanvasPromptMentionTokenRange = {
  raw: string
  label: string
  nodeId: string
  start: number
  end: number
}

export function scanCanvasPromptMentionTokens(value: string): CanvasPromptMentionTokenRange[] {
  const result: CanvasPromptMentionTokenRange[] = []
  const pattern = /@\[([^\]]+)\]\(node:([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) != null) {
    result.push({
      raw: match[0],
      label: match[1] ?? '',
      nodeId: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return result
}

function inactiveMentionQuery(cursor: number): CanvasPromptMentionQuery {
  return {
    active: false,
    start: cursor,
    end: cursor,
    query: '',
  }
}

function defaultCanvasMentionLabel(node: CanvasNode, fallbackIndex: number): string {
  if (node.type === 'image') return `图片 ${fallbackIndex}`
  if (node.type === 'video') return `视频 ${fallbackIndex}`
  if (node.type === 'audio') return `音频 ${fallbackIndex}`
  if (node.type === 'text' || node.type === 'prompt') return `文本 ${fallbackIndex}`
  return `资产 ${fallbackIndex}`
}

function buildCanvasPromptMentionToken(node: CanvasNode, fallbackIndex: number): string {
  const title = node.title?.trim() || defaultCanvasMentionLabel(node, fallbackIndex)
  return `@[参考图${fallbackIndex}:${title}](node:${node.id})`
}
