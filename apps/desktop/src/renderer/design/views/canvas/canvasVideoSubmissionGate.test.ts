import { describe, expect, it } from 'vitest'
import { buildVideoSubmissionChecks, isVideoSubmissionOperation } from './canvasVideoSubmissionGate'

describe('canvasVideoSubmissionGate', () => {
  it('recognizes all canvas video submission operations', () => {
    expect(isVideoSubmissionOperation('text_to_video')).toBe(true)
    expect(isVideoSubmissionOperation('image_to_video')).toBe(true)
    expect(isVideoSubmissionOperation('text_to_image')).toBe(false)
  })

  it('detects assets, style and camera information without making them mandatory', () => {
    const checks = buildVideoSubmissionChecks({
      prompt: '电影感冷色调，中景推镜，人物缓慢转身并说出对白',
      imageCount: 2,
      modelParams: { duration: 5, fps: 24 },
    })
    expect(checks.every((check) => check.detected)).toBe(true)
  })
})
