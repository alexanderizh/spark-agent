import type { UIBlock } from '../services/event-mapper'

export type ChatPanelThinkingBlock = Extract<UIBlock, { kind: 'thinking' }>

export function getChatPanelThinkingBlocks(blocks: UIBlock[]): ChatPanelThinkingBlock[] {
  return blocks.filter((block): block is ChatPanelThinkingBlock => block.kind === 'thinking')
}
