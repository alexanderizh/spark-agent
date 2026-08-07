/**
 * 画布音频节点 · 变速 in-node 抽屉。
 *
 * 叠在节点内部（.canvas-node-audio-speed-drawer），参考截图：
 *   - 左：X 关闭 + "变速" label
 *   - 中：滑块（0.1x – 4.0x，step 0.05），左端 "0.1x" 右端 "4.0x"
 *   - 右：± 微调按钮 + 实时数字（如 1.00x） + 一个向上的"应用"圆按钮
 *
 * 行为：
 *   - factor = 1.0 时"应用" disabled，避免出空操作节点。
 *   - factor 改变 → 实时更新预览数字；点应用 → onApply(factor)。
 *   - Escape 关闭；X 按钮关闭。
 */
import { useEffect, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Icons } from '../../../Icons'

export type CanvasAudioSpeedDrawerProps = {
  /** 当前值（受控，缺省 1.0） */
  value: number
  onChange: (next: number) => void
  onApply: (factor: number) => void
  onCancel: () => void
  /** 进行中 disable */
  busy?: boolean | undefined
}

export const SPEED_FLOOR = 0.1
export const SPEED_CEIL = 4.0
export const SPEED_STEP = 0.05
/** 应用按钮可生效的最小差值（避免 1.00x 空跑） */
export const SPEED_NOOP_DELTA = 0.001

export function clampAudioSpeed(n: number): number {
  if (!Number.isFinite(n)) return 1.0
  return Math.min(SPEED_CEIL, Math.max(SPEED_FLOOR, n))
}

function formatSpeed(n: number): string {
  return `${clampAudioSpeed(n).toFixed(2)}x`
}

export function CanvasAudioSpeedDrawer({
  value,
  onChange,
  onApply,
  onCancel,
  busy = false,
}: CanvasAudioSpeedDrawerProps) {
  const [draft, setDraft] = useState<number>(() => clampAudioSpeed(value))

  useEffect(() => {
    setDraft(clampAudioSpeed(value))
  }, [value])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter') {
        // Enter 等同于"应用"
        event.preventDefault()
        if (!busy && Math.abs(draft - 1) > SPEED_NOOP_DELTA) {
          onApply(clampAudioSpeed(draft))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, draft, onApply, onCancel])

  const applyable = !busy && Math.abs(draft - 1) > SPEED_NOOP_DELTA
  const offsetPct =
    ((clampAudioSpeed(draft) - SPEED_FLOOR) / (SPEED_CEIL - SPEED_FLOOR)) * 100

  const setDraftSafe = (next: number) => setDraft(clampAudioSpeed(next))

  const onSlide = (event: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(event.target.value)
    if (!Number.isFinite(n)) return
    setDraftSafe(n)
    onChange(n)
  }

  const nudge = (delta: number) => () => {
    setDraftSafe(draft + delta)
    onChange(clampAudioSpeed(draft + delta))
  }

  const onApplyClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!applyable) return
    onApply(clampAudioSpeed(draft))
  }
  const onCancelClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  return (
    <div
      className="canvas-node-audio-speed-drawer nodrag nopan"
      role="dialog"
      aria-label="音频变速"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="canvas-node-audio-speed-cancel"
        onClick={onCancelClick}
        disabled={busy}
        aria-label="取消变速"
      >
        <Icons.X size={14} />
      </button>
      <span className="canvas-node-audio-speed-label">变速</span>
      <span className="canvas-node-audio-speed-floor">{SPEED_FLOOR.toFixed(1)}x</span>
      <span className="canvas-node-audio-speed-range">
        <input
          type="range"
          className="canvas-node-audio-speed-slider"
          min={SPEED_FLOOR}
          max={SPEED_CEIL}
          step={SPEED_STEP}
          value={clampAudioSpeed(draft)}
          onChange={onSlide}
          disabled={busy}
          style={{ ['--speed-progress' as string]: `${offsetPct}%` }}
          aria-label="变速滑块"
        />
      </span>
      <span className="canvas-node-audio-speed-ceil">{SPEED_CEIL.toFixed(1)}x</span>
      <div className="canvas-node-audio-speed-value-group">
        <button
          type="button"
          className="canvas-node-audio-speed-step"
          onClick={nudge(-SPEED_STEP)}
          disabled={busy}
          aria-label="微调减速"
        >
          <Icons.ChevronDown size={12} />
        </button>
        <span className="canvas-node-audio-speed-value" aria-live="polite">
          {formatSpeed(draft)}
        </span>
        <button
          type="button"
          className="canvas-node-audio-speed-step"
          onClick={nudge(SPEED_STEP)}
          disabled={busy}
          aria-label="微调加速"
        >
          <Icons.ChevronUp size={12} />
        </button>
      </div>
      <button
        type="button"
        className="canvas-node-audio-speed-apply"
        onClick={onApplyClick}
        disabled={!applyable}
        aria-label="应用变速并生成新节点"
        title="应用"
      >
        <Icons.Upload size={14} />
      </button>
    </div>
  )
}
