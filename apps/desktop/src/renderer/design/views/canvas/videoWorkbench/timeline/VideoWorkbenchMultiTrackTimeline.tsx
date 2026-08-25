import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react'
import { Button, Switch, Tooltip, message } from 'antd'
import { Icons } from '../../../../Icons'
import { classNames } from '../../../../utils/class-names'
import type {
  VideoWorkbenchClip,
  VideoWorkbenchProjectV2,
  VideoWorkbenchResourceV2,
  VideoWorkbenchTrack,
} from '../model/projectTypes'
import type {
  VideoWorkbenchProjectCommand,
  VideoWorkbenchProjectCommandResult,
} from '../model/projectReducer'
import {
  buildVideoWorkbenchMagneticReorderMoves,
  createVideoWorkbenchClipForResource,
  createVideoWorkbenchEntityId,
  createVideoWorkbenchTrack,
  timelineClientXToProjectTime,
  VIDEO_WORKBENCH_TIMELINE_MAX_PX_PER_SEC,
  VIDEO_WORKBENCH_TIMELINE_MIN_PX_PER_SEC,
} from '../model/timelineEditing'
import { isMainVideoWorkbenchTrack } from '../model/trackRules'
import {
  resolveVideoWorkbenchClipTiming,
  resolveVideoWorkbenchProjectDuration,
} from '../model/timelineMath'
import {
  collectVideoWorkbenchSnapCandidates,
  snapVideoWorkbenchClipMove,
} from '../model/timelineSnapping'
import { buildTimelineTicks } from '../videoWorkbenchTimelineScale'
import { formatTimestamp } from '../videoWorkbench.types'
import { VideoWorkbenchTrackRow } from './VideoWorkbenchTrackRow'
import type { TrackMutableChanges, VideoWorkbenchClipSelectionMode } from './timelineTypes'
import './videoWorkbench.timeline-v2.less'

interface Props {
  project: VideoWorkbenchProjectV2
  busy: boolean
  readOnly: boolean
  selectedClipIds: readonly string[]
  playheadSec: number
  canUndo: boolean
  canRedo: boolean
  onSelectionChange: (clipIds: string[]) => void
  onPreviewResource: (resource: VideoWorkbenchResourceV2) => void
  onSeek: (timeSec: number) => void
  onCommand: (command: VideoWorkbenchProjectCommand) => VideoWorkbenchProjectCommandResult
  onUpdateProject: (
    updater: (project: VideoWorkbenchProjectV2) => VideoWorkbenchProjectV2,
    recordHistory?: boolean,
  ) => void
  onUndo: () => void
  onRedo: () => void
  onOpenFrames: () => void
  onOpenEdit: () => void
  onOpenOutput: () => void
}

