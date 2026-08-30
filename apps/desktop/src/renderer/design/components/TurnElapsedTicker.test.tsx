// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TurnElapsedTicker } from './TurnElapsedTicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('TurnElapsedTicker', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T00:00:00Z'))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  const renderTicker = (startedAt: string) => {
    act(() => {
      root.render(<TurnElapsedTicker startedAt={startedAt} />)
    })
    return () => container.querySelector('.agent-task-running-elapsed')?.textContent ?? null
  }

  it('挂载即显示当前耗时（<1s 记 1s），并随时间每秒自刷新', () => {
    const startedAt = new Date().toISOString()
    const getText = renderTicker(startedAt)

    expect(getText()).toBe('· 1s')

    act(() => {
      vi.advanceTimersByTime(34_000)
    })
    expect(getText()).toBe('· 34s')
  })

  it('时间戳无法解析时不渲染，避免「NaNs」', () => {
    const getText = renderTicker('not-a-timestamp')
    expect(container.querySelector('.agent-task-running-elapsed')).toBeNull()
    expect(getText()).toBeNull()
  })

  it('卸载后清掉定时器', () => {
    renderTicker(new Date().toISOString())
    expect(vi.getTimerCount()).toBe(1)

    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })
})
