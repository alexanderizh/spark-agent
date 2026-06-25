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

  // HTML 文件不再走应用内预览：getPreviewFileType 对 .html/.htm 返回 null，
  // 各调用点（ClickableFilePath / SessionFileOpenPicker / DocumentOutputCard）会
  // 回退到 file:open → shell.openPath，由 OS 默认浏览器打开。
  it('classifies .html/.htm as non-previewable so they open in the system browser', () => {
    expect(getPreviewFileType('/tmp/preview.html')).toBeNull()
    expect(getPreviewFileType('/tmp/preview.htm')).toBeNull()
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
})
