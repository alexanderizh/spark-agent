/**
 * VoiceTtsPipeline — 逐句 TTS 流水线（主进程）
 *
 * Agent 回复 delta → SentenceSplitter 切句 → 合成 → 推送渲染端播放队列 →
 * 播放反馈回收 → 全部播完回调。
 *
 * 关键行为：
 * - 首句即合成即播（不等 Agent 说完，压首字延迟）；首句快切（可选）：
 *   凑齐 ≥10 字或首 delta 后 400ms 强切——首句是延迟敏感句，完整性次要
 * - N+1 预取（可选）：合成并发 2（当前句 + 预取 1 句），播放严格按切句序
 *   （sentenceId/sequence 在切句时分配，合成乱序完成不影响播报顺序）
 * - isFinal 兜底：若 delta 事件全部丢失，用全文重新喂切分器
 * - 单句合成失败/超时：跳过该句 + 错误提示音（不阻断后续句）
 * - 整轮全部句子合成失败（成功 0 句）：经 onTurnSynthesisFailed 通知用户一次；
 *   相同原因 5 分钟内不重复提示，部分成功只记日志
 * - cancel()：清空待合成队列、中止在途合成结果（generation 校验）、停播
 *   （带 120ms 淡出）、删除未播放文件
 * - graceful takeover（边播边处理）：当前句自然播完、余句按 playback-error
 *   回收、新首句就绪后按 sequence 在句边界无缝接上；15s 兜底强制收口
 * - 每句文本随队列保留（EchoGuard 回声守卫的数据源：在播/待播/最近播完）
 * - 播放完成的音频文件立即删除；另有服务启动时的目录清扫兜底
 */

import { unlink } from 'node:fs/promises'
import { createLogger, SentenceSplitter, speechifyText } from '@spark/shared'
import type { VoiceAssistantPlayCommand } from '@spark/protocol'

const log = createLogger('voice-tts')

/** 单句合成超时（云端 TTS 首响一般 <5s；超时视为该句失败跳过） */
const SYNTHESIS_TIMEOUT_MS = 30_000
/** 流式路径单轮朗读上限（与 speechifyText 整段上限一致；超出截断并提示） */
const MAX_STREAM_SPEAKABLE_CHARS = 800
const STREAM_TRUNCATION_SENTENCE = '内容较长，完整回复请在应用中查看。'
/** 整轮合成失败提示的节流窗口：相同原因 5 分钟内不重复弹（连续对话防刷屏） */
const FAILURE_NOTICE_THROTTLE_MS = 5 * 60 * 1000
/** 失败提示里错误要点摘要的最大长度 */
const FAILURE_NOTICE_MAX_DETAIL_CHARS = 80
/** 首句快切：凑齐字符数（达到即切，不等自然边界） */
const FIRST_SENTENCE_MIN_CHARS = 10
/** 首句快切：首 delta 后强切兜底（模型吐字慢/首词是长代码块） */
const FIRST_SENTENCE_FORCE_CUT_MS = 400
/** graceful takeover 后等待旧句 ended 的兜底上限（单句音频时长上限量级） */
const GRACEFUL_TAKEOVER_TIMEOUT_MS = 15_000
/** 播放启动间隙健康度日志阈值 */
const PLAYBACK_GAP_LOG_THRESHOLD_MS = 50
/** 回声守卫可见的最近播完句数（环形缓冲） */
const RECENT_PLAYED_FOR_ECHO_GUARD = 8

/** 整轮合成失败的原因归类：no-channel = 无可用语音合成渠道/能力不支持，other = 渠道等运行错误 */
export type TtsFailureNoticeReason = 'no-channel' | 'other'

