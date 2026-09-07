import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { CanvasFlowEdgeData } from './CanvasFlowEdge'
import type { CanvasFlowNodeData } from './CanvasNode'
import { resolveCanvasMultiSelectToolbarGeometry } from './canvasMultiSelectToolbarGeometry'

export type CanvasMultiSelectToolbarOverlayHandle = {
  schedulePositionUpdate: () => void
}

type CanvasMultiSelectToolbarOverlayProps = {
  stageRef: RefObject<HTMLDivElement | null>
  getFlowInstance: () => ReactFlowInstance<
    Node<CanvasFlowNodeData>,
    Edge<CanvasFlowEdgeData>
  > | null
  selectedNodeIds: ReadonlySet<string>
  children: (popoverSide: 'top' | 'bottom') => ReactNode
}

/**
 * 多选工具栏的独立定位边界。
 *
 * 视口和节点拖动期间直接更新 anchor 样式，避免为了跟随坐标而重渲染包含全部
 * React Flow 节点的 CanvasStage。只有工具栏从选区上方翻转到下方（或反向）时，
 * 才局部更新一次 popover 的展开方向。
 */
export const CanvasMultiSelectToolbarOverlay = forwardRef<
  CanvasMultiSelectToolbarOverlayHandle,
  CanvasMultiSelectToolbarOverlayProps
>(function CanvasMultiSelectToolbarOverlay(
  { stageRef, getFlowInstance, selectedNodeIds, children },
  forwardedRef,
) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const placeAboveRef = useRef(true)
  const [placeAbove, setPlaceAbove] = useState(true)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    const stage = stageRef.current
    const instance = getFlowInstance()
    if (!anchor || !stage || !instance) return

    const geometry = resolveCanvasMultiSelectToolbarGeometry({
      stage,
      instance,
      selectedNodeIds,
    })
    if (!geometry) {
      anchor.style.visibility = 'hidden'
      return
    }

    anchor.style.left = `${geometry.left}px`
    anchor.style.top = `${geometry.top}px`
    anchor.style.visibility = 'visible'
    if (placeAboveRef.current !== geometry.placeAbove) {
      placeAboveRef.current = geometry.placeAbove
      setPlaceAbove(geometry.placeAbove)
    }
  }, [getFlowInstance, selectedNodeIds, stageRef])

  const schedulePositionUpdate = useCallback(() => {
    if (frameRef.current != null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      updatePosition()
    })
  }, [updatePosition])

  useImperativeHandle(forwardedRef, () => ({ schedulePositionUpdate }), [schedulePositionUpdate])

  useLayoutEffect(() => {
    updatePosition()
  }, [updatePosition])

  useLayoutEffect(
    () => () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  return (
    <div
      ref={anchorRef}
      className="canvas-multi-select-toolbar-anchor"
      style={{
        position: 'absolute',
        visibility: 'hidden',
        transform: 'translateX(-50%)',
        zIndex: 'var(--z-canvas-context, 30)',
        pointerEvents: 'auto',
      }}
    >
      {children(placeAbove ? 'bottom' : 'top')}
    </div>
  )
})
