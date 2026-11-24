import { describe, expect, it } from 'vitest'
import { attachmentReadFailureToHttp } from './mobile-bridge-attachment'

describe('mobile-bridge-attachment', () => {
  it('maps whitelist rejections to 403 with a distinct message', () => {
    for (const reason of ['outside_whitelist', 'symlink_escape'] as const) {
      const http = attachmentReadFailureToHttp(reason)
      expect(http.status).toBe(403)
      expect(http.code).toBe('ATTACHMENT_OUTSIDE_WHITELIST')
      expect(http.message).toContain('白名单')
    }
  })

  it('maps missing files to 404', () => {
    const http = attachmentReadFailureToHttp('not_found')
    expect(http.status).toBe(404)
    expect(http.code).toBe('ATTACHMENT_NOT_FOUND')
    expect(http.message).toContain('不存在')
  })

  it('maps oversized files to 413', () => {
    const http = attachmentReadFailureToHttp('too_large')
    expect(http.status).toBe(413)
    expect(http.code).toBe('ATTACHMENT_TOO_LARGE')
    expect(http.message).toContain('20 MiB')
  })
})
