import { describe, expect, it } from 'vitest'
import {
  buildHtmlViewerDocument,
  buildSandboxedHtml,
  validateHtmlViewerPayload,
} from './html-sandbox'
import { buildHtmlRenderOriginHost } from './html-render-origin'

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

  it('keeps the standalone viewer as an unsandboxed capability-asset iframe document', () => {
    const token = 'win-abc123'
    const frameSrc = `capability-asset://${buildHtmlRenderOriginHost(token)}/${token}?v=1`
    const document = buildHtmlViewerDocument(
      {
        html: '<main>safe</main>',
        title: '预览',
        theme: 'light',
      },
      frameSrc,
    )

    // iframe 由协议 URL 提供（独立 origin，不继承壳文档策略）
    expect(document).toContain(`src="${frameSrc}"`)
    expect(document).not.toContain('sandbox=')
    // 仅保留不含用户内容的外壳 CSP；内容由独立 origin 文档承载。
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

  it('clamps oversized title and ignores malformed height instead of rejecting', () => {
    expect(
      validateHtmlViewerPayload({ html: '<main>safe</main>', title: '超'.repeat(100) }),
    ).toMatchObject({
      ok: true,
      payload: { title: '超'.repeat(60), theme: 'light' },
    })
    expect(
      validateHtmlViewerPayload({ html: '<main>safe</main>', title: 12345, height: 'auto' }),
    ).toMatchObject({
      ok: true,
      payload: { title: 'HTML 内容', theme: 'light' },
    })
  })
})
