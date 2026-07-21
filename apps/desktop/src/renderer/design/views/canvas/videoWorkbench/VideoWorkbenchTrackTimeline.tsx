/**
 * VideoWorkbenchTrackTimeline — 视频工作台主时间线（多段拼接）。
 *
 * 工作台唯一编辑时间线：组合播放标尺、按时长展示的片段带、排序、切分与时长调整。
 *
 * 交互：
 *  - 按真实时长比例水平排列所有 TrackClip（按 order 升序）
 *  - clip 可拖拽重排（HTML5 drag-and-drop，dataTransfer 携带 clipId）
 *  - 接受来自 ResourcePanel 的拖入（resourceId），把资源追加成新 clip
 *  - clip 上的"+"预览、"×"删除 handle
 *  - 顶部 head 显示总时长 + 导出整条 + 清空
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
import { Button, Tooltip } from 'antd'
import { Icons } from '../../../Icons'
import { formatTimestamp, type TrackClip, type WorkbenchResource } from './videoWorkbench.types'
import {
  calculateTrackDuration,
  clipDurationSec,
  indexResourcesById,
  moveClipRelativeTo,
  reorderTrack,
} from './resourcePanelUtils'
import type { ResourceDragPayload } from './VideoWorkbenchResourcePanel'
import { ResourceThumb } from './VideoWorkbenchResourceThumb'
import {
  buildTimelineTicks,
  timelineClientXToSecond,
  timelineClipWidth,
} from './videoWorkbenchTimelineScale'

const DRAG_MIME = 'application/x-vwb-resource'
const DRAG_CLIP_MIME = 'application/x-vwb-track-clip'

/** 播放状态（由 useVideoWorkbenchPlayback 提供，透传给播放进度条） */
export interface TrackPlaybackState {
  active: boolean
  playing: boolean
  currentClipId: string | null
  globalTimeSec: number
  totalDurationSec: number
}

interface Props {
  track: TrackClip[]
  resources: WorkbenchResource[]
  busy: boolean
  /** clip 从 fromId 移动到 toId 之后（按 UI 上的相邻语义） */
  onReorder: (nextTrack: TrackClip[]) => void
  onRemoveClip: (clipId: string) => void
  onPreviewResource: (resource: WorkbenchResource) => void
  /**
   * 资源面板拖入或"+"按钮 → 调父级把资源加入轨道。
   * - 不传 insertAfterClipId: 追加到末尾
   * - 传 insertAfterClipId: 插入到该 clip 之后（用于指定拖入位置）
   */
  onAddResourceToTrack: (resource: WorkbenchResource, insertAfterClipId?: string | null) => void
  onExportWhole: () => void
  onClearTrack: () => void
  onOpenFrames: () => void
  onOpenEdit: () => void
  onOpenOutput: () => void
  onSplitAtPlayhead: () => void
  onDurationChange: (clipId: string, durationSec: number) => void
  /** 连播状态（播放进度条用） */
  playback: TrackPlaybackState
  onPlaybackSeek: (sec: number) => void
  onPlaybackToggle: () => void
}

/**
 * ClipCard 接收的所有事件 handler 在父级一次性创建，引用稳定。
 * clipId 通过 data-clip-id 传，子组件从 dataset 读，避免每个 clip 重建箭头函数。
 */
interface ClipCardHandlers {
  onClipDragStart: (e: ReactDragEvent<HTMLDivElement>) => void
  onClipDragEnd: () => void
  onClipDragOver: (e: ReactDragEvent<HTMLDivElement>) => void
  onClipDrop: (e: ReactDragEvent<HTMLDivElement>) => void
}

