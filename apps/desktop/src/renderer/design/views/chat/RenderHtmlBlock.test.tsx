// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HtmlCodePreview, HtmlRenderProvider, RenderHtmlBlock } from './RenderHtmlBlock'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

type SparkInvoke = (channel: string, payload?: unknown) => Promise<unknown>

describe('RenderHtmlBlock', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let invoke: ReturnType<typeof vi.fn>

  it('lets the fullscreen panel fill the available viewport', () => {
    const styles = readFileSync(resolve(__dirname, 'RenderHtmlBlock.less'), 'utf8')
    const fullscreenPanelRule = styles.match(/\.render-html-fullscreen-panel\s*\{([^}]*)\}/)?.[1]

    expect(fullscreenPanelRule).toContain('width: 100%')
    expect(fullscreenPanelRule).toContain('height: 100%')
    expect(fullscreenPanelRule).not.toContain('1200px')
    expect(fullscreenPanelRule).not.toContain('820px')
  })

  it('keeps the fullscreen action large enough to discover and click', () => {
    const markup = renderToStaticMarkup(<RenderHtmlBlock block={block} />)

    expect(markup).toContain('render-html-fullscreen-action')
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn((async (channel: string) => {
      if (channel === 'html:put-runtime-doc') return { ok: true }
      if (channel === 'html:release-runtime-doc') return { ok: true }
      return { success: true }
    }) as SparkInvoke)
    ;(window as unknown as { spark: { invoke: SparkInvoke } }).spark = { invoke }
  })

  afterEach(() => {
    root?.unmount()
    root = null
    container.remove()
    vi.clearAllMocks()
  })

  it('loads the sandbox doc via capability-asset in a full-capability iframe', async () => {
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={block} />)
    })
    // put 是异步 IPC：flush 微任务后 iframe 才携带 capability-asset src 挂载。
    await act(async () => {})

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const sandbox = iframe?.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-same-origin')
    expect(sandbox).toContain('allow-forms')
    expect(sandbox).toContain('allow-modals')
    expect(sandbox).toContain('allow-popups')
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(iframe?.src).toMatch(/^capability-asset:\/\/html-render\/hr-[A-Za-z0-9_-]+\?v=1$/)

    const putCall = invoke.mock.calls.find(([channel]) => channel === 'html:put-runtime-doc')
    expect(putCall).toBeDefined()
    const payload = putCall?.[1] as { token: string; document: string }
    expect(payload.token).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/)
    // 合成文档不再注入 CSP（策略容器为空，能力与外部浏览器对齐）。
    expect(payload.document).not.toContain('Content-Security-Policy')
    expect(payload.document).toContain('<main')
  })

  it('releases the runtime doc on unmount', async () => {
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={block} />)
    })
    await act(async () => {})
    root?.unmount()
    root = null

    expect(invoke).toHaveBeenCalledWith(
      'html:release-runtime-doc',
      expect.objectContaining({ token: expect.stringMatching(/^hr-/) }),
    )
  })

  it('re-registers with a new version when the sandbox doc rebuilds', async () => {
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={block} />)
    })
    await act(async () => {})

    await act(async () => {
      root?.render(<RenderHtmlBlock block={{ ...block, html: '<main>v2</main>' }} />)
    })
    await act(async () => {})

    const src = container.querySelector('iframe')?.src ?? ''
    expect(src).toMatch(/\?v=2$/)
  })

  it('renders external-resource HTML directly without a gate', async () => {
    const externalBlock = {
      ...block,
      toolCallId: 'html-ext-1',
      html: '<script src="https://cdn.example.com/mindmap.js"></script>',
      title: '外链思维导图',
      warnings: [],
    }
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={externalBlock} />)
    })
    await act(async () => {})

    // 不再有「允许渲染」门控：外链脚本块直接挂载 iframe。
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.textContent).not.toContain('允许渲染')
    expect(container.querySelector('iframe')?.src).toMatch(/^capability-asset:\/\/html-render\/hr-/)
  })

  it('keeps rendering external-resource blocks across remounts', async () => {
    const externalBlock = {
      ...block,
      toolCallId: 'html-ext-1',
      html: '<script src="https://cdn.example.com/mindmap.js"></script>',
      warnings: [],
    }
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={externalBlock} />)
    })
    await act(async () => {})

    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.textContent).not.toContain('允许渲染')
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
