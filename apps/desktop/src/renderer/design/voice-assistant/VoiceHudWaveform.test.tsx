// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceHudWaveform } from './VoiceHudWaveform'
import { getAssistantCaptureLevelSink, getAssistantPlaybackLevelSink } from './voiceAssistantLevels'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 覆盖 HUD 像素网格 4×4（v2 设计稿方向 1）+ 聆听光晕的三态接线与数据驱动：
 * - thinking：纯 CSS 对角波纹（无 inline opacity，--g 对角序 / --d 距离档变量就位），光晕静态
 * - listening：网格跟随 capture 电平由中心 2×2 向外推进（领先端分数透明度），
 *   光晕 opacity 同步随电平增亮（安静基线 0.30 可见，呼吸由 CSS 承担）
 * - speaking：只读 playback 电平（两源互斥，capture 不串扰）
 * - wake：一次性弹亮类挂载与超时清理（viz 根类 + halo/网格子选择器）
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

function cells(): HTMLElement[] {
  return container == null ? [] : Array.from(container.querySelectorAll('.voice-hud-grid i'))
}

/** 从第 index 格的 inline style 提取数值属性 */
function styleNumber(index: number, prop: 'opacity' | 'scale'): number {
  const style = cells()[index]?.getAttribute('style') ?? ''
  const match =
    prop === 'opacity' ? style.match(/opacity:\s*([\d.]+)/) : style.match(/scale\(([\d.]+)\)/)
  const raw = match?.[1]
  return raw == null ? Number.NaN : Number.parseFloat(raw)
}

/** 光晕的 inline opacity（数据驱动；thinking 态无 inline 为 NaN） */
function haloOpacity(): number {
  const style = container?.querySelector('.voice-hud-halo')?.getAttribute('style') ?? ''
  const raw = style.match(/opacity:\s*([\d.]+)/)?.[1]
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

  it('renders a 4×4 pixel grid with thinking as pure CSS (no inline opacity)', () => {
    render(<VoiceHudWaveform state="thinking" wake={false} onWakeDone={() => undefined} />)

    const viz = container?.querySelector('.voice-hud-viz')
    expect(viz?.className).toBe('voice-hud-viz is-thinking')
    expect(cells()).toHaveLength(16)
    // 思考态对角波纹由 CSS keyframes 驱动，格上不应有数据驱动的 inline opacity/transform
    expect(cells()[5]?.getAttribute('style')).not.toContain('opacity')
    expect(cells()[5]?.getAttribute('style')).not.toContain('scale')
    // 对角序（行+列）与离中心距离档变量供 CSS 消费：左上角 g=0/d=3，中心格 d=1
    expect(cells()[0]?.getAttribute('style')).toContain('--g: 0')
    expect(cells()[0]?.getAttribute('style')).toContain('--d: 3')
    expect(cells()[5]?.getAttribute('style')).toContain('--d: 1')
    // 思考态无数据源：光晕退为 CSS 静态底光，不应有 inline opacity
    expect(haloOpacity()).toBeNaN()
  })

  it('lights the grid from the center outward with a fractional wavefront as level rises', () => {
    render(<VoiceHudWaveform state="listening" wake={false} onWakeDone={() => undefined} />)
    act(() => {
      getAssistantCaptureLevelSink().push(0.25)
    })

    // 中等电平：波前 lit≈4.89 → 中心 2×2 满亮、点亮序第 4 位分数透明度、四角仍是基线
    expect(styleNumber(5, 'opacity')).toBeCloseTo(1, 2)
    expect(styleNumber(1, 'opacity')).toBeCloseTo(0.889, 2)
    expect(styleNumber(0, 'opacity')).toBeLessThanOrEqual(0.23)
    expect(styleNumber(15, 'opacity')).toBeLessThanOrEqual(0.23)
    // 基线格半尺寸缩放、点亮格满尺寸（设计稿 updateGrid16 的 scale 语义）
    expect(styleNumber(0, 'scale')).toBeCloseTo(0.5, 2)
    expect(styleNumber(5, 'scale')).toBeCloseTo(1, 2)
    // 光晕透明度随同一电平增亮：0.3 + 0.206 × 0.48 ≈ 0.399
    expect(haloOpacity()).toBeCloseTo(0.399, 2)
  })

  it('keeps the halo at its resting baseline and only the center core below the noise gate', () => {
    render(<VoiceHudWaveform state="listening" wake={false} onWakeDone={() => undefined} />)
    act(() => {
      getAssistantCaptureLevelSink().push(0.01)
    })

    // 底噪门限内：lit=2 → 中心两枚保持全亮「心跳核」，其余全部回到基线
    expect(styleNumber(5, 'opacity')).toBeCloseTo(1, 2)
    expect(styleNumber(6, 'opacity')).toBeCloseTo(1, 2)
    expect(styleNumber(9, 'opacity')).toBeLessThanOrEqual(0.23)
    expect(styleNumber(0, 'opacity')).toBeLessThanOrEqual(0.23)
    // 光晕停在安静基线 0.30：聆听态安静时呼吸动效仍可见（CSS scale 呼吸不受影响）
    expect(haloOpacity()).toBeCloseTo(0.3, 2)
  })

  it('drives speaking cells and halo from the playback level only', () => {
    render(<VoiceHudWaveform state="speaking" wake={false} onWakeDone={() => undefined} />)
    act(() => {
      getAssistantCaptureLevelSink().push(0.9)
    })

    // capture 电平不应串扰播报态：播报源为空 → 仅剩心跳核，外圈仍是基线，光晕在基线
    expect(styleNumber(1, 'opacity')).toBeLessThanOrEqual(0.23)
    expect(haloOpacity()).toBeCloseTo(0.3, 2)

    act(() => {
      getAssistantPlaybackLevelSink().push(0.7)
    })
    // 播报 0.7 → 波前 lit≈11.6 → 点亮序第 4 位已满亮
    expect(styleNumber(1, 'opacity')).toBeGreaterThan(0.9)
    const viz = container?.querySelector('.voice-hud-viz')
    expect(viz?.className).toContain('is-speaking')
    // 光晕同步播报电平：0.3 + 0.683 × 0.48 ≈ 0.628
    expect(haloOpacity()).toBeCloseTo(0.628, 2)
  })

  it('plays the wake pop once and reports completion after the settle window', () => {
    vi.useFakeTimers()
    const onWakeDone = vi.fn()
    render(<VoiceHudWaveform state="listening" wake onWakeDone={onWakeDone} />)

    expect(container?.querySelector('.voice-hud-viz')?.className).toContain('is-wake')
    expect(onWakeDone).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(660)
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
