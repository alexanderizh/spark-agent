import type { UIBlock } from '../../services/event-mapper'

export type ChatMessageTimelineGroup =
  | { kind: 'content'; key: string; blocks: UIBlock[] }
  | { kind: 'error'; key: string; block: Extract<UIBlock, { kind: 'error' }> }
  | {
      kind: 'runtime_signal'
      key: string
      block: Extract<UIBlock, { kind: 'runtime_signal' }>
    }

/**
 * Preserve the event order while keeping adjacent regular blocks grouped for
 * the existing text/tool renderer. Diagnostics stay where they first occurred.
 */
export function groupChatMessageTimeline(blocks: UIBlock[]): ChatMessageTimelineGroup[] {
  const groups: ChatMessageTimelineGroup[] = []
  let content: UIBlock[] = []
  let contentStart = 0

  const flushContent = () => {
    if (content.length === 0) return
    groups.push({ kind: 'content', key: `content-${contentStart}`, blocks: content })
    content = []
  }

  blocks.forEach((block, index) => {
    if (block.kind === 'error') {
      flushContent()
      groups.push({ kind: 'error', key: `error-${index}`, block })
      return
    }
    if (block.kind === 'runtime_signal') {
      flushContent()
      groups.push({ kind: 'runtime_signal', key: `runtime_signal-${index}`, block })
      return
    }
    if (content.length === 0) contentStart = index
    content.push(block)
  })
  flushContent()
  return groups
}
