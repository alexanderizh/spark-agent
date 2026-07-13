/**
 * VideoTimeline — 可直接剪辑的单视频轨道。
 *
 * 交互遵循桌面 NLE 的核心习惯：
 *   - 点击/拖动空白区域移动播放头
 *   - 拖动片段左右手柄设置入点/出点
 *   - I / O 设置入点和出点，Cmd/Ctrl+B 在播放头处分割
 *   - 选区可直接快切/精切导出，分割会导出播放头两侧片段
 *   - Ctrl/Cmd + 滚轮缩放，方向键微调播放头
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import { Button, Tooltip } from 'antd'
import { Icons } from '../../../Icons'
import { formatTimestamp, type WorkbenchKeyframe } from './videoWorkbench.types'
import {
  MIN_TIMELINE_RANGE_SEC,
  moveTimelineRangeEdge,
  normalizeTimelineRange,
  splitTimelineRange,
  type TimelineRange,
  type TimelineRangeEdge,
} from './videoTimelineModel'

interface Props {
  duration: number
  currentTime: number
  keyframes: WorkbenchKeyframe[]
  manualMarks: number[]
  range: TimelineRange
  trimCopy: boolean
  processingReady: boolean
  onSeek: (sec: number) => void
  onRangeChange: (range: TimelineRange) => void
  onTrimCopyChange: (copy: boolean) => void
  onApplyTrim: () => void
  onSplit: () => void
  onMark: () => void
  onRemoveMark: (sec: number) => void
  onExtractMarks: () => void
  busy: boolean
}

function pickTickInterval(pixelsPerSec: number): number {
  if (pixelsPerSec > 50) return 1
  if (pixelsPerSec > 20) return 2
  if (pixelsPerSec > 10) return 5
  if (pixelsPerSec > 5) return 10
  if (pixelsPerSec > 2) return 30
  return 60
}

const MIN_TRACK_WIDTH = 400

export function VideoTimeline({
  duration,
  currentTime,
  keyframes,
  manualMarks,
  range,
  trimCopy,
  processingReady,
  onSeek,
  onRangeChange,
  onTrimCopyChange,
  onApplyTrim,
  onSplit,
  onMark,
  onRemoveMark,
  onExtractMarks,
  busy,
}: Props): ReactElement {
  const timelineRootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const [draggingEdge, setDraggingEdge] = useState<TimelineRangeEdge | null>(null)

  const normalizedRange = useMemo(() => normalizeTimelineRange(range, duration), [duration, range])
  const selectedDuration = Math.max(0, normalizedRange.endSec - normalizedRange.startSec)
  const canSplit = splitTimelineRange(normalizedRange, currentTime, duration) !== null

  const trackWidth = useMemo(() => {
    if (duration <= 0) return MIN_TRACK_WIDTH
    return Math.max(MIN_TRACK_WIDTH, duration * 8 * zoom)
  }, [duration, zoom])

  const pixelsPerSec = duration > 0 ? trackWidth / duration : 0
  const tickInterval = pickTickInterval(pixelsPerSec)
  const playheadX = duration > 0 ? (currentTime / duration) * trackWidth : 0
  const rangeStartX = duration > 0 ? (normalizedRange.startSec / duration) * trackWidth : 0
  const rangeEndX = duration > 0 ? (normalizedRange.endSec / duration) * trackWidth : trackWidth

  const [viewRange, setViewRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: Infinity,
  })
  useEffect(() => {
    const el = trackRef.current
    if (!el || duration <= 0) return
    const update = () => {
      const startT = (el.scrollLeft / trackWidth) * duration
      const endT = ((el.scrollLeft + el.clientWidth) / trackWidth) * duration
      setViewRange({ start: startT, end: endT })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [trackWidth, duration])

  const ticks = useMemo(() => {
    if (duration <= 0) return []
    const result: number[] = []
    const start = Math.max(0, viewRange.start - tickInterval)
    const end = Math.min(duration, viewRange.end + tickInterval)
    const firstTick = Math.ceil(start / tickInterval) * tickInterval
    for (let t = firstTick; t <= end; t += tickInterval) result.push(t)
    return result
  }, [duration, tickInterval, viewRange.start, viewRange.end])

  const xToTime = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el || duration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left + el.scrollLeft
      return Math.max(0, Math.min(duration, (x / trackWidth) * duration))
    },
    [duration, trackWidth],
  )

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      timelineRootRef.current?.focus({ preventScroll: true })
      setDraggingPlayhead(true)
      onSeek(xToTime(event.clientX))
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [onSeek, xToTime],
  )

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (draggingPlayhead) onSeek(xToTime(event.clientX))
    },
    [draggingPlayhead, onSeek, xToTime],
  )

  const stopPlayheadDrag = useCallback(() => setDraggingPlayhead(false), [])

  const handleTrimPointerDown = useCallback(
    (edge: TimelineRangeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      timelineRootRef.current?.focus({ preventScroll: true })
      setDraggingEdge(edge)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [],
  )

  const handleTrimPointerMove = useCallback(
    (edge: TimelineRangeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
      if (draggingEdge !== edge) return
      event.preventDefault()
      event.stopPropagation()
      onRangeChange(moveTimelineRangeEdge(normalizedRange, edge, xToTime(event.clientX), duration))
    },
    [draggingEdge, duration, normalizedRange, onRangeChange, xToTime],
  )

  const stopTrimDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDraggingEdge(null)
  }, [])

  const moveEdgeFromKeyboard = useCallback(
    (edge: TimelineRangeEdge, delta: number) => {
      const current = edge === 'start' ? normalizedRange.startSec : normalizedRange.endSec
      onRangeChange(moveTimelineRangeEdge(normalizedRange, edge, current + delta, duration))
    },
    [duration, normalizedRange, onRangeChange],
  )

  const handleEdgeKeyDown = useCallback(
    (edge: TimelineRangeEdge, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? 1 : 0.1
      moveEdgeFromKeyboard(edge, event.key === 'ArrowLeft' ? -step : step)
    },
    [moveEdgeFromKeyboard],
  )

  const handleTimelineKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest('button, input, textarea, [contenteditable="true"]')) return

      const step = event.shiftKey ? 5 : 0.1
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onSeek(Math.max(0, currentTime - step))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onSeek(Math.min(duration, currentTime + step))
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault()
        onRangeChange(moveTimelineRangeEdge(normalizedRange, 'start', currentTime, duration))
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        onRangeChange(moveTimelineRangeEdge(normalizedRange, 'end', currentTime, duration))
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'b' &&
        canSplit &&
        processingReady &&
        !busy
      ) {
        event.preventDefault()
        onSplit()
      }
    },
    [
      busy,
      canSplit,
      currentTime,
      duration,
      normalizedRange,
      onRangeChange,
      onSeek,
      onSplit,
      processingReady,
    ],
  )

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setZoom((value) => Math.max(1, Math.min(20, value + (event.deltaY > 0 ? -1 : 1))))
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el || draggingPlayhead || draggingEdge) return
    const target = playheadX - el.clientWidth / 2
    const edgePadding = 24
    if (
      playheadX < el.scrollLeft + edgePadding ||
      playheadX > el.scrollLeft + el.clientWidth - edgePadding
    ) {
      el.scrollLeft = Math.max(0, target)
    }
  }, [draggingEdge, draggingPlayhead, playheadX])

  if (duration <= 0) {
    return (
      <div className="vwb-timeline">
        <div className="vwb-timeline-empty">等待视频探测完成…</div>
      </div>
    )
  }

  return (
    <div
      ref={timelineRootRef}
      className="vwb-timeline"
      role="region"
      aria-label="视频剪辑时间轴"
      tabIndex={0}
      onKeyDown={handleTimelineKeyDown}
    >
      <div className="vwb-timeline-toolbar">
        <div className="vwb-timeline-timecode" aria-label="当前时间与总时长">
          <span className="vwb-timeline-time-current">{formatTimestamp(currentTime)}</span>
          <span className="vwb-timeline-divider">/</span>
          <span className="vwb-timeline-duration">{formatTimestamp(duration)}</span>
        </div>

        <div className="vwb-timeline-edit-actions" aria-label="轨道剪辑工具">
          <Button
            size="small"
            onClick={() =>
              onRangeChange(moveTimelineRangeEdge(normalizedRange, 'start', currentTime, duration))
            }
            disabled={busy || currentTime >= normalizedRange.endSec - MIN_TIMELINE_RANGE_SEC}
            title="设置入点（I）"
          >
            入点
          </Button>
          <Button
            size="small"
            onClick={() =>
              onRangeChange(moveTimelineRangeEdge(normalizedRange, 'end', currentTime, duration))
            }
            disabled={busy || currentTime <= normalizedRange.startSec + MIN_TIMELINE_RANGE_SEC}
            title="设置出点（O）"
          >
            出点
          </Button>
          <Button
            size="small"
            icon={<Icons.Scissors size={13} />}
            onClick={onSplit}
            disabled={busy || !processingReady || !canSplit}
            title="在播放头处分割并导出两段（Cmd/Ctrl+B）"
          >
            分割
          </Button>
          <div className="vwb-timeline-cut-mode" aria-label="剪切精度">
            <button
              type="button"
              className={trimCopy ? 'is-active' : ''}
              aria-pressed={trimCopy}
              onClick={() => onTrimCopyChange(true)}
              title="按关键帧快速无损裁切"
            >
              快切
            </button>
            <button
              type="button"
              className={!trimCopy ? 'is-active' : ''}
              aria-pressed={!trimCopy}
              onClick={() => onTrimCopyChange(false)}
              title="重新编码，精确到所选时间"
            >
              精切
            </button>
          </div>
          <Button
            size="small"
            type="primary"
            icon={<Icons.Download size={13} />}
            onClick={onApplyTrim}
            loading={busy}
            disabled={!processingReady || selectedDuration <= 0}
          >
            导出选区
          </Button>
        </div>

        <div className="vwb-timeline-spacer" />

        <div className="vwb-timeline-secondary-actions">
          <Tooltip title="标记当前帧">
            <Button
              size="small"
              type="text"
              aria-label="标记当前帧"
              icon={<Icons.Pin size={13} />}
              onClick={onMark}
            />
          </Tooltip>
          <Tooltip title={`提取 ${manualMarks.length} 个标记帧`}>
            <Button
              size="small"
              type="text"
              aria-label="提取标记帧"
              icon={<Icons.Download size={13} />}
              onClick={onExtractMarks}
              loading={busy}
              disabled={manualMarks.length === 0}
            />
          </Tooltip>
          <span className="vwb-timeline-zoom-label">{zoom}x</span>
          <Button
            size="small"
            type="text"
            aria-label="缩小时间轴"
            icon={<Icons.Minus size={12} />}
            onClick={() => setZoom((value) => Math.max(1, value - 1))}
            disabled={zoom <= 1}
          />
          <Button
            size="small"
            type="text"
            aria-label="放大时间轴"
            icon={<Icons.Plus size={12} />}
            onClick={() => setZoom((value) => Math.min(20, value + 1))}
            disabled={zoom >= 20}
          />
        </div>
      </div>

      <div className="vwb-timeline-selection-summary" aria-live="polite">
        <span>V1 · 源视频</span>
        <strong>
          {formatTimestamp(normalizedRange.startSec)} – {formatTimestamp(normalizedRange.endSec)}
        </strong>
        <span>选区 {formatTimestamp(selectedDuration)}</span>
      </div>

      <div className="vwb-timeline-scroll" ref={trackRef} onWheel={handleWheel}>
        <div
          className={`vwb-timeline-canvas${draggingPlayhead ? ' dragging' : ''}${draggingEdge ? ' trimming' : ''}`}
          style={{ width: `${trackWidth}px` }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={stopPlayheadDrag}
          onPointerCancel={stopPlayheadDrag}
        >
          <div className="vwb-timeline-ticks" aria-hidden="true">
            {ticks.map((time) => (
              <div
                key={time}
                className="vwb-timeline-tick"
                style={{ left: `${(time / duration) * trackWidth}px` }}
              >
                <span className="vwb-timeline-tick-label">{formatTimestamp(time)}</span>
              </div>
            ))}
          </div>

          <div className="vwb-timeline-lane">
            <div className="vwb-timeline-muted-range" style={{ width: `${rangeStartX}px` }} />
            <div
              className="vwb-timeline-muted-range is-after"
              style={{ left: `${rangeEndX}px`, width: `${trackWidth - rangeEndX}px` }}
            />

            <div
              className="vwb-timeline-clip"
              style={{
                left: `${rangeStartX}px`,
                width: `${Math.max(2, rangeEndX - rangeStartX)}px`,
              }}
            >
              <div className="vwb-timeline-clip-fill" />
              <div className="vwb-timeline-clip-label">
                <Icons.Video size={13} />
                <span>源视频</span>
                <span className="vwb-timeline-clip-duration">
                  {formatTimestamp(selectedDuration)}
                </span>
              </div>
              <div
                className="vwb-timeline-trim-handle is-start"
                role="slider"
                aria-label="片段入点"
                aria-valuemin={0}
                aria-valuemax={normalizedRange.endSec}
                aria-valuenow={normalizedRange.startSec}
                tabIndex={0}
                onKeyDown={(event) => handleEdgeKeyDown('start', event)}
                onPointerDown={(event) => handleTrimPointerDown('start', event)}
                onPointerMove={(event) => handleTrimPointerMove('start', event)}
                onPointerUp={stopTrimDrag}
                onPointerCancel={stopTrimDrag}
              >
                <span />
              </div>
              <div
                className="vwb-timeline-trim-handle is-end"
                role="slider"
                aria-label="片段出点"
                aria-valuemin={normalizedRange.startSec}
                aria-valuemax={duration}
                aria-valuenow={normalizedRange.endSec}
                tabIndex={0}
                onKeyDown={(event) => handleEdgeKeyDown('end', event)}
                onPointerDown={(event) => handleTrimPointerDown('end', event)}
                onPointerMove={(event) => handleTrimPointerMove('end', event)}
                onPointerUp={stopTrimDrag}
                onPointerCancel={stopTrimDrag}
              >
                <span />
              </div>
            </div>

            <div className="vwb-timeline-played" style={{ width: `${playheadX}px` }} />

            {keyframes.map((keyframe) => (
              <Tooltip
                key={keyframe.index}
                title={`${formatTimestamp(keyframe.timestampSec)} · 关键帧 ${keyframe.index + 1}`}
              >
                <button
                  type="button"
                  className="vwb-timeline-kf"
                  style={{ left: `${(keyframe.timestampSec / duration) * trackWidth}px` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSeek(keyframe.timestampSec)}
                  aria-label={`跳到关键帧 ${formatTimestamp(keyframe.timestampSec)}`}
                >
                  <img src={keyframe.previewUrl} alt="" />
                </button>
              </Tooltip>
            ))}

            {manualMarks.map((time) => (
              <Tooltip key={time} title={formatTimestamp(time)}>
                <div
                  className="vwb-timeline-mark"
                  style={{ left: `${(time / duration) * trackWidth}px` }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="vwb-timeline-mark-seek"
                    onClick={() => onSeek(time)}
                    aria-label={`跳到标记 ${formatTimestamp(time)}`}
                  />
                  <button
                    type="button"
                    className="vwb-timeline-mark-remove"
                    aria-label={`删除标记 ${formatTimestamp(time)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemoveMark(time)
                    }}
                  >
                    ×
                  </button>
                </div>
              </Tooltip>
            ))}

            <div className="vwb-timeline-playhead" style={{ left: `${playheadX}px` }}>
              <div className="vwb-timeline-playhead-handle" />
            </div>
          </div>
        </div>
      </div>

      <div className="vwb-timeline-hints">
        <span>拖动黄色手柄修剪</span>
        <span>·</span>
        <span>I / O 设入出点</span>
        <span>·</span>
        <span>Cmd/Ctrl+B 分割</span>
        <span>·</span>
        <span>Ctrl+滚轮缩放</span>
        <span>·</span>
        <span>←/→ 微调</span>
      </div>
    </div>
  )
}
