// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
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

  it('loads the sandbox doc via capability-asset in an allow-scripts-only iframe', async () => {
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={block} />)
    })
    // put 是异步 IPC：flush 微任务后 iframe 才携带 capability-asset src 挂载。
    await act(async () => {})

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('sandbox') ?? '').not.toContain('allow-same-origin')
    expect(iframe?.src).toMatch(/^capability-asset:\/\/html-render\/hr-[A-Za-z0-9_-]+\?v=1$/)

    const putCall = invoke.mock.calls.find(([channel]) => channel === 'html:put-runtime-doc')
    expect(putCall).toBeDefined()
    const payload = putCall?.[1] as { token: string; document: string }
    expect(payload.token).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/)
    // 合成文档自带 meta CSP（安全姿态由登记文档承载，而非继承 renderer CSP）。
    expect(payload.document).toContain('Content-Security-Policy')
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

  it('gates external-resource HTML behind an explicit allow action', async () => {
    const externalBlock = {
      ...block,
      toolCallId: 'html-ext-1',
      html: '<script src="https://cdn.example.com/mindmap.js"></script>',
      title: '外链思维导图',
      warnings: ['检测到外部资源引用，沙盒 CSP 将允许网络加载；请确认来源可信'],
    }
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={externalBlock} />)
    })
    await act(async () => {})

    // 门控态：警告 + 按钮可见，但不挂载 iframe。
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('允许渲染')

    const allowButton = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === '允许渲染',
    )
    expect(allowButton).toBeDefined()
    await act(async () => {
      allowButton?.click()
    })
    await act(async () => {})

    // 点击后立即渲染。
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.src).toMatch(/^capability-asset:\/\/html-render\/hr-/)
  })

  it('remembers the external-resource allowance across remounts', async () => {
    // 上一用例已允许 html-ext-1：重挂载（滚动重建/主题切换）后不再阻拦。
    const externalBlock = {
      ...block,
      toolCallId: 'html-ext-1',
      html: '<script src="https://cdn.example.com/mindmap.js"></script>',
      warnings: ['检测到外部资源引用，沙盒 CSP 将允许网络加载；请确认来源可信'],
    }
    root = createRoot(container)
    await act(async () => {
      root?.render(<RenderHtmlBlock block={externalBlock} />)
    })
    await act(async () => {})

    expect(container.textContent).not.toContain('允许渲染')
    expect(container.querySelector('iframe')).not.toBeNull()
    // 外部资源警告已在确认时呈现过，不再常驻底部提示条。
    expect(container.querySelector('.render-html-warning')).toBeNull()
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
