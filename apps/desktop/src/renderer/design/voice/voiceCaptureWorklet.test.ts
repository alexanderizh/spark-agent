// @vitest-environment node

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVoiceWorkletUrl, type VoiceWorkletChunk } from './voiceCaptureWorklet'

interface TestProcessor {
  outLength: number
  process(inputs: Float32Array[][]): boolean
}

describe('voice capture worklet resampling', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resolves a same-origin public asset instead of a CSP-blocked blob URL', () => {
    vi.stubGlobal('window', { location: { href: 'https://app.local/chat' } })

    expect(getVoiceWorkletUrl()).toBe('https://app.local/voice-capture-processor.js')
    expect(getVoiceWorkletUrl()).not.toMatch(/^(blob|data):/)
  })

  it('preserves resampling phase across 128-sample blocks', () => {
    const workletSource = readFileSync(
      new URL('../../public/voice-capture-processor.js', import.meta.url),
      'utf8',
    )
    const posted: VoiceWorkletChunk[] = []
    const transfers: Array<ArrayBufferLike[]> = []
    const registered: Array<new () => TestProcessor> = []

    class MockAudioWorkletProcessor {
      port = {
        postMessage: (chunk: VoiceWorkletChunk, transfer: ArrayBufferLike[]) => {
          posted.push(chunk)
          transfers.push(transfer)
        },
      }
    }

    runInNewContext(workletSource, {
      AudioWorkletProcessor: MockAudioWorkletProcessor,
      Float32Array,
      Int16Array,
      sampleRate: 48_000,
      registerProcessor: (_name: string, ctor: new () => TestProcessor) => {
        registered.push(ctor)
      },
    })

    const Processor = registered[0]
    if (!Processor) throw new Error('worklet processor was not registered')
    const processor = new Processor()
    const block = new Float32Array(128)
    // 375 * 128 = 48,000 input samples, exactly one second at 48kHz.
    for (let i = 0; i < 375; i += 1) processor.process([[block]])

    const outputSamples =
      posted.reduce((total, chunk) => total + chunk.samples.length, 0) + processor.outLength
    expect(outputSamples).toBe(16_000)
    expect(posted).toHaveLength(10)
    expect(posted.every((chunk) => chunk.level === 0)).toBe(true)
    expect(transfers.every((transfer, index) => transfer[0] === posted[index]?.samples.buffer)).toBe(true)
  })
})
