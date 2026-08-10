// @vitest-environment jsdom

import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiagramViewport } from './DiagramViewport'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('DiagramViewport', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const renderViewport = (fullscreen = false): void => {
    act(() => {
      root.render(
        <DiagramViewport fullscreen={fullscreen} ariaLabel="测试图表">
          <div style={{ width: 1200, height: 700 }}>diagram</div>
        </DiagramViewport>,
      )
    })
  }

  const zoomLabel = (): string | null =>
    container.querySelector('[data-diagram-zoom-label]')?.textContent ?? null

  it('starts at 100% and exposes zoom, reset and fit controls', () => {
    renderViewport()
    expect(zoomLabel()).toBe('100%')
    expect(container.querySelector('[aria-label="缩小图表"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="重置图表缩放为 100%"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="放大图表"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="适应图表窗口"]')).not.toBeNull()
  })

  it('changes zoom with buttons and resets to 100%', () => {
    renderViewport()
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="放大图表"]')?.click())
    expect(zoomLabel()).toBe('110%')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="缩小图表"]')?.click())
    expect(zoomLabel()).toBe('100%')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="缩小图表"]')?.click())
    expect(zoomLabel()).toBe('90%')
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="重置图表缩放为 100%"]')?.click(),
    )
    expect(zoomLabel()).toBe('100%')
  })

  it('keeps ordinary inline wheel scrolling and only zooms with Ctrl/Cmd', () => {
    renderViewport()
    const viewport = container.querySelector<HTMLElement>('[data-diagram-viewport]')
    expect(viewport).not.toBeNull()
    act(() => viewport?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })))
    expect(zoomLabel()).toBe('100%')
    act(() =>
      viewport?.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120 }),
      ),
    )
    expect(zoomLabel()).toBe('110%')
  })

  it('uses plain wheel zoom in fullscreen mode', () => {
    renderViewport(true)
    const viewport = container.querySelector<HTMLElement>('[data-diagram-viewport]')
    act(() =>
      viewport?.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }),
      ),
    )
    expect(zoomLabel()).toBe('110%')
  })

  it('uses a non-passive native wheel listener so zoom can prevent page scrolling', () => {
    const source = readFileSync(resolve(__dirname, 'DiagramViewport.tsx'), 'utf8')
    expect(source).toContain("addEventListener('wheel'")
    expect(source).toContain('{ passive: false }')
    expect(source).not.toContain('onWheel={')
  })
})
