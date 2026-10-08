/**
 * VoiceRecognitionService 句级出字（方案B sentence 模式）单元测试
 *
 * 覆盖：
 * 1. sentence 会话：闭合 span → ±0.2s padding 区间 → SenseVoice 句级解码 →
 *    final 事件（PCM 为 gate 前原始音频，非置零音频）
 * 2. 停止收口：flush 尾句补发 final，队列排空后才 session-stopped（顺序保证），
 *    恒不做整段精修（refining=false、无 refined 事件）
 * 3. 降级：refine 模型缺失 / silero 缺失 → 请求 sentence 自动降级 streaming
 *    （partial 行为回归，零风险兼容）
 * 4. 容错：句级解码抛错 → 不 emit error、不中断会话，后续句照常出字
 * 5. speech-activity 事件（sentence 会话的确认窗口撤销信号源）
 *
 * mock 注入：setVoiceModuleForTests（sherpa native 模块）+ setVadModuleForTests
 * （silero Vad）+ vi.mock(VoiceIntegrityService)（模型路径解析）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceRecognitionEvent } from '@spark/protocol'
import { setVadModuleForTests } from './voice-assistant/VoiceNoiseGate'
import {
  feedVoiceAudio,
  resetVoiceEngineCache,
  setVoiceEventEmitter,
  setVoiceModuleForTests,
  startVoiceSession,
  stopVoiceSession,
  waitForVoiceSentenceTasks,
} from './VoiceRecognitionService'
import { resolveVoiceModelPaths, resolveVoiceRefinePaths, resolveVoiceVadPaths } from './VoiceIntegrityService'

vi.mock('./VoiceIntegrityService.js', () => ({
  resolveVoiceModelPaths: vi.fn(),
  resolveVoiceRefinePaths: vi.fn(),
  resolveVoiceVadPaths: vi.fn(),
}))

// ─── 测试音频 ────────────────────────────────────────────────────────────────

const CHUNK = 1600 // 100ms @16k

function silence(): Int16Array {
  return new Int16Array(CHUNK)
}

function tone(amplitude: number): Int16Array {
  const out = new Int16Array(CHUNK)
  for (let i = 0; i < CHUNK; i += 1) {
    out[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 220 * i) / 16000))
  }
  return out
}

// ─── silero Vad mock（段由测试 emitSegment 显式注入）────────────────────────

interface MockSpan {
  start: number
  samples: Float32Array
}

class MockVad {
  static instances: MockVad[] = []
  segments: MockSpan[] = []

  constructor() {
    MockVad.instances.push(this)
  }

  acceptWaveform(): void {
    // 段由测试通过 emitSegment 显式注入
  }

  isEmpty(): boolean {
    return this.segments.length === 0
  }

  front(): MockSpan {
    return this.segments[0] as MockSpan
  }

  pop(): void {
    this.segments.shift()
  }

  reset(): void {
    this.segments = []
  }

  flush(): void {
    // 段已在队列中，drain 由调用方触发
  }

  emitSegment(start: number, lengthSamples: number): void {
    this.segments.push({ start, samples: new Float32Array(lengthSamples) })
  }
}

// ─── sherpa native 模块 mock ────────────────────────────────────────────────

class MockOnlineStream {
  acceptedSamples = 0
  acceptWaveform({ samples }: { samples: Float32Array }): void {
    this.acceptedSamples += samples.length
  }
  inputFinished(): void {}
}

class MockOnlineRecognizer {
  streams: MockOnlineStream[] = []

  createStream(): MockOnlineStream {
    const stream = new MockOnlineStream()
    this.streams.push(stream)
    return stream
  }

  isReady(): boolean {
    return false
  }

  decode(): void {}

  isEndpoint(): boolean {
    return false
  }

  reset(): void {}

  getResult(): { text: string } {
    return { text: '你好世界' }
  }
}

class MockOfflineStream {
  sampleCounts: number[] = []
  sawNonZero = false

  acceptWaveform({ samples }: { samples: Float32Array }): void {
    this.sampleCounts.push(samples.length)
    if (!this.sawNonZero && samples.some((v) => v !== 0)) this.sawNonZero = true
  }
}

class MockOfflineRecognizer {
  static instances: MockOfflineRecognizer[] = []
  streams: MockOfflineStream[] = []
  failNextDecodes = 0

  constructor() {
    MockOfflineRecognizer.instances.push(this)
  }

  createStream(): MockOfflineStream {
    const stream = new MockOfflineStream()
    this.streams.push(stream)
    return stream
  }

  decode(): void {
    if (this.failNextDecodes > 0) {
      this.failNextDecodes -= 1
      throw new Error('decode boom')
    }
  }

  getResult(): { text: string } {
    return { text: `句${this.streams.length}` }
  }
}

function makeMockSherpaModule(): {
  OnlineRecognizer: new () => MockOnlineRecognizer
  OfflineRecognizer: new () => MockOfflineRecognizer
} {
  return {
    OnlineRecognizer: MockOnlineRecognizer,
    OfflineRecognizer: MockOfflineRecognizer,
  }
}

// ─── 测试环境 ────────────────────────────────────────────────────────────────

let events: VoiceRecognitionEvent[]
let modelDir: string

beforeEach(() => {
  events = []
  MockVad.instances = []
  MockOfflineRecognizer.instances = []
  // 流式识别器模型目录（真实临时目录：readModelDescriptor 走真实 fs）
  modelDir = mkdtempSync(join(tmpdir(), 'voice-rec-test-'))
  for (const file of ['enc.onnx', 'dec.onnx', 'tokens.txt']) {
    writeFileSync(join(modelDir, file), '')
  }
  writeFileSync(
    join(modelDir, 'model-package.json'),
    JSON.stringify({ version: 'test-1', encoder: 'enc.onnx', decoder: 'dec.onnx', tokens: 'tokens.txt' }),
  )
  vi.mocked(resolveVoiceModelPaths).mockReturnValue({
    nativeDir: modelDir,
    modelDir,
    nativeMain: join(modelDir, 'main.js'),
  })
  // silero 探针走 mock Vad（resolveVoiceVadPaths 恒 null：真实路径解析不参与）
  vi.mocked(resolveVoiceVadPaths).mockReturnValue(null)
  // SenseVoice 精修模型「已安装」（路径无需真实存在：OfflineRecognizer 是 mock）
  vi.mocked(resolveVoiceRefinePaths).mockReturnValue({
    version: 'refine-test',
    modelPath: '/virtual/model.onnx',
    tokensPath: '/virtual/tokens.txt',
  })
  setVoiceModuleForTests(makeMockSherpaModule())
  setVadModuleForTests({
    Vad: MockVad as unknown as new (config: unknown, bufferSeconds: number) => MockVad,
  })
  setVoiceEventEmitter((event) => {
    events.push(event)
  })
  // 模块级缓存（识别器/精修识别器/Vad 单例）逐用例清空，避免跨用例串实例
  resetVoiceEngineCache()
})

afterEach(async () => {
  stopVoiceSession()
  // 句级收口的 session-stopped 在队列排空后异步发出，让一拍事件循环清干净
  await new Promise((resolve) => setImmediate(resolve))
  resetVoiceEngineCache()
  setVoiceModuleForTests(null)
  setVadModuleForTests(null)
  setVoiceEventEmitter(null)
  vi.clearAllMocks()
  rmSync(modelDir, { recursive: true, force: true })
})

describe('sentence 句级出字', () => {
  it('闭合 span → ±0.2s padding 区间 → SenseVoice 解码 → final（原始音频非置零）', async () => {
    const handle = startVoiceSession({ sampleRate: 16000, decodeMode: 'sentence' }, 1)
    expect(handle.success).toBe(true)
    const sessionId = handle.sessionId as string
    // 10s 音频（100 chunk）；span [2s, 3s)
    for (let i = 0; i < 100; i += 1) feedVoiceAudio(sessionId, tone(0.5), 1)
    const vad = MockVad.instances[MockVad.instances.length - 1] as MockVad
    vad.emitSegment(32000, 16000)
    feedVoiceAudio(sessionId, tone(0.5), 1) // process 触发 drain → span 入队
    await waitForVoiceSentenceTasks(sessionId)
    const finals = events.filter((e) => e.type === 'final')
    expect(finals.length).toBe(1)
    expect(finals[0]?.text).toBe('句1')
    expect(finals[0]?.sessionId).toBe(sessionId)
    // 解码区间 = span ±0.2s = [28800, 51200) = 22400 samples（单段 5s 切分）
    const offline = MockOfflineRecognizer.instances[MockOfflineRecognizer.instances.length - 1]
    expect(offline?.streams.length).toBe(1)
    const stream = offline?.streams[0]
    expect(stream?.sampleCounts.reduce((a, b) => a + b, 0)).toBe(22400)
    // gate 前原始音频直通缓存（confirm-only 不置零）
    expect(stream?.sawNonZero).toBe(true)
  })

  it('停止收口：flush 尾句补发 final，队列排空后才 session-stopped；恒不精修', async () => {
    const handle = startVoiceSession({ sampleRate: 16000, decodeMode: 'sentence' }, 1)
    const sessionId = handle.sessionId as string
    for (let i = 0; i < 50; i += 1) feedVoiceAudio(sessionId, tone(0.3), 1) // 5s
    const vad = MockVad.instances[MockVad.instances.length - 1] as MockVad
    vad.emitSegment(16000, 16000) // 未 drain 的尾段（stop flush 逼出）
    const refining = stopVoiceSession(sessionId, 1, 'refine')
    // 尾句任务在队：返回 true 让 voice:stop 调用方保持订阅等 session-stopped，
    // 防尾句 final 丢失（语义对齐流式 refine 的等待收尾；恒无 refined 事件）
    expect(refining).toBe(true)
    await waitForVoiceSentenceTasks(sessionId)
    await new Promise((resolve) => setImmediate(resolve))
    // 关键事件顺序：final 先于 session-stopped；无 refined、无 error
    const relevant = events
      .filter((e) => e.type === 'final' || e.type === 'session-stopped' || e.type === 'refined' || e.type === 'error')
      .map((e) => e.type)
    expect(relevant).toEqual(['final', 'session-stopped'])
    expect(events.filter((e) => e.type === 'final')[0]?.text).toBe('句1')
  })

  it('refine 模型缺失：请求 sentence 自动降级 streaming（partial 行为回归）', () => {
    vi.mocked(resolveVoiceRefinePaths).mockReturnValue(null)
    const handle = startVoiceSession({ sampleRate: 16000, decodeMode: 'sentence' }, 1)
    expect(handle.success).toBe(true)
    feedVoiceAudio(handle.sessionId as string, tone(0.5), 1)
    // sentence 模式永不发 partial；收到 partial = 流式路径在跑（降级生效）
    expect(events.some((e) => e.type === 'partial')).toBe(true)
  })

  it('silero 缺失：请求 sentence 自动降级 streaming', () => {
    // 撤掉 mock Vad 且真实 vad 路径恒 null → isSileroVadAvailable() = false
    setVadModuleForTests(null)
    const handle = startVoiceSession({ sampleRate: 16000, decodeMode: 'sentence' }, 1)
    expect(handle.success).toBe(true)
    feedVoiceAudio(handle.sessionId as string, tone(0.5), 1)
    expect(events.some((e) => e.type === 'partial')).toBe(true)
  })

  it('句级解码抛错：不 emit error、不中断会话（后续句照常出字）', async () => {
    const handle = startVoiceSession({ sampleRate: 16000, decodeMode: 'sentence' }, 1)
    const sessionId = handle.sessionId as string
    const offline = MockOfflineRecognizer.instances[MockOfflineRecognizer.instances.length - 1]
    expect(offline).toBeDefined()
    if (offline) offline.failNextDecodes = 1
    for (let i = 0; i < 100; i += 1) feedVoiceAudio(sessionId, tone(0.5), 1)
    const vad = MockVad.instances[MockVad.instances.length - 1] as MockVad
    // 第一句：decode 抛错 → 丢弃（无 final、无 error）
    vad.emitSegment(16000, 16000)
    feedVoiceAudio(sessionId, tone(0.5), 1)
    await waitForVoiceSentenceTasks(sessionId)
    expect(events.filter((e) => e.type === 'final')).toHaveLength(0)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    // 会话仍在：第二句恢复正常解码出字
    vad.emitSegment(80000, 16000)
    feedVoiceAudio(sessionId, tone(0.5), 1)
    await waitForVoiceSentenceTasks(sessionId)
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('sentence 会话发射 speech-activity 事件（确认窗口撤销的信号源）', () => {
    const handle = startVoiceSession({ sampleRate: 16000, decodeMode: 'sentence' }, 1)
    const sessionId = handle.sessionId as string
    // 预热 3 chunk（首 chunk 即翻转 true）+ 高能量 → 静音 7 chunk（hangover 6 后翻转 false）
    for (let i = 0; i < 3; i += 1) feedVoiceAudio(sessionId, silence(), 1)
    for (let i = 0; i < 3; i += 1) feedVoiceAudio(sessionId, tone(0.5), 1)
    for (let i = 0; i < 7; i += 1) feedVoiceAudio(sessionId, silence(), 1)
    const activities = events
      .filter((e) => e.type === 'speech-activity')
      .map((e) => e.speechActive)
    expect(activities).toEqual([true, false])
  })
})