export function VideoWorkbenchMultiTrackTimeline({
  project,
  busy,
  readOnly,
  selectedClipIds,
  playheadSec,
  canUndo,
  canRedo,
  onSelectionChange,
  onPreviewResource,
  onSeek,
  onCommand,
  onUpdateProject,
  onUndo,
  onRedo,
  onOpenFrames,
  onOpenEdit,
  onOpenOutput,
}: Props): ReactElement {
  const rulerRef = useRef<HTMLDivElement>(null)
  const playheadPointerIdRef = useRef<number | null>(null)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)
  const pixelsPerSecond = Math.min(
    VIDEO_WORKBENCH_TIMELINE_MAX_PX_PER_SEC,
    Math.max(VIDEO_WORKBENCH_TIMELINE_MIN_PX_PER_SEC, project.ui.zoomPxPerSec),
  )
  const projectDurationSec = resolveVideoWorkbenchProjectDuration(project)
  const timelineDurationSec = Math.max(30, projectDurationSec + 5)
  const timelineWidth = Math.max(720, timelineDurationSec * pixelsPerSecond)
  const resourcesById = useMemo(
    () => new Map(project.resources.map((resource) => [resource.id, resource])),
    [project.resources],
  )
  const sortedTracks = useMemo(
    () => [...project.tracks].sort((left, right) => left.order - right.order),
    [project.tracks],
  )
  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds])
  const selectedClips = useMemo(
    () =>
      selectedClipIds.flatMap((clipId) => {
        const found = findClip(project, clipId)
        return found ? [found] : []
      }),
    [project, selectedClipIds],
  )
  const ticks = useMemo(
    () => buildTimelineTicks(timelineDurationSec, pixelsPerSecond),
    [pixelsPerSecond, timelineDurationSec],
  )

  const runCommand = useCallback(
    (command: VideoWorkbenchProjectCommand): boolean => {
      const result = onCommand(command)
      if (!result.applied) message.warning(commandRejectMessage(result.reason))
      return result.applied
    },
    [onCommand],
  )

  const handleTrackUpdate = useCallback(
    (trackId: string, changes: TrackMutableChanges) => {
      runCommand({ type: 'track/update', trackId, changes })
    },
    [runCommand],
  )

  const handleSelectionChange = useCallback(
    (clipId: string, mode: VideoWorkbenchClipSelectionMode) => {
      if (mode === 'replace') {
        onSelectionChange([clipId])
        return
      }
      onSelectionChange(
        selectedClipIdSet.has(clipId)
          ? selectedClipIds.filter((candidate) => candidate !== clipId)
          : [...selectedClipIds, clipId],
      )
    },
    [onSelectionChange, selectedClipIdSet, selectedClipIds],
  )

  const handleResourceDrop = useCallback(
    (trackId: string, resourceId: string, timelineStartSec: number) => {
      const resource = resourcesById.get(resourceId)
      if (!resource) {
        message.warning('素材已不存在，请刷新资源面板')
        return
      }
      const clip = createVideoWorkbenchClipForResource(project, resource, timelineStartSec)
      if (
        !runCommand({
          type: 'clip/add',
          trackId,
          clip,
        })
      ) {
        return
      }
      onSelectionChange([clip.id])
      onPreviewResource(resource)
    },
    [onPreviewResource, onSelectionChange, project, resourcesById, runCommand],
  )

  const handleClipMove = useCallback(
    (clipId: string, trackId: string, rawTimelineStartSec: number) => {
      const found = findClip(project, clipId)
      if (!found) return
      const movingSelection = selectedClipIdSet.has(clipId) ? selectedClips : [found]
      const sourceTrackIds = new Set(movingSelection.map((selection) => selection.track.id))
      if (sourceTrackIds.size > 1 && found.track.id !== trackId) {
        message.info('跨轨多选只能整体水平移动；跨轨放置请先选择同一轨道的片段')
        return
      }
      const groupStartSec = Math.min(
        ...movingSelection.map((selection) => selection.clip.timelineStartSec),
      )
      const groupEndSec = Math.max(
        ...movingSelection.map(
          (selection) => resolveVideoWorkbenchClipTiming(selection.clip).timelineEndSec,
        ),
      )
      const rawDeltaSec = rawTimelineStartSec - found.clip.timelineStartSec
      const boundedDeltaSec = Math.max(-groupStartSec, rawDeltaSec)
      const rawGroupStartSec = groupStartSec + boundedDeltaSec
      const candidates = collectVideoWorkbenchSnapCandidates(project, {
        playheadSec,
        excludedClipIds: new Set(movingSelection.map((selection) => selection.clip.id)),
      })
      const snapped = project.ui.snappingEnabled
        ? snapVideoWorkbenchClipMove(
            rawGroupStartSec,
            groupEndSec - groupStartSec,
            candidates,
            pixelsPerSecond,
          )
        : { timeSec: rawGroupStartSec }
      const snappedDeltaSec = snapped.timeSec - groupStartSec
      if (
        movingSelection.length === 1 &&
        found.track.id === trackId &&
        project.project.magneticMainTrack &&
        isMainVideoWorkbenchTrack(project, trackId)
      ) {
        const moves = buildVideoWorkbenchMagneticReorderMoves(
          found.track,
          clipId,
          found.clip.timelineStartSec + snappedDeltaSec,
        )
        if (moves.length > 0) runCommand({ type: 'clip/move-many', moves })
        return
      }
      if (movingSelection.length === 1) {
        runCommand({
          type: 'clip/move',
          clipId,
          targetTrackId: trackId,
          timelineStartSec: Math.max(0, found.clip.timelineStartSec + snappedDeltaSec),
        })
        return
      }
      runCommand({
        type: 'clip/move-many',
        moves: movingSelection.map((selection) => ({
          clipId: selection.clip.id,
          targetTrackId: sourceTrackIds.size === 1 ? trackId : selection.track.id,
          timelineStartSec: Math.max(0, selection.clip.timelineStartSec + snappedDeltaSec),
        })),
      })
    },
    [pixelsPerSecond, playheadSec, project, runCommand, selectedClipIdSet, selectedClips],
  )

  const handleClipMoveEnd = useCallback(
    (clipId: string, pointer: { clientX: number; clientY: number; grabOffsetSec: number }) => {
      const lane = document
        .elementsFromPoint(pointer.clientX, pointer.clientY)
        .find(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element.classList.contains('vwb-mt-lane'),
        )
      const trackId = lane?.dataset.trackId
      if (!lane || !trackId) return
      const bounds = lane.getBoundingClientRect()
      const pointerTimeSec = timelineClientXToProjectTime(
        pointer.clientX,
        bounds.left,
        0,
        pixelsPerSecond,
      )
      handleClipMove(clipId, trackId, Math.max(0, pointerTimeSec - pointer.grabOffsetSec))
    },
    [handleClipMove, pixelsPerSecond],
  )

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const ruler = rulerRef.current
      if (!ruler) return
      const bounds = ruler.getBoundingClientRect()
      const nextTimeSec = timelineClientXToProjectTime(clientX, bounds.left, 0, pixelsPerSecond)
      onSeek(Math.min(projectDurationSec, nextTimeSec))
    },
    [onSeek, pixelsPerSecond, projectDurationSec],
  )

  const handlePlayheadPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      playheadPointerIdRef.current = event.pointerId
      setDraggingPlayhead(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
      seekFromClientX(event.clientX)
    },
    [seekFromClientX],
  )

  const handlePlayheadPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (playheadPointerIdRef.current !== event.pointerId) return
      event.preventDefault()
      seekFromClientX(event.clientX)
    },
    [seekFromClientX],
  )

  const finishPlayheadDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (playheadPointerIdRef.current !== event.pointerId) return
    playheadPointerIdRef.current = null
    setDraggingPlayhead(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const handleDuplicateClip = useCallback(
    (clip: VideoWorkbenchClip, track: VideoWorkbenchTrack) => {
      const timing = resolveVideoWorkbenchClipTiming(clip)
      const trackEndSec = track.clips.reduce(
        (endSec, candidate) =>
          Math.max(endSec, resolveVideoWorkbenchClipTiming(candidate).timelineEndSec),
        0,
      )
      runCommand({
        type: 'clip/duplicate',
        clipId: clip.id,
        duplicateClipId: createVideoWorkbenchEntityId('clip'),
        timelineStartSec:
          track.kind === 'video' ? trackEndSec : Math.max(timing.timelineEndSec, trackEndSec),
      })
    },
    [runCommand],
  )

  const handleDuplicateSelection = useCallback(() => {
    if (busy || readOnly || selectedClips.length === 0) return
    const duplicateIds: string[] = []
    const items: Array<{ clipId: string; duplicateClipId: string; timelineStartSec: number }> = []
    const selectionsByTrack = new Map<string, typeof selectedClips>()
    for (const selection of selectedClips) {
      const trackSelections = selectionsByTrack.get(selection.track.id) ?? []
      trackSelections.push(selection)
      selectionsByTrack.set(selection.track.id, trackSelections)
    }
    let duplicateOffsetSec = 0
    for (const trackSelections of selectionsByTrack.values()) {
      const sortedSelections = [...trackSelections].sort(
        (left, right) => left.clip.timelineStartSec - right.clip.timelineStartSec,
      )
      const firstSelection = sortedSelections[0]
      if (!firstSelection) continue
      const track = firstSelection.track
      const selectionStartSec = firstSelection.clip.timelineStartSec
      const trackEndSec = track.clips.reduce(
        (endSec, clip) => Math.max(endSec, resolveVideoWorkbenchClipTiming(clip).timelineEndSec),
        0,
      )
      duplicateOffsetSec = Math.max(duplicateOffsetSec, trackEndSec - selectionStartSec)
    }
    for (const selection of selectedClips) {
      const duplicateClipId = createVideoWorkbenchEntityId('clip')
      duplicateIds.push(duplicateClipId)
      items.push({
        clipId: selection.clip.id,
        duplicateClipId,
        timelineStartSec: selection.clip.timelineStartSec + duplicateOffsetSec,
      })
    }
    if (runCommand({ type: 'clip/duplicate-many', items })) {
      onSelectionChange(duplicateIds)
    }
  }, [busy, onSelectionChange, readOnly, runCommand, selectedClips])

  const handleRemoveSelection = useCallback(() => {
    if (busy || readOnly || selectedClipIds.length === 0) return
    if (runCommand({ type: 'clip/remove-many', clipIds: [...selectedClipIds] })) {
      onSelectionChange([])
    }
  }, [busy, onSelectionChange, readOnly, runCommand, selectedClipIds])

  const handleTrackReorder = useCallback(
    (trackId: string, targetOrder: number) => {
      if (busy || readOnly) return
      const boundedOrder = Math.max(0, Math.min(sortedTracks.length - 1, targetOrder))
      runCommand({ type: 'track/reorder', trackId, targetOrder: boundedOrder })
    },
    [busy, readOnly, runCommand, sortedTracks.length],
  )

  const handleSplit = useCallback(() => {
    const found = selectedClips.length === 1 ? selectedClips[0] : null
    if (!found) {
      message.info(
        selectedClips.length > 1 ? '分割操作一次只能选择一个片段' : '请先选择要分割的片段',
      )
      return
    }
    runCommand({
      type: 'clip/split',
      clipId: found.clip.id,
      splitAtSec: playheadSec,
      rightClipId: createVideoWorkbenchEntityId('clip'),
    })
  }, [playheadSec, runCommand, selectedClips])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isEditableTarget(event.target)) return
      const withCommandModifier = event.metaKey || event.ctrlKey
      if (withCommandModifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (busy || readOnly) return
        if (event.shiftKey) onRedo()
        else onUndo()
        return
      }
      if (withCommandModifier && event.key.toLowerCase() === 'd' && selectedClipIds.length > 0) {
        event.preventDefault()
        handleDuplicateSelection()
        return
      }
      if (
        !withCommandModifier &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedClipIds.length > 0
      ) {
        event.preventDefault()
        handleRemoveSelection()
        return
      }
      if (event.key === 'Escape' && selectedClipIds.length > 0) {
        event.preventDefault()
        onSelectionChange([])
      }
    },
    [
      handleDuplicateSelection,
      handleRemoveSelection,
      busy,
      onRedo,
      onSelectionChange,
      onUndo,
      readOnly,
      selectedClipIds.length,
    ],
  )

  useEffect(() => {
    const existingClipIds = new Set(
      project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
    )
    const existingSelection = selectedClipIds.filter((clipId) => existingClipIds.has(clipId))
    if (existingSelection.length !== selectedClipIds.length) onSelectionChange(existingSelection)
  }, [onSelectionChange, project.tracks, selectedClipIds])

  const onlyVideoTrackId =
    sortedTracks.filter((track) => track.kind === 'video').length === 1
      ? sortedTracks.find((track) => track.kind === 'video')?.id
      : undefined

  return (
    <section
      className={`vwb-mt${readOnly ? ' is-readonly' : ''}`}
      aria-label="多轨时间线"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDownCapture={(event) => {
        if (!isEditableTarget(event.target)) event.currentTarget.focus({ preventScroll: true })
      }}
    >
      <div className="vwb-mt-toolbar">
        <div className="vwb-mt-toolbar-group">
          <Button
            size="small"
            type="text"
            icon={<Icons.Undo2 size={13} />}
            disabled={!canUndo || busy || readOnly}
            aria-label="撤销"
            title="撤销"
            onClick={onUndo}
          >
            撤销
          </Button>
          <Button
            size="small"
            type="text"
            icon={<Icons.Redo2 size={13} />}
            disabled={!canRedo || busy || readOnly}
            aria-label="重做"
            title="重做"
            onClick={onRedo}
          >
            重做
          </Button>
          <span className="vwb-mt-toolbar-divider" />
          <Button
            size="small"
            type="text"
            icon={<Icons.Scissors size={13} />}
            disabled={selectedClips.length !== 1 || busy || readOnly}
            aria-label="分割"
            title="分割"
            onClick={handleSplit}
          >
            分割
          </Button>
          <Button
            size="small"
            type="text"
            icon={<Icons.Copy size={13} />}
            disabled={selectedClipIds.length === 0 || busy || readOnly}
            aria-label="复制所选"
            title="复制所选"
            onClick={handleDuplicateSelection}
          >
            复制所选
          </Button>
          <Button
            size="small"
            type="text"
            icon={<Icons.Trash size={13} />}
            disabled={selectedClipIds.length === 0 || busy || readOnly}
            aria-label="删除所选"
            title="删除所选"
            onClick={handleRemoveSelection}
          >
            删除所选
          </Button>
          {selectedClipIds.length > 1 ? (
            <span className="vwb-mt-selection-count">已选 {selectedClipIds.length} 段</span>
          ) : null}
          <Button
            size="small"
            type="text"
            icon={<Icons.Layers size={13} />}
            disabled={busy || readOnly}
            aria-label="添加叠加轨"
            title="添加叠加轨"
            onClick={() =>
              runCommand({
                type: 'track/add',
                track: createVideoWorkbenchTrack(project, 'overlay'),
              })
            }
          >
            叠加轨
          </Button>
          <Button
            size="small"
            type="text"
            icon={<Icons.AudioLines size={13} />}
            disabled={busy || readOnly}
            aria-label="添加音频轨"
            title="添加音频轨"
            onClick={() =>
              runCommand({ type: 'track/add', track: createVideoWorkbenchTrack(project, 'audio') })
            }
          >
            音频轨
          </Button>
        </div>
        <div className="vwb-mt-toolbar-group is-secondary">
          <Button size="small" type="text" onClick={onOpenFrames}>
            关键帧
          </Button>
          <Button size="small" type="text" onClick={onOpenEdit}>
            单项处理
          </Button>
          <Button size="small" type="text" onClick={onOpenOutput}>
            产物
          </Button>
          <span className="vwb-mt-toolbar-divider" />
          <Tooltip title="主视频拖动或删除时自动排序并闭合空隙">
            <label className="vwb-mt-switch">
              <Switch
                size="small"
                aria-label="主视频磁吸"
                checked={project.project.magneticMainTrack}
                disabled={readOnly}
                onChange={(checked) =>
                  onUpdateProject(
                    (current) => ({
                      ...current,
                      project: { ...current.project, magneticMainTrack: checked },
                    }),
                    true,
                  )
                }
              />
              <span className="vwb-mt-switch-label">磁吸主轨</span>
            </label>
          </Tooltip>
          <Tooltip title="拖动时吸附播放头、标记点和片段边界">
            <label className="vwb-mt-switch">
              <Switch
                size="small"
                aria-label="时间线吸附"
                checked={project.ui.snappingEnabled}
                disabled={readOnly}
                onChange={(checked) =>
                  onUpdateProject(
                    (current) => ({
                      ...current,
                      ui: { ...current.ui, snappingEnabled: checked },
                    }),
                    true,
                  )
                }
              />
              <span className="vwb-mt-switch-label">吸附</span>
            </label>
          </Tooltip>
          <input
            type="range"
            min={VIDEO_WORKBENCH_TIMELINE_MIN_PX_PER_SEC}
            max={VIDEO_WORKBENCH_TIMELINE_MAX_PX_PER_SEC}
            step={4}
            value={pixelsPerSecond}
            aria-label="多轨时间线缩放比例"
            disabled={readOnly}
            onChange={(event) => {
              const zoomPxPerSec = Number(event.target.value)
              onUpdateProject((current) => ({
                ...current,
                ui: { ...current.ui, zoomPxPerSec },
              }))
            }}
          />
        </div>
      </div>

      {readOnly ? (
        <div className="vwb-mt-readonly-note">
          该工程来自更高版本，当前仅允许查看，不能覆盖保存。
        </div>
      ) : null}

      <div className="vwb-mt-viewport">
        <div className="vwb-mt-ruler-row">
          <div className="vwb-mt-ruler-head">
            <span>{sortedTracks.length} 条轨道</span>
            <small>{project.resources.length} 个素材</small>
          </div>
          <div
            ref={rulerRef}
            className="vwb-mt-ruler"
            style={{ width: `${timelineWidth}px` }}
            onPointerDown={handlePlayheadPointerDown}
            onPointerMove={handlePlayheadPointerMove}
            onPointerUp={finishPlayheadDrag}
            onPointerCancel={finishPlayheadDrag}
          >
            {ticks.map((tick) => (
              <span
                key={`${tick.second}-${tick.leftPx}`}
                className={tick.major ? 'is-major' : ''}
                style={{ left: `${tick.leftPx}px` }}
              >
                {tick.major ? <small>{formatTimestamp(tick.second)}</small> : null}
              </span>
            ))}
          </div>
        </div>
        {sortedTracks.map((track, trackOrder) => (
          <VideoWorkbenchTrackRow
            key={track.id}
            track={track}
            trackOrder={trackOrder}
            resourcesById={resourcesById}
            pixelsPerSecond={pixelsPerSecond}
            timelineWidth={timelineWidth}
            selectedClipIds={selectedClipIdSet}
            canRemoveTrack={track.id !== onlyVideoTrackId}
            editingDisabled={busy || readOnly}
            onSelectClip={handleSelectionChange}
            onClearSelection={() => onSelectionChange([])}
            onPreviewResource={onPreviewResource}
            onTrackUpdate={handleTrackUpdate}
            onTrackRemove={(trackId) => runCommand({ type: 'track/remove', trackId })}
            onTrackReorder={handleTrackReorder}
            onResourceDrop={handleResourceDrop}
            onDuplicateClip={handleDuplicateClip}
            onRemoveClip={(clipId) => runCommand({ type: 'clip/remove', clipId })}
            onTrimClip={(clipId, edge, sourceTimeSec) =>
              runCommand({ type: 'clip/trim', clipId, edge, sourceTimeSec })
            }
            onClipMoveEnd={handleClipMoveEnd}
            onSeek={onSeek}
          />
        ))}
        {sortedTracks.length === 0 ? (
          <div className="vwb-mt-empty">暂无轨道，请先添加主视频、叠加或音频轨。</div>
        ) : null}
        <div
          className={classNames('vwb-mt-playhead', draggingPlayhead && 'is-dragging')}
          style={{
            left: `calc(var(--vwb-mt-head-width) + ${Math.max(0, playheadSec) * pixelsPerSecond}px)`,
          }}
          role="slider"
          tabIndex={0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={projectDurationSec}
          aria-valuenow={Math.min(projectDurationSec, Math.max(0, playheadSec))}
          aria-valuetext={formatTimestamp(playheadSec)}
          onPointerDown={handlePlayheadPointerDown}
          onPointerMove={handlePlayheadPointerMove}
          onPointerUp={finishPlayheadDrag}
          onPointerCancel={finishPlayheadDrag}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const deltaSec = event.shiftKey ? 1 : 0.1
            onSeek(
              Math.min(
                projectDurationSec,
                Math.max(0, playheadSec + (event.key === 'ArrowLeft' ? -deltaSec : deltaSec)),
              ),
            )
          }}
        >
          <span />
        </div>
      </div>
    </section>
  )
}

function findClip(
  project: VideoWorkbenchProjectV2,
  clipId: string,
): { track: VideoWorkbenchTrack; clip: VideoWorkbenchClip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

function commandRejectMessage(reason: string): string {
  switch (reason) {
    case 'locked-track':
      return '轨道已锁定，先解锁后再编辑'
    case 'overlap':
      return '主视频轨不能重叠，请调整片段位置'
    case 'incompatible-track':
      return '该素材类型不能放入目标轨道'
    case 'invalid-command':
      return '当前操作超出素材范围或不满足最小时长'
    case 'duplicate-id':
      return '编辑对象标识冲突，请重试'
    default:
      return '当前编辑操作无法完成'
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}
