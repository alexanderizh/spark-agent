import type { UIBlock } from '../services/event-mapper'

export function hasVisibleTeamMemberActivityBlocks(blocks: UIBlock[]): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case 'team_member_message':
        return block.content.trim().length > 0
      case 'tool_call':
      case 'terminal':
      case 'file_change':
        return false
      default:
        return true
    }
  })
}
