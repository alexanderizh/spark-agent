// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HTML_FRAME_SANDBOX } from '@spark/shared'
import { FilePreviewPanel } from '../design/components/FilePreviewPanel'
import { getPreviewFileType } from '../design/components/FileDisplay'
import { ToastProvider } from '../design/components/Toast'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../design/components/FileMarkdownView', () => ({
  FileMarkdownView: ({
    content,
    imageBasePath,
  }: {
    content: string
    imageBasePath?: string | null
  }) => <div data-image-base-path={imageBasePath ?? ''}>{content}</div>,
}))

vi.mock('../design/components/MarkdownImage', () => ({
  MarkdownImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

describe('FilePreviewPanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'file:read') return { content: '' }
      if (channel === 'file:open') return { opened: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  // HTML 恢复应用内预览：getPreviewFileType 对 .html/.htm 返回 'html'，
  // 由 FilePreviewPanel 的 sandbox iframe 分支渲染（buildHtmlPreviewDocument）。
  it('classifies .html/.htm as html preview type', () => {
    expect(getPreviewFileType('/tmp/preview.html')).toBe('html')
    expect(getPreviewFileType('/tmp/preview.htm')).toBe('html')
  })

  it('still previews markdown files inside the panel', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <FilePreviewPanel filePath="/tmp/notes.md" fileType="markdown" onClose={vi.fn()} />
        </ToastProvider>,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.file-preview-markdown')).not.toBeNull()
    })

    // markdown 预览须把文件所在目录传给渲染层，文内相对路径图片才能解析加载
    const markdownBody = container.querySelector('.file-preview-markdown > div')
    expect(markdownBody?.getAttribute('data-image-base-path')).toBe('/tmp')
  })

  it('previews html files in a sandboxed iframe', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'file:read') return { content: '<h1>hello</h1>' }
      if (channel === 'file:open') return { opened: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <FilePreviewPanel filePath="/tmp/page.html" fileType="html" onClose={vi.fn()} />
        </ToastProvider>,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      const iframe = container.querySelector('iframe.file-preview-html')
      expect(iframe).not.toBeNull()
      // 与聊天 HTML 渲染块同一沙箱令牌：allow-scripts 等全开，
      // 隔离边界由 capability-asset 跨源 origin 提供（无 allow-top-navigation）。
      expect(iframe?.getAttribute('sandbox')).toBe(HTML_FRAME_SANDBOX)
      // 文档经主进程登记的 capability-asset 独立容器加载（可跑脚本、无 CSP 继承），
      // 不再使用被 renderer CSP 拦截内联内容的 srcdoc。
      expect(iframe?.getAttribute('src') ?? '').toContain('capability-asset://html-render/')
      // token 以目录段形式加载：文档内相对引用解析到 <token>/<相对路径>，
      // 由主进程按登记的 assetRoot（文件所在目录）从磁盘解析（多文件 HTML 项目）。
      expect(iframe?.getAttribute('src') ?? '').toMatch(
        /^capability-asset:\/\/html-render\/[^/]+\/\?v=/,
      )
      expect(iframe?.getAttribute('srcdoc')).toBeNull()
    })

    const putCalls = invoke.mock.calls.filter((call) => call[0] === 'html:put-runtime-doc')
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0]?.[1]).toMatchObject({ document: '<h1>hello</h1>', assetRoot: '/tmp' })
  })

  it('skips assetRoot registration for bare file names without a directory', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'file:read') return { content: '<p>solo</p>' }
      if (channel === 'file:open') return { opened: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <FilePreviewPanel filePath="page.html" fileType="html" onClose={vi.fn()} />
        </ToastProvider>,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(container.querySelector('iframe.file-preview-html')).not.toBeNull()
    })

    const putCalls = invoke.mock.calls.filter((call) => call[0] === 'html:put-runtime-doc')
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0]?.[1]).toMatchObject({ document: '<p>solo</p>' })
    expect(putCalls[0]?.[1]).not.toHaveProperty('assetRoot')
  })

  it('releases the html runtime doc on unmount', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'file:read') return { content: '<h1>bye</h1>' }
      if (channel === 'file:open') return { opened: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <FilePreviewPanel filePath="/tmp/bye.html" fileType="html" onClose={vi.fn()} />
        </ToastProvider>,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(container.querySelector('iframe.file-preview-html')).not.toBeNull()
    })

    await act(async () => {
      root?.unmount()
      root = null
    })

    const releaseCalls = invoke.mock.calls.filter((call) => call[0] === 'html:release-runtime-doc')
    expect(releaseCalls).toHaveLength(1)
  })
})
