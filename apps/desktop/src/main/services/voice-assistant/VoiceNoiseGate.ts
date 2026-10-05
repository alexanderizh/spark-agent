/**
 * VoiceNoiseGate — 语音助手环境噪音门控（人声聚焦）
 *
 * 用户痛点：环境音（电视/旁人/风扇）被 ASR 硬解成字并拼进转写。双层防线：
 *
 * 1. 能量层（实时，纯 TS）：dB 域自适应底噪基线 + 近场增益门限，低于门限的
 *    chunk 置零后再喂 ASR——时间推进保留（ASR 尾静音逻辑不受影响），噪音内容
 *    不再进入识别。近场用户音量显著高于远场声源，门限天然"只留最大的人声"。
 * 2. 确认层（silero VAD，段级）：旁路接收原始音频，产出人声段时间轴；final
 *    锁定前校验其音频区间的 silero 人声覆盖率，低于阈值的 final 判为噪音硬解
 *    直接丢弃。silero 对音乐/稳态噪音零误检（实测），恰好补能量层判不出
 *    "有能量的非人声"的盲区。
 *
 * silero 模型未安装或 native 导出缺失时自动降级为纯能量层（只 warn 一次）。
 * Vad 实例为模块级单例（1.13.4 的 JS wrapper 未暴露 free，跨会话复用防泄漏）。
 */

import { createRequire } from 'node:module'
import { createLogger } from '@spark/shared'
import { resolveVoiceModelPaths, resolveVoiceVadPaths } from '../VoiceIntegrityService.js'

const log = createLogger('voice-gate')

// ─── sherpa-onnx Vad 最小类型声明（动态 require） ───────────────────────────

interface SherpaSpeechSegment {
  start: number
  samples: Float32Array
}

interface SherpaVad {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  front(enableExternalBuffer?: boolean): SherpaSpeechSegment
  pop(): void
  reset(): void
  flush(): void
}

interface SherpaVadModule {
  Vad: new (config: SherpaVadConfig, bufferSizeInSeconds: number) => SherpaVad
}

interface SherpaVadConfig {
  sileroVad?: {
    model: string
    threshold?: number
    minSilenceDuration?: number
    minSpeechDuration?: number
    windowSize?: number
    maxSpeechDuration?: number
  }
  sampleRate?: number
  numThreads?: number
  provider?: string
  debug?: boolean
}

export type VoiceFocusMode = 'standard' | 'strict'

/** 近场增益门限（高于自适应底噪的 dB 数）：strict 只保留贴近麦克风的人声 */
const ENERGY_GAIN_DB: Record<VoiceFocusMode, number> = { standard: 6, strict: 12 }
/**
 * 起音迟滞（dB）：开门门限比关门门限低该值——字头轻辅音的能量爬坡期
 * （未达全门限）即开始放行，避免字头被切导致 ASR 漏字。关门仍以全门限 +
 * hangover 判定，不会因此提前关门。
 */
const ENERGY_ATTACK_RELAX_DB = 4
/**
 * silero 人声覆盖率下限：分母只算能量层放行（真正喂给 ASR）的样本，
 * 正常语句覆盖率 >0.6、远场噪音硬解接近 0，该阈值有充分区分度。
 */
const SILERO_COVERAGE_MIN: Record<VoiceFocusMode, number> = { standard: 0.3, strict: 0.45 }
/**
 * confirm-only 档 final 区间内 silero 人声段绝对时长下限（ms）。点击瞬态
 * （10-50ms）即便骗过 silero 也远达不到该时长；正常中文单字 150-300ms。
 * sherpa Vad 的 min_speech_duration 参数可能不被执行（分析已标记该不确定
 * 性），故用自身时间轴计算绝对时长兜底，不依赖该参数。
 */
export const MIN_VOICED_MS_FOR_FINAL = 120

/** 绝对下限（dBFS）：低于此必为底噪，防止极安静环境下门限退化过低 */
const ABSOLUTE_FLOOR_DB = -55
/** 底噪基线 EMA 系数（chunk ≈100ms，时间常数约 2s） */
const BASELINE_EMA_ALPHA = 0.05
/** 开场预热：前若干 chunk 收敛底噪估计（预热期音频直通，不吃字头） */
const WARMUP_CHUNKS = 3
/** 语音结束后的保持放行时长，防字尾轻音与停顿后的字头被切 */
const HANGOVER_CHUNKS = 6
/**
 * 连续活跃重校准上限（chunk ≈100ms）：持续 8s 无间断的高能量几乎必是稳态噪音
 * （真实语音有词间停顿，hangover 只保 300ms），此时把底噪基线重校准到当前
 * 能量自愈"门限被噪音顶死"的死锁。
 */
