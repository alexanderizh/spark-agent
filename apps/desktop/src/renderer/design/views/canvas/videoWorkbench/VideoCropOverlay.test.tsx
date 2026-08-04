// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoCropOverlay } from './VideoCropOverlay'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function pointerEvent(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: 1 },
  })
  return event
}

describe('VideoCropOverlay', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('draws a new selection and reports the same even-pixel size shown in the badge', async () => {
    const onConfirm = vi.fn()
    act(() => {
      root.render(
        <VideoCropOverlay
          bounds={{ left: 0, top: 0, width: 1000, height: 500 }}
          rect={{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }}
          sourceWidth={1280}
          sourceHeight={720}
          busy={false}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      )
    })

    const overlay = container.querySelector<HTMLElement>('.vwb-crop-overlay')
    expect(overlay).not.toBeNull()
    if (!overlay) throw new Error('crop overlay not rendered')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    await act(async () => {
      overlay.dispatchEvent(pointerEvent('pointerdown', 50, 100))
      overlay.dispatchEvent(pointerEvent('pointermove', 650, 400))
      overlay.dispatchEvent(pointerEvent('pointerup', 650, 400))
    })

    expect(container.querySelector('.vwb-crop-size')?.textContent).toContain('768 × 432 px')
    const confirm = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('确认裁剪'),
    )
    expect(confirm).toBeDefined()
    await act(async () => confirm?.click())

    expect(onConfirm).toHaveBeenCalledWith({ x: 0.05, y: 0.2, width: 0.6, height: 0.6 })
  })
})
