/**
 * VoiceHudWaveform — HUD 像素网格动效（v2 设计稿方向 1 · 像素网格 4×4）
 *
 * 结构：光晕（halo）+ 4×4 网格叠层，四类表现：
 * - listening：光晕持续呼吸（CSS scale）+ 透明度随电平（inline opacity）；
 *   网格点亮数随采集电平由中心向外扩张（capture store，10Hz；波前分数透明度 + scale）
 * - speaking：同款驱动逻辑，换播报色档（playback store，AnalyserNode 采样）
 * - thinking：网格对角波纹（纯 CSS，--g = 行+列 对角序负相位差），光晕退为静态底光
 * - wake：网格由中心向外弹亮 + 光晕一次性扩散波纹（播完交给数据驱动）
 *
 * 光晕属性分治：呼吸动画的 keyframes 只声明 transform，电平驱动只写 inline opacity
 * （CSS 动画声明覆盖 inline，但仅限其声明的属性），二者叠加互不覆盖——安静时呼吸
 * 仍在、说话时随音量增亮，聆听态动效不再依赖「有人说话」。
 *
 * 性能：仅 opacity/transform 合成器属性；数据驱动经 useSyncExternalStore 只重渲染
 * 本组件，不波及 HUD 其余内容。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { EMPTY_VOICE_WAVEFORM, type VoiceAudioLevelStore } from '../voice/voiceAudioLevel'
import {
  getAssistantCaptureLevelStore,
  getAssistantPlaybackLevelStore,
} from './voiceAssistantLevels'

const GRID = 4

/** 4×4 = 16 枚方块（10px 格 + 4px 间距 → 52px 见方，舞台留白交给容器） */
const CELL_COUNT = GRID * GRID

/** 与 Composer 语音输入一致的底噪门限：低于此值视为安静，只剩中心「心跳核」 */
const NOISE_GATE = 0.055

/** wake 弹亮总时长：420ms 动画 + 3 档 × 60ms 级联 + 90ms 交接余量 */
const WAKE_SETTLE_MS = 660

/** 光晕透明度区间：安静 0.30 基线（呼吸可见），满电平 0.78 */
const HALO_OPACITY_BASE = 0.3
const HALO_OPACITY_RANGE = 0.48

const captureStore = getAssistantCaptureLevelStore()
const playbackStore = getAssistantPlaybackLevelStore()

/**
 * 点亮序（设计稿 RANKS16 同式）：按「离网格中心的曼哈顿距离」升序、同距按索引，
 * 数据驱动的点亮波前沿此序由中心 2×2 → 边缘 8 枚 → 四角推进。
 */
const LIT_ORDER: readonly number[] = (() => {
  const cells = Array.from({ length: CELL_COUNT }, (_, index) => ({
    index,
    d:
      Math.abs(Math.floor(index / GRID) - (GRID - 1) / 2) +
      Math.abs((index % GRID) - (GRID - 1) / 2),
  }))
  cells.sort((a, b) => a.d - b.d || a.index - b.index)
  return cells.map((cell) => cell.index)
})()

/** index → LIT_ORDER 中的位次（数据驱动按位次计波前衰减） */
const LIT_POSITION: readonly number[] = (() => {
  const positions = new Array<number>(CELL_COUNT)
  LIT_ORDER.forEach((cellIndex, order) => {
    positions[cellIndex] = order
  })
  return positions
})()

/**
 * 当前电平 → 沿点亮序第 pos 枚方块的透明度与缩放。
 * lit = 2 + gated × 14 为「点亮波前」，减去位次后钳位：中心先亮、四角后亮，
 * 波前沿途留分数透明度与半尺寸缩放做平滑（设计稿 updateGrid16 同式）；
 * 静音时 lit=2 → 中心两枚保持全亮「心跳核」。
 */
function cellVisual(level: number, pos: number): { opacity: number; scale: number } {
  const gated = Math.max(0, level - NOISE_GATE) / (1 - NOISE_GATE)
  const lit = 2 + gated * (CELL_COUNT - 2)
  const opacity = Math.min(1, Math.max(0.22, lit - pos))
  const on = (opacity - 0.22) / 0.78
  return { opacity, scale: 0.5 + 0.5 * on }
}

/** 当前电平 → 光晕透明度（安静基线可见，随音量增亮；thinking 无数据源不驱动） */
function haloOpacity(level: number): number {
  const gated = Math.max(0, level - NOISE_GATE) / (1 - NOISE_GATE)
  return HALO_OPACITY_BASE + gated * HALO_OPACITY_RANGE
}

function getEmptyWaveform(): readonly number[] {
  return EMPTY_VOICE_WAVEFORM
}

function emptySubscribe(): () => void {
  return () => undefined
}

export type VoiceHudWaveformState = 'listening' | 'thinking' | 'speaking'

export interface VoiceHudWaveformProps {
  state: VoiceHudWaveformState
  /** 唤醒弹亮（由 Host 在 idle/standby → listening 跳变时置 true，播完自动回调清理） */
  wake: boolean
  onWakeDone: () => void
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

  // wake 置位后播满弹亮 + 级联尾巴再清理；期间 CSS 动画覆盖 inline 样式，
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

  const dataDriven = state === 'listening' || state === 'speaking'

  return (
    <span className={`voice-hud-viz is-${state}${wake ? ' is-wake' : ''}`} aria-hidden="true">
      {/* 光晕：scale 呼吸由 CSS 状态类驱动，opacity 由电平 inline 驱动（属性分治） */}
      <span
        className="voice-hud-halo"
        style={dataDriven ? { opacity: haloOpacity(level).toFixed(3) } : undefined}
      />
      <span className="voice-hud-grid">
        {Array.from({ length: CELL_COUNT }, (_, index) => {
          const row = Math.floor(index / GRID)
          const col = index % GRID
          const visual = dataDriven ? cellVisual(level, LIT_POSITION[index] ?? 0) : null
          return (
            <i
              key={index}
              style={
                {
                  // --g：对角序（行+列）供思考态波纹；--d：离中心距离档 1/2/3 供唤醒级联
                  '--g': String(row + col),
                  '--d': String(Math.abs(row - 1.5) + Math.abs(col - 1.5)),
                  ...(visual
                    ? {
                        opacity: visual.opacity.toFixed(3),
                        transform: `scale(${visual.scale.toFixed(3)})`,
                      }
                    : {}),
                } as React.CSSProperties
              }
            />
          )
        })}
      </span>
    </span>
  )
}