/**
 * 「无可用语音合成渠道/能力不支持」类错误的特征串（按 error.message 匹配，不含错误码字面量）：
 * - media-router 无候选渠道：`No provider supports capability audio.speech`
 * - ttsSynthesis 渠道列表为空：`未配置支持语音合成的多媒体渠道`
 * - 钉选模型 manifest 未声明该能力：`Model X does not support capability audio.speech`
 *   （MediaProviderError 只把错误码存到 error.code，message 不含 `capability_not_supported` 字面量）
 */
const NO_TTS_CHANNEL_PATTERNS: readonly string[] = [
  'No provider supports',
  'does not support capability',
  '未配置支持语音合成的多媒体渠道',
]

/** 按错误信息归类失败原因（决定提示文案是否引导去设置配置渠道） */
export function classifyTtsFailureReason(message: string): TtsFailureNoticeReason {
  return NO_TTS_CHANNEL_PATTERNS.some((pattern) => message.includes(pattern))
    ? 'no-channel'
    : 'other'
}

/** 错误要点摘要：压缩空白后截断，保证 toast 文案简短不吓人 */
function summarizeErrorDetail(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim()
  return cleaned.length > FAILURE_NOTICE_MAX_DETAIL_CHARS
    ? `${cleaned.slice(0, FAILURE_NOTICE_MAX_DETAIL_CHARS)}…`
    : cleaned
}

/** 整轮失败的用户提示文案：无渠道类给配置引导，其余只展示错误要点 */
export function buildTtsFailureNoticeMessage(
  reason: TtsFailureNoticeReason,
  detail: string,
): string {
  if (reason === 'no-channel') {
    return '本轮语音播报失败：没有可用的语音合成渠道，请在 设置 → 语音助手 中配置播报渠道或模型。'
  }
  return `本轮语音播报失败：${summarizeErrorDetail(detail)}`
}

export interface VoiceTtsSynthesisResult {
  filePath: string
}

export interface VoiceTtsPipelineDeps {
  /** 合成一句话为音频文件（实现方负责选择渠道与落盘） */
  synthesize: (sentence: string) => Promise<VoiceTtsSynthesisResult>
  /** 推送播放指令到渲染端 */
  sendPlay: (command: VoiceAssistantPlayCommand) => void
  /** 本轮全部句子播完（turnDone 后队列清空） */
  onAllPlayed: () => void
  /** 是否播放提示音（设置项；false 时 cue 由渲染端静默忽略或主进程不发送） */
  shouldPlayCues: () => boolean
  /**
   * 整轮全部句子合成失败（成功 0 句、失败 ≥1 句）时的用户通知出口。
   * 在 onAllPlayed 之后调用（状态机已回 idle/standby，可安全做同态 error 广播）；
   * 每轮最多一次，节流与文案分类在流水线内完成。
   */
  onTurnSynthesisFailed: (message: string) => void
  /** 首句快切开关（设置项；false 时首句也走自然边界） */
  shouldFastCutFirstSentence?: () => boolean
  /** N+1 预取开关（设置项；false 时合成串行 = 现状行为） */
  shouldPrefetch?: () => boolean
}

interface QueuedPlayback {
  sentenceId: string
  filePath: string
  /** 播放序号（graceful 兜底重发用） */
  sequence: number
  /** 句文本（EchoGuard 回声守卫数据源） */
  text: string
}

