import type { UIMessage } from './event-mapper'

export const MAX_QUICK_REPLIES = 4
export const MAX_QUICK_REPLY_LENGTH = 40

export type PendingQuickReplies = {
  key: string
  toolCallId: string
  replies: string[]
}

export function isQuickReplySuggestionsTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === 'mcp__spark_ui__suggest_replies'
}

export function parseQuickReplies(input: unknown): string[] {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return []
  const raw = (input as Record<string, unknown>).replies
  if (!Array.isArray(raw)) return []

  const replies: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const reply = item.trim().slice(0, MAX_QUICK_REPLY_LENGTH)
    if (!reply || seen.has(reply)) continue
    seen.add(reply)
    replies.push(reply)
    if (replies.length >= MAX_QUICK_REPLIES) break
  }
  return replies
}

/**
 * Resolve the latest unconsumed quick replies after the most recent user message.
 * An unanswered structured question wins if a model violates the mutual-exclusion prompt.
 */
export function resolvePendingQuickReplies(messages: UIMessage[]): PendingQuickReplies | null {
  let candidate: PendingQuickReplies | null = null
  let hasPendingStructuredQuestion = false

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message == null) continue
    if (message.role === 'user') break

    for (let blockIndex = message.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.blocks[blockIndex]
      if (block == null) continue
      if (block.kind === 'user_question' && !block.answered) {
        hasPendingStructuredQuestion = true
      } else if (block.kind === 'quick_replies' && candidate == null) {
        candidate = {
          key: `${message.turnId ?? message.id}:${block.toolCallId}`,
          toolCallId: block.toolCallId,
          replies: block.replies,
        }
      }
    }
  }

  return hasPendingStructuredQuestion ? null : candidate
}
