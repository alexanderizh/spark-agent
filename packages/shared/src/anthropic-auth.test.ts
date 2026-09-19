import { describe, expect, it } from 'vitest'
import {
  buildAnthropicAuthEnv,
  buildAnthropicAuthHeaders,
  isOfficialAnthropicEndpoint,
  resolveAnthropicAuthMode,
} from './anthropic-auth.js'

describe('isOfficialAnthropicEndpoint', () => {
  it('端点为空按官方默认端点处理', () => {
    expect(isOfficialAnthropicEndpoint(undefined)).toBe(true)
    expect(isOfficialAnthropicEndpoint('   ')).toBe(true)
  })

  it('识别官方与 staging 域名', () => {
    expect(isOfficialAnthropicEndpoint('https://api.anthropic.com')).toBe(true)
    expect(isOfficialAnthropicEndpoint('https://api-staging.anthropic.com/v1')).toBe(true)
    expect(isOfficialAnthropicEndpoint('anthropic.com')).toBe(true)
  })

  it('第三方与子路径端点不算官方', () => {
    expect(isOfficialAnthropicEndpoint('https://api.stepfun.com/step_plan')).toBe(false)
    expect(isOfficialAnthropicEndpoint('https://open.bigmodel.cn/api/anthropic')).toBe(false)
    expect(isOfficialAnthropicEndpoint('https://anthropic.example.com')).toBe(false)
  })

  it('无法解析的端点按第三方处理', () => {
    expect(isOfficialAnthropicEndpoint('not a url://')).toBe(false)
  })
})

describe('resolveAnthropicAuthMode', () => {
  it('官方端点用 API Key（x-api-key）', () => {
    expect(resolveAnthropicAuthMode('https://api.anthropic.com', 'sk-ant-api03-x')).toBe('api-key')
    expect(resolveAnthropicAuthMode(undefined, 'sk-ant-api03-x')).toBe('api-key')
  })

  it('官方端点上的 OAuth 风格 token 走 Bearer', () => {
    expect(resolveAnthropicAuthMode('https://api.anthropic.com', 'sk-ant-oat01-x')).toBe(
      'auth-token',
    )
  })

  it('第三方端点双投放，覆盖只认其中一种的渠道', () => {
    expect(resolveAnthropicAuthMode('https://api.stepfun.com/step_plan', 'ep-xxx')).toBe('dual')
    expect(resolveAnthropicAuthMode('https://gw.example.com', 'sk-ant-api03-x')).toBe('dual')
  })

  it('空 key 回落到单 API Key 槽位', () => {
    expect(resolveAnthropicAuthMode('https://api.stepfun.com/step_plan', '')).toBe('api-key')
  })
})

describe('buildAnthropicAuthHeaders', () => {
  it('第三方端点同时返回 x-api-key 与 Bearer', () => {
    expect(buildAnthropicAuthHeaders('https://api.stepfun.com/step_plan', 'ep-xxx')).toEqual({
      'x-api-key': 'ep-xxx',
      authorization: 'Bearer ep-xxx',
    })
  })

  it('官方端点只返回 x-api-key', () => {
    expect(buildAnthropicAuthHeaders('https://api.anthropic.com', 'sk-ant-api03-x')).toEqual({
      'x-api-key': 'sk-ant-api03-x',
    })
  })

  it('官方端点上的 OAuth token 只返回 Bearer', () => {
    expect(buildAnthropicAuthHeaders('https://api.anthropic.com', 'sk-ant-oat01-x')).toEqual({
      authorization: 'Bearer sk-ant-oat01-x',
    })
  })
})

describe('buildAnthropicAuthEnv', () => {
  it('第三方端点同时注入两个环境变量', () => {
    expect(buildAnthropicAuthEnv('https://api.stepfun.com/step_plan', 'ep-xxx')).toEqual({
      ANTHROPIC_API_KEY: 'ep-xxx',
      ANTHROPIC_AUTH_TOKEN: 'ep-xxx',
    })
  })

  it('官方端点只注入 ANTHROPIC_API_KEY', () => {
    expect(buildAnthropicAuthEnv('https://api.anthropic.com', 'sk-ant-api03-x')).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-api03-x',
    })
  })

  it('默认端点（未配置）只注入 ANTHROPIC_API_KEY', () => {
    expect(buildAnthropicAuthEnv(undefined, 'sk-ant-api03-x')).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-api03-x',
    })
  })

  it('空 key 不制造空的 Bearer 凭据', () => {
    expect(buildAnthropicAuthEnv('https://api.stepfun.com/step_plan', '')).toEqual({
      ANTHROPIC_API_KEY: '',
    })
  })
})
