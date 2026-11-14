// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteHtmlPreview } from './RemoteHtmlPreview'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type SparkInvoke = (channel: string, payload?: unknown) => Promise<unknown>

describe('RemoteHtmlPreview', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn((async () => ({ ok: true })) as SparkInvoke)
    ;(window as unknown as { spark: { invoke: SparkInvoke } }).spark = { invoke }
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    vi.clearAllMocks()
  })

  it('registers remote content as a full-capability isolated-origin document', async () => {
    const html = '<form action="https://example.com"><iframe src="/embed"></iframe></form>'
    await act(async () => {
      root = createRoot(container)
      root.render(<RemoteHtmlPreview html={html} title="Remote HTML" />)
    })
    await act(async () => {})

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('src')).toMatch(/^capability-asset:\/\/hr-/)
    expect(iframe?.hasAttribute('sandbox')).toBe(false)
    expect(iframe?.hasAttribute('srcdoc')).toBe(false)
    expect(invoke).toHaveBeenCalledWith(
      'html:put-runtime-doc',
      expect.objectContaining({ document: html }),
    )
  })

  it('releases the registered document when the preview unmounts', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<RemoteHtmlPreview html="<main>remote</main>" />)
    })
    await act(async () => {})
    act(() => root?.unmount())
    root = null

    expect(invoke).toHaveBeenCalledWith(
      'html:release-runtime-doc',
      expect.objectContaining({ token: expect.stringMatching(/^hr-/) }),
    )
  })

  it('默认不显示打开方式动作；openActions 时经对应通道交给主进程打开', async () => {
    const html = '<!doctype html><main>remote</main>'
    await act(async () => {
      root = createRoot(container)
      root.render(<RemoteHtmlPreview html={html} title="HTML 块" openActions />)
    })
    await act(async () => {})

    const openWindow = container.querySelector('button[aria-label="在独立窗口打开"]')
    const openExternal = container.querySelector('button[aria-label="用系统浏览器打开"]')
    expect(openWindow).not.toBeNull()
    expect(openExternal).not.toBeNull()

    await act(async () => {
      ;(openWindow as HTMLButtonElement).click()
    })
    expect(invoke).toHaveBeenCalledWith(
      'html:open-window',
      expect.objectContaining({ html, title: 'HTML 块' }),
    )

    await act(async () => {
      ;(openExternal as HTMLButtonElement).click()
    })
    expect(invoke).toHaveBeenCalledWith(
      'html:open-external',
      expect.objectContaining({ html, title: 'HTML 块' }),
    )
  })

  it('不传 openActions 时不渲染打开方式按钮（产物卡就地预览保持原样）', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<RemoteHtmlPreview html="<main>remote</main>" />)
    })
    await act(async () => {})

    expect(container.querySelector('button[aria-label="在独立窗口打开"]')).toBeNull()
    expect(container.querySelector('button[aria-label="用系统浏览器打开"]')).toBeNull()
  })
})
