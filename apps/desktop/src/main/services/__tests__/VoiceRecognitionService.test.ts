import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({ modelDir: '' }))

vi.mock('../VoiceIntegrityService.js', () => ({
  resolveVoiceModelPaths: () =>
    mockState.modelDir
      ? { nativeMain: join(mockState.modelDir, 'index.js'), modelDir: mockState.modelDir }
      : null,
}))

import {
  feedVoiceAudio,
  resetVoiceEngineCache,
  setVoiceEventEmitter,
  setVoiceModuleForTests,
  startVoiceSession,
} from '../VoiceRecognitionService.js'

afterEach(() => {
  resetVoiceEngineCache()
  setVoiceEventEmitter(null)
  setVoiceModuleForTests(null)
})

/** 可脚本化的 fake sherpa 模块：endpoint 后补静音时吐出滞留的尾字。 */
function createFakeModule(script: { partial: string; finalAfterFlush: string }) {
  const configs: Array<Record<string, unknown>> = []
  const recognizers: FakeRecognizer[] = []

  class FakeStream {
    silenceFeeds = 0
    totalSilenceFeeds = 0
    acceptWaveform({ samples }: { samples: Float32Array; sampleRate: number }): void {
      let allSilence = samples.length > 0
      for (const s of samples) {
        if (s !== 0) {
          allSilence = false
          break
        }
      }
      if (allSilence) {
        this.silenceFeeds += 1
        this.totalSilenceFeeds += 1
      }
    }
    inputFinished(): void {}
  }

  class FakeRecognizer {
    readonly stream = new FakeStream()
    endpointArmed = false
    resetCount = 0

    constructor(config: unknown) {
      configs.push(config as Record<string, unknown>)
      recognizers.push(this)
    }

    createStream() {
      return this.stream
    }
    isReady() {
      return false
    }
    decode(): void {}
    isEndpoint() {
      return this.endpointArmed
    }
    reset(): void {
      this.resetCount += 1
      this.stream.silenceFeeds = 0
    }
    getResult() {
      return {
        text: this.stream.silenceFeeds > 0 ? script.finalAfterFlush : script.partial,
      }
    }
  }

  return { mod: { OnlineRecognizer: FakeRecognizer }, configs, recognizers }
}

function setupModelFixture(): void {
  if (mockState.modelDir) return
  const dir = mkdtempSync(join(tmpdir(), 'voice-model-'))
  writeFileSync(
    join(dir, 'model-package.json'),
    JSON.stringify({
      version: '1.0.0-test',
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      tokens: 'tokens.txt',
    }),
  )
  for (const file of ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']) {
    writeFileSync(join(dir, file), '')
  }
  mockState.modelDir = dir
}

beforeAll(setupModelFixture)

describe('VoiceRecognitionService', () => {
  it('keeps recognition errors scoped to the renderer that owns the session', () => {
    // 该用例依赖 resolveVoiceModelPaths 返回 null；临时清空 fixture 指向。
    const restore = mockState.modelDir
    mockState.modelDir = ''
    try {
      const emit = vi.fn()
      setVoiceEventEmitter(emit)

      const result = startVoiceSession({ sampleRate: 16000 }, 77)

      expect(result.success).toBe(false)
      expect(result.error).toContain('请先在设置中安装语音包')
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }), 77)
    } finally {
      mockState.modelDir = restore
    }
  })

  it('flushes trailing tokens with silence before locking final and resetting at endpoint', () => {
    const { mod, configs, recognizers } = createFakeModule({
      partial: '你好',
      finalAfterFlush: '你好吗',
    })
    setVoiceModuleForTests(mod)
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: 16000 }, 1)
    expect(handle.success).toBe(true)
    const sessionId = handle.sessionId as string

    const speech = new Int16Array(1600).fill(8000)
    feedVoiceAudio(sessionId, speech, 1)
    // endpoint 前只推 partial
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'partial', text: '你好' }), 1)

    const recognizer = recognizers[0]
    if (!recognizer) throw new Error('recognizer was not created')
    recognizer.endpointArmed = true
    feedVoiceAudio(sessionId, speech, 1)

    // endpoint 后必须先补静音逼出尾字，再 reset：final 是 flush 后的完整文本
    const finalCalls = emit.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === 'final',
    )
    expect(finalCalls).toHaveLength(1)
    expect((finalCalls[0]?.[0] as { text?: string }).text).toBe('你好吗')
    expect(recognizer.stream.totalSilenceFeeds).toBeGreaterThan(0)
    expect(recognizer.resetCount).toBe(1)
  })

  it('builds the recognizer with multi-thread decode and a safe endpoint silence threshold', () => {
    const { mod, configs } = createFakeModule({ partial: 'a', finalAfterFlush: 'ab' })
    setVoiceModuleForTests(mod)
    setVoiceEventEmitter(vi.fn())

    const handle = startVoiceSession({ sampleRate: 16000 }, 2)
    expect(handle.success).toBe(true)

    const config = configs[0] as {
      modelConfig?: { numThreads?: number }
      rule1MinTrailingSilence?: number
    }
    expect(config.modelConfig?.numThreads).toBe(2)
    expect(config.rule1MinTrailingSilence).toBeGreaterThanOrEqual(0.8)
  })
})
