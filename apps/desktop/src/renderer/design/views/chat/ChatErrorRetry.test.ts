import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import {
  ERROR_CONTINUE_INSTRUCTION,
  buildErrorContinuePayload,
  buildErrorRetryPayload,
  buildMessageErrorContinuePayload,
  buildTurnRetryPayload,
  turnHasSubstantiveOutput,
} from './ChatErrorRetry'

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

  it('re-opens manual retry when the auto-redispatched turn itself terminally failed', () => {
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
        blocks: [
          { kind: 'error', code: 'HTTP_429', message: 'rate limited', retryable: true },
          {
            kind: 'runtime_signal',
            signal: 'executor_failover',
            level: 'info',
            title: '自动路由已切换执行模型',
            message: '正在自动改派其他健康执行模型重试',
            retryable: true,
          },
        ],
        usage: null,
        eventIds: ['assistant-error'],
      },
      {
        // 重派发轮（投影后：隐藏用户消息被过滤，assistant 带来源标记）自身也失败
        id: 'assistant-redispatch-error',
        turnId: 'turn-2',
        role: 'assistant',
        status: 'error',
        turnSource: 'auto_router_redispatch',
        userMessageVisibility: 'hidden',
        blocks: [{ kind: 'error', code: 'HTTP_500', message: 'backup down', retryable: true }],
        usage: null,
        eventIds: ['assistant-redispatch-error'],
      },
    ]

    // 自动重试已耗尽：原错误卡的手动重试重新开放，载荷还原原文
    expect(buildErrorRetryPayload(messages, 1)?.text).toBe('run the report')

    // 重派发轮自身的错误卡：从原用户消息还原重试载荷（seed 即原文）
    expect(buildErrorRetryPayload(messages, 2)?.text).toBe('run the report')

    // 队列恢复路径同样能还原（重派发轮的 failedTurnId → 原文）
    expect(buildTurnRetryPayload(messages, 'turn-2')?.text).toBe('run the report')
  })

  it('keeps retry suppressed while the redispatched turn is still running', () => {
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
        blocks: [
          { kind: 'error', code: 'HTTP_429', message: 'rate limited', retryable: true },
          {
            kind: 'runtime_signal',
            signal: 'executor_failover',
            level: 'info',
            title: '自动路由已切换执行模型',
            message: '正在自动改派其他健康执行模型重试',
            retryable: true,
          },
        ],
        usage: null,
        eventIds: ['assistant-error'],
      },
      {
        // 重派发轮进行中（无终态错误块）：抑制保持，防双执行
        id: 'assistant-redispatch-running',
        turnId: 'turn-2',
        role: 'assistant',
        status: 'streaming',
        turnSource: 'auto_router_redispatch',
        blocks: [{ kind: 'text', content: 'partial', isStreaming: true }],
        usage: null,
        eventIds: ['assistant-redispatch-running'],
      },
    ]

    expect(buildErrorRetryPayload(messages, 1)).toBeNull()
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

describe('buildErrorContinuePayload', () => {
  const failedUserTurn = [
    uiMessage({
      id: 'user-1',
      turnId: 'turn-failed',
      role: 'user',
      blocks: [{ kind: 'text', content: '原始任务', isStreaming: false }],
      attachments: [{ type: 'file', path: '/tmp/spec.md' }],
    }),
  ]

  function failedAssistant(
    blocks: UIMessage['blocks'],
    extra: Partial<UIMessage> = {},
  ): UIMessage {
    return uiMessage({
      id: 'assistant-1',
      turnId: 'turn-failed',
      role: 'assistant',
      status: 'error',
      blocks: [
        ...blocks,
        { kind: 'error', code: 'HTTP_500', message: 'upstream down', retryable: true },
      ],
      ...extra,
    })
  }

  it('有非空文本产出 → 发送继续指令，且不带失败轮附件与会话引用', () => {
    const messages = [
      ...failedUserTurn,
      failedAssistant([{ kind: 'text', content: '  已完成一半  ', isStreaming: false }]),
    ]

    expect(buildErrorContinuePayload(messages, 'turn-failed')).toEqual({
      text: ERROR_CONTINUE_INSTRUCTION,
      attachments: [],
    })
    expect(JSON.stringify(buildErrorContinuePayload(messages, 'turn-failed'))).not.toContain(
      'sessionReferences',
    )
  })

  it('有工具调用 / 文件变更产出（无文本）→ 发送继续指令', () => {
    const toolOnly = [
      ...failedUserTurn,
      failedAssistant([
        {
          kind: 'tool_call',
          toolCallId: 'tool-1',
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          status: 'success',
          output: 'ok',
          error: undefined,
          durationMs: 12,
        },
      ]),
    ]
    expect(buildErrorContinuePayload(toolOnly, 'turn-failed')?.text).toBe(
      ERROR_CONTINUE_INSTRUCTION,
    )

    const fileChangeOnly = [
      ...failedUserTurn,
      failedAssistant([
        { kind: 'file_change', changeType: 'modify', path: '/tmp/a.ts', diff: '+1 -1' },
      ]),
    ]
    expect(buildErrorContinuePayload(fileChangeOnly, 'turn-failed')?.text).toBe(
      ERROR_CONTINUE_INSTRUCTION,
    )
  })

  it('无产出（错误在首 token 前失败）→ 返回 null 回落原消息重发', () => {
    const messages = [...failedUserTurn, failedAssistant([])]

    expect(buildErrorContinuePayload(messages, 'turn-failed')).toBeNull()
    // 回落路径仍可用：原消息重发载荷不受智能重试影响。
    expect(buildTurnRetryPayload(messages, 'turn-failed')?.text).toBe('原始任务')
  })

  it('纯空白文本与引擎压缩承接摘要不算产出', () => {
    const whitespaceOnly = [
      ...failedUserTurn,
      failedAssistant([{ kind: 'text', content: '   \n  ', isStreaming: false }]),
    ]
    expect(turnHasSubstantiveOutput(whitespaceOnly, 'turn-failed')).toBe(false)

    const compactSummaryOnly = [
      ...failedUserTurn,
      failedAssistant([
        {
          kind: 'text',
          content:
            'This session is being continued from a previous conversation that ran out of context.',
          isStreaming: false,
        },
      ]),
    ]
    expect(turnHasSubstantiveOutput(compactSummaryOnly, 'turn-failed')).toBe(false)
    expect(buildErrorContinuePayload(compactSummaryOnly, 'turn-failed')).toBeNull()
  })

  it('同轮多条 assistant 消息任一有产出即算（团队模式多气泡）', () => {
    const messages = [
      ...failedUserTurn,
      uiMessage({
        id: 'assistant-member',
        turnId: 'turn-failed',
        role: 'assistant',
        status: 'error',
        agentId: 'member-1',
        blocks: [
          { kind: 'text', content: '   ', isStreaming: false },
          { kind: 'error', code: 'HTTP_500', message: 'upstream down', retryable: true },
        ],
      }),
      failedAssistant(
        [
          { kind: 'file_change', changeType: 'create', path: '/tmp/out.md', diff: '+3' },
        ],
        { id: 'assistant-host' },
      ),
    ]

    expect(turnHasSubstantiveOutput(messages, 'turn-failed')).toBe(true)
    expect(buildErrorContinuePayload(messages, 'turn-failed')?.text).toBe(
      ERROR_CONTINUE_INSTRUCTION,
    )
  })

  it('failedTurnId 缺失或无匹配轮次 → 返回 null', () => {
    expect(buildErrorContinuePayload(failedUserTurn, undefined)).toBeNull()
    expect(buildErrorContinuePayload(failedUserTurn, '')).toBeNull()
    expect(buildErrorContinuePayload(failedUserTurn, 'turn-other')).toBeNull()
  })
})

