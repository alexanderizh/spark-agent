import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import type { CanvasOperationMediaThumbnailItem } from './canvasOperationOutputThumbnails'
import './CanvasOperationOutputThumbnailSwitcher.less'

type CanvasOperationOutputThumbnailSwitcherProps = {
  items: CanvasOperationMediaThumbnailItem[]
  activeOutputId?: string | undefined
  onSelect: (item: CanvasOperationMediaThumbnailItem) => void
}

export function CanvasOperationOutputThumbnailSwitcher({
  items,
  activeOutputId,
  onSelect,
}: CanvasOperationOutputThumbnailSwitcherProps) {
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set())
  const [scrollState, setScrollState] = useState({
    overflowing: false,
    canScrollPrevious: false,
    canScrollNext: false,
  })

  const updateScrollState = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth)
    const next = {
      overflowing: maxScrollLeft > 1,
      canScrollPrevious: track.scrollLeft > 1,
      canScrollNext: track.scrollLeft < maxScrollLeft - 1,
    }
    setScrollState((current) =>
      current.overflowing === next.overflowing &&
      current.canScrollPrevious === next.canScrollPrevious &&
      current.canScrollNext === next.canScrollNext
        ? current
        : next,
    )
  }, [])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeOutputId, items])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const frame = requestAnimationFrame(updateScrollState)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState)
    observer?.observe(track)
    window.addEventListener('resize', updateScrollState)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', updateScrollState)
    }
  }, [items, updateScrollState])

  if (items.length < 2) return null

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.currentTarget.scrollLeft += event.deltaY
    event.preventDefault()
    event.stopPropagation()
  }

  const scrollTrack = (direction: -1 | 1) => {
    const track = trackRef.current
    if (!track) return
    const distance = Math.max(68, Math.round(track.clientWidth * 0.8))
    track.scrollBy({ left: direction * distance, behavior: 'smooth' })
  }

  return (
    <div
      className="canvas-operation-output-thumbnail-switcher nodrag nopan nowheel"
      aria-label="历史媒体产物"
    >
      {scrollState.overflowing ? (
        <button
          type="button"
          className="canvas-operation-output-thumbnail-scroll is-previous"
          aria-label="向左滚动产物"
          disabled={!scrollState.canScrollPrevious}
          onClick={(event) => {
            event.stopPropagation()
            scrollTrack(-1)
          }}
        >
          <Icons.ChevronLeft size={15} />
        </button>
      ) : null}
      <div
        ref={trackRef}
        className="canvas-operation-output-thumbnail-track"
        onScroll={updateScrollState}
        onWheel={handleWheel}
      >
        {items.map((item) => {
          const active = item.output.id === activeOutputId
          const failed = failedKeys.has(item.key)
          const previewUrl = normalizeEduAssetUrl(item.previewUrl)
          return (
            <button
              key={item.key}
              ref={active ? activeItemRef : undefined}
              type="button"
              className={active ? 'is-active' : ''}
              data-output-thumbnail-id={item.output.id}
              aria-current={active ? 'true' : undefined}
              aria-label={`查看产物：${item.output.title}`}
              title={item.output.title}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(item)
              }}
            >
              {failed ? (
                <span
                  className="canvas-operation-output-thumbnail-placeholder"
                  data-media-placeholder={item.output.type}
                  aria-hidden="true"
                >
                  {item.output.type === 'video' ? <Icons.Play size={18} /> : <Icons.Image size={18} />}
                </span>
              ) : item.previewKind === 'video' ? (
                <video
                  src={previewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  onError={() =>
                    setFailedKeys((current) => new Set(current).add(item.key))
                  }
                />
              ) : (
                <img
                  src={previewUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() =>
                    setFailedKeys((current) => new Set(current).add(item.key))
                  }
                />
              )}
            </button>
          )
        })}
      </div>
      {scrollState.overflowing ? (
        <button
          type="button"
          className="canvas-operation-output-thumbnail-scroll is-next"
          aria-label="向右滚动产物"
          disabled={!scrollState.canScrollNext}
          onClick={(event) => {
            event.stopPropagation()
            scrollTrack(1)
          }}
        >
          <Icons.ChevronRight size={15} />
        </button>
      ) : null}
    </div>
  )
}
