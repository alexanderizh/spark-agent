/**
 * VoicePlaybackController — 语音助手 TTS 播放队列（渲染进程单例）
 *
 * 消费主进程 stream:voice-assistant:play 指令：
 * - play：safe-file:// 读取音频文件 → decodeAudioData → 按 sequence 排队无缝播放
 * - stop：停当前 + 清队列（打断）
 * - cue：本地合成提示音（唤醒/失效/错误，WebAudio 振荡器，无资产文件）
 *
 * 播放起止经 sendVoiceAssistantRendererEvent 回传主进程（流水线计数与文件清理依据）。
 * 独立于 React 生命周期（模块级单例），窗口存续期间常驻。
 */

import type { VoiceAssistantPlayCommand } from '@spark/protocol'
import { getAssistantPlaybackLevelSink } from './voiceAssistantLevels'

interface QueuedSentence {
  sentenceId: string
  sequence: number
  buffer: AudioBuffer
}

function toSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

function sendRendererEvent(event: Parameters<typeof sendEvent>[0]): void {
  sendEvent(event)
}

// 独立小函数便于 mock（测试注入）
function sendEvent(
  event:
    | { type: 'playback-started'; sentenceId: string }
    | { type: 'playback-ended'; sentenceId: string }
    | { type: 'playback-error'; sentenceId: string; message?: string },
): void {
  window.spark?.sendVoiceAssistantRendererEvent?.(event)
}

/** 提示音参数：[频率Hz, 时长ms][]；简单双音设计，无外部资产 */
const CUE_TONES: Record<'wake' | 'fail' | 'error' | 'ack', Array<[number, number]>> = {
  wake: [
    [660, 90],
    [990, 130],
  ],
  fail: [[330, 180]],
  error: [
    [440, 120],
    [300, 160],
  ],
  /** 首响 ack：短双音上行（880→1320Hz），声学语义「收到/进行中」，与 wake/fail 区分 */
  ack: [
    [880, 70],
    [1320, 70],
  ],
}

export class VoicePlaybackController {
  private context: AudioContext | null = null
  private queue: QueuedSentence[] = []
  private current: { source: AudioBufferSourceNode; sentenceId: string } | null = null
  private stopped = false
  /**
   * 在途解码的 sequence 集合：合成预取（并发 2）下 play 指令可能乱序到达，
   * 队首开播前须确认没有更低序句仍在解码（「乱序合成不乱播」的渲染端半边）。
   * stop 时清空——新轮 sequence 从 1 重排，跨轮残留会反向阻塞新轮队首。
   */
  private decodeInFlightSequences = new Set<number>()
  /** TTS 实时电平分析（HUD 声波条播报态数据源；常连 destination，不输出音频） */
  private analyser: AnalyserNode | null = null
  private levelTimer: number | null = null
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null
  /** 主输出总线（淡出用）：source → masterGain → destination；cue 走独立通道不受淡出影响 */
  private masterGain: GainNode | null = null
  /** 淡出后的硬停止定时器 */
  private fadeStopTimer: number | null = null
  /**
   * 停止代数：每次 stop（硬停/graceful）自增。enqueuePlay 在解码 await 期间可能
   * 跨越一次 stop——graceful 停止后新 play 会复位 stopped 位，若只查 stopped，
   * 旧轮解码中的残句会在新轮里入队插播（旧 sequence 与新轮重排序错乱）。
   * 解码完成后比对代数：变了说明该句属于已被停止的批次，按 playback-error
   * 回传（主进程立即回收条目与文件，不必等 15s 兜底）。
   */
  private stopEpoch = 0

