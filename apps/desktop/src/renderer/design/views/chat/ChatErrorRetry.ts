import type { UIMessage } from '../../services/event-mapper'
import type { ComposerPrefillPayload } from './ChatComposerTypes'

export function buildErrorRetryPayload(
  messages: UIMessage[],
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

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const text = message.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.content)
      .join('\n')
      .trim()
    const attachments = message.attachments ?? []
    return text.length > 0 || attachments.length > 0 ? { text, attachments } : null
  }

  return null
}
