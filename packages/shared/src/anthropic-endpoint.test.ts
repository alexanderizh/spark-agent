import { describe, expect, it } from 'vitest'
import {
  normalizeAnthropicEndpoint,
  resolveAnthropicBaseUrl,
  resolveAnthropicMessagesUrl,
} from './anthropic-endpoint.js'

describe('resolveAnthropicBaseUrl', () => {
  it('裸根地址原样返回（claude CLI 文档写法）', () => {
    expect(resolveAnthropicBaseUrl('https://api.stepfun.com/step_plan')).toBe(
      'https://api.stepfun.com/step_plan',
    )
    expect(resolveAnthropicBaseUrl('https://open.bigmodel.cn/api/anthropic')).toBe(
      'https://open.bigmodel.cn/api/anthropic',
    )
  })

  it('完整 messages 地址摘掉 /v1/messages，避免 SDK 二次拼接（实测 404 的成因）', () => {
    expect(resolveAnthropicBaseUrl('https://api.stepfun.com/step_plan/v1/messages')).toBe(
      'https://api.stepfun.com/step_plan',
    )
    // 幂等：归一化结果再归一化不变
    expect(
      resolveAnthropicBaseUrl(
        resolveAnthropicBaseUrl('https://api.stepfun.com/step_plan/v1/messages'),
      ),
    ).toBe('https://api.stepfun.com/step_plan')
  })

  it('摘掉末尾版本段，OpenRouter 风格 /api/v1 也能得到正确根地址', () => {
    expect(resolveAnthropicBaseUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api',
    )
    expect(resolveAnthropicBaseUrl('https://gw.example.com/v2')).toBe('https://gw.example.com')
  })

  it('处理裸 /messages 后缀、尾斜杠与首尾空白', () => {
    expect(resolveAnthropicBaseUrl('  https://gw.example.com/messages/  ')).toBe(
      'https://gw.example.com',
    )
    expect(resolveAnthropicBaseUrl('https://gw.example.com///')).toBe('https://gw.example.com')
  })

  it('未配置端点回落官方默认根地址', () => {
    expect(resolveAnthropicBaseUrl(undefined)).toBe('https://api.anthropic.com')
    expect(resolveAnthropicBaseUrl('   ')).toBe('https://api.anthropic.com')
    expect(resolveAnthropicBaseUrl('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com',
    )
  })
})

describe('resolveAnthropicMessagesUrl', () => {
  it('三种写法都归一化为同一个直连地址', () => {
    const expected = 'https://api.stepfun.com/step_plan/v1/messages'
    expect(resolveAnthropicMessagesUrl('https://api.stepfun.com/step_plan')).toBe(expected)
    expect(resolveAnthropicMessagesUrl('https://api.stepfun.com/step_plan/v1')).toBe(expected)
    expect(resolveAnthropicMessagesUrl('https://api.stepfun.com/step_plan/v1/messages')).toBe(
      expected,
    )
  })

  it('未配置端点得到官方 messages 地址', () => {
    expect(resolveAnthropicMessagesUrl(undefined)).toBe('https://api.anthropic.com/v1/messages')
  })
})

describe('normalizeAnthropicEndpoint', () => {
  it('只做空白与尾斜杠归一化，不改路径', () => {
    expect(normalizeAnthropicEndpoint(' https://gw.example.com/v1/messages/ ')).toBe(
      'https://gw.example.com/v1/messages',
    )
  })
})
