// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ComposerDropOverlay } from './ComposerDropOverlay'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ComposerDropOverlay', () => {
  let container: HTMLDivElement
  let root: Root | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
  })

  it('portals the overlay into the owning chat area instead of covering sibling panels', () => {
    act(() => {
      root?.render(
        <div className="chat-layout">
          <main className="chat-main">
            <ComposerDropOverlay active className="composer-file-drop-overlay">
              drop
            </ComposerDropOverlay>
          </main>
          <aside className="unified-side-panel">code</aside>
        </div>,
      )
    })

    const chatMain = container.querySelector('.chat-main')
    const sidePanel = container.querySelector('.unified-side-panel')
    expect(chatMain?.querySelector('.composer-file-drop-overlay')?.textContent).toBe('drop')
    expect(sidePanel?.querySelector('.composer-file-drop-overlay')).toBeNull()
  })
})
