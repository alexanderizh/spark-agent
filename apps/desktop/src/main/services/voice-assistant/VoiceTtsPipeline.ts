/**
 * VoiceTtsPipeline — 逐句 TTS 流水线（主进程）
 *
 * Agent 回复 delta → SentenceSplitter 切句 → 逐句合成（顺序、串行，保序）→
 * 推送渲染端播放队列 → 播放反馈回收 → 全部播完回调。
 *
 * 关键行为：
 * - 首句即合成即播（不等 Agent 说完，压首字延迟）
 * - isFinal 兜底：若 delta 事件全部丢失，用全文重新喂切分器
 * - 单句合成失败/超时：跳过该句 + 错误提示音（不阻断后续句）
 * - cancel()：清空待合成队列、停播、删除未播放文件
 * - 播放完成的音频文件立即删除；另有服务启动时的目录清扫兜底
 */

import { unlink } from 'node:fs/promises'
import { createLogger } from '@spark/shared'
import type { VoiceAssistantPlayCommand } from '@spark/protocol'
import { SentenceSplitter, speechifyText } from './speechify.js'

const log = createLogger('voice-tts')

/** 单句合成超时（云端 TTS 首响一般 <5s；超时视为该句失败跳过） */
const SYNTHESIS_TIMEOUT_MS = 30_000
/** 流式路径单轮朗读上限（与 speechifyText 整段上限一致；超出截断并提示） */
const MAX_STREAM_SPEAKABLE_CHARS = 800
const STREAM_TRUNCATION_SENTENCE = '内容较长，完整回复请在应用中查看。'

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
}

interface QueuedPlayback {
  sentenceId: string
  filePath: string
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

export class VoiceTtsPipeline {
  private splitter = new SentenceSplitter()
  /** 等待合成的句子队列 */
  private pending: string[] = []
  private synthesizing = false
  private sequenceCounter = 0
  /** 已推送到渲染端、等待播放结束的句子 */
  private awaitingPlayback = new Map<string, QueuedPlayback>()
  private turnFinalized = false
  private cancelled = false
  /** delta 已喂入切分器的原始累计文本（isFinal 前缀对账用） */
  private fedRaw = ''
  private failureCount = 0
  private playedCount = 0
  private allPlayedNotified = false
  /** 已切出句子的累计字符数（流式长度上限） */
  private emittedChars = 0
  private truncationNotified = false

  constructor(private readonly deps: VoiceTtsPipelineDeps) {}

  /** 新一轮回复开始（由状态机在 submitTurn 成功后调用） */
  beginTurn(): void {
    // 上一轮仍有待播句子（如审批播报打断进行中的轮次）：先停播+删文件，
    // 否则 Map 清空后这些文件永远等不到 playback-ended 而泄漏
    if (this.awaitingPlayback.size > 0) {
      for (const queued of this.awaitingPlayback.values()) safeUnlink(queued.filePath)
      this.awaitingPlayback.clear()
      this.deps.sendPlay({ kind: 'stop' })
    }
    this.splitter.reset()
    this.pending = []
    this.sequenceCounter = 0
    this.awaitingPlayback.clear()
    this.turnFinalized = false
    this.cancelled = false
    this.fedRaw = ''
    this.failureCount = 0
    this.playedCount = 0
    this.allPlayedNotified = false
    this.emittedChars = 0
    this.truncationNotified = false
  }

  /** 喂入 assistant delta（纯增量文本） */
  pushDelta(delta: string): void {
    if (this.cancelled || delta.length === 0) return
    this.fedRaw += delta
    const sentences = this.splitter.push(delta)
    this.emitSentences(sentences)
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
    void this.drainSynthesisQueue()
    this.checkAllPlayed()
  }

  /** 轮次终止信号（completed/cancelled/error 后不再有文本） */
  turnDone(): void {
    if (this.cancelled) return
    if (!this.turnFinalized) {
      const tail = this.splitter.flush()
      if (tail.length > 0) this.pending.push(tail)
      this.turnFinalized = true
    }
    void this.drainSynthesisQueue()
    this.checkAllPlayed()
  }

  /** 打断：停播 + 清队列 + 删未播文件。之后流水线不再产生任何回调。 */
  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.pending = []
    this.splitter.reset()
    for (const queued of this.awaitingPlayback.values()) safeUnlink(queued.filePath)
    this.awaitingPlayback.clear()
    this.deps.sendPlay({ kind: 'stop' })
  }

  /** 渲染端播放反馈 */
  onPlaybackEnded(sentenceId: string): void {
    const queued = this.awaitingPlayback.get(sentenceId)
    if (queued == null) return
    this.awaitingPlayback.delete(sentenceId)
    this.playedCount += 1
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

  /** 带流式长度上限的句子入队：超限后丢弃剩余句并补一句截断提示 */
  private emitSentences(sentences: string[]): void {
    if (sentences.length === 0) return
    if (this.truncationNotified) return
    const budget = MAX_STREAM_SPEAKABLE_CHARS - this.emittedChars
    let used = 0
    for (const sentence of sentences) {
      if (used + sentence.length > budget) {
        this.truncationNotified = true
        this.pending.push(STREAM_TRUNCATION_SENTENCE)
        this.emittedChars += budget
        log.info(
          `[voice-assistant] streaming speech truncated at ${MAX_STREAM_SPEAKABLE_CHARS} chars`,
        )
        break
      }
      this.pending.push(sentence)
      used += sentence.length
    }
    this.emittedChars += used
    if (this.pending.length > 0) void this.drainSynthesisQueue()
  }

  private async drainSynthesisQueue(): Promise<void> {
    if (this.synthesizing || this.cancelled) return
    this.synthesizing = true
    try {
      while (this.pending.length > 0 && !this.cancelled) {
        const sentence = this.pending.shift() as string
        let filePath: string
        try {
          const result = await withTimeout(
            this.deps.synthesize(sentence),
            SYNTHESIS_TIMEOUT_MS,
            'tts synthesis',
          )
          filePath = result.filePath
        } catch (error) {
          this.failureCount += 1
          log.warn(
            `[voice-assistant] tts synthesis failed (sentence skipped, total failures ${this.failureCount}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          // 失败降级：跳句 + 错误提示音（仅首失时提示，避免连续提示音轰炸）
          if (this.failureCount === 1 && this.deps.shouldPlayCues()) {
            this.deps.sendPlay({ kind: 'cue', cue: 'error' })
          }
          continue
        }
        if (this.cancelled) {
          safeUnlink(filePath)
          return
        }
        const sentenceId = `va-s-${++this.sequenceCounter}`
        this.awaitingPlayback.set(sentenceId, { sentenceId, filePath })
        this.deps.sendPlay({ kind: 'play', sentenceId, sequence: this.sequenceCounter, filePath })
      }
    } finally {
      this.synthesizing = false
    }
    this.checkAllPlayed()
  }

  private checkAllPlayed(): void {
    if (
      !this.cancelled &&
      !this.allPlayedNotified &&
      this.turnFinalized &&
      this.pending.length === 0 &&
      !this.synthesizing &&
      this.awaitingPlayback.size === 0
    ) {
      this.allPlayedNotified = true
      this.deps.onAllPlayed()
    }
  }
}
