import { describe, expect, it, vi } from 'vitest'
import { createVoiceAudioLevelStore, EMPTY_VOICE_WAVEFORM } from './voiceAudioLevel'

describe('voice audio level store', () => {
  it('keeps a bounded waveform history and notifies only its own subscribers', () => {
    const store = createVoiceAudioLevelStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.push(0.5)
    store.push(4)

    expect(store.getSnapshot()).toHaveLength(2)
    expect(store.getSnapshot().slice(-2)).toEqual([0.5, 1])
    expect(listener).toHaveBeenCalledTimes(2)

    for (let index = 0; index < 24; index += 1) store.push(index / 24)
    expect(store.getSnapshot()).toHaveLength(18)

    unsubscribe()
    store.reset()
    expect(store.getSnapshot()).toBe(EMPTY_VOICE_WAVEFORM)
    expect(listener).toHaveBeenCalledTimes(26)
  })
})
