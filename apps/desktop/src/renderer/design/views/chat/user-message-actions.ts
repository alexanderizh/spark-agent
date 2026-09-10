import type { SessionId, TurnId } from '@spark/protocol'
import type { UIMessage } from '../../services/event-mapper'
import type {
  ComposerPrefillPayload,
  ComposerRevisionPayload,
  ComposerSessionReference,
} from './ChatComposerTypes'

type SessionTitle = { id: string; title: string }

function mapSessionReferences(
  message: UIMessage,
  sessions: readonly SessionTitle[],
): ComposerSessionReference[] | undefined {
  if (message.sessionReferences == null || message.sessionReferences.length === 0) return undefined
  return message.sessionReferences.map((reference) => ({
    sourceSessionId: reference.sourceSessionId,
    title:
      reference.title ??
      sessions.find((session) => session.id === reference.sourceSessionId)?.title ??
      '未命名会话',
    ...(reference.snapshotSeq !== undefined ? { snapshotSeq: reference.snapshotSeq } : {}),
    status: 'active',
  }))
}

export function buildUserMessagePrefillPayload(
  message: UIMessage,
  text: string,
  sessions: readonly SessionTitle[],
): ComposerPrefillPayload {
  const sessionReferences = mapSessionReferences(message, sessions)
  return {
    text,
    attachments: message.attachments ?? [],
    ...(sessionReferences != null ? { sessionReferences } : {}),
  }
}

export function buildUserMessageRevisionPayload(
  sessionId: SessionId,
  message: UIMessage & { turnId: string },
  text: string,
  sessions: readonly SessionTitle[],
): ComposerRevisionPayload {
  return {
    ...buildUserMessagePrefillPayload(message, text, sessions),
    sessionId,
    turnId: message.turnId as TurnId,
    ...(message.mentionAgentId != null ? { mentionAgentId: message.mentionAgentId } : {}),
  }
}
