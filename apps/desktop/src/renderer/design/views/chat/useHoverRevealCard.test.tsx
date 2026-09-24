// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOVER_REVEAL_OPEN_DELAY_MS, useHoverRevealCard } from './useHoverRevealCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ enabled }: { enabled: boolean }) {
  const { target, hover, leave, dismiss } = useHoverRevealCard(enabled)
  const anchorRef = React.useRef<HTMLDivElement | null>(null)
  return (
    <div data-state={target == null ? 'idle' : `open:${target.key}`} data-enabled={enabled}>
      <div ref={anchorRef} data-testid="anchor" />
      <button className="hover" onClick={() => hover('row-1', anchorRef.current)}>
        hover
      </button>
      <button
        className="hover-now"
        onClick={() => hover('row-1', anchorRef.current, { immediate: true })}
      >
        hover-now
      </button>
      <button className="leave" onClick={leave}>
        leave
      </button>
      <button className="dismiss" onClick={dismiss}>
        dismiss
      </button>
    </div>
  )
}

describe('useHoverRevealCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function state(): string | undefined {
    return container.firstElementChild?.getAttribute('data-state') ?? undefined
  }

  function click(selector: string): void {
    act(() => container.querySelector<HTMLButtonElement>(selector)?.click())
  }

  it('opens only after the hover delay', () => {
    act(() => root.render(<Harness enabled />))
    click('.hover')
    expect(state()).toBe('idle')

    act(() => {
      vi.advanceTimersByTime(HOVER_REVEAL_OPEN_DELAY_MS - 1)
    })
    expect(state()).toBe('idle')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(state()).toBe('open:row-1')
  })

  it('opens immediately for keyboard focus and closes on leave', () => {
    act(() => root.render(<Harness enabled />))
    click('.hover-now')
    expect(state()).toBe('open:row-1')

    click('.leave')
    expect(state()).toBe('idle')
  })

  it('cancels a pending delayed open when the pointer leaves', () => {
    act(() => root.render(<Harness enabled />))
    click('.hover')
    click('.leave')
    act(() => {
      vi.advanceTimersByTime(HOVER_REVEAL_OPEN_DELAY_MS)
    })
    expect(state()).toBe('idle')
  })

  it('ignores hover while the picker is closed', () => {
    act(() => root.render(<Harness enabled={false} />))
    click('.hover-now')
    expect(state()).toBe('idle')
  })

  it('closes on menu scroll while open', () => {
    act(() => root.render(<Harness enabled />))
    click('.hover-now')
    expect(state()).toBe('open:row-1')

    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(state()).toBe('idle')
  })

  it('closes on window resize while open', () => {
    act(() => root.render(<Harness enabled />))
    click('.hover-now')
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(state()).toBe('idle')
  })

  it('dismisses on demand', () => {
    act(() => root.render(<Harness enabled />))
    click('.hover-now')
    click('.dismiss')
    expect(state()).toBe('idle')
  })
})
