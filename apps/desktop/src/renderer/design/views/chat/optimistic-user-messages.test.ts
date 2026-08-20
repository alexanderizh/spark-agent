import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import {
  cancelOptimisticUserMessage,
  cancelOptimisticUserMessageByTurnId,
  clearOptimisticUserMessagesForSession,
  commitCancelledOptimisticUserMessage,
  commitOptimisticUserMessage,
  createOptimisticUserMessage,
  failOptimisticUserMessage,
  finalizeCancelledOptimisticUserMessage,
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

  it('carries session references into the optimistic user bubble', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-reference',
      sessionId: 'session-1',
      content: '这个会话是说什么的',
      createdAt: '2026-08-14T00:00:00.000Z',
      attachments: [],
      sessionReferences: [
        {
          sourceSessionId: 'source-session',
          title: '每个成员发一个 js 排序算法给我',
          snapshotSeq: 42,
        },
      ],
    })

    expect(optimistic.message.sessionReferences).toEqual([
      {
        sourceSessionId: 'source-session',
        title: '每个成员发一个 js 排序算法给我',
        snapshotSeq: 42,
      },
    ])
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

  it('reconciles a persisted user message by client id before turn commit settles', () => {
    const optimistic = createOptimisticUserMessage({
      clientId: 'client-correlated',
      sessionId: 'session-1',
      content: 'hello',
      createdAt: '2026-08-02T10:00:00.000Z',
      attachments: [],
    })
    const { deliveryState: optimisticDeliveryState, ...messageWithoutDeliveryState } =
      optimistic.message
    expect(optimisticDeliveryState).toBe('submitting')
    const persisted = {
      ...messageWithoutDeliveryState,
      id: 'persisted-1',
      turnId: 'turn-1',
      clientId: 'client-correlated',
      eventIds: ['event-1'],
    }

    expect(mergeOptimisticUserMessages([persisted], [optimistic], 'session-1')).toEqual([persisted])
    expect(pruneAcknowledgedOptimisticUserMessages([optimistic], [persisted], 'session-1')).toEqual(
      [],
    )
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

  it('keeps a pre-start cancelled user bubble before the persisted cancellation terminal', () => {
    const optimistic = commitOptimisticUserMessage(
      [
        createOptimisticUserMessage({
          clientId: 'client-cancelled',
          sessionId: 'session-1',
          content: '中止前尚未落库',
          createdAt: '2026-08-02T10:00:00.000Z',
          attachments: [],
        }),
      ],
      'client-cancelled',
      'turn-cancelled',
    )
    const cancelled = finalizeCancelledOptimisticUserMessage(
      optimistic,
      'session-1',
      'turn-cancelled',
    )
    const terminal: UIMessage = {
      id: 'cancel-terminal',
      turnId: 'turn-cancelled',
      role: 'assistant',
      status: 'cancelled',
      blocks: [],
      usage: null,
      eventIds: ['cancel-terminal'],
    }

    const merged = mergeOptimisticUserMessages([terminal], cancelled, 'session-1')

    expect(merged.map((message) => message.id)).toEqual([
      'optimistic-client-cancelled',
      'cancel-terminal',
    ])
    expect(merged[0]?.deliveryState).toBe('cancelled')
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

  it('anchors an unacknowledged cancelled bubble before later persisted messages', () => {
    // starting 窗口被终止：user_message 从未落库，cancelled 气泡没有 persisted 承接。
    // 它必须按发送时间插回原位，而不是垫在所有后续消息之后。
    const cancelled = finalizeCancelledOptimisticUserMessage(
      commitOptimisticUserMessage(
        [
          createOptimisticUserMessage({
            clientId: 'client-cancelled',
            sessionId: 'session-1',
            content: '555',
            createdAt: '2026-08-18T10:00:00.000Z',
            attachments: [],
          }),
        ],
        'client-cancelled',
        'turn-cancelled',
      ),
      'session-1',
      'turn-cancelled',
    )
    const laterTurn: UIMessage = {
      id: 'event-later',
      turnId: 'turn-later',
      role: 'user',
      status: 'completed',
      blocks: [{ kind: 'text', content: '后续消息', isStreaming: false }],
      usage: null,
      timestamp: '2026-08-18T10:00:05.000Z',
      eventIds: ['event-later'],
    }

    const merged = mergeOptimisticUserMessages([laterTurn], cancelled, 'session-1')

    expect(merged.map((message) => message.id)).toEqual([
      'optimistic-client-cancelled',
      'event-later',
    ])
  })

  it('appends a cancelled bubble at the end when it is newer than all persisted messages', () => {
    const cancelled = finalizeCancelledOptimisticUserMessage(
      commitOptimisticUserMessage(
        [
          createOptimisticUserMessage({
            clientId: 'client-cancelled',
            sessionId: 'session-1',
            content: '刚发就被终止',
            createdAt: '2026-08-18T10:00:06.000Z',
            attachments: [],
          }),
        ],
        'client-cancelled',
        'turn-cancelled',
      ),
      'session-1',
      'turn-cancelled',
    )
    const earlierTurn: UIMessage = {
      id: 'event-earlier',
      turnId: 'turn-earlier',
      role: 'user',
      status: 'completed',
      blocks: [{ kind: 'text', content: '更早的消息', isStreaming: false }],
      usage: null,
      timestamp: '2026-08-18T10:00:01.000Z',
      eventIds: ['event-earlier'],
    }

    const merged = mergeOptimisticUserMessages([earlierTurn], cancelled, 'session-1')

    expect(merged.map((message) => message.id)).toEqual([
      'event-earlier',
      'optimistic-client-cancelled',
    ])
  })

  it('still appends submitting bubbles at the end (no timestamp anchoring)', () => {
    const submitting = [
      createOptimisticUserMessage({
        clientId: 'client-submitting',
        sessionId: 'session-1',
        content: '正在发送',
        createdAt: '2026-08-18T10:00:00.000Z',
        attachments: [],
      }),
    ]
    const laterTurn: UIMessage = {
      id: 'event-later',
      turnId: 'turn-later',
      role: 'user',
      status: 'completed',
      blocks: [{ kind: 'text', content: '后续消息', isStreaming: false }],
      usage: null,
      timestamp: '2026-08-18T10:00:05.000Z',
      eventIds: ['event-later'],
    }

    const merged = mergeOptimisticUserMessages([laterTurn], submitting, 'session-1')

    expect(merged.map((message) => message.id)).toEqual([
      'event-later',
      'optimistic-client-submitting',
    ])
  })

  it('settles a late commit onto the cancelled terminal state when cancel raced ahead', () => {
    // cancel 响应先到、submit-turn 的 settle 后到：迟到的 commit 不能把气泡标成 accepted。
    const optimistic = [
      createOptimisticUserMessage({
        clientId: 'client-raced',
        sessionId: 'session-1',
        content: '竞态场景',
        createdAt: '2026-08-18T10:00:00.000Z',
        attachments: [],
      }),
    ]

    const settled = commitCancelledOptimisticUserMessage(optimistic, 'client-raced', 'turn-raced')

    expect(settled).toHaveLength(1)
    expect(settled[0]?.turnId).toBe('turn-raced')
    expect(settled[0]?.message.turnId).toBe('turn-raced')
    expect(settled[0]?.message.deliveryState).toBe('cancelled')
  })
})
