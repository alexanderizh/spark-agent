import { useCallback, useRef } from 'react'
import type { CanvasStageViewport } from './CanvasStage'

/**
 * 维护画布视口的最新快照（供节点放置、任务视口捕获等命令式读取）。
 *
 * 历史：这里曾为「浮动编辑面板跟随视口」维护 tick state，视口每帧变化都会
 * setTick 并触发宿主 CanvasWorkspaceView 全量重渲染；面板几何实际未被消费，
 * 纯属每帧白付的渲染成本，已移除。需要跟随视口的 UI 请改为命令式读取
 * viewportRef.current，不要回到 state 驱动。
 */
export function useFloatingViewportGeometry(): {
  viewportRef: React.MutableRefObject<CanvasStageViewport | null>
  onViewportChange: (viewport: CanvasStageViewport) => void
} {
  const viewportRef = useRef<CanvasStageViewport | null>(null)

  const onViewportChange = useCallback((viewport: CanvasStageViewport) => {
    viewportRef.current = viewport
  }, [])

  return { viewportRef, onViewportChange }
}
