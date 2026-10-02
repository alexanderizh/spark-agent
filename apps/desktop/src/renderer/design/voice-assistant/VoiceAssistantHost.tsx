/**
 * VoiceAssistantHost — 语音助手渲染端宿主（App 根部挂载一次）
 *
 * 三件事：
 * 1. 桥接：把主进程的采集指令路由给 AssistantCaptureController，
 *    播放指令路由给 VoicePlaybackController，状态事件供 HUD 消费。
 * 2. HUD：listening / thinking / speaking 状态浮层（可点击打断）。
 * 3. 卸载兜底：释放采集与播放资源。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@spark/protocol'
import type { VoiceAssistantSessionFocusEvent, VoiceAssistantStateEvent } from '@spark/protocol'
import { VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL } from '@spark/protocol'
import { useSessionSidebar } from '../SessionSidebarContext'
import { getAssistantCaptureController } from './AssistantCaptureController'
import { getVoicePlaybackController } from './VoicePlaybackController'
import { VoiceHudWaveform, type VoiceHudWaveformState } from './VoiceHudWaveform'
import './voiceAssistant.less'

const STATE_META: Record<VoiceHudWaveformState, string> = {
  listening: '正在聆听…',
  thinking: '思考中…',
  speaking: '播报中',
}

/** 声波条可呈现的活跃态（HUD 只在这三态显示；idle 后保留片刻即隐藏） */
function isWaveformState(state: VoiceAssistantStateEvent['state']): state is VoiceHudWaveformState {
  return state === 'listening' || state === 'thinking' || state === 'speaking'
}

/** idle 后浮层保留一小段时间展示收尾状态（完成/已取消），随后隐藏 */
const IDLE_DISMISS_MS = 1200

export function VoiceAssistantHost(): React.ReactNode {
  const [hud, setHud] = useState<{
    state: VoiceAssistantStateEvent['state']
    detail?: string
    reason?: VoiceAssistantStateEvent['reason']
    /** 声波条唤醒弹跳：非活跃 → listening 跳变时置位，播完由波形组件回调清理 */
    wake?: boolean
  } | null>(null)
  const dismissTimerRef = useRef<number | null>(null)
  const { setActiveSession, revealSession } = useSessionSidebar()

  // 语音活动发生时 UI 跳转到语音绑定会话（选中 + 侧栏定位，对齐命令面板行为）。
  // setActiveSession 幂等；跨工作区会话由侧栏上下文的联动 effect 自动切换工作区。
  useEffect(() => {
    return (
      window.spark.on(
        VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL,
        (event: VoiceAssistantSessionFocusEvent) => {
          if (
            event == null ||
            typeof event.sessionId !== 'string' ||
            event.sessionId.length === 0
          ) {
            return
          }
          // 协议 sessionId 为普通 string，侧栏上下文使用 branded SessionId（与
          // stream:session:created 处理一致的窄化）
          const target = event.sessionId as SessionId
          setActiveSession(target)
          revealSession(target)
        },
      ) ?? (() => {})
    )
  }, [setActiveSession, revealSession])

  useEffect(() => {
    const capture = getAssistantCaptureController()
    const playback = getVoicePlaybackController()

    const offCapture = window.spark.on('stream:voice-assistant:capture', (command) => {
      if (command.action === 'start') {
        void capture.start(command.sessionId, command.audioProcessing)
      } else {
        capture.stop(command.sessionId)
      }
    })

    const offPlay = window.spark.on('stream:voice-assistant:play', (command) => {
      playback.handleCommand(command)
    })

    const offState = window.spark.on('stream:voice-assistant:state', (event) => {
      if (dismissTimerRef.current != null) {
        window.clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = null
      }
      if (event.state === 'idle') {
        // 保留当前内容一小段时间再隐藏（展示「已打断/已完成」等收尾）
        dismissTimerRef.current = window.setTimeout(() => setHud(null), IDLE_DISMISS_MS)
        return
      }
      setHud((previous) => {
        const carriedDetail =
          previous?.state === event.state && previous?.detail != null ? previous.detail : undefined
        const detail = event.detail ?? carriedDetail
        // 唤醒词或手动触发进入聆听：给声波条一次弹跳反馈（confirm 等同态续说不触发）
        const wake = event.state === 'listening' && !isWaveformState(event.previous)
        return {
          state: event.state,
          ...(detail != null ? { detail } : {}),
          reason: event.reason,
          ...(wake ? { wake: true } : {}),
        }
      })
    })

    return () => {
      offCapture()
      offPlay()
      offState()
      if (dismissTimerRef.current != null) window.clearTimeout(dismissTimerRef.current)
      capture.stop()
      playback.stop()
    }
  }, [])

  const handleWakeDone = useCallback((): void => {
    // 无 wake 标记时保持原引用，避免无谓重渲染
    setHud((previous) => (previous?.wake ? { ...previous, wake: false } : previous))
  }, [])

  if (hud == null || !isWaveformState(hud.state)) return null

  const handleInterrupt = (): void => {
    void window.spark.invoke('voice-assistant:interrupt', {}).catch(() => undefined)
  }

  return createPortal(
    <div className={`voice-assistant-hud is-${hud.state}`} role="status">
      <VoiceHudWaveform state={hud.state} wake={hud.wake === true} onWakeDone={handleWakeDone} />
      <div className="voice-assistant-hud-body">
        <span className="voice-assistant-hud-label">
          {hud.state === 'listening' && hud.reason === 'confirm'
            ? '请继续说，停顿后将自动发送'
            : STATE_META[hud.state]}
        </span>
        {hud.state === 'listening' && hud.detail != null && hud.detail.length > 0 ? (
          <span className="voice-assistant-hud-partial">{hud.detail}</span>
        ) : null}
      </div>
      <button
        type="button"
        className="voice-assistant-hud-stop"
        onClick={handleInterrupt}
        title="停止（再按唤醒快捷键效果相同）"
      >
        停止
      </button>
    </div>,
    document.body,
  )
}
