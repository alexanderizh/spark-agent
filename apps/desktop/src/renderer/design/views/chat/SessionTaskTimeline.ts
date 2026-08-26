import type { UIBlock, UIMessage } from '../../services/event-mapper'
import {
  extractSessionProgressTasks,
  isSessionProgressToolBlock,
  type InspectorTask,
} from './ChatInspectorUtils'

export type SessionTaskTimelineEntry = {
  anchorToolCallId: string
  tasks: InspectorTask[]
}

export function areSessionTaskTimelineEntriesEqual(
  left: SessionTaskTimelineEntry | undefined,
  right: SessionTaskTimelineEntry | undefined,
): boolean {
  if (left === right) return true
  if (left == null || right == null) return false
  if (
    left.anchorToolCallId !== right.anchorToolCallId ||
    left.tasks.length !== right.tasks.length
  ) {
    return false
  }
  return left.tasks.every((task, index) => {
    const other = right.tasks[index]
    return (
      other != null &&
      task.id === other.id &&
      task.subject === other.subject &&
      task.description === other.description &&
      task.activeForm === other.activeForm &&
      task.status === other.status &&
      task.createdAt === other.createdAt
    )
  })
}

/** Keep the chronological anchor and suppress later task tool cards in a message. */
export function projectSessionTaskTimelineBlocks(
  blocks: UIBlock[],
  anchorToolCallId: string,
): UIBlock[] {
  return blocks.filter(
    (block) => !isSessionProgressToolBlock(block) || block.toolCallId === anchorToolCallId,
  )
}

/**
 * True when a tool block must be routed through the session-task panel
 * replacement in `renderBlocks` (anchor renders the panel, the rest are
 * suppressed) instead of the generic tool card or a `ToolLogGroup` batch.
 * Both the flat (`renderBlocks`) and grouped (`renderActivityBlocks`) render
 * paths must consult this so the task protocols never drift apart.
 */
export function shouldReplaceSessionTaskBlock(
  block: UIBlock,
  sessionTaskEntry: SessionTaskTimelineEntry | null | undefined,
): boolean {
  return sessionTaskEntry != null && isSessionProgressToolBlock(block)
}

/**
 * Build one task-panel snapshot per assistant message that contains host task
 * events. The first event is the visual anchor; later updates in that message
 * refresh the same panel instead of adding duplicate tool cards.
 *
 * The snapshot intentionally delegates to `extractSessionProgressTasks`, the
 * same source used by the floating inspector, so both surfaces share status
 * normalization and terminal-state semantics.
 */
export function buildSessionTaskTimeline(
  messages: UIMessage[],
): ReadonlyMap<string, SessionTaskTimelineEntry> {
  const timeline = new Map<string, SessionTaskTimelineEntry>()

  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return
    const anchor = message.blocks.find(isSessionProgressToolBlock)
    if (anchor == null) return

    const tasks = extractSessionProgressTasks(messages.slice(0, index + 1))
    if (tasks.length === 0) return

    timeline.set(message.id, {
      anchorToolCallId: anchor.toolCallId,
      tasks,
    })
  })

  return timeline
}
