// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@lobehub/ui', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke }),
}))

vi.mock('./Toast', () => ({
  useToast: () => ({ toast }),
}))

vi.mock('./FileDisplay', () => ({
  COMMON_FILE_EXTENSIONS: new Set<string>(),
  getFileExtension: () => '',
  getPreviewFileType: () => null,
  normalizeFileReference: (value: string) => value,
  stripTrailingFilePunctuation: (value: string) => value,
}))

import { ClickableUrl } from './ClickableFilePath'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ClickableUrl', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    invoke.mockReset()
    toast.error.mockReset()
    toast.success.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the original URL while metadata is unavailable', async () => {
    invoke.mockResolvedValue({ metadata: null })

    await act(async () => {
      root.render(<ClickableUrl url="https://example.com/article" />)
    })

    const link = container.querySelector('a')
    expect(link?.textContent).toBe('https://example.com/article')
    expect(link?.className).toContain('clickable-url')
  })

  it('renders a title card when metadata is available', async () => {
    invoke.mockResolvedValue({
      metadata: {
        title: 'Example article',
        faviconUrl: 'https://example.com/favicon.ico',
      },
    })

    await act(async () => {
      root.render(<ClickableUrl url="https://example.com/article" />)
    })

    expect(container.querySelector('.clickable-url-card-body')?.textContent).toBe('Example article')
    expect(container.querySelector('.clickable-url-card-icon')).not.toBeNull()
    expect(container.querySelector('.clickable-url-card-domain')).toBeNull()
    expect(container.querySelector('.clickable-url-card-url')).toBeNull()
  })

  it('shows only the icon and URL when metadata has no title', async () => {
    invoke.mockResolvedValue({
      metadata: {
        title: '',
        faviconUrl: 'https://example.com/favicon.ico',
      },
    })

    await act(async () => {
      root.render(<ClickableUrl url="https://example.com/article" />)
    })

    expect(container.querySelector('.clickable-url-card-body')?.textContent).toBe(
      'https://example.com/article',
    )
    expect(container.querySelector('.clickable-url-card-icon')).not.toBeNull()
    expect(container.querySelector('.clickable-url-card-title')).toBeNull()
  })

  it('does not reserve an icon slot when metadata has no favicon', async () => {
    invoke.mockResolvedValue({
      metadata: {
        title: 'Example article',
      },
    })

    await act(async () => {
      root.render(<ClickableUrl url="https://example.com/article" />)
    })

    expect(container.querySelector('.clickable-url-card-body')?.textContent).toBe('Example article')
    expect(container.querySelector('.clickable-url-card-icon')).toBeNull()
  })

  it('offers open and copy actions from the content-style context menu', async () => {
    invoke.mockResolvedValue({ metadata: null })

    await act(async () => {
      root.render(<ClickableUrl url="https://example.com/article" />)
    })
    const link = container.querySelector('a')
    expect(link).not.toBeNull()

    act(() => {
      link?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 36 }),
      )
    })

    expect(container.querySelector('.context-action-menu')).not.toBeNull()
    expect(container.textContent).toContain('在浏览器中打开')
    expect(container.textContent).toContain('复制链接')
    expect(container.textContent).toContain('复制链接文本')
  })
})
