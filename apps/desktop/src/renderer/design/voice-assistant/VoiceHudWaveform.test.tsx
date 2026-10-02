// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceHudWaveform } from './VoiceHudWaveform'
import { getAssistantCaptureLevelSink, getAssistantPlaybackLevelSink } from './voiceAssistantLevels'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖 HUD 声波条的三态接线与数据驱动：
 * - thinking：纯 CSS 行波（无 inline transform）
 * - listening：跟随 capture 电平，中段条按人声权重更高，底噪回落基线
 * - speaking：只读 playback 电平（两源互斥，capture 不串扰）
 * - wake：一次性弹跳类挂载与超时清理
 */

let container: HTMLElement | null = null
let root: Root | null = null

function render(element: React.ReactElement): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(element)
  })
}

function bars(): HTMLElement[] {
  return container == null ? [] : Array.from(container.querySelectorAll('.voice-hud-waveform i'))
}

/** 从第 index 条的 inline style 提取 scaleY 数值 */
function scaleYOf(index: number): number {
  const transform = bars()[index]?.getAttribute('style') ?? ''
  const match = transform.match(/transform:\s*scaleY\(([\d.]+)\)/)
  const raw = match?.[1]
  return raw == null ? Number.NaN : Number.parseFloat(raw)
}

describe('VoiceHudWaveform', () => {
  beforeEach(() => {
    getAssistantCaptureLevelSink().reset()
    getAssistantPlaybackLevelSink().reset()
  })

  afterEach(() => {
    if (root != null) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container?.remove()
    container = null
    vi.useRealTimers()
  })

  it('renders 16 bars with thinking state as pure CSS (no inline transform)', () => {
    render(<VoiceHudWaveform state="thinking" wake={false} onWakeDone={() => undefined} />)

    const box = container?.querySelector('.voice-hud-waveform')
    expect(box?.className).toBe('voice-hud-waveform is-thinking')
    expect(bars()).toHaveLength(16)
    // 思考态行波由 CSS keyframes 驱动，条上不应有数据驱动的 inline transform
    expect(bars()[8]?.getAttribute('style')).not.toContain('transform')
  })

  it('drives listening bars from the capture level with a center-weighted profile', () => {
    render(<VoiceHudWaveform state="listening" wake={false} onWakeDone={() => undefined} />)
    act(() => {
      getAssistantCaptureLevelSink().push(0.8)
    })

    const edge = scaleYOf(0)
    const middle = scaleYOf(8)
    expect(Number.isNaN(edge)).toBe(false)
    // 中段条按人声频段权重高于边缘条
    expect(middle).toBeGreaterThan(edge)
    expect(middle).toBeGreaterThan(0.5)
  })

  it('falls back to the baseline profile when the capture level is below the noise gate', () => {
    render(<VoiceHudWaveform state="listening" wake={false} onWakeDone={() => undefined} />)
    act(() => {
      getAssistantCaptureLevelSink().push(0.01)
    })

    // 底噪门限内：条只剩基线高度（远低于说话时的中段值）
    expect(scaleYOf(8)).toBeLessThanOrEqual(0.2)
  })

  it('drives speaking bars from the playback level only', () => {
    render(<VoiceHudWaveform state="speaking" wake={false} onWakeDone={() => undefined} />)
    act(() => {
      getAssistantCaptureLevelSink().push(0.9)
    })

    // capture 电平不应串扰播报态
    expect(scaleYOf(8)).toBeLessThanOrEqual(0.2)

    act(() => {
      getAssistantPlaybackLevelSink().push(0.7)
    })
    const middle = scaleYOf(8)
    expect(middle).toBeGreaterThan(0.4)
    const box = container?.querySelector('.voice-hud-waveform')
    expect(box?.className).toContain('is-speaking')
  })

  it('plays the wake pulse once and reports completion after the settle window', () => {
    vi.useFakeTimers()
    const onWakeDone = vi.fn()
    render(<VoiceHudWaveform state="listening" wake onWakeDone={onWakeDone} />)

    expect(container?.querySelector('.voice-hud-waveform')?.className).toContain('is-wake')
    expect(onWakeDone).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(620)
    })
    expect(onWakeDone).toHaveBeenCalledTimes(1)
  })

  it('never schedules a wake cleanup while wake is false', () => {
    vi.useFakeTimers()
    const onWakeDone = vi.fn()
    render(<VoiceHudWaveform state="listening" wake={false} onWakeDone={onWakeDone} />)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onWakeDone).not.toHaveBeenCalled()
  })
})
