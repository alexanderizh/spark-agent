import { useCallback, useRef, useState } from 'react'
import type { PointerEvent, ReactElement } from 'react'
import { Icons } from '../../../Icons'
import {
  cropRectFromPoints,
  isVideoCropPixelsWithinBounds,
  moveVideoCropRect,
  normalizeVideoCropRect,
  resizeVideoCropRect,
  videoCropRectToPixels,
  type VideoCropHandle,
  type VideoCropRect,
} from './videoCropModel'

interface CropMediaBounds {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  bounds: CropMediaBounds
  rect: VideoCropRect
  sourceWidth: number
  sourceHeight: number
  busy: boolean
  onConfirm: (rect: VideoCropRect) => void
  onCancel: () => void
}

type Point = { x: number; y: number }
type Interaction =
  | { type: 'draw'; pointerId: number; start: Point }
  | { type: 'move'; pointerId: number; start: Point; rect: VideoCropRect }
  | {
      type: 'resize'
      pointerId: number
      start: Point
      rect: VideoCropRect
      handle: VideoCropHandle
    }

const HANDLES: VideoCropHandle[] = ['nw', 'ne', 'sw', 'se']

export function VideoCropOverlay({
  bounds,
  rect,
  sourceWidth,
  sourceHeight,
  busy,
  onConfirm,
  onCancel,
}: Props): ReactElement {
  const layerRef = useRef<HTMLDivElement>(null)
  const [draftRect, setDraftRect] = useState(() => normalizeVideoCropRect(rect))
  const interactionRef = useRef<Interaction | null>(null)

  const getPoint = useCallback((event: PointerEvent<HTMLDivElement>): Point | null => {
    const layer = layerRef.current
    if (!layer) return null
    const layerBounds = layer.getBoundingClientRect()
    if (layerBounds.width <= 0 || layerBounds.height <= 0) return null
    return {
      x: Math.min(1, Math.max(0, (event.clientX - layerBounds.left) / layerBounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - layerBounds.top) / layerBounds.height)),
    }
  }, [])

  const startInteraction = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (busy) return
      const point = getPoint(event)
      if (!point) return
      const target = event.target as HTMLElement
      const handle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as
        | VideoCropHandle
        | undefined
      const box = target.closest('[data-crop-box]')
      const interaction: Interaction = handle
        ? { type: 'resize', pointerId: event.pointerId, start: point, rect: draftRect, handle }
        : box
          ? { type: 'move', pointerId: event.pointerId, start: point, rect: draftRect }
          : { type: 'draw', pointerId: event.pointerId, start: point }
      interactionRef.current = interaction
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [busy, draftRect, getPoint],
  )

  const updateInteraction = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const interaction = interactionRef.current
      if (!interaction || busy) return
      const point = getPoint(event)
      if (!point) return
      const delta = { x: point.x - interaction.start.x, y: point.y - interaction.start.y }
      if (interaction.type === 'draw') {
        setDraftRect(cropRectFromPoints(interaction.start, point))
      } else if (interaction.type === 'move') {
        setDraftRect(moveVideoCropRect(interaction.rect, delta))
      } else {
        setDraftRect(resizeVideoCropRect(interaction.rect, interaction.handle, delta))
      }
      event.preventDefault()
    },
    [busy, getPoint],
  )

  const finishInteraction = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (!interaction) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    interactionRef.current = null
  }, [])

  const cropPixels =
    sourceWidth >= 2 && sourceHeight >= 2
      ? videoCropRectToPixels(draftRect, sourceWidth, sourceHeight)
      : null
  const cropSizeLabel =
    cropPixels != null && isVideoCropPixelsWithinBounds(cropPixels, sourceWidth, sourceHeight)
      ? `${cropPixels.w} × ${cropPixels.h} px`
      : '读取尺寸…'

  return (
    <div
      ref={layerRef}
      className="vwb-crop-overlay"
      style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
      onPointerDown={startInteraction}
      onPointerMove={updateInteraction}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      role="application"
      aria-label="视频裁剪框"
    >
      <div
        className="vwb-crop-box"
        data-crop-box
        style={{
          left: `${draftRect.x * 100}%`,
          top: `${draftRect.y * 100}%`,
          width: `${draftRect.width * 100}%`,
          height: `${draftRect.height * 100}%`,
        }}
      >
        <div className="vwb-crop-grid-lines" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="vwb-crop-size">{cropSizeLabel}</span>
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className={`vwb-crop-handle ${handle}`}
            data-crop-handle={handle}
            aria-label={`调整${handle}角`}
          />
        ))}
      </div>

      <div
        className="vwb-crop-toolbar"
        onPointerDown={(event) => event.stopPropagation()}
        role="toolbar"
        aria-label="裁剪操作"
      >
        <span>
          <Icons.Crop size={14} /> 拖动边角调整选区
        </span>
        <button type="button" className="vwb-crop-cancel" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="vwb-crop-confirm"
          onClick={() => onConfirm(draftRect)}
          disabled={busy}
        >
          <Icons.Check size={13} /> 确认裁剪
        </button>
      </div>
    </div>
  )
}
