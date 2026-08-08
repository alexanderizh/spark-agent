import type { UIMessage } from '../../services/event-mapper'
import type { ComposerAttachment } from './ChatComposerTypes'

export interface OptimisticUserMessageDraft {
  clientId: string
  sessionId: string
  content: string
  attachments: ComposerAttachment[]
  createdAt: string
  mentionAgentId?: string
}

export interface OptimisticUserMessage {
  clientId: string
  sessionId: string
  turnId?: string
  createdAt: string
  message: UIMessage
}

export interface OptimisticUserSendCallbacks {
  onBegin: (draft: OptimisticUserMessageDraft) => void
  onCommit: (clientId: string, turnId: string, started: boolean) => void
  onFail: (clientId: string, error: string) => void
  onCancel: (clientId: string) => void
}

export interface OptimisticUserSendLifecycle {
  clientId: string
  commit: (turnId: string, started: boolean) => void
  fail: (error: string) => void
  cancel: () => void
}

export function settleOptimisticUserSend(
  lifecycle: OptimisticUserSendLifecycle | null,
  result: { turnId: string; started: boolean },
): void {
  if (lifecycle == null) return
  lifecycle.commit(result.turnId, result.started)
}

export function startOptimisticUserSend(
  input: Omit<OptimisticUserMessageDraft, 'clientId' | 'createdAt'>,
  callbacks: OptimisticUserSendCallbacks | undefined,
  createId: () => string = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
): OptimisticUserSendLifecycle | null {
  if (callbacks == null) return null

  const clientId = createId()
  callbacks.onBegin({ ...input, clientId, createdAt: now() })
  let settled = false

  return {
    clientId,
    commit: (turnId, started) => {
      if (settled) return
      settled = true
      callbacks.onCommit(clientId, turnId, started)
    },
    fail: (error) => {
      if (settled) return
      settled = true
      callbacks.onFail(clientId, error)
    },
    cancel: () => {
      if (settled) return
      settled = true
      callbacks.onCancel(clientId)
    },
  }
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

export function settleOptimisticImageSend(
  lifecycle: OptimisticImageSendLifecycle | null,
  result: { turnId: string; started: boolean },
): void {
  if (lifecycle == null) return
  if (result.started) lifecycle.commit(result.turnId)
  else lifecycle.cancel()
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
      clientId: draft.clientId,
      deliveryState: 'submitting',
      blocks: [{ kind: 'text', content: draft.content, isStreaming: false }],
      ...(draft.attachments.length > 0
        ? {
            attachments: draft.attachments.map(({ type, path, name, previewPath, previewUrl }) => ({
              type,
              path,
              ...(name != null ? { name } : {}),
              ...(previewPath != null ? { previewPath } : {}),
              ...(previewUrl != null ? { previewUrl } : {}),
            })),
          }
        : {}),
      usage: null,
      timestamp: draft.createdAt,
      eventIds: [],
      ...(draft.mentionAgentId != null ? { mentionAgentId: draft.mentionAgentId } : {}),
    },
  }
}

export function commitOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  clientId: string,
  turnId: string,
  started = true,
): OptimisticUserMessage[] {
  return messages.map((item) => {
    if (item.clientId !== clientId) return item
    const { deliveryError: _deliveryError, ...messageWithoutError } = item.message
    return {
      ...item,
      turnId,
      message: {
        ...messageWithoutError,
        turnId,
        deliveryState: started ? 'accepted' : 'queued',
      },
    }
  })
}

export function failOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  clientId: string,
  error: string,
): OptimisticUserMessage[] {
  return messages.map((item) =>
    item.clientId === clientId
      ? {
          ...item,
          message: {
            ...item.message,
            deliveryState: 'failed',
            deliveryError: error,
          },
        }
      : item,
  )
}

export function setOptimisticUserMessagesQueued(
  messages: OptimisticUserMessage[],
  sessionId: string,
  queuedTurnIds: ReadonlySet<string>,
): OptimisticUserMessage[] {
  return messages.map((item) => {
    if (item.sessionId !== sessionId || item.turnId == null) {
      return item
    }
    if (item.message.deliveryState === 'failed') return item
    if (!queuedTurnIds.has(item.turnId) && item.message.deliveryState !== 'queued') return item
    const { deliveryError: _deliveryError, ...messageWithoutError } = item.message
    return {
      ...item,
      message: {
        ...messageWithoutError,
        deliveryState: queuedTurnIds.has(item.turnId) ? 'queued' : 'accepted',
      },
    }
  })
}

export function cancelOptimisticUserMessageByTurnId(
  messages: OptimisticUserMessage[],
  sessionId: string,
  turnId: string,
): OptimisticUserMessage[] {
  return messages.filter((item) => !(item.sessionId === sessionId && item.turnId === turnId))
}

export function clearOptimisticUserMessagesForSession(
  messages: OptimisticUserMessage[],
  sessionId: string,
): OptimisticUserMessage[] {
  return messages.filter((item) => item.sessionId !== sessionId)
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
