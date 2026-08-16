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
      new URL('../../../../public/voice-capture-processor.js', import.meta.url),
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
    expect(
      transfers.every((transfer, index) => transfer[0] === posted[index]?.samples.buffer),
    ).toBe(true)
  })

  it('attenuates high-frequency content before downsampling to avoid aliasing', () => {
    const workletSource = readFileSync(
      new URL('../../../../public/voice-capture-processor.js', import.meta.url),
      'utf8',
    )
    const posted: VoiceWorkletChunk[] = []
    const registered: Array<new () => TestProcessor> = []

    class MockAudioWorkletProcessor {
      port = {
        postMessage: (chunk: VoiceWorkletChunk) => {
          posted.push(chunk)
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

    const runSine = (frequencyHz: number): number => {
      posted.length = 0
      const processor = new Processor()
      const block = new Float32Array(128)
      const amplitude = 0.5
      // 1 秒：375 个 128-sample 块 @48kHz
      for (let i = 0; i < 375; i += 1) {
        for (let j = 0; j < block.length; j += 1) {
          const t = (i * block.length + j) / 48_000
          block[j] = amplitude * Math.sin(2 * Math.PI * frequencyHz * t)
        }
        processor.process([[block]])
      }
      let sumSquares = 0
      let count = 0
      for (const chunk of posted) {
        for (const s of chunk.samples) {
          sumSquares += (s / 32768) ** 2
          count += 1
        }
      }
      expect(count).toBe(16_000)
      return Math.sqrt(sumSquares / count)
    }

    const speechBandRms = runSine(440)
    const highFreqRms = runSine(15_000)

    // 440Hz 应近乎无损通过；15kHz（会折叠成 1kHz 混叠）被低通显著衰减
    expect(speechBandRms).toBeGreaterThan(0.3)
    expect(highFreqRms).toBeLessThan(speechBandRms * 0.35)
  })
})
