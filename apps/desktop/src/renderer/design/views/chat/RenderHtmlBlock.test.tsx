import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HtmlCodePreview, HtmlRenderProvider, RenderHtmlBlock } from './RenderHtmlBlock'

const block = {
  kind: 'html_block' as const,
  toolCallId: 'html-1',
  html: '<main style="color: red">安全片段</main>',
  title: '安全片段',
  height: 240,
  status: 'rendered' as const,
  error: undefined,
  warnings: [],
}

describe('RenderHtmlBlock', () => {
  it('renders HTML in an allow-scripts-only iframe with injected CSP', () => {
    const markup = renderToStaticMarkup(<RenderHtmlBlock block={block} />)

    expect(markup).toContain('sandbox="allow-scripts"')
    expect(markup).not.toContain('allow-same-origin')
    expect(markup).toContain('Content-Security-Policy')
    expect(markup).toContain('HTML 打开方式')
    expect(markup).toContain('外部浏览器')
  })

  it('shows a structured error state without executing failed content', () => {
    const markup = renderToStaticMarkup(
      <RenderHtmlBlock block={{ ...block, status: 'error', error: '非法标签' }} />,
    )

    expect(markup).toContain('HTML 渲染失败')
    expect(markup).toContain('非法标签')
    expect(markup).not.toContain('<iframe')
  })

  it('uses the HTML code preview style for source content', () => {
    const markup = renderToStaticMarkup(<HtmlCodePreview code={block.html} />)

    expect(markup).toContain('render-html-code-preview')
    expect(markup).toContain('md-code-block')
    expect(markup).toContain('md-code-lang')
    expect(markup).toContain('>html</span>')
  })

  it('does not mount an iframe before the tool result passes validation', () => {
    const markup = renderToStaticMarkup(<RenderHtmlBlock block={{ ...block, status: 'pending' }} />)

    expect(markup).toContain('等待 HTML 安全校验')
    expect(markup).not.toContain('<iframe')
  })

  it('hides the inline preview when a remote opening mode is active', () => {
    const markup = renderToStaticMarkup(
      <HtmlRenderProvider
        value={{
          activeSidePanelBlockId: null,
          activeRemotePresentation: { blockId: block.toolCallId, mode: 'window' },
          onOpenMode: () => undefined,
        }}
      >
        <RenderHtmlBlock block={block} />
      </HtmlRenderProvider>,
    )

    expect(markup).toContain('HTML 已在独立窗口打开')
    expect(markup).toContain('value="window"')
    expect(markup).not.toContain('<iframe')
  })
})
