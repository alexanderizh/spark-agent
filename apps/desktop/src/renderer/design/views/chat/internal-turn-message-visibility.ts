import type { SessionQueuedTurn, TurnPromptSnapshotEvent } from '@spark/protocol'
import type { UIMessage } from '../../services/event-mapper'

export const HIDDEN_INTERNAL_TURN_PLACEHOLDER = '内部提示已隐藏'

/**
 * Builds the chat-only projection without mutating the complete logical message stream.
 * Hidden user metadata is copied to sibling assistant messages so retry/navigation code can
 * reason about the turn without exposing or reconstructing the hidden prompt.
 */
export function projectVisibleChatMessages(messages: UIMessage[]): UIMessage[] {
  const hiddenTurns = new Map<string, Pick<UIMessage, 'turnSource' | 'userMessageVisibility'>>()
  for (const message of messages) {
    if (
      message.role === 'user' &&
      message.turnId != null &&
      message.userMessageVisibility === 'hidden'
    ) {
      hiddenTurns.set(message.turnId, {
        ...(message.turnSource != null ? { turnSource: message.turnSource } : {}),
        userMessageVisibility: 'hidden',
      })
    }
  }

  return messages.flatMap((message) => {
    if (message.role === 'user' && message.userMessageVisibility === 'hidden') return []
    const hiddenPresentation = message.turnId == null ? undefined : hiddenTurns.get(message.turnId)
    return hiddenPresentation == null ? [message] : [{ ...message, ...hiddenPresentation }]
  })
}

function getInternalTurnDisplayLabel(turnSource: SessionQueuedTurn['turnSource']): string {
  switch (turnSource) {
    case 'scheduled_task':
      return '定时任务自动执行'
    case 'goal_contract_draft':
      return '目标模式：生成验收标准'
    case 'goal_iteration':
      return '目标模式自动执行'
    case 'command_follow_up':
      return '命令自动执行'
    default:
      return '内部任务自动执行'
  }
}

/** Keeps queue controls available while replacing hidden prompt bodies with safe labels. */
export function projectQueuedTurnsForDisplay(turns: SessionQueuedTurn[]): SessionQueuedTurn[] {
  return turns.map((turn) =>
    turn.userMessageVisibility === 'hidden'
      ? { ...turn, message: getInternalTurnDisplayLabel(turn.turnSource) }
      : turn,
  )
}

/** Runtime audit keeps the snapshot but never renders an explicitly hidden user prompt. */
export function getVisibleTurnPromptSnapshotUserMessage(snapshot: TurnPromptSnapshotEvent): string {
  return snapshot.userMessageVisibility === 'hidden'
    ? HIDDEN_INTERNAL_TURN_PLACEHOLDER
    : snapshot.userMessage
}
