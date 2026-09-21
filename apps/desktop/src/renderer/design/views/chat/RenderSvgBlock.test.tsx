// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../Icons', () => ({
  Icons: {
    AlertTriangle: () => <span data-testid="icon-alert" />,
    Code: () => <span data-testid="icon-code" />,
  },
}))

vi.mock('../../components/MarkdownCodeBlock', () => ({
  MarkdownCodeBlock: ({ code, lang }: { code: string; lang: string }) => (
    <pre data-lang={lang} data-testid="svg-source">
      {code}
    </pre>
  ),
}))

import { RenderSvgBlock } from './RenderSvgBlock'
import {
  hasExternalSvgReference,
  isSvgDocument,
  sanitizeSvgFragment,
  toSvgDataUrl,
} from './renderSvgSource'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 与实现同源的 UTF-8 base64 解码，用于校验 data URL 内容等价 */
function decodeDataUrl(src: string): string {
  const base64 = src.slice('data:image/svg+xml;base64,'.length)
  return decodeURIComponent(escape(atob(base64)))
}

function renderBlock(source: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<RenderSvgBlock source={source} />))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('RenderSvgBlock', () => {
  let mounted: ReturnType<typeof renderBlock> | null = null

  beforeEach(() => {
    mounted = null
  })

  afterEach(() => {
    mounted?.unmount()
  })

  it('detects complete SVG documents and external references', () => {
    expect(isSvgDocument('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true)
    expect(isSvgDocument('<SVG viewBox="0 0 10 10"></SVG>')).toBe(true)
    expect(isSvgDocument('<g id="bicycle"><circle r="5" /></g>')).toBe(false)
    expect(hasExternalSvgReference('<image href="https://example.com/a.png" />')).toBe(true)
    expect(hasExternalSvgReference('<image href="data:image/png;base64,AAA" />')).toBe(false)
  })

  it('renders a complete document directly through an image data URL', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><!-- 后轮 --><circle r="5" /></svg>'
    mounted = renderBlock(source)

    const img = mounted.container.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(decodeDataUrl(img?.getAttribute('src') ?? '')).toBe(source)
    expect(mounted.container.querySelector('pre')).toBeNull()
  })

  it('renders a bare fragment inline so list-style coordinates still show up', () => {
    mounted = renderBlock('<g id="bicycle"><circle r="5" /></g>')

    const host = mounted.container.querySelector('svg.render-svg-canvas')
    expect(host?.innerHTML).toContain('<g id="bicycle">')
    expect(mounted.container.querySelector('img')).toBeNull()
  })

  it('switches between direct rendering and highlighted source', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4" /></svg>'
    mounted = renderBlock(source)

    const button = mounted.container.querySelector('button')
    expect(button?.textContent).toContain('源码')

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const sourceBlock = mounted.container.querySelector('[data-testid="svg-source"]')
    expect(sourceBlock?.getAttribute('data-lang')).toBe('svg')
    expect(sourceBlock?.textContent).toBe(source)
    expect(mounted.container.querySelector('img')).toBeNull()
  })

  it('reports a muted state when nothing renderable survives sanitizing', () => {
    mounted = renderBlock('<script>alert(1)</script>')
    expect(mounted.container.textContent).toContain('未识别到可渲染的 SVG 图形内容')
  })

  it('notes external references only for the inline fragment path', () => {
    mounted = renderBlock('<image href="https://example.com/a.png" width="4" height="4" />')
    expect(mounted.container.textContent).toContain('外部资源')

    mounted.unmount()
    mounted = renderBlock(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png" /></svg>',
    )
    expect(mounted.container.textContent).not.toContain('外部资源')
  })

  it('strips scripts and document-level styles from fragments', () => {
    const sanitized = sanitizeSvgFragment(
      '<style>body{display:none}</style><script>alert(1)</script><g onload="alert(1)"><circle r="5" /></g>',
    )
    expect(sanitized).not.toContain('<style')
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('onload')
    expect(sanitized).toContain('<circle')
  })

  it('keeps non-ASCII SVG source encodable', () => {
    expect(() => toSvgDataUrl('<svg><!-- 后轮 --></svg>')).not.toThrow()
  })
})
