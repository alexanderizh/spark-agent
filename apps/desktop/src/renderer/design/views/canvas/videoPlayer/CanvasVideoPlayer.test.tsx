// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VIDEO_PLAYER_FRAME_SEC,
  clampVideoPlayerValue,
  formatVideoPlayerTime,
  formatVideoPlayerTimecode,
  resolveVideoPlayerTier,
} from './videoPlayerFormat'
import { CanvasVideoPlayer } from './CanvasVideoPlayer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
})

describe('videoPlayerFormat', () => {
  it('formats regular time and timecode displays', () => {
    expect(formatVideoPlayerTime(0)).toBe('0:00')
    expect(formatVideoPlayerTime(65.4)).toBe('1:05')
    expect(formatVideoPlayerTime(3672)).toBe('1:01:12')
    expect(formatVideoPlayerTime(Number.NaN)).toBe('0:00')
    expect(formatVideoPlayerTimecode(12.34)).toBe('0:12.3')
  })

  it('clamps values and resolves responsive tiers', () => {
    expect(clampVideoPlayerValue(-1, 0, 1)).toBe(0)
    expect(clampVideoPlayerValue(2, 0, 1)).toBe(1)
    expect(clampVideoPlayerValue(Number.NaN, 0, 1)).toBe(0)
    expect(resolveVideoPlayerTier(200)).toBe('mini')
    expect(resolveVideoPlayerTier(300)).toBe('standard')
    expect(resolveVideoPlayerTier(480)).toBe('panel')
    expect(resolveVideoPlayerTier(0)).toBe('standard')
    expect(VIDEO_PLAYER_FRAME_SEC).toBeCloseTo(1 / 30)
  })
})

describe('CanvasVideoPlayer', () => {
  it('renders a video without native controls plus the custom overlay', () => {
    const html = renderToStaticMarkup(
      <CanvasVideoPlayer src="https://example.com/video.mp4" className="canvas-node-image" />,
    )

    expect(html).toContain('<video')
    expect(html).toContain('src="https://example.com/video.mp4"')
    expect(html).toContain('playsInline=""')
    // 自研播放器必须去掉原生 controls，控件由 overlay 承载。
    // 注意不能断言 not.toContain(' controls')：controlsList 属性会误命中。
    expect(html).not.toContain('controls=""')
    expect(html).toContain('canvas-video-player-overlay')
    expect(html).toContain('data-tier=')
    expect(html).toContain('nodrag nopan')
    expect(html).toMatch(/<div class="canvas-video-player(?: |")/)
    expect(html).toContain('canvas-video-player-center-btn nodrag nopan')
  })

  it('forwards media lifecycle callbacks', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push({ root, container })

    const metadata: Array<{ width: number; height: number }> = []
    let loadedData = 0
    let errors = 0

    await act(async () => {
      root.render(
        <CanvasVideoPlayer
          src="https://example.com/video.mp4"
          onVideoMetadata={(info) => metadata.push({ width: info.width, height: info.height })}
          onVideoLoadedData={() => {
            loadedData += 1
          }}
          onVideoError={() => {
            errors += 1
          }}
        />,
      )
    })

    const video = container.querySelector('video')
    expect(video).not.toBeNull()

    await act(async () => {
      Object.defineProperty(video, 'videoWidth', { value: 1920 })
      Object.defineProperty(video, 'videoHeight', { value: 1080 })
      Object.defineProperty(video, 'duration', { value: 12 })
      video?.dispatchEvent(new Event('loadedmetadata'))
      video?.dispatchEvent(new Event('loadeddata'))
      video?.dispatchEvent(new Event('error'))
    })

    expect(metadata).toEqual([{ width: 1920, height: 1080 }])
    expect(loadedData).toBe(1)
    expect(errors).toBe(1)
  })
})
