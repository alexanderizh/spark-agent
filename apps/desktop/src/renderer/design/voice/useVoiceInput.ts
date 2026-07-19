import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceRecognitionEvent } from '@spark/protocol'
import { getVoiceWorkletUrl, VOICE_WORKLET_PROCESSOR_NAME } from './voiceCaptureWorklet'

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
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  toggle: () => Promise<void>
}

interface ActiveSession {
  sessionId: string
  context: AudioContext
  stream: MediaStream
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

  // 用 ref 持有最新回调，避免 start/stop 闭包持有过期引用
  const onFinalRef = useRef(options.onFinal)
  const onErrorRef = useRef(options.onError)
  onFinalRef.current = options.onFinal
  onErrorRef.current = options.onError

  const activeRef = useRef<ActiveSession | null>(null)

  const teardownSession = useCallback((session: ActiveSession) => {
    try {
      session.node.port.onmessage = null
      session.node.disconnect()
      session.source.disconnect()
      for (const track of session.stream.getTracks()) track.stop()
      void session.context.close()
    } catch {
      // 清理不得抛出
    }
    session.unsubscribe()
  }, [])

  const stop = useCallback(async () => {
    const session = activeRef.current
    if (!session) return
    activeRef.current = null
    setStatus('stopping')
    teardownSession(session)
    try {
      await window.spark.invoke('voice:stop', { sessionId: session.sessionId })
    } catch {
      // 停止失败不阻塞 UI
    }
    setPartialText('')
    setStatus('idle')
  }, [teardownSession])

  const start = useCallback(async () => {
    if (activeRef.current || status === 'starting' || status === 'recording') return
    setError(null)
    setPartialText('')
    setStatus('starting')

    let sessionId: string | null = null
    let unsubscribe: (() => void) | null = null

    try {
      const res = await window.spark.invoke('voice:start', { sampleRate: 16000 })
      if (!res.success || !res.sessionId) {
        throw new Error(res.message || '无法启动语音识别')
      }
      sessionId = res.sessionId

      // 先订阅识别事件，确保喂入音频后的 partial/final 不丢
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
        }
      })

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })

      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const context = new AudioContextCtor()
      // 若上下文被浏览器/系统挂起（autoplay 策略），尝试恢复
      if (context.state === 'suspended') void context.resume()

      await context.audioWorklet.addModule(getVoiceWorkletUrl())
      const source = context.createMediaStreamSource(mediaStream)
      const node = new AudioWorkletNode(context, VOICE_WORKLET_PROCESSOR_NAME)
      // 关键：只连 worklet，不连 destination —— 不能把麦克风声音播出来
      source.connect(node)
      node.port.onmessage = (e: MessageEvent<Int16Array>) => {
        window.spark.sendVoiceAudioChunk({ sessionId: sessionId as string, samples: e.data })
      }

      activeRef.current = {
        sessionId,
        context,
        stream: mediaStream,
        source,
        node,
        unsubscribe,
      }
      setStatus('recording')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 清理已建立的订阅与主进程会话
      unsubscribe?.()
      if (sessionId) {
        void window.spark.invoke('voice:stop', { sessionId }).catch(() => {})
      }
      setError(message)
      setStatus('error')
      onErrorRef.current?.(message)
    }
  }, [status])

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
      const session = activeRef.current
      if (!session) return
      activeRef.current = null
      teardownSession(session)
      void window.spark.invoke('voice:stop', { sessionId: session.sessionId }).catch(() => {})
    }
  }, [teardownSession])

  return { status, partialText, error, start, stop, toggle }
}
