import type { UIMessage } from '../services/event-mapper'

export type ChatPanelTurn = {
  key: string
  turnId?: string
  messages: UIMessage[]
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
  const text = message.blocks
    .filter(
      (block): block is Extract<(typeof message.blocks)[number], { kind: 'text' }> =>
        block.kind === 'text',
    )
    .map((block) => block.content)
    .join('\n\n')
  return sanitizeCanvasUserMessage(text)
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
