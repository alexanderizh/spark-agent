import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { buildErrorRetryPayload, buildTurnRetryPayload } from './ChatErrorRetry'

function uiMessage(
  patch: Partial<UIMessage> & Pick<UIMessage, 'id' | 'role' | 'blocks'>,
): UIMessage {
  return {
    status: 'completed',
    usage: null,
    eventIds: [],
    ...patch,
  }
}

describe('buildErrorRetryPayload', () => {
  it('reuses the nearest preceding user message for retryable failures', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'retry this', isStreaming: false }],
        attachments: [{ type: 'file', path: '/tmp/input.txt', name: 'input.txt' }],
        usage: null,
        eventIds: ['user-1'],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        status: 'error',
        blocks: [
          {
            kind: 'error',
            code: 'CLAUDE_OVERLOADED',
            message: 'busy',
            retryable: true,
          },
        ],
        usage: null,
        eventIds: ['assistant-1'],
      },
    ]

    expect(buildErrorRetryPayload(messages, 1)).toEqual({
      text: 'retry this',
      attachments: [{ type: 'file', path: '/tmp/input.txt', name: 'input.txt' }],
    })
  })

  it('does not reuse an earlier visible user turn for a hidden internal turn failure', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-visible',
        turnId: 'turn-visible',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'do not retry this', isStreaming: false }],
        usage: null,
        eventIds: ['user-visible'],
      },
      {
        id: 'user-hidden',
        turnId: 'turn-internal',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'internal prompt', isStreaming: false }],
        usage: null,
        eventIds: ['user-hidden'],
        turnSource: 'goal_iteration',
        userMessageVisibility: 'hidden',
      },
      {
        id: 'assistant-error',
        turnId: 'turn-internal',
        role: 'assistant',
        status: 'error',
        blocks: [{ kind: 'error', code: 'FAILED', message: 'failed', retryable: true }],
        usage: null,
        eventIds: ['assistant-error'],
      },
    ]

    expect(buildErrorRetryPayload(messages, 2)).toBeNull()
  })

  it('does not offer manual retry for a turn already auto-redispatched by auto-router', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        turnId: 'turn-1',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'run the report', isStreaming: false }],
        usage: null,
        eventIds: ['user-1'],
      },
      {
        id: 'assistant-error',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'error',
        blocks: [{ kind: 'error', code: 'HTTP_429', message: 'rate limited', retryable: true }],
        usage: null,
        eventIds: ['assistant-error'],
      },
      {
        // auto-router 故障切换重派发轮（隐藏用户消息）：说明 runtime 已自动重跑
        id: 'user-redispatch',
        turnId: 'turn-2',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'run the report', isStreaming: false }],
        usage: null,
        eventIds: ['user-redispatch'],
        turnSource: 'auto_router_redispatch',
        userMessageVisibility: 'hidden',
      },
    ]

    // 手动重试会与自动重跑双执行（重复计费），必须不生成重试载荷
    expect(buildErrorRetryPayload(messages, 1)).toBeNull()
  })

  it('executor_failover info signal on the failed turn blocks manual retry immediately', () => {
    const base = [
      {
        id: 'user-1',
        turnId: 'turn-1',
        role: 'user' as const,
        status: 'completed' as const,
        blocks: [{ kind: 'text' as const, content: 'run it', isStreaming: false }],
        usage: null,
        eventIds: ['user-1'],
      },
    ]
    // info 级 = runtime 已武装自动改派：重试按钮立即失效（早于重派发轮启动）
    const armed = [
      ...base,
      {
        id: 'assistant-error',
        turnId: 'turn-1',
        role: 'assistant' as const,
        status: 'error' as const,
        blocks: [
          {
            kind: 'runtime_signal' as const,
            signal: 'executor_failover',
            level: 'info' as const,
            title: '自动路由已切换执行模型',
            message: '正在自动改派其他健康执行模型重试',
            retryable: true,
          },
        ],
        usage: null,
        eventIds: ['assistant-error'],
      },
    ]
    expect(buildErrorRetryPayload(armed as UIMessage[], 1)).toBeNull()

    // warning 级 = 仅冻结提示，无自动重跑：手动重试保留
    const frozenOnly = [
      ...base,
      {
        id: 'assistant-error',
        turnId: 'turn-1',
        role: 'assistant' as const,
        status: 'error' as const,
        blocks: [
          {
            kind: 'runtime_signal' as const,
            signal: 'executor_failover',
            level: 'warning' as const,
            title: '自动路由执行模型已短期冻结',
            message: '已冻结 5 分钟',
            retryable: true,
          },
        ],
        usage: null,
        eventIds: ['assistant-error'],
      },
    ]
    expect(buildErrorRetryPayload(frozenOnly as UIMessage[], 1)?.text).toBe('run it')
  })
})

describe('buildTurnRetryPayload', () => {
  it('restores the failed turn with attachments and session references', () => {
    const messages = [
      uiMessage({
        id: 'user-1',
        turnId: 'turn-failed',
        role: 'user',
        blocks: [{ kind: 'text', content: 'retry me', isStreaming: false }],
        attachments: [{ type: 'file', path: '/tmp/spec.md' }],
        sessionReferences: [
          { sourceSessionId: 'session-source', title: 'Source', snapshotSeq: 12 },
        ],
      }),
    ]

    expect(buildTurnRetryPayload(messages, 'turn-failed')).toEqual({
      text: 'retry me',
      attachments: [{ type: 'file', path: '/tmp/spec.md' }],
      sessionReferences: [{ sourceSessionId: 'session-source', title: 'Source', snapshotSeq: 12 }],
    })
  })

  it('does not expose hidden internal turn payloads', () => {
    const messages = [
      uiMessage({
        id: 'user-hidden',
        turnId: 'turn-hidden',
        role: 'user',
        userMessageVisibility: 'hidden',
        blocks: [{ kind: 'text', content: 'internal prompt', isStreaming: false }],
      }),
    ]

    expect(buildTurnRetryPayload(messages, 'turn-hidden')).toBeNull()
  })

  it('does not retry a remote-origin turn through the local composer', () => {
    const messages = [
      uiMessage({
        id: 'remote-user',
        turnId: 'turn-remote',
        role: 'user',
        turnSource: 'remote_user',
        blocks: [{ kind: 'text', content: '【远程 Telegram 会话】内部提示', isStreaming: false }],
      }),
    ]
    expect(buildTurnRetryPayload(messages, 'turn-remote')).toBeNull()
  })
})