const RECALIBRATE_AFTER_CHUNKS = 80
/** silero 段时间轴保留上限（采样点，16k × 120s），防长会话内存增长 */
const TIMELINE_MAX_SAMPLES = 16000 * 120

/** 供单元测试注入 mock native 模块 */
export function setVadModuleForTests(mod: SherpaVadModule | null): void {
  vadModuleOverride = mod
  sharedVad = null
}

let vadModuleOverride: SherpaVadModule | null = null
let vadLoadWarned = false
let sharedVad: SherpaVad | null = null

function loadVad(): SherpaVad | null {
  if (vadModuleOverride != null) {
    if (sharedVad == null) {
      try {
        sharedVad = new vadModuleOverride.Vad(
          {
            sileroVad: { model: '/virtual/model.onnx', threshold: 0.6, windowSize: 512 },
            sampleRate: 16000,
          },
          30,
        )
      } catch (error) {
        log.warn(`mock Vad init failed: ${String(error)}`)
        return null
      }
    }
    return sharedVad
  }
  if (sharedVad != null) return sharedVad
  const paths = resolveVoiceModelPaths()
  const vadPaths = resolveVoiceVadPaths()
  if (!paths || !vadPaths) return null
  try {
    const req = createRequire(import.meta.url)
    const mod = req(paths.nativeMain) as SherpaVadModule
    if (typeof mod.Vad !== 'function') {
      if (!vadLoadWarned) {
        log.warn('native 模块缺少 Vad 导出，人声确认层降级为纯能量门控')
        vadLoadWarned = true
      }
      return null
    }
    sharedVad = new mod.Vad(
      {
        sileroVad: {
          model: vadPaths.modelPath,
          // 0.6：收紧瞬态/窄带噪音的误检（点击宽带脉冲的 silero 得分低于人声）
          threshold: 0.6,
          minSpeechDuration: 0.1,
          minSilenceDuration: 0.5,
          windowSize: 512,
          maxSpeechDuration: 20,
        },
        sampleRate: 16000,
        numThreads: 1,
        provider: 'cpu',
        debug: false,
      },
      30,
    )
    return sharedVad
  } catch (error) {
    if (!vadLoadWarned) {
      log.warn(`silero VAD 加载失败，人声确认层降级为纯能量门控: ${String(error)}`)
      vadLoadWarned = true
    }
    return null
  }
}

/** 清空模块级 Vad 单例（语音包变更/卸载后由 resetVoiceEngineCache 联动） */
export function resetVoiceNoiseGateVad(): void {
  sharedVad = null
}

/** Int16 PCM → Float32 [-1, 1]（confirm-only 旁路喂 silero 用） */
function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = (samples[i] ?? 0) / 32768
  }
  return out
}

export interface VoiceNoiseGateOptions {
  mode: VoiceFocusMode
  /**
   * confirm-only 模式：跳过能量置零与 attack-hysteresis 丢样（历史教训：
   * v1 能量置零式门控严重伤识别率被显式回退），音频流完全不动，仅保留
   * silero 旁路时间轴与 shouldAcceptFinal 判定语义。v2 迁移默认
   * voiceFocus='off' 的会话用它获得「final 级瞬态过滤」而识别路径零改动。
   */
  confirmOnly?: boolean
  /** 采样率（默认 16000，silero 时间轴毫秒换算用） */
  sampleRate?: number
  /** 实时人声活动翻转回调（false→true / true→false），供空转计时重置 */
  onSpeechActivity?: (active: boolean) => void
  /** 测试注入：跳过 silero 层 */
  disableSilero?: boolean
}

interface SpeechSpan {
  start: number
  end: number
}

export class VoiceNoiseGate {
  private readonly mode: VoiceFocusMode
  private readonly confirmOnly: boolean
  private readonly sampleRate: number
  private readonly onSpeechActivity?: ((active: boolean) => void) | undefined
  private readonly useSilero: boolean