/** 待合成条目：sentenceId/sequence 在切句时分配（播放顺序与合成完成序解耦） */
interface PendingSynthesis {
  sentenceId: string
  sequence: number
  text: string
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function safeUnlink(filePath: string): void {
  unlink(filePath).catch((error) => {
    log.warn(`[voice-assistant] failed to remove tts file ${filePath}: ${String(error)}`)
  })
}

/** 新一轮开始的接管模式：immediate = 立即停播（现状）；graceful = 句边界让位（边播边处理） */
export type TurnTakeoverMode = 'immediate' | 'graceful'

export class VoiceTtsPipeline {
  private splitter = new SentenceSplitter()
  /** 等待合成的句子队列（按切句序） */
  private pending: PendingSynthesis[] = []
  /** 在途合成数（并发上限内） */
  private inflightSynthesis = 0
  private sequenceCounter = 0
  /** 已推送到渲染端、等待播放结束的句子 */
  private awaitingPlayback = new Map<string, QueuedPlayback>()
  private turnFinalized = false
  private cancelled = false
  /** 轮次代数：beginTurn/cancel 时自增，在途合成结果按代数校验丢弃（防旧句复活） */
  private generation = 0
  /** delta 已喂入切分器的原始累计文本（isFinal 前缀对账用） */
  private fedRaw = ''
  private failureCount = 0
  /** 本轮合成成功并入播放队列的句子数（部分成功判定：>0 时整轮失败不提示） */
  private successCount = 0
  /** 本轮最近一次合成失败的原始错误信息（原因归类输入） */
  private lastFailureMessage = ''
  /** 上次整轮失败提示（原因 + 时间戳）：跨轮保持，5 分钟内同原因不重复弹 */
  private lastFailureNotice: { reason: TtsFailureNoticeReason; at: number } | null = null
  private playedCount = 0
  private allPlayedNotified = false
  /** 已切出句子的累计字符数（流式长度上限） */
  private emittedChars = 0
  private truncationNotified = false
  // ── 首句快切 ──
  private firstSentenceCut = false
  private firstDeltaAt: number | null = null
  private fastCutTimer: ReturnType<typeof setTimeout> | null = null
  /** 上一句播完时刻（句间播放间隙健康度监控） */
  private lastPlaybackEndedAt: number | null = null
  // ── graceful takeover ──
  private gracefulOldIds: Set<string> = new Set()
  private gracefulTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  // ── 发送水位线（乱序合成不乱播的发送半边） ──
  /** 已发送的最大 sequence（发送序 = sequence 序，防预取乱序完成乱序下发） */
  private sendWatermark = 0
  /** 合成已定局（成功或失败）的 sequence 集合：水位线推进依据（失败句跳过仍推水位） */
  private completedSequences = new Set<number>()
  /**
   * 本代待发条目（sequence → 句）。独立于 awaitingPlayback：graceful 期间旧代
   * 条目仍挂在 awaitingPlayback 等回收，其 sequence 与新代重叠，按 sequence 在
   * awaitingPlayback 里找会命中旧代条目（重发旧句）。
   */
  private awaitingSendSequences = new Map<number, { sentenceId: string; filePath: string }>()
  /** 最近播完句文本（EchoGuard 环形缓冲） */
  private recentPlayedTexts: string[] = []

  constructor(private readonly deps: VoiceTtsPipelineDeps) {}

  /** 新一轮回复开始（由状态机在 submitTurn 成功后调用） */
  beginTurn(takeover: TurnTakeoverMode = 'immediate'): void {
    this.generation += 1
    this.teardownFastCutTimer()
    this.teardownGracefulTimer()
    const hasAwaiting = this.awaitingPlayback.size > 0
    const graceful = takeover === 'graceful' && hasAwaiting
    if (graceful) {
      // 句边界让位：旧句标记待回收（渲染端 graceful stop 会把未播旧句按
      // playback-error 回传，正在播的句子自然播完，文件随回收删除），
      // 新句按 sequence 接上；15s 兜底强制收口防渲染端播放悬挂。
      // awaitingPlayback 保留旧句条目等回收，不在这里清（否则文件泄漏）
      this.gracefulOldIds = new Set(this.awaitingPlayback.keys())
      this.armGracefulTimer()
      this.deps.sendPlay({ kind: 'stop', graceful: true })
      log.info(`[voice-assistant] graceful takeover (oldPending=${this.gracefulOldIds.size})`)
    } else {
      // immediate 模式（或无待播句）：清待播条目（有则删文件）与旧句标记
      if (hasAwaiting) {
        for (const queued of this.awaitingPlayback.values()) safeUnlink(queued.filePath)
        this.deps.sendPlay({ kind: 'stop', fadeMs: 120 })
      }
      this.awaitingPlayback.clear()
      this.gracefulOldIds.clear()
    }
    this.splitter.reset()
    this.pending = []
    this.sequenceCounter = 0
    this.sendWatermark = 0
    this.completedSequences.clear()
    this.awaitingSendSequences.clear()
    this.turnFinalized = false
    this.cancelled = false
    this.fedRaw = ''
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureMessage = ''
    this.playedCount = 0
    this.allPlayedNotified = false
    this.emittedChars = 0
    this.truncationNotified = false
    this.firstSentenceCut = false
    this.firstDeltaAt = null
    this.lastPlaybackEndedAt = null
  }

