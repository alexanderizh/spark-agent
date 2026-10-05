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
  // silero VAD 模型默认缺失：confirm-only 会话降级走 VoiceTransientGuard 兜底票
  resolveVoiceVadPaths: () => null,
}))

import {
  feedVoiceAudio,
  getActiveVoiceSessionCount,
  getVoiceSessionSampleCursor,
  refineVoiceSessionInterval,
  resetVoiceEngineCache,
  setVoiceEventEmitter,
  setVoiceModuleForTests,
  startVoiceSession,
  stopVoiceSession,
  trimVoiceSessionPcmCache,
} from '../VoiceRecognitionService.js'
import { setVadModuleForTests } from '../voice-assistant/VoiceNoiseGate.js'

afterEach(() => {
  resetVoiceEngineCache()
  setVoiceEventEmitter(null)
  setVoiceModuleForTests(null)
  setVadModuleForTests(null)
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
  const offlineRecognizers: FakeOfflineRecognizer[] = []

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
      offlineRecognizers.push(this)
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

  return { mod, configs, recognizers, offlineConfigs, offlineRecognizers }
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
    const { mod, recognizers } = createFakeModule({
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

  it('trims consumed pcm per turn while absolute-offset interval refine stays correct', async () => {
    const { mod, offlineRecognizers } = createFakeModule({
      partial: '你好',
      finalAfterFlush: '你好世界',
      offline: { text: '第二轮的话' },
    })
    setVoiceModuleForTests(mod)
    mockState.refineReady = true
    setVoiceEventEmitter(vi.fn())

    const handle = startVoiceSession({ sampleRate: 16000 }, 9)
    const sessionId = handle.sessionId as string

    // 第一轮：两 chunk 共 32000 样本（标记 1111），消费完 trim 到边界 32000
    feedVoiceAudio(sessionId, new Int16Array(16000).fill(1111), 9)
    feedVoiceAudio(sessionId, new Int16Array(16000).fill(1111), 9)
    expect(getVoiceSessionSampleCursor(sessionId)).toBe(32_000)
    expect(trimVoiceSessionPcmCache(sessionId, 9, 32_000)).toBe(true)
    // 重复 trim（keep ≤ 已裁剪边界）幂等返回 false
    expect(trimVoiceSessionPcmCache(sessionId, 9, 32_000)).toBe(false)
    // 非本 owner 拒绝裁剪
    expect(trimVoiceSessionPcmCache(sessionId, 99, 0)).toBe(false)

    // 第二轮：1.5s 语音（标记 2222），区间 [32000, 56000) 只含第二轮音频
    feedVoiceAudio(sessionId, new Int16Array(16000).fill(2222), 9)
    feedVoiceAudio(sessionId, new Int16Array(8000).fill(2222), 9)
    // 累计游标不因 trim 回退（绝对偏移语义稳定）
    expect(getVoiceSessionSampleCursor(sessionId)).toBe(56_000)

    const text = await refineVoiceSessionInterval(sessionId, 9, 32_000)
    expect(text).toBe('第二轮的话')
    // 离线解码收到的正是纯第二轮样本：24000 个、无第一轮标记混入
    const accepted = offlineRecognizers[0]?.lastStream?.acceptedSamples
    expect(accepted?.length).toBe(24_000)
    expect(accepted?.every((f) => Math.abs(f - 2222 / 32768) < 1e-6)).toBe(true)

    // 防御：fromSample 落在已裁剪区间内 → 从剩余缓存起点取，不越界不报错
    const tailText = await refineVoiceSessionInterval(sessionId, 9, 0)
    expect(tailText).toBe('第二轮的话')
  })

  it('trims at a chunk boundary by keeping the straddling chunk tail', async () => {
    const { mod } = createFakeModule({
      partial: 'hi',
      finalAfterFlush: 'hi there',
      offline: { text: '尾部' },
    })
    setVoiceModuleForTests(mod)
    mockState.refineReady = true
    setVoiceEventEmitter(vi.fn())

    const handle = startVoiceSession({ sampleRate: 16000 }, 10)
    const sessionId = handle.sessionId as string
    // 三个 chunk（4800 样本/个，累计 14400），trim 边界 6000 落在第二个 chunk 中间
    for (let i = 0; i < 3; i += 1) {
      feedVoiceAudio(sessionId, new Int16Array(4800).fill(3333), 10)
    }
    expect(trimVoiceSessionPcmCache(sessionId, 10, 6000)).toBe(true)
    // 剩余 [6000, 14400) = 8400 样本：区间精修从跨界 chunk 尾段起无缝衔接
    const text = await refineVoiceSessionInterval(sessionId, 10, 6000)
    expect(text).toBe('尾部')
    // 后续喂入继续累计（游标不回退）
    feedVoiceAudio(sessionId, new Int16Array(4800).fill(4444), 10)
    expect(getVoiceSessionSampleCursor(sessionId)).toBe(19_200)
  })

  // ─── confirm-only 三票 final 判定（瞬态守卫） ──────────────────────────────

  const SAMPLE_RATE = 16000

  /** 确定性伪随机（mulberry32）：合成宽带点击脉冲可复现 */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** 合成点击 chunk：头部 12ms 宽带白噪脉冲（1ms 起音 + τ6ms 指数衰减）+ 静音补齐 */
  function clickChunk(): Int16Array {
    const n = Math.round((SAMPLE_RATE * 12) / 1000)
    const burst = new Int16Array(n)
    const rand = mulberry32(0x5eed)
    const attackN = Math.max(1, Math.round(SAMPLE_RATE * 0.001))
    for (let i = 0; i < n; i += 1) {
      const env = i < attackN ? i / attackN : Math.exp(-(i - attackN) / (SAMPLE_RATE * 0.006))
      burst[i] = Math.round((rand() * 2 - 1) * 0.5 * env * 32767)
    }
    const chunk = new Int16Array(SAMPLE_RATE / 10)
    chunk.set(burst)
    return chunk
  }

  /** 合成人声：180Hz 基频 + 4 次递减谐波 + 4Hz 音节包络，按 100ms chunk 切分 */
  function voiceChunks(durationMs: number): Int16Array[] {
    const total = Math.round((SAMPLE_RATE * durationMs) / 1000)
    const signal = new Int16Array(total)
    const f0 = 180
    for (let i = 0; i < total; i += 1) {
      const t = i / SAMPLE_RATE
      const env = 0.65 + 0.35 * Math.sin(2 * Math.PI * 4 * t)
      let v = 0
      for (let k = 1; k <= 4; k += 1) v += Math.sin(2 * Math.PI * f0 * k * t) / k
      signal[i] = Math.round((v / 2.08) * env * 0.5 * 32767)
    }
    const chunkSamples = SAMPLE_RATE / 10
    const chunks: Int16Array[] = []
    for (let offset = 0; offset < total; offset += chunkSamples) {
      chunks.push(signal.subarray(offset, Math.min(offset + chunkSamples, total)))
    }
    return chunks
  }

  /** silero 模型可用但从不产出人声段的 FakeVad（验证第一票走 silero 时间轴） */
  function createSilentVadModule() {
    class FakeVad {
      constructor(_config: unknown, _bufferSeconds: number) {}
      acceptWaveform(_samples: Float32Array): void {}
      isEmpty(): boolean {
        return true
      }
      front(): { start: number; samples: Float32Array } {
        return { start: 0, samples: new Float32Array(0) }
      }
      pop(): void {}
      reset(): void {}
      flush(): void {}
    }
    return { Vad: FakeVad }
  }

  function finalCallsOf(emit: ReturnType<typeof vi.fn>) {
    return emit.mock.calls.filter((call) => (call[0] as { type?: string }).type === 'final')
  }

  it('drops a transient click final in a confirm-only session via the guard fallback vote', () => {
    // silero 模型缺失（resolveVoiceVadPaths → null）→ 三票降级到 VoiceTransientGuard
    const { mod, recognizers } = createFakeModule({ partial: '我', finalAfterFlush: '我' })
    setVoiceModuleForTests(mod)
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: SAMPLE_RATE }, 21)
    const sessionId = handle.sessionId as string

    // 前置静音：warmup + 纯静音段关闭，底噪基线就绪
    for (let i = 0; i < 10; i += 1) feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 21)
    feedVoiceAudio(sessionId, clickChunk(), 21)
    // hangover（6 chunk）后点击段关闭归类为非人声，再触发 endpoint final
    for (let i = 0; i < 7; i += 1) feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 21)
    const recognizer = recognizers[0]
    if (!recognizer) throw new Error('recognizer was not created')
    recognizer.endpointArmed = true
    feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 21)

    // 瞬态 final 被三票拒绝：不 emit final，但识别路径存活（partial 正常推送）
    expect(finalCallsOf(emit)).toHaveLength(0)
    expect(emit.mock.calls.some((call) => (call[0] as { type?: string }).type === 'partial')).toBe(
      true,
    )
  })

  it('accepts a harmonic voice final in a confirm-only session via the guard fallback vote', () => {
    const { mod, recognizers } = createFakeModule({ partial: '你好', finalAfterFlush: '你好' })
    setVoiceModuleForTests(mod)
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: SAMPLE_RATE }, 22)
    const sessionId = handle.sessionId as string

    for (let i = 0; i < 10; i += 1) feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 22)
    for (const chunk of voiceChunks(300)) feedVoiceAudio(sessionId, chunk, 22)
    for (let i = 0; i < 2; i += 1) feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 22)
    const recognizer = recognizers[0]
    if (!recognizer) throw new Error('recognizer was not created')
    recognizer.endpointArmed = true
    feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 22)

    const finals = finalCallsOf(emit)
    expect(finals).toHaveLength(1)
    expect((finals[0]?.[0] as { text?: string }).text).toBe('你好')
  })

  it('rejects finals by the silero absolute-duration vote when the silero model is available', () => {
    // silero 可用但时间轴无人声段：即便音频是真人声谐波（guard 票会放行），
    // 第一票 silero 绝对时长 0ms < 120ms 必须拦下——证明决策优先级走 silero
    setVadModuleForTests(createSilentVadModule())
    const { mod, recognizers } = createFakeModule({ partial: '你好', finalAfterFlush: '你好' })
    setVoiceModuleForTests(mod)
    const emit = vi.fn()
    setVoiceEventEmitter(emit)

    const handle = startVoiceSession({ sampleRate: SAMPLE_RATE }, 23)
    const sessionId = handle.sessionId as string

    for (let i = 0; i < 10; i += 1) feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 23)
    for (const chunk of voiceChunks(300)) feedVoiceAudio(sessionId, chunk, 23)
    for (let i = 0; i < 2; i += 1) feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 23)
    const recognizer = recognizers[0]
    if (!recognizer) throw new Error('recognizer was not created')
    recognizer.endpointArmed = true
    feedVoiceAudio(sessionId, new Int16Array(SAMPLE_RATE / 10), 23)

    expect(finalCallsOf(emit)).toHaveLength(0)
  })
})
