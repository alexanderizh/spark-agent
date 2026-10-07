/**
 * VoiceAssistantHost — 语音助手渲染端宿主（App 根部挂载一次）
 *
 * 五件事：
 * 1. 桥接：把主进程的采集指令路由给 AssistantCaptureController，
 *    播放指令路由给 VoicePlaybackController，状态事件供 HUD 消费。
 * 2. HUD：listening / thinking / speaking 状态浮层（可点击打断）。
 * 3. 全双工元素：迷你麦（thinking/speaking 也在听指示）、插话队列框
 *    （弱态/正态/衔接只读）、立即发送/放弃、ack 弹亮（提交瞬间反馈）。
 * 4. 卸载兜底：释放采集与播放资源。
 * 5. 播报设置条：HUD 内嵌 TTS 快捷切换（渠道/模型/音色/语速），数据由
 *    useVoiceTtsSettings 提供，改动经 patch 落库并即时生效到下一句播报。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId, VoiceAssistantStatus } from '@spark/protocol'
import type { VoiceAssistantSessionFocusEvent, VoiceAssistantStateEvent } from '@spark/protocol'
import { VOICE_ASSISTANT_SESSION_FOCUS_CHANNEL } from '@spark/protocol'
import { useSessionSidebar } from '../SessionSidebarContext'
import { getAssistantCaptureController } from './AssistantCaptureController'
import { getVoicePlaybackController } from './VoicePlaybackController'
import { VoiceHudWaveform, type VoiceHudWaveformState } from './VoiceHudWaveform'
import { VoiceHudMiniMic } from './VoiceHudMiniMic'
import { VoiceHudQueueBox } from './VoiceHudQueueBox'
import { VoiceHudTtsSettings } from './VoiceHudTtsSettings'
import { useVoiceHudDrag } from './useVoiceHudDrag'
import { useVoiceTtsSettings } from './useVoiceTtsSettings'
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
    /** 首响 ack 弹亮：listening→thinking 跳变 / 队列派发 / 抢占时置位（提交瞬间反馈） */
    ack?: boolean
  } | null>(null)
  const [status, setStatus] = useState<VoiceAssistantStatus | null>(null)
  const [dispatchInFlight, setDispatchInFlight] = useState(false)
  const dismissTimerRef = useRef<number | null>(null)
  /** 采集就绪门观测：最近一次 status 是否处于 listening+未就绪（展示过准备态才给就绪弹跳） */
  const sawPreparingRef = useRef(false)
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
        void capture.start(command.sessionId, command.audioProcessing, {
          mode: command.mode,
          replayPreRoll: command.replayPreRoll,
        })
      } else {
        capture.stop(command.sessionId)
      }
    })

    const offPlay = window.spark.on('stream:voice-assistant:play', (command) => {
      playback.handleCommand(command)
    })

    const offStatus = window.spark.on('stream:voice-assistant:status', (payload) => {
      if (payload != null && typeof payload === 'object' && 'state' in payload) {
        const next = payload as VoiceAssistantStatus
        setStatus(next)
        // 就绪弹跳（丢首字修复配套）：listening 且 captureReady false→true 翻转 =
        // 「可以说了」的瞬间，给声波条一次弹跳；仅在实际展示过准备态时触发，
        // 就绪即时到达（KWS 常驻流复用）不双跳。
        const wasPreparing = sawPreparingRef.current
        sawPreparingRef.current = next.state === 'listening' && next.captureReady === false
        if (wasPreparing && next.state === 'listening' && next.captureReady === true) {
          // 先清再置产生完整的 false→true 跳变：进入聆听的首次弹跳（state 事件
          // 置位）常在 660ms 动画窗口内仍为 true，直接重复置 true 不会重跑波形
          // 的弹跳 effect，就绪弹跳会被吞。双 rAF 确保摘类帧先提交，动画必定重启
          setHud((previous) =>
            previous?.state === 'listening' ? { ...previous, wake: false } : previous,
          )
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setHud((previous) =>
                previous?.state === 'listening' ? { ...previous, wake: true } : previous,
              )
            })
          })
        }
      }
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
        // 首响 ack 弹亮：提交成功进入思考（listening→thinking）、队列自动派发、
        // 立即发送抢占——与主进程 ack 提示音同帧的视觉确认
        const ack =
          (event.state === 'thinking' && event.previous === 'listening') ||
          event.reason === 'queue-dispatch' ||
          event.reason === 'preempt'
        return {
          state: event.state,
          ...(detail != null ? { detail } : {}),
          reason: event.reason,
          ...(wake ? { wake: true } : {}),
          ...(ack ? { ack: true } : {}),
        }
      })
    })

    return () => {
      offCapture()
      offPlay()
      offStatus()
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

  const handleAckDone = useCallback((): void => {
    setHud((previous) => (previous?.ack ? { ...previous, ack: false } : previous))
  }, [])

  const handleDispatchQueued = useCallback(
    (id: string): void => {
      if (dispatchInFlight) return
      setDispatchInFlight(true)
      void window.spark
        .invoke('voice-assistant:dispatch-queued', { id })
        .catch(() => undefined)
        .finally(() => setDispatchInFlight(false))
    },
    [dispatchInFlight],
  )

  const handleDiscardQueued = useCallback((id: string): void => {
    void window.spark.invoke('voice-assistant:discard-queued', { id }).catch(() => undefined)
  }, [])

  // HUD 矩形卡片自由拖拽（hook 必须在 early return 之前调用）
  const hudCardRef = useRef<HTMLDivElement | null>(null)
  const { isDragging, dragHandlers } = useVoiceHudDrag(hudCardRef)

  // 播报设置数据（hook 同样必须在 early return 之前调用）：宿主常驻预读，
  // HUD 出现时渠道/模型候选与设置已就绪，无需等首读往返。
  const tts = useVoiceTtsSettings()

  if (hud == null || !isWaveformState(hud.state)) return null

  const handleInterrupt = (): void => {
    void window.spark.invoke('voice-assistant:interrupt', {}).catch(() => undefined)
  }

  // 全双工元素可见性：迷你麦仅 thinking/speaking 且窗口在线（listening 主网格冗余；
  // 半双工不显示——确实没在听，不「说了谎」）。S8 衔接只读：graceful 派发事件
  //（queue-dispatch）且仍在播报 = 新轮已跑、旧播报句边界让位中
  const duplexActive = status?.duplexActive === true
  const showMiniMic = duplexActive && (hud.state === 'thinking' || hud.state === 'speaking')
  const takeoverPending =
    hud.reason === 'queue-dispatch' && hud.state === 'speaking' && duplexActive
  // 采集就绪门（丢首字修复）：listening 但 captureReady=false = 麦克风管道仍在建立，
  // 明确告知用户先别开口；旧版本负载无该字段时视为已就绪（向后兼容）
  const capturePreparing = hud.state === 'listening' && status?.captureReady === false

  return createPortal(
    <div
      ref={hudCardRef}
      className={`voice-assistant-hud is-${hud.state}${capturePreparing ? ' is-preparing' : ''}${isDragging ? ' is-dragging' : ''}`}
      role="status"
      {...dragHandlers}
    >
      {/* 顶部大留白舞台：图标本体小巧，区域占比大（参考稿上中下三段式） */}
      <div className="voice-hud-stage">
        <VoiceHudWaveform
          state={hud.state}
          wake={hud.wake === true}
          onWakeDone={handleWakeDone}
          ack={hud.ack === true}
          onAckDone={handleAckDone}
        />
      </div>
      <div className="voice-assistant-hud-body">
        <span className="voice-assistant-hud-label">
          {/* 状态点：状态的彩色信息由点阵/光晕 + 状态点承担，文字保持中性色 */}
          <span className="voice-assistant-hud-dot" aria-hidden="true" />
          {/* 准备态优先于 confirm 续说文案：半双工 confirm 续说走全路径重建采集，
              就绪前麦克风确实没开门，「请继续说」与降调舞台同时出现会自相矛盾 */}
          {capturePreparing
            ? '正在准备麦克风…'
            : hud.state === 'listening' && hud.reason === 'confirm'
              ? '请继续说，停顿后将自动发送'
              : STATE_META[hud.state]}
        </span>
        {showMiniMic ? <VoiceHudMiniMic /> : null}
        {hud.state === 'listening' && hud.detail != null && hud.detail.length > 0 ? (
          <span className="voice-assistant-hud-partial">{hud.detail}</span>
        ) : null}
        {(hud.state === 'thinking' || hud.state === 'speaking') && duplexActive ? (
          <VoiceHudQueueBox
            draft={status?.queueDraft ?? null}
            entries={status?.queuedInputs ?? []}
            takeoverPending={takeoverPending}
            dispatchInFlight={dispatchInFlight}
            onDispatch={handleDispatchQueued}
            onDiscard={handleDiscardQueued}
          />
        ) : null}
      </div>
      {/* 播报设置条：改动经 patch 乐观更新落库，主进程每次合成实时读当前设置，
          下一句播报即按新值生效 */}
      <VoiceHudTtsSettings
        settings={tts.settings}
        models={tts.models}
        onPatch={(patch) => {
          void tts.patch(patch)
        }}
      />
      {/* 保存失败提示：hook 已做乐观回滚 + 5s 自动清空，这里只做展示位
          （同样不作为拖拽把手） */}
      {tts.saveError != null ? (
        <div className="voice-hud-tts-error" onPointerDown={(event) => event.stopPropagation()}>
          {tts.saveError}
        </div>
      ) : null}
      {/* 底部停止：居中胶囊钮（方形图标与方块动画同语言 + 文字）；卡片是拖拽把手，
          按钮不作为把手（pointerdown 不上冒泡到卡片） */}
      <div className="voice-assistant-hud-footer">
        <button
          type="button"
          className="voice-assistant-hud-stop"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleInterrupt}
          title="停止（再按唤醒快捷键效果相同）"
        >
          <i aria-hidden="true" />
          <span>停止</span>
        </button>
      </div>
    </div>,
    document.body,
  )
}