  /** 喂入 assistant delta（纯增量文本） */
  pushDelta(delta: string): void {
    if (this.cancelled || delta.length === 0) return
    this.fedRaw += delta
    const sentences = this.splitter.push(delta)
    if (sentences.length > 0) this.emitSentences(sentences)
    this.maybeFastCutFirstSentence()
  }

  /**
   * 首句快切：凑齐 ≥10 字立即切（不等自然边界），或首 delta 后 400ms 强切。
   * forceTake 出句尾部自动补句号防 TTS 语气悬置；后续句沿用正常切句规则。
   */
  private maybeFastCutFirstSentence(): void {
    if (this.firstSentenceCut || this.turnFinalized) return
    if (this.deps.shouldFastCutFirstSentence?.() !== true) return
    if (this.firstDeltaAt == null) {
      this.firstDeltaAt = Date.now()
      this.fastCutTimer = setTimeout(() => {
        this.fastCutTimer = null
        this.flushFirstSentenceByForce('force-timeout')
      }, FIRST_SENTENCE_FORCE_CUT_MS)
    }
    if (this.splitter.bufferedChars >= FIRST_SENTENCE_MIN_CHARS) {
      this.flushFirstSentenceByForce('chars-reached')
    }
  }

  private flushFirstSentenceByForce(trigger: 'chars-reached' | 'force-timeout'): void {
    if (this.firstSentenceCut || this.cancelled) return
    const taken = this.splitter.forceTake()
    this.teardownFastCutTimer()
    if (taken == null) return
    this.firstSentenceCut = true
    const msSinceFirstDelta = this.firstDeltaAt != null ? Date.now() - this.firstDeltaAt : 0
    log.info(
      `[voice-assistant] first sentence flush (${taken.length} chars, trigger=${trigger}, msSinceFirstDelta=${msSinceFirstDelta})`,
    )
    this.emitSentences([taken])
  }

  private teardownFastCutTimer(): void {
    if (this.fastCutTimer != null) {
      clearTimeout(this.fastCutTimer)
      this.fastCutTimer = null
    }
  }

  /**
   * isFinal 到达：与 delta 累计做前缀对账后收尾。
   * - delta 全丢：用全文重走切分（speechify 清洗）
   * - 全文比 delta 累计多出尾部（常见：末段 delta 缺失）：补切后缀
   * - 全文与累计无前缀关系（多段 turn 的末段 final）：仅 flush 尾句
   */
  finalize(fullText: string): void {
    if (this.cancelled) return
    const full = fullText.trim()
    const fed = this.fedRaw.trim()
    if (full.length > 0) {
      if (fed.length === 0) {
        this.emitSentences(this.splitter.push(speechifyText(full)))
      } else if (full.startsWith(fed)) {
        const suffix = full.slice(fed.length)
        if (suffix.trim().length > 0) {
          this.emitSentences(this.splitter.push(suffix))
        }
      }
    }
    const tail = this.splitter.flush()
    if (tail.length > 0) this.emitSentences([tail])
    this.turnFinalized = true
    this.teardownFastCutTimer()
    void this.drainSynthesisQueue()
    this.checkAllPlayed()
  }

