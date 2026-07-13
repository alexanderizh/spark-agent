// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivitySegment } from './ActivitySegment'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ActivitySegment', () => {
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

  const toggle = (index = 0): HTMLButtonElement => {
    const button = container.querySelectorAll<HTMLButtonElement>('.chat-activity-segment-toggle')[
      index
    ]
    if (button == null) throw new Error(`Missing activity segment toggle ${index}`)
    return button
  }

  it('auto-collapses the current segment while it is running', () => {
    act(() => {
      root.render(
        <ActivitySegment summary="查看了 2 个文件" running sealed={false} autoCollapseEnabled>
          <div>活动明细</div>
        </ActivitySegment>,
      )
    })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('活动明细')

    act(() => {
      root.render(
        <ActivitySegment
          summary="查看了 2 个文件"
          running={false}
          sealed={false}
          autoCollapseEnabled
        >
          <div>活动明细</div>
        </ActivitySegment>,
      )
    })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    act(() => {
      root.render(
        <ActivitySegment summary="查看了 2 个文件" running={false} sealed autoCollapseEnabled>
          <div>活动明细</div>
        </ActivitySegment>,
      )
    })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('活动明细')
  })

  it('gives a manually expanded segment permanent independent control', () => {
    const render = (summary: string, running: boolean, sealed: boolean) => {
      root.render(
        <ActivitySegment summary={summary} running={running} sealed={sealed} autoCollapseEnabled>
          <div>活动明细</div>
        </ActivitySegment>,
      )
    }

    act(() => render('查看了 1 个文件', true, false))
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    act(() => toggle().click())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    act(() => render('查看了 2 个文件', false, false))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    act(() => render('查看了 2 个文件', false, true))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    act(() => toggle().click())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    act(() => render('查看了 3 个文件', true, false))
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps user choices isolated between activity segments', () => {
    act(() => {
      root.render(
        <>
          <ActivitySegment summary="第一段" running={false} sealed autoCollapseEnabled>
            <div>第一段明细</div>
          </ActivitySegment>
          <ActivitySegment summary="第二段" running={false} sealed autoCollapseEnabled>
            <div>第二段明细</div>
          </ActivitySegment>
        </>,
      )
    })

    act(() => toggle(0).click())

    expect(toggle(0).getAttribute('aria-expanded')).toBe('true')
    expect(toggle(1).getAttribute('aria-expanded')).toBe('false')
  })

  it('does not auto-collapse when the appearance preference is disabled', () => {
    act(() => {
      root.render(
        <ActivitySegment
          summary="查看了 2 个文件"
          running={false}
          sealed
          autoCollapseEnabled={false}
        >
          <div>活动明细</div>
        </ActivitySegment>,
      )
    })

    expect(toggle().getAttribute('aria-expanded')).toBe('true')
  })

  it('preserves manual disclosure state while a parent hides and shows the segment', () => {
    const render = (hidden: boolean) => {
      root.render(
        <div style={{ display: hidden ? 'none' : 'block' }}>
          <ActivitySegment summary="查看了 2 个文件" running={false} sealed autoCollapseEnabled>
            <div>活动明细</div>
          </ActivitySegment>
        </div>,
      )
    }

    act(() => render(false))
    act(() => toggle().click())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    act(() => render(true))
    act(() => render(false))

    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('活动明细')
  })
})
