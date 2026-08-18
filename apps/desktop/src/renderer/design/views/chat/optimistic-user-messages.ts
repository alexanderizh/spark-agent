import type { UIMessage } from '../../services/event-mapper'
import type { ComposerAttachment, ComposerSessionReference } from './ChatComposerTypes'

export interface OptimisticUserMessageDraft {
  clientId: string
  sessionId: string
  content: string
  attachments: ComposerAttachment[]
  sessionReferences?: ComposerSessionReference[]
  createdAt: string
  mentionAgentId?: string
  hiddenUntilStarted?: boolean
}

export interface OptimisticUserMessage {
  clientId: string
  sessionId: string
  turnId?: string
  createdAt: string
  hiddenUntilStarted?: boolean
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
    ...(draft.hiddenUntilStarted === true ? { hiddenUntilStarted: true } : {}),
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
      ...(draft.sessionReferences != null && draft.sessionReferences.length > 0
        ? {
            sessionReferences: draft.sessionReferences.map((reference) => ({
              sourceSessionId: reference.sourceSessionId,
              title: reference.title,
              ...(reference.snapshotSeq !== undefined
                ? { snapshotSeq: reference.snapshotSeq }
                : {}),
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
  if (!started) {
    return messages.filter((item) => item.clientId !== clientId)
  }

  return messages.map((item) => {
    if (item.clientId !== clientId) return item
    const { hiddenUntilStarted: _hiddenUntilStarted, ...visibleItem } = item
    const { deliveryError: _deliveryError, ...messageWithoutError } = item.message
    return {
      ...visibleItem,
      turnId,
      message: {
        ...messageWithoutError,
        turnId,
        deliveryState: 'accepted',
      },
    }
  })
}

/** commit/cancel 竞态兜底：turn 已被取消、但 submit-turn 的 settle 晚于取消响应到达时，
 *  直接把气泡落到 cancelled 终态并补上 turnId——与「先 commit 后 cancel」的显示一致，
 *  也保证 merge 时能按时间锚定插回原位（不会被误标成 accepted 而永久残留）。 */
export function commitCancelledOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  clientId: string,
  turnId: string,
): OptimisticUserMessage[] {
  return messages.map((item) => {
    if (item.clientId !== clientId) return item
    const { hiddenUntilStarted: _hiddenUntilStarted, ...visibleItem } = item
    return {
      ...visibleItem,
      turnId,
      message: {
        ...item.message,
        turnId,
        deliveryState: 'cancelled',
      },
    }
  })
}

export function failOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  clientId: string,
  error: string,
): OptimisticUserMessage[] {
  return messages.map((item) => {
    if (item.clientId !== clientId) return item
    const { hiddenUntilStarted: _hiddenUntilStarted, ...visibleItem } = item
    return {
      ...visibleItem,
      message: {
        ...item.message,
        deliveryState: 'failed',
        deliveryError: error,
      },
    }
  })
}

export function removeQueuedOptimisticUserMessages(
  messages: OptimisticUserMessage[],
  sessionId: string,
  queuedTurnIds: ReadonlySet<string>,
): OptimisticUserMessage[] {
  return messages.filter(
    (item) =>
      item.sessionId !== sessionId || item.turnId == null || !queuedTurnIds.has(item.turnId),
  )
}

export function cancelOptimisticUserMessageByTurnId(
  messages: OptimisticUserMessage[],
  sessionId: string,
  turnId: string,
): OptimisticUserMessage[] {
  return messages.filter((item) => !(item.sessionId === sessionId && item.turnId === turnId))
}

export function finalizeCancelledOptimisticUserMessage(
  messages: OptimisticUserMessage[],
  sessionId: string,
  turnId: string,
): OptimisticUserMessage[] {
  return messages.map((item) => {
    if (item.sessionId !== sessionId || item.turnId !== turnId) return item
    const { hiddenUntilStarted: _hiddenUntilStarted, ...visibleItem } = item
    return {
      ...visibleItem,
      message: {
        ...item.message,
        deliveryState: 'cancelled',
      },
    }
  })
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
        item.hiddenUntilStarted !== true &&
        item.message.deliveryState !== 'queued' &&
        (item.turnId == null || !persistedUserTurnIds.has(item.turnId)),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  if (pending.length === 0) return persistedWithImmediatePreviews

  const pendingByTurnId = new Map<string, OptimisticUserMessage[]>()
  for (const item of pending) {
    if (item.turnId == null) continue
    const sameTurn = pendingByTurnId.get(item.turnId) ?? []
    sameTurn.push(item)
    pendingByTurnId.set(item.turnId, sameTurn)
  }

  const insertedTurnIds = new Set<string>()
  const merged: UIMessage[] = []
  for (const message of persistedWithImmediatePreviews) {
    if (message.turnId != null && !insertedTurnIds.has(message.turnId)) {
      const sameTurn = pendingByTurnId.get(message.turnId)
      if (sameTurn != null) {
        merged.push(...sameTurn.map((item) => item.message))
        insertedTurnIds.add(message.turnId)
      }
    }
    merged.push(message)
  }
  for (const item of pending) {
    if (item.turnId != null && insertedTurnIds.has(item.turnId)) continue
    if (item.message.deliveryState === 'cancelled') {
      // starting 窗口被终止的 turn 永远等不到 user_message 事件回流；这条气泡
      // 若追加到末尾，会排在后续真实消息之后（顺序错乱）。按发送时间插回原位。
      insertAtTimestampAnchor(merged, item.message, item.createdAt)
    } else {
      merged.push(item.message)
    }
  }
  return merged
}

/** 把消息插入到第一条 timestamp 晚于 anchorTime 的持久化消息之前；都更早（或无时间戳可比较）则追加末尾。 */
function insertAtTimestampAnchor(
  merged: UIMessage[],
  message: UIMessage,
  anchorTime: string,
): void {
  const anchorIndex = merged.findIndex(
    (candidate) => candidate.timestamp != null && candidate.timestamp > anchorTime,
  )
  if (anchorIndex === -1) {
    merged.push(message)
    return
  }
  merged.splice(anchorIndex, 0, message)
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
