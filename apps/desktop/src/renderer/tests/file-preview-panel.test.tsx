// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePreviewPanel } from '../design/components/FilePreviewPanel'
import { getPreviewFileType } from '../design/components/FileDisplay'
import { ToastProvider } from '../design/components/Toast'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../design/views/ChatView', () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
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
      expect(iframe?.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
      expect(iframe?.getAttribute('srcdoc')).toContain('hello')
    })
  })
})
