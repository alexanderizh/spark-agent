import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import {
  calculateOverlayScrollbarMetrics,
  EMPTY_CHAT_OVERLAY_SCROLL_METRICS,
  type ChatOverlayScrollMetrics,
} from './chat-overlay-scrollbar-metrics'

export function ChatOverlayScrollbar({
  scrollRef,
  controlsId,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  controlsId: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<ChatOverlayScrollMetrics>(
    EMPTY_CHAT_OVERLAY_SCROLL_METRICS,
  )
  const [dragging, setDragging] = useState(false)
  const dragStartYRef = useRef(0)
  const dragStartScrollTopRef = useRef(0)
  const dragMaxScrollTopRef = useRef(0)
  const dragTravelRef = useRef(1)

  const updateMetrics = useCallback(() => {
    const element = scrollRef.current
    const track = trackRef.current
    if (!element || !track) return
    setMetrics(
      calculateOverlayScrollbarMetrics({
        viewportHeight: element.clientHeight,
        contentHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        trackHeight: track.clientHeight,
      }),
    )
  }, [scrollRef])

  useLayoutEffect(() => {
    updateMetrics()
  }, [updateMetrics])

  useEffect(() => {
    const element = scrollRef.current
    const track = trackRef.current
    if (!element || !track) return

    let frame = 0
    const scheduleUpdate = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        updateMetrics()
      })
    }

    element.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null
    resizeObserver?.observe(element)
    resizeObserver?.observe(track)
    const content = element.firstElementChild
    if (content instanceof HTMLElement) resizeObserver?.observe(content)

    const mutationObserver =
      typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleUpdate) : null
    mutationObserver?.observe(element, { childList: true, subtree: true, characterData: true })

    return () => {
      element.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [scrollRef, updateMetrics])

  useEffect(() => {
    if (!dragging) return

    const handlePointerMove = (event: PointerEvent) => {
      const element = scrollRef.current
      const track = trackRef.current
      if (!element || !track) return

      event.preventDefault()
      const delta = event.clientY - dragStartYRef.current
      const nextTop = Math.max(
        0,
        Math.min(
          dragTravelRef.current,
          (dragStartScrollTopRef.current / Math.max(1, dragMaxScrollTopRef.current)) *
            dragTravelRef.current +
            delta,
        ),
      )
      element.scrollTop = (nextTop / dragTravelRef.current) * dragMaxScrollTopRef.current
    }

    const stopDragging = () => {
      setDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging, { once: true })
    window.addEventListener('pointercancel', stopDragging, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [dragging, scrollRef])

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.chat-overlay-scrollbar-thumb')) return
    const element = scrollRef.current
    const track = trackRef.current
    if (!element || !track || !metrics.visible) return

    const rect = track.getBoundingClientRect()
    const travel = Math.max(1, rect.height - metrics.thumbHeight)
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top - metrics.thumbHeight / 2) / travel),
    )
    element.scrollTop = ratio * metrics.maxScrollTop
  }

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(true)
    dragStartYRef.current = event.clientY
    dragStartScrollTopRef.current = scrollRef.current?.scrollTop ?? 0
    dragMaxScrollTopRef.current = metrics.maxScrollTop
    dragTravelRef.current = Math.max(1, (trackRef.current?.clientHeight ?? 0) - metrics.thumbHeight)
  }

  const handleThumbKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const element = scrollRef.current
    if (!element) return

    const page = Math.max(48, element.clientHeight * 0.9)
    switch (event.key) {
      case 'ArrowUp':
        element.scrollBy({ top: -48 })
        break
      case 'ArrowDown':
        element.scrollBy({ top: 48 })
        break
      case 'PageUp':
        element.scrollBy({ top: -page })
        break
      case 'PageDown':
        element.scrollBy({ top: page })
        break
      case 'Home':
        element.scrollTo({ top: 0 })
        break
      case 'End':
        element.scrollTo({ top: element.scrollHeight })
        break
      default:
        return
    }
    event.preventDefault()
  }

  const thumbStyle = {
    height: `${metrics.thumbHeight}px`,
    transform: `translateY(${metrics.thumbTop}px)`,
  } satisfies CSSProperties

  return (
    <div
      ref={trackRef}
      className={`chat-overlay-scrollbar${metrics.visible ? ' is-visible' : ''}`}
      aria-hidden={!metrics.visible}
      onPointerDown={handleTrackPointerDown}
    >
      {metrics.visible && (
        <div
          className="chat-overlay-scrollbar-thumb"
          role="scrollbar"
          tabIndex={0}
          aria-label="会话内容滚动条"
          aria-controls={controlsId}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={metrics.maxScrollTop}
          aria-valuenow={metrics.scrollTop}
          style={thumbStyle}
          onPointerDown={handleThumbPointerDown}
          onKeyDown={handleThumbKeyDown}
        />
      )}
    </div>
  )
}
