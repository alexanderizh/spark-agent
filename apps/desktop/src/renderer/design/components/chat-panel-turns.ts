import type { UIMessage } from '../services/event-mapper'

export type ChatPanelTurn = {
  key: string
  turnId?: string
  messages: UIMessage[]
}

export type ChatPanelMessageNodeReference = {
  id: string
  type: string
  title?: string
}

export function groupChatPanelMessagesByTurn(messages: UIMessage[]): ChatPanelTurn[] {
  const turns: ChatPanelTurn[] = []
  for (const message of messages) {
    const previous = turns.at(-1)
    if (message.turnId != null && previous?.turnId === message.turnId) {
      previous.messages.push(message)
      continue
    }
    turns.push({
      key: message.turnId ?? message.id,
      ...(message.turnId != null ? { turnId: message.turnId } : {}),
      messages: [message],
    })
  }
  return turns
}

export function getChatPanelUserText(message: UIMessage | undefined): string {
  if (message?.role !== 'user') return ''
  return sanitizeCanvasUserMessage(getChatPanelUserContent(message))
}

/**
 * 画布节点引用随用户消息正文持久化在 `[当前选中节点]` 上下文中，而不是普通文件附件里。
 * 从原始正文恢复只读展示数据，使实时消息和重载后的历史消息都能显示发送时的引用。
 */
export function getChatPanelUserNodeReferences(
  message: UIMessage | undefined,
): ChatPanelMessageNodeReference[] {
  if (message?.role !== 'user') return []
  const content = getChatPanelUserContent(message)
  if (!content.startsWith('[画布绑定]\n') && !content.startsWith('[当前选中节点]\n')) {
    return []
  }
  const marker = '[当前选中节点]\n'
  const markerIndex = content.indexOf(marker)
  if (markerIndex < 0) return []

  const contextStart = markerIndex + marker.length
  const capabilityIndex = content.indexOf('\n\n[节点能力使用要求]', contextStart)
  const separatorIndex = content.indexOf('\n---\n', contextStart)
  const contextEnd = [capabilityIndex, separatorIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), content.length)
  const references: ChatPanelMessageNodeReference[] = []
  const seenIds = new Set<string>()

  for (const line of content.slice(contextStart, contextEnd).split('\n')) {
    const match = /^- 节点 ([^|]+?) \| 类型 ([^|]+?)(?: \|.*)?$/.exec(line.trim())
    if (match == null) continue
    const id = match[1]?.trim() ?? ''
    const type = match[2]?.trim() ?? ''
    if (!id || !type || seenIds.has(id)) continue
    const title = /(?:^| \| )标题「([^」]+)」/.exec(line)?.[1]?.trim()
    references.push({ id, type, ...(title ? { title } : {}) })
    seenIds.add(id)
  }

  return references
}

function getChatPanelUserContent(message: UIMessage): string {
  return message.blocks
    .filter(
      (block): block is Extract<(typeof message.blocks)[number], { kind: 'text' }> =>
        block.kind === 'text',
    )
    .map((block) => block.content)
    .join('\n\n')
}

export function sanitizeCanvasUserMessage(content: string): string {
  const marker = '\n---\n\n'
  if (content.startsWith('[画布绑定]\n') || content.startsWith('[当前选中节点]\n')) {
    // 兼容首轮同时包含画布绑定和节点上下文；不要误截用户正文里的 Markdown 分隔线。
    const index = content.indexOf(marker)
    if (index >= 0) return content.slice(index + marker.length).trim()
  }
  return content
}
