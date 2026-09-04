import type { UIMessage } from '../../services/event-mapper'
import type { ComposerPrefillPayload } from './ChatComposerTypes'

function buildUserRetryPayload(
  messages: readonly UIMessage[],
  startIndex: number,
  turnId?: string,
): ComposerPrefillPayload | null {
  for (let index = startIndex; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (turnId != null && message.turnId !== turnId) continue
    if (message.userMessageVisibility === 'hidden') return null
    const text = message.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.content)
      .join('\n')
      .trim()
    const attachments = message.attachments ?? []
    const sessionReferences = (message.sessionReferences ?? []).map((reference) => ({
      sourceSessionId: reference.sourceSessionId,
      title: reference.title ?? reference.sourceSessionId,
      ...(reference.snapshotSeq !== undefined ? { snapshotSeq: reference.snapshotSeq } : {}),
    }))
    return text.length > 0 || attachments.length > 0 || sessionReferences.length > 0
      ? {
          text,
          attachments,
          ...(sessionReferences.length > 0 ? { sessionReferences } : {}),
        }
      : null
  }
  return null
}

export function buildErrorRetryPayload(
  messages: readonly UIMessage[],
  assistantIndex: number,
): ComposerPrefillPayload | null {
  const assistant = messages[assistantIndex]
  if (
    assistant?.role !== 'assistant' ||
    !assistant.blocks.some(
      (block) =>
        (block.kind === 'error' || block.kind === 'runtime_signal') && block.retryable === true,
    )
  ) {
    return null
  }
  if (assistant.userMessageVisibility === 'hidden') return null

  return buildUserRetryPayload(messages, assistantIndex - 1, assistant.turnId)
}

/** Queue pause already proves the turn failed, so retry can recover the matching user payload. */
export function buildTurnRetryPayload(
  messages: readonly UIMessage[],
  failedTurnId: string | undefined,
): ComposerPrefillPayload | null {
  if (failedTurnId == null || failedTurnId.length === 0) return null
  return buildUserRetryPayload(messages, messages.length - 1, failedTurnId)
}
