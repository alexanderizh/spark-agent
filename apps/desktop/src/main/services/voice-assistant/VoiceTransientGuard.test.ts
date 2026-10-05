import { describe, expect, it } from 'vitest'
import {
  MIN_VOICED_SPAN_MS,
  TRANSIENT_MAX_ATTACK_MS,
  TRANSIENT_MAX_DECAY_MS,
  TRANSIENT_MAX_DURATION_MS,
  TRANSIENT_MIN_SPECTRAL_FLATNESS,
  VoiceTransientGuard,
  isTransientBurst,
  type TransientFeatures,
} from './VoiceTransientGuard.js'

const SAMPLE_RATE = 16000
/** 采集 chunk 粒度（100ms），贴近真实 AudioWorklet 推送节奏 */
const CHUNK_MS = 100

/** 确定性伪随机（mulberry32）：合成宽带脉冲可复现，不依赖 Math.random */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 合成点击（机械/电瞬态模型）：宽带白噪 + 1ms 线性起音 + τ=6ms 指数快衰减。
 * 声学特征对应判据：宽带（高谱平坦度）、无基频周期、起音 <5ms、衰减 <60ms。
 */
function synthClickBurst(durationMs: number): Int16Array {
  const n = Math.round((SAMPLE_RATE * durationMs) / 1000)
  const out = new Int16Array(n)
  const rand = mulberry32(0x5eed)
  const attackN = Math.max(1, Math.round(SAMPLE_RATE * 0.001))
  for (let i = 0; i < n; i += 1) {
    const env = i < attackN ? i / attackN : Math.exp(-(i - attackN) / (SAMPLE_RATE * 0.006))
    out[i] = Math.round((rand() * 2 - 1) * 0.5 * env * 32767)
  }
  return out
}

/**
 * 合成人声：180Hz 基频 + 4 次递减谐波 + 4Hz 音节包络（谷值 0.3 不断流）。
 * 谐波谱（低平坦度）+ ≥200ms 持续段，对应人声判据。
 */
function synthHarmonicVoice(durationMs: number): Int16Array {
  const n = Math.round((SAMPLE_RATE * durationMs) / 1000)
  const out = new Int16Array(n)
  const f0 = 180
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE
    const env = 0.65 + 0.35 * Math.sin(2 * Math.PI * 4 * t)
    let v = 0
    for (let k = 1; k <= 4; k += 1) v += Math.sin(2 * Math.PI * f0 * k * t) / k
    out[i] = Math.round((v / 2.08) * env * 0.5 * 32767)
  }
  return out
}

/** 喂入追踪器：并行维护绝对采样游标（等价 guard 内部 fedSamples）供区间查询 */
class FeedTracker {
  fed = 0

  push(guard: VoiceTransientGuard, chunk: Int16Array): void {
    guard.process(chunk)
    this.fed += chunk.length
  }

  /** 喂 N ms 静音（按 100ms chunk 切分） */
  pushSilence(guard: VoiceTransientGuard, ms: number): void {
    let remaining = Math.round((SAMPLE_RATE * ms) / 1000)
    const chunkSamples = Math.round((SAMPLE_RATE * CHUNK_MS) / 1000)
    while (remaining > 0) {
      const take = Math.min(chunkSamples, remaining)
      this.push(guard, new Int16Array(take))
      remaining -= take
    }
  }

  /** 信号置于单个 chunk 头部、静音补齐到 totalMs；返回信号起点的绝对偏移 */
  pushPadded(guard: VoiceTransientGuard, signal: Int16Array, totalMs: number): number {
    const start = this.fed
    const total = Math.round((SAMPLE_RATE * totalMs) / 1000)
    const chunk = new Int16Array(total)
    chunk.set(signal.subarray(0, Math.min(signal.length, total)))
    this.push(guard, chunk)
    return start
  }
}

/** 前置底噪收敛：warmup(3 chunk) + hangover(6 chunk) 后纯静音段关闭，底噪基线就绪 */
function settleNoiseFloor(guard: VoiceTransientGuard, feed: FeedTracker): void {
  feed.pushSilence(guard, 1000)
}

