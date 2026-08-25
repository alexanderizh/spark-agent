import { memo, useCallback } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactElement } from 'react'
import { Tooltip } from 'antd'
import { Icons } from '../../../../Icons'
import type {
  VideoWorkbenchClip,
  VideoWorkbenchResourceV2,
  VideoWorkbenchTrack,
} from '../model/projectTypes'
import { resolveVideoWorkbenchClipTiming } from '../model/timelineMath'
import { formatTimestamp } from '../videoWorkbench.types'
import { ResourceThumb } from '../VideoWorkbenchResourceThumb'
import type { VideoWorkbenchClipSelectionMode } from './timelineTypes'

export const VIDEO_WORKBENCH_CLIP_DRAG_MIME = 'application/x-vwb-project-clip'

interface Props {
  clip: VideoWorkbenchClip
  track: VideoWorkbenchTrack
  resource: VideoWorkbenchResourceV2 | undefined
  pixelsPerSecond: number
  selected: boolean
  showActions: boolean
  editingDisabled: boolean
  onSelect: (clipId: string, mode: VideoWorkbenchClipSelectionMode) => void
  onPreview: (resource: VideoWorkbenchResourceV2) => void
  onDuplicate: (clip: VideoWorkbenchClip, track: VideoWorkbenchTrack) => void
  onRemove: (clipId: string) => void
  onTrim: (clipId: string, edge: 'start' | 'end', sourceTimeSec: number) => void
}

function VideoWorkbenchTimelineClipComponent({
  clip,
  track,
  resource,
  pixelsPerSecond,
  selected,
  showActions,
  editingDisabled,
  onSelect,
  onPreview,
  onDuplicate,
  onRemove,
  onTrim,
}: Props): ReactElement {
  const timing = resolveVideoWorkbenchClipTiming(clip)
  const width = Math.max(18, clip.durationSec * pixelsPerSecond)

  const handleSelect = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.stopPropagation()
      onSelect(clip.id, event.metaKey || event.ctrlKey || event.shiftKey ? 'toggle' : 'replace')
    },
    [clip.id, onSelect],
  )

  const handleSelectKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onSelect(clip.id, event.metaKey || event.ctrlKey || event.shiftKey ? 'toggle' : 'replace')
    },
    [clip.id, onSelect],
  )

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (editingDisabled || track.locked) {
        event.preventDefault()
        return
      }
      const bounds = event.currentTarget.getBoundingClientRect()
      event.dataTransfer.setData(
        VIDEO_WORKBENCH_CLIP_DRAG_MIME,
        JSON.stringify({
          clipId: clip.id,
          offsetSec: Math.max(0, event.clientX - bounds.left) / pixelsPerSecond,
        }),
      )
      event.dataTransfer.effectAllowed = 'move'
    },
    [clip.id, editingDisabled, pixelsPerSecond, track.locked],
  )

  const startTrim = useCallback(
    (edge: 'start' | 'end', event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (editingDisabled || track.locked) return
      const pointerStartX = event.clientX
      const sourceStartSec = edge === 'start' ? timing.sourceStartSec : timing.sourceEndSec
      let latestSourceTimeSec = sourceStartSec
      const move = (moveEvent: globalThis.PointerEvent) => {
        latestSourceTimeSec =
          sourceStartSec + ((moveEvent.clientX - pointerStartX) / pixelsPerSecond) * timing.speed
      }
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        onTrim(clip.id, edge, latestSourceTimeSec)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end, { once: true })
    },
    [
      clip.id,
      editingDisabled,
      onTrim,
      pixelsPerSecond,
      timing.sourceEndSec,
      timing.sourceStartSec,
      timing.speed,
      track.locked,
    ],
  )

  return (
    <div
      className={`vwb-mt-clip vwb-mt-clip-${track.kind}${selected ? ' is-selected' : ''}${
        track.locked || editingDisabled ? ' is-locked' : ''
      }${resource?.missing || !resource ? ' is-missing' : ''}`}
      style={{
        left: `${timing.timelineStartSec * pixelsPerSecond}px`,
        width: `${width}px`,
      }}
      draggable={!editingDisabled && !track.locked}
      data-clip-id={clip.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onDragStart={handleDragStart}
      onClick={handleSelect}
      onKeyDown={handleSelectKey}
      onDoubleClick={() => {
        if (resource) onPreview(resource)
      }}
      title={`${resource?.title ?? '资源已丢失'} · ${formatTimestamp(clip.durationSec)}`}
    >
      <button
        type="button"
        className="vwb-mt-trim is-start"
        aria-label="调整片段入点"
        disabled={editingDisabled || track.locked}
        onPointerDown={(event) => startTrim('start', event)}
      />
      <div className="vwb-mt-clip-media" aria-hidden="true">
        {resource?.kind === 'audio' ? (
          <Icons.AudioLines size={15} />
        ) : (
          <ResourceThumb resource={resource} fallbackSize={15} />
        )}
      </div>
      <div className="vwb-mt-clip-copy">
        <strong>{resource?.title ?? '资源已丢失'}</strong>
        <small>
          {formatTimestamp(timing.timelineStartSec)} · {formatTimestamp(clip.durationSec)}
        </small>
      </div>
      {showActions && !editingDisabled && !track.locked ? (
        <div className="vwb-mt-clip-actions">
          <Tooltip title="复制片段">
            <button
              type="button"
              aria-label="复制片段"
              onClick={(event) => {
                event.stopPropagation()
                onDuplicate(clip, track)
              }}
            >
              <Icons.Copy size={11} />
            </button>
          </Tooltip>
          <Tooltip title="删除片段">
            <button
              type="button"
              aria-label="删除片段"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(clip.id)
              }}
            >
              <Icons.Trash size={11} />
            </button>
          </Tooltip>
        </div>
      ) : null}
      <button
        type="button"
        className="vwb-mt-trim is-end"
        aria-label="调整片段出点"
        disabled={editingDisabled || track.locked}
        onPointerDown={(event) => startTrim('end', event)}
      />
    </div>
  )
}

export const VideoWorkbenchTimelineClip = memo(VideoWorkbenchTimelineClipComponent)
