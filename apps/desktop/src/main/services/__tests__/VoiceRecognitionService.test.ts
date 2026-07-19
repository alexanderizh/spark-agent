import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../VoiceIntegrityService.js', () => ({
  resolveVoiceModelPaths: () => null,
}))

import {
  setVoiceEventEmitter,
  startVoiceSession,
} from '../VoiceRecognitionService.js'

afterEach(() => setVoiceEventEmitter(null))

describe('VoiceRecognitionService', () => {
  it('keeps recognition errors scoped to the renderer that owns the session', () => {
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const result = startVoiceSession({ sampleRate: 16000 }, 77)

    expect(result.success).toBe(false)
    expect(result.error).toContain('请先在设置中安装语音包')
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
      77,
    )
  })
})
