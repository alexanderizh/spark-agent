import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({ modelDir: '', refineReady: false }))

vi.mock('../VoiceIntegrityService.js', () => ({
  resolveVoiceModelPaths: () =>
    mockState.modelDir
      ? { nativeMain: join(mockState.modelDir, 'index.js'), modelDir: mockState.modelDir }
      : null,
  resolveVoiceRefinePaths: () =>
    mockState.refineReady
      ? {
          version: '1.0.0-refine',
          modelPath: '/fake/model.int8.onnx',
          tokensPath: '/fake/tokens.txt',
        }
      : null,
}))

import {
  feedVoiceAudio,
  getActiveVoiceSessionCount,
  resetVoiceEngineCache,
  setVoiceEventEmitter,
  setVoiceModuleForTests,
  startVoiceSession,
  stopVoiceSession,
} from '../VoiceRecognitionService.js'

afterEach(() => {
  resetVoiceEngineCache()
  setVoiceEventEmitter(null)
  setVoiceModuleForTests(null)
  mockState.refineReady = false
})

/** 可脚本化的 fake sherpa 模块：endpoint 后补静音时吐出滞留的尾字。 */
function createFakeModule(script: {
  partial: string
  finalAfterFlush: string
  /** 提供时模拟 native 包携带 OfflineRecognizer（离线整段精修能力） */
  offline?: { text: string }
}) {
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

  const offlineConfigs: Array<Record<string, unknown>> = []

  class FakeOfflineStream {
    acceptedSamples: Float32Array | null = null
    acceptWaveform({ samples }: { samples: Float32Array; sampleRate: number }): void {
      this.acceptedSamples = samples
    }
  }

  class FakeOfflineRecognizer {
    lastStream: FakeOfflineStream | null = null

    constructor(config: unknown) {
      offlineConfigs.push(config as Record<string, unknown>)
    }

    createStream() {
      this.lastStream = new FakeOfflineStream()
      return this.lastStream
    }
    decode(): void {}
    getResult() {
      return { text: script.offline?.text ?? '' }
    }
  }

  const mod = {
    OnlineRecognizer: FakeRecognizer,
    ...(script.offline ? { OfflineRecognizer: FakeOfflineRecognizer } : {}),
  }

  return { mod, configs, recognizers, offlineConfigs }
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

  it('refines the buffered audio offline after stop and emits refined before session-stopped', async () => {
    const { mod } = createFakeModule({
      partial: '你好',
      finalAfterFlush: '你好世界',
      offline: { text: '你好，世界。' },
    })
    setVoiceModuleForTests(mod)
    mockState.refineReady = true
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: 16000 }, 5)
    expect(handle.success).toBe(true)
    const sessionId = handle.sessionId as string

    // 0.3s 音频，越过精修最短时长门槛
    feedVoiceAudio(sessionId, new Int16Array(4800).fill(8000), 5)

    expect(stopVoiceSession(sessionId, 5, 'refine')).toBe(true)

    await vi.waitFor(() => {
      expect(
        emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'session-stopped'),
      ).toBe(true)
    })

    const types = emit.mock.calls.map((call) => (call[0] as { type?: string }).type)
    expect(types.indexOf('final')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('refined')).toBeGreaterThan(types.indexOf('final'))
    expect(types.indexOf('session-stopped')).toBeGreaterThan(types.indexOf('refined'))
    const refinedCall = emit.mock.calls.find(
      (call) => (call[0] as { type?: string }).type === 'refined',
    )
    expect((refinedCall?.[0] as { text?: string }).text).toBe('你好，世界。')
    // 精修会话不占用会话表：精修期间可立即开启新会话
    expect(getActiveVoiceSessionCount()).toBe(0)
  })

  it('falls back to pure streaming when the refine model is not installed', async () => {
    const { mod } = createFakeModule({
      partial: '你好',
      finalAfterFlush: '你好世界',
      offline: { text: '不该被精修' },
    })
    setVoiceModuleForTests(mod)
    mockState.refineReady = false
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: 16000 }, 6)
    const sessionId = handle.sessionId as string
    feedVoiceAudio(sessionId, new Int16Array(4800).fill(8000), 6)

    expect(stopVoiceSession(sessionId, 6, 'refine')).toBe(false)

    await vi.waitFor(() => {
      expect(
        emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'session-stopped'),
      ).toBe(true)
    })
    expect(emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'refined')).toBe(
      false,
    )
  })

  it('does not refine when audio is shorter than the minimum refine duration', () => {
    const { mod } = createFakeModule({
      partial: 'hi',
      finalAfterFlush: 'hi there',
      offline: { text: 'refined' },
    })
    setVoiceModuleForTests(mod)
    mockState.refineReady = true
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: 16000 }, 7)
    const sessionId = handle.sessionId as string
    // 单帧 1600 样本 = 0.1s，低于 0.3s 门槛
    feedVoiceAudio(sessionId, new Int16Array(1600).fill(8000), 7)

    expect(stopVoiceSession(sessionId, 7, 'refine')).toBe(false)
    expect(emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'refined')).toBe(
      false,
    )
    expect(
      emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'session-stopped'),
    ).toBe(true)
  })

  it('keeps legacy flush-mode stop behavior without any refine event', () => {
    const { mod } = createFakeModule({
      partial: '你好',
      finalAfterFlush: '你好世界',
      offline: { text: 'refined' },
    })
    setVoiceModuleForTests(mod)
    mockState.refineReady = true
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: 16000 }, 8)
    const sessionId = handle.sessionId as string
    feedVoiceAudio(sessionId, new Int16Array(4800).fill(8000), 8)

    // 内部维护（重置/踢旧会话）默认 flush 模式：立即结束，不做精修
    expect(stopVoiceSession(sessionId, 8)).toBe(false)
    const types = emit.mock.calls.map((call) => (call[0] as { type?: string }).type)
    expect(types).toContain('final')
    expect(types).not.toContain('refined')
    expect(types[types.length - 1]).toBe('session-stopped')
  })
})