  private baselineDb: number | null = null
  private chunksSinceStart = 0
  /** 连续能量不达标的 chunk 数（hangover 计数：归零于每次能量达标） */
  private quietChunks = HANGOVER_CHUNKS
  /** 连续判定为活跃的 chunk 数（超过上限视为持续噪音，重校准底噪基线自愈） */
  private continuousActiveChunks = 0
  private speechActive = false
  /** 本会话累计采样数（能量层与 silero 层的共同坐标系） */
  private fedSamples = 0
  /** silero 确认的人声段时间轴（会话内采样偏移，升序） */
  private speechSpans: SpeechSpan[] = []
  private lastSpanEnd = 0
  /** 能量层放行（active）的样本时间段：覆盖率校验的分母只算这些真正喂给 ASR 的样本 */
  private activeSpans: SpeechSpan[] = []
  /** 进行中的 active span 起点（-1 = 当前不在 span 中） */
  private activeStart = -1
  /** 最近一个 active chunk 的结束偏移（span 收尾用） */
  private activePendingEnd = 0

  constructor(options: VoiceNoiseGateOptions) {
    this.mode = options.mode
    this.confirmOnly = options.confirmOnly === true
    this.sampleRate = options.sampleRate ?? 16000
    this.onSpeechActivity = options.onSpeechActivity
    this.useSilero = options.disableSilero !== true
  }

  /**
   * 处理一个 PCM chunk：能量门控 + silero 旁路跟踪。
   * 返回门控后的 chunk（低能量段为全零，长度不变——时间推进必须保留，
   * 否则 ASR 的尾静音端点检测会因"没有静音"而永不触发）。
   * confirm-only 模式音频原样返回，只推进 silero 时间轴。
   */
  process(samples: Int16Array): Int16Array {
    if (this.confirmOnly) {
      // 确认层旁路：不判定能量、不置零、不丢样——识别率不可伤（v1 教训），
      // 仅 silero 时间轴随音频推进，供 final 接受判定使用
      if (this.useSilero) {
        const vad = loadVad()
        if (vad != null) {
          try {
            vad.acceptWaveform(int16ToFloat32(samples))
            this.drainSpans(vad)
          } catch (error) {
            log.warn(`silero VAD feed error: ${String(error)}`)
          }
        }
      }
      this.fedSamples += samples.length
      return samples
    }
    const float = new Float32Array(samples.length)
    let sumSquares = 0
    for (let i = 0; i < samples.length; i += 1) {
      const v = (samples[i] ?? 0) / 32768
      float[i] = v
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, samples.length))
    const db = 20 * Math.log10(rms + 1e-10)

    const threshold = Math.max(
      (this.baselineDb ?? -60) + ENERGY_GAIN_DB[this.mode],
      ABSOLUTE_FLOOR_DB,
    )

    let active: boolean
    if (this.chunksSinceStart < WARMUP_CHUNKS) {
      // 预热期：音频直通（唤醒后立即开口的字头不能吃），底噪估计取最小值——
      // 用户已开口时人声能量不会抬高等效门限，baseline 偏低只会更宽松，方向安全
      this.baselineDb = Math.min(this.baselineDb ?? Infinity, db)
      active = true
      this.quietChunks = 0
    } else if (db >= threshold - ENERGY_ATTACK_RELAX_DB) {
      // 起音迟滞：能量爬坡到门限-迟滞量即放行，字头轻辅音不再被切
      active = true
      this.quietChunks = 0
    } else if (this.quietChunks < HANGOVER_CHUNKS) {
      // 尾音保持：防字尾轻辅音与词间停顿后的下一个字头被切
      active = true
      this.quietChunks += 1
    } else {
      active = false
      // 非语音期更新底噪基线（语音期不更新，防把人声当底噪抬高门限）
      this.baselineDb =
        this.baselineDb == null
          ? db
          : this.baselineDb * (1 - BASELINE_EMA_ALPHA) + db * BASELINE_EMA_ALPHA
    }

