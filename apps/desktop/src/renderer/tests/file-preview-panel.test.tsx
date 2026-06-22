// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePreviewPanel } from '../design/components/FilePreviewPanel'
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
      if (channel === 'file:read') {
        return {
          content:
            '<!doctype html><html><head><style>.wide{width:100vw}</style></head><body><main data-preview-marker class="wide">Preview</main></body></html>',
        }
      }
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

  it('renders html previews in a constrained iframe instead of injecting into the app document', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ToastProvider>
          <FilePreviewPanel filePath="/tmp/preview.html" fileType="html" onClose={vi.fn()} />
        </ToastProvider>,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.file-preview-html')).not.toBeNull()
    })

    const iframe = container.querySelector<HTMLIFrameElement>('iframe.file-preview-html')

    expect(iframe).not.toBeNull()
    expect(container.querySelector('[data-preview-marker]')).toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
    expect(iframe?.srcdoc).toContain('data-spark-preview-containment')
    expect(iframe?.srcdoc).toContain('width:100vw')
  })
})
