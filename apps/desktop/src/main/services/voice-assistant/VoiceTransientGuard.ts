/**
 * VoiceTransientGuard — 非人声瞬态前置校验（纯 TS DSP，无 native 依赖）
 *
 * 用户痛点：鼠标点击等非人声瞬态（10-50ms 宽带脉冲）被 ASR 硬解成「我」等
 * token 并提交给模型，浪费轮次与 token。sherpa OnlineRecognizer 只有 rule1/2/3
 * 端点规则、对最短语音时长无约束，瞬态脉冲直达解码器。本模块在 ASR 之外
 * 旁路产出「人声段时间轴」，供 final 产出时做接受/拒绝判定。
 *
 * 判据（点击 vs 人声的声学区分）：
 * - 点击（瞬态脉冲）= 起音 <5ms + 衰减 <60ms + 高频谱平坦度（宽带无结构）
 *   + 无谐波结构（自相关无基频峰）+ 段长 <80ms。
 * - 人声 = 持续段 ≥200ms（典型）+ 自相关谐波峰（基频 71-500Hz 范围 NCCF 高）
 *   + 能量包络有音节起伏（中文单字 150-300ms）。中文最短单字/语气词可低至
 *   ~150ms，故 120-200ms 的非瞬态段仍计入人声（防误杀短字）；<120ms 的
 *   非瞬态段丢弃（太短，即便丢失也不影响句义）。能量起伏不做硬判据——
 *   连续语流包络可无深谷，硬判会误杀。
 *
 * 历史教训（v1 能量置零门控伤识别率被回退）：本模块绝不修改音频、不丢
 * chunk、不置零——只读分析，只产出人声段时间轴。流式 partial 与 KWS 唤醒
 * 路径完全不受影响。
 *
 * 段划分复用 VoiceNoiseGate 的 attack-hysteresis/hangover 语义（chunk 级
 * dB 判定 + 自适应底噪 + 6 chunk 尾保持），但仅用于圈定分析窗口；特征提取
 * 在「有效包络跨度」（段峰 -25dB 以上的首末子窗）上进行，hangover 静音不
 * 参与特征。FFT 256 点（16kHz 下 ~16ms 窗），NCCF 仅在频谱平坦度疑似宽带时
 * 计算（低平坦度必为谐波/调音结构，直接视为有谐波性），整窗开销微秒级。
 *
 * 坐标系：fedSamples 是会话累计采样游标（与 VoiceRecognitionService 的
 * totalSamples 同步推进、跨轮 trim 不回退），时间轴查询一律用绝对采样偏移。
 */

/** 段级声学特征（段关闭或查询时快照聚合；窗级分析流式累积） */
export interface TransientFeatures {
  /** 有效包络跨度时长（段峰-25dB 以上子窗的首末跨度） */
  durationMs: number
  /** 跨度起点到全局能量峰的时长（起音速度） */
  attackMs: number
  /** 全局能量峰到跨度终点的时长（衰减速度） */
  decayMs: number
  /** 频谱平坦度（几何均值/算术均值，0=纯音 1=白噪；宽带脉冲接近 1） */
  spectralFlatness: number
  /** 谐波性（基频范围归一化自相关峰值，0=无周期 1=强谐波） */
  harmonicity: number
  /** 过零率（0-1，清辅音与宽带噪声偏高；观测特征，不参与瞬态硬判据） */
  zeroCrossingRate: number
}

// ─── 瞬态判定阈值（导出常量便于按实测调参） ─────────────────────────────────

/** 瞬态段长上限：短于该值的段才可能是点击 */
export const TRANSIENT_MAX_DURATION_MS = 80
/** 点击起音上限：机械/电瞬态起音近垂直 */
export const TRANSIENT_MAX_ATTACK_MS = 5
/** 点击衰减上限：宽带脉冲能量快速衰减 */
export const TRANSIENT_MAX_DECAY_MS = 60
/** 瞬态最低频谱平坦度：低于该值必有频谱结构（谐波/调音），非宽带脉冲 */
export const TRANSIENT_MIN_SPECTRAL_FLATNESS = 0.35
/** 瞬态最高谐波性：点击无基频周期 */
export const TRANSIENT_MAX_HARMONICITY = 0.35
/** 计入人声的最短段长（与 silero confirm-only 判据的 120ms 对齐；中文单字下限保护） */
export const MIN_VOICED_SPAN_MS = 120

