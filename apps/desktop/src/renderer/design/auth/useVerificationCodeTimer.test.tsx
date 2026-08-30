// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVerificationCodeTimer } from './useVerificationCodeTimer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('useVerificationCodeTimer', () => {
  let container: HTMLDivElement
  let root: Root
  let timerState: ReturnType<typeof useVerificationCodeTimer>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'))
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('separates the 60 second resend cooldown from the server expiry deadline', () => {
    function Harness(): React.ReactElement {
      timerState = useVerificationCodeTimer()
      return <span>{timerState.resendCountdown}</span>
    }

    act(() => {
      root = createRoot(container)
      root.render(<Harness />)
    })
    act(() => timerState.start(300))
    expect(timerState.resendCountdown).toBe(60)
    expect(timerState.isCodeActive).toBe(true)

    act(() => vi.advanceTimersByTime(61_000))
    expect(timerState.resendCountdown).toBe(0)
    expect(timerState.isCodeActive).toBe(true)

    act(() => vi.advanceTimersByTime(239_000))
    expect(timerState.isCodeActive).toBe(false)
    expect(timerState.isExpired).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks the wall clock synchronously after an application sleep', () => {
    function Harness(): React.ReactElement {
      timerState = useVerificationCodeTimer()
      return <span>{timerState.resendCountdown}</span>
    }

    act(() => {
      root = createRoot(container)
      root.render(<Harness />)
    })
    const requestedAt = Date.now()
    vi.setSystemTime(new Date('2026-07-14T00:00:30Z'))
    act(() => timerState.start(300, requestedAt))
    expect(timerState.resendCountdown).toBe(30)
    vi.setSystemTime(new Date('2026-07-14T00:05:01Z'))

    expect(timerState.isCodeActive).toBe(true)
    expect(timerState.isActiveNow()).toBe(false)
  })
})
