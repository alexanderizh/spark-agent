import { describe, expect, it } from 'vitest'

import {
  SPARK_EXECUTOR_UNAVAILABLE_HINTS,
  sparkExecutorAvailability,
} from './sparkExecutorAvailability'

describe('sparkExecutorAvailability', () => {
  it('anthropic 渠道一律可用', () => {
    expect(sparkExecutorAvailability('anthropic', undefined)).toEqual({ available: true })
    expect(sparkExecutorAvailability('anthropic', 'chat')).toEqual({ available: true })
    expect(sparkExecutorAvailability('anthropic', null)).toEqual({ available: true })
  })

  it('openai + responses 可用', () => {
    expect(sparkExecutorAvailability('openai', 'responses')).toEqual({ available: true })
  })

  it('openai 渠道未写 codexApiKind 时按 responses 口径可用（与引擎侧一致）', () => {
    expect(sparkExecutorAvailability('openai', undefined)).toEqual({ available: true })
    expect(sparkExecutorAvailability('openai', null)).toEqual({ available: true })
  })

  it('openai + chat 不可用并给出提示文案', () => {
    const result = sparkExecutorAvailability('openai', 'chat')
    expect(result).toEqual({ available: false, reason: 'chat-completions-openai' })
    if (!result.available) {
      expect(SPARK_EXECUTOR_UNAVAILABLE_HINTS[result.reason].length).toBeGreaterThan(0)
    }
  })

  it('openai + embedding 不可用', () => {
    expect(sparkExecutorAvailability('openai', 'embedding')).toEqual({
      available: false,
      reason: 'chat-completions-openai',
    })
  })
})