/** 有效包络跨度相对阈：段峰 -25dB 以上的子窗计入跨度 */
const SPAN_RELATIVE_DB = 25
/** 跨度绝对下限：极安静环境下防止底噪噪声地板拉长跨度 */
const SPAN_ABSOLUTE_FLOOR_DB = -50
/** 段数据保留上限（子窗数，1ms/子窗）：超长段必非瞬态，只保留头部数据防内存增长 */
const MAX_SPAN_SUBWINDOWS = 4096

// ─── 段划分常量（语义复用 VoiceNoiseGate，仅圈定分析窗口） ──────────────────
const GATE_ENERGY_GAIN_DB = 6
const GATE_ATTACK_RELAX_DB = 4
const GATE_ABSOLUTE_FLOOR_DB = -55
const GATE_BASELINE_EMA_ALPHA = 0.05
const GATE_WARMUP_CHUNKS = 3
const GATE_HANGOVER_CHUNKS = 6

/** 时间轴保留窗口（采样点，sampleRate × 120s），防长会话内存增长 */
const TIMELINE_MAX_SECONDS = 120

const FFT_SIZE = 256
/** NCCF lag 范围：71Hz-500Hz 覆盖男女声基频（16kHz 下 lag 32-224） */
const NCCF_MIN_LAG_HZ = 500
const NCCF_MAX_LAG_HZ = 71

/**
 * 段特征是否为非人声瞬态（点击等宽带脉冲）。五条 AND 全满足才判瞬态——
 * 保守取向：宁可放行模糊段（外层还有 silero 票），不可误杀真人声。
 */
export function isTransientBurst(features: TransientFeatures): boolean {
  return (
    features.durationMs < TRANSIENT_MAX_DURATION_MS &&
    features.attackMs < TRANSIENT_MAX_ATTACK_MS &&
    features.decayMs < TRANSIENT_MAX_DECAY_MS &&
    features.spectralFlatness >= TRANSIENT_MIN_SPECTRAL_FLATNESS &&
    features.harmonicity <= TRANSIENT_MAX_HARMONICITY
  )
}

// ─── 纯函数 DSP 工具 ────────────────────────────────────────────────────────