    // 持续活跃重校准：8s 无间断高能量视为稳态噪音，基线顶到当前能量自愈
    if (active) {
      this.continuousActiveChunks += 1
      if (this.continuousActiveChunks >= RECALIBRATE_AFTER_CHUNKS) {
        this.baselineDb = db
        this.continuousActiveChunks = 0
        log.info(
          `[voice-gate] sustained energy ${db.toFixed(1)}dB for 8s, baseline recalibrated (steady noise assumed)`,
        )
      }
    } else {
      this.continuousActiveChunks = 0
    }

    this.chunksSinceStart += 1
    // 能量层放行段记录（覆盖率校验分母——只统计真正喂给 ASR 的样本）
    if (active) {
      if (this.activeStart < 0) this.activeStart = this.fedSamples
      this.activePendingEnd = this.fedSamples + samples.length
    } else if (this.activeStart >= 0) {
      this.activeSpans.push({ start: this.activeStart, end: this.activePendingEnd })
      this.activeStart = -1
    }
    if (active !== this.speechActive) {
      this.speechActive = active
      try {
        this.onSpeechActivity?.(active)
      } catch {
        // 回调异常不得影响门控主流程
      }
    }

    if (this.useSilero) {
      const vad = loadVad()
      if (vad != null) {
        try {
          vad.acceptWaveform(float)
          this.drainSpans(vad)
        } catch (error) {
          log.warn(`silero VAD feed error: ${String(error)}`)
        }
      }
    }

    this.fedSamples += samples.length

