import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RendererCrashRecovery,
  type RendererReloadTarget,
} from './renderer-crash-recovery.js'

function makeTarget() {
  const target: RendererReloadTarget = {
    getURL: () => 'app://renderer',
    isDestroyed: () => false,
    reload: vi.fn(),
  }
  return target
}

describe('RendererCrashRecovery', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('throttles repeated reloads for one renderer, then retries the latest crash', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T00:00:00.000Z'))
    const target = makeTarget()
    const recovery = new RendererCrashRecovery(() => false, { warn: vi.fn() })

    recovery.handleGone(target, 'crashed')
    expect(target.reload).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_000)
    recovery.handleGone(target, 'crashed')
    expect(target.reload).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(49_999)
    expect(target.reload).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(target.reload).toHaveBeenCalledTimes(2)
  })

  it('keeps crash throttling independent for different renderer windows', () => {
    const first = makeTarget()
    const second = makeTarget()
    const recovery = new RendererCrashRecovery(() => false, { warn: vi.fn() })

    recovery.handleGone(first, 'crashed')
    recovery.handleGone(second, 'crashed')

    expect(first.reload).toHaveBeenCalledOnce()
    expect(second.reload).toHaveBeenCalledOnce()
  })

  it('does not reload during shutdown, for non-crash exits, or after destruction', () => {
    vi.useFakeTimers()
    let quitting = true
    const quittingTarget = makeTarget()
    const normalExitTarget = makeTarget()
    const destroyedTarget = { ...makeTarget(), isDestroyed: () => true }
    const recovery = new RendererCrashRecovery(() => quitting, { warn: vi.fn() })

    recovery.handleGone(quittingTarget, 'crashed')
    quitting = false
    recovery.handleGone(normalExitTarget, 'clean-exit')
    recovery.handleGone(destroyedTarget, 'crashed')
    vi.runAllTimers()

    expect(quittingTarget.reload).not.toHaveBeenCalled()
    expect(normalExitTarget.reload).not.toHaveBeenCalled()
    expect(destroyedTarget.reload).not.toHaveBeenCalled()
  })

  it('cancels a delayed reload when the app starts quitting', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T00:00:00.000Z'))
    let quitting = false
    const target = makeTarget()
    const recovery = new RendererCrashRecovery(() => quitting, { warn: vi.fn() })

    recovery.handleGone(target, 'crashed')
    vi.advanceTimersByTime(10_000)
    recovery.handleGone(target, 'crashed')
    quitting = true
    vi.advanceTimersByTime(50_000)

    expect(target.reload).toHaveBeenCalledOnce()
  })
})
