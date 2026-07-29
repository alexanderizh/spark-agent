// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FontAssetControl } from './FontAssetControl'

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
}))

vi.mock('../hooks/useManagedFontAssets', () => ({
  useManagedFontAssets: () => ({
    status: {
      state: 'error',
      version: null,
      percent: null,
      message: 'failed',
      lastError: 'network unavailable',
      fonts: [],
    },
    install: mocks.install,
  }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('FontAssetControl', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.install.mockReset().mockResolvedValue({ success: false })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('shows the fallback state and lets the user retry manually', async () => {
    await act(async () => root.render(<FontAssetControl />))
    expect(container.textContent).toContain('下载失败')
    expect(container.textContent).toContain('network unavailable')

    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('重试下载'),
    )
    expect(button).toBeDefined()
    await act(async () => button?.click())
    expect(mocks.install).toHaveBeenCalledWith(true)
  })
})
