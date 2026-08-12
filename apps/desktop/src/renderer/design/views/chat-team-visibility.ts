import type { UIBlock } from '../services/event-mapper'

export function hasVisibleTeamMemberActivityBlocks(
  blocks: UIBlock[],
  showActivityLogs = false,
): boolean {
  return blocks.some((block) => {
    switch (block.kind) {
      case 'team_member_message':
        return block.content.trim().length > 0
      case 'tool_call':
      case 'terminal':
      case 'file_change':
      case 'thinking':
        return showActivityLogs
      default:
        return true
    }
  })
}
