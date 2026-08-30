import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Icons } from '../../Icons'
import {
  DIAGRAM_MAX_ZOOM,
  DIAGRAM_MIN_ZOOM,
  clampDiagramZoom,
  getDiagramFitZoom,
  getDiagramWheelZoom,
  getZoomedScrollPosition,
  stepDiagramZoom,
} from './diagramViewportMath'

type DiagramViewportProps = {
  children: ReactNode
  fullscreen?: boolean
  ariaLabel: string
}

type ContentSize = { width: number; height: number }

type PanState = {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
}

const DEFAULT_CONTENT_SIZE: ContentSize = { width: 1, height: 1 }

export function DiagramViewport({ children, fullscreen = false, ariaLabel }: DiagramViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(1)
  const panRef = useRef<PanState | null>(null)
  const [zoom, setZoom] = useState(1)
  const [contentSize, setContentSize] = useState<ContentSize>(DEFAULT_CONTENT_SIZE)
  const [dragging, setDragging] = useState(false)

  const measureContent = useCallback(() => {
    const content = contentRef.current
    if (!content) return
    const rect = content.getBoundingClientRect()
    const currentZoom = zoomRef.current || 1
    const width = Math.max(content.scrollWidth, rect.width / currentZoom)
    const height = Math.max(content.scrollHeight, rect.height / currentZoom)
    if (width <= 1 || height <= 1) return
    const next = { width: Math.ceil(width), height: Math.ceil(height) }
    setContentSize((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    )
  }, [])

  useEffect(() => {
    measureContent()
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureContent)
    observer.observe(content)
    return () => observer.disconnect()
  }, [children, measureContent])

  const applyZoom = useCallback((requestedZoom: number, pointer?: { x: number; y: number }) => {
    const nextZoom = clampDiagramZoom(requestedZoom)
    const currentZoom = zoomRef.current
    if (nextZoom === currentZoom) return

    const viewport = viewportRef.current
    let nextScroll: { scrollLeft: number; scrollTop: number } | null = null
    if (viewport) {
      const anchor = pointer ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
      nextScroll = getZoomedScrollPosition({
        currentZoom,
        nextZoom,
        pointerX: anchor.x,
        pointerY: anchor.y,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      })
    }

    zoomRef.current = nextZoom
    setZoom(nextZoom)
    if (viewport && nextScroll) {
      requestAnimationFrame(() => {
        viewport.scrollLeft = nextScroll.scrollLeft
        viewport.scrollTop = nextScroll.scrollTop
      })
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent): void => {
      if (!fullscreen && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const rect = viewport.getBoundingClientRect()
      applyZoom(getDiagramWheelZoom(zoomRef.current, event.deltaY), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [applyZoom, fullscreen])

  const handleFit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    applyZoom(
      getDiagramFitZoom({
        viewportWidth: viewport.clientWidth,
        viewportHeight: viewport.clientHeight,
        contentWidth: contentSize.width,
        contentHeight: contentSize.height,
        padding: fullscreen ? 32 : 24,
      }),
    )
  }, [applyZoom, contentSize, fullscreen])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!fullscreen || event.button !== 0) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('button, a, foreignObject, input, textarea, select')) return
      const viewport = viewportRef.current
      if (!viewport) return
      panRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      viewport.setPointerCapture?.(event.pointerId)
      setDragging(true)
    },
    [fullscreen],
  )

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    const viewport = viewportRef.current
    if (!pan || !viewport || pan.pointerId !== event.pointerId) return
    event.preventDefault()
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.clientY)
  }, [])

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return
    viewportRef.current?.releasePointerCapture?.(event.pointerId)
    panRef.current = null
    setDragging(false)
  }, [])

  const zoomPercent = `${Math.round(zoom * 100)}%`
  const surfaceStyle = {
    width: `${Math.max(1, Math.round(contentSize.width * zoom))}px`,
    height: `${Math.max(1, Math.round(contentSize.height * zoom))}px`,
  }

  return (
    <div
      className={`render-diagram-viewport-shell${fullscreen ? ' is-fullscreen' : ''}`}
      aria-label={ariaLabel}
    >
      <div className="render-diagram-zoom-controls" role="toolbar" aria-label="图表缩放工具">
        <button
          type="button"
          className="render-diagram-zoom-button"
          aria-label="缩小图表"
          title="缩小"
          disabled={zoom <= DIAGRAM_MIN_ZOOM}
          onClick={() => applyZoom(stepDiagramZoom(zoomRef.current, -1))}
        >
          <Icons.Minus size={15} />
        </button>
        <button
          type="button"
          className="render-diagram-zoom-label"
          aria-label="重置图表缩放为 100%"
          title="重置为 100%"
          data-diagram-zoom-label
          onClick={() => applyZoom(1)}
        >
          {zoomPercent}
        </button>
        <button
          type="button"
          className="render-diagram-zoom-button"
          aria-label="放大图表"
          title="放大"
          disabled={zoom >= DIAGRAM_MAX_ZOOM}
          onClick={() => applyZoom(stepDiagramZoom(zoomRef.current, 1))}
        >
          <Icons.Plus size={15} />
        </button>
        <span className="render-diagram-zoom-divider" aria-hidden />
        <button
          type="button"
          className="render-diagram-zoom-button"
          aria-label="适应图表窗口"
          title="适应窗口"
          onClick={handleFit}
        >
          <Icons.Maximize size={14} />
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`render-diagram-viewport${dragging ? ' is-dragging' : ''}`}
        data-diagram-viewport
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div className="render-diagram-viewport-stage">
          <div className="render-diagram-viewport-surface" style={surfaceStyle}>
            <div
              ref={contentRef}
              className="render-diagram-viewport-content"
              style={{ transform: `scale(${zoom})` }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
