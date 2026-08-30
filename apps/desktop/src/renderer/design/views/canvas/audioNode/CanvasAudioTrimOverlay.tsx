/**
 * 画布音频节点 · 截取 in-node 面板。
 *
 * 叠在节点内部（.canvas-node-audio-trim-overlay），参考截图：
 *   - 顶部一行："X  截取   00:00 - 00:09   [生成]"
 *   - 中间：波形 + 可拖区间矩形 + 矩形中央显示区间总时长徽标 (e.g. "9.16s")
 *   - 起/止合法性：start >= 0、end > start、end <= duration（小于等于时"生成"启用）
 *   - 关闭：X 按钮 / Escape / 点击节点外
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Icons } from '../../../Icons'
import { CanvasAudioWaveform } from './CanvasAudioWaveform'

const TRIM_HANDLE_WIDTH = 8
const MIN_TRIM_DURATION_SEC = 0.1

function formatTimecode(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec >= 0 ? totalSec : 0
  const min = Math.floor(safe / 60)
  const sec = Math.floor(safe % 60)
  const tens = Math.floor((safe * 100) % 100)
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(tens).padStart(2, '0')}`
}

function formatRangeBadge(startSec: number, endSec: number): string {
  const dur = Math.max(0, endSec - startSec)
  return `${dur.toFixed(2)}s`
}

export type CanvasAudioTrimOverlayProps = {
  src: string
  cachedPeaks?: readonly number[] | undefined
  /** 源节点最大时长（秒）；来自 node.data.audioDurationSec */
  durationSec: number
  /** 提交：startSec, endSec */
  onApply: (startSec: number, endSec: number) => void
  onCancel: () => void
  /** 进行中 / ffmpeg 跑时 disable 所有按钮 */
  busy?: boolean | undefined
}

type DragMode = 'start' | 'end' | 'move'

export function CanvasAudioTrimOverlay({
  src,
  cachedPeaks,
  durationSec,
  onApply,
  onCancel,
  busy = false,
}: CanvasAudioTrimOverlayProps) {
  const safeDuration =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 60
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(safeDuration)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ mode: DragMode; pointerId: number; startClientX: number } | null>(null)
  const rangeRef = useRef<HTMLDivElement | null>(null)
  const [wrapperWidth, setWrapperWidth] = useState(480)

  // 跟随容器宽度自适应
  useEffect(() => {
    const node = wrapperRef.current
    if (!node) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setWrapperWidth(Math.round(w))
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const startPct = useMemo(() => (start / safeDuration) * 100, [start, safeDuration])
  const endPct = useMemo(() => (end / safeDuration) * 100, [end, safeDuration])
  const durBadge = formatRangeBadge(start, end)
  const rangeStart = formatTimecode(start)
  const rangeEnd = formatTimecode(end)
  const canApply =
    !busy &&
    end - start >= MIN_TRIM_DURATION_SEC &&
    start >= 0 &&
    end <= safeDuration + 0.05

  const updateByClientX = useCallback(
    (clientX: number) => {
      const rect = rangeRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const sec = ratio * safeDuration
      const mode = dragRef.current?.mode
      if (!mode) return
      if (mode === 'start') {
        const next = Math.max(0, Math.min(sec, end - MIN_TRIM_DURATION_SEC))
        setStart(next)
      } else if (mode === 'end') {
        const next = Math.min(safeDuration, Math.max(sec, start + MIN_TRIM_DURATION_SEC))
        setEnd(next)
      }
    },
    [end, safeDuration, start],
  )

  const beginDrag = useCallback(
    (mode: DragMode) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (busy) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = {
        mode,
        pointerId: event.pointerId,
        startClientX: event.clientX,
      }
      ;(event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId)
    },
    [busy],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      updateByClientX(event.clientX)
    },
    [updateByClientX],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    try {
      ;(event.currentTarget as HTMLDivElement).releasePointerCapture(
        dragRef.current.pointerId,
      )
    } catch {
      // 释放失败不影响主流程（已自动释放场景）
    }
    dragRef.current = null
  }, [])

  // Escape 取消
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const rangeStyle: CSSProperties = {
    position: 'absolute',
    left: `${startPct}%`,
    width: `${Math.max(0, endPct - startPct)}%`,
    top: 4,
    bottom: 4,
    borderRadius: 6,
    border: '1.5px solid var(--primary, #ff5f66)',
    background: 'rgba(255, 95, 102, 0.10)',
    pointerEvents: 'none',
  }
  const handleStyle = (side: 'start' | 'end'): CSSProperties => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: TRIM_HANDLE_WIDTH,
    cursor: 'ew-resize',
    pointerEvents: 'auto',
    [side]: -TRIM_HANDLE_WIDTH / 2,
    background:
      side === 'start'
        ? 'linear-gradient(90deg, transparent, rgba(255,95,102,0.6))'
        : 'linear-gradient(270deg, transparent, rgba(255,95,102,0.6))',
  })

  const onApplyClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canApply) return
    onApply(Math.min(start, end), Math.max(start, end))
  }

  const onCancelClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }

  return (
    <div
      className="canvas-node-audio-trim-overlay nodrag nopan"
      ref={wrapperRef}
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="音频截取"
    >
      <div className="canvas-node-audio-trim-row">
        <button
          type="button"
          className="canvas-node-audio-trim-cancel"
          onClick={onCancelClick}
          disabled={busy}
          aria-label="取消截取"
        >
          <Icons.X size={14} />
        </button>
        <span className="canvas-node-audio-trim-label">截取</span>
        <span className="canvas-node-audio-trim-range">
          {rangeStart} - {rangeEnd}
        </span>
        <button
          type="button"
          className="canvas-node-audio-trim-apply"
          onClick={onApplyClick}
          disabled={!canApply}
          aria-label="生成截取后的音频节点"
        >
          {busy ? '生成中…' : '生成'}
        </button>
      </div>

      <div className="canvas-node-audio-trim-stage">
        <CanvasAudioWaveform
          src={src}
          cachedPeaks={cachedPeaks}
          progress={0}
          height={64}
        />
        <div ref={rangeRef} className="canvas-node-audio-trim-range-track">
          <div style={rangeStyle} className="canvas-node-audio-trim-rect">
            <span className="canvas-node-audio-trim-badge" aria-live="polite">
              {durBadge}
            </span>
          </div>
          <div
            role="slider"
            aria-label="截取起点"
            aria-valuemin={0}
            aria-valuemax={safeDuration}
            aria-valuenow={start}
            className="canvas-node-audio-trim-handle canvas-node-audio-trim-handle-start"
            style={handleStyle('start')}
            onPointerDown={beginDrag('start')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <div
            role="slider"
            aria-label="截取终点"
            aria-valuemin={0}
            aria-valuemax={safeDuration}
            aria-valuenow={end}
            className="canvas-node-audio-trim-handle canvas-node-audio-trim-handle-end"
            style={handleStyle('end')}
            onPointerDown={beginDrag('end')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      </div>
    </div>
  )
}
