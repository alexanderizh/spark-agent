import { describe, expect, it } from 'vitest'
import {
  FULL_CONTENT_BOUNDS,
  isSensitiveKey,
  redactValue,
  scrubCredentials,
} from './hook-redaction.js'

/** 内容级凭据掩码（审查 S1：键控掩码只对对象键生效，字符串正文曾原样保留）。 */
describe('scrubCredentials', () => {
  it('masks common credential tokens in plain strings', () => {
    expect(scrubCredentials('api_key is sk-abcdef0123456789abcdef done')).toBe(
      'api_key is *** done',
    )
    expect(scrubCredentials('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
      'Authorization: ***',
    )
    expect(scrubCredentials('leaked AWS key AKIAIOSFODNN7EXAMPLE')).toBe('leaked AWS key ***')
    expect(scrubCredentials('gh token ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toBe(
      'gh token ***',
    )
    expect(scrubCredentials('slack xoxb-123456789012-1234567890123-abcdef')).toBe('slack ***')
    expect(scrubCredentials('remote said: {"error":"invalid api_key=sk-secret1234567890"}')).toBe(
      'remote said: {"error":"invalid ***"}',
    )
  })

  it('keeps ordinary text intact (no over-masking)', () => {
    expect(scrubCredentials('Remote tool package HTTP 500 Internal Server Error')).toBe(
      'Remote tool package HTTP 500 Internal Server Error',
    )
    // 短值（<12 字符）不按 key=value 凭据处理
    expect(scrubCredentials('password: short')).toBe('password: short')
    expect(scrubCredentials('token 使用已过期')).toBe('token 使用已过期')
  })

  it('scrubs within the window and leaves the tail untouched (tail is truncated away by callers)', () => {
    const head = 'x'.repeat(1000)
    const text = `${head} sk-abcdef0123456789abcdef tail-of-nothing`
    const scrubbed = scrubCredentials(text)
    expect(scrubbed).not.toContain('sk-abcdef0123456789abcdef')
    expect(scrubbed.endsWith('tail-of-nothing')).toBe(true)
  })
})

describe('redactValue string branch applies content scrubbing', () => {
  it('error message strings carrying credentials are masked before persistence', () => {
    const redacted = redactValue(
      'Remote tool package HTTP 401 Unauthorized: {"error":"bad token sk-abcdef0123456789abcdef"}',
    )
    expect(redacted).toBe('Remote tool package HTTP 401 Unauthorized: {"error":"bad token ***"}')
  })

  it('key-based masking still takes precedence for sensitive keys', () => {
    expect(redactValue({ api_key: 'whatever' })).toEqual({ api_key: '***' })
    expect(isSensitiveKey('Authorization')).toBe(true)
    expect(isSensitiveKey('content')).toBe(false)
  })

  it('truncation still applies after scrubbing', () => {
    const long = `${'a'.repeat(600)} sk-abcdef0123456789abcdef`
    const redacted = redactValue(long)
    expect(typeof redacted).toBe('string')
    expect(redacted as string).toContain('…[truncated]')
    expect(redacted as string).not.toContain('sk-abcdef0123456789abcdef')
  })
})

/** FULL_CONTENT_BOUNDS（审计载荷路径）：正文完整保留，凭据掩码窗口放宽到全文。 */
describe('redactValue bounds', () => {
  it('FULL_CONTENT_BOUNDS keeps long strings intact and scrubs credentials in full', () => {
    const filler = 'x'.repeat(2000)
    const long = `${filler} tail sk-abcdef0123456789abcdef`
    const redacted = redactValue(long, 0, FULL_CONTENT_BOUNDS)
    expect(typeof redacted).toBe('string')
    expect(redacted as string).not.toContain('…[truncated]')
    expect((redacted as string).endsWith('tail ***')).toBe(true)
    // 长度 = 原文 − 凭据 + 掩码（全文保留的直接证据）
    expect((redacted as string).length).toBe(long.length - 25 + 3)
  })

  it('FULL_CONTENT_BOUNDS keeps wide/deep structures intact', () => {
    const big = {
      items: Array.from({ length: 100 }, (_, i) => ({ idx: i, note: 'n'.repeat(600) })),
    }
    const redacted = redactValue(big, 0, FULL_CONTENT_BOUNDS) as typeof big
    expect(redacted.items).toHaveLength(100)
    expect(redacted.items[0]?.note).toHaveLength(600)
    expect('[truncated]' in (redacted as Record<string, unknown>)).toBe(false)
  })

  it('summary defaults stay bounded (hooks 摘要路径不受载荷放宽影响)', () => {
    // 数组超限：静默切片到 64（与既有契约一致，无数组级标记）
    const wide = { items: Array.from({ length: 100 }, (_, i) => i) }
    const sliced = redactValue(wide) as { items: number[] }
    expect(sliced.items).toHaveLength(64)
    // 对象键超限：置 [truncated] 标记
    const manyKeys: Record<string, number> = {}
    for (let i = 0; i < 70; i += 1) manyKeys[`k${i}`] = i
    const marked = redactValue(manyKeys) as Record<string, unknown>
    expect(Object.keys(marked)).toHaveLength(65) // 64 条目 + [truncated] 标记键
    expect(marked['[truncated]']).toBe(true)
    // 同结构在 FULL_CONTENT_BOUNDS 下完整保留
    const full = redactValue(manyKeys, 0, FULL_CONTENT_BOUNDS) as Record<string, unknown>
    expect(Object.keys(full)).toHaveLength(70)
    expect('[truncated]' in full).toBe(false)
  })
})
