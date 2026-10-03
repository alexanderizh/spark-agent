/**
 * AssistantCaptureController — 语音助手渲染端采集控制器（无 React 依赖）
 *
 * 响应主进程 stream:voice-assistant:capture 指令：
 * - start：权限检查 → getUserMedia → AudioWorklet 16k PCM → 按 captureSessionId 推流
 * - stop：释放麦克风与音频上下文
 *
 * 与输入框语音（useVoiceInput）共用采集工具（voiceCapture/voiceCaptureWorklet），
 * 但会话 id 由主进程下发、生命周期由主进程状态机驱动；本控制器不做识别逻辑。
 * 采集结果（起停/失败）经 sendVoiceAssistantRendererEvent 回传。
 */

import {
  acquireVoiceMediaStream,
  detectAudioInputDevices,
  voiceCaptureErrorMessage,
  type VoiceCaptureProcessing,
} from '../voice/voiceCapture'
import {
  getVoiceWorkletUrl,
  VOICE_WORKLET_PROCESSOR_NAME,
  type VoiceWorkletChunk,
} from '../voice/voiceCaptureWorklet'
import { getAssistantCaptureLevelSink } from './voiceAssistantLevels'

interface ActiveCapture {
  sessionId: string
  context: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  onTrackEnded: () => void
  audioTrack: MediaStreamTrack
}

export class AssistantCaptureController {
  private active: ActiveCapture | null = null
  private starting: Promise<void> | null = null
  /** starting 进行中到达的新 start 请求（只保留最后一个，完成后串行处理） */
  private pendingStartSessionId: string | null = null

  isActiveSession(sessionId: string): boolean {
    return this.active?.sessionId === sessionId
  }

  get activeSessionId(): string | null {
    return this.active?.sessionId ?? null
  }

  /** 主进程指令：启动采集（并发不同 sessionId 时排队串行，不吞请求） */
  start(sessionId: string, processing?: VoiceCaptureProcessing): Promise<void> {
    if (this.active != null) {
      if (this.active.sessionId === sessionId) return Promise.resolve()
      // 换会话：先释放旧采集（主进程串行指令下罕见，防御处理）
      this.release()
    }
    if (this.starting != null) {
      // 已有启动进行中：记录最新目标，完成后串行启动（旧请求若是同 id 则幂等跳过）
      this.pendingStartSessionId = sessionId
      return this.starting
    }
    this.starting = this.runStart(sessionId, processing)
    return this.starting
  }

  private async runStart(sessionId: string, processing?: VoiceCaptureProcessing): Promise<void> {
    try {
      await this.startInternal(sessionId, processing)
    } finally {
      this.starting = null
      const next = this.pendingStartSessionId
      this.pendingStartSessionId = null
      if (next != null && next !== this.active?.sessionId) {
        this.starting = this.runStart(next)
        void this.starting
      }
    }
  }

  /** 主进程指令：停止采集 */
  stop(sessionId?: string): void {
    if (sessionId != null && this.active?.sessionId !== sessionId) return
    this.release()
  }

  private async startInternal(
    sessionId: string,
    processing?: VoiceCaptureProcessing,
  ): Promise<void> {
    try {
      // 1. 系统麦克风授权（macOS 由主进程触发系统弹窗）
      const permission = await window.spark.invoke('voice:request-microphone-permission', {})
      if (!permission.granted) {
        throw new Error(permission.message ?? '系统未授予麦克风访问权限。')
      }
      // 2. 设备枚举 + 取流（processing 含语音助手的降噪/声源隔离处理）
      const devices = await detectAudioInputDevices()
      const stream = await acquireVoiceMediaStream(devices, processing)
      // 3. 音频管线：AudioContext + Worklet（音频回调驱动，隐藏窗口不受节流影响）
      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const context = new AudioContextCtor()
      if (context.state === 'suspended') await context.resume()
      await context.audioWorklet.addModule(getVoiceWorkletUrl())
      const source = context.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(context, VOICE_WORKLET_PROCESSOR_NAME)
      const levelStore = getAssistantCaptureLevelSink()
      node.port.onmessage = (e: MessageEvent<VoiceWorkletChunk | Int16Array>) => {
        const data = e.data
        const samples = data instanceof Int16Array ? data : data.samples
        window.spark.sendVoiceAudioChunk({ sessionId, samples })
        // chunk 自带 0~1 RMS 电平（裸 Int16Array 旧格式无 level，跳过）；HUD 声波条消费
        if (!(data instanceof Int16Array)) levelStore.push(data.level)
      }
      source.connect(node)
      node.connect(context.destination)

      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack == null) throw new Error('麦克风没有提供可用的音频轨道。')
      const onTrackEnded = (): void => {
        // 设备断开：本地清理 + 回传，主进程按「意外停止」收口
        this.release()
        window.spark.sendVoiceAssistantRendererEvent({ type: 'capture-stopped', sessionId })
      }
      audioTrack.addEventListener('ended', onTrackEnded)

      this.active = { sessionId, context, stream, source, node, onTrackEnded, audioTrack }
      // AEC 实际生效值探测（全双工回声治理层 1）：ideal 软约束在不支持的设备
      // 上会被静默降级，读 settings 回传真实状态供主进程决定是否升严格档
      let echoCancellationEffective: boolean | undefined
      try {
        echoCancellationEffective =
          audioTrack.getSettings().echoCancellation === true ? true : false
      } catch {
        // 读不到设置时不下发字段（旧主进程兼容）
      }
      window.spark.sendVoiceAssistantRendererEvent({
        type: 'capture-started',
        sessionId,
        ...(echoCancellationEffective != null ? { echoCancellationEffective } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : voiceCaptureErrorMessage(error)
      // 清理半建立的管线
      this.release()
      window.spark.sendVoiceAssistantRendererEvent({
        type: 'capture-failed',
        sessionId,
        message,
      })
    }
  }

  private release(): void {
    const active = this.active
    this.active = null
    // 采集停止即清电平（HUD 声波条回落到基线，避免残留旧值）
    getAssistantCaptureLevelSink().reset()
    if (active == null) return
    try {
      active.audioTrack.removeEventListener('ended', active.onTrackEnded)
      active.node.port.onmessage = null
      active.node.port.onmessageerror = null
      active.node.onprocessorerror = null
      active.node.disconnect()
      active.source.disconnect()
      for (const track of active.stream.getTracks()) track.stop()
      void active.context.close()
    } catch {
      // 清理不得抛出
    }
  }
}

let captureInstance: AssistantCaptureController | null = null

export function getAssistantCaptureController(): AssistantCaptureController {
  if (captureInstance == null) captureInstance = new AssistantCaptureController()
  return captureInstance
}
