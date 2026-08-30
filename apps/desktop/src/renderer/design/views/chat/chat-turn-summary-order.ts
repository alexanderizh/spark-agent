import type { UIBlock } from '../../services/event-mapper'

/** Keeps live observation artifacts at their event position in a turn. */
export function reorderChatTurnSummaryBlocks(blocks: UIBlock[]): UIBlock[] {
  const rank = (block: UIBlock): number => {
    if (block.kind === 'validation_suggestion') return 3
    if (block.kind === 'turn_file_summary') return 1
    if (block.kind === 'presented_files') return 2
    return 0
  }

  return blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => rank(left.block) - rank(right.block) || left.index - right.index)
    .map((entry) => entry.block)
}
