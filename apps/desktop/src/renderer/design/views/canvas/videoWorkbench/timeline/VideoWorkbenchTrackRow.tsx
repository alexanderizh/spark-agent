import { useMemo, useState } from 'react'
import type { DragEvent, ReactElement } from 'react'
import { Tooltip } from 'antd'
import { Icons } from '../../../../Icons'
import type {
  VideoWorkbenchClip,
  VideoWorkbenchResourceV2,
  VideoWorkbenchTrack,
} from '../model/projectTypes'
import { timelineClientXToProjectTime, trackKindLabel } from '../model/timelineEditing'
import type { TrackMutableChanges, VideoWorkbenchClipSelectionMode } from './timelineTypes'
import { VideoWorkbenchTimelineClip } from './VideoWorkbenchTimelineClip'

const VIDEO_WORKBENCH_RESOURCE_DRAG_MIME = 'application/x-vwb-resource'
const VIDEO_WORKBENCH_TRACK_DRAG_MIME = 'application/x-vwb-project-track'

interface Props {
  track: VideoWorkbenchTrack
  trackOrder: number
  resourcesById: ReadonlyMap<string, VideoWorkbenchResourceV2>
  /** 资源 id → 上游画布任务状态（running/failed），用于片段状态着色；缺省表示画布状态不可用。 */
  taskStatusByResourceId?: ReadonlyMap<string, 'running' | 'failed'> | null | undefined
  pixelsPerSecond: number
  timelineWidth: number
  selectedClipIds: ReadonlySet<string>
  canRemoveTrack: boolean
  editingDisabled: boolean
  onSelectClip: (clipId: string, mode: VideoWorkbenchClipSelectionMode) => void
  onClearSelection: () => void
  onPreviewResource: (resource: VideoWorkbenchResourceV2) => void
  onTrackUpdate: (trackId: string, changes: TrackMutableChanges) => void
  onTrackRemove: (trackId: string) => void
  onTrackReorder: (trackId: string, targetOrder: number) => void
  onResourceDrop: (trackId: string, resourceId: string, timelineStartSec: number) => void
  onDuplicateClip: (clip: VideoWorkbenchClip, track: VideoWorkbenchTrack) => void
  onRemoveClip: (clipId: string) => void
  onTrimClip: (clipId: string, edge: 'start' | 'end', sourceTimeSec: number) => void
  onClipMoveEnd: (
    clipId: string,
    pointer: { clientX: number; clientY: number; grabOffsetSec: number },
  ) => void
  onSeek: (timeSec: number) => void
}

