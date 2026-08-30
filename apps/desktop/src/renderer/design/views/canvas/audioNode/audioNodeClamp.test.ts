/**
 * 音频节点 sub-utils 的纯逻辑单测，覆盖 clamp + 区间算式，不依赖 DOM。
 */
import { describe, expect, it } from 'vitest'
import {
  clampAudioSpeed,
  SPEED_CEIL,
  SPEED_FLOOR,
  SPEED_NOOP_DELTA,
  SPEED_STEP,
} from './CanvasAudioSpeedDrawer'

describe('clampAudioSpeed', () => {
  it('returns the input when inside the valid range', () => {
    expect(clampAudioSpeed(1.5)).toBeCloseTo(1.5, 5)
    expect(clampAudioSpeed(0.3)).toBeCloseTo(0.3, 5)
    expect(clampAudioSpeed(SPEED_FLOOR)).toBeCloseTo(SPEED_FLOOR, 5)
    expect(clampAudioSpeed(SPEED_CEIL)).toBeCloseTo(SPEED_CEIL, 5)
  })

  it('clamps below the floor and above the ceiling', () => {
    expect(clampAudioSpeed(-1)).toBe(SPEED_FLOOR)
    expect(clampAudioSpeed(0)).toBe(SPEED_FLOOR)
    expect(clampAudioSpeed(SPEED_CEIL + 10)).toBe(SPEED_CEIL)
  })

  it('falls back to 1.0 for non-finite inputs', () => {
    expect(clampAudioSpeed(Number.NaN)).toBe(1.0)
    expect(clampAudioSpeed(Number.POSITIVE_INFINITY)).toBe(1.0)
    expect(clampAudioSpeed(Number.NEGATIVE_INFINITY)).toBe(1.0)
  })

  it('keeps SPEED_STEP and SPEED_NOOP_DELTA exported for slider config', () => {
    expect(SPEED_STEP).toBeCloseTo(0.05, 5)
    expect(SPEED_NOOP_DELTA).toBeCloseTo(0.001, 5)
    expect(SPEED_FLOOR).toBeCloseTo(0.1, 5)
    expect(SPEED_CEIL).toBeCloseTo(4.0, 5)
  })
})
