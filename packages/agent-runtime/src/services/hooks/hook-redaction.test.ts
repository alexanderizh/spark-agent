import { describe, expect, it } from 'vitest'
import { isSensitiveKey, redactValue, scrubCredentials } from './hook-redaction.js'

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
