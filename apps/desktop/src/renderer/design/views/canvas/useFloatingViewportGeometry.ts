import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CanvasNode } from './canvas.types'
import type { CanvasStageViewport } from './CanvasStage'

type FloatingEditorGeometry = {
  toolbar: CSSProperties
  panel: CSSProperties
} | null

export function useFloatingViewportGeometry(
  node: CanvasNode | null,
  getGeometry: (
    node: CanvasNode,
    viewport: CanvasStageViewport | null,
  ) => FloatingEditorGeometry,
): {
  geometry: FloatingEditorGeometry
  viewportRef: React.MutableRefObject<CanvasStageViewport | null>
  onViewportChange: (viewport: CanvasStageViewport) => void
} {
  const viewportRef = useRef<CanvasStageViewport | null>(null)
  const nodeRef = useRef(node)
  nodeRef.current = node
  const rafRef = useRef<number | null>(null)
  const [tick, setTick] = useState(0)

  const scheduleGeometryUpdate = useCallback(() => {
    if (!nodeRef.current) return
    if (rafRef.current != null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      setTick((value) => value + 1)
    })
  }, [])

  const onViewportChange = useCallback(
    (viewport: CanvasStageViewport) => {
      viewportRef.current = viewport
      if (nodeRef.current) scheduleGeometryUpdate()
    },
    [scheduleGeometryUpdate],
  )

  useEffect(() => {
    if (node) setTick((value) => value + 1)
  }, [node?.id])

  useEffect(
    () => () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const geometry = useMemo(() => {
    void tick
    if (!node) return null
    return getGeometry(node, viewportRef.current)
  }, [getGeometry, node, tick])

  return { geometry, viewportRef, onViewportChange }
}
