/**
 * VoiceHudWaveform — HUD 声波条（动效设计稿方向 A：极简扁平声波条的 HUD 适配版）
 *
 * 16 根纯色竖条替换原 emoji 图标位，四类表现：
 * - listening：条高实时跟随采集电平（capture store，10Hz；中段条加权更高）
 * - speaking：条高随 TTS 实时电平脉动（playback store，AnalyserNode 采样）
 * - thinking：低幅行波左→右巡视（纯 CSS，无数据驱动）
 * - wake：一次性弹跳收口（进入 listening 的前 450ms，之后无缝交给数据驱动）
 *
 * 性能：仅 transform 合成器属性；thinking 行波零 JS；数据驱动经
 * useSyncExternalStore 只重渲染本组件的 16 个 <i>，不波及 HUD 其余内容。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { EMPTY_VOICE_WAVEFORM, type VoiceAudioLevelStore } from '../voice/voiceAudioLevel'
import {
  getAssistantCaptureLevelStore,
  getAssistantPlaybackLevelStore,
} from './voiceAssistantLevels'

/** HUD 图标位空间有限：16 条 × (3px 条宽 + 3px 间距)，总宽约 61px */
const BAR_COUNT = 16

/** 与 Composer 语音输入一致的底噪门限：低于此值视为安静，条落到基线 */
const NOISE_GATE = 0.055

/** wake 弹跳总时长：450ms 动画 + 15 条 × 8ms 级联 + 余量 */
const WAKE_SETTLE_MS = 620

const captureStore = getAssistantCaptureLevelStore()
const playbackStore = getAssistantPlaybackLevelStore()

export type VoiceHudWaveformState = 'listening' | 'thinking' | 'speaking'

export interface VoiceHudWaveformProps {
  state: VoiceHudWaveformState
  /** 唤醒弹跳（由 Host 在 idle/standby → listening 跳变时置 true，播完自动回调清理） */
  wake: boolean
  onWakeDone: () => void
}

/** 中段条加权（人声频段语义）：两端 0.45、中央 1.0 的正弦包络 */
function weightOf(index: number): number {
  const x = index / (BAR_COUNT - 1)
  return 0.45 + 0.55 * Math.sin(Math.PI * x)
}

/**
 * 当前电平 → 第 index 条的 scaleY（0.08~1）。
 * 相位噪声 sin(i*7.31 + level*40) 让相邻条不齐涨齐跌；level 不变时波形静止。
 */
function barScale(level: number, index: number, jitter: number): number {
  const gated = Math.max(0, level - NOISE_GATE) / (1 - NOISE_GATE)
  const w = weightOf(index)
  const noise = 1 + 0.12 * Math.sin(index * 7.31 + level * 40)
  const v = gated * w * jitter * noise + 0.06 + 0.1 * w
  return Math.min(1, Math.max(0.08, v))
}

function getEmptyWaveform(): readonly number[] {
  return EMPTY_VOICE_WAVEFORM
}

function emptySubscribe(): () => void {
  return () => undefined
}

export function VoiceHudWaveform({
  state,
  wake,
  onWakeDone,
}: VoiceHudWaveformProps): React.ReactElement {
  // thinking 无数据驱动；listening/speaking 按状态选订阅源（两源互斥，切态即换订阅）
  const store: VoiceAudioLevelStore | null =
    state === 'thinking' ? null : state === 'speaking' ? playbackStore : captureStore
  const waveform = useSyncExternalStore(
    store?.subscribe ?? emptySubscribe,
    store?.getSnapshot ?? getEmptyWaveform,
    getEmptyWaveform,
  )
  const level = waveform.at(-1) ?? 0

  // wake 置位后播满弹跳 + 级联尾巴再清理；期间 CSS 动画覆盖 inline transform，
  // 移除类后数据驱动的 inline 值经 90ms transition 平滑接管
  const wakeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!wake) return
    wakeTimerRef.current = window.setTimeout(onWakeDone, WAKE_SETTLE_MS)
    return () => {
      if (wakeTimerRef.current != null) window.clearTimeout(wakeTimerRef.current)
      wakeTimerRef.current = null
    }
  }, [wake, onWakeDone])

  const jitter = state === 'listening' ? 0.85 : 0.5
  const dataDriven = state === 'listening' || state === 'speaking'

  return (
    <span className={`voice-hud-waveform is-${state}${wake ? ' is-wake' : ''}`} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <i
          key={index}
          style={
            {
              '--i': String(index),
              ...(dataDriven
                ? { transform: `scaleY(${barScale(level, index, jitter).toFixed(3)})` }
                : {}),
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  )
}
