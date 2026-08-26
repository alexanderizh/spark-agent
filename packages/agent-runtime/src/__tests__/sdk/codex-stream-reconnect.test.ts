import { describe, expect, it } from 'vitest'

import {
  createStreamReconnectSignal,
  matchCodexStreamReconnect,
} from '../../sdk/codex-stream-reconnect.js'

const base = {
  id: 'event-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  timestamp: '2026-08-27T00:00:00.000Z',
  seq: 1,
}

describe('matchCodexStreamReconnect', () => {
  it.each([
    ['Reconnecting... 1/5', { attempt: 1, maxAttempts: 5, reason: null }],
    ['reconnecting... 3/5', { attempt: 3, maxAttempts: 5, reason: null }],
    [
      'Reconnecting... 2/5 (stream disconnected before completion: connection closed)',
      { attempt: 2, maxAttempts: 5, reason: 'stream disconnected before completion: connection closed' },
    ],
    // reason 内允许嵌套括号（贪婪捕获，最后一个右括号作为收尾）
    [
      'Reconnecting... 4/5 (stream disconnected before completion: error (ETIMEDOUT))',
      { attempt: 4, maxAttempts: 5, reason: 'stream disconnected before completion: error (ETIMEDOUT)' },
    ],
    ['  Reconnecting... 5/5 (transient)  ', { attempt: 5, maxAttempts: 5, reason: 'transient' }],
  ] as const)('matches %s', (message, expected) => {
    expect(matchCodexStreamReconnect(message)).toEqual(expected)
  })

  it.each([
    // 重试耗尽的最终失败不带该前缀，必须继续按错误透传
    ['exceeded retry limit, last status: 429 Too Many Requests'],
    ['stream disconnected before completion: connection closed'],
    ['Reconnecting... 0/5'],
    // attempt > maxAttempts 非法
    ['Reconnecting... 6/5'],
    ['Reconnecting... /5'],
    ['Reconnecting...'],
    [''],
  ])('rejects %j', (message) => {
    expect(matchCodexStreamReconnect(message)).toBeNull()
  })
})

describe('createStreamReconnectSignal', () => {
  it('builds an info runtime_signal with retry progress details', () => {
    const signal = createStreamReconnectSignal(
      'Reconnecting... 2/5 (stream disconnected)',
      base,
    )
    expect(signal).not.toBeNull()
    expect(signal).toMatchObject({
      ...base,
      type: 'runtime_signal',
      signal: 'stream_reconnect',
      level: 'info',
      title: '网络连接中断，正在自动重连',
      message: 'Reconnecting... 2/5 (stream disconnected)',
      code: 'CODEX_STREAM_RECONNECT',
      retryable: false,
      details: [{ label: '重试进度', value: '2/5' }],
    })
  })

  it('returns null for non-reconnect messages so callers keep the original error path', () => {
    expect(createStreamReconnectSignal('exceeded retry limit, last status: 429', base)).toBeNull()
  })
})
