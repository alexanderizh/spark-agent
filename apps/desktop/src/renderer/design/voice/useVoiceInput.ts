import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceRecognitionEvent } from '@spark/protocol'
import {
  getVoiceWorkletUrl,
  VOICE_WORKLET_PROCESSOR_NAME,
  type VoiceWorkletChunk,
} from './voiceCaptureWorklet'
import {
  createVoiceAudioLevelStore,
  type VoiceAudioLevelStore,
} from './voiceAudioLevel'
import {
  acquireVoiceMediaStream,
  detectAudioInputDevices,
  VoiceCaptureError,
  voiceCaptureErrorMessage,
} from './voiceCapture'

export type VoiceInputStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'error'

export interface UseVoiceInputOptions {
  /** 句尾锁定的最终文本（UI 应追加到已确认区/草稿） */
  onFinal?: (text: string) => void
  /** 识别错误回调 */
  onError?: (message: string) => void
}

export interface UseVoiceInputResult {
  status: VoiceInputStatus
  /** 当前句实时 partial（UI 整体替换展示），录音外为 '' */
  partialText: string
  /** 独立订阅的实时音量历史，不会驱动 Composer 整体重渲染。 */
  audioLevelStore: VoiceAudioLevelStore
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => Promise<void>
}

interface ActiveSession {
  sessionId: string
  context: AudioContext
  stream: MediaStream
  audioTrack: MediaStreamTrack
  onTrackEnded: () => void
  captureGuard: { released: boolean }
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  unsubscribe: () => void
}

/**
 * 语音识别管线 hook：开麦 → AudioWorklet 采 16k PCM → 推主进程 → 收 partial/final。
 *
 * 前置条件：语音包已就绪（native + model）。本 hook 不负责完整性检测与按需下载，
 * 由调用方（麦克风按钮）通过 useVoiceIntegrity 确认 ready 后再调用 start()。
 */
