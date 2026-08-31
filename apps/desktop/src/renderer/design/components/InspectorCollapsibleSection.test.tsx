// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InspectorCollapsibleSection } from './InspectorCollapsibleSection'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('InspectorCollapsibleSection', () => {
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

  it('defaults to collapsed and exposes a native keyboard-accessible toggle', () => {
    const onAction = vi.fn()
    act(() =>
      root.render(
        <InspectorCollapsibleSection
          title="运行时日志"
          summary={<span className="inspector-count">2 轮</span>}
          headerAction={
            <button type="button" onClick={onAction}>
              日志开关
            </button>
          }
        >
          <div data-testid="content">日志内容</div>
        </InspectorCollapsibleSection>,
      ),
    )

    const toggle = container.querySelector<HTMLButtonElement>(
      '.inspector-collapsible-section__toggle',
    )
    const action = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '日志开关',
    )

    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.getAttribute('aria-controls')).toBeTruthy()
    const controlledContent = document.getElementById(toggle?.getAttribute('aria-controls') ?? '')
    expect(controlledContent?.hidden).toBe(true)
    expect(container.querySelector('[data-testid="content"]')).toBeNull()

    act(() => action?.click())
    expect(onAction).toHaveBeenCalledOnce()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')

    act(() => toggle?.click())
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(controlledContent?.hidden).toBe(false)
    expect(container.querySelector('[data-testid="content"]')?.textContent).toBe('日志内容')
  })
})
