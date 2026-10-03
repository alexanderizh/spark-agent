/**
 * VoiceHudMiniMic — HUD 状态行右端的迷你采集电平条（全双工「播报/思考中也在听」指示）
 *
 * 5 根 2px 宽圆角竖条，capture store（10Hz）驱动：条数/高度随采集电平，
 * 安静时整体降到 0.35 透明度、中条微亮（心跳位）。颜色恒为主色（不随状态变色，
 * 与「随状态变色的网格」区分输入/输出两个通道）。
 *
 * 显示条件由 Host 控制：仅 thinking/speaking 且 duplexActive（全双工在线）时渲染
 * ——listening 态主网格本身就是 capture 电平（冗余），半双工确实没在听（说了谎）。
 */

import { useSyncExternalStore } from 'react'
import { EMPTY_VOICE_WAVEFORM } from '../voice/voiceAudioLevel'
import { getAssistantCaptureLevelStore } from './voiceAssistantLevels'

const BAR_COUNT = 5
/** 与主网格同底噪门限：低于此值视为安静 */
const NOISE_GATE = 0.055

const captureStore = getAssistantCaptureLevelStore()

function getEmptyWaveform(): readonly number[] {
  return EMPTY_VOICE_WAVEFORM
}

/**
 * 电平 → 第 idx 根条的透明度与高度：
 * lit = 1 + gated × 4 为点亮波前（中心向外，中条 idx=2 先亮），波前分数透明度平滑；
 * 安静（低于门限）时全部 0.35 + 中条 0.55 心跳位。
 */
function barVisual(level: number, idx: number): { opacity: number; scaleY: number } {
  const gated = Math.max(0, level - NOISE_GATE) / (1 - NOISE_GATE)
  const center = Math.abs(idx - (BAR_COUNT - 1) / 2)
  const lit = 1 + gated * (BAR_COUNT - 1)
  const reach = lit - center
  if (gated <= 0) {
    return { opacity: idx === Math.floor(BAR_COUNT / 2) ? 0.55 : 0.35, scaleY: 0.4 }
  }
  const opacity = Math.min(1, Math.max(0.35, reach))
  return { opacity, scaleY: 0.4 + 0.6 * Math.min(1, Math.max(0, reach)) }
}

export function VoiceHudMiniMic(): React.ReactElement {
  const waveform = useSyncExternalStore(
    captureStore.subscribe,
    captureStore.getSnapshot,
    getEmptyWaveform,
  )
  const level = waveform.at(-1) ?? 0
  return (
    <span className="voice-hud-mini-mic" title="麦克风聆听中" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, idx) => {
        const visual = barVisual(level, idx)
        return (
          <i
            key={idx}
            style={{
              opacity: visual.opacity.toFixed(3),
              transform: `scaleY(${visual.scaleY.toFixed(3)})`,
            }}
          />
        )
      })}
    </span>
  )
}
