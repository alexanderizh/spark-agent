import { describe, expect, it } from 'vitest'
import { translateSyncErrorCode, translateSyncErrorCodes } from './sync-error-messages'

describe('translateSyncErrorCode', () => {
  it('maps known error codes to friendly user messages', () => {
    expect(translateSyncErrorCode('SYNC_TEAM_MEMBER_MISSING').message).toContain('团队成员')
    expect(translateSyncErrorCode('SYNC_MEMORY_SCOPE_UNAVAILABLE').message).toContain('项目记忆')
    expect(translateSyncErrorCode('SYNC_LOCAL_APPLY_FAILED').message).toContain('本地应用失败')
    expect(translateSyncErrorCode('SYNC_ENCRYPTION_KEY_MISSING').message).toContain('加密密钥')
    expect(translateSyncErrorCode('SYNC_CATEGORY_UNSUPPORTED').message).toContain('提示词库')
  })

  it('classifies severities for skipped / degraded / failed codes', () => {
    expect(translateSyncErrorCode('SECRET_COMMON_API_KEY').severity).toBe('skipped')
    expect(translateSyncErrorCode('SYNC_TEAM_MEMBER_MISSING').severity).toBe('degraded')
    expect(translateSyncErrorCode('SYNC_LOCAL_APPLY_FAILED').severity).toBe('failed')
  })

  it('falls back for unknown codes without exposing the raw code', () => {
    const fallback = translateSyncErrorCode('SOME_UNKNOWN_CODE')
    expect(fallback.message).toBe('部分数据未能同步，详见同步记录')
    expect(fallback.message).not.toContain('SOME_UNKNOWN_CODE')
  })
})

describe('translateSyncErrorCodes', () => {
  it('deduplicates identical messages', () => {
    const messages = translateSyncErrorCodes([
      'SYNC_TEAM_MEMBER_MISSING',
      'SYNC_TEAM_MEMBER_MISSING',
    ])
    expect(messages).toHaveLength(1)
  })

  it('keeps the order of distinct messages', () => {
    const messages = translateSyncErrorCodes([
      'SYNC_TEAM_MEMBER_MISSING',
      'SYNC_MEMORY_SCOPE_UNAVAILABLE',
    ])
    expect(messages[0]).toContain('团队成员')
    expect(messages[1]).toContain('项目记忆')
  })

  it('falls back for an empty list', () => {
    expect(translateSyncErrorCodes([])).toEqual(['部分数据未能同步，详见同步记录'])
  })
})