/** in-place 迭代 radix-2 FFT（实部/虚部等长，长度须为 2 的幂） */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j |= bit
    if (i < j) {
      const tr = re[i] as number
      re[i] = re[j] as number
      re[j] = tr
      const ti = im[i] as number
      im[i] = im[j] as number
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k += 1) {
        const iEven = i + k
        const iOdd = iEven + half
        const uRe = re[iEven] as number
        const uIm = im[iEven] as number
        const oddRe = re[iOdd] as number
        const oddIm = im[iOdd] as number
        const vRe = oddRe * curRe - oddIm * curIm
        const vIm = oddRe * curIm + oddIm * curRe
        re[iEven] = uRe + vRe
        im[iEven] = uIm + vIm
        re[iOdd] = uRe - vRe
        im[iOdd] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** 频谱平坦度：功率谱几何均值/算术均值（0=纯音，1=白噪） */
function spectralFlatness(re: Float64Array, im: Float64Array, bins: number): number {
  let logSum = 0
  let sum = 0
  for (let i = 1; i <= bins; i += 1) {
    const p = (re[i] as number) * (re[i] as number) + (im[i] as number) * (im[i] as number)
    logSum += Math.log(p + 1e-12)
    sum += p
  }
  if (sum <= 0) return 0
  const geo = Math.exp(logSum / bins)
  return Math.min(1, geo / (sum / bins))
}

/**
 * 基频范围归一化自相关峰值（NCCF）。用前缀平方和把每个 lag 的计算压成
 * 一遍乘加；帧近全零（静音）时返回 0。
 */
function maxNccf(
  frame: Float64Array,
  prefixSq: Float64Array,
  minLag: number,
  maxLag: number,
): number {
  const n = frame.length
  let mean = 0
  for (let i = 0; i < n; i += 1) mean += frame[i] as number
  mean /= n
  let energy = 0
  for (let i = 0; i < n; i += 1) {
    const v = (frame[i] as number) - mean
    frame[i] = v
    energy += v * v
  }
  if (energy < 1e-10) return 0
  // 去均值后重算前缀平方和（直流分量移除会改变能量分布）
  prefixSq[0] = (frame[0] as number) * (frame[0] as number)
  for (let i = 1; i < n; i += 1) {
    const v = frame[i] as number
    prefixSq[i] = (prefixSq[i - 1] as number) + v * v
  }
  const total = prefixSq[n - 1] as number
  let best = 0
  for (let lag = minLag; lag <= maxLag && lag < n - 8; lag += 1) {
    let corr = 0
    const limit = n - lag
    for (let i = 0; i < limit; i += 1) {
      corr += (frame[i] as number) * (frame[i + lag] as number)
    }
    const ePre = prefixSq[limit - 1] as number
    const eSuf = total - ePre
    if (ePre < 1e-10 || eSuf < 1e-10) continue
    const value = corr / Math.sqrt(ePre * eSuf)
    if (value > best) best = value
  }
  return Math.max(0, Math.min(1, best))
}

// ─── 内部数据结构 ───────────────────────────────────────────────────────────

interface WindowFeatures {
  /** 窗 RMS 能量（dB），活跃窗过滤与包络参考 */
  rmsDb: number
  flatness: number
  harmonicity: number
  zeroCrossingRate: number
}

interface VoicedSpan {
  start: number
  end: number
}

export interface VoiceTransientGuardOptions {
  /** 采样率（默认 16000，与识别管线一致） */
  sampleRate?: number
}

/**
 * 会话级瞬态守卫：逐 chunk 只读分析，维护人声段时间轴。
 * 旁路组件——不修改音频、不影响任何既有门控与识别路径。
 */
export class VoiceTransientGuard {
  private readonly sampleRate: number
  /** 每 1ms 的子窗样本数 */
  private readonly subWindowSamples: number
  private readonly subWindowMs: number

  // 段划分状态机（chunk 级）
  private baselineDb: number | null = null
  private chunksSinceStart = 0
  private quietChunks = GATE_HANGOVER_CHUNKS

  // 会话累计采样游标（绝对偏移坐标系，只增不减）
  private fedSamples = 0
  /** 人声段时间轴（绝对采样偏移，升序） */
  private voicedSpans: VoicedSpan[] = []
  /** 时间轴已裁剪到的最早偏移（早于该值的历史不可查询） */
  private timelineFloor = 0

  // 进行中段状态
  private spanActive = false
  private spanStartSample = 0
  /** 子窗包络 dB（cap 到 MAX_SPAN_SUBWINDOWS 保留头部；溢出段必非瞬态） */
  private subWindows: number[] = []
  private subWindowCount = 0
  private spanPeakDb = -Infinity
  /** 全局峰子窗索引（cap 内有效） */
  private spanPeakSubIdx = 0
  private windows: WindowFeatures[] = []
  private spanWindowPeakDb = -Infinity
  private windowBuf = new Float64Array(FFT_SIZE)
  private windowFill = 0
  private fftRe = new Float64Array(FFT_SIZE)
  private fftIm = new Float64Array(FFT_SIZE)
  private nccfFrame = new Float64Array(FFT_SIZE)
  private nccfPrefix = new Float64Array(FFT_SIZE)

  constructor(options: VoiceTransientGuardOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000
    this.subWindowSamples = Math.max(1, Math.round(this.sampleRate / 1000))
    this.subWindowMs = (this.subWindowSamples / this.sampleRate) * 1000
  }

  /**
   * 逐 chunk 喂入原始 PCM（只读，绝不修改）。chunk 级能量判定圈定活跃段，
   * 段内做窗级特征流式累积；段关闭时分类并入人声时间轴。
   */
  process(samples: Int16Array): void {
    if (samples.length === 0) return
    const rms = chunkRmsDb(samples)
    const active = this.judgeChunkActivity(rms)
    if (active) {
      if (!this.spanActive) {
        this.spanActive = true
        this.spanStartSample = this.fedSamples
      }
      this.accumulateSpan(samples)
    } else if (this.spanActive) {
      this.closeSpan()
    }
    this.fedSamples += samples.length
  }

  /** [startSample, endSample) 内是否存在被确认为人声的段（含进行中段快照） */
  hasVoicedSpanSince(startSample: number, endSample: number): boolean {
    return this.voicedMsSince(startSample, endSample) > 0
  }

  /** [startSample, endSample) 内人声段的累计毫秒数（绝对偏移区间交集） */
  voicedMsSince(startSample: number, endSample: number): number {
    const start = Math.max(0, Math.floor(startSample))
    const end = Math.floor(endSample)
    if (end <= start) return 0
    let coveredSamples = 0
    for (const span of this.voicedSpans) {
      if (span.end <= start) continue
      if (span.start >= end) break
      coveredSamples += Math.min(span.end, end) - Math.max(span.start, start)
    }
    // 进行中段快照：final 常在 hangover 期内产生（段尚未关闭），等价于
    // VoiceNoiseGate 覆盖率查询时把进行中 active span 临时并入的做法
    if (this.spanActive) {
      const snapshot = this.classifySpan()
      if (snapshot != null && snapshot.voiced) {
        const s = Math.max(this.spanStartSample, start)
        const e = Math.min(snapshot.effectiveEndSample, end)
        if (e > s) coveredSamples += e - s
      }
    }
    return coveredSamples / (this.sampleRate / 1000)
  }

  /**
   * 区间是否可判定：查询终点已被分析覆盖，且起点未被时间轴窗口裁剪。
   * false = 区间数据不完整（查询过早 / 历史已裁剪），调用方应放弃 guard 判定。
   */
  isRangeKnown(startSample: number, endSample: number): boolean {
    return (
      Math.floor(endSample) <= this.fedSamples &&
      Math.max(0, Math.floor(startSample)) >= this.timelineFloor
    )
  }

  /** 会话开始/复用前重置（时间轴、段状态、底噪基线全部清空） */
  reset(): void {
    this.baselineDb = null
    this.chunksSinceStart = 0
    this.quietChunks = GATE_HANGOVER_CHUNKS
    this.fedSamples = 0
    this.voicedSpans = []
    this.timelineFloor = 0
    this.resetSpanState()
  }

  // ─── 段划分（chunk 级，语义复用 VoiceNoiseGate：warmup/attack 迟滞/hangover） ──

  private judgeChunkActivity(db: number): boolean {
    const threshold = Math.max(
      (this.baselineDb ?? -60) + GATE_ENERGY_GAIN_DB,
      GATE_ABSOLUTE_FLOOR_DB,
    )
    let active: boolean
    if (this.chunksSinceStart < GATE_WARMUP_CHUNKS) {
      this.baselineDb = Math.min(this.baselineDb ?? Infinity, db)
      active = true
      this.quietChunks = 0
    } else if (db >= threshold - GATE_ATTACK_RELAX_DB) {
      active = true
      this.quietChunks = 0
    } else if (this.quietChunks < GATE_HANGOVER_CHUNKS) {
      active = true
      this.quietChunks += 1
    } else {
      active = false
      this.baselineDb =
        this.baselineDb == null
          ? db
          : this.baselineDb * (1 - GATE_BASELINE_EMA_ALPHA) + db * GATE_BASELINE_EMA_ALPHA
    }
    this.chunksSinceStart += 1
    return active
  }

  // ─── 段内累积 ──────────────────────────────────────────────────────────────

  private accumulateSpan(samples: Int16Array): void {
    let subSum = 0
    let subCount = 0
    let zeroCrossings = 0
    let prev = this.windowFill > 0 ? (this.windowBuf[this.windowFill - 1] as number) : 0
    for (let i = 0; i < samples.length; i += 1) {
      const v = (samples[i] ?? 0) / 32768
      subSum += v * v
      subCount += 1
      if (v > 0 !== prev > 0) zeroCrossings += 1
      prev = v
      this.windowBuf[this.windowFill] = v
      this.windowFill += 1
      if (this.windowFill === FFT_SIZE) {
        this.analyzeWindow(zeroCrossings)
        zeroCrossings = 0
      }
      if (subCount === this.subWindowSamples) {
        this.pushSubWindow(Math.sqrt(subSum / subCount))
        subSum = 0
        subCount = 0
      }
    }
  }

  private pushSubWindow(rms: number): void {
    this.subWindowCount += 1
    if (this.subWindows.length >= MAX_SPAN_SUBWINDOWS) return
    const db = 20 * Math.log10(rms + 1e-10)
    this.subWindows.push(db)
    if (db > this.spanPeakDb) {
      this.spanPeakDb = db
      this.spanPeakSubIdx = this.subWindowCount - 1
    }
  }

  /** 满窗分析：FFT 平坦度 + 条件 NCCF + 过零率，窗特征入段数组 */
  private analyzeWindow(zeroCrossings: number): void {
    const rms = windowRms(this.windowBuf)
    const rmsDb = 20 * Math.log10(rms + 1e-10)
    this.fftRe.set(this.windowBuf)
    this.fftIm.fill(0)
    fftInPlace(this.fftRe, this.fftIm)
    const flatness = spectralFlatness(this.fftRe, this.fftIm, FFT_SIZE / 2)
    // 低平坦度必有频谱结构（谐波/共振峰），直接视为有谐波性；只在疑似宽带时
    // 花费 NCCF 计算确认「无基频周期」——人声浊音窗（占多数）全部走快路径
    const harmonicity =
      flatness < TRANSIENT_MIN_SPECTRAL_FLATNESS
        ? 1
        : (() => {
            this.nccfFrame.set(this.windowBuf)
            return maxNccf(
              this.nccfFrame,
              this.nccfPrefix,
              Math.round(this.sampleRate / NCCF_MIN_LAG_HZ),
              Math.round(this.sampleRate / NCCF_MAX_LAG_HZ),
            )
          })()
    if (this.windows.length < MAX_SPAN_SUBWINDOWS / (FFT_SIZE / this.subWindowSamples)) {
      this.windows.push({
        rmsDb,
        flatness,
        harmonicity,
        zeroCrossingRate: zeroCrossings / FFT_SIZE,
      })
    }
    if (rmsDb > this.spanWindowPeakDb) this.spanWindowPeakDb = rmsDb
    this.windowFill = 0
    this.windowBuf.fill(0)
  }

  /** 段关闭：残余样本补零分析后分类，人声段并入时间轴，清空段状态 */
  private closeSpan(): void {
    if (this.windowFill > 0) {
      this.analyzeWindow(0)
    }
    const result = this.classifySpan()
    if (result != null && result.voiced) {
      this.voicedSpans.push({ start: this.spanStartSample, end: result.effectiveEndSample })
    }
    this.trimTimeline()
    this.resetSpanState()
  }

  /** 清空进行中段全部状态（开新段或 reset 复用） */
  private resetSpanState(): void {
    this.spanActive = false
    this.spanStartSample = 0
    this.subWindows = []
    this.subWindowCount = 0
    this.spanPeakDb = -Infinity
    this.spanPeakSubIdx = 0
    this.windows = []
    this.spanWindowPeakDb = -Infinity
    this.windowFill = 0
    this.windowBuf.fill(0)
  }

  /**
   * 当前段快照分类：voiced=非瞬态且有效时长达标；effectiveEndSample=有效
   * 包络跨度终点（段划分终点含 hangover 静音，不能作时间轴边界）。
   * 段关闭时与查询时（final 常产生于 hangover 期内）共用同一分类函数。
   */
  private classifySpan(): { voiced: boolean; effectiveEndSample: number } | null {
    if (this.subWindowCount === 0) return null
    const overflow = this.subWindowCount > this.subWindows.length
    const totalSubs = this.subWindowCount
    const spanEndSample = this.spanStartSample + totalSubs * this.subWindowSamples
    if (overflow) {
      // 超长段（>4s 数据已截断保留头部）：必非瞬态，时长用全量计数
      const durationMs = totalSubs * this.subWindowMs
      return { voiced: durationMs >= MIN_VOICED_SPAN_MS, effectiveEndSample: spanEndSample }
    }
    const spanThresholdDb = Math.max(this.spanPeakDb - SPAN_RELATIVE_DB, SPAN_ABSOLUTE_FLOOR_DB)
    let first = -1
    let last = -1
    for (let i = 0; i < this.subWindows.length; i += 1) {
      if ((this.subWindows[i] as number) > spanThresholdDb) {
        if (first < 0) first = i
        last = i
      }
    }
    if (first < 0) {
      // 纯静音段（warmup 开在静音上）：无有效包络，不入时间轴
      return { voiced: false, effectiveEndSample: this.spanStartSample }
    }
    const firstAbs = first
    const lastAbs = last
    const peakAbs = this.spanPeakSubIdx
    const durationMs = (lastAbs - firstAbs + 1) * this.subWindowMs
    const attackMs = Math.max(0, peakAbs - firstAbs) * this.subWindowMs
    const decayMs = Math.max(0, lastAbs - peakAbs) * this.subWindowMs

    // 窗特征聚合：只用活跃窗（能量达段窗峰-25dB），hangover/段尾静音不稀释
    const winThreshold = this.spanWindowPeakDb - SPAN_RELATIVE_DB
    const pool: WindowFeatures[] = []
    for (const w of this.windows) {
      if (w.rmsDb > winThreshold) pool.push(w)
    }
    if (pool.length === 0 && this.windows.length > 0) {
      for (const w of this.windows) pool.push(w)
    }
    const flatness = pool.length > 0 ? median(pool.map((w) => w.flatness)) : 0
    const harmonicity =
      pool.length > 0
        ? quantile(
            pool.map((w) => w.harmonicity),
            0.75,
          )
        : 0
    const zeroCrossingRate =
      pool.length > 0 ? pool.reduce((acc, w) => acc + w.zeroCrossingRate, 0) / pool.length : 0

    const features: TransientFeatures = {
      durationMs,
      attackMs,
      decayMs,
      spectralFlatness: flatness,
      harmonicity,
      zeroCrossingRate,
    }
    const voiced = !isTransientBurst(features) && durationMs >= MIN_VOICED_SPAN_MS
    const effectiveEndSample = Math.min(
      spanEndSample,
      this.spanStartSample + (lastAbs + 1) * this.subWindowSamples,
    )
    return { voiced, effectiveEndSample }
  }

  /** 时间轴窗口裁剪：只保留最近 TIMELINE_MAX_SECONDS，裁掉部分不可再查询 */
  private trimTimeline(): void {
    const maxSamples = this.sampleRate * TIMELINE_MAX_SECONDS
    if (this.fedSamples <= maxSamples) return
    const floor = this.fedSamples - maxSamples
    this.voicedSpans = this.voicedSpans.filter((span) => span.end > floor)
    this.timelineFloor = Math.max(this.timelineFloor, floor)
  }
}

// ─── 数值工具 ───────────────────────────────────────────────────────────────

function chunkRmsDb(samples: Int16Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] ?? 0) / 32768
    sum += v * v
  }
  return 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-10)
}

function windowRms(buf: Float64Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i] as number
    sum += v * v
  }
  return Math.sqrt(sum / buf.length)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[idx] as number
}
