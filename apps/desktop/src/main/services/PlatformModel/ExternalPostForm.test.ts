import { describe, expect, it } from 'vitest'
import { buildExternalPostFormHtml } from './ExternalPostForm.js'

describe('buildExternalPostFormHtml', () => {
  it('creates an auto-submitted POST form and escapes signed gateway fields', () => {
    const html = buildExternalPostFormHtml('https://pay.example/submit?flow=1', {
      pid: 'merchant-1',
      sign: '"><script>alert(1)</script>',
    })
    expect(html).toContain('method="POST"')
    expect(html).toContain('action="https://pay.example/submit?flow=1"')
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('rejects non-http payment targets', () => {
    expect(() => buildExternalPostFormHtml('file:///tmp/steal', {})).toThrow('协议不安全')
  })
})
