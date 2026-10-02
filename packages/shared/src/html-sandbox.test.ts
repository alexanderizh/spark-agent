import { describe, expect, it } from 'vitest'
import {
  buildHtmlViewerDocument,
  buildSandboxedHtml,
  validateHtmlViewerPayload,
} from './html-sandbox'

describe('HTML sandbox helpers', () => {
  it('wraps fragments with theme marker and no injected CSP', () => {
    const document = buildSandboxedHtml('<main>safe</main>', 'dark')

    // 产物文档不再注入 CSP：脚本/eval/外联资源/iframe/表单与外部浏览器对齐
    expect(document).not.toContain('Content-Security-Policy')
    expect(document).toContain('data-spark-theme="dark"')
    expect(document).toContain('color-scheme')
  })

  it('injects theme into a complete HTML document without corrupting the html tag', () => {
    const document = buildSandboxedHtml(
      '<!doctype html><html><head><title>safe</title></head><body><main>safe</main></body></html>',
      'dark',
    )

    expect(document).toMatch(/^<!doctype html><html data-spark-theme="dark"><head>/)
    expect(document).toContain('<title>safe</title>')
    expect(document).toContain('</head><body><main>safe</main></body></html>')
    expect(document).not.toContain('<html data-s<meta')
  })

  it('keeps the standalone viewer as a capability-asset iframe document', () => {
    const document = buildHtmlViewerDocument(
      {
        html: '<main>safe</main>',
        title: '预览',
        theme: 'light',
      },
      'capability-asset://html-render/win-abc123?v=1',
    )

    // iframe 由协议 URL 提供（独立空策略容器，不继承壳 CSP），全能力沙箱
    expect(document).toContain('src="capability-asset://html-render/win-abc123?v=1"')
    expect(document).toContain('allow-same-origin')
    expect(document).toContain('allow-scripts')
    expect(document).toContain('allow-forms')
    expect(document).toContain('allow-modals')
    expect(document).toContain('allow-popups')
    expect(document).toContain('frame-src capability-asset:')
    expect(document).not.toContain('srcdoc=')
  })

  it('escapes the frame source attribute against attribute injection', () => {
    const document = buildHtmlViewerDocument(
      { html: '<main>safe</main>', title: '预览', theme: 'light' },
      'capability-asset://html-render/x" onload="alert(1)',
    )

    expect(document).toContain('src="capability-asset://html-render/x&quot; onload=&quot;alert(1)"')
  })

  it('validates bounds without rejecting script-bearing or tagged documents', () => {
    expect(validateHtmlViewerPayload({ html: '<iframe></iframe><form></form>' })).toMatchObject({
      ok: true,
      payload: { title: 'HTML 内容', theme: 'light' },
    })
    expect(validateHtmlViewerPayload({ html: 'x'.repeat(200_001) }).ok).toBe(false)
    expect(validateHtmlViewerPayload({ html: '' }).ok).toBe(false)
    expect(validateHtmlViewerPayload({ html: '<main>safe</main>' })).toMatchObject({
      ok: true,
      payload: { title: 'HTML 内容', theme: 'light' },
    })
  })
})
