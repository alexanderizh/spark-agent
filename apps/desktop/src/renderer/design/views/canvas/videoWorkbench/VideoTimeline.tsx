/**
 * VideoTimeline — 专业视频时间轨道组件。
 *
 * 功能：
 *   - 可拖拽播放头（点击/拖动轨道跳转视频位置）
 *   - 缩放控制（1x~20x，滚轮或按钮，影响时间刻度密度）
 *   - 时间刻度（根据缩放自动选择 1s/5s/10s/30s/1min 间隔）
 *   - 关键帧标记（scene/iframe 提取的帧，黄色竖线）
 *   - 手动标记点（蓝色旗帜，可删除）
 *   - 选区拖拽（用于裁剪，灰色半透明区域）
 *
 * 交互：
 *   - 点击轨道 → 播放头跳到该位置
 *   - 拖动播放头 → 实时 seek
 *   - Ctrl/滚轮 → 缩放
 *   - 点击关键帧/标记 → seek 到该时间
 *   - 标记点 hover → 显示删除按钮
 */
import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { Button, Tooltip } from 'antd'
import { Icons } from '../../../Icons'
import { formatTimestamp, type WorkbenchKeyframe } from './videoWorkbench.types'

interface Props {
  /** 视频总时长（秒） */
  duration: number
  /** 当前播放位置（秒） */
  currentTime: number
  /** 已提取的关键帧 */
  keyframes: WorkbenchKeyframe[]
  /** 手动标记的时间点（秒） */
  manualMarks: number[]
  /** seek 到指定时间 */
  onSeek: (sec: number) => void
  /** 标记当前帧 */
  onMark: () => void
  /** 删除标记 */
  onRemoveMark: (sec: number) => void
  /** 提取标记帧 */
  onExtractMarks: () => void
  busy: boolean
}

/** 根据缩放级别选择合适的刻度间隔（秒） */
function pickTickInterval(pixelsPerSec: number): number {
  // 每个刻度至少 50px 间隔
  if (pixelsPerSec > 50) return 1
  if (pixelsPerSec > 20) return 2
  if (pixelsPerSec > 10) return 5
  if (pixelsPerSec > 5) return 10
  if (pixelsPerSec > 2) return 30
  return 60
}

const MIN_TRACK_WIDTH = 400 // 最小轨道宽度 px（用于计算缩放）

