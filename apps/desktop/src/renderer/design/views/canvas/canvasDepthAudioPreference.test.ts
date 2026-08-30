import { describe, expect, it } from 'vitest'
import { resolveDepthVideoPreserveAudio } from './canvasDepthAudioPreference'

describe('resolveDepthVideoPreserveAudio', () => {
  it('defaults to preserving audio when no explicit value is stored', () => {
    expect(resolveDepthVideoPreserveAudio(undefined)).toBe(true)
    expect(resolveDepthVideoPreserveAudio(null)).toBe(true)
  })

  it('respects explicitly stored preferences', () => {
    expect(resolveDepthVideoPreserveAudio(true)).toBe(true)
    expect(resolveDepthVideoPreserveAudio(false)).toBe(false)
  })
})
