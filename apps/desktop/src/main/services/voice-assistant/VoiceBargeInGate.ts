/**
 * VoiceBargeInGate — 播报期插话门控（全双工回声治理层 2，前置能量层）
 *
 * TTS 播报期间，扬声器声音经空气/驱动回流麦克风（AEC 之后的残余回声）。
 * 本门控在音频进 ASR 之前按能量放行/压制：
 * - dB 域自适应底噪基线（对齐 VoiceNoiseGate 的能量层语义）+ 播报期提高的
 *   增益门限（回声经物理损耗能量偏低，但门限仍高于常规档防漏放）；
 * - 连续达标 chunk 确认（≈300ms 持续人声才算插话，防单 chunk 回声尖峰）：
 *   确认期 chunk 先缓存不喂，确认通过后连同缓存一起放行（字头零丢失）；
 * - 放行后的 hangover 保持（保字尾轻音与短停顿）；
 * - 被压制 chunk 返回等长置零数据（维持 ASR 尾静音端点检测的时间推进）。
 *
 * strict 档由层 1（AEC 探测 false）与层 3（守卫近期命中）触发自动升级。
 */

import { createLogger } from '@spark/shared'

const log = createLogger('voice-assistant')

/** chunk 时长（ms）：16kHz 采样、每次 feed 约 1600 样本，用于日志换算 */
const CHUNK_MS = 100

export interface VoiceBargeInGateProfile {
  /** 高于自适应底噪的 dB 门限（standard=10 ≈ 常规 6 + 播报加成 4；strict=20） */
  gainDbAboveFloor: number
  /** 连续达标确认 chunk 数（防单 chunk 回声尖峰放行；确认期缓存后补） */
  confirmChunks: number
  /** 放行后的保持 chunk 数（对齐 VoiceNoiseGate HANGOVER_CHUNKS 语义） */
  hangoverChunks: number
}

const STANDARD_PROFILE: VoiceBargeInGateProfile = {
  gainDbAboveFloor: 10,
  confirmChunks: 3,
  hangoverChunks: 6,
}

const STRICT_PROFILE: VoiceBargeInGateProfile = {
  gainDbAboveFloor: 20,
  confirmChunks: 3,
  hangoverChunks: 6,
}

/** 绝对下限（dBFS）：低于此必为底噪（对齐 VoiceNoiseGate.ABSOLUTE_FLOOR_DB 语义） */
const ABSOLUTE_FLOOR_DB = -55
/** 底噪基线 EMA 系数（chunk≈100ms，时间常数约 2s） */
const BASELINE_EMA_ALPHA = 0.05
/** 开场预热 chunk 数：学习底噪不判放行（不直通——播报期直通=喂回声） */
const WARMUP_CHUNKS = 3

/** chunk 能量判定结果（内部状态机用） */
type ChunkVerdict = 'below-threshold' | 'above-threshold'

export class VoiceBargeInGate {
  private armed = false
  private strict = false
  private noiseFloorDb = -50
  private warmupRemaining = 0
  /** 连续达标计数（确认期） */
  private confirmStreak = 0
  /** 确认期缓存的 chunk（通过后补放行，字头零丢失） */
  private confirmBuffer: Int16Array[] = []
  /** 放行保持剩余 chunk 数 */
  private hangoverRemaining = 0
  /** 统计：armed 期间压制/放行 chunk 计数（节流日志用） */
  private suppressedChunks = 0
  private admittedChunks = 0
  private lastStatsLoggedAt = 0

  /** 播报起止由 TTS 流水线 playback-started/ended 驱动；arm 时重置状态机 */
  setPlaybackActive(active: boolean, strict: boolean): void {
    if (this.armed === active && this.strict === strict) return
    this.armed = active
    this.strict = strict
    this.confirmStreak = 0
    this.confirmBuffer = []
    this.hangoverRemaining = 0
    if (active) {
      this.warmupRemaining = WARMUP_CHUNKS
      this.suppressedChunks = 0
      this.admittedChunks = 0
      log.info(`[voice-assistant] barge-in gate armed (strict=${strict})`)
    } else if (this.suppressedChunks > 0 || this.admittedChunks > 0) {
      log.info(
        `[voice-assistant] barge-in gate disarmed (suppressed=${this.suppressedChunks}, admitted=${this.admittedChunks})`,
      )
    }
  }

