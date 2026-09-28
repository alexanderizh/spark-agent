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

describe('fullUrl 开关（完整 URL 渠道）', () => {
  it('resolveAnthropicMessagesUrl 原样返回，不做任何拼裁', () => {
    expect(
      resolveAnthropicMessagesUrl('https://gw.example.com/api/coding/v3/messages', {
        fullUrl: true,
      }),
    ).toBe('https://gw.example.com/api/coding/v3/messages')
    // 标准完整形态同样原样
    expect(
      resolveAnthropicMessagesUrl('https://api.stepfun.com/step_plan/v1/messages', {
        fullUrl: true,
      }),
    ).toBe('https://api.stepfun.com/step_plan/v1/messages')
    // 仅去空白与尾部斜杠
    expect(
      resolveAnthropicMessagesUrl('  https://gw.example.com/api/v3/messages/  ', {
        fullUrl: true,
      }),
    ).toBe('https://gw.example.com/api/v3/messages')
  })

  it('resolveAnthropicBaseUrl 仅摘标准 /v1/messages 尾缀，非标版本段保留', () => {
    // SDK 需要 base 且固定追加 /v1/messages：标准完整形态摘掉尾缀自洽
    expect(
      resolveAnthropicBaseUrl('https://api.stepfun.com/step_plan/v1/messages', { fullUrl: true }),
    ).toBe('https://api.stepfun.com/step_plan')
    // 非标尾缀原样（SDK 会拼成 …/v3/v1/messages，此类渠道须用 Spark 引擎原样直连）
    expect(resolveAnthropicBaseUrl('https://gw.example.com/api/coding/v3/messages', {
      fullUrl: true,
    })).toBe('https://gw.example.com/api/coding/v3/messages')
    // 根地址不摘版本段（区别于默认逻辑）
    expect(resolveAnthropicBaseUrl('https://openrouter.ai/api/v1', { fullUrl: true })).toBe(
      'https://openrouter.ai/api/v1',
    )
  })

  it('未开启 fullUrl 时行为与旧逻辑完全一致', () => {
    expect(resolveAnthropicBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api')
    expect(resolveAnthropicMessagesUrl('https://gw.example.com/api/v3/messages')).toBe(
      'https://gw.example.com/api/v3/v1/messages',
    )
    expect(resolveAnthropicMessagesUrl('https://gw.example.com/api/v3/messages', {})).toBe(
      'https://gw.example.com/api/v3/v1/messages',
    )
  })
})
