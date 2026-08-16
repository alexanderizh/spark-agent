import { useCallback, useEffect, useRef } from 'react'
import {
  CANVAS_CONNECTION_ASSIST_RADIUS_PX,
  CANVAS_CONNECTION_CANDIDATE_CLASS,
  CANVAS_CONNECTION_INVALID_CLASS,
  getConnectionClientPoint,
  pickConnectionCandidate,
  resolveCardDropConnection,
  type CardDropConnection,
  type ConnectionAssistNodeRect,
  type ConnectionAssistRules,
  type ConnectionDragOrigin,
} from './canvasConnectionAssist'

/**
 * 连线吸附辅助的 DOM 接线层：
 * - 牵线期间监听 window pointermove（rAF 节流），按屏幕坐标挑选候选节点并
 *   直接在外层 .react-flow__node 上切换反馈类名，避免整图重渲染。
 * - 松手时若既没落在锚点上也没创建有效连接，则尝试卡片级投放：
 *   命中卡片且通过业务规则预检时返回可直接创建的连接。
 */

const NODE_SELECTOR = '.react-flow__node'
const NODE_ID_ATTRIBUTE = 'data-id'

export interface ConnectionAssistDropResult {
  /** 松手点位于某张节点卡片上（无论是否允许连接）。 */
  droppedOnNode: boolean
  /** 通过业务规则预检、可直接创建的卡片级连接。 */
  connect: CardDropConnection | null
}

interface UseCanvasConnectionAssistParams {
  stageRef: React.RefObject<HTMLDivElement | null>
  getRules: () => ConnectionAssistRules
}

interface ActiveDragState {
  origin: ConnectionDragOrigin
  pointer: { x: number; y: number } | null
  frame: number | null
  appliedElement: Element | null
  appliedClass: string | null
}

interface CollectedNodeEntry extends ConnectionAssistNodeRect {
  element: Element
}

function collectNodeEntries(root: ParentNode): CollectedNodeEntry[] {
  const elements = Array.from(root.querySelectorAll(NODE_SELECTOR))
  return elements.flatMap((element, order) => {
    const id = element.getAttribute(NODE_ID_ATTRIBUTE)
    if (!id) return []
    const rect = element.getBoundingClientRect()
    const zIndexValue = Number.parseFloat(window.getComputedStyle(element).zIndex)
    return [
      {
        id,
        element,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        zIndex: Number.isFinite(zIndexValue) ? zIndexValue : 0,
        order,
      },
    ]
  })
}

function clearAppliedFeedback(state: ActiveDragState): void {
  if (state.appliedElement && state.appliedClass) {
    state.appliedElement.classList.remove(state.appliedClass)
  }
  state.appliedElement = null
  state.appliedClass = null
}

export function useCanvasConnectionAssist({ stageRef, getRules }: UseCanvasConnectionAssistParams) {
  const activeDragRef = useRef<ActiveDragState | null>(null)
  const getRulesRef = useRef(getRules)
  useEffect(() => {
    getRulesRef.current = getRules
  }, [getRules])

  const evaluatePointer = useCallback(
    (state: ActiveDragState) => {
      const root = stageRef.current
      const pointer = state.pointer
      if (!root || !pointer) return
      const entries = collectNodeEntries(root)
      const candidate = pickConnectionCandidate(
        entries,
        pointer,
        CANVAS_CONNECTION_ASSIST_RADIUS_PX,
        state.origin.nodeId,
      )
      if (!candidate) {
        clearAppliedFeedback(state)
        return
      }
      const element = entries.find((entry) => entry.id === candidate.id)?.element
      if (!element) {
        clearAppliedFeedback(state)
        return
      }
      const connect = resolveCardDropConnection({
        origin: state.origin,
        dropNodeId: candidate.id,
        rules: getRulesRef.current(),
      })
      const nextClass = connect
        ? CANVAS_CONNECTION_CANDIDATE_CLASS
        : CANVAS_CONNECTION_INVALID_CLASS
      if (state.appliedElement === element && state.appliedClass === nextClass) return
      clearAppliedFeedback(state)
      element.classList.add(nextClass)
      state.appliedElement = element
      state.appliedClass = nextClass
    },
    [stageRef],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const state = activeDragRef.current
      if (!state) return
      state.pointer = { x: event.clientX, y: event.clientY }
      if (state.frame != null) return
      state.frame = window.requestAnimationFrame(() => {
        state.frame = null
        if (activeDragRef.current === state) evaluatePointer(state)
      })
    },
    [evaluatePointer],
  )

  const beginConnectionDrag = useCallback(
    (origin: ConnectionDragOrigin | null) => {
      if (activeDragRef.current) return
      if (!origin) return
      activeDragRef.current = {
        origin,
        pointer: null,
        frame: null,
        appliedElement: null,
        appliedClass: null,
      }
      window.addEventListener('pointermove', handlePointerMove)
    },
    [handlePointerMove],
  )

  const endConnectionDrag = useCallback(
    (event: MouseEvent | TouchEvent): ConnectionAssistDropResult | null => {
      const state = activeDragRef.current
      if (!state) return null
      activeDragRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      if (state.frame != null) window.cancelAnimationFrame(state.frame)
      clearAppliedFeedback(state)
      const point = getConnectionClientPoint(event)
      if (!point) return { droppedOnNode: false, connect: null }
      const nodeElement = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>(NODE_SELECTOR)
      const dropNodeId = nodeElement?.getAttribute(NODE_ID_ATTRIBUTE) ?? null
      if (!nodeElement || !dropNodeId) return { droppedOnNode: false, connect: null }
      const connect = resolveCardDropConnection({
        origin: state.origin,
        dropNodeId,
        rules: getRulesRef.current(),
      })
      return { droppedOnNode: true, connect }
    },
    [handlePointerMove],
  )

  useEffect(
    () => () => {
      const state = activeDragRef.current
      if (!state) return
      activeDragRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      if (state.frame != null) window.cancelAnimationFrame(state.frame)
      clearAppliedFeedback(state)
    },
    [handlePointerMove],
  )

  return { beginConnectionDrag, endConnectionDrag }
}
