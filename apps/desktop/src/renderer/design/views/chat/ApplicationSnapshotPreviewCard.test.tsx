// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationSnapshotPreviewCard } from './ApplicationSnapshotPreviewCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ApplicationSnapshotPreviewCard', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = null
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('renders the governed capability URL as an actual image preview', () => {
    const previewUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`
    const html = renderToStaticMarkup(
      <ApplicationSnapshotPreviewCard
        snapshotId="snapshot-1"
        previewUrl={previewUrl}
        appName="Editor"
        windowTitle="Document"
        capturedAt="2026-07-28T00:00:00.000Z"
      />,
    )

    expect(html).toContain(`<img src="${previewUrl}"`)
    expect(html).toContain('Editor')
    expect(html).toContain('Document')
    expect(html).toContain('应用快照')
  })

  it('renews an expired preview capability through governed snapshot IPC', async () => {
    const initialUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`
    const renewedUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'b'.repeat(43)}`
    const invoke = vi.fn(async () => ({
      snapshot: {
        id: 'snapshot-1',
        previewUrl: renewedUrl,
      },
    }))
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ApplicationSnapshotPreviewCard
          snapshotId="snapshot-1"
          previewUrl={initialUrl}
          appName="Editor"
          windowTitle="Document"
          capturedAt="2026-07-28T00:00:00.000Z"
        />,
      )
    })
    const image = requireImage(container)

    await act(async () => {
      image.dispatchEvent(new Event('error'))
    })

    expect(invoke).toHaveBeenCalledWith('app-snapshot:get', { id: 'snapshot-1' })
    expect(image.getAttribute('src')).toBe(renewedUrl)
  })

  it('does not retry indefinitely when the renewed preview also fails', async () => {
    const initialUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`
    const renewedUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'b'.repeat(43)}`
    const invoke = vi.fn(async () => ({
      snapshot: {
        id: 'snapshot-1',
        previewUrl: renewedUrl,
      },
    }))
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ApplicationSnapshotPreviewCard
          snapshotId="snapshot-1"
          previewUrl={initialUrl}
          appName="Editor"
          windowTitle="Document"
          capturedAt="2026-07-28T00:00:00.000Z"
        />,
      )
    })
    const image = requireImage(container)

    await act(async () => {
      image.dispatchEvent(new Event('error'))
    })
    await act(async () => {
      image.dispatchEvent(new Event('error'))
    })

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('resets renewal state when the card is reused for another snapshot', async () => {
    const firstUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`
    const firstRenewedUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'b'.repeat(43)}`
    const secondUrl = `spark-snapshot://snapshot/snapshot-2/preview?cap=${'c'.repeat(43)}`
    const secondRenewedUrl = `spark-snapshot://snapshot/snapshot-2/preview?cap=${'d'.repeat(43)}`
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ snapshot: { id: 'snapshot-1', previewUrl: firstRenewedUrl } })
      .mockResolvedValueOnce({ snapshot: { id: 'snapshot-2', previewUrl: secondRenewedUrl } })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ApplicationSnapshotPreviewCard
          snapshotId="snapshot-1"
          previewUrl={firstUrl}
          appName="Editor"
          windowTitle="First"
          capturedAt="2026-07-28T00:00:00.000Z"
        />,
      )
    })
    const image = requireImage(container)
    await act(async () => image.dispatchEvent(new Event('error')))

    await act(async () => {
      root?.render(
        <ApplicationSnapshotPreviewCard
          snapshotId="snapshot-2"
          previewUrl={secondUrl}
          appName="Editor"
          windowTitle="Second"
          capturedAt="2026-07-28T00:01:00.000Z"
        />,
      )
    })
    expect(image.getAttribute('src')).toBe(secondUrl)

    await act(async () => image.dispatchEvent(new Event('error')))

    expect(invoke).toHaveBeenNthCalledWith(2, 'app-snapshot:get', { id: 'snapshot-2' })
    expect(image.getAttribute('src')).toBe(secondRenewedUrl)
  })
})

function requireImage(container: HTMLElement): HTMLImageElement {
  const image = container.querySelector('img')
  if (image == null) throw new Error('Expected application snapshot image')
  return image
}
