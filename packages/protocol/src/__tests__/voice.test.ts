import { describe, expect, it } from 'vitest'
import {
  VOICE_AUDIO_CHUNK_MAX_SAMPLES,
  isVoiceAudioChunkPayload,
} from '../voice.js'
import { IpcSchemaRegistry } from '../schemas/index.js'

describe('voice audio chunk validation', () => {
  it('accepts a normal worklet frame', () => {
    expect(
      isVoiceAudioChunkPayload({
        sessionId: 'voice-123-1',
        samples: new Int16Array(1600),
      }),
    ).toBe(true)
  })

  it('rejects malformed session ids and oversized payloads', () => {
    expect(
      isVoiceAudioChunkPayload({ sessionId: '../voice', samples: new Int16Array(1600) }),
    ).toBe(false)
    expect(
      isVoiceAudioChunkPayload({
        sessionId: 'voice-123-1',
        samples: new Int16Array(VOICE_AUDIO_CHUNK_MAX_SAMPLES + 1),
      }),
    ).toBe(false)
  })

  it('validates voice invoke requests at the IPC boundary', () => {
    expect(IpcSchemaRegistry['voice:request-microphone-permission'].parse({})).toEqual({})
    expect(() =>
      IpcSchemaRegistry['voice:request-microphone-permission'].parse({ unexpected: true }),
    ).toThrow()
    expect(IpcSchemaRegistry['voice:start'].parse({ sampleRate: 16000 })).toEqual({
      sampleRate: 16000,
    })
    expect(() => IpcSchemaRegistry['voice:start'].parse({ sampleRate: 48000 })).toThrow()
    expect(() => IpcSchemaRegistry['voice:start'].parse({ vadSilenceMs: 60_000 })).toThrow()
    expect(() => IpcSchemaRegistry['voice:stop'].parse({ sessionId: '../other-window' })).toThrow()
  })
})
