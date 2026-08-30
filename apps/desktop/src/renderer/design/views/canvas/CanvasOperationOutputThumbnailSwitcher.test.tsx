// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasOperationOutputThumbnailSwitcher } from './CanvasOperationOutputThumbnailSwitcher'
import type { CanvasOperationMediaThumbnailItem } from './canvasOperationOutputThumbnails'
import type { CanvasOperationOutputView } from './canvasOperationRuns'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const at = '2026-08-01T00:00:00.000Z'
let root: Root | null = null
let container: HTMLDivElement | null = null

function item(
  id: string,
  previewKind: CanvasOperationMediaThumbnailItem['previewKind'],
): CanvasOperationMediaThumbnailItem {
  const output: CanvasOperationOutputView = {
    id,
    type: previewKind,
    title: id,
    url: previewKind === 'video' ? `${id}.mp4` : `${id}.png`,
    createdAt: at,
    updatedAt: at,
  }
  return {
    key: `run:${id}`,
    runIndex: 0,
    outputIndex: id === 'image-1' ? 0 : 1,
    output,
    previewUrl: output.url ?? '',
    previewKind,
  }
}

function renderSwitcher(
  items: CanvasOperationMediaThumbnailItem[],
  activeOutputId: string | undefined,
  onSelect = vi.fn(),
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <CanvasOperationOutputThumbnailSwitcher
        items={items}
        activeOutputId={activeOutputId}
        onSelect={onSelect}
      />,
    )
  })
  return { container, onSelect }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('CanvasOperationOutputThumbnailSwitcher', () => {
  it('至少两个媒体产物时渲染单行切换项，并将点击项回传给上层', () => {
    const items = [item('image-1', 'image'), item('video-1', 'video')]
    const view = renderSwitcher(items, 'video-1')
    const buttons = view.container.querySelectorAll<HTMLButtonElement>(
      '[data-output-thumbnail-id]',
    )

    expect(buttons).toHaveLength(2)
    expect(view.container.querySelector('img')?.getAttribute('src')).toContain('image-1.png')
    expect(view.container.querySelector('video')?.getAttribute('src')).toContain('video-1.mp4')
    expect(view.container.querySelector('[aria-current="true"]')?.getAttribute(
      'data-output-thumbnail-id',
    )).toBe('video-1')

    act(() => buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(view.onSelect).toHaveBeenCalledWith(items[0])
  })

  it('不足两个媒体产物时不渲染', () => {
    const view = renderSwitcher([item('image-1', 'image')], 'image-1')

    expect(view.container.querySelector('[aria-label="历史媒体产物"]')).toBeNull()
  })

  it('媒体加载失败后保留可点击占位项', () => {
    const items = [item('image-1', 'image'), item('video-1', 'video')]
    const view = renderSwitcher(items, 'image-1')
    const image = view.container.querySelector('img')

    act(() => image?.dispatchEvent(new Event('error', { bubbles: true })))

    const failedButton = view.container.querySelector<HTMLButtonElement>(
      '[data-output-thumbnail-id="image-1"]',
    )
    expect(failedButton?.querySelector('[data-media-placeholder="image"]')).not.toBeNull()
    act(() => failedButton?.click())
    expect(view.onSelect).toHaveBeenCalledWith(items[0])
  })

  it('内容溢出时显示两侧按钮，并按当前位置更新禁用状态', () => {
    const items = [
      item('image-1', 'image'),
      item('image-2', 'image'),
      item('video-1', 'video'),
    ]
    const view = renderSwitcher(items, 'image-1')
    const track = view.container.querySelector<HTMLElement>(
      '.canvas-operation-output-thumbnail-track',
    )
    if (!track) throw new Error('缩略图滚动轨道未渲染')

    Object.defineProperties(track, {
      clientWidth: { configurable: true, value: 140 },
      scrollWidth: { configurable: true, value: 320 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    const scrollBy = vi.fn()
    Object.defineProperty(track, 'scrollBy', { configurable: true, value: scrollBy })

    act(() => track.dispatchEvent(new Event('scroll', { bubbles: true })))

    const previous = view.container.querySelector<HTMLButtonElement>(
      '[aria-label="向左滚动产物"]',
    )
    const next = view.container.querySelector<HTMLButtonElement>('[aria-label="向右滚动产物"]')
    expect(previous?.disabled).toBe(true)
    expect(next?.disabled).toBe(false)

    act(() => next?.click())
    expect(scrollBy).toHaveBeenCalledWith({ left: 112, behavior: 'smooth' })

    track.scrollLeft = 180
    act(() => track.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(previous?.disabled).toBe(false)
    expect(next?.disabled).toBe(true)
  })
})
