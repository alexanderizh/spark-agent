import type { UIMessage } from '../../services/event-mapper'
import type { ComposerAttachment } from './ChatComposerTypes'

export interface OptimisticUserMessageDraft {
  clientId: string
  sessionId: string
  content: string
  attachments: ComposerAttachment[]
  createdAt: string
}

export interface OptimisticUserMessage {
  clientId: string
  sessionId: string
  turnId?: string
  createdAt: string
  message: UIMessage
}

export interface OptimisticImageSendCallbacks {
  onBegin: (draft: OptimisticUserMessageDraft) => void
  onCommit: (clientId: string, turnId: string) => void
  onCancel: (clientId: string) => void
}

export interface OptimisticImageSendLifecycle {
  clientId: string
  commit: (turnId: string) => void
  cancel: () => void
}

export function startOptimisticImageSend(
  input: Omit<OptimisticUserMessageDraft, 'clientId' | 'createdAt'>,
  callbacks: OptimisticImageSendCallbacks | undefined,
  createId: () => string = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
): OptimisticImageSendLifecycle | null {
  if (callbacks == null || !input.attachments.some((attachment) => attachment.type === 'image')) {
    return null
  }

  const clientId = createId()
  callbacks.onBegin({ ...input, clientId, createdAt: now() })
  let settled = false

  return {
    clientId,
    commit: (turnId) => {
      if (settled) return
      settled = true
      callbacks.onCommit(clientId, turnId)
    },
    cancel: () => {
      if (settled) return
      settled = true
      callbacks.onCancel(clientId)
    },
  }
}

export function createOptimisticUserMessage(
  draft: OptimisticUserMessageDraft,
): OptimisticUserMessage {
  return {
    clientId: draft.clientId,
    sessionId: draft.sessionId,
    createdAt: draft.createdAt,
    message: {
      id: `optimistic-${draft.clientId}`,
      role: 'user',
      status: 'completed',
      blocks: [{ kind: 'text', content: draft.content, isStreaming: false }],
      ...(draft.attachments.length > 0
        ? {
            attachments: draft.attachments.map(
              ({ type, path, name, previewPath, previewUrl }) => ({
                type,
                path,
                ...(name != null ? { name } : {}),
                ...(previewPath != null ? { previewPath } : {}),
                ...(previewUrl != null ? { previewUrl } : {}),
              }),
            ),
          }
        : {}),
      usage: null,
      timestamp: draft.createdAt,
      eventIds: [],
    },
  }
}

export function commitOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  clientId: string,
  turnId: string,
): OptimisticUserMessage[] {
  return messages.map((item) =>
    item.clientId === clientId
      ? { ...item, turnId, message: { ...item.message, turnId } }
      : item,
  )
}

export function cancelOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  clientId: string,
): OptimisticUserMessage[] {
  return messages.filter((item) => item.clientId !== clientId)
}

export function mergeOptimisticUserMessages(
  persistedMessages: UIMessage[],
  optimisticMessages: OptimisticUserMessage[],
  sessionId: string,
): UIMessage[] {
  const optimisticByTurnId = new Map(
    optimisticMessages.flatMap((item) =>
      item.sessionId === sessionId && item.turnId != null ? [[item.turnId, item] as const] : [],
    ),
  )
  const persistedWithImmediatePreviews = persistedMessages.map((message) => {
    const optimistic = message.turnId == null ? undefined : optimisticByTurnId.get(message.turnId)
    if (message.role !== 'user' || optimistic == null || message.attachments == null) return message
    const optimisticAttachments = optimistic.message.attachments ?? []
    return {
      ...message,
      attachments: message.attachments.map((attachment, index) => {
        const sameIndex = optimisticAttachments[index]
        const previewSource =
          sameIndex?.type === attachment.type
            ? sameIndex
            : optimisticAttachments.find(
                (candidate) =>
                  candidate.type === attachment.type && candidate.name === attachment.name,
              )
        if (previewSource == null) return attachment
        return {
          ...attachment,
          ...(previewSource.previewPath != null ? { previewPath: previewSource.previewPath } : {}),
          ...(previewSource.previewUrl != null ? { previewUrl: previewSource.previewUrl } : {}),
        }
      }),
    }
  })
  const persistedUserTurnIds = new Set(
    persistedMessages.flatMap((message) =>
      message.role === 'user' && message.turnId != null ? [message.turnId] : [],
    ),
  )
  const pending = optimisticMessages
    .filter(
      (item) =>
        item.sessionId === sessionId &&
        (item.turnId == null || !persistedUserTurnIds.has(item.turnId)),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((item) => item.message)

  return pending.length === 0
    ? persistedWithImmediatePreviews
    : [...persistedWithImmediatePreviews, ...pending]
}

export function pruneAcknowledgedOptimisticUserMessages(
  optimisticMessages: OptimisticUserMessage[],
  persistedMessages: UIMessage[],
  sessionId: string,
): OptimisticUserMessage[] {
  const persistedUserTurnIds = new Set(
    persistedMessages.flatMap((message) =>
      message.role === 'user' && message.turnId != null ? [message.turnId] : [],
    ),
  )
  return optimisticMessages.filter(
    (item) =>
      item.sessionId !== sessionId || item.turnId == null || !persistedUserTurnIds.has(item.turnId),
  )
}
