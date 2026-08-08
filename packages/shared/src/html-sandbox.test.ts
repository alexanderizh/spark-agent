import { describe, expect, it } from 'vitest'
import {
  buildHtmlViewerDocument,
  buildSandboxedHtml,
  findHtmlExternalResourceWarning,
  validateHtmlViewerPayload,
} from './html-sandbox'

describe('HTML sandbox helpers', () => {
  it('wraps fragments with a restrictive CSP and theme marker', () => {
    const document = buildSandboxedHtml('<main>safe</main>', 'dark')

    expect(document).toContain('Content-Security-Policy')
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain('data-spark-theme="dark"')
    expect(document).not.toContain('allow-same-origin')
  })

  it('injects the CSP into a complete HTML document without corrupting the html tag', () => {
    const document = buildSandboxedHtml(
      '<!doctype html><html><head><title>safe</title></head><body><main>safe</main></body></html>',
      'dark',
    )

    expect(document).toMatch(/^<!doctype html><html data-spark-theme="dark"><head>/)
    expect(document).toContain('<title>safe</title>')
    expect(document).toContain('</head><body><main>safe</main></body></html>')
    expect(document).not.toContain('<html data-s<meta')
  })

  it('keeps the standalone viewer as a sandboxed iframe document', () => {
    const document = buildHtmlViewerDocument({
      html: '<main>safe</main>',
      title: '预览',
      theme: 'light',
    })

    expect(document).toContain('sandbox="allow-scripts"')
    expect(document).not.toContain('sandbox="allow-scripts allow-same-origin"')
    expect(document).toContain('srcdoc=')
  })

  it('validates forbidden tags, bounds, and external resource warnings', () => {
    expect(validateHtmlViewerPayload({ html: '<iframe></iframe>' })).toMatchObject({ ok: false })
    expect(validateHtmlViewerPayload({ html: 'x'.repeat(200_001) }).ok).toBe(false)
    expect(findHtmlExternalResourceWarning('<img src="https://example.com/a.png">')).toContain(
      '外部资源',
    )
    expect(validateHtmlViewerPayload({ html: '<main>safe</main>' })).toMatchObject({
      ok: true,
      payload: { title: 'HTML 内容', theme: 'light' },
    })
  })
})