  /** 当前是否处于放行态（service 侧跳过置零的快速判断） */
  isAdmitting(): boolean {
    return this.armed && this.hangoverRemaining > 0
  }

  /**
   * 处理一个 chunk：返回放行的原数据，或等长置零数据（保时间推进）。
   * 未 armed 时原样返回（非播报期无回声风险，不参与判定）。
   */
  process(samples: Int16Array): Int16Array {
    if (!this.armed) return samples
    const levelDb = computeChunkDb(samples)
    const profile = this.strict ? STRICT_PROFILE : STANDARD_PROFILE
    const verdict: ChunkVerdict =
      levelDb > Math.max(this.noiseFloorDb + profile.gainDbAboveFloor, ABSOLUTE_FLOOR_DB + 6)
        ? 'above-threshold'
        : 'below-threshold'

    if (this.warmupRemaining > 0) {
      this.warmupRemaining -= 1
      this.learnNoiseFloor(levelDb)
      this.suppressedChunks += 1
      return zeroed(samples)
    }

    // 放行保持期（hangover）：继续放行并学习底噪（用低于门限的能量）
    if (this.hangoverRemaining > 0) {
      if (verdict === 'above-threshold') {
        this.hangoverRemaining = profile.hangoverChunks
        this.admittedChunks += 1
        return samples
      }
      this.hangoverRemaining -= 1
      this.learnNoiseFloor(levelDb)
      this.admittedChunks += 1
      return samples
    }

    if (verdict === 'above-threshold') {
      this.confirmStreak += 1
      this.confirmBuffer.push(samples)
      if (this.confirmStreak >= profile.confirmChunks) {
        // 确认通过：缓存 chunk 连同当前 chunk 补放行（字头零丢失）
        this.confirmStreak = 0
        this.hangoverRemaining = profile.hangoverChunks
        const buffered = this.confirmBuffer
        this.confirmBuffer = []
        this.admittedChunks += buffered.length
        log.info(
          `[voice-assistant] barge-in admitted (${buffered.length} chunks ≈ ${buffered.length * CHUNK_MS}ms, level=${levelDb.toFixed(1)}dB)`,
        )
        // 多 chunk 返还：调用方按序 feed（这里返回拼接结果，保持单返回值契约）
        return concatSamples(buffered)
      }
      // 确认等待期：置零但保留原数据待确认
      this.suppressedChunks += 1
      this.maybeLogStats()
      return zeroed(samples)
    }

    // 能量跌落：确认期作废（缓存置零放掉，保时间推进），关门继续压制
    if (this.confirmStreak > 0) {
      this.confirmStreak = 0
      this.confirmBuffer = []
    }
    this.learnNoiseFloor(levelDb)
    this.suppressedChunks += 1
    this.maybeLogStats()
    return zeroed(samples)
  }

  /** 底噪基线学习：低于当前门限的能量才参与（防人声抬升底噪） */
  private learnNoiseFloor(levelDb: number): void {
    this.noiseFloorDb = this.noiseFloorDb * (1 - BASELINE_EMA_ALPHA) + levelDb * BASELINE_EMA_ALPHA
  }

  /** 压制统计节流日志（每 50 个压制 chunk ≈5s 聚合一条，防刷屏） */
  private maybeLogStats(): void {
    if (this.suppressedChunks - this.lastStatsLoggedAt < 50) return
    this.lastStatsLoggedAt = this.suppressedChunks
    log.debug(
      `[voice-assistant] barge-in gate suppressed ${this.suppressedChunks} chunks (floor=${this.noiseFloorDb.toFixed(1)}dB)`,
    )
  }
}

/** chunk RMS → dBFS（Int16 满量程 32767；静音兜底 -90dB） */
function computeChunkDb(samples: Int16Array): number {
  if (samples.length === 0) return -90
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] ?? 0) / 32768
    sum += v * v
  }
  const rms = Math.sqrt(sum / samples.length)
  return rms > 0 ? 20 * Math.log10(rms) : -90
}

function zeroed(samples: Int16Array): Int16Array {
  return new Int16Array(samples.length)
}

function concatSamples(chunks: Int16Array[]): Int16Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Int16Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