describe('VoiceTransientGuard', () => {
  it('classifies a synthetic broadband click as transient and keeps it out of the voiced timeline', () => {
    const guard = new VoiceTransientGuard({ sampleRate: SAMPLE_RATE })
    const feed = new FeedTracker()
    settleNoiseFloor(guard, feed)

    // 12ms 宽带脉冲埋在静音 chunk 头部（点击后 hangover 6 chunk + 关段归类）
    const clickStart = feed.pushPadded(guard, synthClickBurst(12), CHUNK_MS)
    feed.pushSilence(guard, 800)

    // 点击区间与整条时间轴都不存在人声段
    expect(guard.hasVoicedSpanSince(clickStart, feed.fed)).toBe(false)
    expect(guard.voicedMsSince(clickStart, feed.fed)).toBe(0)
    expect(guard.hasVoicedSpanSince(0, feed.fed)).toBe(false)
  })

  it('classifies a harmonic voice with syllabic envelope as a voiced span', () => {
    const guard = new VoiceTransientGuard({ sampleRate: SAMPLE_RATE })
    const feed = new FeedTracker()
    settleNoiseFloor(guard, feed)

    const voiceStart = feed.pushPadded(guard, synthHarmonicVoice(300), 300)
    feed.pushSilence(guard, 800)

    expect(guard.hasVoicedSpanSince(voiceStart, feed.fed)).toBe(true)
    // 人声段绝对时长 ≥120ms（MIN_VOICED_SPAN_MS 兜底中文单字下限）
    expect(guard.voicedMsSince(voiceStart, feed.fed)).toBeGreaterThanOrEqual(MIN_VOICED_SPAN_MS)
    // 区间外查询不到该段（绝对偏移坐标系）
    expect(guard.hasVoicedSpanSince(0, voiceStart)).toBe(false)
  })

  it('requires all five transient hallmarks in isTransientBurst', () => {
    const click: TransientFeatures = {
      durationMs: 20,
      attackMs: 2,
      decayMs: 15,
      spectralFlatness: 0.6,
      harmonicity: 0.1,
      zeroCrossingRate: 0.4,
    }
    expect(isTransientBurst(click)).toBe(true)
    // 各阈值边界逐条破坏 AND 链
    expect(isTransientBurst({ ...click, durationMs: TRANSIENT_MAX_DURATION_MS })).toBe(false)
    expect(isTransientBurst({ ...click, attackMs: TRANSIENT_MAX_ATTACK_MS })).toBe(false)
    expect(isTransientBurst({ ...click, decayMs: TRANSIENT_MAX_DECAY_MS })).toBe(false)
    expect(
      isTransientBurst({ ...click, spectralFlatness: TRANSIENT_MIN_SPECTRAL_FLATNESS - 0.01 }),
    ).toBe(false)
    expect(isTransientBurst({ ...click, harmonicity: 0.36 })).toBe(false)
  })

  it('handles empty input and out-of-range queries without throwing', () => {
    const guard = new VoiceTransientGuard({ sampleRate: SAMPLE_RATE })
    const feed = new FeedTracker()

    guard.process(new Int16Array(0))
    expect(guard.isRangeKnown(0, 1)).toBe(false)

    feed.pushSilence(guard, 300)
    expect(guard.voicedMsSince(100, 50)).toBe(0)
    expect(guard.voicedMsSince(100, 100)).toBe(0)
    expect(() => guard.voicedMsSince(-9999, 100)).not.toThrow()
    expect(guard.voicedMsSince(-9999, 100)).toBeGreaterThanOrEqual(0)
    expect(guard.isRangeKnown(0, feed.fed)).toBe(true)
    expect(guard.isRangeKnown(0, feed.fed + 1)).toBe(false)
  })

  it('reset clears the timeline and cursor for session reuse', () => {
    const guard = new VoiceTransientGuard({ sampleRate: SAMPLE_RATE })
    const feed = new FeedTracker()
    settleNoiseFloor(guard, feed)
    const voiceStart = feed.pushPadded(guard, synthHarmonicVoice(300), 300)
    feed.pushSilence(guard, 800)
    expect(guard.hasVoicedSpanSince(voiceStart, feed.fed)).toBe(true)

    guard.reset()
    expect(guard.hasVoicedSpanSince(0, feed.fed)).toBe(false)
    expect(guard.isRangeKnown(0, 1)).toBe(false)

    // reset 后重新建立时间轴（duplex 会话跨轮复用的隔离性）
    const feed2 = new FeedTracker()
    const secondStart = feed2.pushPadded(guard, synthHarmonicVoice(250), 250)
    feed2.pushSilence(guard, 800)
    expect(guard.hasVoicedSpanSince(secondStart, feed2.fed)).toBe(true)
  })
})
