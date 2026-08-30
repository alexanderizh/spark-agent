// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CancellationNotice } from './CancellationNotice'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CancellationNotice', () => {
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

  it('renders cancellation as a compact status rather than a diagnostic card', () => {
    act(() => root.render(<CancellationNotice />))

    expect(container.textContent).toBe('已取消本次任务')
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector('.runtime-diagnostic-card')).toBeNull()
  })
})
