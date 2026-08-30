// @vitest-environment jsdom

import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivitySegment } from './ActivitySegment'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const activitySegmentCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/design/views/chat/ActivitySegment.css'),
  'utf8',
)

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

  it('renders a single activity item directly without the redundant segment disclosure', () => {
    act(() => {
      root.render(
        <ActivitySegment summary="查看了 1 个文件" running={false} sealed autoCollapseEnabled>
          <div className="single-activity-item">查看 1 个文件</div>
        </ActivitySegment>,
      )
    })

    expect(container.querySelector('.chat-activity-segment')).toBeNull()
    expect(container.querySelector('.chat-activity-segment-toggle')).toBeNull()
    expect(container.querySelector('.single-activity-item')).not.toBeNull()
  })

  it('ignores empty renderer fragments when deciding whether a segment has one item', () => {
    act(() => {
      root.render(
        <ActivitySegment summary="运行了 1 条命令" running={false} sealed autoCollapseEnabled>
          <div className="single-command-item">执行 1 条命令</div>
          <React.Fragment>{null}</React.Fragment>
        </ActivitySegment>,
      )
    })

    expect(container.querySelector('.chat-activity-segment')).toBeNull()
    expect(container.querySelector('.single-command-item')).not.toBeNull()
  })

  it('hides a direct single activity item with the master tool-log visibility toggle', () => {
    act(() => {
      root.render(
        <div className="msg-bubble-agent tool-logs-hidden">
          <ActivitySegment summary="查看了 1 个文件" running={false} sealed autoCollapseEnabled>
            <div>查看 1 个文件</div>
          </ActivitySegment>
        </div>,
      )
    })

    const singleItem = container.querySelector<HTMLElement>('.chat-activity-segment-single')
    expect(singleItem).not.toBeNull()
    expect(activitySegmentCss).toMatch(
      /\.msg-bubble-agent\.tool-logs-hidden[\s\S]*\.chat-activity-segment-single\s*\{\s*display:\s*none/,
    )
  })

  it('keeps the segment disclosure when it contains multiple activity items', () => {
    act(() => {
      root.render(
        <ActivitySegment
          summary="查看了 1 个文件 · 进行了思考"
          running={false}
          sealed
          autoCollapseEnabled
        >
          <div>查看 1 个文件</div>
          <div>思考过程</div>
        </ActivitySegment>,
      )
    })

    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('查看 1 个文件')
    expect(container.textContent).not.toContain('思考过程')
  })

  it('auto-collapses the current segment while it is running', () => {
    act(() => {
      root.render(
        <ActivitySegment summary="查看了 2 个文件" running sealed={false} autoCollapseEnabled>
          <div>活动明细</div>
          <div>更多活动</div>
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
          <div>更多活动</div>
        </ActivitySegment>,
      )
    })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')

    act(() => {
      root.render(
        <ActivitySegment summary="查看了 2 个文件" running={false} sealed autoCollapseEnabled>
          <div>活动明细</div>
          <div>更多活动</div>
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
          <div>更多活动</div>
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
            <div>第一段更多活动</div>
          </ActivitySegment>
          <ActivitySegment summary="第二段" running={false} sealed autoCollapseEnabled>
            <div>第二段明细</div>
            <div>第二段更多活动</div>
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
          <div>更多活动</div>
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
            <div>更多活动</div>
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