export function VideoWorkbenchTrackRow({
  track,
  trackOrder,
  resourcesById,
  taskStatusByResourceId,
  pixelsPerSecond,
  timelineWidth,
  selectedClipIds,
  canRemoveTrack,
  editingDisabled,
  onSelectClip,
  onClearSelection,
  onPreviewResource,
  onTrackUpdate,
  onTrackRemove,
  onTrackReorder,
  onResourceDrop,
  onDuplicateClip,
  onRemoveClip,
  onTrimClip,
  onClipMoveEnd,
  onSeek,
}: Props): ReactElement {
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(track.name)

  const sortedClips = useMemo(
    () =>
      [...track.clips].sort(
        (left, right) =>
          left.timelineStartSec - right.timelineStartSec || left.id.localeCompare(right.id),
      ),
    [track.clips],
  )

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (editingDisabled || track.locked) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const dropTimeSec = timelineClientXToProjectTime(event.clientX, bounds.left, 0, pixelsPerSecond)
    const resourcePayload = parseJson<{ resourceId?: unknown }>(
      event.dataTransfer.getData(VIDEO_WORKBENCH_RESOURCE_DRAG_MIME),
    )
    if (typeof resourcePayload?.resourceId === 'string') {
      event.preventDefault()
      onResourceDrop(track.id, resourcePayload.resourceId, dropTimeSec)
    }
  }

  const acceptsDrag = (event: DragEvent<HTMLDivElement>) => {
    if (editingDisabled || track.locked) return
    if (event.dataTransfer.types.includes(VIDEO_WORKBENCH_RESOURCE_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  const visualTrack = track.kind === 'video' || track.kind === 'overlay'
  const audioTrack = track.kind === 'audio'
  const editable = !editingDisabled && !track.locked

  const commitRename = () => {
    const name = draftName.trim()
    setRenaming(false)
    if (!name || name === track.name) {
      setDraftName(track.name)
      return
    }
    onTrackUpdate(track.id, { name })
  }

  const handleTrackDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (editingDisabled || !event.dataTransfer.types.includes(VIDEO_WORKBENCH_TRACK_DRAG_MIME)) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleTrackDrop = (event: DragEvent<HTMLDivElement>) => {
    if (editingDisabled) return
    const sourceTrackId = event.dataTransfer.getData(VIDEO_WORKBENCH_TRACK_DRAG_MIME)
    if (!sourceTrackId || sourceTrackId === track.id) return
    event.preventDefault()
    onTrackReorder(sourceTrackId, trackOrder)
  }

  return (
    <div className={`vwb-mt-row is-${track.kind}${track.collapsed ? ' is-collapsed' : ''}`}>
      <div className="vwb-mt-track-head" onDragOver={handleTrackDragOver} onDrop={handleTrackDrop}>
        <span className={`vwb-mt-track-color is-${track.kind}`} />
        <button
          type="button"
          className="vwb-mt-track-drag"
          aria-label={`拖拽排序：${track.name}`}
          draggable={editable}
          disabled={!editable}
          onDragStart={(event) => {
            event.dataTransfer.setData(VIDEO_WORKBENCH_TRACK_DRAG_MIME, track.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            onTrackReorder(track.id, trackOrder + (event.key === 'ArrowUp' ? -1 : 1))
          }}
        >
          <Icons.GripVertical size={12} />
        </button>
        <button
          type="button"
          className="vwb-mt-track-collapse"
          aria-label={track.collapsed ? '展开轨道' : '折叠轨道'}
          disabled={editingDisabled}
          onClick={() => onTrackUpdate(track.id, { collapsed: !track.collapsed })}
        >
          {track.collapsed ? <Icons.ChevronRight size={12} /> : <Icons.ChevronDown size={12} />}
        </button>
        <span className="vwb-mt-track-copy">
          {renaming ? (
            <input
              autoFocus
              value={draftName}
              maxLength={80}
              aria-label="重命名轨道"
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setDraftName(track.name)
                  event.currentTarget.blur()
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="vwb-mt-track-name"
              disabled={!editable}
              title={editable ? '双击重命名轨道' : track.name}
              onDoubleClick={() => {
                setDraftName(track.name)
                setRenaming(true)
              }}
            >
              {track.name}
            </button>
          )}
          <small>
            {trackKindLabel(track.kind)} · {track.clips.length}
          </small>
        </span>
        <div className="vwb-mt-track-actions">
          {visualTrack ? (
            <Tooltip title={track.visible ? '隐藏轨道' : '显示轨道'}>
              <button
                type="button"
                aria-label={track.visible ? '隐藏轨道' : '显示轨道'}
                disabled={!editable}
                className={!track.visible ? 'is-active' : ''}
                onClick={() => onTrackUpdate(track.id, { visible: !track.visible })}
              >
                {track.visible ? <Icons.Eye size={12} /> : <Icons.EyeOff size={12} />}
              </button>
            </Tooltip>
          ) : null}
          {audioTrack ? (
            <>
              <Tooltip title={track.muted ? '取消静音' : '静音'}>
                <button
                  type="button"
                  aria-label={track.muted ? '取消静音' : '静音'}
                  disabled={!editable}
                  className={track.muted ? 'is-active' : ''}
                  onClick={() => onTrackUpdate(track.id, { muted: !track.muted })}
                >
                  {track.muted ? <Icons.VolumeX size={12} /> : <Icons.Volume2 size={12} />}
                </button>
              </Tooltip>
              <Tooltip title={track.solo ? '取消独奏' : '独奏'}>
                <button
                  type="button"
                  aria-label={track.solo ? '取消独奏' : '独奏'}
                  disabled={!editable}
                  className={track.solo ? 'is-active' : ''}
                  onClick={() => onTrackUpdate(track.id, { solo: !track.solo })}
                >
                  S
                </button>
              </Tooltip>
            </>
          ) : null}
          <Tooltip title={track.locked ? '解锁轨道' : '锁定轨道'}>
            <button
              type="button"
              aria-label={track.locked ? '解锁轨道' : '锁定轨道'}
              disabled={editingDisabled}
              className={track.locked ? 'is-active' : ''}
              onClick={() => onTrackUpdate(track.id, { locked: !track.locked })}
            >
              <Icons.Lock size={12} />
            </button>
          </Tooltip>
          {canRemoveTrack ? (
            <Tooltip title="删除轨道">
              <button
                type="button"
                aria-label="删除轨道"
                disabled={!editable}
                onClick={() => onTrackRemove(track.id)}
              >
                <Icons.Trash size={12} />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div
        className={`vwb-mt-lane${track.locked || editingDisabled ? ' is-locked' : ''}`}
        data-track-id={track.id}
        style={{ width: `${timelineWidth}px` }}
        onDragOver={acceptsDrag}
        onDrop={handleDrop}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          onClearSelection()
          onSeek(timelineClientXToProjectTime(event.clientX, bounds.left, 0, pixelsPerSecond))
        }}
      >
        {sortedClips.length === 0 ? (
          <span className="vwb-mt-lane-empty">{track.locked ? '轨道已锁定' : '拖入兼容素材'}</span>
        ) : null}
        {track.collapsed
          ? null
          : sortedClips.map((clip) => (
              <VideoWorkbenchTimelineClip
                key={clip.id}
                clip={clip}
                track={track}
                resource={clip.resourceId ? resourcesById.get(clip.resourceId) : undefined}
                taskStatus={clip.resourceId ? taskStatusByResourceId?.get(clip.resourceId) : undefined}
                pixelsPerSecond={pixelsPerSecond}
                selected={selectedClipIds.has(clip.id)}
                showActions={selectedClipIds.size === 1 && selectedClipIds.has(clip.id)}
                editingDisabled={editingDisabled}
                onSelect={onSelectClip}
                onPreview={onPreviewResource}
                onDuplicate={onDuplicateClip}
                onRemove={onRemoveClip}
                onTrim={onTrimClip}
                onMoveEnd={onClipMoveEnd}
              />
            ))}
      </div>
    </div>
  )
}

function parseJson<T>(value: string): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}