    if (active) return samples
    // 门控：置零（保留长度）
    return new Int16Array(samples.length)
  }

  private drainSpans(vad: SherpaVad): void {
    while (!vad.isEmpty()) {
      // front() 的 samples 指向内部共享 buffer，pop() 后失效——只取偏移与长度
      const segment = vad.front(false)
      const start = segment.start
      const end = segment.start + segment.samples.length
      vad.pop()
      if (end <= this.lastSpanEnd) continue
      const clampedStart = Math.max(start, this.lastSpanEnd)
      if (clampedStart < end) {
        this.speechSpans.push({ start: clampedStart, end })
        this.lastSpanEnd = end
      }
    }
    // 时间轴裁剪：只保留最近 TIMELINE_MAX_SAMPLES 窗口
    if (this.fedSamples > TIMELINE_MAX_SAMPLES) {
      const cutoff = this.fedSamples - TIMELINE_MAX_SAMPLES
      this.speechSpans = this.speechSpans.filter((span) => span.end > cutoff)
      this.activeSpans = this.activeSpans.filter((span) => span.end > cutoff)
    }
  }

  /** 收尾仍在进行中的 active span（stop flush 后的覆盖率查询需要完整时间轴） */
  private closeActiveSpan(): void {
    if (this.activeStart >= 0) {
      this.activeSpans.push({ start: this.activeStart, end: this.activePendingEnd })
      this.activeStart = -1
    }
  }

  /** 两段升序时间轴在 [start,end) 内的交集样本数 */
  private intersectSpans(
    primary: SpeechSpan[],
    secondary: SpeechSpan[],
    start: number,
    end: number,
  ): number {
    let total = 0
    for (const x of primary) {
      const xs = Math.max(x.start, start)
      const xe = Math.min(x.end, end)
      if (xs >= xe) continue
      for (const y of secondary) {
        if (y.end <= xs) continue
        if (y.start >= xe) break
        total += Math.min(y.end, xe) - Math.max(y.start, xs)
      }
    }
    return total
  }

  /**
   * silero 人声覆盖率：[startSample, endSample) 区间被人声段覆盖的比例。
   * silero 层不可用时返回 1（不拦截，能量层仍在工作）。
   */
  coverageRatio(startSample: number, endSample: number): number {
    if (!this.useSilero) return 1
    const vad = loadVad()
    if (vad == null) return 1
    const span = Math.max(0, endSample - startSample)
    if (span === 0) return 1
    let covered = 0
    for (const speech of this.speechSpans) {
      if (speech.end <= startSample) continue
      if (speech.start >= endSample) break
      covered += Math.min(speech.end, endSample) - Math.max(speech.start, startSample)
    }
    return Math.min(1, covered / span)
  }

  /**
   * 放行样本人声覆盖率：final 区间内「能量层放行（真正喂给 ASR）的样本」被
   * silero 人声段覆盖的比例。分母不含门控静音段——慢语速/多停顿的语句不再被
   * 静音稀释误杀；真正的噪音硬解（能量达标放行但 silero 判非人声）覆盖率
   * 接近 0，仍被有效拦截。放行样本为空时保守放行（能量层都拦下了，不该有 final）。
   */
  coverageRatioOverActive(startSample: number, endSample: number): number {
    if (!this.useSilero) return 1
    const vad = loadVad()
    if (vad == null) return 1
    const unit: SpeechSpan[] = [{ start: startSample, end: endSample }]
    // 进行中的 active span（用户仍在说）临时并入，流式 final 校验时它尚未收尾
    const activeSpans =
      this.activeStart >= 0
        ? [...this.activeSpans, { start: this.activeStart, end: this.activePendingEnd }]
        : this.activeSpans
    const activeTotal = this.intersectSpans(activeSpans, unit, startSample, endSample)
    if (activeTotal === 0) return 1
    const covered = this.intersectSpans(activeSpans, this.speechSpans, startSample, endSample)
    return Math.min(1, covered / activeTotal)
  }

  /**
   * [startSample, endSample) 区间内 silero 人声段的绝对毫秒数（confirm-only
   * 判据的度量）。silero 层不可用（模型缺失/未安装/测试禁用）返回 null，
   * 调用方据此降级到 VoiceTransientGuard 兜底，而不是误判为 0ms 拒绝。
   */
  voicedMsSince(startSample: number, endSample: number): number | null {
    if (!this.useSilero) return null
    const vad = loadVad()
    if (vad == null) return null
    const span = Math.max(0, endSample - startSample)
    if (span === 0) return 0
    let covered = 0
    for (const speech of this.speechSpans) {
      if (speech.end <= startSample) continue
      if (speech.start >= endSample) break
      covered += Math.min(speech.end, endSample) - Math.max(speech.start, startSample)
    }
    return covered / (this.sampleRate / 1000)
  }

  /**
   * final 是否放行。confirm-only：区间 silero 人声绝对时长 ≥120ms 才接受
   * （点击瞬态即便骗过 silero 也远短于该时长）；silero 不可用时放行交由
   * 外层 guard 兜底。完整门控：放行样本的 silero 人声覆盖率低于档位阈值
   * 判为噪音硬解。
   */
  shouldAcceptFinal(startSample: number, endSample: number): boolean {
    if (this.confirmOnly) {
      const voicedMs = this.voicedMsSince(startSample, endSample)
      if (voicedMs == null) return true
      if (voicedMs >= MIN_VOICED_MS_FOR_FINAL) return true
      log.info(
        `[voice-gate] final dropped: silero voiced ${voicedMs.toFixed(0)}ms below ${MIN_VOICED_MS_FOR_FINAL}ms minimum (confirm-only)`,
      )
      return false
    }
    const ratio = this.coverageRatioOverActive(startSample, endSample)
    const accept = ratio >= SILERO_COVERAGE_MIN[this.mode]
    if (!accept) {
      log.info(
        `[voice-gate] final dropped: speech coverage of admitted audio ${(ratio * 100).toFixed(0)}% below ${SILERO_COVERAGE_MIN[this.mode] * 100}%`,
      )
    }
    return accept
  }

  /** 停止收音时逼出 silero 未确认段（stop flush 的 final 校验需要完整时间轴） */
  flushSilero(): void {
    this.closeActiveSpan()
    if (!this.useSilero) return
    const vad = loadVad()
    if (vad == null) return
    try {
      vad.flush()
      this.drainSpans(vad)
    } catch (error) {
      log.warn(`silero VAD flush error: ${String(error)}`)
    }
  }

  /** 会话开始：重置状态与 silero 内部缓冲（单例复用的隔离手段） */
  reset(): void {
    this.baselineDb = null
    this.chunksSinceStart = 0
    this.quietChunks = HANGOVER_CHUNKS
    this.continuousActiveChunks = 0
    this.speechActive = false
    this.fedSamples = 0
    this.speechSpans = []
    this.lastSpanEnd = 0
    this.activeSpans = []
    this.activeStart = -1
    this.activePendingEnd = 0
    if (this.useSilero) {
      const vad = loadVad()
      try {
        vad?.reset()
      } catch {
        // reset 失败则单例带着旧状态降级运行，时间轴由 span 合并逻辑兜底
      }
    }
  }
}