export function VideoWorkbenchTrackTimeline({
  track,
  resources,
  busy,
  onReorder,
  onRemoveClip,
  onPreviewResource,
  onAddResourceToTrack,
  onExportWhole,
  onClearTrack,
  onOpenFrames,
  onOpenEdit,
  onOpenOutput,
  onSplitAtPlayhead,
  onDurationChange,
  playback,
  onPlaybackSeek,
  onPlaybackToggle,
}: Props): ReactElement {
  const resourcesById = useMemo(() => indexResourcesById(resources), [resources])
  const totalDuration = useMemo(
    () => calculateTrackDuration(track, resourcesById),
    [track, resourcesById],
  )
  const sortedTrack = useMemo(() => track.slice().sort((a, b) => a.order - b.order), [track])

  const [draggingClipId, setDraggingClipId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ clipId: string; side: 'before' | 'after' } | null>(
    null,
  )
  const [stripHover, setStripHover] = useState(false)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40)
  const timelineContentRef = useRef<HTMLDivElement>(null)
  const timelineWidth = Math.max(640, totalDuration * pixelsPerSecond)
  const ticks = useMemo(
    () => buildTimelineTicks(totalDuration, pixelsPerSecond),
    [pixelsPerSecond, totalDuration],
  )

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const content = timelineContentRef.current
      if (!content) return
      onPlaybackSeek(
        timelineClientXToSecond(
          clientX,
          content.getBoundingClientRect().left,
          pixelsPerSecond,
          totalDuration,
        ),
      )
    },
    [onPlaybackSeek, pixelsPerSecond, totalDuration],
  )

  // 最新状态 ref：让拖拽 handler 引用稳定（useCallback 空依赖），又能读到最新状态。
  const stateRef = useRef({ sortedTrack, resourcesById, dropTarget })
  useEffect(() => {
    stateRef.current = { sortedTrack, resourcesById, dropTarget }
  }, [dropTarget, resourcesById, sortedTrack])

  // 所有 clip 共享同一函数引用（useCallback），clipId 从 dataset 读；
  // 配合 ClipCard 的 memo，拖拽时只有 dragging/dropClass 变化的 clip 重渲染。
  const onClipDragStart = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const clipId = e.currentTarget.dataset.clipId
    if (!clipId) return
    e.dataTransfer.setData(DRAG_CLIP_MIME, clipId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingClipId(clipId)
  }, [])

  const onClipDragEnd = useCallback(() => {
    setDraggingClipId(null)
    setDropTarget(null)
  }, [])

  const onClipDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const clipId = e.currentTarget.dataset.clipId
    if (!clipId) return
    // 只有 clip 重排或资源拖入两种情况才接受
    const hasClip = e.dataTransfer.types.includes(DRAG_CLIP_MIME)
    const hasResource = e.dataTransfer.types.includes(DRAG_MIME)
    if (!hasClip && !hasResource) return
    e.preventDefault()
    e.dataTransfer.dropEffect = hasClip ? 'move' : 'copy'
    const rect = e.currentTarget.getBoundingClientRect()
    const side: 'before' | 'after' = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    const prev = stateRef.current.dropTarget
    if (!prev || prev.clipId !== clipId || prev.side !== side) {
      setDropTarget({ clipId, side })
    }
  }, [])

  const onClipDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      const targetClipId = e.currentTarget.dataset.clipId
      if (!targetClipId) return
      e.preventDefault()
      e.stopPropagation()
      const { sortedTrack: st, resourcesById: rb } = stateRef.current
      const rect = e.currentTarget.getBoundingClientRect()
      const side: 'before' | 'after' = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
      const clipPayload = e.dataTransfer.getData(DRAG_CLIP_MIME)
      const resourcePayload = e.dataTransfer.getData(DRAG_MIME)
      if (clipPayload) {
        // 移动到目标 clip 的 before/after 位置
        if (clipPayload === targetClipId) {
          setDropTarget(null)
          return
        }
        onReorder(moveClipRelativeTo(st, clipPayload, targetClipId, side))
      } else if (resourcePayload) {
        const payload = safeParse<ResourceDragPayload>(resourcePayload)
        if (payload) {
          const resource = rb.get(payload.resourceId)
          if (resource) {
            // side=after → 插到 target 之后；side=before → 插到 target 之前。
            // before 时取 target 的前一个 clip；没有前一个就传 null（插到开头）。
            if (side === 'after') {
              onAddResourceToTrack(resource, targetClipId)
            } else {
              const targetIndex = st.findIndex((c) => c.id === targetClipId)
              const beforeClip = targetIndex > 0 ? st[targetIndex - 1] : undefined
              onAddResourceToTrack(resource, beforeClip ? beforeClip.id : null)
            }
          }
        }
      }
      setDropTarget(null)
    },
    [onReorder, onAddResourceToTrack],
  )

  const previewResource = useCallback(
    (resource: WorkbenchResource) => onPreviewResource(resource),
    [onPreviewResource],
  )
  const removeClip = useCallback((id: string) => onRemoveClip(id), [onRemoveClip])
  const clipCardHandlers = useMemo<ClipCardHandlers>(
    () => ({ onClipDragStart, onClipDragEnd, onClipDragOver, onClipDrop }),
    [onClipDragStart, onClipDragEnd, onClipDragOver, onClipDrop],
  )

  const onStripDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    const hasResource = e.dataTransfer.types.includes(DRAG_MIME)
    const hasClip = e.dataTransfer.types.includes(DRAG_CLIP_MIME)
    if (!hasResource && !hasClip) return
    e.preventDefault()
    e.dataTransfer.dropEffect = hasClip ? 'move' : 'copy'
    if (!stripHover) setStripHover(true)
  }

  const onStripDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(DRAG_CLIP_MIME)) {
      // clip 拖到空白处 = 移到末尾
      e.preventDefault()
      const clipPayload = e.dataTransfer.getData(DRAG_CLIP_MIME)
      if (!clipPayload) return
      const fromId = clipPayload
      const last = sortedTrack[sortedTrack.length - 1]
      if (!last || last.id === fromId) return
      onReorder(reorderTrack(sortedTrack, fromId, last.id))
      setStripHover(false)
      return
    }
    const hasResource = e.dataTransfer.types.includes(DRAG_MIME)
    if (!hasResource) return
    e.preventDefault()
    const payload = safeParse<ResourceDragPayload>(e.dataTransfer.getData(DRAG_MIME))
    if (!payload) return
    const resource = resourcesById.get(payload.resourceId)
    if (resource) onAddResourceToTrack(resource, null)
    setStripHover(false)
  }

  return (
    <div className="vwb-track">
      <div className="vwb-track-head">
        <button
          type="button"
          className={`vwb-track-play${playback.playing ? ' is-playing' : ''}`}
          onClick={onPlaybackToggle}
          disabled={sortedTrack.length === 0}
          aria-label={playback.playing ? '暂停' : '播放整条'}
        >
          {playback.playing ? <Icons.Pause size={14} /> : <Icons.Play size={14} />}
        </button>
        <span className="vwb-track-clock">
          {formatTimestamp(playback.globalTimeSec)} / {formatTimestamp(totalDuration)}
        </span>
        <span className="vwb-track-label">主轨道</span>
        <span className="vwb-track-meta">
          {sortedTrack.length} 段 · 总时长 {formatTimestamp(totalDuration)}
        </span>
        <div className="vwb-track-spacer" />
        <div className="vwb-track-tools" aria-label="轨道工具">
          <Tooltip title="在播放头处分割当前片段">
            <button type="button" onClick={onSplitAtPlayhead} disabled={sortedTrack.length === 0}>
              <Icons.Scissors size={13} /><span>分割</span>
            </button>
          </Tooltip>
          <Tooltip title="提取或管理关键帧">
            <button type="button" onClick={onOpenFrames}>
              <Icons.Image size={13} /><span>关键帧</span>
            </button>
          </Tooltip>
          <Tooltip title="裁剪、转码与高级设置">
            <button type="button" onClick={onOpenEdit}>
              <Icons.Sliders size={13} /><span>剪辑设置</span>
            </button>
          </Tooltip>
          <Tooltip title="查看与导出产物">
            <button type="button" onClick={onOpenOutput}>
              <Icons.Download size={13} /><span>产物</span>
            </button>
          </Tooltip>
        </div>
        <div className="vwb-track-zoom" aria-label="时间轴缩放">
          <button
            type="button"
            onClick={() => setPixelsPerSecond((value) => Math.max(8, value / 1.5))}
            aria-label="缩小时间轴"
          >
            <Icons.Minus size={12} />
          </button>
          <input
            type="range"
            min={8}
            max={160}
            step={4}
            value={pixelsPerSecond}
            onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
            aria-label="时间轴缩放比例"
          />
          <button
            type="button"
            onClick={() => setPixelsPerSecond((value) => Math.min(160, value * 1.5))}
            aria-label="放大时间轴"
          >
            <Icons.Plus size={12} />
          </button>
        </div>
        <div className="vwb-track-actions">
          <Button
            size="small"
            type="primary"
            icon={<Icons.Download size={13} />}
            onClick={onExportWhole}
            disabled={busy || sortedTrack.length === 0}
          >
            导出整条
          </Button>
          <Button
            size="small"
            type="text"
            danger
            icon={<Icons.Trash size={12} />}
            onClick={onClearTrack}
            disabled={busy || sortedTrack.length === 0}
          >
            清空轨道
          </Button>
        </div>
      </div>

      <div
        className={`vwb-timeline-viewport${stripHover ? ' is-drop' : ''}`}
      >
        <div
          ref={timelineContentRef}
          className="vwb-timeline-content"
          style={{ width: `${timelineWidth}px` }}
        >
          <div
            className="vwb-timeline-ruler"
            onPointerDown={(event) => seekFromClientX(event.clientX)}
          >
            {ticks.map((tick) => (
              <span
                key={`${tick.second}-${tick.leftPx}`}
                className={`vwb-timeline-tick${tick.major ? ' is-major' : ''}`}
                style={{ left: `${tick.leftPx}px` }}
              >
                {tick.major ? <small>{formatRulerTimestamp(tick.second)}</small> : null}
              </span>
            ))}
          </div>
          <div
            className="vwb-track-strip"
            onDragOver={onStripDragOver}
            onDragLeave={() => setStripHover(false)}
            onDrop={onStripDrop}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement
              if (target.closest('button')) return
              seekFromClientX(event.clientX)
            }}
          >
            {sortedTrack.length === 0 ? (
              <div className="vwb-track-empty">
                <Icons.Layers size={22} />
                <div>把右侧图片或视频拖到这里开始剪辑</div>
                <div className="muted">所有片段、标尺和播放头共享同一时间坐标</div>
              </div>
            ) : (
              sortedTrack.map((clip) => {
                const resource = resourcesById.get(clip.resourceId)
                const duration = clipDurationSec(clip, resource)
                const isDragging = draggingClipId === clip.id
                const dropClass =
                  dropTarget && dropTarget.clipId === clip.id
                    ? dropTarget.side === 'before'
                      ? ' drop-target-before'
                      : ' drop-target-after'
                    : ''
                return (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    resource={resource}
                    duration={duration}
                    pixelsPerSecond={pixelsPerSecond}
                    dragging={isDragging}
                    active={playback.currentClipId === clip.id}
                    dropClass={dropClass}
                    handlers={clipCardHandlers}
                    onPreviewResource={previewResource}
                    onRemoveClip={removeClip}
                    onDurationChange={onDurationChange}
                  />
                )
              })
            )}
          </div>
          {totalDuration > 0 ? (
            <button
              type="button"
              className="vwb-track-playhead-line"
              style={{ left: `${playback.globalTimeSec * pixelsPerSecond}px` }}
              aria-label={`播放头 ${formatTimestamp(playback.globalTimeSec)}`}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                seekFromClientX(event.clientX)
                const move = (moveEvent: PointerEvent) => seekFromClientX(moveEvent.clientX)
                const end = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', end)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', end, { once: true })
              }}
            >
              <span />
            </button>
          ) : null}
        </div>
      </div>

      <div className="vwb-track-hint">
        拖拽片段排序 · 拖动片段右边缘调整时长 · 双击预览 · 播放头定位后可分割
      </div>
    </div>
  )
}

