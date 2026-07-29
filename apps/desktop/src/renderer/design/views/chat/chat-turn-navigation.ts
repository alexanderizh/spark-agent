import type { UIBlock, UIMessage } from '../../services/event-mapper'

const PREVIEW_GRAPHEME_LIMIT = 220

export interface ChatTurnNavItem {
  key: string
  turnId?: string
  ordinal: number
  startMessageIndex: number
  messageIndexes: number[]
  userPreview: string
  assistantPreview: string
  status: UIMessage['status']
}

interface MutableChatTurnNavItem {
  key: string
  turnId?: string
  startMessageIndex: number
  userStartMessageIndex?: number
  messageIndexes: number[]
  userMessages: UIMessage[]
  assistantMessages: UIMessage[]
}

type GraphemeSegmenter = {
  segment: (input: string) => Iterable<{ segment: string }>
}

type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter

const Segmenter = (
  Intl as unknown as {
    Segmenter?: GraphemeSegmenterConstructor
  }
).Segmenter
const graphemeSegmenter =
  Segmenter == null ? null : new Segmenter(undefined, { granularity: 'grapheme' })

function graphemes(value: string): Iterable<string> {
  if (graphemeSegmenter == null) return value
  return {
    *[Symbol.iterator]() {
      for (const entry of graphemeSegmenter.segment(value)) yield entry.segment
    },
  }
}

function normalizePreviewText(value: string): string {
  let result = ''
  let graphemeCount = 0
  let pendingSpace = false

  for (const grapheme of graphemes(value)) {
    if (/^\s+$/u.test(grapheme)) {
      pendingSpace = result !== ''
      continue
    }
    if (pendingSpace) {
      if (graphemeCount >= PREVIEW_GRAPHEME_LIMIT) return `${result.trimEnd()}…`
      result += ' '
      graphemeCount += 1
      pendingSpace = false
    }
    if (graphemeCount >= PREVIEW_GRAPHEME_LIMIT) return `${result.trimEnd()}…`
    result += grapheme
    graphemeCount += 1
  }
  return result
}

function extractTextPreview(blocks: UIBlock[]): string {
  return normalizePreviewText(
    blocks
      .filter((block): block is Extract<UIBlock, { kind: 'text' }> => block.kind === 'text')
      .map((block) => block.content)
      .filter(Boolean)
      .join('\n'),
  )
}

function buildUserPreview(messages: UIMessage[]): string {
  const text = normalizePreviewText(
    messages.map((message) => extractTextPreview(message.blocks)).join('\n'),
  )
  if (text !== '') return text
  const attachmentCount = messages.reduce(
    (count, message) => count + (message.attachments?.length ?? 0),
    0,
  )
  if (attachmentCount > 0) return `发送了 ${attachmentCount} 个附件`
  return '该轮没有可预览的用户正文'
}

function buildAssistantPreview(messages: UIMessage[]): string {
  const text = normalizePreviewText(
    messages.map((message) => extractTextPreview(message.blocks)).join('\n'),
  )
  if (text !== '') return text
  if (messages.some((message) => message.status === 'streaming')) return '正在处理…'
  if (messages.some((message) => message.status === 'error')) return '本轮执行失败'
  if (messages.some((message) => message.status === 'cancelled')) return '本轮已取消'
  if (messages.some((message) => message.blocks.length > 0)) return '本轮主要包含工具执行'
  return '等待 Agent 回复'
}

function resolveTurnStatus(messages: UIMessage[]): UIMessage['status'] {
  if (messages.some((message) => message.status === 'streaming')) return 'streaming'
  if (messages.some((message) => message.status === 'error')) return 'error'
  if (messages.some((message) => message.status === 'cancelled')) return 'cancelled'
  return 'completed'
}

export function buildChatTurnNavItems(messages: UIMessage[]): ChatTurnNavItem[] {
  const groups = new Map<string, MutableChatTurnNavItem>()

  messages.forEach((message, messageIndex) => {
    const key = message.turnId ?? `message:${message.id}`
    const existing = groups.get(key)
    const group =
      existing ??
      ({
        key,
        ...(message.turnId != null ? { turnId: message.turnId } : {}),
        startMessageIndex: messageIndex,
        messageIndexes: [],
        userMessages: [],
        assistantMessages: [],
      } satisfies MutableChatTurnNavItem)

    group.startMessageIndex = Math.min(group.startMessageIndex, messageIndex)
    if (message.role === 'user') {
      group.userStartMessageIndex = Math.min(
        group.userStartMessageIndex ?? messageIndex,
        messageIndex,
      )
    }
    group.messageIndexes.push(messageIndex)
    if (message.role === 'user') group.userMessages.push(message)
    else group.assistantMessages.push(message)
    if (existing == null) groups.set(key, group)
  })

  return Array.from(groups.values()).map((group, index) => {
    const allMessages = [...group.userMessages, ...group.assistantMessages]
    return {
      key: group.key,
      ...(group.turnId != null ? { turnId: group.turnId } : {}),
      ordinal: index + 1,
      startMessageIndex: group.userStartMessageIndex ?? group.startMessageIndex,
      messageIndexes: group.messageIndexes,
      userPreview: buildUserPreview(group.userMessages),
      assistantPreview: buildAssistantPreview(group.assistantMessages),
      status: resolveTurnStatus(allMessages),
    }
  })
}
