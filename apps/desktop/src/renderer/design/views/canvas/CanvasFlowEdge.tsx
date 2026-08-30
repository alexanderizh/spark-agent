import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'

/** toFlowEdge 写入的边数据：flow 表示该边与选中节点相连，驱动流光特效。 */
export type CanvasFlowEdgeData = {
  flow: boolean
}

/**
 * 画布统一自定义边：默认态是清晰的中性色曲线；
 * 与选中节点相连时整条提亮为主题色，并叠加「流光」——
 * 一段带光晕的亮光沿 source → target 方向流动（双层描边 + 负向 dashoffset 动画）。
 *
 * 流光 path 使用 pathLength=100 归一化：dasharray/dashoffset 与真实边长无关，
 * 所有边以同一视觉速度流动，且起止两端各留一段全隐藏区，循环无缝、光不会凭空闪现。
 */
export const CANVAS_EDGE_TYPE = 'canvasEdge' as const

export type CanvasFlowEdge = Edge<CanvasFlowEdgeData, typeof CANVAS_EDGE_TYPE>

function FlowStreakLayer({ path, delay }: { path: string; delay?: number }) {
  return (
    <>
      <path
        d={path}
        pathLength={100}
        className="canvas-edge-streak-glow"
        style={delay ? { animationDelay: `${delay}s` } : undefined}
      />
      <path
        d={path}
        pathLength={100}
        className="canvas-edge-streak-core"
        style={delay ? { animationDelay: `${delay}s` } : undefined}
      />
    </>
  )
}

export function CanvasFlowEdgeRenderer({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
}: EdgeProps<CanvasFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const flow = data?.flow === true
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={36}
        // exactOptionalPropertyTypes 下可选 prop 不接受显式 undefined，无值时不传。
        {...(markerStart != null ? { markerStart } : undefined)}
        {...(markerEnd != null ? { markerEnd } : undefined)}
        className={flow ? 'canvas-edge-base canvas-edge-base-flow' : 'canvas-edge-base'}
      />
      {flow && (
        <g className="canvas-edge-streak" aria-hidden="true">
          <FlowStreakLayer path={path} />
          {/* 第二道流光错开半个周期，长边上不会出现长时间全暗的空档 */}
          <FlowStreakLayer path={path} delay={-0.65} />
        </g>
      )}
    </>
  )
}
