import { type CSSProperties } from 'react'
import { Panel, useReactFlow, useStore, useStoreApi, useViewport } from '@xyflow/react'
import { Icons } from '../../Icons'

const UnlockIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect width="16" height="11" x="4" y="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 7.7-1.55" />
  </svg>
)

// 复刻 ReactFlow 内置 Controls 的 store selector，保证锁定按钮状态实时响应。
const interactiveSelector = (s: {
  nodesDraggable: boolean
  nodesConnectable: boolean
  elementsSelectable: boolean
}) => s.nodesDraggable || s.nodesConnectable || s.elementsSelectable

/**
 * 画布底部缩放控制条。
 *
 * 交互能力与 React Flow Controls 一致，但使用画布独立的扁平视觉类，
 * 避免第三方控件主题覆盖按钮背景与前景色。
 *
 * 必须在 <ReactFlowProvider> 内使用（CanvasStage 已包裹）。
 */
export function CanvasZoomControls({
  className,
  style,
  minimapOpen,
  onToggleMinimap,
}: {
  className?: string
  style?: CSSProperties
  minimapOpen: boolean
  onToggleMinimap: () => void
}) {
  const store = useStoreApi()
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  const isInteractive = useStore(interactiveSelector)

  const state = store.getState()
  const minZoomReached = zoom <= state.minZoom
  const maxZoomReached = zoom >= state.maxZoom

  const handleToggleInteractivity = () => {
    store.setState({
      nodesDraggable: !isInteractive,
      nodesConnectable: !isInteractive,
      elementsSelectable: !isInteractive,
    })
  }

  const zoomPercent = `${Math.round(zoom * 100)}%`

  return (
    <Panel className={className} style={style} position="bottom-left">
      <button
        type="button"
        className="canvas-controls-button"
        title="放大"
        aria-label="放大"
        disabled={maxZoomReached}
        onClick={() => void zoomIn()}
      >
        <Icons.Plus size={16} strokeWidth={1.8} />
      </button>
      <output className="canvas-controls-zoom-label" aria-label={`当前缩放 ${zoomPercent}`}>
        {zoomPercent}
      </output>
      <button
        type="button"
        className="canvas-controls-button"
        title="缩小"
        aria-label="缩小"
        disabled={minZoomReached}
        onClick={() => void zoomOut()}
      >
        <Icons.Minus size={16} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="canvas-controls-button"
        title="适配视图"
        aria-label="适配视图"
        onClick={() =>
          void fitView({
            padding: 0.2,
            minZoom: 0.25,
            maxZoom: 1.8,
            duration: 260,
          })
        }
      >
        <Icons.Maximize size={15} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className={`canvas-controls-button canvas-controls-interactive${isInteractive ? '' : ' is-locked'}`}
        title={isInteractive ? '锁定画布元素' : '解锁画布元素'}
        aria-label={isInteractive ? '锁定画布元素' : '解锁画布元素'}
        aria-pressed={!isInteractive}
        onClick={handleToggleInteractivity}
      >
        {isInteractive ? <UnlockIcon /> : <Icons.Lock size={16} strokeWidth={1.8} />}
      </button>
      <span className="canvas-controls-divider" aria-hidden />
      <button
        type="button"
        className={`canvas-controls-button canvas-controls-minimap${minimapOpen ? ' is-open' : ''}`}
        aria-label={minimapOpen ? '收起小地图' : '展开小地图'}
        title={minimapOpen ? '收起小地图' : '展开小地图'}
        aria-pressed={minimapOpen}
        onClick={onToggleMinimap}
      >
        {minimapOpen ? <Icons.Minimize size={16} /> : <Icons.Map size={16} />}
      </button>
    </Panel>
  )
}
