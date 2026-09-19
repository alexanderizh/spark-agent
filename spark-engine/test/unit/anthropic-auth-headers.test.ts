import { describe, expect, it } from 'vitest'
import { anthropicAuthHeaders } from '../../src/llm/anthropic/auth-headers.js'

describe('anthropicAuthHeaders', () => {
  it('第三方端点同时投放 x-api-key 与 Bearer', () => {
    expect(anthropicAuthHeaders('https://api.stepfun.com/step_plan', 'ep-xxx')).toEqual({
      'x-api-key': 'ep-xxx',
      authorization: 'Bearer ep-xxx',
    })
  })

  it('默认端点（未配置 baseUrl）只投放 x-api-key', () => {
    expect(anthropicAuthHeaders(undefined, 'sk-ant-api03-x')).toEqual({
      'x-api-key': 'sk-ant-api03-x',
    })
  })

  it('官方端点上的 OAuth 风格 token 走 Bearer', () => {
    expect(anthropicAuthHeaders('https://api.anthropic.com', 'sk-ant-oat01-x')).toEqual({
      authorization: 'Bearer sk-ant-oat01-x',
    })
  })
})
