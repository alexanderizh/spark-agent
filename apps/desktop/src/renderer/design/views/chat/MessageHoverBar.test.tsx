// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageHoverBar } from './MessageHoverBar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../hooks/useAppearance', () => ({
  readAppearance: () => ({ timestampFormat: 'abs' }),
}))

describe('MessageHoverBar', () => {
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

  it('places the fork icon before delete and keeps it icon-only', () => {
    const onFork = vi.fn()
    const onDelete = vi.fn()

    act(() => {
      root.render(
        <MessageHoverBar
          timestamp="2026-08-14T00:00:00.000Z"
          textContent="内容"
          position="left"
          onFork={onFork}
          onDelete={onDelete}
        />,
      )
    })

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.msg-hover-bar button'),
    )
    expect(buttons.map((button) => button.className)).toEqual([
      'msg-hover-copy',
      'msg-hover-fork',
      'msg-hover-delete',
    ])
    expect(buttons[1]?.textContent).toBe('')
    expect(buttons[1]?.getAttribute('aria-label')).toBe('从此处分支')

    act(() => buttons[1]?.click())
    expect(onFork).toHaveBeenCalledOnce()
  })
})
