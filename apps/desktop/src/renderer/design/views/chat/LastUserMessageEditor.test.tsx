// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LastUserMessageEditor } from './LastUserMessageEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('LastUserMessageEditor', () => {
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

  it('submits with Enter and keeps Shift+Enter for a new line', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(
        <LastUserMessageEditor initialValue="edited" onCancel={vi.fn()} onSubmit={onSubmit} />,
      )
    })
    expect(container.textContent).not.toContain('Enter 发送')
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')

    act(() =>
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      ),
    )
    expect(onSubmit).not.toHaveBeenCalled()
    act(() =>
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    expect(onSubmit).toHaveBeenCalledWith('edited')
  })

  it('cancels with Escape', () => {
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <LastUserMessageEditor initialValue="edited" onCancel={onCancel} onSubmit={vi.fn()} />,
      )
    })
    act(() =>
      container
        .querySelector('textarea')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
