/**
 * VideoWorkbenchTrackTimeline — 视频工作台主时间线（多段拼接）。
 *
 * 与单视频剪辑用的 VideoTimeline 不同：这里没有播放头 / 入出点 / 缩放，
 * 只承担「多段 TrackClip 的排序与组合」职责，UI 类似 Final Cut 的「片段 strip」。
 *
 * 交互：
 *  - 水平排列所有 TrackClip（按 order 升序）
 *  - clip 可拖拽重排（HTML5 drag-and-drop，dataTransfer 携带 clipId）
 *  - 接受来自 ResourcePanel 的拖入（resourceId），把资源追加成新 clip
 *  - clip 上的"+"预览、"×"删除 handle
 *  - 顶部 head 显示总时长 + 导出整条 + 清空
 */
import { memo, useCallback, useMemo, useState } from 'react'
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

const DRAG_MIME = 'application/x-vwb-resource'
const DRAG_CLIP_MIME = 'application/x-vwb-track-clip'

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

  // 单一 dispatch handler：所有 clip 共享同一函数引用，clipId 从 dataset 读
  const onClipDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
    const clipId = e.currentTarget.dataset.clipId
    if (!clipId) return
    e.dataTransfer.setData(DRAG_CLIP_MIME, clipId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingClipId(clipId)
  }

  const onClipDragEnd = () => {
    setDraggingClipId(null)
    setDropTarget(null)
  }

  const onClipDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
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
    if (!dropTarget || dropTarget.clipId !== clipId || dropTarget.side !== side) {
      setDropTarget({ clipId, side })
    }
  }

  const onClipDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const targetClipId = e.currentTarget.dataset.clipId
    if (!targetClipId) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const side: 'before' | 'after' = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after'
    const clipPayload = e.dataTransfer.getData(DRAG_CLIP_MIME)
    const resourcePayload = e.dataTransfer.getData(DRAG_MIME)
    if (clipPayload) {
      // 移动到目标 clip 的 before/after 位置
      const fromId = clipPayload
      if (fromId === targetClipId) {
        setDropTarget(null)
        return
      }
      onReorder(moveClipRelativeTo(sortedTrack, fromId, targetClipId, side))
    } else if (resourcePayload) {
      const payload = safeParse<ResourceDragPayload>(resourcePayload)
      if (payload) {
        const resource = resourcesById.get(payload.resourceId)
        if (resource) {
          // 资源拖入：side=after → 插到 target 之后；side=before → 插到 target 之前
          // 实现：after 时把 insertAfterClipId 设为 target；before 时设为 target 的前一个 clip，
          // 没有前一个就传 null（追加到开头）。父级 handler 负责 reorder 收尾。
          if (side === 'after') {
            onAddResourceToTrack(resource, targetClipId)
          } else {
            const targetIndex = sortedTrack.findIndex((c) => c.id === targetClipId)
            const beforeClip = targetIndex > 0 ? sortedTrack[targetIndex - 1] : undefined
            onAddResourceToTrack(resource, beforeClip ? beforeClip.id : null)
          }
        }
      }
    }
    setDropTarget(null)
  }

  const previewResource = useCallback(
    (resource: WorkbenchResource) => onPreviewResource(resource),
    [onPreviewResource],
  )
  const removeClip = useCallback((id: string) => onRemoveClip(id), [onRemoveClip])
  // These handlers intentionally follow the current render. onClipDrop reads
  // the latest track/resources; freezing the object would retain the empty
  // first-render closure and make later drag/drop operations no-op.
  const clipCardHandlers: ClipCardHandlers = {
    onClipDragStart,
    onClipDragEnd,
    onClipDragOver,
    onClipDrop,
  }

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
        <span className="vwb-track-label">主时间线 V1</span>
        <span className="vwb-track-meta">
          {sortedTrack.length} 段 · 总时长 {formatTimestamp(totalDuration)}
        </span>
        <div className="vwb-track-spacer" />
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
        className={`vwb-track-strip${stripHover ? ' is-drop' : ''}`}
        onDragOver={onStripDragOver}
        onDragLeave={() => setStripHover(false)}
        onDrop={onStripDrop}
      >
        {sortedTrack.length === 0 ? (
          <div className="vwb-track-empty">
            <Icons.Layers size={22} />
            <div>把资源面板里的视频 / 图片拖到此处，或点击「+」加入轨道。</div>
            <div className="muted">图片资源会以 8s 静帧视频形式接入。</div>
          </div>
        ) : (
          sortedTrack.map((clip) => {
            const resource = resourcesById.get(clip.resourceId)
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
                dragging={isDragging}
                dropClass={dropClass}
                handlers={clipCardHandlers}
                onPreview={() => resource && previewResource(resource)}
                onRemove={() => removeClip(clip.id)}
              />
            )
          })
        )}
      </div>

      <div className="vwb-track-hint">
        按住 ⠿ 拖拽片段可重排顺序 · 双击片段可独立预览 · 点击「×」从轨道移除
      </div>
    </div>
  )
}

interface ClipCardProps {
  clip: TrackClip
  resource: WorkbenchResource | undefined
  dragging: boolean
  dropClass: string
  handlers: ClipCardHandlers
  onPreview: () => void
  onRemove: () => void
}

const ClipCard = memo(function ClipCard({
  clip,
  resource,
  dragging,
  dropClass,
  handlers,
  onPreview,
  onRemove,
}: ClipCardProps): ReactElement {
  const duration = clipDurationSec(clip, resource)
  const isImage = resource?.kind === 'image'
  const previewUrl = resource?.thumbnailUrl || resource?.url

  return (
    <div
      className={`vwb-track-clip${dragging ? ' dragging' : ''}${dropClass}${!resource ? ' missing' : ''}`}
      draggable
      data-clip-id={clip.id}
      onDragStart={handlers.onClipDragStart}
      onDragEnd={handlers.onClipDragEnd}
      onDragOver={handlers.onClipDragOver}
      onDrop={handlers.onClipDrop}
      onDoubleClick={onPreview}
      title={resource?.title ?? '资源已丢失'}
    >
      <div
        className={`vwb-track-clip-thumb${previewUrl ? '' : ' no-preview'}`}
        style={previewUrl ? { backgroundImage: `url(${previewUrl})` } : undefined}
      >
        {!previewUrl && <Icons.Film size={16} />}
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
              onPreview()
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
              onRemove()
            }}
          >
            <Icons.X size={12} />
          </button>
        </Tooltip>
      </div>
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
