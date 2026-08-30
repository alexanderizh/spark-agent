import type { CanvasDepthModelState } from './canvasOperationPanelMode'

export function CanvasDepthModelNotice({
  state,
  error,
  compact = false,
}: {
  state: CanvasDepthModelState
  error: string
  compact?: boolean
}) {
  const text =
    state === 'ready'
      ? '本地 Depth Anything V2 模型已就绪，运行时不会调用云端模型。'
      : state === 'installing'
        ? '正在下载 Depth Anything V2 模型，请稍候。'
        : state === 'error'
          ? `深度模型状态读取失败：${error || '未知错误'}`
          : compact
            ? '首次运行会下载 Depth Anything V2 模型，完成后可离线使用。'
            : '使用本地 Depth Anything V2 生成近白远黑的深度视频转换结果；首次运行会下载模型，之后可离线使用。'

  if (compact) return <div className="canvas-operation-panel-hint">{text}</div>
  return (
    <div className="canvas-operation-panel-section canvas-operation-panel-section-runtime">
      <div className="canvas-operation-panel-section-label">本地深度模型</div>
      <div className="canvas-operation-panel-hint">{text}</div>
    </div>
  )
}