describe('buildMessageErrorContinuePayload', () => {
  const userTurn = [
    uiMessage({
      id: 'user-1',
      turnId: 'turn-failed',
      role: 'user',
      blocks: [{ kind: 'text', content: '原始任务', isStreaming: false }],
    }),
  ]

  function failedAssistant(blocks: UIMessage['blocks'], extra: Partial<UIMessage> = {}): UIMessage {
    return uiMessage({
      id: 'assistant-1',
      turnId: 'turn-failed',
      role: 'assistant',
      status: 'error',
      blocks: [
        ...blocks,
        { kind: 'error', code: 'HTTP_500', message: 'upstream down', retryable: true },
      ],
      ...extra,
    })
  }

  it('错误卡 + 有实质产出 → 返回继续指令载荷', () => {
    const messages = [
      ...userTurn,
      failedAssistant([{ kind: 'text', content: '完成一半', isStreaming: false }]),
    ]
    expect(buildMessageErrorContinuePayload(messages, 1)?.text).toBe(ERROR_CONTINUE_INSTRUCTION)
  })

  it('无实质产出 → 返回 null（错误卡回落「重新尝试」）', () => {
    const messages = [...userTurn, failedAssistant([])]
    expect(buildMessageErrorContinuePayload(messages, 1)).toBeNull()
  })

  it('自动改派进行中（executor_failover info）→ 抑制续跑防双执行', () => {
    const messages = [
      ...userTurn,
      failedAssistant([
        { kind: 'text', content: '完成一半', isStreaming: false },
        {
          kind: 'runtime_signal',
          signal: 'executor_failover',
          level: 'info',
          title: '自动路由已切换执行模型',
          message: '正在自动改派其他健康执行模型重试',
          retryable: true,
        },
      ]),
    ]
    expect(buildMessageErrorContinuePayload(messages, 1)).toBeNull()
  })

  it('重派发轮已启动且未失败 → 抑制续跑防双执行', () => {
    const messages = [
      ...userTurn,
      failedAssistant([{ kind: 'text', content: '完成一半', isStreaming: false }]),
      uiMessage({
        id: 'assistant-redispatch-running',
        turnId: 'turn-2',
        role: 'assistant',
        status: 'streaming',
        turnSource: 'auto_router_redispatch',
        blocks: [{ kind: 'text', content: 'partial', isStreaming: true }],
      }),
    ]
    expect(buildMessageErrorContinuePayload(messages, 1)).toBeNull()
  })

  it('隐藏内部轮（goal 迭代）有产出 → 重发不可用但继续指令仍可用', () => {
    const messages = [
      uiMessage({
        id: 'user-hidden',
        turnId: 'turn-internal',
        role: 'user',
        turnSource: 'goal_iteration',
        userMessageVisibility: 'hidden',
        blocks: [{ kind: 'text', content: 'internal prompt', isStreaming: false }],
      }),
      failedAssistant(
        [{ kind: 'file_change', changeType: 'create', path: '/tmp/out.md', diff: '+3' }],
        { id: 'assistant-internal', turnId: 'turn-internal' },
      ),
    ]
    // 重发载荷不可还原（隐藏轮不暴露原文），但已有产出可以安全续跑
    expect(buildErrorRetryPayload(messages, 1)).toBeNull()
    expect(buildMessageErrorContinuePayload(messages, 1)?.text).toBe(ERROR_CONTINUE_INSTRUCTION)
  })
})
