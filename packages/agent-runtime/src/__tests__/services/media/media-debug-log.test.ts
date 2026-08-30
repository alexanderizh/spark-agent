import { describe, expect, it } from 'vitest'
import {
  compactForLog,
  redactPrivateContentForLog,
  sanitizeUrlForLog,
} from '../../../services/media/media-debug-log.js'

describe('compactForLog', () => {
  it('summarizes data URLs and bare base64 without retaining their full payloads', () => {
    const payload = 'aGVsbG8td29ybGQ='.repeat(20)
    const result = compactForLog({
      image: `data:image/png;base64,${payload}`,
      b64_json: payload,
    }) as Record<string, string>

    expect(result.image).toContain('[base64 mime=image/png')
    expect(result.b64_json).toContain('[base64')
    expect(result.image).not.toContain(payload)
    expect(result.b64_json).not.toContain(payload)
  })

  it('fully masks authorization and API key values', () => {
    const result = compactForLog({
      Authorization: 'Bearer secret-token',
      apiKey: 'sk-secret-value',
      nested: { access_token: 'access-secret' },
    }) as Record<string, unknown>

    expect(result.Authorization).toBe('[REDACTED]')
    expect(result.apiKey).toBe('[REDACTED]')
    expect((result.nested as Record<string, unknown>).access_token).toBe('[REDACTED]')
  })

  it('redacts prompt text while retaining only its character count', () => {
    const result = redactPrivateContentForLog({ prompt: '场'.repeat(5_000) }) as Record<string, string>

    expect(result.prompt).toBe('[REDACTED content chars=5000]')
  })

  it('removes credentials, query parameters, and fragments from logged URLs', () => {
    expect(sanitizeUrlForLog('https://user:pass@example.com/media?token=secret#result')).toBe(
      'https://example.com/media?redacted=1',
    )
  })
})