export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputResult {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [partialText, setPartialText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const audioLevelStoreRef = useRef(createVoiceAudioLevelStore())

  // 用 ref 持有最新回调，避免 start/stop 闭包持有过期引用
  const onFinalRef = useRef(options.onFinal)
  const onErrorRef = useRef(options.onError)
  onFinalRef.current = options.onFinal
  onErrorRef.current = options.onError

  const activeRef = useRef<ActiveSession | null>(null)
  const startingRef = useRef(false)
  const cancelStartRef = useRef(false)

  const releaseCapture = useCallback((session: ActiveSession) => {
    try {
      session.captureGuard.released = true
      session.audioTrack.removeEventListener('ended', session.onTrackEnded)
      session.node.port.onmessage = null
      session.node.port.onmessageerror = null
      session.node.onprocessorerror = null
      session.node.disconnect()
      session.source.disconnect()
      for (const track of session.stream.getTracks()) track.stop()
      void session.context.close()
    } catch {
      // 清理不得抛出
    }
  }, [])

  const teardownSession = useCallback((session: ActiveSession) => {
    releaseCapture(session)
    session.unsubscribe()
  }, [releaseCapture])

  const stop = useCallback(async () => {
    const session = activeRef.current
    if (!session) {
      if (startingRef.current) {
        cancelStartRef.current = true
        setPartialText('')
        setStatus('stopping')
      } else {
        // Fast Refresh 等场景可能已清理底层 session、但保留了 recording UI state。
        // stop 必须幂等地把界面复位，不能让录音态永久卡住。
        setPartialText('')
        audioLevelStoreRef.current.reset()
        setStatus('idle')
      }
      return
    }
    activeRef.current = null
    setStatus('stopping')
    // 先停止本地采集，但保留识别事件订阅，确保主进程 stop 时刷出的最后一句 final 不丢。
    releaseCapture(session)
    try {
      await window.spark.invoke('voice:stop', { sessionId: session.sessionId })
    } catch {
      // 停止失败不阻塞 UI
    } finally {
      session.unsubscribe()
    }
    setPartialText('')
    audioLevelStoreRef.current.reset()
    setStatus('idle')
  }, [releaseCapture])

  const start = useCallback(async () => {
    if (activeRef.current || startingRef.current) return
    startingRef.current = true
    cancelStartRef.current = false
    setError(null)
    setPartialText('')
    setStatus('starting')

    let sessionId: string | null = null
    let unsubscribe: (() => void) | null = null
    let mediaStream: MediaStream | null = null
    let context: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let node: AudioWorkletNode | null = null
    let startStage = '检测麦克风设备'

    const ensureNotCancelled = (): void => {
      if (cancelStartRef.current) throw new Error('VOICE_START_CANCELLED')
    }

    try {
      // 1. 先检测输入设备，避免在没有麦克风时白白初始化识别引擎。
      await detectAudioInputDevices()
      ensureNotCancelled()

      // 2. macOS 由主进程触发系统授权弹窗；denied/restricted 在 getUserMedia 前给出明确提示。
      startStage = '检查麦克风权限'
      const permission = await window.spark.invoke('voice:request-microphone-permission', {})
      if (!permission.granted) {
        throw new VoiceCaptureError(
          'permission-denied',
          permission.message ?? '系统未授予麦克风访问权限。',
        )
      }
      ensureNotCancelled()

      // 3. 授权后重新枚举以拿到完整 deviceId；默认设备失败时尝试其他输入设备。
      startStage = '打开麦克风'
      const devices = await detectAudioInputDevices()
      mediaStream = await acquireVoiceMediaStream(devices)
      ensureNotCancelled()

      startStage = '初始化音频引擎'
      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      context = new AudioContextCtor()
      // 若上下文被浏览器/系统挂起（autoplay 策略），尝试恢复
      if (context.state === 'suspended') await context.resume()

      startStage = '加载语音采集组件'
      await context.audioWorklet.addModule(getVoiceWorkletUrl())
      ensureNotCancelled()
      source = context.createMediaStreamSource(mediaStream)
      node = new AudioWorkletNode(context, VOICE_WORKLET_PROCESSOR_NAME)

      // 4. 只有音频采集链路可用后才启动 native 识别会话。
      startStage = '启动语音识别器'
      const res = await window.spark.invoke('voice:start', { sampleRate: 16000 })
      if (!res.success || !res.sessionId) {
        throw new Error(res.message || '无法启动语音识别')
      }
      sessionId = res.sessionId
      ensureNotCancelled()

      // 先订阅识别事件，确保连接 worklet 后的 partial/final 不丢。
      unsubscribe = window.spark.on('stream:voice:recognition', (event: VoiceRecognitionEvent) => {
        if (event.sessionId !== sessionId) return
        if (event.type === 'partial') {
          setPartialText(event.text ?? '')
        } else if (event.type === 'final') {
          const text = (event.text ?? '').trim()
          if (text) onFinalRef.current?.(text)
          setPartialText('')
        } else if (event.type === 'error') {
          const msg = event.message ?? '语音识别错误'
          setError(msg)
          onErrorRef.current?.(msg)
          void stop()
        } else if (event.type === 'session-stopped') {
          void stop()
        }
      })

      node.port.onmessage = (e: MessageEvent<VoiceWorkletChunk | Int16Array>) => {
        // 兼容旧 worklet 的纯 Int16Array 消息，便于开发态热更新过程中平滑切换。
        const data = e.data
        const samples = data instanceof Int16Array ? data : data.samples
        if (!(data instanceof Int16Array)) audioLevelStoreRef.current.push(data.level)
        window.spark.sendVoiceAudioChunk({ sessionId: sessionId as string, samples })
      }
      source.connect(node)
      // Web Audio 图由 destination 拉取；processor 不写 outputs，因此连接后仍保持静音。
      node.connect(context.destination)

      const audioTrack = mediaStream.getAudioTracks()[0]
      if (!audioTrack) {
        throw new VoiceCaptureError('device-unavailable', '麦克风没有提供可用的音频轨道。')
      }
      const captureGuard = { released: false }
      const stopAfterCaptureFailure = (message: string): void => {
        if (captureGuard.released) return
        setError(message)
        onErrorRef.current?.(message)
        void stop()
      }
      const onTrackEnded = (): void => {
        stopAfterCaptureFailure('麦克风已断开或停止工作，请检查输入设备后重试。')
      }
      audioTrack.addEventListener('ended', onTrackEnded)
      node.onprocessorerror = () => {
        stopAfterCaptureFailure('语音采集处理器异常停止，请重新开启语音输入。')
      }
      node.port.onmessageerror = () => {
        stopAfterCaptureFailure('语音数据传输失败，请重新开启语音输入。')
      }

      activeRef.current = {
        sessionId,
        context,
        stream: mediaStream,
        audioTrack,
        onTrackEnded,
        captureGuard,
        source,
        node,
        unsubscribe,
      }
      setStatus('recording')
    } catch (err) {
      const cancelled = cancelStartRef.current
      const message =
        err instanceof VoiceCaptureError
          ? err.message
          : err instanceof DOMException
            ? voiceCaptureErrorMessage(err)
          : err instanceof Error
            ? err.message
            : String(err)
      if (!cancelled && !(err instanceof VoiceCaptureError)) {
        console.error(`[voice-input] ${startStage}失败`, err)
      }
      // 清理已建立的订阅与主进程会话
      try {
        node?.disconnect()
        source?.disconnect()
        for (const track of mediaStream?.getTracks() ?? []) track.stop()
        if (context) void context.close()
      } catch {
        // 清理不得遮蔽原始错误
      }
      unsubscribe?.()
      if (sessionId) {
        void window.spark.invoke('voice:stop', { sessionId }).catch(() => {})
      }
      setPartialText('')
      audioLevelStoreRef.current.reset()
      if (cancelled) {
        setStatus('idle')
      } else {
        setError(message)
        setStatus('error')
        onErrorRef.current?.(message)
      }
    } finally {
      startingRef.current = false
      cancelStartRef.current = false
    }
  }, [stop])

  const toggle = useCallback(async () => {
    if (activeRef.current) {
      await stop()
    } else {
      await start()
    }
  }, [start, stop])

  // 卸载时确保释放麦克风与音频上下文
  useEffect(() => {
    return () => {
      cancelStartRef.current = true
      const session = activeRef.current
      if (!session) return
      activeRef.current = null
      teardownSession(session)
      void window.spark.invoke('voice:stop', { sessionId: session.sessionId }).catch(() => {})
    }
  }, [teardownSession])

  return {
    status,
    partialText,
    audioLevelStore: audioLevelStoreRef.current,
    error,
    start,
    stop,
    toggle,
  }
}
