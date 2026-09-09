import { describe, expect, it } from 'vitest'

import {
  resolveSparkModelRoute,
  resolveSparkUpstreamProtocol,
  toSparkEnginePermissionMode,
  toSparkEngineReasoningEffort,
} from '../../sdk/spark-engine/model-route.js'

describe('resolveSparkUpstreamProtocol', () => {
  it('anthropic 渠道 → anthropic-messages', () => {
    expect(resolveSparkUpstreamProtocol('anthropic', undefined)).toEqual({
      ok: true,
      protocol: 'anthropic-messages',
    })
    // codexApiKind 对 anthropic 渠道无影响。
    expect(resolveSparkUpstreamProtocol('anthropic', 'chat')).toEqual({
      ok: true,
      protocol: 'anthropic-messages',
    })
  })

  it('openai 渠道 + responses / 缺省 → openai-responses', () => {
    expect(resolveSparkUpstreamProtocol('openai', 'responses')).toEqual({
      ok: true,
      protocol: 'openai-responses',
    })
    expect(resolveSparkUpstreamProtocol('openai', undefined)).toEqual({
      ok: true,
      protocol: 'openai-responses',
    })
  })

  it('openai 渠道 + chat → 明确拒绝（spark-engine 无 chat/completions 适配器）', () => {
    const result = resolveSparkUpstreamProtocol('openai', 'chat')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('chat/completions')
  })

  it('未知渠道协议 → 拒绝', () => {
    expect(resolveSparkUpstreamProtocol('gemini', undefined).ok).toBe(false)
    expect(resolveSparkUpstreamProtocol(null, undefined).ok).toBe(false)
  })
})

describe('resolveSparkModelRoute', () => {
  const base = {
    apiKey: 'sk-test',
    model: 'gpt-test',
    apiEndpoint: 'https://example.com/v1',
    sparkUpstreamProtocol: 'openai-responses' as const,
  }

  it('完整配置解析出 registerHttp 参数', () => {
    const route = resolveSparkModelRoute(base)
    expect(route).toEqual({
      ok: true,
      protocol: 'openai-responses',
      modelId: 'spark-openai-responses-gpt-test',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
    })
  })

  it('apiEndpoint 空白 → baseUrl undefined（引擎回落官方默认端点）', () => {
    const route = resolveSparkModelRoute({ ...base, apiEndpoint: '  ' })
    expect(route.ok).toBe(true)
    if (route.ok) expect(route.baseUrl).toBeUndefined()
  })

  it('缺协议 / 缺模型 / 缺 key → 明确 reason', () => {
    expect(resolveSparkModelRoute({ ...base, sparkUpstreamProtocol: undefined }).ok).toBe(false)
    expect(resolveSparkModelRoute({ ...base, model: '  ' }).ok).toBe(false)
    expect(resolveSparkModelRoute({ ...base, apiKey: '' }).ok).toBe(false)
  })
})

describe('toSparkEnginePermissionMode', () => {
  it('spark-* 三档字面量映射引擎三模式', () => {
    expect(toSparkEnginePermissionMode('spark-default')).toBe('manual')
    expect(toSparkEnginePermissionMode('spark-auto')).toBe('auto')
    expect(toSparkEnginePermissionMode('spark-bypass')).toBe('bypass')
  })

  it('旧版四档残留与未知值统一回落 manual（最保守档）', () => {
    expect(toSparkEnginePermissionMode('spark-accept-edits')).toBe('manual')
    expect(toSparkEnginePermissionMode('spark-plan')).toBe('manual')
    expect(toSparkEnginePermissionMode('claude-accept-edits')).toBe('manual')
    expect(toSparkEnginePermissionMode(null)).toBe('manual')
    expect(toSparkEnginePermissionMode(undefined)).toBe('manual')
  })
})

describe('toSparkEngineReasoningEffort', () => {
  it('maps host-only levels to Spark equivalents without silently disabling reasoning', () => {
    expect(toSparkEngineReasoningEffort('minimal')).toBe('low')
    expect(toSparkEngineReasoningEffort('xhigh')).toBe('max')
    expect(toSparkEngineReasoningEffort('high')).toBe('high')
    expect(toSparkEngineReasoningEffort(undefined)).toBeUndefined()
  })
})
