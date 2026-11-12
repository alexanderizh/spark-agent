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
})
