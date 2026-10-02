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
const CUE_TONES: Record<'wake' | 'fail' | 'error', Array<[number, number]>> = {
  wake: [
    [660, 90],
    [990, 130],
  ],
  fail: [[330, 180]],
  error: [
    [440, 120],
    [300, 160],
  ],
}

export class VoicePlaybackController {
  private context: AudioContext | null = null
  private queue: QueuedSentence[] = []
  private current: { source: AudioBufferSourceNode; sentenceId: string } | null = null
  private stopped = false
  private decodeInFlight = false
  /** 已入队的最大 sequence（保证顺序） */
  private lastEnqueuedSequence = 0
  /** TTS 实时电平分析（HUD 声波条播报态数据源；常连 destination，不输出音频） */
  private analyser: AnalyserNode | null = null
  private levelTimer: number | null = null
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null

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
        // 新 play 指令意味着新一轮播放开始：复位停止位
        // （stop 后主进程 cancel 已删除未播文件，路上残留的旧 play 会 404 走 error 分支）
        this.stopped = false
        void this.enqueuePlay(command.sentenceId, command.sequence, command.filePath)
        return
      case 'stop':
        this.stop()
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
    const context = this.ensureContext()
    if (context == null) {
      sendRendererEvent({ type: 'playback-error', sentenceId, message: 'AudioContext 不可用' })
      return
    }
    try {
      const response = await fetch(toSafeFileUrl(filePath))
      if (!response.ok) throw new Error(`音频文件读取失败: ${response.status}`)
      const raw = await response.arrayBuffer()
      const buffer = await context.decodeAudioData(raw)
      if (this.stopped) return // 解码期间被打断
      this.queue.push({ sentenceId, sequence, buffer })
      this.queue.sort((a, b) => a.sequence - b.sequence)
      this.lastEnqueuedSequence = Math.max(this.lastEnqueuedSequence, sequence)
      this.drainQueue()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[voice-assistant] tts decode failed (${sentenceId}): ${message}`)
      sendRendererEvent({ type: 'playback-error', sentenceId, message })
    }
  }

  private drainQueue(): void {
    if (this.current != null || this.decodeInFlight) return
    const next = this.queue.shift()
    if (next == null) {
      // 队列排空且无在播句子：播报结束，停采样并清电平
      if (this.current == null) this.stopLevelSampling()
      return
    }
    const context = this.ensureContext()
    if (context == null) {
      sendRendererEvent({ type: 'playback-error', sentenceId: next.sentenceId })
      return
    }
    const source = context.createBufferSource()
    source.buffer = next.buffer
    source.connect(context.destination)
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

  /** 停止当前播放并清空队列（打断）；置停止位丢弃解码中的残留句 */
  stop(): void {
    this.stopped = true
    const current = this.current
    this.current = null
    this.queue = []
    this.stopLevelSampling()
    if (current != null) {
      try {
        current.source.onended = null
        current.source.stop()
      } catch {
        // 已停止的 source 再 stop 会抛，忽略
      }
    }
  }

  /** 软复位（新一轮 turn 开始前由状态事件驱动，防御队列残留） */
  reset(): void {
    this.stopped = false
    this.stop()
  }

  private playCue(cue: 'wake' | 'fail' | 'error'): void {
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
