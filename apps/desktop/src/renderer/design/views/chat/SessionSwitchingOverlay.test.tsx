// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionSwitchingOverlay } from './SessionSwitchingOverlay'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SessionSwitchingOverlay', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders a presentation-only loading mask for its positioning host', () => {
    const host = document.createElement('section')
    document.body.appendChild(host)
    act(() => root.render(<SessionSwitchingOverlay host={host} />))

    const overlay = host.querySelector('.chat-switching-overlay')
    expect(overlay).not.toBeNull()
    expect(container.querySelector('.chat-switching-overlay')).toBeNull()
    expect(overlay?.getAttribute('aria-hidden')).toBe('true')
    expect(overlay?.querySelector('svg')).not.toBeNull()
    host.remove()
  })
})
