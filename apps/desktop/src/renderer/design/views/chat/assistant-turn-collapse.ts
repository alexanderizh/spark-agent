import type { UIBlock, UIMessage } from '../../services/event-mapper'

export interface AssistantTurnCollapseProjection {
  canCollapse: boolean
  collapsedBlocks: readonly UIBlock[]
}

/**
 * Computes the renderer-only collapsed projection for one assistant turn.
 * `assistant_message.isFinal` identifies the summary block, but the projection
 * remains unavailable until the whole normalized UIMessage is completed.
 */
export function projectAssistantTurnCollapse(
  status: UIMessage['status'] | undefined,
  blocks: readonly UIBlock[],
): AssistantTurnCollapseProjection {
  const summary = findFinalSummaryBlock(blocks)
  const canCollapse =
    status === 'completed' && summary != null && !blocks.some(blocksAutomaticTurnCollapse)

  return {
    canCollapse,
    collapsedBlocks: canCollapse && summary != null ? [summary] : blocks,
  }
}

function findFinalSummaryBlock(blocks: readonly UIBlock[]): UIBlock | null {
  const hostFinal = findLast(
    blocks,
    (block) =>
      block.kind === 'text' && block.isFinalAnswer === true && block.content.trim().length > 0,
  )
  if (hostFinal != null) return hostFinal

  const memberFinal = findLast(
    blocks,
    (block) =>
      block.kind === 'team_member_message' &&
      block.isFinalAnswer === true &&
      block.content.trim().length > 0,
  )
  if (memberFinal != null) return memberFinal

  // Legacy histories may predate the explicit final-answer hint. Preserve the
  // newest visible body instead of leaving a completed turn impossible to fold.
  return findLast(
    blocks,
    (block) =>
      (block.kind === 'text' || block.kind === 'team_member_message') &&
      block.content.trim().length > 0,
  )
}

function blocksAutomaticTurnCollapse(block: UIBlock): boolean {
  switch (block.kind) {
    case 'text':
    case 'thinking':
    case 'terminal':
    case 'team_member_message':
      return block.isStreaming
    case 'tool_call':
      return block.status === 'pending' || block.status === 'running'
    case 'subagent':
      return block.status === 'running' || block.status === 'paused'
    case 'team_dispatch':
      return block.state === 'pending' || block.state === 'working'
    case 'workflow_progress':
      return block.runStatus === 'working'
    case 'goal_iteration_divider':
      return block.state === 'running'
    case 'html_block':
    case 'diagram_block':
      return block.status === 'pending'
    case 'plan_proposed':
    case 'permission_request':
    case 'cancelled':
      return true
    case 'goal_contract':
      return block.state === 'pending'
    case 'user_question':
      return !block.answered
    case 'error':
      return true
    case 'runtime_signal':
      return block.level !== 'info'
    default:
      return false
  }
}

function findLast(
  blocks: readonly UIBlock[],
  predicate: (block: UIBlock) => boolean,
): UIBlock | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block != null && predicate(block)) return block
  }
  return null
}