  /** 轮次终止信号（completed/cancelled/error 后不再有文本） */
  turnDone(): void {
    if (this.cancelled) return
    if (!this.turnFinalized) {
      const tail = this.splitter.flush()
      if (tail.length > 0) this.emitSentences([tail])
      this.turnFinalized = true
    }
    this.teardownFastCutTimer()
    void this.drainSynthesisQueue()
    this.checkAllPlayed()
  }

  /** 打断：停播（淡出）+ 清队列 + 删未播文件。之后流水线不再产生任何回调。 */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.generation += 1
    this.teardownFastCutTimer()
    this.teardownGracefulTimer()
    this.pending = []
    this.splitter.reset()
    for (const queued of this.awaitingPlayback.values()) safeUnlink(queued.filePath)
    this.awaitingPlayback.clear()
    this.deps.sendPlay({ kind: 'stop', fadeMs: 120 })
  }

  /** 渲染端播放反馈 */
  onPlaybackEnded(sentenceId: string): void {
    const queued = this.awaitingPlayback.get(sentenceId)
    if (queued == null) return
    this.awaitingPlayback.delete(sentenceId)
    this.playedCount += 1
    this.rememberPlayedText(queued.text)
    this.lastPlaybackEndedAt = Date.now()
    if (this.gracefulOldIds.size > 0) {
      this.gracefulOldIds.delete(sentenceId)
      if (this.gracefulOldIds.size === 0) this.teardownGracefulTimer()
    }
    safeUnlink(queued.filePath)
    this.checkAllPlayed()
  }

  /** 播放失败/被渲染端跳过：按完成处理（文件删除） */
  onPlaybackFailed(sentenceId: string): void {
    this.onPlaybackEnded(sentenceId)
  }

  /** 当前未播完句子数（状态展示） */
  getPendingCount(): number {
    return this.pending.length + this.awaitingPlayback.size
  }

  /** 已播完句子数（状态展示） */
  getPlayedCount(): number {
    return this.playedCount
  }

  /** 是否有音频正在渲染端播放或等待播放（graceful 派发判定用） */
  isPlaybackActive(): boolean {
    return this.awaitingPlayback.size > 0
  }

  /** 回声守卫数据源：在播 + 待播 + 最近播完句文本 */
  getRecentTtsTexts(): string[] {
    const texts = [...this.awaitingPlayback.values()].map((queued) => queued.text)
    return [...texts, ...this.recentPlayedTexts]
  }

  private rememberPlayedText(text: string): void {
    this.recentPlayedTexts.unshift(text)
    if (this.recentPlayedTexts.length > RECENT_PLAYED_FOR_ECHO_GUARD) {
      this.recentPlayedTexts.length = RECENT_PLAYED_FOR_ECHO_GUARD
    }
  }

  /** 带流式长度上限的句子入队：超限后丢弃剩余句并补一句截断提示 */
  private emitSentences(sentences: string[]): void {
    if (sentences.length === 0) return
    if (this.truncationNotified) return
    const budget = MAX_STREAM_SPEAKABLE_CHARS - this.emittedChars
    let used = 0
    for (const sentence of sentences) {
      if (used + sentence.length > budget) {
        this.truncationNotified = true
        this.pushPending(STREAM_TRUNCATION_SENTENCE)
        this.emittedChars += budget
        log.info(
          `[voice-assistant] streaming speech truncated at ${MAX_STREAM_SPEAKABLE_CHARS} chars`,
        )
        break
      }
      this.pushPending(sentence)
      used += sentence.length
    }
    this.emittedChars += used
    if (this.pending.length > 0) void this.drainSynthesisQueue()
  }

