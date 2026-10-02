/**
 * MessageTtsPlayer — 消息语音播报播放器（渲染进程单例）
 *
 * 会话消息底部播报按钮的执行内核：
 * 正文清洗切句（speechify，5000 字上限）→ 逐句 voice-assistant:tts-synthesize
 * （复用语音助手 TTS 渠道/模型/音色设置，边合边播压首句延迟）→ safe-file 读取 +
 * decodeAudioData（解码完成即删文件）→ WebAudio 顺序播放。
 *
 * 全局同时只允许一条播报：点另一条消息自动停前一条；再次点击同一条即停。
 * 与语音助手播报链路（VoicePlaybackController）互不接管，系统级混音共存。
 * 独立于 React 生命周期（模块级单例）；状态经 subscribe 供 useSyncExternalStore 订阅。
 *
 * 竞态防护：代际令牌（token）——stop/切换后 token 自增，旧播报循环在续段前校验，
 * 不匹配即退出；被打断的 source 保留 onended 让挂起的播放 Promise 正常落定，
 * 避免 stop 后协程永久悬挂。
 */

import { hasMeaningfulVoiceText, SentenceSplitter, speechifyText } from '@spark/shared'
import { encodeToSafeFileUrl } from './PresentedMedia'

/** 消息播报整段朗读上限（语音助手流式路径保持 800 不变，这里放宽到 5000） */
const MESSAGE_TTS_MAX_CHARS = 5000

export type MessageTtsStatus = 'off' | 'loading' | 'playing'

class MessageTtsPlayer {
  /** 当前播报归属（消息 key）；off 态为 null */
  private activeKey: string | null = null
  private status: MessageTtsStatus = 'off'
  private readonly listeners = new Set<() => void>()
  /** 代际令牌：start/stop 竞态防护，token 不匹配的异步续段全部丢弃 */
  private token = 0
  private context: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null
  /** 在途产物：合成已返回但尚未发起清理的文件路径（stop 时统一补删防泄漏） */
  private readonly pendingFiles = new Set<string>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 该消息当前的播报状态（非活跃消息恒为 off；返回原语，useSyncExternalStore 安全） */
  getStatusFor = (key: string): MessageTtsStatus => {
    return this.activeKey === key ? this.status : 'off'
  }

  toggle(key: string, text: string): void {
    if (this.activeKey === key && this.status !== 'off') {
      this.stop()
      return
    }
    void this.start(key, text)
  }

  /** 停止当前播报并清理（消息删除/会话切换时也可调用，无活跃播报时为空操作） */
  stop(): void {
    this.token += 1
    this.interruptSource()
    this.flushPendingFiles()
    this.setActive(null, 'off')
  }

  /** 仅当该消息正在播报（含合成中）时停止；删除消息时调用，避免播已被删除的内容 */
  stopIfActive(key: string): void {
    if (this.activeKey === key && this.status !== 'off') this.stop()
  }

  private setActive(key: string | null, status: MessageTtsStatus): void {
    this.activeKey = key
    this.status = status
    for (const listener of this.listeners) listener()
  }

  /**
   * 停掉在播的 source。保留 onended 让挂起的播放 Promise 正常 resolve，
   * 旧循环恢复后经 token 校验自行退出（置空 onended 会让协程永久悬挂）。
   */
  private interruptSource(): void {
    const source = this.currentSource
    this.currentSource = null
    if (source == null) return
    try {
      source.stop()
    } catch {
      // 已停止的 source 再 stop 会抛，忽略
    }
  }

  /** 补删在途产物（合成已返回、还没走到清理行时被打断的场景） */
  private flushPendingFiles(): void {
    const files = [...this.pendingFiles]
    this.pendingFiles.clear()
    for (const filePath of files) void this.cleanupFile(filePath)
  }

  private async start(key: string, text: string): Promise<void> {
    this.interruptSource()
    const token = this.token + 1
    this.token = token
    const speakable = speechifyText(text, MESSAGE_TTS_MAX_CHARS).trim()
    if (!hasMeaningfulVoiceText(speakable)) return
    // SentenceSplitter 需要先 push 再 flush 才能拿全切分结果
    const splitter = new SentenceSplitter()
    const sentences = [...splitter.push(speakable), splitter.flush()].filter(
      (sentence) => sentence.length > 0,
    )
    if (sentences.length === 0) return
    this.setActive(key, 'loading')
    try {
      for (const sentence of sentences) {
        if (this.token !== token) return
        const { filePath } = await window.spark.invoke('voice-assistant:tts-synthesize', {
          text: sentence,
        })
        // 合成返回即登记在途产物：此后无论走正常清理还是被 stop 补删，都保证删到
        this.pendingFiles.add(filePath)
        const buffer = await this.fetchAndDecode(filePath)
        // 解码完成即删文件：音频已在内存，磁盘产物没有存留价值（打断路径同理）
        void this.cleanupFile(filePath)
        this.pendingFiles.delete(filePath)
        if (this.token !== token || buffer == null) return
        this.setActive(key, 'playing')
        const ended = this.playBuffer(buffer)
        if (ended == null) return
        await ended
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[message-tts] broadcast failed: ${message}`)
    } finally {
      if (this.token === token) {
        this.interruptSource()
        this.setActive(null, 'off')
      }
    }
  }

  /** safe-file 读取 + 解码；失败返回 null（跳过该句继续后续句） */
  private async fetchAndDecode(filePath: string): Promise<AudioBuffer | null> {
    const context = this.ensureContext()
    if (context == null) return null
    try {
      const response = await fetch(encodeToSafeFileUrl(filePath))
      if (!response.ok) throw new Error(`音频文件读取失败: ${response.status}`)
      const raw = await response.arrayBuffer()
      return await context.decodeAudioData(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[message-tts] decode failed: ${message}`)
      return null
    }
  }

  /** 播放一句并返回结束 Promise；AudioContext 不可用时返回 null */
  private playBuffer(buffer: AudioBuffer): Promise<void> | null {
    const context = this.ensureContext()
    if (context == null) return null
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    this.currentSource = source
    return new Promise<void>((resolvePlayback) => {
      source.onended = () => {
        if (this.currentSource === source) this.currentSource = null
        resolvePlayback()
      }
      source.start()
    })
  }

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
    return this.context
  }

  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await window.spark.invoke('voice-assistant:tts-cleanup', { filePath })
    } catch {
      // 清理失败不阻断播放；应用启动时的 sweepTtsDir 会兜底
    }
  }
}

let playerInstance: MessageTtsPlayer | null = null

export function getMessageTtsPlayer(): MessageTtsPlayer {
  if (playerInstance == null) playerInstance = new MessageTtsPlayer()
  return playerInstance
}