  private ensureContext(): AudioContext | null {
    if (this.context != null) {
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined)
      return this.context
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor == null) return null
    this.context = new Ctor()
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined)
    this.masterGain = this.context.createGain()
    this.masterGain.connect(this.context.destination)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 256
    this.levelBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
    return this.context
  }

  /** 10Hz 采样 AnalyserNode 时域 RMS → 播放电平 store（HUD 声波条播报态） */
  private startLevelSampling(): void {
    if (this.levelTimer != null) return
    this.levelTimer = window.setInterval(() => {
      const analyser = this.analyser
      const buffer = this.levelBuffer
      if (analyser == null || buffer == null) return
      analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) {
        // 128 = 时域中心（静音）；越界防御回落静音，不影响 RMS 量级
        const v = ((buffer[i] ?? 128) - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buffer.length)
      // 语音 RMS 偏小（典型 0.05~0.25），增益拉开动态后夹紧到 0~1；release 平滑由 store 承担
      getAssistantPlaybackLevelSink().push(Math.min(1, rms * 2.2))
    }, 100)
  }

  private stopLevelSampling(): void {
    if (this.levelTimer != null) {
      window.clearInterval(this.levelTimer)
      this.levelTimer = null
    }
    getAssistantPlaybackLevelSink().reset()
  }

  /** 主进程播放指令入口 */
  handleCommand(command: VoiceAssistantPlayCommand): void {
    switch (command.kind) {
      case 'play':
        // 新 play 指令意味着新一轮播放开始：复位停止位与总线增益
        // （stop 后主进程 cancel 已删除未播文件，路上残留的旧 play 会 404 走 error 分支）
        this.stopped = false
        this.resetMasterGain()
        void this.enqueuePlay(command.sentenceId, command.sequence, command.filePath)
        return
      case 'stop':
        this.stop({
          graceful: command.graceful === true,
          ...(command.fadeMs != null ? { fadeMs: command.fadeMs } : {}),
        })
        return
      case 'cue':
        this.playCue(command.cue)
        return
      default:
        return
    }
  }

  private async enqueuePlay(sentenceId: string, sequence: number, filePath: string): Promise<void> {
    if (this.stopped) return
    const epochAtEnqueue = this.stopEpoch
    const context = this.ensureContext()
    if (context == null) {
      sendRendererEvent({ type: 'playback-error', sentenceId, message: 'AudioContext 不可用' })
      return
    }
    this.decodeInFlightSequences.add(sequence)
    try {
      const response = await fetch(toSafeFileUrl(filePath))
      if (!response.ok) throw new Error(`音频文件读取失败: ${response.status}`)
      const raw = await response.arrayBuffer()
      const buffer = await context.decodeAudioData(raw)
      // 解码期间跨越了一次 stop（含 graceful）：该句属于已停止批次，回传
      // playback-error 让主进程立即回收（硬停路径主进程已清条目，事件被忽略）
      if (this.stopped || epochAtEnqueue !== this.stopEpoch) {
        sendRendererEvent({ type: 'playback-error', sentenceId, message: '播放已被停止取代' })
        return
      }
      this.queue.push({ sentenceId, sequence, buffer })
      this.queue.sort((a, b) => a.sequence - b.sequence)
      this.drainQueue()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[voice-assistant] tts decode failed (${sentenceId}): ${message}`)
      sendRendererEvent({ type: 'playback-error', sentenceId, message })
    } finally {
      // 解码结束（成功入队/失败/被停止取代）都可能解锁等待中的更低序队首
      this.decodeInFlightSequences.delete(sequence)
      this.drainQueue()
    }
  }

  private drainQueue(): void {
    if (this.current != null) return
    const next = this.queue[0]
    if (next == null) {
      // 队列排空且无在播句子：播报结束，停采样并清电平
      this.stopLevelSampling()
      return
    }
    // 更低序句仍在解码：等它到达再按序开播（乱序合成的顺序保证）
    for (const pending of this.decodeInFlightSequences) {
      if (pending < next.sequence) return
    }
    this.queue.shift()
    const context = this.ensureContext()
    if (context == null) {
      sendRendererEvent({ type: 'playback-error', sentenceId: next.sentenceId })
      return
    }
    const source = context.createBufferSource()
    source.buffer = next.buffer
    source.connect(this.masterGain ?? context.destination)
    // 分析支路：不输出音频，仅供 HUD 声波条读实时电平
    if (this.analyser != null) source.connect(this.analyser)
    this.current = { source, sentenceId: next.sentenceId }
    this.startLevelSampling()
    source.onended = () => {
      // 正常播完与 stop() 主动停止都会触发 onended；stop 场景 current 已被清空
      const current = this.current
      if (current == null || current.source !== source) return
      this.current = null
      sendRendererEvent({ type: 'playback-ended', sentenceId: next.sentenceId })
      this.drainQueue()
    }
    sendRendererEvent({ type: 'playback-started', sentenceId: next.sentenceId })
    source.start()
  }

  /**
   * 停止播放。
   * - 硬停（默认）：清队列 + 停当前（fadeMs 提供时总线淡出防爆音）+ 置停止位
   * - graceful（边播边处理让位）：清未播队列（逐条回传 playback-error 供主进程
   *   回收文件），当前句自然播完（onended 正常回收），后续新 play 正常接续
   */
  stop(options: { fadeMs?: number; graceful?: boolean } = {}): void {
    const dropped = this.queue.splice(0)
    this.stopEpoch += 1
    // 新轮 sequence 从 1 重排：清空在途解码集合，跨轮残留会反向阻塞新轮队首
    this.decodeInFlightSequences.clear()
    if (options.graceful) {
      // 未播句子按播放失败回传（主进程 onPlaybackFailed 删文件回收）
      for (const sentence of dropped) {
        sendRendererEvent({ type: 'playback-error', sentenceId: sentence.sentenceId })
      }
      // 当前句继续播完（onended 正常回收）；stopped 置位丢弃解码中的旧句
      // （跨停止代数的解码句在 enqueuePlay 里按 playback-error 回收），
      // 新 play 到达即复位（graceful 后新轮首句按 sequence 无缝接上）
      this.stopped = true
      if (dropped.length > 0 && this.current == null) this.stopLevelSampling()
      return
    }
    const current = this.current
    this.stopped = true
    this.current = null
    this.stopLevelSampling()
    // 硬停当前句：有 fadeMs 时总线线性淡出后再停（抢占防爆音），否则立即
    if (current == null) return
    if (this.fadeStopTimer != null) {
      window.clearTimeout(this.fadeStopTimer)
      this.fadeStopTimer = null
    }
    const fade = options.fadeMs ?? 0
    if (fade > 0 && this.context != null && this.masterGain != null) {
      const now = this.context.currentTime
      try {
        this.masterGain.gain.cancelScheduledValues(now)
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
        this.masterGain.gain.linearRampToValueAtTime(0.0001, now + fade / 1000)
      } catch {
        // 排程失败回退硬切
      }
      this.fadeStopTimer = window.setTimeout(() => {
        this.fadeStopTimer = null
        this.forceStopSource(current.source)
      }, fade + 30)
      return
    }
    this.forceStopSource(current.source)
  }

  private forceStopSource(source: AudioBufferSourceNode): void {
    try {
      source.onended = null
      source.stop()
    } catch {
      // 已停止的 source 再 stop 会抛，忽略
    }
  }

  /** 淡出后的总线复位（新 play 到达时恢复全量输出） */
  private resetMasterGain(): void {
    if (this.fadeStopTimer != null) {
      window.clearTimeout(this.fadeStopTimer)
      this.fadeStopTimer = null
    }
    if (this.context != null && this.masterGain != null) {
      try {
        const now = this.context.currentTime
        this.masterGain.gain.cancelScheduledValues(now)
        this.masterGain.gain.setValueAtTime(1, now)
      } catch {
        // 忽略
      }
    }
  }

  private playCue(cue: 'wake' | 'fail' | 'error' | 'ack'): void {
    const context = this.ensureContext()
    if (context == null) return
    let offset = 0
    for (const [frequency, durationMs] of CUE_TONES[cue] ?? []) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const startAt = context.currentTime + offset / 1000
      const duration = durationMs / 1000
      // 轻起轻落避免爆音
      gain.gain.setValueAtTime(0, startAt)
      gain.gain.linearRampToValueAtTime(0.12, startAt + 0.02)
      gain.gain.setValueAtTime(0.12, startAt + duration - 0.03)
      gain.gain.linearRampToValueAtTime(0, startAt + duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + duration + 0.02)
      offset += durationMs + 40
    }
  }
}

let controllerInstance: VoicePlaybackController | null = null

export function getVoicePlaybackController(): VoicePlaybackController {
  if (controllerInstance == null) controllerInstance = new VoicePlaybackController()
  return controllerInstance
}
