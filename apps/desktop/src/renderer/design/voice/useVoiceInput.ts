import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceRecognitionEvent } from '@spark/protocol'
import {
  getVoiceWorkletUrl,
  VOICE_WORKLET_PROCESSOR_NAME,
  type VoiceWorkletChunk,
} from './voiceCaptureWorklet'
import { createVoiceAudioLevelStore, type VoiceAudioLevelStore } from './voiceAudioLevel'
import {
  acquireVoiceMediaStream,
  detectAudioInputDevices,
  VoiceCaptureError,
  voiceCaptureErrorMessage,
} from './voiceCapture'

export type VoiceInputStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  /** 流式已结束，主进程正在用离线模型对整段音频重新识别 */
  | 'refining'
  | 'error'

export interface VoiceRefinedPayload {
  /** 本次会话流式识别已写入输入框的文本（精修后将被替换） */
  previous: string
  /** 离线精修后的整段文本 */
  text: string
}

export interface UseVoiceInputOptions {
  /** 句尾锁定的最终文本（UI 应追加到已确认区/草稿） */
  onFinal?: (text: string) => void
  /** 离线精修完成：UI 应把 previous 替换为 text（仅当 previous 仍是草稿后缀时替换才安全） */
  onRefined?: (payload: VoiceRefinedPayload) => void
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

/** 精修是流式结束后的异步过程；超时兜底强制收尾，避免状态卡死（正常 1-5s）。 */
const REFINE_WAIT_TIMEOUT_MS = 90_000

/** 与 ComposerV2 onFinal 追加规则一致的文本拼接（保证精修替换时后缀可精确匹配） */
function appendSegment(prev: string, text: string): string {
  if (!text) return prev
  const needSpace = prev.length > 0 && !/\s$/.test(prev)
  return prev + (needSpace ? ' ' : '') + text
}

/**
 * 语音识别管线 hook：开麦 → AudioWorklet 采 16k PCM → 推主进程 → 收 partial/final。
 *
 * 混合识别（方案A）：录音期间流式 partial/final 实时预览；停止后主进程对缓存音频
 * 做离线精修，refined 事件携带整段文本，由 onRefined 回调整体替换流式结果。
 * 精修模型未安装时主进程直接结束，行为与纯流式一致。
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
  const onRefinedRef = useRef(options.onRefined)
  const onErrorRef = useRef(options.onError)
  onFinalRef.current = options.onFinal
  onRefinedRef.current = options.onRefined
  onErrorRef.current = options.onError

  const activeRef = useRef<ActiveSession | null>(null)
  const startingRef = useRef(false)
  const cancelStartRef = useRef(false)
  /** 本次会话流式 final 累积文本；精修完成时作为 previous 提供给 onRefined */
  const sessionWrittenRef = useRef('')
  /** 精修等待态：保留事件订阅直到 refined/session-stopped，或超时强制收尾 */
  const refiningRef = useRef<{ session: ActiveSession; timer: number } | null>(null)

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

  const teardownSession = useCallback(
    (session: ActiveSession) => {
      releaseCapture(session)
      session.unsubscribe()
    },
    [releaseCapture],
  )

  /** 精修结束（收到 session-stopped 或超时）：退订事件并复位状态 */
  const finishRefining = useCallback((session: ActiveSession) => {
    const pending = refiningRef.current
    if (!pending || pending.session !== session) return
    refiningRef.current = null
    window.clearTimeout(pending.timer)
    session.unsubscribe()
    sessionWrittenRef.current = ''
    setPartialText('')
    audioLevelStoreRef.current.reset()
    setStatus('idle')
  }, [])

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
    let refining = false
    try {
      const res = await window.spark.invoke('voice:stop', { sessionId: session.sessionId })
      refining = res?.refining === true
    } catch {
      // 停止失败不阻塞 UI
    }
    if (refining) {
      // 主进程正在离线精修：保持订阅等待 refined + session-stopped 再收尾
      setPartialText('')
      audioLevelStoreRef.current.reset()
      const timer = window.setTimeout(() => {
        console.warn('[voice-input] voice refine wait timeout, force cleanup')
        finishRefining(session)
      }, REFINE_WAIT_TIMEOUT_MS)
      refiningRef.current = { session, timer }
      setStatus('refining')
      return
    }
    session.unsubscribe()
    sessionWrittenRef.current = ''
    setPartialText('')
    audioLevelStoreRef.current.reset()
    setStatus('idle')
  }, [releaseCapture, finishRefining])

  const start = useCallback(async () => {
    if (activeRef.current || startingRef.current) return
    // 上一段精修尚未收尾（通常 1-5s）：忽略本次开启，避免两段会话的替换逻辑交叉
    if (refiningRef.current) return
    startingRef.current = true
    cancelStartRef.current = false
    setError(null)
    setPartialText('')
    sessionWrittenRef.current = ''
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
          if (text) {
            sessionWrittenRef.current = appendSegment(sessionWrittenRef.current, text)
            onFinalRef.current?.(text)
          }
          setPartialText('')
        } else if (event.type === 'refined') {
          const text = (event.text ?? '').trim()
          const previous = sessionWrittenRef.current
          sessionWrittenRef.current = ''
          if (text) onRefinedRef.current?.({ previous, text })
        } else if (event.type === 'error') {
          const msg = event.message ?? '语音识别错误'
          setError(msg)
          onErrorRef.current?.(msg)
          void stop()
        } else if (event.type === 'session-stopped') {
          const pending = refiningRef.current
          if (pending && pending.session.sessionId === sessionId) {
            finishRefining(pending.session)
          } else {
            void stop()
          }
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
      sessionWrittenRef.current = ''
      audioLevelStoreRef.current.reset()
      if (cancelled) {
        setStatus('idle')
      } else {
        setError(message)
        // 权限拒绝已由主进程拉起系统设置；此时没有录音会话，按钮应立即退出红色录入态。
        setStatus(
          err instanceof VoiceCaptureError && err.code === 'permission-denied' ? 'idle' : 'error',
        )
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

  // 卸载时确保释放麦克风与音频上下文，并清理可能残留的精修等待态
  useEffect(() => {
    return () => {
      cancelStartRef.current = true
      const pending = refiningRef.current
      if (pending) {
        refiningRef.current = null
        window.clearTimeout(pending.timer)
        pending.session.unsubscribe()
      }
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
