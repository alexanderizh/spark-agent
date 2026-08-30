import type { UIBlock } from '../services/event-mapper'
import { getChatPanelThinkingBlocks, type ChatPanelThinkingBlock } from './chat-panel-thinking'
import { getChatPanelToolBlocks, type ChatPanelToolBlock } from './chat-panel-tool-activity'

type ChatPanelTextBlock = Extract<UIBlock, { kind: 'text' }>

export type ChatPanelRenderItem =
  | { kind: 'block'; key: string; block: UIBlock }
  | { kind: 'text_group'; key: string; blocks: ChatPanelTextBlock[] }
  | { kind: 'thinking_group'; key: string; blocks: ChatPanelThinkingBlock[] }
  | { kind: 'tool_activity'; key: string; blocks: ChatPanelToolBlock[] }

export function buildChatPanelRenderItems(
  blocks: UIBlock[],
  options: {
    toolCallDisplay: 'hidden' | 'summary' | 'full'
    toolNamePrefix?: string
  },
): ChatPanelRenderItem[] {
  const items: ChatPanelRenderItem[] = []
  const thinkingBlocks = getChatPanelThinkingBlocks(blocks)
  const compactToolBlocks = getChatPanelToolBlocks(blocks, options.toolNamePrefix)
  const firstThinkingIndex = blocks.findIndex((block) => block.kind === 'thinking')
  const firstCompactToolIndex = blocks.findIndex(
    (block) =>
      block.kind === 'tool_call' &&
      (options.toolNamePrefix == null || block.toolName.startsWith(options.toolNamePrefix)),
  )
  const groupVisibleText = options.toolCallDisplay !== 'full'

  blocks.forEach((block, index) => {
    if (block.kind === 'thinking') {
      if (index === firstThinkingIndex && thinkingBlocks.length > 0) {
        items.push({ kind: 'thinking_group', key: 'thinking-group', blocks: thinkingBlocks })
      }
      return
    }

    if (block.kind === 'tool_call' && options.toolCallDisplay !== 'full') {
      if (
        options.toolCallDisplay === 'summary' &&
        index === firstCompactToolIndex &&
        compactToolBlocks.length > 0
      ) {
        items.push({ kind: 'tool_activity', key: 'tool-activity', blocks: compactToolBlocks })
      }
      return
    }

    if (block.kind === 'text' && groupVisibleText) {
      const previous = items.at(-1)
      if (previous?.kind === 'text_group') {
        previous.blocks.push(block)
      } else {
        items.push({
          kind: 'text_group',
          key: `text-group:${block.segmentId ?? index}`,
          blocks: [block],
        })
      }
      return
    }

    items.push({ kind: 'block', key: blockKey(block, index), block })
  })

  return items
}

export function getChatPanelTextGroupContent(blocks: ChatPanelTextBlock[]): string {
  return blocks
    .map((block) => block.content)
    .filter((content) => content.length > 0)
    .join('\n\n')
}

function blockKey(block: UIBlock, index: number): string {
  if ((block.kind === 'text' || block.kind === 'thinking') && block.segmentId != null) {
    return `${block.kind}:${block.segmentId}`
  }
  if ('toolCallId' in block && typeof block.toolCallId === 'string') {
    return `${block.kind}:${block.toolCallId}`
  }
  if (block.kind === 'checkpoint') return `checkpoint:${block.checkpointId}`
  if (block.kind === 'file_change') return `file:${block.path}:${index}`
  return `${block.kind}:${index}`
}
