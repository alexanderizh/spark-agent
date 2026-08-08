import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import {
  cancelOptimisticUserMessage,
  cancelOptimisticUserMessageByTurnId,
  clearOptimisticUserMessagesForSession,
  commitOptimisticUserMessage,
  createOptimisticUserMessage,
  failOptimisticUserMessage,
  removeQueuedOptimisticUserMessages,
  settleOptimisticUserSend,
  settleOptimisticImageSend,
  startOptimisticUserSend,
  startOptimisticImageSend,
  mergeOptimisticUserMessages,
  pruneAcknowledgedOptimisticUserMessages,
} from './optimistic-user-messages'

function realUserMessage(turnId: string): UIMessage {
  return {
    id: `event-${turnId}`,
    turnId,
    role: 'user',
    status: 'completed',
    blocks: [{ kind: 'text', content: '查看图片', isStreaming: false }],
    attachments: [{ type: 'image', path: '/tmp/optimized.jpg', name: 'screen.png' }],
    usage: null,
    eventIds: [`event-${turnId}`],
  }
}

describe('optimistic user messages', () => {
  it('creates a renderer-only message with the original preview fields', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-1',
      sessionId: 'session-1',
      content: '查看图片',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [
        {
          id: 'image-1',
          type: 'image',
          path: '/tmp/original.png',
          name: 'screen.png',
          previewPath: '/tmp/preview.png',
          previewUrl: 'spark-safe-file://x/original-preview',
        },
      ],
    })

    expect(optimistic.message).toMatchObject({
      id: 'optimistic-client-1',
      role: 'user',
      status: 'completed',
      timestamp: '2026-08-02T10:00:00.000Z',
      attachments: [
        {
          type: 'image',
          path: '/tmp/original.png',
          name: 'screen.png',
          previewPath: '/tmp/preview.png',
          previewUrl: 'spark-safe-file://x/original-preview',
        },
      ],
    })
  })

  it('associates the optimistic message with the returned turn id', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-1',
      sessionId: 'session-1',
      content: '查看图片',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })

    const committed = commitOptimisticUserMessage([optimistic], 'client-1', 'turn-1')

    expect(committed[0]?.turnId).toBe('turn-1')
    expect(committed[0]?.message.turnId).toBe('turn-1')
    expect(committed[0]?.message.deliveryState).toBe('accepted')
  })

  it('shows ordinary text immediately and preserves team mention metadata', () => {
    const onBegin = vi.fn()
    const onCommit = vi.fn()
    const onFail = vi.fn()
    const onCancel = vi.fn()
    const lifecycle = startOptimisticUserSend(
      {
        sessionId: 'session-1',
        content: '@worker 请处理这个问题',
        attachments: [],
        mentionAgentId: 'worker',
      },
      { onBegin, onCommit, onFail, onCancel },
      () => 'client-text',
      () => '2026-08-02T10:00:00.000Z',
    )

    expect(onBegin).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-text', mentionAgentId: 'worker' }),
    )
    const draft = onBegin.mock.calls[0]?.[0]
    expect(draft == null ? undefined : createOptimisticUserMessage(draft).message).toMatchObject({
      deliveryState: 'submitting',
      mentionAgentId: 'worker',
    })

    settleOptimisticUserSend(lifecycle, { turnId: 'turn-text', started: false })
    expect(onCommit).toHaveBeenCalledWith('client-text', 'turn-text', false)
    expect(onFail).not.toHaveBeenCalled()
  })

  it('keeps a failed optimistic message for retry instead of removing it', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-failed',
      sessionId: 'session-1',
      content: '发送失败也要保留',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })

    const failed = failOptimisticUserMessage([optimistic], 'client-failed', '连接已断开')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.message.deliveryState).toBe('failed')
    expect(failed[0]?.message.deliveryError).toBe('连接已断开')
  })

  it('keeps queued turns out of the chat stream and removes explicit cancellations', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-queue',
      sessionId: 'session-1',
      content: '排队消息',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })

    expect(commitOptimisticUserMessage([optimistic], 'client-queue', 'turn-queue', false)).toEqual(
      [],
    )

    const accepted = commitOptimisticUserMessage([optimistic], 'client-queue', 'turn-queue')
    expect(accepted[0]?.message.deliveryState).toBe('accepted')
    expect(
      removeQueuedOptimisticUserMessages(accepted, 'session-1', new Set(['turn-queue'])),
    ).toEqual([])
    const queuedState = {
      ...accepted[0]!,
      message: { ...accepted[0]!.message, deliveryState: 'queued' as const },
    }
    expect(mergeOptimisticUserMessages([], [queuedState], 'session-1')).toEqual([])
    expect(cancelOptimisticUserMessageByTurnId(accepted, 'session-1', 'turn-queue')).toEqual([])
  })

  it('removes the submitting bubble when the backend queues the turn', () => {
    let messages: ReturnType<typeof createOptimisticUserMessage>[] = []
    const lifecycle = startOptimisticUserSend(
      {
        sessionId: 'session-1',
        content: '不要显示在聊天流里的排队消息',
        attachments: [],
        hiddenUntilStarted: true,
      },
      {
        onBegin: (draft) => {
          messages = [...messages, createOptimisticUserMessage(draft)]
        },
        onCommit: (clientId, turnId, started) => {
          messages = commitOptimisticUserMessage(messages, clientId, turnId, started)
        },
        onFail: vi.fn(),
        onCancel: vi.fn(),
      },
      () => 'client-queued',
      () => '2026-08-02T10:00:00.000Z',
    )

    expect(messages).toHaveLength(1)
    expect(mergeOptimisticUserMessages([], messages, 'session-1')).toEqual([])
    settleOptimisticUserSend(lifecycle, { turnId: 'turn-queued', started: false })
    expect(messages).toEqual([])
  })

  it('reveals a busy-session message only after execution starts or submission fails', () => {
    const hidden = createOptimisticUserMessage({
      clientId: 'client-hidden',
      sessionId: 'session-1',
      content: '等待后端确认',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
      hiddenUntilStarted: true,
    })

    const accepted = commitOptimisticUserMessage([hidden], 'client-hidden', 'turn-started', true)
    expect(accepted[0]?.hiddenUntilStarted).toBeUndefined()
    expect(mergeOptimisticUserMessages([], accepted, 'session-1')).toHaveLength(1)

    const failed = failOptimisticUserMessage([hidden], 'client-hidden', '连接已断开')
    expect(failed[0]?.hiddenUntilStarted).toBeUndefined()
    expect(mergeOptimisticUserMessages([], failed, 'session-1')[0]?.deliveryState).toBe('failed')
  })

  it('clears renderer-only messages only for the reset session', () => {
    const resetSessionMessage = createOptimisticUserMessage({
      clientId: 'client-reset',
      sessionId: 'session-reset',
      content: '清空后不应保留',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })
    const otherSessionMessage = createOptimisticUserMessage({
      clientId: 'client-other',
      sessionId: 'session-other',
      content: '其他会话继续保留',
      createdAt: '2026-08-02T10:00:01.000Z',
      attachments: [],
    })

    expect(
      clearOptimisticUserMessagesForSession(
        [resetSessionMessage, otherSessionMessage],
        'session-reset',
      ),
    ).toEqual([otherSessionMessage])
  })

  it('lets the real user message replace a committed optimistic message without duplication', () => {
    const optimistic = commitOptimisticUserMessage(
      [
        createOptimisticUserMessage({
          clientId: 'client-1',
          sessionId: 'session-1',
          content: '查看图片',
          createdAt: '2026-08-02T10:00:00.000Z',
          attachments: [
            {
              id: 'image-1',
              type: 'image',
              path: '/tmp/original.png',
              name: 'screen.png',
              previewUrl: 'safe-file://x/original',
            },
          ],
        }),
      ],
      'client-1',
      'turn-1',
    )
    const real = realUserMessage('turn-1')

    expect(mergeOptimisticUserMessages([real], optimistic, 'session-1')).toEqual([
      {
        ...real,
        attachments: [
          {
            type: 'image',
            path: '/tmp/optimized.jpg',
            name: 'screen.png',
            previewUrl: 'safe-file://x/original',
          },
        ],
      },
    ])
    expect(pruneAcknowledgedOptimisticUserMessages(optimistic, [real], 'session-1')).toEqual([])
  })

  it('isolates sessions and preserves pending message order', () => {
    const first = createOptimisticUserMessage({
      clientId: 'client-1',
      sessionId: 'session-1',
      content: '第一张',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })
    const otherSession = createOptimisticUserMessage({
      clientId: 'client-2',
      sessionId: 'session-2',
      content: '其他会话',
      createdAt: '2026-08-02T10:00:00.500Z',
      attachments: [],
    })
    const second = createOptimisticUserMessage({
      clientId: 'client-3',
      sessionId: 'session-1',
      content: '第二张',
      createdAt: '2026-08-02T10:00:01.000Z',
      attachments: [],
    })

    const merged = mergeOptimisticUserMessages([], [second, otherSession, first], 'session-1')

    expect(merged.map((message) => message.id)).toEqual([
      'optimistic-client-1',
      'optimistic-client-3',
    ])
  })

  it('removes an optimistic message when sending fails', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-1',
      sessionId: 'session-1',
      content: '查看图片',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })

    expect(cancelOptimisticUserMessage([optimistic], 'client-1')).toEqual([])
  })

  it('starts only image sends and commits the returned turn id', () => {
    const onBegin = vi.fn()
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const callbacks = { onBegin, onCommit, onCancel }

    expect(
      startOptimisticImageSend(
        {
          sessionId: 'session-1',
          content: '只有文件',
          attachments: [{ id: 'file', type: 'file', path: '/tmp/a.txt', name: 'a.txt' }],
        },
        callbacks,
        () => 'client-file',
        () => '2026-08-02T10:00:00.000Z',
      ),
    ).toBeNull()
    expect(onBegin).not.toHaveBeenCalled()

    const lifecycle = startOptimisticImageSend(
      {
        sessionId: 'session-1',
        content: '查看图片',
        attachments: [{ id: 'image', type: 'image', path: '/tmp/image.png', name: 'image.png' }],
      },
      callbacks,
      () => 'client-image',
      () => '2026-08-02T10:00:00.000Z',
    )

    expect(onBegin).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-image', sessionId: 'session-1' }),
    )
    lifecycle?.commit('turn-1')
    lifecycle?.cancel()
    expect(onCommit).toHaveBeenCalledWith('client-image', 'turn-1')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels a pending optimistic image send once when sending fails', () => {
    const onCancel = vi.fn()
    const lifecycle = startOptimisticImageSend(
      {
        sessionId: 'session-1',
        content: '查看图片',
        attachments: [{ id: 'image', type: 'image', path: '/tmp/image.png', name: 'image.png' }],
      },
      { onBegin: vi.fn(), onCommit: vi.fn(), onCancel },
      () => 'client-image',
      () => '2026-08-02T10:00:00.000Z',
    )

    lifecycle?.cancel()
    lifecycle?.cancel()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith('client-image')
  })

  it('removes the preview instead of committing it when the turn is queued', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const lifecycle = startOptimisticImageSend(
      {
        sessionId: 'session-1',
        content: '查看图片',
        attachments: [{ id: 'image', type: 'image', path: '/tmp/image.png', name: 'image.png' }],
      },
      { onBegin: vi.fn(), onCommit, onCancel },
      () => 'client-image',
      () => '2026-08-02T10:00:00.000Z',
    )

    settleOptimisticImageSend(lifecycle, { turnId: 'turn-queued', started: false })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledWith('client-image')
  })
})