  /**
   * 切句序入队：sentenceId/sequence 在此刻分配（播放顺序与合成完成序解耦）。
   * sentenceId 嵌入轮次 generation 保证全局唯一——graceful 接管时旧轮句子仍挂在
   * awaitingPlayback 等回收，若新轮 counter 归零后撞号，Map 条目会被覆盖
   * （旧句文件泄漏），渲染端回收旧句的事件还会误删同号新句的条目与文件。
   */
  private pushPending(text: string): void {
    this.sequenceCounter += 1
    this.pending.push({
      sentenceId: `va-s${this.generation}-${this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      text,
    })
  }

  /** 合成调度：并发上限内取队首（预取开=2，关=1=串行现状） */
  private async drainSynthesisQueue(): Promise<void> {
    const maxInflight = this.deps.shouldPrefetch?.() === false ? 1 : 2
    while (!this.cancelled && this.inflightSynthesis < maxInflight && this.pending.length > 0) {
      const item = this.pending.shift() as PendingSynthesis
      this.inflightSynthesis += 1
      void this.synthesizeOne(item)
    }
  }

  private async synthesizeOne(item: PendingSynthesis): Promise<void> {
    const generation = this.generation
    try {
      let filePath: string
      try {
        const result = await withTimeout(
          this.deps.synthesize(item.text),
          SYNTHESIS_TIMEOUT_MS,
          'tts synthesis',
        )
        filePath = result.filePath
      } catch (error) {
        this.failureCount += 1
        this.lastFailureMessage = error instanceof Error ? error.message : String(error)
        log.warn(
          `[voice-assistant] tts synthesis failed (sentence skipped, total failures ${this.failureCount}): ${this.lastFailureMessage}`,
        )
        // 失败降级：跳句 + 错误提示音（仅首失时提示，避免连续提示音轰炸）
        if (this.failureCount === 1 && this.deps.shouldPlayCues()) {
          this.deps.sendPlay({ kind: 'cue', cue: 'error' })
        }
        // 失败句不会播：sequence 记为定局并推水位（后续句不被缺失序卡住）
        this.completedSequences.add(item.sequence)
        this.flushReadySends()
        return
      }
      // 在途期间轮次被接管/打断：结果丢弃（防旧句复活）
      if (this.cancelled || generation !== this.generation) {
        safeUnlink(filePath)
        return
      }
      this.successCount += 1
      this.awaitingSendSequences.set(item.sequence, {
        sentenceId: item.sentenceId,
        filePath,
      })
      this.awaitingPlayback.set(item.sentenceId, {
        sentenceId: item.sentenceId,
        filePath,
        sequence: item.sequence,
        text: item.text,
      })
      // 句间播放间隙健康度：上一句播完到本句就绪的空窗（预取水位线失效信号）
      if (this.lastPlaybackEndedAt != null) {
        const gapMs = Date.now() - this.lastPlaybackEndedAt
        if (gapMs > PLAYBACK_GAP_LOG_THRESHOLD_MS) {
          log.info(`[voice-assistant] playback gap (sentence ${item.sequence}, gapMs=${gapMs})`)
        }
      }
      log.info(
        `[voice-assistant] sentence synthesized (${item.sequence}, ${item.text.length} chars)`,
      )
      this.completedSequences.add(item.sequence)
      this.flushReadySends()
    } finally {
      this.inflightSynthesis -= 1
      if (!this.cancelled) {
        void this.drainSynthesisQueue()
        this.checkAllPlayed()
      }
    }
  }

  private checkAllPlayed(): void {
    if (
      !this.cancelled &&
      !this.allPlayedNotified &&
      this.turnFinalized &&
      this.pending.length === 0 &&
      this.inflightSynthesis === 0 &&
      this.awaitingPlayback.size === 0
    ) {
      this.allPlayedNotified = true
      this.teardownGracefulTimer()
      this.deps.onAllPlayed()
      this.notifyTurnSynthesisFailure()
    }
  }

  /**
   * 发送水位线：合成定局（成功/失败）的 sequence 逐级推进，严格按 sequence 序
   * 下发 play——预取（并发 2）下合成完成可乱序，渲染端只对「已到达的指令」
   * 排序，无法预知更低序句是否在途；这里保证到达序本身就是序。
   */
  private flushReadySends(): void {
    if (this.cancelled) return
    while (this.completedSequences.has(this.sendWatermark + 1)) {
      this.sendWatermark += 1
      const entry = this.awaitingSendSequences.get(this.sendWatermark)
      if (entry != null) {
        this.awaitingSendSequences.delete(this.sendWatermark)
        this.deps.sendPlay({
          kind: 'play',
          sentenceId: entry.sentenceId,
          sequence: this.sendWatermark,
          filePath: entry.filePath,
        })
      }
      // 失败句无待发条目：只推水位（跳过发送）
    }
  }

  private armGracefulTimer(): void {
    this.teardownGracefulTimer()
    this.gracefulTimeoutTimer = setTimeout(() => {
      this.gracefulTimeoutTimer = null
      if (this.cancelled || this.gracefulOldIds.size === 0) return
      // 兜底：旧句 ended 超时未回收（渲染端播放悬挂）——硬停全部播放，
      // 把本轮（新）已推句子按序重发，旧句文件清理
      log.warn(
        `[voice-assistant] graceful takeover force-cancel (timeoutMs=${GRACEFUL_TAKEOVER_TIMEOUT_MS}, staleOld=${this.gracefulOldIds.size})`,
      )
      const replay: Array<{
        sentenceId: string
        sequence: number
        filePath: string
        text: string
      }> = []
      for (const [sentenceId, queued] of this.awaitingPlayback) {
        if (this.gracefulOldIds.has(sentenceId)) {
          safeUnlink(queued.filePath)
        } else {
          replay.push({
            sentenceId,
            sequence: queued.sequence,
            filePath: queued.filePath,
            text: queued.text,
          })
        }
      }
      this.awaitingPlayback.clear()
      this.deps.sendPlay({ kind: 'stop' })
      // 重发新句（渲染端 stopped 复位后按 sequence 重新入队；按 sequence 排序——
      // Map 插入序是合成完成序，兜底重发同样不能乱序）
      replay.sort((a, b) => a.sequence - b.sequence)
      for (const item of replay) {
        this.awaitingPlayback.set(item.sentenceId, {
          sentenceId: item.sentenceId,
          filePath: item.filePath,
          sequence: item.sequence,
          text: item.text,
        })
        this.deps.sendPlay({
          kind: 'play',
          sentenceId: item.sentenceId,
          sequence: item.sequence,
          filePath: item.filePath,
        })
      }
      this.gracefulOldIds.clear()
    }, GRACEFUL_TAKEOVER_TIMEOUT_MS)
  }

  private teardownGracefulTimer(): void {
    if (this.gracefulTimeoutTimer != null) {
      clearTimeout(this.gracefulTimeoutTimer)
      this.gracefulTimeoutTimer = null
    }
  }

  /**
   * 整轮全部句子合成失败时的用户提示（每轮最多一次，由 allPlayedNotified 保证）：
   * 部分成功（≥1 句合成成功）只记日志不弹；相同原因 5 分钟内不重复弹。
   */
  private notifyTurnSynthesisFailure(): void {
    if (this.failureCount === 0 || this.successCount > 0) return
    const reason = classifyTtsFailureReason(this.lastFailureMessage)
    const last = this.lastFailureNotice
    if (
      last != null &&
      last.reason === reason &&
      Date.now() - last.at < FAILURE_NOTICE_THROTTLE_MS
    ) {
      log.info(
        `[voice-assistant] tts failure notice suppressed (throttled, reason=${reason}, failures=${this.failureCount})`,
      )
      return
    }
    this.lastFailureNotice = { reason, at: Date.now() }
    this.deps.onTurnSynthesisFailed(buildTtsFailureNoticeMessage(reason, this.lastFailureMessage))
  }
}