export function VideoTimeline({
  duration,
  currentTime,
  keyframes,
  manualMarks,
  onSeek,
  onMark,
  onRemoveMark,
  onExtractMarks,
  busy,
}: Props): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1) // 1x ~ 20x
  const [dragging, setDragging] = useState(false)

  // 缩放后的轨道宽度（按 duration 和 zoom 计算）
  const trackWidth = useMemo(() => {
    if (duration <= 0) return MIN_TRACK_WIDTH
    // 基础：每秒 8px（1x），zoom 放大
    return Math.max(MIN_TRACK_WIDTH, duration * 8 * zoom)
  }, [duration, zoom])

  const pixelsPerSec = duration > 0 ? trackWidth / duration : 0
  const tickInterval = pickTickInterval(pixelsPerSec)

  // 刻度线列表
  const ticks = useMemo(() => {
    if (duration <= 0) return []
    const result: number[] = []
    for (let t = 0; t <= duration; t += tickInterval) {
      result.push(t)
    }
    return result
  }, [duration, tickInterval])

  /** 把鼠标 X 坐标转换为时间（秒） */
  const xToTime = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el || duration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const scrollLeft = el.scrollLeft
      const x = clientX - rect.left + scrollLeft
      const ratio = Math.max(0, Math.min(1, x / trackWidth))
      return ratio * duration
    },
    [duration, trackWidth],
  )

  // 拖拽播放头
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      setDragging(true)
      const t = xToTime(e.clientX)
      onSeek(t)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [xToTime, onSeek],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return
      const t = xToTime(e.clientX)
      onSeek(t)
    },
    [dragging, xToTime, onSeek],
  )

  const handlePointerUp = useCallback(() => {
    setDragging(false)
  }, [])

  // 滚轮缩放（Ctrl + 滚轮）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -1 : 1
    setZoom((z) => Math.max(1, Math.min(20, z + delta)))
  }, [])

  // 键盘左右箭头微调
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (duration <= 0) return
      const step = e.shiftKey ? 5 : 0.1 // Shift+箭头 = 5s，普通 = 0.1s
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onSeek(Math.max(0, currentTime - step))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onSeek(Math.min(duration, currentTime + step))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentTime, duration, onSeek])

  if (duration <= 0) {
    return (
      <div className="vwb-timeline">
        <div className="vwb-timeline-empty">等待视频探测完成…</div>
      </div>
    )
  }

  const playheadX = (currentTime / duration) * trackWidth

  return (
    <div className="vwb-timeline">
      {/* 工具栏 */}
      <div className="vwb-timeline-toolbar">
        <span className="vwb-timeline-time-current">{formatTimestamp(currentTime)}</span>
        <span className="vwb-timeline-divider">/</span>
        <span className="vwb-timeline-duration">{formatTimestamp(duration)}</span>
        <div className="vwb-timeline-spacer" />
        <span className="vwb-timeline-zoom-label">{zoom}x</span>
        <Button
          size="small"
          type="text"
          icon={<Icons.Minus size={12} />}
          onClick={() => setZoom((z) => Math.max(1, z - 1))}
          disabled={zoom <= 1}
        />
        <Button
          size="small"
          type="text"
          icon={<Icons.Plus size={12} />}
          onClick={() => setZoom((z) => Math.min(20, z + 1))}
          disabled={zoom >= 20}
        />
        <Button
          size="small"
          type="default"
          onClick={onMark}
          icon={<Icons.Pin size={12} />}
        >
          标记帧
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={onExtractMarks}
          loading={busy}
          disabled={manualMarks.length === 0}
          icon={<Icons.Download size={12} />}
        >
          提取标记({manualMarks.length})
        </Button>
      </div>

      {/* 可滚动轨道区 */}
      <div
        className="vwb-timeline-scroll"
        ref={trackRef}
        onWheel={handleWheel}
      >
        <div
          className={`vwb-timeline-canvas${dragging ? ' dragging' : ''}`}
          style={{ width: `${trackWidth}px` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* 时间刻度 */}
          <div className="vwb-timeline-ticks">
            {ticks.map((t) => (
              <div
                key={t}
                className="vwb-timeline-tick"
                style={{ left: `${(t / duration) * trackWidth}px` }}
              >
                <span className="vwb-timeline-tick-label">{formatTimestamp(t)}</span>
              </div>
            ))}
          </div>

          {/* 轨道主体 */}
          <div className="vwb-timeline-lane">
            {/* 已播放区域 */}
            <div
              className="vwb-timeline-played"
              style={{ width: `${playheadX}px` }}
            />

            {/* 关键帧标记 */}
            {keyframes.map((kf) => (
              <Tooltip
                key={kf.index}
                title={`${formatTimestamp(kf.timestampSec)} · 关键帧 ${kf.index + 1}`}
              >
                <div
                  className="vwb-timeline-kf"
                  style={{ left: `${(kf.timestampSec / duration) * trackWidth}px` }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSeek(kf.timestampSec)
                  }}
                >
                  <img src={kf.previewUrl} alt="" />
                </div>
              </Tooltip>
            ))}

            {/* 手动标记点 */}
            {manualMarks.map((t) => (
              <Tooltip key={t} title={formatTimestamp(t)}>
                <div
                  className="vwb-timeline-mark"
                  style={{ left: `${(t / duration) * trackWidth}px` }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSeek(t)
                  }}
                >
                  <span
                    className="vwb-timeline-mark-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveMark(t)
                    }}
                  >
                    ×
                  </span>
                </div>
              </Tooltip>
            ))}

            {/* 播放头 */}
            <div
              className="vwb-timeline-playhead"
              style={{ left: `${playheadX}px` }}
            >
              <div className="vwb-timeline-playhead-handle" />
            </div>
          </div>
        </div>
      </div>

      {/* 提示 */}
      <div className="vwb-timeline-hints">
        <span>点击/拖动轨道定位</span>
        <span>·</span>
        <span>Ctrl+滚轮缩放</span>
        <span>·</span>
        <span>←/→ 微调（Shift 跳 5s）</span>
      </div>
    </div>
  )
}
