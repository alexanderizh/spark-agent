// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CanvasNodeMediaPreview,
  resolveCanvasNodeMediaUrl,
} from './CanvasNodeMediaPreview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

describe('CanvasNodeMediaPreview', () => {
  it('renders an image preview with the expected browser loading attributes', () => {
    const html = renderToStaticMarkup(
      <CanvasNodeMediaPreview type="image" url="https://example.com/image.png" />,
    )

    expect(html).toContain('data-media-state="loading"')
    expect(html).toContain('src="https://example.com/image.png"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('alt="图片预览"')
  })

  it('renders a controlled video preview without node double-click handlers', () => {
    const html = renderToStaticMarkup(
      <CanvasNodeMediaPreview type="video" url="https://example.com/video.mp4" />,
    )

    expect(html).toContain('<video')
    expect(html).toContain('controls=""')
    expect(html).toContain('controlsList="noremoteplayback"')
    expect(html).toContain('disablePictureInPicture=""')
    expect(html).toContain('playsInline=""')
    expect(html).toContain('preload="metadata"')
    expect(html).not.toContain('onDoubleClick')
  })

  it('shows empty state for blank URLs and supports safe-file/local paths', () => {
    const html = renderToStaticMarkup(<CanvasNodeMediaPreview type="image" url="  " />)

    expect(html).toContain('data-media-state="empty"')
    expect(html).toContain('输入图片 URL 后即可预览')
    expect(resolveCanvasNodeMediaUrl('safe-file://x/image')).toBe('safe-file://x/image')
    expect(resolveCanvasNodeMediaUrl('/tmp/image.png')).toMatch(/^safe-file:\/\/x\//)
    expect(resolveCanvasNodeMediaUrl('ftp://example.com/image.png')).toBe('')
  })

  it('moves to error state on media failure and resets for a new URL', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(<CanvasNodeMediaPreview type="image" url="https://example.com/broken.png" />)
    })
    const image = container.querySelector('img')
    expect(image).not.toBeNull()

    await act(async () => {
      image?.dispatchEvent(new Event('error', { bubbles: false }))
    })
    expect(container.querySelector('[data-media-state="error"]')).not.toBeNull()
    expect(container.textContent).toContain('图片加载失败')

    await act(async () => {
      root.render(<CanvasNodeMediaPreview type="image" url="https://example.com/next.png" />)
    })
    expect(container.querySelector('[data-media-state="loading"]')).not.toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/next.png')
  })
})
