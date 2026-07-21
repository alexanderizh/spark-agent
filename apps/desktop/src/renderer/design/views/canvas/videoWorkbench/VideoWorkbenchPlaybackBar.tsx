/**
 * VideoWorkbenchPlaybackBar — 多段轨道的播放进度条。
 *
 * 按各 clip 时长比例横向分段，叠一个可拖动的播放头。
 * 与下方等宽卡片 strip 互补：strip 负责「重排/编辑」，这里负责「按真实时长连播预览」。
 *
 * 交互：pointerdown/move 把横坐标换算为全局秒数 → onSeek（hook.seekToGlobal）。
 */
import { useCallback, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { Icons } from '../../../Icons'
import { formatTimestamp, type TrackClip, type WorkbenchResource } from './videoWorkbench.types'
import { clipDurationSec, indexResourcesById } from './resourcePanelUtils'

interface Props {
  track: TrackClip[]
  resources: WorkbenchResource[]
  globalTimeSec: number
  totalDurationSec: number
  active: boolean
  playing: boolean
  currentClipId: string | null
  onSeek: (sec: number) => void
  onTogglePlay: () => void
}

export function VideoWorkbenchPlaybackBar({
  track,
  resources,
  globalTimeSec,
  totalDurationSec,
  active,
  playing,
  currentClipId,
  onSeek,
  onTogglePlay,
}: Props): ReactElement | null {
  const barRef = useRef<HTMLDivElement>(null)
  const resourcesById = useMemo(() => indexResourcesById(resources), [resources])
  const sortedTrack = useMemo(() => track.slice().sort((a, b) => a.order - b.order), [track])
  const draggingRef = useRef(false)

  const xToSec = useCallback(
    (clientX: number) => {
      const el = barRef.current
      if (!el || totalDurationSec <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * totalDurationSec
    },
    [totalDurationSec],
  )

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (totalDurationSec <= 0) return
      e.preventDefault()
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      onSeek(xToSec(e.clientX))
    },
    [onSeek, totalDurationSec, xToSec],
  )
  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      onSeek(xToSec(e.clientX))
    },
    [onSeek, xToSec],
  )
  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointerId 可能已释放，忽略 */
    }
  }, [])

  if (totalDurationSec <= 0) return null

  const headPct = Math.min(100, (globalTimeSec / totalDurationSec) * 100)
  const canToggle = active || sortedTrack.length > 0

  return (
    <div className="vwb-playback-bar">
      <button
        type="button"
        className={`vwb-playback-play${playing ? ' is-playing' : ''}`}
        onClick={onTogglePlay}
        aria-label={playing ? '暂停' : '播放整条'}
        disabled={!canToggle}
        title={playing ? '暂停（空格）' : '播放整条（空格）'}
      >
        {playing ? <Icons.Pause size={14} /> : <Icons.Play size={14} />}
      </button>
      <div className="vwb-playback-time" aria-label="当前时间与总时长">
        <span className="vwb-playback-time-current">{formatTimestamp(globalTimeSec)}</span>
        <span className="vwb-playback-time-total">/ {formatTimestamp(totalDurationSec)}</span>
      </div>
      <div
        ref={barRef}
        className="vwb-playback-track"
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalDurationSec)}
        aria-valuenow={Math.round(globalTimeSec)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {sortedTrack.map((clip, i) => {
          const resource = resourcesById.get(clip.resourceId)
          const dur = clipDurationSec(clip, resource)
          const pct = (dur / totalDurationSec) * 100
          const isCurrent = clip.id === currentClipId
          const isImage = resource?.kind === 'image'
          return (
            <div
              key={clip.id}
              className={`vwb-playback-seg${isCurrent ? ' is-current' : ''}${
                isImage ? ' is-image' : ''
              }`}
              style={{ width: `${pct}%` }}
              title={`${i + 1}. ${resource?.title ?? '片段'} · ${formatTimestamp(dur)}`}
            >
              <span className="vwb-playback-seg-label">
                {i + 1} · {resource?.title ?? '片段'}
              </span>
              <span className="vwb-playback-seg-dur">{formatTimestamp(dur)}</span>
            </div>
          )
        })}
        <div className="vwb-playback-head" style={{ left: `${headPct}%` }}>
          <div className="vwb-playback-head-handle" />
        </div>
      </div>
    </div>
  )
}
