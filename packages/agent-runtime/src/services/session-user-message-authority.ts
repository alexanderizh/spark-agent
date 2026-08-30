import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  SessionAttachment,
  SessionReferenceInput,
  UserMessageEvent,
  UserMessagePresentation,
} from '@spark/protocol'

export interface AuthoritativeUserMessageInput {
  sessionId: string
  turnId: string
  message: string
  attachments?: SessionAttachment[]
  sessionReferences?: SessionReferenceInput[]
  presentation?: UserMessagePresentation
  now?: () => string
  createId?: () => string
}

/**
 * Composer-originated turns carry a stable client id. Persisting their user event at the
 * SessionService start boundary keeps UI acknowledgement independent from engine startup.
 * Legacy/internal callers remain executor-owned until they opt into the same id contract.
 */
export function createAuthoritativeUserMessageEvent(
  input: AuthoritativeUserMessageInput,
): UserMessageEvent | null {
  if (input.presentation?.clientMessageId == null) return null
  return {
    id: input.createId?.() ?? randomUUID(),
    type: 'user_message',
    sessionId: input.sessionId,
    turnId: input.turnId,
    timestamp: input.now?.() ?? new Date().toISOString(),
    seq: 0,
    content: input.message,
    ...input.presentation,
    ...(input.attachments != null && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((attachment) => ({
            type: attachment.type,
            path: attachment.path,
            name: path.basename(attachment.path),
          })),
        }
      : {}),
    ...(input.sessionReferences != null && input.sessionReferences.length > 0
      ? { sessionReferences: input.sessionReferences }
      : {}),
  }
}