interface ClipCardProps {
  clip: TrackClip
  resource: WorkbenchResource | undefined
  duration: number
  pixelsPerSecond: number
  dragging: boolean
  active: boolean
  dropClass: string
  handlers: ClipCardHandlers
  onPreviewResource: (resource: WorkbenchResource) => void
  onRemoveClip: (clipId: string) => void
  onDurationChange: (clipId: string, durationSec: number) => void
}

const ClipCard = memo(function ClipCard({
  clip,
  resource,
  duration,
  pixelsPerSecond,
  dragging,
  active,
  dropClass,
  handlers,
  onPreviewResource,
  onRemoveClip,
  onDurationChange,
}: ClipCardProps): ReactElement {
  const isImage = resource?.kind === 'image'
  const width = timelineClipWidth(duration, pixelsPerSecond)
  const frameCount = Math.max(1, Math.min(6, Math.ceil(width / 96)))

  return (
    <div
      className={`vwb-track-clip${dragging ? ' dragging' : ''}${active ? ' is-current' : ''}${dropClass}${!resource ? ' missing' : ''}`}
      draggable
      data-clip-id={clip.id}
      onDragStart={handlers.onClipDragStart}
      onDragEnd={handlers.onClipDragEnd}
      onDragOver={handlers.onClipDragOver}
      onDrop={handlers.onClipDrop}
      onDoubleClick={() => {
        if (resource) onPreviewResource(resource)
      }}
      title={resource?.title ?? '资源已丢失'}
      style={{ width: `${width}px`, flexBasis: `${width}px` }}
    >
      <div className="vwb-track-clip-thumb">
        {Array.from({ length: frameCount }, (_, index) => (index + 0.5) / frameCount).map((ratio) => {
          let frameResource = resource
          if (resource?.kind === 'video' && resource.url) {
            const { thumbnailUrl: _thumbnailUrl, ...withoutThumbnail } = resource
            frameResource = {
              ...withoutThumbnail,
              url: `${resource.url.split('#')[0]}#t=${Math.max(0.1, duration * ratio).toFixed(2)}`,
            }
          }
          return (
            <span className="vwb-track-clip-frame" key={ratio}>
              <ResourceThumb resource={frameResource} fallbackSize={16} />
            </span>
          )
        })}
      </div>
      <div className="vwb-track-clip-info">
        <div className="vwb-track-clip-name">
          {resource?.title ?? `已丢失 · ${clip.resourceId.slice(0, 8)}`}
        </div>
        <div className="vwb-track-clip-meta">
          <span>{isImage ? '🖼' : '🎬'}</span>
          <span>{formatTimestamp(duration)}</span>
        </div>
      </div>
      <div className="vwb-track-clip-source">
        {resource?.source === 'upstream'
          ? '上游节点'
          : resource?.source === 'canvas'
            ? '画布'
            : resource?.source === 'local'
              ? '本机'
              : '—'}
      </div>
      <div className="vwb-track-clip-handle">
        <Tooltip title="预览">
          <button
            type="button"
            aria-label="预览片段"
            onClick={(e) => {
              e.stopPropagation()
              if (resource) onPreviewResource(resource)
            }}
          >
            <Icons.Eye size={12} />
          </button>
        </Tooltip>
        <Tooltip title="从轨道移除">
          <button
            type="button"
            aria-label="移除片段"
            onClick={(e) => {
              e.stopPropagation()
              onRemoveClip(clip.id)
            }}
          >
            <Icons.X size={12} />
          </button>
        </Tooltip>
      </div>
      <button
        type="button"
        className="vwb-track-clip-resize"
        aria-label="调整片段时长"
        title="拖动调整片段时长"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const startX = event.clientX
          const startDuration = duration
          const move = (moveEvent: PointerEvent) => {
            onDurationChange(
              clip.id,
              Math.max(0.1, startDuration + (moveEvent.clientX - startX) / pixelsPerSecond),
            )
          }
          const end = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', end)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', end, { once: true })
        }}
      />
    </div>
  )
})

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function formatRulerTimestamp(second: number): string {
  if (second < 60 && Math.abs(second - Math.round(second)) > 0.001) {
    return `${second.toFixed(second < 10 ? 2 : 1)}s`
  }
  return formatTimestamp(second)
}
